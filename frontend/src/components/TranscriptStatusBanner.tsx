import React from 'react';

interface TranscriptStatusBannerProps {
  status: 'queued' | 'processing' | 'done' | 'error' | null;
  error?: string | null;
  onRetry?: () => void;
}

/**
 * ElevenLabs 재전사 파이프라인 상태를 표시하는 배너
 */
export function TranscriptStatusBanner({
  status,
  error,
  onRetry,
}: TranscriptStatusBannerProps) {
  if (!status || status === 'done') {
    return null; // 상태 없거나 완료 시 배너 숨김
  }

  const getStatusConfig = () => {
    switch (status) {
      case 'queued':
        return {
          bg: 'bg-blue-50 border-blue-200',
          icon: '⏳',
          title: '전사 대기 중',
          message: '고품질 전사 작업이 대기열에 등록되었습니다.',
          textColor: 'text-blue-800',
        };
      case 'processing':
        return {
          bg: 'bg-yellow-50 border-yellow-200',
          icon: '🔄',
          title: '전사 진행 중',
          message: 'ElevenLabs API를 통해 전사를 생성하고 있습니다...',
          textColor: 'text-yellow-800',
        };
      case 'error':
        return {
          bg: 'bg-red-50 border-red-200',
          icon: '❌',
          title: '전사 실패',
          message: error || '전사 중 오류가 발생했습니다.',
          textColor: 'text-red-800',
        };
      default:
        return null;
    }
  };

  const config = getStatusConfig();
  if (!config) return null;

  return (
    <div
      className={`${config.bg} border rounded-lg p-4 mb-4 flex items-start gap-3`}
      role="status"
      aria-live="polite"
    >
      <span className="text-2xl" role="img" aria-label={config.title}>
        {config.icon}
      </span>
      <div className="flex-1">
        <h3 className={`font-semibold ${config.textColor}`}>{config.title}</h3>
        <p className={`text-sm ${config.textColor} mt-1`}>{config.message}</p>
      </div>
      {status === 'error' && onRetry && (
        <button
          onClick={onRetry}
          className="px-3 py-1 bg-red-600 text-white text-sm rounded hover:bg-red-700 transition-colors"
        >
          재시도
        </button>
      )}
    </div>
  );
}

interface TranscriptDisplayProps {
  transcript: string | null;
  isLoading?: boolean;
}

/**
 * Parse speaker-labeled transcript segments from backend format:
 * "[00시 15분 30초] Speaker 1\nHello world\n\n[00시 16분 05초] Speaker 2\nHow are you?"
 */
function parseTranscriptSegments(transcript: string) {
  if (!transcript) return [];
  
  // Split by double newlines (segment separator)
  const segments = transcript.split('\n\n').filter(s => s.trim());
  
  const parsed = segments.map((segment, idx) => {
    // Match pattern: [HH시 MM분 SS초] Speaker Name\nText content
    const lines = segment.split('\n');
    const headerMatch = lines[0]?.match(/^\[(\d{2}시\s+\d{2}분\s+\d{2}초)\]\s+(.+)$/);
    
    if (headerMatch) {
      const [, timestamp, speaker] = headerMatch;
      const text = lines.slice(1).join('\n').trim();
      return {
        id: `seg-${idx}`,
        timestamp,
        speaker,
        text: text || lines[0] // Fallback if no text after header
      };
    }
    
    // Fallback: treat entire segment as text with default speaker
    return {
      id: `seg-${idx}`,
      timestamp: '00시 00분 00초',
      speaker: 'Speaker',
      text: segment.trim()
    };
  });

  // Post-process: split overly long segments by punctuation into smaller bubbles
  const maxCharsPerBubble = 220; // threshold for bubble length
  const sentenceSplitter = /(?<=\.|\?|!|…|。|？|！)\s+/g; // split on sentence boundaries

  const chunked: Array<{ id: string; timestamp: string; speaker: string; text: string }> = [];
  let counter = 0;

  for (const seg of parsed) {
    const text = seg.text || '';
    if (text.length <= maxCharsPerBubble) {
      chunked.push(seg);
      continue;
    }

    // Split into sentences; if splitter yields one chunk, fallback to comma-based split
    let parts = text.split(sentenceSplitter).filter(Boolean);
    if (parts.length === 1) {
      parts = text.split(/,\s+|，\s+/).filter(Boolean);
    }

    // Group sentences into bubbles that do not exceed the threshold
    let current = '';
    for (const p of parts) {
      const candidate = current ? `${current} ${p}` : p;
      if (candidate.length <= maxCharsPerBubble) {
        current = candidate;
      } else {
        if (current) {
          chunked.push({ id: `${seg.id}-${counter++}`, timestamp: seg.timestamp, speaker: seg.speaker, text: current.trim() });
        }
        // If single sentence exceeds threshold, hard-split mid-sentence safely
        if (p.length > maxCharsPerBubble) {
          let start = 0;
          while (start < p.length) {
            const slice = p.slice(start, start + maxCharsPerBubble);
            chunked.push({ id: `${seg.id}-${counter++}`, timestamp: seg.timestamp, speaker: seg.speaker, text: slice.trim() });
            start += maxCharsPerBubble;
          }
          current = '';
        } else {
          current = p;
        }
      }
    }
    if (current) {
      chunked.push({ id: `${seg.id}-${counter++}`, timestamp: seg.timestamp, speaker: seg.speaker, text: current.trim() });
    }
  }

  return chunked;
}

/**
 * 최종 전사본을 표시하는 컴포넌트 (실시간 전사 UI 스타일 매칭)
 */
export function TranscriptDisplay({ transcript, isLoading }: TranscriptDisplayProps) {
  if (isLoading) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 animate-pulse">
        <div className="h-4 bg-gray-300 rounded w-3/4 mb-3"></div>
        <div className="h-4 bg-gray-300 rounded w-full mb-3"></div>
        <div className="h-4 bg-gray-300 rounded w-5/6"></div>
      </div>
    );
  }

  if (!transcript) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-gray-500">
        전사본이 아직 생성되지 않았습니다.
      </div>
    );
  }

  const segments = parseTranscriptSegments(transcript);

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-6 max-h-[600px] overflow-y-auto">
      {segments.map((segment) => {
        // Color-code by speaker for visual distinction
        const speakerIndex = parseInt(segment.speaker.match(/\d+$/)?.[0] || '0', 10);
        const colors = [
          { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
          { bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700' },
          { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
          { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700' },
        ];
        const color = colors[speakerIndex % colors.length];

        return (
          <div key={segment.id} className="flex gap-3">
            <div className="flex flex-col items-center gap-1 min-w-[60px]">
              <div className={`w-8 h-8 rounded-full ${color.badge} flex items-center justify-center font-semibold text-xs`}>
                {segment.speaker.charAt(0)}
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{segment.speaker}</span>
                <span className="text-xs text-slate-400">{segment.timestamp}</span>
              </div>
              <div className={`p-3 ${color.bg} rounded-lg rounded-tl-none border ${color.border} shadow-sm text-slate-700 leading-relaxed`}>
                {segment.text}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
