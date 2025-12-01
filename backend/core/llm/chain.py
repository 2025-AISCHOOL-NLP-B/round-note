"""
LangChain 체인 정의 - 요약 및 액션 아이템 추출

핵심 기능:
- RAG 기반 회의 요약 생성
- 구조화된 액션 아이템 추출
- 과거 회의 컨텍스트 활용

LLM 및 액션아이템 추출 성능 튜닝은 이곳에서 조정
"""
from typing import List, Dict, Any, Optional
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.chains import LLMChain
from langchain.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field
import os

# OpenAI LLM 초기화
llm = ChatOpenAI(
    model="gpt-4.1-nano",  # 비용 효율적
    temperature=0.3,  # 일관성 있는 요약
    api_key=os.getenv("OPENAI_API_KEY")
)

# 액션 아이템 출력 스키마
class ActionItemSchema(BaseModel):
    """액션 아이템 구조화 스키마"""
    title: str = Field(description="액션 아이템 제목")
    description: str = Field(description="상세 설명")
    assignee: Optional[str] = Field(None, description="담당자 (발언에서 추출)")
    priority: str = Field("MEDIUM", description="우선순위: LOW, MEDIUM, HIGH")
    due_date: Optional[str] = Field(None, description="마감일 (YYYY-MM-DD 형식)")

class ActionItemsOutput(BaseModel):
    """전체 액션 아이템 리스트"""
    action_items: List[ActionItemSchema] = Field(description="추출된 액션 아이템들")

# Pydantic 파서
action_item_parser = PydanticOutputParser(pydantic_object=ActionItemsOutput)

# --- 프롬프트 템플릿 ---

SUMMARY_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """당신은 회의록 요약 전문가입니다.
회의 전사본을 읽고 핵심 내용을 정리하여 명확하고 간결한 요약을 작성하세요.

**과거 유사 회의 컨텍스트** (참고용):
{context}

**요약 형식**:
1. **회의 개요**: 회의 목적과 주요 안건
2. **핵심 논의 사항**: 주요 의견과 결정 사항
3. **결론**: 최종 결정 및 다음 단계

한국어로 작성하고, 마크다운 형식을 사용하세요."""),
    ("human", "**회의 전사본**:\n{transcript}")
])

ACTION_ITEM_PROMPT = ChatPromptTemplate.from_messages([
    ("system", """당신은 회의에서 액션 아이템을 추출하는 전문가입니다.
회의 전사본을 분석하여 실행 가능한 액션 아이템들을 구조화된 형식으로 추출하세요.

**추출 기준**:
- "~해야 한다", "~하기로 했다", "~를 진행", "담당" 등의 표현 주목
- 명확한 담당자와 기한이 언급되면 포함
- 추상적이거나 모호한 내용은 제외

{format_instructions}"""),
    ("human", "**회의 전사본**:\n{transcript}")
])

# --- LangChain 체인 ---
class SummaryChain:
    """요약 생성 체인"""
    
    def __init__(self):
        self.chain = LLMChain(
            llm=llm,
            prompt=SUMMARY_PROMPT,
            verbose=True
        )
    
    def run(self, transcript: str, context: str = "") -> str:
        """
        회의 요약 생성
        
        Args:
            transcript: 회의 전사본
            context: RAG로 검색한 과거 회의 컨텍스트
            
        Returns:
            마크다운 형식의 요약
        """
        result = self.chain.run(
            transcript=transcript,
            context=context or "과거 유사 회의 없음"
        )
        return result

class ActionItemChain:
    """액션 아이템 추출 체인"""
    
    def __init__(self):
        self.chain = LLMChain(
            llm=llm,
            prompt=ACTION_ITEM_PROMPT,
            verbose=True
        )
        self.parser = action_item_parser
    
    def run(self, transcript: str) -> List[Dict[str, Any]]:
        """
        액션 아이템 추출
        
        Args:
            transcript: 회의 전사본
            
        Returns:
            액션 아이템 딕셔너리 리스트
        """
        result = self.chain.run(
            transcript=transcript,
            format_instructions=self.parser.get_format_instructions()
        )
        
        # Pydantic 파싱
        try:
            parsed = self.parser.parse(result)
            return [item.model_dump() for item in parsed.action_items]
        except Exception as e:
            print(f"액션 아이템 파싱 오류: {e}")
            return []

# --- 전역 체인 인스턴스 ---
summary_chain = SummaryChain()
action_item_chain = ActionItemChain()