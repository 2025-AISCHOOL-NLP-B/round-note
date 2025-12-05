import os
import sys
import redis
from rq import Worker, Queue
from pathlib import Path
from sqlalchemy.orm import Session

# Render에서 Root Directory가 backend로 설정된 경우 대응
# 현재 디렉토리가 backend/이면 부모를 sys.path에 추가
current_dir = Path(__file__).resolve().parent
if current_dir.name == 'backend':
    sys.path.insert(0, str(current_dir.parent))

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
    print("=" * 70)
    print("🚀 Redis Worker 초기화 시작")
    print(f"📡 Redis URL: {redis_url[:30]}...")
    
    if redis_url.startswith("rediss://"):
        print("🔒 SSL 연결 사용 (rediss://)")
        conn = redis.from_url(redis_url, ssl_cert_reqs='required')
    else:
        print("🔓 일반 연결 사용 (redis://)")
        conn = redis.from_url(redis_url)
    
    conn.ping()
    print("✅ Redis에 성공적으로 연결되었습니다.")
    print(f"📊 Redis 정보: {conn.info('server')['redis_version']}")
    print("=" * 70)
except Exception as e:
    print("=" * 70)
    print(f"❌ Redis 연결 실패: {e}")
    print("=" * 70)
    exit(1)

# --- 작업(Task)을 worker.py에 정의합니다. ---
def retranscribe_meeting(meeting_id: str, audio_filename: str | None = None) -> dict:
    """
    Batch STT using ElevenLabs for a meeting's .wav audio.
    Resolves audio path, calls STTService.transcribe_wav, and persists results.
    """
    print("\n" + "=" * 70)
    print(f"🎯 [WORKER] retranscribe_meeting 작업 시작")
    print(f"📝 Meeting ID: {meeting_id}")
    print(f"🎵 Audio filename: {audio_filename}")
    print("=" * 70)
    
    db: Session = SessionLocal()
    try:
        meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
        if not meeting:
            print(f"❌ [WORKER] Meeting not found: {meeting_id}")
            return {"success": False, "message": "Meeting not found", "meeting_id": meeting_id}

        # Mark status processing
        print(f"⏳ [WORKER] 상태를 'processing'으로 변경")
        meeting.FINAL_TRANSCRIPT_STATUS = "processing"
        meeting.FINAL_TRANSCRIPT_ERROR = None
        db.commit()

        # Resolve audio path from shared disk or local directories
        filename = audio_filename or (os.path.basename(meeting.LOCATION) if meeting.LOCATION else f"{meeting_id}.wav")
        audio_path = None
        
        print(f"🔍 [WORKER] 오디오 파일 탐색: {filename}")
        
        # Render Disk 또는 로컬 경로에서 파일 찾기
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
        
        print(f"📂 [WORKER] 탐색 경로: {possible_dirs}")
        
        for base in possible_dirs:
            candidate = os.path.join(base, filename)
            print(f"   검사 중: {candidate}")
            if os.path.exists(candidate):
                audio_path = candidate
                print(f"✅ [WORKER] 파일 발견: {audio_path}")
                break

        if not audio_path:
            print(f"❌ [WORKER] 오디오 파일을 찾을 수 없음: {filename}")
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
            # Overwrite realtime transcript with final transcript for consistency
            meeting.CONTENT = text
            
            # Synchronously generate summary and action items from final transcript
            print(f"[Worker] STT completed for {meeting_id}, generating summary and embeddings...")
            try:
                # Use LLM service directly in this transaction
                llm = LLMService()
                result = llm.get_summary_and_actions_sync([text]) if hasattr(LLMService, 'get_summary_and_actions_sync') else None
                if result is None:
                    import asyncio
                    async def _run():
                        return await llm.get_summary_and_actions([text])
                    result = asyncio.get_event_loop().run_until_complete(_run())

                print(f"[Worker] LLM result: {result}")
                
                # Save summary
                rolling_summary = result.get("rolling_summary") or result.get("summary")
                if rolling_summary:
                    summary_obj = models.Summary(
                        SUMMARY_ID=str(ulid.new()),
                        MEETING_ID=meeting_id,
                        FORMAT="markdown",
                        CONTENT=rolling_summary
                    )
                    db.add(summary_obj)
                    print(f"[Worker] Summary created for {meeting_id}")

                # Save action items
                action_items_list = result.get("action_items", [])
                print(f"[Worker] Processing {len(action_items_list)} action items for {meeting_id}")
                for item_data in action_items_list:
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
                
                print(f"[Worker] Action items created for {meeting_id}")
            except Exception as e:
                print(f"[Worker] Summarization failed: {e}")
            
            # Synchronously index embeddings
            try:
                from backend.core.llm.rag.indexer import index_meeting_transcript
                index_meeting_transcript(db, meeting_id)
                print(f"[Worker] Embeddings indexed for {meeting_id}")
            except Exception as e:
                print(f"[Worker] Embedding indexing failed: {e}")
            
            # Commit all changes in one transaction
            db.commit()
            print(f"✅ [WORKER] All tasks completed for {meeting_id}")
            
            return {"success": True, "meeting_id": meeting_id, "length": len(text or "")}
        else:
            meeting.FINAL_TRANSCRIPT_STATUS = "error"
            meeting.FINAL_TRANSCRIPT_ERROR = (raw or {}).get("message") or str((raw or {}))
            db.commit()
            # Fallback: use realtime transcript CONTENT to continue pipeline
            try:
                if meeting.CONTENT and meeting.CONTENT.strip():
                    from backend.core.llm.rag.indexer import index_meeting_transcript
                    # Summarize and action items from CONTENT
                    llm = LLMService()
                    result = llm.get_summary_and_actions_sync([meeting.CONTENT]) if hasattr(LLMService, 'get_summary_and_actions_sync') else None
                    if result is None:
                        import asyncio
                        async def _run():
                            return await llm.get_summary_and_actions([meeting.CONTENT])
                        result = asyncio.get_event_loop().run_until_complete(_run())

                    # Save summary
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

                    # Index embeddings from fallback text
                    index_meeting_transcript(db, meeting_id)
                    db.commit()
            except Exception:
                db.rollback()
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
        print(f"[Worker] Summarize job started for meeting {meeting_id}")
        meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
        if not meeting:
            print(f"[Worker] Meeting not found: {meeting_id}")
            return {"success": False, "message": "Meeting not found", "meeting_id": meeting_id}
        if not meeting.FINAL_TRANSCRIPT_TEXT:
            print(f"[Worker] Final transcript not ready for {meeting_id}")
            return {"success": False, "message": "Final transcript not ready", "meeting_id": meeting_id}

        print(f"[Worker] Calling LLM for summary/actions for {meeting_id}")
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
            print(f"[Worker] Summary created for {meeting_id}")

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
        
        print(f"[Worker] Action items created for {meeting_id}")
        db.commit()
        print(f"[Worker] Summarize job completed for {meeting_id}")
        return {"success": True, "meeting_id": meeting_id, "summary_saved": bool(summary_obj)}
    except Exception as e:
        print(f"[Worker] Summarize job error for {meeting_id}: {e}")
        db.rollback()
        return {"success": False, "meeting_id": meeting_id, "error": str(e)}
    finally:
        db.close()


def translate_meeting_content(meeting_id: str, content_type: str, source_lang: str = "Korean", target_lang: str = "English") -> dict:
    """
    Translate meeting content (summary or transcript) in background.
    
    Args:
        meeting_id: Meeting ID
        content_type: "summary" or "transcript"
        source_lang: Source language (default: "Korean")
        target_lang: Target language (default: "English")
    """
    db: Session = SessionLocal()
    try:
        print(f"[Worker] Translation job started for {meeting_id} ({content_type} -> {target_lang})")
        
        meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
        if not meeting:
            print(f"[Worker] Meeting not found: {meeting_id}")
            return {"success": False, "message": "Meeting not found", "meeting_id": meeting_id}
        
        llm = LLMService()
        
        if content_type == "summary":
            # Translate summary
            summary = db.query(models.Summary).filter(models.Summary.MEETING_ID == meeting_id).first()
            if not summary:
                print(f"[Worker] Summary not found for {meeting_id}")
                return {"success": False, "message": "Summary not found", "meeting_id": meeting_id}
            
            # Update status to processing
            summary.TRANSLATION_STATUS = "processing"
            summary.TRANSLATION_TARGET_LANG = target_lang
            summary.TRANSLATION_ERROR = None
            db.commit()
            
            # Perform translation (blocking async call)
            import asyncio
            async def _translate():
                return await llm.get_translation(summary.CONTENT, source_lang=source_lang, target_lang=target_lang)
            
            translated_text = asyncio.get_event_loop().run_until_complete(_translate())
            
            # Save with language tag
            summary.TRANSLATED_CONTENT = f"[{target_lang}]|{translated_text}"
            summary.TRANSLATION_STATUS = "done"
            db.commit()
            
            print(f"[Worker] Summary translation completed for {meeting_id}")
            return {"success": True, "meeting_id": meeting_id, "content_type": "summary", "target_lang": target_lang}
            
        elif content_type == "transcript":
            # Translate transcript
            if not meeting.CONTENT:
                print(f"[Worker] No transcript found for {meeting_id}")
                return {"success": False, "message": "No transcript found", "meeting_id": meeting_id}
            
            # Update status to processing
            meeting.TRANSLATION_STATUS = "processing"
            meeting.TRANSLATION_TARGET_LANG = target_lang
            meeting.TRANSLATION_ERROR = None
            db.commit()
            
            # Perform translation (blocking async call)
            import asyncio
            async def _translate():
                return await llm.get_translation(meeting.CONTENT, source_lang=source_lang, target_lang=target_lang)
            
            translated_text = asyncio.get_event_loop().run_until_complete(_translate())
            
            # Save with language tag
            meeting.TRANSLATED_CONTENT = f"[{target_lang}]|{translated_text}"
            meeting.TRANSLATION_STATUS = "done"
            db.commit()
            
            print(f"[Worker] Transcript translation completed for {meeting_id}")
            return {"success": True, "meeting_id": meeting_id, "content_type": "transcript", "target_lang": target_lang}
            
        else:
            return {"success": False, "message": "Invalid content_type", "meeting_id": meeting_id}
            
    except Exception as e:
        print(f"[Worker] Translation job error for {meeting_id}: {e}")
        db.rollback()
        
        # Update error status
        try:
            if content_type == "summary":
                summary = db.query(models.Summary).filter(models.Summary.MEETING_ID == meeting_id).first()
                if summary:
                    summary.TRANSLATION_STATUS = "error"
                    summary.TRANSLATION_ERROR = str(e)
            else:
                meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
                if meeting:
                    meeting.TRANSLATION_STATUS = "error"
                    meeting.TRANSLATION_ERROR = str(e)
            db.commit()
        except Exception:
            pass
            
        return {"success": False, "meeting_id": meeting_id, "error": str(e)}
    finally:
        db.close()


def main():
    """RQ Worker 메인 함수"""
    # Listen on queues used for retranscription, translation and future tasks
    listen = ['high-priority-queue', 'stt', 'translation']

    print("\n" + "=" * 70)
    print(f"👂 '{listen}' 큐를 감시합니다.")
    print("=" * 70)

    queues = [Queue(name, connection=conn) for name in listen]
    
    # 각 큐의 현재 작업 수 출력
    print("\n📊 큐 상태:")
    for queue in queues:
        job_count = queue.count
        print(f"  - Queue '{queue.name}': {job_count} jobs waiting")
    
    worker = Worker(queues, connection=conn)
    print(f"\n🤖 Worker ID: {worker.name}")
    print("=" * 70)
    print("⏳ 새 작업을 기다립니다...\n")

    # work()는 무한 루프입니다. 이 프로세스는 종료되지 않고 계속 실행됩니다.
    try:
        worker.work(with_scheduler=True)
    except KeyboardInterrupt:
        print("\n\n" + "=" * 70)
        print("⏹️  Worker 종료 신호 수신")
        print("=" * 70)
        raise


if __name__ == '__main__':
    main()