"""Background run executor."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from api.services import append_run_event
from db.models import Run
from db.session import async_session_factory
from orchestrator.pipeline import PipelineState, finish_gitops, run_pipeline
from tools.github.credentials import resolve_github_token

logger = logging.getLogger(__name__)

RunPhase = Literal["full", "gitops"]

_background_tasks: set[asyncio.Task[None]] = set()


def is_run_in_flight(run_id: int) -> bool:
    name = f"cocoder-run-{run_id}"
    return any(not t.done() and t.get_name() == name for t in _background_tasks)


def _state_from_run(run: Run) -> PipelineState:
    repo = run.repo
    resume = bool(
        run.gitops_output
        or run.pm_output
        or run.architecture_output
        or run.planner_output
        or run.completed_task_ids
        or run.checkpoint_stage
    )
    state: PipelineState = {
        "run_id": run.id,
        "issue_title": run.issue_title,
        "issue_body": run.issue_body or "",
        "issue_number": run.issue_number,
        "issue_labels": list(run.issue_labels or []),
        "repo_full_name": repo.full_name,
        "owner": repo.owner,
        "name": repo.name,
        "workspace": repo.workspace_path,
        "default_branch": repo.default_branch,
        "clone_url": repo.clone_url,
        "repo_db_id": repo.id,
        "user_id": repo.user_id,
        "github_token": resolve_github_token(repo.user_id),
        "branch_name": run.branch_name,
        "resume": resume,
        "index_status": repo.index_status or "",
        "completed_task_ids": list(run.completed_task_ids or []),
        "files_touched": list(run.files_touched or []),
    }
    if run.gitops_output:
        state["gitops"] = run.gitops_output
    if run.pm_output:
        state["pm"] = run.pm_output
    if run.architecture_output:
        state["architecture"] = run.architecture_output
    if run.planner_output:
        state["planner"] = run.planner_output
    if run.review_output:
        state["review"] = run.review_output
    if run.checkpoint_stage:
        state["checkpoint_stage"] = run.checkpoint_stage
    return state


async def _fail_stuck_run(run_id: int, error: str) -> None:
    async with async_session_factory() as session:
        result = await session.execute(select(Run).where(Run.id == run_id))
        run = result.scalar_one_or_none()
        if not run or run.status not in {"queued", "running"}:
            return
        run.status = "failed"
        run.stage = "failed"
        run.error = error
        run.finished_at = datetime.now(timezone.utc)
        await append_run_event(session, run, stage="failed", message=f"Pipeline error: {error}")
        await session.commit()


async def execute_run(run_id: int, phase: RunPhase = "full") -> None:
    async with async_session_factory() as session:
        result = await session.execute(
            select(Run).where(Run.id == run_id).options(selectinload(Run.repo))
        )
        run = result.scalar_one_or_none()
        if not run:
            logger.error("Run %s not found", run_id)
            return
        if phase == "gitops":
            allowed = run.status == "awaiting_push" or (
                run.status == "running" and run.stage == "gitops"
            )
            if not allowed:
                logger.error(
                    "Refusing gitops for run %s (status=%s stage=%s)",
                    run_id,
                    run.status,
                    run.stage,
                )
                return
        state = _state_from_run(run)

    if phase == "gitops":
        await finish_gitops(state)
        return
    await run_pipeline(state)


async def _guarded_execute(run_id: int, phase: RunPhase) -> None:
    try:
        await execute_run(run_id, phase)
    except Exception as exc:
        logger.exception("execute_run crashed for run %s", run_id)
        await _fail_stuck_run(run_id, str(exc))


def schedule_execute_run(run_id: int, phase: RunPhase = "full") -> None:
    """Start a pipeline on the event loop, independent of the HTTP request."""
    task = asyncio.create_task(_guarded_execute(run_id, phase), name=f"cocoder-run-{run_id}")
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
