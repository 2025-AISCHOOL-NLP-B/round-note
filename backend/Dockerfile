# 1. 베이스 이미지 선택
FROM python:3.11-slim

# 2. Python 환경 변수 설정
# PYTHONDONTWRITEBYTECODE: .pyc 파일 생성 방지
# PYTHONUNBUFFERED: stdout/stderr 버퍼링 비활성화 (로그 실시간 표시)
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# 3. 작업 디렉터리 설정
# 컨테이너 내부의 /app 디렉터리에서 이후 명령을 실행합니다.
WORKDIR /app


# 3. 의존성 설치
# requirements.txt 파일을 컨테이너로 복사합니다.
COPY backend/requirements.txt .

# 빌드 도구를 설치했다가 pip 설치 후 즉시 삭제합니다.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

# 4. 애플리케이션 코드 복사
# 현재 디렉터리(.)의 모든 파일을 컨테이너의 /app 디렉터리로 복사합니다.
COPY backend ./backend

# 5. 애플리케이션 실행
# 컨테이너가 시작될 때 uvicorn을 실행하여 main.py의 app 객체를 
# 0.0.0.0:8000 포트로 서비스합니다. (localhost 대신 0.0.0.0을 사용해야 외부 접근이 가능)
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]