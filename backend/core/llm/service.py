"""
LLM 서비스: 번역, 요약, 액션 아이템 추출 등 모든 LLM 관련 로직을 담당합니다.

작성자: 정유현
날짜: 2024-11-20
"""

import os
import asyncio
import json
from openai import AsyncOpenAI
from typing import List
from dotenv import load_dotenv

load_dotenv()


class LLMService:
    """LLM 서비스: 번역, 요약, 액션 아이템 추출 등 모든 LLM 관련 로직을 담당합니다."""

    def __init__(self):
        OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
        if not OPENAI_API_KEY:
            raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.")
        
        self.client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        # TODO: (권현재) LangChain, RAG 관련 객체 초기화 (추후)

    async def get_simple_summary(self, content: str) -> str:
        """
        단순 텍스트 요약 (실시간 요약용, 액션 아이템 없이 요약만)
        
        Args:
            content: 회의 내용 텍스트
            
        Returns:
            str: 요약된 회의 내용
        """
        if not content or not content.strip():
            return ""
        
        try:
            chat_completion = await self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": """You are a professional real-time meeting summarizer. 
Create a brief and concise summary of the meeting content so far.

Format your summary in Korean as:
## 현재까지 논의된 내용
- 핵심 요점들 (3-5개)

Keep it short and focused on key points only."""
                    },
                    {
                        "role": "user",
                        "content": f"다음 회의 내용을 간략하게 요약해주세요:\n\n{content}"
                    }
                ],
                model="gpt-4o-mini",
                temperature=0.3,
                max_tokens=500
            )
            
            summary = chat_completion.choices[0].message.content.strip()
            return summary
            
        except Exception as e:
            print(f"LLM Simple Summary Error: {e}")
            return f"[요약 생성 오류: {e}]"

    async def generate_summary(self, texts: List[str]) -> str:
        """
        회의록 텍스트 리스트를 받아서 요약 생성
        
        Args:
            texts: 회의 내용 텍스트 리스트 (청크 단위)
            
        Returns:
            str: 요약된 회의 내용
        """
        if not texts:
            return ""
        
        # 모든 텍스트를 하나로 합치기
        full_transcript = "\n".join(texts)
        
        try:
            # OpenAI API로 요약 생성
            chat_completion = await self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": """You are a professional meeting summarizer. 
Create a concise and structured summary of the meeting transcript.

Format your summary as:
## 회의 개요
- 주요 논의 사항들

## 핵심 내용
- 중요한 결정사항들

## 다음 단계
- 후속 조치사항들

Use Korean for the summary."""
                    },
                    {
                        "role": "user",
                        "content": f"다음 회의록을 요약해주세요:\n\n{full_transcript}"
                    }
                ],
                model="gpt-4.1-nano",  # 비용 효율적인 모델
                temperature=0.3,  # 일관된 요약을 위해 낮게 설정
                max_tokens=1000
            )
            
            summary = chat_completion.choices[0].message.content.strip()
            return summary
            
        except Exception as e:
            print(f"LLM Summary Error: {e}")
            return f"[요약 생성 오류: {e}]"

    async def get_translation(self, text: str, source_lang: str = "Korean", target_lang: str = "English") -> str:
        """
        실시간으로 텍스트를 번역하는 코어 함수.
        
        Args:
            text: 번역할 텍스트
            source_lang: 원문 언어 (기본값: Korean)
            target_lang: 대상 언어 (기본값: English)
        
        Returns:
            str: 번역된 텍스트
        """
        if not text.strip():
            return ""
            
        try:
            # 동적 프롬프트 생성
            system_prompt = f"You are a highly skilled real-time translator. Translate the following {source_lang} text to {target_lang}. Respond with only the translated text, maintaining the original tone and meaning."
            
            chat_completion = await self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt,
                    },
                    {"role": "user", "content": text},
                ],
                model="gpt-4o-mini", 
                temperature=0.3,  # 일관성 있는 번역을 위해 낮은 temperature
            )
            return chat_completion.choices[0].message.content.strip()
        
        except Exception as e:
            print(f"LLM Translation Error: {e}")
            return f"[Translation Error: {e}]"

    async def extract_action_items(self, texts: List[str]) -> List[dict]:
        """
        회의록에서 액션 아이템 추출
        
        Args:
            texts: 회의 내용 텍스트 리스트
            
        Returns:
            list[dict]: 액션 아이템 리스트
            [
                {
                    "task": "할 일 내용",
                    "assignee": "담당자",
                    "deadline": "마감일"
                },
                ...
            ]
        """
        if not texts:
            return []
        
        full_transcript = "\n".join(texts)
        
        try:
            chat_completion = await self.client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": """You are an expert at extracting action items from meeting transcripts.

Extract all action items and respond ONLY with a JSON array in this exact format:
[
    {
        "task": "구체적인 작업 내용",
        "assignee": "담당자 이름",
        "deadline": "마감일 (YYYY-MM-DD 또는 '미정')"
    }
]

If no action items are found, return an empty array: []

Important:
- Extract only concrete tasks with clear ownership
- Include deadline if mentioned, otherwise use "미정"
- Use Korean for task descriptions
- Respond ONLY with valid JSON, no additional text"""
                    },
                    {
                        "role": "user",
                        "content": f"다음 회의록에서 액션 아이템을 추출해주세요:\n\n{full_transcript}"
                    }
                ],
                model="gpt-4o-mini",
                temperature=0.1,  # 정확한 추출을 위해 매우 낮게
                max_tokens=1000
            )
            
            response_text = chat_completion.choices[0].message.content.strip()
            
            # JSON 파싱 (마크다운 코드 블록 제거)
            if response_text.startswith("```json"):
                response_text = response_text.replace("```json", "").replace("```", "").strip()
            elif response_text.startswith("```"):
                response_text = response_text.replace("```", "").strip()
            
            action_items = json.loads(response_text)
            
            # 데이터 검증
            if not isinstance(action_items, list):
                return []
            
            # 필수 필드 검증
            validated_items = []
            for item in action_items:
                if isinstance(item, dict) and "task" in item:
                    validated_items.append({
                        "task": item.get("task", ""),
                        "assignee": item.get("assignee", "미지정"),
                        "deadline": item.get("deadline", "미정")
                    })
            
            return validated_items
            
        except json.JSONDecodeError as e:
            print(f"JSON Parse Error: {e}")
            print(f"Response was: {response_text}")
            return []
        except Exception as e:
            print(f"LLM Action Items Error: {e}")
            return []

    async def generate_timeline_summary(
        self, 
        texts: List[str], 
        previous_summary: str = "", 
        time_window: str = ""
    ) -> dict:
        """
        타임라인 기반 증분 요약 생성 (실시간 WebSocket용)
        
        Args:
            texts: 새로운 회의 내용 텍스트 리스트
            previous_summary: 이전까지의 누적 요약
            time_window: 시간 윈도우 (예: "00:00-01:00")
            
        Returns:
            dict: {
                "incremental_summary": "이번 구간의 요약",
                "rolling_summary": "전체 누적 요약"
            }
        """
        if not texts:
            return {
                "incremental_summary": "",
                "rolling_summary": previous_summary
            }
        
        full_transcript = "\n".join(texts)
        
        try:
            # 시스템 프롬프트 구성
            system_content = """You are a professional meeting summarizer for real-time transcription.
Create a concise summary of the new meeting content while maintaining context from the previous summary.

Format your summary in Korean as:
## 주요 내용
- 핵심 논의사항들

## 중요 결정사항
- 결정된 내용들

Keep it concise (3-5 bullet points) focusing on actionable information."""

            # 사용자 프롬프트 구성
            if previous_summary:
                user_content = f"""이전 요약:
{previous_summary}

---

{time_window} 구간의 새로운 회의 내용:
{full_transcript}

위 내용을 바탕으로 이번 구간의 핵심만 간결하게 요약해주세요."""
            else:
                user_content = f"""{time_window} 구간의 회의 내용:
{full_transcript}

위 내용을 바탕으로 핵심만 간결하게 요약해주세요."""

            # OpenAI API 호출
            chat_completion = await self.client.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_content},
                    {"role": "user", "content": user_content}
                ],
                model="gpt-4o-mini",
                temperature=0.3,
                max_tokens=800
            )
            
            incremental_summary = chat_completion.choices[0].message.content.strip()
            
            # 누적 요약 생성
            if previous_summary:
                rolling_summary = f"{previous_summary}\n\n### {time_window}\n{incremental_summary}"
            else:
                rolling_summary = f"### {time_window}\n{incremental_summary}"
            
            return {
                "incremental_summary": incremental_summary,
                "rolling_summary": rolling_summary
            }
            
        except Exception as e:
            print(f"LLM generate_timeline_summary Error: {e}")
            return {
                "incremental_summary": f"[요약 생성 오류: {e}]",
                "rolling_summary": previous_summary or ""
            }

    async def get_summary_and_actions(self, texts: list[str], previous_summary: str = "") -> dict:
        """
        누적된 텍스트를 기반으로 요약과 액션 아이템 추출
        (배치 Worker에서 사용)
        
        Args:
            texts: 회의 내용 텍스트 리스트
            previous_summary: 이전 요약 (있으면 반영, 없으면 새로 생성)
            
        Returns:
            dict: {
                "rolling_summary": "누적 요약",
                "action_items": [액션 아이템 리스트]
            }
        """
        try:
            # 1. 요약 생성
            new_summary = await self.generate_summary(texts)
            
            # 2. 이전 요약과 병합 (있으면)
            if previous_summary:
                rolling_summary = f"{previous_summary}\n\n### 추가 내용\n{new_summary}"
            else:
                rolling_summary = new_summary
            
            # 3. 액션 아이템 추출
            action_items = await self.extract_action_items(texts)
            
            return {
                "rolling_summary": rolling_summary,
                "action_items": action_items
            }
            
        except Exception as e:
            print(f"LLM get_summary_and_actions Error: {e}")
            return {
                "rolling_summary": previous_summary or "[요약 생성 실패]",
                "action_items": []
            }


# ============================================
# 테스트 코드
# ============================================
async def test_llm_service():
    """LLM 서비스 테스트"""
    
    # 더미 회의록
    dummy_texts = [
        """
        회의 참석자: 김철수, 이영희, 박민수
        회의 시간: 2024-11-20 14:00
        회의 주제: Q4 프로젝트 진행 상황 점검
        
        김철수: 백엔드 API 개발이 현재 70% 완료되었습니다. 
        주요 엔드포인트는 모두 구현했고, 테스트 코드 작성 중입니다.
        """,
        """
        이영희: 프론트엔드는 90% 완료되었고, 다음 주 월요일까지 
        전체 기능 테스트를 마칠 예정입니다. UI/UX 리뷰도 필요합니다.
        """,
        """
        박민수: 데이터베이스 마이그레이션은 이번 주 금요일까지 완료하겠습니다.
        인덱스 최적화도 함께 진행하겠습니다.
        
        액션 아이템:
        - 김철수: API 문서 작성 완료 (마감: 2024-11-25)
        - 이영희: UI 디자인 리뷰 진행 (마감: 2024-11-22)
        - 박민수: DB 백업 스크립트 작성 (마감: 2024-11-23)
        """
    ]
    
    print("=" * 50)
    print("LLM 서비스 테스트 시작")
    print("=" * 50)
    
    # 서비스 초기화
    service = LLMService()
    
    # 1. 요약 생성 테스트
    print("\n[1] 요약 생성 테스트")
    print("-" * 50)
    summary = await service.generate_summary(dummy_texts)
    print(summary)
    
    # 2. 액션 아이템 추출 테스트
    print("\n[2] 액션 아이템 추출 테스트")
    print("-" * 50)
    action_items = await service.extract_action_items(dummy_texts)
    if action_items:
        for i, item in enumerate(action_items, 1):
            print(f"{i}. {item['task']}")
            print(f"   담당자: {item['assignee']}")
            print(f"   마감일: {item['deadline']}")
            print()
    else:
        print("액션 아이템이 없습니다.")
    
    # 3. 통합 테스트 (get_summary_and_actions)
    print("\n[3] 통합 테스트 (요약 + 액션 아이템)")
    print("-" * 50)
    result = await service.get_summary_and_actions(dummy_texts)
    print("요약:")
    print(result["rolling_summary"])
    print("\n액션 아이템:")
    for item in result["action_items"]:
        print(f"- {item['task']} ({item['assignee']}, {item['deadline']})")
    
    # 4. 번역 테스트
    print("\n[4] 번역 테스트")
    print("-" * 50)
    korean_text = "안녕하세요. 회의를 시작하겠습니다."
    translation = await service.get_translation(korean_text)
    print(f"원문: {korean_text}")
    print(f"번역: {translation}")
    
    print("\n" + "=" * 50)
    print("테스트 완료!")
    print("=" * 50)


if __name__ == "__main__":
    # 테스트 실행
    # python -m backend.core.llm.service
    asyncio.run(test_llm_service())