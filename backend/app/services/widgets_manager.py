"""Widget store: persistence + validation for dynamic sidebar widgets.

State lives in sandbox/state/widgets.json as {"widgets": [...]}. Upserts
match on the widget id (slug); new widgets append. Unknown types are
stored with base validation only so the frontend registry can grow
without backend changes.
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from skills.sandbox_guard import assert_in_sandbox

from app.schemas.widgets import WIDGET_MODELS, WidgetBase

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_PATH = REPO_ROOT / "sandbox" / "state" / "widgets.json"

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str) -> str:
    slug = _SLUG_RE.sub("-", str(text).strip().lower()).strip("-")
    return slug[:48] or "widget"


def _ensure(path: Path) -> Path:
    path = assert_in_sandbox(path)
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"widgets": []}), encoding="utf-8")
    return path


def read(path: Path = DEFAULT_PATH) -> List[Dict[str, Any]]:
    try:
        data = json.loads(_ensure(path).read_text(encoding="utf-8"))
        widgets = data.get("widgets", [])
        return widgets if isinstance(widgets, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _write(widgets: List[Dict[str, Any]], path: Path) -> None:
    _ensure(path).write_text(
        json.dumps({"widgets": widgets}, indent=2), encoding="utf-8"
    )


def validate(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Validate a widget payload; raises ValueError on bad input."""
    if not isinstance(payload, dict):
        raise ValueError("widget payload must be an object")
    model = WIDGET_MODELS.get(str(payload.get("type", "")).strip().lower())
    if model is not None:
        validated = model.model_validate(payload).model_dump(exclude_none=True)
    else:
        # unknown type: base validation only (forward compatibility)
        validated = WidgetBase.model_validate(payload).model_dump(exclude_none=True)
    if not validated.get("id"):
        validated["id"] = _slugify(validated["title"])
    validated["id"] = _slugify(validated["id"])
    return validated


def build_from_tool_args(args: Dict[str, Any]) -> Dict[str, Any]:
    """Assemble a widget payload from update_user_widget tool arguments,
    keeping only the fields relevant to the chosen schema type."""
    kind = str(args.get("widget_type", "")).strip().lower()
    widget: Dict[str, Any] = {
        "title": str(args.get("title", "Tracker")).strip()[:80],
        "type": kind,
    }
    if args.get("widget_id"):
        widget["id"] = str(args["widget_id"])
    if kind == "list":
        items = []
        for item in args.get("items") or []:
            if isinstance(item, dict) and item.get("label"):
                items.append({
                    "label": str(item["label"])[:120],
                    "value": str(item.get("value", ""))[:120],
                })
        widget["items"] = items or [{"label": "Item 1", "value": "-"}]
    elif kind == "comparison":
        widget["primary_metric"] = str(args.get("primary_metric") or widget["title"])[:80]
        widget["current"] = str(args.get("current", ""))[:120]
        widget["previous"] = str(args.get("previous", ""))[:120]
        widget["delta"] = str(args.get("delta", ""))[:60]
        if args.get("subtext"):
            widget["subtext"] = str(args["subtext"])[:200]
    elif kind == "progress":
        try:
            widget["current_value"] = float(args.get("current_value") or 0)
        except (TypeError, ValueError):
            widget["current_value"] = 0
        try:
            widget["target_value"] = float(args.get("target_value") or 0)
        except (TypeError, ValueError):
            widget["target_value"] = 1
        if widget["target_value"] <= 0:
            widget["target_value"] = 1
        if args.get("unit"):
            widget["unit"] = str(args["unit"])[:24]
    elif kind == "stat":
        widget["value"] = str(args.get("value", ""))[:40]
        if args.get("subtitle"):
            widget["subtitle"] = str(args["subtitle"])[:120]
    return widget


def upsert(widget: Dict[str, Any], path: Path = DEFAULT_PATH) -> Dict[str, Any]:
    widget = validate(widget)
    widgets = read(path)
    for i, existing in enumerate(widgets):
        if existing.get("id") == widget["id"]:
            widgets[i] = widget
            _write(widgets, path)
            return widget
    widgets.append(widget)
    if len(widgets) > 64:
        widgets = widgets[-64:]
    _write(widgets, path)
    return widget


def delete(widget_id: str, path: Path = DEFAULT_PATH) -> bool:
    wanted = _slugify(widget_id)
    widgets = read(path)
    remaining = [w for w in widgets if w.get("id") != wanted]
    if len(remaining) == len(widgets):
        return False
    _write(remaining, path)
    return True
