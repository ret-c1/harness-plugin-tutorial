from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import connect, init_db
from app.modules.memory.router import router as memory_router
from app.modules.security.router import router as security_router
from app.schemas import HealthResponse


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    if settings.jwt_secret == "dev-only-change-me-before-production":
        logger.warning("正在使用开发环境 JWT_SECRET，部署前必须更换")
    yield


app = FastAPI(
    title=settings.app_name,
    version="1.1.0",
    description=(
        "供 DeepSeek Harness 调用的模块化测试 API。包含网络安全管理与 Memory 插件"
        "联调接口，并通过 Bearer Token 识别用户和隔离数据。"
    ),
    lifespan=lifespan,
    openapi_tags=[
        {"name": "认证", "description": "登录、当前用户和修改密码"},
        {"name": "用户管理", "description": "用户信息与角色管理"},
        {"name": "资产管理", "description": "网络安全资产 CRUD 和关联风险查询"},
        {"name": "漏洞管理", "description": "漏洞 CRUD 与资产关联"},
        {"name": "安全事件管理", "description": "安全事件 CRUD 与资产关联"},
        {"name": "统计场景", "description": "责任人覆盖、处置状态和等级分布"},
        {"name": "User Memory", "description": "按登录用户隔离的跨项目记忆"},
        {"name": "Project Memory", "description": "按登录用户和项目共同隔离的项目记忆"},
        {"name": "Task History", "description": "按登录用户隔离的任务执行历史"},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=settings.cors_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
app.include_router(security_router, prefix=API_PREFIX)
app.include_router(memory_router, prefix=API_PREFIX)


@app.get("/health", response_model=HealthResponse, tags=["系统"], summary="健康检查")
def health() -> HealthResponse:
    connection = connect()
    try:
        connection.execute("SELECT 1").fetchone()
    finally:
        connection.close()
    return HealthResponse(status="ok", database="ok")


@app.get("/", include_in_schema=False)
def root() -> dict[str, str]:
    return {
        "service": settings.app_name,
        "version": "1.1.0",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "health": "/health",
    }
