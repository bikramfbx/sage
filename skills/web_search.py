"""Grounded web search for SAGE.

Fills the gap when the local library (rag_reader) has nothing relevant:
queries DuckDuckGo via the ddgs package and returns clean results with
title / href / body. Failures (rate limits, network errors, missing
package) degrade to an empty result list — SAGE then answers that it
cannot ground the query rather than hallucinating sources.
"""

import re
from typing import Any, Dict, List

def _sanitize(text: str, limit: int = 300) -> str:
    if not text:
        return ""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\s+", " ", text)
    return text.strip()[:limit]


def search_web(query: str, max_results: int = 3) -> List[Dict[str, Any]]:
    """Web search with graceful degradation. Never raises."""
    if not query or not query.strip():
        return []
    max_results = max(1, min(int(max_results), 8))
    try:
        try:
            from ddgs import DDGS
        except ImportError:
            from duckduckgo_search import DDGS  # legacy package name
        raw = DDGS().text(query.strip(), max_results=max_results) or []
    except Exception as exc:  # rate limit, network, backend issues
        return [{"error": f"web search unavailable: {str(exc)[:160]}"}]

    results = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        href = str(item.get("href") or item.get("url") or "")
        results.append({
            "title": _sanitize(str(item.get("title") or "")),
            "href": href[:300],
            "body": _sanitize(str(item.get("body") or item.get("snippet") or "")),
        })
    return results
