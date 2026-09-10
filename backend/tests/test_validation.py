"""
Tests for input validation and normalization.
"""

import pytest
from backend.schemas import DefineRequest
from backend.exceptions import InvalidInputException
from backend.config import settings


def test_validation_accepts_word_alias():
    req = DefineRequest.model_validate({
        "word": " aberrant ",
        "context": " His aberrant behavior perplexed everyone. "
    })
    assert req.target == "aberrant"
    assert req.context == "His aberrant behavior perplexed everyone."


def test_validation_accepts_phrase_alias():
    req = DefineRequest.model_validate({
        "phrase": "break the ice",
        "context": "The speaker told a joke to break the ice."
    })
    assert req.target == "break the ice"
    assert req.context == "The speaker told a joke to break the ice."


def test_validation_accepts_selected_text_alias():
    req = DefineRequest.model_validate({
        "selectedText": "paradigm shift",
        "context": "The discovery marked a paradigm shift in physics."
    })
    assert req.target == "paradigm shift"


def test_validation_accepts_target_field():
    req = DefineRequest.model_validate({
        "target": "resilience",
        "context": "The ecosystem demonstrated remarkable resilience."
    })
    assert req.target == "resilience"


def test_validation_trims_whitespace():
    req = DefineRequest.model_validate({
        "word": "   entropy   ",
        "context": "   Entropy increases over time in an isolated system.   "
    })
    assert req.target == "entropy"
    assert req.context == "Entropy increases over time in an isolated system."


def test_validation_rejects_missing_target():
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "context": "Some passage without a target."
        })
    assert exc.value.code == "INVALID_INPUT"
    assert exc.value.status_code == 400


def test_validation_rejects_empty_target():
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "word": "   ",
            "context": "Some passage."
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validation_rejects_missing_context():
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "word": "aberrant"
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validation_rejects_empty_context():
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "word": "aberrant",
            "context": "   "
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validation_rejects_non_string_target():
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "word": 12345,
            "context": "Valid passage text."
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validation_rejects_non_string_context():
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "word": "aberrant",
            "context": {"invalid": "object"}
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validation_rejects_excessively_large_target():
    oversized_target = "a" * (settings.max_target_chars + 1)
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "word": oversized_target,
            "context": "Valid passage text."
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validation_rejects_excessively_large_context():
    oversized_context = "c" * (settings.max_context_chars + 1)
    with pytest.raises(InvalidInputException) as exc:
        DefineRequest.model_validate({
            "word": "aberrant",
            "context": oversized_context
        })
    assert exc.value.code == "INVALID_INPUT"


def test_validation_ignores_extra_input_fields():
    req = DefineRequest.model_validate({
        "word": "bank",
        "context": "Resting on the bank of the river.",
        "extra_field": "ignore_me"
    })
    assert req.target == "bank"
    assert not hasattr(req, "extra_field")
