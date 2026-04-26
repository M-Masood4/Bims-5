from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    nats_url: str = "nats://localhost:4222"
    data_dir: str = "./data"
    host: str = "0.0.0.0"
    port: int = 8002
    event_batch_size: int = 500
    step_duration_seconds: float = 1800.0

    class Config:
        env_file = ".env"
        case_sensitive = False
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()
