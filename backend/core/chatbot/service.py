# backend/core/chatbot/service.py

import os
import logging
import time
from typing import List, Optional

from sqlalchemy.orm import Session
from openai import OpenAI

from backend import models
from backend.crud import chatbot as chatbot_crud
from backend.schemas.chatbot import (
    ChatbotQuestionRequest,
    ChatbotAnswerResponse,
    RetrievedChunk,
    FullTextChatbotRequest,
    FullTextChatbotResponse,
    MeetingContext,
)
from backend.core.llm.rag.retriever import RAGRetriever
from backend.core.chatbot.conversation_helpers import (
    should_skip_llm,
    enhance_answer,
    reinterpret_question,
)
from backend.core.chatbot.evaluation import PerformanceEvaluator


class ChatbotService:
    """
    회의 기반 RAG 챗봇 서비스 (LangChain 미사용 버전)
    """

    def __init__(
        self,
        client: Optional[OpenAI] = None,
        model: str = "gpt-4.1-nano",
        enable_evaluation: bool = False,
    ):
        """
        Args:
            client: 테스트용 OpenAI 클라이언트 주입 (없으면 환경변수 기반 생성)
            model: 사용할 ChatGPT 계열 모델명
            enable_evaluation: 성능 평가 활성화 여부 (기본값: False)
        """
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key and not client:
            logging.getLogger(__name__).error("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다!")
            raise ValueError("OPENAI_API_KEY가 설정되지 않았습니다.")

        self.client = client or OpenAI(api_key=api_key)
        self.model = model
        self.enable_evaluation = enable_evaluation
        self.evaluator = PerformanceEvaluator(logger=logging.getLogger(__name__)) if enable_evaluation else None
        logging.getLogger(__name__).info(f"ChatbotService 초기화 완료 - 모델: {model}, 평가 모드: {enable_evaluation}")

    def _build_meeting_context(self, meeting: Optional[models.Meeting]) -> dict:
        """
        Meeting 객체에서 프롬프트에 필요한 필드들 추출
        meeting이 None이면 빈 컨텍스트 반환
        """
        if not meeting:
            return {
                "title": "",
                "purpose": "",
                "summary": "",
                "decisions": "",
                "next_steps": "",
            }
        
        return {
            "title": meeting.TITLE or "",
            "purpose": meeting.PURPOSE or "",
            "summary": meeting.AI_SUMMARY or "",
            "decisions": getattr(meeting, "KEY_DECISIONS", "") or "",
            "next_steps": getattr(meeting, "NEXT_STEPS", "") or "",
        }

    def _invoke_llm(self, system_content: str, user_content: str, conversation_history: Optional[List[dict]] = None) -> str:
        """
        OpenAI ChatCompletion 호출 래퍼
        (테스트에서 override 하기 쉽도록 분리)

        Args:
            system_content: 시스템 프롬프트
            user_content: 사용자 프롬프트
            conversation_history: 이전 대화 히스토리 (최근 N개)
        """
        logger = logging.getLogger(__name__)
        logger.info(f"OpenAI API 호출 시작 - 모델: {self.model}")

        try:
            # 메시지 구성: system + history + current user message
            messages = [{"role": "system", "content": system_content}]

            # 대화 히스토리 추가 (있는 경우)
            if conversation_history:
                messages.extend(conversation_history)
                logger.info(f"대화 히스토리 {len(conversation_history)}개 추가")

            # 현재 사용자 메시지 추가
            messages.append({"role": "user", "content": user_content})

            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.3,
            )
            answer = response.choices[0].message.content
            logger.info(f"OpenAI API 호출 성공 - 응답 길이: {len(answer) if answer else 0}")
            return answer
        except Exception as e:
            logger.error(f"OpenAI API 호출 실패: {str(e)}", exc_info=True)
            raise

    def answer_question(
        self,
        db: Session,
        meeting: Optional[models.Meeting],
        user: models.User,
        payload: ChatbotQuestionRequest,
    ) -> ChatbotAnswerResponse:
        """
        메인 엔트리: 질문 → (RAG + LLM) → 답변 생성 + 로그 저장
        meeting이 None이면 전체 회의에서 검색
        """

        # 1) 회의 정보 컨텍스트
        ctx = self._build_meeting_context(meeting)
        meeting_id = meeting.MEETING_ID if meeting else None

        # 2) 최근 Q&A 컨텍스트 텍스트 생성
        if meeting_id:
            recent_chat_context = chatbot_crud.get_recent_chat_context(
                db, meeting_id=meeting_id, limit=5
            )
            chat_context = (
                recent_chat_context
                if recent_chat_context
                else "이전에 진행된 Q&A가 없습니다."
            )
        else:
            chat_context = "전체 회의 검색 모드입니다."

        # 3) RAG 검색 (필요 시만)
        retrieved_texts = []
        if payload.use_rag:
            retriever = RAGRetriever(db)
            # meeting_id로 검색 범위 제한 (None이면 전체 검색)
            retrieved_texts = retriever.retrieve(
                query=payload.question,
                k=10 if not meeting_id else 5,
                meeting_id=meeting_id,
            )
            logging.getLogger(__name__).info(
                "RAG retrieved %d chunks for meeting=%s", 
                len(retrieved_texts), 
                meeting_id or "ALL"
            )

        # Build rag_context with source tags when metadata available
        if retrieved_texts:
            parts = []
            for r in retrieved_texts:
                # r is dict like {embedding_id, text, similarity, created_at}
                eid = r.get("embedding_id") if isinstance(r, dict) else None
                text = r.get("text") if isinstance(r, dict) else (r if isinstance(r, str) else str(r))
                sim = r.get("similarity") if isinstance(r, dict) else None
                header = f"[source:{eid} sim:{sim:.3f}]" if eid and sim is not None else (f"[source:{eid}]" if eid else "")
                parts.append(f"{header}\n{text}")
            rag_context = "\n\n".join(parts)
        else:
            rag_context = "관련 발언이 충분히 검색되지 않았습니다."

        # 4) system / user 프롬프트 구성
        if meeting_id:
            system_prompt = (
                "당신은 회의 내용을 정리해주는 한국어 AI 비서입니다.\n"
                "회의에서 실제로 언급된 내용에 근거해서만 답변하고, "
                "언급되지 않은 내용은 '해당 회의에서 언급되지 않았습니다'라고 명확히 말하세요.\n"
                "답변은 너무 길지 않게, 핵심 위주로 정리해서 설명하세요."
            )
        else:
            system_prompt = (
                "당신은 모든 회의 내용을 검색하여 답변하는 한국어 AI 비서입니다.\n"
                "검색된 회의 내용에 근거해서만 답변하고, "
                "관련 내용이 없으면 '관련된 회의 내용을 찾을 수 없습니다'라고 명확히 말하세요.\n"
                "답변은 너무 길지 않게, 핵심 위주로 정리해서 설명하세요."
            )

        user_prompt = (
            f"[회의 기본 정보]\n"
            f"- 제목: {ctx['title']}\n"
            f"- 목적: {ctx['purpose']}\n\n"
            f"[회의 요약]\n{ctx['summary']}\n\n"
            f"[주요 결정사항]\n{ctx['decisions']}\n\n"
            f"[다음 단계]\n{ctx['next_steps']}\n\n"
            f"[관련 발언 (RAG 검색 결과)]\n{rag_context}\n\n"
            f"[최근 Q&A]\n{chat_context}\n\n"
            f"[사용자 질문]\n{payload.question}\n\n"
            "위 정보만을 근거로, 한국어로 자연스럽게 답변하세요."
        )

        # 5) LLM 호출
        answer_text = self._invoke_llm(system_prompt, user_prompt)

        # 6) 로그 저장 (meeting_id가 None일 경우 임시 처리 필요)
        # 전체 회의 검색인 경우, 로그를 저장하지 않거나 별도 테이블에 저장
        if meeting_id:
            log = chatbot_crud.create_chatbot_log(
                db=db,
                meeting_id=meeting_id,
                user_id=user.USER_ID,
                question=payload.question,
                answer=answer_text,
            )
            log_id = log.LOG_ID
            created_at = log.ASKED_DT
        else:
            # 전체 회의 검색 시 로그를 저장하지 않음 (또는 별도 로직 추가)
            from datetime import datetime
            log_id = "GLOBAL_SEARCH"
            created_at = datetime.now()

        # 7) 응답 스키마 변환
        # Convert retrieved_texts metadata into RetrievedChunk objects
        if retrieved_texts:
            retrieved_chunks = []
            for r in retrieved_texts:
                if isinstance(r, dict):
                    retrieved_chunks.append(
                        RetrievedChunk(
                            embedding_id=r.get("embedding_id"),
                            text=r.get("text"),
                            similarity=r.get("similarity"),
                        )
                    )
                else:
                    # legacy string
                    retrieved_chunks.append(RetrievedChunk(text=str(r)))
        else:
            retrieved_chunks = None

        return ChatbotAnswerResponse(
            log_id=log_id,
            question=payload.question,
            answer=answer_text,
            retrieved_chunks=retrieved_chunks,
            confidence=None,  # RAG에서 점수 안 쓰고 있으므로 우선 None
            created_at=created_at,
        )

    def answer_question_fulltext(
        self,
        db: Session,
        payload: FullTextChatbotRequest,
    ) -> FullTextChatbotResponse:
        """
        RAG 기반 챗봇: N개의 회의에서 벡터 검색으로 관련 정보를 추출하여 답변 생성
        (벡터 임베딩 기반 유사도 검색 사용)

        Args:
            db: 데이터베이스 세션
            payload: meeting_ids와 question을 포함한 요청

        Returns:
            FullTextChatbotResponse: 답변과 사용된 회의 정보
        """
        from datetime import datetime
        logger = logging.getLogger(__name__)

        # 성능 측정 시작
        start_time = time.time() if self.enable_evaluation else None

        logger.info(f"풀텍스트 챗봇 처리 시작 - 회의 ID: {payload.meeting_ids}")

        # ========== 1) 질문 재해석 (의도 파악 및 힌트 추가) ==========
        reinterpreted_question = reinterpret_question(payload.question)
        logger.info(f"질문 재해석: '{payload.question}' → '{reinterpreted_question}'")

        # ========== 2) 인사말/일상 대화 감지 (LLM 호출 없이 처리) ==========
        skip_llm, direct_response = should_skip_llm(payload.question)

        if skip_llm:
            logger.info(f"LLM 스킵 - 직접 응답: {direct_response[:50]}...")
            return FullTextChatbotResponse(
                question=payload.question,
                answer=direct_response,
                used_meetings=[],
                created_at=datetime.now(),
            )

        # ========== 3) 회의 조회 ==========
        meetings = (
            db.query(models.Meeting)
            .filter(models.Meeting.MEETING_ID.in_(payload.meeting_ids))
            .all()
        )

        if not meetings:
            logger.warning("유효한 회의를 찾을 수 없습니다.")
            raise ValueError("유효한 회의를 찾을 수 없습니다.")

        # ========== 4) RAG 벡터 검색으로 관련 청크 수집 ==========
        retriever = RAGRetriever(db)
        all_retrieved_chunks = []
        meeting_contexts = []

        for meeting in meetings:
            # 회의 메타데이터
            title = meeting.TITLE or "제목 없음"
            summary = meeting.AI_SUMMARY or ""

            # 각 회의에서 관련 청크 검색 (벡터 유사도 기반)
            retrieved_results = retriever.retrieve(
                query=reinterpreted_question,
                k=10,  # 각 회의당 최대 10개 청크
                meeting_id=meeting.MEETING_ID,
            )

            logger.info(f"회의 '{title}'에서 {len(retrieved_results)}개 청크 검색됨")

            # 액션 아이템 조회
            action_items = (
                db.query(models.ActionItem)
                .filter(models.ActionItem.MEETING_ID == meeting.MEETING_ID)
                .all()
            )

            # 액션 아이템 포맷팅
            if action_items:
                action_list = []
                for idx, item in enumerate(action_items, 1):
                    due_date = item.DUE_DT.strftime("%Y-%m-%d") if item.DUE_DT else "미정"
                    assignee = item.ASSIGNEE_NAME or "미지정"
                    status = item.STATUS or "PENDING"
                    priority = item.PRIORITY or "MEDIUM"
                    action_list.append(
                        f"{idx}. [{status}] {item.TITLE} (담당: {assignee}, 마감: {due_date}, 우선순위: {priority})"
                    )
                action_items_text = "\n".join(action_list)
            else:
                action_items_text = "액션 아이템이 없습니다."

            # 검색된 청크 저장
            for chunk_data in retrieved_results:
                chunk_text = chunk_data.get("text", "")
                similarity = chunk_data.get("similarity") or 0.0  # None 처리
                embedding_id = chunk_data.get("embedding_id") or ""

                all_retrieved_chunks.append({
                    "meeting_title": title,
                    "text": chunk_text,
                    "similarity": similarity,
                    "embedding_id": embedding_id,
                    "action_items": action_items_text,
                })

            # 응답용 메타데이터
            meeting_contexts.append(
                MeetingContext(
                    meeting_id=meeting.MEETING_ID,
                    title=title,
                    content_length=len(retrieved_results)  # 검색된 청크 수
                )
            )

        # ========== 5) 검색된 청크를 유사도 순으로 정렬 후 상위 20개 선택 ==========
        if not all_retrieved_chunks:
            logger.warning("RAG 검색 결과가 없습니다. 회의에 임베딩 데이터가 없을 수 있습니다.")
            # 검색 결과가 없을 경우 기본 메시지 반환
            return FullTextChatbotResponse(
                question=payload.question,
                answer="죄송합니다. 해당 회의에서 관련 정보를 찾을 수 없습니다. 회의 전사 데이터가 처리되지 않았거나, 질문과 관련된 내용이 없을 수 있습니다.",
                used_meetings=meeting_contexts,
                created_at=datetime.now(),
            )

        all_retrieved_chunks.sort(key=lambda x: x["similarity"], reverse=True)
        top_chunks = all_retrieved_chunks[:20]  # 전체에서 상위 20개만 사용

        logger.info(f"총 {len(all_retrieved_chunks)}개 청크 중 상위 {len(top_chunks)}개 선택")

        # ========== 6) 컨텍스트 구성 (RAG 검색 결과 기반) ==========
        context_parts = []
        for chunk in top_chunks:
            header = f"[회의: {chunk['meeting_title']} | 유사도: {chunk['similarity']:.3f}]"
            context_parts.append(f"{header}\n{chunk['text']}")

        # 액션 아이템 추가 (중복 제거)
        action_items_by_meeting = {}
        for chunk in top_chunks:
            meeting_title = chunk['meeting_title']
            if meeting_title not in action_items_by_meeting:
                action_items_by_meeting[meeting_title] = chunk['action_items']

        action_items_context = "\n\n".join([
            f"=== {title} 액션 아이템 ===\n{items}"
            for title, items in action_items_by_meeting.items()
        ])

        combined_context = "\n\n".join(context_parts) + f"\n\n[액션 아이템 정보]\n{action_items_context}"

        # ========== 7) System/User 프롬프트 구성 (RAG 기반, 유연한 톤 + Few-shot 예시) ==========
        system_prompt = """당신은 회의 내용을 분석하고 질문에 답변하는 친근하고 유연한 한국어 AI 비서입니다.

[답변 규칙]
1. 제공된 RAG 검색 결과(관련 회의 발언)와 액션 아이템에 근거해서만 답변하세요
2. 검색 결과에 없는 내용은 "해당 회의에서 관련 내용을 찾을 수 없습니다" + 도움될 만한 제안 추가
3. 여러 회의가 제공된 경우, 각 회의를 구분하거나 종합하여 설명
4. 답변은 핵심 위주로 간결하게 (2-3문장 권장)
5. 자연스럽고 친근한 톤 유지
6. 불필요한 반복 피하기 (매번 같은 인사말 반복 금지)
7. 검색된 청크의 유사도가 낮으면 (0.5 미만) 신중하게 답변하세요

[톤 가이드]
- 정보가 있을 때: 자연스럽게 답변 ("네, ~입니다", "~로 결정되었습니다")
- 정보가 없을 때: 친절하게 대안 제시
- 항상 간결하고 명확하게

[Few-shot 예시]

Q: "이번 회의 요약해줘"
A: "이번 회의에서는 신제품 출시 일정을 논의했습니다. 최종 출시일은 2025년 3월 15일로 결정되었고, 마케팅팀은 2월 말까지 홍보 자료를 준비하기로 했습니다."

Q: "내가 맡은 역할이 뭐야?" 또는 "해야 될 일 알려줘"
A: "액션 아이템을 확인해보니, 김철수님께서 담당하신 업무는 다음과 같습니다:
1. [PENDING] 마케팅 자료 준비 (마감: 2025-02-28, 우선순위: HIGH)
2. [IN_PROGRESS] 예산안 검토 (마감: 2025-02-15, 우선순위: MEDIUM)"

Q: "예산은 얼마로 결정됐어?"
A: "해당 회의에서 예산에 대한 명확한 언급은 없었습니다. 다음 회의에서 논의될 예정인 것으로 보입니다."

Q: "다음 회의 일정은?"
A: "전사 내용에서 다음 회의 일정에 대한 언급을 찾을 수 없었습니다. 회의록이나 일정 관리 시스템을 확인해보시는 것을 추천드립니다." """

        user_prompt = (
            f"[RAG 검색 결과 - 질문과 관련된 회의 발언들]\n"
            f"{combined_context}\n\n"
            f"[사용자 질문]\n{reinterpreted_question}\n\n"
            "위 검색 결과만을 근거로, 한국어로 자연스럽게 답변하세요."
        )

        # ========== 8) 대화 히스토리 준비 ==========
        conversation_history = None
        if payload.conversation_history:
            # 스키마의 ConversationMessage를 dict로 변환
            conversation_history = [
                {"role": msg.role, "content": msg.content}
                for msg in payload.conversation_history
            ]
            logger.info(f"대화 히스토리 {len(conversation_history)}개 메시지 사용")

        # ========== 9) LLM 호출 ==========
        logger.info("LLM 호출 시작")
        answer_text = self._invoke_llm(system_prompt, user_prompt, conversation_history)
        logger.info(f"LLM 호출 완료 - 답변 길이: {len(answer_text)}")

        # ========== 10) 답변 패턴 다양화 ==========
        enhanced_answer = enhance_answer(answer_text, payload.question)

        # ========== 11) 성능 평가 (활성화된 경우) ==========
        if self.enable_evaluation and self.evaluator and start_time:
            end_time = time.time()
            metrics = self.evaluator.evaluate_all(
                question=payload.question,
                answer=enhanced_answer,
                context=combined_context,
                retrieved_chunks=top_chunks,  # RAG 모드에서 검색된 청크 전달
                start_time=start_time,
                end_time=end_time,
            )
            logger.info(
                f"[성능 평가] 종합: {metrics.overall_score:.3f}, "
                f"충실성: {metrics.faithfulness:.3f}, "
                f"근거성: {metrics.groundedness:.3f}, "
                f"연관성: {metrics.relevance:.3f}, "
                f"완전성: {metrics.completeness:.3f}, "
                f"응답시간: {metrics.response_time_ms:.1f}ms"
            )

        # ========== 12) 응답 생성 ==========
        response = FullTextChatbotResponse(
            question=payload.question,
            answer=enhanced_answer,
            used_meetings=meeting_contexts,
            created_at=datetime.now(),
        )
        logger.info("RAG 챗봇 처리 완료")
        return response
