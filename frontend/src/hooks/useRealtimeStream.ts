import { useState, useRef, useCallback, useEffect } from 'react';
import { useMicVAD, ReactRealTimeVADOptions } from '@ricky0123/vad-react';

// WebSocket 설정 관련 전역 상수
const WS_URL = process.env.NEXT_PUBLIC_API_URL ?
    `ws${process.env.NEXT_PUBLIC_API_URL.substring(4)}/api/v1/realtime/ws` :
    'ws://localhost:8000/api/v1/realtime/ws';

// 오디오 설정 (Deepgram 요구사항에 맞춤)
const AUDIO_CONFIG = {
    sampleRate: 16000,
    channel: 1,
    bufferSize: 4096,
};

function float32ToInt16(float32Array: Float32Array): Int16Array {
    let int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        // -1.0에서 1.0 범위로 클리핑
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        // 16비트 정수로 변환
        int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array;
}

function float32ToStereoInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length * 2);
    for (let i = 0; i < float32Array.length; i++) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        let v = s < 0 ? s * 0x8000 : s * 0x7FFF;
        int16Array[i * 2] = v;     // Left (Mic)
        int16Array[i * 2 + 1] = 0; // Right (Silence)
    }
    return int16Array;
}

interface TimelineSummary {
    sequence: number;
    timeWindow: string;
    content: string;
    timestamp: number;
}

export interface TranscriptSegment {
    id: string;
    timestamp: string;
    speaker: string;
    text: string;
    isFinal: boolean;
    channelType?: 'Mic' | 'System';  // ✅ 이 줄 추가
}

interface RealtimeStreamControls {
    isRecording: boolean;
    isPaused: boolean;
    transcript: TranscriptSegment[];
    partialText: string;
    translation: string;
    timelineSummaries: TimelineSummary[];
    isGeneratingSummary: boolean;
    startRecording: (meetingId?: string, participants?: string) => Promise<void>;
    stopRecording: () => void;
    pauseRecording: () => void;
    resumeRecording: () => void;
    vadLoading: boolean;
    startSystemAudio: () => Promise<void>;
    stopSystemAudio: () => void;
    isSystemAudioShared: boolean;
}

const useRealtimeStream = (): RealtimeStreamControls => {
    // 1. 상태 정의
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [isPaused, setIsPaused] = useState<boolean>(false);
    const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
    const [partialText, setPartialText] = useState<string>('');
    const [translation, setTranslation] = useState<string>('');
    const [timelineSummaries, setTimelineSummaries] = useState<TimelineSummary[]>([]);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState<boolean>(false);
    const [isSystemAudioShared, setIsSystemAudioShared] = useState<boolean>(false);

    // 2. Mutable 객체 참조
    const wsRef = useRef<WebSocket | null>(null);
    const isRecordingRef = useRef<boolean>(false); // 최신 isRecording 상태를 추적
    const isPausedRef = useRef<boolean>(false); // 최신 isPaused 상태를 추적
    const silenceIntervalRef = useRef<NodeJS.Timeout | null>(null); // 침묵 오디오 전송 인터벌
    const mediaStreamRef = useRef<MediaStream | null>(null); // 마이크 스트림 참조

    // Audio Processing Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const stereoNodeRef = useRef<AudioWorkletNode | null>(null);
    const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const systemSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const mergerNodeRef = useRef<ChannelMergerNode | null>(null);
    const systemStreamRef = useRef<MediaStream | null>(null);
    const lastStereoMessageTimeRef = useRef<number>(0); // 마지막으로 스테레오 프로세서에서 데이터를 받은 시간
    const currentChannelsRef = useRef<number>(1); // 현재 연결된 채널 수 (1: Mono, 2: Stereo)

    // 마이크 스트림을 직접 관리하여 추후 cleanup 시 트랙을 명확히 종료
    const getOrCreateMediaStream = useCallback(async (): Promise<MediaStream> => {
        if (mediaStreamRef.current) {
            const hasLiveTrack = mediaStreamRef.current.getTracks().some(track => track.readyState === 'live');
            if (hasLiveTrack) {
                return mediaStreamRef.current;
            }
        }

        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            throw new Error('Audio capture is not supported in this environment');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: AUDIO_CONFIG.channel,
                sampleRate: AUDIO_CONFIG.sampleRate,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        mediaStreamRef.current = stream;
        return stream;
    }, []);

    const pauseMediaStream = useCallback(async (stream: MediaStream) => {
        stream.getAudioTracks().forEach(track => {
            track.enabled = false;
        });
    }, []);

    const resumeMediaStream = useCallback(async (stream: MediaStream): Promise<MediaStream> => {
        const liveTrackExists = stream.getAudioTracks().some(track => track.readyState === 'live');
        if (!liveTrackExists) {
            mediaStreamRef.current = null;
            return getOrCreateMediaStream();
        }

        stream.getAudioTracks().forEach(track => {
            track.enabled = true;
        });
        mediaStreamRef.current = stream;
        return stream;
    }, [getOrCreateMediaStream]);

    // 오디오 처리 그래프 설정
    const setupAudioProcessing = useCallback(async () => {
        if (!mediaStreamRef.current) {
            console.warn("[AudioSetup] 마이크 스트림이 없어 오디오 처리를 설정할 수 없습니다.");
            return;
        }

        try {
            // 1. AudioContext 생성
            const audioContext = new AudioContext({ sampleRate: AUDIO_CONFIG.sampleRate });
            audioContextRef.current = audioContext;
            const actualSampleRate = audioContext.sampleRate;
            console.log(`[AudioSetup] AudioContext created. Requested: ${AUDIO_CONFIG.sampleRate}, Actual: ${actualSampleRate}, State: ${audioContext.state}`);

            if (actualSampleRate !== AUDIO_CONFIG.sampleRate) {
                console.warn(`⚠️ 샘플레이트 불일치! 요청: ${AUDIO_CONFIG.sampleRate}Hz, 실제: ${actualSampleRate}Hz`);
            }

            // 2. Worklet 모듈 로드
            try {
                console.log("[AudioSetup] Loading Worklet module...");
                await audioContext.audioWorklet.addModule('/stereo-processor.js');
                console.log("[AudioSetup] Worklet module loaded successfully.");
            } catch (err) {
                console.error("[AudioSetup] Worklet 모듈 로드 실패:", err);
                return;
            }

            // 3. 노드 생성
            const stereoNode = new AudioWorkletNode(audioContext, 'stereo-processor', {
                outputChannelCount: [2], // Stereo output
            });
            stereoNodeRef.current = stereoNode;

            const mergerNode = audioContext.createChannelMerger(2);
            mergerNodeRef.current = mergerNode;

            // 4. 마이크 소스 연결 (Channel 0)
            console.log(`[AudioSetup] Connecting Mic Stream: ${mediaStreamRef.current.id}, Tracks: ${mediaStreamRef.current.getAudioTracks().length}`);
            const micSource = audioContext.createMediaStreamSource(mediaStreamRef.current);
            micSourceRef.current = micSource;
            micSource.connect(mergerNode, 0, 0);

            // 4.5 시스템 오디오가 이미 있다면 연결 (Channel 1), 없으면 무음 소스 연결
            if (systemStreamRef.current) {
                const systemSource = audioContext.createMediaStreamSource(systemStreamRef.current);
                systemSourceRef.current = systemSource;
                systemSource.connect(mergerNode, 0, 1);
                console.log("기존 시스템 오디오 스트림 연결됨");
            } else {
                // [Fix] 시스템 오디오가 없을 때 Channel 1에 명시적으로 무음 연결
                // ChannelMerger가 연결되지 않은 채널을 다른 채널로 채우는 것을 방지
                const silenceBuffer = audioContext.createBuffer(1, 128, audioContext.sampleRate);
                const silenceSource = audioContext.createBufferSource();
                silenceSource.buffer = silenceBuffer;
                silenceSource.loop = true;
                silenceSource.connect(mergerNode, 0, 1);
                silenceSource.start();
                console.log("✅ Channel 1에 무음 소스 연결 (마이크 전용 모드)");
            }

            // 5. 프로세서 연결
            mergerNode.connect(stereoNode);

            // [Fix] Chrome 등 일부 브라우저에서 destination에 연결되지 않으면 AudioWorklet이 동작하지 않는 문제 해결
            // 무음 Gain 노드를 통해 destination에 연결하여 오디오 그래프 활성화 유지
            const silentGain = audioContext.createGain();
            silentGain.gain.value = 0;
            stereoNode.connect(silentGain);
            silentGain.connect(audioContext.destination);

            // AudioContext가 suspended 상태라면 재개
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
                console.log("AudioContext resumed");
            }

            // 5.5 시스템 오디오 공유 상태를 Worklet에 알림
            const systemAudioShared = !!systemStreamRef.current;
            stereoNode.port.postMessage({
                type: 'setSystemAudioActive',
                value: systemAudioShared
            });
            console.log(`[AudioSetup] System Audio Active: ${systemAudioShared}`);

            // 6. 데이터 전송 핸들러
            stereoNode.port.onmessage = (event) => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    // event.data is ArrayBuffer (Int16)
                    // console.log(`Sending audio chunk: ${event.data.byteLength} bytes`); // Debug

                    // [Debug] 가끔씩 데이터 내용 확인
                    if (Math.random() < 0.01) {
                        const int16Data = new Int16Array(event.data);
                        let hasRightSignal = false;
                        // Check every 2nd sample (Right channel)
                        for (let i = 1; i < int16Data.length; i += 2) {
                            if (int16Data[i] !== 0) {
                                hasRightSignal = true;
                                break;
                            }
                        }
                        if (hasRightSignal) {
                            console.log(`[Frontend] Sending Chunk with System Audio Signal 🔊`);
                        } else {
                            // console.log(`[Frontend] Sending Chunk - Right Channel Silent 🔇`);
                        }
                    }

                    wsRef.current.send(event.data);
                    lastStereoMessageTimeRef.current = Date.now(); // 마지막 전송 시간 갱신
                } else {
                    // console.warn("[AudioSetup] WebSocket not open, dropping audio chunk");
                }
            };

            console.log("오디오 처리 그래프 설정 완료 (Worklet running)");

        } catch (e) {
            console.error("오디오 처리 그래프 설정 오류:", e);
        }
    }, []);

    // 시스템 오디오 공유 시작
    const startSystemAudio = useCallback(async () => {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: true, // 오디오만 요청하는 것은 대부분의 브라우저에서 지원하지 않음
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                }
            });

            // 비디오 트랙은 필요 없으므로 중지 (또는 무시)
            // 주의: 비디오 트랙을 중지하면 공유 중지 UI가 사라질 수 있음. 
            // 하지만 오디오만 필요한 경우 리소스를 위해 중지하는 것이 좋음.
            // 여기서는 사용자가 "공유 중지"를 누를 수 있게 유지하되, 처리는 하지 않음.

            const audioTrack = stream.getAudioTracks()[0];
            if (!audioTrack) {
                console.warn("시스템 오디오 트랙을 찾을 수 없습니다. (오디오 공유 체크 확인)");
                stream.getTracks().forEach(t => t.stop());
                return;
            }

            systemStreamRef.current = stream;
            setIsSystemAudioShared(true);

            console.log(`[SystemAudio] Stream obtained. MicStream active: ${!!mediaStreamRef.current}`);

            // 만약 녹음 중이라면 즉시 오디오 그래프에 연결해야 함
            if (isRecordingRef.current) {
                if (audioContextRef.current && mergerNodeRef.current) {
                    // [Fix] AudioContext 상태 확인 및 재개
                    if (audioContextRef.current.state === 'suspended') {
                        await audioContextRef.current.resume();
                        console.log("[SystemAudio] AudioContext resumed for system audio connection");
                    }

                    // 이미 그래프가 있으면 연결
                    const systemSource = audioContextRef.current.createMediaStreamSource(stream);
                    systemSourceRef.current = systemSource;
                    systemSource.connect(mergerNodeRef.current, 0, 1);
                    console.log("시스템 오디오 연결됨 (기존 그래프)");

                    // Worklet에 시스템 오디오 활성화 알림
                    if (stereoNodeRef.current) {
                        stereoNodeRef.current.port.postMessage({
                            type: 'setSystemAudioActive',
                            value: true
                        });
                        console.log("[SystemAudio] Worklet에 시스템 오디오 활성화 알림");
                    }
                } else {
                    // 그래프가 없으면 새로 설정 (MicStream이 있어야 함)
                    if (mediaStreamRef.current) {
                        await setupAudioProcessing();
                    } else {
                        console.warn("[SystemAudio] 녹음 중이나 마이크 스트림이 없음. 그래프 설정 보류.");
                    }
                }
            } else {
                console.log("[SystemAudio] 녹음 대기 중. 시작 시 그래프 설정 예정.");
            }

            // 트랙 종료 핸들러 (사용자가 브라우저 UI에서 공유 중지 시)
            audioTrack.onended = () => {
                console.log("시스템 오디오 공유 중단됨 (UI)");
                stopSystemAudio();
            };

        } catch (e) {
            console.error("시스템 오디오 공유 시작 오류:", e);
        }
    }, []);

    // 시스템 오디오 공유 중지
    const stopSystemAudio = useCallback(() => {
        if (systemSourceRef.current) {
            systemSourceRef.current.disconnect();
            systemSourceRef.current = null;
        }

        if (systemStreamRef.current) {
            systemStreamRef.current.getTracks().forEach(track => track.stop());
            systemStreamRef.current = null;
        }

        setIsSystemAudioShared(false);

        // Worklet에 시스템 오디오 비활성화 알림
        if (stereoNodeRef.current) {
            stereoNodeRef.current.port.postMessage({
                type: 'setSystemAudioActive',
                value: false
            });
            console.log("[SystemAudio] Worklet에 시스템 오디오 비활성화 알림");
        }

        console.log("시스템 오디오 공유 중지됨");
    }, []);

    // VAD 설정 - pause/listening 확인
    const { loading: vadLoading, start: vadStart, pause: vadPause, userSpeaking, listening } = useMicVAD({
        model: "v5",
        inputSampleRate: AUDIO_CONFIG.sampleRate,
        baseAssetPath: '/',
        onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/',
        getStream: getOrCreateMediaStream,
        pauseStream: pauseMediaStream,
        resumeStream: resumeMediaStream,
        onFrameProcessed: (probs: any, frame: Float32Array) => {
            // [Fallback] 시스템 오디오 공유가 아닐 때, 또는 AudioWorklet이 동작하지 않을 때 VAD에서 직접 데이터 전송
            // AudioWorklet이 실패하거나 설정되지 않았을 때를 대비한 안전장치
            const now = Date.now();
            const isStereoActive = (now - lastStereoMessageTimeRef.current) < 1000; // 1초 이내에 데이터가 있었으면 활성 상태로 간주

            if (!isSystemAudioShared || !isStereoActive) {
                // 시스템 오디오 공유 중인데 스테레오가 비활성 상태라면 로그 출력 (최초 1회 또는 간헐적)
                if (isSystemAudioShared && !isStereoActive && Math.random() < 0.01) {
                    console.warn(`[Fallback] AudioWorklet 비활성. ContextState: ${audioContextRef.current?.state}. LastMsg: ${now - lastStereoMessageTimeRef.current}ms ago`);
                }

                // [Optimization] 현재 채널 설정에 따라 데이터 전송
                // Channels=1 (Mono): VAD Mono 데이터 그대로 전송
                // Channels=2 (Stereo): Mono 데이터를 Stereo로 변환하여 전송
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    const currentChannels = currentChannelsRef.current;

                    if (currentChannels === 1) {
                        // Mono 전송
                        const int16Frame = float32ToInt16(frame);
                        if (int16Frame.buffer.byteLength > 0) {
                            wsRef.current.send(int16Frame.buffer);
                        }
                    } else {
                        // Stereo 전송 (Mono를 L-R-L-R로 복제)
                        const stereoFrame = float32ToStereoInt16(frame);
                        if (stereoFrame.buffer.byteLength > 0) {
                            wsRef.current.send(stereoFrame.buffer);
                        }
                    }
                }
            }
        },
        onSpeechStart: () => {
            console.log("VAD: Speech Started");
            if (stereoNodeRef.current) {
                stereoNodeRef.current.port.postMessage({ type: 'setMicEnabled', value: true });
            }
        },
        onSpeechEnd: () => {
            console.log("VAD: Speech End");
            if (stereoNodeRef.current) {
                stereoNodeRef.current.port.postMessage({ type: 'setMicEnabled', value: false });
            }
        },
    } as Partial<ReactRealTimeVADOptions>);

    // isRecording 변경 시 ref 동기화
    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    // isPaused 변경 시 ref 동기화
    useEffect(() => {
        isPausedRef.current = isPaused;
    }, [isPaused]);

    // VAD 로딩 완료 시 즉시 pause하여 마이크 자동 시작 방지
    useEffect(() => {
        if (!vadLoading && vadPause) {
            vadPause();
            console.log("VAD 로딩 완료, 자동 pause 적용됨");
        }
    }, [vadLoading, vadPause]);

    // 침묵 오디오 프레임 생성 및 전송 함수
    const sendSilenceFrame = useCallback(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            // 100ms분량의 침묵 오디오 (16000Hz * 0.1s = 1600 samples)
            const silenceFrameSize = Math.floor(AUDIO_CONFIG.sampleRate * 0.1);
            const silenceFrame = new Int16Array(silenceFrameSize).fill(0);
            wsRef.current.send(silenceFrame.buffer);
            // console.log("침묵 프레임 전송");
        }
    }, []);

    // 일시정지 중 침묵 오디오 전송 인터벌 관리
    useEffect(() => {
        if (isPaused && isRecording) {
            // 일시정지 상태: 100ms마다 침묵 프레임 전송
            console.log("침묵 오디오 전송 시작 (WebSocket 연결 유지용)");
            silenceIntervalRef.current = setInterval(() => {
                sendSilenceFrame();
            }, 100); // 100ms마다
        } else {
            // 일시정지 해제 또는 녹음 중지: 인터벌 정리
            if (silenceIntervalRef.current) {
                console.log("침묵 오디오 전송 중지");
                clearInterval(silenceIntervalRef.current);
                silenceIntervalRef.current = null;
            }
        }

        return () => {
            if (silenceIntervalRef.current) {
                clearInterval(silenceIntervalRef.current);
                silenceIntervalRef.current = null;
            }
        };
    }, [isPaused, isRecording, sendSilenceFrame]);

    // 리소스 정리 함수
    const cleanupResources = useCallback(() => {
        console.log("리소스 정리 시작");

        // 시스템 오디오 정리
        stopSystemAudio();

        // 오디오 그래프 정리
        if (micSourceRef.current) {
            micSourceRef.current.disconnect();
            micSourceRef.current = null;
        }
        if (mergerNodeRef.current) {
            mergerNodeRef.current.disconnect();
            mergerNodeRef.current = null;
        }
        if (stereoNodeRef.current) {
            stereoNodeRef.current.port.onmessage = null;
            stereoNodeRef.current.disconnect();
            stereoNodeRef.current = null;
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        // 침묵 오디오 인터벌 정리
        if (silenceIntervalRef.current) {
            clearInterval(silenceIntervalRef.current);
            silenceIntervalRef.current = null;
        }

        // VAD 중지 - pause 메서드 사용
        try {
            vadPause();
            console.log("VAD pause 호출됨");
        } catch (e) {
            console.error("VAD 중지 오류:", e);
        }

        // 마이크 스트림 ref에 저장된 것이 있다면 중지
        if (mediaStreamRef.current) {
            try {
                mediaStreamRef.current.getTracks().forEach(track => {
                    track.stop();
                    console.log("저장된 마이크 트랙 중지:", track.label);
                });
                mediaStreamRef.current = null;
            } catch (e) {
                console.error("저장된 마이크 스트림 중지 오류:", e);
            }
        }

        // WebSocket 연결 닫기
        if (wsRef.current) {
            try {
                const ws = wsRef.current;

                // 핸들러 제거
                ws.onmessage = null;
                ws.onclose = null;
                ws.onerror = null;

                if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                    ws.close();
                }
                wsRef.current = null;
                console.log("WebSocket 정리됨");
            } catch (e: unknown) {
                console.error("WebSocket 정리 오류:", e);
            }
        }
    }, [vadPause]);

    // 녹음 시작
    const startRecording = useCallback(async (meetingId?: string, participants?: string) => {
        if (vadLoading) {
            console.log("VAD 로딩 중...");
            return;
        }

        try {
            // [Fix] AudioContext를 WebSocket 연결 전에 미리 생성하여 실제 샘플레이트 감지
            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContext({ sampleRate: AUDIO_CONFIG.sampleRate });
                const detectedRate = audioContextRef.current.sampleRate;
                console.log(`[AudioSetup] AudioContext created. SampleRate: ${detectedRate}Hz`);
            }

            // [Optimization] 시스템 오디오 공유 여부에 따라 채널 수 결정
            // System Audio ON -> Stereo (2ch)
            // System Audio OFF -> Mono (1ch)
            const channels = isSystemAudioShared ? 2 : 1;
            currentChannelsRef.current = channels;

            // [Fix] AudioWorklet에서 다운샘플링 수행하므로 항상 16kHz로 전송
            const transmitSampleRate = AUDIO_CONFIG.sampleRate; // 16000Hz

            let wsUrl = WS_URL + `?translate=true&summary=true&channels=${channels}&sampleRate=${transmitSampleRate}`;
            if (meetingId) {
                wsUrl += `&meetingId=${meetingId}`;
            }

            // 참여자 이름을 키워드 부스팅용 파라미터로 추가
            if (participants && participants.trim()) {
                wsUrl += `&participants=${encodeURIComponent(participants)}`;
                console.log(`키워드 부스팅 활성화 - 참여자: ${participants}`);
            }

            console.log(`WebSocket 연결 시도 (Channels: ${channels}, SampleRate: ${transmitSampleRate}Hz [Downsampled], MeetingID: ${meetingId}):`, wsUrl);
            console.log("환경변수 API_URL:", process.env.NEXT_PUBLIC_API_URL);

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            // WebSocket 연결 상태 모니터링
            console.log("WebSocket readyState:", ws.readyState);
            // 0: CONNECTING, 1: OPEN, 2: CLOSING, 3: CLOSED

            // WebSocket 연결 대기
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.error("WebSocket 연결 타임아웃 (5초)");
                    reject(new Error("WebSocket 연결 타임아웃"));
                }, 5000);

                ws.onopen = (event: Event) => {
                    clearTimeout(timeout);
                    console.log("✅ WebSocket 연결 성공!");
                    console.log("WebSocket readyState:", ws.readyState);
                    resolve();
                };

                ws.onerror = (error: Event) => {
                    clearTimeout(timeout);
                    console.error("❌ WebSocket 연결 오류:", error);
                    console.error("WebSocket readyState:", ws.readyState);
                    reject(new Error("WebSocket 연결 실패"));
                };
            });

            // WebSocket 메시지 핸들러 설정
            ws.onmessage = (event: MessageEvent) => {
                console.log("📩 WebSocket 메시지 수신:", event.data);
                try {
                    const message = JSON.parse(event.data);
                    console.log("파싱된 메시지:", message);

                    switch (message.type) {
                        case 'partial_transcript':
                            console.log("임시 전사:", message.text);
                            setPartialText(message.text);
                            break;

                        case 'final_transcript': {
                            console.log("최종 전사:", message.text);
                            const now = new Date();
                            const timeString = `${now.getHours().toString().padStart(2, '0')}시 ${now.getMinutes().toString().padStart(2, '0')}분 ${now.getSeconds().toString().padStart(2, '0')}초`;

                            // [System Speaker X] 또는 [Mic Speaker X] 패턴 파싱
                            const match = message.text.match(/^\[(System|Mic)\s+Speaker\s+(\d+)\]\s*(.*)$/);
                            const channelType = match ? match[1] as 'System' | 'Mic' : null;
                            const speakerNum = match ? match[2] : null;
                            const cleanText = match ? match[3] : message.text;
                            const speaker = match ? `Speaker${speakerNum}` : "Unknown";

                            const newSegment: TranscriptSegment = {
                                id: Date.now().toString(),
                                timestamp: timeString,
                                speaker,       // ← 파싱된 speaker 반영
                                text: cleanText, // ← [Speaker X] 제거된 텍스트만 반영
                                isFinal: true,
                                channelType: channelType || undefined
                            };

                            setTranscript(prev => [...prev, newSegment]);
                            setPartialText('');
                            break;
                        }

                        case 'translation':
                            console.log("번역 결과:", message.translated_text);
                            setTranslation(message.translated_text);
                            break;

                        case 'summary_generating':
                            console.log("요약 생성 시작:", message.sequence);
                            setIsGeneratingSummary(true);
                            break;

                        case 'timeline_summary':
                            console.log("타임라인 요약 수신:", message.sequence, message.time_window);
                            setTimelineSummaries(prev => [...prev, {
                                sequence: message.sequence,
                                timeWindow: message.time_window,
                                content: message.content,
                                timestamp: message.timestamp
                            }]);
                            setIsGeneratingSummary(false);
                            break;

                        case 'summary_error':
                            console.error("요약 생성 오류:", message.message);
                            setIsGeneratingSummary(false);
                            break;

                        case 'error':
                            console.error("Server Error:", message.message);
                            setPartialText(`[ERROR]: ${message.message}`);
                            break;

                        default:
                            console.warn("Unknown message type:", message.type);
                    }
                } catch (e: unknown) {
                    console.error("메시지 파싱 오류:", e);
                    console.error("원본 데이터:", event.data);
                }
            };

            // WebSocket 종료 핸들러
            ws.onclose = (event: CloseEvent) => {
                console.log("🔴 WebSocket 연결 종료");
                console.log("Close code:", event.code);
                console.log("Close reason:", event.reason);
                console.log("Was clean:", event.wasClean);
                console.log("현재 녹음 상태:", isRecordingRef.current);

                // Close code 설명
                const closeCodeMessages = {
                    1000: "정상 종료",
                    1001: "서버 종료",
                    1006: "비정상 종료 (네트워크 오류 또는 서버 문제)",
                    1011: "서버 내부 오류",
                    1012: "서버 재시작",
                } as const;
                const closeReason = closeCodeMessages[event.code as keyof typeof closeCodeMessages] || "알 수 없음";

                if (isRecordingRef.current) {
                    setIsRecording(false);
                    // 연결 종료 시 에러 메시지를 세그먼트로 추가할지 여부는 선택사항. 
                    // 여기서는 로그만 남기고 UI에는 표시하지 않거나, 필요시 시스템 메시지로 추가 가능.
                    // setTranscript(prev => [...prev, { id: 'sys', timestamp: '', speaker: 'System', text: `[서버 연결 종료 - Code: ${event.code}]`, isFinal: true }]);
                }
            };

            // WebSocket 에러 핸들러 추가
            ws.onerror = (error: Event) => {
                console.error("WebSocket 실행 중 오류:", error);
            };

            // VAD 시작 - start 메서드 사용 (VAD가 내부적으로 마이크 스트림 관리)
            if (typeof vadStart === 'function') {
                // 마이크 스트림이 확실히 준비되었는지 확인
                if (!mediaStreamRef.current) {
                    console.log("VAD 시작 전 스트림 생성 시도...");
                    await getOrCreateMediaStream();
                }

                vadStart();
                console.log("VAD 시작됨");
            }

            // 오디오 처리 그래프 설정 (VAD 시작 후 스트림이 준비된 상태에서)
            // [Change] 시스템 오디오 공유 상태일 때만 Worklet 설정 (또는 필요시)
            if (isSystemAudioShared) {
                console.log("시스템 오디오 공유 모드: AudioWorklet(Stereo) 설정 시작");

                // [Optimization] AudioContext 상태 확인 및 재개
                // AudioContext는 이미 startRecording 초반에 생성되었음
                if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
                    await audioContextRef.current.resume().catch(e => console.warn("AudioContext resume failed:", e));
                }

                // VAD가 스트림을 점유하고 있을 수 있으므로 잠시 대기
                await new Promise(resolve => setTimeout(resolve, 500));

                // 재확인: 스트림이 여전히 유효한지
                if (mediaStreamRef.current) {
                    await setupAudioProcessing();
                } else {
                    console.warn("시스템 오디오 모드 시작 실패: 마이크 스트림 유실됨");
                }
            } else {
                console.log("기본 마이크 모드: VAD onFrameProcessed 사용 (Mono 전송)");
            }

            setIsRecording(true);
            // 초기화: 이전 대화 내용을 지우지 않고 유지하거나, 필요시 초기화. 
            // 여기서는 startRecording 시 초기화하지 않고 이어서 보여줌 (사용자 경험상 끊겼다 다시 해도 이어지는게 나을 수 있음)
            // 만약 매번 새로 시작하려면 setTranscript([]) 호출.

        } catch (e: unknown) {
            console.error("녹음 시작 오류:", e);
            cleanupResources();
            setIsRecording(false);
        }
    }, [vadLoading, vadStart, cleanupResources, isSystemAudioShared, setupAudioProcessing, getOrCreateMediaStream]);

    // 녹음 중지
    const stopRecording = useCallback(() => {
        if (!isRecording) {
            console.log("이미 녹음이 중지됨");
            return;
        }

        console.log("녹음 중지 시작");
        cleanupResources();

        setIsRecording(false);
        setIsPaused(false); // 일시정지 상태도 리셋
        setPartialText('');
        // 종료 메시지 추가 (선택사항)
        // setTranscript(prev => [...prev, { id: 'end', timestamp: '', speaker: 'System', text: '[녹음 종료]', isFinal: true }]);
        console.log("녹음 중지 완료");

    }, [isRecording, cleanupResources]);

    // 녹음 일시정지 (WebSocket은 유지, VAD만 pause)
    const pauseRecording = useCallback(() => {
        if (!isRecording || isPaused) {
            console.log("녹음 중이 아니거나 이미 일시정지됨");
            return;
        }

        console.log("녹음 일시정지");
        try {
            // 백엔드에 일시정지 상태 알림 (채널별 + 글로벌)
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED", value: true }));
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED_MIC", value: true }));
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED_SYSTEM", value: true }));
                console.log("일시정지 제어 메시지 전송 (채널별 + 글로벌)");
            }

            // AudioWorklet에 채널별 일시정지 알림
            if (stereoNodeRef.current) {
                stereoNodeRef.current.port.postMessage({ type: 'setPausedMic', value: true });
                stereoNodeRef.current.port.postMessage({ type: 'setPausedSystem', value: true });
                console.log("Worklet에 채널별 일시정지 메시지 전송");
            }

            vadPause();
            setIsPaused(true);
            console.log("VAD 일시정지 완료");
        } catch (e) {
            console.error("VAD 일시정지 오류:", e);
        }
    }, [isRecording, isPaused, vadPause]);

    // 녹음 재개 (VAD만 restart)
    const resumeRecording = useCallback(() => {
        if (!isRecording || !isPaused) {
            console.log("녹음 중이 아니거나 일시정지 상태가 아님");
            return;
        }

        console.log("녹음 재개");
        try {
            // 백엔드에 재개 상태 알림 (채널별 + 글로벌)
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED", value: false }));
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED_MIC", value: false }));
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED_SYSTEM", value: false }));
                console.log("재개 제어 메시지 전송 (채널별 + 글로벌)");
            }

            // AudioWorklet에 채널별 재개 알림
            if (stereoNodeRef.current) {
                stereoNodeRef.current.port.postMessage({ type: 'setPausedMic', value: false });
                stereoNodeRef.current.port.postMessage({ type: 'setPausedSystem', value: false });
                console.log("Worklet에 채널별 재개 메시지 전송");
            }

            vadStart();
            setIsPaused(false);
            console.log("VAD 재개 완료");
        } catch (e) {
            console.error("VAD 재개 오류:", e);
        }
    }, [isRecording, isPaused, vadStart]);

    // 컴포넌트 언마운트 시 정리
    useEffect(() => {
        return () => {
            console.log("컴포넌트 언마운트 - 리소스 정리 시작");

            // 침묵 인터벌 정리
            if (silenceIntervalRef.current) {
                clearInterval(silenceIntervalRef.current);
                silenceIntervalRef.current = null;
            }

            // VAD 강제 중지
            try {
                if (vadPause) {
                    vadPause();
                    console.log("언마운트 시 VAD pause 호출");
                }
            } catch (e) {
                console.error("언마운트 시 VAD pause 오류:", e);
            }

            // 마이크 스트림 정리
            if (mediaStreamRef.current) {
                mediaStreamRef.current.getTracks().forEach(track => {
                    track.stop();
                    console.log("언마운트 시 마이크 트랙 중지:", track.label);
                });
                mediaStreamRef.current = null;
            }

            // WebSocket 정리
            if (wsRef.current) {
                const ws = wsRef.current;
                ws.onmessage = null;
                ws.onclose = null;
                ws.onerror = null;
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
                wsRef.current = null;
            }

            console.log("컴포넌트 언마운트 - 리소스 정리 완료");
        };
    }, [vadPause]);

    return {
        isRecording: isRecording || vadLoading,
        isPaused,
        transcript,
        partialText,
        translation,
        timelineSummaries,
        isGeneratingSummary,
        startRecording,
        stopRecording,
        pauseRecording,
        resumeRecording,
        vadLoading: vadLoading,
        startSystemAudio,
        stopSystemAudio,
        isSystemAudioShared,
    };
};

export default useRealtimeStream;