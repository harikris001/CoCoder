"""Async SQLAlchemy session helpers."""

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from config import get_settings
from db.models import Base

settings = get_settings()
engine = create_async_engine(settings.database_url, echo=False)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Columns added after initial create_all — SQLite needs explicit ALTER TABLE.
_RUN_COLUMN_MIGRATIONS: list[tuple[str, str]] = [
    ("completed_task_ids", "JSON"),
    ("checkpoint_stage", "VARCHAR(64)"),
    ("execution_seconds", "INTEGER DEFAULT 0"),
    ("attempt_started_at", "DATETIME"),
]

_REPO_COLUMN_MIGRATIONS: list[tuple[str, str]] = [
    ("user_id", "INTEGER"),
]


async def _migrate_sqlite_columns() -> None:
    """Add missing columns on existing SQLite DBs (create_all does not alter)."""
    if "sqlite" not in settings.database_url:
        return
    async with engine.begin() as conn:
        result = await conn.execute(text("PRAGMA table_info(runs)"))
        existing = {row[1] for row in result.fetchall()}
        for column, col_type in _RUN_COLUMN_MIGRATIONS:
            if column not in existing:
                await conn.execute(text(f"ALTER TABLE runs ADD COLUMN {column} {col_type}"))

        result = await conn.execute(text("PRAGMA table_info(repos)"))
        existing = {row[1] for row in result.fetchall()}
        for column, col_type in _REPO_COLUMN_MIGRATIONS:
            if column not in existing:
                await conn.execute(text(f"ALTER TABLE repos ADD COLUMN {column} {col_type}"))


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _migrate_sqlite_columns()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
