"""SQLAlchemy models for CoCoder."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    username: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    repos: Mapped[list[Repo]] = relationship(back_populates="user")


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="sessions")


class Repo(Base):
    __tablename__ = "repos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    owner: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    clone_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    default_branch: Mapped[str] = mapped_column(String(255), default="main")
    workspace_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    index_status: Mapped[str] = mapped_column(String(64), default="pending")
    index_stats: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    last_indexed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    runs: Mapped[list[Run]] = relationship(back_populates="repo", cascade="all, delete-orphan")
    index_jobs: Mapped[list[IndexJob]] = relationship(
        back_populates="repo", cascade="all, delete-orphan"
    )
    user: Mapped[Optional[User]] = relationship(back_populates="repos")


class IndexJob(Base):
    __tablename__ = "index_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(ForeignKey("repos.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(64), default="pending")
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stats: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    repo: Mapped[Repo] = relationship(back_populates="index_jobs")


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    repo_id: Mapped[int] = mapped_column(ForeignKey("repos.id"), nullable=False)
    issue_number: Mapped[int] = mapped_column(Integer, nullable=False)
    issue_title: Mapped[str] = mapped_column(String(1024), nullable=False)
    issue_body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    issue_url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    branch_name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(64), default="queued")
    stage: Mapped[str] = mapped_column(String(64), default="queued")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    pm_output: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    architecture_output: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    planner_output: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    review_output: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    files_touched: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    completed_task_ids: Mapped[Optional[list[str]]] = mapped_column(JSON, nullable=True)
    checkpoint_stage: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    execution_seconds: Mapped[int] = mapped_column(Integer, default=0)
    attempt_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    repo: Mapped[Repo] = relationship(back_populates="runs")
    events: Mapped[list[RunEvent]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="RunEvent.created_at"
    )
    pull_request: Mapped[Optional[PullRequest]] = relationship(
        back_populates="run", uselist=False, cascade="all, delete-orphan"
    )


class RunEvent(Base):
    __tablename__ = "run_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), nullable=False)
    stage: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    run: Mapped[Run] = relationship(back_populates="events")


class PullRequest(Base):
    __tablename__ = "pull_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"), unique=True, nullable=False)
    number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    url: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    title: Mapped[str] = mapped_column(String(1024), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(64), default="open")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    run: Mapped[Run] = relationship(back_populates="pull_request")


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"
    __table_args__ = (UniqueConstraint("delivery_id", name="uq_webhook_delivery_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    delivery_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    processed: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
