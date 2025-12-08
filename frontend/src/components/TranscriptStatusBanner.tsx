import React, { useState } from 'react';

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
  speakerMapping?: Record<string, string>;
  onUpdateSpeaker?: (original: string, newName: string) => void;
}

/**
 * Parse speaker-labeled transcript segments from backend format:
 * "[00시 15분 30초] Speaker 1\nHello world" (Korean)
 * "[12時56分03秒] スピーカー0" (Japanese)
 * "[12h56m03s] Speaker 1" (English, etc)
 */
function parseTranscriptSegments(transcript: string) {
  if (!transcript) return [];
  
  // 타임스탬프 패턴 (다양한 언어 지원)
  // 한국어: [00시 00분 00초], 일본어: [00時00分00秒], 중국어: [00时00分00秒], 기타: [00h00m00s] 등
  const timestampPatterns = [
    /^\[(\d{2}時\d{2}分\d{2}秒)\]\s+(.+)$/,  // 일본어: [12時56分03秒]
    /^\[(\d{2}时\d{2}分\d{2}秒)\]\s+(.+)$/,  // 중국어: [12时56分33秒]
    /^\[(\d{2}시\s+\d{2}분\s+\d{2}초)\]\s+(.+)$/,  // 한국어: [12시 56분 03초]
    /^\[(\d{1,2}h\d{1,2}m\d{1,2}s)\]\s+(.+)$/,  // 영어/기타: [12h56m03s]
    /^\[(\d{2}:\d{2}:\d{2})\]\s+(.+)$/,  // 국제 표준: [12:56:03]
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
        const [, timestamp, speaker] = headerMatch;
        const text = lines.slice(1).join('\n').trim();
        return {
          id: `seg-${idx}`,
          timestamp,
          speaker,
          text: text || firstLine
        };
      }
    }
    
    // Fallback: treat entire segment as text with default speaker
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
export function TranscriptDisplay({ transcript, isLoading, speakerMapping, onUpdateSpeaker }: TranscriptDisplayProps) {
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [tempName, setTempName] = useState('');

  const startEdit = (label: string, currentName?: string) => {
    setEditingSpeaker(label);
    setTempName(currentName || label);
  };

  const submitEdit = () => {
    if (!editingSpeaker) return;
    const trimmed = tempName.trim();
    if (trimmed && onUpdateSpeaker) {
      onUpdateSpeaker(editingSpeaker, trimmed);
    }
    setEditingSpeaker(null);
    setTempName('');
  };

  const cancelEdit = () => {
    setEditingSpeaker(null);
    setTempName('');
  };

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
        const mappedName = speakerMapping?.[segment.speaker];
        const displayName = mappedName || segment.speaker;

        // Color-code by speaker for visual distinction
        // 다양한 언어에서 스피커 번호 추출: "Speaker 1", "スピーカー2", "说话者0" 등
        // 색상 키는 숫자 기반 라벨뿐 아니라 임의 이름도 안정적으로 분리되도록 해시
        const hash = Array.from(segment.speaker).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const speakerIndex = hash % 256;
        const colors = [
          { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
          { bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700' },
          { bg: 'bg-purple-50', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
          { bg: 'bg-orange-50', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700' },
          { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-800' },
          { bg: 'bg-rose-50', border: 'border-rose-200', badge: 'bg-rose-100 text-rose-700' },
          { bg: 'bg-pink-50', border: 'border-pink-200', badge: 'bg-pink-100 text-pink-700' },
          { bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', badge: 'bg-fuchsia-100 text-fuchsia-700' },
          { bg: 'bg-violet-50', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700' },
          { bg: 'bg-indigo-50', border: 'border-indigo-200', badge: 'bg-indigo-100 text-indigo-700' },
          { bg: 'bg-sky-50', border: 'border-sky-200', badge: 'bg-sky-100 text-sky-700' },
          { bg: 'bg-cyan-50', border: 'border-cyan-200', badge: 'bg-cyan-100 text-cyan-700' },
          { bg: 'bg-teal-50', border: 'border-teal-200', badge: 'bg-teal-100 text-teal-700' },
          { bg: 'bg-emerald-50', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
          { bg: 'bg-lime-50', border: 'border-lime-200', badge: 'bg-lime-100 text-lime-700' },
          { bg: 'bg-slate-50', border: 'border-slate-200', badge: 'bg-slate-100 text-slate-700' },
        ];
        const color = colors[speakerIndex % colors.length];

        return (
          <div key={segment.id} className="flex gap-3">
            <div className="flex flex-col items-center gap-1 min-w-[60px]">
              <div className={`w-8 h-8 rounded-full ${color.badge} flex items-center justify-center font-semibold text-xs`}>
                {displayName.charAt(0)}
              </div>
            </div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {editingSpeaker === segment.speaker ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      className="border border-slate-200 rounded px-2 py-1 text-sm"
                      value={tempName}
                      onChange={(e) => setTempName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitEdit();
                        if (e.key === 'Escape') cancelEdit();
                      }}
                    />
                    <button
                      type="button"
                      className="px-2 py-1 text-xs rounded bg-blue-600 text-white"
                      onClick={submitEdit}
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1 text-xs rounded bg-slate-100 text-slate-700"
                      onClick={cancelEdit}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-sm font-semibold text-slate-700 underline decoration-dashed decoration-slate-300 underline-offset-4 hover:text-blue-700"
                    onClick={() => startEdit(segment.speaker, mappedName || segment.speaker)}
                    disabled={!onUpdateSpeaker}
                  >
                    {displayName}
                  </button>
                )}
                {mappedName && (
                  <span className="text-xs text-slate-400">({segment.speaker})</span>
                )}
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
