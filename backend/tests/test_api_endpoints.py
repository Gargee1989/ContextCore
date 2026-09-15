"""
Tests for FastAPI API endpoints, headers, error responses, and status codes.
"""

from unittest.mock import patch
from fastapi.testclient import TestClient

from backend.app import app
from backend.schemas import DefineResponse
from backend.exceptions import (
    RateLimitedException,
    ServiceTimeoutException,
    DefinitionUnavailableException,
)

client = TestClient(app)


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "provider" in data
    assert "model" in data


def test_define_endpoint_success():
    mock_result = DefineResponse(
        status="success",
        meaning="It means unusual or different from what is normally expected.",
        tone="",
        synonym="unusual",
        example="Leaving a meeting without saying anything would be unusual behavior.",
        simplified_passage="His unusual behavior during the meeting confused everyone.",
    )

    with patch("backend.app.llm_service.define", return_value=mock_result):
        response = client.post(
            "/define",
            json={
                "word": "aberrant",
                "context": "His aberrant behavior during the meeting perplexed everyone.",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["meaning"] == "It means unusual or different from what is normally expected."
        assert data["synonym"] == "unusual"
        assert data["simplified_passage"] == "His unusual behavior during the meeting confused everyone."


def test_define_endpoint_more_context_needed():
    mock_result = DefineResponse(
        status="more_context_needed",
        meaning="Highlight the surrounding sentence or paragraph to make the meaning clear.",
        tone="",
        synonym="",
        example="",
        simplified_passage="",
    )

    with patch("backend.app.llm_service.define", return_value=mock_result):
        response = client.post(
            "/define",
            json={
                "word": "charge",
                "context": "The charge was important.",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "more_context_needed"
        assert data["meaning"] == "Highlight the surrounding sentence or paragraph to make the meaning clear."


def test_define_endpoint_missing_target():
    response = client.post(
        "/define",
        json={"context": "Some passage without target."},
    )
    assert response.status_code == 400
    data = response.json()
    assert data == {
        "status": "error",
        "code": "INVALID_INPUT",
        "message": "Selected text and its surrounding passage are required.",
    }


def test_define_endpoint_missing_context():
    response = client.post(
        "/define",
        json={"word": "aberrant"},
    )
    assert response.status_code == 400
    data = response.json()
    assert data == {
        "status": "error",
        "code": "INVALID_INPUT",
        "message": "Selected text and its surrounding passage are required.",
    }


def test_define_endpoint_empty_body():
    response = client.post(
        "/define",
        content="",
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 400
    data = response.json()
    assert data["status"] == "error"
    assert data["code"] == "INVALID_INPUT"


def test_define_endpoint_rate_limited():
    with patch(
        "backend.app.llm_service.define",
        side_effect=RateLimitedException(),
    ):
        response = client.post(
            "/define",
            json={"word": "test", "context": "Valid test context."},
        )
        assert response.status_code == 429
        assert response.json() == {
            "status": "error",
            "code": "RATE_LIMITED",
            "message": "Too many definition requests. Please try again shortly.",
        }


def test_define_endpoint_timeout():
    with patch(
        "backend.app.llm_service.define",
        side_effect=ServiceTimeoutException(),
    ):
        response = client.post(
            "/define",
            json={"word": "test", "context": "Valid test context."},
        )
        assert response.status_code == 504
        assert response.json() == {
            "status": "error",
            "code": "SERVICE_TIMEOUT",
            "message": "The definition service took too long to respond. Please try again.",
        }


def test_define_endpoint_provider_failure():
    with patch(
        "backend.app.llm_service.define",
        side_effect=DefinitionUnavailableException(),
    ):
        response = client.post(
            "/define",
            json={"word": "test", "context": "Valid test context."},
        )
        assert response.status_code == 503
        assert response.json() == {
            "status": "error",
            "code": "DEFINITION_UNAVAILABLE",
            "message": "The definition service is temporarily unavailable. Please try again.",
        }


def test_define_endpoint_cors_headers():
    response = client.options(
        "/define",
        headers={
            "Origin": "chrome-extension://abcdefghijklmnop",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert response.headers.get("access-control-allow-origin") == "*"


def test_register_credential_returns_opaque_reference():
    registered = {
        "credential_id": "credential-id",
        "credential_token": "credential-token",
        "provider": "OpenAI",
        "model": "gpt-test",
    }
    with patch("backend.app.credential_service.register", return_value=registered) as register:
        response = client.post(
            "/credentials",
            json={"provider": "OpenAI", "api_key": "sk-test", "model": "gpt-test"},
        )

    assert response.status_code == 200
    assert response.json() == registered
    assert "api_key" not in response.json()
    register.assert_called_once_with(
        provider="OpenAI",
        api_key="sk-test",
        model="gpt-test",
        base_url=None,
    )


def test_define_endpoint_resolves_credential_reference():
    mock_result = DefineResponse(
        status="success",
        meaning="A test meaning.",
        tone="",
        synonym="",
        example="",
        simplified_passage="",
    )
    resolved = {
        "api_key": "sk-server-side",
        "provider": "OpenAI",
        "model": "gpt-test",
        "base_url": None,
    }
    with patch("backend.app.credential_service.resolve", return_value=resolved), patch(
        "backend.app.llm_service.define", return_value=mock_result
    ) as define:
        response = client.post(
            "/define",
            json={
                "word": "test",
                "context": "Valid test context.",
                "credential_id": "credential-id",
                "credential_token": "credential-token",
            },
        )

    assert response.status_code == 200
    assert define.call_args.kwargs["api_key"] == "sk-server-side"
    assert define.call_args.kwargs["provider"] == "OpenAI"
