import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Button } from '@/shared/ui/button';
import { Search, Calendar, Clock, Check, Send, Bot, User as UserIcon, CheckSquare, Square, Sparkles } from 'lucide-react';
import type { Meeting } from '@/features/dashboard/Dashboard';
import { fetchWithAuth, handleAuthResponse } from '@/utils/auth';
import { getQuickQuestions, type QuickQuestion } from '@/features/meetings/reportsService';
import ReactMarkdown from 'react-markdown';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// LLM 응답 정규화 함수
function normalizeMarkdown(text: string): string {
    let normalized = text;

    // 1. 이모지 뒤 2줄 개행
    normalized = normalized.replace(/(📌|📋|✨)\s*(\*\*[^*]+\*\*)/g, '$1 $2\n\n');

    // 2. **제목** 뒤 2줄 개행 (콜론 포함/미포함)
    normalized = normalized.replace(/(\*\*[^*]+\*\*):?\s*(?!-|\d\.|\n)/g, '$1\n\n');

    // 3. 문장 연결부 개행 (접속사 등) - 문단 구분
    normalized = normalized.replace(/(\.)\s+(특히|따라서|또한|그리고|하지만|그런데|그러므로|요약하면)/g, '$1\n\n$2');

    // 4. 숫자 리스트 패턴 정규화 (가장 중요: "글자1." -> "글자\n1.")
    // 숫자가 아닌 문자 뒤에 숫자가 붙어있는 경우 처리 (공백 포함)
    normalized = normalized.replace(/([^\d\n])\s*(\d+\.\s)/g, '$1\n$2');

    // 5. 콜론(:) 뒤에 바로 오는 숫자 리스트
    normalized = normalized.replace(/(:)\s*(\d+\.)/g, '$1\n\n$2');

    // 6. 리스트 항목 앞에 개행 추가 (보완)
    normalized = normalized.replace(/([^\n])\s*(-\s)/g, '$1\n$2');

    // 7. 연속된 개행 3개 이상을 2개로 정리
    normalized = normalized.replace(/\n{3,}/g, '\n\n');

    return normalized.trim();
}


interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
    meetingContext?: string; // 어떤 회의에 대한 메시지인지
}

interface MeetingChatbotPageProps {
    meetings: Meeting[];
}

export function MeetingChatbotPage({ meetings }: MeetingChatbotPageProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMeetings, setSelectedMeetings] = useState<Meeting[]>([]);
    const [activeChats, setActiveChats] = useState<Meeting[]>([]); // 실제로 챗봇에 로드된 회의들
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [quickQuestions, setQuickQuestions] = useState<QuickQuestion[]>([]);
    const [showQuickQuestions, setShowQuickQuestions] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // 검색어에 따른 회의 필터링
    const filteredMeetings = useMemo(() => {
        if (!searchQuery.trim()) {
            return meetings.slice(0, 5);
        }

        const query = searchQuery.toLowerCase();
        return meetings
            .filter(
                (meeting) =>
                    meeting.title.toLowerCase().includes(query) ||
                    meeting.content.toLowerCase().includes(query) ||
                    meeting.summary.toLowerCase().includes(query)
            )
            .slice(0, 5);
    }, [meetings, searchQuery]);

    // 자동 스크롤
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    };

    const formatTime = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleTimeString('ko-KR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // 회의 선택/해제 토글
    const toggleMeetingSelection = (meeting: Meeting) => {
        setSelectedMeetings(prev => {
            const isSelected = prev.find(m => m.id === meeting.id);
            if (isSelected) {
                return prev.filter(m => m.id !== meeting.id);
            } else {
                // 최대 5개까지만 선택 가능
                if (prev.length >= 5) {
                    return prev;
                }
                return [...prev, meeting];
            }
        });
    };

    // 선택된 회의들로 챗봇 시작 (이전 대화는 유지하고 누적)
    const handleConfirmSelection = async () => {
        if (selectedMeetings.length === 0) return;

        // 새로운 회의 세션 시작 메시지 생성
        const sessionMessages: Message[] = selectedMeetings.map((meeting, index) => ({
            id: `session-${Date.now()}-${index}`,
            role: 'system' as const,
            content: `안녕하세요! "${meeting.title}" 회의록에 대해 질문해주세요. 회의 내용을 기반으로 AI가 답변해드립니다.`,
            timestamp: new Date(),
            meetingContext: meeting.id,
        }));

        // 이전 대화 내용은 유지하고 새로운 세션 메시지 추가
        setMessages(prev => [...prev, ...sessionMessages]);
        setActiveChats([...selectedMeetings]);

        // 질문 선택지 로드
        await loadQuickQuestions();
        setShowQuickQuestions(true);
    };

    // 빠른 질문 선택지 로드
    const loadQuickQuestions = async () => {
        console.log('[MeetingChatbotPage] Loading quick questions');

        // 기본 질문 선택지 설정
        const defaultQuestions: QuickQuestion[] = [
            {
                id: 'summary',
                question: '이번 회의 핵심 내용을 요약해주세요',
                description: '회의의 주요 내용, 논의사항, 결론을 간단히 정리해드립니다',
                category: 'summary',
                icon: ''
            },
            {
                id: 'action',
                question: '내가 해야 할 일이 무엇인가요?',
                description: '회의에서 나에게 할당된 액션 아이템과 마감일을 확인합니다',
                category: 'action',
                icon: ''
            },
            {
                id: 'decision',
                question: '주요 결정사항과 합의된 내용은 무엇인가요?',
                description: '회의에서 내려진 의사결정과 팀이 합의한 사항을 알려드립니다',
                category: 'decision',
                icon: ''
            },
            {
                id: 'adversarial',
                question: '이 회의를 다각도로 분석해서 논리적 오류, 누락된 논점, 과거 결정과의 모순, 잠재 리스크, 개선 가능한 부분을 알려주세요',
                description: '적대적 지능으로 회의를 종합 분석합니다',
                category: 'adversarial',
                icon: ''
            },
        ];

        setQuickQuestions(defaultQuestions);
        console.log('[MeetingChatbotPage] Default questions set:', defaultQuestions.length);

        // API에서 질문 가져오기 시도 (단일 회의만)
        if (selectedMeetings.length === 1) {
            try {
                const response = await getQuickQuestions(selectedMeetings[0].id);
                console.log('[MeetingChatbotPage] API questions loaded:', response.questions.length);
                setQuickQuestions(response.questions);
            } catch (error) {
                console.error('[MeetingChatbotPage] Failed to load quick questions from API:', error);
                // 기본 질문 유지
            }
        }
    };

    // ✅ 스트리밍 응답 생성 (실시간)
    const generateStreamingResponse = async (question: string, messageId: string): Promise<void> => {
        try {
            const meetingIds = activeChats.map(m => m.id);
            const conversationHistory = messages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                    role: m.role,
                    content: m.content
                }));

            const response = await fetchWithAuth(`${API_URL}/api/v1/chatbot/ask-streaming`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    meeting_ids: meetingIds,
                    question: question,
                    conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
                }),
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullText = '';

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const data = line.slice(6);
                            if (data === '[DONE]') {
                                return;
                            }
                            fullText += data;

                            // 실시간으로 메시지 업데이트 (정규화 적용)
                            setMessages(prev => prev.map(msg =>
                                msg.id === messageId
                                    ? { ...msg, content: normalizeMarkdown(fullText) }
                                    : msg
                            ));
                        }
                    }
                }
            }
        } catch (error) {
            console.error('스트리밍 챗봇 API 호출 오류:', error);
            throw error;
        }
    };

    // API를 통한 응답 생성 (일반)
    const generateResponse = async (question: string): Promise<string> => {
        try {
            // activeChats에서 meeting ID 추출
            const meetingIds = activeChats.map(m => m.id);

            // ✅ 개선: 전체 대화 히스토리 전송 (무제한)
            const conversationHistory = messages
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({
                    role: m.role,
                    content: m.content
                }));

            const response = await fetchWithAuth(`${API_URL}/api/v1/chatbot/ask-fulltext`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    meeting_ids: meetingIds,
                    question: question,
                    conversation_history: conversationHistory.length > 0 ? conversationHistory : undefined,
                }),
            });
            await handleAuthResponse(response);

            const data = await response.json();
            return data.answer;
        } catch (error) {
            console.error('챗봇 API 호출 오류:', error);
            throw error;
        }
    };

    const handleSend = async (questionText?: string) => {
        const question = (questionText || input).trim();
        if (!question || activeChats.length === 0) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: question,
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsTyping(true);
        setShowQuickQuestions(false); // 질문 후 선택지 숨김
        const currentInput = question;

        try {
            // ✅ 항상 스트리밍 모드로 동작
            const assistantMessageId = (Date.now() + 1).toString();
            const assistantMessage: Message = {
                id: assistantMessageId,
                role: 'assistant',
                content: '', // 빈 내용으로 시작
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, assistantMessage]);
            setIsTyping(false); // 스트리밍 중에는 typing 표시 해제

            await generateStreamingResponse(currentInput, assistantMessageId);
        } catch (error) {
            console.error('Chat error:', error);

            // 에러 메시지 표시
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: error instanceof Error
                    ? `죄송합니다. 오류가 발생했습니다: ${error.message}`
                    : '죄송합니다. 알 수 없는 오류가 발생했습니다.',
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, errorMessage]);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col gap-4 p-4">
            {/* 검색창 */}
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="회의 제목 또는 내용으로 검색..."
                    className="pl-10 h-12 text-base"
                />
            </div>

            {/* 최근 회의 카드 + 선택 버튼 */}
            <div className="space-y-3">
                <div className="flex gap-3 overflow-x-auto pb-2 min-w-[1100px]">
                    {filteredMeetings.length === 0 ? (
                        <div className="w-[1100px] text-center py-8 text-muted-foreground">
                            {searchQuery ? '검색 결과가 없습니다.' : '회의 내역이 없습니다.'}
                        </div>
                    ) : (
                        filteredMeetings.map((meeting) => {
                            const isSelected = selectedMeetings.find(m => m.id === meeting.id);
                            const isActive = activeChats.find(m => m.id === meeting.id);

                            return (
                                <Card
                                    key={meeting.id}
                                    className={`flex-shrink-0 w-50 cursor-pointer transition-all hover:shadow-lg ${isActive
                                        ? 'border-2 border-green-500 bg-green-50'
                                        : isSelected
                                            ? 'border-2 border-primary bg-primary/5'
                                            : 'border hover:border-primary/50'
                                        }`}
                                    onClick={() => toggleMeetingSelection(meeting)}
                                >
                                    <CardContent className="p-4 relative">
                                        {/* 선택 체크박스 표시 */}
                                        <div className="absolute top-2 right-2">
                                            {isSelected ? (
                                                <CheckSquare className="w-5 h-5 text-primary" />
                                            ) : (
                                                <Square className="w-5 h-5 text-muted-foreground" />
                                            )}
                                        </div>

                                        <h3 className="font-semibold text-sm mb-2 line-clamp-2 pr-6" title={meeting.title}>
                                            {meeting.title}
                                        </h3>
                                        <div className="space-y-1 text-xs text-muted-foreground">
                                            <div className="flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                <span>{formatDate(meeting.date)}</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <Clock className="w-3 h-3" />
                                                <span>{formatTime(meeting.createdAt)}</span>
                                            </div>
                                        </div>
                                        {isActive && (
                                            <div className="mt-2 text-xs text-green-600 font-medium">
                                                활성 챗봇
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })
                    )}
                </div>

                {/* 회의 선택 버튼 */}
                <div className="flex justify-center">
                    <Button
                        onClick={handleConfirmSelection}
                        disabled={selectedMeetings.length === 0}
                        size="lg"
                        className="gap-2"
                    >
                        <Check className="w-5 h-5" />
                        선택한 회의로 챗봇 시작 ({selectedMeetings.length}/5)
                    </Button>
                </div>
            </div>

            {/* 챗봇 영역 - 높이 제한 및 내부 스크롤 */}
            <div className="h-[700px]">
                <Card className="h-full flex flex-col">
                    <CardHeader className="border-b">
                        <CardTitle className="flex items-center gap-2">
                            <Bot className="w-5 h-5 text-blue-600" />
                            AI 회의 챗봇
                            {activeChats.length > 0 && (
                                <span className="text-sm text-muted-foreground font-normal">
                                    ({activeChats.length}개 회의 로드됨)
                                </span>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col p-0 min-h-0">
                        {/* 메시지 영역 */}
                        <div className="flex-1 p-4 overflow-y-auto min-h-0">
                            {activeChats.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center">
                                    <div className="text-muted-foreground space-y-2">
                                        <p className="text-lg font-medium">회의를 선택해주세요</p>
                                        <p className="text-sm">
                                            위의 회의 목록에서 최대 5개까지 선택한 후<br />
                                            "회의 선택" 버튼을 눌러주세요
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* 빠른 질문 선택지 */}
                                    {showQuickQuestions && quickQuestions.length > 0 && (
                                        <div className="space-y-3 bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg border-2 border-blue-200">
                                            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                                                <Sparkles className="w-5 h-5 text-blue-600" />
                                                추천 질문 선택하기
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {quickQuestions.map((q) => {
                                                    console.log(`[MeetingChatbotPage] Rendering question: ${q.question}`);
                                                    return (
                                                        <button
                                                            key={q.id}
                                                            className="text-left p-4 rounded-lg border-2 border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 hover:shadow-md transition-all"
                                                            onClick={() => {
                                                                console.log('[MeetingChatbotPage] Question clicked:', q.question);
                                                                handleSend(q.question);
                                                            }}
                                                            disabled={isTyping}
                                                        >
                                                            <div className="flex gap-3 items-start">
                                                                <span className="text-3xl flex-shrink-0">{q.icon}</span>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="font-semibold text-sm text-gray-900 leading-tight mb-1">
                                                                        {q.question}
                                                                    </div>
                                                                    <div className="text-xs text-gray-600 leading-snug">
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

                                    {messages.map((message) => (
                                        <div
                                            key={message.id}
                                            className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''
                                                }`}
                                        >
                                            {message.role !== 'system' && (
                                                <div
                                                    className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${message.role === 'user'
                                                        ? 'bg-blue-600'
                                                        : 'bg-purple-600'
                                                        }`}
                                                >
                                                    {message.role === 'user' ? (
                                                        <UserIcon className="w-4 h-4 text-white" />
                                                    ) : (
                                                        <Bot className="w-4 h-4 text-white" />
                                                    )}
                                                </div>
                                            )}
                                            <div
                                                className={`w-fit max-w-[80%] rounded-lg p-3 ${message.role === 'user'
                                                    ? 'bg-blue-600 text-white'
                                                    : message.role === 'system'
                                                        ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200'
                                                        : 'bg-gray-100 text-gray-900'
                                                    }`}
                                            >
                                                <ReactMarkdown
                                                    components={{
                                                        p: ({ node, ...props }) => (
                                                            <p className="mb-2 whitespace-pre-wrap break-words" {...props} />
                                                        ),
                                                        strong: ({ node, ...props }) => (
                                                            <strong className="font-bold" {...props} />
                                                        ),
                                                        ul: ({ node, ...props }) => (
                                                            <ul className="list-disc ml-4 mb-2" {...props} />
                                                        ),
                                                        ol: ({ node, ...props }) => (
                                                            <ol className="list-decimal ml-4 mb-2" {...props} />
                                                        ),
                                                        li: ({ node, ...props }) => (
                                                            <li className="mb-1" {...props} />
                                                        ),
                                                    }}
                                                >
                                                    {message.content}
                                                </ReactMarkdown>
                                                <p
                                                    className={`text-xs mt-1 ${message.role === 'user'
                                                        ? 'text-blue-100'
                                                        : message.role === 'system'
                                                            ? 'text-green-600'
                                                            : 'text-gray-500'
                                                        }`}
                                                >
                                                    {message.timestamp.toLocaleTimeString('ko-KR', {
                                                        hour: '2-digit',
                                                        minute: '2-digit',
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                    {isTyping && (
                                        <div className="flex gap-3">
                                            <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-purple-600">
                                                <Bot className="w-4 h-4 text-white" />
                                            </div>
                                            <div className="bg-gray-100 rounded-lg p-3">
                                                <div className="flex gap-1">
                                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                                                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    <div ref={messagesEndRef} />
                                </div>
                            )}
                        </div>

                        {/* 입력 영역 */}
                        <div className="border-t p-4">
                            <div className="flex gap-2">
                                <Input
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyPress={handleKeyPress}
                                    placeholder={
                                        activeChats.length === 0
                                            ? '먼저 회의를 선택해주세요...'
                                            : '회의에 대해 질문하세요...'
                                    }
                                    className="flex-1"
                                    disabled={activeChats.length === 0}
                                />
                                <Button
                                    onClick={() => handleSend()}
                                    disabled={!input.trim() || isTyping || activeChats.length === 0}
                                >
                                    <Send className="w-4 h-4" />
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
