# CoCoder Server

Hybrid indexing + auto-fix agent API.

## Setup

```bash
cd server
cp .env.example .env   # fill GITHUB_TOKEN, OPENROUTER_API_KEY, GITHUB_WEBHOOK_SECRET
uv sync
uv run python main.py  # http://localhost:8000
```

## Key endpoints

- `POST /auth/signup`, `POST /auth/signin` — create an account or start a session
- `GET /auth/me`, `POST /auth/signout` — inspect or end the current session
- `GET /settings/github`, `POST /settings/github/test`, `PUT/DELETE /settings/github/pat` — manage GitHub PAT credentials
- `GET /settings/github/oauth/start` and `/callback` — connect GitHub OAuth for the current user
- `POST /webhooks/github` — signed issue webhook
- `GET/POST /repos` — register & list repos
- `POST /repos/{id}/issues/sync` — pull open GitHub issues and enqueue runs (local-dev friendly)
- `POST /repos/{id}/issues/{number}/run` — enqueue a specific issue
- `GET /repos/{id}/index/status` — hybrid index stats
- `GET /runs`, `GET /runs/{id}`, `GET /runs/{id}/diff`, `POST /runs/{id}/retry`
- `WS /runs/{id}/events` — live stage stream
- `GET/PUT/DELETE /settings/llm` — BYOK model providers (keys encrypted at rest; responses never include raw keys)
- `POST /settings/llm/test` — probe a provider key

## Why webhooks may not fire locally

GitHub cannot POST to `http://localhost:8000`. Until you expose the API with a tunnel (ngrok, Cloudflare Tunnel, etc.) and register a repo webhook to `https://<public-host>/webhooks/github` (events: **Issues**), use **Sync open issues** in the UI or:

```bash
curl -X POST http://localhost:8000/repos/3/issues/sync
```

Webhook checklist:

1. Tunnel: `ngrok http 8000` → copy HTTPS URL
2. GitHub → repo → Settings → Webhooks → Add webhook
3. Payload URL: `https://<tunnel>/webhooks/github`
4. Content type: `application/json`
5. Secret: same as `GITHUB_WEBHOOK_SECRET` in `.env` (or leave both empty for local unsigned)
6. Events: **Issues** (opened / reopened)

## Pipeline

Issue webhook (or sync) → clone → `bugfix/<n>` → hybrid index (RAG + AST + deps) → PM → Architecture → Task Planner → Backend/Frontend → Reviewer → commit/push → PR (`Fixes #<n>`).
