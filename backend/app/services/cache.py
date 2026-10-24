"""
Thread-safe LRU and TTL in-memory cache for translations.
"""
import time
import threading
from collections import OrderedDict
from typing import Optional, Tuple, Dict
from ..config import settings

class TranslationCache:
    def __init__(self, max_size: int = settings.CACHE_MAX_SIZE, ttl_seconds: int = settings.CACHE_TTL_SECONDS):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, Tuple[str, float]] = OrderedDict()
        self._lock = threading.Lock()
        self._hits = 0
        self._misses = 0

    def _make_key(self, text: str, source: str, target: str) -> str:
        return f"{source.strip().lower()}:{target.strip().lower()}:{text}"

    def get(self, text: str, source: str, target: str) -> Optional[str]:
        if not settings.CACHE_ENABLED:
            return None

        key = self._make_key(text, source, target)
        with self._lock:
            if key in self._cache:
                value, timestamp = self._cache[key]
                # Check expiration
                if time.time() - timestamp <= self.ttl_seconds:
                    # Move to end for LRU
                    self._cache.move_to_end(key)
                    self._hits += 1
                    return value
                else:
                    # Expired
                    del self._cache[key]
            self._misses += 1
            return None

    def set(self, text: str, translation: str, source: str, target: str) -> None:
        if not settings.CACHE_ENABLED:
            return

        key = self._make_key(text, source, target)
        now = time.time()
        with self._lock:
            if key in self._cache:
                self._cache[key] = (translation, now)
                self._cache.move_to_end(key)
            else:
                if len(self._cache) >= self.max_size:
                    # Pop oldest (FIFO/LRU)
                    self._cache.popitem(last=False)
                self._cache[key] = (translation, now)

    def stats(self) -> Dict[str, float]:
        with self._lock:
            total = self._hits + self._misses
            hit_rate = (self._hits / total) if total > 0 else 0.0
            return {
                "size": len(self._cache),
                "hits": self._hits,
                "misses": self._misses,
                "hit_rate": round(hit_rate, 4)
            }

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._hits = 0
            self._misses = 0

translation_cache = TranslationCache()
