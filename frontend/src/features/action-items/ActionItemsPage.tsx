import React, { useState, useMemo } from 'react';
import { Card, CardContent } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import {
  CheckCircle2,
  Circle,
  User,
  Clock,
  Calendar,
  AlertCircle
} from 'lucide-react';
import { Avatar } from '@/shared/ui/avatar';

import type { Meeting, ActionItem } from '../dashboard/Dashboard';

interface ActionItemsPageProps {
  meetings: Meeting[];
  onUpdateMeeting: (meeting: Meeting) => void;
}

export function ActionItemsPage({ meetings: meetingsProp, onUpdateMeeting }: ActionItemsPageProps) {
  // 로컬 상태로 meetings 관리하여 즉시 업데이트 반영
  const [meetings, setMeetings] = useState(meetingsProp);

  // meetings prop이 변경되면 로컬 상태도 업데이트
  React.useEffect(() => {
    console.log('[ActionItemsPage] Meetings prop updated:', meetingsProp);
    setMeetings(meetingsProp);
  }, [meetingsProp]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | 'all'>('all');

  // 회의별로 그룹화된 액션아이템 생성
  const groupedItems = useMemo(() => {
    return meetings
      .map(meeting => ({
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        actionItems: meeting.actionItems
          .filter(item => {
            // 검색 필터
            if (searchQuery) {
              const q = searchQuery.toLowerCase();
              if (
                !item.text.toLowerCase().includes(q) &&
                !item.assignee.toLowerCase().includes(q)
              ) return false;
            }
            // 상태 필터
            if (filterStatus !== 'all') {
              const isCompleted = filterStatus === 'completed';
              if (item.completed !== isCompleted) return false;
            }
            return true;
          })
          .sort((a, b) => {
            if (!a.dueDate && !b.dueDate) return 0;
            if (!a.dueDate) return 1;
            if (!b.dueDate) return -1;
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          }),
      }))
      // ✅ 액션아이템이 하나도 없는 회의는 제외
      .filter(group => group.actionItems.length > 0);
  }, [meetings, searchQuery, filterStatus]);

  const displayedGroups = selectedMeetingId === 'all'
    ? groupedItems
    : groupedItems.filter(g => g.id === selectedMeetingId);

  const handleToggleActionItem = async (meetingId: string, itemId: string) => {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting) return;

    const item = meeting.actionItems.find(ai => ai.id === itemId);
    if (!item) return;

    const newCompleted = !item.completed;

    // 로컬 상태 즉시 업데이트
    const updatedActionItems = meeting.actionItems.map(ai =>
      ai.id === itemId ? { ...ai, completed: newCompleted } : ai
    );
    const updatedMeeting = { ...meeting, actionItems: updatedActionItems };

    // 로컬 meetings 배열 업데이트
    setMeetings(meetings.map(m => m.id === meetingId ? updatedMeeting : m));
    console.log('[ActionItemsPage] Local meetings state updated');

    // 부모에게 전파
    onUpdateMeeting(updatedMeeting);

    // 백엔드 동기화
    try {
      const newStatus = newCompleted ? 'DONE' : 'TODO';
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/reports/${meetingId}/action-items/${itemId}`, {
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

  const handleUpdateActionItem = async (meetingId: string, itemId: string, field: keyof ActionItem, value: string) => {
    const meeting = meetings.find(m => m.id === meetingId);
    if (!meeting) return;

    // 로컬 상태 즉시 업데이트
    const updatedActionItems = meeting.actionItems.map(ai =>
      ai.id === itemId ? { ...ai, [field]: value } : ai
    );
    const updatedMeeting = { ...meeting, actionItems: updatedActionItems };

    // 로컬 meetings 배열 업데이트
    setMeetings(meetings.map(m => m.id === meetingId ? updatedMeeting : m));
    console.log('[ActionItemsPage] Local meetings state updated (handleUpdateActionItem)');

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

      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/reports/${meetingId}/action-items/${itemId}`, {
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

  const isOverdue = (item: ActionItem) => {
    if (item.completed || !item.dueDate) return false;
    return new Date(item.dueDate) < new Date();
  };

  return (
    <div className="space-y-5">
      {/* 검색 & 필터 */}
      <Card className="rounded-2xl border-border shadow-sm">
        <CardContent className="pt-6 grid md:grid-cols-3 gap-4">
          <div className="relative md:col-span-1">
            <Input
              placeholder="액션 아이템 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-3"
            />
          </div>
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="w-full h-10 border border-border rounded-lg px-3 bg-white"
            >
              <option value="all">전체</option>
              <option value="pending">진행 중</option>
              <option value="completed">완료</option>
            </select>
          </div>
          <div>
            <select
              value={selectedMeetingId}
              onChange={(e) => setSelectedMeetingId(e.target.value)}
              className="w-full h-10 border border-border rounded-lg px-3 bg-white"
            >
              <option value="all">전체 회의</option>
              {meetings.map(m => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* 회의별 액션아이템 렌더링 */}
      {displayedGroups.length === 0 ? (
        <Card className="rounded-2xl border-border shadow-sm">
          <CardContent className="py-16 text-center text-muted-foreground">
            액션 아이템이 없습니다
          </CardContent>
        </Card>
      ) : (
        displayedGroups.map(group => (
          <div key={group.id} className="space-y-3">
            <h3 className="flex items-center gap-2 mt-6 text-foreground">
              <Calendar className="w-4 h-4 text-primary" />
              {group.title} <span className="text-muted-foreground text-sm">({group.date})</span>
            </h3>

            {group.actionItems.length === 0 ? (
              <Card className="rounded-2xl border-border shadow-sm">
                <CardContent className="py-8 text-center text-muted-foreground text-sm">
                  액션 아이템 없음
                </CardContent>
              </Card>
            ) : (
              group.actionItems.map(item => (
                <Card
                  key={`${group.id}-${item.id}`}
                  className={`rounded-2xl border-border shadow-sm ${item.completed ? 'bg-muted/50' : ''} ${isOverdue(item) ? 'border-red-300' : ''}`}
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={item.completed}
                        onCheckedChange={() => handleToggleActionItem(group.id, item.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-2">
                        <p className={`${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {item.text}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <User className="w-3 h-3" /> {item.assignee || '담당자 없음'}
                          {item.dueDate && (
                            <>
                              <span className="text-border">•</span>
                              <Clock className="w-3 h-3" /> {item.dueDate}
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {item.completed && (
                          <Badge variant="secondary" className="bg-green-100 text-green-700">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            완료
                          </Badge>
                        )}
                        {isOverdue(item) && (
                          <Badge variant="secondary" className="bg-red-100 text-red-700">
                            <AlertCircle className="w-3 h-3 mr-1" />
                            마감 초과
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* 담당자 / 마감일 */}
                    <div className="grid grid-cols-2 gap-3 ml-8 mt-2 items-center">
                      <div className="flex items-center gap-2">
                        <Avatar
                          name={item.assignee}
                          src={item.assigneeAvatar}
                          size={32}
                        />
                        <Input
                          key={`assignee-${group.id}-${item.id}`}
                          defaultValue={item.assignee}
                          onBlur={(e) => {
                            if (e.target.value !== item.assignee) {
                              handleUpdateActionItem(group.id, item.id, 'assignee', e.target.value);
                            }
                          }}
                          placeholder="담당자 이름"
                          className="h-9 flex-1"
                        />
                      </div>
                      <Input
                        key={`duedate-${group.id}-${item.id}`}
                        type="date"
                        defaultValue={item.dueDate}
                        onChange={(e) => handleUpdateActionItem(group.id, item.id, 'dueDate', e.target.value)}
                        className="h-9"
                      />
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}

