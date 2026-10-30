"use client";

import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AuroraHero } from "@/components/ui/hero";

// backend binds 127.0.0.1; localhost can stall on IPv6 (::1) in some
// environments before the browser falls back, so probe IPv4 first
const API = "http://127.0.0.1:8001";
const API_FALLBACK = "http://localhost:8001";

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
  imageUrl?: string;
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

function StatePanels({ state }: { state: AgentState }) {
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
  );
}

function AttachButton({ onPick, attached }: { onPick: (file: File) => void; attached: boolean }) {
  return (
    <label
      title="Attach an image"
      className={`flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-2xl border transition-colors ${
        attached
          ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-200"
          : "border-white/10 bg-white/[0.05] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
      }`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </svg>
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function ImageThumb({ image, onRemove }: { image: File; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(image);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [image]);
  return (
    <div className="relative mb-2 w-fit">
      {url ? (
        <img
          src={url}
          alt="attachment preview"
          className="h-16 w-16 rounded-xl border border-white/15 object-cover"
        />
      ) : (
        <div className="h-16 w-16 animate-pulse rounded-xl border border-white/15 bg-white/10" />
      )}
      <button
        onClick={onRemove}
        title="Remove attachment"
        className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/25 bg-black/75 text-[10px] leading-none text-zinc-300 hover:border-white/50 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}

const _n = (v: unknown) => (typeof v === "number" ? Math.round(v) : 0);

// tiny inline markdown: **bold** and *italic* spans only
function _md(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1] !== undefined) {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {match[1]}
        </strong>
      );
    } else {
      parts.push(<em key={key++} className="italic">{match[2]}</em>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// block renderer for assistant bubbles: bullets, blank lines, bold/italic
function MarkdownBlock({ content }: { content: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {content.split("\n").map((line, k) => {
        if (!line.trim()) return <div key={k} className="h-1.5" />;
        const bullet = line.startsWith("- ") || line.startsWith("• ");
        const body = bullet ? line.slice(2) : line;
        return (
          <div key={k} className={bullet ? "flex gap-2" : undefined}>
            {bullet && <span className="shrink-0 text-emerald-300/80">•</span>}
            <span>{_md(body)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatPerceptionReply(data: any): string {
  if (data?.type === "FOOD_MEAL") {
    // server now builds the rich markdown breakdown — prefer it verbatim
    if (typeof data.summary === "string" && data.summary.trim()) return data.summary;
    const macros = data.macros ?? {};
    const items: any[] = Array.isArray(macros.items) ? macros.items : [];
    const totals = macros.today_totals ?? {};
    const targets = macros.targets ?? {};
    const lines = [data.summary || "Meal logged from your photo."];
    if (items.length) {
      lines.push(
        "",
        ...items.map(
          (i) =>
            `• ${i.name ?? "food item"} — ${_n(i.calories)} kcal · ${_n(i.protein_g)}g protein · ${_n(i.carbs_g)}g carbs · ${_n(i.fats_g)}g fats`
        )
      );
    }
    if (totals.calories != null) {
      lines.push(
        "",
        `Daily Total: ${_n(totals.calories)} / ${_n(targets.calories)} kcal · ${_n(totals.protein)} / ${_n(targets.protein)} g protein`
      );
    }
    return lines.join("\n");
  }
  if (data?.type === "ACADEMIC_ASSIGNMENT") {
    // rich markdown breakdown is built server-side (reply mirrors summary)
    if (typeof data.reply === "string" && data.reply.trim()) return data.reply;
    if (typeof data.summary === "string" && data.summary.trim()) return data.summary;
    const title = data.title ? ` "${data.title}"` : "";
    return `Saved assignment${title}${data.due_date ? ` — due ${data.due_date}` : ""} and indexed it into your notes.`;
  }
  if (data?.status === "error") {
    return `I couldn't analyze that image (${data.reason ?? "perception unavailable"}). Try again in a moment.`;
  }
  if (data?.status === "ignored") {
    return "That capture didn't contain anything I could act on.";
  }
  return data?.summary ?? data?.log_line ?? "Perception completed.";
}

function DashboardApp({
  initialPrompt,
  initialImage,
  messages,
  setMessages,
  onState,
}: {
  initialPrompt?: string | null;
  initialImage?: File | null;
  messages: ChatMsg[];
  setMessages: Dispatch<SetStateAction<ChatMsg[]>>;
  onState: (s: AgentState) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
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
      if (data.state) onState(data.state);
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

  async function refreshState() {
    try {
      const r = await fetch(`${apiBase}/api/state`);
      if (r.ok) onState(await r.json());
    } catch {
      // sidebar refresh is best-effort
    }
  }

  const objectUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  async function sendPerceive(text: string, image: File) {
    if (sending) return;
    // the landing handler may have already appended this exact user turn
    // (seeded bubble) — never duplicate it
    const lastMsg = messages[messages.length - 1];
    const seeded = !!(
      lastMsg &&
      lastMsg.role === "user" &&
      lastMsg.content === (text || "Analyze this image")
    );
    if (!seeded) {
      const previewUrl = URL.createObjectURL(image);
      objectUrlsRef.current.push(previewUrl);
      // immediate user bubble with the inline attachment thumbnail
      setMessages((m) => [
        ...m,
        { role: "user", content: text || "Analyze this image", imageUrl: previewUrl },
      ]);
    }
    setSending(true);
    const form = new FormData();
    form.append("image", image);
    if (text) form.append("prompt", text);
    const post = async (base: string) => {
      const r = await fetch(`${base}/api/perceive`, { method: "POST", body: form });
      if (!r.ok) {
        console.error(`SAGE perceive POST ${base}/api/perceive -> HTTP ${r.status}`);
        throw { kind: "http", status: r.status };
      }
      return r.json();
    };
    try {
      let data;
      try {
        data = await post(apiBase);
      } catch (err: any) {
        if (err?.kind === "http") throw err;
        // one stack unreachable — retry on the alternate base transparently
        const alt = apiBase === API ? API_FALLBACK : API;
        data = await post(alt);
        setApiBase(alt);
      }
      setMessages((m) => [...m, { role: "assistant", content: formatPerceptionReply(data) }]);
      // fresh state from the response keeps the sidebar widgets in sync
      // instantly — no page reload, no extra fetch
      if (data.state) onState(data.state);
      else void refreshState();
      setOnline(true);
    } catch (err: any) {
      console.error("SAGE perception failed:", err);
      const offline = err?.kind !== "http";
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: offline
            ? `Cannot reach the SAGE backend on ${apiBase} or ${API_FALLBACK}. Is uvicorn running?`
            : `Perception failed (HTTP ${err?.status ?? "?"}). Try a clearer image in a moment.`,
        },
      ]);
      if (offline) {
        setOnline(false);
        void refreshState();
      }
    } finally {
      setSending(false);
    }
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim();
    if (sending) return;
    if (!text && !pendingImage) return;
    if (!textArg) setInput("");
    if (pendingImage) {
      const image = pendingImage;
      setPendingImage(null);
      await sendPerceive(text, image);
      return;
    }
    // the landing handler may have already appended this exact user turn
    // (seeded bubble) — never duplicate it and never double-count it in
    // the API history payload
    const lastMsg = messages[messages.length - 1];
    const seeded = !!(lastMsg && lastMsg.role === "user" && lastMsg.content === text && !lastMsg.imageUrl);
    const history: { role: "user" | "assistant" | "system"; content: string }[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      ...(seeded ? [] : [{ role: "user" as const, content: text }]),
    ];
    if (!seeded) setMessages((m) => [...m, { role: "user", content: text }]);
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
      } else {
        setTransientStatus(
          `backend rejected the message (HTTP ${err.status ?? "?"}) — context truncated`
        );
      }
    } finally {
      setSending(false);
    }
  }

  // landing quick-action / prompt seeding: fire the seeded prompt or
  // image perception once the dashboard is live
  const sentInitialRef = useRef(false);
  useEffect(() => {
    if (sentInitialRef.current) return;
    if (initialImage) {
      sentInitialRef.current = true;
      void sendPerceive(initialPrompt?.trim() ?? "", initialImage);
    } else if (initialPrompt) {
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

      {perceptionStatus && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-50 rounded-xl border border-white/10 bg-black/55 px-3 py-2 font-[family-name:var(--font-mono,ui-monospace)] text-xs text-zinc-200 backdrop-blur-md">
          perception: {perceptionStatus}
        </div>
      )}

      <main
        id="chat"
        className="relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.07] shadow-[0_10px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl"
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
                  {m.imageUrl && (
                    <img
                      src={m.imageUrl}
                      alt="attached"
                      className="mb-2 max-h-48 w-auto max-w-full rounded-xl border border-white/20 object-cover"
                    />
                  )}
                  {m.role === "assistant" ? (
                    <MarkdownBlock content={m.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
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

        <motion.div
          layoutId="sage-input"
          transition={{ layout: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } }}
          className="shrink-0 border-t border-white/[0.07] p-4"
        >
          {pendingImage && (
            <div className="mx-auto max-w-2xl">
              <ImageThumb image={pendingImage} onRemove={() => setPendingImage(null)} />
            </div>
          )}
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <AttachButton onPick={setPendingImage} attached={!!pendingImage} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Message SAGE…"
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.08] px-4 py-2.5 text-sm text-zinc-100 outline-none backdrop-blur-md placeholder:text-zinc-500 focus:border-emerald-300/50"
            />
            <button
              onClick={() => send()}
              disabled={sending || (!input.trim() && !pendingImage)}
              className="rounded-xl bg-emerald-400/75 px-5 py-2.5 text-sm font-semibold text-[#08130d] backdrop-blur-md transition-colors hover:bg-emerald-300 disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </motion.div>
      </main>

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
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [agentState, setAgentState] = useState<AgentState>(EMPTY_STATE);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setBooted(true), 250);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!booted) return;
    let alive = true;
    fetch(`${API}/api/state`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (alive && s) setAgentState(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [booted]);

  function startSession(prompt: string, image: File | null = null) {
    const trimmed = prompt.trim();
    if (!trimmed && !image) return;
    // optimistic user bubble BEFORE the transition/API call so the
    // prompt is visible the instant the dashboard expands
    const previewUrl = image ? URL.createObjectURL(image) : undefined;
    if (previewUrl) objectUrlsRef.current.push(previewUrl);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: trimmed || "Analyze this image",
        ...(previewUrl ? { imageUrl: previewUrl } : {}),
      },
    ]);
    setPendingPrompt(trimmed || null);
    setPendingImage(image);
    setDraft("");
    setIsStarted(true);
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
                        onKeyDown={(e) => e.key === "Enter" && startSession(draft)}
                        placeholder="Ask SAGE..."
                        className="h-10 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                      />
                      <button
                        onClick={() => startSession(draft)}
                        disabled={!draft.trim()}
                        title="Send"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/90 text-[#08130d] transition-all hover:bg-emerald-300 hover:scale-105 disabled:opacity-30"
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
                initialImage={pendingImage}
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
            <StatePanels state={agentState} />
          </motion.div>
        )}
      </div>
    </div>
  );
}
