"""Background run executor."""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from db.models import Run
from db.session import async_session_factory
from orchestrator.pipeline import PipelineState, run_pipeline

logger = logging.getLogger(__name__)


async def execute_run(run_id: int) -> None:
    async with async_session_factory() as session:
        result = await session.execute(
            select(Run).where(Run.id == run_id).options(selectinload(Run.repo))
        )
        run = result.scalar_one_or_none()
        if not run:
            logger.error("Run %s not found", run_id)
            return
        repo = run.repo
        resume = bool(
            run.pm_output
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
            "repo_full_name": repo.full_name,
            "owner": repo.owner,
            "name": repo.name,
            "workspace": repo.workspace_path,
            "default_branch": repo.default_branch,
            "clone_url": repo.clone_url,
            "repo_db_id": repo.id,
            "branch_name": run.branch_name,
            "resume": resume,
            "index_status": repo.index_status or "",
            "completed_task_ids": list(run.completed_task_ids or []),
            "files_touched": list(run.files_touched or []),
        }
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

    await run_pipeline(state)
