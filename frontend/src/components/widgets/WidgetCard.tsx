"use client";

// shared shell for all widget cards: dark-glass panel + delete control
export default function WidgetCard({
  title,
  children,
  onDelete,
  id,
}: {
  title: string;
  children: React.ReactNode;
  onDelete: (id: string) => void;
  id: string;
}) {
  return (
    <div className="group relative bg-zinc-900/80 border border-zinc-800 rounded-xl p-4">
      <button
        onClick={() => onDelete(id)}
        title="Remove widget"
        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg text-[11px] text-zinc-600 opacity-0 transition-all hover:bg-white/[0.06] hover:text-zinc-200 group-hover:opacity-100"
      >
        ✕
      </button>
      <h3 className="font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.24em] text-zinc-400 pr-6">
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}
