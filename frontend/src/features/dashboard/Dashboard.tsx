import { useState, useEffect } from "react";
import { MeetingStart } from "@/features/realtime/MeetingStart";
import { MeetingListView } from "@/features/meetings/MeetingListView";
import { MeetingChatbotPage } from "@/features/meetings/MeetingChatbotPage";
import { ActionItemsPage } from "@/features/action-items/ActionItemsPage";
import { TemplateSettings } from "@/features/settings/TemplateSettings";
// import { NotificationSettings } from "@/features/settings/NotificationSettings";
import { TranslationSettings } from "@/features/settings/TranslationSettings";
import { KeywordSettings } from "@/features/settings/KeywordSettings";
import { PlatformSettings } from "@/features/settings/PlatformSettings";
import { Button } from "@/shared/ui/button";
import { initNotificationChecker } from "@/utils/notificationChecker";
import {
  Home,
  PlayCircle,
  ClipboardList,
  Settings,
  FileEdit,
  LogOut,
  Languages,
  Bell,
  Database,
  Link2,
  Tag,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
} from "lucide-react";
import { Toaster } from "../../shared/ui/sonner";
import Image from "next/image";
import logoImage from "../../../public/1479b69d0df16b28749512726e3ffc0f8c722c85.png";
import logoSmall from "../../../public/60426c137b413d34e2b76e4bc10e67509bb612fb.png";

export interface ActionItem {
  id: string;
  text: string;
  description?: string;
  assignee: string;
  dueDate: string;
  completed: boolean;
  priority?: string;
  assigneeAvatar?: string;
  item_id?: string;
  title?: string;
  due_date?: string;
  jira_assignee_id?: string | null;
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  content: string;
  summary: string;
  actionItems: ActionItem[];
  createdAt: string;
  updatedAt: string;
  participants?: string[];
  keyDecisions?: string[];
  nextSteps?: string[];
  audioUrl?: string;
  purpose?: string;
}

export function Dashboard() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeSection, setActiveSection] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem("dashboard_active_section") || "home";
    }
    return "home";
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Save activeSection to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem("dashboard_active_section", activeSection);
  }, [activeSection]);

  useEffect(() => {
    const fetchMeetings = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/meetings/`, {
          method: 'GET',
          credentials: 'include', // httpOnly Cookie 전송
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[Dashboard] Fetched meetings from backend:', data);

          const mappedMeetings: Meeting[] = data.map((m: any) => ({
            id: m.meeting_id,
            title: m.title || '제목 없음',
            date: m.start_dt?.split('T')[0] || new Date().toISOString().split('T')[0],
            content: m.content || '',
            summary: m.summary?.content || m.ai_summary || m.purpose || '',
            actionItems: (m.action_items || []).map((item: any) => ({
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
            })),
            createdAt: m.start_dt || new Date().toISOString(),
            updatedAt: m.end_dt || new Date().toISOString(),
            participants: m.participants || [],
            keyDecisions: m.key_decisions || [],
            nextSteps: m.next_steps || [],
            audioUrl: m.audio_url || ''
          }));

          setMeetings(mappedMeetings);
        }
      } catch (error) {
        console.error('Failed to fetch meetings:', error);
      }
    };

    fetchMeetings();
  }, []);

  // Initialize notification checker
  useEffect(() => {
    if (meetings.length > 0) {
      const cleanup = initNotificationChecker(meetings);
      return cleanup;
    }
  }, [meetings]);

  const handleAddMeeting = (meeting: Meeting) => {
    console.log('[Dashboard] Adding meeting:', meeting);
    console.log('[Dashboard] Meeting audioUrl:', meeting.audioUrl);
    setMeetings([meeting, ...meetings]);
    setActiveSection("history");
  };

  const handleUpdateMeeting = (updatedMeeting: Meeting) => {
    console.log('[Dashboard] handleUpdateMeeting called with:', updatedMeeting);
    const updated = {
      ...updatedMeeting,
      updatedAt: new Date().toISOString(),
    };
    const newMeetings = meetings.map((m) => (m.id === updated.id ? updated : m));
    console.log('[Dashboard] Updated meetings:', newMeetings);
    setMeetings(newMeetings);
  };

  const handleDeleteMeeting = (id: string) => {
    const newMeetings = meetings.filter((m) => m.id !== id);
    setMeetings(newMeetings);
  };

  const handleLogout = async () => {
    try {
      // 백엔드 로그아웃 API 호출 (httpOnly Cookie 삭제)
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include', // httpOnly Cookie 전송
      }).catch(err => console.log('Logout API error:', err)); // 실패해도 계속 진행

      // 로그인 페이지로 이동
      window.location.href = "/login";
    } catch (error) {
      console.error('로그아웃 중 오류:', error);
      // 오류가 발생해도 로그인 페이지로 이동
      window.location.href = "/login";
    }
  };

  const renderContent = () => {
    switch (activeSection) {
      case "home":
        return (
          <div className="space-y-5">
            <div className="bg-gradient-to-br from-primary to-blue-700 rounded-2xl p-8 shadow-md text-white w-[1000px] h-[200px]">
              <h2 className="mb-3 text-white">회의 시작하기</h2>
              <p className="text-white/90 mb-6">
                실시간 음성 인식으로 회의를 기록하고 자동으로 요약과 액션
                아이템을 추출하세요
              </p>
              <Button
                onClick={() => setActiveSection("start")}
                size="lg"
                className="gap-2 bg-white text-primary hover:bg-white/90 shadow-md"
              >
                <PlayCircle className="w-5 h-5" />새 회의 시작
              </Button>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div
                className="bg-white rounded-2xl p-6 shadow-sm border border-border cursor-pointer hover:shadow-md hover:border-primary/30 transition-all flex flex-col justify-between min-h-[140px]"
                onClick={() => setActiveSection("history")}
              >
                <div>
                  <h3 className="mb-2 text-foreground">전체 회의록</h3>
                  <p className="text-3xl mb-2 text-primary">
                    {meetings.length}개
                  </p>
                </div>
                <p className="text-xs md:text-sm text-muted-foreground text-right mt-1">
                  회의 내역 보기 →
                </p>
              </div>

              <div
                className="bg-white rounded-2xl p-6 shadow-sm border border-border cursor-pointer hover:shadow-md hover:border-primary/30 transition-all flex flex-col justify-between min-h-[140px]"
                onClick={() => setActiveSection("actions")}
              >
                <div>
                  <h3 className="mb-2 text-foreground">액션 아이템</h3>
                  <div className="flex items-end gap-4 mb-2">
                    <div>
                      <p className="text-xs text-muted-foreground">진행 중</p>
                      <p className="text-2xl" style={{ color: '#FFA726' }}>
                        {meetings.reduce(
                          (acc, m) =>
                            acc +
                            m.actionItems.filter((a) => !a.completed).length,
                          0
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">완료</p>
                      <p className="text-2xl text-emerald-500">
                        {meetings.reduce(
                          (acc, m) =>
                            acc +
                            m.actionItems.filter((a) => a.completed).length,
                          0
                        )}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="text-xs md:text-sm text-muted-foreground text-right mt-1">
                  액션 아이템 관리 →
                </p>
              </div>
            </div>
          </div>
        );

      case "start":
        return (
          <MeetingStart meetings={meetings} onAddMeeting={handleAddMeeting} />
        );

      case "history":
        return (
          <MeetingListView
            meetings={meetings}
            onUpdateMeeting={handleUpdateMeeting}
            onDeleteMeeting={handleDeleteMeeting}
          />
        );

      case "actions":
        return (
          <ActionItemsPage
            meetings={meetings}
            onUpdateMeeting={handleUpdateMeeting}
          />
        );

      case "chatbot":
        return <MeetingChatbotPage meetings={meetings} />;

      case "template":
        return <TemplateSettings onBack={() => setActiveSection("settings")} />;

      // case "notification-settings":
      //   return (
      //     <NotificationSettings onBack={() => setActiveSection("settings")} />
      //   );

      case "translation-settings":
        return (
          <TranslationSettings onBack={() => setActiveSection("settings")} />
        );

      case "keyword-settings":
        return <KeywordSettings onBack={() => setActiveSection("settings")} />;

      case "platform-settings":
        return (
          <PlatformSettings onBack={() => setActiveSection("settings")} />
        );

      case "settings":
        return (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-border w-[1100px] max-w-[1200px] mx-auto">
            <h2 className="mb-6 text-foreground">환경설정</h2>
            <div className="space-y-3">
              {/* 템플릿 설정 추가 */}
              <div
                className="group p-5 border-2 border-border rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
                onClick={() => setActiveSection("template")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-blue-100 rounded-xl group-hover:bg-blue-200 transition-colors">
                      <FileEdit className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="mb-1">템플릿 설정</h3>
                      <p className="text-muted-foreground text-sm">
                        회의록 템플릿을 관리하고 커스터마이징할 수 있습니다
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </div>

              <div
                className="group p-5 border-2 border-border rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
                onClick={() => setActiveSection("translation-settings")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-indigo-100 rounded-xl group-hover:bg-indigo-200 transition-colors">
                      <Languages className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="mb-1 flex items-center gap-2">
                        번역 설정
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        음성 인식 언어 및 번역 설정
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </div>

              <div
                className="group p-5 border-2 border-border rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
                onClick={() => setActiveSection("keyword-settings")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-purple-100 rounded-xl group-hover:bg-purple-200 transition-colors">
                      <Tag className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="mb-1">키워드 텍스트 설정</h3>
                      <p className="text-muted-foreground text-sm">
                        액션 아이템 추출을 위한 키워드를 커스터마이징할 수
                        있습니다
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </div>



              <div
                className="group p-5 border-2 border-border rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer"
                onClick={() => setActiveSection("platform-settings")}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-green-100 rounded-xl group-hover:bg-green-200 transition-colors">
                      <Link2 className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <h3 className="mb-1">연동 플랫폼 설정</h3>
                      <p className="text-muted-foreground text-sm">
                        Notion, Jira 등 플랫폼 연동 계정 설정
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </div>


            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const SidebarNavItem = ({
    section,
    icon: Icon,
    label,
  }: {
    section: string;
    icon: any;
    label: string;
  }) => (
    <button
      onClick={() => setActiveSection(section)}
      className={`
          flex items-center gap-3 px-4 py-3 rounded-xl transition-all w-full
          ${activeSection === section
          ? "bg-primary text-white shadow-md"
          : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
        }
        `}
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      {sidebarOpen && <span className="truncate">{label}</span>}
    </button>
  );

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar */}
      <aside
        className={`
            bg-white border-r border-border sticky top-0 h-screen transition-all duration-300 flex-shrink-0 hidden md:flex flex-col
            ${sidebarOpen ? "w-64" : "w-20"}
          `}
      >
        {/* Sidebar Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          {sidebarOpen ? (
            <Image
              src={logoImage}
              alt="RoundNote Logo"
              width={40}
              height={40}
              className="h-10 w-auto cursor-pointer"
              onClick={() => setActiveSection("home")}
            />
          ) : (
            <div className="flex justify-center w-full">
              <Image
                src={logoSmall}
                alt="RoundNote Logo"
                width={32}
                height={32}
                className="h-8 w-auto cursor-pointer"
                onClick={() => setActiveSection("home")}
              />
            </div>
          )}
          {sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="ml-auto hover:bg-primary/10"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
          )}
        </div>

        {/* Toggle button when closed */}
        {!sidebarOpen && (
          <div className="px-2 py-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-full hover:bg-primary/10"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
        )}

        {/* Sidebar Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          <SidebarNavItem section="home" icon={Home} label="메인 화면" />
          <SidebarNavItem
            section="history"
            icon={ClipboardList}
            label="회의 내역"
          />
          <SidebarNavItem section="chatbot" icon={MessageSquare} label="회의 챗봇" />
          <SidebarNavItem section="settings" icon={Settings} label="환경설정" />
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-border">
          <Button
            onClick={handleLogout}
            variant="ghost"
            className={`
                w-full gap-3 text-red-600 hover:bg-red-50 hover:text-red-700
                ${sidebarOpen ? "justify-start" : "justify-center px-0"}
              `}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span>로그아웃</span>}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="bg-white border-b border-border p-4 md:hidden sticky top-0 z-50">
          <div className="flex items-center justify-between">
            <Image
              src={logoImage}
              alt="RoundNote Logo"
              width={40}
              height={40}
              className="h-10 w-auto cursor-pointer"
              onClick={() => setActiveSection("home")}
            />
            <Button onClick={handleLogout} variant="ghost" size="sm">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
          {/* Mobile Navigation */}
          <nav className="flex gap-2 mt-4 overflow-x-auto pb-2">
            <Button
              variant={activeSection === "home" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveSection("home")}
              className="whitespace-nowrap"
            >
              <Home className="w-4 h-4 mr-2" />
              메인
            </Button>
            <Button
              variant={activeSection === "history" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveSection("history")}
              className="whitespace-nowrap"
            >
              <ClipboardList className="w-4 h-4 mr-2" />
              회의 내역
            </Button>
            <Button
              variant={activeSection === "settings" ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveSection("settings")}
              className="whitespace-nowrap"
            >
              <Settings className="w-4 h-4 mr-2" />
              환경설정
            </Button>
          </nav>
        </header>

        {/* Main Content */}
        <main className="flex-1 p-4 md:p-8 overflow-auto">
          <div className="max-w-6xl mx-auto">{renderContent()}</div>
        </main>
      </div>

      {/* Toast Notifications */}

      <Toaster position="top-center" richColors />
    </div>
  );
}
export default Dashboard;