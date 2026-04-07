from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import Optional


class Settings(BaseSettings):
    # Database
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/investment_portfolio"
    
    # JWT
    secret_key: str = "44gcq_C7UNSKRkqbhHo8lWuUzajjsPjE5L1oEddbLB0"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    
    # Email
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = "abreuyoel22@gmail.com"
    smtp_password: str = "eillgiimvvftpkse"
    email_from: str = "abreuyoel22@gmail.com"
    
    # VAPID
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_contact_email: str = ""
    
    # App
    app_name: str = "Investment Portfolio Manager"
    app_version: str = "1.0.0"
    debug: bool = True
    frontend_url: str = "http://localhost:4200"

    # Gemini AI
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-pro"

    @property
    def gemini_api_key_clean(self) -> str:
        """API key sin espacios/saltos de línea que rompen headers HTTP."""
        return self.gemini_api_key.strip()
    
    class Config:
        env_file = ".env"
        case_sensitive = False


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()