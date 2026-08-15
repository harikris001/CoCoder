"""Run listing, detail, diff, retry, and websocket event stream."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect
from git import Repo as GitRepo
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.events import event_bus
from api.auth import get_current_user, user_from_token
from api.schemas import DiffOut, RunOut, RunSummaryOut
from api.services import append_run_event, load_run
from config import get_settings
from db.models import Repo, Run, User
from db.session import async_session_factory, get_db
from tools.github.git_ops import get_diff

router = APIRouter(prefix="/runs", tags=["runs"])


class RequestChangesBody(BaseModel):
    comment: str | None = Field(default=None, max_length=4000)


def _to_summary(run: Run) -> RunSummaryOut:
    return RunSummaryOut(
        id=run.id,
        repo_id=run.repo_id,
        issue_number=run.issue_number,
        issue_title=run.issue_title,
        branch_name=run.branch_name,
        status=run.status,
        stage=run.stage,
        created_at=run.created_at,
        updated_at=run.updated_at,
        pr_url=run.pull_request.url if run.pull_request else None,
        repo_full_name=run.repo.full_name if run.repo else None,
    )


def _to_detail(run: Run) -> RunOut:
    return RunOut(
        id=run.id,
        repo_id=run.repo_id,
        issue_number=run.issue_number,
        issue_title=run.issue_title,
        issue_body=run.issue_body,
        issue_url=run.issue_url,
        issue_labels=run.issue_labels,
        branch_name=run.branch_name,
        status=run.status,
        stage=run.stage,
        error=run.error,
        gitops_output=run.gitops_output,
        pm_output=run.pm_output,
        architecture_output=run.architecture_output,
        planner_output=run.planner_output,
        review_output=run.review_output,
        files_touched=run.files_touched,
        completed_task_ids=run.completed_task_ids,
        checkpoint_stage=run.checkpoint_stage,
        execution_seconds=run.execution_seconds or 0,
        attempt_started_at=run.attempt_started_at,
        retry_count=run.retry_count,
        created_at=run.created_at,
        updated_at=run.updated_at,
        finished_at=run.finished_at,
        pull_request=run.pull_request,
        events=list(run.events or []),
        repo_full_name=run.repo.full_name if run.repo else None,
    )


@router.get("", response_model=list[RunSummaryOut])
async def list_runs(
    repo_id: int | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RunSummaryOut]:
    stmt = (
        select(Run)
        .join(Repo, Repo.id == Run.repo_id)
        .options(selectinload(Run.pull_request), selectinload(Run.repo))
        .where(Repo.user_id == user.id)
        .order_by(Run.created_at.desc())
        .limit(100)
    )
    if repo_id is not None:
        stmt = stmt.where(Run.repo_id == repo_id)
    if status is not None:
        stmt = stmt.where(Run.status == status)
    result = await db.execute(stmt)
    return [_to_summary(r) for r in result.scalars().all()]


@router.get("/{run_id}", response_model=RunOut)
async def get_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RunOut:
    run = await load_run(db, run_id, user.id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _to_detail(run)


@router.get("/{run_id}/diff", response_model=DiffOut)
async def get_run_diff(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DiffOut:
    run = await load_run(db, run_id, user.id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    workspace = Path(run.repo.workspace_path)
    if not (workspace / ".git").exists():
        return DiffOut(run_id=run.id, branch_name=run.branch_name, diff="", files=[])
    git_repo = GitRepo(str(workspace))
    diff, files = get_diff(git_repo)
    return DiffOut(run_id=run.id, branch_name=run.branch_name, diff=diff, files=files)


def _next_resume_stage(run: Run) -> str:
    """First incomplete stage for resume messaging."""
    if not run.gitops_output:
        return "branch"
    if not run.pm_output:
        return "pm"
    if not run.architecture_output:
        return "architecture"
    if not run.planner_output:
        return "planner"
    return "develop"


@router.post("/{run_id}/retry")
async def retry_run(
    run_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    run = await load_run(db, run_id, user.id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status == "awaiting_push":
        raise HTTPException(
            status_code=409,
            detail="Approve, request changes, or discard this run instead of retrying",
        )
    if run.status == "discarded":
        raise HTTPException(status_code=409, detail="Discarded runs cannot be retried")
    from orchestrator.runner import is_run_in_flight, schedule_execute_run

    if run.status in {"queued", "running"} and is_run_in_flight(run_id):
        raise HTTPException(status_code=409, detail="Run is already in progress")

    resume_stage = _next_resume_stage(run)
    run.status = "queued"
    run.stage = "queued"
    run.error = None
    run.finished_at = None
    run.attempt_started_at = None
    run.retry_count = (run.retry_count or 0) + 1
    # Preserve execution_seconds, pm/architecture/planner outputs, completed_task_ids, files_touched, branch
    await append_run_event(
        db,
        run,
        stage="queued",
        message=f"Resuming from checkpoint (stage={resume_stage})",
        payload={
            "resume_stage": resume_stage,
            "checkpoint_stage": run.checkpoint_stage,
            "completed_task_ids": run.completed_task_ids or [],
        },
    )
    await db.commit()

    schedule_execute_run(run_id)
    return {"status": "queued", "run_id": run_id, "resume_stage": resume_stage}


@router.post("/{run_id}/approve")
async def approve_run(
    run_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    run = await load_run(db, run_id, user.id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "awaiting_push":
        raise HTTPException(status_code=409, detail="Run is not waiting for push approval")

    run.status = "running"
    run.stage = "gitops"
    run.error = None
    run.finished_at = None
    await append_run_event(db, run, stage="gitops", message="Human approved push and PR")
    await db.commit()

    from orchestrator.runner import schedule_execute_run

    schedule_execute_run(run_id, "gitops")
    return {"status": "queued", "run_id": run_id, "phase": "gitops"}


@router.post("/{run_id}/request-changes")
async def request_run_changes(
    run_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    body: RequestChangesBody = RequestChangesBody(),
) -> dict:
    run = await load_run(db, run_id, user.id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "awaiting_push":
        raise HTTPException(status_code=409, detail="Run is not waiting for push approval")

    comment = (body.comment or "").strip()
    review = dict(run.review_output or {})
    review["approved"] = False
    if comment:
        review["human_feedback"] = comment

    run.status = "queued"
    run.stage = "queued"
    run.error = None
    run.finished_at = None
    run.attempt_started_at = None
    run.completed_task_ids = []
    run.review_output = review
    run.checkpoint_stage = "planner"
    run.retry_count = (run.retry_count or 0) + 1
    await append_run_event(
        db,
        run,
        stage="queued",
        message="Human requested changes — resuming develop",
        payload={"comment": comment or None},
    )
    await db.commit()

    from orchestrator.runner import schedule_execute_run

    schedule_execute_run(run_id)
    return {"status": "queued", "run_id": run_id, "resume_stage": "develop"}


@router.post("/{run_id}/discard")
async def discard_run(
    run_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    run = await load_run(db, run_id, user.id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status != "awaiting_push":
        raise HTTPException(status_code=409, detail="Run is not waiting for push approval")

    run.status = "discarded"
    run.stage = "discarded"
    run.finished_at = datetime.now(timezone.utc)
    run.attempt_started_at = None
    await append_run_event(db, run, stage="discarded", message="Human discarded this run — no push")
    await db.commit()
    return {"status": "discarded", "run_id": run_id}


@router.websocket("/{run_id}/events")
async def run_events_ws(websocket: WebSocket, run_id: int) -> None:
    async with async_session_factory() as db:
        user = await user_from_token(db, websocket.cookies.get(get_settings().auth_cookie_name))
        run = await load_run(db, run_id, user.id if user else None) if user else None
    if not user or not run:
        await websocket.close(code=4401)
        return
    await websocket.accept()
    queue = await event_bus.subscribe(run_id)
    try:
        # Send a hello so the client knows the socket is live
        await websocket.send_json({"type": "subscribed", "run_id": run_id})
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=20.0)
                await websocket.send_json({"type": "event", **event})
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "ping"})
    except WebSocketDisconnect:
        pass
    finally:
        await event_bus.unsubscribe(run_id, queue)
