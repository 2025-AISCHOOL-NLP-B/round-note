import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Calendar, CheckCircle2, Circle, Eye, Search, Filter, Trash2 } from 'lucide-react';
import { MeetingDetail } from '@/features/meetings/MeetingDetail';
import { ScrollToTop } from '@/features/utils/ScrollToTop';
import type { Meeting } from '@/features/dashboard/Dashboard';


interface MeetingListViewProps {
  meetings: Meeting[];
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting: (id: string) => void;
}

export function MeetingListView({ meetings, onUpdateMeeting, onDeleteMeeting }: MeetingListViewProps) {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'progress'>('date');

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
      <div className="mx-auto w-[1000px] relative">
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

      </div>

      {/* Meetings Grid */}
      {filteredAndSortedMeetings.length === 0 ? (
        <div className="w-full">
          <div className="mx-auto w-[1000px] h-[500px] flex items-center justify-center">
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
                <CardContent className="pt-6" onClick={() => setSelectedMeeting(meeting)}>
                  <div className="space-y-4">
                    {/* Header: title + delete */}
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="mb-2 line-clamp-2">{meeting.title}</h3>
                        <div className="flex items-center gap-2 text-sm text-gray-600">
                          <Calendar className="w-3 h-3" />
                          <span>{meeting.date}</span>
                        </div>
                      </div>
                      <div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); onDeleteMeeting(meeting.id); }}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
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
      <ScrollToTop />
    </div>
  );
}