"use client";

import WidgetCard from "./WidgetCard";

export default function FallbackCard({
  widget,
  onDelete,
}: {
  widget: { id: string; title: string; type?: string };
  onDelete: (id: string) => void;
}) {
  return (
    <WidgetCard id={widget.id} title={widget.title} onDelete={onDelete}>
      <p className="text-xs text-zinc-500">
        Custom tracker <span className="text-zinc-400">({widget.type})</span> — no renderer
        registered yet.
      </p>
    </WidgetCard>
  );
}
