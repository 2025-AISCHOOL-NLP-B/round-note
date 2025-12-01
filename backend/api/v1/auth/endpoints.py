from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from backend.database import get_db
from backend.dependencies import get_current_user
from backend.schemas import user as user_schema
from backend.crud import user as user_crud
from backend.core.auth import security
from backend import models
from authlib.integrations.starlette_client import OAuth
import os
from backend.core.utils.logger import setup_logger

logger = setup_logger(__name__)

def get_cookie_params():
    """
    환경에 따른 쿠키 설정 반환
    Render 등 배포 환경에서는 SameSite=None, Secure=True 필수
    """
    env = os.getenv("ENVIRONMENT", "development")
    # RENDER 환경변수가 있거나 ENVIRONMENT가 production이면 배포 환경으로 간주
    is_production = env == "production" or os.getenv("RENDER") is not None
    
    return {
        "httponly": True,
        "secure": is_production,
        "samesite": "none" if is_production else "lax"
    }

router = APIRouter()

# OAuth 설정
oauth = OAuth()
oauth.register(
    name='google',
    client_id=os.getenv('GOOGLE_CLIENT_ID'),
    client_secret=os.getenv('GOOGLE_CLIENT_SECRET'),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

# -------------------------------
# 회원가입
# -------------------------------
@router.post("/register")
def register_user(user: user_schema.UserCreate, response: Response, db: Session = Depends(get_db)):
    """새로운 사용자를 등록하고 자동으로 로그인 토큰을 발급합니다."""
    logger.info("User registration attempt", extra={
        "email": user.email,
        "user_name": user.name,
        "action": "register"
    })

    # 이메일 중복 체크
    existing_user = user_crud.get_user_by_email(db, user.email)
    if existing_user:
        logger.warning("Registration failed - email already exists", extra={
            "email": user.email,
            "action": "register"
        })
        raise HTTPException(status_code=400, detail="이미 등록된 이메일입니다.")

    db_user = user_crud.create_user(db, user)
    logger.info("User created successfully", extra={
        "user_id": db_user.USER_ID,
        "email": db_user.EMAIL,
        "action": "register_success"
    })

    # 회원가입 성공 후 자동으로 토큰 발급
    token = security.create_access_token({"sub": db_user.USER_ID, "email": db_user.EMAIL})

    # httpOnly Cookie에 토큰 설정 (브라우저용)
    cookie_params = get_cookie_params()
    
    response.set_cookie(
        key="access_token",
        value=token,
        max_age=7200,  # 2시간
        **cookie_params
    )
    
    # 리프레시 토큰도 발급
    refresh_token = security.create_refresh_token({"sub": db_user.USER_ID, "email": db_user.EMAIL})
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=604800,  # 7일
        **cookie_params
    )

    # 응답 body에도 토큰 포함 (API 테스트 및 모바일 앱용)
    return {
        "message": "회원가입 성공",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": db_user.USER_ID,
            "email": db_user.EMAIL,
            "name": db_user.NAME
        }
    }

# -------------------------------
# 로그인
# -------------------------------
@router.post("/login")
def login_for_access_token(form_data: user_schema.UserLogin, response: Response, db: Session = Depends(get_db)):
    logger.info("Login attempt", extra={
        "email": form_data.email,
        "action": "login"
    })
    
    user = user_crud.authenticate_user(db, form_data.email, form_data.password)
    if not user:
        logger.warning("Login failed - invalid credentials", extra={
            "email": form_data.email,
            "action": "login"
        })
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="이메일 또는 비밀번호가 올바르지 않습니다.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = security.create_access_token({"sub": user.USER_ID, "email": user.EMAIL})
    logger.info("Login successful", extra={
        "user_id": user.USER_ID,
        "email": user.EMAIL,
        "action": "login"
    })

    # httpOnly Cookie에 토큰 설정 (브라우저용)
    cookie_params = get_cookie_params()
    
    response.set_cookie(
        key="access_token",
        value=token,
        max_age=7200,  # 2시간
        **cookie_params
    )
    
    # 리프레시 토큰도 발급
    refresh_token = security.create_refresh_token({"sub": user.USER_ID, "email": user.EMAIL})
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        max_age=604800,  # 7일
        **cookie_params
    )

    # 응답 body에도 토큰 포함 (API 테스트 및 모바일 앱용)
    return {
        "message": "로그인 성공",
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.USER_ID,
            "email": user.EMAIL,
            "name": user.NAME
        }
    }

# -------------------------------
# Google OAuth
# -------------------------------
@router.get("/google/login")
async def google_login(request: Request):
    host = request.headers.get('host', '')
    is_local = 'localhost' in host or '127.0.0.1' in host

    if is_local:
        redirect_uri = 'http://localhost:8000/api/v1/auth/google/callback'
    else:
        redirect_uri = os.getenv('GOOGLE_REDIRECT_URI', f'https://{host}/api/v1/auth/google/callback')

    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/google/callback")
async def google_callback(request: Request, db: Session = Depends(get_db)):
    try:
        token = await oauth.google.authorize_access_token(request)
        user_info = token.get('userinfo')
        if not user_info:
            raise HTTPException(status_code=400, detail="사용자 정보를 가져올 수 없습니다.")

        email = user_info.get('email')
        user_name = user_info.get('name', email.split('@')[0])

        db_user = user_crud.get_user_by_email(db, email)
        if not db_user:
            import secrets
            random_password = secrets.token_urlsafe(32)
            db_user = models.User(
                EMAIL=email,
                PW=security.get_password_hash(random_password),
                NAME=user_name,
                STATUS='A'
            )
            db.add(db_user)
            db.commit()
            db.refresh(db_user)

        access_token = security.create_access_token({"sub": db_user.USER_ID, "email": db_user.EMAIL})

        host = request.headers.get('host', '')
        is_local = 'localhost' in host or '127.0.0.1' in host
        frontend_url = 'http://localhost:3000' if is_local else os.getenv('CORS_ORIGIN', 'https://round-note-web.onrender.com')

        cookie_params = get_cookie_params()
        
        response = RedirectResponse(url=f"{frontend_url}/main")
        response.set_cookie(
            key="access_token",
            value=access_token,
            max_age=7200,  # 2시간
            **cookie_params
        )
        
        # 리프레시 토큰도 발급
        refresh_token = security.create_refresh_token({"sub": db_user.USER_ID, "email": db_user.EMAIL})
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            max_age=604800,  # 7일
            **cookie_params
        )
        
        print(f"[DEBUG] 쿠키 설정 완료 - {cookie_params}")
        return response

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Google 로그인 중 오류: {str(e)}")

# -------------------------------
# 현재 사용자 조회 (쿠키 기반 수정)
# -------------------------------
@router.get("/me", response_model=user_schema.UserOut)
def get_current_user_info(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="인증 토큰이 없습니다.")

    payload = security.verify_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰입니다.")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰에 사용자 정보가 없습니다.")

    user = user_crud.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다.")

    return user

# -------------------------------
# 토큰 갱신
# -------------------------------
@router.post("/refresh")
def refresh_access_token(request: Request, response: Response, db: Session = Depends(get_db)):
    """
    리프레시 토큰을 사용하여 새로운 액세스 토큰을 발급합니다.
    세션 중간에 토큰이 만료된 경우 클라이언트가 호출하는 엔드포인트입니다.
    """
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="리프레시 토큰이 없습니다. 다시 로그인해주세요."
        )
    
    payload = security.verify_token(refresh_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 리프레시 토큰입니다. 다시 로그인해주세요."
        )
    
    # 리프레시 토큰인지 확인
    token_type = payload.get("type")
    if token_type != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="잘못된 토큰 타입입니다."
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="토큰에 사용자 정보가 없습니다.")
    
    user = user_crud.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="사용자를 찾을 수 없습니다.")
    
    # 새로운 액세스 토큰 발급
    new_access_token = security.create_access_token({"sub": user.USER_ID, "email": user.EMAIL})
    
    cookie_params = get_cookie_params()
    response.set_cookie(
        key="access_token",
        value=new_access_token,
        max_age=7200,  # 2시간
        **cookie_params
    )
    
    logger.info("Token refreshed successfully", extra={
        "user_id": user.USER_ID,
        "email": user.EMAIL,
        "action": "refresh_token"
    })
    
    return {
        "message": "토큰이 갱신되었습니다.",
        "access_token": new_access_token,
        "token_type": "bearer"
    }

# -------------------------------
# 로그아웃
# -------------------------------
@router.post("/logout")
def logout(response: Response, current_user: models.User = Depends(get_current_user)):
    """
    사용자 로그아웃 처리 - httpOnly Cookie 삭제
    
    JWT는 stateless하므로 서버에서 토큰을 무효화할 수 없지만,
    쿠키를 삭제하여 클라이언트에서 토큰에 접근할 수 없도록 합니다.
    """
    print(f"[DEBUG] 로그아웃 - USER_ID: {current_user.USER_ID}, Email: {current_user.EMAIL}")
    
    # httpOnly Cookie 삭제 (환경에 맞게 samesite 설정)
    cookie_params = get_cookie_params()
    
    response.delete_cookie(
        key="access_token",
        httponly=True,
        secure=cookie_params["secure"],
        samesite=cookie_params["samesite"]
    )
    
    return {"message": "로그아웃되었습니다."}

# -------------------------------
# 디버그용 사용자 조회
# -------------------------------
@router.get("/users/debug")
def get_all_users_debug(db: Session = Depends(get_db)):
    users = db.query(models.User).all()
    return [
        {
            "user_id": user.USER_ID,
            "email": user.EMAIL,
            "name": user.NAME,
            "status": user.STATUS,
            "join_dt": str(user.JOIN_DT),
            "password_hash_prefix": user.PW[:10] + "..." if user.PW else None
        }
        for user in users
    ]