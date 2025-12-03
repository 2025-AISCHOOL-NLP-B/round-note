import { useState, useEffect, useCallback, useRef } from 'react';

export interface MeetingArtifacts {
  meeting_id: string;
  final_transcript_status: 'queued' | 'processing' | 'done' | 'error' | null;
  final_transcript_error: string | null;
  final_transcript_url: string | null;
  final_transcript_text: string | null;
  summary: {
    summary_id: string;
    content: string;
    translated_content: string | null;
    format: string;
    created_dt: string;
  } | null;
  action_items: Array<{
    item_id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string | null;
    assignee_id: string | null;
    assignee_name: string | null;
    jira_assignee_id: string | null;
    due_dt: string | null;
    created_dt: string;
    updated_dt: string | null;
  }>;
}

interface UseMeetingArtifactsOptions {
  pollInterval?: number; // ms, default 3000
  enabled?: boolean; // default true
  onStatusChange?: (status: MeetingArtifacts['final_transcript_status']) => void;
}

interface UseMeetingArtifactsResult {
  artifacts: MeetingArtifacts | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
}

/**
 * 회의 최종 전사/요약/액션 아이템 상태를 폴링하는 훅
 * ElevenLabs 재전사 파이프라인 완료 여부 추적용
 */
export function useMeetingArtifacts(
  meetingId: string | null,
  options: UseMeetingArtifactsOptions = {}
): UseMeetingArtifactsResult {
  const {
    pollInterval = 3000,
    enabled = true,
    onStatusChange,
  } = options;

  const [artifacts, setArtifacts] = useState<MeetingArtifacts | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const previousStatusRef = useRef<MeetingArtifacts['final_transcript_status']>(null);

  // Fetch artifacts from backend
  const fetchArtifacts = useCallback(async () => {
    if (!meetingId) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/meetings/${meetingId}/artifacts`,
        {
          credentials: 'include', // httpOnly cookie auth
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch artifacts: ${response.statusText}`);
      }

      const data: MeetingArtifacts = await response.json();
      setArtifacts(data);

      // Notify status change
      if (onStatusChange && data.final_transcript_status !== previousStatusRef.current) {
        previousStatusRef.current = data.final_transcript_status;
        onStatusChange(data.final_transcript_status);
      }

      // Auto-stop polling when done or error
      if (data.final_transcript_status === 'done' || data.final_transcript_status === 'error') {
        stopPolling();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch artifacts';
      setError(message);
      console.error('useMeetingArtifacts error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [meetingId, onStatusChange]);

  // Start polling
  const startPolling = useCallback(() => {
    if (!meetingId || isPolling) return;
    setIsPolling(true);
  }, [meetingId, isPolling]);

  // Stop polling
  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Polling loop
  useEffect(() => {
    if (!enabled || !meetingId || !isPolling) return;

    const poll = async () => {
      await fetchArtifacts();
      
      // Schedule next poll if still polling
      if (isPolling) {
        pollTimeoutRef.current = setTimeout(poll, pollInterval);
      }
    };

    poll();

    return () => {
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [enabled, meetingId, isPolling, pollInterval, fetchArtifacts]);

  // Initial fetch on mount
  useEffect(() => {
    if (enabled && meetingId) {
      fetchArtifacts();
    }
  }, [enabled, meetingId, fetchArtifacts]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  return {
    artifacts,
    isLoading,
    error,
    refetch: fetchArtifacts,
    startPolling,
    stopPolling,
  };
}
