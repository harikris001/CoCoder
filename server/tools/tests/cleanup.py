"""Revert workspace files the tester created or modified."""

from __future__ import annotations

from pathlib import Path

_SKIP_DIR_NAMES = {".git"}


def _is_skipped(rel: Path) -> bool:
    return any(part in _SKIP_DIR_NAMES for part in rel.parts)


def iter_workspace_files(root: Path) -> list[Path]:
    root = root.resolve()
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file() and not path.is_symlink():
            continue
        rel = path.relative_to(root)
        if _is_skipped(rel):
            continue
        files.append(path)
    return files


def take_workspace_snapshot(root: str | Path) -> dict[str, bytes]:
    """Map relative posix paths to file bytes (excludes .git)."""
    base = Path(root).resolve()
    snap: dict[str, bytes] = {}
    for path in iter_workspace_files(base):
        rel = path.relative_to(base).as_posix()
        try:
            snap[rel] = path.read_bytes()
        except OSError:
            continue
    return snap


def restore_workspace_snapshot(root: str | Path, snapshot: dict[str, bytes]) -> list[str]:
    """Delete files created after the snapshot and restore modified/deleted files.

    Returns relative paths that were removed or reverted.
    """
    base = Path(root).resolve()
    cleaned: list[str] = []
    current: dict[str, Path] = {}
    for path in iter_workspace_files(base):
        current[path.relative_to(base).as_posix()] = path

    for rel, path in current.items():
        if rel in snapshot:
            continue
        try:
            path.unlink()
            cleaned.append(rel)
        except OSError:
            continue

    for rel, content in snapshot.items():
        path = base / rel
        if path.is_file():
            try:
                if path.read_bytes() == content:
                    continue
            except OSError:
                pass
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            cleaned.append(rel)
        except OSError:
            continue

    _remove_empty_dirs(base, snapshot)
    return sorted(set(cleaned))


def _remove_empty_dirs(root: Path, snapshot: dict[str, bytes]) -> None:
    kept_dirs = {str((root / rel).parent) for rel in snapshot}
    kept_dirs.add(str(root))
    dirs = sorted(
        (p for p in root.rglob("*") if p.is_dir() and ".git" not in p.relative_to(root).parts),
        key=lambda p: len(p.parts),
        reverse=True,
    )
    for directory in dirs:
        if str(directory) in kept_dirs:
            continue
        try:
            directory.rmdir()
        except OSError:
            continue
