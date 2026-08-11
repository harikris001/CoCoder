"""Shared GitHub API authentication helpers."""

from __future__ import annotations

from typing import Any

import httpx

GITHUB_API = "https://api.github.com"


def github_headers(token: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


async def validate_github_token(token: str) -> dict[str, Any]:
    token = token.strip()
    if not token:
        raise ValueError("GitHub token is required")
    async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
        response = await client.get(f"{GITHUB_API}/user", headers=github_headers(token))
    if response.status_code >= 400:
        raise ValueError(f"GitHub rejected the token ({response.status_code})")
    data = response.json()
    if not isinstance(data, dict) or not data.get("login"):
        raise ValueError("GitHub returned an invalid user response")
    scopes = [scope.strip() for scope in response.headers.get("x-oauth-scopes", "").split(",") if scope.strip()]
    data["scopes"] = scopes
    return data
