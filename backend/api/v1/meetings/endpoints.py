from fastapi import APIRouter, Depends, status, HTTPException, UploadFile, File, BackgroundTasks, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
import os
from datetime import datetime
from backend.database import get_db
from backend.schemas import meeting as meeting_schema
from backend.crud import meeting as meeting_crud
from backend.dependencies import get_current_user
from backend import models
# RQ
import redis
from rq import Queue
# TODO: Redis/RQ 클라이언트 (get_redis_conn) 임포트 및 backend.worker.process_meeting_job 임포트
# [추가]
from backend.core.llm.rag.indexer import index_meeting_transcript, index_meeting_transcript_background
from pydantic import BaseModel

router = APIRouter(tags=["Meetings"])

# ==================== 1. 회의 생성 ====================
@router.post("/", response_model=meeting_schema.MeetingOut, status_code=status.HTTP_201_CREATED)
def create_meeting(
    meeting_in: meeting_schema.MeetingCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    새로운 회의를 생성합니다.
    
    - **title**: 회의 제목 (필수)
    - **purpose**: 회의 목적 (선택)
    - **is_realtime**: 실시간 회의 여부 (기본값: True)
    
    인증된 사용자만 회의를 생성할 수 있습니다.
    """
    # 현재 로그인한 사용자 ID로 회의 생성
    db_meeting = meeting_crud.create_meeting(
        db=db,
        meeting_in=meeting_in,
        user_id=current_user.USER_ID
    )
    return db_meeting

# ==================== 2. 회의 목록 조회 ====================
@router.get("/", response_model=List[meeting_schema.MeetingOut])
def list_meetings(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    현재 사용자가 생성한 회의 목록을 조회합니다.
    
    - **skip**: 건너뛸 개수 (페이징용, 기본값: 0)
    - **limit**: 최대 조회 개수 (기본값: 100)
    
    최신 회의가 먼저 나타납니다.
    """
    from sqlalchemy.orm import joinedload
    
    # 요약과 액션 아이템을 함께 로드
    meetings = db.query(models.Meeting).options(
        joinedload(models.Meeting.summaries),
        joinedload(models.Meeting.action_items)
    ).filter(
        models.Meeting.CREATOR_ID == current_user.USER_ID
    ).order_by(
        models.Meeting.START_DT.desc()
    ).offset(skip).limit(limit).all()
    
    # dict로 변환
    meeting_list = []
    for meeting in meetings:
        meeting_dict = {
            "meeting_id": meeting.MEETING_ID,
            "creator_id": meeting.CREATOR_ID,
            "title": meeting.TITLE,
            "purpose": meeting.PURPOSE,
            "start_dt": meeting.START_DT,
            "end_dt": meeting.END_DT,
            "location": meeting.LOCATION,
            "content": meeting.CONTENT,
            "translated_content": meeting.TRANSLATED_CONTENT,
            "ai_summary": meeting.AI_SUMMARY,
            "participants": meeting.PARTICIPANTS,
            "key_decisions": meeting.KEY_DECISIONS,
            "next_steps": meeting.NEXT_STEPS,
            "audio_url": meeting.AUDIO_URL,
            "summary": {
                "summary_id": meeting.summaries[0].SUMMARY_ID,
                "content": meeting.summaries[0].CONTENT,
                "translated_content": meeting.summaries[0].TRANSLATED_CONTENT,
                "format": meeting.summaries[0].FORMAT,
                "created_dt": meeting.summaries[0].CREATED_DT
            } if meeting.summaries else None,
            "action_items": [
                {
                    "item_id": item.ITEM_ID,
                    "title": item.TITLE,
                    "description": item.DESCRIPTION,
                    "status": item.STATUS,
                    "priority": item.PRIORITY,
                    "assignee_id": item.ASSIGNEE_ID,
                    "assignee_name": item.ASSIGNEE_NAME,
                    "jira_assignee_id": item.JIRA_ASSIGNEE_ID,
                    "due_dt": item.DUE_DT,
                    "created_dt": item.CREATED_DT,
                    "updated_dt": item.UPDATED_DT
                }
                for item in meeting.action_items
            ] if meeting.action_items else []
        }
        meeting_list.append(meeting_dict)
    
    return meeting_list

# ==================== 3. 회의 상세 조회 ====================
@router.get("/{meeting_id}", response_model=meeting_schema.MeetingOut)
def get_meeting(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    특정 회의의 상세 정보를 조회합니다.
    
    - **meeting_id**: 회의 ID (ULID)
    
    본인이 생성한 회의만 조회할 수 있습니다.
    """
    # 회의 조회 (요약과 액션 아이템 포함)
    from sqlalchemy.orm import joinedload
    
    db_meeting = db.query(models.Meeting).options(
        joinedload(models.Meeting.summaries),
        joinedload(models.Meeting.action_items)
    ).filter(models.Meeting.MEETING_ID == meeting_id).first()
    
    # 회의가 존재하지 않는 경우
    if not db_meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"회의를 찾을 수 없습니다. (meeting_id: {meeting_id})"
        )
    
    # 본인이 생성한 회의인지 확인
    if db_meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인이 생성한 회의만 조회할 수 있습니다."
        )
    
    # 요약과 액션 아이템을 dict로 변환
    meeting_dict = {
        "meeting_id": db_meeting.MEETING_ID,
        "creator_id": db_meeting.CREATOR_ID,
        "title": db_meeting.TITLE,
        "purpose": db_meeting.PURPOSE,
        "start_dt": db_meeting.START_DT,
        "end_dt": db_meeting.END_DT,
        "location": db_meeting.LOCATION,
        "content": db_meeting.CONTENT,
        "translated_content": db_meeting.TRANSLATED_CONTENT,
        "ai_summary": db_meeting.AI_SUMMARY,
        "participants": db_meeting.PARTICIPANTS,
        "key_decisions": db_meeting.KEY_DECISIONS,
        "next_steps": db_meeting.NEXT_STEPS,
        "audio_url": db_meeting.AUDIO_URL,
        "summary": {
            "summary_id": db_meeting.summaries[0].SUMMARY_ID,
            "content": db_meeting.summaries[0].CONTENT,
            "translated_content": db_meeting.summaries[0].TRANSLATED_CONTENT,
            "format": db_meeting.summaries[0].FORMAT,
            "created_dt": db_meeting.summaries[0].CREATED_DT
        } if db_meeting.summaries else None,
        "action_items": [
            {
                "item_id": item.ITEM_ID,
                "title": item.TITLE,
                "description": item.DESCRIPTION,
                "status": item.STATUS,
                "priority": item.PRIORITY,
                "assignee_id": item.ASSIGNEE_ID,
                "assignee_name": item.ASSIGNEE_NAME,
                "jira_assignee_id": item.JIRA_ASSIGNEE_ID,
                "due_dt": item.DUE_DT,
                "created_dt": item.CREATED_DT,
                "updated_dt": item.UPDATED_DT
            }
            for item in db_meeting.action_items
        ] if db_meeting.action_items else []
    }
    
    return meeting_dict

# ==================== 3-b. 회의 최종 전사/산출물 조회 ====================
@router.get("/{meeting_id}/artifacts")
def get_meeting_artifacts(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Return final transcript status/text and derived artifacts for frontend polling.
    """
    meeting = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회의를 찾을 수 없습니다.")
    if meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="본인이 생성한 회의만 조회할 수 있습니다.")

    # latest summary (if exists)
    latest_summary = None
    if meeting.summaries:
        latest = sorted(meeting.summaries, key=lambda s: s.CREATED_DT or datetime.min, reverse=True)[0]
        latest_summary = {
            "summary_id": latest.SUMMARY_ID,
            "content": latest.CONTENT,
            "translated_content": latest.TRANSLATED_CONTENT,
            "format": latest.FORMAT,
            "created_dt": latest.CREATED_DT,
        }

    # action items
    action_items = [
        {
            "item_id": item.ITEM_ID,
            "title": item.TITLE,
            "description": item.DESCRIPTION,
            "status": item.STATUS,
            "priority": item.PRIORITY,
            "assignee_id": item.ASSIGNEE_ID,
            "assignee_name": item.ASSIGNEE_NAME,
            "jira_assignee_id": item.JIRA_ASSIGNEE_ID,
            "due_dt": item.DUE_DT,
            "created_dt": item.CREATED_DT,
            "updated_dt": item.UPDATED_DT,
        }
        for item in meeting.action_items
    ]

    return {
        "meeting_id": meeting.MEETING_ID,
        "audio_url": meeting.AUDIO_URL,
        "final_transcript_status": meeting.FINAL_TRANSCRIPT_STATUS,
        "final_transcript_error": meeting.FINAL_TRANSCRIPT_ERROR,
        "final_transcript_url": meeting.FINAL_TRANSCRIPT_URL,
        "final_transcript_text": meeting.FINAL_TRANSCRIPT_TEXT,
        "summary": latest_summary,
        "action_items": action_items,
    }

# ==================== 4. 회의 수정 ====================
@router.put("/{meeting_id}", response_model=meeting_schema.MeetingOut)
def update_meeting(
    meeting_id: str,
    meeting_update: meeting_schema.MeetingUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    회의 정보를 수정합니다.
    
    - **meeting_id**: 회의 ID (ULID)
    - **title**: 새로운 제목 (선택)
    - **purpose**: 새로운 목적 (선택)
    - **status**: 새로운 상태 (선택)
    
    본인이 생성한 회의만 수정할 수 있습니다.
    """
    # 회의 조회
    db_meeting = meeting_crud.get_meeting(db=db, meeting_id=meeting_id)
    
    # 회의가 존재하지 않는 경우
    if not db_meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"회의를 찾을 수 없습니다. (meeting_id: {meeting_id})"
        )
    
    # 본인이 생성한 회의인지 확인
    if db_meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인이 생성한 회의만 수정할 수 있습니다."
        )
    
    # 회의 정보 업데이트
    updated_meeting = meeting_crud.update_meeting(
        db=db,
        meeting=db_meeting,
        meeting_in=meeting_update
    )
    # 최신 관계 로드 (summary, action_items)
    from sqlalchemy.orm import joinedload
    refreshed = db.query(models.Meeting).options(
        joinedload(models.Meeting.summaries),
        joinedload(models.Meeting.action_items)
    ).filter(models.Meeting.MEETING_ID == updated_meeting.MEETING_ID).first()

    # dict로 변환하여 스키마에 맞게 반환
    meeting_dict = {
        "meeting_id": refreshed.MEETING_ID,
        "creator_id": refreshed.CREATOR_ID,
        "title": refreshed.TITLE,
        "purpose": refreshed.PURPOSE,
        "start_dt": refreshed.START_DT,
        "end_dt": refreshed.END_DT,
        "location": refreshed.LOCATION,
        "content": refreshed.CONTENT,
        "translated_content": refreshed.TRANSLATED_CONTENT,
        "ai_summary": refreshed.AI_SUMMARY,
        "participants": refreshed.PARTICIPANTS,
        "key_decisions": refreshed.KEY_DECISIONS,
        "next_steps": refreshed.NEXT_STEPS,
        "audio_url": refreshed.AUDIO_URL,
        "summary": {
            "summary_id": refreshed.summaries[0].SUMMARY_ID,
            "content": refreshed.summaries[0].CONTENT,
            "translated_content": refreshed.summaries[0].TRANSLATED_CONTENT,
            "format": refreshed.summaries[0].FORMAT,
            "created_dt": refreshed.summaries[0].CREATED_DT
        } if refreshed.summaries else None,
        "action_items": [
            {
                "item_id": item.ITEM_ID,
                "title": item.TITLE,
                "description": item.DESCRIPTION,
                "status": item.STATUS,
                "priority": item.PRIORITY,
                "assignee_id": item.ASSIGNEE_ID,
                "assignee_name": item.ASSIGNEE_NAME,
                "jira_assignee_id": item.JIRA_ASSIGNEE_ID,
                "due_dt": item.DUE_DT,
                "created_dt": item.CREATED_DT,
                "updated_dt": item.UPDATED_DT
            }
            for item in refreshed.action_items
        ] if refreshed.action_items else []
    }

    return meeting_dict

# ==================== 5. 회의 삭제 ====================
@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    회의를 삭제합니다.
    
    - **meeting_id**: 회의 ID (ULID)
    
    본인이 생성한 회의만 삭제할 수 있습니다.
    관련된 STT_CHUNK, SUMMARY, ACTION_ITEM도 함께 삭제됩니다 (CASCADE).
    """
    # 회의 조회
    db_meeting = meeting_crud.get_meeting(db=db, meeting_id=meeting_id)
    
    # 회의가 존재하지 않는 경우
    if not db_meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"회의를 찾을 수 없습니다. (meeting_id: {meeting_id})"
        )
    
    # 본인이 생성한 회의인지 확인
    if db_meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인이 생성한 회의만 삭제할 수 있습니다."
        )
    
    # 회의 삭제
    meeting_crud.delete_meeting(db=db, meeting=db_meeting)
    
    # 204 No Content는 본문을 반환하지 않음
    return None

# ==================== 6. 회의 종료 (LLM 자동 처리) ====================
@router.post("/{meeting_id}/end", status_code=status.HTTP_200_OK)
async def end_meeting_and_process(
    meeting_id: str,
    end_request: meeting_schema.MeetingEndRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    회의 종료를 처리하고 LLM으로 요약 및 액션 아이템을 자동 생성합니다.
    
    - **meeting_id**: 회의 ID (ULID)
    - **status**: 종료 후 회의 상태 (기본값: COMPLETED)
    - **ended_at**: 종료 시각 (선택)
    - **content**: 회의 전사 내용 (필수)
    
    회의 종료 시 자동으로 처리됩니다:
    1. 회의 전사 내용 저장
    2. LLM으로 요약 생성
    3. LLM으로 액션 아이템 추출
    """
    # 회의 조회
    db_meeting = meeting_crud.get_meeting(db=db, meeting_id=meeting_id)
    
    # 회의가 존재하지 않는 경우
    if not db_meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"회의를 찾을 수 없습니다. (meeting_id: {meeting_id})"
        )
    
    # 본인이 생성한 회의인지 확인
    if db_meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인이 생성한 회의만 종료할 수 있습니다."
        )
    
    # 회의 종료 처리
    ended_meeting = meeting_crud.end_meeting(
        db=db,
        meeting=db_meeting,
        end_request=end_request
    )
    
    # LLM으로 요약 및 액션 아이템 생성
    summary_content = None
    action_items = []
    
    if ended_meeting.CONTENT:
        try:
            from backend.core.llm.service import LLMService
            import ulid
            
            llm_service = LLMService()
            
            # LLM으로 요약 및 액션 아이템 생성
            result = await llm_service.get_summary_and_actions([ended_meeting.CONTENT])
            
            # 요약 저장
            if result.get("rolling_summary"):
                summary = models.Summary(
                    SUMMARY_ID=str(ulid.new()),
                    MEETING_ID=meeting_id,
                    FORMAT="markdown",
                    CONTENT=result["rolling_summary"]
                )
                db.add(summary)
                summary_content = result["rolling_summary"]
            
            # 액션 아이템 저장
            for item_data in result.get("action_items", []):
                item_id = str(ulid.new())
                
                # 마감일 파싱
                deadline_str = item_data.get("deadline")
                due_dt = None
                if deadline_str and deadline_str != "미정":
                    try:
                        # YYYY-MM-DD 형식 파싱
                        due_dt = datetime.strptime(deadline_str, "%Y-%m-%d")
                    except ValueError:
                        pass

                action_item = models.ActionItem(
                    ITEM_ID=item_id,
                    MEETING_ID=meeting_id,
                    TITLE=item_data.get("task", ""),
                    DESCRIPTION=item_data.get("task", ""),
                    STATUS="PENDING",
                    PRIORITY="MEDIUM",
                    ASSIGNEE_ID=None,
                    ASSIGNEE_NAME=item_data.get("assignee"),
                    DUE_DT=due_dt
                )
                db.add(action_item)
                action_items.append({
                    "item_id": item_id,
                    "title": item_data.get("task"),
                    "task": item_data.get("task"),
                    "assignee": item_data.get("assignee"),
                    "deadline": item_data.get("deadline"),
                    "status": "PENDING",
                    "priority": "MEDIUM"
                })
            
            db.commit()

        except Exception as e:
            db.rollback()
            print(f"LLM 처리 오류: {e}")
            # LLM 처리 실패해도 회의 종료는 성공으로 간주

    # ==================== 재전사 작업 큐 등록 (고품질 전사) ====================
    # 회의 종료 시 ElevenLabs 재전사 파이프라인을 즉시 큐에 등록
    try:
        ended_meeting.FINAL_TRANSCRIPT_STATUS = "queued"
        ended_meeting.FINAL_TRANSCRIPT_ERROR = None
        db.commit()

        import os
        import redis
        from rq import Queue
        from backend.worker import retranscribe_meeting
        import logging
        logger = logging.getLogger(__name__)

        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            logger.info(f"=== [END MEETING] Enqueuing STT job for meeting {meeting_id} ===")
            logger.info(f"Redis URL: {redis_url[:30]}...")
            
            try:
                conn = redis.from_url(redis_url)
                conn.ping()
                logger.info("✅ Redis connection successful")
                
                q = Queue("stt", connection=conn)
                logger.info(f"Queue 'stt' created, current jobs: {q.count}")

                # 오디오 파일명 결정
                audio_path = ended_meeting.LOCATION or ended_meeting.AUDIO_URL
                audio_filename = os.path.basename(audio_path) if audio_path else f"{meeting_id}.wav"
                logger.info(f"Audio filename: {audio_filename}")

                job = q.enqueue(retranscribe_meeting, meeting_id, audio_filename)
                logger.info(f"✅ STT job enqueued successfully: job_id={job.id}, status={job.get_status()}")
            except Exception as redis_error:
                logger.error(f"❌ Redis enqueue failed: {str(redis_error)}", exc_info=True)
                raise
        else:
            logger.warning("⚠️ REDIS_URL not set, running synchronously")
            # 환경에 Redis가 없으면 동기 실행 (개발/테스트용)
            retranscribe_meeting(meeting_id, None)
    except Exception as e:
        # 재전사 큐 등록 실패해도 회의 종료는 계속 진행
        logger.error(f"❌ Failed to enqueue retranscription: {str(e)}", exc_info=True)
        pass

    return {
        "message": f"회의가 종료되었습니다. (meeting_id: {meeting_id})",
        "meeting_id": meeting_id,
        "status": "COMPLETED",
        "content": ended_meeting.CONTENT,
        "audio_url": ended_meeting.AUDIO_URL,
        "summary": summary_content,
        "action_items": action_items
    }

from pathlib import Path
# ==================== 9. 최종화 진행 상태 조회 ====================
@router.get("/{meeting_id}/finalization-progress")
def get_finalization_progress(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Returns progress flags indicating whether final transcript is done
    and whether summary, action items, and embeddings have been generated.
    """
    meeting = meeting_crud.get_meeting(db=db, meeting_id=meeting_id)
    if not meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회의를 찾을 수 없습니다.")
    if meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="본인이 생성한 회의만 조회할 수 있습니다.")

    stt_done = (meeting.FINAL_TRANSCRIPT_STATUS == "done" and bool(meeting.FINAL_TRANSCRIPT_TEXT))

    # Summary exists
    has_summary = db.query(models.Summary).filter(models.Summary.MEETING_ID == meeting_id).count() > 0
    # Embeddings exist (for reference only, not part of loading completion)
    has_embeddings = db.query(models.Embedding).filter(models.Embedding.MEETING_ID == meeting_id).count() > 0

    # UI loading finishes when STT + summary are done (action items and embeddings async/optional)
    all_done = bool(stt_done and has_summary)

    import sys
    print(f"[finalization-progress] meeting_id={meeting_id}, stt_done={stt_done}, has_summary={has_summary}, all_done={all_done}", file=sys.stderr)

    return {
        "meeting_id": meeting_id,
        "stt_done": stt_done,
        "summary_done": has_summary,
        "embeddings_done": has_embeddings,
        "all_done": all_done,
        "final_transcript_status": meeting.FINAL_TRANSCRIPT_STATUS,
        "final_transcript_error": meeting.FINAL_TRANSCRIPT_ERROR,
    }

# ... existing code ...

# ==================== 7. 회의 오디오 파일 다운로드 ====================
@router.get("/{meeting_id}/audio")
async def get_meeting_audio(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)  # httpOnly Cookie 인증
):
    """
    회의의 오디오 파일을 다운로드합니다.
    
    - **meeting_id**: 회의 ID (ULID)
    
    본인이 생성한 회의의 오디오 파일만 다운로드할 수 있습니다.
    httpOnly Cookie를 통한 인증이 필요합니다.
    """
    user_id = current_user.USER_ID
    
    # 회의 조회
    db_meeting = meeting_crud.get_meeting(db=db, meeting_id=meeting_id)
    
    # 회의가 존재하지 않는 경우
    if not db_meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"회의를 찾을 수 없습니다. (meeting_id: {meeting_id})"
        )
    
    # 본인이 생성한 회의인지 확인
    if db_meeting.CREATOR_ID != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인이 생성한 회의의 오디오만 다운로드할 수 있습니다."
        )
    
    # 로컬 파일 경로 확인 (audio_storage 폴더)
    # Docker 환경에서는 /app/audio_storage, 로컬에서는 ./audio_storage 사용
    # 여러 경로를 확인하여 파일 찾기
    possible_dirs = []
    if os.path.exists('/app/audio_storage'):
        possible_dirs.append('/app/audio_storage')
    
    # 프로젝트 루트 경로 계산 (backend/api/v1/meetings/endpoints.py -> root)
    try:
        root_dir = Path(__file__).resolve().parents[4]
        root_audio_dir = root_dir / "audio_storage"
        possible_dirs.append(str(root_audio_dir))
    except:
        pass

    possible_dirs.append(os.path.abspath('./audio_storage'))
    possible_dirs.append(os.path.abspath('../audio_storage'))
    possible_dirs.append(os.path.abspath('./backend/audio_storage'))

    file_path = None
    found = False
    
    # 1. DB에 저장된 경로로 확인
    audio_path = db_meeting.LOCATION or db_meeting.AUDIO_URL
    if audio_path:
        # 경로에서 파일명만 추출
        filename = os.path.basename(audio_path)
        
        for base_dir in possible_dirs:
            candidate = os.path.join(base_dir, filename)
            if os.path.exists(candidate):
                file_path = candidate
                found = True
                break
    
    # 2. DB 경로로 못 찾은 경우, meeting_id.wav로 확인
    if not found:
        filename = f'{meeting_id}.wav'
        for base_dir in possible_dirs:
            candidate = os.path.join(base_dir, filename)
            if os.path.exists(candidate):
                file_path = candidate
                found = True
                break
    
    # 파일 존재 확인
    if not found or not file_path:
        # 디버깅을 위해 검색한 경로들을 로그로 남기거나 에러 메시지에 포함
        searched_paths = [os.path.join(d, f'{meeting_id}.wav') for d in possible_dirs]
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"오디오 파일을 찾을 수 없습니다. 검색 경로: {searched_paths}"
        )
    
    # 파일 반환
    return FileResponse(
        path=file_path,
        media_type="audio/wav",
        filename=f"{db_meeting.TITLE or meeting_id}.wav"
    )


# ==================== 7. 오디오 파일 업로드 ====================
@router.post("/{meeting_id}/audio", status_code=status.HTTP_200_OK)
async def upload_meeting_audio(
    meeting_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    회의 오디오 파일을 업로드합니다.
    
    - **meeting_id**: 회의 ID (필수)
    - **file**: 업로드할 오디오 파일 (필수)
    
    파일은 audio_storage 폴더에 저장되며, DB의 AUDIO_URL과 LOCATION이 자동으로 업데이트됩니다.
    """
    # 1. 회의 존재 여부 확인
    db_meeting = meeting_crud.get_meeting(db, meeting_id=meeting_id)
    if not db_meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="존재하지 않는 회의입니다."
        )
    
    # 2. 권한 확인 (본인이 생성한 회의만 업로드 가능)
    if db_meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="본인이 생성한 회의의 오디오만 업로드할 수 있습니다."
        )
    
    # 3. 파일 저장
    base_audio_dir = None
    if os.path.exists('/app/audio_storage'):
        base_audio_dir = '/app/audio_storage'
    else:
        # 프로젝트 루트 경로 계산 (backend/api/v1/meetings/endpoints.py -> root)
        try:
            root_dir = Path(__file__).resolve().parents[4]
            base_audio_dir = str(root_dir / "audio_storage")
        except:
            base_audio_dir = './audio_storage'

    os.makedirs(base_audio_dir, exist_ok=True)
    
    file_path = os.path.join(base_audio_dir, f'{meeting_id}.wav')
    print(f"Saving audio to: {file_path}")  # Debug log
    
    try:
        with open(file_path, 'wb') as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        print(f"Failed to save audio file: {e}") # Debug log
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"파일 저장 실패: {str(e)}"
        )
    
    # 4. DB 업데이트
    # 저장된 위치를 기준으로 상대 경로 저장 (또는 절대 경로)
    # 여기서는 일관성을 위해 ./audio_storage/... 형식으로 저장하거나
    # 실제 저장된 위치를 반영하는 것이 좋음.
    # 하지만 기존 로직 유지를 위해 ./audio_storage/로 저장하되,
    # get_meeting_audio에서 잘 찾도록 함.
    audio_url = f'./audio_storage/{meeting_id}.wav'
    db_meeting.AUDIO_URL = audio_url
    db_meeting.LOCATION = audio_url
    db.commit()
    
    return {
        "message": "오디오 파일이 업로드되었습니다.",
        "audio_url": audio_url,
        "file_size": len(content)
    }

# ==================== 8. 회의 재전사 작업 큐 등록 (ElevenLabs) ====================
@router.post("/{meeting_id}/finalize", status_code=status.HTTP_202_ACCEPTED)
def finalize_meeting_and_enqueue_stt(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Post-meeting re-transcription: enqueue RQ job to run ElevenLabs STT on the .wav in audio_storage.
    Returns a queued status and basic job info.
    """
    db_meeting = meeting_crud.get_meeting(db=db, meeting_id=meeting_id)
    if not db_meeting:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회의를 찾을 수 없습니다.")
    if db_meeting.CREATOR_ID != current_user.USER_ID:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="본인이 생성한 회의만 처리할 수 있습니다.")

    # Set status to queued
    db_meeting.FINAL_TRANSCRIPT_STATUS = "queued"
    db_meeting.FINAL_TRANSCRIPT_ERROR = None
    db.commit()

    # Enqueue RQ job
    import logging
    logger = logging.getLogger(__name__)
    
    redis_url = os.getenv("REDIS_URL")
    if not redis_url:
        logger.error("❌ REDIS_URL environment variable not set")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="REDIS_URL 환경 변수가 필요합니다.")
    
    logger.info(f"=== [FINALIZE] Enqueuing finalization job for meeting {meeting_id} ===")
    logger.info(f"Redis URL: {redis_url[:30]}...")
    
    try:
        conn = redis.from_url(redis_url)
        conn.ping()
        logger.info("✅ Redis connection successful")
        
        q = Queue("stt", connection=conn)
        logger.info(f"Queue 'stt' created, current jobs: {q.count}")

        # Determine audio filename
        audio_path = db_meeting.LOCATION or db_meeting.AUDIO_URL
        audio_filename = os.path.basename(audio_path) if audio_path else f"{meeting_id}.wav"
        logger.info(f"Audio filename: {audio_filename}")

        # Import worker task lazily to avoid circular imports
        from backend.worker import retranscribe_meeting
        job = q.enqueue(retranscribe_meeting, meeting_id, audio_filename)
        logger.info(f"✅ Finalization job enqueued successfully: job_id={job.id}, status={job.get_status()}")

        return {"status": "queued", "meeting_id": meeting_id, "job_id": job.id}
    except Exception as e:
        logger.error(f"❌ Failed to enqueue finalization job: {str(e)}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to enqueue: {str(e)}")

# [추가(테스트용)]
class DummyContentRequest(BaseModel):
    content: str

@router.post("/{meeting_id}/dummy-content")
def set_dummy_content(
    meeting_id: str,
    body: DummyContentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
    background_tasks: BackgroundTasks = None,
):
    meeting = (
        db.query(models.Meeting)
        .filter(models.Meeting.MEETING_ID == meeting_id)
        .first()
    )
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    meeting.CONTENT = body.content
    db.commit()
    # Schedule indexing as a background task so the request isn't blocked
    if background_tasks is not None:
        background_tasks.add_task(index_meeting_transcript_background, meeting_id)
    else:
        # fallback: run synchronously if BackgroundTasks not provided
        index_meeting_transcript(db, meeting_id)

    return {"status": "ok"}

@router.post("/{meeting_id}/index")
def index_meeting(
    meeting_id: str,
    token: str = None,
    request: Request = None,
    db: Session = Depends(get_db),
    background_tasks: BackgroundTasks = None,
):
    """
    Trigger indexing for a specific meeting. This schedules a background
    task that creates a fresh DB session to perform embedding generation
    and storage.
    """
    # Authenticate: allow token via query param (`?token=...`) or Authorization header
    try:
        from backend.core.auth.security import verify_token
        from backend.crud import user as user_crud

        auth_token = token
        # If no token query param, try Authorization header
        if not auth_token and request is not None:
            auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
            if auth_header and auth_header.lower().startswith("bearer "):
                auth_token = auth_header.split(" ", 1)[1]

        if not auth_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 토큰이 필요합니다.")

        payload = verify_token(auth_token)
        if not payload:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰입니다.")

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰에서 사용자 ID를 찾을 수 없습니다.")

        current_user = user_crud.get_user_by_id(db, user_id)
        if not current_user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다.")

        # Permission: only creator can trigger indexing
        meeting_obj = db.query(models.Meeting).filter(models.Meeting.MEETING_ID == meeting_id).first()
        if not meeting_obj:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="회의를 찾을 수 없습니다.")
        if meeting_obj.CREATOR_ID != current_user.USER_ID:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="본인이 생성한 회의만 색인할 수 있습니다.")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=f"토큰 검증 오류: {str(e)}")

    # Schedule or run indexing
    if background_tasks is not None:
        background_tasks.add_task(index_meeting_transcript_background, meeting_id)
        return {"status": "scheduled"}
    else:
        index_meeting_transcript(db, meeting_id)
        return {"status": "indexed"}