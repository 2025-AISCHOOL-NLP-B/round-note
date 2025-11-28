"""Settings management endpoints for integrations."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import ulid
import json
import requests

from backend.dependencies import get_db, get_current_user
from backend import models
from backend.core.auth.encryption import encrypt_data, decrypt_data
from backend.core.integrations import JiraService, NotionService


router = APIRouter(prefix="/settings", tags=["Settings"])


# ==================== Pydantic Schemas ====================

class JiraSettingsIn(BaseModel):
    """Jira settings input schema."""
    base_url: str
    email: str
    api_token: str
    default_project_key: Optional[str] = None


class JiraSettingsOut(BaseModel):
    """Jira settings output schema (without sensitive data)."""
    base_url: str
    email: str
    default_project_key: Optional[str] = None
    is_active: bool
    created_dt: str
    updated_dt: Optional[str] = None


class NotionSettingsIn(BaseModel):
    """Notion settings input schema - API Token만 저장"""
    api_token: str


class NotionTokenRequest(BaseModel):
    """Notion token request for searching pages/databases."""
    api_token: str


class NotionSettingsOut(BaseModel):
    """Notion settings output schema (without sensitive data)."""
    is_active: bool
    created_dt: str
    updated_dt: Optional[str] = None


# ==================== Endpoints ====================

@router.post("/jira", status_code=status.HTTP_201_CREATED)
async def save_jira_settings(
    settings: JiraSettingsIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Save or update Jira integration settings for a user.
    
    Encrypts sensitive data (API token) before storing in database.
    """
    user_id = current_user.USER_ID
    try:
        # Test Jira connection before saving
        jira = JiraService(
            base_url=settings.base_url,
            email=settings.email,
            api_token=settings.api_token,
            project_key=settings.default_project_key
        )
        
        # Validate connection by fetching projects
        try:
            projects = jira.get_projects()
            projects_count = len(projects) if projects else 0
            
            # 프로젝트가 없어도 연결 성공이면 허용 (경고만 출력)
            if projects_count == 0:
                print("[WARNING] No projects found, but connection succeeded. User may have limited permissions.")
        except requests.exceptions.HTTPError as e:
            # HTTP 에러는 연결 실패로 간주
            error_detail = f"Jira API error {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "errorMessages" in error_json:
                    error_detail += f": {', '.join(error_json['errorMessages'])}"
                elif "message" in error_json:
                    error_detail += f": {error_json['message']}"
            except:
                error_detail += f": {e.response.text[:200]}"
            
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_detail
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to connect to Jira: {str(e)}"
            )
        
        # Encrypt sensitive data
        encrypted_config = {
            "base_url": settings.base_url,
            "email": settings.email,
            "api_token": encrypt_data(settings.api_token),  # Encrypt API token
            "default_project_key": settings.default_project_key
        }
        
        # Check if settings already exist
        existing = db.query(models.UserIntegrationSetting).filter(
            models.UserIntegrationSetting.USER_ID == user_id,
            models.UserIntegrationSetting.PLATFORM == "jira"
        ).first()
        
        if existing:
            # Update existing settings
            existing.CONFIG = encrypted_config
            existing.IS_ACTIVE = 'Y'
            db.commit()
            db.refresh(existing)
            
            return {
                "message": "Jira settings updated successfully",
                "projects_found": projects_count
            }
        else:
            # Create new settings
            new_setting = models.UserIntegrationSetting(
                INTEGRATION_ID=str(ulid.new()),
                USER_ID=user_id,
                PLATFORM="jira",
                CONFIG=encrypted_config,
                IS_ACTIVE='Y'
            )
            db.add(new_setting)
            db.commit()
            db.refresh(new_setting)
            
            return {
                "message": "Jira settings saved successfully",
                "projects_found": projects_count
            }
            
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save Jira settings: {str(e)}"
        )


@router.get("/jira", response_model=JiraSettingsOut)
async def get_jira_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Retrieve Jira settings for a user (without API token).
    """
    user_id = current_user.USER_ID
    setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "jira"
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Jira settings not found. Please configure Jira integration first."
        )
    
    config = setting.CONFIG
    
    return JiraSettingsOut(
        base_url=config.get("base_url", ""),
        email=config.get("email", ""),
        default_project_key=config.get("default_project_key"),
        is_active=setting.IS_ACTIVE == 'Y',
        created_dt=setting.CREATED_DT.isoformat() if setting.CREATED_DT else "",
        updated_dt=setting.UPDATED_DT.isoformat() if setting.UPDATED_DT else None
    )


@router.delete("/jira", status_code=status.HTTP_200_OK)
async def delete_jira_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Delete Jira integration settings for a user.
    """
    user_id = current_user.USER_ID
    setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "jira"
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Jira settings not found"
        )
    
    db.delete(setting)
    db.commit()
    
    return {"message": "Jira settings deleted successfully"}


@router.get("/jira/projects")
async def get_jira_projects(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Get list of Jira projects accessible to the user.
    """
    user_id = current_user.USER_ID
    # Retrieve user's Jira settings
    setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "jira"
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Jira not configured. Please set up Jira integration in settings."
        )
    
    try:
        config = setting.CONFIG
        
        # Decrypt API token
        decrypted_token = decrypt_data(config["api_token"])
        
        # Initialize Jira service
        jira = JiraService(
            base_url=config["base_url"],
            email=config["email"],
            api_token=decrypted_token,
            project_key=config.get("default_project_key")
        )
        
        # Fetch projects
        projects = jira.get_projects()
        
        return {
            "projects": projects,
            "default_project_key": config.get("default_project_key")
        }
        
    except requests.exceptions.RequestException as e:
        # Network/HTTP errors from Jira API
        error_detail = f"Jira API request failed: {str(e)}"
        if hasattr(e, 'response') and e.response is not None:
            error_detail += f" (Status: {e.response.status_code})"
            try:
                error_json = e.response.json()
                if "errorMessages" in error_json:
                    error_detail += f" - {', '.join(error_json['errorMessages'])}"
            except:
                pass
        print(f"[ERROR] {error_detail}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_detail
        )
    except Exception as e:
        # Other errors (decryption, parsing, etc.)
        error_detail = f"Failed to fetch Jira projects: {type(e).__name__}: {str(e)}"
        print(f"[ERROR] {error_detail}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch Jira projects: {str(e)}"
        )


@router.get("/jira/projects/{project_key}/users")
async def get_jira_project_users(
    project_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Get assignable users for a Jira project.
    """
    user_id = current_user.USER_ID
    
    # Retrieve user's Jira settings
    setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "jira"
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Jira not configured"
        )
    
    try:
        config = setting.CONFIG
        decrypted_token = decrypt_data(config["api_token"])
        
        jira = JiraService(
            base_url=config["base_url"],
            email=config["email"],
            api_token=decrypted_token,
            project_key=project_key
        )
        
        users = jira.get_project_assignable_users(project_key)
        
        return {"users": users}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch Jira users: {str(e)}"
        )


@router.get("/jira/projects/{project_key}/priorities")
async def get_jira_project_priorities(
    project_key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Get available priorities for a Jira project.
    """
    user_id = current_user.USER_ID
    
    # Retrieve user's Jira settings
    setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "jira"
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Jira not configured"
        )
    
    try:
        config = setting.CONFIG
        decrypted_token = decrypt_data(config["api_token"])
        
        jira = JiraService(
            base_url=config["base_url"],
            email=config["email"],
            api_token=decrypted_token,
            project_key=project_key
        )
        
        priorities = jira.get_project_priorities(project_key)
        
        return {"priorities": priorities}
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch Jira priorities: {str(e)}"
        )


# ==================== Notion Settings Endpoints ====================

@router.post("/notion", status_code=status.HTTP_201_CREATED)
async def save_notion_settings(
    settings: NotionSettingsIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Save or update Notion integration settings for a user.
    
    Encrypts sensitive data (API token) before storing in database.
    """
    user_id = current_user.USER_ID
    print(f"[DEBUG] Received Notion settings: {settings}")
    print(f"[DEBUG] User ID: {user_id}")
    try:
        # Test Notion connection before saving (API 토큰만 검증)
        notion = NotionService(
            api_token=settings.api_token,
            parent_page_id=None,
            database_id=None
        )
        
        # Validate connection by making a simple API call
        try:
            # Test API call - get user info
            test_url = f"{notion.base_url}/users/me"
            resp = requests.get(test_url, headers=notion.headers)
            resp.raise_for_status()
            user_info = resp.json()
            print(f"[INFO] Notion connection successful for user: {user_info.get('name', 'Unknown')}")
        except requests.exceptions.HTTPError as e:
            error_detail = f"Notion API error {e.response.status_code}"
            try:
                error_json = e.response.json()
                if "message" in error_json:
                    error_detail += f": {error_json['message']}"
            except:
                error_detail += f": {e.response.text[:200]}"
            
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_detail
            )
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Failed to connect to Notion: {str(e)}"
            )
        
        # Encrypt sensitive data (API Token만 저장)
        encrypted_config = {
            "api_token": encrypt_data(settings.api_token)  # Encrypt API token
        }
        
        # Check if settings already exist
        existing = db.query(models.UserIntegrationSetting).filter(
            models.UserIntegrationSetting.USER_ID == user_id,
            models.UserIntegrationSetting.PLATFORM == "notion"
        ).first()
        
        if existing:
            # Update existing settings
            existing.CONFIG = encrypted_config
            existing.IS_ACTIVE = 'Y'
            db.commit()
            db.refresh(existing)
            
            return {"message": "Notion settings updated successfully"}
        else:
            # Create new settings
            new_setting = models.UserIntegrationSetting(
                INTEGRATION_ID=str(ulid.new()),
                USER_ID=user_id,
                PLATFORM="notion",
                CONFIG=encrypted_config,
                IS_ACTIVE='Y'
            )
            db.add(new_setting)
            db.commit()
            db.refresh(new_setting)
            
            return {"message": "Notion settings saved successfully"}
            
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception in save_notion_settings: {str(e)}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save Notion settings: {str(e)}"
        )


@router.get("/notion", response_model=NotionSettingsOut)
async def get_notion_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Retrieve Notion settings for a user (without API token).
    """
    user_id = current_user.USER_ID
    setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "notion"
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notion settings not found. Please configure Notion integration first."
        )
    
    return NotionSettingsOut(
        is_active=setting.IS_ACTIVE == 'Y',
        created_dt=setting.CREATED_DT.isoformat() if setting.CREATED_DT else "",
        updated_dt=setting.UPDATED_DT.isoformat() if setting.UPDATED_DT else None
    )


@router.delete("/notion", status_code=status.HTTP_200_OK)
async def delete_notion_settings(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Delete Notion integration settings for a user.
    """
    user_id = current_user.USER_ID
    setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "notion"
    ).first()
    
    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notion settings not found"
        )
    
    db.delete(setting)
    db.commit()
    
    return {"message": "Notion settings deleted successfully"}


@router.post("/notion/pages")
async def search_notion_pages(
    request: NotionTokenRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Notion 페이지 목록 조회 (연동 전 테스트용)
    
    Request body에 api_token을 포함해야 합니다.
    """
    if not request.api_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_token is required"
        )
    
    try:
        # 임시로 NotionService 생성하여 페이지 목록 조회
        notion = NotionService(api_token=request.api_token)
        pages = notion.search_pages()
        
        return {
            "pages": pages,
            "count": len(pages)
        }
    except requests.exceptions.HTTPError as e:
        error_detail = f"Notion API error {e.response.status_code}"
        try:
            error_json = e.response.json()
            if "message" in error_json:
                error_detail += f": {error_json['message']}"
        except:
            pass
        
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch Notion pages: {str(e)}"
        )


@router.post("/notion/databases")
async def search_notion_databases(
    request: NotionTokenRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    Notion 데이터베이스 목록 조회 (연동 전 테스트용)
    
    Request body에 api_token을 포함해야 합니다.
    """
    if not request.api_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="api_token is required"
        )
    
    try:
        # 임시로 NotionService 생성하여 데이터베이스 목록 조회
        notion = NotionService(api_token=request.api_token)
        databases = notion.get_databases()
        
        return {
            "databases": databases,
            "count": len(databases)
        }
    except requests.exceptions.HTTPError as e:
        error_detail = f"Notion API error {e.response.status_code}"
        try:
            error_json = e.response.json()
            if "message" in error_json:
                error_detail += f": {error_json['message']}"
        except:
            pass
        
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch Notion databases: {str(e)}"
        )


@router.get("/notion/my-pages")
async def get_my_notion_pages(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    내 Notion 페이지 목록 조회 (연동 후 - 저장된 토큰 사용)
    """
    user_id = current_user.USER_ID
    notion_setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "notion"
    ).first()
    
    if not notion_setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notion not configured"
        )
    
    try:
        config = notion_setting.CONFIG
        print(f"[DEBUG] Config keys: {config.keys() if config else 'None'}")
        print(f"[DEBUG] Config: {config}")
        
        if not config or "api_token" not in config:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Notion configuration is invalid. Please re-configure Notion integration."
            )
        
        decrypted_token = decrypt_data(config["api_token"])
        print(f"[DEBUG] Token decrypted successfully")
        
        notion = NotionService(api_token=decrypted_token)
        print(f"[DEBUG] NotionService initialized")
        
        pages = notion.search_pages(query="", include_workspace=True)
        print(f"[DEBUG] Found {len(pages)} pages")
        
        return {
            "pages": pages,
            "count": len(pages)
        }
    except requests.exceptions.HTTPError as e:
        error_detail = f"Notion API error {e.response.status_code}"
        try:
            error_json = e.response.json()
            if "message" in error_json:
                error_detail += f": {error_json['message']}"
        except:
            error_detail += f": {e.response.text[:200]}"
        
        print(f"[ERROR] {error_detail}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to fetch Notion pages: {type(e).__name__}: {str(e)}"
        print(f"[ERROR] {error_detail}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_detail
        )


@router.get("/notion/my-databases")
async def get_my_notion_databases(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user)
):
    """
    내 Notion 데이터베이스 목록 조회 (연동 후 - 저장된 토큰 사용)
    """
    user_id = current_user.USER_ID
    notion_setting = db.query(models.UserIntegrationSetting).filter(
        models.UserIntegrationSetting.USER_ID == user_id,
        models.UserIntegrationSetting.PLATFORM == "notion"
    ).first()
    
    if not notion_setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notion not configured"
        )
    
    try:
        config = notion_setting.CONFIG
        decrypted_token = decrypt_data(config["api_token"])
        
        notion = NotionService(api_token=decrypted_token)
        databases = notion.get_databases()
        
        return {
            "databases": databases,
            "count": len(databases)
        }
    except requests.exceptions.HTTPError as e:
        error_detail = f"Notion API error {e.response.status_code}"
        try:
            error_json = e.response.json()
            if "message" in error_json:
                error_detail += f": {error_json['message']}"
        except:
            error_detail += f": {e.response.text[:200]}"
        
        print(f"[ERROR] {error_detail}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_detail
        )
    except Exception as e:
        import traceback
        error_detail = f"Failed to fetch Notion databases: {type(e).__name__}: {str(e)}"
        print(f"[ERROR] {error_detail}")
        print(f"[ERROR] Traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=error_detail
        )
