"""Screen Perception verification: local filtering, PII redaction,
assignment scheduling, note persistence, and zero-LLM gatekeeping.

Monkeypatches local OCR (no tesseract binary in this environment) so the
run is deterministic and costs only the LLM calls under test.

Run: venv/bin/python scripts/perception_checks.py
"""

import asyncio
import json
import base64
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "backend"))

from fastapi.testclient import TestClient

from app.main import app
from app.services.sage_brain import sage_brain
from skills import screen_perception as sp
from skills.screen_perception import redact, should_process

PASS, FAIL = [], []

def check(name, condition, detail=""):
    (PASS if condition else FAIL).append(name)
    print(("PASS" if condition else "FAIL"), name, "" if condition else detail)

# --- unit: PII + secret redaction ---------------------------------------------
dirty = "Ping prof.jane@univ.edu / +91 98765 43210, token ghp_abcDEF123ghiJKL456, k=deadbeefdeadbeefdeadbeefdeadbeef"
clean = redact(dirty)
check("email redacted", "prof.jane@univ.edu" not in clean and "redacted-email" in clean)
check("phone redacted", "98765 43210" not in clean and "redacted-phone" in clean)
check("api key redacted", "ghp_abcDEF123ghiJKL456" not in clean and "redacted-key" in clean)
check("hex blob redacted", "deadbeefdeadbeef" not in clean)

# --- unit: keyword gate --------------------------------------------------------
check("auto+keywords pass", should_process("assignment due Friday", "auto_scan") is not None)
check("auto non-study drops", should_process("cat minecraft stream", "auto_scan") is None)
check("manual always passes", should_process("cat minecraft stream", "manual_snap") == ["manual_snap"])

# --- e2e via API with OCR stubbed -------------------------------------------------
client = TestClient(app)
B64 = base64.b64encode(b"pretend-frame-bytes").decode()

doc_names = set()
calls = {"n": 0}
orig_analyze = sage_brain.screen_copilot.analyze

async def counting_analyze(text, tag, matched):
    calls["n"] += 1
    return await orig_analyze(text, tag, matched)

sage_brain.screen_copilot.analyze = counting_analyze

# 1) auto scan on non-study content: gatekeeper must drop it BEFORE the LLM
sp.run_ocr = lambda b64: "epic gaming montage highlights and memes, totally non study"
r = client.post("/api/perceive", json={"image_base64": B64, "trigger_mode": "auto_scan"})
body = r.json()
check("static/non-study ignored", r.status_code == 200 and body["status"] == "ignored"
      and body["reason"] == "no_keywords_matched", json.dumps(body))
check("zero LLM calls for ignored frame", calls["n"] == 0)

# 2) live LLM: assignment detection -> auto-scheduled
assignment_text = (
    "COURSE ANNOUNCEMENT  prof.amelia@univ.edu mail list\n"
    "CS-305 Distributed Systems OS Lab Report 2\n"
    "submission due date: November 6, 2026 23:59 via the course portal"
)
sp.run_ocr = lambda b64: assignment_text
r = client.post("/api/perceive", json={
    "image_base64": B64, "trigger_mode": "auto_scan", "subject_tag": "CS-305"
})
body = r.json()
check("assignment scheduled", body.get("status") == "assignment_scheduled", json.dumps(body)[:200])
ev = body.get("event") or {}
check("event has title+date", bool(ev.get("title")) and bool(ev.get("date")), str(ev))
check("state carries event", any("Lab Report" in (e.get("title") or "")
      for e in (body.get("state") or {}).get("schedule", [])))
check("schedule grew on disk", "CS-305" in json.dumps(
    json.loads((REPO_ROOT / "sandbox" / "state" / "schedule.json").read_text())))
created_event_title = ev.get("title", "")

# 3) live LLM: study note content -> markdown note under sandbox/docs/
notes_text = (
    "Lecture 12: vector clocks capture causality across replicas; each process "
    "keeps a vector counter, merges on receive. Review questions for the quiz; "
    "midterm scope: leader election, heartbeats, quorum math."
)
sp.run_ocr = lambda b64: notes_text
r = client.post("/api/perceive", json={"image_base64": B64, "trigger_mode": "auto_scan"})
body = r.json()
check("note saved", body.get("status") == "note_saved", json.dumps(body)[:200])
note_rel = (body.get("note") or {}).get("path", "")
note_path = REPO_ROOT / note_rel
check("note file exists", note_path.exists(), note_rel)
if note_path.exists():
    content = note_path.read_text()
    doc_names.add(note_path.name)
    check("note markdown structured", "# Auto note" in content and "## Raw redacted capture" in content)
    check("no PII persisted", "@univ.edu" not in content)

# 4) manual snap of non-study content still yields a usable note
sp.run_ocr = lambda b64: "random cat memes wallpaper   admin@fanclub.net posted"
r = client.post("/api/perceive", json={"image_base64": B64, "trigger_mode": "manual_snap"})
body = r.json()
check("manual snap produces artifact", body.get("status") == "note_saved", json.dumps(body)[:200])
manual_note = (body.get("note") or {}).get("path", "")
if manual_note:
    manual_path = REPO_ROOT / manual_note
    check("manual note redacted", "admin@fanclub.net" not in manual_path.read_text())
    manual_path.unlink(missing_ok=True)

# 5) frames never persist as images
imgs = [p.name for p in (REPO_ROOT / "sandbox" / "docs").glob("*")
        if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp")]
check("no raw frames on disk", imgs == [], str(imgs))

# --- cleanup test artifacts -----------------------------------------------------
sched_path = REPO_ROOT / "sandbox" / "state" / "schedule.json"
sched = json.loads(sched_path.read_text())
before = len(sched)
sched = [e for e in sched if created_event_title and e.get("title") != created_event_title]
sched_path.write_text(json.dumps(sched, indent=2))
print(f"\ncleanup: removed {before - len(sched)} test event(s)")
if note_path.exists() and note_path.name in doc_names:
    note_path.unlink(missing_ok=True)
    print("removed test note:", note_path.name)

print(f"\nperception checks: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    for f in FAIL:
        print(" -", f)
    sys.exit(1)
