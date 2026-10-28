"""Generate sample PDFs into sandbox/docs/ so rag_reader has content to index.

Builds minimal valid PDFs from scratch (no external deps) with correct
xref tables, then verifies they parse with pypdf.
"""

import json
from pathlib import Path

DOCS_DIR = Path(__file__).resolve().parent.parent / "sandbox" / "docs"


def _esc(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def build_pdf(pages: list) -> bytes:
    """pages: list of list-of-text-lines, one list per PDF page."""
    n = len(pages)
    page_nums = [4 + 2 * i for i in range(n)]
    content_nums = [5 + 2 * i for i in range(n)]
    objects = {
        1: f"<< /Type /Catalog /Pages 2 0 R >>",
        2: "<< /Type /Pages /Kids ["
        + " ".join(f"{p} 0 R" for p in page_nums)
        + f"] /Count {n} >>",
        3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    }
    for i, lines in enumerate(pages):
        pn, cn = page_nums[i], content_nums[i]
        objects[pn] = (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            "/Resources << /Font << /F1 3 0 R >> >> "
            f"/Contents {cn} 0 R >>"
        )
        stream_lines = ["BT", "/F1 11 Tf", "54 730 Td", "18 TL"]
        for line in lines:
            stream_lines.append(f"({_esc(line)}) Tj T*")
        stream_lines.append("ET")
        stream = "\n".join(stream_lines).encode("latin-1", "replace")
        objects[cn] = (
            b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n"
            + stream + b"\nendstream"
        )

    out = bytearray(b"%PDF-1.4\n")
    offsets = {}
    for num in sorted(objects):
        offsets[num] = len(out)
        body = objects[num]
        out += f"{num} 0 obj\n".encode()
        out += body if isinstance(body, bytes) else body.encode()
        out += b"\nendobj\n"

    max_num = max(offsets)
    xref_pos = len(out)
    out += f"xref\n0 {max_num + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for i in range(1, max_num + 1):
        out += f"{offsets.get(i, 0):010d} 00000 n \n".encode()
    out += (
        f"trailer\n<< /Size {max_num + 1} /Root 1 0 R >>\n"
        f"startxref\n{xref_pos}\n%%EOF"
    ).encode()
    return bytes(out)


COURSE_NOTES = [
    [
        "CS-302 Distributed Systems - Week 6 Lecture Notes",
        "",
        "Topic: Raft Consensus Algorithm",
        "",
        "Raft elects a single leader per term. Candidates request",
        "votes from peers and win with a majority quorum.",
        "Heartbeats flow from the leader to followers every",
        "100-300ms. If a follower misses heartbeats it starts a",
        "new election with an incremented term number.",
        "",
        "Log replication: the leader appends entries and replicates",
        "them to followers. An entry is committed once a majority",
        "acknowledge it. Commit index advances monotonically.",
    ],
    [
        "CS-302 Distributed Systems - Week 6 (continued)",
        "",
        "Topic: Vector Clocks and Causality",
        "",
        "Vector clocks capture causality across replicas. Each",
        "process maintains a vector of counters, incremented on",
        "local events and merged on message receipt.",
        "",
        "Exam hint: expect a question comparing Raft leader",
        "election with the failure detector approach in Paxos.",
        "Review the midterm scope page on the course site.",
    ],
]

NUTRITION_GUIDE = [
    [
        "SAGE Nutrition Reference Guide",
        "",
        "Daily macro targets for an active university student:",
        "approximately 2500 calories and 150 grams of protein",
        "distributed across 4 meals.",
        "",
        "Sample day plan:",
        "- Breakfast: oats with whey (~500 kcal, 35g protein)",
        "- Lunch: chicken rice bowl (~700 kcal, 45g protein)",
        "- Snack: greek yogurt and almonds (~400 kcal, 20g protein)",
        "- Dinner: paneer, dal, roti (~900 kcal, 50g protein)",
        "",
        "Keep protein within 30-40g per meal for optimal uptake.",
    ],
]

CALENDAR_SEED = [
    {
        "title": "CS-302 Distributed Systems midterm",
        "date": "2026-11-04T09:00:00",
        "location": "LT-5",
        "course": "CS-302",
    },
    {
        "title": "Nutrition check-in with campus coach",
        "date": "2026-10-30T16:30:00",
        "location": "Rec Center",
        "course": None,
    },
    {
        "title": "SAGE capstone sync",
        "date": "2026-11-11T14:00:00",
        "location": "Lab 2",
        "course": "CAPSTONE",
    },
]


def main():
    DOCS_DIR.mkdir(parents=True, exist_ok=True)

    notes_path = DOCS_DIR / "cs302_week6_lecture_notes.pdf"
    notes_path.write_bytes(build_pdf(COURSE_NOTES))

    nutrition_path = DOCS_DIR / "nutrition_reference_guide.pdf"
    nutrition_path.write_bytes(build_pdf([NUTRITION_GUIDE[0]]))

    calendar_path = (
        Path(__file__).resolve().parent.parent / "sandbox" / "calendar" / "events.json"
    )
    if not calendar_path.exists():
        calendar_path.parent.mkdir(parents=True, exist_ok=True)
        calendar_path.write_text(
            json.dumps(CALENDAR_SEED, indent=2), encoding="utf-8"
        )

    from pypdf import PdfReader

    for p in (notes_path, nutrition_path):
        n = len(PdfReader(str(p)).pages)
        print(f"OK {p.name}: {n} page(s)")


if __name__ == "__main__":
    main()
