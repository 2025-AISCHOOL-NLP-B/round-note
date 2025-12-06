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
import ProcessingOverlay from '@/shared/ui/processing-overlay';
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
import { getActiveTemplate } from '@/features/settings/templateUtils';
import { fetchWithAuth } from '@/utils/auth';
import type { Meeting } from "@/features/dashboard/Dashboard";
import { Switch } from '@/shared/ui/switch';
import { Video } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type MeetingMode = 'video-conference' | 'offline' | 'file-upload';

interface MeetingContentInputProps {
  meetingInfo: {
    title: string;
    date: string;
    purpose?: string;
    participants?: string
  };
  meetingMode: MeetingMode;
  onComplete: (content: string, aiAnalysis?: any, meetingId?: string | null) => void;
  onBack: () => void;
  meetings: Meeting[];
}

export function MeetingContentInput({ meetingInfo, meetingMode, onComplete, onBack, meetings }: MeetingContentInputProps) {
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

  // 화상회의 모드 최초 진입 시 자동으로 시스템 오디오 공유 시도 (한 번만)
  const autoShareAttemptedRef = useRef(false);
  useEffect(() => {
    const autoStartSystemAudio = async () => {
      // 조건: 화상회의 모드, 아직 공유 안됨, 녹음 시작 전, 최초 시도만
      if (
        meetingMode === 'video-conference' &&
        !isSystemAudioShared &&
        !isRecording &&
        !autoShareAttemptedRef.current
      ) {
        autoShareAttemptedRef.current = true;
        try {
          await startSystemAudio();
          // 성공/실패는 hook 내부에서 처리; 여기서는 조용히 진행
        } catch (err) {
          // 안전 처리: 사용자 취소 시에도 UI 에러 없이 진행
          console.warn('[AutoShare] System audio auto-start failed:', err);
        }
      }
    };
    autoStartSystemAudio();
  }, [meetingMode, isSystemAudioShared, isRecording, startSystemAudio]);

  const [content, setContent] = useState('');
  const [editableTitle, setEditableTitle] = useState(meetingInfo.title || '');
  const [currentMeetingId, setCurrentMeetingId] = useState<string | null>(null);
  const [meetingDate, setMeetingDate] = useState(meetingInfo.date || new Date().toISOString().split('T')[0]);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [inputLanguage, setInputLanguage] = useState('ko-KR');
  const [outputLanguage, setOutputLanguage] = useState('ko-KR');
  const [activeTab, setActiveTab] = useState<'transcribe' | 'summary'>('transcribe');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [realtimeSummary, setRealtimeSummary] = useState<string>('');
  const [localParticipants, setLocalParticipants] = useState(meetingInfo.participants || '');
  const summaryEndRef = useRef<HTMLDivElement>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);
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
      toast.info('오디오 녹음이 종료되었습니다.');
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
      // 전사 내용이 없으면 자원만 정리하고 종료
      if (!content.trim()) {
        stopRecording();
        stopAudioRecording();
        return;
      }
      // 전사 내용이 있으면 정상 저장 플로우
      await handleSubmit();
      return;
    } else {
      try {
        // 1) 회의 미리 생성 (is_realtime 플래그)
        let createdMeetingId: string | undefined;
        try {
          const created = await createMeeting({ title: editableTitle || generateDefaultTitle(meetings), purpose: meetingInfo.purpose, is_realtime: true });
          createdMeetingId = created.meeting_id;
          setCurrentMeetingId(created.meeting_id);
        } catch (e) {
          console.error('Failed to create meeting before recording:', e);
          toast.error('회의 생성에 실패했습니다. 네트워크 상태를 확인해주세요.');
          return;
        }

        // 2) 화상회의 모드일 경우 자동으로 시스템 오디오 요청
        if (meetingMode === 'video-conference' && !isSystemAudioShared) {
          try {
            await startSystemAudio();
            toast.success('시스템 오디오 공유가 시작되었습니다.');
          } catch (error) {
            console.warn('System audio sharing declined or failed:', error);
            toast.warning('시스템 오디오 공유가 취소되었습니다. 마이크만 사용합니다.');
            // 시스템 오디오 실패해도 녹음은 계속 진행
          }
        }

        // 3) 녹음 시작 (meetingId + 참여자 이름을 키워드 부스팅에 전달)
        await startRecording(createdMeetingId, localParticipants);
        startAudioRecording();
        setRecordingTime(0);
      } catch (error) {
        console.error('Recording error:', error);
        setMicPermissionDenied(true);
        setSpeechSupported(false);
        toast.error('마이크 권한이 필요합니다.');
      }
    }
  };



  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // 이 함수는 이제 toggleRecording에서 content가 있을 때만 호출됨
    if (!content.trim()) {
      toast.error('회의 내용을 입력해주세요.');
      setIsProcessing(false);
      return;
    }

    // 녹음 중이면 정리
    if (isRecording) {
      stopRecording();
    }
    stopAudioRecording();

    setIsProcessing(true);

    // Finalize audio recording and get Blob
    const recordedAudioBlob = await finalizeAudioRecording();

    // 백엔드에 전사 내용 저장 후 요약 재생성 호출
    let regen: any = null;
    try {
      if (!currentMeetingId) {
        toast.error('회의 식별자가 없습니다. 녹음을 시작할 때 회의를 생성하지 못했습니다.');
      } else {
        // 1) 회의 종료/내용 저장
        await endMeeting(currentMeetingId, { status: 'COMPLETED', ended_at: new Date().toISOString(), content });

        // 2) 현재 선택된 템플릿 가져오기
        const activeTemplate = getActiveTemplate();
        const templateData = activeTemplate ? {
          id: activeTemplate.id,
          name: activeTemplate.name,
          description: activeTemplate.description || '',
          sections: activeTemplate.sections.map(s => ({
            id: s.id,
            title: s.title,
            placeholder: s.placeholder
          }))
        } : undefined;

        // 3) 요약 재생성 (템플릿 적용)
        regen = await regenerateSummary(currentMeetingId, templateData);
        toast.success('회의록이 저장되었습니다.');
      }
    } catch (err) {
      console.error('Saving content / regenerating summary failed:', err);
      toast.error('회의 저장 또는 요약 생성 중 오류가 발생했습니다.');
    }

    // 최종 UI 정리
    setTimeout(() => {
      // localParticipants를 배열로 변환해서 aiAnalysis에 포함
      const participantsArray = localParticipants
        .split(',')
        .map(p => p.trim())
        .filter(p => p.length > 0);
      
      onComplete(content, { 
        audioBlob: recordedAudioBlob, 
        participants: participantsArray,
        ...regen 
      }, currentMeetingId);
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
      {/* 로딩 오버레이 */}
      <ProcessingOverlay
        open={isProcessing}
        title="회의 종료 중..."
        message="회의록을 저장하고 AI 요약을 생성하고 있습니다."
        subMessage="잠시만 기다려주세요."
      />

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


          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground mt-3">
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
          {/* 참여자 입력 - 전사 창 위, 동일 너비. 녹음 시작 전만 노출 */}
          {!isRecording && (
            <div className="pt-3 border-t border-slate-200">
              <label htmlFor="participants" className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                <Users className="w-4 h-4 text-primary" />
                회의 참여자
              </label>
              <Input
                id="participants"
                value={localParticipants}
                onChange={(e) => setLocalParticipants(e.target.value)}
                placeholder="예: 권현재, 김기찬, 서동현 (쉼표 구분)"
                className="bg-white border-primary/30 focus-visible:ring-primary focus-visible:border-primary shadow-sm"
              />
              <p className="text-xs text-slate-500 mt-1.5 ml-1">
                참여자 이름을 입력하면 음성 인식률이 향상됩니다
              </p>
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
                  disabled={!speechSupported || vadLoading || isProcessing}
                  size="lg"
                  className={`flex-1 max-w-md gap-2 ${isRecording
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-primary hover:bg-primary/90'
                    } ${(!speechSupported || isProcessing) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isProcessing ? (
                    <>
                      <Sparkles className="w-5 h-5 animate-spin" />
                      회의 종료 중...
                    </>
                  ) : isRecording ? (
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

                {isRecording && !isProcessing && (
                  <Button
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    size="lg"
                    variant="outline"
                    className="gap-2 w-32"
                    disabled={isProcessing}
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

                {!isProcessing && meetingMode === 'video-conference' && (
                  <Button
                    onClick={async () => {
                      try {
                        if (isSystemAudioShared) {
                          await Promise.resolve(stopSystemAudio());
                        } else {
                          await startSystemAudio();
                        }
                      } catch (err) {
                        // 안전 처리: 예외가 있어도 UI가 깨지지 않도록 함
                        console.warn('[UI] System audio toggle error:', err);
                      }
                    }}
                    size="lg"
                    variant={isSystemAudioShared ? "secondary" : "outline"}
                    className="gap-2"
                    title="시스템 오디오(화상회의 소리) 공유"
                    disabled={isProcessing}
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
                )}
              </div>

              {/* 전사 내용 표시 영역 - 타임라인 스타일 */}
              <div
                ref={transcriptRef}
                className="h-[500px] w-[1000px] overflow-y-auto border border-slate-200 rounded-lg p-4 bg-slate-50"
              >
                {transcript.length > 0 || partialText ? (
                  <div className="space-y-6">
                    {transcript.map((segment) => {
                      const isMic = segment.channelType === 'Mic';

                      // 8-color palette per channel to avoid monotone balloons
                      const micPalette = [
                        { bg: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-100', icon: 'text-red-800', badge: 'bg-red-100 text-red-900', accent: '#dc2626' },
                        { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', iconBg: 'bg-fuchsia-100', icon: 'text-fuchsia-800', badge: 'bg-fuchsia-100 text-fuchsia-900', accent: '#c026d3' },
                        { bg: 'bg-amber-50', border: 'border-amber-200', iconBg: 'bg-amber-100', icon: 'text-amber-800', badge: 'bg-amber-100 text-amber-900', accent: '#f59e0b' },
                        { bg: 'bg-violet-50', border: 'border-violet-200', iconBg: 'bg-violet-100', icon: 'text-violet-800', badge: 'bg-violet-100 text-violet-900', accent: '#6d28d9' },
                        { bg: 'bg-orange-50', border: 'border-orange-200', iconBg: 'bg-orange-100', icon: 'text-orange-800', badge: 'bg-orange-100 text-orange-900', accent: '#ea580c' },
                        { bg: 'bg-pink-50', border: 'border-pink-200', iconBg: 'bg-pink-100', icon: 'text-pink-800', badge: 'bg-pink-100 text-pink-900', accent: '#db2777' },
                        { bg: 'bg-rose-50', border: 'border-rose-200', iconBg: 'bg-rose-100', icon: 'text-rose-800', badge: 'bg-rose-100 text-rose-900', accent: '#e11d48' },
                        { bg: 'bg-purple-50', border: 'border-purple-200', iconBg: 'bg-purple-100', icon: 'text-purple-800', badge: 'bg-purple-100 text-purple-900', accent: '#7c3aed' },
                      ];

                      const systemPalette = [
                        { bg: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-blue-100', icon: 'text-blue-800', badge: 'bg-blue-100 text-blue-900', accent: '#1d4ed8' },
                        { bg: 'bg-teal-50', border: 'border-teal-200', iconBg: 'bg-teal-100', icon: 'text-teal-800', badge: 'bg-teal-100 text-teal-900', accent: '#0f766e' },
                        { bg: 'bg-sky-50', border: 'border-sky-200', iconBg: 'bg-sky-100', icon: 'text-sky-800', badge: 'bg-sky-100 text-sky-900', accent: '#0284c7' },
                        { bg: 'bg-emerald-50', border: 'border-emerald-200', iconBg: 'bg-emerald-100', icon: 'text-emerald-800', badge: 'bg-emerald-100 text-emerald-900', accent: '#059669' },
                        { bg: 'bg-indigo-50', border: 'border-indigo-200', iconBg: 'bg-indigo-100', icon: 'text-indigo-800', badge: 'bg-indigo-100 text-indigo-900', accent: '#4338ca' },
                        { bg: 'bg-lime-50', border: 'border-lime-200', iconBg: 'bg-lime-100', icon: 'text-lime-800', badge: 'bg-lime-100 text-lime-900', accent: '#4d7c0f' },
                        { bg: 'bg-cyan-50', border: 'border-cyan-200', iconBg: 'bg-cyan-100', icon: 'text-cyan-800', badge: 'bg-cyan-100 text-cyan-900', accent: '#0891b2' },
                        { bg: 'bg-slate-50', border: 'border-slate-200', iconBg: 'bg-slate-100', icon: 'text-slate-800', badge: 'bg-slate-100 text-slate-900', accent: '#475569' },
                      ];

                      const palette = isMic ? micPalette : systemPalette;
                      const speakerMatch = segment.speaker.match(/\d+/);
                      const speakerIndex = speakerMatch ? parseInt(speakerMatch[0], 10) : 0;
                      const color = palette[speakerIndex % palette.length];

                      const IconComponent = isMic ? Mic : Monitor;
                      const badge = isMic ? '마이크' : '시스템';

                      return (
                        <div key={segment.id} className="flex gap-3">
                          <div className="flex flex-col items-center gap-1 min-w-[60px]">
                            <div className={`w-8 h-8 rounded-full ${color.iconBg} flex items-center justify-center ${color.icon}`}>
                              <IconComponent className="w-4 h-4" />
                            </div>
                          </div>
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-slate-700">{segment.speaker}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded ${color.badge}`}>
                                {badge}
                              </span>
                              <span className="text-xs text-slate-400">{segment.timestamp}</span>
                            </div>
                            <div
                              className={`p-3 ${color.bg} rounded-lg rounded-tl-none shadow-sm text-slate-800 leading-relaxed`}
                            >
                              {segment.text}
                            </div>
                          </div>
                        </div>
                      );
                    })}

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
                  disabled={!speechSupported || vadLoading || isProcessing}
                  size="lg"
                  className={`flex-1 max-w-md gap-2 ${isRecording
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-primary hover:bg-primary/90'
                    } ${(!speechSupported || isProcessing) ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isProcessing ? (
                    <>
                      <Sparkles className="w-5 h-5 animate-spin" />
                      회의 종료 중...
                    </>
                  ) : isRecording ? (
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

                {isRecording && !isProcessing && (
                  <Button
                    onClick={isPaused ? resumeRecording : pauseRecording}
                    size="lg"
                    variant="outline"
                    className="gap-2 w-32"
                    disabled={isProcessing}
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

                {!isProcessing && meetingMode === 'video-conference' && (
                  <Button
                    onClick={async () => {
                      try {
                        if (isSystemAudioShared) {
                          await Promise.resolve(stopSystemAudio());
                        } else {
                          await startSystemAudio();
                        }
                      } catch (err) {
                        console.warn('[UI] System audio toggle error:', err);
                      }
                    }}
                    size="lg"
                    variant={isSystemAudioShared ? "secondary" : "outline"}
                    className="gap-2"
                    title="시스템 오디오(화상회의 소리) 공유"
                    disabled={isProcessing}
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
                )}
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


    </div>
  );
}