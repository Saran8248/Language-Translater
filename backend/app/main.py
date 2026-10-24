"""
FastAPI application entry point for Universal Translator backend.
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings
from .schemas import (
    TranslationRequest,
    TranslationResponse,
    LanguageDetectionRequest,
    LanguageDetectionResponse,
    HealthStatusResponse,
)
from .services.cache import translation_cache
from .services.rate_limiter import rate_limiter
from .services.translator import translation_service

# Setup logging
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("universal_translator")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Universal Translator Backend starting up...")
    logger.info(f"Active provider: {translation_service.get_provider_name()}")
    yield
    logger.info("Universal Translator Backend shutting down...")

app = FastAPI(
    title="Universal Translator API",
    description="Backend translation proxy for the Universal Translator Chrome extension.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Permits Chrome Extension origins (chrome-extension://*) and localhost
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def client_rate_limiting_middleware(request: Request, call_next):
    # Only rate limit translation & detection endpoints
    if request.url.path in ("/translate", "/detect"):
        client_ip = request.client.host if request.client else "127.0.0.1"
        rate_limiter.check(client_ip)
    response = await call_next(request)
    return response


@app.get("/", summary="Root index")
async def root():
    return {
        "service": "Universal Translator API",
        "version": "1.0.0",
        "docs_url": "/docs",
        "health_url": "/health",
        "active_provider": translation_service.get_provider_name()
    }


@app.get("/health", response_model=HealthStatusResponse, summary="Health status")
async def health():
    stats = translation_cache.stats()
    return HealthStatusResponse(
        status="healthy",
        provider=translation_service.get_provider_name(),
        active_providers_available=translation_service.list_available_providers(),
        cache_items=stats["size"],
        cache_hit_rate=stats["hit_rate"],
        version="1.0.0"
    )


@app.post("/translate", response_model=TranslationResponse, summary="Batch translate texts")
async def translate(req: TranslationRequest):
    try:
        translations, detected_lang, cached_count, provider = await translation_service.translate(
            texts=req.texts,
            target=req.target,
            source=req.source or "auto"
        )
        return TranslationResponse(
            translations=translations,
            source=req.source or "auto",
            detected_language=detected_lang,
            target=req.target,
            provider=provider,
            cached_count=cached_count
        )
    except Exception as e:
        logger.error(f"Translation failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Translation failed: {str(e)}"
        )


@app.post("/detect", response_model=LanguageDetectionResponse, summary="Detect language")
async def detect(req: LanguageDetectionRequest):
    try:
        lang, confidence = await translation_service.detect(req.text)
        is_en = lang.lower().startswith("en")
        return LanguageDetectionResponse(
            language=lang,
            confidence=round(confidence, 2),
            is_english=is_en
        )
    except Exception as e:
        logger.error(f"Language detection failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Detection failed: {str(e)}"
        )


@app.post("/cache/clear", summary="Clear translation cache")
async def clear_cache():
    translation_cache.clear()
    return {"message": "Translation cache cleared successfully."}
