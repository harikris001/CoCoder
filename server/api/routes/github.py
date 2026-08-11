"""GitHub OAuth connection flow for authenticated CoCoder users."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from config import get_settings
from db.models import GitHubOAuthState, User
from db.session import get_db
from secure_store import GitHubCredential, get_github_secrets, save_github_secrets
from tools.github.client import validate_github_token

router = APIRouter(prefix="/settings/github/oauth", tags=["github"])


def _state_hash(state: str) -> str:
    return hashlib.sha256(state.encode("utf-8")).hexdigest()


def _frontend_redirect(**params: str) -> RedirectResponse:
    settings = get_settings()
    query = urlencode(params)
    return RedirectResponse(f"{settings.frontend_url.rstrip('/')}/settings?{query}", status_code=303)


async def _discard_oauth_state(db: AsyncSession, state: str) -> None:
    result = await db.execute(
        select(GitHubOAuthState).where(GitHubOAuthState.state_hash == _state_hash(state))
    )
    oauth_state = result.scalar_one_or_none()
    if oauth_state:
        await db.delete(oauth_state)
        await db.commit()


@router.get("/start")
async def start_github_oauth(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    settings = get_settings()
    if not settings.github_oauth_client_id or not settings.github_oauth_client_secret:
        raise HTTPException(status_code=503, detail="GitHub OAuth is not configured")

    state = secrets.token_urlsafe(32)
    db.add(
        GitHubOAuthState(
            user_id=user.id,
            state_hash=_state_hash(state),
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
        )
    )
    await db.commit()
    query = urlencode(
        {
            "client_id": settings.github_oauth_client_id,
            "redirect_uri": settings.github_oauth_redirect_uri,
            "scope": " ".join(settings.github_oauth_scopes.replace(",", " ").split()),
            "state": state,
        }
    )
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{query}", status_code=303)


@router.get("/callback")
async def github_oauth_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    if error:
        if state:
            await _discard_oauth_state(db, state)
        return _frontend_redirect(github="error", reason="authorization_denied")
    if not code or not state:
        return _frontend_redirect(github="error", reason="invalid_callback")

    result = await db.execute(
        select(GitHubOAuthState).where(GitHubOAuthState.state_hash == _state_hash(state))
    )
    oauth_state = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    expires_at = oauth_state.expires_at if oauth_state else now
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if not oauth_state or expires_at <= now:
        return _frontend_redirect(github="error", reason="expired_state")

    user_id = oauth_state.user_id
    await db.delete(oauth_state)
    await db.commit()
    settings = get_settings()

    try:
        async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
            response = await client.post(
                "https://github.com/login/oauth/access_token",
                headers={"Accept": "application/json"},
                data={
                    "client_id": settings.github_oauth_client_id,
                    "client_secret": settings.github_oauth_client_secret,
                    "code": code,
                    "redirect_uri": settings.github_oauth_redirect_uri,
                },
            )
        if response.status_code >= 400:
            raise ValueError("GitHub token exchange failed")
        exchange = response.json()
        access_token = str(exchange.get("access_token") or "").strip()
        if not access_token:
            raise ValueError("GitHub did not return an access token")
        identity = await validate_github_token(access_token)
    except (httpx.HTTPError, ValueError, TypeError):
        return _frontend_redirect(github="error", reason="token_exchange_failed")

    credentials = get_github_secrets(user_id)
    credentials.oauth = GitHubCredential(
        token=access_token,
        login=str(identity["login"]),
        scopes=list(identity.get("scopes") or []),
        expires_at=str(exchange["expires_at"]) if exchange.get("expires_at") else None,
    )
    credentials.active_source = "oauth"
    save_github_secrets(user_id, credentials)
    return _frontend_redirect(github="connected")
