from fastapi import APIRouter

from app.modules.security.routers import (
    assets,
    auth,
    security_events,
    statistics,
    users,
    vulnerabilities,
)


router = APIRouter()
router.include_router(auth.router)
router.include_router(users.router)
router.include_router(assets.router)
router.include_router(vulnerabilities.router)
router.include_router(security_events.router)
router.include_router(statistics.router)
