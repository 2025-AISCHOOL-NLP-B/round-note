import { useState, useEffect, useRef } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import useRealtimeStream from '@/hooks/useRealtimeStream';
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
  StopCircle
} from 'lucide-react';
import { projectId, publicAnonKey } from '@/utils/supabase/info';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select';
import { toast } from 'sonner';

interface MeetingContentInputProps {
  meetingInfo: { title: string; date: string; purpose?: string; participants?: string };
  onComplete: (content: string, aiAnalysis?: any) => void;
  onBack: () => void;
}

export function MeetingContentInput({ meetingInfo, onComplete, onBack }: MeetingContentInputProps) {
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
  } = useRealtimeStream();

  const [content, setContent] = useState('');
  const [editableTitle, setEditableTitle] = useState(meetingInfo.title || '');
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
  const contentEndRef = useRef<HTMLDivElement>(null);
  const summaryEndRef = useRef<HTMLDivElement>(null);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // Audio recording states
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const audioRecordingRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

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

  // transcript가 업데이트되면 content에 반영
  useEffect(() => {
    if (transcript) {
      setContent(transcript);
      setTimeout(() => {
        contentEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
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
      toast.success('녹음이 중지되었습니다.');
    } else {
      try {
        await startRecording();
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

    setIsAnalyzing(true);
    setAnalysisError('');
    
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-3ecf4837/analyze-meeting`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${publicAnonKey}`,
          },
          body: JSON.stringify({
            content,
            meetingTitle: editableTitle,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'AI 분석에 실패했습니다.');
      }

      const analysis = await response.json();
      setAiAnalysis(analysis);
      toast.success('AI 분석이 완료되었습니다!');
      console.log('AI Analysis result:', analysis);
      
    } catch (error) {
      console.error('AI analysis error:', error);
      setAnalysisError(error instanceof Error ? error.message : 'AI 분석 중 오류가 발생했습니다.');
      toast.error('AI 분석에 실패했습니다.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
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
    
    setTimeout(() => {
      onComplete(content, analysisWithAudio);
      setContent('');
      setAiAnalysis(null);
      // Reset audio chunks for next recording
      audioChunksRef.current = [];
      setIsProcessing(false);
      toast.success('회의록이 저장되었습니다!');
    }, 800);
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
              placeholder="회의 제목을 입력하세요"
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
                  className={`flex-1 max-w-md gap-2 ${
                    isRecording 
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
              </div>

              {/* 전사 내용 표시 영역 - 고정 높이 + 스크롤 */}
              <div className="h-[400px] w-[1000px] overflow-y-auto border border-slate-200 rounded-lg p-4 bg-slate-50">
                {content || partialText ? (
                  <div className="space-y-2">
                    <div className="whitespace-pre-wrap text-slate-700 text-sm md:text-base leading-relaxed">
                      {content}
                      {partialText && (
                        <span className="text-slate-400 italic"> {partialText}</span>
                      )}
                      <div ref={contentEndRef} />
                    </div>
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
                        <p className="text-xs text-slate-400">말씀하시면 자동으로 텍스트로 변환됩니다</p>
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
                  className={`flex-1 max-w-md gap-2 ${
                    isRecording 
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
              </div>

              {/* 요약 내용 표시 영역 - 고정 높이 + 스크롤 */}
              <div className="h-[400px] w-[1000px] overflow-y-auto border border-slate-200 rounded-lg p-4 bg-slate-50">
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
            <div className="grid gap-2 text-sm">
              <div className="flex items-start gap-2">
                <FileText className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-green-800">요약</p>
                  <p className="text-green-700 text-xs">{aiAnalysis.summary?.substring(0, 100)}...</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-green-800">액션 아이템</p>
                  <p className="text-green-700 text-xs">{aiAnalysis.actionItems?.length || 0}개 발견됨</p>
                </div>
              </div>
              {aiAnalysis.participants && (
                <div className="flex items-start gap-2">
                  <Users className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-green-800">참석자</p>
                    <p className="text-green-700 text-xs">{aiAnalysis.participants.join(', ')}</p>
                  </div>
                </div>
              )}
            </div>
            <p className="text-xs text-green-600 italic">저장 버튼을 누르면 AI 분석 결과가 함께 저장됩니다</p>
          </CardContent>
        </Card>
      )}

      {analysisError && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>{analysisError}</AlertDescription>
        </Alert>
      )}

      {/* 언어 선택 및 회의 종료 버튼 */}
      <Card className="mt-4 border-slate-200 shadow-md">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            {/* Language Selection */}
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-primary" />
              <Select value={inputLanguage} onValueChange={setInputLanguage}>
                <SelectTrigger className="w-[140px] h-9 text-sm border-slate-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ko-KR">🇰🇷 한국어</SelectItem>
                  <SelectItem value="en-US">🇺🇸 English</SelectItem>
                  <SelectItem value="ja-JP">🇯🇵 日본어</SelectItem>
                  <SelectItem value="zh-CN">🇨🇳 중문</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 회의 종료 버튼 */}
            <Button
              onClick={handleSubmit}
              disabled={isProcessing || !content.trim()}
              size="lg"
              className="gap-2 bg-emerald-500 hover:bg-emerald-600"
            >
              {isProcessing ? (
                <>
                  <Sparkles className="w-4 h-4 animate-spin" />
                  저장 중...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  회의 종료
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}