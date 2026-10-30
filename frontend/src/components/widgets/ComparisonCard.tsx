"use client";

import WidgetCard from "./WidgetCard";

export default function ComparisonCard({
  widget,
  onDelete,
}: {
  widget: {
    id: string;
    title: string;
    primary_metric?: string;
    current?: string;
    previous?: string;
    delta?: string;
    subtext?: string;
  };
  onDelete: (id: string) => void;
}) {
  const delta = (widget.delta ?? "").trim();
  const positive = !delta.startsWith("-") && delta !== "";
  const badge = positive
    ? "border-emerald-300/30 bg-emerald-400/15 text-emerald-300"
    : "border-red-300/30 bg-red-400/15 text-red-300";
  return (
    <WidgetCard id={widget.id} title={widget.title} onDelete={onDelete}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-100">{widget.current}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{widget.previous}</p>
        </div>
        {delta && (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[11px] font-semibold ${badge}`}
          >
            {delta}
          </span>
        )}
      </div>
      {widget.subtext && (
        <p className="mt-2.5 border-t border-zinc-800 pt-2 text-[11px] leading-relaxed text-zinc-500">
          {widget.subtext}
        </p>
      )}
    </WidgetCard>
  );
}
