"""LangChain tools wrapping hybrid retrieve and scoped filesystem."""

from __future__ import annotations

import json
from contextvars import ContextVar
from pathlib import Path

from langchain.tools import tool

from indexing.retrieve import format_context_pack, hybrid_retrieve
from tools.files.filesystem import FileSystem
from tools.tests.run_tests import run_workspace_tests

_workspace_var: ContextVar[Path] = ContextVar("workspace", default=Path("./workspace").resolve())
_repo_id_var: ContextVar[str] = ContextVar("repo_id", default="default")
_fs_var: ContextVar[FileSystem] = ContextVar("fs", default=FileSystem("./workspace"))


def configure_tools(workspace: str | Path, repo_id: int | str) -> None:
    """Set workspace and repo_id for the current execution context (thread-safe)."""
    ws = Path(workspace).resolve()
    _workspace_var.set(ws)
    _repo_id_var.set(str(repo_id))
    _fs_var.set(FileSystem(str(ws)))


@tool
def search_repository(query: str) -> str:
    """Hybrid search across RAG, AST symbols, and the dependency graph for the active repo.

    Call ONCE per distinct query to gather context. Do not call again with the
    same or a similar query — reuse the result you already received."""
    result = hybrid_retrieve(_repo_id_var.get(), _workspace_var.get(), query)
    return format_context_pack(result)


@tool
def read_file(file_path: str) -> str:
    """Read a file from the active repository workspace.

    Do not read the same file twice — reuse the content from your earlier call.
    Limit yourself to a few targeted reads rather than scanning the whole tree."""
    return _fs_var.get().read(file_path)


@tool
def write_file(file_path: str, content: str) -> str:
    """Write/overwrite a file in the active repository workspace.

    After writing, do not re-read the file to verify — trust the success message."""
    _fs_var.get().write(file_path, content)
    return f"Wrote {file_path}"


@tool
def create_file(file_path: str, content: str = "") -> str:
    """Create a new file in the active repository workspace.

    After creating, do not re-read the file to verify — trust the success message."""
    _fs_var.get().create(file_path, content)
    return f"Created {file_path}"


@tool
def list_files(directory: str = ".") -> list[str]:
    """List files under a directory in the active repository workspace.

    Call once per directory. Do not list the same directory again."""
    return _fs_var.get().list_directory(directory)


@tool
def edit_file(file_path: str, content: str, start_line: int, end_line: int) -> str:
    """Replace lines start_line..end_line (1-indexed inclusive end) in a file.

    After editing, do not re-read the file to verify — trust the success message."""
    _fs_var.get().edit_lines(file_path, start_line, end_line, content)
    return f"Edited {file_path} lines {start_line}-{end_line}"


@tool
def delete_file(file_path: str) -> str:
    """Delete a file from the active repository workspace."""
    _fs_var.get().delete(file_path)
    return f"Deleted {file_path}"


@tool
def run_tests() -> str:
    """Run the workspace's detected test command (pytest, npm test, cargo, go, make).

    Does not accept a custom shell command. Call ONCE, then interpret the output.
    Do not call again unless you have made code changes since the last run."""
    result = run_workspace_tests(_workspace_var.get())
    return json.dumps(result)


DEV_TOOLS = [search_repository, read_file, write_file, create_file, list_files, edit_file, delete_file]
READ_TOOLS = [search_repository, read_file, list_files]
TEST_TOOLS = [*READ_TOOLS, run_tests, create_file, delete_file]
