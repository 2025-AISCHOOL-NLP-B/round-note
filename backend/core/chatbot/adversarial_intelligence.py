"""
적대적 지능 (Adversarial Intelligence) 모듈

회의 내용의 논리적 불일치, 누락된 논점, 과거 결정과의 모순을 탐지하여
회의의 품질을 높이고 잠재적 리스크를 사전에 식별합니다.

주요 기능:
1. 논리적 불일치 탐지 (Logical Inconsistency Detection)
2. 누락된 논점 탐지 (Missing Arguments Detection)
3. 과거 의사결정 모순 탐지 (Historical Decision Contradiction Detection)
4. 잠재 리스크 식별 (Potential Risk Identification)
5. 비논리적 결론 탐지 (Illogical Conclusion Detection)
"""

import logging
from typing import List, Dict, Optional, Any
from datetime import datetime
from sqlalchemy.orm import Session
from openai import OpenAI
import os

from backend import models
from backend.core.llm.rag.retriever import RAGRetriever


logger = logging.getLogger(__name__)


class AdversarialIntelligence:
    """
    적대적 지능 분석 엔진

    회의 내용을 비판적으로 분석하여 논리적 문제점, 누락된 사항,
    과거 결정과의 모순을 탐지합니다.
    """

    def __init__(self, db: Session, client: Optional[OpenAI] = None, model: str = "gpt-4o-mini"):
        """
        Args:
            db: 데이터베이스 세션
            client: OpenAI 클라이언트 (없으면 환경변수로 생성)
            model: 사용할 모델 (기본값: gpt-4o-mini)
        """
        self.db = db
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key and not client:
            raise ValueError("OPENAI_API_KEY가 설정되지 않았습니다.")

        self.client = client or OpenAI(api_key=api_key)
        self.model = model
        self.retriever = RAGRetriever(db)
        logger.info(f"AdversarialIntelligence 초기화 - 모델: {model}")

    def analyze_meeting(self, meeting_id: str) -> Dict[str, Any]:
        """
        회의 전체를 적대적 지능으로 분석

        Args:
            meeting_id: 분석할 회의 ID

        Returns:
            분석 결과 dict
            {
                "meeting_id": str,
                "analyzed_at": datetime,
                "inconsistencies": List[Dict],  # 논리적 불일치
                "missing_points": List[Dict],   # 누락된 논점
                "contradictions": List[Dict],   # 과거 결정 모순
                "risks": List[Dict],            # 잠재 리스크
                "illogical_conclusions": List[Dict],  # 비논리적 결론
                "overall_score": float,  # 전체 품질 점수 (0-100)
                "recommendations": List[str],  # 개선 권장사항
            }
        """
        logger.info(f"적대적 지능 분석 시작 - 회의 ID: {meeting_id}")

        # 1. 회의 데이터 조회
        meeting = self.db.query(models.Meeting).filter(
            models.Meeting.MEETING_ID == meeting_id
        ).first()

        if not meeting:
            raise ValueError(f"회의를 찾을 수 없습니다: {meeting_id}")

        # 2. 회의 컨텍스트 구성
        content = meeting.CONTENT or ""
        summary = meeting.AI_SUMMARY or ""
        title = meeting.TITLE or ""

        # 3. 액션 아이템 조회
        action_items = self.db.query(models.ActionItem).filter(
            models.ActionItem.MEETING_ID == meeting_id
        ).all()

        # 4. 과거 회의 검색 (유사한 주제)
        similar_meetings = self._get_similar_meetings(meeting_id, title, content, k=3)

        # 5. 각 분석 수행
        inconsistencies = self._detect_logical_inconsistencies(content, summary, action_items)
        missing_points = self._detect_missing_points(content, summary, action_items)
        contradictions = self._detect_contradictions(meeting, similar_meetings)
        risks = self._identify_risks(content, summary, action_items, inconsistencies, contradictions)
        illogical_conclusions = self._detect_illogical_conclusions(content, summary, action_items)

        # 6. 전체 품질 점수 계산
        overall_score = self._calculate_quality_score(
            inconsistencies, missing_points, contradictions, risks, illogical_conclusions
        )

        # 7. 개선 권장사항 생성
        recommendations = self._generate_recommendations(
            inconsistencies, missing_points, contradictions, risks, illogical_conclusions
        )

        result = {
            "meeting_id": meeting_id,
            "meeting_title": title,
            "analyzed_at": datetime.now(),
            "inconsistencies": inconsistencies,
            "missing_points": missing_points,
            "contradictions": contradictions,
            "risks": risks,
            "illogical_conclusions": illogical_conclusions,
            "overall_score": overall_score,
            "recommendations": recommendations,
        }

        logger.info(
            f"적대적 지능 분석 완료 - 회의: {meeting_id}, "
            f"점수: {overall_score:.1f}, "
            f"불일치: {len(inconsistencies)}, "
            f"누락: {len(missing_points)}, "
            f"모순: {len(contradictions)}, "
            f"리스크: {len(risks)}"
        )

        return result

    def _get_similar_meetings(
        self,
        current_meeting_id: str,
        title: str,
        content: str,
        k: int = 3
    ) -> List[Dict]:
        """과거 유사 회의 검색"""
        try:
            # 제목 + 내용 일부로 검색
            query = f"{title}\n{content[:500]}"
            similar_meetings = self.retriever.retrieve_similar_meetings(
                query=query,
                k=k,
                exclude_meeting_id=current_meeting_id
            )
            return similar_meetings
        except Exception as e:
            logger.warning(f"과거 회의 검색 실패: {e}")
            return []

    def _detect_logical_inconsistencies(
        self,
        content: str,
        summary: str,
        action_items: List[models.ActionItem]
    ) -> List[Dict]:
        """
        논리적 불일치 탐지

        예시:
        - "예산을 늘린다"고 했는데 "비용 절감"을 목표로 설정
        - "다음 주 출시"라고 했는데 "아직 개발 중"인 액션 아이템
        """
        logger.info("논리적 불일치 탐지 시작")

        action_items_text = self._format_action_items(action_items)

        prompt = f"""다음 회의 내용을 분석하여 논리적 불일치를 찾아주세요.

[회의 요약]
{summary}

[회의 원문]
{content[:3000]}

[액션 아이템]
{action_items_text}

논리적 불일치란:
- 서로 모순되는 진술
- 목표와 실행 계획의 불일치
- 결론과 논의 내용의 괴리

JSON 형식으로 답변하세요:
[
  {{
    "type": "logical_inconsistency",
    "severity": "high|medium|low",
    "description": "불일치 내용",
    "evidence": ["증거1", "증거2"],
    "impact": "예상되는 영향"
  }}
]

불일치가 없으면 빈 배열 []을 반환하세요."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 회의 내용을 비판적으로 분석하는 전문가입니다."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                response_format={"type": "json_object"}
            )

            import json
            result_text = response.choices[0].message.content
            result = json.loads(result_text)

            # 결과가 dict일 경우 ({"inconsistencies": [...]})
            if isinstance(result, dict):
                inconsistencies = result.get("inconsistencies", [])
            else:
                inconsistencies = result if isinstance(result, list) else []

            logger.info(f"논리적 불일치 {len(inconsistencies)}개 탐지")
            return inconsistencies

        except Exception as e:
            logger.error(f"논리적 불일치 탐지 실패: {e}", exc_info=True)
            return []

    def _detect_missing_points(
        self,
        content: str,
        summary: str,
        action_items: List[models.ActionItem]
    ) -> List[Dict]:
        """
        누락된 논점 탐지

        예시:
        - 예산 논의했지만 구체적 금액 없음
        - 일정 결정했지만 담당자 미지정
        - 리스크 언급했지만 대응 방안 없음
        """
        logger.info("누락된 논점 탐지 시작")

        action_items_text = self._format_action_items(action_items)

        prompt = f"""다음 회의 내용을 분석하여 누락된 중요 논점을 찾아주세요.

[회의 요약]
{summary}

[회의 원문]
{content[:3000]}

[액션 아이템]
{action_items_text}

누락된 논점이란:
- 논의되었지만 구체적 결정이 없는 사항
- 중요한 고려사항이지만 언급되지 않은 주제
- 액션 아이템에 담당자/기한이 없는 경우
- 리스크 대응 방안 누락

JSON 형식으로 답변하세요:
[
  {{
    "type": "missing_point",
    "severity": "high|medium|low",
    "topic": "누락된 주제",
    "description": "무엇이 누락되었는지",
    "why_important": "왜 중요한지",
    "suggestion": "추가로 논의해야 할 사항"
  }}
]

누락이 없으면 빈 배열 []을 반환하세요."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 회의 내용을 비판적으로 분석하는 전문가입니다."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                response_format={"type": "json_object"}
            )

            import json
            result_text = response.choices[0].message.content
            result = json.loads(result_text)

            if isinstance(result, dict):
                missing_points = result.get("missing_points", [])
            else:
                missing_points = result if isinstance(result, list) else []

            logger.info(f"누락된 논점 {len(missing_points)}개 탐지")
            return missing_points

        except Exception as e:
            logger.error(f"누락된 논점 탐지 실패: {e}", exc_info=True)
            return []

    def _detect_contradictions(
        self,
        current_meeting: models.Meeting,
        similar_meetings: List[Dict]
    ) -> List[Dict]:
        """
        과거 의사결정 모순 탐지

        예시:
        - 이전 회의에서 "A 방식 사용"으로 결정했는데 이번에 "B 방식 사용"으로 변경
        - 과거 "비용 절감" 목표였는데 이번에 "예산 증액" 결정
        """
        logger.info("과거 의사결정 모순 탐지 시작")

        if not similar_meetings:
            logger.info("과거 유사 회의가 없어 모순 탐지 스킵")
            return []

        current_content = current_meeting.CONTENT or ""
        current_summary = current_meeting.AI_SUMMARY or ""

        # 과거 회의 요약 수집
        past_summaries = []
        for sm in similar_meetings[:3]:  # 최대 3개
            meeting_id = sm.get("meeting_id")
            past_meeting = self.db.query(models.Meeting).filter(
                models.Meeting.MEETING_ID == meeting_id
            ).first()

            if past_meeting:
                past_summaries.append({
                    "title": sm.get("title", ""),
                    "date": sm.get("start_dt", ""),
                    "summary": sm.get("summary", "")
                })

        if not past_summaries:
            return []

        past_context = "\n\n".join([
            f"[{ps['title']} - {ps['date']}]\n{ps['summary']}"
            for ps in past_summaries
        ])

        prompt = f"""다음 현재 회의와 과거 회의를 비교하여 의사결정 모순을 찾아주세요.

[현재 회의 요약]
{current_summary}

[현재 회의 원문 일부]
{current_content[:2000]}

[과거 유사 회의]
{past_context}

의사결정 모순이란:
- 과거 결정과 상반되는 새로운 결정
- 이전에 합의된 방향과 다른 방향으로의 전환
- 과거 회의에서 다뤘던 이슈가 재발하는 경우

JSON 형식으로 답변하세요:
[
  {{
    "type": "contradiction",
    "severity": "high|medium|low",
    "current_decision": "현재 회의의 결정",
    "past_decision": "과거 회의의 결정",
    "past_meeting": "과거 회의 제목",
    "description": "어떤 점이 모순인지",
    "requires_review": true|false
  }}
]

모순이 없으면 빈 배열 []을 반환하세요."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 회의 내용을 비판적으로 분석하는 전문가입니다."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                response_format={"type": "json_object"}
            )

            import json
            result_text = response.choices[0].message.content
            result = json.loads(result_text)

            if isinstance(result, dict):
                contradictions = result.get("contradictions", [])
            else:
                contradictions = result if isinstance(result, list) else []

            logger.info(f"과거 의사결정 모순 {len(contradictions)}개 탐지")
            return contradictions

        except Exception as e:
            logger.error(f"과거 의사결정 모순 탐지 실패: {e}", exc_info=True)
            return []

    def _identify_risks(
        self,
        content: str,
        summary: str,
        action_items: List[models.ActionItem],
        inconsistencies: List[Dict],
        contradictions: List[Dict]
    ) -> List[Dict]:
        """
        잠재 리스크 식별

        예시:
        - 일정이 촉박한데 리소스 부족
        - 중요한 의사결정인데 참석자 적음
        - 논리적 불일치로 인한 실행 리스크
        """
        logger.info("잠재 리스크 식별 시작")

        action_items_text = self._format_action_items(action_items)

        # 발견된 문제 요약
        issues_summary = f"""
이미 탐지된 문제:
- 논리적 불일치: {len(inconsistencies)}개
- 과거 결정 모순: {len(contradictions)}개
"""

        prompt = f"""다음 회의 내용을 분석하여 잠재적 리스크를 식별해주세요.

[회의 요약]
{summary}

[회의 원문]
{content[:3000]}

[액션 아이템]
{action_items_text}

{issues_summary}

잠재 리스크란:
- 일정/예산/리소스 관련 위험
- 실행 가능성에 대한 의문
- 이해관계자 간 갈등 가능성
- 외부 의존성으로 인한 리스크
- 기술적/운영적 어려움

JSON 형식으로 답변하세요:
[
  {{
    "type": "risk",
    "severity": "high|medium|low",
    "category": "일정|예산|리소스|기술|운영|기타",
    "description": "리스크 내용",
    "likelihood": "high|medium|low",
    "impact": "high|medium|low",
    "mitigation": "완화 방안 제안"
  }}
]

리스크가 없으면 빈 배열 []을 반환하세요."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 리스크 관리 전문가입니다."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                response_format={"type": "json_object"}
            )

            import json
            result_text = response.choices[0].message.content
            result = json.loads(result_text)

            if isinstance(result, dict):
                risks = result.get("risks", [])
            else:
                risks = result if isinstance(result, list) else []

            logger.info(f"잠재 리스크 {len(risks)}개 식별")
            return risks

        except Exception as e:
            logger.error(f"잠재 리스크 식별 실패: {e}", exc_info=True)
            return []

    def _detect_illogical_conclusions(
        self,
        content: str,
        summary: str,
        action_items: List[models.ActionItem]
    ) -> List[Dict]:
        """
        비논리적 결론 탐지

        예시:
        - 문제는 A인데 해결책이 B (연관 없음)
        - 데이터 없이 중요한 의사결정
        - 근거가 불충분한 결론
        """
        logger.info("비논리적 결론 탐지 시작")

        action_items_text = self._format_action_items(action_items)

        prompt = f"""다음 회의 내용을 분석하여 비논리적 결론을 찾아주세요.

[회의 요약]
{summary}

[회의 원문]
{content[:3000]}

[액션 아이템]
{action_items_text}

비논리적 결론이란:
- 논의 내용과 결론이 연결되지 않음
- 근거가 불충분한 의사결정
- 문제와 해결책이 매치되지 않음
- 데이터/증거 없는 단정적 결론

JSON 형식으로 답변하세요:
[
  {{
    "type": "illogical_conclusion",
    "severity": "high|medium|low",
    "conclusion": "문제가 되는 결론",
    "problem": "무엇이 비논리적인지",
    "missing_logic": "빠진 논리적 연결고리",
    "suggestion": "개선 방안"
  }}
]

비논리적 결론이 없으면 빈 배열 []을 반환하세요."""

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "당신은 논리 분석 전문가입니다."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3,
                response_format={"type": "json_object"}
            )

            import json
            result_text = response.choices[0].message.content
            result = json.loads(result_text)

            if isinstance(result, dict):
                illogical = result.get("illogical_conclusions", [])
            else:
                illogical = result if isinstance(result, list) else []

            logger.info(f"비논리적 결론 {len(illogical)}개 탐지")
            return illogical

        except Exception as e:
            logger.error(f"비논리적 결론 탐지 실패: {e}", exc_info=True)
            return []

    def _calculate_quality_score(
        self,
        inconsistencies: List[Dict],
        missing_points: List[Dict],
        contradictions: List[Dict],
        risks: List[Dict],
        illogical_conclusions: List[Dict]
    ) -> float:
        """
        회의 품질 점수 계산 (0-100)

        점수가 높을수록 회의 품질이 좋음 (문제가 적음)
        """
        # 각 문제 유형의 가중치
        weights = {
            "high": 10,
            "medium": 5,
            "low": 2
        }

        # 감점 계산
        deductions = 0

        for item in inconsistencies:
            severity = item.get("severity", "medium")
            deductions += weights.get(severity, 5)

        for item in missing_points:
            severity = item.get("severity", "medium")
            deductions += weights.get(severity, 5) * 0.8  # 누락은 약간 덜 심각

        for item in contradictions:
            severity = item.get("severity", "medium")
            deductions += weights.get(severity, 5) * 1.2  # 모순은 더 심각

        for item in risks:
            severity = item.get("severity", "medium")
            deductions += weights.get(severity, 5) * 0.7  # 리스크는 잠재적

        for item in illogical_conclusions:
            severity = item.get("severity", "medium")
            deductions += weights.get(severity, 5) * 1.1

        # 100점 만점에서 감점
        score = max(0, 100 - deductions)

        return round(score, 1)

    def _generate_recommendations(
        self,
        inconsistencies: List[Dict],
        missing_points: List[Dict],
        contradictions: List[Dict],
        risks: List[Dict],
        illogical_conclusions: List[Dict]
    ) -> List[str]:
        """개선 권장사항 생성"""
        recommendations = []

        # 우선순위별 정렬
        high_priority_items = []

        for item in inconsistencies:
            if item.get("severity") == "high":
                high_priority_items.append(("불일치", item.get("description", "")))

        for item in contradictions:
            if item.get("severity") == "high":
                high_priority_items.append(("모순", item.get("description", "")))

        for item in illogical_conclusions:
            if item.get("severity") == "high":
                high_priority_items.append(("비논리적 결론", item.get("conclusion", "")))

        # 권장사항 생성
        if high_priority_items:
            recommendations.append(
                f"🔴 긴급: {len(high_priority_items)}개의 심각한 문제가 발견되었습니다. 즉시 재검토가 필요합니다."
            )

        if inconsistencies:
            recommendations.append(
                f"⚠️ 논리적 불일치 {len(inconsistencies)}개 발견 - 관련 결정사항을 다시 검토하세요."
            )

        if missing_points:
            recommendations.append(
                f"📋 누락된 논점 {len(missing_points)}개 발견 - 추가 논의가 필요합니다."
            )

        if contradictions:
            recommendations.append(
                f"🔄 과거 결정과의 모순 {len(contradictions)}개 발견 - 이전 회의록을 참고하세요."
            )

        if risks:
            high_risks = [r for r in risks if r.get("severity") == "high"]
            if high_risks:
                recommendations.append(
                    f"⚡ 높은 리스크 {len(high_risks)}개 식별 - 완화 방안을 마련하세요."
                )

        if not recommendations:
            recommendations.append("✅ 회의 품질이 우수합니다. 특별한 문제가 발견되지 않았습니다.")

        return recommendations

    def _format_action_items(self, action_items: List[models.ActionItem]) -> str:
        """액션 아이템을 텍스트로 포맷팅"""
        if not action_items:
            return "액션 아이템이 없습니다."

        lines = []
        for idx, item in enumerate(action_items, 1):
            due_date = item.DUE_DT.strftime("%Y-%m-%d") if item.DUE_DT else "미정"
            assignee = item.ASSIGNEE_NAME or "미지정"
            status = item.STATUS or "PENDING"
            priority = item.PRIORITY or "MEDIUM"
            lines.append(
                f"{idx}. [{status}] {item.TITLE} (담당: {assignee}, 마감: {due_date}, 우선순위: {priority})"
            )

        return "\n".join(lines)
