import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { AgentId, AgentStatus, HotZone, Memo, SessionState, SystemState } from "../types";
import { AgentPill } from "./AgentPill";
import { ExpandPanel } from "./ExpandPanel";
import { MediaCompact } from "./MediaCard";
import { ConfirmContext, ConfirmDialog, useConfirmState } from "./ConfirmDialog";

interface Props {
  sessions: SessionState[];
  memos: Memo[];
  system: SystemState;
}

const AGENT_ORDER: AgentId[] = [
  "claude-code",
  "codex",
  "opencode",
  "deveco-code",
  "codearts",
  "workbuddy",
  "hermes",
  "trae",
];

function groupByAgent(sessions: SessionState[]): Map<AgentId, SessionState[]> {
  const map = new Map<AgentId, SessionState[]>();
  for (const s of sessions) {
    if (!map.has(s.agent)) map.set(s.agent, []);
    map.get(s.agent)!.push(s);
  }
  return map;
}

// The single state the *whole* capsule reacts to (halo + aurora sweep). Most
// urgent wins: an error anywhere should colour the island red even if another
// session is happily working.
function overallStatus(sessions: SessionState[]): AgentStatus {
  const has = (s: AgentStatus) => sessions.some((x) => x.status === s);
  if (has("error")) return "error";
  if (has("working")) return "working";
  if (has("done")) return "done";
  return "idle";
}

export function Island({ sessions, memos, system }: Props) {
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);

  const islandRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Close the panel when the window loses focus (user clicked another app).
  useEffect(() => {
    return window.light?.onBlur(() => setOpen(false));
  }, []);

  // Hover source of truth. In the real app, the main process cursor poll is
  // authoritative (DOM mouseenter/leave are unreliable under the click-through
  // window). In the browser dev mock there's no onHover, so we fall back to DOM
  // events on the island/panel.
  const bridgeDrivesHover = typeof window !== "undefined" && !!window.light?.onHover;
  useEffect(() => {
    if (!window.light?.onHover) return;
    return window.light.onHover((over) => setHover(over));
  }, []);

  // Auto-collapse the panel a beat after the cursor leaves the island+panel
  // hot zone — the reliable replacement for "click outside to dismiss" (the
  // window never takes focus, so outside clicks can't blur it). Staying inside
  // keeps it open; returning cancels the close. A held input lease (mouse
  // pressed, or a text input focused) also counts as "staying": both mean the
  // user is mid-interaction and the panel must not collapse under them.
  const busyRef = useRef({ pointer: false, focus: false });
  const [busyTick, setBusyTick] = useState(0);
  useEffect(() => {
    if (!open || hover || busyTick < 0) return;
    if (busyRef.current.pointer || busyRef.current.focus) return;
    const t = setTimeout(() => setOpen(false), 1500);
    return () => clearTimeout(t);
  }, [open, hover, busyTick]);

  // Report the input lease to the main process (dedup: only on change).
  //   pointer — any mouse button held anywhere: the poll must not flip the
  //     window click-through mid-press, or the pending pointerup is swallowed.
  //   focus — a text input has keyboard focus: the poll must not steal focus
  //     (delayed blur → panel collapses → memo draft lost) while the cursor
  //     wanders outside the hot zones without the user clicking another app.
  const reportBusy = useCallback(() => {
    window.light?.setInputBusy({ ...busyRef.current });
    setBusyTick((n) => n + 1); // re-run the auto-collapse guard above
  }, []);
  useEffect(() => {
    const isText = (t: EventTarget | null): boolean =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const onDown = () => {
      if (!busyRef.current.pointer) {
        busyRef.current.pointer = true;
        reportBusy();
      }
    };
    const onUp = () => {
      if (busyRef.current.pointer) {
        busyRef.current.pointer = false;
        reportBusy();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const next = isText(e.target);
      if (next !== busyRef.current.focus) {
        busyRef.current.focus = next;
        reportBusy();
      }
    };
    const onFocusOut = () => {
      // focusout fires before the follow-up focusin when focus moves between
      // two inputs, so always drop first and let focusin re-assert.
      if (busyRef.current.focus) {
        busyRef.current.focus = false;
        reportBusy();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    // Window blur (Alt-Tab etc.) also means the pointerup is gone.
    window.addEventListener("blur", onUp);
    window.addEventListener("focusout", onFocusOut, true);
    window.addEventListener("focusin", onFocusIn, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onUp);
      window.removeEventListener("focusout", onFocusOut, true);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  }, [reportBusy]);

  // Report island & panel rects to main process for cursor-based hover detection.
  const confirm = useConfirmState();
  const reportHotZones = () => {
    const bridge = window.light;
    if (!bridge) return;
    const zones: HotZone[] = [];
    // The modal mask spans the whole window — while it's up, every pixel of
    // the (mostly transparent) window must be interactive so the mask can
    // catch clicks instead of letting them fall through to other apps.
    if (confirm.request) {
      zones.push({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
    }
    const padding = 6;
    const island = islandRef.current?.getBoundingClientRect();
    if (island && island.width > 0) {
      zones.push({
        x: island.left - padding,
        y: island.top - padding,
        w: island.width + padding * 2,
        h: island.height + padding * 2,
      });
    }
    const panel = panelRef.current?.getBoundingClientRect();
    if (panel && panel.width > 0) {
      zones.push({
        x: panel.left - padding,
        y: panel.top - padding,
        w: panel.width + padding * 2,
        h: panel.height + padding * 2,
      });
    }
    bridge.setHotZones(zones);
  };

  useLayoutEffect(() => {
    reportHotZones();
  });

  useEffect(() => {
    const ro = new ResizeObserver(() => reportHotZones());
    if (islandRef.current) ro.observe(islandRef.current);
    if (stageRef.current) ro.observe(stageRef.current);
    const onResize = () => reportHotZones();
    window.addEventListener("resize", onResize);
    const id = setInterval(reportHotZones, 200);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      clearInterval(id);
    };
  }, []);

  // Show every agent that has a live session — including idle ones, so Claude
  // Code stays visible with its idle/working/done state. Sessions are removed
  // on session_end (window closed) or GC'd after 30 min of silence.
  const grouped = groupByAgent(sessions);
  const agents = AGENT_ORDER.filter((a) => grouped.has(a));

  const media = system.media;
  const musicOn = Boolean(media && media.title);

  const hasContent = agents.length > 0 || musicOn;
  const isMinimal = !hasContent;
  const status = overallStatus(sessions);

  const handleClick = () => setOpen((v) => !v);
  // Hover expands the pill and keeps the panel alive. When the main process
  // drives hover (real app), ignore DOM enter/leave so the two can't fight
  // (which is what left the pill stuck "expanded"). In the mock, DOM events
  // are the only signal, so use them.
  const handleEnter = bridgeDrivesHover ? undefined : () => setHover(true);
  const handleLeave = bridgeDrivesHover ? undefined : () => setHover(false);

  // The island hugs its content (width:auto via .island-row) and framer's
  // `layout` animates size changes — so there's never empty space on the right.
  return (
    <ConfirmContext.Provider value={confirm.raise}>
      <div className="stage" ref={stageRef}>
      <motion.div
        ref={islandRef}
        className={`island s-${status} ${isMinimal ? "minimal" : ""} ${open ? "open" : ""}`}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        layout
        whileHover={{ y: -2 }}
        transition={{ type: "spring", stiffness: 300, damping: 26 }}
      >
        <span className="aurora" aria-hidden="true" />
        <span className="glass-sheen" aria-hidden="true" />
        <AnimatePresence mode="wait" initial={false}>
          {isMinimal ? (
            <motion.div
              key="minimal"
              className="agents minimal-inner"
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClick}
            >
              <span className="dot idle" />
              <span className="sub" style={{ opacity: hover || open ? 0.7 : 0 }}>
                Light
              </span>
            </motion.div>
          ) : (
            <motion.div
              key="content"
              className="island-row"
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={handleClick}
            >
              <div className="agents">
                {agents.map((a) => (
                  <AgentPill
                    key={a}
                    agent={a}
                    sessions={grouped.get(a)!}
                    expanded={hover || open}
                  />
                ))}
              </div>
              {musicOn && agents.length > 0 && <span className="vsep" />}
              {musicOn && <MediaCompact media={media!} />}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {open && (
          <div ref={panelRef} onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
            <ExpandPanel
              sessions={sessions.filter((s) => s.status !== "idle" || s.recent.length > 0)}
              memos={memos}
              system={system}
            />
          </div>
        )}
      </AnimatePresence>
      </div>
      <ConfirmDialog request={confirm.request} onSettle={confirm.settle} />
    </ConfirmContext.Provider>
  );
}
