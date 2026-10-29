"use client";

import { useEffect, useRef, useState } from "react";

const API = "http://localhost:8001";
const API_FALLBACK = "http://127.0.0.1:8001";

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
  const [apiBase, setApiBase] = useState(API);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probe = async (base: string): Promise<boolean> => {
      try {
        const r = await fetch(`${base}/api/state`);
        if (!r.ok) {
          console.warn(`SAGE backend probe ${base} -> HTTP ${r.status}`);
          return false;
        }
        const s: AgentState = await r.json();
        setState(s);
        setApiBase(base);
        return true;
      } catch (err) {
        console.warn(`SAGE backend probe ${base} failed:`, err);
        return false;
      }
    };

    async function connect() {
      // browsers may resolve localhost to IPv6 ::1, which a 0.0.0.0 bind
      // doesn't cover — try it first, then the explicit IPv4 fallback
      if (await probe(API)) {
        if (alive) {
          setOnline(true);
          loadHistory(API);
        }
        return true;
      }
      if (await probe(API_FALLBACK)) {
        if (alive) {
          setOnline(true);
          loadHistory(API_FALLBACK);
        }
        return true;
      }
      if (alive) {
        setOnline(false);
        // self-heal: keep retrying instead of staying red until a reload
        timer = setTimeout(connect, 4000);
      }
      return false;
    }

    void connect();
    const onVisible = () => document.visibilityState === "visible" && void connect();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function clearHistory() {
    try {
      await fetch(`${apiBase}/api/history`, { method: "DELETE" });
    } catch {}
    setMessages([]);
  }

  async function loadHistory(base: string) {
    try {
      const r = await fetch(`${base}/api/history`);
      if (!r.ok) return;
      const h = await r.json();
      if (Array.isArray(h.messages)) {
        setMessages(
          h.messages.map(
            (m: { role: "user" | "assistant" | "system"; content: string }) => ({
              role: m.role,
              content: m.content,
            })
          )
        );
      }
    } catch {}
  }

  // --- Screen Perception (Study Copilot) ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevSigRef = useRef<number[] | null>(null);
  const busyRef = useRef(false);
  const [streaming, setStreaming] = useState(false);
  const [streamLabel, setStreamLabel] = useState("");
  const [autoDetect, setAutoDetect] = useState(false);
  const [perceiving, setPerceiving] = useState(false);
  const [perceptionStatus, setPerceptionStatus] = useState("");

  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setTransientStatus(msg: string) {
    setPerceptionStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setPerceptionStatus(""), 5000);
  }

  function endStudyStream() {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    prevSigRef.current = null;
    setStreaming(false);
    setAutoDetect(false);
    setStreamLabel("");
    setTransientStatus("stream ended");
  }

  useEffect(() => {
    return () => {
      // never leak screen shares across refreshes
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    };
  }, []);

  async function selectStudyWindow() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser" },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      prevSigRef.current = null;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      const track = stream.getVideoTracks()[0];
      setStreamLabel(track?.label || "selected window");
      setStreaming(true);
      setTransientStatus("study stream active");
      track?.addEventListener("ended", endStudyStream);
    } catch {
      setTransientStatus("screen share cancelled");
    }
  }

  function frameSignature(): number[] | null {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const grid = document.createElement("canvas");
    grid.width = 32;
    grid.height = 18;
    const gctx = grid.getContext("2d", { willReadFrequently: true });
    if (!gctx) return null;
    gctx.drawImage(video, 0, 0, 32, 18);
    const px = gctx.getImageData(0, 0, 32, 18).data;
    const sig: number[] = [];
    for (let i = 0; i < px.length; i += 4) {
      sig.push((px[i] + 2 * px[i + 1] + px[i + 2]) / 4);
    }
    return sig;
  }

  function captureFrame(force = false): string | null {
    const sig = frameSignature();
    if (!sig) return null;
    const prev = prevSigRef.current;
    prevSigRef.current = sig;
    if (!force && prev && prev.length === sig.length) {
      let changed = 0;
      for (let i = 0; i < sig.length; i++) {
        if (Math.abs(sig[i] - prev[i]) > 12) changed++;
      }
      // <5% of sampled blocks changed: static screen, skip upload entirely
      if (changed / sig.length < 0.05) return null;
    }
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = Math.round((video.videoHeight / video.videoWidth) * 1280) || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    return dataUrl.split(",")[1] ?? null;
  }

  async function perceive(mode: "auto_scan" | "manual_snap") {
    if (!streamRef.current || busyRef.current) return;
    const frame = captureFrame(mode === "manual_snap");
    if (!frame) {
      setTransientStatus("frame unchanged — local skip, nothing sent");
      return;
    }
    busyRef.current = true;
    setPerceiving(true);
    try {
      const r = await fetch(`${apiBase}/api/perceive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_base64: frame, trigger_mode: mode }),
      });
      if (!r.ok) {
        setTransientStatus(`perception error ${r.status}`);
        return;
      }
      const data = await r.json();
      if (data.state) setState(data.state);
      if (data.status === "ignored") {
        setTransientStatus(`frame ignored (${data.reason})`);
      } else if (data.status === "assignment_scheduled") {
        setMessages((m) => [...m, { role: "assistant", content: data.log_line }]);
        setTransientStatus(`assignment scheduled — ${data.log_line ?? ""}`);
      } else if (data.status === "note_saved") {
        setMessages((m) => [...m, { role: "assistant", content: data.log_line }]);
        setTransientStatus(`note saved — ${data.log_line ?? ""}`);
      }
    } catch {
      setTransientStatus("perception call failed");
    } finally {
      busyRef.current = false;
      setPerceiving(false);
    }
  }

  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (autoDetect && streaming) {
      void perceive("auto_scan");
      const id = setInterval(() => void perceive("auto_scan"), 30000);
      autoTimerRef.current = id;
      return () => clearInterval(id);
    }
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDetect, streaming]);

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
    const body = JSON.stringify({ messages: history });
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);

    async function postChat(base: string) {
      const r = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!r.ok) {
        const detail = await r.text().catch(() => "");
        console.error(`SAGE chat POST ${base}/api/chat -> HTTP ${r.status} ${r.statusText}`, detail.slice(0, 300));
        throw new Error(`HTTP ${r.status} on ${base}`);
      }
      return r.json();
    }

    try {
      let data;
      try {
        data = await postChat(apiBase);
      } catch (err) {
        console.error(`SAGE chat request failed via ${apiBase}:`, err);
        // network/CORS hiccup on one stack — retry transparently on the other
        const alt = apiBase === API ? API_FALLBACK : API;
        data = await postChat(alt);
        setApiBase(alt);
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply, documents: data.state?.documents ?? [] },
      ]);
      if (data.state) setState(data.state);
      setOnline(true);
    } catch (err) {
      console.error("SAGE chat unreachable on both bases:", err);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Cannot reach the SAGE backend on ${apiBase} or ${API_FALLBACK}. Is uvicorn running? (see browser console for details)`,
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
      <video ref={videoRef} className="hidden" autoPlay muted playsInline />
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-mono text-sm font-semibold tracking-widest text-emerald-400">
            SAGE
          </span>
          <span className="hidden truncate text-xs text-zinc-500 lg:inline">
            Student Assistant for Growth and Education
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          {!streaming ? (
            <button
              onClick={selectStudyWindow}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-emerald-300 transition-colors hover:bg-emerald-500/20"
              title="Share a window for the Study Copilot"
            >
              Select Study Window
            </button>
          ) : (
            <button
              onClick={endStudyStream}
              className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-red-300 transition-colors hover:bg-red-500/20"
            >
              Stop Stream
            </button>
          )}
          <button
            onClick={() => void perceive("manual_snap")}
            disabled={!streaming || perceiving}
            title="Capture the current window and analyze it now"
            className="rounded-lg border border-zinc-800 px-2.5 py-1 text-zinc-300 transition-colors hover:border-emerald-500/40 hover:text-emerald-300 disabled:opacity-40"
          >
            {perceiving ? "analyzing…" : "Snap & Analyze"}
          </button>
          <label
            className="hidden cursor-pointer select-none items-center gap-1.5 text-zinc-400 xl:flex"
            title="Scan the shared window every 30s for assignment deadlines"
          >
            <input
              type="checkbox"
              className="accent-emerald-500"
              checked={autoDetect}
              disabled={!streaming}
              onChange={(e) => setAutoDetect(e.target.checked)}
            />
            Auto-Detect Assignments
          </label>
          {streaming && (
            <span
              className="hidden max-w-40 truncate rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-emerald-300 md:inline"
              title={streamLabel}
            >
              Active Stream [{streamLabel}]
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-4 font-mono text-xs text-zinc-500">
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

      {perceptionStatus && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 rounded-lg border border-zinc-800 bg-zinc-900/95 px-3 py-2 font-mono text-xs text-zinc-300">
          perception: {perceptionStatus}
        </div>
      )}

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
