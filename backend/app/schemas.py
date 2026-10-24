"""
Pydantic schemas for Universal Translator API requests and responses.
"""
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator
from .config import settings

class TranslationRequest(BaseModel):
    texts: List[str] = Field(
        ...,
        description="List of strings to translate",
        min_length=1
    )
    target: str = Field(
        default="en",
        description="Target ISO 639-1 language code (e.g. 'en')"
    )
    source: Optional[str] = Field(
        default="auto",
        description="Source ISO 639-1 language code or 'auto' for automatic detection"
    )

    @field_validator("texts")
    @classmethod
    def validate_texts(cls, v: List[str]) -> List[str]:
        if len(v) > settings.MAX_TEXTS_PER_REQUEST:
            raise ValueError(
                f"Too many texts in batch. Maximum allowed is {settings.MAX_TEXTS_PER_REQUEST}, received {len(v)}."
            )
        total_chars = 0
        for idx, text in enumerate(v):
            if len(text) > settings.MAX_CHARS_PER_TEXT:
                raise ValueError(
                    f"Text at index {idx} exceeds maximum length of {settings.MAX_CHARS_PER_TEXT} characters."
                )
            total_chars += len(text)
        if total_chars > settings.MAX_TOTAL_CHARS_PER_REQUEST:
            raise ValueError(
                f"Total batch characters ({total_chars}) exceeds maximum limit ({settings.MAX_TOTAL_CHARS_PER_REQUEST})."
            )
        return v

class TranslationResponse(BaseModel):
    translations: List[str] = Field(..., description="Translated strings in original order")
    source: str = Field(default="auto", description="Source language used")
    detected_language: Optional[str] = Field(default=None, description="Detected source language if auto")
    target: str = Field(..., description="Target language")
    provider: str = Field(..., description="Translator provider used")
    cached_count: int = Field(default=0, description="Number of items served from cache")

class LanguageDetectionRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Sample text for detection")

class LanguageDetectionResponse(BaseModel):
    language: str = Field(..., description="Detected ISO language code (e.g. 'de', 'fr', 'en')")
    confidence: float = Field(default=1.0, description="Detection confidence score (0.0 to 1.0)")
    is_english: bool = Field(default=False, description="Whether detected language is English")

class HealthStatusResponse(BaseModel):
    status: str = Field(default="healthy")
    provider: str
    active_providers_available: List[str]
    cache_items: int
    cache_hit_rate: float
    version: str = "1.0.0"
