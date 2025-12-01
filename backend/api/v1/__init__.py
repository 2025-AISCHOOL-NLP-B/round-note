from fastapi import APIRouter

from .auth.endpoints import router as auth_router
from .meetings.endpoints import router as meetings_router
from .realtime.endpoints import router as realtime_router
from .chatbot.endpoints import router as chatbot_router

router = APIRouter(prefix="/v1")
router.include_router(auth_router)
router.include_router(meetings_router, prefix="/meetings")
router.include_router(realtime_router)
router.include_router(chatbot_router, prefix="/chatbot")
