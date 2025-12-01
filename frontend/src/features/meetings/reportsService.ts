/**
 * Reports API 서비스
 * 백엔드 /api/v1/reports 엔드포인트와 통신
 * LLM 기반 요약, 액션 아이템 추출 등을 처리
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
import { handleAuthResponse } from '@/utils/auth';

// 공통 헤더 생성 (httpOnly Cookie 사용)
const getHeaders = (): HeadersInit => {
  return {
    'Content-Type': 'application/json'
  };
};

// 공통 fetch 옵션 (credentials 포함)
const getFetchOptions = (options: RequestInit = {}): RequestInit => {
  return {
    ...options,
    credentials: 'include',
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  };
};

// ==================== 타입 정의 ====================

export interface SummaryResponse {
  summary_id: string;
  meeting_id: string;
  format: string;
  content: string;
  created_dt: string;
}

export interface ActionItemResponse {
  item_id: string;
  meeting_id: string;
  title: string;
  description?: string;
  due_dt?: string;
  priority?: string;
  status: string;
  assignee_id?: string;
  external_tool?: string;
  created_dt: string;
  updated_dt?: string;
}

export interface FullReportResponse {
  meeting_id: string;
  summary: SummaryResponse | null;
  action_items: ActionItemResponse[];
  full_transcript: string | null;
}

export interface RegenerateResponse {
  message: string;
  meeting_id: string;
  summary: string;
  action_items_count: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  answer: string;
  sources?: string[];
}

// ==================== API 함수 ====================

/**
 * 회의 요약 조회
 */
export const getMeetingSummary = async (meetingId: string): Promise<SummaryResponse> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/summary`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 액션 아이템 목록 조회
 */
export const getMeetingActionItems = async (meetingId: string): Promise<ActionItemResponse[]> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 전체 보고서 조회 (요약 + 액션 아이템 + 전사 내용)
 */
export const getFullReport = async (meetingId: string): Promise<FullReportResponse> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/full`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 요약 및 액션 아이템 재생성 (LLM 호출)
 */
export const regenerateSummary = async (meetingId: string): Promise<RegenerateResponse> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/regenerate`, 
    getFetchOptions({ method: 'POST' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 회의 내용 검색 (RAG 기반) - TODO: 백엔드 구현 후 활성화
 */
export const searchMeetingContent = async (
  meetingId: string, 
  query: string
): Promise<{ results: string[] }> => {
  const response = await fetch(
    `${API_URL}/api/v1/reports/${meetingId}/search?query=${encodeURIComponent(query)}`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 챗봇 질문 (회의 내용 기반 Q&A)
 */
export const chatWithMeeting = async (
  meetingId: string,
  message: string,
  history: ChatMessage[] = []
): Promise<ChatResponse> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/chat`, 
    getFetchOptions({
      method: 'POST',
      body: JSON.stringify({
        message,
        history,
      }),
    })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Jira 설정 저장
 */
export const saveJiraSettings = async (settings: {
  base_url: string;
  email: string;
  api_token: string;
  default_project_key?: string;
}): Promise<{ message: string; projects_found: number }> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira`, 
    getFetchOptions({
      method: 'POST',
      body: JSON.stringify(settings),
    })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Jira 설정 조회
 */
export const getJiraSettings = async (): Promise<{
  base_url: string;
  email: string;
  default_project_key?: string;
  is_active: boolean;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Jira 설정 삭제
 */
export const deleteJiraSettings = async (): Promise<{ message: string }> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira`, 
    getFetchOptions({ method: 'DELETE' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion 설정 저장 (API 토큰만)
 */
export const saveNotionSettings = async (settings: {
  api_token: string;
}): Promise<{ message: string }> => {
  const response = await fetch(`${API_URL}/api/v1/settings/notion`, 
    getFetchOptions({
      method: 'POST',
      body: JSON.stringify(settings),
    })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion 설정 조회 (연동 상태만)
 */
export const getNotionSettings = async (): Promise<{
  is_active: boolean;
  created_dt?: string;
  updated_dt?: string;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/notion`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion 설정 삭제
 */
export const deleteNotionSettings = async (): Promise<{ message: string }> => {
  const response = await fetch(`${API_URL}/api/v1/settings/notion`, 
    getFetchOptions({ method: 'DELETE' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion 페이지 목록 조회 (연동 전 - API 토큰 검증용)
 */
export const searchNotionPages = async (apiToken: string): Promise<{
  pages: Array<{ id: string; title: string; url: string }>;
  count: number;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/notion/pages`, 
    getFetchOptions({
      method: 'POST',
      body: JSON.stringify({ api_token: apiToken }),
    })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion 데이터베이스 목록 조회 (연동 전 - API 토큰 검증용)
 */
export const searchNotionDatabases = async (apiToken: string): Promise<{
  databases: Array<{ id: string; title: string; url: string }>;
  count: number;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/notion/databases`, 
    getFetchOptions({
      method: 'POST',
      body: JSON.stringify({ api_token: apiToken }),
    })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 내 Notion 페이지 목록 조회 (연동 후 - 저장된 토큰 사용)
 */
export const getMyNotionPages = async (): Promise<{
  pages: Array<{ id: string; title: string; url: string }>;
  count: number;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/notion/my-pages`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 내 Notion 데이터베이스 목록 조회 (연동 후 - 저장된 토큰 사용)
 */
export const getMyNotionDatabases = async (): Promise<{
  databases: Array<{ id: string; title: string; url: string }>;
  count: number;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/notion/my-databases`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Jira 프로젝트의 담당 가능한 사용자 목록 조회
 */
export const getJiraProjectUsers = async (projectKey: string): Promise<{
  users: Array<{
    account_id: string;
    display_name: string;
    email: string;
    avatar_url?: string;
  }>;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira/projects/${projectKey}/users`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Jira 프로젝트의 우선순위 목록 조회
 */
export const getJiraPriorities = async (projectKey: string): Promise<{
  priorities: Array<{
    id: string;
    name: string;
    icon_url?: string;
    description: string;
  }>;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira/projects/${projectKey}/priorities`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Jira 프로젝트 목록 조회
 */
export const getJiraProjects = async (): Promise<{
  projects: Array<{ key: string; name: string; id: string }>;
  default_project_key?: string;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira/projects`, 
    getFetchOptions({ method: 'GET' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Jira로 액션 아이템 내보내기 (프로젝트 선택)
 */
export const pushToJira = async (
  meetingId: string,
  projectKey: string,
  itemIds?: string[]
): Promise<{
  message: string;
  project_key: string;
  jira_base_url: string;
  created: Array<{ item_id: string; issue_key: string; issue_url: string; action: string }>;
  updated: Array<{ item_id: string; issue_key: string; issue_url: string; action: string }>;
  failed: Array<{ item_id: string; title: string; error: string }>;
  summary: {
    total: number;
    created_count: number;
    updated_count: number;
    failed_count: number;
  };
}> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items/to-jira`, 
    getFetchOptions({
      method: 'POST',
      body: JSON.stringify({ 
        project_key: projectKey,
        item_ids: itemIds
      }),
    })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 액션 아이템 생성
 */
export const createActionItem = async (
  meetingId: string,
  item: {
    title: string;
    description?: string;
    due_dt?: string;
    priority?: string;
    assignee_id?: string;
    assignee_name?: string;
    jira_assignee_id?: string;
  }
): Promise<any> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items`, 
    getFetchOptions({
      method: 'POST',
      body: JSON.stringify(item),
    })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * 액션 아이템 수정
 */
export const updateActionItem = async (
  meetingId: string,
  itemId: string,
  updates: {
    title?: string;
    description?: string;
    due_dt?: string;
    priority?: string;
    status?: string;
    assignee_id?: string;
    assignee_name?: string;
    jira_assignee_id?: string;
  }
): Promise<any> => {
  const url = `${API_URL}/api/v1/reports/${meetingId}/action-items/${itemId}`;
  console.log('[updateActionItem] Request:', { url, meetingId, itemId, updates });
  
  try {
    const response = await fetch(url, 
      getFetchOptions({
        method: 'PATCH',
        body: JSON.stringify(updates),
      })
    );

    console.log('[updateActionItem] Response status:', response.status, response.statusText);

    await handleAuthResponse(response);

    const result = await response.json();
    console.log('[updateActionItem] Success:', result);
    return result;
  } catch (error) {
    console.error('[updateActionItem] Network error:', error);
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`네트워크 오류: 백엔드 서버에 연결할 수 없습니다. URL: ${url}`);
    }
    throw error;
  }
};

/**
 * 액션 아이템 삭제
 */
export const deleteActionItem = async (
  meetingId: string,
  itemId: string
): Promise<{ message: string; item_id: string }> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items/${itemId}`, 
    getFetchOptions({ method: 'DELETE' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion으로 보고서 내보내기
 */
export const pushToNotion = async (meetingId: string): Promise<any> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/report/to-notion`, 
    getFetchOptions({ method: 'POST' })
  );

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion으로 포괄적 회의록 내보내기 (멘토 피드백 반영)
 * - 참석자, 요약, 액션 아이템 필수 포함
 * - 날짜 형식: 2024년 11월 25일 (월) 14:00 - 15:30
 */
export const exportToNotionComprehensive = async (
  meetingId: string,
  parentPageId?: string
): Promise<{
  success: boolean;
  notion_page_id: string;
  notion_url: string;
  message: string;
  included: {
    participants: number;
    summary: boolean;
    action_items: number;
  };
}> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/notion/comprehensive`, {
    method: 'POST',
    headers: getHeaders(),
    credentials: 'include',
    body: JSON.stringify({ parent_page_id: parentPageId }),
  });

  await handleAuthResponse(response);

  return response.json();
};

/**
 * Notion에 액션 아이템만 내보내기
 */
export const exportActionItemsToNotion = async (
  meetingId: string,
  databaseId?: string
): Promise<{
  success: boolean;
  created_count: number;
  items: Array<{ id: string; url: string }>;
  message: string;
}> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/notion/action-items`, {
    method: 'POST',
    headers: getHeaders(),
    credentials: 'include',
    body: JSON.stringify({ database_id: databaseId }),
  });

  await handleAuthResponse(response);

  return response.json();
};

// ==================== Aliases & Helpers for NotionExportButtonV3 ====================

/**
 * 포괄적 회의록 미리보기 (NotionExportButtonV3용)
 * 실제로는 full report를 가져와서 통계를 계산
 */
export const previewComprehensiveReport = async (meetingId: string): Promise<{
  participants_count: number;
  absent_count: number;
  discussions_count: number;
  action_items_count: number;
}> => {
  try {
    // Fetch full report to get summary and action items
    const report = await getFullReport(meetingId);
    
    // Estimate counts
    const actionItemsCount = report.action_items ? report.action_items.length : 0;
    
    // Estimate discussions from summary content (e.g. bullet points)
    const summaryContent = report.summary?.content || '';
    // Count bullet points or lines as a proxy for discussions
    const discussionsCount = (summaryContent.match(/^- /gm) || []).length || 
                             (summaryContent.split('\n').filter(line => line.trim().length > 0).length);
    
    return {
      participants_count: 1, // Default to 1 (host) as we don't track participants fully yet
      absent_count: 0,
      discussions_count: discussionsCount,
      action_items_count: actionItemsCount
    };
  } catch (error) {
    console.error('Failed to preview report:', error);
    return {
      participants_count: 0,
      absent_count: 0,
      discussions_count: 0,
      action_items_count: 0
    };
  }
};

export const pushComprehensiveReportToNotion = async (meetingId: string, parentPageId?: string) => {
  const result = await exportToNotionComprehensive(meetingId, parentPageId);
  return {
    ...result,
    participants_count: result.included.participants,
    absent_count: 0,
    discussions_count: 0,
    decisions_count: 0,
    action_items_count: result.included.action_items,
    pending_issues_count: 0
  };
};

export const pushReportToNotion = pushToNotion;
export const pushActionItemsToNotion = async (meetingId: string, databaseId?: string) => {
  const result = await exportActionItemsToNotion(meetingId, databaseId);
  return {
    ...result,
    notion_url: result.items.length > 0 ? result.items[0].url : ''
  };
};

