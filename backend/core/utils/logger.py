# Production-ready logger utility
import logging
import sys
import os
from pathlib import Path
from logging.handlers import RotatingFileHandler
from pythonjsonlogger import jsonlogger


class ProductionLogger:
    """
    Production-ready logger with:
    - JSON formatting for easy parsing
    - File rotation to manage disk space
    - Separate error log file
    - Environment-based configuration
    - Ready for ELK/CloudWatch/Datadog integration
    """
    
    @staticmethod
    def setup_logger(
        name: str,
        level: int = logging.INFO,
        log_dir: str = "logs",
        enable_file_logging: bool = True,
        enable_error_file: bool = True
    ):
        """
        Create a production-ready logger
        
        Args:
            name: Logger name (usually __name__)
            level: Logging level (default: INFO)
            log_dir: Directory for log files (default: "logs")
            enable_file_logging: Enable file logging (default: True)
            enable_error_file: Enable separate error log file (default: True)
            
        Returns:
            configured logger instance
        """
        logger = logging.getLogger(name)
        
        # Prevent duplicate handlers
        if logger.handlers:
            return logger
        
        logger.setLevel(level)
        logger.propagate = False
        
        # JSON Formatter for structured logging
        formatter = jsonlogger.JsonFormatter(
            fmt='%(asctime)s %(name)s %(levelname)s %(message)s %(pathname)s %(lineno)d',
            datefmt='%Y-%m-%dT%H:%M:%SZ'
        )
        
        # 1. Console Handler (Always enabled for development)
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        console_handler.setLevel(level)
        logger.addHandler(console_handler)
        
        # 2. File Handler with Rotation (Production)
        if enable_file_logging:
            log_path = Path(log_dir)
            log_path.mkdir(parents=True, exist_ok=True)
            
            # All logs
            file_handler = RotatingFileHandler(
                log_path / "app.log",
                maxBytes=10 * 1024 * 1024,  # 10MB
                backupCount=5,  # Keep 5 backup files
                encoding='utf-8'
            )
            file_handler.setFormatter(formatter)
            file_handler.setLevel(level)
            logger.addHandler(file_handler)
        
        # 3. Error-only File Handler (Critical issues)
        if enable_error_file:
            log_path = Path(log_dir)
            log_path.mkdir(parents=True, exist_ok=True)
            
            error_handler = RotatingFileHandler(
                log_path / "error.log",
                maxBytes=10 * 1024 * 1024,  # 10MB
                backupCount=10,  # Keep more error logs
                encoding='utf-8'
            )
            error_handler.setFormatter(formatter)
            error_handler.setLevel(logging.ERROR)  # Only ERROR and above
            logger.addHandler(error_handler)
        
        return logger


# Convenience function with environment-based configuration
def setup_logger(name: str):
    """
    Easy setup with automatic environment detection
    
    Usage:
        from backend.core.utils.logger import setup_logger
        
        logger = setup_logger(__name__)
        logger.info("Meeting created", extra={
            "meeting_id": meeting.id,
            "user_id": user.id
        })
    """
    env = os.getenv("ENVIRONMENT", "development")
    
    return ProductionLogger.setup_logger(
        name=name,
        level=logging.DEBUG if env == "development" else logging.INFO,
        enable_file_logging=env == "production",
        enable_error_file=True
    )
