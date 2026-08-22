"""Application settings loaded from environment."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_ROOT = Path(__file__).resolve().parent
WORKSPACE_ROOT = SERVER_ROOT / "workspace"
INDEX_ROOT = SERVER_ROOT / ".cocoder" / "index"
DATA_ROOT = SERVER_ROOT / ".cocoder" / "data"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openrouter_api_key: str = ""
    github_token: str = ""
    github_webhook_secret: str = ""
    database_url: str = f"sqlite+aiosqlite:///{DATA_ROOT / 'cocoder.db'}"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    max_review_retries: int = 3
    agent_recursion_limit: int = 100
    agent_tool_call_limit: int = 15
    agent_summary_model: str = "openrouter/free"
    agent_context_window_tokens: int = 64000
    agent_checkpoint_db: str = str(DATA_ROOT / "langgraph.sqlite")
    embedding_model: str = "openai/text-embedding-3-small"
    llm_model: str = "deepseek/deepseek-v4-flash-0731"
    auth_session_days: int = 30
    auth_cookie_name: str = "cocoder_session"
    auth_cookie_secure: bool = False
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""
    github_oauth_redirect_uri: str = "http://localhost:8000/settings/github/oauth/callback"
    frontend_url: str = "http://localhost:5173"
    github_oauth_scopes: str = "read:user user:email repo"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)
    INDEX_ROOT.mkdir(parents=True, exist_ok=True)
    return Settings()
