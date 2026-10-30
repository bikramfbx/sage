import type { FC } from "react";

import ComparisonCard from "./ComparisonCard";
import FallbackCard from "./FallbackCard";
import ListCard from "./ListCard";
import ProgressCard from "./ProgressCard";
import StatCard from "./StatCard";

export type WidgetData = {
  id: string;
  title: string;
  type: string;
  [key: string]: unknown;
};

export type WidgetProps = {
  widget: WidgetData;
  onDelete: (id: string) => void;
};

export const WIDGET_REGISTRY: Record<string, FC<WidgetProps>> = {
  list: ListCard,
  comparison: ComparisonCard,
  progress: ProgressCard,
  stat: StatCard,
};

export function resolveWidget(type: string): FC<WidgetProps> {
  return WIDGET_REGISTRY[type] ?? FallbackCard;
}

export { FallbackCard };
