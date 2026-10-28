import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from openai import AsyncOpenAI

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from skills.macro_tracker import (  # noqa: E402
    MacroTracker,
    looks_like_food_message,
    parse_food_message,
)
from skills.rag_reader import RagReader  # noqa: E402
from skills.schedule_manager import ScheduleManager  # noqa: E402

from app.core.config import settings  # noqa: E402

MAX_TOOL_ROUNDS = 4

DOC_INTENT = (
    r"\b(notes?|pdf|pdfs|document|documents|docs|syllabus|lecture|"
    r"lectures|handbook|guide|reading|readings|search)\b"
)

SYSTEM_PROMPT = """You are SAGE (Student Assistant for Growth and Education), an always-on personal AI companion for a university student.

Personality: intelligent, articulate, empathetic, and sharp. You speak like a trusted friend and mentor — warm, natural, and flexible. Never use canned or rigid template phrases. Adapt your tone to the moment: focused during a study grind, encouraging when energy dips, brief and direct when the user is in a hurry.

You help with academics, scheduling and timetables, nutrition and macro tracking, and finding things in the student's personal PDF library.

Tools and when to use them:
- log_macros: ONLY when the student logs NEW food they actually ate ("I ate X", "had X for dinner", "add a meal"). If they give exact numbers, use them as-is. If the meal is vague (e.g. "6 eggs, a sweet bun and a banana"), estimate calories and protein yourself from nutritional knowledge — reasonable ballparks are exactly what's wanted. Always pass a short food_description. If the tool result reports duplicate: true, the meal was already recorded today — do not retry, just confirm it's tracked and give the current totals.
- manage_schedule: whenever the user wants an event added, a weekly timetable imported, or asks what's coming up. Use add_event for single events and resolve relative dates like "tomorrow 5 PM" into ISO 8601 using the current time given below. Use bulk_import_timetable for pasted timetables. Use get_schedule when asked about plans. If a call fails, adjust and retry once.
- search_docs: when the user asks about their notes, PDFs, lectures, syllabus, or anything likely to live inside their documents.

Logging vs. asking (critical):
- Strictly distinguish a LOG action from a QUERY action. A LOG records new food ("I ate X", "log my lunch"). A QUERY asks about food or macros already discussed or recorded ("how many calories were in that dinner?", "what are my macros?", "how much protein do I have left?").
- Call log_macros ONLY on a LOG. For a QUERY, answer directly from the conversation history and the daily macro state below — never call log_macros, never re-estimate an already-logged meal.

Response formatting:
- When you log a meal, always state the itemized macros for THAT specific meal AND the updated daily total, e.g. "Dinner: ~810 kcal / 49 g protein. Daily Total: 2,385 / 2,500 kcal, 132 / 150 g protein."
- When answering macro queries, use the exact recorded numbers from the daily state below.

Behavior:
- Decide on your own when tools are needed: converse freely when none are, and chain multiple tools in a single turn when the request calls for it.
- After tool results come back, synthesize them into a natural reply. Never dump raw JSON or tool output at the user.
- Keep replies tight — a few sentences unless the user clearly wants depth. Plain text, minimal formatting.
- If you don't know something, say so honestly rather than inventing it.

Context: today is {date} ({weekday}), local time {time}.
Daily macro state for {macro_date}: {cal} / {tcal} kcal, {protein} / {tprotein} g protein so far.
Already logged today (never re-log these): 
{meals}"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "log_macros",
            "description": (
                "Record NEW food the student actually ate and update daily macro "
                "tracking. Estimate calories/protein from nutritional knowledge when "
                "the user is vague. NEVER call this for questions about already-logged "
                "food or macro status — answer those from context instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "food_description": {
                        "type": "string",
                        "description": "Short description of the food or meal, e.g. '6 eggs, a sweet bun, a banana'",
                    },
                    "estimated_calories": {
                        "type": "integer",
                        "description": "Total estimated kcal for the meal",
                    },
                    "estimated_protein_g": {
                        "type": "integer",
                        "description": "Total estimated grams of protein",
                    },
                },
                "required": ["food_description"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "manage_schedule",
            "description": (
                "Create calendar events, import a raw weekly timetable as recurring "
                "events, or read the upcoming schedule."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add_event", "bulk_import_timetable", "get_schedule"],
                    },
                    "event_title": {"type": "string"},
                    "date_time": {
                        "type": "string",
                        "description": "ISO 8601 datetime for add_event, e.g. 2026-10-29T17:00:00",
                    },
                    "location": {"type": "string"},
                    "timetable_text": {
                        "type": "string",
                        "description": "Raw pasted weekly timetable text for bulk_import_timetable",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_docs",
            "description": "Search the student's personal PDF library (sandbox/docs) for relevant passages.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Topic or keywords to search for"}
                },
                "required": ["query"],
            },
        },
    },
]


class SageBrain:
    """Conversational orchestrator: Nemotron via Nebius, with local
    agent tools backed by the skills package. Falls back to a deterministic
    offline mode when the LLM is unreachable."""

    def __init__(self, sandbox_dir: Optional[Path] = None):
        self.sandbox_dir = Path(sandbox_dir) if sandbox_dir else REPO_ROOT / "sandbox"
        self.tracker = MacroTracker(self.sandbox_dir / "state" / "macros.json")
        self.reader = RagReader(self.sandbox_dir / "docs")
        self.schedule = ScheduleManager(
            self.sandbox_dir / "state" / "schedule.json",
            self.sandbox_dir / "calendar" / "events.json",
        )
        self.model = settings.model_id
        self.client: Optional[AsyncOpenAI] = None
        if settings.nebius_api_key:
            self.client = AsyncOpenAI(
                base_url=settings.nebius_base_url,
                api_key=settings.nebius_api_key,
            )

    def build_state(self, documents: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        return {
            "macros": self.tracker.state(),
            "schedule": self.schedule.state(8),
            "documents": documents or [],
        }

    def _system_prompt(self) -> str:
        now = datetime.now()
        macro_state = self.tracker.state()
        totals = macro_state["totals"]
        entries = macro_state["entries"]
        if entries:
            meals = "\n".join(
                f"- {e['time'][11:16]} · {e['label']} — "
                f"{e['calories']:.0f} kcal, {e['protein']:.0f} g protein"
                for e in entries
            )
        else:
            meals = "(nothing logged yet)"
        return SYSTEM_PROMPT.format(
            date=now.strftime("%B %d, %Y"),
            weekday=now.strftime("%A"),
            time=now.strftime("%H:%M"),
            macro_date=macro_state["date"],
            meals=meals,
            cal=f"{totals['calories']:.0f}",
            tcal=f"{self.tracker.targets['calories']:.0f}",
            protein=f"{totals['protein']:.0f}",
            tprotein=f"{self.tracker.targets['protein']:.0f}",
        )

    async def _execute_tool(
        self, name: str, args: Dict[str, Any], collected: Dict[str, Any]
    ) -> Dict[str, Any]:
        try:
            if name == "log_macros":
                entry = self.tracker.add_intake(
                    label=str(args.get("food_description", "meal")),
                    calories=float(args.get("estimated_calories") or 0),
                    protein=float(args.get("estimated_protein_g") or 0),
                )
                totals = self.tracker.today_totals()
                if not entry.get("duplicate"):
                    collected["macros_touched"] = True
                return {
                    "ok": True,
                    "duplicate": bool(entry.get("duplicate")),
                    "logged": entry,
                    "today_totals": totals,
                    "targets": self.tracker.targets,
                }

            if name == "manage_schedule":
                action = str(args.get("action", ""))
                if action == "add_event":
                    event = self.schedule.add_event(
                        title=str(args.get("event_title") or "Untitled event"),
                        date_time=str(args.get("date_time") or ""),
                        location=args.get("location") or None,
                    )
                    collected["schedule_touched"] = True
                    return {"ok": True, "event": event}
                if action == "bulk_import_timetable":
                    result = self.schedule.bulk_import_timetable(
                        str(args.get("timetable_text") or "")
                    )
                    if result.get("ok"):
                        collected["schedule_touched"] = True
                    return result
                if action == "get_schedule":
                    return {"ok": True, "events": self.schedule.upcoming(10)}
                return {"ok": False, "error": f"Unknown action: {action}"}

            if name == "search_docs":
                hits = self.reader.search(str(args.get("query", "")), top_k=3)
                if hits:
                    collected["documents"] = hits
                return {
                    "ok": True,
                    "results": hits,
                    "documents_available": self.reader.list_documents(),
                }

            return {"ok": False, "error": f"Unknown tool: {name}"}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    async def _run_agent(
        self, thread: List[Dict[str, Any]], collected: Dict[str, Any]
    ) -> str:
        for _ in range(MAX_TOOL_ROUNDS):
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=thread,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.7,
                max_tokens=1200,
            )
            message = response.choices[0].message

            if not message.tool_calls:
                return message.content or ""

            thread.append(
                {
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.function.name,
                                "arguments": tc.function.arguments,
                            },
                        }
                        for tc in message.tool_calls
                    ],
                }
            )

            for tc in message.tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = await self._execute_tool(tc.function.name, args, collected)
                thread.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(result)[:4000],
                    }
                )

        return (
            "I went back and forth on that one a few too many times and lost the thread. "
            "Could you rephrase it for me?"
        )

    def _fallback(self, message: str) -> Dict[str, Any]:
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
                    f"Today: {totals['calories']:.0f} / {targets['calories']:.0f} kcal, "
                    f"{totals['protein']:.0f} / {targets['protein']:.0f} g protein."
                )

        if re.search(DOC_INTENT, message, re.IGNORECASE):
            documents = self.reader.search(message, top_k=3)
            if documents:
                top = documents[0]
                parts.append(
                    f"From {top['document']} (page {top['page']}): \"{top['snippet']}\""
                )
            else:
                parts.append("No matching passages in your PDFs under sandbox/docs yet.")

        if not parts:
            totals = self.tracker.today_totals()
            targets = self.tracker.targets
            next_event = self.schedule.upcoming(1)
            when = next_event[0]["date"][:10] if next_event else "nothing scheduled"
            parts.append(
                "SAGE is running in offline mode right now (the Nemotron bridge is "
                f"unreachable), so I can only do the basics. Next event: {when}. "
                f"Macros today: {totals['calories']:.0f} / {targets['calories']:.0f} kcal, "
                f"{totals['protein']:.0f} / {targets['protein']:.0f} g protein."
            )

        return {
            "reply": "\n\n".join(parts),
            "state": self.build_state(documents),
        }

    async def process(
        self,
        messages: List[Dict[str, str]],
        conversation_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        thread_messages = [
            {"role": m["role"], "content": m["content"]}
            for m in messages
            if m.get("content")
        ]

        if self.client is None:
            result = self._fallback(thread_messages[-1]["content"])
        else:
            try:
                collected: Dict[str, Any] = {}
                thread = [{"role": "system", "content": self._system_prompt()}]
                thread.extend(thread_messages)
                reply = await self._run_agent(thread, collected)
                result = {"reply": reply, "state": self.build_state(collected.get("documents"))}
            except Exception as exc:
                result = self._fallback(thread_messages[-1]["content"])
                result["reply"] = (
                    f"(Offline mode — Nebius call failed: {exc})\n\n" + result["reply"]
                )

        result["conversation_id"] = conversation_id
        return result


sage_brain = SageBrain()
