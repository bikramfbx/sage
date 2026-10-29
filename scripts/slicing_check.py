"""Context-window slicing verification against the live backend.

Simulates exactly what the dashboard does on a >64-message thread:
unsliced payload (pre-fix behavior) vs history.slice(-50) (post-fix).
Run: venv/bin/python scripts/slicing_check.py
"""

import json
import urllib.error
import urllib.request

API = "http://127.0.0.1:8001/api/chat"

# 75-message thread (37 assistant turns + closing user message)
thread = []
for i in range(1, 38):
    thread.append({"role": "user", "content": f"study question {i}: what is point {i}?"})
    thread.append({"role": "assistant", "content": f"Point {i}: key concept {i}, remembered fine."})
thread.append({"role": "user", "content": "anyway, quick live check — one sentence please"})

def post(messages, timeout=120):
    body = json.dumps({"messages": messages}).encode()
    req = urllib.request.Request(API, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

status_full, body_full = post(thread)
print("unsliced (75 msgs) ->", status_full, "| detail:", str(body_full.get("detail"))[:90])

status_sliced, body_sliced = post(thread[-50:])
reply = (body_sliced or {}).get("reply", "")
print("sliced (-50)       ->", status_sliced, "| reply:", reply[:120])

ok = True
if status_full != 422:
    ok = False
    print("FAIL: oversized payload must still be rejected with 422")
if status_sliced != 200 or not reply:
    ok = False
    print("FAIL: sliced payload must succeed with a reply")

print("\nRESULT:", "PASS" if ok else "FAIL")
json.dump({"cleanup_needed": status_sliced == 200}, open("/tmp/opencode/_cleanup_flag.json", "w"))
