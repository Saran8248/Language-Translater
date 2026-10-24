"""
Convenience launcher for the Universal Translator FastAPI backend.
"""
import sys
import os

# Add backend directory to path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import uvicorn
from app.config import settings

def start():
    print(f"Starting Universal Translator Backend on http://{settings.HOST}:{settings.PORT}")
    print(f"Swagger API documentation: http://{settings.HOST}:{settings.PORT}/docs")
    print(f"Provider: {settings.TRANSLATION_PROVIDER}")
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level="info"
    )

if __name__ == "__main__":
    start()
