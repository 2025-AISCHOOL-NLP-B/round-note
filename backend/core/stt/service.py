from typing import Optional, Dict, Any, Tuple
import os
from dotenv import load_dotenv
from backend.core.utils.logger import setup_logger
from backend.core.utils.retry_config import api_retry_stt
from backend.core.utils.error_responses import ErrorMessages, ErrorResponse
from tenacity import RetryError
import requests
from requests import Response

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
        
        # Initialize ElevenLabs config (for batch STT)
        self.ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
        self.ELEVENLABS_MOCK_MODE = os.environ.get("ELEVENLABS_MOCK_MODE", "false").lower() == "true"
        if not self.ELEVENLABS_API_KEY and not self.ELEVENLABS_MOCK_MODE:
            logger.warning(
                "ELEVENLABS_API_KEY not set; batch STT disabled",
                extra={"service": "stt"}
            )
        self.ELEVENLABS_TRANSCRIBE_URL = os.environ.get(
            "ELEVENLABS_TRANSCRIBE_URL",
            # Default STT endpoint path; adjust if your org uses a different base
            "https://api.elevenlabs.io/v1/speech-to-text"
        )
    
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

    # Batch STT using ElevenLabs
    @api_retry_stt
    def transcribe_wav(self, file_path: str, language: str = "ko", meeting_start_time=None) -> Tuple[Optional[str], Dict[str, Any]]:
        """
        Transcribe a local .wav file using ElevenLabs batch STT.

        Args:
            file_path: Absolute or workspace-relative path to a .wav file (audio_storage/*.wav expected).
            language: BCP-47 or provider-supported code. Default 'ko'.
            meeting_start_time: Optional datetime of meeting start. If provided, timestamps show actual time.

        Returns:
            (transcript_text, raw_response_dict)
            transcript_text may be None on failure; raw_response_dict includes status and error info.
        """
        # Mock mode for testing without API key
        if self.ELEVENLABS_MOCK_MODE:
            logger.info("ElevenLabs MOCK mode enabled - returning dummy transcript", extra={"service": "stt"})
            mock_text = f"[MOCK] 안녕하세요. 이것은 {os.path.basename(file_path)}에 대한 더미 전사 결과입니다. 실제 ElevenLabs API 키를 설정하면 진짜 전사를 받을 수 있습니다."
            return mock_text, {"success": True, "mock": True}
        
        if not self.ELEVENLABS_API_KEY:
            logger.error("ELEVENLABS_API_KEY missing; cannot run batch STT", extra={"service": "stt"})
            return None, {
                "success": False,
                "message": "ELEVENLABS_API_KEY is not configured",
                "error_code": "STT_EL_001"
            }

        if not file_path.lower().endswith(".wav"):
            logger.error("Batch STT requires .wav input", extra={
                "service": "stt",
                "file_path": file_path
            })
            return None, {
                "success": False,
                "message": "Unsupported audio format. Expected .wav",
                "error_code": "STT_EL_002"
            }

        if not os.path.exists(file_path):
            logger.error("Audio file not found", extra={
                "service": "stt",
                "file_path": file_path
            })
            return None, {
                "success": False,
                "message": "Audio file not found",
                "error_code": "STT_EL_003"
            }

        headers = {
            "xi-api-key": self.ELEVENLABS_API_KEY
        }
        # ElevenLabs STT typically accepts multipart/form-data for file uploads
        files = {
            "file": (os.path.basename(file_path), open(file_path, "rb"), "audio/wav")
        }
        data = {
            "model_id": "scribe_v1",  # ElevenLabs STT model (scribe_v1, scribe_v1_experimental, scribe_v2)
            "language_code": language,  # API expects language_code, not language
            "diarize": "true",  # Enable speaker diarization (required)
            "timestamps_granularity": "word",  # Get word-level timestamps with speaker_id
            "tag_audio_events": "false",
            # "diarization_threshold": "0.1",
            "num_speakers": None,  # Hint for max speakers (optional, helps accuracy)
            # TODO: num_speakers can be set dynamically based on meeting participant count
        }

        try:
            max_attempts = 3
            for attempt in range(1, max_attempts + 1):
                try:
                    logger.info("Calling ElevenLabs batch STT", extra={
                        "service": "stt",
                        "provider": "elevenlabs",
                        "file": os.path.basename(file_path),
                        "attempt": attempt
                    })
                    resp: Response = requests.post(
                        self.ELEVENLABS_TRANSCRIBE_URL,
                        headers=headers,
                        files=files,
                        data=data,
                        timeout=180  # increase read timeout
                    )
                    break
                except requests.exceptions.ReadTimeout as e:
                    if attempt == max_attempts:
                        raise
                    backoff = 2 ** attempt
                    logger.warning(f"ElevenLabs STT timeout, retrying in {backoff}s (attempt {attempt}/{max_attempts})", extra={"service": "stt"})
                    import time
                    time.sleep(backoff)
            raw = {}
            try:
                raw = resp.json()
            except Exception:
                raw = {"status_code": resp.status_code, "text": resp.text}

            if resp.ok:
                # ElevenLabs returns diarization in 'words' array with speaker_id when diarize=true
                # Format: {"text": "...", "words": [{"text": "Hello", "start": 0, "end": 0.5, "speaker_id": "speaker_1"}, ...]}
                words = raw.get("words", [])
                
                if words and any(w.get("speaker_id") for w in words):
                    # Group consecutive words by speaker to form utterances
                    formatted_segments = []
                    current_speaker = None
                    current_text = []
                    current_start = 0.0
                    
                    for word in words:
                        speaker_id = word.get("speaker_id", "speaker_unknown")
                        text = word.get("text", "")
                        start = word.get("start", 0.0)
                        
                        if speaker_id != current_speaker:
                            # New speaker detected, save previous segment
                            if current_speaker and current_text:
                                # Calculate actual time from meeting start
                                if meeting_start_time:
                                    from datetime import timedelta, timezone
                                    actual_time = meeting_start_time + timedelta(seconds=current_start)
                                    # Convert to KST (UTC+9) if timezone-aware
                                    if actual_time.tzinfo is not None:
                                        kst = timezone(timedelta(hours=9))
                                        actual_time = actual_time.astimezone(kst)
                                    timestamp = f"{actual_time.hour:02d}시 {actual_time.minute:02d}분 {actual_time.second:02d}초"
                                else:
                                    # Fallback: elapsed time from audio start
                                    total_seconds = int(current_start)
                                    hours = total_seconds // 3600
                                    minutes = (total_seconds % 3600) // 60
                                    seconds = total_seconds % 60
                                    timestamp = f"{hours:02d}시 {minutes:02d}분 {seconds:02d}초"
                                
                                speaker_label = current_speaker.replace("speaker_", "Speaker ")
                                formatted_segments.append(
                                    f"[{timestamp}] {speaker_label}\n{' '.join(current_text)}"
                                )
                            
                            # Start new segment
                            current_speaker = speaker_id
                            current_text = [text]
                            current_start = start
                        else:
                            # Same speaker, append word
                            current_text.append(text)
                    
                    # Don't forget the last segment
                    if current_speaker and current_text:
                        # Calculate actual time from meeting start
                        if meeting_start_time:
                            from datetime import timedelta, timezone
                            actual_time = meeting_start_time + timedelta(seconds=current_start)
                            # Convert to KST (UTC+9) if timezone-aware
                            if actual_time.tzinfo is not None:
                                kst = timezone(timedelta(hours=9))
                                actual_time = actual_time.astimezone(kst)
                            timestamp = f"{actual_time.hour:02d}시 {actual_time.minute:02d}분 {actual_time.second:02d}초"
                        else:
                            # Fallback: elapsed time from audio start
                            total_seconds = int(current_start)
                            hours = total_seconds // 3600
                            minutes = (total_seconds % 3600) // 60
                            seconds = total_seconds % 60
                            timestamp = f"{hours:02d}시 {minutes:02d}분 {seconds:02d}초"
                        
                        speaker_label = current_speaker.replace("speaker_", "Speaker ")
                        formatted_segments.append(
                            f"[{timestamp}] {speaker_label}\n{' '.join(current_text)}"
                        )
                    
                    transcript = "\n\n".join(formatted_segments)
                    unique_speakers = len(set(w.get("speaker_id") for w in words if w.get("speaker_id")))
                    logger.info(f"ElevenLabs diarization: {len(formatted_segments)} segments from {unique_speakers} speakers", extra={
                        "service": "stt",
                        "segments": len(formatted_segments),
                        "speakers": unique_speakers
                    })
                else:
                    # Fallback to plain text (no diarization)
                    transcript = (
                        raw.get("text") or raw.get("transcript") or raw.get("data", {}).get("text")
                    )
                    if not transcript:
                        logger.warning("ElevenLabs response OK but missing transcript field", extra={
                            "service": "stt",
                            "response_keys": list(raw.keys())
                        })
                
                return transcript, {"success": True, "provider": "elevenlabs", "raw": raw}
            else:
                logger.error("ElevenLabs STT error", extra={
                    "service": "stt",
                    "status_code": resp.status_code,
                    "response": raw
                })
                return None, {
                    "success": False,
                    "message": "ElevenLabs STT request failed",
                    "status_code": resp.status_code,
                    "raw": raw,
                    "error_code": "STT_EL_004"
                }
        except Exception as e:
            logger.error("Unexpected ElevenLabs STT failure", extra={
                "service": "stt",
                "error": str(e)
            }, exc_info=True)
            return None, {
                "success": False,
                "message": "Unexpected error during ElevenLabs STT",
                "error": str(e),
                "error_code": "STT_EL_999"
            }
