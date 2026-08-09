"""Hybrid indexer combining RAG, AST symbols, dependency graph, and repo map."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from config import INDEX_ROOT
from indexing.ast_index import Symbol, extract_symbols, language_for_path
from indexing.dependency_graph import SKIP_DIRS, DependencyGraph
from indexing.rag import VectorIndex


@dataclass
class HybridRetrieveResult:
    query: str
    rag_hits: list[dict[str, Any]] = field(default_factory=list)
    symbols: list[dict[str, Any]] = field(default_factory=list)
    related_files: list[str] = field(default_factory=list)
    repo_map: str = ""
    context_pack: list[dict[str, Any]] = field(default_factory=list)


class HybridIndexer:
    def __init__(self, repo_id: int | str, workspace: Path) -> None:
        self.repo_id = str(repo_id)
        self.workspace = Path(workspace)
        self.index_dir = INDEX_ROOT / self.repo_id
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.vector = VectorIndex(self.index_dir / "chroma")
        self.graph = DependencyGraph()
        self.symbols: list[Symbol] = []
        self._symbols_path = self.index_dir / "symbols.json"
        self._graph_path = self.index_dir / "graph.json"
        self._map_path = self.index_dir / "repo_map.txt"
        self._meta_path = self.index_dir / "meta.json"

    def index(self, full: bool = True) -> dict[str, Any]:
        if full:
            self.vector.clear()
        rag_stats = self.vector.index_repo(self.workspace)
        graph_stats = self.graph.build(self.workspace)
        self.graph.save(self._graph_path)

        self.symbols = []
        for path in self.workspace.rglob("*"):
            if not path.is_file():
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if language_for_path(path) is None:
                continue
            try:
                source = path.read_bytes()
            except OSError:
                continue
            rel = str(path.relative_to(self.workspace))
            self.symbols.extend(extract_symbols(path, rel, source))

        self._symbols_path.write_text(
            json.dumps([s.to_dict() for s in self.symbols], indent=2),
            encoding="utf-8",
        )
        repo_map = self._build_repo_map()
        self._map_path.write_text(repo_map, encoding="utf-8")

        stats = {
            "chunks": rag_stats.get("chunks", 0),
            "symbols": len(self.symbols),
            "graph_nodes": graph_stats.get("nodes", 0),
            "graph_edges": graph_stats.get("edges", 0),
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        }
        self._meta_path.write_text(json.dumps(stats, indent=2), encoding="utf-8")
        return stats

    def load(self) -> None:
        if self._symbols_path.exists():
            raw = json.loads(self._symbols_path.read_text(encoding="utf-8"))
            self.symbols = [Symbol(**item) for item in raw]
        if self._graph_path.exists():
            self.graph.load(self._graph_path)

    def repo_map(self) -> str:
        if self._map_path.exists():
            return self._map_path.read_text(encoding="utf-8")
        return self._build_repo_map()

    def stats(self) -> dict[str, Any]:
        if self._meta_path.exists():
            return json.loads(self._meta_path.read_text(encoding="utf-8"))
        return {}

    def retrieve(self, query: str, k: int = 8, hops: int = 2) -> HybridRetrieveResult:
        self.load()
        rag_hits = self.vector.query(query, k=k)
        tokens = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", query))
        matched_symbols = [
            s.to_dict()
            for s in self.symbols
            if s.name in tokens or any(tok.lower() in s.name.lower() for tok in tokens)
        ][:20]

        seed_files = {h["path"] for h in rag_hits if h.get("path")}
        seed_files.update(s["file_path"] for s in matched_symbols)
        related: set[str] = set()
        for path in seed_files:
            related.update(self.graph.neighbors(path, hops=hops))
            # also try module-style neighbors from basename without suffix
            stem = Path(path).stem
            related.update(self.graph.neighbors(stem, hops=1))

        # Prefer real workspace-relative paths
        related_files = sorted(
            p for p in related if isinstance(p, str) and ("/" in p or p.endswith((".py", ".ts", ".tsx", ".js")))
        )[:40]

        context_pack: list[dict[str, Any]] = []
        seen_paths: set[str] = set()
        for hit in rag_hits:
            path = hit.get("path")
            if not path or path in seen_paths:
                continue
            seen_paths.add(path)
            context_pack.append(
                {
                    "path": path,
                    "snippet": hit.get("text", "")[:600],
                    "why": f"rag score={hit.get('score', 0):.3f}",
                }
            )
        for sym in matched_symbols:
            path = sym["file_path"]
            if path in seen_paths:
                continue
            seen_paths.add(path)
            context_pack.append(
                {
                    "path": path,
                    "snippet": sym.get("snippet", "")[:600],
                    "why": f"ast symbol {sym.get('kind')} {sym.get('name')}",
                }
            )
        for path in related_files:
            if path in seen_paths:
                continue
            full = self.workspace / path
            if not full.exists() or not full.is_file():
                continue
            try:
                snippet = full.read_text(encoding="utf-8", errors="replace")[:400]
            except OSError:
                continue
            seen_paths.add(path)
            context_pack.append({"path": path, "snippet": snippet, "why": "dependency graph neighbor"})
            if len(context_pack) >= 20:
                break

        return HybridRetrieveResult(
            query=query,
            rag_hits=rag_hits,
            symbols=matched_symbols,
            related_files=related_files,
            repo_map=self.repo_map(),
            context_pack=context_pack,
        )

    def _build_repo_map(self) -> str:
        lines: list[str] = ["# Repository map", ""]
        manifests = [
            "README.md",
            "readme.md",
            "package.json",
            "pyproject.toml",
            "requirements.txt",
            "Cargo.toml",
            "go.mod",
        ]
        for name in manifests:
            path = self.workspace / name
            if path.exists():
                try:
                    content = path.read_text(encoding="utf-8", errors="replace")[:1500]
                except OSError:
                    continue
                lines.append(f"## {name}")
                lines.append(content)
                lines.append("")

        lines.append("## File tree (truncated)")
        count = 0
        for path in sorted(self.workspace.rglob("*")):
            if not path.is_file():
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            lines.append(str(path.relative_to(self.workspace)))
            count += 1
            if count >= 200:
                lines.append("...")
                break
        return "\n".join(lines)
