from sqlalchemy.orm import Session
from backend import models
from backend.schemas import meeting as meeting_schema
from typing import List, Optional
import re


def _apply_speaker_mapping_to_text(text: Optional[str], mapping: Optional[dict]) -> Optional[str]:
    """Replace speaker labels in transcript-like text using provided mapping.

    Expected format: lines beginning with "[timestamp] Speaker N". Only the label
    immediately following the timestamp is replaced to avoid unintended changes
    in the utterance body.
    """
    if not text or not mapping:
        return text

    updated = text
    for label, new_name in mapping.items():
        if not label or not new_name:
            continue
        pattern = rf"(?m)(\[[^\]]+\]\s*){re.escape(label)}"
        updated = re.sub(pattern, rf"\1{new_name}", updated)
    return updated

# [수정] 회의 목록 조희
# CREATOR_ID == user_id인 회의들 목록 조회용 함수
def get_meetings_by_user(
    db: Session,
    user_id: str,
    skip: int = 0,
    limit: int = 100,
) -> List[models.Meeting]:
    """
    특정 사용자가 생성한 회의 목록을 조회합니다.

    - user_id: 회의를 만든 USER.USER_ID (ULID 문자열)
    - skip, limit: 페이징 용도
    """
    return (
        db.query(models.Meeting)
        .filter(models.Meeting.CREATOR_ID == user_id)
        .order_by(models.Meeting.START_DT.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )

# [추가] 회의 상세 정보 조회
# PK인 MEETING_ID로 회의 1건을 조회해서 반환/ 없으면 None
def get_meeting(
    db: Session,
    meeting_id: str,
) -> Optional[models.Meeting]:
    """
    회의 ID(meeting_id)를 기준으로 단일 회의 정보를 조회합니다.
    """
    return (
        db.query(models.Meeting)
        .filter(models.Meeting.MEETING_ID == meeting_id)
        .first()
    )

# [수정] 회의 생성
# 새로운 Meeting 객체를 만들어서 DB에 저장하고, 그 객체를 반환
def create_meeting(
    db: Session,
    meeting_in: meeting_schema.MeetingCreate,
    user_id: str,
) -> models.Meeting:
    """
    새로운 회의를 DB에 생성합니다.

    - meeting_in: 회의 생성 요청 바디 (MeetingCreate)
    - user_id: 회의 생성자 USER_ID (ULID 문자열)

    is_realtime 필드는 WebSocket/Pass1 로직에서 사용할 수 있지만,
    Meeting 테이블 자체에는 컬럼이 없으므로 여기서는 TITLE/PURPOSE/CREATOR_ID만 저장합니다.
    """
    db_meeting = models.Meeting(
        # MEETING_ID는 models에서 ULID default 설정이 되어 있으므로 명시할 필요 없음
        TITLE=meeting_in.title,
        PURPOSE=getattr(meeting_in, "purpose", None),
        CREATOR_ID=user_id,
        # START_DT는 server_default=func.now() 이므로 따로 넣지 않아도 DB에서 자동 설정
    )

    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting

# [추가] 회의 정보 수정
# 들어온 스키마에서 None이 아닌 필드만 골라서 기존 Meeting 객체에 반영
def update_meeting(
    db: Session,
    meeting: models.Meeting,
    meeting_in: meeting_schema.MeetingUpdate,
) -> models.Meeting:
    """
    기존 회의의 기본 정보(제목, 목적 등)를 수정합니다.

    - meeting: 사전에 get_meeting으로 가져온 Meeting 객체
    - meeting_in: 수정할 필드가 담긴 MeetingUpdate 스키마
    """
    # 제목/목적은 선택적으로 들어오기 때문에 None 체크 후 업데이트
    if meeting_in.title is not None:
        meeting.TITLE = meeting_in.title
    if getattr(meeting_in, "purpose", None) is not None:
        meeting.PURPOSE = meeting_in.purpose

    # Speaker mapping 업데이트 (UI에서 전달)
    if getattr(meeting_in, "speaker_mapping", None) is not None:
        meeting.SPEAKER_MAPPING = meeting_in.speaker_mapping
        meeting.CONTENT = _apply_speaker_mapping_to_text(meeting.CONTENT, meeting.SPEAKER_MAPPING)
        meeting.FINAL_TRANSCRIPT_TEXT = _apply_speaker_mapping_to_text(
            meeting.FINAL_TRANSCRIPT_TEXT,
            meeting.SPEAKER_MAPPING,
        )
        meeting.TRANSLATED_CONTENT = _apply_speaker_mapping_to_text(
            getattr(meeting, "TRANSLATED_CONTENT", None),
            meeting.SPEAKER_MAPPING,
        )

    # Meeting 모델에 STATUS 컬럼을 나중에 추가한다면 여기서 meeting.STATUS도 갱신 가능
    # if meeting_in.status is not None:
    #     meeting.STATUS = meeting_in.status

    db.commit()
    db.refresh(meeting)
    return meeting

# [추가] 회의 종료
# 회의의 END_DT를 세팅해서 끝났다는걸 기록
def end_meeting(
    db: Session,
    meeting: models.Meeting,
    end_request: meeting_schema.MeetingEndRequest,
) -> models.Meeting:
    """
    회의를 종료 처리합니다.

    - end_request.status: (향후 STATUS 컬럼이 생기면) 회의 상태로 반영 가능
    - end_request.ended_at: END_DT로 저장할 종료 시각
    """
    # 종료 시각이 명시되었다면 그 시간으로, 아니면 현재 시각은 DB 레벨에서 처리하거나
    # 여기서 datetime.utcnow() 등을 사용할 수 있습니다.
    if end_request.ended_at is not None:
        meeting.END_DT = end_request.ended_at
    else:
        # DB에서 server_default를 쓸 수도 있고, 여기서 now()를 직접 넣을 수도 있음
        from sqlalchemy.sql import func
        meeting.END_DT = func.now()

    # 상태 업데이트
    # meeting.STATUS = end_request.status

    # 회의 원문/오디오 경로 저장
    if getattr(end_request, "content", None) is not None:
        meeting.CONTENT = end_request.content
    if getattr(end_request, "audio_url", None) is not None:
        audio_url = end_request.audio_url
        meeting.AUDIO_URL = audio_url
        # 로컬 파일 경로면 LOCATION에도 저장 (blob: URL이 아닌 경우)
        if not audio_url.startswith('blob:'):
            meeting.LOCATION = audio_url
    
    # 참여자 정보 저장 (기본값으로 설정될 참여자 정보)
    if getattr(end_request, "participants", None) is not None:
        meeting.PARTICIPANTS = end_request.participants

    db.commit()
    db.refresh(meeting)
    return meeting

# [추가] 회의 삭제
# 전달받은 Meeting 객체를 DB에서 삭제
def delete_meeting(
    db: Session,
    meeting: models.Meeting,
) -> None:
    """
    회의를 삭제합니다.

    cascade 설정 덕분에, 관련된 STT_CHUNK, SUMMARY, ACTION_ITEM 등이
    함께 삭제되도록 모델 관계를 구성할 수 있습니다.
    """
    db.delete(meeting)
    db.commit()