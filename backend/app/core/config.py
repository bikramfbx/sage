from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_DIR.parent


class Settings(BaseSettings):
    app_name: str = "SAGE"
    environment: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8001
    cors_origins: list[str] = ["http://localhost:3000"]

    sandbox_dir: Path = REPO_ROOT / "sandbox"

    # Loaded from the repo-root .env (NEBIUS_API_KEY, NEBIUS_BASE_URL, MODEL_ID)
    nebius_api_key: str = ""
    nebius_base_url: str = "https://api.studio.nebius.ai/v1"
    model_id: str = "nvidia/Nemotron-3-Ultra-550b-a55b"

    model_config = SettingsConfigDict(
        env_file=(str(REPO_ROOT / ".env"), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
