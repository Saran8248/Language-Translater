"""
Automated unit and integration tests for Universal Translator Backend API.
"""
import unittest
from fastapi.testclient import TestClient
import sys
import os

# Add backend directory to path
backend_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from app.main import app
from app.services.cache import translation_cache
from app.services.rate_limiter import rate_limiter
from app.config import settings

class TestUniversalTranslatorBackend(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        # Reset cache before tests
        translation_cache.clear()

    def test_root_endpoint(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("service", data)
        self.assertIn("active_provider", data)

    def test_health_endpoint(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["status"], "healthy")
        self.assertIn("provider", data)
        self.assertIn("cache_items", data)
        self.assertIn("version", data)

    def test_batch_translate(self):
        payload = {
            "texts": ["Guten Morgen", "Auf Wiedersehen"],
            "target": "en",
            "source": "de"
        }
        resp = self.client.post("/translate", json=payload)
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("translations", data)
        self.assertEqual(len(data["translations"]), 2)
        # Check translation outputs
        self.assertEqual(data["target"], "en")
        self.assertEqual(data["source"], "de")
        self.assertTrue(len(data["translations"][0]) > 0)
        self.assertTrue(len(data["translations"][1]) > 0)

    def test_cache_hits(self):
        payload = {
            "texts": ["Hallo Welt"],
            "target": "en",
            "source": "de"
        }
        # First call: cache miss
        resp1 = self.client.post("/translate", json=payload)
        self.assertEqual(resp1.status_code, 200)
        data1 = resp1.json()
        self.assertEqual(data1["cached_count"], 0)

        # Second call: cache hit
        resp2 = self.client.post("/translate", json=payload)
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.json()
        self.assertEqual(data2["cached_count"], 1)
        self.assertEqual(data1["translations"], data2["translations"])

    def test_clear_cache(self):
        payload = {"texts": ["Bonjour"], "target": "en", "source": "fr"}
        self.client.post("/translate", json=payload)
        self.assertGreater(translation_cache.stats()["size"], 0)

        clear_resp = self.client.post("/cache/clear")
        self.assertEqual(clear_resp.status_code, 200)
        self.assertEqual(translation_cache.stats()["size"], 0)

    def test_detect_language(self):
        resp = self.client.post("/detect", json={"text": "Bonjour tout le monde"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("language", data)
        self.assertIn("confidence", data)
        self.assertIn("is_english", data)
        self.assertFalse(data["is_english"])

        # Test English detection
        resp_en = self.client.post("/detect", json={"text": "The quick brown fox jumps over the lazy dog."})
        self.assertEqual(resp_en.status_code, 200)
        data_en = resp_en.json()
        self.assertTrue(data_en["is_english"])

    def test_validation_empty_texts(self):
        resp = self.client.post("/translate", json={"texts": [], "target": "en"})
        self.assertEqual(resp.status_code, 422)

    def test_validation_exceeding_batch_limit(self):
        texts = [f"Text item {i}" for i in range(settings.MAX_TEXTS_PER_REQUEST + 5)]
        resp = self.client.post("/translate", json={"texts": texts, "target": "en"})
        self.assertEqual(resp.status_code, 422)

if __name__ == "__main__":
    unittest.main()
