"""
ContentCore Backend Configuration

    Loads environment variables, defines operational thresholds, and configures
    the LLM provider (Gemini, NVIDIA NIM, or OpenAI) without exposing credentials.
"""

from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

# Directory paths
BACKEND_DIR = Path(__file__).resolve().parent
ROOT_DIR = BACKEND_DIR.parent
ENV_FILE_PATH = BACKEND_DIR / ".env"
FALLBACK_ENV_PATH = ROOT_DIR / ".env"

# Explicitly load environment variables
if ENV_FILE_PATH.exists():
    load_dotenv(dotenv_path=ENV_FILE_PATH)
elif FALLBACK_ENV_PATH.exists():
    load_dotenv(dotenv_path=FALLBACK_ENV_PATH)
else:
    load_dotenv()

# Placeholder markers
PLACEHOLDERS = {
    "your_gemini_api_key_here",
    "your_openai_api_key_here",
    "your_nvidia_api_key_here",
    "nvapi-yourActualKeyHere",
    "sk-proj-yourActualKeyHere",
}


class Settings:
    """Application settings and LLM configuration."""

    def __init__(self) -> None:
        self.gemini_api_key: str | None = os.getenv("GEMINI_API_KEY")
        self.nvidia_api_key: str | None = os.getenv("NVIDIA_API_KEY")
        self.openai_api_key: str | None = os.getenv("OPENAI_API_KEY")

        # Resolve primary key
        raw_key = self.gemini_api_key or self.nvidia_api_key or self.openai_api_key or ""
        self._api_key: str = raw_key.strip()

        # Provider detection
        self.is_gemini: bool = bool(self.gemini_api_key)
        self.is_nvidia: bool = bool(
            self.nvidia_api_key
            or (self._api_key and self._api_key.startswith("nvapi-"))
        )

        # Gemini and NVIDIA use OpenAI-compatible endpoints.
        default_gemini_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
        default_nvidia_url = "https://integrate.api.nvidia.com/v1"
        self.gemini_base_url: str = os.getenv("GEMINI_BASE_URL", default_gemini_url)
        self.nvidia_base_url: str = os.getenv("NVIDIA_BASE_URL", default_nvidia_url)
        self.base_url: str | None = (
            self.gemini_base_url if self.is_gemini else
            self.nvidia_base_url if self.is_nvidia else None
        )

        # Model resolution
        default_model = (
            "gemini-3.6-flash" if self.is_gemini else
            "meta/llama-3.2-11b-vision-instruct" if self.is_nvidia else "gpt-4o-mini"
        )
        self.model: str = os.getenv("LLM_MODEL", default_model)
        self.provider_name: str = (
            "Google Gemini" if self.is_gemini else
            "NVIDIA NIM" if self.is_nvidia else "OpenAI"
        )

        # Operational limits & hyper-parameters
        self.max_target_chars: int = int(os.getenv("MAX_TARGET_CHARS", "500"))
        self.max_context_chars: int = int(os.getenv("MAX_CONTEXT_CHARS", "5000"))
        self.llm_timeout_seconds: float = float(os.getenv("LLM_TIMEOUT_SECONDS", "30.0"))
        self.llm_temperature: float = float(os.getenv("LLM_TEMPERATURE", "0.1"))
        self.llm_max_tokens: int = int(os.getenv("LLM_MAX_TOKENS", "1024"))

        # Server defaults
        self.host: str = os.getenv("HOST", "127.0.0.1")
        self.port: int = int(os.getenv("PORT", "8000"))

    @property
    def api_key(self) -> str:
        """Returns the configured API key."""
        return self._api_key

    @property
    def is_configured(self) -> bool:
        """Checks if a valid, non-placeholder API key is available."""
        if not self._api_key:
            return False
        return self._api_key not in PLACEHOLDERS


settings = Settings()
