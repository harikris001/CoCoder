"""Create / update GitHub pull requests."""

from __future__ import annotations

from typing import Any, Optional

import httpx

from config import get_settings
from tools.github.client import GITHUB_API, github_headers


def create_pull_request(
    owner: str,
    repo: str,
    *,
    title: str,
    body: str,
    head: str,
    base: str,
    token: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    headers = github_headers(token or settings.github_token)
    url = f"{GITHUB_API}/repos/{owner}/{repo}/pulls"
    payload = {"title": title, "body": body, "head": head, "base": base}

    with httpx.Client(timeout=60.0, trust_env=False) as client:
        # If PR already exists for this head, return it
        existing = client.get(
            url,
            headers=headers,
            params={"state": "open", "head": f"{owner}:{head}"},
        )
        if existing.status_code == 200:
            data = existing.json()
            if isinstance(data, list) and data:
                return data[0]

        response = client.post(url, headers=headers, json=payload)
        if response.status_code >= 400:
            return {
                "error": True,
                "status_code": response.status_code,
                "message": response.text,
            }
        return response.json()


def build_pr_body(issue_number: int, summary: str, files: list[str]) -> str:
    file_list = "\n".join(f"- `{f}`" for f in files) or "- (no files listed)"
    return (
        f"## Summary\n\n{summary}\n\n"
        f"## Files changed\n\n{file_list}\n\n"
        f"Fixes #{issue_number}\n\n"
        f"_Opened automatically by CoCoder._\n"
    )
