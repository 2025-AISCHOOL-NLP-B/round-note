# backend/core/chatbot/service.py

import os
import logging
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


class ChatbotService:
    """
    회의 기반 RAG 챗봇 서비스 (LangChain 미사용 버전)
    """

    def __init__(
        self,
        client: Optional[OpenAI] = None,
        model: str = "gpt-4.1-nano",
    ):
        """
        Args:
            client: 테스트용 OpenAI 클라이언트 주입 (없으면 환경변수 기반 생성)
            model: 사용할 ChatGPT 계열 모델명
        """
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key and not client:
            logging.getLogger(__name__).error("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다!")
            raise ValueError("OPENAI_API_KEY가 설정되지 않았습니다.")
        
        self.client = client or OpenAI(api_key=api_key)
        self.model = model
        logging.getLogger(__name__).info(f"ChatbotService 초기화 완료 - 모델: {model}")

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

    def _invoke_llm(self, system_content: str, user_content: str) -> str:
        """
        OpenAI ChatCompletion 호출 래퍼
        (테스트에서 override 하기 쉽도록 분리)
        """
        logger = logging.getLogger(__name__)
        logger.info(f"OpenAI API 호출 시작 - 모델: {self.model}")
        
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": user_content},
                ],
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
        원문 기반 챗봇: N개의 회의 전문을 LLM에 직접 전달하여 답변 생성
        (벡터 검색 없이 원문만 사용)

        Args:
            db: 데이터베이스 세션
            payload: meeting_ids와 question을 포함한 요청

        Returns:
            FullTextChatbotResponse: 답변과 사용된 회의 정보
        """
        from datetime import datetime
        logger = logging.getLogger(__name__)
        
        logger.info(f"풀텍스트 챗봇 처리 시작 - 회의 ID: {payload.meeting_ids}")

        # 1) 회의 조회
        meetings = (
            db.query(models.Meeting)
            .filter(models.Meeting.MEETING_ID.in_(payload.meeting_ids))
            .all()
        )

        if not meetings:
            logger.warning("유효한 회의를 찾을 수 없습니다.")
            raise ValueError("유효한 회의를 찾을 수 없습니다.")

        # 2) 회의별 컨텍스트 구성
        meeting_contexts = []
        full_context_parts = []

        for meeting in meetings:
            # 회의 원문 (전사 텍스트)
            content = meeting.CONTENT or ""

            # 회의 메타데이터
            title = meeting.TITLE or "제목 없음"
            purpose = meeting.PURPOSE or ""
            summary = meeting.AI_SUMMARY or ""

            # 컨텍스트 구성
            context_part = f"""
=== {title} ===
목적: {purpose}
요약: {summary}

[전사 원문]
{content}
"""
            full_context_parts.append(context_part)

            # 응답용 메타데이터
            meeting_contexts.append(
                MeetingContext(
                    meeting_id=meeting.MEETING_ID,
                    title=title,
                    content_length=len(content)
                )
            )

        # 3) 전체 컨텍스트 통합
        combined_context = "\n\n".join(full_context_parts)

        # 4) System/User 프롬프트 구성
        system_prompt = (
            "당신은 회의 내용을 분석하고 질문에 답변하는 한국어 AI 비서입니다.\n"
            "제공된 회의 전사 원문에 근거해서만 답변하고, "
            "원문에 없는 내용은 '제공된 회의에서 언급되지 않았습니다'라고 명확히 말하세요.\n"
            "여러 회의가 제공된 경우, 각 회의를 회의 제목으로 구분하여 답변하거나 종합하여 설명하세요.\n"
            "답변은 핵심 위주로 간결하게 작성하세요."
        )

        user_prompt = (
            f"{combined_context}\n\n"
            f"[사용자 질문]\n{payload.question}\n\n"
            "위 회의 내용만을 근거로, 한국어로 자연스럽게 답변하세요."
        )

        # 5) LLM 호출
        logger.info("LLM 호출 시작")
        answer_text = self._invoke_llm(system_prompt, user_prompt)
        logger.info(f"LLM 호출 완료 - 답변 길이: {len(answer_text)}")

        # 6) 응답 생성
        response = FullTextChatbotResponse(
            question=payload.question,
            answer=answer_text,
            used_meetings=meeting_contexts,
            created_at=datetime.now(),
        )
        logger.info("풀텍스트 챗봇 처리 완료")
        return response
