"""Helpers for hybrid retrieval used by agents/tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from indexing.hybrid import HybridIndexer, HybridRetrieveResult


def hybrid_retrieve(repo_id: int | str, workspace: str | Path, query: str, k: int = 8) -> HybridRetrieveResult:
    indexer = HybridIndexer(repo_id, Path(workspace))
    return indexer.retrieve(query, k=k)


def format_context_pack(result: HybridRetrieveResult) -> str:
    parts: list[str] = [f"# Hybrid context for: {result.query}", ""]
    if result.repo_map:
        parts.append("## Repo map (excerpt)")
        parts.append(result.repo_map[:2500])
        parts.append("")
    parts.append("## Ranked context pack")
    for i, item in enumerate(result.context_pack, 1):
        parts.append(f"### {i}. {item.get('path')} ({item.get('why')})")
        parts.append("```")
        parts.append(str(item.get("snippet", "")))
        parts.append("```")
        parts.append("")
    if result.related_files:
        parts.append("## Related files")
        parts.extend(f"- {p}" for p in result.related_files[:30])
    return "\n".join(parts)


def result_to_dict(result: HybridRetrieveResult) -> dict[str, Any]:
    return {
        "query": result.query,
        "rag_hits": result.rag_hits,
        "symbols": result.symbols,
        "related_files": result.related_files,
        "repo_map": result.repo_map[:3000],
        "context_pack": result.context_pack,
    }
