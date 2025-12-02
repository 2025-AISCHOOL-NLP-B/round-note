"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Input } from '@/shared/ui/input';
import { Button } from '@/shared/ui/button';
import { MessageSquare, X, Minus, Sparkles } from 'lucide-react';
import type { Meeting } from '@/features/dashboard/Dashboard';
import { getQuickQuestions, type QuickQuestion } from '@/features/meetings/reportsService';

export default function MeetingChat({ meeting, open, onOpen, onClose }: { meeting?: Meeting; open?: boolean; onOpen?: () => void; onClose?: () => void }) {
  const [messages, setMessages] = useState<Array<{ id: string; sender: 'user' | 'bot'; text: string; time: string; sources?: Array<{ embedding_id?: string; text: string; similarity?: number }> }>>([{
    id: '1', sender: 'bot', text: `안녕하세요! 회의 관련 도우미입니다. 회의 내용을 질문해보세요.`, time: new Date().toISOString(), sources: undefined
  }]);
  const [showSourcesMap, setShowSourcesMap] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [quickQuestions, setQuickQuestions] = useState<QuickQuestion[]>([]);
  const [showQuickQuestions, setShowQuickQuestions] = useState(true);
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

  const getAuthToken = (): string | null => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('access_token');
  };
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Positioning for draggable/floating window (shared by full window and collapsed bubble)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; left: number; top: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clickCandidateRef = useRef<boolean>(false);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // 빠른 질문 선택지 로드
  useEffect(() => {
    const loadQuickQuestions = async () => {
      console.log('[MeetingChat] Loading quick questions, meeting:', meeting);

      if (!meeting) {
        console.log('[MeetingChat] No meeting provided');
        return;
      }

      const meetingId = (meeting as any)?.meeting_id || (meeting as any)?.id || null;
      console.log('[MeetingChat] Meeting ID:', meetingId);

      // 기본 질문 선택지를 먼저 설정 (즉시 표시)
      const defaultQuestions = [
        {
          id: 'summary',
          question: '이번 회의 핵심 내용을 요약해주세요',
          description: '회의의 주요 내용, 논의사항, 결론을 간단히 정리해드립니다',
          category: 'summary' as const,
          icon: '📝'
        },
        {
          id: 'action',
          question: '내가 해야 할 일이 무엇인가요?',
          description: '회의에서 나에게 할당된 액션 아이템과 마감일을 확인합니다',
          category: 'action' as const,
          icon: '✅'
        },
        {
          id: 'decision',
          question: '주요 결정사항과 합의된 내용은 무엇인가요?',
          description: '회의에서 내려진 의사결정과 팀이 합의한 사항을 알려드립니다',
          category: 'decision' as const,
          icon: '🎯'
        },
        {
          id: 'adversarial',
          question: '이 회의에서 놓친 부분이나 리스크가 있나요?',
          description: '적대적 지능으로 논리적 불일치, 누락된 논점, 과거 결정과의 모순, 잠재 리스크를 탐지합니다',
          category: 'adversarial' as const,
          icon: '🔍'
        },
      ];

      // 즉시 기본 질문 설정
      setQuickQuestions(defaultQuestions);
      console.log('[MeetingChat] Default questions set:', defaultQuestions.length);

      if (!meetingId) {
        console.log('[MeetingChat] No valid meeting ID, using default questions');
        return;
      }

      // API에서 질문 가져오기 시도 (백그라운드)
      try {
        const response = await getQuickQuestions(meetingId);
        console.log('[MeetingChat] API questions loaded:', response.questions.length);
        setQuickQuestions(response.questions);
      } catch (error) {
        console.error('[MeetingChat] Failed to load quick questions from API:', error);
        // 기본 질문 유지
      }
    };

    loadQuickQuestions();
  }, [meeting]);

  useEffect(() => {
    // initialize position to bottom-right on mount
    if (typeof window !== 'undefined') {
      // clear any previously saved position to reset to original default
      try { localStorage.removeItem('meeting_chat_pos'); } catch (e) { /* ignore */ }
      const fullWidth = 360;
      const fullHeight = Math.floor(window.innerHeight * 0.7);
      const bubbleSize = 48; // collapsed bubble size (w-12 h-12)

      const fullLeftDefault = Math.max(12, window.innerWidth - 24 - fullWidth);
      const fullTopDefault = Math.max(80, window.innerHeight - 48 - fullHeight);

      const bubbleLeftDefault = Math.max(12, window.innerWidth - 24 - bubbleSize);
      const bubbleTopDefault = Math.max(12, window.innerHeight - 48 - bubbleSize);

      // If collapsed (open === false) place bubble at bottom-right, otherwise open window default
      if (open === false) {
        setPos({ left: bubbleLeftDefault, top: bubbleTopDefault });
      } else {
        setPos({ left: fullLeftDefault, top: fullTopDefault });
      }
    }
  }, [open]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) clickCandidateRef.current = false;
      setPos({ left: dragStartRef.current.left + dx, top: dragStartRef.current.top + dy });
    };
    const onUp = () => {
      if (!dragStartRef.current) return;
      draggingRef.current = false;

      // if user clicked without moving much, treat as click: open if currently collapsed
      if (clickCandidateRef.current) {
        clickCandidateRef.current = false;
        if (!open) {
          try { onOpen && onOpen(); } catch (e) { /* ignore */ }
        }
        dragStartRef.current = null;
        return;
      }

      // snap to nearest corner with gap
      const width = open === false ? 48 : 360;
      const height = open === false ? 48 : Math.floor(window.innerHeight * 0.7);
      const gap = 24;
      const current = dragStartRef.current;
      const finalLeft = current.left;
      const finalTop = current.top;

      const corners = [
        { left: gap, top: gap }, // top-left
        { left: window.innerWidth - width - gap, top: gap }, // top-right
        { left: gap, top: window.innerHeight - height - gap }, // bottom-left
        { left: window.innerWidth - width - gap, top: window.innerHeight - height - gap }, // bottom-right
      ];

      let best = corners[0];
      let bestDist = Infinity;
      for (const c of corners) {
        const dx = (finalLeft) - c.left;
        const dy = (finalTop) - c.top;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < bestDist) { bestDist = d; best = c; }
      }

      setPos({ left: Math.max(12, best.left), top: Math.max(12, best.top) });

      // persist position
      try { localStorage.setItem('meeting_chat_pos', JSON.stringify({ left: Math.max(12, best.left), top: Math.max(12, best.top) })); } catch (e) { /* ignore */ }

      dragStartRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [open]);

  const startDrag = (e: React.MouseEvent) => {
    if (!pos) return;
    draggingRef.current = true;
    dragStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, left: pos.left, top: pos.top };
    clickCandidateRef.current = true;
  };

  const send = async (questionText?: string) => {
    const question = (questionText || input).trim();
    if (!question || !meeting) return;

    const user = { id: String(Date.now()), sender: 'user' as const, text: question, time: new Date().toISOString() };
    setMessages(m => [...m, user]);
    setInput('');
    setShowQuickQuestions(false); // 질문 후 선택지 숨김

    setIsTyping(true);
    try {
      const token = getAuthToken();
      // support different meeting id field names (meeting_id vs id)
      const meetingId = (meeting as any)?.meeting_id || (meeting as any)?.id || null;

      // ✅ 개선: 전체 대화 히스토리 전송 (무제한)
      const conversationHistory = messages
        .filter(m => m.sender === 'user' || m.sender === 'bot')
        // .slice(-10) 제거 - 전체 히스토리 전송
        .map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text
        }));

      const res = await fetch(`${API_URL}/api/v1/chatbot/ask-fulltext`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          meeting_ids: [meetingId],
          question,
          conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        // Normalize error message: if detail is an object, try to extract useful text or stringify
        let detail = err && err.detail !== undefined ? err.detail : err;
        let detailText = '';
        if (typeof detail === 'string') {
          detailText = detail;
        } else if (detail && typeof detail === 'object') {
          // Try common shapes: {detail: '...'} or {message: '...'} or pydantic style
          detailText = detail.detail || detail.message || JSON.stringify(detail);
        } else {
          detailText = String(detail);
        }

        setMessages(m => [...m, { id: String(Date.now()+1), sender: 'bot', text: `오류: ${detailText}`, time: new Date().toISOString() }]);
        setIsTyping(false);
        return;
      }

      const data = await res.json();
      // Normalize answer field (sometimes API may return object)
      let botText = '';
      if (!data) {
        botText = '응답이 없습니다.';
      } else if (typeof data.answer === 'string') {
        botText = data.answer;
      } else if (data.answer && typeof data.answer === 'object') {
        // try common nested field
        botText = data.answer.text || data.answer.content || JSON.stringify(data.answer);
      } else if (data.answer == null && data.ANSWER) {
        botText = String(data.ANSWER);
      } else {
        botText = String(data.answer || data);
      }

      // attach retrieved chunks (if present) to the bot message
      const botMsgId = String(Date.now()+2);
      const sources = Array.isArray(data.retrieved_chunks) ? data.retrieved_chunks.map((c: any) => ({ embedding_id: c.embedding_id, text: c.text || c, similarity: c.similarity })) : undefined;
      setMessages(m => [...m, { id: botMsgId, sender: 'bot', text: botText, time: new Date().toISOString(), sources }]);
      if (sources && sources.length > 0) {
        setShowSourcesMap(prev => ({ ...prev, [botMsgId]: false }));
      }
    } catch (e: any) {
      setMessages(m => [...m, { id: String(Date.now()+3), sender: 'bot', text: `요청 실패: ${e.message || e}`, time: new Date().toISOString() }]);
    } finally {
      setIsTyping(false);
    }
  };

  if (!pos) return null; // wait until positioned

  const isOpen = typeof open === 'boolean' ? open : true;

  if (!isOpen) {
    return (
      <div
        style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 60 }}
      >
        <div
          className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center cursor-pointer"
          onMouseDown={startDrag}
          onClick={() => { if (!draggingRef.current) { try { onOpen && onOpen(); } catch (e) { /* ignore */ } } }}
          title="챗봇 열기"
        >
          <MessageSquare className="w-6 h-6 text-primary" />
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{ position: 'fixed', left: pos.left, top: pos.top, width: 360, height: '70vh', zIndex: 60 }}
      className="rounded-lg overflow-hidden bg-white shadow-xl border border-gray-200"
    >
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b cursor-move" onMouseDown={startDrag}>
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-gray-700" />
            <div>
              <h4 className="text-sm font-medium">회의 챗봇</h4>
              <p className="text-xs text-gray-500">회의 관련 질문을 입력하세요</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="p-1 rounded hover:bg-gray-100" onClick={() => onClose && onClose()} aria-label="최소화"><Minus className="w-4 h-4 text-gray-500" /></button>
            <button className="p-1 rounded hover:bg-gray-100" onClick={() => onClose && onClose()} aria-label="닫기"><X className="w-4 h-4 text-gray-500" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="space-y-3">
            {messages.map(m => (
              <div key={m.id} className={m.sender === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={m.sender === 'user' ? 'bg-blue-500 text-white rounded-lg px-3 py-2 max-w-[80%]' : 'bg-gray-100 text-gray-900 rounded-lg px-3 py-2 max-w-[80%]'}>
                  <div className="text-sm">{m.text}</div>
                  {m.sources && m.sources.length > 0 && (
                    <div className="mt-2 text-xs text-gray-500">
                      <button
                        className="underline"
                        onClick={() => setShowSourcesMap(prev => ({ ...prev, [m.id]: !prev[m.id] }))}
                      >
                        {showSourcesMap[m.id] ? '출처 숨기기' : `출처 보기 (${m.sources.length})`}
                      </button>
                      {showSourcesMap[m.id] && (
                        <ul className="mt-2 space-y-2 text-[12px] text-gray-700">
                          {m.sources.map((s, idx) => (
                            <li key={idx} className="p-2 bg-white border rounded">
                              <div className="text-[11px] text-gray-500">{s.embedding_id ? `source:${s.embedding_id}` : ''} {s.similarity ? `(sim: ${s.similarity.toFixed(3)})` : ''}</div>
                              <div className="text-sm mt-1">{s.text}</div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <div className="text-[10px] text-gray-400 mt-1 text-right">{new Date(m.time).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}

            {/* 빠른 질문 선택지 */}
            {quickQuestions.length > 0 && (
              <div className="space-y-2 mt-3 bg-white">
                <div className="flex items-center gap-1 text-xs font-medium text-gray-600 px-1">
                  <Sparkles className="w-3 h-3" />
                  추천 질문 (총 {quickQuestions.length}개)
                </div>
                <div className="space-y-1.5">
                  {quickQuestions.map((q, idx) => {
                    console.log(`[MeetingChat] Rendering question ${idx}:`, q.question);
                    return (
                      <button
                        key={q.id}
                        className="w-full text-left p-2.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all bg-white"
                        onClick={() => {
                          console.log('[MeetingChat] Question clicked:', q.question);
                          send(q.question);
                        }}
                        disabled={isTyping}
                      >
                        <div className="flex gap-2 items-start">
                          <span className="text-lg flex-shrink-0">{q.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-xs text-gray-900 leading-tight">
                              {q.question}
                            </div>
                            <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                              {q.description}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-gray-100 text-gray-900 rounded-lg px-3 py-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="p-3 border-t">
          <div className="flex gap-2">
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="회의에 대해 질문해보세요..." />
            <Button onClick={send}>전송</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
