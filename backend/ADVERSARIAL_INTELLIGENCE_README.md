# 적대적 지능 (Adversarial Intelligence) 기능

## 개요

적대적 지능은 회의 내용을 비판적으로 분석하여 다음 항목을 탐지하는 기능입니다:

1. **논리적 불일치** (Logical Inconsistency)
2. **누락된 논점** (Missing Arguments)
3. **과거 의사결정 모순** (Historical Decision Contradiction)
4. **잠재 리스크** (Potential Risk)
5. **비논리적 결론** (Illogical Conclusion)

## 주요 기능

### 1. 논리적 불일치 탐지
- 서로 모순되는 진술 발견
- 목표와 실행 계획의 불일치 식별
- 결론과 논의 내용의 괴리 파악

**예시:**
```
목표: "예산 20% 절감"
결정: "마케팅 예산 2배 증액, 인력 추가 채용"
→ 논리적 불일치 탐지!
```

### 2. 누락된 논점 탐지
- 논의되었지만 구체적 결정이 없는 사항
- 중요한 고려사항이지만 언급되지 않은 주제
- 액션 아이템의 담당자/기한 누락

**예시:**
```
논의: "신제품 출시 일정"
결정: "다음 달 15일 출시, 예산 2000만원"
누락: 담당자 미지정, 홍보 방안 미논의, 리스크 대응 없음
→ 누락된 논점 탐지!
```

### 3. 과거 의사결정 모순 탐지
- 이전 회의 결정과 상반되는 새로운 결정
- 합의된 방향과 다른 방향으로의 전환
- 과거 이슈가 해결 없이 재발

**예시:**
```
과거 회의 (1개월 전): "React 사용 결정"
현재 회의: "Vue.js로 전환 결정"
→ 과거 결정 모순 탐지!
```

### 4. 잠재 리스크 식별
- 일정/예산/리소스 관련 위험
- 실행 가능성에 대한 의문
- 이해관계자 간 갈등 가능성
- 외부 의존성 리스크

**예시:**
```
상황: "2주 내 출시, 팀원 50% 휴가"
→ 일정 리스크 높음!
```

### 5. 비논리적 결론 탐지
- 논의 내용과 결론의 연결 부재
- 근거 불충분한 의사결정
- 문제와 해결책의 불일치

**예시:**
```
문제: "사용자 이탈률 증가"
결론: "로고 색상 변경"
→ 비논리적 결론!
```

## API 사용법

### 엔드포인트

```
POST /api/v1/chatbot/analyze-adversarial/{meeting_id}
```

### 요청 예시

```bash
curl -X POST "http://localhost:8000/api/v1/chatbot/analyze-adversarial/01KB6HXFDGW35MVQ99KN5J4EMD" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

### 응답 예시

```json
{
  "meeting_id": "01KB6HXFDGW35MVQ99KN5J4EMD",
  "meeting_title": "2024년 Q1 예산 절감 회의",
  "analyzed_at": "2025-12-01T10:30:00",
  "overall_score": 45.5,
  "inconsistencies": [
    {
      "type": "logical_inconsistency",
      "severity": "high",
      "description": "예산 절감 목표와 예산 증액 결정이 모순됩니다",
      "evidence": [
        "운영 비용 20% 절감 목표",
        "마케팅 예산 2배 증액 결정"
      ],
      "impact": "목표 달성 불가능"
    }
  ],
  "missing_points": [
    {
      "type": "missing_point",
      "severity": "medium",
      "topic": "담당자 미지정",
      "description": "액션 아이템에 구체적 담당자가 없습니다",
      "why_important": "책임 소재 불명확",
      "suggestion": "각 액션 아이템의 담당자 명확히 지정 필요"
    }
  ],
  "contradictions": [
    {
      "type": "contradiction",
      "severity": "high",
      "current_decision": "Vue.js 사용",
      "past_decision": "React 사용",
      "past_meeting": "기술 스택 선정 회의",
      "description": "1개월 전 결정한 기술 스택을 변경",
      "requires_review": true
    }
  ],
  "risks": [
    {
      "type": "risk",
      "severity": "high",
      "category": "일정",
      "description": "2주 내 출시 일정이 매우 촉박함",
      "likelihood": "high",
      "impact": "high",
      "mitigation": "일정 재조정 또는 인력 추가 투입 고려"
    }
  ],
  "illogical_conclusions": [
    {
      "type": "illogical_conclusion",
      "severity": "medium",
      "conclusion": "로고 색상 변경으로 이탈률 개선",
      "problem": "이탈률 증가 원인 분석 없이 결론",
      "missing_logic": "데이터 기반 원인 분석 단계 생략",
      "suggestion": "사용자 조사 및 데이터 분석 선행 필요"
    }
  ],
  "recommendations": [
    "🔴 긴급: 3개의 심각한 문제가 발견되었습니다. 즉시 재검토가 필요합니다.",
    "⚠️ 논리적 불일치 2개 발견 - 관련 결정사항을 다시 검토하세요.",
    "📋 누락된 논점 3개 발견 - 추가 논의가 필요합니다.",
    "🔄 과거 결정과의 모순 1개 발견 - 이전 회의록을 참고하세요.",
    "⚡ 높은 리스크 2개 식별 - 완화 방안을 마련하세요."
  ]
}
```

## 품질 점수 계산

전체 품질 점수는 0-100점으로 계산됩니다:
- **80-100점**: 우수한 회의
- **60-79점**: 양호한 회의 (일부 개선 필요)
- **40-59점**: 보통 (여러 문제 발견)
- **0-39점**: 불량 (심각한 문제 다수)

### 감점 기준

| 심각도 | 불일치 | 누락 | 모순 | 리스크 | 비논리 |
|--------|--------|------|------|--------|--------|
| High   | -10점  | -8점 | -12점| -7점   | -11점  |
| Medium | -5점   | -4점 | -6점 | -3.5점 | -5.5점 |
| Low    | -2점   | -1.6점| -2.4점| -1.4점 | -2.2점 |

## 테스트 방법

### 1. 테스트 데이터 생성 및 분석

```bash
cd backend
python test_adversarial_intelligence.py
```

이 스크립트는:
1. 3가지 유형의 문제가 있는 테스트 회의 생성
2. 각 회의에 대한 적대적 지능 분석 수행
3. 결과를 터미널에 출력

### 2. API 직접 테스트

테스트 스크립트가 출력하는 회의 ID를 사용하여:

```bash
# 생성된 회의 ID로 API 테스트
curl -X POST "http://localhost:8000/api/v1/chatbot/analyze-adversarial/YOUR_MEETING_ID" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

## 구현 세부사항

### 파일 구조

```
backend/
├── core/
│   └── chatbot/
│       ├── adversarial_intelligence.py  # 메인 분석 엔진
│       ├── service.py                   # 기존 챗봇 서비스
│       └── conversation_helpers.py
├── api/
│   └── v1/
│       └── chatbot/
│           └── endpoints.py             # API 엔드포인트
├── schemas/
│   └── chatbot.py                       # Pydantic 스키마
└── test_adversarial_intelligence.py     # 테스트 스크립트
```

### 주요 클래스

#### `AdversarialIntelligence`

```python
class AdversarialIntelligence:
    def __init__(self, db: Session, client: Optional[OpenAI] = None, model: str = "gpt-4o-mini")

    def analyze_meeting(self, meeting_id: str) -> Dict[str, Any]

    # 개별 분석 메서드
    def _detect_logical_inconsistencies(...)
    def _detect_missing_points(...)
    def _detect_contradictions(...)
    def _identify_risks(...)
    def _detect_illogical_conclusions(...)
```

### 과거 회의 검색

적대적 지능은 RAG (Retrieval-Augmented Generation)를 사용하여 과거 유사 회의를 검색합니다:

```python
# 벡터 유사도 기반 검색
similar_meetings = retriever.retrieve_similar_meetings(
    query=f"{title}\n{content[:500]}",
    k=3,  # 상위 3개
    exclude_meeting_id=current_meeting_id
)
```

## 주의사항

1. **OpenAI API 사용**: 이 기능은 OpenAI GPT 모델을 사용하므로 API 키가 필요합니다
2. **임베딩 데이터 필요**: 과거 회의 모순 탐지를 위해서는 회의가 임베딩되어 있어야 합니다
3. **분석 시간**: 회의 길이와 복잡도에 따라 5-30초 소요
4. **비용**: GPT-4o-mini 모델 사용 시 회의당 약 $0.01-0.05 예상

## 활용 사례

### 1. 회의 후 품질 체크
회의 종료 후 자동으로 분석을 실행하여 문제점 식별

### 2. 의사결정 검증
중요한 결정이 내려진 회의를 분석하여 논리적 오류 방지

### 3. 과거 이력 추적
과거 회의와의 일관성을 유지하고 모순된 결정 방지

### 4. 리스크 사전 식별
실행 전에 잠재적 문제를 발견하여 대응

## 향후 개선 방향

1. **실시간 분석**: 회의 진행 중 실시간 피드백
2. **자동 권장사항**: AI가 구체적 개선안 제시
3. **트렌드 분석**: 여러 회의의 패턴 분석
4. **우선순위 자동 할당**: 문제의 긴급도 기반 우선순위 결정
5. **알림 시스템**: 심각한 문제 발견 시 자동 알림

## 문의 및 지원

문제가 발생하거나 개선 제안이 있으시면 개발팀에 문의하세요.
