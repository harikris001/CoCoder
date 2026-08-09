"""Repository registration and index status APIs."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from api.schemas import IndexStatusOut, RepoCreate, RepoOut
from api.services import get_or_create_repo
from config import WORKSPACE_ROOT, get_settings
from db.models import IndexJob, Repo, Run
from db.session import async_session_factory, get_db
from indexing.hybrid import HybridIndexer
from tools.github.git_ops import ensure_repo

router = APIRouter(prefix="/repos", tags=["repos"])


@router.get("", response_model=list[RepoOut])
async def list_repos(db: AsyncSession = Depends(get_db)) -> list[Repo]:
    result = await db.execute(select(Repo).order_by(Repo.created_at.desc()))
    return list(result.scalars().all())


@router.post("", response_model=RepoOut)
async def register_repo(
    body: RepoCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> Repo:
    clone_url = body.clone_url or f"https://github.com/{body.owner}/{body.name}.git"
    workspace = str(WORKSPACE_ROOT / f"{body.owner}__{body.name}")
    repo = await get_or_create_repo(
        db,
        owner=body.owner,
        name=body.name,
        clone_url=clone_url,
        default_branch=body.default_branch,
        workspace_path=workspace,
    )
    await db.commit()
    await db.refresh(repo)
    background_tasks.add_task(_clone_and_index, repo.id)
    return repo


@router.get("/{repo_id}", response_model=RepoOut)
async def get_repo(repo_id: int, db: AsyncSession = Depends(get_db)) -> Repo:
    repo = await db.get(Repo, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")
    return repo


@router.get("/{repo_id}/index/status", response_model=IndexStatusOut)
async def index_status(repo_id: int, db: AsyncSession = Depends(get_db)) -> IndexStatusOut:
    repo = await db.get(Repo, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")
    result = await db.execute(
        select(IndexJob).where(IndexJob.repo_id == repo_id).order_by(IndexJob.created_at.desc()).limit(5)
    )
    jobs = result.scalars().all()
    return IndexStatusOut(
        repo_id=repo.id,
        status=repo.index_status,
        stats=repo.index_stats,
        last_indexed_at=repo.last_indexed_at,
        recent_jobs=[
            {
                "id": j.id,
                "status": j.status,
                "message": j.message,
                "stats": j.stats,
                "created_at": j.created_at.isoformat() if j.created_at else None,
            }
            for j in jobs
        ],
    )


@router.post("/{repo_id}/reindex")
async def reindex_repo(
    repo_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict:
    repo = await db.get(Repo, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")
    background_tasks.add_task(_clone_and_index, repo.id)
    return {"status": "queued", "repo_id": repo_id}


@router.post("/{repo_id}/issues/sync")
async def sync_open_issues(
    repo_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    limit: int = 10,
) -> dict:
    """Pull open GitHub issues and enqueue runs for ones not already tracked.

    Use this for local development where GitHub cannot reach localhost webhooks.
    """
    from api.services import create_run
    from orchestrator.runner import execute_run
    from tools.github.github_issues import fetch_issues

    repo = await db.get(Repo, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")

    try:
        issues = fetch_issues(repo.owner, repo.name, state="open", per_page=max(1, min(limit, 50)))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch issues: {exc}") from exc

    created: list[dict] = []
    skipped: list[dict] = []
    for issue in issues:
        number = int(issue["number"])
        existing = await db.execute(
            select(Run).where(Run.repo_id == repo.id, Run.issue_number == number)
        )
        if existing.scalar_one_or_none():
            skipped.append({"issue_number": number, "reason": "already_tracked"})
            continue
        run = await create_run(
            db,
            repo=repo,
            issue_number=number,
            issue_title=issue.get("title") or f"Issue #{number}",
            issue_body=issue.get("body"),
            issue_url=issue.get("html_url"),
        )
        created.append({"issue_number": number, "run_id": run.id, "title": run.issue_title})

    await db.commit()
    for item in created:
        background_tasks.add_task(execute_run, item["run_id"])

    return {
        "status": "ok",
        "repo_id": repo_id,
        "created": created,
        "skipped": skipped,
        "fetched": len(issues),
    }


@router.post("/{repo_id}/issues/{issue_number}/run")
async def run_specific_issue(
    repo_id: int,
    issue_number: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Fetch one GitHub issue and enqueue (or re-use) a CoCoder run."""
    from api.services import create_run
    from orchestrator.runner import execute_run
    from tools.github.github_issues import fetch_issue

    repo = await db.get(Repo, repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")

    try:
        issue = fetch_issue(repo.owner, repo.name, issue_number)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch issue: {exc}") from exc
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found on GitHub")

    existing = await db.execute(
        select(Run).where(Run.repo_id == repo.id, Run.issue_number == issue_number)
    )
    run = existing.scalar_one_or_none()
    if run and run.status in {"queued", "running"}:
        return {"status": "already_running", "run_id": run.id, "issue_number": issue_number}

    if run:
        run.status = "queued"
        run.stage = "queued"
        run.error = None
        run.issue_title = issue.get("title") or run.issue_title
        run.issue_body = issue.get("body")
        run.issue_url = issue.get("html_url")
        run_id = run.id
    else:
        run = await create_run(
            db,
            repo=repo,
            issue_number=issue_number,
            issue_title=issue.get("title") or f"Issue #{issue_number}",
            issue_body=issue.get("body"),
            issue_url=issue.get("html_url"),
        )
        run_id = run.id

    await db.commit()
    background_tasks.add_task(execute_run, run_id)
    return {"status": "queued", "run_id": run_id, "issue_number": issue_number}


async def _clone_and_index(repo_id: int) -> None:
    settings = get_settings()
    async with async_session_factory() as session:
        repo = await session.get(Repo, repo_id)
        if not repo:
            return
        job = IndexJob(repo_id=repo.id, status="running", started_at=datetime.now(timezone.utc))
        session.add(job)
        repo.index_status = "indexing"
        await session.commit()
        workspace = Path(repo.workspace_path)
        clone_url = repo.clone_url
        default_token = settings.github_token
        job_id = job.id

    try:
        ensure_repo(clone_url, workspace, default_token)
        indexer = HybridIndexer(repo_id, workspace)
        stats = indexer.index(full=True)
        async with async_session_factory() as session:
            repo = await session.get(Repo, repo_id)
            job = await session.get(IndexJob, job_id)
            if repo:
                repo.index_status = "ready"
                repo.index_stats = stats
                repo.last_indexed_at = datetime.now(timezone.utc)
            if job:
                job.status = "completed"
                job.stats = stats
                job.finished_at = datetime.now(timezone.utc)
                job.message = "Index completed"
            await session.commit()
    except Exception as exc:
        async with async_session_factory() as session:
            repo = await session.get(Repo, repo_id)
            job = await session.get(IndexJob, job_id)
            if repo:
                repo.index_status = "failed"
            if job:
                job.status = "failed"
                job.message = str(exc)
                job.finished_at = datetime.now(timezone.utc)
            await session.commit()
