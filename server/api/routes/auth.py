"""Email/password authentication endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import (
    clear_session_cookie,
    create_session,
    get_current_user,
    hash_password,
    set_session_cookie,
    token_hash,
    validate_email,
    verify_password,
)
from api.schemas import SignInRequest, SignUpRequest, UserOut
from db.models import AuthSession, User
from db.session import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


def _username_for(email: str, display_name: str) -> str:
    value = "".join(ch for ch in display_name.lower() if ch.isalnum())
    return value[:255] or email.split("@", 1)[0][:255]


@router.post("/signup", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def signup(
    body: SignUpRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    email = validate_email(body.email)
    display_name = body.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="Display name is required")

    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    user = User(
        email=email,
        display_name=display_name,
        username=_username_for(email, display_name),
        password_hash=hash_password(body.password),
    )
    db.add(user)
    await db.flush()
    token = await create_session(db, user)
    await db.commit()
    await db.refresh(user)
    set_session_cookie(response, token)
    return user


@router.post("/signin", response_model=UserOut)
async def signin(
    body: SignInRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> User:
    email = validate_email(body.email)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = await create_session(db, user)
    await db.commit()
    set_session_cookie(response, token)
    return user


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/signout")
async def signout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    from config import get_settings

    token = request.cookies.get(get_settings().auth_cookie_name)
    if token:
        result = await db.execute(select(AuthSession).where(AuthSession.token_hash == token_hash(token)))
        session = result.scalar_one_or_none()
        if session:
            session.revoked_at = datetime.now(timezone.utc)
            await db.commit()
    clear_session_cookie(response)
    return {"status": "signed_out"}
