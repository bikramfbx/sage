"use client";

import WidgetCard from "./WidgetCard";

export default function StatCard({
  widget,
  onDelete,
}: {
  widget: { id: string; title: string; value?: string; subtitle?: string };
  onDelete: (id: string) => void;
}) {
  return (
    <WidgetCard id={widget.id} title={widget.title} onDelete={onDelete}>
      <p className="text-2xl font-semibold tracking-tight text-zinc-50">{widget.value}</p>
      {widget.subtitle && (
        <p className="mt-1 text-[11px] text-zinc-500">{widget.subtitle}</p>
      )}
    </WidgetCard>
  );
}
