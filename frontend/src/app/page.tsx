"use client";

import { useEffect, useRef, useState } from "react";

const API = "http://localhost:8001";

type MacroEntry = { label: string; calories: number; protein: number; time: string };
type MacrosState = {
  date: string;
  totals: { calories: number; protein: number };
  targets: { calories: number; protein: number };
  entries: MacroEntry[];
};
type ScheduleEvent = {
  title: string;
  date: string;
  location: string | null;
  course: string | null;
};
type DocumentRef = { document: string; page: number | null; snippet: string | null };
type AgentState = {
  macros: MacrosState;
  schedule: ScheduleEvent[];
  documents: DocumentRef[];
};
type ChatMsg = {
  role: "user" | "assistant" | "system";
  content: string;
  documents?: DocumentRef[];
};

const EMPTY_STATE: AgentState = {
  macros: {
    date: "",
    totals: { calories: 0, protein: 0 },
    targets: { calories: 2500, protein: 150 },
    entries: [],
  },
  schedule: [],
  documents: [],
};

function ProgressBar({
  value,
  max,
  label,
  unit,
  barClass,
}: {
  value: number;
  max: number;
  label: string;
  unit: string;
  barClass: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-mono text-zinc-300">
          {Math.round(value)} <span className="text-zinc-500">/ {Math.round(max)} {unit}</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-right font-mono text-[10px] text-zinc-600">
        {pct.toFixed(0)}%
      </div>
    </div>
  );
}

function formatEventDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [state, setState] = useState<AgentState>(EMPTY_STATE);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/api/state`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((s: AgentState) => {
        setState(s);
        setOnline(true);
      })
      .catch(() => setOnline(false));

    fetch(`${API}/api/history`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((h) => {
        if (Array.isArray(h.messages)) {
          setMessages(h.messages.map((m: { role: "user" | "assistant" | "system"; content: string }) => ({ role: m.role, content: m.content })));
        }
      })
      .catch(() => {});
  }, []);

  async function clearHistory() {
    try {
      await fetch(`${API}/api/history`, { method: "DELETE" });
    } catch {}
    setMessages([]);
  }

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const history: { role: "user" | "assistant" | "system"; content: string }[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: "user", content: text },
    ];
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);
    try {
      const r = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const data = await r.json();
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply, documents: data.state?.documents ?? [] },
      ]);
      if (data.state) setState(data.state);
      setOnline(true);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Cannot reach the SAGE backend on " + API + ". Is uvicorn running?",
        },
      ]);
      setOnline(false);
    } finally {
      setSending(false);
    }
  }

  const macros = state.macros;

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800 px-5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold tracking-widest text-emerald-400">
            SAGE
          </span>
          <span className="text-xs text-zinc-500">
            Student Assistant for Growth and Education
          </span>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs text-zinc-500">
          <span className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                online === null
                  ? "animate-pulse bg-zinc-500"
                  : online
                    ? "bg-emerald-400"
                    : "bg-red-500"
              }`}
            />
            {online === null
              ? "connecting"
              : online
                ? "backend online :8001"
                : "backend offline"}
          </span>
          <button
            onClick={clearHistory}
            title="Clear chat history and start a fresh session"
            className="rounded-lg border border-zinc-800 px-2.5 py-1 text-xs text-zinc-400 transition-colors hover:border-red-500/60 hover:text-red-400"
          >
            Clear History
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col border-r border-zinc-800">
          <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-5">
            {messages.length === 0 && (
              <div className="mt-24 text-center">
                <p className="font-mono text-2xl text-zinc-700">$ ask sage_</p>
                <p className="mt-3 text-sm text-zinc-500">
                  Log a meal: &quot;ate 600 kcal with 40g protein chicken rice&quot;
                  <br />
                  or search your notes: &quot;what do my lecture notes say about raft?&quot;
                </p>
              </div>
            )}
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                  <div
                    className={
                      m.role === "user"
                        ? "max-w-[80%] rounded-2xl rounded-br-sm bg-emerald-600/90 px-4 py-2.5 text-sm text-white"
                        : "max-w-[85%] rounded-2xl rounded-bl-sm border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm text-zinc-200"
                    }
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.role === "assistant" && m.documents && m.documents.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-zinc-800 pt-2">
                        {m.documents.map((d, j) => (
                          <span
                            key={j}
                            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400"
                          >
                            {d.document}
                            {d.page ? `:p${d.page}` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex items-center gap-2.5 px-1">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-400 [animation-delay:300ms]" />
                  </div>
                  <span className="font-mono text-xs text-zinc-600">
                    sage is thinking
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 border-t border-zinc-800 p-4">
            <div className="mx-auto flex max-w-2xl gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Message SAGE…"
                className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-emerald-500/60"
              />
              <button
                onClick={send}
                disabled={sending || !input.trim()}
                className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </div>
        </main>

        <aside className="hidden w-80 shrink-0 flex-col gap-4 overflow-y-auto bg-zinc-950 p-4 lg:flex">
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-zinc-500">
              Macro Tracker
              <span className="float-right normal-case text-zinc-600">{macros.date}</span>
            </h2>
            <div className="flex flex-col gap-4">
              <ProgressBar
                label="Calories"
                unit="kcal"
                value={macros.totals.calories}
                max={macros.targets.calories}
                barClass="bg-amber-400"
              />
              <ProgressBar
                label="Protein"
                unit="g"
                value={macros.totals.protein}
                max={macros.targets.protein}
                barClass="bg-emerald-400"
              />
            </div>
            {macros.entries.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-zinc-800 pt-3">
                {macros.entries.map((e, i) => (
                  <li key={i} className="flex justify-between gap-2 text-xs">
                    <span className="truncate text-zinc-400">{e.label}</span>
                    <span className="shrink-0 font-mono text-zinc-500">
                      {Math.round(e.calories)}kcal · {Math.round(e.protein)}p
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-zinc-500">
              Upcoming Schedule
            </h2>
            {state.schedule.length === 0 ? (
              <p className="text-xs text-zinc-600">No upcoming events.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {state.schedule.map((ev, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-zinc-800 bg-zinc-950 p-3 transition-colors hover:border-zinc-700"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-zinc-200">{ev.title}</p>
                      {ev.course && (
                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400">
                          {ev.course}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 font-mono text-xs text-zinc-500">
                      {formatEventDate(ev.date)}
                    </p>
                    {ev.location && (
                      <p className="mt-0.5 text-xs text-zinc-600">{ev.location}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
