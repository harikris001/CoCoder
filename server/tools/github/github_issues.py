"""GitHub issues helpers."""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from langchain.tools import tool

load_dotenv()


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.getenv('GITHUB_TOKEN')}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def fetch_issues(
    owner: str,
    repo: str,
    *,
    state: str = "open",
    per_page: int = 30,
    page: int = 1,
) -> list[dict[str, Any]]:
    url = f"https://api.github.com/repos/{owner}/{repo}/issues"
    params = {"state": state, "sort": "created", "order": "desc", "per_page": per_page, "page": page}
    with httpx.Client(timeout=30.0, trust_env=False) as client:
        response = client.get(url, headers=_headers(), params=params)
        response.raise_for_status()
        data = response.json()
    if not isinstance(data, list):
        return []
    issues: list[dict[str, Any]] = []
    for issue in data:
        if issue.get("pull_request"):
            continue
        issues.append(_normalize_issue(issue))
    return issues


def fetch_issue(owner: str, repo: str, number: int) -> Optional[dict[str, Any]]:
    url = f"https://api.github.com/repos/{owner}/{repo}/issues/{number}"
    with httpx.Client(timeout=30.0, trust_env=False) as client:
        response = client.get(url, headers=_headers())
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return _normalize_issue(response.json())


def _normalize_issue(issue: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": issue.get("number"),
        "title": issue.get("title"),
        "state": issue.get("state"),
        "labels": [lbl.get("name") if isinstance(lbl, dict) else lbl for lbl in (issue.get("labels") or [])],
        "body": issue.get("body"),
        "reported_by": (issue.get("user") or {}).get("login"),
        "html_url": issue.get("html_url"),
    }


@tool
def get_github_issues(url: str, state: str = "open", per_page: int = 10) -> list[dict[str, Any]] | str:
    """Fetch issues from a GitHub issues API URL (e.g. https://api.github.com/repos/owner/repo/issues)."""
    params = {"state": state, "sort": "created", "order": "desc", "per_page": per_page}
    with httpx.Client(timeout=30.0, trust_env=False) as client:
        response = client.get(url, headers=_headers(), params=params)
        if response.status_code != 200:
            return f"Error fetching issues: {response.status_code} - {response.text}"
        page_data = response.json()
    if not isinstance(page_data, list):
        return page_data
    return [_normalize_issue(issue) for issue in page_data if not issue.get("pull_request")]
