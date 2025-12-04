import React from 'react';

interface TranscriptStatusBannerProps {
  status: 'queued' | 'processing' | 'done' | 'error' | null;
  error?: string | null;
  onRetry?: () => void;
  usedFallback?: boolean; // STT 실패 후 실시간 전사로 대체 여부
}

/**
 * ElevenLabs 재전사 파이프라인 상태를 표시하는 배너
 */
export function TranscriptStatusBanner({
  status,
  error,
  onRetry,
  usedFallback,
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
          title: '처리 진행 중',
          message: '고품질 전사본 생성 및 요약/액션아이템 추출 중입니다...',
          textColor: 'text-yellow-800',
        };
      case 'error':
        return {
          bg: 'bg-red-50 border-red-200',
          icon: '❌',
          title: '전사 실패',
          message: usedFallback
            ? (error ? `전사 실패: ${error} — 실시간 전사본으로 대체하여 요약/임베딩을 생성했습니다.` : '전사 실패 — 실시간 전사본으로 대체하여 요약/임베딩을 생성했습니다.')
            : (error || '전사 중 오류가 발생했습니다.'),
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
 * "[00시 15분 30초] Speaker 1\nHello world" (Korean)
 * "[12時56分03秒] スピーカー0" (Japanese)
 * "[12h56m03s] Speaker 1" (English, etc)
 */
function parseTranscriptSegments(transcript: string) {
  if (!transcript) return [];
  
  // 타임스탬프 패턴 (다양한 언어 지원) - 더 구체적이고 유연한 패턴
  // 이들은 [타임스탬프] 스피커/이름 형식을 매칭합니다
  const timestampPatterns = [
    /^\[(\d{1,2}時\d{1,2}分\d{1,2}秒)\]\s+(.+?)(?:\s+(.*))?$/,  // 일본어: [12時56分03秒] or [1時5分3秒]
    /^\[(\d{1,2}时\d{1,2}分\d{1,2}秒)\]\s+(.+?)(?:\s+(.*))?$/,  // 중국어: [12时56分33秒]
    /^\[(\d{1,2}시\s+\d{1,2}분\s+\d{1,2}초)\]\s+(.+?)(?:\s+(.*))?$/,  // 한국어: [12시 56분 03초] or [1시 5분 3초]
    /^\[(\d{1,2}:\d{1,2}:\d{1,2})\]\s+(.+?)(?:\s+(.*))?$/,  // 국제 표준: [12:56:03]
    /^\[(\d{1,2}h\d{1,2}m\d{1,2}s)\]\s+(.+?)(?:\s+(.*))?$/,  // 영어/기타: [12h56m03s]
  ];

  // Split by double newlines (segment separator)
  const segments = transcript.split('\n\n').filter(s => s.trim());
  
  const parsed = segments.map((segment, idx) => {
    const lines = segment.split('\n');
    const firstLine = lines[0];
    
    // 모든 타임스탬프 패턴 시도
    for (const pattern of timestampPatterns) {
      const headerMatch = firstLine?.match(pattern);
      if (headerMatch) {
        const [, timestamp, speaker, extraInfo] = headerMatch;
        // 다음 줄부터 텍스트 추출 (현재 라인은 헤더만)
        let text = lines.slice(1).join('\n').trim();
        
        // 텍스트가 없으면 추가 정보 사용 (같은 줄에 있는 경우)
        if (!text && extraInfo) {
          text = extraInfo;
        }
        
        return {
          id: `seg-${idx}`,
          timestamp,
          speaker: speaker.trim(),
          text: text || '(내용 없음)'
        };
      }
    }
    
    // Fallback: 타임스탬프가 없거나 패턴 미매칭 - 같은 줄에 붙어있는 경우도 처리
    // 예: "[12시 56분 03초]Speaker 0시트콤이야?" 형태의 경우
    const bracketMatch = firstLine?.match(/^\[([^\]]+)\](.*)/);
    if (bracketMatch) {
      const [, timestamp, rest] = bracketMatch;
      // 나머지 부분에서 스피커와 텍스트 분리 시도
      const spaceIndex = rest.indexOf(' ');
      if (spaceIndex > 0) {
        const speaker = rest.substring(0, spaceIndex).trim();
        const text = rest.substring(spaceIndex).trim() || lines.slice(1).join('\n').trim();
        return {
          id: `seg-${idx}`,
          timestamp,
          speaker,
          text: text || '(내용 없음)'
        };
      } else {
        // 공백이 없으면 rest 전체가 스피커
        const text = lines.slice(1).join('\n').trim();
        return {
          id: `seg-${idx}`,
          timestamp,
          speaker: rest.trim() || 'Speaker',
          text: text || '(내용 없음)'
        };
      }
    }
    
    // 최종 Fallback: 타임스탬프 자체를 찾을 수 없는 경우
    return {
      id: `seg-${idx}`,
      timestamp: '00:00:00',
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
        // 다양한 언어에서 스피커 번호 추출: "Speaker 1", "スピーカー2", "说话者0" 등
        const speakerMatch = segment.speaker.match(/\d+/);
        const speakerIndex = speakerMatch ? parseInt(speakerMatch[0], 10) : 0;
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
