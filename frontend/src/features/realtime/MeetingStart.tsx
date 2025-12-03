import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MeetingInfoInput } from '@/features/meetings/MeetingInfoInput';
import { MeetingContentInput } from './MeetingContentInput';
import type { Meeting } from '@/features/dashboard/Dashboard';
import { createMeeting, updateMeeting, endMeeting, type MeetingResponse } from '@/features/meetings/meetingsService';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Switch } from '@/shared/ui/switch';
import { Label } from '@/shared/ui/label';
import { Video, Mic, Upload, ArrowRight } from 'lucide-react';

type MeetingMode = 'video-conference' | 'offline' | 'file-upload';

interface MeetingStartProps {
  meetings: Meeting[];
  onAddMeeting: (meeting: Meeting) => void;
  meetingMode: MeetingMode;
}

export function MeetingStart({ meetings, onAddMeeting, meetingMode }: MeetingStartProps) {
  const [currentStep, setCurrentStep] = useState<'transcribe' | 'info'>('transcribe');
  const router = useRouter();
  const [transcribedContent, setTranscribedContent] = useState('');
  const [aiAnalysis, setAiAnalysis] = useState<any>(null);
  const [createdMeetingId, setCreatedMeetingId] = useState<string | null>(null);

  // 회의 전사 완료 시
  const handleContentComplete = (content: string, analysis?: any, meetingId?: string | null) => {
    setTranscribedContent(content);
    setAiAnalysis(analysis);
    if (meetingId) {
      setCreatedMeetingId(meetingId);
    }
    setCurrentStep('info');
  };

  // 정보 입력 완료 시 - 최종 저장
  const handleInfoComplete = async (info: { title: string; date: string; purpose: string; participants: string[] }) => {
    // 1. 백엔드에 회의 생성/업데이트 요청
    toast.info('회의를 저장하는 중...');

    let meetingData;
    try {
      if (createdMeetingId) {
        // 기존 회의 업데이트
        meetingData = await updateMeeting(createdMeetingId, {
          title: info.title,
          purpose: info.purpose,
        });
      } else {
        // 회의 생성 (fallback)
        meetingData = await createMeeting({
          title: info.title,
          purpose: info.purpose,
          is_realtime: true,
        });
        setCreatedMeetingId(meetingData.meeting_id);
      }
    } catch (createError) {
      console.error('[MeetingStart] Failed to create/update meeting:', createError);
      toast.error('회의 저장에 실패했습니다.');
      return;
    }

    // 3. 오디오 파일 업로드 (WebSocket에서 이미 고품질 오디오가 저장되므로 프론트엔드 업로드 생략)
    /*
    if (aiAnalysis?.audioBlob) {
      try {
        const formData = new FormData();
        formData.append('file', aiAnalysis.audioBlob, `${meetingData.meeting_id}.wav`);
        
        const uploadResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/meetings/${meetingData.meeting_id}/audio`,
          {
            method: 'POST',
            credentials: 'include', // httpOnly Cookie 전송
            body: formData,
          }
        );
        
        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          console.log('[MeetingStart] Audio uploaded:', uploadResult);
          toast.success('오디오 파일이 업로드되었습니다.');
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.error('Audio upload failed:', await uploadResponse.text());
          toast.warning('오디오 파일 업로드에 실패했습니다.');
        }
      } catch (uploadError) {
        console.error('[MeetingStart] Audio upload error:', uploadError);
        toast.warning('오디오 파일 업로드 중 오류가 발생했습니다.');
      }
    }
    */

    // 4. 회의 종료 + LLM 처리를 위한 헬퍼 함수들
    const extractActionItems = (text: string) => {
      const lines = text.split('\n');
      const actionItems = [];

      // 로컬스토리지에서 키워드 설정 가져오기
      const keywordSettings = localStorage.getItem('roundnote-keyword-settings');
      let actionKeywords = ['액션', '할일', '과제', '담당', '진행', '검토', '확인', '준비', '작성', '제출'];

      if (keywordSettings) {
        try {
          const settings = JSON.parse(keywordSettings);
          if (settings.actionKeywords && settings.actionKeywords.length > 0) {
            actionKeywords = settings.actionKeywords;
          }
        } catch (error) {
          console.error('Failed to load keyword settings:', error);
        }
      }

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length > 5 && actionKeywords.some(keyword => trimmedLine.includes(keyword))) {
          const assigneeMatch = trimmedLine.match(/([가-힣]{2,4})\s*(?:님|씨|:|,)/);
          const assignee = assigneeMatch ? assigneeMatch[1] : '미정';

          actionItems.push({
            id: `${Date.now()}-${Math.random()}`,
            text: trimmedLine.replace(/^[-•*]\s*/, ''),
            assignee,
            dueDate: '',
            completed: false
          });
        }
      }

      return actionItems;
    };

    const generateSummary = (text: string) => {
      const lines = text.split('\n').filter(line => line.trim().length > 0);
      const summaryLines = [];

      const importantKeywords = ['결정', '합의', '중요', '주요', '핵심', '논의', '결론'];

      for (const line of lines) {
        if (importantKeywords.some(keyword => line.includes(keyword))) {
          summaryLines.push(line.trim().replace(/^[-•*]\s*/, ''));
        }
      }

      if (summaryLines.length === 0 && lines.length > 0) {
        summaryLines.push(...lines.slice(0, 3).map(l => l.trim().replace(/^[-•*]\s*/, '')));
      }

      return summaryLines.length > 0
        ? summaryLines.join('\n')
        : '회의 내용에서 주요 사항을 추출하지 못했습니다.';
    };

    // 5. 백엔드 API 호출: 회의 종료 + LLM 요약/액션아이템 자동 생성
    let summary = '';
    let actionItems: any[] = [];
    let audioUrl = ''; try {
      const endBody: any = {
        status: 'COMPLETED',
        ended_at: new Date().toISOString(),
        content: transcribedContent,
      };

      // 기존에 생성된 회의가 없어서 새로 만든 경우에만 audio_url을 추측해서 보냄
      // (기존 회의가 있었다면 WebSocket이 이미 audio_url을 설정했을 것이므로 덮어쓰지 않음)
      if (!createdMeetingId) {
        endBody.audio_url = `./audio_storage/${meetingData.meeting_id}.wav`;
      }

      const endResponse = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v1/meetings/${meetingData.meeting_id}/end`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include', // httpOnly Cookie 전송
          body: JSON.stringify(endBody),
        }
      );

      if (endResponse.ok) {
        const endResult = await endResponse.json();
        console.log('[MeetingStart] End meeting response:', endResult);

        // 백엔드에서 생성한 요약과 액션 아이템 사용
        summary = endResult.summary || '';
        audioUrl = endResult.audio_url || `./audio_storage/${meetingData.meeting_id}.wav`;

        // 액션 아이템 변환
        if (endResult.action_items && Array.isArray(endResult.action_items)) {
          actionItems = endResult.action_items.map((item: any, index: number) => ({
            id: item.item_id || `${Date.now()}-${index}`,
            item_id: item.item_id,
            text: item.title || item.task || '',
            title: item.title || item.task || '',
            description: item.description || '',
            assignee: item.assignee || '미정',
            dueDate: item.deadline || '',
            due_date: item.deadline,
            completed: item.status === 'DONE',
            priority: (item.priority || 'MEDIUM').toLowerCase(),
            jira_assignee_id: item.jira_assignee_id || ''
          }));
        }

        console.log('[MeetingStart] Using backend-generated summary and action items');
      } else {
        console.warn('[MeetingStart] Failed to end meeting on backend, using fallback');
        throw new Error('Failed to end meeting');
      }
    } catch (error) {
      console.error('Failed to save meeting:', error);
      toast.error('회의 저장에 실패했습니다. 다시 시도해주세요.');
      // If auth error, redirect to login
      try {
        if (error instanceof Error && (error.name === 'AuthError' || /auth/i.test(error.message) || /유효하지/i.test(error.message))) {
          toast.error('로그인이 필요합니다. 로그인 페이지로 이동합니다.');
          router.push('/login');
          return;
        }
      } catch (e) {
        console.error('Router redirect failed', e);
      }

      // 에러 발생 시에도 로컬 상태는 업데이트 (임시 ID 사용)
      const extractActionItems = (text: string) => {
        const lines = text.split('\n');
        const actionItems = [];

        const keywordSettings = localStorage.getItem('roundnote-keyword-settings');
        let actionKeywords = ['액션', '할일', '과제', '담당', '진행', '검토', '확인', '준비', '작성', '제출'];

        if (keywordSettings) {
          try {
            const settings = JSON.parse(keywordSettings);
            if (settings.actionKeywords && settings.actionKeywords.length > 0) {
              actionKeywords = settings.actionKeywords;
            }
          } catch (error) {
            console.error('Failed to load keyword settings:', error);
          }
        }

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.length > 5 && actionKeywords.some(keyword => trimmedLine.includes(keyword))) {
            const assigneeMatch = trimmedLine.match(/([가-힣]{2,4})\s*(?:님|씨|:|,)/);
            const assignee = assigneeMatch ? assigneeMatch[1] : '미정';

            actionItems.push({
              id: `${Date.now()}-${Math.random()}`,
              text: trimmedLine.replace(/^[-•*]\s*/, ''),
              assignee,
              dueDate: '',
              completed: false
            });
          }
        }

        return actionItems;
      };

      const generateSummary = (text: string) => {
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        const summaryLines = [];

        const importantKeywords = ['결정', '합의', '중요', '주요', '핵심', '논의', '결론'];

        for (const line of lines) {
          if (importantKeywords.some(keyword => line.includes(keyword))) {
            summaryLines.push(line.trim().replace(/^[-•*]\s*/, ''));
          }
        }

        if (summaryLines.length === 0 && lines.length > 0) {
          summaryLines.push(...lines.slice(0, 3).map(l => l.trim().replace(/^[-•*]\s*/, '')));
        }

        return summaryLines.length > 0
          ? summaryLines.join('\n')
          : '회의 내용에서 주요 사항을 추출하지 못했습니다.';
      };

      let summary = '';
      let actionItems: any[] = [];

      // Fallback: AI 분석 결과 또는 로컬 패턴 매칭 사용
      if (aiAnalysis) {
        summary = aiAnalysis.summary || generateSummary(transcribedContent);

        if (aiAnalysis.actionItems && Array.isArray(aiAnalysis.actionItems)) {
          actionItems = aiAnalysis.actionItems.map((item: any, index: number) => ({
            id: `${Date.now()}-${index}`,
            text: item.task || item.text || '',
            assignee: item.assignee || '미정',
            dueDate: item.dueDate || '',
            completed: false,
            priority: item.priority
          }));
        } else {
          actionItems = extractActionItems(transcribedContent);
        }
      } else {
        summary = generateSummary(transcribedContent);
        actionItems = extractActionItems(transcribedContent);
      }

      // 회의 정보 조회 시도
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v1/meetings/${meetingData.meeting_id}`,
          {
            method: 'GET',
            credentials: 'include', // httpOnly Cookie 전송
          }
        );

        if (response.ok) {
          const meetingFromBackend = await response.json();
          audioUrl = meetingFromBackend.audio_url || meetingFromBackend.location || `./audio_storage/${meetingData.meeting_id}.wav`;
          console.log('[MeetingStart] Fetched audio URL from backend:', audioUrl);
        } else {
          console.warn('[MeetingStart] Failed to fetch meeting from backend');
          audioUrl = `./audio_storage/${meetingData.meeting_id}.wav`;
        }
      } catch (fetchError) {
        console.error('[MeetingStart] Error fetching meeting:', fetchError);
        audioUrl = `./audio_storage/${meetingData.meeting_id}.wav`;
      }
    }

    const now = new Date().toISOString();

    const newMeeting: Meeting = {
      id: meetingData.meeting_id, // 백엔드에서 받은 ID 사용
      title: info.title,
      date: info.date,
      content: transcribedContent,
      summary,
      actionItems,
      createdAt: meetingData.start_dt || now,
      updatedAt: now,
      participants: info.participants,
      keyDecisions: aiAnalysis?.keyDecisions || [],
      nextSteps: aiAnalysis?.nextSteps || [],
      audioUrl: audioUrl // 백엔드에서 확인된 실제 경로 사용
    };

    console.log('[MeetingStart] New meeting object:', newMeeting);
    onAddMeeting(newMeeting);
    toast.success('회의가 성공적으로 저장되었습니다!');
  };

  const handleBack = () => {
    setCurrentStep('transcribe');
  };

  // 1단계: 회의 시작 (전사)
  if (currentStep === 'transcribe') {
    return (
      <MeetingContentInput
        meetingInfo={{
          title: '',
          date: new Date().toISOString().split('T')[0],
          purpose: '',
          participants: ''
        }}
        meetingMode={meetingMode}
        onComplete={handleContentComplete}
        onBack={handleBack}
        meetings={meetings}
      />
    );
  }

  // 2단계: 정보 입력 (제목, 목적, 참석자 등)
  // AI 분석 결과를 바탕으로 초기값 설정
  const generateDefaultTitle = () => {
    const now = new Date();

    // 날짜 (한국식 표기)
    const dateStr = now.toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }); // "2025년 11월 24일"

    // 시간 (시:분)
    const timeStr = `${String(now.getHours()).padStart(2, "0")}시`;

    // 오늘 날짜 기준 회의 개수
    const todayISO = now.toISOString().split("T")[0]; // YYYY-MM-DD
    const count = meetings.filter((m) => m.date === todayISO).length + 1;

    // 1) 내용이 없으면 날짜+시간 기반 제목
    if (!transcribedContent.trim()) {
      return `${dateStr} ${timeStr} 회의(${count})`;
    }

    // 2) AI 분석 결과에서 제목 추출
    if (aiAnalysis?.title) {
      return `${dateStr} ${timeStr} ${aiAnalysis.title}(${count})`;
    }

    // 3) 회의 내용에서 주제 추출 (키워드 + 빈도 분석)
    const extractTopicFromTranscript = (content: string): string => {
      if (!content.trim()) return '';
      // 주제 관련 키워드 패턴으로 직접 추출
      const topicPatterns = [
        /(?:에 대한|관련|주제는|안건은|목적은)\s*["""]?([^"""\n,.]{5,30}?)["""]?(?:\s|입니다|이다|회의|논의|에|를|을)/,
        /([가-힣\s]{3,20})\s*(?:프로젝트|기획|개발|검토|회의|논의|미팅)/,
        /(?:오늘|이번)\s*(?:회의|논의|미팅)(?:는|의)\s*["""]?([^"""\n,.]{3,30})/,
      ];
      for (const pattern of topicPatterns) {
        const match = content.match(pattern);
        if (match && match[1]) {
          const topic = match[1].trim();
          if (topic.length >= 3 && !['회의', '오늘', '이번', '우리', '저희'].includes(topic)) {
            return topic;
          }
        }
      }
      // 명사 빈도 분석 (가장 많이 언급된 주제)
      const meaningfulWords = content
        .replace(/[^\w\s가-힣]/g, ' ')
        .split(/\s+/)
        .filter(word =>
          word.length >= 2 &&
          word.length <= 15 &&
          !/^[0-9]+$/.test(word) &&
          !['회의', '오늘', '그리고', '저희', '우리', '있습니다', '입니다', '합니다'].includes(word)
        )
        .slice(0, 200);
      const wordCount: Record<string, number> = {};
      meaningfulWords.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
      });
      const commonWords = Object.entries(wordCount)
        .filter(([word, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1]);
      if (commonWords.length > 0) {
        return commonWords[0][0];
      }
      return '';
    };
    const topic = extractTopicFromTranscript(transcribedContent);
    if (topic) {
      return `${dateStr} ${timeStr} ${topic} 회의(${count})`;
    }
    // 4) 내용의 첫 줄을 제목으로 사용 (단, 안내 문구는 제외)
    const firstLine = transcribedContent.split("\n")[0].trim();
    if (
      firstLine &&
      !firstLine.includes("실시간 전사를 시작합니다") &&
      !firstLine.includes("회의 시작")
    ) {
      const summary =
        firstLine.substring(0, 50) + (firstLine.length > 50 ? "..." : "");
      return `${dateStr} ${timeStr} ${summary} 회의(${count})`;
    }
    // 5) 기본 제목
    return `${dateStr} ${timeStr} 회의(${count})`;
  };

  const generateDefaultPurpose = () => {
    // AI 분석 결과에서 목적 추출
    if (aiAnalysis?.purpose) {
      return aiAnalysis.purpose;
    }
    // 요약의 일부를 목적으로 사용
    if (aiAnalysis?.summary) {
      const summaryFirstLine = aiAnalysis.summary.split("\n")[0].trim();
      return summaryFirstLine.substring(0, 100);
    }
    // 회의 내용 첫 10문장 요약 (타임스탬프/화자 정보 제거)
    if (!transcribedContent.trim()) return '';

    // 1. 타임스탬프와 화자 정보 제거
    const cleanText = transcribedContent
      .split('\n')
      .map(line => {
        // [시간] Speaker X 형식 제거
        return line.replace(/^\[.*?\]\s*Speaker\s*\d+\s*/g, '').trim();
      })
      .filter(line => line.length > 0)
      .join(' ');

    // 2. 문장 단위로 분리 및 필터링
    const sentences = cleanText
      .split(/[.!?]\s+/)
      .map(s => s.trim())
      .filter(s =>
        s.length > 10 &&
        !s.includes("실시간 전사") &&
        !s.includes("회의 시작")
      )
      .slice(0, 10); // 첫 10문장
    if (sentences.length === 0) return '';
    // 문장들을 합쳐서 요약 생성 (최대 200자)
    const summary = sentences.join('. ');
    return summary.substring(0, 200) + (summary.length > 200 ? '...' : '');
  };

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-border w-[1100px] max-w-[1100px] mx-auto">
      <div className="mb-6">
        <h2 className="text-foreground mb-2">회의 정보 입력</h2>
        <p className="text-sm text-muted-foreground">
          회의 전사가 완료되었습니다. 회의 정보를 확인하고 수정해주세요.
        </p>
      </div>
      <MeetingInfoInput
        initialInfo={{
          title: generateDefaultTitle(),
          date: new Date().toISOString().split("T")[0],
          purpose: generateDefaultPurpose(),
          participants: aiAnalysis?.participants?.join(", ") || "",
        }}
        meetings={meetings}
        onComplete={handleInfoComplete}
      />
    </div>
  );
}