from typing import Optional
import os
from dotenv import load_dotenv

load_dotenv()

class STTService:
    """STT 서비스: Deepgram 연결 정보 관리 및 배치 STT 처리를 담당합니다."""
    
    def __init__(self):
        
        self.DEEPGRAM_API_KEY = os.environ.get("DEEPGRAM_API_KEY")
        if not self.DEEPGRAM_API_KEY:
            raise ValueError("DEEPGRAM_API_KEY 환경 변수가 설정되지 않았습니다.")

        self.DEEPGRAM_BASE_URL = "wss://api.deepgram.com/v1/listen"
        self.DEEPGRAM_PARAMS = (
            # "?punctuate=true"  # 구두점 추가
            "?language=ko"     # 한국어 지정
            "&model=nova-2"    # 최신 고성능 모델
            "&diarize=true"    # 화자 분리 (Pass 1 핵심 기능)
            "&encoding=linear16" # 오디오 인코딩 형식
            "&sample_rate=16000" # 오디오 샘플링 속도 (마이크/파일 표준)
            "&smart_format=true" # 스마트 포맷팅 (숫자, 날짜 등)
            # "&channel=1"        # 단일 채널 오디오
            # "&endpointer=true" # 음성 활동 감지(선택 사항, 필요 시 활성화)
        )
        
        # TODO: (팀원 B) ElevenLabs 클라이언트 초기화 (배치 STT용)
    
    def get_realtime_stt_url(self) -> tuple[str, dict]:
        """
        FastAPI가 Deepgram WebSocket에 연결하는 데 필요한 URL과 헤더를 반환합니다.
        """
            
        full_url = self.DEEPGRAM_BASE_URL + self.DEEPGRAM_PARAMS
        headers = {"Authorization": f"Token {self.DEEPGRAM_API_KEY}"}
        
        return full_url, headers