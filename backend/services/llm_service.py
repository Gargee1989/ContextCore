"""
ContextCore Backend - LLM Service

Handles LLM communication with Gemini, NVIDIA NIM, or OpenAI, response parsing,
strict JSON validation, error translation, and privacy protection.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
import httpx
from openai import OpenAI, RateLimitError, APITimeoutError, OpenAIError
from pydantic import ValidationError

from backend.config import (
    settings,
    resolve_llm_config,
    PROVIDER_GEMINI,
    PROVIDER_OPENAI,
    PROVIDER_NVIDIA,
)
from backend.prompts import SYSTEM_PROMPT, build_user_message
from backend.schemas import DefineResponse
from backend.exceptions import (
    RateLimitedException,
    ServiceTimeoutException,
    DefinitionUnavailableException,
)

logger = logging.getLogger("contextcore.llm_service")

# Required keys for the LLM response
REQUIRED_RESPONSE_KEYS = {
    "status",
    "meaning",
    "tone",
    "synonym",
    "example",
    "simplified_passage",
}

MORE_CONTEXT_MESSAGE = (
    "Highlight the surrounding sentence or paragraph to make the meaning clear."
)


class LLMService:
    """Service for interacting with LLM providers to generate contextual definitions."""

    def __init__(self) -> None:
        self._client: OpenAI | None = None

    def get_client(self) -> OpenAI | None:
        """Initializes or returns the cached OpenAI-compatible client."""
        if settings.is_gemini:
            return None

        if self._client is not None:
            return self._client

        if not settings.is_configured:
            logger.error("LLM API key is unconfigured or invalid.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            )

        if settings.base_url:
            self._client = OpenAI(
                base_url=settings.base_url,
                api_key=settings.api_key,
                timeout=settings.llm_timeout_seconds,
            )
        else:
            self._client = OpenAI(
                api_key=settings.api_key,
                timeout=settings.llm_timeout_seconds,
            )

        return self._client

    def create_client(
        self,
        api_key: str,
        base_url: str | None = None,
    ) -> OpenAI:
        """Creates an OpenAI-compatible client for direct calling with input credentials."""
        if base_url:
            return OpenAI(
                base_url=base_url,
                api_key=api_key,
                timeout=settings.llm_timeout_seconds,
            )
        return OpenAI(
            api_key=api_key,
            timeout=settings.llm_timeout_seconds,
        )

    def clean_markdown_fences(self, content: str) -> str:
        """Strips surrounding Markdown code fences if returned by the LLM."""
        text = content.strip()
        # Pattern to match ```json ... ``` or ``` ... ```
        pattern = r"^```(?:json)?\s*([\s\S]*?)\s*```$"
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return text

    def parse_and_validate_response(self, raw_content: str) -> DefineResponse:
        """
        Parses raw text from the LLM, validates structure, and ensures compliance
        with the strict ContextCore output contract.
        """
        cleaned = self.clean_markdown_fences(raw_content)

        try:
            data = json.loads(cleaned)
        except Exception as err:
            logger.warning("Failed to parse LLM response as JSON.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            ) from err

        if not isinstance(data, dict):
            logger.warning("LLM response is not a JSON object.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            )

        data_keys = set(data.keys())

        # Check for missing keys
        missing_keys = REQUIRED_RESPONSE_KEYS - data_keys
        if missing_keys:
            logger.warning("LLM response missing keys.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            )

        # Check for unexpected extra keys
        extra_keys = data_keys - REQUIRED_RESPONSE_KEYS
        if extra_keys:
            logger.warning("LLM response has unexpected extra keys.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            )

        # Verify all fields are strings and not None/arrays/objects
        for key in REQUIRED_RESPONSE_KEYS:
            val = data[key]
            if val is None or not isinstance(val, str):
                logger.warning(f"LLM response key '{key}' is not a string.")
                raise DefinitionUnavailableException(
                    "The definition service is temporarily unavailable. Please try again."
                )

        # Verify status
        status = data.get("status")
        if status not in ("success", "more_context_needed"):
            logger.warning(f"Invalid status '{status}' in LLM response.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            )

        # Verify meaning
        meaning = data.get("meaning", "").strip()
        if not meaning:
            logger.warning("Empty meaning in LLM response.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            )

        # If status is more_context_needed, enforce standard required message
        if status == "more_context_needed":
            data["meaning"] = MORE_CONTEXT_MESSAGE

        # Validate with Pydantic for length constraints and schema validation
        try:
            return DefineResponse(**data)
        except ValidationError as val_err:
            logger.warning("Response failed Pydantic schema validation.")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            ) from val_err

    def define(
        self,
        target: str,
        context: str,
        api_key: str | None = None,
        provider: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> DefineResponse:
        """
        Invokes the LLM to get the contextual definition of target in context.
        Supports direct input for provider, API key, model, and base URL,
        falling back to backend/.env configuration when omitted.

        Note: The passage content is never logged or stored to protect reader privacy.
        """
        user_message = build_user_message(target, context)
        has_direct_input = any(x is not None for x in (api_key, provider, model, base_url))

        if has_direct_input:
            cfg = resolve_llm_config(
                api_key=api_key,
                provider=provider,
                model=model,
                base_url=base_url,
            )
            if not cfg["is_configured"]:
                logger.error("LLM API key is unconfigured or invalid.")
                raise DefinitionUnavailableException(
                    "The definition service is temporarily unavailable. Please try again."
                )

            target_provider = cfg["provider"]
            target_model = cfg["model"]
            target_key = cfg["api_key"]
            target_base_url = cfg["base_url"]

            logger.info(
                f"Dispatching definition request (direct input): target_len={len(target)}, context_len={len(context)}, provider={target_provider}, model={target_model}"
            )

            client = self.create_client(api_key=target_key, base_url=target_base_url)
        else:
            client = self.get_client()
            target_model = settings.model
            target_provider = settings.provider_name
            target_key = settings.api_key

            logger.info(
                f"Dispatching definition request: target_len={len(target)}, context_len={len(context)}, provider={target_provider}"
            )

            if settings.is_gemini and client is None:
                return self.define_with_gemini(
                    user_message,
                    api_key=target_key,
                    model=target_model,
                    base_url=cfg["base_url"],
                )

        try:
            completion = client.chat.completions.create(
                model=target_model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_message},
                ],
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
                response_format={"type": "json_object"},
                timeout=settings.llm_timeout_seconds,
            )

            raw_response = completion.choices[0].message.content or ""
            return self.parse_and_validate_response(raw_response)

        except RateLimitError as rl_err:
            logger.warning("LLM provider rate limit encountered.")
            raise RateLimitedException(
                "Too many definition requests. Please try again shortly."
            ) from rl_err

        except APITimeoutError as to_err:
            logger.warning("LLM provider request timed out.")
            raise ServiceTimeoutException(
                "The definition service took too long to respond. Please try again."
            ) from to_err

        except TimeoutError as to_err:
            logger.warning("Request timed out.")
            raise ServiceTimeoutException(
                "The definition service took too long to respond. Please try again."
            ) from to_err

        except (RateLimitedException, ServiceTimeoutException, DefinitionUnavailableException):
            # Re-raise domain exceptions as-is
            raise

        except OpenAIError as api_err:
            # If Google Gemini fails via OpenAI client, attempt native generateContent as fallback
            if (has_direct_input and cfg["is_gemini"]) or (not has_direct_input and settings.is_gemini):
                try:
                    return self.define_with_gemini(
                        user_message,
                        api_key=target_key,
                        model=target_model,
                        base_url=cfg["base_url"] if has_direct_input else settings.gemini_base_url,
                    )
                except Exception:
                    pass
            logger.warning(f"Upstream provider error: {type(api_err).__name__}")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            ) from api_err

        except Exception as unexpected_err:
            logger.warning(f"Unexpected error in LLM service: {type(unexpected_err).__name__}")
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            ) from unexpected_err

    def define_with_gemini(
        self,
        user_message: str,
        api_key: str | None = None,
        model: str | None = None,
        base_url: str | None = None,
    ) -> DefineResponse:
        """Call Gemini's native generateContent API."""
        effective_key = api_key or settings.api_key
        effective_model = model or settings.model
        effective_base_url = base_url or "https://generativelanguage.googleapis.com/v1beta/openai/"
        native_base_url = "https://generativelanguage.googleapis.com/v1beta"
        if "/openai" in effective_base_url:
            native_base_url = effective_base_url.split("/openai", 1)[0]
        url = f"{native_base_url.rstrip('/')}/models/{effective_model}:generateContent"
        payload = {
            "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text": user_message}]}],
            "generationConfig": {
                "temperature": settings.llm_temperature,
                "maxOutputTokens": settings.llm_max_tokens,
                "responseMimeType": "application/json",
            },
        }

        try:
            response = httpx.post(
                url,
                headers={"x-goog-api-key": effective_key},
                json=payload,
                timeout=settings.llm_timeout_seconds,
            )
            response.raise_for_status()
            response_data = response.json()
            raw_content = response_data["candidates"][0]["content"]["parts"][0]["text"]
            return self.parse_and_validate_response(raw_content)
        except httpx.TimeoutException as timeout_error:
            raise ServiceTimeoutException(
                "The definition service took too long to respond. Please try again."
            ) from timeout_error
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as provider_error:
            logger.warning(
                f"Gemini provider request failed: {type(provider_error).__name__}"
            )
            raise DefinitionUnavailableException(
                "The definition service is temporarily unavailable. Please try again."
            ) from provider_error


# Singleton instance
llm_service = LLMService()
