#!/bin/bash
set -e

# 현재 디렉토리 출력 (디버깅용)
echo "Current directory: $(pwd)"
echo "Files in current directory:"
ls -la

# 환경 변수 설정
export PYTHONPATH=/app:$PYTHONPATH

# DB 마이그레이션
echo "=========================================="
echo "🗄️  Running database migrations..."
echo "=========================================="
alembic upgrade head

# API와 Worker를 동시에 실행
echo ""
echo "=========================================="
echo "🚀 Starting API server..."
echo "=========================================="
python -m uvicorn main:app --host 0.0.0.0 --port 10000 \
  --log-level info &
API_PID=$!
echo "✅ API started with PID: $API_PID"

# API가 시작될 때까지 대기
echo ""
echo "=========================================="
echo "⏳ Waiting for API to start..."
echo "=========================================="
RETRY_COUNT=0
MAX_RETRIES=30
while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
  if curl -s http://localhost:10000/api/v1/health-check > /dev/null 2>&1; then
    echo "✅ API is ready!"
    break
  fi
  RETRY_COUNT=$((RETRY_COUNT + 1))
  echo "   Attempt $RETRY_COUNT/$MAX_RETRIES..."
  sleep 1
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
  echo "⚠️  API did not start within timeout, but continuing..."
fi

echo ""
echo "=========================================="
echo "👷 Starting RQ Worker..."
echo "=========================================="
python worker.py &
WORKER_PID=$!
echo "✅ Worker started with PID: $WORKER_PID"

echo ""
echo "=========================================="
echo "✅ Both services running"
echo "=========================================="
echo "API PID: $API_PID"
echo "Worker PID: $WORKER_PID"
echo "=========================================="

# 모든 백그라운드 프로세스 모니터링
trap "echo 'Shutting down...'; kill $API_PID $WORKER_PID 2>/dev/null || true" SIGTERM SIGINT

# 프로세스 중 하나라도 종료되면 전체 종료
wait -n
EXIT_CODE=$?
echo ""
echo "⚠️  Process exited with code: $EXIT_CODE"
kill $API_PID $WORKER_PID 2>/dev/null || true
exit $EXIT_CODE
