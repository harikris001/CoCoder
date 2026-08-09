"""LLM BYOK settings API — never returns raw API keys."""

from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from llm.factory import probe_provider, resolve_llm_config
from secure_store import PROVIDERS, ProviderId, clear_llm_secrets, get_llm_secrets, mask_key, update_llm_secrets

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


def _status_map(secrets=None) -> dict[str, ProviderStatus]:
    data = secrets or get_llm_secrets()
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


def _to_out() -> LlmSettingsOut:
    secrets = get_llm_secrets()
    try:
        resolved = resolve_llm_config(secrets)
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
async def get_llm_settings() -> LlmSettingsOut:
    return _to_out()


@router.put("/llm", response_model=LlmSettingsOut)
async def put_llm_settings(body: LlmSettingsUpdate) -> LlmSettingsOut:
    def _patch(p: Optional[ProviderUpdate]) -> Optional[dict[str, Any]]:
        if p is None:
            return None
        return p.model_dump(exclude_unset=True)

    if body.active_provider is not None and body.active_provider not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Invalid active_provider")

    update_llm_secrets(
        active_provider=body.active_provider,
        openai=_patch(body.openai),
        anthropic=_patch(body.anthropic),
        google=_patch(body.google),
        openrouter=_patch(body.openrouter),
        custom=_patch(body.custom),
    )
    return _to_out()


@router.delete("/llm", response_model=LlmSettingsOut)
async def delete_llm_settings() -> LlmSettingsOut:
    clear_llm_secrets()
    return _to_out()


@router.post("/llm/test", response_model=LlmTestOut)
async def test_llm_settings(body: LlmTestRequest) -> LlmTestOut:
    secrets = get_llm_secrets()
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
