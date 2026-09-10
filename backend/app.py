"""
ContentCore Backend - FastAPI Application

Provides the POST /define API endpoint for the PDF & E-book Reader Extension.
Enforces strict input validation, privacy safeguards, and standardized error envelopes.
"""

import logging
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend.config import settings
from backend.exceptions import (
    ContentCoreException,
    InvalidInputException,
)
from backend.schemas import DefineRequest, DefineResponse, ErrorResponse
from backend.services.llm_service import llm_service

# Configure privacy-preserving logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("contentcore.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle handler."""
    logger.info(
        f"Starting ContentCore backend (Provider: {settings.provider_name}, Model: {settings.model}, Configured: {settings.is_configured})"
    )
    yield
    logger.info("ContentCore backend shut down.")


app = FastAPI(
    title="ContentCore Smart PDF & E-Book Reader API",
    description="Context-aware definition engine for selected document text.",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for browser extension contexts (including chrome-extension:// origins)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Exception Handlers
# ---------------------------------------------------------------------------
@app.exception_handler(ContentCoreException)
async def handle_contentcore_exception(
    request: Request, exc: ContentCoreException
) -> JSONResponse:
    """Handles domain-specific ContentCore exceptions."""
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "code": exc.code,
            "message": exc.message,
        },
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Handles FastAPI/Pydantic request validation failures."""
    return JSONResponse(
        status_code=400,
        content={
            "status": "error",
            "code": "INVALID_INPUT",
            "message": "Selected text and its surrounding passage are required.",
        },
    )


@app.exception_handler(StarletteHTTPException)
async def handle_starlette_http_exception(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Catches HTTP exceptions such as 400 Bad Request on JSON decoding."""
    if exc.status_code == 400:
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "code": "INVALID_INPUT",
                "message": "Selected text and its surrounding passage are required.",
            },
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "status": "error",
            "code": "HTTP_ERROR",
            "message": exc.detail,
        },
    )


@app.exception_handler(Exception)
async def handle_generic_exception(
    request: Request, exc: Exception
) -> JSONResponse:
    """
    Fallback exception handler.
    Ensures internal stack traces and server details are never exposed to clients.
    """
    logger.error(f"Unhandled server error: {type(exc).__name__}")
    return JSONResponse(
        status_code=503,
        content={
            "status": "error",
            "code": "DEFINITION_UNAVAILABLE",
            "message": "The definition service is temporarily unavailable. Please try again.",
        },
    )


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------
@app.post(
    "/define",
    response_model=DefineResponse,
    responses={
        400: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
        504: {"model": ErrorResponse},
    },
)
async def define_text(request: Request) -> JSONResponse:
    """
    Context-aware definition endpoint.
    
    Accepts target text (under 'word', 'phrase', 'target', or 'selectedText')
    and surrounding 'context'. Returns an instant, simplified contextual explanation.
    """
    try:
        payload = await request.json()
    except Exception:
        raise InvalidInputException(
            "Selected text and its surrounding passage are required."
        )

    # Validate and normalize payload
    req = DefineRequest.model_validate(payload)

    # Call LLM contextual engine
    result: DefineResponse = llm_service.define(target=req.target, context=req.context)

    return JSONResponse(
        status_code=200,
        content=result.model_dump(),
    )


@app.get("/health")
async def health_check() -> dict[str, Any]:
    """Health check endpoint providing non-sensitive operational status."""
    return {
        "status": "healthy",
        "provider": settings.provider_name,
        "model": settings.model,
        "configured": settings.is_configured,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=settings.host, port=settings.port)
