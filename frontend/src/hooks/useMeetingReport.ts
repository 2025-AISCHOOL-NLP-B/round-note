import { useState, useCallback } from 'react';
import {
  getMeetingSummary,
  getMeetingActionItems,
  getFullReport,
  regenerateSummary,
  type SummaryResponse,
  type ActionItemResponse,
  type FullReportResponse,
} from '@/features/meetings/reportsService';

interface UseMeetingReportResult {
  // 상태
  summary: SummaryResponse | null;
  actionItems: ActionItemResponse[];
  fullReport: FullReportResponse | null;
  isLoading: boolean;
  isRegenerating: boolean;
  error: string | null;
  
  // 액션
  fetchSummary: (meetingId: string) => Promise<void>;
  fetchActionItems: (meetingId: string) => Promise<void>;
  fetchFullReport: (meetingId: string) => Promise<void>;
  regenerate: (meetingId: string) => Promise<boolean>;
  clearError: () => void;
}

/**
 * 회의 보고서 관련 데이터를 관리하는 훅
 * 백엔드 LLM API와 연동
 */
export function useMeetingReport(): UseMeetingReportResult {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [actionItems, setActionItems] = useState<ActionItemResponse[]>([]);
  const [fullReport, setFullReport] = useState<FullReportResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 요약 조회
  const fetchSummary = useCallback(async (meetingId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await getMeetingSummary(meetingId);
      setSummary(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : '요약을 불러오는데 실패했습니다.';
      setError(message);
      console.error('Failed to fetch summary:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 액션 아이템 조회
  const fetchActionItems = useCallback(async (meetingId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await getMeetingActionItems(meetingId);
      setActionItems(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : '액션 아이템을 불러오는데 실패했습니다.';
      setError(message);
      console.error('Failed to fetch action items:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 전체 보고서 조회
  const fetchFullReport = useCallback(async (meetingId: string) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const data = await getFullReport(meetingId);
      setFullReport(data);
      
      // 개별 상태도 업데이트
      if (data.summary) {
        setSummary(data.summary);
      }
      setActionItems(data.action_items);
    } catch (err) {
      const message = err instanceof Error ? err.message : '보고서를 불러오는데 실패했습니다.';
      setError(message);
      console.error('Failed to fetch full report:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 요약 및 액션 아이템 재생성
  const regenerate = useCallback(async (meetingId: string): Promise<boolean> => {
    setIsRegenerating(true);
    setError(null);
    
    try {
      const result = await regenerateSummary(meetingId);
      
      // 재생성 후 새 데이터 조회
      await fetchFullReport(meetingId);
      
      console.log('Regeneration successful:', result);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '재생성에 실패했습니다.';
      setError(message);
      console.error('Failed to regenerate:', err);
      return false;
    } finally {
      setIsRegenerating(false);
    }
  }, [fetchFullReport]);

  // 에러 초기화
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    summary,
    actionItems,
    fullReport,
    isLoading,
    isRegenerating,
    error,
    fetchSummary,
    fetchActionItems,
    fetchFullReport,
    regenerate,
    clearError,
  };
}

// 액션 아이템을 프론트엔드 형식으로 변환하는 유틸리티
export function convertActionItemsToFrontend(
  items: ActionItemResponse[]
): Array<{
  id: string;
  text: string;
  assignee: string;
  dueDate: string;
  completed: boolean;
  priority?: string;
}> {
  return items.map(item => ({
    id: item.item_id,
    text: item.title,
    assignee: item.assignee_id || '미정',
    dueDate: item.due_dt ? new Date(item.due_dt).toISOString().split('T')[0] : '',
    completed: item.status === 'DONE',
    priority: item.priority,
  }));
}
