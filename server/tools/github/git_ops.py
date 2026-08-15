"""Git branch / commit / push operations for issue branches."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional
from urllib.parse import quote, urlsplit, urlunsplit

from git import GitCommandError, InvalidGitRepositoryError, Repo

from config import get_settings

logger = logging.getLogger(__name__)


def workspace_for(owner: str, name: str, root: Path) -> Path:
    return root / f"{owner}__{name}"


def ensure_repo(clone_url: str, workspace: Path, token: Optional[str] = None) -> Repo:
    workspace.parent.mkdir(parents=True, exist_ok=True)
    clean_url = _clean_url(clone_url)
    auth_url = _authenticated_url(clean_url, token or get_settings().github_token)

    if workspace.exists() and (workspace / ".git").exists():
        repo = Repo(str(workspace))
        try:
            repo.remotes.origin.set_url(auth_url)
            repo.remotes.origin.fetch()
        except GitCommandError:
            logger.warning("GitHub repository fetch failed")
        finally:
            repo.remotes.origin.set_url(clean_url)
        return repo

    if workspace.exists():
        # Non-git directory — remove empty-ish or fail clearly
        if any(workspace.iterdir()):
            raise RuntimeError(f"Workspace exists but is not a git repo: {workspace}")
        workspace.rmdir()

    try:
        repo = Repo.clone_from(auth_url, str(workspace))
    except GitCommandError as exc:
        raise RuntimeError(_redact_git_error(str(exc), token or get_settings().github_token)) from None
    repo.remotes.origin.set_url(clean_url)
    return repo


def _authenticated_url(clone_url: str, token: str) -> str:
    if not token:
        return clone_url
    if clone_url.startswith("https://"):
        return clone_url.replace("https://", f"https://x-access-token:{quote(token, safe='')}@", 1)
    return clone_url


def _redact_git_error(error: str, token: Optional[str]) -> str:
    if not token:
        return error
    redacted = error.replace(token, "[REDACTED]")
    encoded = quote(token, safe="")
    if encoded != token:
        redacted = redacted.replace(encoded, "[REDACTED]")
    return redacted


def _clean_url(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme and parsed.netloc:
        return urlunsplit((parsed.scheme, parsed.hostname or "", parsed.path, parsed.query, parsed.fragment))
    return url


def ensure_issue_branch(
    repo: Repo,
    branch_name: str,
    default_branch: str = "main",
    token: Optional[str] = None,
) -> str:
    # Refresh remote refs
    origin_url = repo.remotes.origin.url
    try:
        if token:
            repo.remotes.origin.set_url(_authenticated_url(_clean_url(origin_url), token))
        repo.remotes.origin.fetch()
    except GitCommandError:
        pass
    finally:
        repo.remotes.origin.set_url(_clean_url(origin_url))

    local_names = {ref.name for ref in repo.heads}
    remote_names = {ref.remote_head for ref in repo.remotes.origin.refs} if repo.remotes else set()

    if branch_name in local_names:
        repo.git.checkout(branch_name)
        return branch_name

    if branch_name in remote_names:
        repo.git.checkout("-b", branch_name, f"origin/{branch_name}")
        return branch_name

    # Create from default branch
    base = default_branch
    if f"origin/{default_branch}" in [r.name for r in repo.remotes.origin.refs]:
        repo.git.checkout("-B", default_branch, f"origin/{default_branch}")
    elif default_branch in local_names:
        repo.git.checkout(default_branch)
    else:
        # fall back to current HEAD
        base = repo.active_branch.name

    repo.git.checkout("-b", branch_name)
    logger.info("Created branch %s from %s", branch_name, base)
    return branch_name


def commit_all(repo: Repo, message: str) -> bool:
    try:
        repo.git.add(A=True)
        cached = repo.git.diff("--cached")
        if not cached:
            return False
        repo.index.commit(message)
        return True
    except Exception as exc:
        logger.error("Commit failed: %s", exc)
        return False


def push_branch(repo: Repo, branch_name: str, token: Optional[str] = None) -> None:
    origin_url = repo.remotes.origin.url
    try:
        if token:
            repo.remotes.origin.set_url(_authenticated_url(_clean_url(origin_url), token))
        repo.remotes.origin.push(refspec=f"{branch_name}:{branch_name}", set_upstream=True)
    except GitCommandError as exc:
        raise RuntimeError(_redact_git_error(str(exc), token)) from None
    finally:
        repo.remotes.origin.set_url(_clean_url(origin_url))


def get_diff(repo: Repo, base: str = "HEAD") -> tuple[str, list[str]]:
    default = "main"
    try:
        for candidate in ("main", "master"):
            if any(r.name.endswith(f"/{candidate}") for r in repo.remotes.origin.refs):
                default = candidate
                break
        diff = repo.git.diff(f"origin/{default}...HEAD")
        names = repo.git.diff("--name-only", f"origin/{default}...HEAD").splitlines()
        return diff, [n for n in names if n]
    except Exception:
        pass
    try:
        diff = repo.git.diff(base)
        names = repo.git.diff("--name-only", base).splitlines()
        if not diff:
            diff = repo.git.diff()
            names = repo.git.diff("--name-only").splitlines()
        return diff, [n for n in names if n]
    except Exception:
        return "", []


def changed_files(repo: Repo, default_branch: str = "main") -> list[str]:
    try:
        names = repo.git.diff("--name-only", f"origin/{default_branch}...HEAD").splitlines()
        return [n for n in names if n]
    except GitCommandError:
        try:
            return [item.a_path for item in repo.index.diff(None)] + list(repo.untracked_files)
        except Exception:
            return []
