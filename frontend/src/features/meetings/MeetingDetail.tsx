import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { 
  FileText, 
  Brain, 
  Calendar, 
  User, 
  Clock, 
  CheckCircle2,
  ListChecks,
  Download,
  ExternalLink,
  Trash2,
  ArrowLeft,
  MoreVertical,
  FileDown,
  ChevronDown,
  ChevronUp,
  Languages,
  Play,
  Pause,
  Volume2,
  Settings,
  MessageSquare,
  Mic
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../shared/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../shared/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../shared/ui/dropdown-menu';
import { MeetingAnalysis } from '@/features/realtime/MeetingAnalysis';
import { ScrollToTop } from '@/features/utils/ScrollToTop';
import { useMeetingArtifacts } from '@/hooks/useMeetingArtifacts';
import { TranscriptStatusBanner, TranscriptDisplay } from '@/components/TranscriptStatusBanner';
import { exportToPDF } from '@/utils/exportPDF';
import { exportToWord } from '@/utils/exportWord';
import type { Meeting, ActionItem } from '@/features/dashboard/Dashboard';

interface MeetingDetailProps {
  meeting: Meeting;
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting: (id: string) => void;
  onClose: () => void;
}

export function MeetingDetail({
  meeting: meetingProp,
  onUpdateMeeting,
  onDeleteMeeting,
  onClose,
}: MeetingDetailProps) {
  // 로컬 상태로 meeting 관리하여 즉시 업데이트 반영
  const [meeting, setMeeting] = useState(meetingProp);
  
  // meeting prop이 변경되면 로컬 상태도 업데이트
  React.useEffect(() => {
    console.log('[MeetingDetail] Meeting prop updated:', meetingProp);
    setMeeting(meetingProp);
  }, [meetingProp]);
  
  const [activeTab, setActiveTab] = useState('basic');

  // Refs for scroll navigation
  const summaryRef = useRef<HTMLDivElement>(null);
  const actionItemsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);

  // Collapsible states
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [actionItemsOpen, setActionItemsOpen] = useState(true);
  const [contentOpen, setContentOpen] = useState(true);
  const [audioOpen, setAudioOpen] = useState(true);

  // Translation states
  const [summaryLang, setSummaryLang] = useState('ko');
  const [contentLang, setContentLang] = useState('ko');
  const [translatedSummary, setTranslatedSummary] = useState('');
  const [translatedContent, setTranslatedContent] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  
  // 번역 캐시 (언어별로 저장)
  const [translationCache, setTranslationCache] = useState<{
    summary: Record<string, string>;
    content: Record<string, string>;
  }>({
    summary: {},
    content: {}
  });
  
  // 원문 언어 (현재는 한국어로 고정, 추후 설정에서 변경 가능)
  const sourceLang = 'ko';
  
  // 언어별 UI 설정 (정규표현식, 포맷팅 규칙)
  const langConfig: Record<string, { 
    code: string; 
    name: string; 
    fullName: string;
    numberFormat?: string; // 숫자 포맷 (예: 1,000 vs 1.000)
    dateFormat?: string; // 날짜 포맷 (예: YYYY-MM-DD vs DD.MM.YYYY)
    quotationMark?: { open: string; close: string }; // 인용 부호
    spaceBeforePunctuation?: boolean; // 문장부호 전 공백 여부
  }> = {
    'ko': { 
      code: 'ko', 
      name: '한국어', 
      fullName: 'Korean',
      numberFormat: 'comma', // 1,000
      dateFormat: 'YYYY년 MM월 DD일',
      quotationMark: { open: '「', close: '」' },
      spaceBeforePunctuation: false
    },
    'en': { 
      code: 'en', 
      name: 'English', 
      fullName: 'English',
      numberFormat: 'comma', // 1,000
      dateFormat: 'MMMM DD, YYYY',
      quotationMark: { open: '"', close: '"' },
      spaceBeforePunctuation: false
    },
    'ja': { 
      code: 'ja', 
      name: '日本語', 
      fullName: 'Japanese',
      numberFormat: 'comma', // 1,000
      dateFormat: 'YYYY年MM月DD日',
      quotationMark: { open: '「', close: '」' },
      spaceBeforePunctuation: false
    },
    'zh': { 
      code: 'zh', 
      name: '中文', 
      fullName: 'Chinese',
      numberFormat: 'comma', // 1,000
      dateFormat: 'YYYY年MM月DD日',
      quotationMark: { open: '「', close: '」' },
      spaceBeforePunctuation: false
    },
    'es': { 
      code: 'es', 
      name: 'Español', 
      fullName: 'Spanish',
      numberFormat: 'dot', // 1.000
      dateFormat: 'DD de MMMM de YYYY',
      quotationMark: { open: '«', close: '»' },
      spaceBeforePunctuation: true
    },
    'fr': { 
      code: 'fr', 
      name: 'Français', 
      fullName: 'French',
      numberFormat: 'dot', // 1.000
      dateFormat: 'DD MMMM YYYY',
      quotationMark: { open: '«', close: '»' },
      spaceBeforePunctuation: true
    },
    'de': { 
      code: 'de', 
      name: 'Deutsch', 
      fullName: 'German',
      numberFormat: 'dot', // 1.000
      dateFormat: 'DD.MM.YYYY',
      quotationMark: { open: '„', close: '"' },
      spaceBeforePunctuation: false
    },
  };
  
  // 언어 코드 매핑 (호환성 유지)
  const langMap = langConfig;

  // Audio states
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioSrc, setAudioSrc] = useState('');
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // 번역 텍스트에 언어별 포맷팅 적용
  const formatTranslatedText = (text: string | undefined, targetLang: string): string => {
    if (!text) return '';
    
    const config = langConfig[targetLang];
    if (!config) return text;

    let formatted = text;

    // 라인별 처리 (타임스탬프와 스피커 정보 유지)
    const lines = formatted.split('\n');
    formatted = lines.map(line => {
      // 타임스탬프 패턴: [HH시 MM분 SS초] 또는 [HH時MM分SS秒] 등
      const timestampMatch = line.match(/^\[([^\]]+)\]\s*/);
      const timestamp = timestampMatch ? timestampMatch[0] : '';
      const contentAfterTimestamp = timestampMatch ? line.substring(timestampMatch[0].length) : line;

      let processedContent = contentAfterTimestamp;

      // 언어별 포맷팅 규칙 적용
      switch (targetLang) {
        case 'es': // 스페인어
          // 문장부호 전 공백 추가
          processedContent = processedContent
            .replace(/([^\s])([?!;:])/g, '$1 $2')
            .replace(/([«])\s+/g, '$1 ')
            .replace(/\s+([»])/g, ' $1');
          // 숫자 포맷: 1.000
          processedContent = processedContent.replace(/(\d{1,3}),(\d{3})/g, '$1.$2');
          break;

        case 'fr': // 프랑스어
          // 문장부호 전 공백 추가 (! ? ; :)
          processedContent = processedContent
            .replace(/([^\s])(!)/g, '$1 $2')
            .replace(/([^\s])(\?)/g, '$1 $2')
            .replace(/([^\s])(;)/g, '$1 $2')
            .replace(/([^\s])(:)/g, '$1 $2')
            .replace(/([«])\s+/g, '$1 ')
            .replace(/\s+([»])/g, ' $1');
          // 숫자 포맷: 1.000
          processedContent = processedContent.replace(/(\d{1,3}),(\d{3})/g, '$1.$2');
          // 대문자 규칙 (문장 시작은 대문자)
          processedContent = processedContent.replace(/([.!?]\s+)([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());
          break;

        case 'de': // 독일어
          // 숫자 포맷: 1.000
          processedContent = processedContent.replace(/(\d{1,3}),(\d{3})/g, '$1.$2');
          break;

        case 'ja': // 일본어
          // 숫자 포맷: 1,000 (일본식)
          processedContent = processedContent.replace(/(\d{1,3})\.(\d{3})/g, '$1,$2');
          // 마침표 정규화: 。(일본식 마침표)
          processedContent = processedContent.replace(/\.$/, '。');
          break;

        case 'zh': // 중국어
          // 마침표 정규화: 。(중국식 마침표)
          processedContent = processedContent.replace(/\.$/, '。');
          break;

        case 'en': // 영어
          // 숫자 포맷: 1,000
          processedContent = processedContent.replace(/(\d{1,3})\.(\d{3})/g, '$1,$2');
          // 대문자 규칙 (문장 시작, 문장부호 후)
          processedContent = processedContent.replace(/^([a-z])/g, (match) => match.toUpperCase());
          processedContent = processedContent.replace(/([.!?]\s+)([a-z])/g, (match, p1, p2) => p1 + p2.toUpperCase());
          break;

        case 'ko': // 한국어
          // 숫자 포맷: 1,000
          processedContent = processedContent.replace(/(\d{1,3})\.(\d{3})/g, '$1,$2');
          break;

        default:
          break;
      }

      // 타임스탬프와 함께 반환
      return timestamp + processedContent;
    }).join('\n');

    return formatted;
  };

  // ElevenLabs 재전사 상태 및 폴링 훅
  const { 
    artifacts, 
    isLoading: isLoadingArtifacts, 
    error: artifactsError, 
    startPolling, 
    stopPolling,
    refetch: refetchArtifacts 
  } = useMeetingArtifacts(meeting.id);

  // 미팅 ID 변경 시 캐시된 선택 언어 불러오고 자동 번역 수행
  useEffect(() => {
    const savedLang = localStorage.getItem(`meeting-${meeting.id}-content-lang`);
    if (savedLang) {
      setContentLang(savedLang);
    } else {
      setContentLang('ko');
    }
  }, [meeting.id]);

  // contentLang 변경 시 자동 번역 (캐시된 언어가 로드되었을 때)
  useEffect(() => {
    if (contentLang !== sourceLang && meeting.content) {
      handleTranslate(meeting.content, contentLang, 'content');
    } else if (contentLang === sourceLang) {
      setTranslatedContent('');
    }
  }, [contentLang, meeting.content]);

  const [isFinalizingTranscript, setIsFinalizingTranscript] = useState(false);
  const [finalizationProgress, setFinalizationProgress] = useState<{ all_done: boolean; final_transcript_status: 'queued'|'processing'|'done'|'error'|null; final_transcript_error?: string|null } | null>(null);

  // Poll finalization progress after meeting end until all downstream tasks finish
  useEffect(() => {
    let pollingIntervalId: NodeJS.Timeout | null = null;

    const startPolling = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const res = await fetch(`${apiUrl}/api/v1/meetings/${meeting.id}/finalization-progress`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          console.log('[MeetingDetail] Finalization progress:', data);
          setFinalizationProgress({
            all_done: !!data.all_done,
            final_transcript_status: data.final_transcript_status,
            final_transcript_error: data.final_transcript_error,
          });
          
          // all_done이 true면 즉시 폴링 중지
          if (data.all_done) {
            console.log('[MeetingDetail] Polling stopped - all_done=true');
            if (pollingIntervalId) {
              clearInterval(pollingIntervalId);
              pollingIntervalId = null;
            }
            return true; // Stop polling
          }
        }
      } catch (e) {
        console.error('[MeetingDetail] Poll error:', e);
      }
      return false; // Continue polling
    };
    
    // 처음 폴링 수행
    console.log('[MeetingDetail] Starting initial poll for meeting:', meeting.id);
    startPolling().then(shouldStop => {
      if (!shouldStop) {
        // 계속 폴링 필요 - interval 설정
        console.log('[MeetingDetail] Setting up polling interval...');
        pollingIntervalId = setInterval(() => {
          startPolling().then(shouldStop => {
            if (shouldStop) {
              console.log('[MeetingDetail] Clearing polling interval');
              if (pollingIntervalId) {
                clearInterval(pollingIntervalId);
                pollingIntervalId = null;
              }
            }
          });
        }, 1000);
      }
    });
    
    // Cleanup
    return () => {
      if (pollingIntervalId) {
        clearInterval(pollingIntervalId);
      }
    };
  }, [meeting.id]);

  // 회의 종료 완료 시 artifacts refetch 및 오디오 자동 재로드
  useEffect(() => {
    if (finalizationProgress?.all_done === true) {
      console.log('[MeetingDetail] Finalization completed, refetching artifacts and reloading audio...');
      
      // Artifacts 강제 새로고침 (summary, action items, content 데이터 로드)
      refetchArtifacts();
      
      // 오디오 재로드
      if (audioPlayerRef.current && meeting.audioUrl?.trim()) {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
        const audioApiUrl = `${apiUrl}/api/v1/meetings/${meeting.id}/audio`;
        
        fetch(audioApiUrl, { credentials: 'include' })
          .then(res => res.blob())
          .then(blob => {
            const url = URL.createObjectURL(blob);
            setAudioSrc(url);
            if (audioPlayerRef.current) {
              audioPlayerRef.current.src = url;
              audioPlayerRef.current.load();
            }
          })
          .catch(err => console.error('[MeetingDetail] Audio reload error:', err));
      }
    }
  }, [finalizationProgress?.all_done, meeting.id, refetchArtifacts]);

  // Set audio src with token on mount and when audioUrl changes
  useEffect(() => {
    let objectUrl: string | null = null;
    
    async function loadAudio() {
      if (meeting.audioUrl && meeting.audioUrl.trim() !== '') {
        try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
          const audioApiUrl = `${apiUrl}/api/v1/meetings/${meeting.id}/audio`;
          
          console.log('[MeetingDetail] Fetching audio from:', audioApiUrl);
          
          // httpOnly Cookie를 포함하여 오디오 파일 가져오기
          const response = await fetch(audioApiUrl, {
            credentials: 'include', // httpOnly Cookie 전송
          });
          
          if (!response.ok) {
            console.error('[MeetingDetail] Audio fetch failed:', response.status, response.statusText);
            setAudioSrc('');
            return;
          }
          
          // Blob으로 변환하고 Object URL 생성
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          
          console.log('[MeetingDetail] Audio loaded successfully, Blob URL:', objectUrl);
          setAudioSrc(objectUrl);
          
          // 오디오 엘리먼트가 있으면 강제로 로드
          if (audioPlayerRef.current) {
            audioPlayerRef.current.load();
          }
        } catch (error) {
          console.error('[MeetingDetail] Audio load error:', error);
          setAudioSrc('');
        }
      } else {
        console.log('[MeetingDetail] No audio URL available:', meeting.audioUrl);
        setAudioSrc('');
      }
    }
    
    loadAudio();
    
    // Cleanup: Object URL 해제
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [meeting.id, meeting.audioUrl]);

  // artifacts 변경 시 meeting 상태 업데이트 (summary, action_items, content, audio)
  useEffect(() => {
    if (artifacts) {
      console.log('[MeetingDetail] Updating meeting from artifacts:', artifacts);
      setMeeting(prev => ({
        ...prev,
        audioUrl: artifacts.audio_url || prev.audioUrl,
        summary: artifacts.summary?.content || prev.summary,
        content: artifacts.final_transcript_text || prev.content,
        actionItems: artifacts.action_items.map(item => ({
          id: item.item_id,
          text: item.title,
          completed: item.status === 'COMPLETED' || item.status === 'completed',
          priority: item.priority || undefined,
          assignee: item.assignee_name || '',
          dueDate: item.due_dt || '',
        })) || prev.actionItems,
      }));
    }
  }, [artifacts]);

  // Scroll to section function
  const scrollToSection = (ref: React.RefObject<HTMLDivElement | null>) => {
    if (ref.current) {
      // Open the section if it's closed
      if (ref === summaryRef && !summaryOpen) setSummaryOpen(true);
      if (ref === actionItemsRef && !actionItemsOpen) setActionItemsOpen(true);
      if (ref === contentRef && !contentOpen) setContentOpen(true);
      if (ref === audioRef && !audioOpen) setAudioOpen(true);
      
      // Wait for opening animation, then scroll
      setTimeout(() => {
        ref.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'start',
          inline: 'nearest'
        });
      }, 100);
    }
  };

  const handleToggleActionItem = async (actionItemId: string) => {
    const item = meeting.actionItems.find(item => item.id === actionItemId);
    if (!item) return;

    const newCompleted = !item.completed;
    
    // 로컬 상태 즉시 업데이트 (UI 반응성)
    const updatedActionItems = meeting.actionItems.map(item =>
      item.id === actionItemId ? { ...item, completed: newCompleted } : item
    );
    const updatedMeeting = { ...meeting, actionItems: updatedActionItems };
    
    // 로컬 meeting state 업데이트
    setMeeting(updatedMeeting);
    console.log('[MeetingDetail] Local meeting state updated (toggle)');
    
    // 부모에게 전파
    onUpdateMeeting(updatedMeeting);

    // 백엔드 동기화
    try {
      const newStatus = newCompleted ? 'DONE' : 'TODO';
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/reports/${meeting.id}/action-items/${actionItemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (error) {
      console.error('Failed to toggle action item:', error);
    }
  };

  const handleUpdateActionItem = async (actionItemId: string, field: keyof ActionItem, value: string) => {
    // 로컬 상태 즉시 업데이트 (UI 반응성)
    const updatedActionItems = meeting.actionItems.map(item =>
      item.id === actionItemId ? { ...item, [field]: value } : item
    );
    const updatedMeeting = { ...meeting, actionItems: updatedActionItems };
    
    // 로컬 meeting state 업데이트
    setMeeting(updatedMeeting);
    console.log('[MeetingDetail] Local meeting state updated (field update)');
    
    // 부모에게 전파
    onUpdateMeeting(updatedMeeting);

    // 백엔드 동기화
    try {
      const updates: any = {};
      
      if (field === 'assignee') {
        updates.assignee_name = value;
      } else if (field === 'dueDate') {
        updates.due_dt = value;
      } else if (field === 'text') {
        updates.title = value;
      }

      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/reports/${meeting.id}/action-items/${actionItemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
    } catch (error) {
      console.error('Failed to update action item:', error);
    }
  };

  const calculateProgress = () => {
    if (meeting.actionItems.length === 0) return 100;
    const completed = meeting.actionItems.filter(item => item.completed).length;
    return Math.round((completed / meeting.actionItems.length) * 100);
  };

  const handleExportPDF = () => {
    exportToPDF(meeting);
  };

  const handleExportWord = () => {
    exportToWord(meeting);
  };

  const handleDelete = async () => {
    if (confirm('정말로 이 회의록을 삭제하시겠습니까?')) {
      // Dashboard의 handleDeleteMeeting이 백엔드 호출과 상태 업데이트를 모두 처리
      await onDeleteMeeting(meeting.id);
      onClose();
    }
  };

  const handleFinalizeTranscript = async () => {
    if (!meeting.audioUrl) {
      alert('오디오 파일이 없어 재전사를 시작할 수 없습니다.');
      return;
    }

    setIsFinalizingTranscript(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const response = await fetch(`${apiUrl}/api/v1/meetings/${meeting.id}/finalize`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Failed to start transcription' }));
        console.error('[MeetingDetail] Finalize error:', error);
        alert(`재전사 시작 실패: ${error.detail || '알 수 없는 오류'}`);
        return;
      }

      const result = await response.json();
      console.log('[MeetingDetail] Finalize started, job_id:', result.job_id);
      
      // 폴링 시작
      startPolling();
    } catch (error) {
      console.error('[MeetingDetail] Finalize error:', error);
      alert('재전사 시작 중 오류가 발생했습니다.');
    } finally {
      setIsFinalizingTranscript(false);
    }
  };

  const handleTranslate = async (text: string, targetLang: string, type: 'summary' | 'content') => {
    // 캐시 확인
    const cacheKey = targetLang;
    const cachedTranslation = type === 'summary' 
      ? translationCache.summary[cacheKey] 
      : translationCache.content[cacheKey];
    
    if (cachedTranslation) {
      console.log(`[MeetingDetail] Using cached translation: ${targetLang}`);
      if (type === 'summary') {
        setTranslatedSummary(cachedTranslation);
      } else {
        setTranslatedContent(cachedTranslation);
      }
      return;
    }
    
    setIsTranslating(true);
    
    try {
      // 백엔드 번역 API 호출
      const contentType = type === 'summary' ? 'summary' : 'transcript';
      const sourceLangFull = langMap[sourceLang]?.fullName || 'Korean';
      const targetLangFull = langMap[targetLang]?.fullName || 'English';
      
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/reports/${meeting.id}/translate?content_type=${contentType}&source_lang=${sourceLangFull}&target_lang=${targetLangFull}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // httpOnly Cookie 전송
        }
      );
      
      if (response.ok) {
        const result = await response.json();
        
        // 캐시된 번역이면 즉시 표시
        if (result.cached && result.translated_text) {
          const formattedText = formatTranslatedText(result.translated_text, targetLang);
          
          // 캐시에 저장
          setTranslationCache(prev => ({
            ...prev,
            [type]: {
              ...prev[type],
              [cacheKey]: formattedText
            }
          }));
          
          if (type === 'summary') {
            setTranslatedSummary(formattedText);
          } else {
            setTranslatedContent(formattedText);
          }
          
          console.log(`[MeetingDetail] Translation loaded from cache: ${sourceLangFull} → ${targetLangFull}`);
          setIsTranslating(false);
          return;
        }
        
        // Queue에 등록된 경우 - polling 시작 (isTranslating은 유지)
        if (result.status === 'queued' || result.status === 'processing') {
          console.log(`[MeetingDetail] Translation queued/processing: ${result.status}`);
          
          // Polling 시작
          pollTranslationStatus(contentType, targetLangFull, type, cacheKey);
          return;
        }
        
        console.log(`[MeetingDetail] Unexpected response:`, result);
      } else {
        const error = await response.json().catch(() => ({ detail: 'Translation failed' }));
        console.error('[MeetingDetail] Translation error:', error);
        alert(`번역 실패: ${error.detail || '알 수 없는 오류'}`);
        setIsTranslating(false);
      }
    } catch (error) {
      console.error('[MeetingDetail] Translation error:', error);
      alert('번역 중 오류가 발생했습니다.');
      setIsTranslating(false);
    }
  };

  // 번역 상태 polling
  const pollTranslationStatus = async (
    contentType: string,
    targetLangFull: string,
    type: 'summary' | 'content',
    cacheKey: string
  ) => {
    const maxAttempts = 60; // 5분 (5초 간격)
    let attempts = 0;
    
    const poll = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/reports/${meeting.id}/translation-status?content_type=${contentType}`,
          {
            credentials: 'include',
          }
        );
        
        if (response.ok) {
          const result = await response.json();
          
          if (result.status === 'done' && result.translated_text) {
            // 번역 완료
            const formattedText = formatTranslatedText(result.translated_text, langMap[targetLangFull.toLowerCase()]?.code || 'en');
            
            // 캐시에 저장
            setTranslationCache(prev => ({
              ...prev,
              [type]: {
                ...prev[type],
                [cacheKey]: formattedText
              }
            }));
            
            if (type === 'summary') {
              setTranslatedSummary(formattedText);
            } else {
              setTranslatedContent(formattedText);
            }
            
            console.log(`[MeetingDetail] Translation completed via polling`);
            setIsTranslating(false);
          } else if (result.status === 'error') {
            // 번역 실패
            console.error('[MeetingDetail] Translation failed:', result.error);
            alert(`번역 실패: ${result.error || '알 수 없는 오류'}`);
            setIsTranslating(false);
          } else if (result.status === 'processing' || result.status === 'queued') {
            // 계속 polling
            attempts++;
            if (attempts < maxAttempts) {
              setTimeout(poll, 5000); // 5초 후 재시도
            } else {
              console.error('[MeetingDetail] Translation polling timeout');
              alert('번역이 너무 오래 걸립니다. 나중에 다시 시도해주세요.');
              setIsTranslating(false);
            }
          }
        }
      } catch (error) {
        console.error('[MeetingDetail] Polling error:', error);
        attempts++;
        if (attempts < maxAttempts) {
          setTimeout(poll, 5000);
        } else {
          setIsTranslating(false);
        }
      }
    };
    
    // 첫 polling 시작
    setTimeout(poll, 2000); // 2초 후 첫 확인
  };

  const handleAudioPlayPause = () => {
    // Audio playback toggle logic
    if (audioPlayerRef.current) {
      if (isPlaying) {
        audioPlayerRef.current.pause();
      } else {
        audioPlayerRef.current.play();
      }
    }
    setIsPlaying(!isPlaying);
  };

  const handleAudioDownload = async () => {
    if (!audioSrc) {
      console.error('[MeetingDetail] No audio source available');
      alert('오디오 파일을 사용할 수 없습니다.');
      return;
    }
    
    try {
      console.log('[MeetingDetail] Downloading from:', audioSrc);
      const response = await fetch(audioSrc);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const blob = await response.blob();
      console.log('[MeetingDetail] Downloaded blob:', blob.size, 'bytes');
      
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${meeting.title}_audio.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      console.log('[MeetingDetail] Download completed');
    } catch (error) {
      console.error('[MeetingDetail] Download failed:', error);
      alert(`오디오 파일 다운로드에 실패했습니다: ${error}`);
    }
  };

  useEffect(() => {
    const currentRef = audioPlayerRef.current;
    if (currentRef) {
      currentRef.addEventListener('play', () => setIsPlaying(true));
      currentRef.addEventListener('pause', () => setIsPlaying(false));
    }
    return () => {
      if (currentRef) {
        currentRef.removeEventListener('play', () => setIsPlaying(true));
        currentRef.removeEventListener('pause', () => setIsPlaying(false));
      }
    };
  }, []);

  return (
    <div className="w-[1100px] mx-auto px-4 space-y-4 md:space-y-6">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-2 -ml-2">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">목록으로</span>
          </Button>
          
          {/* Desktop Actions */}
          <div className="hidden md:flex gap-2">
            {/* 재전사 수동 트리거 제거: 회의 종료 시 자동으로 큐 등록됨 */}
            <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-2">
              <Download className="w-4 h-4" />
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportWord} className="gap-2">
              <Download className="w-4 h-4" />
              Word
            </Button>
            {activeTab !== 'analysis' && activeTab !== 'basic' && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const { exportMeetingToNotion } = await import('@/features/meetings/integrations');
                    await exportMeetingToNotion(meeting);
                  } catch (e) {
                    console.error(e);
                    alert('Notion 연동 중 오류가 발생했습니다.');
                  }
                }}
                className="gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Notion으로 전송
              </Button>
            )}
            <Button variant="destructive" size="sm" onClick={handleDelete} className="gap-2">
              <Trash2 className="w-4 h-4" />
              삭제
            </Button>
          </div>

          {/* Mobile Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild className="md:hidden">
              <Button variant="outline" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {activeTab !== 'analysis' && (
                <>
                  <DropdownMenuItem onClick={handleExportPDF}>
                    <Download className="w-4 h-4 mr-2" />
                    PDF로 내보내기
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportWord}>
                    <FileDown className="w-4 h-4 mr-2" />
                    Word로 내보내기
                  </DropdownMenuItem>
                </>
              )}
              {/* 재전사 수동 트리거 제거: 회의 종료 시 자동으로 큐 등록됨 */}
              <DropdownMenuItem onClick={handleDelete} className="text-red-600">
                <Trash2 className="w-4 h-4 mr-2" />
                회의록 삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <h1 className="text-blue-600">{meeting.title}</h1>

        {/* Info Cards - Mobile Optimized */}
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          <Card className="shadow-sm">
            <CardContent className="p-3 md:p-4">
              <div className="flex flex-col items-center text-center gap-1">
                <Calendar className="w-5 h-5 md:w-6 md:h-6 text-blue-500 mb-1" />
                <p className="text-xs text-gray-500">회의 날짜</p>
                <p className="text-xs md:text-sm mt-1">{meeting.date}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-3 md:p-4">
              <div className="flex flex-col items-center text-center gap-1">
                <ListChecks className="w-5 h-5 md:w-6 md:h-6 text-green-500 mb-1" />
                <p className="text-xs text-gray-500">액션 아이템</p>
                <p className="text-xs md:text-sm mt-1">{meeting.actionItems.length}개</p>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="p-3 md:p-4">
              <div className="flex flex-col items-center text-center gap-1">
                <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6 text-purple-500 mb-1" />
                <p className="text-xs text-gray-500">진행률</p>
                <p className="text-xs md:text-sm mt-1">{calculateProgress()}%</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="basic" className="gap-1 md:gap-2 text-sm md:text-base">
            <FileText className="w-4 h-4" />
            <span className="hidden sm:inline">기본 정보</span>
            <span className="sm:hidden">기본</span>
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-1 md:gap-2 text-sm md:text-base">
            <Brain className="w-4 h-4" />
            <span className="hidden sm:inline">액션 및 분석</span>
            <span className="sm:hidden">분석</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4 md:space-y-6 mt-4 md:mt-6">
          {/* Quick Navigation Buttons */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
            <Button
              variant="outline"
              onClick={() => scrollToSection(summaryRef)}
              className="gap-2 border-primary/30 hover:bg-primary/10 hover:border-primary"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="text-sm">회의 요약</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => scrollToSection(actionItemsRef)}
              className="gap-2 border-primary/30 hover:bg-primary/10 hover:border-primary"
            >
              <ListChecks className="w-4 h-4" />
              <span className="text-sm">액션 아이템</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => scrollToSection(contentRef)}
              className="gap-2 border-primary/30 hover:bg-primary/10 hover:border-primary"
            >
              <FileText className="w-4 h-4" />
              <span className="text-sm">회의 원문</span>
            </Button>
            <Button
              variant="outline"
              onClick={() => scrollToSection(audioRef)}
              className="gap-2 border-primary/30 hover:bg-primary/10 hover:border-primary"
            >
              <Mic className="w-4 h-4" />
              <span className="text-sm">오디오 파일</span>
            </Button>
          </div>

          {/* 고품질 전사 처리 상태 표시 */}
          {artifacts?.final_transcript_status && (
            <TranscriptStatusBanner 
              status={finalizationProgress?.all_done ? 'done' : (finalizationProgress?.final_transcript_status ?? artifacts.final_transcript_status)}
              error={finalizationProgress?.final_transcript_error ?? artifacts.final_transcript_error}
              usedFallback={finalizationProgress?.final_transcript_status === 'error'}
            />
          )}

          {/* Meeting Summary */}
          <div ref={summaryRef}>
            <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen}>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      회의 요약
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Select
                        value={summaryLang}
                        onValueChange={(lang) => {
                          setSummaryLang(lang);
                          if (lang !== 'ko') {
                            handleTranslate(meeting.summary, lang, 'summary');
                          } else {
                            setTranslatedSummary('');
                          }
                        }}
                      >
                        <SelectTrigger className="w-[140px] h-8">
                          <Languages className="w-4 h-4 mr-1" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ko">한국어</SelectItem>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="ja">日本語</SelectItem>
                          <SelectItem value="zh">中文</SelectItem>
                        </SelectContent>
                      </Select>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {summaryOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent>
                    {isTranslating && summaryLang !== 'ko' ? (
                      <div className="text-center py-4 text-gray-500">번역 중...</div>
                    ) : (
                      <div className="prose max-w-none">
                        <p className="whitespace-pre-wrap text-gray-700">
                          {summaryLang === 'ko' ? meeting.summary : translatedSummary || meeting.summary}
                        </p>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          {/* Action Items */}
          <div ref={actionItemsRef}>
            <Collapsible open={actionItemsOpen} onOpenChange={setActionItemsOpen}>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      액션 아이템
                      <Badge variant="secondary">
                        {meeting.actionItems.filter(a => a.completed).length} / {meeting.actionItems.length} 완료
                      </Badge>
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setActiveTab('analysis')}
                        className="gap-2"
                      >
                        <Settings className="w-4 h-4" />
                        <span className="hidden sm:inline">수정</span>
                      </Button>
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {actionItemsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent>
                    {meeting.actionItems.length === 0 ? (
                      <p className="text-gray-500 text-center py-8">액션 아이템이 없습니다</p>
                    ) : (
                      <div className="space-y-3">
                        {meeting.actionItems.map((item) => (
                          <div
                            key={item.id}
                            className={`p-3 md:p-4 border rounded-lg ${
                              item.completed ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300'
                            }`}
                          >
                            <div className="flex items-start gap-2 md:gap-3 mb-3">
                              <Checkbox
                                checked={item.completed}
                                onCheckedChange={() => handleToggleActionItem(item.id)}
                                className="mt-0.5 md:mt-1"
                              />
                              <p className={`flex-1 text-sm md:text-base ${item.completed ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                                {item.text}
                              </p>
                              <div className="flex gap-1 shrink-0">
                                {item.priority && (
                                  <Badge 
                                    variant="secondary" 
                                    className={`text-xs ${
                                      item.priority === '높음' ? 'bg-red-100 text-red-700' :
                                      item.priority === '중간' ? 'bg-yellow-100 text-yellow-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}
                                  >
                                    {item.priority}
                                  </Badge>
                                )}
                                {item.completed && (
                                  <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                                    완료
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-6 md:ml-8">
                              <div className="space-y-1">
                                <label className="text-xs text-gray-500 flex items-center gap-1">
                                  <User className="w-3 h-3" />
                                  담당자
                                </label>
                                <Input
                                  key={`assignee-${item.id}`}
                                  defaultValue={item.assignee}
                                  onBlur={(e) => {
                                    if (e.target.value !== item.assignee) {
                                      handleUpdateActionItem(item.id, 'assignee', e.target.value);
                                    }
                                  }}
                                  placeholder="담당자 이름"
                                  className="h-8 md:h-9 text-sm"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-gray-500 flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  마감일
                                </label>
                                <Input
                                  type="date"
                                  key={`duedate-${item.id}`}
                                  defaultValue={item.dueDate}
                                  onChange={(e) => handleUpdateActionItem(item.id, 'dueDate', e.target.value)}
                                  className="h-8 md:h-9 text-sm"
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          {/* AI Analysis Results */}
          {((meeting.participants?.length ?? 0) > 0 ||
            (meeting.keyDecisions?.length ?? 0) > 0 ||
            (meeting.nextSteps?.length ?? 0) > 0) && (
            <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-blue-600" />
                  AI 분석 결과
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {(meeting.participants?.length ?? 0)> 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4 text-purple-600" />
                      참석자
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {meeting.participants?.map((participant, index) => (
                        <Badge key={index} variant="secondary" className="bg-white">
                          {participant}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {(meeting.keyDecisions?.length ?? 0)> 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 mb-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      주요 결정사항
                    </h4>
                    <ul className="space-y-2">
                      {meeting.keyDecisions?.map((decision, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <span className="text-green-600 shrink-0">•</span>
                          <span className="text-gray-700">{decision}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(meeting.nextSteps?.length ?? 0)> 0 && (
                  <div>
                    <h4 className="flex items-center gap-2 mb-2">
                      <ListChecks className="w-4 h-4 text-blue-600" />
                      다음 단계
                    </h4>
                    <ul className="space-y-2">
                      {meeting.nextSteps?.map((step, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <span className="text-blue-600 shrink-0">{index + 1}.</span>
                          <span className="text-gray-700">{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Full Content */}
          <div ref={contentRef}>
            <Collapsible open={contentOpen} onOpenChange={setContentOpen}>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      회의 원문
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {/* 원문 언어 (Static) */}
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md text-sm font-medium border border-gray-200">
                        <Mic className="w-3.5 h-3.5" />
                        <span>{langMap[sourceLang]?.name}</span>
                      </div>
                      
                      {/* 번역 언어 선택 (Clickable Toggle) */}
                      <Select
                        value={contentLang}
                        onValueChange={(lang) => {
                          setContentLang(lang);
                          // localStorage에 선택 언어 저장
                          localStorage.setItem(`meeting-${meeting.id}-content-lang`, lang);
                          
                          if (lang !== sourceLang) {
                            handleTranslate(meeting.content, lang, 'content');
                          } else {
                            setTranslatedContent('');
                          }
                        }}
                      >
                        <SelectTrigger className="w-[140px] h-8">
                          <Languages className="w-4 h-4 mr-1" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ko">
                            <span className="font-medium">원문 보기</span>
                          </SelectItem>
                          <SelectItem value="en">English</SelectItem>
                          <SelectItem value="ja">日本語</SelectItem>
                          <SelectItem value="zh">中文</SelectItem>
                          <SelectItem value="es">Español</SelectItem>
                          <SelectItem value="fr">Français</SelectItem>
                          <SelectItem value="de">Deutsch</SelectItem>
                        </SelectContent>
                      </Select>
                      
                      <CollapsibleTrigger asChild>
                        <Button variant="ghost" size="sm">
                          {contentOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent>
                    {isTranslating && contentLang !== sourceLang ? (
                      <div className="text-center py-8 text-gray-500">
                        <div className="inline-flex items-center gap-2">
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
                          <span>{langMap[sourceLang]?.name} → {langMap[contentLang]?.name} 번역 중...</span>
                        </div>
                      </div>
                    ) : (
                      <TranscriptDisplay 
                        transcript={contentLang === sourceLang ? meeting.content : translatedContent || meeting.content}
                        isLoading={false}
                      />
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          {/* Audio File Section */}
          <div ref={audioRef}>
            <Collapsible open={audioOpen} onOpenChange={setAudioOpen}>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Volume2 className="w-5 h-5 text-purple-600" />
                      원본 오디오 파일
                    </CardTitle>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm">
                        {audioOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent>
                    {meeting.audioUrl && meeting.audioUrl.trim() !== '' ? (
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className="text-sm text-gray-600">
                              <span className="font-medium">{meeting.title}</span> 녹음 파일
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAudioDownload}
                            className="gap-2"
                          >
                            <Download className="w-4 h-4" />
                            다운로드
                          </Button>
                        </div>
                        <audio
                          ref={audioPlayerRef}
                          {...(audioSrc && { src: audioSrc })}
                          controls
                          className="w-full"
                          onError={(e) => {
                            const target = e.target as HTMLAudioElement;
                            console.error('[MeetingDetail] Audio load error:', {
                              src: target.src,
                              error: target.error,
                              networkState: target.networkState,
                              readyState: target.readyState
                            });
                          }}
                        />
                        <p className="text-xs text-gray-500 mt-4">
                          * 회의 중 녹음된 원본 오디오 파일입니다. 재생 또는 다운로드하여 다시 들을 수 있습니다.
                        </p>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500">
                        <Volume2 className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                        <p>녹음된 오디오 파일이 없습니다</p>
                        <p className="text-xs mt-1">회의 시작 시 음성 녹음을 활성화하면 오디오 파일이 저장됩니다.</p>
                      </div>
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>
        </TabsContent>

        <TabsContent value="analysis" className="mt-6">
          <MeetingAnalysis 
            meeting={meeting} 
            onUpdateMeeting={(updatedMeeting) => {
              // 로컬 상태 즉시 업데이트
              setMeeting(updatedMeeting);
              console.log('[MeetingDetail] Local meeting state updated');
              // 부모에게 전파
              onUpdateMeeting(updatedMeeting);
            }} 
          />
        </TabsContent>
      </Tabs>
      
      <ScrollToTop />
    </div>
  );
}