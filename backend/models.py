import ulid
from functools import partial
from sqlalchemy import (
    Column, ForeignKey, TEXT, Float,
    CheckConstraint, TIMESTAMP
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import declarative_base, relationship
from pgvector.sqlalchemy import Vector

# --- Base 및 ULID 기본값 설정 ---

Base = declarative_base()

def default_ulid():
    return str(ulid.new())

p_ulid = partial(default_ulid)

# 1. 사용자(USER는 SQL 예약어이므로 따옴표로 감쌉니다) # 유저가 만든/할당된 객체들의 중심
class User(Base):
    __tablename__ = "RN_USER"
    
    # [수정] PK: NUMBER -> TEXT(ULID)
    USER_ID = Column(TEXT, primary_key=True, default=p_ulid)
    PW = Column(TEXT, nullable=False)
    NAME = Column(TEXT, nullable=False)
    EMAIL = Column(TEXT, unique=True)
    PHONE = Column(TEXT, nullable=True)
    JOIN_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    EXT_API_KEY = Column(TEXT, nullable=True)
    STATUS = Column(TEXT, nullable=False, default='A')

    __table_args__ = (
        CheckConstraint(STATUS.in_(['A', 'D']), name='ck_user_status'),
    )

    # 관계
    meetings = relationship(
        "Meeting",
        back_populates="creator",
        cascade="all, delete-orphan"
    )
    action_items = relationship(
        "ActionItem",
        back_populates="assignee",
        cascade="all, delete-orphan"
    )
    knowledge_sources = relationship(
        "KnowledgeSource",
        back_populates="owner",
        cascade="all, delete-orphan"
    )


# 2. 사용자설정 # 유저별 환경 설정을 따로 저장하는 테이블
class UserSetting(Base):
    __tablename__ = "USER_SETTING"

    SETTING_ID = Column(TEXT, primary_key=True, default=p_ulid)
    USER_ID = Column(TEXT, ForeignKey('RN_USER.USER_ID'), nullable=False)
    MEETING_TEMPLATE_ID = Column(TEXT, nullable=True)
    BOOST_USE_YN = Column(TEXT, nullable=False, default='N')

    __table_args__ = (
        CheckConstraint(BOOST_USE_YN.in_(['Y', 'N']), name='ck_user_setting_boost_yn'),
    )


# 2-1. 사용자 통합 설정 (Jira, Notion 등 외부 플랫폼 연동 정보)
class UserIntegrationSetting(Base):
    __tablename__ = "USER_INTEGRATION_SETTING"

    INTEGRATION_ID = Column(TEXT, primary_key=True, default=p_ulid)
    USER_ID = Column(TEXT, ForeignKey('RN_USER.USER_ID'), nullable=False)
    PLATFORM = Column(TEXT, nullable=False)  # 'jira', 'notion', 'google_calendar' 등
    CONFIG = Column(JSONB, nullable=False)  # 암호화된 설정 정보 (base_url, email, api_token 등)
    IS_ACTIVE = Column(TEXT, nullable=False, default='Y')
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    UPDATED_DT = Column(TIMESTAMP(timezone=True), nullable=True, onupdate=func.now())

    __table_args__ = (
        CheckConstraint(IS_ACTIVE.in_(['Y', 'N']), name='ck_integration_is_active'),
        CheckConstraint(PLATFORM.in_(['jira', 'notion', 'google_calendar']), name='ck_integration_platform'),
    )


# 3. 회의 # 관계 : 회의를 중심으로 모든 분석/로그가 매달림
# 모든 자식 관계에 cascade="all, delete-orphan'이 달려있어, 회의 삭제 -> 연결된 요약/할 일/로그/분석/임베딩 다같이 삭제되는 구조
class Meeting(Base):
    __tablename__ = "MEETING"

    MEETING_ID = Column(TEXT, primary_key=True, default=p_ulid)
    TITLE = Column(TEXT, nullable=True)
    PURPOSE = Column(TEXT, nullable=True)
    START_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    END_DT = Column(TIMESTAMP(timezone=True), nullable=True)
    CREATOR_ID = Column(TEXT, ForeignKey('RN_USER.USER_ID'), nullable=False)
    # NCP Object Key 저장용
    LOCATION = Column(TEXT, nullable=True)
    # 회의 전사 내용 전체
    CONTENT = Column(TEXT, nullable=True)
    # 번역된 전사 내용
    TRANSLATED_CONTENT = Column(TEXT, nullable=True)
    # AI 요약 결과
    AI_SUMMARY = Column(TEXT, nullable=True)
    # 참석자 정보 (JSON 배열)
    PARTICIPANTS = Column(JSONB, nullable=True)
    # 주요 결정사항 (JSON 배열)
    KEY_DECISIONS = Column(JSONB, nullable=True)
    # 다음 단계 (JSON 배열)
    NEXT_STEPS = Column(JSONB, nullable=True)
    # 오디오 URL
    AUDIO_URL = Column(TEXT, nullable=True)
    # Jira 프로젝트 키 (회의별 마지막 선택 프로젝트 기억용)
    JIRA_PROJECT_KEY = Column(TEXT, nullable=True)
    # Post-meeting re-transcription (ElevenLabs) artifacts
    FINAL_TRANSCRIPT_TEXT = Column(TEXT, nullable=True)
    FINAL_TRANSCRIPT_URL = Column(TEXT, nullable=True)
    FINAL_TRANSCRIPT_STATUS = Column(TEXT, nullable=True)  # queued|processing|done|error
    FINAL_TRANSCRIPT_ERROR = Column(TEXT, nullable=True)
    # Translation status tracking
    TRANSLATION_STATUS = Column(TEXT, nullable=True)  # queued|processing|done|error
    TRANSLATION_ERROR = Column(TEXT, nullable=True)
    TRANSLATION_TARGET_LANG = Column(TEXT, nullable=True)  # en, ja, zh, etc.

    # 관계
    creator = relationship(
        "User",
        back_populates="meetings",
    )
    stt_chunks = relationship(
        "SttChunk",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )
    summaries = relationship(
        "Summary",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )
    action_items = relationship(
        "ActionItem",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )
    chatbot_logs = relationship(
        "ChatbotLog",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )
    artifact_logs = relationship(
        "ArtifactLog",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )
    final_analyses = relationship(
        "FinalAnalysis",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )
    embeddings = relationship(
        "Embedding",
        back_populates="meeting",
        cascade="all, delete-orphan"
    )


# 4. 전사 청크 (STT_CHUNK) # 회의 음성 인식 결과를 시간 구간별로 쪼갠 텍스트 블록 저장
class SttChunk(Base):
    __tablename__ = "STT_CHUNK"

    CHUNK_ID = Column(TEXT, primary_key=True, default=p_ulid)
    MEETING_ID = Column(TEXT, ForeignKey("MEETING.MEETING_ID"), nullable=False)
    UTTER_ID = Column(TEXT, nullable=True)
    START_SEC = Column(Float, nullable=False)
    END_SEC = Column(Float, nullable=False)
    SPEAKER_LABEL = Column(TEXT, nullable=True)
    text = Column("TEXT", TEXT, nullable=False)
    # RAG용 pgvector 컬럼 (OpenAI 임베딩 차원 1536 기준)
    text_vector = Column(Vector(1536), nullable=True)
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    meeting = relationship(
        "Meeting",
        back_populates="stt_chunks",
    )
    # 필요하면 나중에 SttChunk <-> Embedding 관계도 추가 가능
    # embeddings = relationship(
    #     "Embedding",
    #     back_populates="chunk",
    #     cascade="all, delete-orphan"
    # )


# 5. 요약 # 회의별로 생성되는 요약 텍스트 저장
class Summary(Base):
    __tablename__ = "SUMMARY"

    SUMMARY_ID = Column(TEXT, primary_key=True, default=p_ulid)
    MEETING_ID = Column(TEXT, ForeignKey("MEETING.MEETING_ID"), nullable=False)
    FORMAT = Column(TEXT, nullable=False)
    CONTENT = Column(TEXT, nullable=False)
    # 번역된 요약 내용
    TRANSLATED_CONTENT = Column(TEXT, nullable=True)
    # Translation status tracking for summaries
    TRANSLATION_STATUS = Column(TEXT, nullable=True)  # queued|processing|done|error
    TRANSLATION_ERROR = Column(TEXT, nullable=True)
    TRANSLATION_TARGET_LANG = Column(TEXT, nullable=True)  # en, ja, zh, etc.
    PROMPT_ID = Column(TEXT, nullable=True)
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    meeting = relationship(
        "Meeting",
        back_populates="summaries",
    )
    final_analyses = relationship(
        "FinalAnalysis",
        back_populates="summary",
        cascade="all, delete-orphan"
    )


# 6. 액션 아이템 # 회의에서 나온 할 일/TO-DO를 관리하는 테이블
class ActionItem(Base):
    __tablename__ = "ACTION_ITEM"

    ITEM_ID = Column(TEXT, primary_key=True, default=p_ulid)
    MEETING_ID = Column(TEXT, ForeignKey("MEETING.MEETING_ID"), nullable=False)
    TITLE = Column(TEXT, nullable=False)
    DESCRIPTION = Column(TEXT, nullable=True)
    DUE_DT = Column(TIMESTAMP(timezone=True), nullable=True)
    PRIORITY = Column(TEXT, nullable=True)
    EXTERNAL_TOOL = Column(TEXT, nullable=True)
    STATUS = Column(TEXT, nullable=False)
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    UPDATED_DT = Column(TIMESTAMP(timezone=True), nullable=True, onupdate=func.now())
    ASSIGNEE_ID = Column(TEXT, ForeignKey('RN_USER.USER_ID'), nullable=True)  # 내부 관리용 (현재 사용자)
    ASSIGNEE_NAME = Column(TEXT, nullable=True)  # 표시용 담당자 이름 (자유 텍스트)
    JIRA_ASSIGNEE_ID = Column(TEXT, nullable=True)  # Jira account_id (동기화 시 사용)

    __table_args__ = (
        CheckConstraint(
            STATUS.in_(['PENDING', 'IN_PROGRESS', 'DONE']),
            name='ck_action_item_status'
        ),
        CheckConstraint(
            PRIORITY.in_(['LOW', 'MEDIUM', 'HIGH']),
            name='ck_action_item_priority'
        ),
    )

    meeting = relationship(
        "Meeting",
        back_populates="action_items",
    )
    assignee = relationship(
        "User",
        back_populates="action_items",
    )


# 7. 회의 챗봇 로그 # 회의 중/후에 사용자가 챗봇에게 물어본 Q/A 저장
class ChatbotLog(Base):
    __tablename__ = "CHATBOT_LOG"

    LOG_ID = Column(TEXT, primary_key=True, default=p_ulid)
    MEETING_ID = Column(TEXT, ForeignKey("MEETING.MEETING_ID"), nullable=False)
    USER_ID = Column(TEXT, ForeignKey('RN_USER.USER_ID'), nullable=False)
    Q_TEXT = Column(TEXT, nullable=False)
    A_TEXT = Column(TEXT, nullable=True)
    ASKED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    meeting = relationship(
        "Meeting",
        back_populates="chatbot_logs",
    )
    user = relationship("User")


# 8. 지식 소스 # 유저가 추가한 문서/파일 등의 지식 베이스 정보
class KnowledgeSource(Base):
    __tablename__ = "KNOWLEDGE_SOURCE"

    SRC_ID = Column(TEXT, primary_key=True, default=p_ulid)
    OWNER_ID = Column(TEXT, ForeignKey('RN_USER.USER_ID'), nullable=False)
    SRC_TYPE = Column(TEXT, nullable=False)
    TITLE = Column(TEXT, nullable=True)
    SRC_PATH = Column(TEXT, nullable=True)
    META_JSON = Column(JSONB, nullable=True)
    content_vector = Column(Vector(1536), nullable=True)
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    owner = relationship(
        "User",
        back_populates="knowledge_sources",
    )


# 9. 최종 분석 # 요약/액션아이템을 기반으로 만든 최종 산출물
class FinalAnalysis(Base):
    __tablename__ = "FINAL_ANALYSIS"

    FINAL_ID = Column(TEXT, primary_key=True, default=p_ulid)
    MEETING_ID = Column(TEXT, ForeignKey("MEETING.MEETING_ID"), nullable=False)
    FINAL_TYPE = Column(TEXT, nullable=False)
    SUMMARY_ID = Column(TEXT, ForeignKey("SUMMARY.SUMMARY_ID"), nullable=True)
    CONTENT = Column(TEXT, nullable=False)
    ARTIFACT_PATH = Column(TEXT, nullable=True)
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    meeting = relationship(
        "Meeting",
        back_populates="final_analyses",
    )
    summary = relationship(
        "Summary",
        back_populates="final_analyses",
    )


# 10. 키워드 부스팅 사전 # STT/LLM에서 강조해줄 사용자별 키워드 목록
class KeywordBoostDict(Base):
    __tablename__ = "KEYWORD_BOOST_DICT"

    KEY_ID = Column(TEXT, primary_key=True, default=p_ulid)
    USER_ID = Column(TEXT, ForeignKey('RN_USER.USER_ID'), nullable=False)
    KEYWORD = Column(TEXT, nullable=False)
    CATEGORY = Column(TEXT, nullable=True)


# 11. 파일/산출물 로그 # 회의에서 사용하는 각종 파일들의 로그
class ArtifactLog(Base):
    __tablename__ = "ARTIFACT_LOG"

    ARTIFACT_LOG_ID = Column(TEXT, primary_key=True, default=p_ulid)
    MEETING_ID = Column(TEXT, ForeignKey("MEETING.MEETING_ID"), nullable=False)
    ARTIFACT_TYPE = Column(TEXT, nullable=False)
    ARTIFACT_PATH = Column(TEXT, nullable=True)
    target = Column("TARGET", TEXT, nullable=True)   # SQL 예약어
    result = Column("RESULT", TEXT, nullable=True)
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    meeting = relationship(
        "Meeting",
        back_populates="artifact_logs",
    )

# 12. 임베딩 (RAG 벡터) # 회의에서 사용하는 RAG 임베딩을 따로 저장하는 테이블
class Embedding(Base):
    __tablename__ = "EMBEDDING"

    EMBEDDING_ID = Column(TEXT, primary_key=True, default=p_ulid)
    MEETING_ID = Column(TEXT, ForeignKey("MEETING.MEETING_ID"), nullable=False)
    CHUNK_TEXT = Column(TEXT, nullable=False)
    EMBEDDING = Column(Vector(1536), nullable=False)
    CREATED_DT = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

    meeting = relationship(
        "Meeting",
        back_populates="embeddings",
    )
