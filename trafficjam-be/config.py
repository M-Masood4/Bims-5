from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    debug: bool = False
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/bims5"
    nats_url: str = "nats://localhost:4222"
    simengine_url: str = "http://localhost:8080"
    ai_service_url: str = "http://localhost:8003"
    multipart_max_part_size_bytes: int = 16 * 1024 * 1024

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
