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
    """STT Service: Manages Deepgram connection info and handles batch STT processing."""
    
    def __init__(self):
        logger.info("Initializing STTService", extra={"service": "stt"})
        
        self.DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
        if not self.DEEPGRAM_API_KEY:
            logger.error("DEEPGRAM_API_KEY not set", extra={"service": "stt"})
            raise ValueError("DEEPGRAM_API_KEY environment variable is not set.")

        self.DEEPGRAM_BASE_URL = "wss://api.deepgram.com/v1/listen"
        self.DEEPGRAM_PARAMS = (
            # "?punctuate=true"  # Add punctuation
            "?language=ko"     # Support Korean
            "&model=nova-2"    # Latest high-performance model
            "&diarize=true"    # Speaker diarization
            "&encoding=linear16" # Audio encoding format
            "&sample_rate=16000" # Audio sample rate (matches microphone)
            "&smart_format=true" # Smart formatting (dates, times, etc.)
            "&multichannel=true" # Enable multichannel
            # "&channels=2"      # Dynamic configuration via method argument
            # "&endpointer=true" # Voice activity detection
        )
        
        logger.info("STTService initialized successfully", extra={
            "service": "stt",
            "model": "nova-2",
            "language": "ko",
            "diarization_enabled": True
        })
        
        # TODO: (Team Member B) Initialize ElevenLabs client (for batch STT)
    
    @api_retry_stt
    def get_realtime_stt_url(self, channels: int = 1, sample_rate: int = 16000, keywords: list[str] = None) -> tuple[str, dict]:
        """
        Returns the URL and headers required for FastAPI to connect to the Deepgram WebSocket.
        
        Auto-retry: Retries up to 3 times on network errors.
        """
        logger.debug(f"Generating Deepgram WebSocket URL (Channels: {channels}, SampleRate: {sample_rate}Hz, Keywords: {keywords})", extra={"service": "stt"})
            
        # 동적으로 채널 수와 샘플레이트 설정
        # DEEPGRAM_PARAMS에서 sample_rate=16000 제거하고 동적으로 설정
        params = self.DEEPGRAM_PARAMS.replace("&sample_rate=16000", "") + f"&channels={channels}&sample_rate={sample_rate}"
        

        # 키워드 부스팅 추가 (참여자 이름 등)
        if keywords and len(keywords) > 0:
            # Deepgram 키워드 형식: keywords=키워드1:boost,키워드2:boost
            # boost 값은 -10 ~ 10, 기본적으로 2 사용 (적당히 강조)
            keyword_params = ",".join([f"{kw}:2" for kw in keywords if kw.strip()])
            if keyword_params:
                params += f"&keywords={keyword_params}"
                logger.info(f"Keywords boosting enabled: {keyword_params}", extra={"service": "stt"})
                
        full_url = self.DEEPGRAM_BASE_URL + params
        headers = {"Authorization": f"Token {self.DEEPGRAM_API_KEY}"}
        
        logger.debug("WebSocket URL generated", extra={
            "service": "stt",
            "url": self.DEEPGRAM_BASE_URL,
            "channels": channels,
            "sample_rate": sample_rate
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
