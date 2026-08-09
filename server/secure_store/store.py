"""Fernet-encrypted BYOK secrets persisted under .cocoder/data."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Optional

from cryptography.fernet import Fernet, InvalidToken

from config import DATA_ROOT

ProviderId = Literal["openai", "anthropic", "google", "openrouter", "custom"]
PROVIDERS: tuple[ProviderId, ...] = ("openai", "anthropic", "google", "openrouter", "custom")

SECRETS_PATH = DATA_ROOT / "secrets.enc"
MASTER_KEY_PATH = DATA_ROOT / "master.key"


@dataclass
class ProviderCreds:
    api_key: str = ""
    model: str = ""
    base_url: str = ""


@dataclass
class LlmSecrets:
    active_provider: ProviderId = "openrouter"
    openai: ProviderCreds = field(default_factory=lambda: ProviderCreds(model="gpt-4o"))
    anthropic: ProviderCreds = field(default_factory=lambda: ProviderCreds(model="claude-sonnet-4-5"))
    google: ProviderCreds = field(default_factory=lambda: ProviderCreds(model="gemini-2.5-pro"))
    openrouter: ProviderCreds = field(
        default_factory=lambda: ProviderCreds(model="deepseek/deepseek-v4-flash")
    )
    custom: ProviderCreds = field(default_factory=ProviderCreds)

    def provider(self, name: ProviderId) -> ProviderCreds:
        return getattr(self, name)

    def to_dict(self) -> dict[str, Any]:
        return {
            "active_provider": self.active_provider,
            "openai": asdict(self.openai),
            "anthropic": asdict(self.anthropic),
            "google": asdict(self.google),
            "openrouter": asdict(self.openrouter),
            "custom": asdict(self.custom),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> LlmSecrets:
        if not data:
            return cls()
        active = data.get("active_provider") or "openrouter"
        if active not in PROVIDERS:
            active = "openrouter"

        def _creds(key: str, default_model: str = "") -> ProviderCreds:
            raw = data.get(key) or {}
            return ProviderCreds(
                api_key=str(raw.get("api_key") or ""),
                model=str(raw.get("model") or default_model),
                base_url=str(raw.get("base_url") or ""),
            )

        return cls(
            active_provider=active,  # type: ignore[arg-type]
            openai=_creds("openai", "gpt-4o"),
            anthropic=_creds("anthropic", "claude-sonnet-4-5"),
            google=_creds("google", "gemini-2.5-pro"),
            openrouter=_creds("openrouter", "deepseek/deepseek-v4-flash"),
            custom=_creds("custom"),
        )


def mask_key(key: str) -> Optional[str]:
    key = (key or "").strip()
    if not key:
        return None
    if len(key) <= 4:
        return "••••"
    return f"••••{key[-4:]}"


def _ensure_data_dir() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)


def _fernet_from_env(env_key: str) -> Fernet:
    """Build a Fernet from COCODER_SECRETS_KEY (Fernet token or arbitrary string)."""
    try:
        return Fernet(env_key.encode("utf-8"))
    except (ValueError, TypeError):
        digest = hashlib.sha256(env_key.encode("utf-8")).digest()
        return Fernet(base64.urlsafe_b64encode(digest))


def _load_or_create_fernet() -> Fernet:
    _ensure_data_dir()
    env_key = (os.environ.get("COCODER_SECRETS_KEY") or "").strip()
    if env_key:
        return _fernet_from_env(env_key)

    if MASTER_KEY_PATH.exists():
        return Fernet(MASTER_KEY_PATH.read_bytes().strip())

    key = Fernet.generate_key()
    MASTER_KEY_PATH.write_bytes(key)
    try:
        os.chmod(MASTER_KEY_PATH, 0o600)
    except OSError:
        pass
    return Fernet(key)


def _read_blob() -> dict[str, Any]:
    if not SECRETS_PATH.exists():
        return {}
    fernet = _load_or_create_fernet()
    try:
        plain = fernet.decrypt(SECRETS_PATH.read_bytes())
        data = json.loads(plain.decode("utf-8"))
        return data if isinstance(data, dict) else {}
    except (InvalidToken, json.JSONDecodeError, OSError):
        return {}


def _write_blob(data: dict[str, Any]) -> None:
    _ensure_data_dir()
    fernet = _load_or_create_fernet()
    payload = json.dumps(data, separators=(",", ":")).encode("utf-8")
    SECRETS_PATH.write_bytes(fernet.encrypt(payload))
    try:
        os.chmod(SECRETS_PATH, 0o600)
    except OSError:
        pass


def get_llm_secrets(user_id: int | None = None) -> LlmSecrets:
    blob = _read_blob()
    if not isinstance(blob, dict):
        return LlmSecrets()
    if user_id is not None:
        users = blob.get("llm_by_user")
        if isinstance(users, dict):
            return LlmSecrets.from_dict(users.get(str(user_id)))
        return LlmSecrets()
    return LlmSecrets.from_dict(blob.get("llm"))


def save_llm_secrets(secrets: LlmSecrets, user_id: int | None = None) -> LlmSecrets:
    blob = _read_blob()
    if user_id is None:
        blob["llm"] = secrets.to_dict()
    else:
        users = blob.setdefault("llm_by_user", {})
        if not isinstance(users, dict):
            users = {}
            blob["llm_by_user"] = users
        users[str(user_id)] = secrets.to_dict()
    _write_blob(blob)
    return secrets


def clear_llm_secrets(user_id: int | None = None) -> None:
    blob = _read_blob()
    if user_id is None:
        blob.pop("llm", None)
    else:
        users = blob.get("llm_by_user")
        if isinstance(users, dict):
            users.pop(str(user_id), None)
            if not users:
                blob.pop("llm_by_user", None)
    if blob:
        _write_blob(blob)
    elif SECRETS_PATH.exists():
        SECRETS_PATH.unlink()


def update_llm_secrets(
    *,
    user_id: int | None = None,
    active_provider: Optional[ProviderId] = None,
    openai: Optional[dict[str, Any]] = None,
    anthropic: Optional[dict[str, Any]] = None,
    google: Optional[dict[str, Any]] = None,
    openrouter: Optional[dict[str, Any]] = None,
    custom: Optional[dict[str, Any]] = None,
) -> LlmSecrets:
    """Merge updates. Blank api_key means leave existing key unchanged."""
    current = get_llm_secrets(user_id)
    if active_provider and active_provider in PROVIDERS:
        current.active_provider = active_provider

    def _merge(target: ProviderCreds, patch: Optional[dict[str, Any]]) -> None:
        if not patch:
            return
        if "model" in patch and patch["model"] is not None:
            target.model = str(patch["model"]).strip()
        if "base_url" in patch and patch["base_url"] is not None:
            target.base_url = str(patch["base_url"]).strip()
        if "api_key" in patch and patch["api_key"] is not None:
            key = str(patch["api_key"]).strip()
            if key:
                target.api_key = key

    _merge(current.openai, openai)
    _merge(current.anthropic, anthropic)
    _merge(current.google, google)
    _merge(current.openrouter, openrouter)
    _merge(current.custom, custom)
    return save_llm_secrets(current, user_id)
