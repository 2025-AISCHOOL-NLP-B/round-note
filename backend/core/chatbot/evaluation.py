# backend/core/chatbot/evaluation.py
"""
챗봇 성능 평가 지표 시스템

주요 평가 항목:
1. Faithfulness (사실 충실성): 답변이 제공된 컨텍스트에 충실한가?
2. Groundedness (근거 기반성): 답변이 검증 가능한 근거에 기반하는가?
3. Relevance (질문-답변 연관성): 답변이 질문과 관련이 있는가?
4. Completeness (답변의 완전성): 답변이 질문에 충분히 답변하는가?
5. Response Time (응답 시간): 답변 생성 속도
"""

import time
import logging
from typing import Dict, Optional, List, Any
from datetime import datetime
from pydantic import BaseModel, Field


class EvaluationMetrics(BaseModel):
    """평가 지표 결과"""
    faithfulness: Optional[float] = Field(None, description="사실 충실성 점수 (0-1)")
    groundedness: Optional[float] = Field(None, description="근거 기반성 점수 (0-1)")
    relevance: Optional[float] = Field(None, description="질문-답변 연관성 점수 (0-1)")
    completeness: Optional[float] = Field(None, description="답변 완전성 점수 (0-1)")
    response_time_ms: Optional[float] = Field(None, description="응답 시간 (밀리초)")
    overall_score: Optional[float] = Field(None, description="종합 점수 (0-1)")
    evaluated_at: datetime = Field(default_factory=datetime.now)


class PerformanceEvaluator:
    """챗봇 성능 평가기"""

    def __init__(self, logger: Optional[logging.Logger] = None):
        self.logger = logger or logging.getLogger(__name__)

    def evaluate_faithfulness(
        self,
        answer: str,
        context: str,
    ) -> float:
        """
        사실 충실성 평가: 답변이 컨텍스트에 충실한가?

        평가 기준:
        - 답변이 컨텍스트에 있는 내용만을 사용했는가?
        - 환각(hallucination) 없이 사실에 근거했는가?

        Args:
            answer: 챗봇 답변
            context: 제공된 컨텍스트 (회의 전사 원문)

        Returns:
            0-1 점수 (1이 가장 충실)
        """
        # 간단한 휴리스틱 기반 평가
        # 프로덕션에서는 LLM 기반 평가나 더 정교한 방법 사용 권장

        # 1. "언급되지 않았습니다" 같은 문구가 있으면 충실도 높음
        honest_phrases = [
            "언급되지 않았습니다",
            "언급되지 않음",
            "찾을 수 없습니다",
            "명확한 언급은 없",
            "확인할 수 없었습니다"
        ]

        if any(phrase in answer for phrase in honest_phrases):
            return 1.0  # 정보가 없을 때 솔직하게 말함 = 높은 충실도

        # 2. 답변이 너무 짧으면 정보가 부족할 가능성
        if len(answer) < 20:
            return 0.5

        # 3. 기본 점수 (실제로는 LLM 기반 평가 필요)
        return 0.8

    def evaluate_groundedness(
        self,
        answer: str,
        retrieved_chunks: Optional[List[str]] = None,
    ) -> float:
        """
        근거 기반성 평가: 답변이 검색된 청크에 기반하는가?

        Args:
            answer: 챗봇 답변
            retrieved_chunks: RAG로 검색된 텍스트 청크들

        Returns:
            0-1 점수
        """
        if not retrieved_chunks:
            # RAG를 사용하지 않는 경우 기본값
            return 0.7

        # 간단한 키워드 오버랩 기반 평가
        # 프로덕션: semantic similarity 또는 LLM 기반 평가

        answer_words = set(answer.lower().split())
        chunk_words = set()
        for chunk in retrieved_chunks:
            chunk_words.update(chunk.lower().split())

        if len(answer_words) == 0:
            return 0.0

        overlap = len(answer_words & chunk_words) / len(answer_words)
        return min(1.0, overlap * 1.5)  # 스케일 조정

    def evaluate_relevance(
        self,
        question: str,
        answer: str,
    ) -> float:
        """
        질문-답변 연관성 평가

        평가 기준:
        - 답변이 질문에 직접적으로 답변하는가?
        - 불필요한 정보가 포함되지 않았는가?

        Args:
            question: 사용자 질문
            answer: 챗봇 답변

        Returns:
            0-1 점수
        """
        # 간단한 키워드 기반 평가
        # 프로덕션: semantic similarity 또는 LLM 기반 평가

        question_lower = question.lower()
        answer_lower = answer.lower()

        # 질문의 핵심 키워드 추출 (간단한 방법)
        question_keywords = [
            word for word in question_lower.split()
            if len(word) > 2 and word not in ["이번", "회의", "알려", "알려줘", "뭐야", "무엇"]
        ]

        if not question_keywords:
            return 0.7  # 기본값

        # 답변에 질문 키워드가 얼마나 포함되어 있는지
        matches = sum(1 for kw in question_keywords if kw in answer_lower)
        relevance = matches / len(question_keywords)

        return min(1.0, relevance * 1.2)  # 스케일 조정

    def evaluate_completeness(
        self,
        question: str,
        answer: str,
    ) -> float:
        """
        답변 완전성 평가

        평가 기준:
        - 답변이 질문에 충분히 답변했는가?
        - 필요한 정보가 모두 포함되어 있는가?

        Args:
            question: 사용자 질문
            answer: 챗봇 답변

        Returns:
            0-1 점수
        """
        # 간단한 길이 기반 + 구조 기반 평가
        # 프로덕션: LLM 기반 평가 권장

        # 1. 너무 짧으면 불완전
        if len(answer) < 30:
            return 0.4

        # 2. 적절한 길이 (50-300자)
        if 50 <= len(answer) <= 300:
            base_score = 0.9
        elif len(answer) > 300:
            base_score = 0.7  # 너무 길면 감점
        else:
            base_score = 0.6

        # 3. 구조적 완전성 체크
        # - 리스트 형태 답변 (액션 아이템 등)
        if "1." in answer or "-" in answer:
            base_score += 0.1

        # - 부가 설명이 있는지
        if "입니다" in answer or "했습니다" in answer:
            base_score += 0.05

        return min(1.0, base_score)

    def evaluate_response_time(
        self,
        start_time: float,
        end_time: float,
    ) -> Dict[str, float]:
        """
        응답 시간 평가

        Args:
            start_time: 시작 시간 (time.time())
            end_time: 종료 시간 (time.time())

        Returns:
            {"response_time_ms": float, "score": float}
        """
        response_time_ms = (end_time - start_time) * 1000

        # 응답 시간에 따른 점수
        # < 1초: 1.0
        # 1-2초: 0.9
        # 2-3초: 0.7
        # 3-5초: 0.5
        # > 5초: 0.3

        if response_time_ms < 1000:
            score = 1.0
        elif response_time_ms < 2000:
            score = 0.9
        elif response_time_ms < 3000:
            score = 0.7
        elif response_time_ms < 5000:
            score = 0.5
        else:
            score = 0.3

        return {
            "response_time_ms": response_time_ms,
            "score": score
        }

    def evaluate_all(
        self,
        question: str,
        answer: str,
        context: str,
        retrieved_chunks: Optional[List[str]] = None,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
    ) -> EvaluationMetrics:
        """
        전체 평가 지표 계산

        Args:
            question: 사용자 질문
            answer: 챗봇 답변
            context: 제공된 컨텍스트
            retrieved_chunks: RAG 검색 청크
            start_time: 시작 시간
            end_time: 종료 시간

        Returns:
            EvaluationMetrics 객체
        """
        self.logger.info("챗봇 성능 평가 시작")

        # 개별 지표 평가
        faithfulness = self.evaluate_faithfulness(answer, context)
        groundedness = self.evaluate_groundedness(answer, retrieved_chunks)
        relevance = self.evaluate_relevance(question, answer)
        completeness = self.evaluate_completeness(question, answer)

        # 응답 시간 평가
        response_time_ms = None
        time_score = None
        if start_time is not None and end_time is not None:
            time_result = self.evaluate_response_time(start_time, end_time)
            response_time_ms = time_result["response_time_ms"]
            time_score = time_result["score"]

        # 종합 점수 계산 (가중 평균)
        scores = [
            (faithfulness, 0.3),  # 사실 충실성 30%
            (groundedness, 0.2),  # 근거 기반성 20%
            (relevance, 0.25),    # 질문 연관성 25%
            (completeness, 0.25), # 답변 완전성 25%
        ]

        if time_score is not None:
            # 응답 시간은 보너스 점수로 추가 (최대 10% 가산)
            overall_score = sum(s * w for s, w in scores) + (time_score * 0.1)
        else:
            overall_score = sum(s * w for s, w in scores)

        overall_score = min(1.0, overall_score)

        metrics = EvaluationMetrics(
            faithfulness=faithfulness,
            groundedness=groundedness,
            relevance=relevance,
            completeness=completeness,
            response_time_ms=response_time_ms,
            overall_score=overall_score,
        )

        self.logger.info(f"평가 완료 - 종합 점수: {overall_score:.3f}")
        self.logger.info(
            f"세부 점수 - 충실성: {faithfulness:.3f}, "
            f"근거성: {groundedness:.3f}, "
            f"연관성: {relevance:.3f}, "
            f"완전성: {completeness:.3f}"
        )

        return metrics


# ==================== 편의 함수 ====================

def quick_evaluate(
    question: str,
    answer: str,
    context: str,
    logger: Optional[logging.Logger] = None,
) -> EvaluationMetrics:
    """
    간단한 평가 (응답 시간 제외)

    Args:
        question: 사용자 질문
        answer: 챗봇 답변
        context: 제공된 컨텍스트
        logger: 로거 (선택)

    Returns:
        EvaluationMetrics 객체
    """
    evaluator = PerformanceEvaluator(logger=logger)
    return evaluator.evaluate_all(
        question=question,
        answer=answer,
        context=context,
        retrieved_chunks=None,
        start_time=None,
        end_time=None,
    )
