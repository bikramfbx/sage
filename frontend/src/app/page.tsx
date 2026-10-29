"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { AuroraHero } from "@/components/ui/hero";

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
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
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

function DashboardApp() {
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
    setMessages((m) => [...m, { role: "user", content: text }]);
    setSending(true);

    // context window slicing: keep the payload safely under the 64-item
    // server cap while preserving the most recent conversation context
    const SLICE_LIMITS = [50, 30];

    type ChatError =
      | { kind: "http"; status: number; detail: string; base: string }
      | { kind: "network"; cause: unknown; base: string };

    async function postChat(base: string, limit: number): Promise<any> {
      try {
        const r = await fetch(`${base}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history.slice(-limit) }),
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          console.error(
            `SAGE chat POST ${base}/api/chat -> HTTP ${r.status} ${r.statusText}`,
            detail.slice(0, 300)
          );
          throw { kind: "http", status: r.status, detail, base };
        }
        return r.json();
      } catch (err: any) {
        if (err && err.kind === "http") throw err;
        console.error(`SAGE chat network error via ${base}:`, err);
        throw { kind: "network", cause: err, base };
      }
    }

    try {
      let data;
      try {
        data = await postChat(apiBase, SLICE_LIMITS[0]);
      } catch (err: any) {
        if (err.kind === "http" && (err.status === 422 || err.status === 400)) {
          // validation error, not a connectivity problem — truncate harder
          setTransientStatus("message context too long; truncating window…");
          console.warn("SAGE chat: payload rejected, retrying with a smaller window");
          data = await postChat(apiBase, SLICE_LIMITS[1]);
        } else if (err.kind === "network") {
          // one stack unreachable — try the alternate base transparently
          const alt = apiBase === API ? API_FALLBACK : API;
          data = await postChat(alt, SLICE_LIMITS[0]);
          setApiBase(alt);
        } else {
          throw err;
        }
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply, documents: data.state?.documents ?? [] },
      ]);
      if (data.state) setState(data.state);
      setOnline(true);
    } catch (err: any) {
      const offlineError =
        err.kind === "network" || (err.kind === "http" && err.status === 503);
      console.error("SAGE chat failed:", err);
      if (offlineError) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: `Cannot reach the SAGE backend on ${apiBase} or ${API_FALLBACK}. Is uvicorn running? (see browser console for details)`,
          },
        ]);
        setOnline(false);
      } else {
        setTransientStatus(
          `backend rejected the message (HTTP ${err.status ?? "?"}) — context truncated`
        );
      }
    } finally {
      setSending(false);
    }
  }

  const macros = state.macros;

  return (
    <div id="docs" className="flex h-screen w-full overflow-hidden items-stretch gap-5 px-4 py-5 text-zinc-100 sm:px-6">
      <video ref={videoRef} className="hidden" autoPlay muted playsInline />
      <div className="fixed right-5 top-5 z-30 flex items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-1.5 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.22em] text-zinc-400 backdrop-blur-md">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            online === null
              ? "animate-pulse bg-zinc-400"
              : online
                ? "bg-emerald-400"
                : "bg-red-400"
          }`}
        />
        {online === null ? "connecting" : online ? "sage online" : "sage offline"}
      </div>

      {perceptionStatus && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 rounded-xl border border-white/10 bg-black/55 px-3 py-2 font-[family-name:var(--font-mono,ui-monospace)] text-xs text-zinc-200 backdrop-blur-md">
          perception: {perceptionStatus}
        </div>
      )}

      <main
        id="chat"
        className="relative z-10 flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.07] shadow-[0_10px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        <div className="flex h-11 shrink-0 items-center border-b border-white/[0.07] px-5">
          <span className="font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.35em] text-emerald-300/80">
            sage_
          </span>
        </div>

        <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto p-5">
          {messages.length === 0 && (
            <div className="mt-24 text-center">
              <p className="font-[family-name:var(--font-mono,ui-monospace)] text-2xl text-zinc-500/70">$ ask sage_</p>
              <p className="mt-3 text-sm text-zinc-400/80">
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
                      ? "max-w-[80%] rounded-2xl rounded-br-sm border border-emerald-300/25 bg-emerald-400/15 px-4 py-2.5 text-sm text-emerald-50 backdrop-blur-md"
                      : "max-w-[85%] rounded-2xl rounded-bl-sm border border-white/10 bg-black/30 px-4 py-2.5 text-sm text-zinc-200 backdrop-blur-sm"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.role === "assistant" && m.documents && m.documents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                      {m.documents.map((d, j) => (
                        <span
                          key={j}
                          className="rounded bg-white/10 px-1.5 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] text-zinc-300/80"
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
                  <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-300/90 [animation-delay:0ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-300/90 [animation-delay:150ms]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-emerald-300/90 [animation-delay:300ms]" />
                </div>
                <span className="font-[family-name:var(--font-mono,ui-monospace)] text-xs text-zinc-500">
                  sage is thinking
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.07] p-4">
          <div className="mx-auto flex max-w-2xl gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Message SAGE…"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.08] px-4 py-2.5 text-sm text-zinc-100 outline-none backdrop-blur-md placeholder:text-zinc-500 focus:border-emerald-300/50"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="rounded-xl bg-emerald-400/75 px-5 py-2.5 text-sm font-semibold text-[#08130d] backdrop-blur-md transition-colors hover:bg-emerald-300 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      </main>

      <aside className="hidden w-[21rem] shrink-0 flex-col gap-5 overflow-y-auto overflow-x-hidden pb-1 lg:flex">
        <section className="rounded-3xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
          <h2 className="mb-3 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.28em] text-zinc-400">
            Macro Tracker
            <span className="float-right normal-case text-zinc-500/80">{macros.date}</span>
          </h2>
          <div className="flex flex-col gap-4">
            <ProgressBar
              label="Calories"
              unit="kcal"
              value={macros.totals.calories}
              max={macros.targets.calories}
              barClass="bg-amber-300"
            />
            <ProgressBar
              label="Protein"
              unit="g"
              value={macros.totals.protein}
              max={macros.targets.protein}
              barClass="bg-emerald-300"
            />
          </div>
          {macros.entries.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-white/10 pt-3">
              {macros.entries.map((e, i) => (
                <li key={i} className="flex justify-between gap-2 text-xs">
                  <span className="truncate text-zinc-300/90">{e.label}</span>
                  <span className="shrink-0 font-[family-name:var(--font-mono,ui-monospace)] text-zinc-400/90">
                    {Math.round(e.calories)}kcal · {Math.round(e.protein)}p
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-xl">
          <h2 className="mb-3 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.28em] text-zinc-400">
            Upcoming Schedule
          </h2>
          {state.schedule.length === 0 ? (
            <p className="text-xs text-zinc-500/80">No upcoming events.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {state.schedule.map((ev, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-white/10 bg-black/30 p-3 transition-colors hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-100">{ev.title}</p>
                    {ev.course && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] text-emerald-300/90">
                        {ev.course}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 font-[family-name:var(--font-mono,ui-monospace)] text-xs text-zinc-400/90">
                    {formatEventDate(ev.date)}
                  </p>
                  {ev.location && (
                    <p className="mt-0.5 text-xs text-zinc-500">{ev.location}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

export default function SAGEHeroLanding() {
  // cinematic 4s boot: right-aligned SAGE lockup flashes on instantly,
  // scrolls up out of frame at 3.5s, interface rises at the 4s mark
  const [textVisible, setTextVisible] = useState(true);
  const [interfaceReady, setInterfaceReady] = useState(false);
  useEffect(() => {
    const a = setTimeout(() => setTextVisible(false), 3500);
    const b = setTimeout(() => setInterfaceReady(true), 4000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  return (
    <div className="relative h-screen overflow-hidden bg-[#08080B]">
      <div className="fixed inset-0 z-0">
        {/* green -> cyan -> teal iridescent ramp */}
        <AuroraHero
          eyebrow=""
          headline=""
          description=""
          meta={[]}
          colors={["#3DDC97", "#38CFF2", "#2DD4BF"]}
        />
        <motion.div
          initial={{ y: 0 }}
          animate={textVisible ? { y: 0 } : { y: "-115%" }}
          transition={
            textVisible
              ? { duration: 0 }
              : { duration: 0.95, ease: [0.72, 0, 0.28, 1] }
          }
          aria-hidden={!textVisible}
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center px-6 text-center"
        >
          <p className="inline-flex px-4 py-1.5 rounded-full bg-white/5 border border-white/10 font-[family-name:var(--font-mono,ui-monospace)] text-xs tracking-widest text-emerald-400">
            STUDENT ASSISTANT FOR GROWTH AND EDUCATION
          </p>
          <h1 className="mt-8 text-7xl sm:text-8xl font-semibold tracking-[-0.04em] bg-gradient-to-b from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            SAGE
          </h1>
          <p className="mt-6 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] tracking-[0.3em] text-zinc-400/70 sm:text-xs">
            initializing ambient interface…
          </p>
        </motion.div>
      </div>
      {interfaceReady && (
        <motion.div
          initial={{ opacity: 0, y: 34, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 72, damping: 17, delay: 0.05 }}
          className="relative z-10"
        >
          <DashboardApp />
        </motion.div>
      )}
    </div>
  );
}
