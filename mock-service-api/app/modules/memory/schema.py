SCHEMA = """
CREATE TABLE IF NOT EXISTS user_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    memory_key TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, memory_key)
);

CREATE TABLE IF NOT EXISTS project_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    memory_key TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, project_id, memory_key)
);

CREATE TABLE IF NOT EXISTS task_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    project_id TEXT,
    session_id TEXT,
    title TEXT NOT NULL,
    task_input TEXT NOT NULL,
    task_output TEXT,
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
    ),
    started_at TEXT NOT NULL,
    completed_at TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (user_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_user_memories_user_updated
    ON user_memories(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_memories_user_project_updated
    ON project_memories(user_id, project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_history_user_started
    ON task_history(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_history_user_project_started
    ON task_history(user_id, project_id, started_at DESC);
"""
