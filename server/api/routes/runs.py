"""Run listing, detail, diff, retry, and websocket event stream."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect
from git import Repo as GitRepo
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.events import event_bus
from api.schemas import DiffOut, RunOut, RunSummaryOut
from api.services import append_run_event, load_run
from db.models import Run
from db.session import get_db
from tools.github.git_ops import get_diff

router = APIRouter(prefix="/runs", tags=["runs"])


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
        branch_name=run.branch_name,
        status=run.status,
        stage=run.stage,
        error=run.error,
        pm_output=run.pm_output,
        architecture_output=run.architecture_output,
        planner_output=run.planner_output,
        review_output=run.review_output,
        files_touched=run.files_touched,
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
) -> list[RunSummaryOut]:
    stmt = (
        select(Run)
        .options(selectinload(Run.pull_request), selectinload(Run.repo))
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
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)) -> RunOut:
    run = await load_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return _to_detail(run)


@router.get("/{run_id}/diff", response_model=DiffOut)
async def get_run_diff(run_id: int, db: AsyncSession = Depends(get_db)) -> DiffOut:
    run = await load_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    workspace = Path(run.repo.workspace_path)
    if not (workspace / ".git").exists():
        return DiffOut(run_id=run.id, branch_name=run.branch_name, diff="", files=[])
    git_repo = GitRepo(str(workspace))
    diff, files = get_diff(git_repo)
    return DiffOut(run_id=run.id, branch_name=run.branch_name, diff=diff, files=files)


@router.post("/{run_id}/retry")
async def retry_run(
    run_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict:
    run = await load_run(db, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    run.status = "queued"
    run.stage = "queued"
    run.error = None
    await append_run_event(db, run, stage="queued", message="Run re-queued")
    await db.commit()

    from orchestrator.runner import execute_run

    background_tasks.add_task(execute_run, run_id)
    return {"status": "queued", "run_id": run_id}


@router.websocket("/{run_id}/events")
async def run_events_ws(websocket: WebSocket, run_id: int) -> None:
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
