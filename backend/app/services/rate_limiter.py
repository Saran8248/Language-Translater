"""
In-memory rate limiter per client IP address using a sliding window.
"""
import time
import threading
from collections import defaultdict
from typing import Dict, List
from fastapi import HTTPException, status
from ..config import settings

class RateLimiter:
    def __init__(self, rpm: int = settings.RATE_LIMIT_RPM):
        self.rpm = rpm
        self._requests: Dict[str, List[float]] = defaultdict(list)
        self._lock = threading.Lock()

    def check(self, client_ip: str) -> None:
        if self.rpm <= 0:
            return

        now = time.time()
        window_start = now - 60.0

        with self._lock:
            # Filter timestamps older than 60s
            valid_timestamps = [t for t in self._requests[client_ip] if t > window_start]
            if len(valid_timestamps) >= self.rpm:
                retry_after = int(60.0 - (now - valid_timestamps[0])) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Rate limit exceeded. Maximum {self.rpm} requests per minute.",
                    headers={"Retry-After": str(max(1, retry_after))}
                )
            valid_timestamps.append(now)
            self._requests[client_ip] = valid_timestamps

    def cleanup(self) -> None:
        """Periodically removes stale IPs to prevent memory leaks."""
        now = time.time()
        window_start = now - 60.0
        with self._lock:
            stale_keys = [ip for ip, timestamps in self._requests.items() if not timestamps or timestamps[-1] <= window_start]
            for ip in stale_keys:
                del self._requests[ip]

rate_limiter = RateLimiter()
