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
    PROVIDER_GEMINI,
    SUPPORTED_PROVIDERS,
    normalize_provider_name,
)
from backend.exceptions import DefinitionUnavailableException, InvalidInputException


class CredentialService:
    """Manages encrypted storage and resolution of provider credentials."""

    def __init__(self, db_path: Path | None = None) -> None:
        default_path = Path(__file__).resolve().parent.parent / ".credentials.sqlite3"
        self.db_path = db_path or default_path
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS credentials (
                    credential_id TEXT PRIMARY KEY,
                    token_hash TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT,
                    base_url TEXT,
                    encrypted_api_key TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            connection.commit()

    @staticmethod
    def _encryption_key() -> bytes:
        raw_key = os.getenv("CREDENTIAL_ENCRYPTION_KEY", "").strip()
        if not raw_key:
            # Auto-generate a secure 32-byte key if missing, so new developers and users have zero friction
            generated = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
            env_path = Path(__file__).resolve().parent.parent / ".env"
            try:
                with open(env_path, "a") as f:
                    f.write(f"\nCREDENTIAL_ENCRYPTION_KEY={generated}\n")
            except Exception:
                pass
            os.environ["CREDENTIAL_ENCRYPTION_KEY"] = generated
            raw_key = generated

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

    def _encrypt_api_key(self, provider: str, api_key: str) -> str:
        aesgcm = AESGCM(self._encryption_key())
        nonce = secrets.token_bytes(12)
        ciphertext = aesgcm.encrypt(nonce, api_key.encode("utf-8"), provider.encode("utf-8"))
        payload = nonce + ciphertext
        return base64.b64encode(payload).decode("utf-8")

    def _decrypt_api_key(self, provider: str, payload_b64: str) -> str:
        try:
            raw = base64.b64decode(payload_b64.encode("utf-8"))
            if len(raw) <= 12:
                raise ValueError("Invalid encrypted payload.")
            nonce = raw[:12]
            ciphertext = raw[12:]
            aesgcm = AESGCM(self._encryption_key())
            plaintext = aesgcm.decrypt(nonce, ciphertext, provider.encode("utf-8"))
            return plaintext.decode("utf-8")
        except Exception as error:
            raise DefinitionUnavailableException(
                "Failed to decrypt stored provider credentials."
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
            if exc.status_code in (401, 403):
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
            if any(k in error_str for k in ["401", "403", "auth", "unauthorized", "forbidden", "invalid api key", "invalid key", "invalid_api_key", "bearer token", "permission denied", "access denied"]):
                raise InvalidInputException(
                    f"Invalid API key for {provider}. Please verify your key in the provider's dashboard."
                ) from exc
            if any(k in error_str for k in ["404", "not found", "does not exist", "model_not_found"]):
                raise InvalidInputException(
                    f"Model '{model}' does not exist or is unavailable for {provider}. Please check the model name."
                ) from exc
            if any(k in error_str for k in ["429", "rate limit", "quota", "insufficient_quota"]):
                raise InvalidInputException(
                    "The provider API key has exceeded its quota or rate limit."
                ) from exc
            raise InvalidInputException(
                f"Could not connect to {provider} servers to verify the key. Please check your internet connection or try again later."
            ) from exc
        except Exception as exc:
            if isinstance(exc, InvalidInputException):
                raise
            err_str = str(exc).lower()
            if any(k in err_str for k in ["401", "403", "unauthorized", "forbidden", "invalid api key", "invalid key", "invalid_api_key", "bearer token", "permission denied", "access denied"]):
                raise InvalidInputException(
                    f"Invalid API key for {provider}. Please verify your key in the provider's dashboard."
                ) from exc
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
            connection.commit()

        return {
            "credential_id": credential_id,
            "credential_token": access_token,
            "provider": normalized_provider,
            "model": resolved_model,
        }

    def resolve(self, credential_id: str, credential_token: str) -> dict[str, str | None]:
        clean_id = credential_id.strip()
        clean_token = credential_token.strip()
        if not clean_id or not clean_token:
            raise InvalidInputException("Invalid credential reference.")

        with sqlite3.connect(self.db_path) as connection:
            cursor = connection.cursor()
            cursor.execute(
                """
                SELECT provider, model, base_url, encrypted_api_key, token_hash
                FROM credentials
                WHERE credential_id = ?
                """,
                (clean_id,),
            )
            row = cursor.fetchone()

        if not row:
            raise InvalidInputException("Saved credential was not found.")

        provider, model, base_url, encrypted_api_key, stored_hash = row
        if not secrets.compare_digest(stored_hash, self._hash_token(clean_token)):
            raise InvalidInputException("Invalid credential access token.")

        api_key = self._decrypt_api_key(provider, encrypted_api_key)
        return {
            "api_key": api_key,
            "provider": provider,
            "model": model,
            "base_url": base_url,
        }

    def delete(self, credential_id: str, credential_token: str) -> bool:
        clean_id = credential_id.strip()
        clean_token = credential_token.strip()
        if not clean_id or not clean_token:
            raise InvalidInputException("Invalid credential reference.")

        with sqlite3.connect(self.db_path) as connection:
            cursor = connection.cursor()
            cursor.execute(
                "SELECT token_hash FROM credentials WHERE credential_id = ?",
                (clean_id,),
            )
            row = cursor.fetchone()
            if not row or not secrets.compare_digest(row[0], self._hash_token(clean_token)):
                raise InvalidInputException("Saved credential was not found.")

            connection.execute(
                "DELETE FROM credentials WHERE credential_id = ?",
                (clean_id,),
            )
            connection.commit()
            return True


credential_service = CredentialService()
