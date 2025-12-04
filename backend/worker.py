import os
import redis
from rq import Worker, Queue
from pathlib import Path
from sqlalchemy.orm import Session
from backend.database import SessionLocal
from backend import models
from backend.core.stt.service import STTService
from backend.core.llm.service import LLMService
import ulid

print("RQ Worker(일꾼) 프로세스가 시작됩니다...")

# Render에서 주입한 REDIS_URL 환경 변수를 읽습니다.
redis_url = os.getenv('REDIS_URL')

if not redis_url:
    print("에러: REDIS_URL 환경 변수가 설정되지 않았습니다.")
    exit(1)

# Render의 rediss:// (SSL) URL에 맞게 접속 설정을 합니다.
conn = None
try:
    if redis_url.startswith("rediss://"):
        conn = redis.from_url(redis_url, ssl_cert_reqs='required')
    else:
        conn = redis.from_url(redis_url)
    
    conn.ping()
    print("Redis에 성공적으로 연결되었습니다.")
except Exception as e:
    print(f"Redis 연결 실패: {e}")
    exit(1)

# --- 작업(Task)을 worker.py에 정의합니다. ---
def retranscribe_meeting(meeting_id: str, audio_filename: str | None = None) -> dict:
    """
    Batch STT using ElevenLabs for a meeting's .wav audio.
    Resolves audio path, calls STTService.transcribe_wav, and persists results.
    """
    db: Session = SessionLocal()
    try:
        meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
        if not meeting:
            return {"success": False, "message": "Meeting not found", "meeting_id": meeting_id}

        # Mark status processing
        meeting.FINAL_TRANSCRIPT_STATUS = "processing"
        meeting.FINAL_TRANSCRIPT_ERROR = None
        db.commit()

        # Resolve audio path
        possible_dirs = []
        if os.path.exists('/app/audio_storage'):
            possible_dirs.append('/app/audio_storage')
        try:
            root_dir = Path(__file__).resolve().parents[1]
            possible_dirs.append(str(root_dir / "audio_storage"))
        except Exception:
            pass
        possible_dirs.append(os.path.abspath('./audio_storage'))
        possible_dirs.append(os.path.abspath('../audio_storage'))
        possible_dirs.append(os.path.abspath('./backend/audio_storage'))

        filename = audio_filename or (os.path.basename(meeting.LOCATION) if meeting.LOCATION else f"{meeting_id}.wav")
        audio_path = None
        for base in possible_dirs:
            candidate = os.path.join(base, filename)
            if os.path.exists(candidate):
                audio_path = candidate
                break

        if not audio_path:
            meeting.FINAL_TRANSCRIPT_STATUS = "error"
            meeting.FINAL_TRANSCRIPT_ERROR = f"Audio file not found: {filename}"
            db.commit()
            return {"success": False, "message": "Audio file not found", "filename": filename}

        # Run ElevenLabs STT with meeting start time
        stt = STTService()
        text, raw = stt.transcribe_wav(audio_path, language="ko", meeting_start_time=meeting.START_DT)
        if text:
            meeting.FINAL_TRANSCRIPT_TEXT = text
            meeting.FINAL_TRANSCRIPT_STATUS = "done"
            db.commit()
            # Chain summarization and action item extraction
            try:
                summarize_meeting_from_final_transcript(meeting_id)
            except Exception:
                # best-effort; do not fail the transcript job
                pass
            return {"success": True, "meeting_id": meeting_id, "length": len(text or "")}
        else:
            meeting.FINAL_TRANSCRIPT_STATUS = "error"
            meeting.FINAL_TRANSCRIPT_ERROR = (raw or {}).get("message") or str((raw or {}))
            db.commit()
            return {"success": False, "meeting_id": meeting_id, "error": meeting.FINAL_TRANSCRIPT_ERROR}
    except Exception as e:
        try:
            meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
            if meeting:
                meeting.FINAL_TRANSCRIPT_STATUS = "error"
                meeting.FINAL_TRANSCRIPT_ERROR = str(e)
                db.commit()
        except Exception:
            pass
        return {"success": False, "meeting_id": meeting_id, "error": str(e)}
    finally:
        db.close()


def summarize_meeting_from_final_transcript(meeting_id: str) -> dict:
    """Create summary and action items using the final transcript text."""
    db: Session = SessionLocal()
    try:
        meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
        if not meeting:
            return {"success": False, "message": "Meeting not found", "meeting_id": meeting_id}
        if not meeting.FINAL_TRANSCRIPT_TEXT:
            return {"success": False, "message": "Final transcript not ready", "meeting_id": meeting_id}

        llm = LLMService()
        result = llm.get_summary_and_actions_sync([meeting.FINAL_TRANSCRIPT_TEXT]) if hasattr(LLMService, 'get_summary_and_actions_sync') else None
        if result is None:
            # fallback to async method via simple run (blocking)
            import asyncio
            async def _run():
                return await llm.get_summary_and_actions([meeting.FINAL_TRANSCRIPT_TEXT])
            result = asyncio.get_event_loop().run_until_complete(_run())

        # Save summary
        summary_obj = None
        rolling_summary = result.get("rolling_summary") or result.get("summary")
        if rolling_summary:
            summary_obj = models.Summary(
                SUMMARY_ID=str(ulid.new()),
                MEETING_ID=meeting_id,
                FORMAT="markdown",
                CONTENT=rolling_summary
            )
            db.add(summary_obj)

        # Save action items
        for item_data in result.get("action_items", []):
            deadline_str = item_data.get("deadline")
            due_dt = None
            if deadline_str and deadline_str != "미정":
                from datetime import datetime
                try:
                    due_dt = datetime.strptime(deadline_str, "%Y-%m-%d")
                except Exception:
                    due_dt = None

            ai = models.ActionItem(
                ITEM_ID=str(ulid.new()),
                MEETING_ID=meeting_id,
                TITLE=item_data.get("task", ""),
                DESCRIPTION=item_data.get("task", ""),
                STATUS="PENDING",
                PRIORITY="MEDIUM",
                ASSIGNEE_ID=None,
                ASSIGNEE_NAME=item_data.get("assignee"),
                DUE_DT=due_dt
            )
            db.add(ai)

        db.commit()
        return {"success": True, "meeting_id": meeting_id, "summary_saved": bool(summary_obj)}
    except Exception as e:
        db.rollback()
        return {"success": False, "meeting_id": meeting_id, "error": str(e)}
    finally:
        db.close()

if __name__ == '__main__':
    # Listen on queues used for retranscription and future tasks
    listen = ['high-priority-queue', 'stt']

    print(f"'{listen}' 큐를 감시합니다. 새 작업을 기다립니다...")

    queues = [Queue(name, connection=conn) for name in listen]
    worker = Worker(queues, connection=conn)

    # work()는 무한 루프입니다. 이 프로세스는 종료되지 않고 계속 실행됩니다.
    worker.work()