"""Encrypted server-side storage for user-supplied provider credentials."""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
import sqlite3
import uuid
from pathlib import Path

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

    def register(
        self,
        provider: str,
        api_key: str,
        model: str | None = None,
        base_url: str | None = None,
    ) -> dict[str, str | None]:
        normalized_provider = normalize_provider_name(provider)
        if normalized_provider not in SUPPORTED_PROVIDERS:
            raise InvalidInputException(
                "Provider must be Google Gemini, OpenAI, or NVIDIA NIM."
            )

        clean_api_key = api_key.strip()
        if not clean_api_key or clean_api_key in PLACEHOLDERS:
            raise InvalidInputException("A valid provider API key is required.")

        credential_id = str(uuid.uuid4())
        access_token = secrets.token_urlsafe(32)
        resolved_model = (model or "").strip() or DEFAULT_MODELS[normalized_provider]
        resolved_base_url = (base_url or "").strip() or DEFAULT_BASE_URLS[normalized_provider]
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
