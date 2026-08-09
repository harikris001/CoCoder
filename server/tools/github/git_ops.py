"""Git branch / commit / push operations for bugfix branches."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from git import GitCommandError, InvalidGitRepositoryError, Repo

from config import get_settings

logger = logging.getLogger(__name__)


def workspace_for(owner: str, name: str, root: Path) -> Path:
    return root / f"{owner}__{name}"


def ensure_repo(clone_url: str, workspace: Path, token: Optional[str] = None) -> Repo:
    workspace.parent.mkdir(parents=True, exist_ok=True)
    auth_url = _authenticated_url(clone_url, token or get_settings().github_token)

    if workspace.exists() and (workspace / ".git").exists():
        repo = Repo(str(workspace))
        try:
            repo.remotes.origin.set_url(auth_url)
            repo.remotes.origin.fetch()
        except GitCommandError as exc:
            logger.warning("Fetch failed: %s", exc)
        return repo

    if workspace.exists():
        # Non-git directory — remove empty-ish or fail clearly
        if any(workspace.iterdir()):
            raise RuntimeError(f"Workspace exists but is not a git repo: {workspace}")
        workspace.rmdir()

    return Repo.clone_from(auth_url, str(workspace))


def _authenticated_url(clone_url: str, token: str) -> str:
    if not token:
        return clone_url
    if clone_url.startswith("https://"):
        return clone_url.replace("https://", f"https://x-access-token:{token}@", 1)
    return clone_url


def ensure_bugfix_branch(repo: Repo, issue_number: int, default_branch: str = "main") -> str:
    branch_name = f"bugfix/{issue_number}"
    # Refresh remote refs
    try:
        repo.remotes.origin.fetch()
    except GitCommandError:
        pass

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


def push_branch(repo: Repo, branch_name: str) -> None:
    repo.remotes.origin.push(refspec=f"{branch_name}:{branch_name}", set_upstream=True)


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
