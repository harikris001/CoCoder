"""LLM client factory from BYOK secrets with .env fallback."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openrouter import ChatOpenRouter

from config import get_settings
from secure_store import LlmSecrets, ProviderId, get_llm_secrets


@dataclass
class ResolvedLlm:
    provider: ProviderId
    model: str
    api_key: str
    base_url: str = ""
    source: str = "byok"  # byok | env


def resolve_llm_config(secrets: Optional[LlmSecrets] = None) -> ResolvedLlm:
    """Pick active provider credentials, falling back to OpenRouter from .env."""
    settings = get_settings()
    data = secrets or get_llm_secrets()
    provider = data.active_provider
    creds = data.provider(provider)

    if provider == "custom":
        if creds.api_key.strip() and creds.base_url.strip() and creds.model.strip():
            return ResolvedLlm(
                provider="custom",
                model=creds.model.strip(),
                api_key=creds.api_key.strip(),
                base_url=creds.base_url.strip(),
                source="byok",
            )
    elif creds.api_key.strip() and (creds.model.strip() or provider == "openrouter"):
        model = creds.model.strip() or settings.llm_model
        return ResolvedLlm(
            provider=provider,
            model=model,
            api_key=creds.api_key.strip(),
            source="byok",
        )

    # Env fallback — OpenRouter
    env_key = (settings.openrouter_api_key or "").strip()
    if not env_key:
        raise RuntimeError(
            "No LLM credentials configured. Add a key in Settings (BYOK) "
            "or set OPENROUTER_API_KEY in the server .env."
        )
    return ResolvedLlm(
        provider="openrouter",
        model=settings.llm_model,
        api_key=env_key,
        source="env",
    )


def build_chat_model(
    *,
    temperature: float = 0.2,
    secrets: Optional[LlmSecrets] = None,
) -> BaseChatModel:
    resolved = resolve_llm_config(secrets)
    return _build(resolved, temperature=temperature)


def _build(resolved: ResolvedLlm, *, temperature: float) -> BaseChatModel:
    if resolved.provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=resolved.model,
            api_key=resolved.api_key,
            temperature=temperature,
        )

    if resolved.provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=resolved.model,
            api_key=resolved.api_key,
            temperature=temperature,
        )

    if resolved.provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=resolved.model,
            google_api_key=resolved.api_key,
            temperature=temperature,
        )

    if resolved.provider == "custom":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=resolved.model,
            api_key=resolved.api_key,
            base_url=resolved.base_url,
            temperature=temperature,
        )

    # openrouter
    return ChatOpenRouter(
        model=resolved.model,
        api_key=resolved.api_key,
        temperature=temperature,
    )


async def probe_provider(
    provider: ProviderId,
    *,
    api_key: str,
    model: str,
    base_url: str = "",
) -> tuple[bool, str]:
    """Lightweight connectivity check for Settings → Test."""
    key = api_key.strip()
    if not key:
        return False, "API key is required"
    try:
        if provider == "openrouter":
            import httpx

            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
            if res.status_code >= 400:
                return False, f"OpenRouter rejected key ({res.status_code})"
            return True, "OpenRouter key ok"

        if provider == "openai":
            import httpx

            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
            if res.status_code >= 400:
                return False, f"OpenAI rejected key ({res.status_code})"
            return True, "OpenAI key ok"

        if provider == "anthropic":
            import httpx

            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                    },
                )
            if res.status_code >= 400:
                return False, f"Anthropic rejected key ({res.status_code})"
            return True, "Anthropic key ok"

        if provider == "google":
            import httpx

            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": key},
                )
            if res.status_code >= 400:
                return False, f"Google rejected key ({res.status_code})"
            return True, "Google key ok"

        if provider == "custom":
            if not base_url.strip():
                return False, "Base URL is required"
            import httpx

            root = base_url.rstrip("/")
            url = f"{root}/models" if root.endswith("/v1") else f"{root}/v1/models"
            async with httpx.AsyncClient(timeout=20.0) as client:
                res = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {key}"},
                )
            if res.status_code >= 400:
                return False, f"Custom endpoint rejected key ({res.status_code})"
            return True, "Custom endpoint ok"

        return False, f"Unknown provider: {provider}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc) or "Connection failed"
