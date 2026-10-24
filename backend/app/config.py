"""
Configuration management for Universal Translator Backend.
Loads settings from environment variables and .env file.
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file from backend root if present
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

class Settings:
    # Server settings
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

    # Provider selection: "auto", "google", "deepl", "libretranslate", "mymemory", "mock"
    TRANSLATION_PROVIDER: str = os.getenv("TRANSLATION_PROVIDER", "auto").lower()

    # Provider credentials
    GOOGLE_TRANSLATE_API_KEY: str = os.getenv("GOOGLE_TRANSLATE_API_KEY", "")
    DEEPL_API_KEY: str = os.getenv("DEEPL_API_KEY", "")
    DEEPL_API_URL: str = os.getenv("DEEPL_API_URL", "https://api-free.deepl.com/v2/translate")
    
    LIBRETRANSLATE_URL: str = os.getenv("LIBRETRANSLATE_URL", "")
    LIBRETRANSLATE_API_KEY: str = os.getenv("LIBRETRANSLATE_API_KEY", "")

    MYMEMORY_EMAIL: str = os.getenv("MYMEMORY_EMAIL", "")

    # Request limits
    MAX_TEXTS_PER_REQUEST: int = int(os.getenv("MAX_TEXTS_PER_REQUEST", "100"))
    MAX_CHARS_PER_TEXT: int = int(os.getenv("MAX_CHARS_PER_TEXT", "5000"))
    MAX_TOTAL_CHARS_PER_REQUEST: int = int(os.getenv("MAX_TOTAL_CHARS_PER_REQUEST", "50000"))

    # Rate limiting (requests per minute per client IP)
    RATE_LIMIT_RPM: int = int(os.getenv("RATE_LIMIT_RPM", "120"))

    # Cache settings
    CACHE_ENABLED: bool = os.getenv("CACHE_ENABLED", "true").lower() in ("true", "1", "yes")
    CACHE_MAX_SIZE: int = int(os.getenv("CACHE_MAX_SIZE", "10000"))
    CACHE_TTL_SECONDS: int = int(os.getenv("CACHE_TTL_SECONDS", "86400")) # 24 hours

    # CORS origins
    ALLOWED_ORIGINS: list = [
        "http://localhost",
        "http://localhost:8000",
        "http://127.0.0.1",
        "http://127.0.0.1:8000",
        "*"
    ]

settings = Settings()
