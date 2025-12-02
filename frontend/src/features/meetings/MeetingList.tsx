import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import { Input } from '@/shared/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Calendar, CheckCircle2, Circle, Trash2, Eye, User, Clock, Search, Download, FileText, Filter, Brain } from 'lucide-react';
import { exportToPDF } from '@/utils/exportPDF';
import { exportToWord } from '@/utils/exportWord';
import { MeetingAnalysis } from '@/features/realtime/MeetingAnalysis';
import type { Meeting, ActionItem } from '@/features/dashboard/Dashboard';

interface MeetingListProps {
  meetings: Meeting[];
  onUpdateMeeting: (meeting: Meeting) => void;
  onDeleteMeeting: (id: string) => void;
}

export function MeetingList({ meetings, onUpdateMeeting, onDeleteMeeting }: MeetingListProps) {
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'completed' | 'pending'>('all');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'progress'>('date');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);

  const handleBulkDelete = () => {
    if (selectedIds.length === 0) return;

    if (confirm(`${selectedIds.length}개의 회의록을 삭제하시겠습니까?`)) {
      selectedIds.forEach(id => onDeleteMeeting(id));
      setSelectedIds([]);
      setIsSelectionMode(false);
    }
  };
  const handleDeleteAll = () => {
    if (meetings.length === 0) return;

    meetings.forEach(meeting => onDeleteMeeting(meeting.id));
    setShowDeleteAllConfirm(false);
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

  const handleViewDetails = (meeting: Meeting) => {
    setSelectedMeeting(meeting);
    setIsDialogOpen(true);
  };

  const handleToggleActionItem = (actionItemId: string) => {
    if (!selectedMeeting) return;

    const updatedActionItems = selectedMeeting.actionItems.map(item =>
      item.id === actionItemId ? { ...item, completed: !item.completed } : item
    );

    const updatedMeeting = { ...selectedMeeting, actionItems: updatedActionItems };
    setSelectedMeeting(updatedMeeting);
    onUpdateMeeting(updatedMeeting);
  };

  const handleUpdateActionItem = (actionItemId: string, field: keyof ActionItem, value: string) => {
    if (!selectedMeeting) return;

    const updatedActionItems = selectedMeeting.actionItems.map(item =>
      item.id === actionItemId ? { ...item, [field]: value } : item
    );

    const updatedMeeting = { ...selectedMeeting, actionItems: updatedActionItems };
    setSelectedMeeting(updatedMeeting);
    onUpdateMeeting(updatedMeeting);
  };

  const calculateProgress = (meeting: Meeting) => {
    if (meeting.actionItems.length === 0) return 100;
    const completed = meeting.actionItems.filter(item => item.completed).length;
    return Math.round((completed / meeting.actionItems.length) * 100);
  };

  const handleExportPDF = () => {
    if (selectedMeeting) {
      exportToPDF(selectedMeeting);
    }
  };

  const handleExportWord = () => {
    if (selectedMeeting) {
      exportToWord(selectedMeeting);
    }
  };

  if (meetings.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <Circle className="w-16 h-16 text-gray-300 mb-4" />
          <p className="text-gray-500">아직 작성된 회의록이 없습니다</p>
          <p className="text-gray-400 text-sm mt-2">새 회의록을 작성해보세요</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Search and Filter Section */}
        <Card className="w-full max-w-[1600px] mx-auto">
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="md:col-span-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="회의록 검색..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 w-full"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
                  <SelectTrigger>
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
                  <SelectTrigger>
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

        {/* Meetings Grid */}
        {filteredAndSortedMeetings.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Search className="w-16 h-16 text-gray-300 mb-4" />
              <p className="text-gray-500">검색 결과가 없습니다</p>
            </CardContent>
          </Card>
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
                          <h3 className="mb-2 line-clamp-2">{meeting.title}</h3>
                          <div className="flex items-center gap-2 text-sm text-gray-600">
                            <Calendar className="w-3 h-3" />
                            <span>{meeting.date}</span>
                          </div>
                        </div>

                        {/* ❌ 개별 삭제 버튼 제거됨 */}
                      </div>
                    </div>

                    {/* ... 나머지 내용 (참여자, 액션 아이템 등) ... */}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-gray-600">액션 아이템 진행률</span>
                        <span className="text-gray-900">
                          {completedCount}/{meeting.actionItems.length}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    <Button
                      onClick={() => handleViewDetails(meeting)}
                      className="w-full gap-2"
                      variant="outline"
                    >
                      <Eye className="w-4 h-4" />
                      상세 보기
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>


      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
          {selectedMeeting && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <DialogTitle>{selectedMeeting.title}</DialogTitle>
                    <DialogDescription className="flex items-center gap-2 mt-1">
                      <Calendar className="w-4 h-4" />
                      {selectedMeeting.date}
                    </DialogDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportPDF}
                      className="gap-2"
                    >
                      <Download className="w-4 h-4" />
                      PDF
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportWord}
                      className="gap-2"
                    >
                      <FileText className="w-4 h-4" />
                      Word
                    </Button>
                  </div>
                </div>
              </DialogHeader>

              <Tabs defaultValue="basic" className="mt-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="basic" className="gap-2">
                    <FileText className="w-4 h-4" />
                    기본 정보
                  </TabsTrigger>
                  <TabsTrigger value="analysis" className="gap-2">
                    <Brain className="w-4 h-4" />
                    심층 분석
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="basic" className="space-y-6 mt-4">
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-blue-600">
                      요약
                    </h3>
                    <Card>
                      <CardContent className="pt-6">
                        <p className="whitespace-pre-wrap text-gray-700">{selectedMeeting.summary}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-purple-600">
                      전체 회의 내용
                    </h3>
                    <Card>
                      <CardContent className="pt-6">
                        <p className="whitespace-pre-wrap text-gray-700">{selectedMeeting.content}</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div>
                    <h3 className="mb-3 flex items-center gap-2 text-green-600">
                      액션 아이템 ({selectedMeeting.actionItems.length})
                    </h3>

                    {selectedMeeting.actionItems.length === 0 ? (
                      <Card>
                        <CardContent className="py-8 text-center text-gray-500">
                          추출된 액션 아이템이 없습니다
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-3">
                        {selectedMeeting.actionItems.map((item) => (
                          <Card key={item.id} className={item.completed ? 'bg-gray-50' : ''}>
                            <CardContent className="pt-6">
                              <div className="space-y-3">
                                <div className="flex items-start gap-3">
                                  <Checkbox
                                    checked={item.completed}
                                    onCheckedChange={() => handleToggleActionItem(item.id)}
                                    className="mt-1"
                                  />
                                  <div className="flex-1">
                                    <p className={`${item.completed ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                                      {item.text}
                                    </p>
                                  </div>
                                  {item.completed && (
                                    <Badge variant="secondary" className="bg-green-100 text-green-700">
                                      <CheckCircle2 className="w-3 h-3 mr-1" />
                                      완료
                                    </Badge>
                                  )}
                                </div>

                                <div className="grid grid-cols-2 gap-3 ml-8">
                                  <div className="space-y-1">
                                    <label className="text-xs text-gray-500 flex items-center gap-1">
                                      <User className="w-3 h-3" />
                                      담당자
                                    </label>
                                    <Input
                                      value={item.assignee}
                                      onChange={(e) => handleUpdateActionItem(item.id, 'assignee', e.target.value)}
                                      placeholder="담당자 이름"
                                      className="h-8"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-xs text-gray-500 flex items-center gap-1">
                                      <Clock className="w-3 h-3" />
                                      마감일
                                    </label>
                                    <Input
                                      type="date"
                                      value={item.dueDate}
                                      onChange={(e) => handleUpdateActionItem(item.id, 'dueDate', e.target.value)}
                                      className="h-8"
                                    />
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="analysis" className="mt-4">
                  <MeetingAnalysis meeting={selectedMeeting} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </DialogContent>
      </Dialog>
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
    </>
  );
}