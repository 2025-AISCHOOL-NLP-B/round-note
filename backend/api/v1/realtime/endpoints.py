from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
import asyncio
import websockets
import json
import logging
import wave
import os
import time
import struct
import math

from sqlalchemy.orm import Session
from backend.database import get_db
from backend.crud import meeting as meeting_crud
from backend.dependencies import get_storage_service, get_llm_service, get_stt_service
from backend.core.stt.service import STTService
from backend.core.llm.service import LLMService
from backend.core.storage.service import StorageService

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s")

router = APIRouter()

class TranscribeSettings:
    """번역, 요약 등 실시간 기능 활성화 상태를 저장하는 공유 객체"""
    def __init__(self, translate: bool = False, summary: bool = False, meeting_id: str = None):
        self.translate = translate
        self.summary = summary
        self.is_paused = False  # 일시정지 상태 추가
        self.meeting_id = meeting_id # 회의 ID 저장
        # 채널별 일시정지 상태 (Mic=Left, System=Right)
        self.paused_mic = False
        self.paused_system = False

# 메인 WebSocket 핸들러
@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, 
    db: Session = Depends(get_db),
    storage_service: StorageService = Depends(get_storage_service), 
    stt_service: STTService = Depends(get_stt_service),
    llm_service: LLMService = Depends(get_llm_service),
    translate: bool = True, 
    summary: bool = False,
    channels: int = 1, # 클라이언트로부터 채널 수 요청 받음 (기본 1)
    sampleRate: int = 16000, # 실제 AudioContext 샘플레이트
    meetingId: str = None, # 회의 ID (선택)
    participants: str = None # 참여자 목록 (쉼표 구분, 키워드 부스팅용)
):
    """
    메인 WebSocket 핸들러, 클라이언트와 Deepgram 간의 중계 역할을 합니다.
    """
    await websocket.accept()
    logging.info(f"React <-> FastAPI WebSocket 연결 수립됨. (요청 채널: {channels}, 샘플레이트: {sampleRate}Hz, MeetingID: {meetingId}), Participants: {participants})")
    
    settings = TranscribeSettings(translate=translate, summary=summary, meeting_id=meetingId)
    
    # 요약 관련 공유 상태
    summary_state = {
        "transcript_buffer": [],  # {"text": str, "timestamp": float}
        "previous_summary": "",
        "first_transcript_time": None,
        "last_summary_time": None,
        "sequence": 0,
        "summary_interval": 60.0,  # 60초마다 요약
        "min_text_length": 100  # 최소 텍스트 길이
    }
    
    try:
        # 참여자 이름을 키워드 리스트로 파싱
        keywords = []
        participant_list = []  # 원본 참여자 목록 저장용 (한글 포함)
        if participants:
            # 쉼표로 구분된 이름들을 리스트로 변환
            participant_list = [name.strip() for name in participants.split(",") if name.strip()]
            logging.info(f"[WebSocket] Received participants from URL: {participant_list}")
            
            # Deepgram은 ASCII 문자만 지원하므로, 한글/특수문자 필터링
            # ASCII 문자만 포함된 이름들만 키워드로 사용
            keywords = [name for name in participant_list if all(ord(c) < 128 for c in name)]
            
            if keywords:
                logging.info(f"키워드 부스팅 활성화: {keywords} (ASCII 이름 수: {len(keywords)})")
            if len(keywords) < len(participant_list):
                non_ascii_count = len(participant_list) - len(keywords)
                logging.info(f"비-ASCII 이름 {non_ascii_count}개는 키워드 부스팅에서 제외됨")
        else:
            logging.info(f"[WebSocket] No participants received from URL")
        
        # 요청된 채널 수와 키워드에 맞춰 Deepgram URL 생성
        # keywords가 있으면 자동으로 num_speakers hint가 설정됨
        dg_url, dg_headers = stt_service.get_realtime_stt_url(channels=channels, keywords=keywords)
        
        # meetingId가 있으면 해당 ID로 파일 생성, 없으면 랜덤 생성
        # 파일 생성 시 사용된 ID를 file_id로 저장
        file_id = meetingId
        if file_id:
            wave_file, file_path = storage_service.create_local_wave_file(meeting_id=file_id, channels=channels, sample_rate=sampleRate)
        else:
            # meetingId가 없으면 내부적으로 생성된 ID를 사용해야 함.
            # create_local_wave_file이 ID를 반환하지 않으므로, 미리 생성해서 넘김
            import ulid
            file_id = str(ulid.new())
            wave_file, file_path = storage_service.create_local_wave_file(meeting_id=file_id, channels=channels, sample_rate=sampleRate)
            logging.info(f"Generated temporary file ID: {file_id}")
        
        # 2. Deepgram WebSocket에 연결
        # [Fix] 연결 타임아웃을 30초로 연장하고 핑 설정을 최적화하여 핸드셰이크 실패 방지
        async with websockets.connect(
            dg_url, 
            additional_headers=dg_headers,
            open_timeout=30,
            ping_interval=20, 
            ping_timeout=20
        ) as dg_websocket:
            logging.info(f"Deepgram 연결 성공. 양방향 중계 시작.")

            # 3. 비동기 태스크 생성: React <-> Deepgram 양방향 중계
            #    asyncio.create_task는 즉시 실행되지만 결과를 기다리지 않습니다.
            forward_task = asyncio.create_task(
                handle_client_uplink(websocket, dg_websocket, settings, wave_file, storage_service)
            )
            receive_task = asyncio.create_task(
                forward_to_client(websocket, dg_websocket, settings, llm_service, summary_state)
            )
            
            # 요약 태스크 (summary 플래그가 True일 때만 시작)
            summary_task = None
            if settings.summary:
                summary_task = asyncio.create_task(
                    periodic_summary_task(websocket, settings, llm_service, summary_state)
                )
                logging.info("타임라인 요약 태스크 시작됨")
            
            # 4. 모든 태스크 중 하나가 끝날 때까지 대기
            tasks = [forward_task, receive_task]
            if summary_task:
                tasks.append(summary_task)
            
            done, pending = await asyncio.wait(
                tasks,
                return_when=asyncio.FIRST_COMPLETED
            )
            
            for task in pending:
                task.cancel()
                # 취소가 완료될 때까지 잠시 대기
                try:
                    await task
                except asyncio.CancelledError:
                    pass

    except WebSocketDisconnect:
        # 5. React가 연결을 끊었을 때
        logging.info("React 클라이언트 연결 종료 (정상)")
    except Exception as e:
        # 6. Deepgram 연결 실패 등 오류 발생 시
        logging.error(f"WebSocket 파이프라인 오류: {e}")
        await websocket.send_json({"type": "error", "message": f"서버 오류: {e}"})
    finally:
        if wave_file:
            try:
                # [Fix] 파일 닫기는 동기적으로 수행하여 헤더(RIFF) 기록 및 버퍼 플러시를 확실하게 보장
                # 비동기(to_thread)로 처리 시 이벤트 루프 종료와 겹쳐 파일이 깨질 수 있음
                wave_file.close()
                logging.info(f"🔴 WebSocket 핸들러 종료 및 파일 저장 완료: {file_path}")
                
                # 최종 Meeting ID 확인 (settings.meeting_id가 업데이트 되었을 수 있음)
                final_meeting_id = settings.meeting_id if settings.meeting_id else file_id
                
                # 파일 이름 변경 로직 (임시 ID -> 실제 Meeting ID)
                if final_meeting_id != file_id:
                    try:
                        dir_name = os.path.dirname(file_path)
                        new_file_path = os.path.join(dir_name, f"{final_meeting_id}.wav")
                        
                        # 파일 이름 변경
                        if os.path.exists(file_path):
                            os.rename(file_path, new_file_path)
                            logging.info(f"Renamed audio file: {file_path} -> {new_file_path}")
                            file_path = new_file_path # 경로 업데이트
                        else:
                            logging.warning(f"Original file not found for rename: {file_path}")
                            
                    except Exception as e:
                        logging.error(f"Failed to rename audio file: {e}")

                # DB Update: meetingId가 있으면 오디오 경로 및 참여자 정보 업데이트
                if final_meeting_id:
                    try:
                        # Use relative path for portability
                        relative_path = f"./audio_storage/{os.path.basename(file_path)}"
                        
                        # We need to run sync DB operation in async context
                        def update_db():
                            meeting = meeting_crud.get_meeting(db, final_meeting_id)
                            if meeting:
                                meeting.AUDIO_URL = relative_path
                                meeting.LOCATION = relative_path
                                
                                # 참여자 목록을 PARTICIPANTS 필드에 저장 (원본 목록 사용: 한글 포함)
                                if participant_list:
                                    meeting.PARTICIPANTS = participant_list
                                    logging.info(f"[WebSocket] ✅ Updated meeting {final_meeting_id} PARTICIPANTS field: {participant_list}")
                                else:
                                    logging.info(f"[WebSocket] ⚠️ No participant_list to save for meeting {final_meeting_id}")
                                
                                db.commit()
                                logging.info(f"Updated meeting {final_meeting_id} audio_url to {relative_path}")
                            else:
                                logging.warning(f"Meeting {final_meeting_id} not found for audio update")
                        
                        await asyncio.to_thread(update_db)
                    except Exception as e:
                        logging.error(f"Failed to update meeting audio URL: {e}")

                # try:
                #     logging.info("NCP Object Storage 업로드 시작...")
                #     objecct_key = await storage_service.upload_to_ncp_object_stroage(file_path, meeting_id=os.path.basename(file_path).split('.')[0])
                #     logging.info(f"NCP Object Storage 업로드 완료. 객체 키: {objecct_key}")
                    
                #     # TODO: 업로드된 객체 키를 DB에 저장하는 로직 추가
                #     # TODO: RQ에 작업 큐잉 ex) await redis_queue.enqueue("process_batch_transcription", meeting_id, object_key)
                    
                # except Exception as e:
                #     logging.error(f"❌ NCP Object Storage 업로드 실패: {e}")
                    
            except Exception as e:
                logging.error(f"❌ wave_file 닫기 실패: {e}")
                
        else:
            logging.info(f"🔴 WebSocket 핸들러 종료 (파일 객체 없음)")



async def handle_client_uplink(
    client_ws: WebSocket, dg_ws: websockets.WebSocketClientProtocol, 
    settings: TranscribeSettings, wave_file: wave.Wave_write, 
    stoage_service: StorageService
    ):
    """
    React로부터 오디오 청크(bytes)와 제어 메시지(JSON/text)를 모두 받아 처리합니다.
    """
    logging.info("Uplink Handler: 오디오 및 제어 메시지 수신 시작.")
    
    chunk_count = 0
    
    try:
        while True:
            # 1. [핵심] bytes, text 등 모든 유형의 메시지를 수신 (논블로킹 await)
            message = await client_ws.receive()

            # WebSocket 연결이 끊긴 경우 체크
            if message.get("type") == "websocket.disconnect":
                logging.info("Uplink Handler: 클라이언트 연결 정상 종료 감지.")
                break

            # 2. bytes (오디오 데이터): Deepgram으로 즉시 중계
            if message.get("bytes"):
                audio_data = message["bytes"]
                
                if len(audio_data) > 0:
                    chunk_count += 1
                    
                    # [Debug] 오디오 데이터 분석 (RMS 계산) - 50번째 청크마다 또는 데이터가 클 때
                    if chunk_count % 50 == 0:
                        try:
                            # Int16 Stereo (2 bytes per sample, 2 channels)
                            # L, R, L, R ...
                            count = len(audio_data) // 2
                            shorts = struct.unpack(f"<{count}h", audio_data)
                            
                            left_sum_sq = 0
                            right_sum_sq = 0
                            samples = count // 2
                            
                            for i in range(samples):
                                l = shorts[i*2]
                                r = shorts[i*2+1]
                                left_sum_sq += l * l
                                right_sum_sq += r * r
                                
                            left_rms = math.sqrt(left_sum_sq / samples) if samples > 0 else 0
                            right_rms = math.sqrt(right_sum_sq / samples) if samples > 0 else 0
                            
                            logging.info(f"[AudioCheck] Chunk #{chunk_count}: Size={len(audio_data)} bytes. RMS(L)={left_rms:.2f}, RMS(R)={right_rms:.2f}")
                            
                            if right_rms == 0:
                                logging.warning(f"[AudioCheck] ⚠️ Right Channel (System) is SILENT.")
                            elif right_rms > 0:
                                logging.info(f"[AudioCheck] ✅ Right Channel (System) has signal.")
                                
                        except Exception as e:
                            logging.error(f"[AudioCheck] Error analyzing audio chunk: {e}")

                    await dg_ws.send(audio_data)
                    
                    # 일시정지 상태가 아닐 때만 파일에 저장
                    if not settings.is_paused:
                        try:
                            # [Debug] 저장되는 오디오 데이터 크기 확인 (Stereo라면 16kHz * 2ch * 2bytes = 64000 bytes/sec)
                            # 1초에 약 15~16번 전송되므로, 청크당 약 4096 bytes 정도여야 함 (Mono면 2048)
                            # 하지만 프론트엔드 버퍼가 4096 샘플이면: 4096 * 2ch * 2bytes = 16384 bytes
                            if len(audio_data) > 10000: # 큰 청크만 로그 (너무 자주 찍히지 않게)
                                logging.debug(f"Writing audio chunk: {len(audio_data)} bytes")
                                
                            await stoage_service.write_audio_chunk(wave_file, audio_data)
                        except Exception as e:
                            logging.warning(f"⚠️ 오디오 청크 로컬 쓰기 실패: {str(e)}")
                    else:
                        logging.debug("일시정지 중이므로 파일 저장 스킵")
                else:
                    logging.debug("UPLINK RECEIVED: 0 bytes. Skipping forward.")

            elif message.get("text"):
                # 3. text (제어 메시지): JSON으로 파싱하여 설정 변경
                try:
                    control_msg = json.loads(message["text"])
                    command = control_msg.get("command")
                    value = control_msg.get("value")
                    
                    if command == "SET_TRANSLATE" and isinstance(value, bool):
                        settings.translate = value # 공유 상태 업데이트
                        logging.info(f"--> [CONTROL] 번역 기능 상태 변경: {value}")
                        # 클라이언트에게 설정이 바뀌었음을 알리는 피드백 (선택적)
                        await client_ws.send_json({"type": "setting_update", "translate": value})
                    
                    elif command == "SET_PAUSED" and isinstance(value, bool):
                        settings.is_paused = value # 일시정지 상태 업데이트
                        logging.info(f"--> [CONTROL] 일시정지 상태 변경: {value} ({'일시정지' if value else '재개'})")
                        # 클라이언트에게 설정이 바뀌었음을 알리는 피드백 (선택적)
                        await client_ws.send_json({"type": "setting_update", "paused": value})
                    elif command == "SET_PAUSED_SYSTEM" and isinstance(value, bool):
                        settings.paused_system = value
                        logging.info(f"--> [CONTROL] 시스템 채널 일시정지 상태 변경: {value}")
                        await client_ws.send_json({"type": "setting_update", "paused_system": value})
                    elif command == "SET_PAUSED_MIC" and isinstance(value, bool):
                        settings.paused_mic = value
                        logging.info(f"--> [CONTROL] 마이크 채널 일시정지 상태 변경: {value}")
                        await client_ws.send_json({"type": "setting_update", "paused_mic": value})
                    
                    elif command == "SET_MEETING_ID" and isinstance(value, str):
                        settings.meeting_id = value
                        logging.info(f"--> [CONTROL] Meeting ID 업데이트: {value}")
                        await client_ws.send_json({"type": "setting_update", "meeting_id": value})
                    
                    # (추후 "SET_SUMMARY" 등 다른 명령어도 여기서 처리)
                        
                except json.JSONDecodeError:
                    logging.error(f"Uplink Handler: 비정상 텍스트 메시지 수신 무시: {message['text']}")
            
    except WebSocketDisconnect:
        logging.info("Uplink Handler: 클라이언트 연결 끊김 감지 (WebSocketDisconnect).")
    except RuntimeError as e:
        # "Cannot call 'receive' once a disconnect message has been received" 에러 처리
        if "disconnect" in str(e).lower():
            logging.info("Uplink Handler: 연결 종료 후 receive 시도 - 정상 종료 처리.")
        else:
            logging.error(f"Uplink Handler 런타임 오류: {e}")
            raise
    except Exception as e:
        logging.error(f"Uplink Handler 오류: {e}")
    finally:
        try:
            await dg_ws.send(json.dumps({"type": "CloseStream"}))
        except Exception:
            pass
        try:
            # 이 시점에 dg_ws가 아직 열려있다면 닫아줍니다.
            await dg_ws.close()
        except Exception:
            pass



async def forward_to_client(
    client_ws: WebSocket, 
    dg_ws: websockets.WebSocketClientProtocol, 
    settings: TranscribeSettings, 
    llm_service: LLMService,
    summary_state: dict
):
    """
    Deepgram(dg_ws)으로부터 전사 결과를 받아 React(client_ws)로 전달하고,
    공유 상태(settings)에 따라 번역 태스크를 생성합니다.
    요약이 활성화된 경우 전사 텍스트를 버퍼에 저장합니다.
    """
    logging.info("DG Receiver: 텍스트 수신 및 중계 시작.")
    try:
        # 1. Deepgram으로부터 메시지를 비동기로 반복 수신 (Async For)
        async for message in dg_ws:
            
            result = json.loads(message)
            
            if result.get("type") == "Metadata" or result.get("type") == "UtteranceEnd":
                logging.debug(f"DG RECEIVER: Skipped Deepgram message type: {result.get('type')}")
                continue
            
            # Deepgram 응답에서 전사 텍스트 추출
            transcript = result.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
            if not transcript:
                continue

            if result.get("is_final"):
                # 2. 최종 텍스트 처리: 화자 정보와 함께 최종 문장 구성
                words = result.get("channel", {}).get("alternatives", [{}])[0].get("words", [])
                speaker_id = words[0].get("speaker") if words else None
                
                # 채널 정보 확인 (0: Mic, 1: System)
                channel_index = result.get("channel_index", [0, 1])[0]

                # 채널별 일시정지 상태에 따른 필터링 (마이크/시스템 각각)
                if (channel_index == 0 and settings.paused_mic) or (channel_index == 1 and settings.paused_system):
                    logging.debug(f"DG RECEIVER: 채널 {channel_index} 일시정지 중 - 최종 전사 무시")
                    continue

                async def emit_segment(segment_speaker, segment_words):
                    reconstructed_text = ""
                    if segment_words:
                        word_texts = [w.get("word") or "" for w in segment_words]
                        reconstructed_text = " ".join(word_texts).strip()

                    segment_text = reconstructed_text if reconstructed_text else transcript
                    if not segment_text:
                        return

                    speaker_tag = ""
                    if segment_speaker is not None:
                        prefix = "System" if channel_index == 1 else "Mic"
                        speaker_tag = f"[{prefix} Speaker {segment_speaker}] "

                    final_text = speaker_tag + segment_text

                    # 3. (React 전송) 최종 전사 텍스트를 React로 전송
                    await client_ws.send_json({"type": "final_transcript", "text": final_text})
                    
                    # 4. 요약 활성화 시 버퍼에 저장
                    if settings.summary and not settings.is_paused:
                        # 채널별 일시정지 상태 확인 후 버퍼 적재
                        if (channel_index == 0 and settings.paused_mic) or (channel_index == 1 and settings.paused_system):
                            logging.debug(f"Summary Buffer: 채널 {channel_index} 일시정지 - 버퍼 적재 스킵")
                        else:
                            current_time = time.time()
                            summary_state["transcript_buffer"].append({
                                "text": final_text,
                                "timestamp": current_time
                            })
                            # 첫 전사 시간 기록
                            if summary_state["first_transcript_time"] is None:
                                summary_state["first_transcript_time"] = current_time
                                logging.info(f"✅ 첫 전사 시간 기록: {current_time}")
                            buffer_count = len(summary_state["transcript_buffer"])
                            logging.info(f"📝 전사 버퍼 추가: 총 {buffer_count}개 항목")
                    
                    # 5. 번역 태스크 생성
                    if settings.translate:
                        # 번역도 채널 일시정지 시 스킵
                        if (channel_index == 0 and settings.paused_mic) or (channel_index == 1 and settings.paused_system):
                            logging.debug(f"Translation Task: 채널 {channel_index} 일시정지 - 번역 스킵")
                        else:
                            asyncio.create_task(
                                get_translation_and_send(client_ws, final_text, llm_service)
                            )

                # speaker change: send previous segment immediately (tiny delay between bursts to avoid UI flood)
                if words:
                    unique_speakers = {w.get("speaker") for w in words}
                    if len(unique_speakers) > 1:
                        current_speaker = words[0].get("speaker")
                        current_words = []
                        delay_between_segments = 0.05  # soften UI burst when multiple bubbles appear
                        i = 0
                        total_words = len(words)
                        while i < total_words:
                            w = words[i]
                            w_speaker = w.get("speaker")
                            if w_speaker == current_speaker:
                                current_words.append(w)
                                i += 1
                                continue

                            # collect contiguous run for new speaker
                            new_speaker = w_speaker
                            new_run = []
                            while i < total_words and words[i].get("speaker") == new_speaker:
                                new_run.append(words[i])
                                i += 1

                            if current_words:
                                await emit_segment(current_speaker, current_words)
                                await asyncio.sleep(delay_between_segments)
                            current_speaker = new_speaker
                            current_words = new_run

                        if current_words:
                            await emit_segment(current_speaker, current_words)
                    else:
                        await emit_segment(speaker_id, words)
                else:
                    await emit_segment(speaker_id, [])
                
            else:
                # 5. 임시 텍스트 처리: React로 임시 전사 텍스트 전송
                channel_index = result.get("channel_index", [0, 1])[0]
                if (channel_index == 0 and settings.paused_mic) or (channel_index == 1 and settings.paused_system):
                    logging.debug(f"DG RECEIVER: 채널 {channel_index} 일시정지 중 - 임시 전사 무시")
                else:
                    await client_ws.send_json({"type": "partial_transcript", "text": transcript})
                
    except WebSocketDisconnect:
        # 이 함수가 종료되면 websocket_endpoint의 gather도 종료됩니다.
        logging.debug("DG Receiver: 클라이언트 연결 끊김 감지.")
    except Exception as e:
        logging.error(f"DG Receiver 오류: {e}")



async def periodic_summary_task(
    client_ws: WebSocket,
    settings: TranscribeSettings,
    llm_service: LLMService,
    summary_state: dict
):
    """
    주기적으로 전사 버퍼를 체크하여 타임라인 요약을 생성합니다.
    10초마다 체크하며, 조건 만족 시 요약을 생성합니다.
    """
    logging.info("🔄 Periodic Summary Task 시작")
    try:
        while True:
            await asyncio.sleep(10)  # 10초마다 체크
            
            # 일시정지 상태면 스킵
            if settings.is_paused:
                logging.debug("⏸️ 일시정지 중 - 요약 스킵")
                continue
            
            # 첫 전사가 없으면 스킵
            if summary_state["first_transcript_time"] is None:
                logging.debug("⏳ 첫 전사 대기 중")
                continue
            
            # 버퍼가 비어있으면 스킵
            if not summary_state["transcript_buffer"]:
                logging.debug("📭 버퍼 비어있음 - 요약 스킵")
                continue
            
            current_time = time.time()
            
            # 마지막 요약 시간 계산
            reference_time = summary_state["last_summary_time"] or summary_state["first_transcript_time"]
            elapsed = current_time - reference_time
            
            logging.info(f"⏱️ 경과시간 체크: {elapsed:.1f}초 / {summary_state['summary_interval']}초")
            
            # 시간 조건과 최소 텍스트 길이 체크
            if elapsed >= summary_state["summary_interval"]:
                buffer_texts = [item["text"] for item in summary_state["transcript_buffer"]]
                total_text = " ".join(buffer_texts)
                
                if len(total_text) >= summary_state["min_text_length"]:
                    logging.info(f"요약 생성 조건 만족: 경과시간={elapsed:.1f}초, 텍스트길이={len(total_text)}자")
                    asyncio.create_task(
                        get_summary_and_send(client_ws, llm_service, summary_state)
                    )
                else:
                    logging.debug(f"텍스트 길이 부족: {len(total_text)}자 < {summary_state['min_text_length']}자")
                    
    except asyncio.CancelledError:
        logging.info("Periodic Summary Task 취소됨")
    except Exception as e:
        logging.error(f"Periodic Summary Task 오류: {e}")


async def get_summary_and_send(
    client_ws: WebSocket,
    llm_service: LLMService,
    summary_state: dict
):
    """
    버퍼의 전사 텍스트를 요약하고 클라이언트에 전송합니다.
    get_translation_and_send()와 동일한 패턴으로 구현되었습니다.
    """
    try:
        # 버퍼에서 텍스트 추출
        buffer_texts = [item["text"] for item in summary_state["transcript_buffer"]]
        
        if not buffer_texts:
            return
        
        # 시퀀스 증가
        summary_state["sequence"] += 1
        sequence = summary_state["sequence"]
        
        # 시간 윈도우 계산
        first_time = summary_state["first_transcript_time"]
        current_time = time.time()
        elapsed_total = current_time - first_time
        
        start_minutes = int((elapsed_total - summary_state["summary_interval"]) // 60) if sequence > 1 else 0
        end_minutes = int(elapsed_total // 60)
        time_window = f"{start_minutes:02d}:{int((elapsed_total - summary_state['summary_interval']) % 60):02d} - {end_minutes:02d}:{int(elapsed_total % 60):02d}"
        
        logging.info(f"요약 생성 시작: 시퀀스={sequence}, 구간={time_window}, 텍스트수={len(buffer_texts)}")

        # 요약 생성 시작 알림
        try:
            await client_ws.send_json({
                "type": "summary_generating",
                "sequence": sequence,
                "time_window": time_window
            })
        except RuntimeError as e:
            if "disconnect" in str(e).lower() or "closed" in str(e).lower():
                logging.info(f"Summary Task: 클라이언트 연결 종료됨 - 알림 전송 스킵")
                return
            else:
                raise

        # LLM 서비스로 요약 생성
        result = await llm_service.generate_timeline_summary(
            texts=buffer_texts,
            previous_summary=summary_state["previous_summary"],
            time_window=time_window
        )

        # 요약 결과 전송
        try:
            await client_ws.send_json({
                "type": "timeline_summary",
                "sequence": sequence,
                "time_window": time_window,
                "content": result["incremental_summary"],
                "rolling_summary": result["rolling_summary"],
                "timestamp": current_time
            })

            # 상태 업데이트
            summary_state["previous_summary"] = result["rolling_summary"]
            summary_state["last_summary_time"] = current_time
            summary_state["transcript_buffer"].clear()

            logging.info(f"요약 생성 완료: 시퀀스={sequence}")

        except RuntimeError as e:
            if "disconnect" in str(e).lower() or "closed" in str(e).lower():
                logging.info(f"Summary Task: 클라이언트 연결 종료됨 - 결과 전송 스킵")
            else:
                raise

    except Exception as e:
        logging.error(f"요약 생성 오류: {e}")
        try:
            await client_ws.send_json({
                "type": "summary_error",
                "message": f"요약 생성 실패: {str(e)}"
            })
        except:
            pass  # 연결이 끊긴 경우 무시


async def get_translation_and_send(client_ws: WebSocket, text: str, llm_service: LLMService):
    """
    Core Service를 호출하여 번역하고 결과를 React로 전송합니다.
    이 함수는 'forward_to_client'에서 asyncio.create_task로 호출됩니다.
    """
    logging.info(f"Translation Task Started for: {text}")
    try:
        # WebSocket 연결 상태 확인
        if client_ws.client_state.name != 'CONNECTED':
            logging.warning(f"WebSocket not connected, skipping translation send")
            return
        
        # 1. core/llm_service.py의 코어 함수 호출 (실제 API 통신)
        translated_text = await llm_service.get_translation(text)

        # 2. 번역 결과를 React로 전송 (논블로킹)
        if client_ws.client_state.name == 'CONNECTED':
          await client_ws.send_json({
              "type": "translation",
              "original_text": text,
              "translated_text": translated_text
          })
        logging.info(f"Translation Task Finished for: {text}")
        
    except Exception as e:
        logging.error(f"OpenAI 번역 오류: {e}")
        # 오류 발생 시 클라이언트에게 알림 (연결 상태 확인 후)
        try:
            if client_ws.client_state.name == 'CONNECTED':
                await client_ws.send_json({"type": "error", "message": f"Translation failed: {e}"})
        except Exception as send_error:
            logging.warning(f"Failed to send error to client: {send_error}")