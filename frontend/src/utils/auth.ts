/**
 * 인증 관련 유틸리티 함수
 * httpOnly Cookie 기반 인증 시스템 + 토큰 갱신 메커니즘
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// 토큰 갱신 중 플래그 (중복 요청 방지)
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach(callback => callback(token));
}

function addRefreshSubscriber(callback: (token: string) => void) {
  refreshSubscribers.push(callback);
}

/**
 * 로그인 페이지로 리다이렉트 (클라이언트 사이드만)
 */
export function redirectToLogin(nextPath?: string) {
  if (typeof window !== 'undefined') {
    const target = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : '/login';
    window.location.href = target;
  }
}

/**
 * 인증 실패 공통 처리: 로그아웃 요청 후 로그인 페이지로 이동
 */
export async function handleAuthFailure(message?: string) {
  try {
    await logout();
  } catch {
    // ignore
  }
  const current = typeof window !== 'undefined' ? window.location.pathname : undefined;
  redirectToLogin(current);
  throw new Error(message || '인증이 필요합니다. 다시 로그인해주세요.');
}

/**
 * 토큰 갱신 시도
 * @returns 성공 시 true, 실패 시 false
 */
async function tryRefreshToken(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (response.ok) {
      return true;
    }

    // 갱신 실패 시 로그인 필요
    if (response.status === 401) {
      await handleAuthFailure('세션이 만료되었습니다. 다시 로그인해주세요.');
    }
    return false;
  } catch (error) {
    console.error('Token refresh error:', error);
    return false;
  }
}

/**
 * 공통 응답 처리: 401/403 시 토큰 갱신 시도, 실패 시 인증 실패 처리
 */
export async function handleAuthResponse(response: Response): Promise<Response> {
  if (response.ok) return response;

  // 안전하게 본문 파싱 시도
  const body = await response.json().catch(async () => {
    const text = await response.text().catch(() => '');
    return { detail: text?.slice(0, 200) || response.statusText || 'Request failed' };
  });

  if (response.status === 401 || response.status === 403) {
    // 토큰 만료로 인한 401인 경우, 갱신 시도
    if (response.status === 401 && !isRefreshing) {
      isRefreshing = true;
      const refreshed = await tryRefreshToken();
      isRefreshing = false;
      
      if (refreshed) {
        onRefreshed('');
        // 재시도하지 말고 요청을 다시 보내도록 클라이언트에 위임
        throw new Error('TOKEN_REFRESHED');
      }
    }

    await handleAuthFailure(typeof body.detail === 'string' ? body.detail : undefined);
  }

  throw new Error(typeof body.detail === 'string' ? body.detail : `Request failed with status ${response.status}`);
}

/**
 * credentials 포함 + 인증 응답 처리까지 수행하는 fetch 래퍼
 * 401 응답 시 토큰 갱신을 시도합니다.
 */
export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const options: RequestInit = {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  };

  try {
    const res = await fetch(input, options);
    return await handleAuthResponse(res);
  } catch (error: any) {
    // 토큰이 갱신된 경우 재시도
    if (error?.message === 'TOKEN_REFRESHED') {
      // 갱신된 토큰으로 재시도
      return fetch(input, options)
        .then(res => handleAuthResponse(res));
    }
    throw error;
  }
}

/**
 * 서버에 현재 사용자 정보를 요청하여 인증 상태 확인
 * @returns 인증된 경우 사용자 정보, 아니면 null
 */
export async function checkAuth(): Promise<{ id: string; email: string; name: string } | null> {
  try {
    const response = await fetch(`${API_URL}/api/v1/auth/me`, {
      method: 'GET',
      credentials: 'include', // httpOnly Cookie 전송
    });

    if (response.ok) {
      const data = await response.json();
      // 백엔드 응답 형식을 프론트엔드 형식으로 변환
      return {
        id: data.user_id || data.USER_ID,
        email: data.email || data.EMAIL,
        name: data.name || data.NAME,
      };
    }

    // 401 Unauthorized는 정상적인 응답 (로그인하지 않은 상태)
    if (response.status === 401) {
      return null;
    }

    return null;
  } catch (error) {
    console.error('Authentication check failed:', error);
    return null;
  }
}

/**
 * 로그아웃 처리
 */
export async function logout(): Promise<void> {
  try {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include', // httpOnly Cookie 전송
    });
  } catch (error) {
    console.error('Logout failed:', error);
  }
}
