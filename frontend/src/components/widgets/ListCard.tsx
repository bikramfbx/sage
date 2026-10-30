"use client";

import WidgetCard from "./WidgetCard";

type Item = { label: string; value: string };

export default function ListCard({
  widget,
  onDelete,
}: {
  widget: { id: string; title: string; items?: Item[] };
  onDelete: (id: string) => void;
}) {
  return (
    <WidgetCard id={widget.id} title={widget.title} onDelete={onDelete}>
      <ul className="flex flex-col gap-2">
        {(widget.items ?? []).map((it, i) => (
          <li key={i} className="flex items-center justify-between gap-3">
            <span className="truncate text-xs text-zinc-300">{it.label}</span>
            <span className="shrink-0 rounded-md border border-zinc-800 bg-white/[0.05] px-2 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[11px] text-zinc-100">
              {it.value}
            </span>
          </li>
        ))}
      </ul>
    </WidgetCard>
  );
}
