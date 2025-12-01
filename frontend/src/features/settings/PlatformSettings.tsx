import { useState, useEffect } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Card } from "@/shared/ui/card";
import { ArrowLeft, Link2, CheckCircle2, AlertCircle, ExternalLink, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/shared/ui/switch";
import { Badge } from "@/shared/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";

interface PlatformSettingsProps {
  onBack: () => void;
}

interface Platform {
  id: string;
  name: string;
  description: string;
  icon: string;
  connected: boolean;
  enabled: boolean; // 활성화 상태 (스위치로 제어)
  apiKey?: string;
  webhookUrl?: string;
  color: string;
}

const STORAGE_KEY = "roundnote-platform-settings";

export function PlatformSettings({ onBack }: PlatformSettingsProps) {
  const [platforms, setPlatforms] = useState<Platform[]>([
    {
      id: "notion",
      name: "Notion",
      description: "회의록을 Notion 데이터베이스에 자동으로 동기화합니다",
      icon: "📝",
      connected: false,
      enabled: false,
      color: "border-slate-300 bg-slate-50"
    },
    {
      id: "google-calendar",
      name: "Google Calendar",
      description: "액션 아이템을 Google Calendar 이벤트로 추가합니다",
      icon: "📅",
      connected: false,
      enabled: false,
      color: "border-blue-300 bg-blue-50"
    },
    {
      id: "jira",
      name: "Jira",
      description: "액션 아이템을 Jira 이슈로 생성합니다",
      icon: "🔷",
      connected: false,
      enabled: false,
      color: "border-indigo-300 bg-indigo-50"
    }
  ]);

  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [webhookInput, setWebhookInput] = useState("");

  useEffect(() => {
    // Load saved settings
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setPlatforms(JSON.parse(saved));
      } catch (error) {
        console.error("Failed to load platform settings:", error);
      }
    }

    // Jira 설정 확인
    const checkJiraSettings = async () => {
      try {
        const { getJiraSettings } = await import('@/features/meetings/reportsService');
        const settings = await getJiraSettings();

        if (settings && settings.is_active) {
          setPlatforms(prev => prev.map(p =>
            p.id === "jira"
              ? { ...p, connected: true, enabled: true }
              : p
          ));
        }
      } catch (error) {
        // Jira 설정이 없으면 연동 상태를 false로 설정
        console.log("No Jira settings found");
        setPlatforms(prev => prev.map(p =>
          p.id === "jira"
            ? { ...p, connected: false, enabled: false }
            : p
        ));
      }
    };

    // Notion 설정 확인
    const checkNotionSettings = async () => {
      try {
        const { getNotionSettings } = await import('@/features/meetings/reportsService');
        const settings = await getNotionSettings();

        if (settings && settings.is_active) {
          setPlatforms(prev => prev.map(p =>
            p.id === "notion"
              ? { ...p, connected: true, enabled: true }
              : p
          ));
        }
      } catch (error) {
        // Notion 설정이 없으면 연동 상태를 false로 설정
        console.log("No Notion settings found");
        setPlatforms(prev => prev.map(p =>
          p.id === "notion"
            ? { ...p, connected: false, enabled: false }
            : p
        ));
      }
    };

    checkJiraSettings();
    checkNotionSettings();
  }, []);

  const saveSettings = (updatedPlatforms: Platform[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedPlatforms));
    setPlatforms(updatedPlatforms);
  };

  // 상자 클릭 - 연동창 열기/닫기
  const handleCardClick = (platformId: string) => {
    const platform = platforms.find(p => p.id === platformId);

    if (expandedPlatform === platformId) {
      // 이미 열려있으면 닫기
      setExpandedPlatform(null);
      setApiKeyInput("");
      setWebhookInput("");
    } else {
      // 열기
      setExpandedPlatform(platformId);
      setApiKeyInput(platform?.apiKey || "");
      setWebhookInput(platform?.webhookUrl || "");
    }
  };

  // 스위치 토글 - 활성화/비활성화만
  const toggleEnabled = (platformId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 카드 클릭 이벤트 방지

    const platform = platforms.find(p => p.id === platformId);

    if (!platform?.connected) {
      toast.error("먼저 연동을 완료해주세요");
      return;
    }

    const updatedPlatforms = platforms.map(p =>
      p.id === platformId
        ? { ...p, enabled: !p.enabled }
        : p
    );

    saveSettings(updatedPlatforms);

    const newState = !platform.enabled;
    toast.success(`${platform.name} ${newState ? '활성화' : '비활성화'} 되었습니다`);
  };

  // 연동하기
  const saveConnection = async (platformId: string) => {
    const platform = platforms.find(p => p.id === platformId);

    if (platformId === "jira") {
      // Jira 연동 - Backend API 호출
      if (!webhookInput.trim() || !apiKeyInput.trim() || !(platform as any).tempEmail) {
        toast.error("모든 필수 항목을 입력해주세요");
        return;
      }

      try {
        const { saveJiraSettings } = await import('@/features/meetings/reportsService');

        toast.info("Jira 연결 중...");

        const result = await saveJiraSettings({
          base_url: webhookInput.trim(),
          email: (platform as any).tempEmail.trim(),
          api_token: apiKeyInput.trim(),
          default_project_key: (platform as any).tempProjectKey?.trim() || undefined,
        });

        const updatedPlatforms = platforms.map(p =>
          p.id === "jira"
            ? {
              ...p,
              connected: true,
              enabled: true,
              apiKey: apiKeyInput,
              webhookUrl: webhookInput,
              tempEmail: undefined,
              tempProjectKey: undefined
            }
            : p
        );

        saveSettings(updatedPlatforms);
        setExpandedPlatform(null);
        setApiKeyInput("");
        setWebhookInput("");

        toast.success(`Jira 연동 완료! (${result.projects_found}개 프로젝트 발견)`);
      } catch (error: any) {
        toast.error(`Jira 연동 실패: ${error.message}`);
      }
    } else if (platformId === "notion") {
      // Notion 연동 - Backend API 호출 (API 토큰만 저장)
      if (!apiKeyInput.trim()) {
        toast.error("API 토큰을 입력해주세요");
        return;
      }

      try {
        const { saveNotionSettings } = await import('@/features/meetings/reportsService');

        toast.info("Notion 연결 중...");

        // API 토큰만 저장 (페이지/DB는 export 시점에 선택)
        await saveNotionSettings({
          api_token: apiKeyInput.trim(),
        });

        const updatedPlatforms = platforms.map(p =>
          p.id === "notion"
            ? {
              ...p,
              connected: true,
              enabled: true,
              apiKey: apiKeyInput,
              tempParentPageId: undefined,
              tempDatabaseId: undefined
            }
            : p
        );

        saveSettings(updatedPlatforms);
        setExpandedPlatform(null);
        setApiKeyInput("");
        setWebhookInput("");

        toast.success("Notion 연동 완료! (내보낼 때 페이지를 선택할 수 있습니다)");
      } catch (error: any) {
        toast.error(`Notion 연동 실패: ${error.message}`);
      }
    } else {
      // 다른 플랫폼 (기존 로직)
      if (!apiKeyInput.trim()) {
        toast.error("API 키 또는 토큰을 입력해주세요");
        return;
      }

      const updatedPlatforms = platforms.map(p =>
        p.id === platformId
          ? { ...p, connected: true, enabled: true, apiKey: apiKeyInput, webhookUrl: webhookInput }
          : p
      );

      saveSettings(updatedPlatforms);
      setExpandedPlatform(null);
      setApiKeyInput("");
      setWebhookInput("");

      toast.success(`${platform?.name} 연동이 완료되었습니다`);
    }
  };

  // 연동 해제
  const disconnectPlatform = async (platformId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const platform = platforms.find(p => p.id === platformId);

    if (platformId === "jira") {
      try {
        const { deleteJiraSettings } = await import('@/features/meetings/reportsService');
        await deleteJiraSettings();

        const updatedPlatforms = platforms.map(p =>
          p.id === "jira"
            ? { ...p, connected: false, enabled: false, apiKey: undefined, webhookUrl: undefined }
            : p
        );

        saveSettings(updatedPlatforms);
        setExpandedPlatform(null);
        toast.success("Jira 연동이 해제되었습니다");
      } catch (error: any) {
        toast.error(`연동 해제 실패: ${error.message}`);
      }
    } else if (platformId === "notion") {
      try {
        const { deleteNotionSettings } = await import('@/features/meetings/reportsService');
        await deleteNotionSettings();

        const updatedPlatforms = platforms.map(p =>
          p.id === "notion"
            ? { ...p, connected: false, enabled: false, apiKey: undefined }
            : p
        );

        saveSettings(updatedPlatforms);
        setExpandedPlatform(null);
        toast.success("Notion 연동이 해제되었습니다");
      } catch (error: any) {
        toast.error(`연동 해제 실패: ${error.message}`);
      }
    } else {
      const updatedPlatforms = platforms.map(p =>
        p.id === platformId
          ? { ...p, connected: false, enabled: false, apiKey: undefined, webhookUrl: undefined }
          : p
      );

      saveSettings(updatedPlatforms);
      setExpandedPlatform(null);
      toast.success(`${platform?.name} 연동이 해제되었습니다`);
    }
  };

  return (
    <div className="bg-white rounded-2xl p-8 shadow-sm border border-border w-[1100px] max-w-[1100px] mx-auto">
      <div className="mb-6 flex items-center gap-4">
        <Button
          onClick={onBack}
          variant="ghost"
          size="icon"
          className="hover:bg-muted"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h2 className="text-foreground">연동 플랫폼 설정</h2>
          <p className="text-muted-foreground text-sm mt-1">
            다양한 플랫폼과 연동하여 회의록을 자동으로 공유합니다
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {platforms.map((platform) => (
          <Card
            key={platform.id}
            className={`p-6 border-2 ${platform.color} transition-all cursor-pointer hover:shadow-md ${expandedPlatform === platform.id ? 'ring-2 ring-primary' : ''
              }`}
            onClick={() => handleCardClick(platform.id)}
          >
            <div className="space-y-4">
              {/* Platform Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <span className="text-3xl">{platform.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Label className="text-lg">{platform.name}</Label>
                      {platform.connected && (
                        <Badge className="bg-green-500 hover:bg-green-600">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          연동됨
                        </Badge>
                      )}
                      {platform.connected && platform.enabled && (
                        <Badge className="bg-[#FFA726] hover:bg-[#FB8C00]">
                          활성
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {platform.description}
                    </p>
                  </div>
                </div>

                <div onClick={(e) => toggleEnabled(platform.id, e)}>
                  <Switch
                    checked={platform.enabled}
                    disabled={!platform.connected}
                  />
                </div>
              </div>

              {/* Configuration Form - 상자를 클릭하면 열림 */}
              {expandedPlatform === platform.id && !platform.connected && (
                <div className="mt-4 p-4 bg-white border-2 border-primary/20 rounded-lg space-y-4" onClick={(e) => e.stopPropagation()}>
                  {platform.id === "jira" ? (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="jira-base-url">
                          Jira Base URL *
                        </Label>
                        <Input
                          id="jira-base-url"
                          type="url"
                          placeholder="https://yourcompany.atlassian.net"
                          value={webhookInput}
                          onChange={(e) => setWebhookInput(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="jira-email">
                          Email *
                        </Label>
                        <Input
                          id="jira-email"
                          type="email"
                          placeholder="your-email@example.com"
                          value={(platform as any).tempEmail || ""}
                          onChange={(e) => {
                            setPlatforms(prev => prev.map(p =>
                              p.id === "jira" ? { ...p, tempEmail: e.target.value } : p
                            ));
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="jira-api-token">
                          API Token *
                        </Label>
                        <Input
                          id="jira-api-token"
                          type="password"
                          placeholder="Jira API 토큰을 입력하세요"
                          value={apiKeyInput}
                          onChange={(e) => setApiKeyInput(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="jira-project-key">
                          기본 프로젝트 키 (선택사항)
                        </Label>
                        <Input
                          id="jira-project-key"
                          type="text"
                          placeholder="PROJ"
                          value={(platform as any).tempProjectKey || ""}
                          onChange={(e) => {
                            setPlatforms(prev => prev.map(p =>
                              p.id === "jira" ? { ...p, tempProjectKey: e.target.value } : p
                            ));
                          }}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      {platform.id === "notion" ? (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="notion-api-token">
                              API Token *
                            </Label>
                            <Input
                              id="notion-api-token"
                              type="password"
                              placeholder="Notion Integration Token을 입력하세요"
                              value={apiKeyInput}
                              onChange={(e) => setApiKeyInput(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                              💡 페이지와 데이터베이스는 회의록을 내보낼 때 선택할 수 있습니다
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor={`${platform.id}-api-key`}>
                              API 키 / 토큰 *
                            </Label>
                            <Input
                              id={`${platform.id}-api-key`}
                              type="password"
                              placeholder={`${platform.name} API 키 또는 토큰을 입력하세요`}
                              value={apiKeyInput}
                              onChange={(e) => setApiKeyInput(e.target.value)}
                            />
                          </div>
                        </>
                      )}
                    </>
                  )}

                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={() => saveConnection(platform.id)}
                      size="sm"
                      className="gap-2 bg-primary hover:bg-primary/90"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      연동하기
                    </Button>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedPlatform(null);
                        setApiKeyInput("");
                        setWebhookInput("");
                      }}
                      size="sm"
                      variant="outline"
                    >
                      취소
                    </Button>
                  </div>

                  <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium mb-2">💡 API 키 발급 방법</p>
                        {platform.id === 'notion' && (
                          <>
                            <ol className="list-decimal list-inside space-y-1 mb-2">
                              <li>Notion 계정으로 로그인</li>
                              <li>설정 → 연동 (Integrations) 이동</li>
                              <li>"새 통합 개발" 클릭</li>
                              <li>Internal Integration 선택 후 이름 입력</li>
                              <li>"Internal Integration Token" 복사</li>
                            </ol>
                            <a
                              href="https://www.notion.so/my-integrations"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-blue-600 hover:underline font-medium"
                            >
                              Notion Integration 페이지 열기
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        )}
                        {platform.id === 'jira' && (
                          <>
                            <ol className="list-decimal list-inside space-y-1 mb-2">
                              <li>Atlassian 계정 설정 페이지 이동</li>
                              <li>보안 → API 토큰 선택</li>
                              <li>"토큰 만들기" 클릭</li>
                              <li>토큰 이름 입력 후 생성</li>
                              <li>생성된 토큰 복사 (한 번만 표시됨)</li>
                            </ol>
                            <a
                              href="https://id.atlassian.com/manage-profile/security/api-tokens"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-blue-600 hover:underline font-medium"
                            >
                              Jira API 토큰 생성 페이지 열기
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        )}
                        {platform.id === 'google-calendar' && (
                          <>
                            <ol className="list-decimal list-inside space-y-1 mb-2">
                              <li>Google Cloud Console 접속</li>
                              <li>프로젝트 생성 또는 선택</li>
                              <li>"API 및 서비스" → "사용자 인증 정보" 이동</li>
                              <li>"사용자 인증 정보 만들기" → "OAuth 클라이언트 ID" 선택</li>
                              <li>웹 애플리케이션 유형 선택 후 생성</li>
                              <li>클라이언트 ID 및 비밀번호 복사</li>
                            </ol>
                            <a
                              href="https://console.cloud.google.com/apis/credentials"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-blue-600 hover:underline font-medium"
                            >
                              Google Cloud Console 열기
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Connected Info - 상자를 클릭하면 열림 */}
              {expandedPlatform === platform.id && platform.connected && (
                <div className="mt-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                      <div className="text-sm text-green-700 flex-1">
                        <p className="">연동 완료</p>
                        <p className="text-xs mt-1">
                          회의록이 자동으로 {platform.name}에 동기화됩니다
                        </p>
                      </div>
                    </div>
                  </div>

                  <Button
                    onClick={(e) => disconnectPlatform(platform.id, e)}
                    size="sm"
                    variant="destructive"
                    className="gap-2 w-full"
                  >
                    <XCircle className="w-4 h-4" />
                    연동 해제
                  </Button>
                </div>
              )}
            </div>
          </Card>
        ))}

        {/* Summary */}
        <Card className="p-6 bg-primary/5 border-primary/20">
          <div className="flex items-start gap-3">
            <Link2 className="w-5 h-5 text-primary mt-0.5" />
            <div>
              <Label className="text-base text-foreground">연동 상태</Label>
              <p className="text-sm text-muted-foreground mt-1">
                현재 {platforms.filter(p => p.connected).length}개의 플랫폼이 연동되어 있습니다
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {platforms
                  .filter(p => p.connected)
                  .map(p => (
                    <Badge key={p.id} variant="secondary" className={p.enabled ? "bg-[#FFA726] text-white" : ""}>
                      {p.icon} {p.name} {p.enabled && "✓"}
                    </Badge>
                  ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Info */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm text-blue-900 mb-2">💡 플랫폼 연동 안내</h4>
          <ul className="space-y-1 text-sm text-blue-700">
            <li>• 카드를 클릭하면 연동 설정을 할 수 있습니다</li>
            <li>• 스위치는 연동된 플랫폼의 활성화/비활성화를 제어합니다</li>
            <li>• API 키는 안전하게 로컬 스토리지에 저장됩니다</li>
            <li>• 연동을 해제하면 저장된 API 키가 삭제됩니다</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
