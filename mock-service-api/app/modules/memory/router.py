from fastapi import APIRouter

from app.modules.memory import project_memories, task_history, user_memories


router = APIRouter(prefix="/memory")
router.include_router(user_memories.router)
router.include_router(project_memories.router)
router.include_router(task_history.router)
