from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
import ulid
from datetime import datetime

from backend.dependencies import get_db, get_current_user
from backend import models
from backend.schemas.report import SummaryOut, ActionItemOut, ReportOut
from backend.core.llm.service import LLMService
from backend.core.integrations import JiraService, NotionService
from backend.core.auth.encryption import decrypt_data

router = APIRouter(prefix="/reports", tags=["Reports"])


# ============================================
# 0. 실시간 요약 미리보기 (DB 저장 없음)
# ============================================
class PreviewSummaryRequest(BaseModel):
    """실시간 요약 요청 (DB 저장 없이 content만 분석)"""
    content: str

@router.post("/preview-summary")
async def preview_summary(
    payload: PreviewSummaryRequest,
    current_user: models.User = Depends(get_current_user)
):
    """
    실시간 요약 생성 (DB 저장 없음)
    
    - 녹음 중 임시 content를 받아서 LLM으로 요약만 생성
    - DB에 저장하지 않고 응답만 반환
    - 액션 아이템 생성하지 않음 (요약만)
    """
    if not payload.content or not payload.content.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Content is required"
        )
    
    try:
        llm_service = LLMService()
        # 간단한 요약 생성 (액션 아이템 제외)
        summary_text = await llm_service.get_simple_summary(payload.content)
        
        return {
            "summary": summary_text,
            "cached": False
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate preview summary: {str(e)}"
        )


# ============================================
# 1. 회의 요약 조회
# ============================================
@router.get("/{meeting_id}/summary", response_model=SummaryOut)
async def get_meeting_summary(
    meeting_id: str,
    db: Session = Depends(get_db)
):
    """
    회의 요약 조회
    
    프론트엔드에서 사용:
    - 회의 상세 페이지
    - 요약 화면
    """
    
    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # 요약 조회
    summary = db.query(models.Summary).filter(
        models.Summary.MEETING_ID == meeting_id
    ).first()
    
    if not summary:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Summary for meeting {meeting_id} not found. Try regenerating the summary."
        )
    
    # Pydantic 모델로 변환 (DB 필드명 → snake_case)
    return SummaryOut(
        summary_id=summary.SUMMARY_ID,
        meeting_id=summary.MEETING_ID,
        format=summary.FORMAT,
        content=summary.CONTENT,
        created_dt=summary.CREATED_DT
    )


# ============================================
# 2. 액션 아이템 목록 조회
# ============================================
@router.get("/{meeting_id}/action-items", response_model=List[ActionItemOut])
async def get_meeting_action_items(
    meeting_id: str,
    db: Session = Depends(get_db)
):
    """
    액션 아이템 목록 조회
    
    프론트엔드에서 사용:
    - 할 일 목록 화면
    - 담당자별 태스크 보드
    """
    
    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # 액션 아이템 조회
    action_items = db.query(models.ActionItem).filter(
        models.ActionItem.MEETING_ID == meeting_id
    ).all()
    
    # Pydantic 모델로 변환
    return [
        ActionItemOut(
            item_id=item.ITEM_ID,
            meeting_id=item.MEETING_ID,
            title=item.TITLE,
            description=item.DESCRIPTION,
            due_dt=item.DUE_DT,
            priority=item.PRIORITY,
            status=item.STATUS,
            assignee_id=item.ASSIGNEE_ID,
            external_tool=item.EXTERNAL_TOOL,
            created_dt=item.CREATED_DT,
            updated_dt=item.UPDATED_DT
        )
        for item in action_items
    ]


# ============================================
# 2-1. 액션 아이템 생성
# ============================================

class ActionItemCreate(BaseModel):
    """액션 아이템 생성 요청"""
    title: str
    description: str = ""
    due_dt: Optional[str] = None
    priority: str = "MEDIUM"
    assignee_name: Optional[str] = None  # 표시용 담당자 이름
    jira_assignee_id: Optional[str] = None  # Jira 동기화용

@router.post("/{meeting_id}/action-items", response_model=ActionItemOut, status_code=status.HTTP_201_CREATED)
async def create_action_item(
    meeting_id: str,
    item: ActionItemCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    액션 아이템 생성
    """
    from datetime import datetime
    
    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # 액션 아이템 생성
    new_item = models.ActionItem(
        ITEM_ID=str(ulid.new()),
        MEETING_ID=meeting_id,
        TITLE=item.title,
        DESCRIPTION=item.description,
        DUE_DT=datetime.fromisoformat(item.due_dt) if item.due_dt else None,
        PRIORITY=item.priority,
        STATUS="TODO",
        ASSIGNEE_ID=current_user.USER_ID,  # 항상 현재 사용자로 설정 (내부 관리용)
        ASSIGNEE_NAME=item.assignee_name,  # 표시용 담당자 이름
        JIRA_ASSIGNEE_ID=item.jira_assignee_id  # Jira 담당자 ID (있는 경우)
    )
    
    db.add(new_item)
    db.commit()
    db.refresh(new_item)
    
    return ActionItemOut(
        item_id=new_item.ITEM_ID,
        meeting_id=new_item.MEETING_ID,
        title=new_item.TITLE,
        description=new_item.DESCRIPTION,
        due_dt=new_item.DUE_DT,
        priority=new_item.PRIORITY,
        status=new_item.STATUS,
        assignee_id=new_item.ASSIGNEE_ID,
        assignee_name=new_item.ASSIGNEE_NAME,
        jira_assignee_id=new_item.JIRA_ASSIGNEE_ID,
        external_tool=new_item.EXTERNAL_TOOL,
        created_dt=new_item.CREATED_DT,
        updated_dt=new_item.UPDATED_DT
    )


# ============================================
# 2-2. 액션 아이템 수정
# ============================================

class ActionItemUpdate(BaseModel):
    """액션 아이템 수정 요청"""
    title: Optional[str] = None
    description: Optional[str] = None
    due_dt: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assignee_name: Optional[str] = None  # 표시용 담당자 이름
    jira_assignee_id: Optional[str] = None  # Jira 동기화용
    assignee_id: Optional[str] = None  # 내부용 (일반적으로 수정 안 함)

@router.patch("/{meeting_id}/action-items/{item_id}", response_model=ActionItemOut)
async def update_action_item(
    meeting_id: str,
    item_id: str,
    updates: ActionItemUpdate,
    db: Session = Depends(get_db)
):
    """
    액션 아이템 수정
    """
    from datetime import datetime
    
    # 액션 아이템 조회
    item = db.query(models.ActionItem).filter(
        models.ActionItem.ITEM_ID == item_id,
        models.ActionItem.MEETING_ID == meeting_id
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Action item {item_id} not found"
        )
    
    # 업데이트
    if updates.title is not None:
        item.TITLE = updates.title
    if updates.description is not None:
        item.DESCRIPTION = updates.description
    if updates.due_dt is not None:
        # 날짜 파싱: 빈 문자열, '미정', 잘못된 형식 처리
        if updates.due_dt and updates.due_dt.strip() and updates.due_dt not in ['미정', 'undefined', 'null']:
            try:
                item.DUE_DT = datetime.fromisoformat(updates.due_dt)
            except ValueError as e:
                print(f"[WARNING] Invalid date format: {updates.due_dt}, error: {e}")
                item.DUE_DT = None
        else:
            item.DUE_DT = None
    if updates.priority is not None:
        item.PRIORITY = updates.priority
    if updates.status is not None:
        item.STATUS = updates.status
    if updates.assignee_name is not None:
        item.ASSIGNEE_NAME = updates.assignee_name
    if updates.jira_assignee_id is not None:
        item.JIRA_ASSIGNEE_ID = updates.jira_assignee_id
    if updates.assignee_id is not None:
        item.ASSIGNEE_ID = updates.assignee_id
    
    db.commit()
    db.refresh(item)
    
    return ActionItemOut(
        item_id=item.ITEM_ID,
        meeting_id=item.MEETING_ID,
        title=item.TITLE,
        description=item.DESCRIPTION,
        due_dt=item.DUE_DT,
        priority=item.PRIORITY,
        status=item.STATUS,
        assignee_id=item.ASSIGNEE_ID,
        assignee_name=item.ASSIGNEE_NAME,
        jira_assignee_id=item.JIRA_ASSIGNEE_ID,
        external_tool=item.EXTERNAL_TOOL,
        created_dt=item.CREATED_DT,
        updated_dt=item.UPDATED_DT
    )


# ============================================
# 2-3. 액션 아이템 삭제
# ============================================

@router.delete("/{meeting_id}/action-items/{item_id}", status_code=status.HTTP_200_OK)
async def delete_action_item(
    meeting_id: str,
    item_id: str,
    db: Session = Depends(get_db)
):
    """
    액션 아이템 삭제
    """
    # 액션 아이템 조회
    item = db.query(models.ActionItem).filter(
        models.ActionItem.ITEM_ID == item_id,
        models.ActionItem.MEETING_ID == meeting_id
    ).first()
    
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Action item {item_id} not found"
        )
    
    db.delete(item)
    db.commit()
    
    return {"message": "Action item deleted successfully", "item_id": item_id}


# ============================================
# 3. 전체 보고서 조회 (요약 + 액션 아이템)
# ============================================
@router.get("/{meeting_id}/full", response_model=ReportOut)
async def get_full_report(
    meeting_id: str,
    db: Session = Depends(get_db)
):
    """
    전체 보고서 조회 (요약 + 액션 아이템)
    
    프론트엔드에서 사용:
    - 최종 회의록 다운로드
    - 전체 보고서 페이지
    """
    
    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # 요약 조회
    summary = db.query(models.Summary).filter(
        models.Summary.MEETING_ID == meeting_id
    ).first()
    
    # 액션 아이템 조회
    action_items = db.query(models.ActionItem).filter(
        models.ActionItem.MEETING_ID == meeting_id
    ).all()
    
    # Pydantic 모델로 변환
    summary_out = None
    if summary:
        summary_out = SummaryOut(
            summary_id=summary.SUMMARY_ID,
            meeting_id=summary.MEETING_ID,
            format=summary.FORMAT,
            content=summary.CONTENT,
            created_dt=summary.CREATED_DT
        )
    
    action_items_out = [
        ActionItemOut(
            item_id=item.ITEM_ID,
            meeting_id=item.MEETING_ID,
            title=item.TITLE,
            description=item.DESCRIPTION,
            due_dt=item.DUE_DT,
            priority=item.PRIORITY,
            status=item.STATUS,
            assignee_id=item.ASSIGNEE_ID,
            external_tool=item.EXTERNAL_TOOL,
            created_dt=item.CREATED_DT,
            updated_dt=item.UPDATED_DT
        )
        for item in action_items
    ]
    
    # 보고서 조합
    return ReportOut(
        meeting_id=meeting_id,
        summary=summary_out,
        action_items=action_items_out,
        full_transcript=meeting.CONTENT  # 전체 전사 텍스트
    )


# ============================================
# 4. 요약 재생성 (LLM 서비스 사용) ⭐
# ============================================
@router.post("/{meeting_id}/regenerate")
async def regenerate_summary(
    meeting_id: str,
    db: Session = Depends(get_db)
):
    """
    회의 요약 재생성 (LLM 활용)
    
    프론트엔드에서 사용:
    - "요약 다시 생성" 버튼
    - 수동 재생성 기능
    
    동작:
    1. Meeting.CONTENT에서 전사 텍스트 가져오기
    2. LLM 서비스로 요약 & 액션 아이템 생성
    3. DB 업데이트
    """
    
    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # 전사 텍스트 확인
    if not meeting.CONTENT:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No transcript found for meeting {meeting_id}. Complete the meeting first."
        )
    
    try:
        # LLM 서비스 초기화
        llm_service = LLMService()
        
        # 전사 텍스트를 리스트로 변환 (청크 단위)
        # CONTENT가 하나의 큰 텍스트라고 가정
        transcript_texts = [meeting.CONTENT]
        
        # LLM으로 요약 및 액션 아이템 생성
        result = await llm_service.get_summary_and_actions(transcript_texts)
        
        # === 요약 업데이트/생성 ===
        summary = db.query(models.Summary).filter(
            models.Summary.MEETING_ID == meeting_id
        ).first()
        
        if summary:
            # 기존 요약 업데이트
            summary.CONTENT = result["rolling_summary"]
            summary.FORMAT = "markdown"
        else:
            # 새 요약 생성
            summary = models.Summary(
                SUMMARY_ID=str(ulid.new()),
                MEETING_ID=meeting_id,
                FORMAT="markdown",
                CONTENT=result["rolling_summary"]
            )
            db.add(summary)
        
        # === 액션 아이템 재생성 ===
        # 기존 액션 아이템 삭제
        db.query(models.ActionItem).filter(
            models.ActionItem.MEETING_ID == meeting_id
        ).delete()
        
        # 새 액션 아이템 생성
        for item_data in result["action_items"]:
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
                ITEM_ID=str(ulid.new()),
                MEETING_ID=meeting_id,
                TITLE=item_data.get("task", ""),
                DESCRIPTION=item_data.get("task", ""),  # task를 description으로도 사용
                STATUS="PENDING",
                PRIORITY="MEDIUM",
                ASSIGNEE_ID=None,
                ASSIGNEE_NAME=item_data.get("assignee"),
                DUE_DT=due_dt
            )
            db.add(action_item)
        
        # 커밋
        db.commit()
        db.refresh(summary)
        
        return {
            "message": "Summary and action items regenerated successfully",
            "meeting_id": meeting_id,
            "summary": result["rolling_summary"],
            "action_items_count": len(result["action_items"])
        }
        
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to regenerate summary: {str(e)}"
        )


# ============================================
# 실시간 액션 아이템 추출 (회의 종료와 별개) ⭐
# ============================================
@router.post("/{meeting_id}/actions/realtime")
async def generate_realtime_actions(
    meeting_id: str,
    db: Session = Depends(get_db)
):
    """
    실시간 액션 아이템 추출 (회의 종료와 별개)
    
    프론트엔드에서 사용:
    - 회의 진행 중 "액션 아이템 추출" 버튼
    - 전사 스트림 기반으로 즉시 액션아이템 생성
    
    동작:
    1. Meeting.CONTENT 대신 현재까지 누적된 전사 텍스트 사용
    2. LLM 서비스로 액션아이템만 추출
    3. DB 저장은 선택 (여기서는 저장하지 않고 결과만 반환)
    """

    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()

    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )

    # CONTENT가 없어도 진행 가능 (실시간 스트림 기반)
    transcript_texts = []
    if meeting.CONTENT:
        transcript_texts.append(meeting.CONTENT)

    try:
        # LLM 서비스 초기화
        llm_service = LLMService()

        # 액션아이템만 추출
        result = await llm_service.get_action_items_only(transcript_texts)

        return {
            "message": "Realtime action items generated successfully",
            "meeting_id": meeting_id,
            "action_items": result["action_items"]
        }

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate realtime action items: {str(e)}"
        )

# ============================================
# 5. RAG 검색 (TODO: 권현재님 RAG 완성 후)
# ============================================
@router.get("/{meeting_id}/search")
async def search_meeting_content(
    meeting_id: str,
    query: str,
    db: Session = Depends(get_db)
):
    """
    RAG 기반 회의 내용 검색
    
    TODO: 권현재님의 RAG 시스템 완성 후 구현
    """
    
    return {
        "message": "RAG search not implemented yet",
        "meeting_id": meeting_id,
        "query": query,
        "results": []
    }


# ============================================
# 6. 번역 (요약 또는 전사 내용)
# ============================================
@router.post("/{meeting_id}/translate")
async def translate_meeting_content(
    meeting_id: str,
    content_type: str,  # "summary" or "transcript"
    source_lang: str = "Korean",  # 원문 언어
    target_lang: str = "English",  # 목표 언어
    db: Session = Depends(get_db)
):
    """
    회의 요약 또는 전사 내용을 번역합니다.
    
    - **content_type**: 번역할 내용 타입 ("summary" 또는 "transcript")
    - **source_lang**: 원문 언어 (기본값: "Korean")
    - **target_lang**: 목표 언어 (기본값: "English")
    
    매번 새로 번역하며, DB에는 가장 최근 번역만 캐싱됩니다.
    """
    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    try:
        llm_service = LLMService()
        
        if content_type == "summary":
            # 요약 번역
            summary = db.query(models.Summary).filter(
                models.Summary.MEETING_ID == meeting_id
            ).first()
            
            if not summary:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Summary for meeting {meeting_id} not found"
                )
            
            # 캐시 확인: TRANSLATED_CONTENT에 언어 정보가 포함되어 있는지 확인
            # 형식: "[target_lang]|translated_text"
            cached = False
            if summary.TRANSLATED_CONTENT and summary.TRANSLATED_CONTENT.startswith(f"[{target_lang}]|"):
                # 캐시된 번역 사용
                cached_text = summary.TRANSLATED_CONTENT.split("|", 1)[1]
                return {
                    "meeting_id": meeting_id,
                    "content_type": "summary",
                    "translated_text": cached_text,
                    "source_lang": source_lang,
                    "target_lang": target_lang,
                    "cached": True
                }
            
            # 캐시에 없으면 새로 번역
            translated_text = await llm_service.get_translation(
                summary.CONTENT,
                source_lang=source_lang,
                target_lang=target_lang
            )
            
            # DB에 저장 (언어 정보 포함)
            summary.TRANSLATED_CONTENT = f"[{target_lang}]|{translated_text}"
            db.commit()
            
            return {
                "meeting_id": meeting_id,
                "content_type": "summary",
                "translated_text": translated_text,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "cached": False
            }
        
        elif content_type == "transcript":
            # 전사 내용 번역
            if not meeting.CONTENT:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"No transcript found for meeting {meeting_id}"
                )
            
            # 캐시 확인: TRANSLATED_CONTENT에 언어 정보가 포함되어 있는지 확인
            # 형식: "[target_lang]|translated_text"
            if meeting.TRANSLATED_CONTENT and meeting.TRANSLATED_CONTENT.startswith(f"[{target_lang}]|"):
                # 캐시된 번역 사용
                cached_text = meeting.TRANSLATED_CONTENT.split("|", 1)[1]
                return {
                    "meeting_id": meeting_id,
                    "content_type": "transcript",
                    "translated_text": cached_text,
                    "source_lang": source_lang,
                    "target_lang": target_lang,
                    "cached": True
                }
            
            # 캐시에 없으면 새로 번역
            translated_text = await llm_service.get_translation(
                meeting.CONTENT,
                source_lang=source_lang,
                target_lang=target_lang
            )
            
            # DB에 저장 (언어 정보 포함)
            meeting.TRANSLATED_CONTENT = f"[{target_lang}]|{translated_text}"
            db.commit()
            
            return {
                "meeting_id": meeting_id,
                "content_type": "transcript",
                "translated_text": translated_text,
                "source_lang": source_lang,
                "target_lang": target_lang,
                "cached": False
            }
        
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="content_type must be 'summary' or 'transcript'"
            )
    
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Translation failed: {str(e)}"
        )


# ============================================
# 7. Jira 연동 (개선됨)
# ============================================

class JiraSyncRequest(BaseModel):
    """Request body for Jira sync."""
    project_key: str
    item_ids: Optional[List[str]] = None

@router.post("/{meeting_id}/action-items/to-jira")
async def push_action_items_to_jira(
    meeting_id: str,
    request: JiraSyncRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    액션 아이템을 선택한 Jira 프로젝트로 동기화.
    
    - 이미 동기화된 항목(external_tool 존재)은 업데이트
    - 새 항목은 생성
    - priority, due_date 필드 매핑
    - 부분 실패 처리 (일부 성공 시에도 결과 반환)
    - item_ids가 제공되면 해당 ID의 항목만 동기화
    """
    project_key = request.project_key
    from backend.core.auth.encryption import decrypt_data
    
    user_id = current_user.USER_ID
    
    # 회의 존재 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # Jira 설정 확인
    jira_setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "jira"
    ).first()
    
    if not jira_setting:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jira not configured. Please set up Jira integration in settings."
        )
    
    # Jira 서비스 초기화
    config = jira_setting.CONFIG
    decrypted_token = decrypt_data(config["api_token"])
    
    jira_service = JiraService(
        base_url=config["base_url"],
        email=config["email"],
        api_token=decrypted_token,
        project_key=project_key
    )
    
    # 액션 아이템 조회
    query = db.query(models.ActionItem).filter(
        models.ActionItem.MEETING_ID == meeting_id
    )
    
    if request.item_ids:
        query = query.filter(models.ActionItem.ITEM_ID.in_(request.item_ids))
        
    action_items = query.all()
    
    if not action_items:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No action items found for this meeting (or none matched the provided IDs)"
        )
    
    # 동기화 결과 추적
    created = []
    updated = []
    failed = []
    
    # Jira base_url에서 issue URL 생성을 위한 준비
    jira_base_url = config["base_url"].rstrip('/')
    
    for item in action_items:
        try:
            # external_tool에 Jira 이슈 키가 있으면 업데이트 시도
            if item.EXTERNAL_TOOL:
                # 기존 이슈 키에서 프로젝트 추출 (예: KAN-123 -> KAN)
                existing_project = item.EXTERNAL_TOOL.split('-')[0] if '-' in item.EXTERNAL_TOOL else None
                
                # 같은 프로젝트면 업데이트, 다른 프로젝트면 새로 생성
                if existing_project == project_key:
                    try:
                        result = jira_service.update_issue(
                            issue_key=item.EXTERNAL_TOOL,
                            title=item.TITLE,
                            description=item.DESCRIPTION,
                            priority=item.PRIORITY,
                            due_date=item.DUE_DT,
                            assignee_id=item.JIRA_ASSIGNEE_ID
                        )
                        updated.append({
                            "item_id": item.ITEM_ID,
                            "issue_key": item.EXTERNAL_TOOL,
                            "issue_url": f"{jira_base_url}/browse/{item.EXTERNAL_TOOL}",
                            "action": "updated"
                        })
                        continue  # 업데이트 성공 시 다음 항목으로
                    except Exception as e:
                        # 이슈가 삭제되었거나 접근 불가 시 새로 생성으로 fallback
                        if "does not exist" in str(e).lower() or "404" in str(e):
                            pass  # 아래 생성 로직으로 진행
                        else:
                            raise
            
            # 새 이슈 생성 (EXTERNAL_TOOL이 없거나, 다른 프로젝트이거나, 업데이트 실패한 경우)
            resp = jira_service.create_issue(
                title=item.TITLE,
                description=item.DESCRIPTION or "",
                project_key=project_key,
                priority=item.PRIORITY,
                due_date=item.DUE_DT,
                assignee_id=item.JIRA_ASSIGNEE_ID
            )
            
            issue_key = resp.get("key")
            
            # external_tool에 이슈 키 저장
            item.EXTERNAL_TOOL = issue_key
            db.commit()
            
            created.append({
                "item_id": item.ITEM_ID,
                "issue_key": issue_key,
                "issue_url": f"{jira_base_url}/browse/{issue_key}",
                "action": "created"
            })
                
        except Exception as e:
            # 개별 항목 실패 시 계속 진행
            failed.append({
                "item_id": item.ITEM_ID,
                "title": item.TITLE,
                "error": str(e)
            })
    
    # 회의에 마지막 사용 프로젝트 저장
    meeting.JIRA_PROJECT_KEY = project_key
    db.commit()
    
    return {
        "message": "Jira synchronization completed",
        "project_key": project_key,
        "jira_base_url": jira_base_url,
        "created": created,
        "updated": updated,
        "failed": failed,
        "summary": {
            "total": len(action_items),
            "created_count": len(created),
            "updated_count": len(updated),
            "failed_count": len(failed)
        }
    }


# ============================================
# 7. Notion 연동 (기존 유지)
# ============================================
@router.post("/{meeting_id}/report/to-notion")
async def push_report_to_notion(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """전체 보고서를 Notion으로 전송"""
    
    # 사용자 Notion 설정 조회
    user_id = current_user.USER_ID
    notion_setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "notion"
    ).first()
    
    if not notion_setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notion not configured. Please set up Notion integration in settings."
        )
    
    # Notion 설정 복호화
    config = notion_setting.CONFIG
    decrypted_token = decrypt_data(config["api_token"])
    
    notion = NotionService(
        api_token=decrypted_token,
        parent_page_id=config.get("parent_page_id"),
        database_id=config.get("database_id")
    )
    
    summary = db.query(models.Summary).filter(
        models.Summary.MEETING_ID == meeting_id
    ).first()
    
    if not summary:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Summary not found"
        )
    
    blocks = [{
        "object": "block",
        "type": "paragraph",
        "paragraph": {
            "text": [{
                "type": "text",
                "text": {"content": summary.CONTENT}
            }]
        }
    }]
    
    resp = notion.create_page(
        title=f"Meeting {meeting_id} Report",
        content_blocks=blocks
    )
    
    return resp


# ============================================
# 8. Notion 포괄적 회의록 (멘토 피드백 반영) ⭐
# ============================================

class NotionExportRequest(BaseModel):
    parent_page_id: Optional[str] = None

@router.post("/{meeting_id}/notion/comprehensive")
async def push_comprehensive_report_to_notion(
    meeting_id: str,
    request: NotionExportRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    **참석 못한 사람도 완벽히 이해할 수 있는 포괄적인 회의록을 Notion에 생성**
    
    ⭐ 필수 포함 섹션:
    - 👥 참석자 (주최자, 참석자, 불참자)
    - 📝 요약
    - ⚡ 액션 아이템 (담당자, 마감일)
    
    날짜 형식: 2024년 11월 25일 (월) 14:00 - 15:30
    
    Request Body:
    - parent_page_id: 페이지를 생성할 부모 페이지 ID (optional)
    """
    from backend.core.integrations.notion_service import Participant
    
    # 1. 회의 정보 조회
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # 2. 요약 조회 (⭐ 필수)
    summary = db.query(models.Summary).filter(
        models.Summary.MEETING_ID == meeting_id
    ).first()
    
    summary_text = summary.CONTENT if summary else "요약 없음"
    
    # 3. 액션 아이템 조회 (⭐ 필수)
    action_items_db = db.query(models.ActionItem).filter(
        models.ActionItem.MEETING_ID == meeting_id
    ).all()
    
    action_items = [
        {
            'title': item.TITLE,
            'assignee': getattr(item, 'ASSIGNEE_NAME', None) or item.ASSIGNEE_ID,
            'due_date': item.DUE_DT,
            'status': item.STATUS or 'PENDING',
            'description': item.DESCRIPTION,
            'priority': item.PRIORITY or 'MEDIUM'
        }
        for item in action_items_db
    ]
    
    # 4. 참석자 정보 (⭐ 필수)
    participants = [
        Participant(
            user_id=meeting.CREATOR_ID or "unknown",
            name=current_user.NAME or current_user.EMAIL or "주최자",
            role="host"
        )
    ]
    
    # 5. 사용자 Notion 설정 조회
    user_id = current_user.USER_ID
    notion_setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "notion"
    ).first()
    
    if not notion_setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notion not configured. Please set up Notion integration in settings."
        )
    
    # Notion 설정 복호화
    config = notion_setting.CONFIG
    decrypted_token = decrypt_data(config["api_token"])
    
    # 요청에서 받은 parent_page_id 사용
    notion = NotionService(
        api_token=decrypted_token,
        parent_page_id=request.parent_page_id,
        database_id=None
    )
    
    # 6. Notion 페이지 생성
    try:
        result = notion.create_comprehensive_meeting_page(
            meeting_title=meeting.TITLE or f"회의 {meeting_id}",
            meeting_date=meeting.START_DT,
            meeting_end_date=meeting.END_DT,
            location="온라인",
            meeting_type="정기",
            participants=participants,
            absent_members=[],
            purpose="",
            summary=summary_text,
            discussions=[],
            decisions=[],
            action_items=action_items,
            pending_issues=[],
            attachments=[],
            next_meeting_agenda=None,
            audio_url=f"https://roundnote.com/meetings/{meeting_id}/audio",
            transcript_url=f"https://roundnote.com/meetings/{meeting_id}/transcript"
        )
        
        return {
            "success": True,
            "notion_page_id": result["id"],
            "notion_url": result["url"],
            "message": "포괄적 회의록이 Notion에 생성되었습니다.",
            "included": {
                "participants": len(participants),
                "summary": bool(summary_text),
                "action_items": len(action_items)
            }
        }
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Notion 설정 오류: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Notion 페이지 생성 실패: {str(e)}"
        )


# ============================================
# 9. Notion 액션 아이템만 Tasks DB에 추가
# ============================================

class NotionActionItemsRequest(BaseModel):
    database_id: Optional[str] = None

@router.post("/{meeting_id}/notion/action-items")
async def push_action_items_to_notion_db(
    meeting_id: str,
    request: NotionActionItemsRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    액션 아이템만 Notion Tasks 데이터베이스에 추가
    
    사용자의 Notion 설정 필요
    
    Request Body:
    - database_id: 액션 아이템을 추가할 데이터베이스 ID (optional)
    """
    
    # 사용자 Notion 설정 조회
    user_id = current_user.USER_ID
    notion_setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "notion"
    ).first()
    
    if not notion_setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notion not configured. Please set up Notion integration in settings."
        )
    
    # Notion 설정 복호화
    config = notion_setting.CONFIG
    decrypted_token = decrypt_data(config["api_token"])
    
    # 요청에서 받은 database_id 사용
    notion = NotionService(
        api_token=decrypted_token,
        parent_page_id=None,
        database_id=request.database_id
    )
    
    # 회의 확인
    meeting = db.query(models.Meeting).filter(
        models.Meeting.MEETING_ID == meeting_id
    ).first()
    
    if not meeting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Meeting {meeting_id} not found"
        )
    
    # 액션 아이템 조회
    action_items = db.query(models.ActionItem).filter(
        models.ActionItem.MEETING_ID == meeting_id
    ).all()
    
    if not action_items:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="액션 아이템이 없습니다"
        )
    
    try:
        created_items = []
        
        for item in action_items:
            result = notion.create_action_item_in_database(
                title=item.TITLE,
                assignee=getattr(item, 'ASSIGNEE_NAME', None) or item.ASSIGNEE_ID,
                due_date=item.DUE_DT,
                priority=item.PRIORITY or "MEDIUM",
                status=item.STATUS or "PENDING",
                description=item.DESCRIPTION,
                meeting_title=meeting.TITLE
            )
            created_items.append(result)
        
        return {
            "success": True,
            "created_count": len(created_items),
            "items": created_items,
            "message": f"{len(created_items)}개의 액션 아이템이 Notion에 추가되었습니다."
        }
        
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Notion 설정 오류: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Notion 추가 실패: {str(e)}"
        )


# ============================================
# 10. 테스트용 더미 데이터 생성
# ============================================
@router.post("/dummy/create-sample-data")
async def create_sample_data(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    테스트용 더미 회의 데이터 생성
    
    개발/테스트 환경에서만 사용!
    """
    from datetime import datetime
    
    # 더미 회의 생성
    meeting_id = str(ulid.new())
    meeting = models.Meeting(
        MEETING_ID=meeting_id,
        TITLE="샘플 회의 - Q4 프로젝트 진행 상황",
        CONTENT="""
        회의 참석자: 김철수, 이영희, 박민수
        회의 시간: 2024-11-20 14:00
        
        김철수: 백엔드 API 개발이 현재 70% 완료되었습니다.
        이영희: 프론트엔드는 90% 완료되었고, UI/UX 리뷰가 필요합니다.
        박민수: 데이터베이스 마이그레이션은 금요일까지 완료 예정입니다.
        
        결정사항:
        - API 문서 작성 (담당: 김철수, 마감: 11/25)
        - UI 디자인 리뷰 (담당: 이영희, 마감: 11/22)
        - DB 백업 스크립트 작성 (담당: 박민수, 마감: 11/23)
        """,
        START_DT=datetime.now(),
        END_DT=datetime.now(),
        CREATOR_ID=current_user.USER_ID
    )
    db.add(meeting)
    
    # 더미 요약 생성
    summary = models.Summary(
        SUMMARY_ID=str(ulid.new()),
        MEETING_ID=meeting_id,
        FORMAT="markdown",
        CONTENT="""## 회의 개요
- Q4 프로젝트 진행 상황 점검
- 참석자: 김철수, 이영희, 박민수

## 핵심 내용
- 백엔드 API 개발 70% 완료
- 프론트엔드 90% 완료
- 데이터베이스 마이그레이션 진행 중

## 다음 단계
- API 문서 작성 (김철수, 11/25)
- UI 디자인 리뷰 (이영희, 11/22)
- DB 백업 스크립트 (박민수, 11/23)"""
    )
    db.add(summary)
    
    # 더미 액션 아이템 생성
    action_items_data = [
        {
            "TITLE": "API 문서 작성 완료",
            "DESCRIPTION": "모든 엔드포인트에 대한 Swagger 문서 작성",
            "PRIORITY": "HIGH",
            "STATUS": "PENDING"
        },
        {
            "TITLE": "UI 디자인 리뷰 진행",
            "DESCRIPTION": "최종 UI/UX 검토 및 피드백 반영",
            "PRIORITY": "MEDIUM",
            "STATUS": "PENDING"
        },
        {
            "TITLE": "DB 백업 스크립트 작성",
            "DESCRIPTION": "자동 백업 스크립트 작성 및 크론잡 설정",
            "PRIORITY": "HIGH",
            "STATUS": "PENDING"
        }
    ]
    
    for item_data in action_items_data:
        action_item = models.ActionItem(
            ITEM_ID=str(ulid.new()),
            MEETING_ID=meeting_id,
            TITLE=item_data["TITLE"],
            DESCRIPTION=item_data["DESCRIPTION"],
            PRIORITY=item_data["PRIORITY"],
            STATUS=item_data["STATUS"]
        )
        db.add(action_item)
    
    db.commit()
    
    return {
        "message": "Sample data created successfully",
        "meeting_id": meeting_id,
        "summary_created": True,
        "action_items_count": len(action_items_data),
        "test_urls": {
            "summary": f"/api/v1/reports/{meeting_id}/summary",
            "action_items": f"/api/v1/reports/{meeting_id}/action-items",
            "full_report": f"/api/v1/reports/{meeting_id}/full",
            "regenerate": f"/api/v1/reports/{meeting_id}/regenerate"
        }
    }