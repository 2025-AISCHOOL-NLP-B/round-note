import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';
import { Button } from '@/shared/ui/button';
import { Search, Calendar, Clock, Check, Send, Bot, User as UserIcon, CheckSquare, Square } from 'lucide-react';
import type { Meeting } from '@/features/dashboard/Dashboard';
import { fetchWithAuth, handleAuthResponse } from '@/utils/auth';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
    const handleConfirmSelection = () => {
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
    };

    // API를 통한 응답 생성
    const generateResponse = async (question: string): Promise<string> => {
        try {
            // activeChats에서 meeting ID 추출
            const meetingIds = activeChats.map(m => m.id);

            const response = await fetchWithAuth(`${API_URL}/api/v1/chatbot/ask-fulltext`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    meeting_ids: meetingIds,
                    question: question,
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

    const handleSend = async () => {
        if (!input.trim() || activeChats.length === 0) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date(),
        };

        setMessages(prev => [...prev, userMessage]);
        const currentInput = input.trim();
        setInput('');
        setIsTyping(true);

        try {
            // 실제 AI API 호출 (여러 회의 컨텍스트 전달)
            const response = await generateResponse(currentInput);

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response,
                timestamp: new Date(),
            };

            setMessages(prev => [...prev, assistantMessage]);
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
        } finally {
            setIsTyping(false);
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
                                                className={`flex-1 max-w-[80%] rounded-lg p-3 ${message.role === 'user'
                                                    ? 'bg-blue-600 text-white'
                                                    : message.role === 'system'
                                                        ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200'
                                                        : 'bg-gray-100 text-gray-900'
                                                    }`}
                                            >
                                                <p className="whitespace-pre-wrap break-words">
                                                    {message.content}
                                                </p>
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
                                    onClick={handleSend}
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
