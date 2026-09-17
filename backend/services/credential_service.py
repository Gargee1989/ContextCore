"""Encrypted server-side storage for user-supplied provider credentials."""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import sqlite3
import uuid
from pathlib import Path
import httpx
from openai import (
    OpenAI,
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    APIConnectionError,
    APITimeoutError,
    APIStatusError,
    OpenAIError,
)

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.config import (
    DEFAULT_BASE_URLS,
    DEFAULT_MODELS,
    PLACEHOLDERS,
    SUPPORTED_PROVIDERS,
    normalize_provider_name,
)
from backend.exceptions import DefinitionUnavailableException, InvalidInputException


class CredentialService:
    """Stores provider keys encrypted at rest and returns opaque access tokens."""

    def __init__(self) -> None:
        self.db_path = Path(
            os.getenv(
                "CREDENTIAL_DB_PATH",
                str(Path(__file__).resolve().parent.parent / ".credentials.sqlite3"),
            )
        )
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_database()

    def _initialize_database(self) -> None:
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS credentials (
                    credential_id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL UNIQUE,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    base_url TEXT,
                    encrypted_api_key TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    @staticmethod
    def _encryption_key() -> bytes:
        raw_key = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "").strip()
        if not raw_key:
            raise DefinitionUnavailableException(
                "Credential storage is not configured on this backend."
            )
        try:
            key = base64.urlsafe_b64decode(raw_key.encode())
        except Exception as error:
            raise DefinitionUnavailableException(
                "Credential storage encryption is misconfigured."
            ) from error
        if len(key) != 32:
            raise DefinitionUnavailableException(
                "Credential storage encryption is misconfigured."
            )
        return key

    @classmethod
    def _encrypt_api_key(cls, provider: str, api_key: str) -> str:
        nonce = secrets.token_bytes(12)
        ciphertext = AESGCM(cls._encryption_key()).encrypt(
            nonce,
            api_key.encode(),
            provider.encode(),
        )
        return base64.urlsafe_b64encode(nonce + ciphertext).decode()

    @classmethod
    def _decrypt_api_key(cls, provider: str, encrypted_api_key: str) -> str:
        try:
            payload = base64.urlsafe_b64decode(encrypted_api_key.encode())
            plaintext = AESGCM(cls._encryption_key()).decrypt(
                payload[:12],
                payload[12:],
                provider.encode(),
            )
            return plaintext.decode()
        except DefinitionUnavailableException:
            raise
        except Exception as error:
            raise DefinitionUnavailableException(
                "Stored provider credentials could not be decrypted."
            ) from error

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    def verify_credentials(
        self,
        provider: str,
        api_key: str,
        model: str,
        base_url: str | None = None,
    ) -> None:
        """
        Performs a lightweight test call to verify API key and model before saving.
        Raises InvalidInputException with descriptive messages on failures.
        """
        try:
            client = OpenAI(
                api_key=api_key,
                base_url=base_url or None,
                timeout=10.0,
            )
            client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": "test"}],
                max_tokens=1,
            )
        except AuthenticationError as exc:
            raise InvalidInputException(
                f"Invalid API key for {provider}. Please verify your key in the provider's dashboard."
            ) from exc
        except NotFoundError as exc:
            raise InvalidInputException(
                f"Model '{model}' does not exist or is unavailable for {provider}. Please check the model name."
            ) from exc
        except RateLimitError as exc:
            raise InvalidInputException(
                "The provider API key has exceeded its quota or rate limit."
            ) from exc
        except (APIConnectionError, APITimeoutError, httpx.ConnectError, httpx.TimeoutException) as exc:
            raise InvalidInputException(
                f"Could not connect to {provider} servers to verify the key. Please check your internet connection or try again later."
            ) from exc
        except APIStatusError as exc:
            if exc.status_code == 401:
                raise InvalidInputException(
                    f"Invalid API key for {provider}. Please verify your key in the provider's dashboard."
                ) from exc
            if exc.status_code == 404:
                raise InvalidInputException(
                    f"Model '{model}' does not exist or is unavailable for {provider}. Please check the model name."
                ) from exc
            if exc.status_code == 429:
                raise InvalidInputException(
                    "The provider API key has exceeded its quota or rate limit."
                ) from exc
            if exc.status_code and exc.status_code >= 500:
                raise InvalidInputException(
                    f"Could not connect to {provider} servers to verify the key. Please check your internet connection or try again later."
                ) from exc
            raise InvalidInputException(
                f"Could not connect to {provider} servers to verify the key. Please check your internet connection or try again later."
            ) from exc
        except OpenAIError as exc:
            error_str = str(exc).lower()
            if "401" in error_str or "auth" in error_str:
                raise InvalidInputException(
                    f"Invalid API key for {provider}. Please verify your key in the provider's dashboard."
                ) from exc
            if "404" in error_str or "not found" in error_str:
                raise InvalidInputException(
                    f"Model '{model}' does not exist or is unavailable for {provider}. Please check the model name."
                ) from exc
            if "429" in error_str or "rate" in error_str or "quota" in error_str:
                raise InvalidInputException(
                    "The provider API key has exceeded its quota or rate limit."
                ) from exc
            raise InvalidInputException(
                f"Could not connect to {provider} servers to verify the key. Please check your internet connection or try again later."
            ) from exc
        except Exception as exc:
            if isinstance(exc, InvalidInputException):
                raise
            raise InvalidInputException(
                f"Could not connect to {provider} servers to verify the key. Please check your internet connection or try again later."
            ) from exc

    def register(
        self,
        provider: str,
        api_key: str,
        model: str | None = None,
        base_url: str | None = None,
        verify: bool = True,
    ) -> dict[str, str | None]:
        normalized_provider = normalize_provider_name(provider)
        if normalized_provider not in SUPPORTED_PROVIDERS:
            raise InvalidInputException(
                "Provider must be Google Gemini, OpenAI, or NVIDIA NIM."
            )

        clean_api_key = api_key.strip()
        if not clean_api_key or clean_api_key in PLACEHOLDERS:
            raise InvalidInputException("A valid provider API key is required.")

        resolved_model = (model or "").strip() or DEFAULT_MODELS[normalized_provider]
        resolved_base_url = (base_url or "").strip() or DEFAULT_BASE_URLS[normalized_provider]

        if verify:
            self.verify_credentials(
                provider=normalized_provider,
                api_key=clean_api_key,
                model=resolved_model,
                base_url=resolved_base_url,
            )

        credential_id = str(uuid.uuid4())
        access_token = secrets.token_urlsafe(32)
        encrypted_api_key = self._encrypt_api_key(normalized_provider, clean_api_key)

        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                INSERT INTO credentials
                    (credential_id, token_hash, provider, model, base_url, encrypted_api_key)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    credential_id,
                    self._hash_token(access_token),
                    normalized_provider,
                    resolved_model,
                    resolved_base_url,
                    encrypted_api_key,
                ),
            )

        return {
            "credential_id": credential_id,
            "credential_token": access_token,
            "provider": normalized_provider,
            "model": resolved_model,
        }

    def resolve(self, credential_id: str, credential_token: str) -> dict[str, str | None]:
        if not credential_id or not credential_token:
            raise InvalidInputException("A credential ID and credential token are required.")

        with sqlite3.connect(self.db_path) as connection:
            row = connection.execute(
                """
                SELECT provider, model, base_url, encrypted_api_key
                FROM credentials
                WHERE credential_id = ? AND token_hash = ?
                """,
                (credential_id, self._hash_token(credential_token)),
            ).fetchone()

        if row is None:
            raise InvalidInputException("The credential reference is invalid or expired.")

        provider, model, base_url, encrypted_api_key = row
        return {
            "api_key": self._decrypt_api_key(provider, encrypted_api_key),
            "provider": provider,
            "model": model,
            "base_url": base_url,
        }

    def delete(self, credential_id: str, credential_token: str) -> None:
        if not credential_id or not credential_token:
            raise InvalidInputException("A credential ID and credential token are required.")
        with sqlite3.connect(self.db_path) as connection:
            result = connection.execute(
                "DELETE FROM credentials WHERE credential_id = ? AND token_hash = ?",
                (credential_id, self._hash_token(credential_token)),
            )
        if result.rowcount == 0:
            raise InvalidInputException("The credential reference is invalid or expired.")


credential_service = CredentialService()
