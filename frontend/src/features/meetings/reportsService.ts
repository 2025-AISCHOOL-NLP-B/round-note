/**
 * Reports API 서비스
 * 백엔드 /api/v1/reports 엔드포인트와 통신
 * LLM 기반 요약, 액션 아이템 추출 등을 처리
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// 토큰을 로컬스토리지에서 가져오는 헬퍼 함수
const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('access_token');
};

// 공통 헤더 생성
const getHeaders = (): HeadersInit => {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
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
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/summary`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch summary' }));
    throw new Error(error.detail || 'Failed to fetch summary');
  }

  return response.json();
};

/**
 * 액션 아이템 목록 조회
 */
export const getMeetingActionItems = async (meetingId: string): Promise<ActionItemResponse[]> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch action items' }));
    throw new Error(error.detail || 'Failed to fetch action items');
  }

  return response.json();
};

/**
 * 전체 보고서 조회 (요약 + 액션 아이템 + 전사 내용)
 */
export const getFullReport = async (meetingId: string): Promise<FullReportResponse> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/full`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch full report' }));
    throw new Error(error.detail || 'Failed to fetch full report');
  }

  return response.json();
};

/**
 * 요약 및 액션 아이템 재생성 (LLM 호출)
 */
export const regenerateSummary = async (meetingId: string): Promise<RegenerateResponse> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/regenerate`, {
    method: 'POST',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to regenerate summary' }));
    throw new Error(error.detail || 'Failed to regenerate summary');
  }

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
    {
      method: 'GET',
      headers: getHeaders(),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Search failed' }));
    throw new Error(error.detail || 'Search failed');
  }

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
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/chat`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      message,
      history,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Chat failed' }));
    throw new Error(error.detail || 'Chat failed');
  }

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
  const response = await fetch(`${API_URL}/api/v1/settings/jira`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(settings),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to save Jira settings' }));
    throw new Error(error.detail || 'Failed to save Jira settings');
  }

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
  const response = await fetch(`${API_URL}/api/v1/settings/jira`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Jira settings not found' }));
    throw new Error(error.detail || 'Jira settings not found');
  }

  return response.json();
};

/**
 * Jira 설정 삭제
 */
export const deleteJiraSettings = async (): Promise<{ message: string }> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to delete Jira settings' }));
    throw new Error(error.detail || 'Failed to delete Jira settings');
  }

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
  const response = await fetch(`${API_URL}/api/v1/settings/jira/projects/${projectKey}/users`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch Jira users' }));
    throw new Error(error.detail || 'Failed to fetch Jira users');
  }

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
  const response = await fetch(`${API_URL}/api/v1/settings/jira/projects/${projectKey}/priorities`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch Jira priorities' }));
    throw new Error(error.detail || 'Failed to fetch Jira priorities');
  }

  return response.json();
};

/**
 * Jira 프로젝트 목록 조회
 */
export const getJiraProjects = async (): Promise<{
  projects: Array<{ key: string; name: string; id: string }>;
  default_project_key?: string;
}> => {
  const response = await fetch(`${API_URL}/api/v1/settings/jira/projects`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to fetch Jira projects' }));
    throw new Error(error.detail || 'Failed to fetch Jira projects');
  }

  return response.json();
};

/**
 * Jira로 액션 아이템 내보내기 (프로젝트 선택)
 */
export const pushToJira = async (
  meetingId: string,
  projectKey: string
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
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items/to-jira`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ project_key: projectKey }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to push to Jira' }));
    throw new Error(error.detail || 'Failed to push to Jira');
  }

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
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(item),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to create action item' }));
    throw new Error(error.detail || 'Failed to create action item');
  }

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
    const response = await fetch(url, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(updates),
    });

    console.log('[updateActionItem] Response status:', response.status, response.statusText);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Failed to update action item' }));
      const errorMessage = typeof error.detail === 'string' ? error.detail : JSON.stringify(error);
      console.error('[updateActionItem] Error response:', error);
      throw new Error(errorMessage);
    }

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
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/action-items/${itemId}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to delete action item' }));
    throw new Error(error.detail || 'Failed to delete action item');
  }

  return response.json();
};

/**
 * Notion으로 보고서 내보내기
 */
export const pushToNotion = async (meetingId: string): Promise<any> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/report/to-notion`, {
    method: 'POST',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to push to Notion' }));
    throw new Error(error.detail || 'Failed to push to Notion');
  }

  return response.json();
};

/**
 * Notion으로 포괄적 회의록 내보내기 (멘토 피드백 반영)
 * - 참석자, 요약, 액션 아이템 필수 포함
 * - 날짜 형식: 2024년 11월 25일 (월) 14:00 - 15:30
 */
export const exportToNotionComprehensive = async (meetingId: string): Promise<{
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
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to export to Notion' }));
    throw new Error(error.detail || 'Failed to export to Notion');
  }

  return response.json();
};

/**
 * Notion에 액션 아이템만 내보내기
 */
export const exportActionItemsToNotion = async (meetingId: string): Promise<{
  success: boolean;
  created_count: number;
  items: Array<{ id: string; url: string }>;
  message: string;
}> => {
  const response = await fetch(`${API_URL}/api/v1/reports/${meetingId}/notion/action-items`, {
    method: 'POST',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Failed to export action items to Notion' }));
    throw new Error(error.detail || 'Failed to export action items to Notion');
  }

  return response.json();
};
