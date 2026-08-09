"""LangGraph-style orchestrator pipeline for issue → PR."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, TypedDict

from agents import (
    ArchitectureAgent,
    BackendAgent,
    FrontendAgent,
    PMAgent,
    ReviewerAgent,
    TaskPlannerAgent,
)
from api.services import append_run_event, upsert_pull_request
from config import get_settings
from db.models import Run
from db.session import async_session_factory
from indexing.hybrid import HybridIndexer
from indexing.retrieve import format_context_pack
from sqlalchemy.orm import selectinload
from sqlalchemy import select
from tools.agent_tools import configure_tools
from tools.github.git_ops import (
    changed_files,
    commit_all,
    ensure_bugfix_branch,
    ensure_repo,
    get_diff,
    push_branch,
)
from tools.github.pull_requests import build_pr_body, create_pull_request

logger = logging.getLogger(__name__)


class PipelineState(TypedDict, total=False):
    run_id: int
    issue_title: str
    issue_body: str
    issue_number: int
    repo_full_name: str
    owner: str
    name: str
    workspace: str
    default_branch: str
    clone_url: str
    repo_db_id: int
    context: str
    pm: dict[str, Any]
    architecture: dict[str, Any]
    planner: dict[str, Any]
    review: dict[str, Any]
    files_touched: list[str]
    branch_name: str
    status: str
    error: str


def _structured(result: Any) -> dict[str, Any]:
    """Extract structured response from LangChain agent invoke result."""
    if isinstance(result, dict):
        structured = result.get("structured_response")
        if structured is not None:
            if hasattr(structured, "model_dump"):
                return structured.model_dump()
            if isinstance(structured, dict):
                return structured
        messages = result.get("messages") or []
        # Prefer tool-call args (ToolStrategy) over free-form text
        for msg in reversed(messages):
            tool_calls = getattr(msg, "tool_calls", None) or []
            for call in tool_calls:
                name = call.get("name") if isinstance(call, dict) else getattr(call, "name", None)
                args = call.get("args") if isinstance(call, dict) else getattr(call, "args", None)
                if isinstance(args, dict) and args:
                    return args
                if isinstance(args, str) and args.strip():
                    try:
                        parsed = json.loads(args)
                        if isinstance(parsed, dict):
                            return parsed
                    except json.JSONDecodeError:
                        pass
                # Some providers nest under additional_kwargs
                if name and isinstance(args, dict):
                    return args
        for msg in reversed(messages):
            content = getattr(msg, "content", None)
            if isinstance(content, str) and content.strip():
                try:
                    parsed = json.loads(content)
                    if isinstance(parsed, dict):
                        return parsed
                except json.JSONDecodeError:
                    # Try fenced JSON block
                    start = content.find("{")
                    end = content.rfind("}")
                    if start >= 0 and end > start:
                        try:
                            return json.loads(content[start : end + 1])
                        except json.JSONDecodeError:
                            continue
            if isinstance(content, list):
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text = part.get("text") or ""
                        if text.strip().startswith("{"):
                            try:
                                return json.loads(text)
                            except json.JSONDecodeError:
                                continue
    if hasattr(result, "model_dump"):
        return result.model_dump()
    return {"raw": str(result)}


def _invoke_agent_sync(agent: Any, user_text: str, *, retries: int = 2) -> dict[str, Any]:
    """Invoke an agent and extract JSON structured output, with retries.

    This is a *synchronous* helper — callers from async code should use
    ``_invoke_agent`` which wraps this in ``asyncio.to_thread``.
    """
    last_error: Exception | None = None
    prompt = user_text
    for attempt in range(retries + 1):
        try:
            result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
            parsed = _structured(result)
            if "raw" in parsed and len(parsed) == 1:
                raise ValueError(f"Agent did not return structured JSON: {parsed['raw'][:300]}")
            return parsed
        except Exception as exc:  # noqa: BLE001 — retry structured-output failures
            last_error = exc
            logger.warning(
                "Agent invoke failed (attempt %s/%s): %s",
                attempt + 1,
                retries + 1,
                exc,
            )
            prompt = (
                f"{user_text}\n\n"
                "IMPORTANT: Your previous reply was invalid. "
                "Finish by calling the structured response tool with valid JSON "
                "matching the required schema. Do not return empty content."
            )
    assert last_error is not None
    raise last_error


async def _invoke_agent(agent: Any, user_text: str, *, retries: int = 2) -> dict[str, Any]:
    """Async wrapper — runs the blocking LLM call in a thread to avoid starving the event loop."""
    import asyncio

    return await asyncio.to_thread(_invoke_agent_sync, agent, user_text, retries=retries)


async def _update_run(run_id: int, **fields: Any) -> None:
    async with async_session_factory() as session:
        result = await session.execute(select(Run).where(Run.id == run_id))
        run = result.scalar_one()
        for key, value in fields.items():
            setattr(run, key, value)
        run.updated_at = datetime.now(timezone.utc)
        await session.commit()


async def _event(run_id: int, stage: str, message: str, payload: Optional[dict] = None) -> None:
    async with async_session_factory() as session:
        result = await session.execute(select(Run).where(Run.id == run_id))
        run = result.scalar_one()
        await append_run_event(session, run, stage=stage, message=message, payload=payload)
        await session.commit()


async def run_pipeline(state: PipelineState) -> PipelineState:
    settings = get_settings()
    run_id = state["run_id"]
    workspace = Path(state["workspace"])
    configure_tools(workspace, state["repo_db_id"])

    try:
        await _update_run(run_id, status="running", stage="clone")
        await _event(run_id, "clone", "Cloning / updating repository")
        repo = ensure_repo(state["clone_url"], workspace, settings.github_token)

        await _update_run(run_id, stage="branch")
        branch = ensure_bugfix_branch(repo, state["issue_number"], state.get("default_branch") or "main")
        state["branch_name"] = branch
        await _update_run(run_id, branch_name=branch)
        await _event(run_id, "branch", f"Using branch {branch}")

        await _update_run(run_id, stage="index")
        await _event(run_id, "index", "Building hybrid index (RAG + AST + dependency graph)")
        indexer = HybridIndexer(state["repo_db_id"], workspace)
        stats = indexer.index(full=True)
        query = f"{state['issue_title']}\n\n{state.get('issue_body') or ''}"
        retrieved = indexer.retrieve(query)
        context = format_context_pack(retrieved)
        state["context"] = context
        await _event(run_id, "index", "Index ready", payload=stats)

        # Persist index stats on repo
        async with async_session_factory() as session:
            from db.models import Repo

            result = await session.execute(select(Repo).where(Repo.id == state["repo_db_id"]))
            db_repo = result.scalar_one()
            db_repo.index_status = "ready"
            db_repo.index_stats = stats
            db_repo.last_indexed_at = datetime.now(timezone.utc)
            await session.commit()

        await _update_run(run_id, stage="pm")
        await _event(run_id, "pm", "PM Agent analyzing issue")
        pm_agent = PMAgent()
        pm = await _invoke_agent(
            pm_agent,
            (
                f"GitHub issue #{state['issue_number']}: {state['issue_title']}\n\n"
                f"{state.get('issue_body') or ''}\n\n"
                f"Repository summary:\n{context[:4000]}"
            ),
        )
        state["pm"] = pm
        await _update_run(run_id, pm_output=pm)
        await _event(run_id, "pm", "PM output ready", payload=pm)

        await _update_run(run_id, stage="architecture")
        await _event(run_id, "architecture", "Architecture Agent mapping changes")
        arch_agent = ArchitectureAgent()
        architecture = await _invoke_agent(
            arch_agent,
            (
                f"Requirements:\n{json.dumps(pm, indent=2)}\n\n"
                f"Use search_repository if needed. Hybrid context:\n{context[:6000]}"
            ),
        )
        state["architecture"] = architecture
        await _update_run(run_id, architecture_output=architecture)
        await _event(run_id, "architecture", "Architecture output ready", payload=architecture)

        await _update_run(run_id, stage="planner")
        await _event(run_id, "planner", "Task Planner creating tasks")
        planner_agent = TaskPlannerAgent()
        planner = await _invoke_agent(
            planner_agent,
            (
                f"PM:\n{json.dumps(pm, indent=2)}\n\n"
                f"Architecture:\n{json.dumps(architecture, indent=2)}"
            ),
        )
        state["planner"] = planner
        await _update_run(run_id, planner_output=planner)
        await _event(run_id, "planner", "Task plan ready", payload=planner)

        files_touched: list[str] = []
        review: dict[str, Any] = {"approved": False}
        retries = 0
        max_retries = settings.max_review_retries

        while retries <= max_retries:
            await _update_run(run_id, stage="develop", retry_count=retries)
            await _event(run_id, "develop", f"Developer agents implementing (attempt {retries + 1})")

            tasks = planner.get("tasks") or []
            if not tasks:
                # Fallback single backend task
                tasks = [
                    {
                        "id": "t1",
                        "title": "Implement fix",
                        "description": json.dumps(architecture),
                        "owner": "backend",
                        "depends_on": [],
                    }
                ]

            for task in tasks:
                owner = (task.get("owner") or "backend").lower()
                prompt = (
                    f"Task: {task.get('title')}\n{task.get('description')}\n\n"
                    f"Acceptance criteria: {pm.get('acceptance_criteria')}\n\n"
                    f"Architecture: {json.dumps(architecture)}\n\n"
                    f"Prior review feedback: {json.dumps(review)}\n\n"
                    f"Use tools to inspect and edit files in the repo workspace."
                )
                if owner == "frontend":
                    agent = FrontendAgent()
                else:
                    agent = BackendAgent()
                configure_tools(workspace, state["repo_db_id"])
                dev_out = await _invoke_agent(agent, prompt)
                files_touched.extend(dev_out.get("files_modified") or [])
                files_touched.extend(dev_out.get("files_created") or [])
                await _event(
                    run_id,
                    "develop",
                    f"{owner} finished task {task.get('id')}",
                    payload=dev_out,
                )

            files_touched = sorted(set(files_touched))
            diff, diff_files = get_diff(repo)
            if diff_files:
                files_touched = sorted(set(files_touched) | set(diff_files))
            await _update_run(run_id, files_touched=files_touched)

            await _update_run(run_id, stage="review")
            await _event(run_id, "review", "Reviewer Agent checking changes")
            reviewer = ReviewerAgent()
            configure_tools(workspace, state["repo_db_id"])
            review = await _invoke_agent(
                reviewer,
                (
                    f"Acceptance criteria:\n{json.dumps(pm.get('acceptance_criteria'))}\n\n"
                    f"Files touched: {files_touched}\n\n"
                    f"Diff (truncated):\n{diff[:8000]}\n\n"
                    f"Approve only if criteria are met."
                ),
            )
            state["review"] = review
            await _update_run(run_id, review_output=review)
            await _event(run_id, "review", "Review complete", payload=review)

            if review.get("approved"):
                break
            retries += 1
            if retries > max_retries:
                await _update_run(
                    run_id,
                    status="needs_human",
                    stage="needs_human",
                    error="Review retries exhausted",
                    finished_at=datetime.now(timezone.utc),
                )
                await _event(run_id, "needs_human", "Needs human intervention after review failures")
                state["status"] = "needs_human"
                return state

        # GitOps
        await _update_run(run_id, stage="gitops")
        await _event(run_id, "gitops", "Committing and opening PR")
        summary = (state.get("pm") or {}).get("goal") or state["issue_title"]
        committed = commit_all(
            repo,
            f"fix: {state['issue_title']} (#{state['issue_number']})\n\nCoCoder automated fix.",
        )
        if committed:
            push_branch(repo, branch)
        else:
            # Still try push in case commits already exist on branch
            try:
                push_branch(repo, branch)
            except Exception as exc:
                logger.warning("Push skipped/failed: %s", exc)

        files = changed_files(repo, state.get("default_branch") or "main") or files_touched
        title = f"Fix: {state['issue_title']}"
        body = build_pr_body(state["issue_number"], summary, files)
        pr = create_pull_request(
            state["owner"],
            state["name"],
            title=title,
            body=body,
            head=branch,
            base=state.get("default_branch") or "main",
        )

        async with async_session_factory() as session:
            result = await session.execute(
                select(Run).where(Run.id == run_id).options(selectinload(Run.pull_request))
            )
            run = result.scalar_one()
            if pr.get("error"):
                await append_run_event(
                    session,
                    run,
                    stage="gitops",
                    message=f"PR creation failed: {pr.get('message')}",
                    payload=pr,
                )
                run.status = "failed"
                run.error = str(pr.get("message"))
                run.finished_at = datetime.now(timezone.utc)
            else:
                await upsert_pull_request(
                    session,
                    run,
                    title=title,
                    body=body,
                    number=pr.get("number"),
                    url=pr.get("html_url"),
                    state=pr.get("state") or "open",
                )
                await append_run_event(
                    session,
                    run,
                    stage="done",
                    message=f"PR opened: {pr.get('html_url')}",
                    payload={"pr": pr.get("html_url"), "number": pr.get("number")},
                )
                run.status = "completed"
                run.stage = "done"
                run.finished_at = datetime.now(timezone.utc)
                run.files_touched = files
            await session.commit()

        state["status"] = "completed" if not pr.get("error") else "failed"
        state["files_touched"] = files
        return state

    except Exception as exc:
        logger.exception("Pipeline failed for run %s", run_id)
        await _update_run(
            run_id,
            status="failed",
            stage="failed",
            error=str(exc),
            finished_at=datetime.now(timezone.utc),
        )
        await _event(run_id, "failed", f"Pipeline error: {exc}")
        state["status"] = "failed"
        state["error"] = str(exc)
        return state
