"""Detect and run allowlisted test commands in a repo workspace."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

TEST_TIMEOUT_SECONDS = 120
MAX_OUTPUT_CHARS = 8000

# argv prefixes only — remaining tokens must be flags, `--`, or `./...`.
_ALLOWED_PREFIXES: tuple[tuple[str, ...], ...] = (
    ("python", "-m", "pytest"),
    ("python3", "-m", "pytest"),
    ("pytest",),
    ("npm", "test"),
    ("pnpm", "test"),
    ("yarn", "test"),
    ("cargo", "test"),
    ("go", "test"),
    ("make", "test"),
)

_SAFE_TRAILING = frozenset({"--", "./..."})


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _has_pytest(workspace: Path) -> bool:
    if (workspace / "pytest.ini").is_file() or (workspace / "conftest.py").is_file():
        return True
    pyproject = _read_text(workspace / "pyproject.toml")
    if "[tool.pytest" in pyproject or "pytest" in pyproject:
        return True
    if "[tool:pytest]" in _read_text(workspace / "setup.cfg"):
        return True
    tests_dir = workspace / "tests"
    if tests_dir.is_dir():
        return any(path.is_file() for path in tests_dir.rglob("test_*.py"))
    return False


def _package_json(workspace: Path) -> dict[str, Any] | None:
    path = workspace / "package.json"
    if not path.is_file():
        return None
    try:
        data = json.loads(_read_text(path) or "{}")
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _node_test_command(workspace: Path) -> list[str] | None:
    pkg = _package_json(workspace)
    if not pkg:
        return None
    scripts = pkg.get("scripts")
    if not isinstance(scripts, dict) or "test" not in scripts:
        return None
    extra = ["--", "--watchAll=false"]
    if (workspace / "pnpm-lock.yaml").is_file():
        return ["pnpm", "test", *extra]
    if (workspace / "yarn.lock").is_file():
        return ["yarn", "test", "--watchAll=false"]
    return ["npm", "test", *extra]


def _makefile_has_test(workspace: Path) -> bool:
    makefile = workspace / "Makefile"
    if not makefile.is_file():
        makefile = workspace / "makefile"
    if not makefile.is_file():
        return False
    for line in _read_text(makefile).splitlines():
        stripped = line.split("#", 1)[0].rstrip()
        if stripped.startswith("test:") or stripped == "test:":
            return True
    return False


def detect_test_command(workspace: str | Path) -> list[str] | None:
    """Return the first matching allowlisted test argv, or None."""
    root = Path(workspace)
    if _has_pytest(root):
        return ["python", "-m", "pytest", "-q", "--tb=short"]
    node = _node_test_command(root)
    if node:
        return node
    if (root / "Cargo.toml").is_file():
        return ["cargo", "test"]
    if (root / "go.mod").is_file():
        return ["go", "test", "./..."]
    if _makefile_has_test(root):
        return ["make", "test"]
    return None


def is_allowed_test_command(argv: list[str] | tuple[str, ...]) -> bool:
    """True only for detected-style commands; rejects free-form shells."""
    if not argv:
        return False
    parts = [str(p) for p in argv]
    if any(not p or "\n" in p or "\x00" in p for p in parts):
        return False
    for prefix in _ALLOWED_PREFIXES:
        if parts[: len(prefix)] != list(prefix):
            continue
        trailing = parts[len(prefix) :]
        if all(t in _SAFE_TRAILING or t.startswith("-") for t in trailing):
            return True
    return False


def _truncate(text: str) -> str:
    if len(text) <= MAX_OUTPUT_CHARS:
        return text
    omitted = len(text) - MAX_OUTPUT_CHARS
    return text[:MAX_OUTPUT_CHARS] + f"\n... [truncated {omitted} chars]"


def run_workspace_tests(workspace: str | Path) -> dict[str, Any]:
    """Run the detected test command in ``workspace``. Never takes a custom command."""
    root = Path(workspace).resolve()
    command = detect_test_command(root)
    if not command:
        return {
            "ran": False,
            "passed": None,
            "command": None,
            "exit_code": None,
            "timed_out": False,
            "stdout": "",
            "stderr": "",
            "error": None,
            "no_tests_found": True,
        }
    if not is_allowed_test_command(command):
        return {
            "ran": False,
            "passed": False,
            "command": command,
            "exit_code": None,
            "timed_out": False,
            "stdout": "",
            "stderr": "",
            "error": "Detected command is not on the test allowlist",
            "no_tests_found": False,
        }

    env = os.environ.copy()
    env["CI"] = "true"
    try:
        proc = subprocess.run(  # noqa: S603 — argv is allowlisted, never shell=True
            command,
            cwd=root,
            capture_output=True,
            text=True,
            timeout=TEST_TIMEOUT_SECONDS,
            env=env,
            check=False,
        )
    except FileNotFoundError as exc:
        return {
            "ran": False,
            "passed": False,
            "command": command,
            "exit_code": None,
            "timed_out": False,
            "stdout": "",
            "stderr": "",
            "error": f"Test runner not found: {exc}",
            "no_tests_found": False,
        }
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout or b"").decode(
            "utf-8", errors="replace"
        )
        stderr = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr or b"").decode(
            "utf-8", errors="replace"
        )
        return {
            "ran": True,
            "passed": False,
            "command": command,
            "exit_code": None,
            "timed_out": True,
            "stdout": _truncate(stdout),
            "stderr": _truncate(stderr or f"Timed out after {TEST_TIMEOUT_SECONDS}s"),
            "error": f"Tests timed out after {TEST_TIMEOUT_SECONDS}s",
            "no_tests_found": False,
        }

    return {
        "ran": True,
        "passed": proc.returncode == 0,
        "command": command,
        "exit_code": proc.returncode,
        "timed_out": False,
        "stdout": _truncate(proc.stdout or ""),
        "stderr": _truncate(proc.stderr or ""),
        "error": None,
        "no_tests_found": False,
    }
