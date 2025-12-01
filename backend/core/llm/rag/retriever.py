"""
RAG 검색기 - VectorStore를 활용한 유사 문서 검색

핵심 기능:
- 유사 회의 검색 (과거 회의 중 비슷한 주제 찾기)
- 회의 내 유사 청크 검색 (특정 회의 내에서 관련 발언 찾기)
- 컨텍스트 재랭킹 (관련성 높은 순으로 정렬)
"""
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session
from backend.core.llm.rag.vectorstore import VectorStore
from backend import models


class RAGRetriever:
    """RAG 검색을 위한 Retriever 클래스"""
    
    def __init__(self, db: Session):
        """
        RAGRetriever 초기화
        
        Args:
            db: SQLAlchemy 세션 (DB 접근용)
            
        Example:
            >>> from backend.database import SessionLocal
            >>> db = SessionLocal()
            >>> retriever = RAGRetriever(db)
        """
        self.vectorstore = VectorStore(db)
        self.db = db
    
    def retrieve_similar_meetings(
        self,
        query: str,
        k: int = 3,
        exclude_meeting_id: Optional[str] = None
    ) -> List[dict]:
        """
        쿼리와 유사한 과거 회의들을 검색
        
        작동 원리:
        1. VectorStore로 유사 청크 검색 (k*3개, 오버샘플링)
        2. 청크에서 회의 ID 추출 및 중복 제거
        3. 회의별 최고 유사도 점수 계산
        4. 상위 k개 회의 선택 (유사도 높은 순)
        5. DB에서 회의 상세 정보 조회 (제목, 요약, 날짜 등)
        
        Args:
            query: 검색 쿼리 (현재 회의 전사본 또는 사용자 질문)
            k: 반환할 회의 개수 (기본값: 3)
            exclude_meeting_id: 제외할 회의 ID (보통 현재 회의)
            
        Returns:
            유사한 회의 정보 리스트
            [
                {
                    "meeting_id": "meeting_001",
                    "title": "Q3 마케팅 전략",
                    "purpose": "분기 목표 설정",
                    "summary": "SNS 광고 예산 20% 증액...",
                    "similarity": 0.89,
                    "start_dt": "2024-10-15T10:00:00"
                },
                ...
            ]
            
        Example:
            >>> retriever = RAGRetriever(db)
            >>> similar = retriever.retrieve_similar_meetings(
            ...     query="마케팅 예산 회의",
            ...     k=3,
            ...     exclude_meeting_id="current_meeting_id"
            ... )
            >>> print(f"유사 회의 {len(similar)}개 발견")
        """
        # 1. VectorStore로 유사 청크 검색
        # k*3개 가져오기: 여러 청크가 같은 회의에 속할 수 있으므로
        results = self.vectorstore.similarity_search(
            query=query,
            k=k * 3  # 오버샘플링: 충분한 회의 확보
        )

        # 2. 청크에서 회의 ID 추출 및 그룹핑
        meeting_scores = {}

        for eid, chunk_text, similarity, created_dt in results:
            # embedding_id가 있으면 바로 Embedding 레코드 조회
            embedding = None
            if eid:
                embedding = (
                    self.db.query(models.Embedding)
                    .filter(models.Embedding.EMBEDDING_ID == eid)
                    .first()
                )
            else:
                embedding = (
                    self.db.query(models.Embedding)
                    .filter(models.Embedding.CHUNK_TEXT == chunk_text)
                    .first()
                )

            if embedding and embedding.MEETING_ID != exclude_meeting_id:
                meeting_id = embedding.MEETING_ID

                # 같은 회의의 여러 청크가 있으면 최고 점수 사용
                if meeting_id not in meeting_scores:
                    meeting_scores[meeting_id] = similarity
                else:
                    meeting_scores[meeting_id] = max(meeting_scores[meeting_id], similarity)
        
        # 3. 상위 k개 회의 선택 (유사도 높은 순)
        top_meetings = sorted(
            meeting_scores.items(),
            key=lambda x: x[1],  # 유사도로 정렬
            reverse=True  # 내림차순
        )[:k]
        
        # 4. 회의 상세 정보 조회 (DB)
        similar_meetings = []
        for meeting_id, similarity in top_meetings:
            # 회의 기본 정보
            meeting = (
                self.db.query(models.Meeting)
                .filter(models.Meeting.MEETING_ID == meeting_id)
                .first()
            )
            
            if meeting:
                # 해당 회의의 요약 가져오기 (최신)
                summary = (
                    self.db.query(models.Summary)
                    .filter(models.Summary.MEETING_ID == meeting_id)
                    .order_by(models.Summary.CREATED_DT.desc())
                    .first()
                )
                
                similar_meetings.append({
                    "meeting_id": meeting_id,
                    "title": meeting.TITLE or "제목 없음",
                    "purpose": meeting.PURPOSE,
                    "summary": summary.CONTENT if summary else None,
                    "similarity": round(similarity, 3),  # 소수점 3자리
                    "start_dt": meeting.START_DT.isoformat() if meeting.START_DT else None
                })
        
        return similar_meetings
    
    def retrieve_in_meeting(
        self,
        meeting_id: str,
        query: str,
        k: int = 5
    ) -> List[Tuple[str, float]]:
        """
        특정 회의 내에서 쿼리와 관련된 발언/청크 검색
        
        회의록 챗봇이나 특정 주제 발언을 찾을 때 사용합니다.
        
        Args:
            meeting_id: 검색할 회의 ID
            query: 검색 쿼리 (사용자 질문)
            k: 반환할 청크 개수 (기본값: 5)
            
        Returns:
            [(chunk_text, similarity_score), ...] 리스트
            유사도 높은 순으로 정렬됨
            
        Example:
            >>> retriever = RAGRetriever(db)
            >>> results = retriever.retrieve_in_meeting(
            ...     meeting_id="meeting_123",
            ...     query="예산은 얼마로 결정했나요?",
            ...     k=3
            ... )
            >>> for text, score in results:
            ...     print(f"[{score:.3f}] {text[:50]}...")
        """
        # VectorStore의 meeting_id 필터링 기능 사용
        # 간단한 래퍼 메서드
        # returns list of tuples (embedding_id, chunk_text, similarity, created_dt)
        return self.vectorstore.similarity_search(
            query=query,
            k=k,
            meeting_id=meeting_id  # 특정 회의로 제한
        )
    
    def retrieve(
        self,
        query: str,
        k: int = 5,
        meeting_id: Optional[str] = None
    ) -> List[str]:
        """
        범용 검색 인터페이스 (LangChain 호환)
        
        LangChain과 통합할 때 사용하는 표준 인터페이스입니다.
        점수 없이 텍스트만 반환합니다.
        
        Args:
            query: 검색 쿼리
            k: 반환할 결과 개수 (기본값: 5)
            meeting_id: 특정 회의로 제한 (선택)
            
        Returns:
            관련 텍스트 청크 리스트 (점수 제외)
            
        Example:
            >>> retriever = RAGRetriever(db)
            >>> docs = retriever.retrieve("예산 관련 내용", k=5)
            >>> print(f"{len(docs)}개 문서 검색됨")
            >>> for doc in docs:
            ...     print(f"- {doc[:50]}...")
        """
        # VectorStore 검색 결과에서 점수 제거
        results = self.vectorstore.similarity_search(
            query=query,
            k=k,
            meeting_id=meeting_id
        )

        # results: list of tuples (embedding_id, chunk_text, similarity, created_dt)
        # return list of dicts with metadata
        return [
            {
                "embedding_id": r[0],
                "text": r[1],
                "similarity": r[2],
                "created_at": r[3].isoformat() if r[3] is not None else None,
            }
            for r in results
        ]