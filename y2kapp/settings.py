from __future__ import annotations

from typing import List

from pydantic import Field, validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", case_sensitive=False)
    # App
    app_title: str = Field(default="Y2K 문자메세지", env="APP_TITLE")
    env: str = Field(default="development", env="ENV", description="Environment name: development|staging|production")
    debug: bool = Field(default=False, env="DEBUG")

    # Server
    host: str = Field(default="0.0.0.0", env="HOST")
    port: int = Field(default=8000, env="PORT")
    log_level: str = Field(default="info", env="LOG_LEVEL")

    # Security
    cors_origins: str = Field(default="*", env="CORS_ORIGINS")
    trusted_hosts: str = Field(default="*", env="TRUSTED_HOSTS")
    enforce_https: bool = Field(default=False, env="ENFORCE_HTTPS")

    # Database
    database_url: str = Field(default="sqlite:///./y2k_messages.db", env="DATABASE_URL")

    # API
    default_list_limit: int = Field(default=50, env="DEFAULT_LIST_LIMIT")

    # Device
    device_name: str = Field(default="ME", env="DEVICE_NAME")

    @validator("cors_origins")
    def _normalize_cors(cls, v: str) -> str:  # noqa: D401
        # Allow comma-separated list; leave '*' as-is
        return v.strip() or "*"

    @validator("trusted_hosts")
    def _normalize_hosts(cls, v: str) -> str:  # noqa: D401
        return v.strip() or "*"

    def cors_list(self) -> List[str] | str:
        return self.cors_origins if self.cors_origins == "*" else [s.strip() for s in self.cors_origins.split(",") if s.strip()]

    def trusted_hosts_list(self) -> List[str]:
        return [s.strip() for s in self.trusted_hosts.split(",") if s.strip()] or ["*"]


settings = Settings()  # type: ignore[call-arg]
