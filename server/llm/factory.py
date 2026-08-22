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


def resolve_llm_config(
    secrets: Optional[LlmSecrets] = None,
    *,
    user_id: int | None = None,
) -> ResolvedLlm:
    """Pick active provider credentials, falling back to OpenRouter from .env."""
    settings = get_settings()
    data = secrets or get_llm_secrets(user_id)
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
    user_id: int | None = None,
    context_window: int | None = None,
) -> BaseChatModel:
    resolved = resolve_llm_config(secrets, user_id=user_id)
    return _build(resolved, temperature=temperature, context_window=context_window)


def build_summary_chat_model(
    *,
    temperature: float = 0.0,
    user_id: int | None = None,
    context_window: int | None = None,
) -> BaseChatModel:
    """Build the conversation-compaction model used by SummarizationMiddleware.

    Uses ``agent_summary_model`` (default OpenRouter's free autorouter) when the
    active provider is OpenRouter (BYOK or env fallback); otherwise reuses the
    main chat model so summaries work for any BYOK provider.
    """
    settings = get_settings()
    summary_model = (settings.agent_summary_model or "").strip()
    resolved = resolve_llm_config(user_id=user_id)
    if summary_model and resolved.provider == "openrouter":
        return _build(
            ResolvedLlm(
                provider="openrouter",
                model=summary_model,
                api_key=resolved.api_key,
                source=resolved.source,
            ),
            temperature=temperature,
            context_window=context_window,
        )
    return build_chat_model(
        temperature=temperature,
        user_id=user_id,
        context_window=context_window,
    )


def _build(
    resolved: ResolvedLlm,
    *,
    temperature: float,
    context_window: int | None = None,
) -> BaseChatModel:
    profile = {"max_input_tokens": context_window} if context_window else None
    if resolved.provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=resolved.model,
            api_key=resolved.api_key,
            temperature=temperature,
            profile=profile,
        )

    if resolved.provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=resolved.model,
            api_key=resolved.api_key,
            temperature=temperature,
            profile=profile,
        )

    if resolved.provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=resolved.model,
            google_api_key=resolved.api_key,
            temperature=temperature,
            profile=profile,
        )

    if resolved.provider == "custom":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=resolved.model,
            api_key=resolved.api_key,
            base_url=resolved.base_url,
            temperature=temperature,
            profile=profile,
        )

    # openrouter
    return ChatOpenRouter(
        model=resolved.model,
        api_key=resolved.api_key,
        temperature=temperature,
        profile=profile,
    )


@dataclass
class ProviderModel:
    id: str
    name: str = ""


def _dedupe_sort_models(models: list[ProviderModel]) -> list[ProviderModel]:
    seen: set[str] = set()
    out: list[ProviderModel] = []
    for m in models:
        mid = (m.id or "").strip()
        if not mid or mid in seen:
            continue
        seen.add(mid)
        out.append(ProviderModel(id=mid, name=(m.name or "").strip() or mid))
    out.sort(key=lambda m: m.id.lower())
    return out


def _parse_openai_style(payload: dict) -> list[ProviderModel]:
    rows = payload.get("data") or []
    models: list[ProviderModel] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        mid = str(row.get("id") or "").strip()
        if not mid:
            continue
        name = str(row.get("name") or row.get("display_name") or mid).strip()
        models.append(ProviderModel(id=mid, name=name))
    return _dedupe_sort_models(models)


def _parse_anthropic(payload: dict) -> list[ProviderModel]:
    rows = payload.get("data") or []
    models: list[ProviderModel] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        mid = str(row.get("id") or "").strip()
        if not mid:
            continue
        name = str(row.get("display_name") or row.get("name") or mid).strip()
        models.append(ProviderModel(id=mid, name=name))
    return _dedupe_sort_models(models)


def _parse_google(payload: dict) -> list[ProviderModel]:
    rows = payload.get("models") or []
    models: list[ProviderModel] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        methods = row.get("supportedGenerationMethods") or row.get("supported_generation_methods")
        if isinstance(methods, list) and methods and "generateContent" not in methods:
            continue
        raw_name = str(row.get("name") or "").strip()
        if not raw_name:
            continue
        mid = raw_name.removeprefix("models/")
        display = str(row.get("displayName") or row.get("display_name") or mid).strip()
        models.append(ProviderModel(id=mid, name=display))
    return _dedupe_sort_models(models)


class ProviderModelsError(Exception):
    """Raised when a provider models catalog cannot be fetched."""

    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


async def list_provider_models(
    provider: ProviderId,
    *,
    api_key: str,
    base_url: str = "",
) -> list[ProviderModel]:
    """Fetch and normalize the chat/model catalog for a provider."""
    import httpx

    key = api_key.strip()
    if not key:
        raise ProviderModelsError("API key is required", status_code=400)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if provider == "openrouter":
                res = await client.get(
                    "https://openrouter.ai/api/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                if res.status_code >= 400:
                    raise ProviderModelsError(
                        f"OpenRouter rejected key ({res.status_code})",
                        status_code=502,
                    )
                return _parse_openai_style(res.json())

            if provider == "openai":
                res = await client.get(
                    "https://api.openai.com/v1/models",
                    headers={"Authorization": f"Bearer {key}"},
                )
                if res.status_code >= 400:
                    raise ProviderModelsError(
                        f"OpenAI rejected key ({res.status_code})",
                        status_code=502,
                    )
                return _parse_openai_style(res.json())

            if provider == "anthropic":
                res = await client.get(
                    "https://api.anthropic.com/v1/models",
                    headers={
                        "x-api-key": key,
                        "anthropic-version": "2023-06-01",
                    },
                )
                if res.status_code >= 400:
                    raise ProviderModelsError(
                        f"Anthropic rejected key ({res.status_code})",
                        status_code=502,
                    )
                return _parse_anthropic(res.json())

            if provider == "google":
                res = await client.get(
                    "https://generativelanguage.googleapis.com/v1beta/models",
                    params={"key": key},
                )
                if res.status_code >= 400:
                    raise ProviderModelsError(
                        f"Google rejected key ({res.status_code})",
                        status_code=502,
                    )
                return _parse_google(res.json())

            if provider == "custom":
                if not base_url.strip():
                    raise ProviderModelsError("Base URL is required", status_code=400)
                root = base_url.rstrip("/")
                url = f"{root}/models" if root.endswith("/v1") else f"{root}/v1/models"
                res = await client.get(
                    url,
                    headers={"Authorization": f"Bearer {key}"},
                )
                if res.status_code >= 400:
                    raise ProviderModelsError(
                        f"Custom endpoint rejected key ({res.status_code})",
                        status_code=502,
                    )
                return _parse_openai_style(res.json())

            raise ProviderModelsError(f"Unknown provider: {provider}", status_code=400)
    except ProviderModelsError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ProviderModelsError(str(exc) or "Connection failed", status_code=502) from exc


async def probe_provider(
    provider: ProviderId,
    *,
    api_key: str,
    model: str,
    base_url: str = "",
) -> tuple[bool, str]:
    """Lightweight connectivity check for Settings → Test."""
    del model  # connectivity probe does not need a specific model id
    try:
        models = await list_provider_models(provider, api_key=api_key, base_url=base_url)
        label = {
            "openrouter": "OpenRouter",
            "openai": "OpenAI",
            "anthropic": "Anthropic",
            "google": "Google",
            "custom": "Custom endpoint",
        }.get(provider, provider)
        return True, f"{label} key ok ({len(models)} models)"
    except ProviderModelsError as exc:
        return False, str(exc)
