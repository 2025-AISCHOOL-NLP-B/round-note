import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Download, FileBarChart, Calendar, Users, Target, CheckCircle2, Clock, TrendingUp, ExternalLink, ListChecks } from 'lucide-react';
import type { Meeting } from '@/features/dashboard/Dashboard';
import { toast } from 'sonner';

interface MeetingReportProps {
  meeting: Meeting;
  showExports?: boolean;
}

export function MeetingReport({ meeting, showExports = true }: MeetingReportProps) {
  const generateReportData = () => {
    const totalItems = meeting.actionItems.length;
    const completedItems = meeting.actionItems.filter(a => a.completed).length;
    const pendingItems = totalItems - completedItems;
    const completionRate = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;

    // Extract participants
    const participants = new Set<string>();
    meeting.actionItems.forEach(item => {
      if (item.assignee && item.assignee !== '미정') {
        participants.add(item.assignee);
      }
    });

    // Calculate items per person
    const itemsPerPerson = Array.from(participants).map(person => {
      const personItems = meeting.actionItems.filter(item => item.assignee === person);
      const completed = personItems.filter(item => item.completed).length;
      return {
        name: person,
        total: personItems.length,
        completed,
        pending: personItems.length - completed,
        completionRate: Math.round((completed / personItems.length) * 100),
      };
    });

    // Items with due dates
    const itemsWithDueDate = meeting.actionItems.filter(item => item.dueDate);
    const overdueTasks = itemsWithDueDate.filter(item => {
      if (!item.completed && item.dueDate) {
        return new Date(item.dueDate) < new Date();
      }
      return false;
    });

    return {
      totalItems,
      completedItems,
      pendingItems,
      completionRate,
      participants: Array.from(participants),
      itemsPerPerson,
      overdueTasks: overdueTasks.length,
      totalWithDueDate: itemsWithDueDate.length,
    };
  };

  const reportData = generateReportData();

  const handleDownloadReport = () => {
    const reportContent = `
==============================================
회의록 리포트
==============================================

회의 정보
--------------
제목: ${meeting.title}
날짜: ${meeting.date}
작성일: ${new Date(meeting.createdAt).toLocaleDateString('ko-KR')}

회의 요약
--------------
${meeting.summary}

핵심 지표
--------------
• 총 액션 아이템: ${reportData.totalItems}개
• 완료된 항목: ${reportData.completedItems}개
• 진행 중 항목: ${reportData.pendingItems}개
• 완료율: ${reportData.completionRate}%
• 참여자 수: ${reportData.participants.length}명
• 마감 지연 항목: ${reportData.overdueTasks}개

참여자별 현황
--------------
${reportData.itemsPerPerson.map(person => 
  `${person.name}: ${person.total}개 (완료 ${person.completed}, 진행 ${person.pending}, 완료율 ${person.completionRate}%)`
).join('\n')}

액션 아이템 상세
--------------
${meeting.actionItems.map((item, index) => `
${index + 1}. [${item.completed ? '완료' : '진행중'}] ${item.text}
   담당자: ${item.assignee}
   마감일: ${item.dueDate || '미정'}
`).join('\n')}

전체 회의 내용
--------------
${meeting.content}

==============================================
생성일시: ${new Date().toLocaleString('ko-KR')}
==============================================
    `;

    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `회의리포트_${meeting.title}_${meeting.date}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileBarChart className="w-6 h-6 text-blue-600" />
          <h3 className="text-blue-600">회의 리포트</h3>
        </div>
        {showExports && (
          <div className="flex gap-2">
            <Button onClick={handleDownloadReport} className="gap-2">
              <Download className="w-4 h-4" />
              리포트 다운로드
            </Button>
            <Button
              onClick={async () => {
                try {
                  const { exportMeetingToNotion } = await import('@/features/meetings/integrations');
                  await exportMeetingToNotion(meeting);
                } catch (e) {
                  console.error(e);
                  toast.error('Notion 연동 중 오류가 발생했습니다.');
                }
              }}
              variant="outline"
              className="gap-2"
            >
              <ExternalLink className="w-4 h-4" />
              Notion으로 전송
            </Button>
          </div>
        )}
      </div>

      {/* Executive Summary */}
      <Card>
        <CardHeader>
          <CardTitle>요약</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-blue-50 rounded-lg">
              <Target className="w-8 h-8 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl">{reportData.totalItems}</p>
              <p className="text-sm text-gray-600">총 액션 아이템</p>
            </div>
            <div className="text-center p-4 bg-green-50 rounded-lg">
              <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
              <p className="text-2xl">{reportData.completedItems}</p>
              <p className="text-sm text-gray-600">완료</p>
            </div>
            <div className="text-center p-4 bg-orange-50 rounded-lg">
              <Clock className="w-8 h-8 text-orange-600 mx-auto mb-2" />
              <p className="text-2xl">{reportData.pendingItems}</p>
              <p className="text-sm text-gray-600">진행 중</p>
            </div>
            <div className="text-center p-4 bg-purple-50 rounded-lg">
              <TrendingUp className="w-8 h-8 text-purple-600 mx-auto mb-2" />
              <p className="text-2xl">{reportData.completionRate}%</p>
              <p className="text-sm text-gray-600">완료율</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Meeting Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            회의 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">회의 제목</span>
            <span>{meeting.title}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">회의 날짜</span>
            <span>{meeting.date}</span>
          </div>
          <div className="flex justify-between py-2 border-b">
            <span className="text-gray-600">작성일</span>
            <span>{new Date(meeting.createdAt).toLocaleDateString('ko-KR')}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-gray-600">최종 수정일</span>
            <span>{new Date(meeting.updatedAt).toLocaleDateString('ko-KR')}</span>
          </div>
        </CardContent>
      </Card>

      {/* Meeting Summary (회의요약) */}
      <Card>
        <CardHeader>
          <CardTitle>회의 요약</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-gray-700">{meeting.summary}</p>
        </CardContent>
      </Card>

      {/* Action Items List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="w-5 h-5" />
            액션 아이템 리스트
          </CardTitle>
        </CardHeader>
        <CardContent>
          {meeting.actionItems.length === 0 ? (
            <p className="text-gray-500 text-center py-8">액션 아이템이 없습니다</p>
          ) : (
            <div className="space-y-3">
              {meeting.actionItems.map((item, idx) => (
                <div key={item.id || idx} className="p-3 border rounded-lg">
                  <div className="flex justify-between items-start">
                    <div className="text-sm text-gray-900">{item.text}</div>
                    <div className="text-xs text-gray-500 text-right">
                      <div>{item.assignee || '미정'}</div>
                      <div>{item.dueDate || '마감일 미정'}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Meeting Content (회의 원문) */}
      <Card>
        <CardHeader>
          <CardTitle>회의 원문</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 rounded-lg p-4 max-h-[500px] overflow-y-auto">
            <p className="whitespace-pre-wrap text-gray-700">{meeting.content}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
