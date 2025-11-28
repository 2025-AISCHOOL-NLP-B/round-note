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
    
    return updated_meeting

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
    
    return {
        "message": f"회의가 종료되었습니다. (meeting_id: {meeting_id})",
        "meeting_id": meeting_id,
        "status": "COMPLETED",
        "content": ended_meeting.CONTENT,
        "audio_url": ended_meeting.AUDIO_URL,
        "summary": summary_content,
        "action_items": action_items
    }

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
    
    # LOCATION 또는 AUDIO_URL에서 파일 경로 확인
    audio_path = db_meeting.LOCATION or db_meeting.AUDIO_URL
    
    if not audio_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="오디오 파일이 존재하지 않습니다."
        )
    
    # 로컬 파일 경로 확인 (audio_storage 폴더)
    # Docker 환경에서는 /app/audio_storage, 로컬에서는 ./audio_storage 사용
    base_audio_dir = '/app/audio_storage' if os.path.exists('/app/audio_storage') else './audio_storage'
    
    if audio_path.startswith('./audio_storage/'):
        # 상대 경로를 절대 경로로 변환
        filename = audio_path.replace('./audio_storage/', '')
        file_path = os.path.join(base_audio_dir, filename)
    elif audio_path.startswith('audio_storage/'):
        filename = audio_path.replace('audio_storage/', '')
        file_path = os.path.join(base_audio_dir, filename)
    else:
        # MEETING_ID.wav 형식으로 시도
        file_path = os.path.join(base_audio_dir, f'{meeting_id}.wav')
    
    # 파일 존재 확인
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"오디오 파일을 찾을 수 없습니다: {file_path}"
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
    base_audio_dir = '/app/audio_storage' if os.path.exists('/app/audio_storage') else './audio_storage'
    os.makedirs(base_audio_dir, exist_ok=True)
    
    file_path = os.path.join(base_audio_dir, f'{meeting_id}.wav')
    
    try:
        with open(file_path, 'wb') as buffer:
            content = await file.read()
            buffer.write(content)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"파일 저장 실패: {str(e)}"
        )
    
    # 4. DB 업데이트
    audio_url = f'./audio_storage/{meeting_id}.wav'
    db_meeting.AUDIO_URL = audio_url
    db_meeting.LOCATION = audio_url
    db.commit()
    
    return {
        "message": "오디오 파일이 업로드되었습니다.",
        "audio_url": audio_url,
        "file_size": len(content)
    }

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