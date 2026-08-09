# CoCoder

Hybrid GitHub issue auto-fix agent.

- [`server/`](server/) — FastAPI + LangChain agents + hybrid indexer (RAG / AST / dependency graph)
- [`frontend/`](frontend/) — Vite React dashboard

## Quick start

```bash
# API
cd server && cp .env.example .env   # set tokens
uv sync
uv run python main.py

# UI
cd frontend && npm install && npm run dev
```

Open http://localhost:5173 — API at http://localhost:8000.
