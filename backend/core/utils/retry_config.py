"""
Retry configuration with environment-based settings

This module provides configurable retry decorators for external API calls.
Retry behavior can be customized via environment variables.
"""

import os
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    RetryError
)
from requests.exceptions import RequestException, Timeout
from httpx import HTTPError, TimeoutException
from backend.core.utils.logger import setup_logger

logger = setup_logger(__name__)


class RetryConfig:
    """
    Environment-configurable retry settings
    
    Environment variables:
    - RETRY_MAX_ATTEMPTS: Maximum number of retry attempts (default: 3)
    - RETRY_MIN_WAIT_SECONDS: Minimum wait time between retries (default: 2)
    - RETRY_MAX_WAIT_SECONDS: Maximum wait time between retries (default: 10)
    - RETRY_MULTIPLIER: Exponential backoff multiplier (default: 1)
    """
    
    MAX_ATTEMPTS = int(os.getenv("RETRY_MAX_ATTEMPTS", "3"))
    MIN_WAIT = int(os.getenv("RETRY_MIN_WAIT_SECONDS", "2"))
    MAX_WAIT = int(os.getenv("RETRY_MAX_WAIT_SECONDS", "10"))
    MULTIPLIER = int(os.getenv("RETRY_MULTIPLIER", "1"))


def create_api_retry_decorator(service_name: str):
    """
    Create a retry decorator with logging and service-specific configuration
    
    Args:
        service_name: Name of the service (e.g., "STT", "LLM", "Integration")
        
    Returns:
        Configured retry decorator
        
    Usage:
        @create_api_retry_decorator("STT")
        async def transcribe(audio):
            # API call that may fail
            return await deepgram.transcribe(audio)
    """
    def log_retry(retry_state):
        """Log retry attempts with structured data"""
        logger.warning(
            f"Retrying {service_name} API call",
            extra={
                "service": service_name,
                "attempt": retry_state.attempt_number,
                "wait_seconds": retry_state.next_action.sleep if retry_state.next_action else 0,
                "exception": str(retry_state.outcome.exception()) if retry_state.outcome else None
            }
        )
    
    return retry(
        stop=stop_after_attempt(RetryConfig.MAX_ATTEMPTS),
        wait=wait_exponential(
            multiplier=RetryConfig.MULTIPLIER,
            min=RetryConfig.MIN_WAIT,
            max=RetryConfig.MAX_WAIT
        ),
        retry=retry_if_exception_type((
            RequestException,
            Timeout,
            TimeoutException,
            HTTPError,
            ConnectionError
        )),
        before_sleep=log_retry,
        reraise=True  # Re-raise exception after all retries exhausted
    )


# Pre-configured decorators for common services
api_retry_stt = create_api_retry_decorator("STT")
api_retry_llm = create_api_retry_decorator("LLM")
api_retry_integration = create_api_retry_decorator("Integration")
api_retry_storage = create_api_retry_decorator("Storage")
