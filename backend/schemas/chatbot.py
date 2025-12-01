# backend/schemas/chatbot.py

from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field


class ChatbotQuestionRequest(BaseModel):
    """
    사용자가 챗봇에게 질의할 때 사용하는 요청 바디
    """
    meeting_id: Optional[str] = Field(None, description="대상 회의 ID (MEETING_ID). None이면 전체 회의 검색")
    question: str = Field(..., description="사용자 질문")
    use_rag: bool = Field(
        default=True,
        description="RAG(회의 전사 기반 검색)를 사용할지 여부"
    )


class RetrievedChunk(BaseModel):
    """
    RAG로 검색된 텍스트 청크 정보
    (현재는 텍스트만, 필요하면 score 등 추가 가능)
    """
    embedding_id: Optional[str] = None
    text: str
    similarity: Optional[float] = None


class ChatbotAnswerResponse(BaseModel):
    """
    챗봇 답변 응답 스키마
    """
    log_id: str = Field(..., description="CHATBOT_LOG의 PK")
    question: str = Field(..., description="사용자 질문")
    answer: str = Field(..., description="챗봇 답변")
    retrieved_chunks: Optional[List[RetrievedChunk]] = Field(
        default=None,
        description="RAG로 검색된 관련 텍스트 청크들"
    )
    confidence: Optional[float] = Field(
        default=None,
        description="(선택) 답변 신뢰도 점수"
    )
    created_at: datetime = Field(
        ...,
        description="질문/답변 생성 시각 (ASKED_DT)"
    )


class ChatMessage(BaseModel):
    """
    히스토리 조회용 단일 Q&A 메시지
    """
    log_id: str
    question: str
    answer: Optional[str]
    asked_dt: datetime


class ChatHistoryResponse(BaseModel):
    """
    특정 회의에 대한 챗봇 Q&A 히스토리 응답
    """
    meeting_id: str
    meeting_title: Optional[str]
    chat_logs: List[ChatMessage]


class ChatbotHealthCheck(BaseModel):
    """
    챗봇 헬스체크 응답
    """
    status: str
    rag_enabled: bool
    vectorstore_connected: bool
    llm_available: bool


# ==================== 새로운 원문 기반 챗봇 스키마 ====================

class ConversationMessage(BaseModel):
    """
    대화 히스토리용 단일 메시지
    """
    role: str = Field(..., description="메시지 역할 (user/assistant)")
    content: str = Field(..., description="메시지 내용")


class FullTextChatbotRequest(BaseModel):
    """
    원문 기반 챗봇 요청 스키마 (N개의 회의 선택 가능)
    """
    meeting_ids: List[str] = Field(
        ...,
        description="질문 대상 회의 ID 리스트 (1개 이상)",
        min_length=1
    )
    question: str = Field(..., description="사용자 질문", min_length=1)
    conversation_history: Optional[List[ConversationMessage]] = Field(
        default=None,
        description="이전 대화 히스토리 (최근 5개 권장)"
    )


class MeetingContext(BaseModel):
    """
    LLM에 전달된 회의 컨텍스트 정보
    """
    meeting_id: str
    title: Optional[str] = None
    content_length: int = Field(..., description="전사 텍스트 길이")


class FullTextChatbotResponse(BaseModel):
    """
    원문 기반 챗봇 응답 스키마
    """
    question: str = Field(..., description="사용자 질문")
    answer: str = Field(..., description="챗봇 답변")
    used_meetings: List[MeetingContext] = Field(
        ...,
        description="답변 생성에 사용된 회의 정보 리스트"
    )
    created_at: datetime = Field(..., description="응답 생성 시각")


# ==================== 적대적 지능 (Adversarial Intelligence) 스키마 ====================

class AdversarialIssue(BaseModel):
    """
    적대적 지능이 탐지한 개별 이슈
    """
    type: str = Field(..., description="이슈 유형 (logical_inconsistency, missing_point, contradiction, risk, illogical_conclusion)")
    severity: str = Field(..., description="심각도 (high, medium, low)")
    description: str = Field(..., description="이슈 설명")
    evidence: Optional[List[str]] = Field(None, description="증거 (해당하는 경우)")
    impact: Optional[str] = Field(None, description="예상 영향")
    suggestion: Optional[str] = Field(None, description="개선 제안")


class LogicalInconsistency(AdversarialIssue):
    """논리적 불일치"""
    type: str = "logical_inconsistency"


class MissingPoint(AdversarialIssue):
    """누락된 논점"""
    type: str = "missing_point"
    topic: Optional[str] = Field(None, description="누락된 주제")
    why_important: Optional[str] = Field(None, description="중요한 이유")


class Contradiction(AdversarialIssue):
    """과거 의사결정 모순"""
    type: str = "contradiction"
    current_decision: Optional[str] = Field(None, description="현재 회의의 결정")
    past_decision: Optional[str] = Field(None, description="과거 회의의 결정")
    past_meeting: Optional[str] = Field(None, description="과거 회의 제목")
    requires_review: Optional[bool] = Field(None, description="재검토 필요 여부")


class Risk(AdversarialIssue):
    """잠재 리스크"""
    type: str = "risk"
    category: Optional[str] = Field(None, description="리스크 카테고리 (일정, 예산, 리소스, 기술, 운영, 기타)")
    likelihood: Optional[str] = Field(None, description="발생 가능성 (high, medium, low)")
    mitigation: Optional[str] = Field(None, description="완화 방안")


class IllogicalConclusion(AdversarialIssue):
    """비논리적 결론"""
    type: str = "illogical_conclusion"
    conclusion: Optional[str] = Field(None, description="문제가 되는 결론")
    problem: Optional[str] = Field(None, description="비논리적인 점")
    missing_logic: Optional[str] = Field(None, description="빠진 논리적 연결고리")


class AdversarialAnalysisResponse(BaseModel):
    """
    적대적 지능 분석 결과 응답
    """
    meeting_id: str = Field(..., description="분석된 회의 ID")
    meeting_title: str = Field(..., description="회의 제목")
    analyzed_at: datetime = Field(..., description="분석 시각")
    inconsistencies: List[dict] = Field(default_factory=list, description="논리적 불일치 목록")
    missing_points: List[dict] = Field(default_factory=list, description="누락된 논점 목록")
    contradictions: List[dict] = Field(default_factory=list, description="과거 결정 모순 목록")
    risks: List[dict] = Field(default_factory=list, description="잠재 리스크 목록")
    illogical_conclusions: List[dict] = Field(default_factory=list, description="비논리적 결론 목록")
    overall_score: float = Field(..., description="전체 품질 점수 (0-100, 높을수록 좋음)")
    recommendations: List[str] = Field(default_factory=list, description="개선 권장사항")
