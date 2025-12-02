# backend/core/chatbot/conversation_helpers.py
"""
대화 유연성 향상을 위한 헬퍼 모듈

주요 기능:
1. 인사말/일상 대화 감지
2. 회의 무관 질문 감지
3. 응답 패턴 다양화
4. 컨텍스트 기반 응답 선택
"""

from typing import Dict, List, Optional, Tuple
from enum import Enum
import random


class QuestionType(Enum):
    """질문 유형 분류"""
    GREETING = "greeting"  # 인사말
    SMALL_TALK = "small_talk"  # 일상 대화 (자기소개, 날씨 등)
    OFF_TOPIC = "off_topic"  # 회의와 무관한 질문
    MEETING_RELATED = "meeting_related"  # 회의 관련 질문
    UNCLEAR = "unclear"  # 불분명한 질문
    SUMMARY_REQUEST = "summary_request"  # 요약 요청
    ACTION_LIST_REQUEST = "action_list_request"  # 액션 아이템 조회
    ROLE_ASSIGNMENT_REQUEST = "role_assignment_request"  # 담당 업무 조회


class ConversationClassifier:
    """대화 유형 분류기"""

    # 인사말 패턴
    GREETING_PATTERNS = [
        "안녕", "반가", "처음", "hi", "hello", "hey",
        "좋은 아침", "좋은 오후", "좋은 저녁"
    ]

    # 일상 대화 패턴
    SMALL_TALK_PATTERNS = {
        "자기소개": ["나는", "내 이름은", "저는", "제 이름은"],
        "날씨": ["날씨", "비", "눈", "춥", "덥"],
        "감사": ["고마워", "감사", "thank"],
        "칭찬": ["잘했어", "훌륭해", "멋져", "좋아"],
    }

    # 회의 관련 키워드
    MEETING_KEYWORDS = [
        "회의", "미팅", "예산", "일정", "마감", "담당", "결정",
        "액션", "아이템", "참석", "발표", "보고", "진행",
        "승인", "검토", "계획", "전략", "목표", "성과"
    ]

    # 요약 요청 패턴
    SUMMARY_PATTERNS = [
        "요약", "정리", "개요", "핵심", "summary"
    ]

    # 액션 아이템 요청 패턴
    ACTION_PATTERNS = [
        "해야", "할일", "todo", "task", "업무", "과제"
    ]

    # 담당자/역할 요청 패턴
    ROLE_PATTERNS = [
        "맡은", "담당", "역할", "책임", "누가"
    ]

    @classmethod
    def classify_question(cls, question: str) -> Tuple[QuestionType, Optional[str]]:
        """
        질문 유형 분류

        Args:
            question: 사용자 질문

        Returns:
            (질문 유형, 세부 카테고리)
        """
        question_lower = question.lower().strip()

        # 0. 한글 자음/모음만 있는 경우 먼저 체크 (ㅇ, ㅁ, ㅂ, ㅅ 등)
        if all(ord(char) in range(0x3131, 0x3164) for char in question if char.strip()):
            return QuestionType.UNCLEAR, None

        # 1. 인사말 감지 (길이 체크보다 먼저)
        if any(greeting in question_lower for greeting in cls.GREETING_PATTERNS):
            if len(question) < 10:  # 짧은 인사말
                return QuestionType.GREETING, None

        # 2. 너무 짧은 질문 (2자 이하)
        if len(question) <= 2:
            return QuestionType.UNCLEAR, None

        # 3. 일상 대화 감지
        for category, patterns in cls.SMALL_TALK_PATTERNS.items():
            if any(pattern in question_lower for pattern in patterns):
                return QuestionType.SMALL_TALK, category

        # 4. 요약 요청 감지
        if any(pattern in question_lower for pattern in cls.SUMMARY_PATTERNS):
            return QuestionType.SUMMARY_REQUEST, None

        # 5. 액션 아이템 요청 감지
        if any(pattern in question_lower for pattern in cls.ACTION_PATTERNS):
            return QuestionType.ACTION_LIST_REQUEST, None

        # 6. 담당자/역할 요청 감지
        if any(pattern in question_lower for pattern in cls.ROLE_PATTERNS):
            return QuestionType.ROLE_ASSIGNMENT_REQUEST, None

        # 7. 회의 관련 질문 감지
        if any(keyword in question_lower for keyword in cls.MEETING_KEYWORDS):
            return QuestionType.MEETING_RELATED, None

        # 8. 불분명한 질문 (너무 짧거나 의문사만)
        if len(question) < 5:
            return QuestionType.UNCLEAR, None

        # 9. 그 외는 회의 무관 질문으로 간주
        return QuestionType.OFF_TOPIC, None


class ResponseGenerator:
    """응답 생성기 - 다양한 톤과 패턴 제공"""

    # 인사말 응답 템플릿
    GREETING_RESPONSES = [
        "안녕하세요! 회의 내용에 대해 궁금하신 점이 있으시면 편하게 물어보세요.",
        "반갑습니다! 어떤 회의 내용이 궁금하신가요?",
        "안녕하세요! 회의 관련해서 도움이 필요하시면 말씀해주세요.",
    ]

    # 자기소개 응답 템플릿
    SELF_INTRO_RESPONSES = [
        "{name}님, 반갑습니다! 회의 내용에 대해 궁금하신 점을 물어보시면 도와드리겠습니다.",
        "안녕하세요 {name}님! 회의 관련 질문이 있으시면 편하게 물어보세요.",
        "{name}님, 만나서 반갑습니다! 어떤 회의 내용이 궁금하신가요?",
    ]

    # 회의 무관 질문 응답 템플릿
    OFF_TOPIC_RESPONSES = [
        "죄송하지만, 저는 회의 내용에 대해서만 답변드릴 수 있어요. 회의 관련 질문이 있으시면 말씀해주세요!",
        "그 질문은 회의 내용과는 관련이 없는 것 같아요. 회의에 대해 궁금하신 점을 물어보시면 도와드리겠습니다.",
        "제가 도울 수 있는 건 회의 내용 관련 질문이에요. 예산, 일정, 담당자 등에 대해 궁금하신 점이 있으신가요?",
    ]

    # 불분명한 질문 응답 템플릿
    UNCLEAR_RESPONSES = [
        "질문을 좀 더 구체적으로 말씀해주시겠어요? 회의 내용 중 궁금하신 점을 자세히 물어보시면 도와드리겠습니다.",
        "질문 내용이 명확하지 않아요. 예를 들어 '이번 회의 요약해줘', '맡은 역할이 뭐야?' 같이 구체적으로 물어보시면 답변해드릴 수 있어요!",
        "무엇이 궁금하신지 조금 더 자세히 말씀해주시겠어요? 회의 요약, 액션 아이템, 참석자 등 구체적으로 물어보세요.",
    ]

    # 감사 응답 템플릿
    THANKS_RESPONSES = [
        "별말씀을요! 다른 궁금한 점이 있으시면 언제든 물어보세요.",
        "도움이 되었다니 기쁩니다! 추가로 궁금하신 점이 있으시면 말씀해주세요.",
        "천만에요! 회의 관련해서 더 알고 싶으신 내용이 있으시면 말씀해주세요.",
    ]

    # 칭찬 응답 템플릿
    PRAISE_RESPONSES = [
        "감사합니다! 더 궁금하신 점이 있으시면 언제든 물어보세요.",
        "좋게 봐주셔서 감사합니다! 회의 관련해서 추가로 궁금하신 점이 있으신가요?",
        "고맙습니다! 다른 회의 내용도 궁금하시면 말씀해주세요.",
    ]

    @classmethod
    def generate_greeting_response(cls) -> str:
        """인사말 응답 생성"""
        return random.choice(cls.GREETING_RESPONSES)

    @classmethod
    def generate_small_talk_response(
        cls,
        category: Optional[str],
        question: str
    ) -> str:
        """일상 대화 응답 생성"""
        if category == "자기소개":
            # 이름 추출 시도
            name = cls._extract_name(question)
            if name:
                return random.choice(cls.SELF_INTRO_RESPONSES).format(name=name)
            else:
                return "반갑습니다! 회의 내용에 대해 궁금하신 점이 있으시면 물어보세요."

        elif category == "감사":
            return random.choice(cls.THANKS_RESPONSES)

        elif category == "칭찬":
            return random.choice(cls.PRAISE_RESPONSES)

        else:
            # 기타 일상 대화
            return "회의 내용 관련해서 도움이 필요하시면 말씀해주세요!"

    @classmethod
    def generate_off_topic_response(cls) -> str:
        """회의 무관 질문 응답 생성"""
        return random.choice(cls.OFF_TOPIC_RESPONSES)

    @classmethod
    def generate_unclear_response(cls) -> str:
        """불분명한 질문 응답 생성"""
        return random.choice(cls.UNCLEAR_RESPONSES)

    @classmethod
    def _extract_name(cls, text: str) -> Optional[str]:
        """자기소개 텍스트에서 이름 추출"""
        import re

        # "나는 [이름]" 패턴 - 이름은 2-4글자로 제한, non-greedy
        patterns = [
            (r"나는\s*([가-힣]{2,4}?)(?:이라고|라고)", "이라고/라고"),
            (r"제\s*이름은\s*([가-힣]{2,4}?)(?:입니다|이에요|예요|야|이야|해)", "제 이름은"),
            (r"저는\s*([가-힣]{2,4}?)(?:입니다|이에요|예요|야|이야|해)", "저는"),
            (r"내\s*이름은\s*([가-힣]{2,4}?)(?:입니다|이에요|예요|야|이야|해)", "내 이름은"),
        ]

        for pattern, _ in patterns:
            match = re.search(pattern, text)
            if match:
                name = match.group(1)
                # 이름이 3-4글자이고 마지막이 '야'로 끝나면 제거 (예: "이민수야" -> "이민수")
                if name.endswith('야') and len(name) > 2:
                    name = name[:-1]
                # 여전히 어미가 포함되어 있으면 스킵
                if not any(suffix in name for suffix in ["입니다", "이에요", "예요", "이야", "라고"]):
                    return name

        return None


class AnswerPatternVariator:
    """답변 패턴 다양화 클래스"""

    # 정보 있을 때 시작 패턴
    INFO_FOUND_PATTERNS = [
        "{answer}",
        "네, {answer}",
        "{answer}로 확인됩니다.",
        "회의 내용에 따르면, {answer}",
        "{answer}이었습니다.",
    ]

    # 정보 없을 때 응답 패턴
    INFO_NOT_FOUND_PATTERNS = [
        "해당 회의에서 {topic}에 대한 언급은 없었습니다. 다른 궁금한 점이 있으신가요?",
        "죄송하지만, 제공된 회의에서 {topic}에 대해 명확히 언급되지 않았습니다.",
        "{topic}에 대한 내용을 찾을 수 없네요. 다른 주제로 물어보시겠어요?",
        "회의 내용에서 {topic} 관련 내용을 확인할 수 없었습니다.",
    ]

    @classmethod
    def variate_answer(cls, answer: str, question: str) -> str:
        """
        답변 패턴 다양화

        Args:
            answer: 원본 LLM 답변
            question: 사용자 질문

        Returns:
            패턴이 적용된 답변
        """
        # 정보 없음 응답인 경우
        if cls._is_not_found(answer):
            topic = cls._extract_topic(question)
            return random.choice(cls.INFO_NOT_FOUND_PATTERNS).format(topic=topic)

        # 정보가 있는 경우 - 패턴 적용 (50% 확률로)
        if random.random() < 0.5:
            pattern = random.choice(cls.INFO_FOUND_PATTERNS)
            # {answer} 자리에 원본 답변 삽입
            if "{answer}" in pattern:
                return pattern.replace("{answer}", answer)

        # 나머지는 원본 그대로
        return answer

    @classmethod
    def _is_not_found(cls, answer: str) -> bool:
        """정보 없음 응답인지 확인"""
        not_found_phrases = [
            "언급되지 않았습니다",
            "언급되지 않음",
            "찾을 수 없습니다",
            "없습니다",
            "명확한 언급은 없",
        ]
        return any(phrase in answer for phrase in not_found_phrases)

    @classmethod
    def _extract_topic(cls, question: str) -> str:
        """질문에서 주제 추출 (간단한 버전)"""
        # "예산은 얼마인가요?" -> "예산"
        keywords = ["예산", "일정", "담당자", "참석자", "결정", "액션"]
        for keyword in keywords:
            if keyword in question:
                return keyword
        return "해당 내용"


# ==================== 편의 함수 ====================

def should_skip_llm(question: str) -> Tuple[bool, Optional[str]]:
    """
    LLM 호출 없이 바로 응답 가능한지 판단

    ✅ 개선: 맥락 참조 질문은 LLM으로 전달 (대화 히스토리 활용)

    Args:
        question: 사용자 질문

    Returns:
        (LLM 스킵 여부, 직접 응답 텍스트)
    """
    question_lower = question.lower().strip()

    # ✅ 맥락 참조 키워드 감지 - LLM으로 전달해야 함
    context_reference_keywords = [
        "아까", "방금", "지금까지", "그거", "그것", "그게",
        "첫 번째", "두 번째", "마지막", "이전", "위에서",
        "전에", "앞서", "앞에서", "ceo", "참석자", "누가"
    ]

    # 맥락 참조 질문은 반드시 LLM으로 전달 (대화 히스토리 필요)
    if any(keyword in question_lower for keyword in context_reference_keywords):
        return False, None  # LLM 호출 필요

    question_type, category = ConversationClassifier.classify_question(question)

    # 인사말만 스킵 (매우 명확한 경우만)
    if question_type == QuestionType.GREETING and len(question) < 10:
        return True, ResponseGenerator.generate_greeting_response()

    # 일상 대화 (자기소개, 감사, 칭찬 - 명확한 경우만)
    if question_type == QuestionType.SMALL_TALK:
        return True, ResponseGenerator.generate_small_talk_response(category, question)

    # ✅ 나머지는 모두 LLM으로 전달 (유연성 향상)
    # - 불분명한 질문도 LLM이 대화 히스토리로 해석 가능
    # - 회의 무관 질문도 RAG 폴백으로 처리
    return False, None


def enhance_answer(answer: str, question: str, apply_variation: bool = True) -> str:
    """
    답변 품질 향상

    Args:
        answer: 원본 LLM 답변
        question: 사용자 질문
        apply_variation: 패턴 다양화 적용 여부

    Returns:
        향상된 답변
    """
    if apply_variation:
        return AnswerPatternVariator.variate_answer(answer, question)
    return answer


def reinterpret_question(question: str) -> str:
    """
    질문 재해석: 사용자 의도를 파악하여 LLM이 이해하기 쉬운 힌트 추가

    Args:
        question: 사용자 원본 질문

    Returns:
        재해석된 질문 (힌트 추가)

    Examples:
        - "맡은 역할이 뭐야?" → "맡은 역할이 뭐야? (내가 담당한 액션 아이템을 알려줘)"
        - "해야 될 일 있어?" → "해야 될 일 있어? (액션 아이템 목록을 확인해줘)"
        - "요약해줘" → "요약해줘 (회의 전체 내용을 요약해줘)"
    """
    question_type, _ = ConversationClassifier.classify_question(question)
    question_lower = question.lower().strip()

    # 1. 담당자/역할 요청
    if question_type == QuestionType.ROLE_ASSIGNMENT_REQUEST:
        if "맡은" in question_lower or "역할" in question_lower:
            return question + " (내가 담당한 액션 아이템을 알려줘)"
        elif "담당" in question_lower:
            return question + " (담당자별 액션 아이템을 알려줘)"

    # 2. 액션 아이템 요청
    elif question_type == QuestionType.ACTION_LIST_REQUEST:
        if "해야" in question_lower or "할일" in question_lower:
            return question + " (액션 아이템 목록을 확인해줘)"
        elif "업무" in question_lower or "과제" in question_lower:
            return question + " (진행 중인 액션 아이템을 알려줘)"

    # 3. 요약 요청
    elif question_type == QuestionType.SUMMARY_REQUEST:
        if len(question) < 15:  # 짧은 요약 요청
            return question + " (회의 전체 내용을 요약해줘)"

    # 그 외는 원본 그대로 반환
    return question
