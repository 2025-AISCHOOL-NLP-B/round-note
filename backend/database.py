import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import dotenv
from typing import Generator
from sqlalchemy.orm import Session
from pathlib import Path

# backend/.env 파일 로드 (루트 디렉토리 기준)
# Docker 환경에서는 이미 환경 변수가 설정되어 있으므로 override=False 사용
env_path = Path(__file__).parent / ".env"
dotenv.load_dotenv(dotenv_path=env_path, override=False)

# 1. .env에서 DB URL 로드
DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    raise ValueError("DATABASE_URL 환경 변수가 .env 파일에 설정되지 않았습니다.")

# 2. SQLAlchemy 엔진 생성
engine = create_engine(DATABASE_URL)

# 3. DB 세션 생성자 (SessionLocal) 정의
#    이것이 FastAPI와 Worker에서 사용할 DB 세션입니다.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ===================================================================
# [추가] 4. FastAPI 종속성 주입을 위한 get_db 제너레이터 함수
# ===================================================================
def get_db() -> Generator[Session, None, None]:
    """
    요청마다 독립적인 DB 세션을 생성하고, 요청 완료 후 세션을 닫습니다.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        # DB 세션을 안전하게 닫는 것이 중요합니다.
        db.close()