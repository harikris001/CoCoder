"""Classify GitHub issues and build safe branch names."""

from __future__ import annotations

import re
from typing import Any, Iterable, Literal

IssueType = Literal["fix", "feat", "docs", "refactor", "test", "chore", "perf"]

ISSUE_TYPES: tuple[IssueType, ...] = ("fix", "feat", "docs", "refactor", "test", "chore", "perf")

_LABEL_TO_TYPE: dict[str, IssueType] = {
    "bug": "fix",
    "bugfix": "fix",
    "defect": "fix",
    "fix": "fix",
    "type:bug": "fix",
    "enhancement": "feat",
    "feature": "feat",
    "feat": "feat",
    "type:feature": "feat",
    "type:enhancement": "feat",
    "documentation": "docs",
    "docs": "docs",
    "type:docs": "docs",
    "refactor": "refactor",
    "type:refactor": "refactor",
    "test": "test",
    "testing": "test",
    "tests": "test",
    "type:test": "test",
    "chore": "chore",
    "dependencies": "chore",
    "dependency": "chore",
    "maintenance": "chore",
    "type:chore": "chore",
    "performance": "perf",
    "perf": "perf",
    "type:perf": "perf",
}

_TYPE_TITLE: dict[IssueType, str] = {
    "fix": "Fix",
    "feat": "Feat",
    "docs": "Docs",
    "refactor": "Refactor",
    "test": "Test",
    "chore": "Chore",
    "perf": "Perf",
}

_SLUG_MAX = 50
_BRANCH_MAX = 200


def normalize_labels(labels: Iterable[Any] | None) -> list[str]:
    names: list[str] = []
    for lbl in labels or []:
        if isinstance(lbl, dict):
            name = lbl.get("name")
            if name:
                names.append(str(name))
        elif lbl:
            names.append(str(lbl))
    return names


def classify_from_labels(labels: Iterable[str] | None) -> IssueType | None:
    for raw in labels or []:
        key = str(raw).strip().lower()
        if key in _LABEL_TO_TYPE:
            return _LABEL_TO_TYPE[key]
        if key.startswith("type:"):
            mapped = _LABEL_TO_TYPE.get(key) or _LABEL_TO_TYPE.get(key.split(":", 1)[-1])
            if mapped:
                return mapped
    return None


def classify_from_text(title: str, body: str = "") -> IssueType:
    text = f"{title}\n{body}".lower()
    if re.search(r"\b(readme|docs?|documentation|typo)\b", text):
        return "docs"
    if re.search(r"\b(refactor|cleanup|clean up)\b", text):
        return "refactor"
    if re.search(r"\b(unit test|tests?|coverage|spec)\b", text):
        return "test"
    if re.search(r"\b(perf|performance|slow|latency)\b", text):
        return "perf"
    if re.search(r"\b(chore|bump|dependenc|upgrade)\b", text):
        return "chore"
    if re.search(r"\b(bug|fix|crash|error|broken|regression|fail(?:s|ing|ed)?)\b", text):
        return "fix"
    if re.search(r"\b(add|implement|support|feature|enhancement|new)\b", text):
        return "feat"
    return "fix"


def classify_issue(labels: Iterable[str] | None, title: str, body: str = "") -> IssueType:
    return classify_from_labels(labels) or classify_from_text(title, body)


def slugify(title: str, *, max_len: int = _SLUG_MAX) -> str:
    slug = title.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug.strip("-")
    if not slug:
        slug = "issue"
    if len(slug) > max_len:
        slug = slug[:max_len].rstrip("-")
    return slug or "issue"


def normalize_issue_type(value: Any) -> IssueType:
    raw = str(value or "").strip().lower()
    aliases: dict[str, IssueType] = {t: t for t in ISSUE_TYPES}
    aliases.update(_LABEL_TO_TYPE)
    return aliases.get(raw, "fix")


def branch_name_for_issue(issue_number: int, title: str, issue_type: IssueType) -> str:
    slug = slugify(title)
    name = f"{issue_type}/{issue_number}-{slug}"
    if len(name) > _BRANCH_MAX:
        extra = len(name) - _BRANCH_MAX
        slug = slugify(title, max_len=max(8, _SLUG_MAX - extra))
        name = f"{issue_type}/{issue_number}-{slug}"
    return name


def pr_title_for(issue_type: IssueType, title: str) -> str:
    cleaned = title.strip() or "Issue"
    prefix = _TYPE_TITLE[issue_type]
    if cleaned.lower().startswith(f"{prefix.lower()}:") or cleaned.lower().startswith(f"{issue_type}:"):
        return cleaned
    return f"{prefix}: {cleaned}"


def closes_keyword_for(issue_type: IssueType) -> Literal["Fixes", "Closes"]:
    return "Fixes" if issue_type == "fix" else "Closes"


def github_ops_dict(
    *,
    issue_number: int,
    title: str,
    issue_type: IssueType,
    rationale: str,
) -> dict[str, Any]:
    return {
        "issue_type": issue_type,
        "branch_name": branch_name_for_issue(issue_number, title, issue_type),
        "commit_prefix": issue_type,
        "pr_title": pr_title_for(issue_type, title),
        "closes_keyword": closes_keyword_for(issue_type),
        "rationale": rationale,
    }


def fallback_github_ops(
    *,
    issue_number: int,
    title: str,
    body: str = "",
    labels: Iterable[str] | None = None,
) -> dict[str, Any]:
    names = list(labels or [])
    issue_type = classify_issue(names, title, body)
    source = "labels" if classify_from_labels(names) else "title/description"
    return github_ops_dict(
        issue_number=issue_number,
        title=title,
        issue_type=issue_type,
        rationale=f"Fallback classification from {source}.",
    )


def sanitize_github_ops(
    payload: dict[str, Any] | None,
    *,
    issue_number: int,
    title: str,
    body: str = "",
    labels: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Force a git-safe branch name and allowed issue type."""
    if not payload or not str(payload.get("issue_type") or "").strip():
        return fallback_github_ops(
            issue_number=issue_number, title=title, body=body, labels=labels
        )
    issue_type = normalize_issue_type(payload.get("issue_type") or payload.get("commit_prefix"))
    rationale = str(payload.get("rationale") or "").strip() or "Classified by GitHub Ops agent."
    result = github_ops_dict(
        issue_number=issue_number,
        title=title,
        issue_type=issue_type,
        rationale=rationale,
    )
    raw_pr = str(payload.get("pr_title") or "").strip()
    if raw_pr:
        result["pr_title"] = raw_pr[:256]
    return result
