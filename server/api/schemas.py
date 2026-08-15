"""Pydantic schemas for API responses."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class UserOut(BaseModel):
    id: int
    email: str
    display_name: str
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SignUpRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=72)


class SignInRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=72)


class RepoCreate(BaseModel):
    owner: str
    name: str
    clone_url: Optional[str] = None
    default_branch: str = "main"


class RepoOut(BaseModel):
    id: int
    owner: str
    name: str
    full_name: str
    clone_url: str
    default_branch: str
    workspace_path: str
    index_status: str
    index_stats: Optional[dict[str, Any]] = None
    last_indexed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class IndexStatusOut(BaseModel):
    repo_id: int
    status: str
    stats: Optional[dict[str, Any]] = None
    last_indexed_at: Optional[datetime] = None
    recent_jobs: list[dict[str, Any]] = Field(default_factory=list)


class RunEventOut(BaseModel):
    id: int
    stage: str
    message: str
    payload: Optional[dict[str, Any]] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PullRequestOut(BaseModel):
    id: int
    number: Optional[int] = None
    url: Optional[str] = None
    title: str
    body: Optional[str] = None
    state: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RunOut(BaseModel):
    id: int
    repo_id: int
    issue_number: int
    issue_title: str
    issue_body: Optional[str] = None
    issue_url: Optional[str] = None
    issue_labels: Optional[list[str]] = None
    branch_name: str
    status: str
    stage: str
    error: Optional[str] = None
    gitops_output: Optional[dict[str, Any]] = None
    pm_output: Optional[dict[str, Any]] = None
    architecture_output: Optional[dict[str, Any]] = None
    planner_output: Optional[dict[str, Any]] = None
    test_output: Optional[dict[str, Any]] = None
    review_output: Optional[dict[str, Any]] = None
    files_touched: Optional[list[str]] = None
    completed_task_ids: Optional[list[str]] = None
    checkpoint_stage: Optional[str] = None
    execution_seconds: int = 0
    attempt_started_at: Optional[datetime] = None
    retry_count: int
    created_at: datetime
    updated_at: datetime
    finished_at: Optional[datetime] = None
    pull_request: Optional[PullRequestOut] = None
    events: list[RunEventOut] = Field(default_factory=list)
    repo_full_name: Optional[str] = None

    model_config = {"from_attributes": True}


class RunSummaryOut(BaseModel):
    id: int
    repo_id: int
    issue_number: int
    issue_title: str
    branch_name: str
    status: str
    stage: str
    created_at: datetime
    updated_at: datetime
    pr_url: Optional[str] = None
    repo_full_name: Optional[str] = None

    model_config = {"from_attributes": True}


class DiffOut(BaseModel):
    run_id: int
    branch_name: str
    diff: str
    files: list[str] = Field(default_factory=list)
