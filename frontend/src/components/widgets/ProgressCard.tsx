"use client";

import WidgetCard from "./WidgetCard";

export default function ProgressCard({
  widget,
  onDelete,
}: {
  widget: {
    id: string;
    title: string;
    current_value?: number;
    target_value?: number;
    unit?: string;
  };
  onDelete: (id: string) => void;
}) {
  const current = widget.current_value ?? 0;
  const target = widget.target_value ?? 1;
  const pct = Math.max(0, Math.min(100, Math.round((current / (target || 1)) * 100)));
  const unit = widget.unit ? ` ${widget.unit}` : "";
  return (
    <WidgetCard id={widget.id} title={widget.title} onDelete={onDelete}>
      <div className="flex items-baseline justify-between">
        <span className="font-[family-name:var(--font-mono,ui-monospace)] text-lg font-semibold text-zinc-100">
          {current}
          <span className="text-xs font-normal text-zinc-500"> / {target}{unit}</span>
        </span>
        <span className="font-[family-name:var(--font-mono,ui-monospace)] text-[11px] text-emerald-300">
          {pct}%
        </span>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-white/[0.07]">
        <div
          className="h-full rounded-full bg-emerald-300 transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </WidgetCard>
  );
}
