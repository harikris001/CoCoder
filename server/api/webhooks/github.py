"""GitHub webhook ingestion with signature verification and idempotency."""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.services import create_run, get_or_create_repo
from config import WORKSPACE_ROOT, get_settings
from db.models import WebhookDelivery
from db.session import async_session_factory

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def _verify_signature(secret: str, body: bytes, signature_header: str | None) -> bool:
    if not secret:
        # Dev-friendly: allow unsigned when secret unset
        return True
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    expected = f"sha256={digest}"
    return hmac.compare_digest(expected, signature_header)


@router.post("/github")
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: str | None = Header(default=None),
    x_github_event: str | None = Header(default=None),
    x_github_delivery: str | None = Header(default=None),
) -> dict[str, Any]:
    settings = get_settings()
    body = await request.body()

    if not _verify_signature(settings.github_webhook_secret, body, x_hub_signature_256):
        logger.warning(
            "Webhook signature rejected (delivery=%s event=%s)",
            x_github_delivery,
            x_github_event,
        )
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    if not x_github_event:
        raise HTTPException(status_code=400, detail="Missing X-GitHub-Event header")

    import json

    try:
        payload = json.loads(body.decode("utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {exc}") from exc
    action = payload.get("action")
    logger.info(
        "Webhook received event=%s action=%s delivery=%s repo=%s",
        x_github_event,
        action,
        x_github_delivery,
        (payload.get("repository") or {}).get("full_name"),
    )

    async with async_session_factory() as session:
        if x_github_delivery:
            existing = await session.execute(
                select(WebhookDelivery).where(WebhookDelivery.delivery_id == x_github_delivery)
            )
            if existing.scalar_one_or_none():
                return {"status": "duplicate", "delivery_id": x_github_delivery}

            session.add(
                WebhookDelivery(
                    delivery_id=x_github_delivery,
                    event=x_github_event,
                    action=action,
                )
            )
            await session.commit()

    if x_github_event == "ping":
        return {"status": "pong"}

    if x_github_event == "issues" and action in {"opened", "reopened"}:
        run_id = await _enqueue_issue_run(payload)
        if run_id is not None:
            from orchestrator.runner import execute_run

            background_tasks.add_task(execute_run, run_id)
        return {"status": "accepted", "run_id": run_id}

    return {"status": "ignored", "event": x_github_event, "action": action}


async def _enqueue_issue_run(payload: dict[str, Any]) -> int | None:
    issue = payload.get("issue") or {}
    repository = payload.get("repository") or {}

    if issue.get("pull_request"):
        return None

    owner = (repository.get("owner") or {}).get("login") or repository.get("full_name", "").split("/")[0]
    name = repository.get("name")
    if not owner or not name:
        logger.warning("Webhook missing repository owner/name")
        return None

    clone_url = repository.get("clone_url") or f"https://github.com/{owner}/{name}.git"
    default_branch = repository.get("default_branch") or "main"
    workspace_path = str(WORKSPACE_ROOT / f"{owner}__{name}")

    async with async_session_factory() as session:
        repo = await get_or_create_repo(
            session,
            owner=owner,
            name=name,
            clone_url=clone_url,
            default_branch=default_branch,
            workspace_path=workspace_path,
        )
        run = await create_run(
            session,
            repo=repo,
            issue_number=int(issue["number"]),
            issue_title=issue.get("title") or f"Issue #{issue.get('number')}",
            issue_body=issue.get("body"),
            issue_url=issue.get("html_url"),
        )
        await session.commit()
        return run.id
