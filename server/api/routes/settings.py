"""LLM BYOK settings API — never returns raw API keys."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.auth import get_current_user
from db.models import User
from db.session import get_db
from llm.factory import ProviderModelsError, list_provider_models, probe_provider, resolve_llm_config
from secure_store import (
    GitHubCredential,
    PROVIDERS,
    ProviderId,
    clear_github_credential,
    clear_llm_secrets,
    get_github_secrets,
    get_llm_secrets,
    mask_key,
    save_github_secrets,
    update_llm_secrets,
)
from tools.github.client import validate_github_token
from tools.github.credentials import github_status

router = APIRouter(prefix="/settings", tags=["settings"])


class ProviderUpdate(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


class LlmSettingsUpdate(BaseModel):
    active_provider: Optional[ProviderId] = None
    openai: Optional[ProviderUpdate] = None
    anthropic: Optional[ProviderUpdate] = None
    google: Optional[ProviderUpdate] = None
    openrouter: Optional[ProviderUpdate] = None
    custom: Optional[ProviderUpdate] = None


class ProviderStatus(BaseModel):
    configured: bool
    mask: Optional[str] = None
    model: str = ""
    base_url: str = ""


class LlmSettingsOut(BaseModel):
    active_provider: ProviderId
    source: Literal["byok", "env"]
    resolved_model: str
    providers: dict[str, ProviderStatus]


class LlmTestRequest(BaseModel):
    provider: ProviderId
    api_key: Optional[str] = None
    model: Optional[str] = None
    base_url: Optional[str] = None


class LlmTestOut(BaseModel):
    ok: bool
    message: str


class LlmModelOut(BaseModel):
    id: str
    name: str = ""


class LlmModelsRequest(BaseModel):
    provider: ProviderId
    api_key: Optional[str] = None
    base_url: Optional[str] = None


class LlmModelsOut(BaseModel):
    provider: ProviderId
    models: list[LlmModelOut] = Field(default_factory=list)


class GitHubStatusOut(BaseModel):
    configured: bool
    source: str | None = None
    login: str | None = None
    mask: str | None = None
    scopes: list[str] = Field(default_factory=list)
    expires_at: str | None = None
    pat_configured: bool = False
    oauth_configured: bool = False


class GitHubPatUpdate(BaseModel):
    token: str


class GitHubTestOut(BaseModel):
    ok: bool
    message: str
    login: str | None = None
    scopes: list[str] = Field(default_factory=list)


class PreferencesOut(BaseModel):
    require_push_approval: bool


class PreferencesUpdate(BaseModel):
    require_push_approval: bool


def _status_map(secrets) -> dict[str, ProviderStatus]:
    data = secrets
    out: dict[str, ProviderStatus] = {}
    for name in PROVIDERS:
        creds = data.provider(name)
        out[name] = ProviderStatus(
            configured=bool(creds.api_key.strip())
            and (name != "custom" or bool(creds.base_url.strip())),
            mask=mask_key(creds.api_key),
            model=creds.model,
            base_url=creds.base_url if name == "custom" else "",
        )
    return out


def _to_out(user_id: int) -> LlmSettingsOut:
    secrets = get_llm_secrets(user_id)
    try:
        resolved = resolve_llm_config(secrets, user_id=user_id)
        source: Literal["byok", "env"] = "byok" if resolved.source == "byok" else "env"
        resolved_model = resolved.model
        active = resolved.provider
    except RuntimeError:
        source = "env"
        resolved_model = secrets.provider(secrets.active_provider).model
        active = secrets.active_provider

    # Prefer explicitly saved active_provider for UI even if falling back for runs
    return LlmSettingsOut(
        active_provider=secrets.active_provider if secrets.active_provider in PROVIDERS else active,
        source=source,
        resolved_model=resolved_model,
        providers=_status_map(secrets),
    )


@router.get("/llm", response_model=LlmSettingsOut)
async def get_llm_settings(user: User = Depends(get_current_user)) -> LlmSettingsOut:
    return _to_out(user.id)


@router.put("/llm", response_model=LlmSettingsOut)
async def put_llm_settings(
    body: LlmSettingsUpdate,
    user: User = Depends(get_current_user),
) -> LlmSettingsOut:
    def _patch(p: Optional[ProviderUpdate]) -> Optional[dict[str, Any]]:
        if p is None:
            return None
        return p.model_dump(exclude_unset=True)

    if body.active_provider is not None and body.active_provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid active_provider")

    update_llm_secrets(
        user_id=user.id,
        active_provider=body.active_provider,
        openai=_patch(body.openai),
        anthropic=_patch(body.anthropic),
        google=_patch(body.google),
        openrouter=_patch(body.openrouter),
        custom=_patch(body.custom),
    )
    return _to_out(user.id)


@router.delete("/llm", response_model=LlmSettingsOut)
async def delete_llm_settings(user: User = Depends(get_current_user)) -> LlmSettingsOut:
    clear_llm_secrets(user.id)
    return _to_out(user.id)


@router.post("/llm/test", response_model=LlmTestOut)
async def test_llm_settings(
    body: LlmTestRequest,
    user: User = Depends(get_current_user),
) -> LlmTestOut:
    secrets = get_llm_secrets(user.id)
    creds = secrets.provider(body.provider)
    api_key = (body.api_key or "").strip() or creds.api_key
    model = (body.model or "").strip() or creds.model
    base_url = (body.base_url or "").strip() or creds.base_url

    if not api_key:
        raise HTTPException(status_code=400, detail="No API key to test (enter one or save first)")

    ok, message = await probe_provider(
        body.provider,
        api_key=api_key,
        model=model,
        base_url=base_url,
    )
    return LlmTestOut(ok=ok, message=message)


@router.post("/llm/models", response_model=LlmModelsOut)
async def post_llm_models(
    body: LlmModelsRequest,
    user: User = Depends(get_current_user),
) -> LlmModelsOut:
    provider = body.provider
    if provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid provider")

    secrets = get_llm_secrets(user.id)
    creds = secrets.provider(provider)
    key = (body.api_key or "").strip() or creds.api_key
    url = (body.base_url or "").strip() or creds.base_url

    if not key:
        raise HTTPException(
            status_code=400,
            detail="No API key to list models (enter one or save first)",
        )
    if provider == "custom" and not url:
        raise HTTPException(status_code=400, detail="Base URL is required for custom provider")

    try:
        models = await list_provider_models(provider, api_key=key, base_url=url)
    except ProviderModelsError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    return LlmModelsOut(
        provider=provider,
        models=[LlmModelOut(id=m.id, name=m.name) for m in models],
    )


@router.get("/github", response_model=GitHubStatusOut)
async def get_github_settings(user: User = Depends(get_current_user)) -> GitHubStatusOut:
    return GitHubStatusOut(**github_status(user.id))


@router.post("/github/test", response_model=GitHubTestOut)
async def test_github_token(
    body: GitHubPatUpdate,
    user: User = Depends(get_current_user),
) -> GitHubTestOut:
    del user
    try:
        identity = await validate_github_token(body.token)
    except ValueError as exc:
        return GitHubTestOut(ok=False, message=str(exc))
    return GitHubTestOut(
        ok=True,
        message=f"Connected as @{identity['login']}",
        login=str(identity["login"]),
        scopes=list(identity.get("scopes") or []),
    )


@router.put("/github/pat", response_model=GitHubStatusOut)
async def save_github_pat(
    body: GitHubPatUpdate,
    user: User = Depends(get_current_user),
) -> GitHubStatusOut:
    try:
        identity = await validate_github_token(body.token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    secrets = get_github_secrets(user.id)
    secrets.pat = GitHubCredential(
        token=body.token.strip(),
        login=str(identity["login"]),
        scopes=list(identity.get("scopes") or []),
    )
    secrets.active_source = "pat"
    save_github_secrets(user.id, secrets)
    return GitHubStatusOut(**github_status(user.id))


@router.delete("/github/pat", response_model=GitHubStatusOut)
async def delete_github_pat(user: User = Depends(get_current_user)) -> GitHubStatusOut:
    clear_github_credential(user.id, "pat")
    return GitHubStatusOut(**github_status(user.id))


@router.delete("/github/oauth", response_model=GitHubStatusOut)
async def delete_github_oauth(user: User = Depends(get_current_user)) -> GitHubStatusOut:
    clear_github_credential(user.id, "oauth")
    return GitHubStatusOut(**github_status(user.id))


@router.get("/preferences", response_model=PreferencesOut)
async def get_preferences(user: User = Depends(get_current_user)) -> PreferencesOut:
    return PreferencesOut(require_push_approval=user.require_push_approval is not False)


@router.put("/preferences", response_model=PreferencesOut)
async def put_preferences(
    body: PreferencesUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PreferencesOut:
    result = await db.execute(select(User).where(User.id == user.id))
    row = result.scalar_one()
    row.require_push_approval = body.require_push_approval
    await db.commit()
    await db.refresh(row)
    return PreferencesOut(require_push_approval=bool(row.require_push_approval))
