"""Persistent chat memory for SAGE.

Stores every turn in sandbox/state/chat_history.json and folds older
turns into a compressed summary kept in sandbox/state/context_summary.json
via a Nemotron call once the raw log grows past the threshold. The
summary is injected into the system prompt as [Prior Session Memory]
while only the recent turns are replayed verbatim.
"""

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

COMPRESS_THRESHOLD_TURNS = 10
KEEP_TURNS_VERBATIM = 5


class MemoryManager:
    def __init__(self, state_dir):
        self.state_dir = state_dir
        self.history_path = state_dir / "chat_history.json"
        self.summary_path = state_dir / "context_summary.json"

    def messages(self) -> List[Dict[str, Any]]:
        if not self.history_path.exists():
            return []
        try:
            return json.loads(self.history_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []

    def _save_messages(self, messages: List[Dict[str, Any]]) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.history_path.write_text(
            json.dumps(messages, indent=2), encoding="utf-8"
        )

    def summary_info(self) -> Dict[str, Any]:
        if not self.summary_path.exists():
            return {"summary": "", "compressed_count": 0}
        try:
            return json.loads(self.summary_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {"summary": "", "compressed_count": 0}

    def _save_summary(self, summary: str, compressed_count: int) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.summary_path.write_text(
            json.dumps(
                {"summary": summary, "compressed_count": compressed_count},
                indent=2,
            ),
            encoding="utf-8",
        )

    def merge_incoming(self, incoming: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Persist only messages not already stored (clients replay the
        full session history on every request).

        Alignment strategy: exact prefix match first (normal replay), then a
        best-effort contiguous match of the incoming sequence against the
        recent tail of the stored log, so a client holding a partially
        divergent view can't duplicate turns wholesale.
        """
        stored = self.messages()

        def _bare(m):
            return {"role": m.get("role"), "content": m.get("content")}

        stored_bare = [_bare(m) for m in stored]
        incoming_bare = [_bare(m) for m in incoming]

        match = 0
        for s, i in zip(stored_bare, incoming_bare):
            if s == i:
                match += 1
            else:
                break

        if match < len(incoming) and match == 0 and stored_bare:
            # try to find the incoming sequence inside the recent stored tail
            best = 0
            limit = max(0, len(stored_bare) - 60)
            for start in range(len(stored_bare) - 1, limit - 1, -1):
                overlap = 0
                for s, i in zip(stored_bare[start:], incoming_bare):
                    if s == i:
                        overlap += 1
                    else:
                        break
                if overlap > best:
                    best = overlap
            match = best

        new_messages = incoming[match:]
        if new_messages:
            stamp = datetime.now().isoformat(timespec="seconds")
            for m in new_messages:
                stored.append(
                    {
                        "role": m.get("role", "user"),
                        "content": m.get("content", ""),
                        "time": stamp,
                    }
                )
            self._save_messages(stored)
        return new_messages

    def append(self, role: str, content: str) -> None:
        stored = self.messages()
        stored.append(
            {
                "role": role,
                "content": content,
                "time": datetime.now().isoformat(timespec="seconds"),
            }
        )
        self._save_messages(stored)

    def client_view(self) -> List[Dict[str, Any]]:
        return [
            {"role": m["role"], "content": m["content"]} for m in self.messages()
        ]

    def active_window(self, keep_messages: Optional[int] = None) -> List[Dict[str, Any]]:
        """Verbatim messages not yet folded into the summary."""
        info = self.summary_info()
        covered = info.get("compressed_count", 0)
        msgs = self.messages()
        window = msgs[covered:]
        if keep_messages is not None and len(window) > keep_messages:
            window = window[-keep_messages:]
        return window

    def clear(self) -> None:
        self._save_messages([])
        self._save_summary("", 0)

    async def maybe_compress(
        self, client, model: str,
        threshold_turns: int = COMPRESS_THRESHOLD_TURNS,
        keep_turns: int = KEEP_TURNS_VERBATIM,
    ) -> bool:
        """Compress older turns into the summary once the active region
        exceeds `threshold_turns` assistant turns. Returns True if a
        compression run happened."""
        if client is None:
            return False
        info = self.summary_info()
        covered = info.get("compressed_count", 0)
        msgs = self.messages()
        active = msgs[covered:]

        assistant_positions = [
            i for i, m in enumerate(active) if m.get("role") == "assistant"
        ]
        turn_count = len(assistant_positions)
        if turn_count <= threshold_turns:
            return False

        # keep the last `keep_turns` user+assistant pairs verbatim
        cutoff_exclusive = assistant_positions[-keep_turns]
        older = active[:cutoff_exclusive]
        if not older:
            return False

        transcript = "\n".join(
            f"{m.get('role', 'user')}: {m.get('content', '')}"[:600]
            for m in older
        )
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Summarize this SAGE conversation excerpt into a "
                            "concise memory note the assistant can use later: "
                            "facts about the student, meals logged with numbers, "
                            "events added or changed, corrections, decisions, "
                            "open threads. Reply with the summary text only, "
                            "under 120 words."
                        ),
                    },
                    {"role": "user", "content": transcript[:8000]},
                ],
                temperature=0.3,
                max_tokens=300,
            )
            new_summary = (response.choices[0].message.content or "").strip()
        except Exception:
            return False
        if not new_summary:
            return False

        existing = info.get("summary", "")
        combined = (
            f"{existing}\n{new_summary}".strip() if existing else new_summary
        )
        total_covered = covered + len(older)
        self._save_summary(combined, total_covered)
        return True
