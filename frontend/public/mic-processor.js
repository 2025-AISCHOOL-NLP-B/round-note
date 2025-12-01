class MicProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        // 포트(Port)를 통해 메인 스레드(React Hook)와 통신합니다.
    }
    
    // AudioWorklet의 핵심 함수: 오디오 버퍼가 도착할 때마다 호출됨
    process(inputs, outputs, parameters) {
        // inputs[0] : 마이크 스트림의 첫 번째 입력
        const input = inputs[0]; 

        if (input.length > 0) {
            const inputBuffer = input[0]; // 모노 입력(채널 0)
            
            // Float32Array (Web Audio 기본)를 Int16Array (Deepgram 요구)로 변환
            const output = new Int16Array(inputBuffer.length);
            for (let i = 0; i < inputBuffer.length; i++) {
                // 부동소수점 값을 16비트 정수 범위로 변환 (-32768 ~ 32767)
                output[i] = Math.max(-1, Math.min(1, inputBuffer[i])) * 0x7FFF; 
            }
            
            // 1. 처리된 버퍼를 메인 스레드(React Hook)로 전송
            // 2. [output.buffer]는 메모리 이동(transfer)을 위한 표식입니다.
            this.port.postMessage(output.buffer, [output.buffer]);
        }
        return true; // 계속 오디오 처리를 진행합니다.
    }
}
// Worklet에 등록될 이름
registerProcessor('mic-processor', MicProcessor);