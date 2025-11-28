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
}

interface RealtimeStreamControls {
    isRecording: boolean;
    isPaused: boolean;
    transcript: TranscriptSegment[];
    partialText: string;
    translation: string;
    timelineSummaries: TimelineSummary[];
    isGeneratingSummary: boolean;
    startRecording: () => Promise<void>;
    stopRecording: () => void;
    pauseRecording: () => void;
    resumeRecording: () => void;
    vadLoading: boolean;
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

    // 2. Mutable 객체 참조
    const wsRef = useRef<WebSocket | null>(null);
    const isRecordingRef = useRef<boolean>(false); // 최신 isRecording 상태를 추적
    const isPausedRef = useRef<boolean>(false); // 최신 isPaused 상태를 추적
    const silenceIntervalRef = useRef<NodeJS.Timeout | null>(null); // 침묵 오디오 전송 인터벌
    const mediaStreamRef = useRef<MediaStream | null>(null); // 마이크 스트림 참조

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
            const isSpeech = probs.isSpeech > 0.6;
            const int16Frame = float32ToInt16(frame);

            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && int16Frame.buffer.byteLength > 0) {
                // console.log("전송 데이터 타입:", int16Frame.buffer instanceof ArrayBuffer);
                wsRef.current.send(int16Frame.buffer);
            }

        },
        onSpeechStart: () => {
            console.log("VAD: Speech Started");
        },
        onSpeechEnd: () => {
            console.log("VAD: Speech End");
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
    const startRecording = useCallback(async () => {
        if (vadLoading) {
            console.log("VAD 로딩 중...");
            return;
        }

        try {
            const wsUrl = WS_URL + "?translate=true&summary=true";
            console.log("WebSocket 연결 시도:", wsUrl);
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

                            // message.text 안에서 [Speaker X] 패턴을 분리
                            const match = message.text.match(/^\[Speaker (\d+)\]\s*(.*)$/);
                            const speaker = match ? `Speaker ${match[1]}` : "Unknown";
                            const cleanText = match ? match[2] : message.text;

                            const newSegment: TranscriptSegment = {
                                id: Date.now().toString(),
                                timestamp: timeString,
                                speaker,       // ← 파싱된 speaker 반영
                                text: cleanText, // ← [Speaker X] 제거된 텍스트만 반영
                                isFinal: true
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
                vadStart();
                console.log("VAD 시작됨");
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
    }, [vadLoading, vadStart, cleanupResources]);

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
            // 백엔드에 일시정지 상태 알림
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED", value: true }));
                console.log("일시정지 제어 메시지 전송");
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
            // 백엔드에 재개 상태 알림
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ command: "SET_PAUSED", value: false }));
                console.log("재개 제어 메시지 전송");
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
    };
};

export default useRealtimeStream;