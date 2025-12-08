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
from backend.core.chatbot.evaluation import PerformanceEvaluator
from backend.core.chatbot.adversarial_intelligence import AdversarialIntelligence


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

    def _determine_temperature(self, question: str) -> float:
        """
        질문 유형에 따라 적응형 temperature 결정

        Args:
            question: 사용자 질문

        Returns:
            temperature 값 (0.0 ~ 1.0)
        """
        question_lower = question.lower()

        # 1. 사실 기반 답변 (낮은 temperature = 0.2)
        factual_keywords = ["요약", "정리", "개요", "누가", "언제", "어디서", "몇", "얼마"]
        if any(keyword in question_lower for keyword in factual_keywords):
            return 0.2

        # 2. 창의적 답변 (높은 temperature = 0.7)
        creative_keywords = ["아이디어", "제안", "어떻게 하면", "개선", "전략", "추천"]
        if any(keyword in question_lower for keyword in creative_keywords):
            return 0.7

        # 3. 분석/추론 (중간 temperature = 0.5)
        analytical_keywords = ["왜", "이유", "분석", "평가", "비교", "차이"]
        if any(keyword in question_lower for keyword in analytical_keywords):
            return 0.5

        # 4. 기본값 (균형잡힌 0.4)
        return 0.4

    def _invoke_llm(
        self,
        system_content: str,
        user_content: str,
        conversation_history: Optional[List[dict]] = None,
        temperature: Optional[float] = None,
        stream: bool = False
    ) -> str:
        """
        OpenAI ChatCompletion 호출 래퍼 (적응형 temperature 지원)

        Args:
            system_content: 시스템 프롬프트
            user_content: 사용자 프롬프트
            conversation_history: 이전 대화 히스토리 (무제한)
            temperature: 온도 값 (None이면 자동 결정)
            stream: 스트리밍 모드 활성화 여부
        """
        logger = logging.getLogger(__name__)
        logger.info(f"OpenAI API 호출 시작 - 모델: {self.model}")

        try:
            # 메시지 구성: system + history + current user message
            messages = [{"role": "system", "content": system_content}]

            # 대화 히스토리 추가 (있는 경우, 무제한)
            if conversation_history:
                messages.extend(conversation_history)
                logger.info(f"대화 히스토리 {len(conversation_history)}개 추가 (전체 맥락 유지)")

            # 현재 사용자 메시지 추가
            messages.append({"role": "user", "content": user_content})

            # Temperature 자동 결정 (제공되지 않은 경우)
            if temperature is None:
                # user_content에서 질문 추출하여 temperature 결정
                temperature = self._determine_temperature(user_content)
                logger.info(f"적응형 temperature 자동 설정: {temperature}")

            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=temperature,
                stream=stream,
            )

            if stream:
                # 스트리밍 모드: generator 반환
                return response
            else:
                # 일반 모드: 전체 답변 반환
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

    def _is_adversarial_question(self, question: str) -> bool:
        """
        질문이 적대적 지능 분석을 요청하는지 감지
        """
        adversarial_keywords = [
            "놓친",
            "누락",
            "리스크",
            "위험",
            "문제",
            "모순",
            "불일치",
            "비논리",
            "적대적",
            "비판",
            "검토",
            "체크",
        ]

        question_lower = question.lower()
        return any(keyword in question_lower for keyword in adversarial_keywords)

    def _format_adversarial_analysis(self, analysis: dict) -> str:
        """
        적대적 지능 분석 결과를 자연스러운 답변 형식으로 변환
        """
        parts = []

        # 전체 점수
        score = analysis.get("overall_score", 0)
        if score >= 80:
            parts.append(f"회의 품질 점수: {score:.1f}/100 (우수)")
        elif score >= 60:
            parts.append(f"회의 품질 점수: {score:.1f}/100 (양호)")
        else:
            parts.append(f"회의 품질 점수: {score:.1f}/100 (개선 필요)")

        parts.append("")

        # 주요 발견사항
        inconsistencies = analysis.get("inconsistencies", [])
        missing_points = analysis.get("missing_points", [])
        contradictions = analysis.get("contradictions", [])
        risks = analysis.get("risks", [])
        illogical_conclusions = analysis.get("illogical_conclusions", [])

        if inconsistencies:
            parts.append(f"**논리적 불일치 ({len(inconsistencies)}건)**")
            for idx, item in enumerate(inconsistencies[:3], 1):  # 최대 3개만
                severity = item.get("severity", "medium")
                desc = item.get("description", "")
                parts.append(f"{idx}. [{severity.upper()}] {desc}")
            parts.append("")

        if missing_points:
            parts.append(f"**누락된 논점 ({len(missing_points)}건)**")
            for idx, item in enumerate(missing_points[:3], 1):
                severity = item.get("severity", "medium")
                topic = item.get("topic", "")
                desc = item.get("description", "")
                parts.append(f"{idx}. [{severity.upper()}] {topic}: {desc}")
            parts.append("")

        if contradictions:
            parts.append(f"**과거 결정과의 모순 ({len(contradictions)}건)**")
            for idx, item in enumerate(contradictions[:3], 1):
                severity = item.get("severity", "medium")
                desc = item.get("description", "")
                parts.append(f"{idx}. [{severity.upper()}] {desc}")
            parts.append("")

        if risks:
            parts.append(f"**잠재 리스크 ({len(risks)}건)**")
            for idx, item in enumerate(risks[:3], 1):
                severity = item.get("severity", "medium")
                category = item.get("category", "기타")
                desc = item.get("description", "")
                parts.append(f"{idx}. [{severity.upper()}] [{category}] {desc}")
            parts.append("")

        if illogical_conclusions:
            parts.append(f"**비논리적 결론 ({len(illogical_conclusions)}건)**")
            for idx, item in enumerate(illogical_conclusions[:3], 1):
                severity = item.get("severity", "medium")
                conclusion = item.get("conclusion", "")
                parts.append(f"{idx}. [{severity.upper()}] {conclusion}")
            parts.append("")

        # 권장사항
        recommendations = analysis.get("recommendations", [])
        if recommendations:
            parts.append("**개선 권장사항**")
            for rec in recommendations[:5]:  # 최대 5개
                parts.append(f"- {rec}")

        return "\n".join(parts)

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

        # ========== 1) 적대적 지능 질문 감지 ==========
        is_adversarial = self._is_adversarial_question(payload.question)

        if is_adversarial and len(payload.meeting_ids) == 1:
            # 적대적 지능 분석은 단일 회의에 대해서만 수행
            logger.info("적대적 지능 질문 감지 - 분석 수행")
            try:
                analyzer = AdversarialIntelligence(db=db)
                analysis_result = analyzer.analyze_meeting(payload.meeting_ids[0])

                # 분석 결과를 자연스러운 답변으로 변환
                formatted_answer = self._format_adversarial_analysis(analysis_result)

                # 회의 정보
                meeting = db.query(models.Meeting).filter(
                    models.Meeting.MEETING_ID == payload.meeting_ids[0]
                ).first()

                meeting_context = MeetingContext(
                    meeting_id=meeting.MEETING_ID,
                    title=meeting.TITLE or "제목 없음",
                    content_length=len(meeting.CONTENT or "")
                )

                return FullTextChatbotResponse(
                    question=payload.question,
                    answer=formatted_answer,
                    used_meetings=[meeting_context],
                    created_at=datetime.now(),
                )
            except Exception as e:
                logger.error(f"적대적 지능 분석 실패: {e}", exc_info=True)
                # 실패 시 일반 RAG 챗봇으로 폴백
                logger.info("적대적 지능 분석 실패 - 일반 RAG로 폴백")

        # ========== 2) 회의 조회 ==========
        meetings = (
            db.query(models.Meeting)
            .filter(models.Meeting.MEETING_ID.in_(payload.meeting_ids))
            .all()
        )

        if not meetings:
            logger.warning("유효한 회의를 찾을 수 없습니다.")
            raise ValueError("유효한 회의를 찾을 수 없습니다.")

        # ========== 5) RAG 벡터 검색으로 관련 청크 수집 ==========
        retriever = RAGRetriever(db)
        all_retrieved_chunks = []
        meeting_contexts = []

        for meeting in meetings:
            # 회의 메타데이터
            title = meeting.TITLE or "제목 없음"
            summary = meeting.AI_SUMMARY or ""

            # 각 회의에서 관련 청크 검색 (벡터 유사도 기반)
            retrieved_results = retriever.retrieve(
                query=payload.question,
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

        # ========== 6) 검색된 청크를 유사도 순으로 정렬 후 상위 20개 선택 ==========
        if not all_retrieved_chunks:
            logger.warning("RAG 검색 결과가 없습니다. RAG 폴백 모드로 전환합니다.")
            # ✅ RAG 폴백 전략: 검색 결과가 없어도 LLM의 일반 지식으로 답변 시도
            fallback_system_prompt = """현재 회의 내용에서는 관련 정보를 찾기 어렵습니다.
그러나 일반적인 상황을 기준으로 도움이 될 만한 간단한 조언을 알려드릴게요.

답변은 짧고 가독성 좋게 작성합니다."""

            fallback_user_prompt = f"""사용자 질문: {payload.question}

회의 전사 데이터에서 관련 정보를 찾을 수 없었습니다.
하지만 질문에 대해 일반적인 조언이나 도움이 될 만한 정보를 제공해주세요."""

            # 대화 히스토리 준비
            conversation_history = None
            if payload.conversation_history:
                conversation_history = [
                    {"role": msg.role, "content": msg.content}
                    for msg in payload.conversation_history
                ]

            # LLM 호출 (일반 지식 기반)
            fallback_answer = self._invoke_llm(
                fallback_system_prompt,
                fallback_user_prompt,
                conversation_history,
                temperature=0.5  # 균형잡힌 temperature
            )

            logger.info(f"RAG 폴백 답변 생성 완료 - 길이: {len(fallback_answer)}")

            return FullTextChatbotResponse(
                question=payload.question,
                answer=fallback_answer,
                used_meetings=meeting_contexts,
                created_at=datetime.now(),
            )

        all_retrieved_chunks.sort(key=lambda x: x["similarity"], reverse=True)
        top_chunks = all_retrieved_chunks[:20]  # 전체에서 상위 20개만 사용

        logger.info(f"총 {len(all_retrieved_chunks)}개 청크 중 상위 {len(top_chunks)}개 선택")

        # ========== 7) 컨텍스트 구성 (RAG 검색 결과 기반) ==========
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

        # ========== 8) System/User 프롬프트 구성 ==========
        system_prompt = """당신은 한국어 기반 GPT 스타일 AI 어시스턴트입니다.

[기본 원칙]
- 답변은 짧고 명확하며 가독성이 좋아야 합니다.
- 회의와 관련된 질문이면 제공된 회의 컨텍스트를 우선 사용합니다.
- 회의와 무관한 질문이면 GPT처럼 자연스럽고 유연하게 대화합니다.
- 정보가 부족하면 “해당 정보는 회의에 없었습니다”가 아니라 “찾기 어려워요”처럼 부드럽게 말합니다.
- 보고서 형식(핵심 요약, 상세 내용, 추가 제안 등)을 강요하지 않습니다.
- 목록은 최대 3개까지만, 문장은 1~3줄 단위로 끊어 가독성을 높입니다.
- 과한 단락·장문 금지.

[스타일 가이드]
- 존댓말 유지하되 대화체로.
- 이모지는 중요한 포인트에만 제한적으로 사용.
- 불필요한 굵은 글씨, 색상 강조 금지.
- 문단 간 줄바꿈은 필수.

[안전 원칙]
- 적대적/위험 질문은 안전하게 중립적으로.
"""

        user_prompt = (
            f"[RAG 검색 결과 - 질문과 관련된 회의 발언들]\n"
            f"{combined_context}\n\n"
            f"[사용자 질문]\n{payload.question}\n\n"
            "위 검색 결과만을 근거로, 한국어로 자연스럽게 답변하세요."
        )

        # ========== 9) 대화 히스토리 준비 ==========
        conversation_history = None
        if payload.conversation_history:
            # 스키마의 ConversationMessage를 dict로 변환
            conversation_history = [
                {"role": msg.role, "content": msg.content}
                for msg in payload.conversation_history
            ]
            logger.info(f"대화 히스토리 {len(conversation_history)}개 메시지 사용")

        # ========== 10) LLM 호출 ==========
        logger.info("LLM 호출 시작")
        answer_text = self._invoke_llm(system_prompt, user_prompt, conversation_history)
        logger.info(f"LLM 호출 완료 - 답변 길이: {len(answer_text)}")

        # ========== 11) 성능 평가 (활성화된 경우) ==========
        if self.enable_evaluation and self.evaluator and start_time:
            end_time = time.time()
            metrics = self.evaluator.evaluate_all(
                question=payload.question,
                answer=answer_text,
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
            answer=answer_text,
            used_meetings=meeting_contexts,
            created_at=datetime.now(),
        )
        logger.info("RAG 챗봇 처리 완료")
        return response

    def answer_question_streaming(
        self,
        db: Session,
        payload: FullTextChatbotRequest,
    ):
        """
        RAG 기반 챗봇 (스트리밍 모드): 실시간으로 답변 생성

        Args:
            db: 데이터베이스 세션
            payload: meeting_ids와 question을 포함한 요청

        Yields:
            답변 청크를 실시간으로 스트리밍
        """
        from datetime import datetime
        logger = logging.getLogger(__name__)

        logger.info(f"스트리밍 챗봇 처리 시작 - 회의 ID: {payload.meeting_ids}")

        # ========== 1) 회의 조회 ==========
        meetings = (
            db.query(models.Meeting)
            .filter(models.Meeting.MEETING_ID.in_(payload.meeting_ids))
            .all()
        )

        if not meetings:
            yield "data: " + '{"error": "유효한 회의를 찾을 수 없습니다."}\n\n'
            return

        # ========== 5) RAG 벡터 검색 ==========
        retriever = RAGRetriever(db)
        all_retrieved_chunks = []

        for meeting in meetings:
            retrieved_results = retriever.retrieve(
                query=payload.question,
                k=10,
                meeting_id=meeting.MEETING_ID,
            )

            for chunk_data in retrieved_results:
                chunk_text = chunk_data.get("text", "")
                similarity = chunk_data.get("similarity") or 0.0
                embedding_id = chunk_data.get("embedding_id") or ""

                all_retrieved_chunks.append({
                    "meeting_title": meeting.TITLE or "제목 없음",
                    "text": chunk_text,
                    "similarity": similarity,
                    "embedding_id": embedding_id,
                })

        # ========== 6) RAG 폴백 처리 ==========
        if not all_retrieved_chunks:
            logger.warning("RAG 검색 결과가 없습니다. 스트리밍 폴백 모드")
            fallback_system_prompt = """당신은 회의 전문 AI 어시스턴트입니다.
회의 데이터에서 정보를 찾을 수 없었지만, 일반적인 조언을 제공하세요."""

            fallback_user_prompt = f"사용자 질문: {payload.question}\n\n일반적인 조언을 제공해주세요."

            conversation_history = None
            if payload.conversation_history:
                conversation_history = [
                    {"role": msg.role, "content": msg.content}
                    for msg in payload.conversation_history
                ]

            # 스트리밍 LLM 호출
            stream_response = self._invoke_llm(
                fallback_system_prompt,
                fallback_user_prompt,
                conversation_history,
                temperature=0.5,
                stream=True
            )

            for chunk in stream_response:
                if chunk.choices[0].delta.content:
                    yield f"data: {chunk.choices[0].delta.content}\n\n"
                    time.sleep(0.02)  # 20ms 지연 (스트리밍 속도 조절)

            yield "data: [DONE]\n\n"
            return

        # ========== 7) 검색 결과 정렬 및 컨텍스트 구성 ==========
        all_retrieved_chunks.sort(key=lambda x: x["similarity"], reverse=True)
        top_chunks = all_retrieved_chunks[:20]

        context_parts = []
        for chunk in top_chunks:
            header = f"[회의: {chunk['meeting_title']} | 유사도: {chunk['similarity']:.3f}]"
            context_parts.append(f"{header}\n{chunk['text']}")

        combined_context = "\n\n".join(context_parts)

        # ========== 8) System/User 프롬프트 ==========
        system_prompt = """당신은 한국어 기반 GPT 스타일 AI 어시스턴트입니다.

[기본 원칙]
- 답변은 짧고 명확하며 가독성이 좋아야 합니다.
- 회의와 관련된 질문이면 제공된 회의 컨텍스트를 우선 사용합니다.
- 회의와 무관한 질문이면 GPT처럼 자연스럽고 유연하게 대화합니다.
- 정보가 부족하면 “해당 정보는 회의에 없었습니다”가 아니라 “찾기 어려워요”처럼 부드럽게 말합니다.
- 보고서 형식(핵심 요약, 상세 내용, 추가 제안 등)을 강요하지 않습니다.
- 목록은 최대 3개까지만, 문장은 1~3줄 단위로 끊어 가독성을 높입니다.
- 과한 단락·장문 금지.

[스타일 가이드]
- 존댓말 유지하되 대화체로.
- 이모지는 중요한 포인트에만 제한적으로 사용.
- 불필요한 굵은 글씨, 색상 강조 금지.
- 문단 간 줄바꿈은 필수.

[안전 원칙]
- 적대적/위험 질문은 안전하게 중립적으로.
"""

        user_prompt = (
            f"[RAG 검색 결과]\n{combined_context}\n\n"
            f"[사용자 질문]\n{payload.question}\n\n"
            "위 검색 결과를 근거로 답변하세요."
        )

        # ========== 9) 대화 히스토리 준비 ==========
        conversation_history = None
        if payload.conversation_history:
            conversation_history = [
                {"role": msg.role, "content": msg.content}
                for msg in payload.conversation_history
            ]

        # ========== 10) 스트리밍 LLM 호출 ==========
        logger.info("스트리밍 LLM 호출 시작")
        stream_response = self._invoke_llm(
            system_prompt,
            user_prompt,
            conversation_history,
            temperature=None,  # 자동 결정
            stream=True
        )

        # ========== 11) 스트리밍 응답 전송 ==========
        for chunk in stream_response:
            if chunk.choices[0].delta.content:
                yield f"data: {chunk.choices[0].delta.content}\n\n"
                time.sleep(0.02)  # 20ms 지연 (스트리밍 속도 조절)

        yield "data: [DONE]\n\n"
        logger.info("스트리밍 챗봇 처리 완료")
