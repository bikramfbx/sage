"""Real end-to-end screen perception test: renders an assignment document
image (the exact course page text), runs TRUE local tesseract OCR through
POST /api/perceive, and verifies disk persistence + chat-history restore.

Run: venv/bin/python scripts/perception_e2e.py
"""

import base64
import io
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))

import urllib.request

from PIL import Image, ImageDraw, ImageFont

TITLE = "Assignment 3: Damped and Forced Oscillations"
DUE = "Due date: November 12, 2026, 5:00 PM. Submit through the course portal."

def render_assignment_image() -> bytes:
    img = Image.new("RGB", (1400, 500), "white")
    draw = ImageDraw.Draw(img)
    try:
        big = ImageFont.load_default(size=44)
        small = ImageFont.load_default(size=32)
    except TypeError:
        big = ImageFont.load_default()
        small = big
    draw.text((80, 60), "PHYS-210 Course Updates", font=big, fill="black")
    draw.text((80, 160), TITLE, font=big, fill="black")
    draw.text((80, 260), DUE, font=small, fill="black")
    draw.text((80, 340), "Bring your lab notebook to the review session.", font=small, fill="black")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

img_b64 = base64.b64encode(render_assignment_image()).decode()
print(f"rendered assignment frame: {len(img_b64)} base64 chars")

body = json.dumps({
    "image_base64": img_b64,
    "trigger_mode": "auto_scan",
    "subject_tag": "PHYS-210",
}).encode()

req = urllib.request.Request(
    "http://localhost:8001/api/perceive",
    data=body,
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=180) as resp:
    out = json.loads(resp.read())

print("STATUS:", out.get("status"))
print("LOG_LINE:", out.get("log_line"))
print("EVENT:", json.dumps(out.get("event") or {}, indent=2))
print("STATE SCHEDULE TOP:", [
    (e["title"], e["date"]) for e in (out.get("state") or {}).get("schedule", [])[:5]
])

fails = []

def check(name, cond, detail=""):
    print(("PASS " if cond else "FAIL ") + name, "" if cond else detail)
    if not cond:
        fails.append(name)

check("pipeline processed snap", out.get("status") in ("assignment_scheduled", "note_saved", "ignored"))

# 1) disk-sync: schedule.json contains the assignment, correctly dated
sched = json.loads((REPO_ROOT / "sandbox" / "state" / "schedule.json").read_text())
match = [e for e in sched if "Assignment 3" in e.get("title", "") and "2026-11-12" in e.get("date", "")]
check("schedule.json has Assignment 3 @ 2026-11-12", len(match) == 1, json.dumps(sched)[-400:])
log_line = out.get("log_line")

# 2) history restore: the perception bubble is in chat_history.json
hist = json.loads((REPO_ROOT / "sandbox" / "state" / "chat_history.json").read_text())
check("bubble persisted to chat_history", any(
    m.get("role") == "assistant" and m.get("content") == log_line for m in hist
), json.dumps(hist[-3:]))

# 3) GET /api/history serves it back (what a fresh page load does)
with urllib.request.urlopen("http://localhost:8001/api/history", timeout=10) as resp:
    served = json.loads(resp.read())
check("GET /api/history returns bubble", any(
    m.get("content") == log_line for m in served.get("messages", [])
))

# 4) sidebar restore: GET /api/state still shows the event after a "refresh"
with urllib.request.urlopen("http://localhost:8001/api/state", timeout=10) as resp:
    st = json.loads(resp.read())
check("GET /api/state shows assignment", any(
    "Assignment 3" in e.get("title", "") and "2026-11-12" in e.get("date", "")
    for e in st.get("schedule", [])
))

print()
print("perception persistence e2e:", "ALL PASS" if not fails else f"{len(fails)} FAILURES -> {fails}")
sys.exit(1 if fails else 0)
