import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
import psycopg
import redis
from botocore.client import Config
from redis import Redis
import boto3
from dotenv import load_dotenv
from pathlib import Path

from backend.api.v1.health_check.endpoints import router as health_router
from backend.api.v1.auth.endpoints import router as auth_router
from backend.api.v1.meetings.endpoints import router as meetings_router
from backend.api.v1.realtime.endpoints import router as realtime_router
from backend.api.v1.reports.endpoints import router as reports_router
from backend.api.v1.chatbot.endpoints import router as chatbot_router
from backend.api.v1.settings.endpoints import router as settings_router

# backend/.env 파일 명시적으로 로드
# Docker 환경에서는 이미 환경 변수가 설정되어 있으므로 override=False 사용
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path, override=False)

# 1. FastAPI 앱 생성 및 설정
app = FastAPI()

# 세션 미들웨어 추가 (Google OAuth에 필요)
app.add_middleware(SessionMiddleware, secret_key=os.getenv("SECRET_KEY", "your-secret-key-here"))

# 2. CORS 설정
origins = [
    os.environ.get("CORS_ORIGIN_LOCAL", "http://localhost:3000"),  # 로컬 개발 환경
]

# 배포 환경의 CORS_ORIGIN이 설정되어 있으면 추가
cors_origin = os.environ.get("CORS_ORIGIN")
if cors_origin:
    origins.append(cors_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. API 라우터 포함
app.include_router(health_router, prefix="/api/v1/health-check", tags=["Health"])
app.include_router(auth_router, prefix="/api/v1/auth", tags=["Auth"])
app.include_router(meetings_router, prefix="/api/v1/meetings", tags=["Meetings"])
app.include_router(realtime_router, prefix="/api/v1/realtime", tags=["Realtime"])
app.include_router(reports_router, prefix="/api/v1", tags=["Reports"])
app.include_router(chatbot_router, prefix="/api/v1/chatbot", tags=["Chatbot"])
app.include_router(settings_router, prefix="/api/v1", tags=["Settings"])

@app.get("/")
def read_root():
    return {"Hello": "FastAPI is running!"}