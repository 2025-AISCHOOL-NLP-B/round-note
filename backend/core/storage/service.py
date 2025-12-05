import os
import asyncio
import wave
import ulid
import logging
from wave import Wave_write
from botocore.client import Config 
import boto3
from botocore.exceptions import ClientError
from typing import AsyncGenerator
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s")

class StorageService:
    """오디오 파일의 저장, 로드, 경로 관리를 담당합니다."""

    def __init__(self):
        # Docker 환경에서는 /app/audio_storage, 로컬에서는 ./audio_storage 사용
        self.local_storage_path = "/app/audio_storage" if os.path.exists("/app/audio_storage") else "./audio_storage"
        
        self.ncp_endpoint_url = os.getenv("NCP_ENDPOINT_URL")
        self.ncp_access_key = os.getenv("NCP_ACCESS_KEY")
        self.ncp_secret_key = os.getenv("NCP_SECRET_KEY")
        self.ncp_bucket_name = os.getenv("NCP_BUCKET_NAME")
        self.ncp_region = os.getenv("NCP_REGION", "kr-standard")
        
        if not all([self.ncp_endpoint_url, self.ncp_access_key, self.ncp_secret_key, self.ncp_bucket_name]):
            logging.warning("NCP Object Storage 환경 변수가 완전히 설정되지 않았습니다. 업로드 기능이 작동하지 않을 수 있습니다.")
            self.s3 = None
        else:
            try:
                self.s3 = boto3.client(
                    's3',
                    endpoint_url=self.ncp_endpoint_url,
                    aws_access_key_id=self.ncp_access_key,
                    aws_secret_access_key=self.ncp_secret_key,
                    region_name=self.ncp_region,
                    config=Config(signature_version='s3v4')
                )
                logging.warning(f"USING ENDPOINT: {self.s3.meta.endpoint_url}")
                logging.info("NCP Object Storage 클라이언트 초기화 성공.")
            except Exception as e:
                logging.error(f"NCP Object Storage 클라이언트 초기화 실패: {e}")
                self.s3 = None


    # 로컬 파일 생성 및 wave.open 관리를 책임집니다.
    def create_local_wave_file(self, meeting_id: str = None, channels: int = 2, sample_rate: int = 16000) -> tuple[wave.Wave_write, str]:
        """로컬 오디오 파일을 생성하고 파일 핸들(wave.Wave_write)과 경로를 반환합니다."""
        if meeting_id is None:
            meeting_id = str(ulid.new())
            
        os.makedirs(self.local_storage_path, exist_ok=True)
        file_path = os.path.join(self.local_storage_path, f"{meeting_id}.wav")
        
        wave_file = wave.open(file_path, 'wb')
        # 프론트엔드에서 전송된 채널 수와 샘플레이트에 맞춰 동적 설정
        wave_file.setnchannels(channels)
        wave_file.setsampwidth(2)
        wave_file.setframerate(sample_rate)
        logging.info(f"로컬 오디오 저장 시작: {file_path} (Channels: {channels}, Rate: {sample_rate}Hz)")
        return wave_file, file_path

    # 동기 함수인 writeframes를 to_thread로 감싸는 헬퍼 함수
    async def write_audio_chunk(self, wave_file: wave.Wave_write, audio_data: bytes):
        """오디오 청크를 파일에 비동기로 기록합니다."""
        import struct
        
        file_channels = wave_file.getnchannels()
        data_length = len(audio_data)
        
        # 첫 청크에서만 디버그 로그
        if not hasattr(self, '_first_chunk_logged'):
            self._first_chunk_logged = True
            logging.info(f"[StorageService] 오디오 스트리밍 시작 - 채널: {file_channels}, 청크크기: {data_length}bytes")
        
        # Mono 파일: 데이터를 그대로 저장 (변환 없음)
        # Stereo 파일: 데이터를 그대로 저장 (변환 없음)
        # 프론트엔드가 올바른 형식으로 전송한다고 가정
        if file_channels == 2:
            # Stereo 파일이면 변환 없이 그대로 저장
            if not hasattr(self, '_stereo_file_logged'):
                self._stereo_file_logged = True
                logging.info(f"[StorageService] Stereo 파일 - 변환 없이 저장. 데이터크기: {data_length}bytes")
                
        await asyncio.to_thread(wave_file.writeframes, audio_data)

    # wave.close() 역시 비동기로 처리
    async def close_wave_file(self, wave_file: wave.Wave_write):
        """오디오 파일 핸들을 비동기로 닫습니다."""
        await asyncio.to_thread(wave_file.close)
    
    
    
    async def upload_to_ncp_object_stroage(self, local_path: str, meeting_id: str) -> str:
        """
        로컬에 저장된 오디오 파일을 NCP Object Storage에 업로드하고,
        업로드된 객체의 키를 반환합니다.
        """
        if not self.s3:
            logging.error("NCP Object Storage 클라이언트가 초기화되지 않았습니다.")
            raise Exception("NCP Object Storage client is not initialized.")

        object_name = f"{meeting_id}.wav" # NCP 내 저장될 객체 이름

        try:
            await asyncio.to_thread(
                self.s3.upload_file(local_path, self.ncp_bucket_name, object_name)
            )
            
            logging.info(f"NCP Object Storage 업로드 성공: {local_path} -> {self.ncp_bucket_name}/{object_name}")
            
            # 업로드 후 로컬 파일 삭제
            try:
                await asyncio.to_thread(os.remove, local_path)
                logging.info(f"삭제된 로컬 파일: {local_path}")
            except Exception as e:
                logging.warning(f"로컬 파일 삭제 실패: {e}")

            return object_name

        except ClientError as e:
            logging.error(f"NCP Object Storage 업로드 실패: {e}")
            raise e
        except Exception as e:
            logging.error(f"NCP Object Storage 알 수 없는 오류: {e}")
            raise e
    
    def download_from_ncp(self, object_name: str, local_path: str) -> bool:
        """
        NCP Object Storage에서 파일을 다운로드합니다.
        
        Args:
            object_name: NCP에 저장된 객체 이름 (예: meeting_id.wav)
            local_path: 다운로드할 로컬 경로
            
        Returns:
            성공 시 True, 실패 시 False
        """
        if not self.s3:
            logging.error("NCP Object Storage 클라이언트가 초기화되지 않았습니다.")
            return False
        
        try:
            # 디렉토리 생성
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            
            self.s3.download_file(self.ncp_bucket_name, object_name, local_path)
            logging.info(f"✅ NCP에서 다운로드 성공: {self.ncp_bucket_name}/{object_name} -> {local_path}")
            return True
        except ClientError as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown')
            if error_code == 'NoSuchKey' or error_code == '404':
                logging.warning(f"⚠️ NCP에 파일이 없음: {object_name}")
            else:
                logging.error(f"❌ NCP 다운로드 실패: {e}")
            return False
        except Exception as e:
            logging.error(f"❌ NCP 다운로드 중 알 수 없는 오류: {e}")
            return False