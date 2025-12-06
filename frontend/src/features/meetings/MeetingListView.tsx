import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Calendar, CheckCircle2, Circle, Eye, Search, Filter, Trash2 } from 'lucide-react';
import { MeetingDetail } from '@/features/meetings/MeetingDetail';
import { ScrollToTop } from '@/features/utils/ScrollToTop';
import type { Meeting } from '@/features/dashboard/Dashboard';


interface MeetingListViewProps {
  meetings: Meeting[];
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting: (id: string) => Promise<void> | void;
  onRefreshMeetings?: () => Promise<void> | void;
}

export function MeetingListView({ meetings, onUpdateMeeting, onDeleteMeeting, onRefreshMeetings }: MeetingListViewProps) {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'progress'>('date');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;

    if (confirm(`${selectedIds.length}개의 회의록을 삭제하시겠습니까?`)) {
      // 순차적으로 삭제 처리
      for (const id of selectedIds) {
        await onDeleteMeeting(id);
      }
      setSelectedIds([]);
      setIsSelectionMode(false);
      // 서버/상태 싱크를 위해 재조회 옵션 호출
      if (onRefreshMeetings) await onRefreshMeetings();
    }
  };

  const handleDeleteAll = async () => {
    if (meetings.length === 0) return;

    // 순차적으로 모든 회의록 삭제
    for (const meeting of meetings) {
      await onDeleteMeeting(meeting.id);
    }
    setShowDeleteAllConfirm(false);
    if (onRefreshMeetings) await onRefreshMeetings();
  };

  const filteredAndSortedMeetings = useMemo(() => {
    let filtered = meetings;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(meeting =>
        meeting.title.toLowerCase().includes(query) ||
        meeting.content.toLowerCase().includes(query) ||
        meeting.summary.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(meeting => {
        if (meeting.actionItems.length === 0) return filterStatus === 'completed';
        const allCompleted = meeting.actionItems.every(item => item.completed);
        return filterStatus === 'completed' ? allCompleted : !allCompleted;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      } else if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      } else {
        const progressA = a.actionItems.length === 0 ? 100 :
          (a.actionItems.filter(i => i.completed).length / a.actionItems.length) * 100;
        const progressB = b.actionItems.length === 0 ? 100 :
          (b.actionItems.filter(i => i.completed).length / b.actionItems.length) * 100;
        return progressB - progressA;
      }
    });

    return filtered;
  }, [meetings, searchQuery, filterStatus, sortBy]);

  const calculateProgress = (meeting: Meeting) => {
    if (meeting.actionItems.length === 0) return 100;
    const completed = meeting.actionItems.filter(item => item.completed).length;
    return Math.round((completed / meeting.actionItems.length) * 100);
  };



  // If a meeting is selected, show detail view
  if (selectedMeeting) {
    return (
      <MeetingDetail
        meeting={selectedMeeting}
        onUpdateMeeting={(updated) => {
          setSelectedMeeting(updated);
          onUpdateMeeting(updated);
        }}
        onDeleteMeeting={onDeleteMeeting}
        onClose={() => setSelectedMeeting(null)}
      />
    );
  }


  return (
    <div className={`space-y-5`}>
      {/* Search and Filter Section */}
      <div className="w-full relative">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 items-center">
              <div className="md:col-span-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="회의록 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="상태 필터" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">전체</SelectItem>
                    <SelectItem value="pending">진행 중</SelectItem>
                    <SelectItem value="completed">완료</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="정렬" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">날짜순</SelectItem>
                    <SelectItem value="title">제목순</SelectItem>
                    <SelectItem value="progress">진행률순</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {searchQuery && (
              <div className="mt-4 text-sm text-gray-600">
                검색 결과: {filteredAndSortedMeetings.length}개
              </div>
            )}
          </CardContent>
        </Card>

        {/* 삭제 기능 버튼 */}
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <div className="flex items-center gap-2">
            {isSelectionMode && (
              <>
                <Checkbox
                  checked={selectedIds.length === filteredAndSortedMeetings.length && filteredAndSortedMeetings.length > 0}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedIds(filteredAndSortedMeetings.map(m => m.id));
                    } else {
                      setSelectedIds([]);
                    }
                  }}
                />
                <span className="text-sm text-gray-600">
                  {selectedIds.length > 0 ? `${selectedIds.length}개 선택됨` : '전체 선택'}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isSelectionMode ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setIsSelectionMode(false);
                    setSelectedIds([]);
                  }}
                >
                  취소
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                  disabled={selectedIds.length === 0}
                  className="gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  선택 삭제 ({selectedIds.length})
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSelectionMode(true)}
                  className="gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  선택 삭제
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteAllConfirm(true)}
                  className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="w-4 h-4" />
                  전체 삭제
                </Button>
              </>
            )}
          </div>
        </div>

      </div>

      {/* Meetings Grid */}
      {filteredAndSortedMeetings.length === 0 ? (
        <div className="w-full">
          <div className="w-full h-[500px] flex items-center justify-center">
            <Card className="w-full h-full">
              <CardContent className="flex flex-col items-center justify-center h-full">
                <Circle className="w-24 h-24 text-gray-300 mb-4" />
                <h3 className="text-lg font-medium text-gray-700">아직 작성된 회의록이 없습니다</h3>
                <p className="text-sm text-gray-500 mt-2">새 회의록을 작성해보세요</p>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAndSortedMeetings.map((meeting) => {
            const progress = calculateProgress(meeting);
            const completedCount = meeting.actionItems.filter(item => item.completed).length;

            return (
              <Card key={meeting.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent
                  className="pt-6"
                  onClick={() => {
                    // 선택 모드일 때는 카드 클릭 시 체크박스 토글
                    if (isSelectionMode) {
                      if (selectedIds.includes(meeting.id)) {
                        setSelectedIds(selectedIds.filter(id => id !== meeting.id));
                      } else {
                        setSelectedIds([...selectedIds, meeting.id]);
                      }
                    } else {
                      // 일반 모드일 때는 상세 보기
                      setSelectedMeeting(meeting);
                    }
                  }}
                >
                  <div className="space-y-4">
                    {/* Header: title + checkbox */}
                    <div className="flex items-start gap-3">
                      {/* 선택 모드일 때 체크박스 표시 */}
                      {isSelectionMode && (
                        <Checkbox
                          checked={selectedIds.includes(meeting.id)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedIds([...selectedIds, meeting.id]);
                            } else {
                              setSelectedIds(selectedIds.filter(id => id !== meeting.id));
                            }
                          }}
                          className="mt-1"
                          onClick={(e) => e.stopPropagation()} // 카드 클릭 이벤트 전파 방지
                        />
                      )}

                      <div className="flex-1">
                        <h3 className="mb-2 line-clamp-1">{meeting.title}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Calendar className="w-3 h-3" />
                          <span>{meeting.date}</span>
                        </div>
                      </div>

                      {/* ❌ 개별 삭제 버튼 제거됨 */}
                    </div>

                    {/* Participants (show only if exists) */}
                    {meeting.participants && meeting.participants.length > 0 ? (
                      <p className="text-sm text-gray-600 line-clamp-2">
                        참여자: {meeting.participants.join(', ')}
                      </p>
                    ) : (
                      <div className="h-3" />
                    )}

                    {/* Action Items Summary */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Circle className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-600">
                          액션: {completedCount}/{meeting.actionItems.length}
                        </span>
                      </div>
                      <Badge
                        variant="secondary"
                        className={
                          progress === 100
                            ? 'bg-green-100 text-green-700'
                            : progress > 50
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-orange-100 text-orange-700'
                        }
                      >
                        {progress}%
                      </Badge>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    {/* View Button */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => setSelectedMeeting(meeting)}
                    >
                      <Eye className="w-4 h-4" />
                      상세 보기
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={showDeleteAllConfirm} onOpenChange={setShowDeleteAllConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>전체 삭제 확인</DialogTitle>
            <DialogDescription>
              모든 회의록({meetings.length}개)을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setShowDeleteAllConfirm(false)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAll}
            >
              전체 삭제
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ScrollToTop />
    </div>
  );
}