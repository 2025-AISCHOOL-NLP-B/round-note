"""
User-friendly error messages for API failures

This module provides consistent, localized error messages
for various service failures throughout the application.
"""


class ErrorMessages:
    """
    Centralized error messages in Korean
    
    These messages are shown to users when services fail
    after all retry attempts are exhausted.
    """
    
    # ==================== STT Errors ====================
    STT_TRANSCRIPTION_FAILED = "음성을 인식할 수 없습니다. 다시 시도해주세요."
    STT_SERVICE_UNAVAILABLE = "음성 인식 서비스에 일시적인 문제가 있습니다."
    STT_INVALID_AUDIO = "오디오 파일 형식이 올바르지 않습니다."
    STT_AUDIO_TOO_LARGE = "오디오 파일이 너무 큽니다. (최대 100MB)"
    
    # ==================== LLM Errors ====================
    LLM_SUMMARY_FAILED = "요약을 생성할 수 없습니다. 잠시 후 다시 시도해주세요."
    LLM_ANALYSIS_FAILED = "분석을 완료할 수 없습니다. 잠시 후 다시 시도해주세요."
    LLM_SERVICE_UNAVAILABLE = "AI 분석 서비스에 일시적인 문제가 있습니다."
    LLM_RATE_LIMIT = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
    LLM_INVALID_INPUT = "입력 내용이 너무 길거나 형식이 올바르지 않습니다."
    
    # ==================== Integration Errors ====================
    JIRA_INTEGRATION_FAILED = "Jira 연동에 실패했습니다. 설정을 확인해주세요."
    JIRA_AUTH_FAILED = "Jira 인증에 실패했습니다. API 토큰을 확인해주세요."
    JIRA_CREATE_ISSUE_FAILED = "Jira 이슈 생성에 실패했습니다."
    
    NOTION_INTEGRATION_FAILED = "Notion 연동에 실패했습니다. 설정을 확인해주세요."
    NOTION_AUTH_FAILED = "Notion 인증에 실패했습니다. API 키를 확인해주세요."
    NOTION_CREATE_PAGE_FAILED = "Notion 페이지 생성에 실패했습니다."
    
    GOOGLE_CALENDAR_FAILED = "Google Calendar 연동에 실패했습니다."
    GOOGLE_CALENDAR_AUTH_FAILED = "Google Calendar 인증에 실패했습니다."
    
    # ==================== Storage Errors ====================
    STORAGE_UPLOAD_FAILED = "파일 업로드에 실패했습니다. 다시 시도해주세요."
    STORAGE_DOWNLOAD_FAILED = "파일 다운로드에 실패했습니다."
    STORAGE_DELETE_FAILED = "파일 삭제에 실패했습니다."
    STORAGE_SERVICE_UNAVAILABLE = "저장소 서비스에 일시적인 문제가 있습니다."
    
    # ==================== Database Errors ====================
    DB_CONNECTION_FAILED = "데이터베이스 연결에 실패했습니다."
    DB_QUERY_FAILED = "데이터 조회에 실패했습니다."
    DB_UPDATE_FAILED = "데이터 업데이트에 실패했습니다."
    
    # ==================== Generic Errors ====================
    SERVICE_TEMPORARILY_UNAVAILABLE = "서비스에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요."
    NETWORK_ERROR = "네트워크 연결을 확인해주세요."
    TIMEOUT_ERROR = "요청 시간이 초과되었습니다. 다시 시도해주세요."
    UNKNOWN_ERROR = "알 수 없는 오류가 발생했습니다. 관리자에게 문의해주세요."


class ErrorResponse:
    """
    Structured error response format
    
    Usage:
        return ErrorResponse.create(
            success=False,
            message=ErrorMessages.STT_TRANSCRIPTION_FAILED,
            error_code="STT_001"
        )
    """
    
    @staticmethod
    def create(
        success: bool = False,
        message: str = ErrorMessages.UNKNOWN_ERROR,
        error_code: str = None,
        data: dict = None
    ) -> dict:
        """
        Create standardized error response
        
        Args:
            success: Operation success status
            message: User-friendly error message
            error_code: Optional error code for debugging
            data: Optional additional data
            
        Returns:
            Structured error response dictionary
        """
        response = {
            "success": success,
            "message": message
        }
        
        if error_code:
            response["error_code"] = error_code
            
        if data:
            response["data"] = data
            
        return response
