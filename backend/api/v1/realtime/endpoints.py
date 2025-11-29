from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
import asyncio
import websockets
import json
import logging
import wave
import os
import time

from backend.dependencies import get_storage_service, get_llm_service, get_stt_service
from backend.core.stt.service import STTService
from backend.core.llm.service import LLMService
from backend.core.storage.service import StorageService

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s")

router = APIRouter()

class TranscribeSettings:
    """번역, 요약 등 실시간 기능 활성화 상태를 저장하는 공유 객체"""
    def __init__(self, translate: bool = False, summary: bool = False):
        self.translate = translate
        self.summary = summary
        self.is_paused = False  # 일시정지 상태 추가
        
# 메인 WebSocket 핸들러
@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, 
    storage_service: StorageService = Depends(get_storage_service), 
    stt_service: STTService = Depends(get_stt_service),
    llm_service: LLMService = Depends(get_llm_service),
    translate: bool = True, 
    summary: bool = False,
    channels: int = 1 # 클라이언트로부터 채널 수 요청 받음 (기본 1)
):
    """
    메인 WebSocket 핸들러, 클라이언트와 Deepgram 간의 중계 역할을 합니다.
    """
    await websocket.accept()
    logging.info(f"React <-> FastAPI WebSocket 연결 수립됨. (요청 채널: {channels})")
    
    settings = TranscribeSettings(translate=translate, summary=summary)
    
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
        # 요청된 채널 수에 맞춰 Deepgram URL 생성
        dg_url, dg_headers = stt_service.get_realtime_stt_url(channels=channels)
        wave_file, file_path = storage_service.create_local_wave_file()
        
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
                await asyncio.to_thread(wave_file.close)
                logging.info(f"🔴 WebSocket 핸들러 종료 및 파일 저장 완료: {file_path}")
                
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
    try:
        while True:
            # 1. [핵심] bytes, text 등 모든 유형의 메시지를 수신 (논블로킹 await)
            message = await client_ws.receive()

            # 2. bytes (오디오 데이터): Deepgram으로 즉시 중계
            if message.get("bytes"):
                audio_data = message["bytes"]
                
                if len(audio_data) > 0:
                    await dg_ws.send(audio_data)
                    
                    # 일시정지 상태가 아닐 때만 파일에 저장
                    if not settings.is_paused:
                        try:
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
                    # (추후 "SET_SUMMARY" 등 다른 명령어도 여기서 처리)
                        
                except json.JSONDecodeError:
                    logging.error(f"Uplink Handler: 비정상 텍스트 메시지 수신 무시: {message['text']}")
            
    except WebSocketDisconnect:
        logging.error("Uplink Handler: 클라이언트 연결 끊김 감지.")
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
            
            # Deepgram 응답에서 전사 텍스트 추출 (로직은 streaming_way_DG.py 재활용)
            transcript = result.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
            if not transcript:
                continue

            if result.get("is_final"):
                # 2. 최종 텍스트 처리: 화자 정보와 함께 최종 문장 구성
                words = result.get("channel", {}).get("alternatives", [{}])[0].get("words", [])
                speaker_id = words[0].get("speaker") if words else None
                
                # 채널 정보 확인 (0: Mic, 1: System)
                channel_index = result.get("channel_index", [0, 1])[0]
                
                if speaker_id is not None:
                    prefix = "System" if channel_index == 1 else "Mic"
                    speaker_tag = f"[{prefix} Speaker {speaker_id}] "
                else:
                    speaker_tag = ""

                final_text = speaker_tag + transcript
                
                # 3. (React 전송) 최종 전사 텍스트를 React로 전송
                await client_ws.send_json({"type": "final_transcript", "text": final_text})
                
                # 4. 요약 활성화 시 버퍼에 저장
                if settings.summary and not settings.is_paused:
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
                    asyncio.create_task(
                        get_translation_and_send(client_ws, final_text, llm_service)
                    )
                
            else:
                # 5. 임시 텍스트 처리: React로 임시 전사 텍스트 전송
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
        await client_ws.send_json({
            "type": "summary_generating",
            "sequence": sequence,
            "time_window": time_window
        })
        
        # LLM 서비스로 요약 생성
        result = await llm_service.generate_timeline_summary(
            texts=buffer_texts,
            previous_summary=summary_state["previous_summary"],
            time_window=time_window
        )
        
        # 요약 결과 전송
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
        
    except Exception as e:
        logging.error(f"요약 생성 오류: {e}")
        await client_ws.send_json({
            "type": "summary_error",
            "message": f"요약 생성 실패: {str(e)}"
        })


async def get_translation_and_send(client_ws: WebSocket, text: str, llm_service: LLMService):
    """
    Core Service를 호출하여 번역하고 결과를 React로 전송합니다.
    이 함수는 'forward_to_client'에서 asyncio.create_task로 호출됩니다.
    """
    logging.info(f"Translation Task Started for: {text}")
    try:
        # 1. core/llm_service.py의 코어 함수 호출 (실제 API 통신)
        translated_text = await llm_service.get_translation(text)
        
        # 2. 번역 결과를 React로 전송 (논블로킹)
        await client_ws.send_json({
            "type": "translation",
            "original_text": text,
            "translated_text": translated_text
        })
        logging.info(f"Translation Task Finished for: {text}")
        
    except Exception as e:
        logging.error(f"OpenAI 번역 오류: {e}")
        # 오류 발생 시 클라이언트에게 알림
        await client_ws.send_json({"type": "error", "message": f"Translation failed: {e}"})