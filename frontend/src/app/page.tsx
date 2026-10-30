"use client";

import { useEffect, useRef, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AuroraHero } from "@/components/ui/hero";
import { resolveWidget, type WidgetData } from "@/components/widgets/WidgetRegistry";

// backend base URL: NEXT_PUBLIC_API_URL (baked in at build time, e.g. on
// Vercel) with the public Render deploy as fallback; trailing slashes are
// trimmed so `${API}/api/...` never produces a double slash. A locally
// running uvicorn stays available as the secondary probe target.
const API =
  (process.env.NEXT_PUBLIC_API_URL || "https://sage-c6au.onrender.com").replace(/\/+$/, "");
const API_FALLBACK = "http://127.0.0.1:8001";

// client timezone for every backend request — reminder math and
// "what time is it" answers must match the browser clock
const USER_TIMEZONE =
  (typeof Intl !== "undefined" && Intl.DateTimeFormat().resolvedOptions().timeZone) || "UTC";
const TZ_HEADERS = { "X-User-Timezone": USER_TIMEZONE };
const JUDGE_DEMO_TOKEN = "JUDGE_DEMO_2026";

function bootstrapJudgeToken() {
  try {
    const token = new URLSearchParams(window.location.search).get("demo_token");
    if (token === JUDGE_DEMO_TOKEN) {
      sessionStorage.setItem("sage_judge_token", token);
    }
  } catch {}
}
if (typeof window !== "undefined") bootstrapJudgeToken();

function judgeAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const token = sessionStorage.getItem("sage_judge_token");
    if (token) headers["X-Judge-Token"] = token;
    const apiKey = sessionStorage.getItem("sage_api_key");
    if (apiKey) headers["X-Nebius-Api-Key"] = apiKey;
  } catch {}
  return headers;
}

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
  id?: string;
  kind?: string;
};
type DocumentRef = { document: string; page: number | null; snippet: string | null };
type AgentState = {
  macros: MacrosState;
  schedule: ScheduleEvent[];
  documents: DocumentRef[];
  widgets?: WidgetData[];
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
  widgets: [],
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

function StatePanels({
  state,
  onDeleteWidget,
  onDeleteSchedule,
}: {
  state: AgentState;
  onDeleteWidget: (id: string) => void;
  onDeleteSchedule?: (id: string) => void;
}) {
  const macros = state.macros;
  return (
    <aside className="flex h-full w-[21rem] flex-col gap-5 overflow-y-auto overflow-x-hidden pb-1">
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

        {(state.widgets ?? []).length > 0 && (
          <div className="flex flex-col gap-3">
            {(state.widgets ?? []).map((w) => {
              const Card = resolveWidget(w.type);
              return <Card key={w.id} widget={w} onDelete={onDeleteWidget} />;
            })}
          </div>
        )}

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
                  className="group relative rounded-2xl border border-white/10 bg-black/30 p-3 transition-colors hover:border-white/20"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-zinc-100">{ev.title}</p>
                    {ev.course && (
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] text-emerald-300/90 transition-opacity group-hover:opacity-0">
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
                  {ev.id && onDeleteSchedule && (
                    <button
                      type="button"
                      title="Delete event"
                      onClick={() => ev.id && onDeleteSchedule(ev.id)}
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg text-[11px] text-zinc-600 opacity-0 transition-all hover:bg-white/[0.06] hover:text-red-400 group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
    </aside>
  );
}

function DashboardApp({
  initialPrompt,
  messages,
  setMessages,
  onState,
  onAuthRequired,
}: {
  initialPrompt?: string | null;
  messages: ChatMsg[];
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>;
  onState: (s: AgentState) => void;
  onAuthRequired?: () => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [statusToast, setStatusToast] = useState("");
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function setTransientStatus(msg: string) {
    setStatusToast(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatusToast(""), 5000);
  }
  const [apiBase, setApiBase] = useState(API);

  // --- Live Screen Copilot (Tab Analyzer) ---
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const prevSigRef = useRef<number[] | null>(null);
  const busyRef = useRef(false);
  const [sharing, setSharing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [shareLabel, setShareLabel] = useState("");
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      // never leak screen shares across refreshes
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      if (statusTimer.current) clearTimeout(statusTimer.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const probe = async (base: string): Promise<boolean> => {
      try {
        const r = await fetch(`${base}/api/state`, { headers: TZ_HEADERS });
        if (!r.ok) {
          console.warn(`SAGE backend probe ${base} -> HTTP ${r.status}`);
          return false;
        }
        const s: AgentState = await r.json();
        onState(s);
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
      await fetch(`${apiBase}/api/history`, { method: "DELETE", headers: TZ_HEADERS });
      setMessages([]);
      setTransientStatus("chat history reset");
    } catch {
      setTransientStatus("could not reset chat history");
    }
  }

  async function loadHistory(base: string) {
    try {
      const r = await fetch(`${base}/api/history`, { headers: TZ_HEADERS });
      if (!r.ok) return;
      const h = await r.json();
      if (Array.isArray(h.messages)) {
        const server: ChatMsg[] = h.messages.map(
          (m: { role: "user" | "assistant" | "system"; content: string }) => ({
            role: m.role,
            content: m.content,
          })
        );
        // MERGE, never overwrite: the history snapshot can race an
        // in-flight perception/chat turn and would otherwise wipe the
        // bubbles the user is already looking at
        setMessages((prev) => {
          if (prev.length === 0) return server;
          const key = (m: ChatMsg) => `${m.role}|${m.content}`;
          const serverKeys = new Set(server.map(key));
          // snapshot already contains every local turn -> trust it
          // wholesale (it also restores proper chronological order)
          if (prev.every((m) => serverKeys.has(key(m)))) return server;
          // locals carry turns the stale snapshot doesn't know about —
          // keep them and append only unseen server turns
          const seen = new Set(serverKeys);
          const merged = [...prev];
          for (const m of server) {
            const k = key(m);
            if (!seen.has(k)) {
              merged.push(m);
              seen.add(k);
            }
          }
          return merged;
        });
      }
    } catch {}
  }

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, sending]);

  async function refreshState() {
    try {
      const r = await fetch(`${apiBase}/api/state`, { headers: TZ_HEADERS });
      if (r.ok) onState(await r.json());
    } catch {
      // sidebar refresh is best-effort
    }
  }

  function stopShare() {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    prevSigRef.current = null;
    setSharing(false);
    setShareLabel("");
    setTransientStatus("screen sharing stopped");
  }

  async function startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
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
      setShareLabel(track?.label || "selected tab");
      setSharing(true);
      setTransientStatus("screen copilot active");
      track?.addEventListener("ended", stopShare);
      // index the tab immediately, then watch for changes every 30s
      setTimeout(() => void autoAnalyze(true), 1500);
      autoTimerRef.current = setInterval(() => void autoAnalyze(false), 30000);
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
      // <5% of sampled blocks changed: static tab, skip the upload
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

  async function postScreen(base: string, payload: object) {
    const r = await fetch(`${base}/api/screen/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...TZ_HEADERS, ...judgeAuthHeaders() },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error(`SAGE screen POST ${base}/api/screen/analyze -> HTTP ${r.status}`);
      throw { kind: "http", status: r.status };
    }
    return r.json();
  }

  async function autoAnalyze(force: boolean) {
    if (!streamRef.current || busyRef.current) return;
    const frame = captureFrame(force);
    if (!frame) return; // tab unchanged - nothing new to index
    busyRef.current = true;
    try {
      let data;
      try {
        data = await postScreen(apiBase, { frame_base64: frame });
      } catch (err: any) {
        if (err?.kind === "http") throw err;
        const alt = apiBase === API ? API_FALLBACK : API;
        data = await postScreen(alt, { frame_base64: frame });
        setApiBase(alt);
      }
      if (data.state) onState(data.state);
      if (data.log_line) {
        setMessages((m) => [...m, { role: "assistant", content: data.log_line }]);
      }
      setTransientStatus(data.log_line ?? "tab capture indexed");
    } catch {
      setTransientStatus("screen copilot call failed");
    } finally {
      busyRef.current = false;
    }
  }

  async function askScreen(text: string, frame: string) {
    setSending(true);
    try {
      let data;
      try {
        data = await postScreen(apiBase, { frame_base64: frame, question: text });
      } catch (err: any) {
        if (err?.kind === "http") throw err;
        const alt = apiBase === API ? API_FALLBACK : API;
        data = await postScreen(alt, { frame_base64: frame, question: text });
        setApiBase(alt);
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply }]);
      if (data.state) onState(data.state);
      setOnline(true);
    } catch (err: any) {
      console.error("SAGE screen copilot failed:", err);
      const offline = err?.kind !== "http";
      if (err?.status === 401) onAuthRequired?.();
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: offline
            ? `Cannot reach the SAGE backend on ${apiBase} or ${API_FALLBACK}. Is uvicorn running?`
            : `Screen copilot failed (HTTP ${err?.status ?? "?"}). ${
                err?.status === 401 ? "A judge token or Nebius API key is required." : "Try again in a moment."
              }`,
        },
      ]);
      if (offline) setOnline(false);
    } finally {
      setSending(false);
    }
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (sending) return;
    if (!text) return;
    // instant clear on dispatch: old queries never linger in the bar
    if (!textArg) setInput("");
    // the landing handler may have already appended this exact user turn
    // (seeded bubble) — never duplicate it and never double-count it in
    // the API history payload
    const lastMsg = messages[messages.length - 1];
    const seeded = !!(lastMsg && lastMsg.role === "user" && lastMsg.content === text);
    const history: { role: "user" | "assistant" | "system"; content: string }[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      ...(seeded ? [] : [{ role: "user" as const, content: text }]),
    ];
    if (!seeded) setMessages((m) => [...m, { role: "user", content: text }]);
    if (sharing) {
      const frame = captureFrame(true);
      if (frame) {
        await askScreen(text, frame);
        return;
      }
      // no frame available - fall through to plain text chat
    }
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
          headers: { "Content-Type": "application/json", ...TZ_HEADERS, ...judgeAuthHeaders() },
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
      if (data.state) onState(data.state);
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
      } else if (err.status === 401) {
        onAuthRequired?.();
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              "Unauthorized (HTTP 401) — a judge token or Nebius API key is required for chat. Use the banner in the corner to authenticate.",
          },
        ]);
      } else {
        setTransientStatus(
          `backend rejected the message (HTTP ${err.status ?? "?"}) — context truncated`
        );
      }
    } finally {
      setSending(false);
    }
  }

  // landing quick-action / prompt seeding: fire the seeded prompt once
  // the dashboard is live
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (sentInitialRef.current) return;
    if (initialPrompt) {
      sentInitialRef.current = true;
      void send(initialPrompt.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="docs" className="relative h-full w-full text-zinc-100">
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

      {statusToast && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 rounded-xl border border-white/10 bg-black/55 px-3 py-2 font-[family-name:var(--font-mono,ui-monospace)] text-xs text-zinc-200 backdrop-blur-md">
          {statusToast}
        </div>
      )}

      <main
        id="chat"
        className="relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.07] shadow-[0_10px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl"
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.07] px-5">
          <span className="font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.35em] text-emerald-300/80">
            sage_
          </span>
          <div
            className="flex items-center gap-2"
            style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          >
          {sharing && (
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/40 bg-emerald-400/15 px-3 py-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
              <span className="font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.2em] text-emerald-200">
                sage active — watching tab
              </span>
              <button
                onClick={stopShare}
                title={`Stop Sharing${shareLabel ? `: ${shareLabel}` : ""}`}
                className="rounded-full border border-white/15 px-1.5 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[9px] uppercase tracking-[0.15em] text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
              >
                stop
              </button>
            </div>
          )}
            <button
              onClick={() => setConfirmReset(true)}
              title="Reset chat history"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
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
          <div className="mx-auto flex max-w-2xl flex-col gap-[22px]">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={
                    m.role === "user"
                      ? "max-w-[78%] rounded-2xl rounded-br-sm border border-emerald-300/25 bg-emerald-400/15 px-4 py-2.5 text-[13.5px] leading-relaxed text-emerald-50 backdrop-blur-md"
                      : "max-w-[85%] rounded-2xl rounded-bl-sm border border-white/[0.08] bg-[#0b0e14]/70 px-4 py-3 text-[13.5px] leading-relaxed text-zinc-200 backdrop-blur-sm"
                  }
                >
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.role === "assistant" && m.documents && m.documents.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                      {m.documents.map((d, j) => (
                        <span
                          key={j}
                          className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] text-zinc-300/80"
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
                <span className="font-[family-name:var(--font-mono,ui-monospace)] text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                  sage is thinking
                </span>
              </div>
            )}
          </div>
        </div>

        <motion.div
          layoutId="sage-input"
          transition={{ layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
          className="shrink-0 border-t border-white/[0.07] p-4"
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            {!sharing && (
              <button
                onClick={startShare}
                title="Share Tab / Screen"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-400 transition-colors hover:border-emerald-300/40 hover:text-emerald-200"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="3" rx="2" />
                  <line x1="8" x2="16" y1="21" y2="21" />
                  <line x1="12" x2="12" y1="17" y2="21" />
                </svg>
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Message SAGE…"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.08] px-4 py-2.5 text-sm text-zinc-100 outline-none backdrop-blur-md placeholder:text-zinc-500 focus:border-emerald-300/50"
            />
            <button
              onClick={() => send()}
              disabled={sending || !input.trim()}
              className="rounded-xl bg-zinc-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-600 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </motion.div>
      </main>

      <AnimatePresence>
        {confirmReset && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setConfirmReset(false)}
          >
            <motion.div
              className="w-[22rem] rounded-2xl border border-white/10 bg-[#12161f] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.6)]"
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-zinc-100">Reset chat history?</h3>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                This wipes the conversation on SAGE and this device. Your macro tracker
                and schedule stay untouched.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmReset(false)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06]"
                >
                  Cancel
                </button>
                <button
                  onClick={clearHistory}
                  className="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red-500"
                >
                  Reset
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SAGEHome() {
  // 250ms ambient dark phase -> landing view fills only the chat column
  // (macro tracker + schedule stay visible) -> morphs into the workspace
  // when the first prompt goes out
  const [booted, setBooted] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [agentState, setAgentState] = useState<AgentState>(EMPTY_STATE);
  const [authNeeded, setAuthNeeded] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 250);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!booted) return;
    try {
      if (sessionStorage.getItem("sage_banner_dismissed") === "1") return;
      if (!sessionStorage.getItem("sage_judge_token") && !sessionStorage.getItem("sage_api_key")) {
        setAuthNeeded(true);
      }
    } catch {}
  }, [booted]);

  function useDemoToken() {
    try {
      sessionStorage.setItem("sage_judge_token", JUDGE_DEMO_TOKEN);
      sessionStorage.setItem("sage_banner_dismissed", "1");
    } catch {}
    setAuthNeeded(false);
  }
  function saveApiKey() {
    const key = keyDraft.trim();
    if (!key) return;
    try {
      sessionStorage.setItem("sage_api_key", key);
      sessionStorage.setItem("sage_banner_dismissed", "1");
    } catch {}
    setAuthNeeded(false);
  }
  function dismissBanner() {
    try {
      sessionStorage.setItem("sage_banner_dismissed", "1");
    } catch {}
    setAuthNeeded(false);
  }

  useEffect(() => {
    if (!booted) return;
    let alive = true;
    fetch(`${API}/api/state`, { headers: TZ_HEADERS })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (alive && s) setAgentState(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [booted]);

  async function handleDeleteWidget(id: string) {
    const del = (base: string) =>
      fetch(`${base}/api/widgets/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: TZ_HEADERS,
      });
    let ok = false;
    try {
      ok = (await del(API)).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        ok = (await del(API_FALLBACK)).ok;
      } catch {
        return;
      }
    }
    if (!ok) return;
    try {
      const r = await fetch(`${API}/api/state`, { headers: TZ_HEADERS });
      if (r.ok) setAgentState(await r.json());
    } catch {}
  }

  async function handleDeleteSchedule(id: string) {
    const del = (base: string) =>
      fetch(`${base}/api/schedule/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: TZ_HEADERS,
      });
    let ok = false;
    try {
      ok = (await del(API)).ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      try {
        ok = (await del(API_FALLBACK)).ok;
      } catch {
        return;
      }
    }
    if (!ok) return;
    try {
      const r = await fetch(`${API}/api/state`, { headers: TZ_HEADERS });
      if (r.ok) setAgentState(await r.json());
    } catch {}
  }

  // native push notifications: ask once on first interaction, then watch
  // the synced schedule for events starting within 15 minutes
  const notifiedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    try {
      notifiedRef.current = new Set(
        JSON.parse(sessionStorage.getItem("notified_events") ?? "[]")
      );
    } catch {
      notifiedRef.current = new Set();
    }
    const ask = () => {
      try {
        if ("Notification" in window && Notification.permission === "default") {
          void Notification.requestPermission();
        }
      } catch {}
      window.removeEventListener("pointerdown", ask);
      window.removeEventListener("keydown", ask);
    };
    window.addEventListener("pointerdown", ask);
    window.addEventListener("keydown", ask);
    return () => {
      window.removeEventListener("pointerdown", ask);
      window.removeEventListener("keydown", ask);
    };
  }, []);

  useEffect(() => {
    const check = () => {
      try {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        const now = Date.now();
        for (const ev of agentState.schedule ?? []) {
          const start = Date.parse(ev.date);
          if (Number.isNaN(start)) continue;
          const minutes = (start - now) / 60000;
          // quick reminders fire at their start time; classes warn 15 min early
          const window = ev.kind === "reminder" ? 1 : 15;
          if (minutes < 0 || minutes > window) continue;
          const key = ev.id ?? `${ev.title}|${ev.date}`;
          if (notifiedRef.current.has(key)) continue;
          notifiedRef.current.add(key);
          try {
            sessionStorage.setItem(
              "notified_events",
              JSON.stringify([...notifiedRef.current])
            );
          } catch {}
          const when = ev.date.slice(11, 16);
          new Notification(ev.title, {
            body: `Starts at ${when} — ${ev.location || "Upcoming"}`,
            icon: "/favicon.ico",
          });
        }
      } catch {}
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [agentState]);

  function startSession(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    // optimistic user bubble BEFORE the transition/API call so the
    // prompt is visible the instant the dashboard expands
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setPendingPrompt(trimmed);
    setDraft("");
    setIsStarted(true);
  }

  function submitLanding(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // clear the bar in THIS render so the AnimatePresence exit copy does
    // not show stale text; start the session on the next frame
    setDraft("");
    requestAnimationFrame(() => startSession(trimmed));
  }

  return (
    <div className="relative h-screen overflow-hidden bg-[#08080B] text-zinc-100">
      <div className="fixed inset-0 z-0">
        {/* green -> cyan -> teal iridescent ramp */}
        <AuroraHero
          eyebrow=""
          headline=""
          description=""
          meta={[]}
          colors={["#3DDC97", "#38CFF2", "#2DD4BF"]}
        />
      </div>

      <div className="relative z-10 flex h-full w-full items-stretch gap-5 px-4 py-5 sm:px-6">
        <div className="relative min-w-0 flex-1">
          <AnimatePresence>
            {booted && !isStarted && (
              <motion.div
                key="landing"
                className="absolute inset-0 z-10"
                initial={{ opacity: 0, y: 24, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -18, scale: 0.99 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.07] px-6 shadow-[0_10px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl">
                  <h1
                    className="max-w-xl text-center text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl"
                    style={{ fontFamily: "var(--font-instrument), 'Instrument Sans', sans-serif" }}
                  >
                    Welcome back, where should we begin?
                  </h1>

                  <motion.div
                    layoutId="sage-input"
                    transition={{ layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
                    className="mt-10 flex w-[min(100%,36rem)] flex-col rounded-3xl border border-white/15 bg-black/30 p-3 shadow-[0_14px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl"
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && submitLanding(draft)}
                        placeholder="Ask SAGE..."
                        className="h-10 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                      />
                      <button
                        onClick={() => submitLanding(draft)}
                        disabled={!draft.trim()}
                        title="Send"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-zinc-700 text-white transition-all hover:bg-zinc-600 hover:scale-105 disabled:opacity-30"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                    </div>
                  </motion.div>

                  <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                    {[
                      "Summarize my macros for today",
                      "Check upcoming class schedule",
                      "Solve physics / math problem",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => startSession(q)}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 font-[family-name:var(--font-mono,ui-monospace)] text-xs text-zinc-300 backdrop-blur-md transition-colors hover:border-white/25 hover:bg-white/[0.09] hover:text-zinc-100"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {isStarted && (
            <motion.div
              key="dashboard"
              className="absolute inset-0"
              initial={{ opacity: 0, y: 34, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 80, damping: 18 }}
            >
              <DashboardApp
                initialPrompt={pendingPrompt}
                onAuthRequired={() => {
                  try {
                    sessionStorage.removeItem("sage_banner_dismissed");
                  } catch {}
                  setAuthNeeded(true);
                }}
                messages={messages}
                setMessages={setMessages}
                onState={setAgentState}
              />
            </motion.div>
          )}
        </div>

        {booted && (
          <motion.div
            key="panels"
            className="hidden h-full min-h-0 shrink-0 lg:block"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          >
            <StatePanels
              state={agentState}
              onDeleteWidget={handleDeleteWidget}
              onDeleteSchedule={handleDeleteSchedule}
            />
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {authNeeded && (
          <motion.div
            className="fixed bottom-4 right-4 z-50 w-[19.5rem] rounded-2xl border border-zinc-800 bg-zinc-900/90 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.6)] backdrop-blur-md"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs leading-relaxed text-zinc-300">
                <span className="font-semibold text-zinc-100">Judge Mode Active</span> — open the
                app with{" "}
                <code className="rounded bg-white/[0.07] px-1 py-0.5 font-[family-name:var(--font-mono,ui-monospace)] text-[10px] text-emerald-300">
                  ?demo_token=JUDGE_DEMO_2026
                </code>{" "}
                or enter your Nebius API Key.
              </p>
              <button onClick={dismissBanner} title="Dismiss" className="shrink-0 text-zinc-500 hover:text-zinc-200">
                ✕
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={useDemoToken}
                className="shrink-0 rounded-lg border border-emerald-300/40 bg-emerald-400/15 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 transition-colors hover:bg-emerald-400/25"
              >
                Use demo token
              </button>
              <input
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveApiKey()}
                placeholder="Nebius API key"
                type="password"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-300/40"
              />
              <button
                onClick={saveApiKey}
                className="shrink-0 rounded-lg bg-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-zinc-600"
              >
                Save
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
