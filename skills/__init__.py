"""SAGE skills: lightweight local modules the backend orchestrator calls."""

from skills.macro_tracker import MacroTracker, parse_food_message  # noqa: F401
from skills.rag_reader import RagReader  # noqa: F401
from skills.schedule_manager import ScheduleManager  # noqa: F401
from skills.screen_perception import (  # noqa: F401
    TRIGGER_KEYWORDS,
    matched_keywords,
    redact,
    should_process,
)
