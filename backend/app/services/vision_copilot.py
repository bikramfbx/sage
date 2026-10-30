"""Vision copilot: image upload perception for SAGE.

Routes an uploaded image through the vision-language model (Nemotron-line
VLM served by Nebius) to either the FOOD_MEAL macro pipeline or the
ACADEMIC_ASSIGNMENT study pipeline. Heavy lifting lives in
skills.screen_perception; this service owns async dispatch, settings, and
graceful OCR-heuristic degradation. Images are processed in memory only
and never persisted.
"""

import asyncio
from typing import Any, Dict, Optional

from app.core.config import settings
from skills import screen_perception as sp


class VisionCopilot:
    def __init__(self):
        self.llm_calls = 0

    def _creds(self) -> Dict[str, str]:
        return {
            "api_key": settings.nebius_api_key,
            "base_url": settings.nebius_base_url,
            "model_id": settings.vision_model_id,
        }

    def vision_available(self) -> bool:
        return bool(settings.nebius_api_key)

    async def classify(self, image_bytes: bytes) -> Dict[str, Any]:
        """Returns {"category": FOOD_MEAL|ACADEMIC_ASSIGNMENT, "source": str}."""
        category, source = await asyncio.to_thread(
            sp.classify_image, image_bytes, **self._creds()
        )
        self.llm_calls += 1
        return {"category": category, "source": source}

    async def analyze_food(self, image_bytes: bytes) -> Optional[Dict[str, Any]]:
        """Vision nutrition estimate; None when vision is unavailable."""
        if not self.vision_available():
            return None
        self.llm_calls += 1
        return await asyncio.to_thread(
            sp.estimate_food_macros, image_bytes, **self._creds()
        )

    async def analyze_assignment(self, image_bytes: bytes) -> Dict[str, Any]:
        """Assignment extraction (vision primary, OCR fallback)."""
        self.llm_calls += 1
        return await asyncio.to_thread(
            sp.extract_assignment, image_bytes, **self._creds()
        )


vision_copilot = VisionCopilot()
