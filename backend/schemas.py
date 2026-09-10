"""
ContentCore Backend - Request and Response Schemas

Defines Pydantic models for input normalization, strict validation, and output formatting.
"""

from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from backend.config import settings
from backend.exceptions import InvalidInputException


class DefineRequest(BaseModel):
    """
    Incoming request payload for POST /define.
    
    Accepts target text under aliases: 'word', 'phrase', 'target', or 'selectedText'.
    Normalizes selected text to `target` and validates `context`.
    """

    target: str = Field(..., description="Normalized selected text")
    context: str = Field(..., description="Surrounding passage or sentence")

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

        return {
            "target": target,
            "context": context,
        }


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
