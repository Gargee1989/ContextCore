"""
ContextCore Backend - Request and Response Schemas

Defines Pydantic models for input normalization, strict validation, and output formatting.
"""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.config import SUPPORTED_PROVIDERS, normalize_provider_name, settings
from backend.exceptions import InvalidInputException


class DefineRequest(BaseModel):
    """
    Incoming request payload for POST /define.
    
    Accepts target text under aliases: 'word', 'phrase', 'target', or 'selectedText'.
    Normalizes selected text to `target` and validates `context`.
    Optionally accepts direct credentials/config: 'api_key', 'provider', 'model', 'base_url'.
    """

    target: str = Field(..., description="Normalized selected text")
    context: str = Field(..., description="Surrounding passage or sentence")
    api_key: str | None = Field(default=None, description="Direct LLM API key")
    provider: str | None = Field(default=None, description="LLM provider: Google Gemini, OpenAI, or NVIDIA NIM")
    model: str | None = Field(default=None, description="Model name to use")
    base_url: str | None = Field(default=None, description="Optional custom base URL")
    credential_id: str | None = Field(default=None, description="Registered credential ID")
    credential_token: str | None = Field(default=None, description="Registered credential access token")

    model_config = ConfigDict(extra="ignore")

    @model_validator(mode="before")
    @classmethod
    def normalize_and_validate(cls, data: Any) -> dict[str, Any]:
        if not isinstance(data, dict):
            raise InvalidInputException(
                "Selected text and its surrounding passage are required."
            )

        # Extract target from any supported alias
        target_candidates = [
            data.get("target"),
            data.get("word"),
            data.get("phrase"),
            data.get("selectedText"),
        ]

        # Find first non-None candidate
        raw_target = next((c for c in target_candidates if c is not None), None)
        raw_context = data.get("context")

        # Must be strings
        if not isinstance(raw_target, str) or not isinstance(raw_context, str):
            raise InvalidInputException(
                "Selected text and its surrounding passage are required."
            )

        # Trim surrounding whitespace
        target = raw_target.strip()
        context = raw_context.strip()

        # Must not be empty after trimming
        if not target or not context:
            raise InvalidInputException(
                "Selected text and its surrounding passage are required."
            )

        # Length validation against configurable limits
        if len(target) > settings.max_target_chars:
            raise InvalidInputException(
                "Selected text and its surrounding passage are required."
            )

        if len(context) > settings.max_context_chars:
            raise InvalidInputException(
                "Selected text and its surrounding passage are required."
            )

        validated: dict[str, Any] = {
            "target": target,
            "context": context,
        }

        # Extract optional direct input credentials and provider/model configurations
        raw_api_key = data.get("api_key") or data.get("apiKey") or data.get("key")
        if isinstance(raw_api_key, str) and raw_api_key.strip():
            validated["api_key"] = raw_api_key.strip()

        raw_provider = (
            data.get("provider")
            or data.get("provider_name")
            or data.get("providerName")
            or data.get("llm_provider")
        )
        if isinstance(raw_provider, str) and raw_provider.strip():
            normalized_provider = normalize_provider_name(raw_provider)
            if normalized_provider not in SUPPORTED_PROVIDERS:
                raise InvalidInputException(
                    "Provider must be Google Gemini, OpenAI, or NVIDIA NIM."
                )
            validated["provider"] = normalized_provider

        raw_model = (
            data.get("model")
            or data.get("model_name")
            or data.get("modelName")
            or data.get("llm_model")
        )
        if isinstance(raw_model, str) and raw_model.strip():
            validated["model"] = raw_model.strip()

        raw_base_url = data.get("base_url") or data.get("baseUrl")
        if isinstance(raw_base_url, str) and raw_base_url.strip():
            validated["base_url"] = raw_base_url.strip()

        raw_credential_id = data.get("credential_id") or data.get("credentialId")
        if isinstance(raw_credential_id, str) and raw_credential_id.strip():
            validated["credential_id"] = raw_credential_id.strip()

        raw_credential_token = data.get("credential_token") or data.get("credentialToken")
        if isinstance(raw_credential_token, str) and raw_credential_token.strip():
            validated["credential_token"] = raw_credential_token.strip()

        return validated


class CredentialRegisterRequest(BaseModel):
    """Request to register a user's provider key on the backend."""

    provider: str
    api_key: str = Field(..., min_length=1)
    model: str | None = None
    base_url: str | None = None

    model_config = ConfigDict(extra="forbid")


class CredentialRegisterResponse(BaseModel):
    """Opaque reference returned after encrypted credential registration."""

    credential_id: str
    credential_token: str
    provider: str
    model: str

    model_config = ConfigDict(extra="forbid")


class DefineResponse(BaseModel):
    """
    Strict response schema for successful or more-context-needed definitions.
    
    Must match exact contract:
    - status: "success" or "more_context_needed"
    - meaning: non-empty string
    - tone: string
    - synonym: string
    - example: string
    - simplified_passage: string
    - No extra fields allowed.
    """

    status: Literal["success", "more_context_needed"] = Field(
        ..., description="Result status"
    )
    meaning: str = Field(
        ..., min_length=1, max_length=2000, description="Short contextual explanation"
    )
    tone: str = Field(
        "", max_length=500, description="Communicated tone or expression"
    )
    synonym: str = Field(
        "", max_length=500, description="Common, context-correct synonym"
    )
    example: str = Field(
        "", max_length=2000, description="Short relatable real-life example"
    )
    simplified_passage: str = Field(
        "", max_length=10000, description="Simplified passage text"
    )

    model_config = ConfigDict(extra="forbid")


class ErrorResponse(BaseModel):
    """Standardized API error response envelope."""

    status: Literal["error"] = "error"
    code: str
    message: str

    model_config = ConfigDict(extra="forbid")
