from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "SAGE"
    environment: str = "development"
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    hermes_agent_url: str = "http://localhost:8080"
    openshell_enabled: bool = True

    nemoclub_enabled: bool = True  # typo guard - use nemoclw? 
    nemoclw_enabled: bool = True
    nemoclw_proxy_url: str = "http://localhost:9090"
    nemoclaw_enabled: bool = True
    nemoclaw_proxy_url: str = "http://localhost:9090"

    nebius_api_base_url: str = "https://api.nebius.com/v1"
    nebius_api_key: str = ""
    nemotron_model: str = "nvidia/nemotron-4-340b"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
