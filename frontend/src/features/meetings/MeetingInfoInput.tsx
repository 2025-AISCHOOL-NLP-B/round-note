import { useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';
import { Card } from '@/shared/ui/card';
import { Calendar, Save, Target, Users, Sparkles } from 'lucide-react';
import type { Meeting } from '@/features/dashboard/Dashboard';

interface MeetingInfoInputProps {
  initialInfo: { title: string; date: string; purpose?: string; participants?: string };
  meetings: Meeting[];
  onComplete: (info: { title: string; date: string; purpose: string; participants: string[] }) => void | Promise<void>;
}

export function MeetingInfoInput({ initialInfo, meetings, onComplete }: MeetingInfoInputProps) {
  const [title, setTitle] = useState(initialInfo.title);
  const [date, setDate] = useState(initialInfo.date);
  const [purpose, setPurpose] = useState(initialInfo.purpose || '');
  const [participants, setParticipants] = useState(initialInfo.participants || '');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);

    let finalTitle = title.trim();

    // 제목이 없으면 날짜 기반으로 자동 생성
    if (!finalTitle) {
      // 날짜가 있으면 그대로 제목으로 사용
      if (date) {
        finalTitle = `${date} 회의`;
      } else {
        // 날짜가 없으면 오늘 날짜를 기본값으로 사용
        const today = new Date();
        finalTitle = today.toISOString().split('T')[0] + ' 회의';
      }
    }

    // 참석자를 배열로 변환 (쉼표로 구분)
    const participantsList = participants
      .split(',')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    try {
      // 약간의 딜레이를 주어 로딩 UI가 보이도록 함 (선택)
      await new Promise(resolve => setTimeout(resolve, 150));

      await Promise.resolve(
        onComplete({
          title: finalTitle,
          date,
          purpose: purpose.trim(),
          participants: participantsList,
        })
      );
    } finally {
      // 부모 저장 완료까지 기다린 뒤 로딩 종료
      setIsProcessing(false);
    }
  };

  return (
    <>
      {/* 로딩 오버레이 */}
      {isProcessing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <Card className="p-8 bg-white shadow-2xl">
            <div className="flex flex-col items-center gap-4">
              <Sparkles className="w-12 h-12 text-primary animate-spin" />
              <div className="text-center">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">회의록 저장 중...</h3>
                <p className="text-sm text-slate-600">회의 정보를 최종 저장하고 있습니다.</p>
                <p className="text-xs text-slate-500 mt-2">잠시만 기다려주세요.</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">회의 제목</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 2025년 1분기 마케팅 전략 회의 (미입력 시 자동 생성)"
            disabled={isProcessing}
          />
          <p className="text-xs text-gray-500">
            * 입력하지 않으면 날짜 기반으로 자동 생성됩니다
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="purpose" className="flex items-center gap-2">
            <Target className="w-4 h-4" />
            회의 목적
          </Label>
          <Textarea
            id="purpose"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="예: 신규 서비스 런칭 전략 수립 및 일정 확정"
            className="min-h-[80px] resize-none"
            disabled={isProcessing}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="date" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            회의 날짜
          </Label>
          <Input
            id="date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={isProcessing}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="participants" className="flex items-center gap-2">
            <Users className="w-4 h-4" />
            회의 참석자
          </Label>
          <Input
            id="participants"
            value={participants}
            onChange={(e) => setParticipants(e.target.value)}
            placeholder="예: 김철수, 이영희, 박지민 (쉰표로 구분)"
            disabled={isProcessing}
          />
        </div>
      </div>

      <div className="bg-gradient-to-br from-primary/10 to-purple-100 border border-primary/20 rounded-xl p-4">
        <h4 className="text-sm mb-2 text-primary">💡 안내</h4>
        <p className="text-sm text-foreground/80">
          회의 정보를 확인하고 수정해주세요. 제목을 입력하지 않으면 날짜 기반으로 자동 생성됩니다.
        </p>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="lg" className="gap-2" disabled={isProcessing}>
          {isProcessing ? (
            <>
              <Sparkles className="w-4 h-4 animate-spin" />
              저장 중...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              저장
            </>
          )}
        </Button>
      </div>
    </form>
    </>
  );
}