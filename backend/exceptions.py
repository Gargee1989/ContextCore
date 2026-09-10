"""
ContentCore Backend - Domain Exceptions

Custom exception classes that map to standardized client error responses.
"""


class ContentCoreException(Exception):
    """Base exception for ContentCore errors."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


class InvalidInputException(ContentCoreException):
    """HTTP 400 - Validation failure or missing input."""

    def __init__(
        self,
        message: str = "Selected text and its surrounding passage are required.",
    ) -> None:
        super().__init__(
            status_code=400,
            code="INVALID_INPUT",
            message=message,
        )


class RateLimitedException(ContentCoreException):
    """HTTP 429 - Upstream provider or local rate limit exceeded."""

    def __init__(
        self,
        message: str = "Too many definition requests. Please try again shortly.",
    ) -> None:
        super().__init__(
            status_code=429,
            code="RATE_LIMITED",
            message=message,
        )


class ServiceTimeoutException(ContentCoreException):
    """HTTP 504 - Upstream provider timed out."""

    def __init__(
        self,
        message: str = "The definition service took too long to respond. Please try again.",
    ) -> None:
        super().__init__(
            status_code=504,
            code="SERVICE_TIMEOUT",
            message=message,
        )


class DefinitionUnavailableException(ContentCoreException):
    """HTTP 503 - Provider error, parsing failure, or temporary unavailability."""

    def __init__(
        self,
        message: str = "The definition service is temporarily unavailable. Please try again.",
    ) -> None:
        super().__init__(
            status_code=503,
            code="DEFINITION_UNAVAILABLE",
            message=message,
        )
