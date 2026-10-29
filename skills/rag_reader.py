"""RAG reader skill for SAGE.

Indexes PDF documents AND auto-generated Markdown notes stored in
sandbox/docs/ and returns the most relevant page/text snippets for a
query. Uses pypdf for PDF extraction and a lightweight keyword scoring
pass instead of embeddings.

When wired with a schedule provider, the reader also scores upcoming
events from sandbox/state/schedule.json so schedule-only answers (e.g.
"assignment 3") surface even without a note in the library. Fresh files
appearing in docs/ (perceive notes) are picked up automatically on the
next query via mtime-keyed caching.
"""

import re
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from pypdf import PdfReader

from skills.sandbox_guard import assert_in_sandbox

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DOCS_DIR = REPO_ROOT / "sandbox" / "docs"

INDEXED_SUFFIXES = (".pdf", ".md")

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def sanitize_pdf_text(text: str, limit: int = 1200) -> str:
    """Neutralize extracted document text before it reaches the LLM.

    Strips control characters, HTML-escapes angle brackets and ampersands
    so injected markup (fake tool tags, prompt delimiters) cannot be
    mistaken for conversation structure, and clamps length.
    """
    text = _CONTROL_RE.sub(" ", text or "")
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()[:limit]

_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "do", "does", "did",
    "my", "our", "your", "of", "in", "on", "for", "to", "and", "or",
    "what", "when", "where", "which", "who", "how", "why", "about",
    "say", "says", "said", "tell", "show", "find", "from", "with",
    "me", "i", "it", "its", "be", "can", "will", "that", "this",
}


class RagReader:
    def __init__(
        self,
        docs_dir: Path = DEFAULT_DOCS_DIR,
        schedule_provider: Optional[Callable[[], List[Dict[str, Any]]]] = None,
    ):
        self.docs_dir = assert_in_sandbox(docs_dir)
        self.schedule_provider = schedule_provider
        self._cache: Dict[str, tuple[float, List[str]]] = {}

    def invalidate(self) -> None:
        """Drop cached extractions (used right after a new note is saved)."""
        self._cache.clear()

    def _indexed_files(self) -> List[Path]:
        if not self.docs_dir.exists():
            return []
        files: List[Path] = []
        for suffix in INDEXED_SUFFIXES:
            files.extend(self.docs_dir.glob(f"*{suffix}"))
        return sorted(set(files))

    def _page_texts(self, path: Path) -> List[str]:
        path = assert_in_sandbox(path, root=self.docs_dir)
        mtime = path.stat().st_mtime
        cached = self._cache.get(path.name)
        if cached and cached[0] == mtime:
            return cached[1]
        if path.suffix.lower() == ".pdf":
            reader = PdfReader(str(path))
            pages = []
            for page in reader.pages:
                try:
                    pages.append(page.extract_text() or "")
                except Exception:
                    pages.append("")
        else:
            # markdown notes: whole file is one chunk (page None); drop the
            # capture boilerplate so snippets surface the actual content
            try:
                body_lines = [
                    line for line in path.read_text(encoding="utf-8").splitlines()
                    if not re.match(
                        r"^\s*(# Auto note|- Subject:|- Trigger keywords:"
                        r"|- Source:|## Raw redacted capture|```)",
                        line,
                    )
                ]
                pages = ["\n".join(body_lines)]
            except OSError:
                pages = [""]
        self._cache[path.name] = (mtime, pages)
        return pages

    def list_documents(self) -> List[str]:
        return sorted(p.name for p in self._indexed_files())

    def _schedule_hits(self, tokens: List[str]) -> List[Dict[str, Any]]:
        if not self.schedule_provider:
            return []
        try:
            events = self.schedule_provider() or []
        except Exception:
            return []
        hits = []
        for event in events:
            lines = [
                str(event.get("title") or ""),
                str(event.get("date") or "")[:16],
                str(event.get("location") or ""),
                str(event.get("course") or ""),
            ]
            text = " — ".join(line for line in lines if line)
            lowered = text.lower()
            score = sum(lowered.count(t) for t in tokens)
            if score:
                hits.append({
                    "document": "sandbox/state/schedule.json",
                    "page": None,
                    "snippet": f"Scheduled: {RagReader._snippet(sanitize_pdf_text(text), tokens, width=380)}",
                    "score": score * 2,  # own data; slight boost so the
                    # schedule surfaces alongside note hits
                })
        return hits

    def search(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Score every indexed document (and schedule entries) against
        the query. New notes are picked up automatically on each call."""
        tokens = [
            t for t in re.findall(r"[a-z0-9]+", query.lower())
            if t not in _STOPWORDS and len(t) > 2
        ]
        if not tokens:
            return []

        results: List[Dict[str, Any]] = []
        for path in self._indexed_files():
            try:
                pages = self._page_texts(path)
            except Exception:
                continue
            for chunk_num, text in enumerate(pages, start=1):
                lowered = text.lower()
                score = sum(lowered.count(t) for t in tokens)
                if score == 0:
                    continue
                is_md = path.suffix.lower() != ".pdf"
                snippet = RagReader._snippet(
                    sanitize_pdf_text(text), tokens, width=380 if is_md else 180
                )
                page = chunk_num if not is_md else None
                results.append({
                    "document": path.name,
                    "page": page,
                    "snippet": snippet,
                    "score": score,
                })

        results.extend(self._schedule_hits(tokens))
        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:top_k]

    @staticmethod
    def _snippet(text: str, tokens: List[str], width: int = 180) -> str:
        compact = re.sub(r"\s+", " ", text).strip()
        lowered = compact.lower()
        best_idx = -1
        for token in tokens:
            lowered_token = token.lower()
            idx = lowered.find(lowered_token)
            if idx != -1 and (best_idx == -1 or idx < best_idx):
                best_idx = idx
        if best_idx == -1:
            return compact[:width]
        start = max(0, best_idx - width // 3)
        end = min(len(compact), start + width)
        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(compact) else ""
        return f"{prefix}{compact[start:end]}{suffix}"
