"""RAG-style PDF reader skill for SAGE.

Indexes PDF documents stored in sandbox/docs/ and returns the most
relevant page snippets for a query. Uses pypdf for extraction and a
lightweight keyword scoring pass instead of embeddings.
"""

import re
import time
from pathlib import Path
from typing import Any, Dict, List

from pypdf import PdfReader

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DOCS_DIR = REPO_ROOT / "sandbox" / "docs"

_STOPWORDS = {
    "the", "a", "an", "is", "are", "was", "were", "do", "does", "did",
    "my", "our", "your", "of", "in", "on", "for", "to", "and", "or",
    "what", "when", "where", "which", "who", "how", "why", "about",
    "say", "says", "said", "tell", "show", "find", "from", "with",
    "me", "i", "it", "its", "be", "can", "will", "that", "this",
}


class RagReader:
    def __init__(self, docs_dir: Path = DEFAULT_DOCS_DIR):
        self.docs_dir = Path(docs_dir)
        self._cache: Dict[str, tuple[float, List[str]]] = {}

    def _page_texts(self, path: Path) -> List[str]:
        mtime = path.stat().st_mtime
        cached = self._cache.get(path.name)
        if cached and cached[0] == mtime:
            return cached[1]
        reader = PdfReader(str(path))
        pages = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                pages.append("")
        self._cache[path.name] = (mtime, pages)
        return pages

    def list_documents(self) -> List[str]:
        if not self.docs_dir.exists():
            return []
        return sorted(p.name for p in self.docs_dir.glob("*.pdf"))

    def search(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Score every page of every indexed PDF against the query."""
        tokens = [
            t for t in re.findall(r"[a-z0-9]+", query.lower())
            if t not in _STOPWORDS and len(t) > 2
        ]
        if not tokens:
            return []

        results: List[Dict[str, Any]] = []
        for path in self.docs_dir.glob("*.pdf"):
            try:
                pages = self._page_texts(path)
            except Exception:
                continue
            for page_num, text in enumerate(pages, start=1):
                lowered = text.lower()
                score = sum(lowered.count(t) for t in tokens)
                if score == 0:
                    continue
                snippet = self._snippet(text, tokens)
                results.append({
                    "document": path.name,
                    "page": page_num,
                    "snippet": snippet,
                    "score": score,
                })

        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:top_k]

    @staticmethod
    def _snippet(text: str, tokens: List[str], width: int = 180) -> str:
        compact = re.sub(r"\s+", " ", text).strip()
        lowered = compact.lower()
        best_idx = -1
        for token in tokens:
            idx = lowered.find(token)
            if idx != -1 and (best_idx == -1 or idx < best_idx):
                best_idx = idx
        if best_idx == -1:
            return compact[:width]
        start = max(0, best_idx - width // 3)
        end = min(len(compact), start + width)
        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(compact) else ""
        return f"{prefix}{compact[start:end]}{suffix}"
