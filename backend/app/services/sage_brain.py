import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from skills.macro_tracker import (  # noqa: E402
    MacroTracker,
    looks_like_food_message,
    parse_food_message,
)
from skills.rag_reader import RagReader  # noqa: E402

DOC_INTENT = (
    r"\b(notes?|pdf|pdfs|document|documents|docs|syllabus|lecture|"
    r"lectures|handbook|guide|reading|readings|search|look\s?up)\b"
)


class SageBrain:
    """Local orchestrator: routes chat input to skills and builds state.

    When the Hermes Agent (OpenShell sandbox) is connected, its replies
    will replace the deterministic composer below; skills and state
    handling stay the same.
    """

    def __init__(self, sandbox_dir: Optional[Path] = None):
        self.sandbox_dir = Path(sandbox_dir) if sandbox_dir else REPO_ROOT / "sandbox"
        self.tracker = MacroTracker(self.sandbox_dir / "state" / "macros.json")
        self.reader = RagReader(self.sandbox_dir / "docs")

    def load_schedule(self, limit: int = 5) -> List[Dict[str, Any]]:
        path = self.sandbox_dir / "calendar" / "events.json"
        if not path.exists():
            return []
        try:
            events = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        now = datetime.now().isoformat(timespec="seconds")
        upcoming = [e for e in events if e.get("date", "") >= now]
        upcoming.sort(key=lambda e: e.get("date", ""))
        return upcoming[:limit]

    def build_state(self, documents: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        return {
            "macros": self.tracker.state(),
            "schedule": self.load_schedule(),
            "documents": documents or [],
        }

    def process(self, message: str, conversation_id: Optional[str] = None) -> Dict[str, Any]:
        parts: List[str] = []
        documents: List[Dict[str, Any]] = []

        if looks_like_food_message(message):
            parsed = parse_food_message(message)
            if parsed:
                self.tracker.add_intake(**parsed)
                totals = self.tracker.today_totals()
                targets = self.tracker.targets
                parts.append(
                    f"Logged {parsed['calories']:.0f} kcal / {parsed['protein']:.0f} g protein. "
                    f"Today you're at {totals['calories']:.0f} / {targets['calories']:.0f} kcal "
                    f"and {totals['protein']:.0f} / {targets['protein']:.0f} g protein."
                )

        if re.search(DOC_INTENT, message, re.IGNORECASE):
            documents = self.reader.search(message, top_k=3)
            if documents:
                top = documents[0]
                parts.append(
                    f"Found this in {top['document']} (page {top['page']}): "
                    f"\"{top['snippet']}\""
                )
                if len(documents) > 1:
                    extra = ", ".join(
                        f"{d['document']} p{d['page']}" for d in documents[1:]
                    )
                    parts.append(f"Also relevant: {extra}.")
            else:
                parts.append(
                    "I couldn't find that in your PDFs under sandbox/docs yet. "
                    "Drop more files there and ask again."
                )

        if not parts:
            totals = self.tracker.today_totals()
            targets = self.tracker.targets
            schedule = self.load_schedule(limit=1)
            next_event = (
                f"Next up: {schedule[0]['title']} on {schedule[0]['date'][:10]}."
                if schedule
                else "Nothing scheduled."
            )
            parts.append(
                "SAGE local mode is running (Hermes bridge pending). "
                f"{next_event} "
                f"Macros today: {totals['calories']:.0f} / {targets['calories']:.0f} kcal, "
                f"{totals['protein']:.0f} / {targets['protein']:.0f} g protein. "
                "Try 'ate 600 kcal with 40g protein chicken rice' or ask about your lecture notes."
            )

        return {
            "reply": "\n\n".join(parts),
            "conversation_id": conversation_id,
            "state": self.build_state(documents),
        }


sage_brain = SageBrain()
