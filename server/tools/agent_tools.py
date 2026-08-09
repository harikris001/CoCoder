"""LangChain tools wrapping hybrid retrieve and scoped filesystem."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from langchain.tools import tool

from indexing.retrieve import format_context_pack, hybrid_retrieve
from tools.files.filesystem import FileSystem

_workspace: Path = Path("./workspace").resolve()
_repo_id: str = "default"
_fs = FileSystem(str(_workspace))


def configure_tools(workspace: str | Path, repo_id: int | str) -> None:
    global _workspace, _repo_id, _fs
    _workspace = Path(workspace).resolve()
    _repo_id = str(repo_id)
    _fs = FileSystem(str(_workspace))


@tool
def search_repository(query: str) -> str:
    """Hybrid search across RAG, AST symbols, and the dependency graph for the active repo."""
    result = hybrid_retrieve(_repo_id, _workspace, query)
    return format_context_pack(result)


@tool
def read_file(file_path: str) -> str:
    """Read a file from the active repository workspace."""
    return _fs.read(file_path)


@tool
def write_file(file_path: str, content: str) -> str:
    """Write/overwrite a file in the active repository workspace."""
    _fs.write(file_path, content)
    return f"Wrote {file_path}"


@tool
def create_file(file_path: str, content: str = "") -> str:
    """Create a new file in the active repository workspace."""
    _fs.create(file_path, content)
    return f"Created {file_path}"


@tool
def list_files(directory: str = ".") -> list[str]:
    """List files under a directory in the active repository workspace."""
    return _fs.list_directory(directory)


@tool
def edit_file(file_path: str, content: str, start_line: int, end_line: int) -> str:
    """Replace lines start_line..end_line (1-indexed inclusive end) in a file."""
    _fs.edit_lines(file_path, start_line, end_line, content)
    return f"Edited {file_path} lines {start_line}-{end_line}"


DEV_TOOLS = [search_repository, read_file, write_file, create_file, list_files, edit_file]
READ_TOOLS = [search_repository, read_file, list_files]
