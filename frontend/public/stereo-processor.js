class StereoProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.micEnabled = false; // 기본값: VAD로 제어
        this.energyDebugEnabled = false;
        this.frameCounter = 0;
        this.alwaysSendMic = false; // 기본값: 게이팅 적용
        
        // 버퍼링 설정
        this.BUFFER_SIZE = 4096; // 약 85ms @ 48kHz
        this.buffer = new Int16Array(this.BUFFER_SIZE * 2); // Stereo
        this.bufferIndex = 0;
        
        console.log("[StereoProcessor] Initialized. Ready to process. BufferSize:", this.BUFFER_SIZE);
        
        this.port.onmessage = (event) => {
            if (event.data.type === 'setMicEnabled') {
                this.micEnabled = event.data.value;
            } else if (event.data.type === 'setEnergyDebug') {
                this.energyDebugEnabled = !!event.data.value;
                console.log('[StereoProcessor] Energy debug set to', this.energyDebugEnabled);
            } else if (event.data.type === 'setAlwaysSendMic') {
                this.alwaysSendMic = !!event.data.value;
                console.log('[StereoProcessor] alwaysSendMic set to', this.alwaysSendMic);
            }
        };
    }

    process(inputs, outputs, parameters) {
        // inputs[0]은 ChannelMerger에서 온 스테레오 입력입니다.
        const input = inputs[0];
        
        // [Debug] 입력 상태 로깅 (200 프레임마다)
        if (this.frameCounter % 200 === 0) {
             const channelCount = input ? input.length : 0;
             console.log(`[StereoProcessor] Frame ${this.frameCounter}. Input channels: ${channelCount}. MicEnabled: ${this.micEnabled}`);
        }

        if (!input || input.length === 0) return true;

        // 채널이 없으면 무음 처리
        const left = input.length > 0 ? input[0] : null;  // Channel 0: Mic
        const right = input.length > 1 ? input[1] : null; // Channel 1: System

        // 시스템 오디오 에너지 체크 (RMS)
        let systemEnergy = 0;
        if (right) {
            for (let i = 0; i < right.length; i++) {
                systemEnergy += right[i] * right[i];
            }
            systemEnergy = Math.sqrt(systemEnergy / right.length);
        }

        // 입력 길이 결정 (보통 128)
        const inputLength = left ? left.length : (right ? right.length : 128);
        
        for (let i = 0; i < inputLength; i++) {
            // 마이크 채널 (Left) - VAD 게이팅 적용
            // left가 없으면 0 (무음)
            let micRaw = left ? left[i] : 0;
            let micSample = (this.micEnabled || this.alwaysSendMic) ? micRaw : 0;
            
            // 시스템 채널 (Right) - 게이팅 없이 항상 통과
            // right가 없으면 0 (무음)
            let sysSample = right ? right[i] : 0;

            // Float32 -> Int16 변환
            micSample = Math.max(-1, Math.min(1, micSample));
            sysSample = Math.max(-1, Math.min(1, sysSample));
            
            // 버퍼에 저장 (Interleaved)
            if (this.bufferIndex < this.buffer.length) {
                this.buffer[this.bufferIndex++] = micSample < 0 ? micSample * 0x8000 : micSample * 0x7FFF;
                this.buffer[this.bufferIndex++] = sysSample < 0 ? sysSample * 0x8000 : sysSample * 0x7FFF;
            }
            
            // 버퍼가 가득 차면 전송
            if (this.bufferIndex >= this.buffer.length) {
                this.port.postMessage(this.buffer.buffer, [this.buffer.buffer]);
                
                // [Debug] 데이터 전송 로그 (100번 전송마다 한 번씩)
                if (this.frameCounter % 100 === 0) {
                    console.log(`[StereoProcessor] Sent buffer. MicEnabled: ${this.micEnabled}, SystemEnergy: ${systemEnergy.toFixed(4)}`);
                }

                // 새 버퍼 생성 (Transferable로 보냈으므로 원본은 사용 불가)
                this.buffer = new Int16Array(this.BUFFER_SIZE * 2);
                this.bufferIndex = 0;
            }
        }
        
        this.frameCounter++;
        return true; // 프로세서 유지
    }
}

registerProcessor('stereo-processor', StereoProcessor);
