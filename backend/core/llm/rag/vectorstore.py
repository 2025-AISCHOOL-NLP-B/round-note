"""
pgvector를 사용한 벡터 저장소 구현

핵심 기능:
- OpenAI 임베딩 생성 (text-embedding-3-small, 1536차원)
- pgvector에 임베딩 저장 (Embedding 테이블)
- 유사도 검색 (코사인 유사도)
"""
from typing import List, Tuple, Optional
from sqlalchemy.orm import Session
from sqlalchemy import text
import openai
import os
from backend import models
import logging

logger = logging.getLogger(__name__)

class VectorStore:
    """pgvector 기반 벡터 저장소"""
    
    def __init__(self, db: Session):
        """
        Args:
            db: SQLAlchemy 세션
        """
        self.db = db
        self.embedding_model = "text-embedding-3-small"
        openai.api_key = os.getenv("OPENAI_API_KEY")
        
        if not openai.api_key:
            raise ValueError("OPENAI_API_KEY가 설정되지 않았습니다")
    
    # 임베딩 생성 # 텍스트를 숫자로 인코딩(유사한 텍스트들은 벡터 공간에서 가깜게 배치됨)
    def _get_embedding(self, text: str) -> List[float]:
        """
        OpenAI API를 사용하여 텍스트를 임베딩 벡터로 변환
        
        Args:
            text: 임베딩할 텍스트
            
        Returns:
            1536차원 임베딩 벡터
        """
        response = openai.embeddings.create(
            model=self.embedding_model,
            input=text
        )
        return response.data[0].embedding
    
    # 임베딩 저장 # 모든 임베딩을 DB에 영구 저장, 생성된 ID 리스트 반환
    def add_texts(
        self,
        meeting_id: str,
        texts: List[str],
        metadatas: Optional[List[dict]] = None
    ) -> List[str]:
        """
        텍스트 청크들을 임베딩하여 DB에 저장
        
        Args:
            meeting_id: 회의 ID
            texts: 저장할 텍스트 청크 리스트
            metadatas: 각 청크의 메타데이터 (선택)
            
        Returns:
            생성된 임베딩 ID 리스트
        """
        embedding_ids = []
        logger.info("VectorStore.add_texts: creating %d embeddings for meeting=%s", len(texts), meeting_id)
        
        for i, text in enumerate(texts):
            # 1. OpenAI 임베딩 생성
            embedding_vector = self._get_embedding(text)
            
            # 2. DB에 저장
            embedding = models.Embedding(
                MEETING_ID=meeting_id,
                CHUNK_TEXT=text,
                EMBEDDING=embedding_vector
            )
            self.db.add(embedding)
            self.db.flush()  # ID 할당을 위해 flush
            
            embedding_ids.append(embedding.EMBEDDING_ID)
            logger.debug("Created embedding id=%s for chunk idx=%d", embedding.EMBEDDING_ID, i)
        
        self.db.commit()
        logger.info("VectorStore.add_texts: committed %d embeddings for meeting=%s", len(embedding_ids), meeting_id)
        return embedding_ids
    
    # 유사도 검색 # 벡터의 방향을 비교, 의미적으로 비슷한지 판단
    def similarity_search(
        self,
        query: str,
        k: int = 5,
        meeting_id: Optional[str] = None
    ) -> List[Tuple[str, float]]:
        """
        쿼리와 유사한 텍스트 청크를 검색 (코사인 유사도)
        
        Args:
            query: 검색 쿼리
            k: 반환할 결과 개수
            meeting_id: 특정 회의로 검색 범위 제한 (선택)
            
        Returns:
            [(chunk_text, similarity_score), ...] 리스트
        """
        # 1. 쿼리 임베딩 생성
        query_embedding = self._get_embedding(query)
        
        # 2. pgvector 코사인 유사도 검색
        # <=> 연산자: 코사인 거리 (1 - 코사인 유사도)
        if meeting_id:
            sql_query = text("""
                SELECT 
                    "EMBEDDING_ID",
                    "CHUNK_TEXT",
                    1 - ("EMBEDDING" <=> (:query_embedding)::vector) as similarity,
                    "CREATED_DT"
                FROM "EMBEDDING"
                WHERE "MEETING_ID" = :meeting_id
                ORDER BY "EMBEDDING" <=> (:query_embedding)::vector
                LIMIT :k
            """)
        else:
            sql_query = text("""
                SELECT 
                    "EMBEDDING_ID",
                    "CHUNK_TEXT",
                    1 - ("EMBEDDING" <=> (:query_embedding)::vector) as similarity,
                    "CREATED_DT"
                FROM "EMBEDDING"
                ORDER BY "EMBEDDING" <=> (:query_embedding)::vector
                LIMIT :k
            """)

        params = {
            "query_embedding": query_embedding,
            "k": k
        }
        
        if meeting_id:
            params["meeting_id"] = meeting_id

        results = self.db.execute(sql_query, params).fetchall()

        # return list of tuples: (embedding_id, chunk_text, similarity, created_dt)
        return [(row[0], row[1], float(row[2]) if row[2] is not None else None, row[3]) for row in results]
    
    # 임베딩 삭제
    def delete_by_meeting(self, meeting_id: str) -> int:
        """
        특정 회의의 모든 임베딩 삭제
        
        Args:
            meeting_id: 회의 ID
            
        Returns:
            삭제된 레코드 수
        """
        deleted_count = (
            self.db.query(models.Embedding)
            .filter(models.Embedding.MEETING_ID == meeting_id)
            .delete(synchronize_session=False)
        )
        self.db.commit()
        return deleted_count