# RoundNote Backend - 개발 가이드

## 목차
- 프로젝트 구조
- 시작하기
- 역할 배분
- API 엔드포인트
- 개발 규칙
- 주요 기능

---

## 프로젝트 구조

```
backend/
├── main.py                   # FastAPI 애플리케이션 엔트리 포인트
├── worker.py                 # RQ Worker - Pass 2 배치 작업 (ElevenLabs STT, 요약 생성)
├── database.py               # SQLAlchemy 엔진, SessionLocal, get_db 의존성
├── models.py                 # User, Meeting, Summary, ActionItem, Embedding 모델
├── alembic/                  # Alembic DB 마이그레이션
│
├── api/
│   └── v1/                   # API v1 라우터 모음
│       ├── __init__.py       # v1 라우터 통합
│       ├── auth/
│       │   └── endpoints.py  # 인증 엔드포인트 (register, login, /me)
│       ├── meetings/
│       │   └── endpoints.py  # 회의 CRUD 엔드포인트 (GET, POST, PUT, DELETE)
│       ├── realtime/
│       │   └── endpoints.py  # WebSocket 엔드포인트 (Pass 1 STT - Deepgram)
│       └── reports/
│           └── endpoints.py  # 보고서 조회 엔드포인트 (summary, action-items, search)
│
├── schemas/                  # Pydantic DTO 정의
│   ├── __init__.py
│   ├── user.py               # UserCreate, UserOut, Token 스키마
│   ├── meeting.py            # MeetingCreate, MeetingOut 스키마
│   └── report.py             # ActionItemOut, SummaryOut, ReportOut 스키마
│
├── crud/                     # DB CRUD 함수
│   ├── __init__.py
│   ├── user.py               # create_user, get_user_by_email 등
│   ├── meeting.py            # create_meeting, get_meeting, list_meetings 등
│   ├── summary.py            # create_summary, get_summary_by_meeting 등
│   └── action_item.py        # create_action_item, get_action_items_by_meeting 등
│
└── core/                     # 비즈니스 로직 및 외부 서비스 통합
    ├── auth/
    │   └── security.py       # JWT/더미 인증 로직, 보안 유틸
    ├── llm/
    │   ├── service.py        # generate_summary, extract_action_items (OpenAI API)
    │   ├── chain.py          # LangChain 체인 정의 (요약, 액션 아이템 추출)
    │   └── rag/
    │       ├── retriever.py  # 유사 문서 검색 (의미 기반)
    │       └── vectorstore.py # pgvector 저장소 임베딩 관리
    ├── stt/
    │   └── service.py        # Deepgram (Pass 1 실시간), ElevenLabs (Pass 2 배치 전사 API 클라이언트)
    ├── storage/
    │   └── service.py        # NCP Object Storage 업로드/다운로드
    └── integrations/
        ├── __init__.py
        ├── jira_service.py   # Jira 이슈 생성/업데이트
        └── notion_service.py # Notion 페이지 생성/업데이트
```

---

## 시작하기

### 1. 환경 설정

```bash
# Python 3.11 설치 (Windows)
winget install Python.Python.3.11

# 프로젝트 루트에서 backend 폴더로 이동
cd backend

# 가상 환경 생성 (Python 3.11)
py -3.11 -m venv .venv

# 가상 환경 활성화
# Windows
. .venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

# 의존성 설치
pip install -r requirements.txt
```

### 2. Docker 환경 설정

```bash
# 프로젝트 루트에서 (round-note/)
cd ..

# Docker Compose 서비스 시작
docker-compose up -d

# 서비스 상태 확인
docker-compose ps
```

### 3. 환경 변수

아래 환경 변수를 `.env` 파일에 설정하세요:

**데이터베이스 & 캐시**
- `DATABASE_URL` - PostgreSQL 연결 문자열
- `REDIS_URL` - Redis 연결 문자열

**외부 API 키**
- `OPENAI_API_KEY` - OpenAI API 키 (LLM, 번역)
- `DEEPGRAM_API_KEY` - Deepgram STT API 키 (실시간 음성인식)
- `ELEVENLABS_API_KEY` - ElevenLabs API 키 (고품질 배치 전사)
- `ELEVENLABS_TRANSCRIBE_URL` - ElevenLabs STT 엔드포인트 (선택, 기본값: `https://api.elevenlabs.io/v1/speech-to-text`)

**NCP Object Storage**
- `NCP_ENDPOINT_URL` - NCP Object Storage 엔드포인트
- `NCP_BUCKET_NAME` - 버킷 이름
- `NCP_ACCESS_KEY` - NCP Access Key
- `NCP_SECRET_KEY` - NCP Secret Key

**인증 & 보안**
- `SECRET_KEY` - JWT 서명 키 (프로덕션 환경에서 반드시 변경)
- `ALGORITHM` - JWT 알고리즘 (기본값: HS256)
- `ACCESS_TOKEN_EXPIRE_MINUTES` - JWT 토큰 만료 시간 (분)

**Google OAuth**
- `GOOGLE_CLIENT_ID` - Google OAuth 클라이언트 ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth 클라이언트 Secret
- `GOOGLE_REDIRECT_URI` - OAuth 콜백 URI

**CORS 설정**
- `CORS_ORIGIN_LOCAL` - 로컬 개발 환경 CORS
- `CORS_ORIGIN` - 배포 환경 CORS

### 4. 데이터베이스 마이그레이션

```bash
# Backend 디렉토리에서 마이그레이션 적용
alembic -c backend/alembic.ini upgrade head

# 마이그레이션 생성 (필요시)
alembic revision --autogenerate -m "description"
```

### 5. 서버 실행

```bash
# 모든 서비스는 Docker Compose로 실행합니다
# 프로젝트 루트에서
cd ..

docker-compose up -d

# 서비스 상태 확인
docker-compose ps
```

### 6. Docker 컨테이너 확인

```bash
# PostgreSQL 접속
docker exec -it roundnote_db psql -U roundnote_user -d roundnote_db

# Redis CLI
docker exec -it roundnote_redis redis-cli

# Backend 로그 확인
docker logs -f roundnote_backend
```

### 7. NCP Compute 배포

**배포 환경 변경**: Backend, PostgreSQL, Redis 모두 **NCP Compute로 이전**

**장점:**
- 모든 서비스가 같은 VPC 내부 (안전 & 빠름)
- NCP Object Storage (VPC 전용) 직접 접근
- `docker-compose.yml` 동일하게 사용
- Frontend는 Render에서 호스팅

**배포 단계:**
1. NCP Compute 생성 (Ubuntu 20.04, 2vCPU, 4GB RAM)
2. Docker & Docker Compose 설치
3. 코드 클론: `git clone <repo>`
4. 환경변수 설정: `backend/.env`
5. 실행: `docker-compose up -d`
6. NCP 보안그룹: SSH(22), Backend(8000) 오픈
7. Render 환경변수: `REACT_APP_API_URL=http://<NCP-IP>:8000`

자세한 내용은 [`README.md`](../README.md)의 **"NCP Compute 배포"** 섹션 참고

---

## 역할 배분

| 담당 역할 | 담당자 | 주요 책임 | 관련 파일 |
|:---|:---|:---|:---|
| **팀장 (RAG & 저장소 + 기본 CRUD)** | 권현재 | - RAG 시스템 (문서 검색/인덱싱)<br>- LangChain 체인 설계<br>- 벡터 저장소 관리 (pgvector)<br>- Meeting CRUD 함수 (생성/조회/수정/삭제)<br>- Summary/ActionItem CRUD<br>- Pydantic 스키마 정의<br>- DB 모델 설계 | `core/llm/rag/`<br>`core/llm/chain.py`<br>`crud/meeting.py`<br>`crud/summary.py`<br>`crud/action_item.py`<br>`schemas/meeting.py`<br>`schemas/report.py`<br>`models.py` |
| **백엔드 리드 (STT/WebSocket/인증/핵심 API)** | 김기찬 | - API 라우터 설계/구현 (auth, meetings 기본)<br>- 실시간 WebSocket 구현 (Pass 1)<br>- STT 통합 (Deepgram)<br>- 인증 & JWT 토큰 관리<br>- User CRUD 함수 (회원가입/조회)<br>- 기본 더미 인증 미들웨어<br>- Pydantic User 스키마 | `api/v1/auth/`<br>`api/v1/meetings/` (라우팅만)<br>`api/v1/realtime/`<br>`core/stt/`<br>`core/auth/`<br>`crud/user.py`<br>`schemas/user.py` |
| **Integration & LLM & 배치 처리** | 정유현 | - Pass 2 배치 전사 (ElevenLabs)<br>- NCP Object Storage 통합<br>- 오디오 다운로드/업로드 로직<br>- LLM 요약/분석 파이프라인<br>- 액션 아이템/요약 생성<br>- 보고서 조회 API 구현 (reports)<br>- Jira/Notion 외부 연동<br>- RQ Worker 배치 작업 관리 | `worker.py` (ElevenLabs/배치)<br>`core/storage/`<br>`core/llm/service.py`<br>`api/v1/reports/`<br>`core/integrations/`<br>`crud/` (영향도 있는 부분) |

---

## API 엔드포인트

### 인증 (Auth) - 백엔드 리드 (김기찬)
```
POST   /api/v1/auth/register       회원가입
POST   /api/v1/auth/login          로그인 (더미 인증 초기 사용)
GET    /api/v1/auth/me             현재 사용자 정보 (더미 반환)
POST   /api/v1/auth/logout         로그아웃 (더미 구현)
```

### 회의 관리 (Meetings) - 백엔드 리드(라우팅) + 팀장(CRUD)
```
GET    /api/v1/meetings            회의 목록 조회 (권현재 CRUD)
POST   /api/v1/meetings            새 회의 생성 (권현재 CRUD)
GET    /api/v1/meetings/{id}       회의 상세 조회 (권현재 CRUD)
PUT    /api/v1/meetings/{id}       회의 정보 수정 (권현재 CRUD)
DELETE /api/v1/meetings/{id}       회의 삭제 (권현재 CRUD)
```

### 실시간 WebSocket (Realtime) - 백엔드 리드 (김기찬)
```
WS     /api/v1/realtime/ws?translate=true&summary=false
```

**WebSocket 메시지 포맷:**

클라이언트 → 서버:
```json
{
  "type": "audio",
  "data": "base64_encoded_audio_chunk"
}
```

서버 → 클라이언트:
```json
{
  "type": "final_transcript",
  "text": "회의 내용...",
  "speaker": "User1",
  "timestamp": 1234567890
}
```

### 보고서/요약 조회 (Reports) - Integration & LLM (정유현)
```
GET    /api/v1/reports/{meeting_id}/summary     회의 요약
GET    /api/v1/reports/{meeting_id}/action-items 액션 아이템
GET    /api/v1/reports/{meeting_id}/full        최종 보고서
GET    /api/v1/reports/{meeting_id}/search      RAG 검색
POST   /api/v1/reports/{meeting_id}/regenerate  요약 재생성

### 회의 배치 전사 & 산출물 (Meetings Batch STT) - Integration & LLM (정유현)
```
POST   /api/v1/meetings/{id}/finalize   배치 전사 작업 큐 등록 (RQ, ElevenLabs)
GET    /api/v1/meetings/{id}/artifacts  최종 전사/요약/액션아이템 상태 및 결과 조회
GET    /api/v1/meetings/{id}/audio      회의 오디오(.wav) 다운로드
POST   /api/v1/meetings/{id}/audio      회의 오디오(.wav) 업로드
```

**동작 요약:**
- 업로드된 `.wav` 파일을 기준으로 RQ 작업이 `stt` 큐에 등록됩니다.
- Worker가 ElevenLabs STT를 호출하여 고품질 전사본을 생성합니다.
- 전사 완료 후 요약 및 액션 아이템을 자동으로 생성하여 DB에 저장합니다.
- 프론트엔드는 `/artifacts` 엔드포인트를 폴링하여 상태(`queued|processing|done|error`)와 결과를 표시합니다.
```

---

## 개발 규칙

### 1. 파일 네이밍
- 파이썬 모듈: `snake_case` (예: `meeting_service.py`)
- 클래스: `PascalCase` (예: `MeetingService`)
- 함수: `snake_case` (예: `get_meeting()`)

### 2. 코드 구조

**CRUD 함수 (crud/meeting.py) - 백엔드 리드:**
```python
def get_meetings_by_user(db: Session, user_id: str, skip: int = 0, limit: int = 100):
    """특정 사용자의 회의 목록을 조회합니다."""
    return db.query(models.Meeting)\
        .filter(models.Meeting.creator_id == user_id)\
        .offset(skip)\
        .limit(limit)\
        .all()
```

**API 엔드포인트 (api/v1/meetings/endpoints.py) - 백엔드 리드:**
```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend import crud, schemas
from backend.dependencies import get_db

router = APIRouter(prefix="/meetings", tags=["Meetings"])

@router.get("/")
def list_meetings(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """회의 목록 조회"""
    meetings = crud.meeting.get_meetings_by_user(db, user_id, skip, limit)
    return meetings
```

**클래스 기반 서비스와 의존성 주입 패턴 (core/stt/service.py + api/v1/realtime/endpoints.py):**

서비스는 클래스로 구현하고, 각 서비스의 인스턴스를 반환하는 의존성 제공자를 `dependencies.py`에 정의합니다:

```python
# core/stt/service.py
class STTService:
    def __init__(self):
        self.api_key = os.getenv("DEEPGRAM_API_KEY")
        if not self.api_key:
            raise ValueError("DEEPGRAM_API_KEY not set")
    
    def get_realtime_stt_url(self):
        return f"wss://api.deepgram.com/v1/listen?language=ko&model=nova-2&diarize=true"
    
    async def transcribe(self, audio_chunk: bytes) -> str:
        # 실제 Deepgram API 호출
        pass
```

```python
# dependencies.py
from backend.core.stt.service import STTService
from backend.core.llm.service import LLMService

def get_stt_service() -> STTService:
    return STTService()

def get_llm_service() -> LLMService:
    return LLMService()
```

엔드포인트에서는 `Depends()` 로 서비스 인스턴스를 주입받습니다:

```python
# api/v1/realtime/endpoints.py
from fastapi import APIRouter, WebSocket, Depends
from backend.dependencies import get_stt_service, get_llm_service
from backend.core.stt.service import STTService
from backend.core.llm.service import LLMService

@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    stt_service: STTService = Depends(get_stt_service),
    llm_service: LLMService = Depends(get_llm_service)
):
    """실시간 음성 인식 핸들러"""
    await websocket.accept()
    
    # stt_service, llm_service 사용
    url, headers = stt_service.get_realtime_stt_url()
    # ... WebSocket 로직
```

**LLM 요약 함수 (core/llm/service.py) - RAG & LangChain:**
```python
from langchain.chains import LLMChain
from langchain.prompts import PromptTemplate
from backend.core.llm.rag.retriever import RAGRetriever

async def generate_summary(meeting_id: str, transcript: str):
    """회의 전사본을 요약합니다."""
    retriever = RAGRetriever()
    context = retriever.retrieve(transcript, k=3)
    
    prompt = PromptTemplate.from_template(
        "다음 회의 내용을 요약하세요:\n{context}\n{transcript}"
    )
    chain = LLMChain(llm=llm, prompt=prompt)
    summary = chain.run(context=context, transcript=transcript)
    
    return summary
```

**엔드포인트와 서비스 분리 패턴**

API 라우터(`endpoints.py`)는 요청/응답, 권한 체크, HTTP 레이어만 처리하고
핵심 비즈니스 로직은 `service.py`로 분리합니다. `endpoints.py`는 `service.py`의
함수를 호출하여 결과를 반환합니다. 예:

```python
# api/v1/reports/endpoints.py
@router.post("/{meeting_id}/regenerate")
def regenerate_summary(meeting_id: str, db: Session = Depends(get_db)):
    # 입력 검증, 권한 체크
    summary = reports_service.regenerate_summary(meeting_id, db)
    return summary
```

`service.py`는 I/O, 외부 API 호출, RQ 작업 등록 등을 담당합니다.

**WebSocket 핸들러 (api/v1/realtime/endpoints.py) - 백엔드 보조:**
```python
@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    translate: bool = False,
    summary: bool = False
):
    """실시간 음성 인식 및 처리"""
    await websocket.accept()
    
    stt_service = STTService()
    
    try:
        while True:
            data = await websocket.receive_json()
            if data["type"] == "audio":
                # 실시간 스트리밍 전사는 UX 목적(부분 자막, 즉각 피드백)에 사용합니다.
                # 전체 오디오에 대한 고품질 전사 및 산출물 생성을 위해
                # 전체 오디오 스트림은 NCP Object Storage에 저장하고
                # 저장된 파일을 배치 방식(예: ElevenLabs API)으로 전송하여
                # 고품질 전사/분석을 수행합니다. 결과물은 DB에 저장되고
                # 필요시 Notion/Jira로 전송됩니다 (core.integrations 사용).
                transcript = await stt_service.transcribe(data["data"])
                await websocket.send_json({
                    "type": "final_transcript",
                    "text": transcript
                })
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
```

### 3. 커밋 메시지 컨벤션

형식: `<Type>: <Subject>`

**Type:**
- `Feat:` - 새로운 기능 추가
- `Fix:` - 버그 수정
- `Refactor:` - 코드 리팩토링
- `Style:` - 코드 스타일 변경 (포매팅 등)
- `Test:` - 테스트 코드 추가/수정
- `Docs:` - 문서 수정
- `Chore:` - 빌드, 패키지 매니저 설정

**예시:**
```
Feat: 회의 CRUD 엔드포인트 구현
Feat: RAG 파이프라인 추가
Fix: WebSocket 번역 오류 수정
Docs: README 업데이트
Test: 회의 생성 테스트 추가
```

### 4. 로깅
```python
import logging

logger = logging.getLogger(__name__)

logger.info("회의 생성 시작: %s", meeting_id)
logger.error("LLM 요약 오류: %s", str(e))
```

---

## 주요 기능

### Pass 1: 실시간 음성 인식 (STT) - 백엔드 리드 (김기찬)

**흐름:**
1. 프론트엔드에서 오디오 청크 전송 (WebSocket)
2. `core/stt/service.py` → Deepgram API 호출 (실시간)
3. 전사 텍스트 실시간 반환 (부분 자막, UX 피드백용)
4. 선택적 번역 (OpenAI API, 실시간)
5. 전체 오디오 스트림 → NCP Object Storage에 저장 (배치 처리용)

**특징:** 빠른 응답, UX 최적화, 낮은 지연 시간

**관련 파일:**
- `core/stt/service.py` (Deepgram)
- `api/v1/realtime/endpoints.py`
- `worker.py` (오디오 청크 버퍼링)

---

### Pass 2: 배치 방식 고품질 전사 (STT) - Integration & LLM (정유현)

**흐름:**
1. 회의 종료 → 전체 오디오 NCP에 저장 완료
2. RQ Worker가 배치 작업 시작
3. NCP에서 오디오 다운로드
4. `core/stt/service.py` (ElevenLabs) → 고품질 전사 요청 (`transcribe_wav`) 
5. 고품질 전사본 획득 → LangChain 전달
6. `core/llm/service.py` → 요약 & 액션 아이템 추출
7. 결과 → DB에 저장 (Summary, ActionItem)
8. 최종 보고서 생성 → Jira/Notion 연동

**상태 필드 (Meeting):**
- `FINAL_TRANSCRIPT_STATUS`: `queued|processing|done|error`
- `FINAL_TRANSCRIPT_TEXT`, `FINAL_TRANSCRIPT_URL`, `FINAL_TRANSCRIPT_ERROR`

**특징:** 높은 정확도, 비용 효율적 (배치), LLM 분석 포함

**관련 파일:**
- `worker.py` (RQ 배치 작업)
- `core/storage/service.py` (NCP 다운로드)
- `core/stt/service.py` (ElevenLabs)
- `core/llm/service.py` (LangChain 분석)
- `core/llm/rag/` (RAG 파이프라인)
- `crud/summary.py`, `crud/action_item.py` (DB 저장)
- `core/integrations/` (Jira/Notion)

---

### RAG 시스템 (검색 및 컨텍스트 강화) - 팀장 (권현재)

**기능:**
- 벡터 임베딩 저장 (pgvector)
- 의미 기반 문서 검색 (유사 회의 찾기)
- 컨텍스트 강화 생성 (RAG) - LLM이 과거 회의 참고하여 더 정확한 요약 생성

**흐름:**
1. 각 회의마다 LLM 임베딩 생성
2. pgvector에 저장
3. 새 회의 전사본으로 유사 회의 검색
4. 유사 회의의 과거 요약/액션 아이템을 컨텍스트로 사용
5. LLM이 더 나은 요약 생성

**관련 파일:**
- `core/llm/rag/vectorstore.py` (pgvector 통합)
- `core/llm/rag/retriever.py` (유사 문서 검색)
- `models.py` (Embedding 테이블)

---

### 저장소 관리 - Integration & LLM (정유현)

**기능:**
- 오디오 파일 NCP Object Storage 저장
- Pass 1 동안 스트리밍 저장 (청크 단위)
- Pass 2 배치 처리용 다운로드
- 회의 메타데이터 DB 저장

**흐름:**
1. WebSocket 연결 시 로컬 Wave 파일 생성
2. 오디오 청크 받으면서 파일에 쓰기
3. 회의 종료 시 NCP에 업로드
4. Pass 2에서 다운로드하여 배치 전사

**관련 파일:**
- `core/storage/service.py`
- `models.py` (Meeting.audio_path, audio_duration)

---

### LLM 분석 및 요약 - Integration & LLM (정유현) + 팀장 (권현재)

**흐름:**
1. Pass 2 고품질 전사본 → LangChain 입력
2. RAG 검색 (유사 회의 컨텍스트)
3. LLM으로 요약 생성 (프롬프트 기반)
4. 액션 아이템 추출 (JSON 구조화)
5. 결과 → DB + Reports API로 반환

**관련 파일:**
- `core/llm/service.py` (LLM 호출)
- `core/llm/chain.py` (LangChain 체인)
- `core/llm/rag/` (컨텍스트 검색)
- `api/v1/reports/` (결과 조회)

---

### 외부 연동 (Jira/Notion) - Integration & LLM (정유현)

**기능:**
- 액션 아이템 → Jira 이슈 자동 생성
- 최종 보고서 → Notion 페이지 자동 생성
- 팀 협업 플랫폼 통합

**관련 파일:**
- `core/integrations/jira_service.py`
- `core/integrations/notion_service.py`
- `api/v1/reports/` (외부 연동 엔드포인트)

---

## 데이터베이스 스키마

### 핵심 테이블

**USER**
- user_id (PK, ULID)
- email, password_hash, name, phone
- created_at, updated_at, is_active

**MEETING**
- meeting_id (PK, ULID)
- creator_id (FK → USER)
- title, purpose, status (ONGOING/ENDING/COMPLETED)
- start_dt, end_dt
- location (NCP 오디오 경로)

**STT_CHUNK** (실시간 처리 - 백엔드 보조)
- chunk_id (PK, ULID)
- meeting_id (FK)
- start_sec, end_sec
- speaker_label, text
- created_at

**SUMMARY** (요약 - RAG & LangChain)
- summary_id (PK, ULID)
- meeting_id (FK)
- content (JSON/Markdown)
- format (json/markdown)
- created_at

**ACTION_ITEM** (액션 아이템 - RAG & LangChain)
- item_id (PK, ULID)
- meeting_id (FK)
- title, description
- due_date, priority, status
- assignee_id (FK → USER)

**EMBEDDING** (RAG 벡터 - RAG & LangChain)
- embedding_id (PK, ULID)
- meeting_id (FK)
- chunk_text
- embedding (pgvector)
- created_at

---

## 개발 진도 체크리스트 (남은 주요 작업)

### 1️⃣ 김기찬 (백엔드 리드) - 크리티컬 패스 (우선순위순)

**Phase 1A - 완료됨 ✅**

- [x] **User 인증 구현**
  - [x] POST /auth/register (실제 DB 연동, bcrypt 해싱)
  - [x] POST /auth/login (JWT 토큰 발급)
  - [x] User CRUD 함수 (create_user, authenticate_user, get_user_by_email)
  - [x] JWT 토큰 생성/검증 (python-jose, passlib)
  - [x] Pydantic User 스키마 (UserCreate, UserLogin, Token, UserOut)

- [x] **Google OAuth 2.0 구현**
  - [x] GET /auth/google/login (Google 로그인 리다이렉트)
  - [x] GET /auth/google/callback (OAuth 콜백 처리, JWT 발급)
  - [x] authlib 통합 및 SessionMiddleware 추가
  - [x] 신규 사용자 자동 생성 로직

- [x] **데이터베이스 스키마 수정**
  - [x] PostgreSQL 예약어 충돌 해결 (USER → RN_USER)
  - [x] Alembic 마이그레이션 생성 및 적용

- [x] **WebSocket 실시간 STT (Pass 1)**
  - [x] Deepgram WebSocket 연결 구현
  - [x] React ↔ Deepgram 양방향 중계
  - [x] 실시간 번역 기능 (OpenAI API)
  - [x] 일시정지/재개 제어
  - [x] 오디오 파일 로컬 저장 (WAV)
  - [x] 프론트엔드 WebSocket 훅 (useRealtimeStream)

- [x] **Meetings CRUD API 구현**
  - [x] GET /meetings (회의 목록 조회 with JWT 인증)
  - [x] POST /meetings (새 회의 생성)
  - [x] GET /meetings/{id} (회의 상세 조회)
  - [x] PUT /meetings/{id} (회의 정보 수정)
  - [x] DELETE /meetings/{id} (회의 삭제)
  - [x] POST /meetings/{id}/end (회의 종료 처리)

**Phase 1B - 남은 작업 ⏳**

- [x] **추가 인증 기능**
  - [x] GET /auth/me (JWT 토큰 기반 현재 사용자 정보)
  - [x] POST /auth/logout (로그아웃 처리)
  - [x] 보안 개선 (localStorage → httpOnly Cookie)

- [X] **회의 저장 통합**
  - [X] 회의 종료 시 전사 내용(CONTENT), AI 분석(AI_SUMMARY) DB 저장
  - [X] 액션 아이템 자동 추출 및 ACTION_ITEM 테이블 저장
  - [X] Summary 테이블 연동 (회의별 요약 저장)
  - [X] 프론트엔드 → 백엔드 회의 저장 시 전체 데이터 전달


- [X] **Jira 연동**
  - [X] `core/integrations/jira_service.py` - 액션 아이템을 Jira 이슈로 생성


**Phase 1C - 버그 수정 🐛**

- [ ] **프론트엔드 마이크 제어 이슈**
  - [ ] 녹음 종료 버튼 클릭 시 새로고침 없이 마이크 비활성화 문제 해결
  - [ ] MediaStream 트랙 정리 로직 개선

---

### 2️⃣ 권현재 (팀장) - 병렬 진행 (우선순위순)

**Phase 2A (1-2일)**

- [x] **Meeting/Summary/ActionItem CRUD 완성**
  - [x] `crud/meeting.py` - create_meeting, get_meeting, list_meetings, update_meeting, delete_meeting
  - [x] `crud/summary.py` - create_summary, get_summary_by_meeting, update_summary
  - [x] `crud/action_item.py` - create_action_item, get_action_items_by_meeting, update_action_item
  
  - [x] 더미 데이터로 CRUD 함수 단위 테스트 (tests/test_crud.py)

- [ ] **Pydantic 스키마 확장**
  - [x] `schemas/meeting.py` - 완성 (생성/조회/수정 스키마 분리)
  - [x] `schemas/report.py` - ActionItemOut, SummaryOut 완성
  - [ ] 팀원들과 스키마 협의
=======
  - [ ] 더미 데이터로 CRUD 함수 단위 테스트 (tests/test_crud.py)

- [x] **Pydantic 스키마 확장**
  - [x] `schemas/meeting.py` - 완성 (생성/조회/수정 스키마 분리)
  - [x] `schemas/report.py` - ActionItemOut, SummaryOut 완성
  - [x] 팀원들과 스키마 협의
**Phase 2B (2-3일) - 병렬, 더미 데이터 사용**

- [ ] **LangChain + RAG 파이프라인 (프로토타입)**
  - [ ] `core/llm/chain.py` - 요약/액션 아이템 추출 LangChain 체인 정의
  - [ ] `core/llm/rag/vectorstore.py` - pgvector 저장/검색 (더미 임베딩)
  - [ ] `core/llm/rag/retriever.py` - 유사 문서 검색 로직
  - [ ] 더미 전사본으로 RAG 테스트 (tests/test_rag.py)

**Phase 2C (1-2일) - Phase 2A 완료 후**

- [x] **DB 마이그레이션 & 모델 확정**
  - [x] `models.py` - User, Meeting, Summary, ActionItem, Embedding 모델
  - [x] `alembic/` - 마이그레이션 생성 및 테스트

---

### 3️⃣ 정유현 (Integration & LLM & 배치 처리) - 병렬 진행

**Phase 3A (1-2일) - 즉시 병렬 (더미 데이터 사용)**

- [x] **NCP Object Storage 통합**
  - [x] `core/storage/service.py` - upload_audio, download_audio (더미 경로 반환)
  - [x] NCP SDK 초기화 및 테스트
  - [ ] GET /api/v1/health/storage 엔드포인트 추가 (김기찬 또는 정유현)

- [ ] **Pass 2 배치 전사 파이프라인 설계**
  - [ ] `worker.py` - RQ Job 정의 (ElevenLabs 호출 틀)
  - [ ] ElevenLabs API 클라이언트 작성
  - [ ] NCP 다운로드 → ElevenLabs 전사 → 결과 저장 흐름

**Phase 3B (1-2일) - 병렬, 더미 데이터 사용**

- [x] **LLM 서비스 완성 (OpenAI API)**
  - [x] `core/llm/service.py` - generate_summary, extract_action_items
  - [x] 프롬프트 템플릿 작성 및 최적화

**Phase 3C (1-2일) - 병렬, Reports API 라우팅**

- [] **Reports API 라우터 완성** (김기찬이 기본 라우팅 후)
  - [] `api/v1/reports/endpoints.py` - 모든 엔드포인트 구현
  - [] GET /reports/{meeting_id}/summary
  - [] GET /reports/{meeting_id}/action-items
  - [] POST /reports/{meeting_id}/regenerate (RQ 작업 등록)

**Phase 3D (1-2일) - Phase 3A 완료 후**

- [] **Notion 연동**
  - [] `core/integrations/notion_service.py` - 보고서를 Notion 페이지로 생성
  - [ ] 통합 테스트

---

## 병렬 작업 가이드 (더미 데이터 활용)

> **핵심 전략**: 각 팀원이 상대방의 작업을 기다리지 않도록 **더미 데이터**를 사용하여 병렬 진행
> 
> **Cyber Bibek 조언**: 김기찬의 CRUD API 완성을 기다리지 말고, hardcoded meeting_id를 사용하여 RAG/LLM 모듈을 즉시 테스트하세요.

### 더미 데이터 구조 (`tests/fixtures.py`)

```python
from datetime import datetime
from ulid import ULID

DUMMY_USER = {
    "user_id": str(ULID()),
    "email": "test@roundnote.com",
    "name": "테스트 사용자",
    "password_hash": "hashed_password_here"
}

# 권현재와 정유현이 사용할 hardcoded meeting_id
DUMMY_MEETING_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV"

DUMMY_MEETING = {
    "meeting_id": DUMMY_MEETING_ID,
    "creator_id": DUMMY_USER["user_id"],
    "title": "Q4 전략 회의",
    "purpose": "분기별 목표 설정",
    "transcript": "안녕하세요. 이번 분기 목표에 대해 논의하겠습니다. 마케팅 팀은 SNS 마케팅을 강화하고, 개발팀은 API 안정성을 개선해야 합니다.",
    "status": "COMPLETED",
    "start_dt": datetime(2025, 11, 17, 10, 0),
    "end_dt": datetime(2025, 11, 17, 11, 30),
    "audio_path": "s3://roundnote/meetings/meeting-123.mp3"
}

DUMMY_ACTION_ITEMS = [
    {
        "item_id": str(ULID()),
        "meeting_id": DUMMY_MEETING_ID,
        "title": "마케팅 계획 수립",
        "description": "Q4 마케팅 전략 수립",
        "assignee_id": DUMMY_USER["user_id"],
        "due_date": datetime(2025, 12, 15),
        "priority": "HIGH",
        "status": "PENDING"
    },
    {
        "item_id": str(ULID()),
        "meeting_id": DUMMY_MEETING_ID,
        "title": "개발 일정 확인",
        "description": "개발팀과 일정 조율",
        "assignee_id": DUMMY_USER["user_id"],
        "due_date": datetime(2025, 12, 20),
        "priority": "MEDIUM",
        "status": "PENDING"
    }
]

DUMMY_SUMMARY = {
    "summary_id": str(ULID()),
    "meeting_id": DUMMY_MEETING_ID,
    "content": "이 회의에서는 Q4 목표를 설정하고 마케팅/개발 전략을 논의했습니다. 주요 액션 아이템은 마케팅 강화와 API 안정성 개선입니다.",
    "format": "markdown",
    "created_at": datetime.now()
}
```

### 각 팀원의 병렬 작업 예시

**권현재 - 회의/요약 CRUD + RAG 파이프라인 (김기찬 기다리지 않기)**

```python
# backend/crud/test_crud_meeting.py
import pytest
from tests.fixtures import DUMMY_MEETING, DUMMY_MEETING_ID, DUMMY_ACTION_ITEMS
from backend.crud import meeting as crud_meeting
from sqlalchemy.orm import Session

@pytest.fixture
def mock_db():
    # 실제 DB 없이 더미 객체 반환
    pass

def test_create_meeting(mock_db):
    """더미 데이터로 회의 생성 CRUD 테스트"""
    result = crud_meeting.create_meeting(
        mock_db,
        title=DUMMY_MEETING["title"],
        creator_id=DUMMY_MEETING["creator_id"]
    )
    assert result.meeting_id is not None
    print("✓ 회의 생성 CRUD 확인")

def test_rag_retriever():
    """더미 전사본으로 RAG 검색 테스트 (김기찬 기다리지 말 것)"""
    from backend.core.llm.rag.retriever import RAGRetriever
    
    retriever = RAGRetriever()
    # DUMMY_MEETING_ID를 hardcoding
    results = retriever.retrieve(DUMMY_MEETING["transcript"], k=3)
    assert len(results) <= 3
    print("✓ RAG Retriever 작동 확인")
```

**정유현 - LLM 서비스 + Pass 2 배치 + Object Storage (김기찬 기다리지 않기)**

```python
# backend/core/llm/test_service.py
import pytest
from tests.fixtures import DUMMY_MEETING_ID, DUMMY_MEETING

@pytest.mark.asyncio
async def test_llm_summary():
    """더미 전사본으로 요약 생성 테스트"""
    from backend.core.llm.service import LLMService
    
    llm_service = LLMService()
    summary = await llm_service.generate_summary(DUMMY_MEETING["transcript"])
    assert summary is not None
    assert len(summary) > 10
    print("✓ LLM 요약 생성 확인")

@pytest.mark.asyncio
async def test_pass2_batch_transcription():
    """Pass 2 배치 전사 파이프라인 테스트"""
    from backend.core.storage.service import StorageService
    from backend.worker import transcribe_audio_batch
    
    storage = StorageService()
    
    # 1. 더미 오디오 파일 생성 (또는 NCP에서 다운로드)
    local_audio = f"/tmp/meeting_{DUMMY_MEETING_ID}.mp3"
    
    # 2. NCP에서 다운로드 (실제 또는 더미)
    # audio_data = storage.download_audio(DUMMY_MEETING["audio_path"])
    
    # 3. ElevenLabs로 배치 전사 요청
    transcript = await transcribe_audio_batch(local_audio)
    
    assert transcript is not None
    print(f"✓ Pass 2 배치 전사 완료: {transcript[:50]}...")

def test_storage_integration():
    """NCP Object Storage 통합 테스트"""
    from backend.core.storage.service import StorageService
    
    storage = StorageService()
    
    # 더미 파일 업로드/다운로드
    uploaded_path = storage.upload_audio(
        local_path="/tmp/meeting.mp3",
        dest_path=f"meetings/{DUMMY_MEETING_ID}.mp3"
    )
    assert uploaded_path is not None
    
    downloaded_path = storage.download_audio(uploaded_path)
    assert downloaded_path is not None
    print("✓ Object Storage 통합 확인")

# backend/worker.py (Pass 2 배치 작업)
from rq import Queue
from redis import Redis
import asyncio

redis_conn = Redis()
q = Queue(connection=redis_conn)

@q.job
async def transcribe_audio_batch(meeting_id: str, audio_path: str):
    """
    Pass 2: 배치 방식 고품질 전사
    
    흐름:
    1. NCP에서 오디오 다운로드
    2. ElevenLabs API 호출
    3. 고품질 전사본 획득
    4. LangChain에 전달하여 요약 생성
    """
    from backend.core.storage.service import StorageService
    from backend.core.stt.service import ElevenLabsSTTService
    from backend.core.llm.service import LLMService
    
    storage = StorageService()
    stt_service = ElevenLabsSTTService()
    llm_service = LLMService()
    
    try:
        # 1. NCP에서 다운로드
        local_audio = storage.download_audio(audio_path)
        
        # 2. ElevenLabs로 전사
        transcript = await stt_service.transcribe(local_audio)
        
        # 3. LLM으로 요약 & 액션 아이템 추출
        summary = await llm_service.generate_summary(transcript)
        action_items = await llm_service.extract_action_items(transcript)
        
        # 4. DB에 저장 (CRUD 함수 호출)
        from backend import crud
        from backend.database import SessionLocal
        
        db = SessionLocal()
        crud.summary.create_summary(db, meeting_id, summary)
        for item in action_items:
            crud.action_item.create_action_item(db, meeting_id, item)
        db.close()
        
        print(f"✅ Pass 2 완료: {meeting_id}")
    except Exception as e:
        print(f"❌ Pass 2 오류: {e}")
        raise
```

**김기찬 - 간소화된 인증 + WebSocket (권현재/정유현 기다리지 말 것)**

```python
# backend/core/auth/dummy_auth.py (초기 단계)
"""
더미 인증 - 프론트엔드 개발과 병렬 진행을 위해 사용
실제 JWT는 나중에 구현
"""

DUMMY_TOKEN = "dummy_token_12345"
DUMMY_USER_ID = "user_12345"

def authenticate_dummy():
    """더미 인증 미들웨어"""
    return {"user_id": DUMMY_USER_ID, "email": "test@test.com"}

# backend/api/v1/auth/endpoints.py (간소화)
from fastapi import APIRouter, Depends
from backend.core.auth.dummy_auth import authenticate_dummy, DUMMY_TOKEN

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login")
def login(email: str, password: str):
    """더미 로그인 - 모든 요청에 token 반환"""
    return {
        "access_token": DUMMY_TOKEN,
        "token_type": "bearer",
        "user_id": "user_12345"
    }

@router.get("/me")
def get_me(token: str = Depends(authenticate_dummy)):
    """더미 현재 사용자 - 하드코딩된 사용자 반환"""
    return {"id": "user_12345", "email": "test@test.com"}
```

### Week별 타임라인 (병렬 작업 고려, 재조정)

**Week 1 (3-4일) - 병렬 진행 (간소화)**

```
김기찬 (1-2일 압축):
├─ 더미 인증 (login, /me) - 1일
├─ WebSocket 안정화 (Deepgram) - 1-2일
└─ API 라우팅 스켈레톤 (더미 반환) - 반일

권현재 (병렬 진행):
├─ Meeting/Summary/ActionItem CRUD - 1-2일 (김기찬 기다리지 않음)
├─ Pydantic 스키마 확장 - 반일
└─ LangChain + RAG 프로토타입 - 2-3일 (DUMMY_MEETING_ID 사용)

정유현 (병렬 진행):
├─ NCP Object Storage 통합 - 1-2일 (김기찬 기다리지 않음)
├─ Pass 2 배치 전사 (ElevenLabs) - 1-2일
├─ LLM 서비스 (generate_summary/extract_action_items) - 1일
└─ Reports API 엔드포인트 - 1일 (DUMMY_MEETING_ID로 테스트)
```

**Week 2 (2-3일) - 통합 & 연결**

```
모두:
├─ 실제 DB 데이터 연동
├─ API 엔드포인트 통합 테스트 (e2e)
├─ 프론트엔드 통합 테스트 (WebSocket, CRUD, Reports)
└─ 오류 수정 및 최적화
```

### 통합 테스트 (모든 팀원 준비 완료 후, Week 2)

```python
# backend/tests/test_integration_e2e.py
@pytest.mark.asyncio
async def test_full_workflow():
    """전체 end-to-end 플로우 테스트"""
    from httpx import AsyncClient
    from backend.main import app
    from tests.fixtures import DUMMY_MEETING_ID
    
    client = AsyncClient(app=app, base_url="http://test")
    
    # 1. 더미 로그인 (김기찬)
    login_response = await client.post(
        "/api/v1/auth/login",
        json={"email": "test@test.com", "password": "dummy"}
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    
    # 2. 회의 생성 (권현재 CRUD)
    meeting_response = await client.post(
        "/api/v1/meetings",
        json={"title": "테스트 회의", "purpose": "기능 검증"},
        headers=headers
    )
    meeting_id = meeting_response.json()["id"]
    
    # 3. 실시간 STT (김기찬 WebSocket)
    async with client.websocket_connect(
        f"/api/v1/realtime/ws?meeting_id={meeting_id}"
    ) as ws:
        await ws.send_json({"type": "audio", "data": "base64_audio"})
        response = await ws.receive_json()
        assert response["type"] == "final_transcript"
    
    # 4. Pass 2 배치 전사 + 요약 생성 (정유현)
    # RQ 작업이 자동으로 실행되거나 수동 호출
    
    # 5. 요약 조회 (정유현 Reports API)
    summary_response = await client.get(
        f"/api/v1/reports/{meeting_id}/summary",
        headers=headers
    )
    assert summary_response.json()["content"] is not None
    
    print("✓ 전체 플로우 검증 완료")
```

### 브랜치 전략 (팀 단위 병렬 작업, 재조정)

```bash
# develop에서 각 팀원이 자신의 브랜치 생성
git checkout develop

# 각 팀원의 브랜치
git checkout -b feat/kim-websocket-auth      # 김기찬: WebSocket + 더미 인증
git checkout -b feat/kwon-crud-rag           # 권현재: Meeting CRUD + RAG
git checkout -b feat/jeong-llm-storage       # 정유현: LLM + Storage + Pass 2

# 각자의 변경사항을 커밋 (병렬로 진행)
git add .
git commit -m "Feat: implement [feature] with dummy data tests"

# 완료 후 develop에 PR (conflict 최소화)
git checkout develop
git pull origin develop
git merge feat/kim-websocket-auth
git merge feat/kwon-crud-rag
git merge feat/jeong-llm-storage
```

---

## 주요 환경 변수

| 변수 | 설명 | 예시 |
|:---|:---|:---|
| `DATABASE_URL` | PostgreSQL 연결 문자열 (Docker) | `postgresql://roundnote_user:roundnote_password@db:5432/roundnote_db` |
| `REDIS_URL` | Redis 연결 문자열 (Docker) | `redis://redis:6379` |
| `OPENAI_API_KEY` | OpenAI API 키 (LLM, 번역) | `sk-...` |
| `DEEPGRAM_API_KEY` | Deepgram STT API 키 (실시간) | `d6ea7b94...` |
| `ELEVENLABS_API_KEY` | ElevenLabs API 키 (배치 전사) | `ea1a8b13...` |
| `NCP_ENDPOINT_URL` | NCP Object Storage 엔드포인트 | `https://kr.object.ncloudstorage.com` |
| `NCP_BUCKET_NAME` | NCP 버킷 이름 | `roundnote-bucket` |
| `NCP_ACCESS_KEY` | NCP Access Key | `ncp_iam_...` |
| `NCP_SECRET_KEY` | NCP Secret Key | `ncp_iam_...` |
| `SECRET_KEY` | JWT 서명 키 (프로덕션 필수 변경) | `roundnote-secret-key-please-change` |
| `ALGORITHM` | JWT 알고리즘 | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT 만료 시간 (분) | `30` |
| `GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID | `270793728126-...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth 클라이언트 Secret | `GOCSPX-...` |
| `GOOGLE_REDIRECT_URI` | OAuth 콜백 URI | `http://localhost:8000/api/v1/auth/google/callback` |
| `CORS_ORIGIN_LOCAL` | 로컬 개발 CORS | `http://localhost:3000` |
| `CORS_ORIGIN` | 배포 환경 CORS | `https://round-note-web.onrender.com` |

---

## 문제 해결

### PostgreSQL 연결 오류
```
ERROR: could not translate host name "postgres" to address
```
**해결:** Docker Compose 서비스 재시작

```bash
docker-compose restart postgres
docker-compose logs postgres
```

### Redis 연결 오류
```
ERROR: ConnectionRefusedError: [Errno 111] Connection refused
```
**해결:** Docker Compose 서비스 재시작

```bash
docker-compose restart redis
docker-compose logs redis
```

### JWT 토큰 검증 오류
```
ERROR: Could not validate credentials
```
**해결:** JWT_SECRET_KEY 확인

```bash
echo %JWT_SECRET_KEY%
```

### Backend 연결 불가
```
ERROR: Connection to backend failed
```
**해결:** Backend 컨테이너 로그 확인

```bash
docker-compose logs -f backend
```

---

## 유용한 명령어

```bash
# FastAPI 자동 문서
http://localhost:8000/docs

# 마이그레이션 상태 확인 (backend 설정 파일 사용)
alembic -c backend/alembic.ini current

# 마이그레이션 히스토리
alembic -c backend/alembic.ini history

# DB 리셋 (개발용)
alembic -c backend/alembic.ini downgrade base
alembic -c backend/alembic.ini upgrade head

# PostgreSQL 접속
docker exec -it roundnote-postgres psql -U roundnote -d roundnote

# Redis CLI
docker exec -it roundnote-redis redis-cli

# RQ Worker 실행 (로컬 개발)
set REDIS_URL=redis://localhost:6379/0 && python backend/worker.py

# 또는 PowerShell
$env:REDIS_URL="redis://localhost:6379/0"; python backend/worker.py

# 컨테이너 로그 확인
docker-compose logs -f backend
docker-compose logs -f postgres
docker-compose logs -f redis

# 모든 서비스 중지
docker-compose down

# 모든 서비스 시작
docker-compose up -d
```

---

## 참고 문서

- [FastAPI 공식 문서](https://fastapi.tiangolo.com/)
- [SQLAlchemy ORM](https://docs.sqlalchemy.org/en/20/orm/)
- [LangChain 문서](https://python.langchain.com/docs/)
- [Deepgram 실시간 API](https://developers.deepgram.com/reference/streaming)
- [ElevenLabs STT 문서](https://api.elevenlabs.io) 
- [OpenAI API](https://platform.openai.com/docs/api-reference)
- [Alembic 마이그레이션](https://alembic.sqlalchemy.org/)
- [pgvector 사용 가이드](https://github.com/pgvector/pgvector)

---

## 팀 연락처 (재조정)

| 역할 | 이름 | 담당 업무 |
|:---|:---|:---|
| 팀장 (RAG & CRUD) | 권현재 | - Meeting/Summary/ActionItem CRUD<br>- Pydantic 스키마 정의<br>- DB 모델 설계<br>- RAG/LangChain 파이프라인<br>- 벡터 저장소 (pgvector) |
| 백엔드 리드 | 김기찬 | - Pass 1 STT (Deepgram, WebSocket)<br>- 더미 인증 (로그인/회원가입)<br>- API 라우팅 (간소화)<br>- 실시간 자막 전달 |
| Integration & LLM & 배치 | 정유현 | - Pass 2 배치 전사 (ElevenLabs)<br>- NCP Object Storage 통합<br>- LLM 요약/분석 (generate_summary)<br>- 액션 아이템 추출<br>- Reports API 엔드포인트<br>- Jira/Notion 연동<br>- RQ Worker 관리 |

---

**마지막 업데이트:** 2025-11-17  
**버전:** V2.2 (ElevenLabs 배치 전사 + RQ 연동)