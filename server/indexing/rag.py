"""Chunking + Chroma vector store for semantic RAG."""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from typing import Any, Optional

import chromadb
from chromadb.api.models.Collection import Collection
from langchain_text_splitters import RecursiveCharacterTextSplitter

from config import get_settings
from indexing.dependency_graph import SKIP_DIRS

logger = logging.getLogger(__name__)

CODE_EXTENSIONS = {
    ".py",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".md",
    ".json",
    ".toml",
    ".yml",
    ".yaml",
    ".txt",
}


class SimpleEmbedder:
    """Deterministic local embedder so indexing works without an external API.

    Uses hashed bag-of-tokens projected into a fixed vector. Good enough for
    local hybrid retrieval demos; swap for OpenRouter embeddings when desired.
    """

    def __init__(self, dim: int = 384) -> None:
        self.dim = dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * self.dim
        tokens = text.lower().split()
        if not tokens:
            return vec
        for tok in tokens:
            digest = hashlib.sha256(tok.encode("utf-8")).digest()
            idx = int.from_bytes(digest[:4], "little") % self.dim
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vec[idx] += sign
        # L2 normalize
        norm = sum(v * v for v in vec) ** 0.5 or 1.0
        return [v / norm for v in vec]


class VectorIndex:
    def __init__(self, persist_dir: Path, collection_name: str = "code") -> None:
        self.persist_dir = persist_dir
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        self.client = chromadb.PersistentClient(path=str(persist_dir))
        self.embedder = SimpleEmbedder()
        self.collection: Collection = self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=150,
            separators=["\n\n", "\n", " ", ""],
        )

    def clear(self) -> None:
        try:
            self.client.delete_collection(self.collection.name)
        except Exception:
            pass
        self.collection = self.client.get_or_create_collection(
            name="code",
            metadata={"hnsw:space": "cosine"},
        )

    def index_repo(self, root: Path) -> dict[str, Any]:
        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict[str, Any]] = []

        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if path.suffix.lower() not in CODE_EXTENSIONS:
                continue
            if path.stat().st_size > 1_000_000:
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            rel = str(path.relative_to(root))
            chunks = self.splitter.split_text(text)
            for i, chunk in enumerate(chunks):
                chunk_id = hashlib.md5(f"{rel}:{i}:{chunk[:64]}".encode()).hexdigest()
                ids.append(chunk_id)
                documents.append(chunk)
                metadatas.append({"path": rel, "chunk": i})

        # Upsert in batches
        batch = 100
        for start in range(0, len(ids), batch):
            end = start + batch
            batch_docs = documents[start:end]
            embeddings = self.embedder.embed(batch_docs)
            self.collection.upsert(
                ids=ids[start:end],
                documents=batch_docs,
                metadatas=metadatas[start:end],
                embeddings=embeddings,
            )

        return {"chunks": len(ids)}

    def query(self, text: str, k: int = 8) -> list[dict[str, Any]]:
        if self.collection.count() == 0:
            return []
        embedding = self.embedder.embed([text])[0]
        result = self.collection.query(query_embeddings=[embedding], n_results=min(k, self.collection.count()))
        hits: list[dict[str, Any]] = []
        docs = (result.get("documents") or [[]])[0]
        metas = (result.get("metadatas") or [[]])[0]
        dists = (result.get("distances") or [[]])[0]
        for doc, meta, dist in zip(docs, metas, dists):
            hits.append(
                {
                    "text": doc,
                    "path": (meta or {}).get("path"),
                    "score": 1.0 - float(dist) if dist is not None else 0.0,
                    "source": "rag",
                }
            )
        return hits
