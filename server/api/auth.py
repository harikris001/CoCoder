"""Password authentication and server-side session helpers."""

from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.models import AuthSession, User
from db.session import get_db

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
SESSION_HEADER = {"WWW-Authenticate": "Cookie"}


def normalize_email(email: str) -> str:
    return email.strip().lower()


def validate_email(email: str) -> str:
    normalized = normalize_email(email)
    if not EMAIL_RE.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    return normalized


def hash_password(password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=422, detail="Password must be at most 72 bytes")
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("ascii"))
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


async def create_session(db: AsyncSession, user: User) -> str:
    raw_token = secrets.token_urlsafe(32)
    session = AuthSession(
        user_id=user.id,
        token_hash=token_hash(raw_token),
        expires_at=datetime.now(timezone.utc)
        + timedelta(days=get_settings().auth_session_days),
    )
    db.add(session)
    await db.flush()
    return raw_token


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        max_age=settings.auth_session_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.auth_cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=get_settings().auth_cookie_name, path="/")


async def user_from_token(db: AsyncSession, token: str | None) -> User | None:
    if not token:
        return None
    result = await db.execute(
        select(AuthSession, User)
        .join(User, User.id == AuthSession.user_id)
        .where(AuthSession.token_hash == token_hash(token))
    )
    row = result.one_or_none()
    if not row:
        return None
    session, user = row
    if session.revoked_at is not None or _as_utc(session.expires_at) <= datetime.now(timezone.utc):
        return None
    return user


async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    user = await user_from_token(db, request.cookies.get(get_settings().auth_cookie_name))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers=SESSION_HEADER,
        )
    return user
