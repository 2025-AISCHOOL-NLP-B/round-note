import { useState, useEffect, useRef } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import useRealtimeStream, { TranscriptSegment } from '@/hooks/useRealtimeStream';
import {
  Mic,
  MicOff,
  AlertCircle,
  Save,
  ArrowLeft,
  Sparkles,
  Wand2,
  Users,
  FolderPlus,
  Calendar,
  Clock,
  Copy,
  Share2,
  Menu,
  Edit3,
  ChevronDown,
  Check,
  FileText,
  Brain,
  Languages,
  PauseCircle,
  PlayCircle,
  StopCircle,
  User,
  Monitor,
  MonitorOff
} from 'lucide-react';
// Supabase support is optional and disabled by default.
const ENABLE_SUPABASE = String(process.env.NEXT_PUBLIC_ENABLE_SUPABASE || 'false').toLowerCase() === 'true';
let SUPABASE_FUNCTION_URL: string | undefined;
let publicAnonKey: string | undefined;
let projectId: string | undefined;
if (ENABLE_SUPABASE) {
  // Lazy-import only when enabled to avoid bundling unused code
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const supaInfo = require('@/utils/supabase/info');
    projectId = supaInfo.projectId;
    publicAnonKey = supaInfo.publicAnonKey;
    SUPABASE_FUNCTION_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_URL || `https://${projectId}.supabase.co/functions/v1/make-server-3ecf4837/analyze-meeting`;
  } catch (e) {
    // If info module is absent, keep Supabase disabled effectively
    console.warn('Supabase info not found; Supabase features will remain disabled.');
  }
}
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { toast } from 'sonner';
import { createMeeting, endMeeting } from '@/features/meetings/meetingsService';
import { regenerateSummary } from '@/features/meetings/reportsService';
import { fetchWithAuth } from '@/utils/auth';
import type { Meeting } from "@/features/dashboard/Dashboard";

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface MeetingContentInputProps {
  meetingInfo: {
    title: string;
    date: string;
    purpose?: string;
    participants?: string
  };
  onComplete: (content: string, aiAnalysis?: any, meetingId?: string | null) => void;
  onBack: () => void;
  meetings: Meeting[];
}

export function MeetingContentInput({ meetingInfo, onComplete, onBack, meetings }: MeetingContentInputProps) {
  // useRealtimeStream hook 사용
  const {
    isRecording,
    isPaused,
    transcript,
    partialText,
    translation,
    timelineSummaries,
    isGeneratingSummary: isGeneratingSummaryFromHook,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    vadLoading,
    startSystemAudio,
    stopSystemAudio,
    isSystemAudioShared,
  } = useRealtimeStream();

  const [content, setContent] = useState('');
  const [editableTitle, setEditableTitle] = useState(meetingInfo.title || '');
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState(meetingInfo.date || new Date().toISOString().split('T')[0]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [analysisError, setAnalysisError] = useState<string>('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [inputLanguage, setInputLanguage] = useState('ko-KR');
  const [outputLanguage, setOutputLanguage] = useState('ko-KR');
  const [activeTab, setActiveTab] = useState<'transcribe' | 'summary'>('transcribe');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [realtimeSummary, setRealtimeSummary] = useState<string>('');
  const contentEndRef = useRef<HTMLDivElement>(null);
  const summaryEndRef = useRef<HTMLDivElement>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const summaryIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  // Audio recording states
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const audioRecordingRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // 임시 제목 생성 함수
  const generateDefaultTitle = (meetings: Meeting[]): string => {
    const now = new Date();

    const dateStr = now.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }); // "2025년 11월 24일"

    const timeStr = `${String(now.getHours()).padStart(2, "0")}시`;

    const todayISO = now.toISOString().split("T")[0];
    const count = meetings.filter((m) => m.date === todayISO).length + 1;

    return `${dateStr} ${timeStr} 회의(${count})`;
  };

  // 전사 자동 스크롤
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript, partialText]);

  // 요약 자동 스크롤
  useEffect(() => {
    if (summaryRef.current) {
      summaryRef.current.scrollTop = summaryRef.current.scrollHeight;
    }
  }, [timelineSummaries]);

  // Load translation settings
  useEffect(() => {
    const translationSettings = localStorage.getItem('roundnote-translation-settings');
    if (translationSettings) {
      try {
        const settings = JSON.parse(translationSettings);
        const langCode = settings.language === 'en' ? 'en-US' : 'ko-KR';
        setInputLanguage(langCode);
        setOutputLanguage(langCode);
      } catch (error) {
        console.error('Failed to load translation settings:', error);
      }
    }
  }, []);

  // transcript가 업데이트되면 content(단순 텍스트 저장용)에 반영하고 스크롤
  useEffect(() => {
    if (transcript.length > 0) {
      // 텍스트 형태로 변환하여 저장 (나중에 저장할 때 사용)
      const textContent = transcript
        .map(seg => `[${seg.timestamp}] ${seg.speaker}\n${seg.text}`)
        .join('\n\n');
      setContent(textContent);

      // ✅ 내부 div만 자동 스크롤
      if (transcriptRef.current) {
        transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
      }
    }
  }, [transcript]);

  useEffect(() => {
    if (isRecording) {
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    }

    return () => {
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
      }
    };
  }, [isRecording]);

  // 실시간 요약 생성 (10초마다)
  useEffect(() => {
    if (isRecording && content.trim().length > 50) {
      summaryIntervalRef.current = setInterval(() => {
        generateRealtimeSummary();
      }, 10000); // 10초마다 요약 생성
    } else {
      if (summaryIntervalRef.current) {
        clearInterval(summaryIntervalRef.current);
      }
    }

    return () => {
      if (summaryIntervalRef.current) {
        clearInterval(summaryIntervalRef.current);
      }
    };
  }, [isRecording, content]);

  const generateRealtimeSummary = async () => {
    if (!content.trim() || isGeneratingSummary) return;

    setIsGeneratingSummary(true);

    try {
      // DB 저장 없이 content만 전달하여 실시간 요약 생성
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetchWithAuth(`${API_URL}/api/v1/reports/preview-summary`, {
        method: 'POST',
        body: JSON.stringify({ content }),
        cache: 'no-store',
        signal: controller.signal as AbortSignal,
      });
      clearTimeout(timeout);
      
      const result = await response.json();
      if (result?.summary) {
        setRealtimeSummary(result.summary);
        if (summaryRef.current) {
          summaryRef.current.scrollTop = summaryRef.current.scrollHeight;
        }
      }
    } catch (error: any) {
      // 실시간 요약 실패는 조용히 처리 (사용자에게 방해되지 않도록)
      console.error('Realtime summary error:', error);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Start audio recording
  const startAudioRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      audioRecordingRef.current = recorder;
      toast.success('오디오 녹음이 시작되었습니다.');
    } catch (error) {
      console.error('Audio recording error:', error);
      toast.error('오디오 녹음을 시작할 수 없습니다.');
    }
  };

  // Stop audio recording (pause)
  const stopAudioRecording = () => {
    if (audioRecordingRef.current && audioRecordingRef.current.state !== 'inactive') {
      audioRecordingRef.current.pause();
      toast.info('오디오 녹음이 일시 중지되었습니다.');
    }
  };

  // Resume audio recording
  const resumeAudioRecording = () => {
    if (audioRecordingRef.current && audioRecordingRef.current.state === 'paused') {
      audioRecordingRef.current.resume();
      toast.success('오디오 녹음이 재개되었습니다.');
    }
  };

  // Finalize audio recording - Blob 반환
  const finalizeAudioRecording = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (audioRecordingRef.current && audioRecordingRef.current.state !== 'inactive') {
        audioRecordingRef.current.onstop = () => {
          if (audioChunksRef.current.length > 0) {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            resolve(audioBlob);
          } else {
            resolve(null);
          }
        };
        audioRecordingRef.current.stop();
      } else {
        resolve(null);
      }
    });
  };

  const toggleRecording = async () => {
    if (isRecording) {
      stopRecording();
      stopAudioRecording();
      // End meeting and save
      await handleSubmit();
    } else {
      try {
        // 1) 회의 미리 생성 (is_realtime 플래그)
        let created;
        try {
          created = await createMeeting({ title: editableTitle || generateDefaultTitle(meetings), purpose: meetingInfo.purpose, is_realtime: true });
          setCurrentMeetingId(created.meeting_id);
        } catch (e) {
          console.error('Failed to create meeting before recording:', e);
          toast.error('회의 생성에 실패했습니다. 네트워크 상태를 확인해주세요.');
          return;
        }
        // 2) 녹음 시작 (생성된 회의 ID 전달)
        await startRecording(created.meeting_id);
        startAudioRecording();
        setRecordingTime(0);
        toast.success('녹음이 시작되었습니다.');
      } catch (error) {
        console.error('Recording error:', error);
        setMicPermissionDenied(true);
        setSpeechSupported(false);
        toast.error('마이크 권한이 필요합니다.');
      }
    }
  };

  const handleAIAnalysis = async () => {
    if (!content.trim()) {
      toast.error('분석할 회의 내용을 먼저 입력해주세요.');
      return;
    }

    if (!currentMeetingId) {
      toast.error('회의를 먼저 시작해주세요.');
      return;
    }

    setIsAnalyzing(true);
    setAnalysisError('');

    const maxRetries = 3;
    let retryCount = 0;

    const performAnalysis = async (): Promise<void> => {
      try {
        // 백엔드에 회의 내용 업데이트
        await fetchWithAuth(`${API_URL}/api/v1/meetings/${currentMeetingId}`, {
          method: 'PUT',
          body: JSON.stringify({ content }),
        });

        // regenerate를 호출하여 요약 + 액션 아이템 생성
        const regenResponse = await fetchWithAuth(`${API_URL}/api/v1/reports/${currentMeetingId}/regenerate`, {
          method: 'POST',
        });

        const result = await regenResponse.json();
        setAiAnalysis({
          summary: result.summary,
          actionItems: result.action_items_count > 0 ? Array(result.action_items_count).fill({ task: '액션 아이템' }) : [],
        });
        toast.success('AI 분석이 완료되었습니다!');
        console.log('AI Analysis result:', result);

      } catch (error: any) {
        console.error('AI analysis error:', error);

        // 네트워크 오류 vs 인증 오류 구분
        const isNetworkError = error?.message?.includes('Failed to fetch') || error?.name === 'TypeError';
        const isTimeoutError = error?.name === 'AbortError';
        const isAuthError = error?.message?.includes('인증');

        // 인증 오류는 재시도하지 않음
        if (isAuthError) {
          setAnalysisError('인증이 필요합니다. 다시 로그인해주세요.');
          toast.error('세션이 만료되었습니다. 다시 로그인해주세요.');
          throw error;
        }

        // 네트워크 오류는 재시도
        if ((isNetworkError || isTimeoutError) && retryCount < maxRetries) {
          retryCount++;
          console.log(`Retrying analysis (${retryCount}/${maxRetries})...`);
          toast.info(`네트워크 오류. ${retryCount}번째 재시도 중... (${retryCount}/${maxRetries})`);
          
          // 지수 백오프: 1초, 2초, 4초
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount - 1) * 1000));
          return performAnalysis();
        }

        // 최대 재시도 횟수 초과 또는 다른 오류
        const msg = isTimeoutError 
          ? '분석 요청 시간이 초과되었습니다.' 
          : (isNetworkError 
            ? '네트워크 연결을 확인해주세요.'
            : (error?.message || 'AI 분석 중 오류가 발생했습니다.'));
        
        setAnalysisError(msg);
        toast.error(msg);
        throw error;
      }
    };

    try {
      await performAnalysis();
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (!content.trim()) {
      toast.error('회의 내용을 입력해주세요.');
      return;
    }

    if (isRecording) {
      stopRecording();
    }

    setIsProcessing(true);

    // Finalize audio recording and get Blob
    const recordedAudioBlob = await finalizeAudioRecording();

    // Add audio Blob to analysis
    const analysisWithAudio = {
      ...aiAnalysis,
      audioBlob: recordedAudioBlob // Blob을 전달
    };

    // 백엔드에 전사 내용 저장 후 요약 재생성 호출
    try {
      if (!currentMeetingId) {
        toast.error('회의 식별자가 없습니다. 녹음을 시작할 때 회의를 생성하지 못했습니다.');
      } else {
        // 1) 회의 종료/내용 저장
        await endMeeting(currentMeetingId, { status: 'COMPLETED', ended_at: new Date().toISOString(), content });
        // 2) 요약 재생성
        const regen = await regenerateSummary(currentMeetingId);
        // 3) UI 반영
        setAiAnalysis({ summary: regen.summary, actionItems: regen.action_items_count });
        toast.success('회의록이 저장되고 AI 요약이 생성되었습니다.');
      }
    } catch (err) {
      console.error('Saving content / regenerating summary failed:', err);
      toast.error('회의 저장 또는 요약 생성 중 오류가 발생했습니다.');
    }

    // 최종 UI 정리
    setTimeout(() => {
      onComplete(content, analysisWithAudio, currentMeetingId);
      setContent('');
      // Reset audio chunks for next recording
      audioChunksRef.current = [];
      setIsProcessing(false);
    }, 500);
  };

  const handleCopyNotes = async () => {
    if (!content.trim()) {
      toast.error('복사할 내용이 없습니다.');
      return;
    }

    try {
      // Try modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content);
        toast.success('노트가 클립보드에 복사되었습니다.');
      } else {
        // Fallback to legacy method
        const textArea = document.createElement('textarea');
        textArea.value = content;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            toast.success('노트가 클립보드에 복사되었습니다.');
          } else {
            throw new Error('Copy failed');
          }
        } finally {
          document.body.removeChild(textArea);
        }
      }
    } catch (err) {
      console.error('Failed to copy text:', err);
      toast.error('복사에 실패했습니다. 브라우저 설정을 확인해주세요.');

      // Provide alternative option
      setTimeout(() => {
        if (confirm('수동으로 복사하시겠습니까? 확인을 누르면 전체 텍스트를 선택합니다.')) {
          // Create a selection for user to manually copy
          const selection = window.getSelection();
          const range = document.createRange();
          const contentElement = contentEndRef.current?.previousElementSibling;
          if (contentElement) {
            range.selectNodeContents(contentElement);
            selection?.removeAllRanges();
            selection?.addRange(range);
            toast.info('텍스트가 선택되었습니다. Ctrl+C (또는 Cmd+C)로 복사하세요.');
          }
        }
      }, 500);
    }
  };

  const getLanguageLabel = (code: string) => {
    const labels: Record<string, string> = {
      'ko-KR': '🇰🇷 한국어',
      'en-US': '🇺🇸 English',
      'ja-JP': '🇯🇵 日본어',
      'zh-CN': '🇨🇳 중문'
    };
    return labels[code] || code;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50/50 via-slate-50 to-indigo-50/50 pb-8 px-2 md:px-4 pt-4">

      {/* Top Bar with Title and Date */}
      <Card className="mb-4 border-slate-200 shadow-md">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-4 mb-2">
            <Input
              value={editableTitle}
              onChange={(e) => setEditableTitle(e.target.value)}
              className="text-xl md:text-2xl border-none p-0 w-1000px h-auto focus-visible:ring-0 focus-visible:ring-offset-0 font-semibold text-slate-800 placeholder:text-slate-400 flex-1"
              placeholder={generateDefaultTitle(meetings)}   // ← 임시 제목 자동 반영
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mb-3">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-primary" />
              <Input
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="h-7 w-auto border-none shadow-none p-0 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-primary" />
              <span className="font-mono">{formatTime(recordingTime)}</span>
            </div>
            {isRecording && (
              <Badge className={`${isPaused ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-red-500 hover:bg-red-600'} text-white ${!isPaused && 'animate-pulse'}`}>
                <span className="w-2 h-2 bg-white rounded-full mr-1.5"></span>
                {isPaused ? 'PAUSED' : 'REC'}
              </Badge>
            )}
          </div>

          {/* 회의 정보 표시 */}
          {(meetingInfo.purpose || meetingInfo.participants) && (
            <div className="pt-3 border-t border-slate-200 space-y-2">
              {meetingInfo.purpose && (
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-slate-500 font-medium min-w-[60px]">목적:</span>
                  <span className="text-slate-700">{meetingInfo.purpose}</span>
                </div>
              )}
              {meetingInfo.participants && (
                <div className="flex items-start gap-2 text-sm">
                  <span className="text-slate-500 font-medium min-w-[60px]">참석자:</span>
                  <span className="text-slate-700">{meetingInfo.participants}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Content Area with Tabs */}
      <Card className="mb-4 border-slate-200 shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              <CardTitle className="text-lg">실시간 전사</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyNotes}
              className="gap-1.5 text-muted-foreground hover:text-primary"
            >
              <Copy className="w-4 h-4" />
              <span className="hidden sm:inline">복사</span>
            </Button>
          </div>

          {/* 탭 메뉴 */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'transcribe' | 'summary')} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="transcribe" className="gap-2">
                <Mic className="w-4 h-4" />
                실시간 전사
              </TabsTrigger>
              <TabsTrigger value="summary" className="gap-2">
                <Brain className="w-4 h-4" />
                실시간 전사 요약
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {/* 실시간 전사 탭 */}
          {activeTab === 'transcribe' && (
            <div>
              {/* 녹취 컨트롤 버튼 */}
              <div className="mb-4 flex gap-2 justify-center">
                <Button
                  onClick={toggleRecording}
                  disabled={!speechSupported || vadLoading}
                  size="lg"
                  className={`flex-1 max-w-md gap-2 ${isRecording
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-primary hover:bg-primary/90'
                    } ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isRecording ? (
                    <>
                      <StopCircle className="w-5 h-5" />
                      회의 종료
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5" />
                      녹취 시작
                    </>
                  )}
                </Button>

                {isRecording && (
                  <Button
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    size="lg"
                    variant="outline"
                    className="gap-2 w-32"
                  >
                    {isPaused ? (
                      <>
                        <PlayCircle className="w-5 h-5" />
                        재개
                      </>
                    ) : (
                      <>
                        <PauseCircle className="w-5 h-5" />
                        일시정지
                      </>
                    )}
                  </Button>
                )}

                <Button
                  onClick={isSystemAudioShared ? stopSystemAudio : startSystemAudio}
                  size="lg"
                  variant={isSystemAudioShared ? "secondary" : "outline"}
                  className="gap-2"
                  title="시스템 오디오(화상회의 소리) 공유"
                >
                  {isSystemAudioShared ? (
                    <>
                      <MonitorOff className="w-5 h-5" />
                      <span className="hidden sm:inline">시스템 소리 끄기</span>
                    </>
                  ) : (
                    <>
                      <Monitor className="w-5 h-5" />
                      <span className="hidden sm:inline">시스템 소리 공유</span>
                    </>
                  )}
                </Button>
              </div>

              {/* 전사 내용 표시 영역 - 타임라인 스타일 */}
              <div
                ref={transcriptRef}
                className="h-[500px] w-[1000px] overflow-y-auto border border-slate-200 rounded-lg p-4 bg-slate-50"
              >
                {transcript.length > 0 || partialText ? (
                  <div className="space-y-6">
                    {transcript.map((segment) => (
                      <div key={segment.id} className="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                        <div className="flex flex-col items-center gap-1 min-w-[60px]">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                            <User className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-700">{segment.speaker}</span>
                            <span className="text-xs text-slate-400">{segment.timestamp}</span>
                          </div>
                          <div className="p-3 bg-white rounded-lg rounded-tl-none border border-slate-200 shadow-sm text-slate-700 leading-relaxed">
                            {segment.text}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* 실시간 입력 중인 텍스트 표시 */}
                    {partialText && (
                      <div className="flex gap-3 animate-pulse">
                        <div className="flex flex-col items-center gap-1 min-w-[60px]">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                            <User className="w-4 h-4" />
                          </div>
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-slate-500">Speaker ...</span>
                            <span className="text-xs text-slate-400">입력 중...</span>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-lg rounded-tl-none border border-slate-200 border-dashed text-slate-500 italic">
                            {partialText}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={contentEndRef} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    {isRecording ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-center gap-2">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <div
                              key={i}
                              className="w-1 bg-primary rounded-full animate-pulse"
                              style={{
                                height: '40px',
                                animationDelay: `${i * 0.1}s`,
                                animationDuration: '0.8s'
                              }}
                            />
                          ))}
                        </div>
                        <p className="text-slate-500">음성을 듣고 있습니다...</p>
                        <p className="text-xs text-slate-400">말씀하시면 타임라인에 기록됩니다</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <Mic className="w-12 h-12 text-slate-300 mx-auto" />
                        <p className="text-slate-500">녹취 시작 버튼을 눌러주세요</p>
                        <p className="text-xs text-slate-400">음성이 실시간으로 텍스트로 변환됩니다</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 실시간 전사 요약 탭 */}
          {activeTab === 'summary' && (
            <div>
              {/* 녹취 컨트롤 버튼 */}
              <div className="mb-4 flex gap-2 justify-center">
                <Button
                  onClick={toggleRecording}
                  disabled={!speechSupported || vadLoading}
                  size="lg"
                  className={`flex-1 max-w-md gap-2 ${isRecording
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-primary hover:bg-primary/90'
                    } ${!speechSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isRecording ? (
                    <>
                      <StopCircle className="w-5 h-5" />
                      녹취 중지
                    </>
                  ) : (
                    <>
                      <Mic className="w-5 h-5" />
                      녹취 시작
                    </>
                  )}
                </Button>

                {isRecording && (
                  <Button
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    size="lg"
                    variant="outline"
                    className="gap-2 w-32"
                  >
                    {isPaused ? (
                      <>
                        <PlayCircle className="w-5 h-5" />
                        재개
                      </>
                    ) : (
                      <>
                        <PauseCircle className="w-5 h-5" />
                        일시정지
                      </>
                    )}
                  </Button>
                )}

                <Button
                  onClick={isSystemAudioShared ? stopSystemAudio : startSystemAudio}
                  size="lg"
                  variant={isSystemAudioShared ? "secondary" : "outline"}
                  className="gap-2"
                  title="시스템 오디오(화상회의 소리) 공유"
                >
                  {isSystemAudioShared ? (
                    <>
                      <MonitorOff className="w-5 h-5" />
                      <span className="hidden sm:inline">시스템 소리 끄기</span>
                    </>
                  ) : (
                    <>
                      <Monitor className="w-5 h-5" />
                      <span className="hidden sm:inline">시스템 소리 공유</span>
                    </>
                  )}
                </Button>
              </div>

              {/* 요약 내용 표시 영역 - 고정 높이 + 스크롤 */}
              <div
                ref={summaryRef}
                className="h-[500px] w-[1000px] overflow-y-auto border border-slate-200 rounded-lg p-4 bg-slate-50"
              >
                {timelineSummaries.length > 0 ? (
                  <div className="space-y-3">
                    {timelineSummaries.map((summary, index) => (
                      <div key={index} className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                        <div className="flex items-start gap-2 mb-2">
                          <Brain className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-semibold text-slate-800">
                                {summary.sequence}차 요약
                              </h4>
                              <span className="text-xs text-slate-500 bg-white px-2 py-1 rounded">
                                📍 {summary.timeWindow}
                              </span>
                            </div>
                            <div className="whitespace-pre-wrap text-slate-700 text-sm leading-relaxed">
                              {summary.content}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {isGeneratingSummaryFromHook && (
                      <div className="flex items-center gap-2 justify-center p-4 text-slate-500">
                        <Sparkles className="w-4 h-4 animate-spin" />
                        <span className="text-sm">다음 구간 요약 생성 중...</span>
                      </div>
                    )}
                    <div ref={summaryEndRef} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    {isRecording ? (
                      <div className="space-y-4">
                        <Brain className="w-12 h-12 text-primary mx-auto animate-pulse" />
                        <p className="text-slate-500">회의 내용을 수집 중입니다...</p>
                        <p className="text-xs text-slate-400">60초마다 자동으로 타임라인 요약이 생성됩니다</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <Brain className="w-12 h-12 text-slate-300 mx-auto" />
                        <p className="text-slate-500">녹취 시작 버튼을 눌러주세요</p>
                        <p className="text-xs text-slate-400">AI가 타임라인 기반으로 회의 내용을 자동 요약합니다</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Messages */}
      {micPermissionDenied && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            마이크 권한이 거부되었습니다. 브라우저 설정에서 마이크 권한을 허용해주세요.
          </AlertDescription>
        </Alert>
      )}

      {!speechSupported && !micPermissionDenied && (
        <Alert className="mb-4">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 브라우저를 사용해주세요.
          </AlertDescription>
        </Alert>
      )}

      {/* AI Analysis Prompt */}
      {content && !aiAnalysis && (
        <Card className="mb-4 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-start gap-2">
                <Brain className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-slate-800">AI 분석 준비 완료</p>
                  <p className="text-xs text-slate-600">회의 내용을 분석하여 요약과 액션 아이템을 추출합니다</p>
                </div>
              </div>
              <Button
                onClick={handleAIAnalysis}
                disabled={isAnalyzing}
                className="gap-2 shrink-0 w-full sm:w-auto bg-primary hover:bg-primary/90"
                size="sm"
              >
                {isAnalyzing ? (
                  <>
                    <Wand2 className="w-4 h-4 animate-spin" />
                    분석 중...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    AI 분석 시작
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Analysis Results */}
      {aiAnalysis && (
        <Card className="mb-4 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Check className="w-5 h-5 text-green-600" />
              <CardTitle className="text-base text-green-800">AI 분석 완료</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {aiAnalysis.summary && (
              <div>
                <h4 className="font-semibold text-green-800 mb-1">요약</h4>
                <p className="text-green-700 text-sm whitespace-pre-wrap">{aiAnalysis.summary}</p>
              </div>
            )}
            {aiAnalysis.actionItems && aiAnalysis.actionItems.length > 0 && (
              <div>
                <h4 className="font-semibold text-green-800 mb-1">액션 아이템</h4>
                <ul className="list-disc list-inside text-green-700 text-sm">
                  {aiAnalysis.actionItems.map((item: any, i: number) => (
                    <li key={i}>{typeof item === 'string' ? item : (item.task || item.title || item.text || '')}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}