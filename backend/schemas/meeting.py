from pydantic import BaseModel, Field
from datetime import datetime
from typing import List, Optional

# 공통으로 쓰는 필드를 한 곳에 모아둔 베이스 클래스
# 회의와 관련된 여러 스키마에서 공통으로 반복되는 필드를 한 곳에 모아둔 베이스 클래스
class MeetingBase(BaseModel):
    title: Optional[str] = Field(None, max_length=100, description="회의 제목")
    purpose: Optional[str] = Field(None, max_length=255, description="회의 목적/안건")

# 회의 생성 요청에 사용할 스키마(POST/meetings)
# 클라이언트가 새 회의를 만들 때 보내는 JSON 바디의 구조
class MeetingCreate(MeetingBase):
    is_realtime: bool = Field(
        True,
        description="실시간 회의 여부 (Pass 1 WebSocket 사용할지 여부)"
    )
    # TODO: 참여자(participants) 목록 필드 추가 고려

# 회의 수정 요청에 사용할 스키마 (PUT /meetings/{id})
# 이미 생성된 회의의 일부 정보를 수정할 때 사용하는 요청 바디 구조
class MeetingUpdate(MeetingBase):
    status: Optional[str] = Field(
        None,
        description="회의 상태 (예: ONGOING, COMPLETED 등). 필요 시 업데이트"
    )

# 회의 응답(조회)에 사용할 스키마
# 백엔드에서 Meeting ORM 객체를 조회한 뒤, 클라이언트에게 돌려줄 때의 응답 JSON 구조를 정의
class MeetingOut(MeetingBase):
    MEETING_ID: str = Field(..., description="ULID 기반 회의 ID (TEXT)", alias="meeting_id")
    CREATOR_ID: str = Field(..., description="회의 생성한 사용자 ID", alias="creator_id")
    STATUS: Optional[str] = Field(
        None,
        description="회의 상태 (예: ONGOING, COMPLETED 등)",
        alias="status"
    )
    START_DT: datetime = Field(..., description="회의 시작 시각", alias="start_dt")
    END_DT: Optional[datetime] = Field(
        None,
        description="회의 종료 시각 (아직 안 끝났으면 None)",
        alias="end_dt"
    )
    LOCATION: Optional[str] = Field(
        None,
        description="회의 오디오 파일이 저장된 NCP Object Storage 경로",
        alias="location"
    )
    TITLE: Optional[str] = Field(None, description="회의 제목", alias="title")
    PURPOSE: Optional[str] = Field(None, description="회의 목적", alias="purpose")
    CONTENT: Optional[str] = Field(
        None,
        description="회의 전사 원문 전체",
        alias="content"
    )
    TRANSLATED_CONTENT: Optional[str] = Field(
        None,
        description="번역된 전사 내용",
        alias="translated_content"
    )
    AI_SUMMARY: Optional[str] = Field(
        None,
        description="AI가 생성한 회의 요약",
        alias="ai_summary"
    )
    PARTICIPANTS: Optional[list] = Field(
        None,
        description="참석자 목록 (JSON 배열)",
        alias="participants"
    )
    KEY_DECISIONS: Optional[list] = Field(
        None,
        description="주요 결정사항 (JSON 배열)",
        alias="key_decisions"
    )
    NEXT_STEPS: Optional[list] = Field(
        None,
        description="다음 단계 (JSON 배열)",
        alias="next_steps"
    )
    AUDIO_URL: Optional[str] = Field(
        None,
        description="오디오 파일 URL",
        alias="audio_url"
    )
    
    # 관계 필드 추가
    summary: Optional[dict] = Field(
        None,
        description="회의 요약 정보"
    )
    action_items: List[dict] = Field(
        default_factory=list,
        description="액션 아이템 목록"
    )

    class Config:
        from_attributes = True  # ORM 객체로부터 바로 변환 가능하도록 설정
        populate_by_name = True  # alias와 원본 필드명 모두 허용

# 회의 종료 처리 요청 바디
# 회의가 끝날 때, 프론트가 회의 끝났다고 서버에 알리는 전용 요청 바디
class MeetingEndRequest(BaseModel):
    """회의 종료 요청 바디 스키마"""

    status: str = Field(
        "COMPLETED",
        description="종료 후 회의 상태 (기본값: COMPLETED)"
    )
    ended_at: Optional[datetime] = Field(
        None,
        description="클라이언트 기준 회의 종료 시각 (보내지 않으면 서버에서 현재 시각 사용)"
    )
    content: Optional[str] = Field(
        None,
        description="회의 원문 전체 (전사 텍스트)"
    )
    audio_url: Optional[str] = Field(
        None,
        description="오디오 파일 경로 (NCP Object Storage 등)"
    )