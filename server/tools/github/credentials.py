"""Resolve a user's GitHub credential with a local-development fallback."""

from __future__ import annotations

from typing import Any

from config import get_settings
from secure_store import get_active_github_credential, get_github_secrets, mask_key


def resolve_github_token(user_id: int | None) -> str:
    if user_id is not None:
        active = get_active_github_credential(user_id)
        if active and active[1].token:
            return active[1].token
    return get_settings().github_token.strip()


def github_status(user_id: int) -> dict[str, Any]:
    secrets = get_github_secrets(user_id)
    active = secrets.active()
    if not active:
        env_token = get_settings().github_token.strip()
        return {
            "configured": bool(env_token),
            "source": "env" if env_token else None,
            "login": None,
            "mask": mask_key(env_token),
            "scopes": [],
            "expires_at": None,
            "pat_configured": bool(secrets.pat.token),
            "oauth_configured": bool(secrets.oauth.token),
        }
    source, credential = active
    return {
        "configured": True,
        "source": source,
        "login": credential.login or None,
        "mask": mask_key(credential.token),
        "scopes": credential.scopes,
        "expires_at": credential.expires_at,
        "pat_configured": bool(secrets.pat.token),
        "oauth_configured": bool(secrets.oauth.token),
    }
