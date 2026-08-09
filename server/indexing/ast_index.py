"""AST symbol extraction via tree-sitter (Python + JS/TS)."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

import tree_sitter_javascript as ts_js
import tree_sitter_python as ts_python
import tree_sitter_typescript as ts_typescript
from tree_sitter import Language, Node, Parser, Query, QueryCursor


@dataclass
class Symbol:
    name: str
    kind: str
    file_path: str
    start_line: int
    end_line: int
    snippet: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_PY_LANGUAGE = Language(ts_python.language())
_JS_LANGUAGE = Language(ts_js.language())
_TS_LANGUAGE = Language(ts_typescript.language_typescript())
_TSX_LANGUAGE = Language(ts_typescript.language_tsx())

_LANG_BY_SUFFIX: dict[str, Language] = {
    ".py": _PY_LANGUAGE,
    ".js": _JS_LANGUAGE,
    ".jsx": _JS_LANGUAGE,
    ".mjs": _JS_LANGUAGE,
    ".cjs": _JS_LANGUAGE,
    ".ts": _TS_LANGUAGE,
    ".tsx": _TSX_LANGUAGE,
}

_PY_QUERY = """
(function_definition name: (identifier) @name) @def
(class_definition name: (identifier) @name) @def
"""

_JS_QUERY = """
(function_declaration name: (identifier) @name) @def
(class_declaration name: (identifier) @name) @def
(lexical_declaration (variable_declarator name: (identifier) @name)) @def
(export_statement (function_declaration name: (identifier) @name)) @def
(export_statement (class_declaration name: (identifier) @name)) @def
"""


def language_for_path(path: Path) -> Optional[Language]:
    return _LANG_BY_SUFFIX.get(path.suffix.lower())


def _node_text(source: bytes, node: Node) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def extract_symbols(file_path: Path, relative_path: str, source: bytes) -> list[Symbol]:
    language = language_for_path(file_path)
    if language is None:
        return []

    parser = Parser(language)
    tree = parser.parse(source)
    query_src = _PY_QUERY if file_path.suffix.lower() == ".py" else _JS_QUERY

    try:
        query = Query(language, query_src)
        cursor = QueryCursor(query)
        matches = cursor.matches(tree.root_node)
    except Exception:
        return []

    symbols: list[Symbol] = []
    seen: set[tuple[str, int]] = set()

    for _pattern_index, captures in matches:
        name_nodes = captures.get("name") or []
        def_nodes = captures.get("def") or name_nodes
        if not name_nodes or not def_nodes:
            continue
        name_node = name_nodes[0]
        def_node = def_nodes[0]
        name = _node_text(source, name_node)
        key = (name, def_node.start_point[0] + 1)
        if key in seen:
            continue
        seen.add(key)
        kind = "class" if "class" in def_node.type else "function"
        snippet = _node_text(source, def_node)
        if len(snippet) > 800:
            snippet = snippet[:800] + "\n..."
        symbols.append(
            Symbol(
                name=name,
                kind=kind,
                file_path=relative_path,
                start_line=def_node.start_point[0] + 1,
                end_line=def_node.end_point[0] + 1,
                snippet=snippet,
            )
        )
    return symbols


def extract_imports(file_path: Path, relative_path: str, source: bytes) -> list[tuple[str, str]]:
    """Return (from_file, imported_module) pairs."""
    text = source.decode("utf-8", errors="replace")
    imports: list[tuple[str, str]] = []
    suffix = file_path.suffix.lower()

    if suffix == ".py":
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("import "):
                mods = stripped[len("import ") :].split("#")[0]
                for part in mods.split(","):
                    mod = part.strip().split(" as ")[0].strip()
                    if mod:
                        imports.append((relative_path, mod))
            elif stripped.startswith("from "):
                rest = stripped[len("from ") :]
                if " import " in rest:
                    mod = rest.split(" import ", 1)[0].strip()
                    if mod:
                        imports.append((relative_path, mod))
    else:
        for line in text.splitlines():
            stripped = line.strip()
            if "from " in stripped and " import " in stripped and stripped.startswith("import "):
                try:
                    mod = stripped.split(" from ", 1)[1].strip().strip(";").strip("'\"")
                    if mod:
                        imports.append((relative_path, mod))
                except Exception:
                    continue
            elif stripped.startswith("import "):
                raw = stripped[len("import ") :].strip().strip(";")
                if (raw.startswith("'") or raw.startswith('"')) and (
                    raw.endswith("'") or raw.endswith('"')
                ):
                    imports.append((relative_path, raw.strip("'\"")))
                elif raw.startswith("(") and raw.endswith(")"):
                    imports.append((relative_path, raw[1:-1].strip("'\"")))
    return imports
