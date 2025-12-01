# backend/core/llm/rag/indexer.py

from sqlalchemy.orm import Session
from backend.core.llm.rag.vectorstore import VectorStore
from backend import models
from backend.database import SessionLocal


def index_meeting_transcript_background(meeting_id: str):
    """
    Background helper that creates its own DB session and runs indexing.
    Use this with FastAPI BackgroundTasks to avoid using a request-scoped
    DB session which would be closed before the background task runs.
    """
    db = SessionLocal()
    try:
        index_meeting_transcript(db, meeting_id)
    finally:
        db.close()

def index_meeting_transcript(db: Session, meeting_id: str):
    """
    회의 전체 전사를 적당한 길이로 쪼개서 EMBEDDING 테이블에 저장.
    """
    meeting = (
        db.query(models.Meeting)
        .filter(models.Meeting.MEETING_ID == meeting_id)
        .first()
    )
    if not meeting or not meeting.CONTENT:
        return

    # 1) 전사 텍스트를 간단하게 문단/문장 단위로 쪼개기 (간단 예시)
    raw_text = meeting.CONTENT
    chunks = [c.strip() for c in raw_text.split("\n") if c.strip()]
    # 필요하면 더 정교한 chunker로 교체

    # 2) VectorStore에 저장
    vs = VectorStore(db)
    vs.add_texts(meeting_id=meeting_id, texts=chunks)
