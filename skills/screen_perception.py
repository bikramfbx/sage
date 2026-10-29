"""Screen perception skill for SAGE.

Privacy-first local pipeline: OCR runs entirely on-device (pytesseract +
Pillow, no network), extracted text is redacted for PII/secrets, and a
keyword gatekeeper decides whether the text is study-relevant at all.
Raw frames only ever exist in memory — nothing is persisted before
redaction and gating.

When the tesseract binary is unavailable the module degrades cleanly:
run_ocr raises OcrUnavailable so callers can surface an explicit status
instead of silently shipping pixels anywhere.
"""

import io
import re
import shutil
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

TRIGGER_KEYWORDS = [
    "assignment", "due date", "due", "submission", "quiz", "homework",
    "exam", "midterm", "final", "syllabus", "lecture", "deadline",
    "announce", "lab report", "problem set", "office hours",
]

_PII_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PII_PHONE = re.compile(
    r"(\+\d{1,3}[\s.-]?\d[\d\s.-]{6,14}\d\b"      # +91 98765 43210 / +1 555 294 1334
    r"|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b"            # 555-294-1334
    r"|\(\d{3}\)\s?\d{3}[\s.-]?\d{4}\b"            # (555) 294-1334
    r"|\b(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b)"  # 98765 43210 / 9876543210
)
_PII_API_KEY = re.compile(
    r"(?:\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b"
    r"|\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_-]{8,}\b"
    r"|\b(?:AKIA|xox[bpae]|AIza)[A-Za-z0-9_-]{8,}\b"
    r"|\b[A-Fa-f0-9]{32,64}\b"
    r"|\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)"
)
_PII_URL_CRED = re.compile(r"(https?://)([A-Za-z0-9._%+-]+):([^@\s]{3,})@")

_REDACTED_EMAIL = "[redacted-email]"
_REDACTED_PHONE = "[redacted-phone]"
_REDACTED_KEY = "[redacted-key]"


class OcrUnavailable(RuntimeError):
    pass


def ocr_available() -> bool:
    if shutil.which("tesseract") is None:
        return False
    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
    except ImportError:
        return False
    return True


def run_ocr(image_base64: str) -> str:
    """Decode an in-memory frame and OCR it locally. Never writes to disk."""
    import base64

    if not ocr_available():
        raise OcrUnavailable("tesseract/python bindings are not installed")
    try:
        raw = base64.b64decode(image_base64, validate=True)
    except Exception as exc:
        raise ValueError(f"image_base64 is not valid base64: {exc}")

    from PIL import Image, ImageOps
    import pytesseract

    try:
        frame = Image.open(io.BytesIO(raw))
        frame = ImageOps.exif_transpose(frame).convert("L")
    except Exception as exc:
        raise ValueError(f"unsupported or corrupt image payload: {exc}")
    try:
        return pytesseract.image_to_string(frame) or ""
    except Exception as exc:
        raise OcrUnavailable(f"local OCR failed: {exc}")


def redact(text: str) -> str:
    """Remove emails, phone numbers, API keys, and URL credentials."""
    text = _PII_URL_CRED.sub(r"\1[redacted-url-credentials]@", text)
    text = _PII_API_KEY.sub(_REDACTED_KEY, text)
    text = _PII_EMAIL.sub(_REDACTED_EMAIL, text)
    text = _PII_PHONE.sub(_REDACTED_PHONE, text)
    return text


def matched_keywords(text: str, keywords: Optional[List[str]] = None) -> List[str]:
    hits = []
    lowered = (text or "").lower()
    for keyword in (keywords or TRIGGER_KEYWORDS):
        if keyword.lower() in lowered:
            hits.append(keyword)
    return hits


def should_process(
    text: str,
    trigger_mode: str,
    keywords: Optional[List[str]] = None,
) -> Optional[List[str]]:
    """Gatekeeper: manual snaps always pass; auto scans need a keyword.

    Returns matched keywords to carry into the LLM call, or None when the
    frame must be dropped locally (never calling the LLM).
    """
    if trigger_mode == "manual_snap":
        return matched_keywords(text, keywords) or ["manual_snap"]
    if trigger_mode != "auto_scan":
        raise ValueError(f"unknown trigger_mode: {trigger_mode}")
    hits = matched_keywords(text, keywords)
    return hits or None


def build_note_markdown(
    redacted_text: str,
    subject_tag: Optional[str],
    matched: List[str],
    llm_markdown: Optional[str] = None,
) -> str:
    now = datetime.now()
    lines = [
        f"# Auto note — {now.strftime('%Y-%m-%d %H:%M')}",
        "",
        f"- Subject: {subject_tag or 'general'}",
        f"- Trigger keywords: {', '.join(matched) if matched else 'manual snap'}",
        f"- Source: screen capture (OCR, redacted; frame not persisted)",
        "",
    ]
    if llm_markdown:
        lines += [llm_markdown.strip(), "", "---", ""]
    lines += ["## Raw redacted capture", "", "```", redacted_text.strip()[:2000], "```", ""]
    return "\n".join(lines)


def default_note_path(now: Optional[datetime] = None) -> str:
    stamp = (now or datetime.now()).strftime("%Y%m%d_%H%M%S")
    return f"docs/auto_notes_{stamp}.md"


def deadline_hint(text: str) -> Optional[str]:
    """Best-effort regex date scan used only as LLM-verifier fallback."""
    month = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})"
    match = re.search(month, text.lower())
    if match:
        today = datetime.now()
        candidate = datetime.strptime(
            f"{match.group(1)[:3]} {match.group(2)}", "%b %d"
        ).replace(year=today.year)
        if candidate < today - timedelta(days=1):
            candidate = candidate.replace(year=today.year + 1)
        return candidate.isoformat(timespec="seconds")
    return None
