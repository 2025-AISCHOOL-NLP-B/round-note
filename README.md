# RoundNote - 실시간 회의 요약 및 액션 아이템 관리 서비스

**RoundNote**는 회의 음성을 실시간으로 처리하여 자동으로 회의 요약 및 액션 아이템을 추출하고, 이를 Jira/Notion 같은 협업 도구에 연동하는 LLM 기반 서비스입니다.

---

## 프로젝트 개요

| 항목 | 설명 |
|:---|:---|
| **팀명** | Knights of Round Table (원탁의 기사단) |
| **개발 기간** | 2025.09.26 ~ 2025.12.09 |
| **버전** | V2.0 (Architecture Stabilized) |
| **기술 스택** | FastAPI, SQLAlchemy, Deepgram STT, OpenAI LLM, LangChain, PostgreSQL, Redis, Docker |

---

## 팀 구성 및 역할

| 역할 | 담당자 | 주요 업무 |
|:---|:---|:---|
| **팀장** | 권현재 | RAG 시스템, 저장소 관리, NCP Object Storage, ASR 모델링(유사 시) |
| **백엔드 리드** | 김기찬 | STT, WebSocket 실시간 처리, User/Meeting CRUD, 인증 시스템 |
| **Integration & LLM** | 정유현 | LLM 요약 분석, 외부 서비스 통합(Jira, Notion) |
| **프론트엔드** | 서동현 | - |
| **프론트엔드** | 김선아 | - |

---

## 주요 기능

### 1. 실시간 음성 인식 (STT)
- WebSocket을 통한 실시간 음성 스트림 처리
- Deepgram API를 이용한 화자 분리(Diarization) 및 전사
- 실시간 스트리밍은 UX용(부분 자막)
- 고품질 전사를 위해 전체 오디오는 NCP Object Storage에 저장 후 배치 처리

### 2. LLM 분석 및 요약
- LangChain을 이용한 프롬프트 템플릿 기반 요약
- RAG(Retrieval Augmented Generation) 시스템으로 컨텍스트 강화
- 액션 아이템 자동 추출 및 분류

### 3. 외부 협업 도구 연동
- Jira: 액션 아이템을 이슈로 자동 생성
- Notion: 최종 회의록 및 보고서 자동 업로드

### 4. 저장소 관리
- 오디오 파일 저장 (NCP Object Storage)
- 회의 메타데이터 및 산출물 DB 저장 (PostgreSQL)
- 작업 큐 관리 (Redis + RQ)

---

## 시스템 아키텍처

```
회의 참여자
    |
    v (WebSocket 오디오 청크)
FastAPI 서버 (api/v1/realtime/endpoints.py)
    |
    +---> Deepgram API (실시간 STT)
    |       └--> 부분 자막 반환 (UX용)
    |
    +---> 전체 오디오 저장 (NCP Object Storage)
    |       └--> RQ Worker (배치 처리)
    |           └--> ElevenLabs API (고품질 전사)
    |
    +---> LLM 분석 (OpenAI)
    |       └--> LangChain 체인
    |       └--> RAG Retriever (vectorstore 검색)
    |       └--> 요약 & 액션 아이템 추출
    |
    +---> 저장 (PostgreSQL)
    |
    +---> 외부 도구 연동 (core/integrations/)
            └--> Jira (이슈 생성)
            └--> Notion (페이지 업로드)
```

---

## 빠른 시작

### 사전 요구사항
- Docker & Docker Compose
- Python 3.11 (로컬 개발용)
- 환경 변수 설정 (OPENAI_API_KEY, DEEPGRAM_API_KEY 등)

### 설치 및 실행

```bash
# 저장소 클론
git clone https://github.com/2025-AISCHOOL-NLP-B/round-note.git
cd round-note

# 환경 변수 설정 (backend/.env)
# DATABASE_URL, REDIS_URL, OPENAI_API_KEY, DEEPGRAM_API_KEY 등 필수

# Docker 서비스 시작
docker-compose up -d

# FastAPI 문서 접속
http://localhost:8000/docs
```

자세한 설정 및 개발 가이드는 [`backend/README.md`](./backend/README.md)를 참고하세요.

---

## 프로젝트 구조

```
round-note/
├── backend/
│   ├── main.py                    # FastAPI 애플리케이션
│   ├── requirements.txt           # Python 의존성
│   ├── docker-compose.yml        # 서비스 정의
│   │
│   ├── api/v1/                   # API 라우터 (endpoints)
│   │   ├── auth/                 # 인증
│   │   ├── meetings/             # 회의 관리
│   │   ├── realtime/             # WebSocket 실시간
│   │   └── reports/              # 보고서/요약 조회
│   │
│   ├── core/                     # 비즈니스 로직 (services)
│   │   ├── auth/                 # JWT 인증
│   │   ├── llm/                  # LLM & LangChain
│   │   ├── stt/                  # Deepgram STT
│   │   ├── storage/              # NCP Object Storage
│   │   └── integrations/         # Jira, Notion
│   │
│   ├── crud/                     # DB CRUD 작업
│   ├── schemas/                  # Pydantic 스키마
│   ├── models.py                 # SQLAlchemy ORM
│   ├── dependencies.py           # 의존성 주입
│   └── alembic/                  # DB 마이그레이션
│
├── frontend/                     # Next.js 프론트엔드
│   ├── src/app/                 # 페이지 (회의 실시간, 대시보드 등)
│   ├── src/features/            # 컴포넌트 (실시간 STT, 액션 아이템 등)
│   └── src/utils/               # 유틸리티 (Supabase, API 호출 등)
│
└── docker-compose.yml           # 전체 서비스 오케스트레이션
```

---

## 개발 가이드

### 아키텍처 패턴

**Endpoints → Service → External API 패턴**
- `api/*/endpoints.py`: HTTP 요청 처리 및 검증
- `core/*/service.py`: 비즈니스 로직 및 I/O
- `dependencies.py`: 클래스 기반 서비스 의존성 주입

예시:
```python
# 의존성 제공자 (dependencies.py)
def get_stt_service() -> STTService:
    return STTService()

# 엔드포인트 (api/v1/realtime/endpoints.py)
@router.websocket("/ws")
async def websocket_endpoint(
    stt_service: STTService = Depends(get_stt_service)
):
    # stt_service 사용
    pass
```

### 커밋 메시지 컨벤션

- `Feat:` 새로운 기능
- `Fix:` 버그 수정
- `Refactor:` 코드 리팩토링
- `Docs:` 문서 수정

---

## 기술 스택

### 백엔드
- **Framework**: FastAPI (async/await 기반)
- **Database**: PostgreSQL (ORM: SQLAlchemy)
- **Cache/Queue**: Redis + RQ (배치 작업)
- **STT**: Deepgram API (실시간), ElevenLabs (배치)
- **LLM**: OpenAI GPT-4, LangChain/RAG
- **Storage**: NCP Object Storage
- **Authentication**: JWT + bcrypt
- **Container**: Docker & Docker Compose

### 프론트엔드
- **Framework**: Next.js 14+ (React 18)
- **Styling**: TailwindCSS
- **Real-time**: WebSocket (native)
- **State**: React Hooks
- **UI Components**: Radix UI

### 배포
- **CI/CD**: GitHub Actions
- **Hosting**: Docker (개발) / ECS/K8s (프로덕션 예상)

---

## 주요 엔드포인트

### 인증
```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
GET    /api/v1/auth/me
```

### 회의
```
GET    /api/v1/meetings
POST   /api/v1/meetings
GET    /api/v1/meetings/{id}
```

### 실시간 WebSocket
```
WS     /api/v1/realtime/ws
```

### 보고서/요약
```
GET    /api/v1/reports/{meeting_id}/summary
GET    /api/v1/reports/{meeting_id}/action-items
POST   /api/v1/reports/{meeting_id}/action-items/to-jira
POST   /api/v1/reports/{meeting_id}/report/to-notion
```

---

## 배포 전략

### 개발 vs 배포 환경

| 환경 | Frontend | Backend | DB | Redis | Object Storage |
|------|----------|---------|-----|-------|----------------|
| **로컬 개발** | localhost:3000 | localhost:8000 | Docker (local) | Docker (local) | NCP (VPC 테스트) |
| **프로덕션** | Render | **NCP Compute** | **NCP Compute (Docker)** | **NCP Compute (Docker)** | **NCP (VPC 전용)** |

**주요 변경**: Render 대신 NCP Compute로 전환하여 VPC 전용 Object Storage 사용 가능

## 로컬 개발

### 환경 설정

```bash
cd backend

# Python 3.11 설치
winget install Python.Python.3.11

# 가상 환경
python -m venv .venv
.venv\Scripts\activate

# 의존성
pip install -r requirements.txt
```

### 환경 변수 (로컬)

`backend/.env` 파일 생성:

```env
# Database & Cache
DATABASE_URL=postgresql://roundnote_user:roundnote_password@db:5432/roundnote_db
REDIS_URL=redis://redis:6379

# External APIs
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...

# NCP Object Storage
NCP_ENDPOINT_URL=https://kr.object.ncloudstorage.com
NCP_BUCKET_NAME=roundnote-bucket
NCP_ACCESS_KEY=ncp_xxx
NCP_SECRET_KEY=ncp_xxx

# CORS
CORS_ORIGIN_LOCAL=http://localhost:3000
CORS_ORIGIN=https://round-note-web.onrender.com

# JWT
JWT_SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
```

### Docker로 실행 (로컬)

```bash
# 프로젝트 루트에서
docker-compose up -d

# 서비스 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs -f backend

# FastAPI 문서 접속
http://localhost:8000/docs
```

## NCP Compute 배포 (프로덕션)

### 1단계: NCP Compute 인스턴스 생성

- **OS**: Ubuntu 20.04 LTS
- **사양**: 2vCPU, 4GB RAM (최소)
- **VPC**: 기존 VPC 선택 (Object Storage와 동일)
- **Public IP**: 할당 필수 (SSH 접속용)

### 2단계: Compute 내에 Docker 설치

```bash
# SSH로 접속 후
sudo apt update && sudo apt upgrade -y

# Docker 설치
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Docker Compose 설치
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 버전 확인
docker --version && docker-compose --version
```

### 3단계: 코드 배포

```bash
git clone https://github.com/2025-AISCHOOL-NLP-B/round-note.git
cd round-note
```

### 4단계: 환경 변수 설정 (NCP)

`backend/.env` 파일 생성:

```bash
cat > backend/.env << EOF
# Database & Cache (NCP VPC 내부)
DATABASE_URL=postgresql://roundnote_user:roundnote_password@db:5432/roundnote_db
REDIS_URL=redis://redis:6379

# External APIs
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...

# NCP Object Storage (VPC 전용)
NCP_ENDPOINT_URL=https://kr.object.ncloudstorage.com
NCP_BUCKET_NAME=roundnote-bucket
NCP_ACCESS_KEY=ncp_xxx
NCP_SECRET_KEY=ncp_xxx

# CORS (Render 프론트)
CORS_ORIGIN=https://round-note-web.onrender.com

# JWT
JWT_SECRET_KEY=your-production-secret-key
JWT_ALGORITHM=HS256
EOF
```

### 5단계: Docker Compose 실행

```bash
docker-compose up -d

# 서비스 상태 확인
docker-compose ps

# 로그 확인
docker-compose logs -f backend

# 헬스 체크
curl http://localhost:8000/api/v1/health-check
```

### 6단계: NCP 보안 그룹 설정

**인바운드 규칙:**
- SSH (22): 본인 IP만 허용
- Backend API (8000): Render 또는 특정 IP에서만

**아웃바운드 규칙:**
- 모든 트래픽 허용 (외부 API 호출용)

### 7단계: Frontend 환경변수 (Render)

Render 대시보드 → Environment variables 추가:

```bash
REACT_APP_API_URL=http://<Ncp-Compute-PUBLIC-IP>:8000
```

Frontend 코드 (src/utils/api.ts):

```typescript
const API_URL = process.env.REACT_APP_API_URL || "http://localhost:8000";
```

---

## 개발 진도

### 구현된 기능 ✓
- FastAPI 서버 구조 및 라우터
- WebSocket 실시간 STT (Deepgram)
- STTService, LLMService 클래스 기반 서비스
- 의존성 주입 (Depends 패턴)
- Jira/Notion 통합 서비스 (템플릿)
- PostgreSQL + SQLAlchemy ORM

### 진행 중 기능
- LangChain + RAG 파이프라인 구현
- Reports 서비스 함수 (get_summary, regenerate_summary)
- 배치 오디오 처리 (ElevenLabs)
- 통합 테스트 및 CI/CD

### 계획 중 기능
- 프론트엔드 대시보드 (실시간 자막, 액션 아이템 패널)
- 유저 프로필 및 권한 관리
- 회의 분석 리포트 (기간별 통계)
- 모바일 앱 (PWA/RN)

---

## 참고 자료

- [FastAPI 공식 문서](https://fastapi.tiangolo.com/)
- [LangChain 문서](https://python.langchain.com/docs/)
- [Deepgram STT API](https://developers.deepgram.com/)
- [Jira REST API](https://developer.atlassian.com/cloud/jira/rest/)
- [Notion API](https://developers.notion.com/)

---

## 라이센스

MIT License

## 연락처

- **팀장**: 권현재 (hyeonjae3575@gmail.com)
- **백엔드 리드**: 김기찬 (emyoung611@gmail.com)

---

**마지막 업데이트**: 2025-11-17  
**상태**: Active Development
