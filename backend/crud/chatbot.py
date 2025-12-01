# backend/crud/chatbot.py

from typing import List, Optional
from datetime import datetime

from sqlalchemy.orm import Session

from backend import models


def create_chatbot_log(
    db: Session,
    meeting_id: str,
    user_id: str,
    question: str,
    answer: str,
) -> models.ChatbotLog:
    """
    챗봇 Q&A 로그 1건 생성
    """
    log = models.ChatbotLog(
        MEETING_ID=meeting_id,
        USER_ID=user_id,
        Q_TEXT=question,
        A_TEXT=answer,
        ASKED_DT=datetime.utcnow(),
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


def get_chatbot_logs_by_meeting(
    db: Session,
    meeting_id: str,
    limit: int = 100,
) -> List[models.ChatbotLog]:
    """
    회의 ID 기준으로 Q&A 히스토리 조회
    """
    return (
        db.query(models.ChatbotLog)
        .filter(models.ChatbotLog.MEETING_ID == meeting_id)
        .order_by(models.ChatbotLog.ASKED_DT.asc())
        .limit(limit)
        .all()
    )


def get_chatbot_log_by_id(
    db: Session,
    log_id: str,
) -> Optional[models.ChatbotLog]:
    """
    LOG_ID 기준 단일 로그 조회
    """
    return (
        db.query(models.ChatbotLog)
        .filter(models.ChatbotLog.LOG_ID == log_id)
        .first()
    )


def get_recent_chat_context(
    db: Session,
    meeting_id: str,
    limit: int = 5,
) -> str:
    """
    LLM 프롬프트에 넣을 '최근 대화 컨텍스트' 문자열 생성

    예시 형식:
        사용자: 이 회의에서 예산 얘기 했었지?
        AI: 네, 마케팅 예산 20% 증액 논의했습니다.
        사용자: 담당자는 누구였지?
        AI: 김팀장이 담당자로 지정되었습니다.
    """
    logs = (
        db.query(models.ChatbotLog)
        .filter(models.ChatbotLog.MEETING_ID == meeting_id)
        .order_by(models.ChatbotLog.ASKED_DT.desc())
        .limit(limit)
        .all()
    )

    if not logs:
        return ""

    logs = list(reversed(logs))  # 오래된 것부터

    parts: list[str] = []
    for log in logs:
        parts.append(f"사용자: {log.Q_TEXT}")
        if log.A_TEXT:
            parts.append(f"AI: {log.A_TEXT}")

    return "\n".join(parts)


def delete_chatbot_logs_by_meeting(
    db: Session,
    meeting_id: str,
) -> int:
    """
    특정 회의의 모든 챗봇 로그 삭제
    """
    query = db.query(models.ChatbotLog).filter(
        models.ChatbotLog.MEETING_ID == meeting_id
    )
    deleted_count = query.delete(synchronize_session=False)
    db.commit()
    return deleted_count


def get_user_chat_stats(
    db: Session,
    user_id: str,
) -> dict:
    """
    사용자의 챗봇 사용 통계 (간단 버전)
    """
    total_questions = (
        db.query(models.ChatbotLog)
        .filter(models.ChatbotLog.USER_ID == user_id)
        .count()
    )

    last_log = (
        db.query(models.ChatbotLog)
        .filter(models.ChatbotLog.USER_ID == user_id)
        .order_by(models.ChatbotLog.ASKED_DT.desc())
        .first()
    )

    return {
        "user_id": user_id,
        "total_questions": total_questions,
        "last_asked_at": last_log.ASKED_DT if last_log else None,
    }
