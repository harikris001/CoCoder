"""Shared helpers for creating runs and emitting stage events."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.events import event_bus
from db.models import PullRequest, Repo, Run, RunEvent


def branch_for_issue(issue_number: int) -> str:
    """Placeholder until GitHub Ops names the typed branch."""
    return f"bugfix/{issue_number}"


async def get_or_create_repo(
    session: AsyncSession,
    *,
    owner: str,
    name: str,
    clone_url: str,
    default_branch: str,
    workspace_path: str,
    user_id: int | None = None,
) -> Repo:
    full_name = f"{owner}/{name}"
    result = await session.execute(select(Repo).where(Repo.full_name == full_name))
    repo = result.scalar_one_or_none()
    if repo:
        if repo.user_id is not None and user_id is not None and repo.user_id != user_id:
            raise ValueError("Repository is already connected to another account")
        if repo.user_id is None and user_id is not None:
            repo.user_id = user_id
        repo.clone_url = clone_url
        repo.default_branch = default_branch
        repo.workspace_path = workspace_path
        return repo

    repo = Repo(
        owner=owner,
        name=name,
        full_name=full_name,
        clone_url=clone_url,
        default_branch=default_branch,
        workspace_path=workspace_path,
        user_id=user_id,
    )
    session.add(repo)
    await session.flush()
    return repo


async def create_run(
    session: AsyncSession,
    *,
    repo: Repo,
    issue_number: int,
    issue_title: str,
    issue_body: Optional[str],
    issue_url: Optional[str],
    issue_labels: Optional[list[str]] = None,
) -> Run:
    run = Run(
        repo_id=repo.id,
        issue_number=issue_number,
        issue_title=issue_title,
        issue_body=issue_body,
        issue_url=issue_url,
        issue_labels=issue_labels,
        branch_name=branch_for_issue(issue_number),
        status="queued",
        stage="queued",
    )
    session.add(run)
    await session.flush()
    await append_run_event(
        session,
        run,
        stage="queued",
        message=f"Run queued for issue #{issue_number}",
    )
    return run


async def append_run_event(
    session: AsyncSession,
    run: Run,
    *,
    stage: str,
    message: str,
    payload: Optional[dict[str, Any]] = None,
) -> RunEvent:
    event = RunEvent(run_id=run.id, stage=stage, message=message, payload=payload)
    session.add(event)
    run.stage = stage
    run.updated_at = datetime.now(timezone.utc)
    await session.flush()
    await event_bus.publish(
        run.id,
        {
            "id": event.id,
            "run_id": run.id,
            "stage": stage,
            "message": message,
            "payload": payload,
            "status": run.status,
            "created_at": event.created_at.isoformat() if event.created_at else None,
        },
    )
    return event


async def load_run(
    session: AsyncSession,
    run_id: int,
    user_id: int | None = None,
) -> Optional[Run]:
    from sqlalchemy import and_

    conditions = [Run.id == run_id]
    if user_id is not None:
        conditions.append(Repo.user_id == user_id)
    result = await session.execute(
        select(Run)
        .join(Repo, Repo.id == Run.repo_id)
        .where(and_(*conditions))
        .options(
            selectinload(Run.events),
            selectinload(Run.pull_request),
            selectinload(Run.repo),
        )
    )
    return result.scalar_one_or_none()


async def upsert_pull_request(
    session: AsyncSession,
    run: Run,
    *,
    title: str,
    body: str,
    number: Optional[int],
    url: Optional[str],
    state: str = "open",
) -> PullRequest:
    if run.pull_request:
        pr = run.pull_request
        pr.title = title
        pr.body = body
        pr.number = number
        pr.url = url
        pr.state = state
    else:
        pr = PullRequest(
            run_id=run.id,
            title=title,
            body=body,
            number=number,
            url=url,
            state=state,
        )
        session.add(pr)
    await session.flush()
    return pr
