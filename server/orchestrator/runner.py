"""Background run executor."""

from __future__ import annotations

import logging
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from db.models import Run
from db.session import async_session_factory
from orchestrator.pipeline import PipelineState, finish_gitops, run_pipeline
from tools.github.credentials import resolve_github_token

logger = logging.getLogger(__name__)

RunPhase = Literal["full", "gitops"]


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
