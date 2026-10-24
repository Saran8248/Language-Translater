"""
Translation services supporting Google Cloud, DeepL, LibreTranslate, MyMemory, and Mock.
Provides batch translation, language detection, error handling, and caching.
"""
import asyncio
import logging
import re
from typing import List, Tuple, Optional, Dict, Any
import httpx
from ..config import settings
from .cache import translation_cache

logger = logging.getLogger("universal_translator")

class BaseTranslator:
    name: str = "base"

    async def translate_batch(
        self, texts: List[str], target: str = "en", source: str = "auto"
    ) -> Tuple[List[str], Optional[str]]:
        raise NotImplementedError

    async def detect_language(self, text: str) -> Tuple[str, float]:
        raise NotImplementedError


class MockTranslator(BaseTranslator):
    """Deterministic mock translator for testing and offline development."""
    name: str = "mock"

    DICTIONARY: Dict[str, str] = {
        # German
        "Guten Morgen": "Good morning",
        "Guten Tag": "Good day",
        "Auf Wiedersehen": "Goodbye",
        "Hallo Welt": "Hello World",
        "Willkommen auf unserer Webseite": "Welcome to our website",
        "Dies ist ein Testartikel": "This is a test article",
        "Hier klicken": "Click here",
        "Mehr erfahren": "Learn more",
        "Kontaktieren Sie uns": "Contact us",
        "Über uns": "About us",
        "Datenschutz": "Privacy policy",
        "Impressum": "Imprint",
        # French
        "Bonjour": "Hello",
        "Bonjour le monde": "Hello world",
        "Bienvenue sur notre site web": "Welcome to our website",
        "Ceci est un article de test": "This is a test article",
        "Cliquez ici": "Click here",
        "En savoir plus": "Learn more",
        "Contactez-nous": "Contact us",
        "À propos": "About",
        "Politique de confidentialité": "Privacy policy",
        # Spanish
        "Hola": "Hello",
        "Hola Mundo": "Hello World",
        "Bienvenido a nuestro sitio web": "Welcome to our website",
        "Este es un artículo de prueba": "This is a test article",
        "Haga clic aquí": "Click here",
        "Leer más": "Read more",
        "Contáctenos": "Contact us",
        "Sobre nosotros": "About us",
        "Política de privacidad": "Privacy policy",
        # Japanese
        "こんにちは": "Hello",
        "こんにちは世界": "Hello World",
        "私たちのウェブサイトへようこそ": "Welcome to our website",
        "これはテスト記事です": "This is a test article",
        "ここをクリック": "Click here",
        "詳細を見る": "See details",
        "お問い合わせ": "Contact us",
        "会社概要": "Company profile",
        "プライバシーポリシー": "Privacy policy"
    }

    async def translate_batch(
        self, texts: List[str], target: str = "en", source: str = "auto"
    ) -> Tuple[List[str], Optional[str]]:
        results = []
        detected_lang = source if source != "auto" else None

        for text in texts:
            clean = text.strip()
            if not clean:
                results.append(text)
                continue

            if not detected_lang:
                lang, _ = await self.detect_language(clean)
                if lang != "en":
                    detected_lang = lang

            # Check dictionary
            if clean in self.DICTIONARY:
                results.append(self.DICTIONARY[clean])
            elif clean.lower() in {k.lower(): v for k, v in self.DICTIONARY.items()}:
                lookup = {k.lower(): v for k, v in self.DICTIONARY.items()}
                results.append(lookup[clean.lower()])
            else:
                # Wrap with English mock marker
                results.append(f"[EN: {clean}]")

        return results, (detected_lang or "auto")

    async def detect_language(self, text: str) -> Tuple[str, float]:
        sample = text.strip().lower()
        # Japanese script detection
        if re.search(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]', text):
            return "ja", 0.99
        # German markers
        if any(w in sample for w in ["guten", "morgen", "willkommen", "und", "dies", "hier", "über", "uns", "kontaktieren"]):
            return "de", 0.95
        # French markers
        if any(w in sample for w in ["bonjour", "monde", "bienvenue", "notre", "ceci", "cliquez", "plus", "propos"]):
            return "fr", 0.95
        # Spanish markers
        if any(w in sample for w in ["hola", "mundo", "bienvenido", "nuestro", "este", "artículo", "aquí", "contacto"]):
            return "es", 0.95
        # English markers
        if any(w in sample for w in ["the", "and", "is", "welcome", "this", "our", "click", "here", "read"]):
            return "en", 0.95
        return "auto", 0.5


class GoogleTranslator(BaseTranslator):
    """Google Cloud Translation API v2."""
    name: str = "google"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.endpoint = "https://translation.googleapis.com/language/translate/v2"

    async def translate_batch(
        self, texts: List[str], target: str = "en", source: str = "auto"
    ) -> Tuple[List[str], Optional[str]]:
        params = {"key": self.api_key}
        payload = {
            "q": texts,
            "target": target,
            "format": "text"
        }
        if source and source != "auto":
            payload["source"] = source

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(self.endpoint, params=params, json=payload)
            resp.raise_for_status()
            data = resp.json()

        translations_data = data.get("data", {}).get("translations", [])
        translations = []
        detected_lang = None

        for item in translations_data:
            translations.append(item.get("translatedText", ""))
            if not detected_lang and "detectedSourceLanguage" in item:
                detected_lang = item["detectedSourceLanguage"]

        return translations, detected_lang

    async def detect_language(self, text: str) -> Tuple[str, float]:
        endpoint = "https://translation.googleapis.com/language/translate/v2/detect"
        params = {"key": self.api_key}
        payload = {"q": [text]}

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(endpoint, params=params, json=payload)
            resp.raise_for_status()
            data = resp.json()

        detections = data.get("data", {}).get("detections", [[]])[0]
        if detections:
            return detections[0].get("language", "en"), detections[0].get("confidence", 1.0)
        return "en", 0.0


class DeepLTranslator(BaseTranslator):
    """DeepL Translation API."""
    name: str = "deepl"

    def __init__(self, api_key: str, api_url: str = settings.DEEPL_API_URL):
        self.api_key = api_key
        self.api_url = api_url

    async def translate_batch(
        self, texts: List[str], target: str = "en", source: str = "auto"
    ) -> Tuple[List[str], Optional[str]]:
        headers = {
            "Authorization": f"DeepL-Auth-Key {self.api_key}",
            "Content-Type": "application/json"
        }
        # DeepL expects uppercase target language (e.g. "EN-US" or "EN")
        target_lang = target.upper()
        if target_lang == "EN":
            target_lang = "EN-US"

        payload: Dict[str, Any] = {
            "text": texts,
            "target_lang": target_lang
        }
        if source and source != "auto":
            payload["source_lang"] = source.upper()

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(self.api_url, headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        results = []
        detected_lang = None
        for item in data.get("translations", []):
            results.append(item.get("text", ""))
            if not detected_lang and "detected_source_language" in item:
                detected_lang = item["detected_source_language"].lower()

        return results, detected_lang

    async def detect_language(self, text: str) -> Tuple[str, float]:
        # DeepL detects during translate
        res, detected = await self.translate_batch([text[:200]], target="en")
        return detected or "en", 0.9


class LibreTranslateTranslator(BaseTranslator):
    """LibreTranslate open-source translation API."""
    name: str = "libretranslate"

    def __init__(self, url: str, api_key: str = ""):
        self.url = url.rstrip("/")
        self.api_key = api_key

    async def translate_batch(
        self, texts: List[str], target: str = "en", source: str = "auto"
    ) -> Tuple[List[str], Optional[str]]:
        endpoint = f"{self.url}/translate"
        payload = {
            "q": texts,
            "source": source if source != "auto" else "auto",
            "target": target,
            "format": "text"
        }
        if self.api_key:
            payload["api_key"] = self.api_key

        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(endpoint, json=payload)
            resp.raise_for_status()
            data = resp.json()

        # LibreTranslate may return array of strings or single translatedText
        if isinstance(data, dict) and "translatedText" in data:
            if isinstance(data["translatedText"], list):
                return data["translatedText"], None
            return [data["translatedText"]], None
        elif isinstance(data, list):
            return [item.get("translatedText", "") if isinstance(item, dict) else str(item) for item in data], None
        return texts, None

    async def detect_language(self, text: str) -> Tuple[str, float]:
        endpoint = f"{self.url}/detect"
        payload = {"q": text}
        if self.api_key:
            payload["api_key"] = self.api_key

        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(endpoint, json=payload)
            resp.raise_for_status()
            data = resp.json()

        if isinstance(data, list) and len(data) > 0:
            top = data[0]
            return top.get("language", "en"), top.get("confidence", 1.0)
        return "en", 0.5


class MyMemoryTranslator(BaseTranslator):
    """
    MyMemory free translation service with batching and fallback support.
    Useful for zero-credential out-of-the-box local testing.
    """
    name: str = "mymemory"

    def __init__(self, email: str = settings.MYMEMORY_EMAIL):
        self.email = email
        self.endpoint = "https://api.mymemory.translated.net/get"

    async def _translate_single(self, client: httpx.AsyncClient, text: str, target: str, source: str) -> Tuple[str, Optional[str]]:
        langpair = f"{source}|{target}" if source and source != "auto" else f"auto|{target}"
        params = {"q": text, "langpair": langpair}
        if self.email:
            params["de"] = self.email

        try:
            resp = await client.get(self.endpoint, params=params)
            if resp.status_code == 200:
                data = resp.json()
                trans = data.get("responseData", {}).get("translatedText")
                # Also inspect matches for detected language if auto
                detected = None
                matches = data.get("matches", [])
                if matches and "source" in matches[0]:
                    detected = matches[0]["source"].split("-")[0].lower()
                return trans if trans else text, detected
            return text, None
        except Exception as e:
            logger.warning(f"MyMemory error translating '{text[:30]}': {e}")
            return text, None

    async def translate_batch(
        self, texts: List[str], target: str = "en", source: str = "auto"
    ) -> Tuple[List[str], Optional[str]]:
        results = [None] * len(texts)
        detected_lang = None

        # Concurrently translate up to 5 requests at a time to respect rate limits
        sem = asyncio.Semaphore(5)

        async def worker(idx: int, t: str, client: httpx.AsyncClient):
            async with sem:
                res, det = await self._translate_single(client, t, target, source)
                return idx, res, det

        async with httpx.AsyncClient(timeout=10.0) as client:
            tasks = [worker(i, text, client) for i, text in enumerate(texts)]
            completed = await asyncio.gather(*tasks, return_exceptions=True)

        for item in completed:
            if isinstance(item, tuple):
                idx, res, det = item
                results[idx] = res
                if not detected_lang and det:
                    detected_lang = det

        # Fill any missing
        for i in range(len(results)):
            if results[i] is None:
                results[i] = texts[i]

        return results, detected_lang

    async def detect_language(self, text: str) -> Tuple[str, float]:
        # Fast local heuristic check first
        mock = MockTranslator()
        lang, conf = await mock.detect_language(text)
        if lang != "auto":
            return lang, conf

        # Try MyMemory sample
        _, det = await self.translate_batch([text[:150]], target="en")
        return det or "en", 0.8


class TranslationService:
    """
    Main manager service orchestrating providers, in-memory caching,
    and automatic failover.
    """
    def __init__(self):
        self.provider = self._init_primary_provider()
        self.mock_fallback = MockTranslator()

    def _init_primary_provider(self) -> BaseTranslator:
        prov = settings.TRANSLATION_PROVIDER
        if prov == "google" or (prov == "auto" and settings.GOOGLE_TRANSLATE_API_KEY):
            logger.info("Universal Translator using Google Cloud Translation provider.")
            return GoogleTranslator(settings.GOOGLE_TRANSLATE_API_KEY)
        elif prov == "deepl" or (prov == "auto" and settings.DEEPL_API_KEY):
            logger.info("Universal Translator using DeepL Translation provider.")
            return DeepLTranslator(settings.DEEPL_API_KEY, settings.DEEPL_API_URL)
        elif prov == "libretranslate" or (prov == "auto" and settings.LIBRETRANSLATE_URL):
            logger.info("Universal Translator using LibreTranslate provider.")
            return LibreTranslateTranslator(settings.LIBRETRANSLATE_URL, settings.LIBRETRANSLATE_API_KEY)
        elif prov == "mock":
            logger.info("Universal Translator using Mock provider.")
            return MockTranslator()
        else:
            # Default to MyMemory with fallback to Mock
            logger.info("Universal Translator using MyMemory free provider.")
            return MyMemoryTranslator()

    def get_provider_name(self) -> str:
        return self.provider.name

    def list_available_providers(self) -> List[str]:
        available = ["mock", "mymemory"]
        if settings.GOOGLE_TRANSLATE_API_KEY:
            available.append("google")
        if settings.DEEPL_API_KEY:
            available.append("deepl")
        if settings.LIBRETRANSLATE_URL:
            available.append("libretranslate")
        return available

    async def translate(
        self, texts: List[str], target: str = "en", source: str = "auto"
    ) -> Tuple[List[str], Optional[str], int, str]:
        """
        Translates a batch of texts:
        1. Checks in-memory cache for each text.
        2. Uncached texts are translated via primary provider.
        3. If primary provider fails, falls back gracefully to Mock translator.
        4. Cache is updated with newly translated texts.
        5. Returns (final_translations, detected_language, cached_count, provider_name).
        """
        translations: List[Optional[str]] = [None] * len(texts)
        uncached_indices: List[int] = []
        uncached_texts: List[str] = []
        cached_count = 0

        # Step 1: Check cache
        for idx, text in enumerate(texts):
            clean = text.strip()
            if not clean:
                translations[idx] = text
                continue

            cached = translation_cache.get(clean, source, target)
            if cached is not None:
                translations[idx] = cached
                cached_count += 1
            else:
                uncached_indices.append(idx)
                uncached_texts.append(clean)

        detected_lang: Optional[str] = None
        provider_used = self.provider.name

        # Step 2: Translate uncached items if any
        if uncached_texts:
            try:
                new_translations, det = await self.provider.translate_batch(
                    uncached_texts, target=target, source=source
                )
                detected_lang = det
            except Exception as e:
                logger.error(f"Primary provider '{self.provider.name}' failed: {e}. Falling back to MockTranslator.")
                new_translations, det = await self.mock_fallback.translate_batch(
                    uncached_texts, target=target, source=source
                )
                detected_lang = det
                provider_used = f"{self.provider.name}->mock_fallback"

            # Step 3: Populate cache and fill results
            for idx, text, trans in zip(uncached_indices, uncached_texts, new_translations):
                translations[idx] = trans
                translation_cache.set(text, trans, source, target)

        # Guarantee no None
        final_list = [t if t is not None else "" for t in translations]
        return final_list, detected_lang, cached_count, provider_used

    async def detect(self, text: str) -> Tuple[str, float]:
        try:
            return await self.provider.detect_language(text)
        except Exception as e:
            logger.warning(f"Detection failed on primary provider: {e}. Falling back to mock detection.")
            return await self.mock_fallback.detect_language(text)


translation_service = TranslationService()
