import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { 
  Brain, 
  MessageSquare, 
  FileBarChart, 
  TrendingUp, 
  Users, 
  Target, 
  AlertTriangle,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  ExternalLink,
  Clock,
  User
} from 'lucide-react';
import { MeetingReport } from '@/features/meetings/MeetingReport';
import { toast } from 'sonner';
import type { Meeting, ActionItem } from '@/features/dashboard/Dashboard';

interface MeetingAnalysisProps {
  meeting: Meeting;
  onUpdateMeeting?: (meeting: Meeting) => void;
}

export function MeetingAnalysis({ meeting: meetingProp, onUpdateMeeting }: MeetingAnalysisProps) {
  const [meeting, setMeeting] = useState(meetingProp);
  const [activeTab, setActiveTab] = useState('actionitems');
  const [isAddingActionItem, setIsAddingActionItem] = useState(false);
  const [newActionItem, setNewActionItem] = useState({ text: '', assignee: '', jiraAssignee: '', dueDate: '', priority: '중간' });
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // meeting prop이 변경되면 로컬 상태 업데이트
  React.useEffect(() => {
    console.log('[MeetingAnalysis] Meeting prop updated:', meetingProp);
    setMeeting(meetingProp);
  }, [meetingProp]);
  
  // Jira 통합 상태
  const [jiraConnected, setJiraConnected] = useState(false);
  const [availableJiraProjects, setAvailableJiraProjects] = useState<Array<{ key: string; name: string }>>([]);
  const [selectedJiraProject, setSelectedJiraProject] = useState<string>('');
  const [jiraUsers, setJiraUsers] = useState<Array<{ account_id: string; display_name: string; email: string }>>([]);
  const [jiraPriorities, setJiraPriorities] = useState<Array<{ id: string; name: string }>>([]);
  const [loadingJiraData, setLoadingJiraData] = useState(false);
  
  // Jira 동기화 전 편집 모달 상태
  const [showJiraEditModal, setShowJiraEditModal] = useState(false);
  const [jiraEditItems, setJiraEditItems] = useState<Array<{
    item_id: string;
    title: string;
    description: string;
    assignee_name: string;
    original_assignee_name?: string;
    jira_assignee_id: string | null;
    priority: string;
    due_dt: string;
    isNew?: boolean;
  }>>([]);
  const [deletedJiraItems, setDeletedJiraItems] = useState<string[]>([]);
  const [itemsToSync, setItemsToSync] = useState<string[] | null>(null);

  // Jira 연동 상태 확인 및 프로젝트 목록 로드
  React.useEffect(() => {
    const checkJiraIntegration = async () => {
      try {
        const { getJiraSettings, getJiraProjects } = await import('@/features/meetings/reportsService');
        
        // Jira 연동 확인
        const settings = await getJiraSettings();
        if (settings && settings.is_active) {
          setJiraConnected(true);
          
          // 프로젝트 목록 가져오기
          const projectsData = await getJiraProjects();
          setAvailableJiraProjects(projectsData.projects || []);
        }
      } catch (error) {
        // Jira 연동 안 됨
        setJiraConnected(false);
      }
    };
    
    checkJiraIntegration();
  }, []);

  // 선택한 Jira 프로젝트가 변경되면 사용자와 우선순위 목록 로드
  React.useEffect(() => {
    const loadJiraProjectData = async () => {
      if (!selectedJiraProject) {
        setJiraUsers([]);
        setJiraPriorities([]);
        return;
      }
      
      setLoadingJiraData(true);
      try {
        const { getJiraProjectUsers, getJiraPriorities } = await import('@/features/meetings/reportsService');
        
        const [usersData, prioritiesData] = await Promise.all([
          getJiraProjectUsers(selectedJiraProject),
          getJiraPriorities(selectedJiraProject)
        ]);
        
        setJiraUsers(usersData.users || []);
        setJiraPriorities(prioritiesData.priorities || []);
      } catch (error: any) {
        toast.error(`Jira 데이터 로드 실패: ${error.message}`);
      } finally {
        setLoadingJiraData(false);
      }
    };
    
    loadJiraProjectData();
  }, [selectedJiraProject]);

  const handleAddActionItem = async () => {
    if (!newActionItem.text.trim()) {
      toast.error('액션 아이템 내용을 입력해주세요.');
      return;
    }

    try {
      const { createActionItem } = await import('@/features/meetings/reportsService');
      
      // 우선순위 매핑: 한글->영문 변환
      const priorityMap: Record<string, string> = {
        '높음': 'HIGH',
        '중간': 'MEDIUM',
        '낮음': 'LOW'
      };
      const priorityValue = priorityMap[newActionItem.priority] || 'MEDIUM';

      const newItem = await createActionItem(meeting.id, {
        title: newActionItem.text,
        description: '',
        due_dt: newActionItem.dueDate || undefined,
        priority: priorityValue,
        assignee_name: newActionItem.assignee || undefined,
        jira_assignee_id: undefined,
      });

      // 영문 -> 한글 매핑
      const priorityMapReverse: Record<string, '높음' | '중간' | '낮음'> = {
        'HIGH': '높음',
        'MEDIUM': '중간',
        'LOW': '낮음'
      };

      const actionItem: ActionItem = {
        id: newItem.item_id,
        text: newItem.title,
        assignee: newItem.assignee_name || '미지정',
        dueDate: newItem.due_dt ? new Date(newItem.due_dt).toISOString().split('T')[0] : newActionItem.dueDate,
        completed: newItem.status === 'DONE',
        priority: priorityMapReverse[newItem.priority] || '중간'
      };

      if (onUpdateMeeting) {
        onUpdateMeeting({
          ...meeting,
          actionItems: [...meeting.actionItems, actionItem]
        });
      }

      setNewActionItem({ text: '', assignee: '', jiraAssignee: '', dueDate: '', priority: '중간' });
      setIsAddingActionItem(false);
      toast.success('액션 아이템이 추가되었습니다.');
    } catch (error: any) {
      toast.error(`액션 아이템 추가 실패: ${error.message}`);
    }
  };

  const handleUpdateActionItem = async (id: string, field: keyof ActionItem, value: any) => {
    try {
      const { updateActionItem } = await import('@/features/meetings/reportsService');
      
      const updates: any = {};
      
      if (field === 'text') {
        updates.title = value;
      } else if (field === 'priority') {
        const priorityMap: Record<string, string> = {
          '높음': 'HIGH',
          '중간': 'MEDIUM',
          '낮음': 'LOW'
        };
        updates.priority = priorityMap[value] || 'MEDIUM';
      } else if (field === 'completed') {
        updates.status = value ? 'DONE' : 'TODO';
      } else if (field === 'dueDate') {
        updates.due_dt = value;
      } else if (field === 'assignee') {
        updates.assignee_name = value;
      }

      await updateActionItem(meeting.id, id, updates);

      // 로컬 상태 즉시 업데이트
      const updatedItems = meeting.actionItems.map(item =>
        item.id === id ? { ...item, [field]: value } : item
      );
      const updatedMeeting = {
        ...meeting,
        actionItems: updatedItems
      };
      
      setMeeting(updatedMeeting);
      console.log('[MeetingAnalysis] Local meeting state updated (handleUpdateActionItem)');
      
      if (onUpdateMeeting) {
        onUpdateMeeting(updatedMeeting);
      }
    } catch (error: any) {
      toast.error(`액션 아이템 수정 실패: ${error.message}`);
    }
  };

  const handleDeleteActionItem = async (id: string) => {
    if (confirm('이 액션 아이템을 삭제하시겠습니까?')) {
      try {
        const { deleteActionItem } = await import('@/features/meetings/reportsService');
        
        await deleteActionItem(meeting.id, id);

        // 로컬 상태 즉시 업데이트
        const updatedMeeting = {
          ...meeting,
          actionItems: meeting.actionItems.filter(item => item.id !== id)
        };
        
        setMeeting(updatedMeeting);
        console.log('[MeetingAnalysis] Local meeting state updated (handleDeleteActionItem)');
        
        if (onUpdateMeeting) {
          onUpdateMeeting(updatedMeeting);
        }
        toast.success('액션 아이템이 삭제되었습니다.');
      } catch (error: any) {
        toast.error(`액션 아이템 삭제 실패: ${error.message}`);
      }
    }
  };

  const handleToggleComplete = async (id: string) => {
    try {
      const { updateActionItem } = await import('@/features/meetings/reportsService');
      
      const item = meeting.actionItems.find(item => item.id === id);
      if (!item) return;

      const newStatus = item.completed ? 'TODO' : 'DONE';
      await updateActionItem(meeting.id, id, { status: newStatus });

      // 로컬 상태 즉시 업데이트
      const updatedItems = meeting.actionItems.map(item =>
        item.id === id ? { ...item, completed: !item.completed } : item
      );
      const updatedMeeting = {
        ...meeting,
        actionItems: updatedItems
      };
      
      setMeeting(updatedMeeting);
      console.log('[MeetingAnalysis] Local meeting state updated (handleToggleComplete)');
      
      if (onUpdateMeeting) {
        onUpdateMeeting(updatedMeeting);
      }
    } catch (error: any) {
      toast.error(`상태 변경 실패: ${error.message}`);
    }
  };

  const handleExportToGoogleCalendar = (item: ActionItem) => {
    const eventTitle = encodeURIComponent(item.text);
    const eventDate = item.dueDate ? item.dueDate.replace(/-/g, '') : '';
    const eventDetails = encodeURIComponent(`담당자: ${item.assignee}\n회의: ${meeting.title}`);
    
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${eventTitle}&dates=${eventDate}/${eventDate}&details=${eventDetails}`;
    window.open(googleCalendarUrl, '_blank');
    toast.success('Google 캘린더로 이동합니다.');
  };


  const [showJiraModal, setShowJiraModal] = useState(false);
  const [jiraProjects, setJiraProjects] = useState<Array<{ key: string; name: string; id: string }>>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [isLoadingJira, setIsLoadingJira] = useState(false);
  const [jiraSyncProgress, setJiraSyncProgress] = useState<{
    total: number;
    created: number;
    updated: number;
    failed: number;
  } | null>(null);

  const handleExportToJira = async () => {
    try {
      const { getJiraSettings, getJiraProjects, getJiraProjectUsers, getJiraPriorities } = await import('@/features/meetings/reportsService');
      
      // Jira 설정 확인
      try {
        await getJiraSettings();
      } catch (error) {
        toast.error('Jira를 먼저 연동해주세요. 설정 > 연동 플랫폼에서 Jira를 설정하세요.');
        return;
      }
      
      // 프로젝트 목록 조회
      setIsLoadingJira(true);
      const projectsData = await getJiraProjects();
      setJiraProjects(projectsData.projects);
      const defaultProject = projectsData.default_project_key || projectsData.projects[0]?.key || '';
      setSelectedProject(defaultProject);
      
      let currentJiraUsers: Array<{ account_id: string; display_name: string; email: string }> = [];

      // 기본 프로젝트의 사용자 및 우선순위 조회
      if (defaultProject) {
        try {
          const [usersData, prioritiesData] = await Promise.all([
            getJiraProjectUsers(defaultProject),
            getJiraPriorities(defaultProject)
          ]);
          setJiraUsers(usersData.users);
          setJiraPriorities(prioritiesData.priorities);
          currentJiraUsers = usersData.users || [];
        } catch (error) {
          console.error('Failed to load Jira project data:', error);
        }
      }
      
      // 편집 모달 준비
      const itemsForEdit = meeting.actionItems.map(item => {
        const itemId = item.item_id || item.id;
        
        // 날짜 필드 정규화: ISO 형식 또는 YYYY-MM-DD 형식만 허용
        let normalizedDate = '';
        const rawDate = item.due_date || item.dueDate || '';
        if (rawDate && typeof rawDate === 'string' && rawDate !== '미정') {
          // ISO 형식(YYYY-MM-DDTHH:mm:ss)을 YYYY-MM-DD로 변환
          if (rawDate.includes('T')) {
            normalizedDate = rawDate.split('T')[0];
          } 
          // YYYY-MM-DD 형식 검증
          else if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            normalizedDate = rawDate;
          }
        }

        // Jira 담당자 매칭 로직 추가
        let jiraAssigneeId = item.jira_assignee_id || '';
        let assigneeName = item.assignee || '';

        if (!jiraAssigneeId && assigneeName && assigneeName !== '미지정' && currentJiraUsers.length > 0) {
            // 이름으로 매칭 시도 (정확히 일치하거나 포함되는 경우)
            const matchedUser = currentJiraUsers.find(u => 
                u.display_name === assigneeName || 
                u.display_name.includes(assigneeName) ||
                assigneeName.includes(u.display_name)
            );
            
            if (matchedUser) {
                jiraAssigneeId = matchedUser.account_id;
                console.log(`[Jira Sync] Auto-matched assignee: ${assigneeName} -> ${matchedUser.display_name}`);
            }
        }
        
        console.log('[Jira Edit] Item mapping:', { 
          original: item, 
          item_id: item.item_id, 
          id: item.id, 
          using: itemId,
          raw_date: rawDate,
          normalized_date: normalizedDate,
          jira_assignee_id: jiraAssigneeId
        });
        
        return {
          item_id: itemId,
          title: item.title || item.text,
          description: item.description || '',
          assignee_name: assigneeName,
          original_assignee_name: assigneeName,
          jira_assignee_id: jiraAssigneeId,
          priority: item.priority || 'MEDIUM',
          due_dt: normalizedDate
        };
      });
      
      setJiraEditItems(itemsForEdit);
      setDeletedJiraItems([]);
      setShowJiraEditModal(true);
    } catch (error: any) {
      toast.error(`Jira 프로젝트 조회 실패: ${error.message}`);
    } finally {
      setIsLoadingJira(false);
    }
  };

  // Notion 내보내기 핸들러
  const [isLoadingNotion, setIsLoadingNotion] = useState(false);
  const [showNotionPageModal, setShowNotionPageModal] = useState(false);
  const [notionPages, setNotionPages] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedNotionPage, setSelectedNotionPage] = useState<string>('');
  const [loadingNotionPages, setLoadingNotionPages] = useState(false);
  
  const handleExportToNotion = async () => {
    try {
      const { getMyNotionPages, getNotionSettings } = await import('@/features/meetings/reportsService');
      
      // Notion 설정 확인
      try {
        const settings = await getNotionSettings();
        if (!settings.is_active) {
          toast.error('Notion 연동이 비활성화되어 있습니다. 설정 페이지에서 활성화해주세요.');
          return;
        }
      } catch (error: any) {
        // 404 에러 = 설정이 없음
        if (error.message.includes('not found') || error.message.includes('404')) {
          toast.error('Notion 연동을 먼저 설정해주세요. 설정 페이지로 이동합니다.');
          // 설정 페이지로 이동하는 로직 추가 가능
          return;
        }
        throw error;
      }
      
      // 페이지 선택 모달 열기
      setShowNotionPageModal(true);
      setLoadingNotionPages(true);
      
      // 페이지 목록 가져오기 (저장된 토큰 사용)
      const pagesData = await getMyNotionPages();
      setNotionPages(pagesData.pages || []);
      setLoadingNotionPages(false);
    } catch (error: any) {
      toast.error(`Notion 연동 오류: ${error.message}`);
      setShowNotionPageModal(false);
      setLoadingNotionPages(false);
    }
  };
  
  const confirmNotionExport = async () => {
    if (!selectedNotionPage) {
      toast.error('페이지를 선택해주세요');
      return;
    }
    
    try {
      setIsLoadingNotion(true);
      setShowNotionPageModal(false);
      toast.info('Notion에 내보내는 중...');
      
      const { exportToNotionComprehensive } = await import('@/features/meetings/reportsService');
      const result = await exportToNotionComprehensive(meeting.id, selectedNotionPage);
      
      if (result.success) {
        toast.success('Notion에 회의록이 생성되었습니다!');
        
        // Notion 페이지 열기
        if (result.notion_url) {
          window.open(result.notion_url, '_blank');
        }
      }
    } catch (error: any) {
      console.error('Notion export error:', error);
      toast.error(`Notion 내보내기 실패: ${error.message}`);
    } finally {
      setIsLoadingNotion(false);
      setSelectedNotionPage('');
    }
  };

  const handleJiraSync = async () => {
    if (!selectedProject) {
      toast.error('프로젝트를 선택해주세요');
      return;
    }

    try {
      const { pushToJira } = await import('@/features/meetings/reportsService');
      
      setIsLoadingJira(true);
      toast.info('Jira 동기화 중...');
      
      const result = await pushToJira(meeting.id, selectedProject, itemsToSync || undefined);
      
      setJiraSyncProgress({
        total: result.summary.total,
        created: result.summary.created_count,
        updated: result.summary.updated_count,
        failed: result.summary.failed_count,
      });
      
      // Jira 이슈 URL 저장 (첫 번째 생성된 이슈 또는 업데이트된 이슈)
      const firstIssue = result.created[0] || result.updated[0];
      const jiraUrl = firstIssue?.issue_url || (result.jira_base_url ? `${result.jira_base_url}/browse/${selectedProject}` : null);
      
      if (result.summary.failed_count === 0) {
        toast.success(`Jira 동기화 완료! (생성: ${result.summary.created_count}, 업데이트: ${result.summary.updated_count})`);
        
        // Jira 프로젝트 페이지 자동 열기
        if (jiraUrl) {
          window.open(jiraUrl, '_blank');
        }
      } else {
        const successCount = result.summary.created_count + result.summary.updated_count;
        toast.warning(`일부 항목 동기화 실패 (성공: ${successCount}, 실패: ${result.summary.failed_count})`);
      }
      
      // Jira 동기화 후 회의 데이터 새로고침
      console.log('[Jira Sync] onUpdateMeeting exists:', !!onUpdateMeeting);
      if (onUpdateMeeting) {
        try {
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/meetings/${meeting.id}`, {
            credentials: 'include'
          });
          
          if (response.ok) {
            const updatedMeetingData = await response.json();
            console.log('[Jira Sync] Fetched updated meeting data:', updatedMeetingData);
            const updatedMeeting = {
              ...meeting,
              actionItems: (updatedMeetingData.action_items || []).map((item: any) => ({
                id: item.item_id,
                item_id: item.item_id,
                text: item.title || item.description || '',
                title: item.title,
                description: item.description,
                assignee: item.assignee_name || '미지정',
                dueDate: item.due_dt ? new Date(item.due_dt).toISOString().split('T')[0] : '',
                due_date: item.due_dt,
                completed: item.status === 'DONE',
                priority: item.priority?.toLowerCase() || 'medium',
                jira_assignee_id: item.jira_assignee_id
              }))
            };
            
            // 로컬 상태 즉시 업데이트
            setMeeting(updatedMeeting);
            console.log('[Jira Sync] Local meeting state updated');
            
            // 부모 컴포넌트에도 전파
            console.log('[Jira Sync] Calling onUpdateMeeting with:', updatedMeeting);
            onUpdateMeeting(updatedMeeting);
            console.log('[Jira Sync] Meeting data updated after sync');
          } else {
            console.error('[Jira Sync] Failed to fetch meeting data, status:', response.status);
          }
        } catch (error) {
          console.error('[Jira Sync] Failed to refresh meeting data:', error);
        }
      } else {
        console.warn('[Jira Sync] onUpdateMeeting is not provided');
      }
      
      setTimeout(() => {
        setShowJiraModal(false);
        setJiraSyncProgress(null);
      }, 3000);
    } catch (error: any) {
      toast.error(`Jira 동기화 실패: ${error.message}`);
    } finally {
      setIsLoadingJira(false);
    }
  };

  // 편집 모달에서 프로젝트 변경 시 사용자 및 우선순위 재로드
  React.useEffect(() => {
    const loadEditModalProjectData = async () => {
      if (!showJiraEditModal || !selectedProject) {
        return;
      }
      
      setLoadingJiraData(true);
      try {
        const { getJiraProjectUsers, getJiraPriorities } = await import('@/features/meetings/reportsService');
        
        const [usersData, prioritiesData] = await Promise.all([
          getJiraProjectUsers(selectedProject),
          getJiraPriorities(selectedProject)
        ]);
        
        setJiraUsers(usersData.users || []);
        setJiraPriorities(prioritiesData.priorities || []);
      } catch (error: any) {
        toast.error(`Jira 데이터 로드 실패: ${error.message}`);
      } finally {
        setLoadingJiraData(false);
      }
    };
    
    loadEditModalProjectData();
  }, [showJiraEditModal, selectedProject]);

  // Generate comprehensive summary
  const generateComprehensiveSummary = () => {
    const lines = meeting.content.split('\n').filter(line => line.trim());
    
    // Extract key decisions
    const decisions = lines.filter(line => 
      /결정|확정|합의|승인/.test(line)
    );

    // Extract discussion points
    const discussions = lines.filter(line =>
      /논의|의견|검토|고려/.test(line)
    );

    // Extract risks or concerns
    const concerns = lines.filter(line =>
      /우려|위험|문제|이슈|리스크/.test(line)
    );

    return {
      decisions,
      discussions,
      concerns,
      totalParticipants: extractParticipants().length,
      totalActionItems: meeting.actionItems.length,
      completedActionItems: meeting.actionItems.filter(a => a.completed).length,
      pendingActionItems: meeting.actionItems.filter(a => !a.completed).length,
    };
  };

  const extractParticipants = () => {
    const participants = new Set<string>();
    meeting.actionItems.forEach(item => {
      if (item.assignee && item.assignee !== '미정') {
        participants.add(item.assignee);
      }
    });
    
    // Also extract from content
    const namePattern = /([가-힣]{2,4})(?:\s*님|\s*씨|\s*:|\s*담당)/g;
    let match;
    while ((match = namePattern.exec(meeting.content)) !== null) {
      participants.add(match[1]);
    }
    
    return Array.from(participants);
  };

  const calculatePriority = () => {
    const urgentKeywords = ['긴급', '급함', '중요', '우선', '즉시'];
    const urgentItems = meeting.actionItems.filter(item =>
      urgentKeywords.some(keyword => item.text.includes(keyword))
    );

    return {
      high: urgentItems.length,
      medium: meeting.actionItems.length - urgentItems.length,
      low: 0
    };
  };

  const summary = generateComprehensiveSummary();
  const participants = extractParticipants();
  const priority = calculatePriority();

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center gap-2">
        <Brain className="w-5 h-5 md:w-6 md:h-6 text-purple-600" />
        <h2 className="text-purple-600">액션 및 분석</h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="actionitems" className="gap-1 md:gap-2 text-xs md:text-sm">
            <Target className="w-3 h-3 md:w-4 md:h-4" />
            <span className="hidden sm:inline">액션 아이템 설정</span>
            <span className="sm:hidden">액션</span>
          </TabsTrigger>
          <TabsTrigger value="report" className="gap-1 md:gap-2 text-xs md:text-sm">
            <FileBarChart className="w-3 h-3 md:w-4 md:h-4" />
            리포트
          </TabsTrigger>
        </TabsList>

        <TabsContent value="actionitems" className="space-y-4 mt-4">
          {/* 액션 아이템 목록 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <Target className="w-5 h-5 text-blue-600" />
                액션 아이템 목록
                <Badge variant="secondary">
                  {meeting.actionItems.filter(a => a.completed).length} / {meeting.actionItems.length} 완료
                </Badge>
              </CardTitle>
              <Button 
                size="sm" 
                variant="outline" 
                className="gap-1"
                onClick={() => setIsAddingActionItem(true)}
                disabled={isAddingActionItem}
              >
                <Plus className="w-4 h-4" />
                추가
              </Button>
            </CardHeader>
            <CardContent>
              {/* 인라인 추가 폼 */}
              {isAddingActionItem && (
                <div className="mb-4 p-4 border rounded-lg bg-blue-50/50 border-blue-100 animate-in fade-in slide-in-from-top-2">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-2">
                        <Target className="w-4 h-4 text-blue-500" />
                      </div>
                      <div className="flex-1 space-y-3">
                        <Textarea
                          value={newActionItem.text}
                          onChange={(e) => setNewActionItem({ ...newActionItem, text: e.target.value })}
                          placeholder="새로운 액션 아이템 내용을 입력하세요..."
                          className="min-h-[60px] bg-white"
                          autoFocus
                        />
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-gray-500 flex items-center gap-1">
                              <User className="w-3 h-3" />
                              담당자
                            </label>
                            <Input
                              type="text"
                              value={newActionItem.assignee}
                              onChange={(e) => setNewActionItem({ ...newActionItem, assignee: e.target.value })}
                              placeholder="담당자 이름"
                              className="h-8 text-sm bg-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-gray-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              마감일
                            </label>
                            <Input
                              type="date"
                              value={newActionItem.dueDate}
                              onChange={(e) => setNewActionItem({ ...newActionItem, dueDate: e.target.value })}
                              className="h-8 text-sm bg-white"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-gray-500">우선순위</label>
                            <select
                              value={newActionItem.priority}
                              onChange={(e) => setNewActionItem({ ...newActionItem, priority: e.target.value })}
                              className="w-full h-8 px-2 text-sm rounded-md border border-slate-200 bg-white"
                            >
                              <option value="높음">높음</option>
                              <option value="중간">중간</option>
                              <option value="낮음">낮음</option>
                            </select>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => setIsAddingActionItem(false)}
                          >
                            취소
                          </Button>
                          <Button 
                            size="sm" 
                            onClick={handleAddActionItem}
                          >
                            저장
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {meeting.actionItems.length === 0 && !isAddingActionItem ? (
                <div className="text-center py-8 text-gray-500">
                  <Target className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                  <p>아직 액션 아이템이 없습니다</p>
                  <p className="text-xs mt-1">상단의 추가 버튼을 눌러 액션 아이템을 생성하세요</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {meeting.actionItems.map((item) => (
                    <div
                      key={item.id}
                      className={`p-4 border rounded-lg ${
                        item.completed ? 'bg-gray-50 border-gray-200' : 'bg-white border-gray-300'
                      }`}
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <Checkbox
                          checked={item.completed}
                          onCheckedChange={() => handleToggleComplete(item.id)}
                          className="mt-1"
                        />
                        {editingId === item.id ? (
                          <Textarea
                            value={item.text}
                            onChange={(e) => handleUpdateActionItem(item.id, 'text', e.target.value)}
                            className="flex-1 min-h-[60px]"
                            onBlur={() => setEditingId(null)}
                            autoFocus
                          />
                        ) : (
                          <p 
                            className={`flex-1 text-sm md:text-base cursor-pointer ${item.completed ? 'line-through text-gray-500' : 'text-gray-900'}`}
                            onClick={() => setEditingId(item.id)}
                          >
                            {item.text}
                          </p>
                        )}
                        <div className="flex gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleExportToGoogleCalendar(item)}
                            className="h-6 w-6 p-0 rounded-full hover:bg-blue-50 text-gray-400 hover:text-blue-600"
                            title="구글 캘린더에 추가"
                          >
                            <CalendarIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 ml-8">
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500 flex items-center gap-1">
                            <User className="w-3 h-3" />
                            담당자
                          </label>
                          <Input
                            key={`assignee-${item.id}`}
                            type="text"
                            defaultValue={item.assignee}
                            onBlur={(e) => {
                              if (e.target.value !== item.assignee) {
                                handleUpdateActionItem(item.id, 'assignee', e.target.value);
                              }
                            }}
                            placeholder="담당자 이름"
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            마감일
                          </label>
                          <Input
                            key={`duedate-${item.id}`}
                            type="date"
                            defaultValue={item.dueDate}
                            onChange={(e) => handleUpdateActionItem(item.id, 'dueDate', e.target.value)}
                            className="h-8 text-sm"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-500">우선순위 및 관리</label>
                          <div className="flex gap-2">
                            <select
                              value={item.priority || '중간'}
                              onChange={(e) => handleUpdateActionItem(item.id, 'priority', e.target.value)}
                              className={`flex-1 h-8 px-2 text-xs rounded-md border border-slate-200 ${
                                item.priority === '높음' ? 'bg-red-50 text-red-700 border-red-200' :
                                item.priority === '중간' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                                'bg-gray-50 text-gray-700 border-gray-200'
                              }`}
                            >
                              <option value="높음">높음</option>
                              <option value="중간">중간</option>
                              <option value="낮음">낮음</option>
                            </select>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => handleDeleteActionItem(item.id)}
                              className="h-8 px-2"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              
              {/* Jira & Notion 동기화 버튼 */}
              {meeting.actionItems.length > 0 && (
                <div className="mt-4 pt-4 border-t flex justify-center gap-3">
                  <Button 
                    variant="outline" 
                    className="w-[200px] gap-2 border-[#0052CC] text-[#0052CC] hover:bg-[#0052CC]/10" 
                    onClick={handleExportToJira}
                  >
                    <ExternalLink className="w-4 h-4" />
                    Jira에 동기화
                  </Button>
                  <Button 
                    variant="outline" 
                    className="w-[200px] gap-2 border-[#000000] text-[#000000] hover:bg-[#000000]/10" 
                    onClick={handleExportToNotion}
                  >
                    <FileBarChart className="w-4 h-4" />
                    Notion에 동기화
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-3 md:space-y-4 mt-4">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
            <Card className="shadow-sm">
              <CardContent className="p-3 md:p-6 md:pt-6">
                <div className="flex flex-col md:flex-row items-center md:justify-between gap-2">
                  <div className="text-center md:text-left">
                    <p className="text-xs md:text-sm text-gray-600">참여자</p>
                    <p className="text-xl md:text-2xl mt-1">{summary.totalParticipants}</p>
                  </div>
                  <Users className="w-6 h-6 md:w-8 md:h-8 text-blue-500 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-3 md:p-6 md:pt-6">
                <div className="flex flex-col md:flex-row items-center md:justify-between gap-2">
                  <div className="text-center md:text-left">
                    <p className="text-xs md:text-sm text-gray-600">액션 아이템</p>
                    <p className="text-xl md:text-2xl mt-1">{summary.totalActionItems}</p>
                  </div>
                  <Target className="w-6 h-6 md:w-8 md:h-8 text-green-500 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-3 md:p-6 md:pt-6">
                <div className="flex flex-col md:flex-row items-center md:justify-between gap-2">
                  <div className="text-center md:text-left">
                    <p className="text-xs md:text-sm text-gray-600">완료</p>
                    <p className="text-xl md:text-2xl mt-1">{summary.completedActionItems}</p>
                  </div>
                  <TrendingUp className="w-6 h-6 md:w-8 md:h-8 text-purple-500 opacity-50" />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardContent className="p-3 md:p-6 md:pt-6">
                <div className="flex flex-col md:flex-row items-center md:justify-between gap-2">
                  <div className="text-center md:text-left">
                    <p className="text-xs md:text-sm text-gray-600">진행 중</p>
                    <p className="text-xl md:text-2xl mt-1">{summary.pendingActionItems}</p>
                  </div>
                  <AlertTriangle className="w-6 h-6 md:w-8 md:h-8 text-orange-500 opacity-50" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Participants */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 md:pb-6">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <Users className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
                참여자 목록
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5 md:gap-2">
                {participants.length > 0 ? (
                  participants.map((participant, index) => (
                    <div
                      key={index}
                      className="px-2 md:px-3 py-0.5 md:py-1 bg-blue-100 text-blue-700 rounded-full text-xs md:text-sm"
                    >
                      {participant}
                    </div>
                  ))
                ) : (
                  <p className="text-gray-500 text-xs md:text-sm">참여자 정보가 없습니다</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Key Decisions */}
          {summary.decisions.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3 md:pb-6">
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <Target className="w-4 h-4 md:w-5 md:h-5 text-green-600" />
                  주요 결정사항
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {summary.decisions.slice(0, 5).map((decision, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="text-green-600 mt-0.5 md:mt-1">•</span>
                      <span className="text-gray-700 text-sm md:text-base">{decision.trim()}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Discussion Points */}
          {summary.discussions.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3 md:pb-6">
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <MessageSquare className="w-4 h-4 md:w-5 md:h-5 text-purple-600" />
                  주요 논의사항
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {summary.discussions.slice(0, 5).map((discussion, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="text-purple-600 mt-0.5 md:mt-1">•</span>
                      <span className="text-gray-700 text-sm md:text-base">{discussion.trim()}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Concerns */}
          {summary.concerns.length > 0 && (
            <Card className="shadow-sm">
              <CardHeader className="pb-3 md:pb-6">
                <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                  <AlertTriangle className="w-4 h-4 md:w-5 md:h-5 text-orange-600" />
                  우려사항 및 리스크
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {summary.concerns.slice(0, 5).map((concern, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="text-orange-600 mt-0.5 md:mt-1">•</span>
                      <span className="text-gray-700 text-sm md:text-base">{concern.trim()}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Action Items by Priority */}
          <Card className="shadow-sm">
            <CardHeader className="pb-3 md:pb-6">
              <CardTitle className="flex items-center gap-2 text-base md:text-lg">
                <Target className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
                액션 아이템 우선순위
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs md:text-sm text-gray-600 w-12">높음</span>
                  <div className="flex-1 mx-2 md:mx-4 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{ width: `${(priority.high / meeting.actionItems.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs md:text-sm w-8 text-right">{priority.high}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs md:text-sm text-gray-600 w-12">중간</span>
                  <div className="flex-1 mx-2 md:mx-4 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-yellow-500 h-2 rounded-full"
                      style={{ width: `${(priority.medium / meeting.actionItems.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs md:text-sm w-8 text-right">{priority.medium}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        

        <TabsContent value="report" className="mt-4">
          <MeetingReport meeting={meeting} showExports={false} />
        </TabsContent>
      </Tabs>

      {/* Jira 연동 전 편집 모달 */}
      {showJiraEditModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowJiraEditModal(false)}>
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <ExternalLink className="w-5 h-5 text-[#0052CC]" />
                Jira 동기화 준비
              </h3>
              <p className="text-sm text-gray-600 mt-2">
                프로젝트를 선택하고 각 액션 아이템의 담당자와 우선순위를 설정하세요.
              </p>
            </div>
            
            <div className="p-6 space-y-4 border-b">
              <div className="flex justify-between items-end">
                <div className="flex-1 mr-4">
                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                    Jira 프로젝트
                  </label>
                  <select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0052CC] focus:border-transparent"
                  >
                    {jiraProjects.map((project) => (
                      <option key={project.key} value={project.key}>
                        {project.name} ({project.key})
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  onClick={() => {
                    const tempId = `temp-${Date.now()}`;
                    setJiraEditItems([
                      {
                        item_id: tempId,
                        title: '',
                        description: '',
                        assignee_name: '미지정',
                        jira_assignee_id: null,
                        priority: 'MEDIUM',
                        due_dt: '',
                        isNew: true
                      },
                      ...jiraEditItems
                    ]);
                  }}
                  className="gap-2 bg-[#0052CC] hover:bg-[#0747A6]"
                >
                  <Plus className="w-4 h-4" />
                  추가
                </Button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              <div className="space-y-4">
                {jiraEditItems.map((item, index) => (
                  <Card key={item.item_id || `jira-edit-${index}`} className="shadow-sm relative group">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-500"
                      onClick={() => {
                        // 목록에서만 제거 (동기화 대상에서 제외)
                        setJiraEditItems(jiraEditItems.filter((_, i) => i !== index));
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                    <CardContent className="pt-4">
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-gray-500 mb-1 block">
                            제목 *
                          </label>
                          <input
                            type="text"
                            value={item.title}
                            onChange={(e) => {
                              const newItems = [...jiraEditItems];
                              newItems[index].title = e.target.value;
                              setJiraEditItems(newItems);
                            }}
                            className="w-full p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0052CC] focus:border-transparent"
                            placeholder="액션 아이템 제목"
                          />
                        </div>
                        
                        <div>
                          <label className="text-xs font-medium text-gray-500 mb-1 block">
                            설명
                          </label>
                          <textarea
                            value={item.description}
                            onChange={(e) => {
                              const newItems = [...jiraEditItems];
                              newItems[index].description = e.target.value;
                              setJiraEditItems(newItems);
                            }}
                            className="w-full p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0052CC] focus:border-transparent resize-none"
                            placeholder="추가 설명 (선택사항)"
                            rows={2}
                          />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-500 mb-1 block">
                              Jira 담당자
                            </label>
                            <select
                              value={item.jira_assignee_id || ''}
                              onChange={(e) => {
                                const newItems = [...jiraEditItems];
                                newItems[index].jira_assignee_id = e.target.value || null;
                                
                                if (e.target.value) {
                                  // 담당자 선택됨
                                  const selectedUser = jiraUsers.find(u => u.account_id === e.target.value);
                                  if (selectedUser) {
                                    newItems[index].assignee_name = selectedUser.display_name;
                                    console.log('[Jira Edit] Set assignee:', selectedUser.display_name);
                                  }
                                } else {
                                  // 미지정 선택됨
                                  newItems[index].assignee_name = '미지정';
                                  console.log('[Jira Edit] Set assignee to 미지정');
                                }
                                setJiraEditItems(newItems);
                              }}
                              className="w-full p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0052CC] focus:border-transparent"
                              disabled={loadingJiraData}
                            >
                              <option value="">
                                {item.original_assignee_name && item.original_assignee_name !== '미지정' 
                                  ? `미지정 (기존: ${item.original_assignee_name})` 
                                  : '미지정'}
                              </option>
                              {jiraUsers.map((user) => (
                                <option key={user.account_id} value={user.account_id}>
                                  {user.display_name}
                                </option>
                              ))}
                            </select>
                          </div>
                          
                          <div>
                            <label className="text-xs font-medium text-gray-500 mb-1 block">
                              우선순위
                            </label>
                            <select
                              value={item.priority}
                              onChange={(e) => {
                                const newItems = [...jiraEditItems];
                                newItems[index].priority = e.target.value;
                                setJiraEditItems(newItems);
                              }}
                              className="w-full p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0052CC] focus:border-transparent"
                              disabled={loadingJiraData}
                            >
                              {jiraPriorities.length > 0 ? (
                                jiraPriorities.map((priority) => (
                                  <option key={priority.id} value={priority.name.toUpperCase()}>
                                    {priority.name}
                                  </option>
                                ))
                              ) : (
                                <>
                                  <option value="LOW">낮음</option>
                                  <option value="MEDIUM">중간</option>
                                  <option value="HIGH">높음</option>
                                </>
                              )}
                            </select>
                          </div>
                          
                          <div>
                            <label className="text-xs font-medium text-gray-500 mb-1 block">
                              마감일
                            </label>
                            <input
                              type="date"
                              value={item.due_dt?.split('T')[0] || ''}
                              onChange={(e) => {
                                const newItems = [...jiraEditItems];
                                newItems[index].due_dt = e.target.value;
                                setJiraEditItems(newItems);
                              }}
                              className="w-full p-2 text-sm border border-gray-300 rounded-md focus:ring-2 focus:ring-[#0052CC] focus:border-transparent"
                            />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
            
            <div className="p-6 border-t bg-gray-50">
              <div className="flex gap-2 justify-end">
                <Button
                  onClick={() => setShowJiraEditModal(false)}
                  variant="outline"
                >
                  취소
                </Button>
                <Button
                  onClick={async () => {
                    // 편집된 데이터로 액션 아이템 업데이트
                    try {
                      const { updateActionItem, createActionItem } = await import('@/features/meetings/reportsService');
                      
                      setLoadingJiraData(true);
                      let successCount = 0;
                      let failedCount = 0;
                      const errors: Array<{ item: string; error: string }> = [];
                      const finalItemIds: string[] = [];

                      // 생성 및 수정 처리
                      for (const item of jiraEditItems) {
                        console.log('[Jira Update] Processing item:', item.item_id, 'isNew:', item.isNew);
                        
                        try {
                          // 날짜 검증
                          let validDueDate: string | undefined = undefined;
                          if (item.due_dt && item.due_dt.trim() && item.due_dt !== '미정') {
                            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                            if (dateRegex.test(item.due_dt)) {
                              validDueDate = item.due_dt;
                            }
                          }

                          if (item.isNew) {
                            // 새 항목 생성
                            if (!item.title.trim()) continue; // 제목 없으면 스킵

                            const newItem = await createActionItem(meeting.id, {
                              title: item.title,
                              description: item.description,
                              assignee_name: item.assignee_name || '미지정',
                              jira_assignee_id: item.jira_assignee_id || undefined,
                              priority: item.priority,
                              due_dt: validDueDate
                            });
                            console.log('[Jira Update] Created new item:', item.title);
                            finalItemIds.push(newItem.item_id);
                            successCount++;
                          } else {
                            // 기존 항목 수정
                            await updateActionItem(meeting.id, item.item_id, {
                              title: item.title,
                              description: item.description,
                              assignee_name: item.assignee_name || '미지정',
                              jira_assignee_id: item.jira_assignee_id || undefined,
                              priority: item.priority,
                              due_dt: validDueDate
                            });
                            console.log('[Jira Update] Updated item:', item.item_id);
                            finalItemIds.push(item.item_id);
                            successCount++;
                          }
                        } catch (err: any) {
                          console.error('[Jira Update] Failed for item:', item.item_id, err);
                          failedCount++;
                          errors.push({
                            item: item.title || item.item_id,
                            error: err.message || String(err)
                          });
                        }
                      }
                      
                      if (failedCount > 0) {
                        toast.warning(`${successCount}개 처리 성공, ${failedCount}개 실패`);
                      }
                      
                      // 동기화할 아이템 ID 목록 설정
                      setItemsToSync(finalItemIds);
                      
                      // 회의 데이터 새로고침 (서버에서 최신 데이터 가져오기)
                      if (onUpdateMeeting) {
                        try {
                          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/meetings/${meeting.id}`, {
                            credentials: 'include'
                          });
                          
                          if (response.ok) {
                            const updatedMeetingData = await response.json();
                            const updatedMeeting = {
                              ...meeting,
                              actionItems: (updatedMeetingData.action_items || []).map((item: any) => ({
                                id: item.item_id,
                                item_id: item.item_id,
                                text: item.title || item.description || '',
                                title: item.title,
                                description: item.description,
                                assignee: item.assignee_name || '미지정',
                                dueDate: item.due_dt ? new Date(item.due_dt).toISOString().split('T')[0] : '',
                                due_date: item.due_dt,
                                completed: item.status === 'DONE',
                                priority: item.priority?.toLowerCase() || 'medium',
                                jira_assignee_id: item.jira_assignee_id
                              }))
                            };
                            
                            setMeeting(updatedMeeting);
                            onUpdateMeeting(updatedMeeting);
                          }
                        } catch (error) {
                          console.error('[Jira Update] Failed to refresh meeting data:', error);
                        }
                      }
                      
                      if (successCount > 0 && failedCount === 0) {
                        toast.success('액션 아이템이 업데이트되었습니다');
                      }
                      
                      setShowJiraEditModal(false);
                      
                      if (successCount > 0) {
                        setShowJiraModal(true);
                      }
                    } catch (error) {
                      console.error('Unexpected error during update:', error);
                      toast.error('예상치 못한 오류가 발생했습니다');
                    } finally {
                      setLoadingJiraData(false);
                    }
                  }}
                  className="bg-[#0052CC] hover:bg-[#0747A6]"
                  disabled={loadingJiraData}
                >
                  {loadingJiraData ? '로딩 중...' : '다음'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jira 동기화 확인 모달 */}
      {showJiraModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => !isLoadingJira && setShowJiraModal(false)}>
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <ExternalLink className="w-5 h-5 text-[#0052CC]" />
              Jira 동기화
            </h3>
            
            {!jiraSyncProgress ? (
              <>
                <div className="mb-6">
                  <p className="text-sm text-gray-600 mb-3">
                    선택한 프로젝트에 액션 아이템을 동기화합니다.
                  </p>
                  <div className="bg-blue-50 rounded-lg p-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">프로젝트:</span>
                      <span className="font-medium text-[#0052CC]">
                        {jiraProjects.find(p => p.key === selectedProject)?.name} ({selectedProject})
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">액션 아이템:</span>
                      <span className="font-medium">{meeting.actionItems.length}개</span>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    onClick={handleJiraSync}
                    disabled={isLoadingJira || !selectedProject}
                    className="flex-1 bg-[#0052CC] hover:bg-[#0747A6]"
                  >
                    {isLoadingJira ? '동기화 중...' : '동기화 시작'}
                  </Button>
                  <Button
                    onClick={() => setShowJiraModal(false)}
                    variant="outline"
                    disabled={isLoadingJira}
                  >
                    취소
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-3xl mb-2">✅</div>
                  <h4 className="font-semibold mb-2">동기화 완료!</h4>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">전체</span>
                    <span className="font-medium">{jiraSyncProgress.total}개</span>
                  </div>
                  <div className="flex justify-between text-green-600">
                    <span>생성됨</span>
                    <span className="font-medium">{jiraSyncProgress.created}개</span>
                  </div>
                  <div className="flex justify-between text-blue-600">
                    <span>업데이트됨</span>
                    <span className="font-medium">{jiraSyncProgress.updated}개</span>
                  </div>
                  {jiraSyncProgress.failed > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>실패</span>
                      <span className="font-medium">{jiraSyncProgress.failed}개</span>
                    </div>
                  )}
                </div>
                
                <p className="text-xs text-center text-gray-500">
                  자동으로 닫힙니다...
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Notion 페이지 선택 모달 */}
      {showNotionPageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Notion 페이지 선택</h3>
              <button 
                onClick={() => {
                  setShowNotionPageModal(false);
                  setSelectedNotionPage('');
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            
            {loadingNotionPages ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto"></div>
                <p className="text-sm text-gray-600 mt-4">페이지 목록 로딩 중...</p>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    회의록을 생성할 페이지를 선택하세요
                  </label>
                  <select
                    value={selectedNotionPage}
                    onChange={(e) => setSelectedNotionPage(e.target.value)}
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="">페이지 선택...</option>
                    {notionPages.map((page) => (
                      <option key={page.id} value={page.id}>
                        {page.title || 'Untitled'}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div className="flex gap-2 mt-6">
                  <Button
                    onClick={() => {
                      setShowNotionPageModal(false);
                      setSelectedNotionPage('');
                    }}
                    variant="outline"
                    className="flex-1"
                  >
                    취소
                  </Button>
                  <Button
                    onClick={confirmNotionExport}
                    disabled={!selectedNotionPage || isLoadingNotion}
                    className="flex-1"
                  >
                    {isLoadingNotion ? '내보내는 중...' : '내보내기'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
