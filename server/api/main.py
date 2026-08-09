"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auth, repos, runs, settings
from api.webhooks import github as github_webhooks
from config import get_settings
from db.session import init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cocoder")


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_settings()
    await init_db()
    logger.info("CoCoder API ready")
    yield


app = FastAPI(title="CoCoder", version="0.1.0", lifespan=lifespan)

settings_cfg = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings_cfg.cors_origin_list or ["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(github_webhooks.router)
app.include_router(auth.router)
app.include_router(repos.router)
app.include_router(runs.router)
app.include_router(settings.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
