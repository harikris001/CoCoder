"""Import / module dependency graph."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import networkx as nx

from indexing.ast_index import extract_imports


SKIP_DIRS = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".cocoder",
    "dist",
    "build",
    ".next",
    "coverage",
}


class DependencyGraph:
    def __init__(self) -> None:
        self.graph = nx.DiGraph()

    def build(self, root: Path) -> dict[str, Any]:
        self.graph.clear()
        file_count = 0
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if path.suffix.lower() not in {".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"}:
                continue
            rel = str(path.relative_to(root))
            self.graph.add_node(rel)
            try:
                source = path.read_bytes()
            except OSError:
                continue
            for src, imported in extract_imports(path, rel, source):
                self.graph.add_edge(src, imported)
            file_count += 1

        return {
            "nodes": self.graph.number_of_nodes(),
            "edges": self.graph.number_of_edges(),
            "files": file_count,
        }

    def neighbors(self, node: str, hops: int = 1) -> list[str]:
        if node not in self.graph:
            # fuzzy: match by basename or module fragment
            candidates = [n for n in self.graph.nodes if node in str(n)]
            if not candidates:
                return []
            node = candidates[0]

        found: set[str] = set()
        frontier = {node}
        for _ in range(max(1, hops)):
            nxt: set[str] = set()
            for n in frontier:
                nxt.update(self.graph.successors(n))
                nxt.update(self.graph.predecessors(n))
            found.update(nxt)
            frontier = nxt
        found.discard(node)
        return sorted(found)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "nodes": list(self.graph.nodes),
            "edges": list(self.graph.edges),
        }
        path.write_text(json.dumps(data), encoding="utf-8")

    def load(self, path: Path) -> None:
        data = json.loads(path.read_text(encoding="utf-8"))
        self.graph = nx.DiGraph()
        self.graph.add_nodes_from(data.get("nodes", []))
        self.graph.add_edges_from(data.get("edges", []))
