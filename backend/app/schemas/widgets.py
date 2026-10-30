"""Schemas for the dynamic widget tracking system.

Four standard schema types are validated strictly; unknown types fall
back to base validation only so the registry stays extensible (new
widget kinds can be added frontend-side without backend changes).
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class WidgetBase(BaseModel):
    id: Optional[str] = Field(default=None, max_length=64)
    title: str = Field(min_length=1, max_length=80)
    type: str = Field(min_length=1, max_length=32)


class WidgetItem(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=120)


class ListWidget(WidgetBase):
    type: str = Field(frozen=True, pattern=r"^list$")
    items: List[WidgetItem] = Field(min_length=1, max_length=24)


class ComparisonWidget(WidgetBase):
    type: str = Field(frozen=True, pattern=r"^comparison$")
    primary_metric: str = Field(min_length=1, max_length=80)
    current: str = Field(min_length=1, max_length=120)
    previous: str = Field(min_length=1, max_length=120)
    delta: str = Field(min_length=1, max_length=60)
    subtext: Optional[str] = Field(default=None, max_length=200)


class ProgressWidget(WidgetBase):
    type: str = Field(frozen=True, pattern=r"^progress$")
    current_value: float = Field(ge=-1e9, le=1e9)
    target_value: float = Field(gt=0, le=1e9)
    unit: Optional[str] = Field(default=None, max_length=24)


class StatWidget(WidgetBase):
    type: str = Field(frozen=True, pattern=r"^stat$")
    value: str = Field(min_length=1, max_length=40)
    subtitle: Optional[str] = Field(default=None, max_length=120)


WIDGET_MODELS = {
    "list": ListWidget,
    "comparison": ComparisonWidget,
    "progress": ProgressWidget,
    "stat": StatWidget,
}


class WidgetEnvelope(BaseModel):
    widgets: List[dict] = Field(default_factory=list, max_length=64)
