from typing import Optional, Dict, Any
import os
from dotenv import load_dotenv
from backend.core.utils.logger import setup_logger
from backend.core.utils.retry_config import api_retry_stt
from backend.core.utils.error_responses import ErrorMessages, ErrorResponse
from tenacity import RetryError

load_dotenv()

# Setup logger for this service
logger = setup_logger(__name__)

class STTService:
    """STT ?�비?? Deepgram ?�결 ?�보 관�?�?배치 STT 처리�??�당?�니??"""
    
    def __init__(self):
        logger.info("Initializing STTService", extra={"service": "stt"})
        
        self.DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
        if not self.DEEPGRAM_API_KEY:
            logger.error("DEEPGRAM_API_KEY not set", extra={"service": "stt"})
            raise ValueError("DEEPGRAM_API_KEY 환경 변수가 설정되지 않았습니다.")

        self.DEEPGRAM_BASE_URL = "wss://api.deepgram.com/v1/listen"
        self.DEEPGRAM_PARAMS = (
            # "?punctuate=true"  # 구두??추�?
            "?language=ko"     # ?�국??지??
            "&model=nova-2"    # 최신 고성??모델
            "&diarize=true"    # ?�자 분리 (Pass 1 ?�심 기능)
            "&encoding=linear16" # ?�디???�코???�식
            "&sample_rate=16000" # ?�디???�플�??�도 (마이???�일 ?��?)
            "&smart_format=true" # ?�마???�맷??(?�자, ?�짜 ??
            # "&channel=1"        # ?�일 채널 ?�디??
            # "&endpointer=true" # ?�성 ?�동 감�?(?�택 ?�항, ?�요 ???�성??
        )
        
        logger.info("STTService initialized successfully", extra={
            "service": "stt",
            "model": "nova-2",
            "language": "ko",
            "diarization_enabled": True
        })
        
        # TODO: (팀원 B) ElevenLabs 클라이언트 초기화 (배치 STT용)
    
    @api_retry_stt
    def get_realtime_stt_url(self) -> tuple[str, dict]:
        """
        FastAPI가 Deepgram WebSocket에 연결하는 데 필요한 URL과 헤더를 반환합니다.
        
        자동 재시도: 네트워크 오류 시 최대 3회 재시도
        """
        logger.debug("Generating Deepgram WebSocket URL", extra={"service": "stt"})
            
        full_url = self.DEEPGRAM_BASE_URL + self.DEEPGRAM_PARAMS
        headers = {"Authorization": f"Token {self.DEEPGRAM_API_KEY}"}
        
        logger.debug("WebSocket URL generated", extra={
            "service": "stt",
            "url": self.DEEPGRAM_BASE_URL  # Don't log full URL with params for security
        })
        
        return full_url, headers
    
    def get_realtime_stt_url_with_fallback(self) -> Dict[str, Any]:
        """
        Fallback wrapper for get_realtime_stt_url with user-friendly error handling
        
        Returns:
            Success: {"success": True, "url": str, "headers": dict}
            Failure: {"success": False, "message": str}
        """
        try:
            url, headers = self.get_realtime_stt_url()
            return {
                "success": True,
                "url": url,
                "headers": headers
            }
        except RetryError as e:
            # All retries exhausted
            logger.error("All STT URL generation retries exhausted", extra={
                "service": "stt",
                "error": str(e)
            }, exc_info=True)
            return ErrorResponse.create(
                success=False,
                message=ErrorMessages.STT_SERVICE_UNAVAILABLE,
                error_code="STT_001"
            )
        except Exception as e:
            # Unexpected error
            logger.error("Unexpected STT error", extra={
                "service": "stt",
                "error": str(e)
            }, exc_info=True)
            return ErrorResponse.create(
                success=False,
                message=ErrorMessages.STT_SERVICE_UNAVAILABLE,
                error_code="STT_999"
            )
