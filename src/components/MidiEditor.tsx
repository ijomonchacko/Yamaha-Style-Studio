import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MidiEvent } from "../lib/binary/midiParser";
import {
  cloneNotes,
  deleteNotesAt,
  extractNotes,
  findNoteIndices,
  moveNotes,
  noteRangeOf,
  pasteNotesAt,
  quantizeNotes,
  replaceNotes,
  resizeNote,
  RolledNote,
  setNotesVelocity,
  snapNotesToMarkers,
  snapTick,
  transposeNotes
} from "../lib/midi/noteEdit";
import { StyleRole } from "./ChannelMatrix";

export interface MidiEditorProps {
  open: boolean;
  role: StyleRole;
  fileName: string;
  color: string;
  events: MidiEvent[];
  lengthTicks: number;
  bars: number;
  snapTicks: number;
  playhead: number;
  playing: boolean;
  defaultChannel: number;
  onClose: () => void;
  /** Commit edited events back to Live Preview / project state. */
  onSave: (role: StyleRole, events: MidiEvent[]) => void;
  /** Push draft to Live Preview engine without closing (for audio preview). */
  onSyncPreview?: (role: StyleRole, events: MidiEvent[]) => void;
  /**
   * Transport control for the editor.
   * `"all"` / `"solo"` always start (restarting if already playing).
   * `"stop"` pauses and clears isolation.
   */
  onPlayMode?: (mode: "all" | "solo" | "stop") => void | Promise<void>;
}

type Tool = "select" | "draw" | "erase";
type DragMode =
  | "marquee"
  | "move"
  | "resize-start"
  | "resize-end"
  | "draw";

interface DragState {
  mode: DragMode;
  originX: number;
  originY: number;
  notes0: RolledNote[];
  selected0: number[];
  pointerId: number;
  startTick?: number;
  endTick?: number;
  pitch?: number;
  drawChannel?: number;
}

const EDGE_PX = 7;
const KEY_W = 52;
const HEADER_H = 36;
const MIN_NOTE_H = 12;
const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;

const CLIP_KEY = "aus-live-midi-clip";

function midiPitchLabel(midi: number): string {
  const n = Math.max(0, Math.min(127, Math.round(midi)));
  const oct = Math.floor(n / 12) - 1;
  return `${PITCH_NAMES[n % 12]}${oct}`;
}

function loadClipboard(): RolledNote[] {
  try {
    const raw = sessionStorage.getItem(CLIP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RolledNote[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveClipboard(notes: RolledNote[]) {
  try {
    sessionStorage.setItem(CLIP_KEY, JSON.stringify(notes));
  } catch { /* ignore */ }
}

/**
 * Full-screen MIDI piano-roll editor.
 * Edits a working copy; Save writes back to Live Preview via onSave.
 */
export function MidiEditor(props: MidiEditorProps) {
  const {
    open, role, fileName, color, events, lengthTicks, bars, snapTicks,
    playhead, playing, defaultChannel, onClose, onSave, onSyncPreview, onPlayMode
  } = props;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [draftEvents, setDraftEvents] = useState<MidiEvent[]>([]);
  const [history, setHistory] = useState<MidiEvent[][]>([]);
  const [future, setFuture] = useState<MidiEvent[][]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<Tool>("select");
  const [snap, setSnap] = useState(snapTicks);
  const [velocity, setVelocity] = useState(96);
  const [dirty, setDirty] = useState(false);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverEdge, setHoverEdge] = useState<"start" | "end" | "body" | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [previewNotes, setPreviewNotes] = useState<RolledNote[] | null>(null);
  const [scrollPitch, setScrollPitch] = useState(0); // 0 = top of full range
  const [pitchSpan, setPitchSpan] = useState(36);
  const dragRef = useRef<DragState | null>(null);
  /** Snapshot at open so Cancel can restore Live Preview after audio sync. */
  const originalEventsRef = useRef<MidiEvent[]>([]);
  const draftRef = useRef<MidiEvent[]>([]);
  const playingRef = useRef(playing);
  /** Last start mode — Space pauses, or restarts with same mode. */
  const [playMode, setPlayMode] = useState<"all" | "solo">("all");
  const playModeRef = useRef<"all" | "solo">("all");
  /** Animation clock for playhead glow / note pulse while playing. */
  const [animT, setAnimT] = useState(0);

  useEffect(() => { draftRef.current = draftEvents; }, [draftEvents]);
  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { playModeRef.current = playMode; }, [playMode]);

  useEffect(() => {
    if (!open || !playing) return;
    let raf = 0;
    const tick = (t: number) => {
      setAnimT(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open, playing]);

  // Load working copy when opening / role changes
  useEffect(() => {
    if (!open) return;
    const copy = events.map(e => ({ ...e }));
    originalEventsRef.current = events.map(e => ({ ...e }));
    setDraftEvents(copy);
    draftRef.current = copy;
    setHistory([]);
    setFuture([]);
    setSelected(new Set());
    setDirty(false);
    setPreviewNotes(null);
    setSnap(snapTicks);
    setTool("select");
    setPlayMode("all");
    playModeRef.current = "all";
  }, [open, role, events, snapTicks]);

  const togglePlay = useCallback(async (mode?: "all" | "solo") => {
    // Same mode (or Space with no arg) while playing → pause.
    if (playingRef.current && (!mode || mode === playModeRef.current)) {
      await onPlayMode?.("stop");
      return;
    }
    const m = mode ?? playModeRef.current;
    setPlayMode(m);
    playModeRef.current = m;
    onSyncPreview?.(role, draftRef.current);
    await onPlayMode?.(m);
  }, [onSyncPreview, onPlayMode, role]);

  const baseNotes = useMemo(() => extractNotes(draftEvents), [draftEvents]);
  const notes = previewNotes ?? baseNotes;
  const fullRange = useMemo(() => {
    const r = noteRangeOf(baseNotes);
    return {
      lo: Math.max(0, Math.min(r.lo, 36)),
      hi: Math.min(127, Math.max(r.hi, 84))
    };
  }, [baseNotes]);

  const viewLo = useMemo(() => {
    const maxLo = Math.max(0, fullRange.hi - pitchSpan + 1);
    return Math.max(fullRange.lo, Math.min(maxLo, fullRange.lo + scrollPitch));
  }, [fullRange, pitchSpan, scrollPitch]);
  const viewHi = Math.min(127, viewLo + pitchSpan - 1);

  const commit = useCallback((nextNotes: RolledNote[], select?: number[] | RolledNote[]) => {
    const nextEvents = replaceNotes(draftEvents, nextNotes);
    const rebuilt = extractNotes(nextEvents);
    setHistory(h => [...h.slice(-49), draftEvents]);
    setFuture([]);
    setDraftEvents(nextEvents);
    setDirty(true);
    setPreviewNotes(null);
    if (select) {
      // Re-resolve selection after sort so ←/→ never retarget wrong (high) notes.
      if (select.length && typeof select[0] === "object") {
        setSelected(new Set(findNoteIndices(rebuilt, select as RolledNote[])));
      } else {
        const targets = (select as number[]).map(i => nextNotes[i]).filter(Boolean);
        setSelected(new Set(findNoteIndices(rebuilt, targets)));
      }
    }
  }, [draftEvents]);

  const undo = useCallback(() => {
    setHistory(h => {
      if (!h.length) return h;
      const prev = h[h.length - 1];
      setFuture(f => [draftEvents, ...f].slice(0, 50));
      setDraftEvents(prev);
      setDirty(true);
      setSelected(new Set());
      return h.slice(0, -1);
    });
  }, [draftEvents]);

  const redo = useCallback(() => {
    setFuture(f => {
      if (!f.length) return f;
      const [next, ...rest] = f;
      setHistory(h => [...h, draftEvents].slice(-50));
      setDraftEvents(next);
      setDirty(true);
      setSelected(new Set());
      return rest;
    });
  }, [draftEvents]);

  const layout = useCallback((w: number, h: number) => {
    const gridW = Math.max(1, w - KEY_W);
    const gridH = Math.max(1, h - HEADER_H);
    const span = Math.max(1, viewHi - viewLo + 1);
    const rowH = gridH / span;
    return { gridW, gridH, span, rowH, w, h };
  }, [viewLo, viewHi]);

  const noteRect = useCallback((n: RolledNote, w: number, h: number) => {
    const { gridW, gridH, rowH } = layout(w, h);
    const x1 = KEY_W + (n.start / Math.max(1, lengthTicks)) * gridW;
    const x2 = KEY_W + (Math.min(n.end, lengthTicks) / Math.max(1, lengthTicks)) * gridW;
    const y = HEADER_H + gridH - ((n.note - viewLo + 0.5) * rowH);
    const nh = Math.max(MIN_NOTE_H, rowH * 0.78);
    return { x: x1, y: y - nh / 2, w: Math.max(4, x2 - x1), h: nh };
  }, [layout, lengthTicks, viewLo]);

  const hitTest = useCallback((mx: number, my: number, w: number, h: number) => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const r = noteRect(notes[i], w, h);
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        let edge: "start" | "end" | "body" = "body";
        if (r.w > EDGE_PX * 2.5) {
          if (mx - r.x <= EDGE_PX) edge = "start";
          else if (r.x + r.w - mx <= EDGE_PX) edge = "end";
        }
        return { index: i, edge };
      }
    }
    return null;
  }, [notes, noteRect]);

  const xyToTickPitch = useCallback((mx: number, my: number, w: number, h: number) => {
    const { gridW, gridH, rowH } = layout(w, h);
    const tick = Math.max(0, Math.min(lengthTicks, ((mx - KEY_W) / gridW) * lengthTicks));
    const relY = Math.max(0, Math.min(gridH, my - HEADER_H));
    // Top of grid = viewHi, bottom = viewLo
    const note = Math.round(viewHi - (relY / Math.max(1e-6, rowH)));
    return {
      tick: snapTick(tick, snap),
      note: Math.max(0, Math.min(127, note)),
      inGrid: mx >= KEY_W && my >= HEADER_H && mx <= KEY_W + gridW && my <= HEADER_H + gridH
    };
  }, [layout, lengthTicks, snap, viewHi]);

  // Draw
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { gridW, gridH, rowH } = layout(w, h);

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0c1220");
    bg.addColorStop(1, "#080b14");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const pulse = playing ? 0.5 + 0.5 * Math.sin(animT / 280) : 0;

    // Piano keys + pitch names on every visible row
    for (let p = viewLo; p <= viewHi; p++) {
      const y = HEADER_H + gridH - ((p - viewLo + 1) * rowH);
      const isBlack = [1, 3, 6, 8, 10].includes(p % 12);
      const isC = p % 12 === 0;
      ctx.fillStyle = isBlack ? "#101624" : "#1a2438";
      ctx.fillRect(0, y, KEY_W, rowH);
      if (isC) {
        ctx.fillStyle = "rgba(94,200,255,0.08)";
        ctx.fillRect(0, y, KEY_W, rowH);
      }
      ctx.strokeStyle = "rgba(148,163,184,0.1)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(KEY_W, y);
      ctx.stroke();

      const label = midiPitchLabel(p);
      const fontPx = Math.max(8, Math.min(11, rowH * 0.55));
      ctx.font = `${isC ? "600 " : "500 "}${fontPx}px "JetBrains Mono", monospace`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isC
        ? "rgba(125,223,255,0.95)"
        : isBlack
          ? "rgba(148,163,184,0.55)"
          : "rgba(226,232,240,0.78)";
      ctx.fillText(label, KEY_W - 5, y + rowH / 2);
    }

    // Grid pitch lanes
    for (let p = viewLo; p <= viewHi; p++) {
      const y = HEADER_H + gridH - ((p - viewLo + 1) * rowH);
      const isBlack = [1, 3, 6, 8, 10].includes(p % 12);
      const isC = p % 12 === 0;
      ctx.fillStyle = isBlack ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.0)";
      ctx.fillRect(KEY_W, y, gridW, rowH);
      if (isC) {
        ctx.fillStyle = "rgba(94,200,255,0.035)";
        ctx.fillRect(KEY_W, y, gridW, rowH);
      }
      ctx.strokeStyle = isC ? "rgba(94,200,255,0.12)" : "rgba(148,163,184,0.06)";
      ctx.beginPath();
      ctx.moveTo(KEY_W, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Timeline header + bar/beat markers
    const headGrad = ctx.createLinearGradient(0, 0, 0, HEADER_H);
    headGrad.addColorStop(0, "#141c30");
    headGrad.addColorStop(1, "#0c1220");
    ctx.fillStyle = headGrad;
    ctx.fillRect(KEY_W, 0, gridW, HEADER_H);

    // Corner badge
    ctx.fillStyle = "#0a0e18";
    ctx.fillRect(0, 0, KEY_W, HEADER_H);
    ctx.fillStyle = "rgba(148,163,184,0.7)";
    ctx.font = "600 9px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("NOTE", KEY_W / 2, HEADER_H / 2);

    if (bars > 0) {
      const beatsPerBar = 4;
      const totalBeats = bars * beatsPerBar;
      const sixteenths = bars * 16;
      for (let i = 0; i <= sixteenths; i++) {
        if (i % 4 === 0) continue;
        const x = KEY_W + Math.round((gridW / sixteenths) * i) + 0.5;
        ctx.strokeStyle = "rgba(148,163,184,0.045)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, HEADER_H);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let i = 0; i <= totalBeats; i++) {
        const x = KEY_W + Math.round((gridW / totalBeats) * i) + 0.5;
        const isBar = i % beatsPerBar === 0;
        if (isBar) {
          ctx.strokeStyle = "rgba(94,200,255,0.32)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, HEADER_H);
          ctx.lineTo(x, h);
          ctx.stroke();
          // Bar marker pip
          ctx.fillStyle = "rgba(94,200,255,0.9)";
          ctx.beginPath();
          ctx.moveTo(x, 5);
          ctx.lineTo(x + 4, HEADER_H / 2);
          ctx.lineTo(x, HEADER_H - 5);
          ctx.lineTo(x - 4, HEADER_H / 2);
          ctx.closePath();
          ctx.fill();
          if (i < totalBeats) {
            ctx.fillStyle = "rgba(226,232,240,0.9)";
            ctx.font = "600 11px Inter, sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`Bar ${i / beatsPerBar + 1}`, x + 8, HEADER_H / 2);
          }
        } else {
          ctx.strokeStyle = "rgba(148,163,184,0.12)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, HEADER_H);
          ctx.lineTo(x, h);
          ctx.stroke();
          ctx.fillStyle = "rgba(148,163,184,0.4)";
          ctx.fillRect(x - 1.5, HEADER_H - 7, 3, 7);
        }
      }
    }

    // Notes with labels + soft animation
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (n.note < viewLo || n.note > viewHi) continue;
      const r = noteRect(n, w, h);
      const isSel = selected.has(i);
      const isHov = hoverIdx === i;
      const mid = (n.start + n.end) / 2 / Math.max(1, lengthTicks);
      const nearPlay = playing && Math.abs(playhead - mid) < 0.04;
      const alpha = Math.min(1, 0.32 + 0.58 * (n.velocity / 127) + (nearPlay ? pulse * 0.18 : 0));

      // Soft outer glow for selected / active
      if (isSel || nearPlay) {
        ctx.globalAlpha = isSel ? 0.22 : 0.12 + pulse * 0.08;
        ctx.fillStyle = isSel ? "#fff" : color;
        roundRect(ctx, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 5);
        ctx.fill();
      }

      ctx.globalAlpha = alpha;
      const noteGrad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      if (isSel) {
        noteGrad.addColorStop(0, "#ffffff");
        noteGrad.addColorStop(1, "#dbeafe");
      } else {
        noteGrad.addColorStop(0, color);
        noteGrad.addColorStop(1, shadeColor(color, -28));
      }
      ctx.fillStyle = noteGrad;
      roundRect(ctx, r.x, r.y, r.w, r.h, 4);
      ctx.fill();

      // Velocity stripe on left edge
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = isSel ? "rgba(10,14,24,0.35)" : "rgba(255,255,255,0.25)";
      const stripeW = Math.min(4, Math.max(2, r.w * 0.08));
      ctx.fillRect(r.x + 1, r.y + 2, stripeW, Math.max(2, r.h - 4));

      ctx.globalAlpha = isSel ? 1 : isHov ? 0.95 : 0.45;
      ctx.strokeStyle = isSel ? "#fff" : isHov ? "#e2e8f0" : "rgba(0,0,0,0.35)";
      ctx.lineWidth = isSel ? 1.75 : 1;
      roundRect(ctx, r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1), 4);
      ctx.stroke();

      // Note name on the event (timeline body)
      const name = midiPitchLabel(n.note);
      const canLabel = r.w >= 22 && r.h >= 11;
      if (canLabel) {
        ctx.globalAlpha = isSel ? 0.95 : 0.88;
        ctx.fillStyle = isSel ? "#0a0e18" : "rgba(255,255,255,0.92)";
        const fontPx = Math.max(8, Math.min(11, r.h * 0.62));
        ctx.font = `600 ${fontPx}px "JetBrains Mono", monospace`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const textX = r.x + stripeW + 4;
        const maxTextW = r.w - stripeW - 8;
        if (ctx.measureText(name).width <= maxTextW) {
          ctx.fillText(name, textX, r.y + r.h / 2);
        } else if (r.w >= 16) {
          // Short form: pitch class only when tight
          const short = PITCH_NAMES[n.note % 12];
          if (ctx.measureText(short).width <= maxTextW) {
            ctx.fillText(short, textX, r.y + r.h / 2);
          }
        }
      }

      if ((isSel || isHov) && r.w > EDGE_PX * 2.5) {
        ctx.globalAlpha = 0.95;
        ctx.fillStyle = isSel ? "#0a0e18" : "rgba(255,255,255,0.85)";
        const hw = 3;
        const hh = Math.max(4, r.h - 4);
        ctx.fillRect(r.x + 1, r.y + (r.h - hh) / 2, hw, hh);
        ctx.fillRect(r.x + r.w - hw - 1, r.y + (r.h - hh) / 2, hw, hh);
      }
    }
    ctx.globalAlpha = 1;

    // Marquee
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      const mw = Math.abs(marquee.x1 - marquee.x0);
      const mh = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = "rgba(94,200,255,0.1)";
      ctx.strokeStyle = "rgba(94,200,255,0.65)";
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, mw, mh);
      ctx.strokeRect(x + 0.5, y + 0.5, mw, mh);
    }

    // Playhead + time readout
    if (playhead >= 0 && playhead <= 1) {
      const px = KEY_W + playhead * gridW;
      if (playing) {
        ctx.globalAlpha = 0.12 + pulse * 0.08;
        ctx.fillStyle = "#f472b6";
        ctx.fillRect(px - 6, 0, 12, h);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = playing ? "#f472b6" : "rgba(244,114,182,0.45)";
      ctx.lineWidth = playing ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      // Head triangle
      ctx.fillStyle = playing ? "#f472b6" : "rgba(244,114,182,0.7)";
      ctx.beginPath();
      ctx.moveTo(px - 5, 2);
      ctx.lineTo(px + 5, 2);
      ctx.lineTo(px, 10);
      ctx.closePath();
      ctx.fill();

      // Bar:beat near playhead in timeline header
      if (bars > 0) {
        const totalBeats = bars * 4;
        const beatPos = playhead * totalBeats;
        const barN = Math.min(bars, Math.floor(beatPos / 4) + 1);
        const beatN = Math.floor(beatPos % 4) + 1;
        const tag = `${barN}.${beatN}`;
        ctx.font = "600 10px 'JetBrains Mono', monospace";
        const tw = ctx.measureText(tag).width + 10;
        const tx = Math.min(w - tw - 4, Math.max(KEY_W + 4, px - tw / 2));
        ctx.fillStyle = "rgba(10,14,24,0.85)";
        roundRect(ctx, tx, 3, tw, 14, 4);
        ctx.fill();
        ctx.fillStyle = "#fda4af";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tag, tx + tw / 2, 10);
      }
    }

    // Dividers
    ctx.strokeStyle = "rgba(148,163,184,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(KEY_W + 0.5, 0);
    ctx.lineTo(KEY_W + 0.5, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, HEADER_H + 0.5);
    ctx.lineTo(w, HEADER_H + 0.5);
    ctx.stroke();
  }, [
    open, notes, selected, hoverIdx, marquee, color, playhead, playing,
    viewLo, viewHi, bars, lengthTicks, layout, noteRect, animT
  ]);

  // Resize observer redraw via state
  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const ro = new ResizeObserver(() => {
      // force paint by toggling a noop — canvas uses clientWidth each draw
      setHoverIdx(h => h);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [open]);

  const localXY = (e: React.PointerEvent | PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      w: rect.width,
      h: rect.height
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const { x, y, w, h } = localXY(e);
    if (x < KEY_W || y < HEADER_H) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const hit = hitTest(x, y, w, h);
    const { tick, note } = xyToTickPitch(x, y, w, h);
    const notes0 = baseNotes.map(n => ({ ...n }));

    if (tool === "draw") {
      const start = tick;
      const end = Math.max(start + Math.max(1, snap), start + snap);
      const drawn: RolledNote = {
        note,
        start,
        end,
        velocity,
        channel: defaultChannel
      };
      const next = [...notes0, drawn];
      dragRef.current = {
        mode: "draw",
        originX: x,
        originY: y,
        notes0: next,
        selected0: [next.length - 1],
        pointerId: e.pointerId,
        startTick: start,
        endTick: end,
        pitch: note,
        drawChannel: defaultChannel
      };
      setPreviewNotes(next);
      setSelected(new Set([next.length - 1]));
      return;
    }

    if (tool === "erase") {
      if (hit) {
        commit(deleteNotesAt(notes0, [hit.index]));
        setSelected(new Set());
      }
      return;
    }

    // select tool
    if (!hit) {
      if (!e.shiftKey) setSelected(new Set());
      dragRef.current = {
        mode: "marquee",
        originX: x,
        originY: y,
        notes0,
        selected0: e.shiftKey ? [...selected] : [],
        pointerId: e.pointerId
      };
      setMarquee({ x0: x, y0: y, x1: x, y1: y });
      return;
    }

    let sel = new Set(selected);
    if (e.shiftKey) {
      if (sel.has(hit.index)) sel.delete(hit.index);
      else sel.add(hit.index);
    } else if (!sel.has(hit.index)) {
      sel = new Set([hit.index]);
    }
    setSelected(sel);

    const mode: DragMode =
      hit.edge === "start" ? "resize-start"
        : hit.edge === "end" ? "resize-end"
          : "move";

    dragRef.current = {
      mode,
      originX: x,
      originY: y,
      notes0,
      selected0: [...sel],
      pointerId: e.pointerId,
      startTick: notes0[hit.index].start,
      endTick: notes0[hit.index].end,
      pitch: notes0[hit.index].note
    };
    setPreviewNotes(notes0);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y, w, h } = localXY(e);
    const drag = dragRef.current;

    if (!drag) {
      const hit = hitTest(x, y, w, h);
      setHoverIdx(hit?.index ?? null);
      setHoverEdge(hit?.edge ?? null);
      return;
    }

    e.preventDefault();
    const dx = x - drag.originX;
    const dTickRaw = (dx / Math.max(1, w - KEY_W)) * lengthTicks;

    if (drag.mode === "marquee") {
      setMarquee({ x0: drag.originX, y0: drag.originY, x1: x, y1: y });
      const x0 = Math.min(drag.originX, x);
      const x1 = Math.max(drag.originX, x);
      const y0 = Math.min(drag.originY, y);
      const y1 = Math.max(drag.originY, y);
      const next = new Set(drag.selected0);
      for (let i = 0; i < drag.notes0.length; i++) {
        const r = noteRect(drag.notes0[i], w, h);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) next.add(i);
      }
      setSelected(next);
      return;
    }

    if (drag.mode === "draw") {
      const { tick } = xyToTickPitch(x, y, w, h);
      const start = drag.startTick ?? 0;
      const end = Math.max(start + Math.max(1, snap), tick);
      const next = drag.notes0.map((n, i) =>
        i === drag.notes0.length - 1
          ? { ...n, end, note: drag.pitch ?? n.note }
          : n
      );
      setPreviewNotes(next);
      return;
    }

    const dy = y - drag.originY;
    // Fixed px/semitone (not tied to zoom) so drag stays gentle at any zoom.
    const PX_PER_SEMI = 28;
    const dPitch = -Math.trunc(dy / PX_PER_SEMI);
    let next = drag.notes0.map(n => ({ ...n }));
    const step = Math.max(1, snap);
    const snappedDelta = Math.round(dTickRaw / step) * step;

    if (drag.mode === "move") {
      next = moveNotes(drag.notes0, drag.selected0, snappedDelta, dPitch);
    } else if (drag.mode === "resize-end" && drag.selected0.length === 1) {
      const idx = drag.selected0[0];
      const origin = drag.notes0[idx];
      let end = snapTick(origin.end + dTickRaw, snap);
      end = Math.max(origin.start + Math.max(1, snap), Math.min(lengthTicks * 2, end));
      next = resizeNote(next, idx, "end", end);
    } else if (drag.mode === "resize-start" && drag.selected0.length === 1) {
      const idx = drag.selected0[0];
      const origin = drag.notes0[idx];
      let start = snapTick(origin.start + dTickRaw, snap);
      start = Math.max(0, Math.min(origin.end - Math.max(1, snap), start));
      next = resizeNote(next, idx, "start", start);
    }
    setPreviewNotes(next);
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    try { (e.target as HTMLElement).releasePointerCapture?.(drag.pointerId); } catch { /* */ }

    if (drag.mode === "marquee") {
      setMarquee(null);
      dragRef.current = null;
      return;
    }

    if (previewNotes) {
      if (drag.mode === "draw") {
        commit(previewNotes, [previewNotes.length - 1]);
      } else {
        commit(previewNotes, drag.selected0);
      }
    }
    dragRef.current = null;
    setPreviewNotes(null);
    setMarquee(null);
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(baseNotes.map((_, i) => i)));
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const clip = cloneNotes([...selected].map(i => baseNotes[i]).filter(Boolean));
        saveClipboard(clip);
        return;
      }
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        const clip = cloneNotes([...selected].map(i => baseNotes[i]).filter(Boolean));
        saveClipboard(clip);
        commit(deleteNotesAt(baseNotes, selected));
        setSelected(new Set());
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        e.preventDefault();
        const clip = loadClipboard();
        if (!clip.length) return;
        const pasteTick = selected.size
          ? Math.max(...[...selected].map(i => baseNotes[i]?.end ?? 0))
          : Math.round(playhead * lengthTicks);
        const { notes: next, newIndices } = pasteNotesAt(baseNotes, clip, pasteTick, defaultChannel);
        commit(next, newIndices);
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (!selected.size) return;
        const { notes: next, newIndices } = (() => {
          const idx = [...selected];
          const copies = idx.map(i => baseNotes[i]).filter(Boolean);
          return pasteNotesAt(baseNotes, copies, Math.min(...copies.map(n => n.start)) + snap, defaultChannel);
        })();
        commit(next, newIndices);
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave(role, draftEvents);
        setDirty(false);
        return;
      }
      // Space = play / pause current mode; Shift+Space = this MIDI only
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        if (e.shiftKey) void togglePlay("solo");
        else void togglePlay();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (!selected.size) return;
        commit(deleteNotesAt(baseNotes, selected));
        setSelected(new Set());
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        if (!selected.size) return;
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        // Time only — never pitch. ←/→ = 1 tick · Shift = snap · Ctrl = beat
        const step = (e.ctrlKey || e.metaKey)
          ? Math.max(1, snap * 4)
          : e.shiftKey
            ? Math.max(1, snap)
            : 1;
        const idxs = [...selected];
        const moved = moveNotes(baseNotes, selected, step * dir, 0);
        // moveNotes keeps index slots; re-resolve after extractNotes sort
        commit(moved, idxs.map(i => moved[i]).filter(Boolean));
        return;
      }
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        if (!selected.size) return;
        const dir = e.key === "ArrowUp" ? 1 : -1;
        // Pitch only. ↑/↓ = 1 st · Shift = octave
        const amount = (e.shiftKey ? 12 : 1) * dir;
        const idxs = [...selected];
        const moved = moveNotes(baseNotes, selected, 0, amount);
        commit(moved, idxs.map(i => moved[i]).filter(Boolean));
        return;
      }
      if (e.key === "1") setTool("select");
      if (e.key === "2") setTool("draw");
      if (e.key === "3") setTool("erase");
      // M = magnet to beat/bar markers
      if (e.key.toLowerCase() === "m" && !mod) {
        e.preventDefault();
        const idxs = selected.size ? selected : null;
        const bt = Math.max(1, Math.round(lengthTicks / Math.max(1, bars)));
        const beat = Math.max(1, Math.round(bt / 4));
        const next = snapNotesToMarkers(baseNotes, idxs, beat, Math.max(1, Math.round(beat / 2)));
        commit(next, selected.size ? [...selected].map(i => next[i]).filter(Boolean) : undefined);
        return;
      }
      if (e.key === "Escape") {
        if (dirty) {
          if (!window.confirm("Discard unsaved MIDI edits?")) return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    open, baseNotes, selected, snap, draftEvents, dirty, playhead, lengthTicks,
    bars, defaultChannel, role, undo, redo, commit, onSave, onClose, togglePlay
  ]);

  const doCopy = () => {
    const clip = cloneNotes([...selected].map(i => baseNotes[i]).filter(Boolean));
    saveClipboard(clip);
  };
  const doPaste = () => {
    const clip = loadClipboard();
    if (!clip.length) return;
    const pasteTick = selected.size
      ? Math.max(...[...selected].map(i => baseNotes[i]?.end ?? 0))
      : Math.round(playhead * lengthTicks);
    const { notes: next, newIndices } = pasteNotesAt(baseNotes, clip, pasteTick, defaultChannel);
    commit(next, newIndices);
  };
  const doDuplicate = () => {
    if (!selected.size) return;
    const copies = [...selected].map(i => baseNotes[i]).filter(Boolean);
    const { notes: next, newIndices } = pasteNotesAt(
      baseNotes,
      copies,
      Math.min(...copies.map(n => n.start)) + snap,
      defaultChannel
    );
    commit(next, newIndices);
  };
  const doDelete = () => {
    if (!selected.size) return;
    commit(deleteNotesAt(baseNotes, selected));
    setSelected(new Set());
  };
  const doQuantize = () => {
    const idxs = selected.size ? selected : null;
    commit(quantizeNotes(baseNotes, idxs, snap, "start"), selected.size ? [...selected] : undefined);
  };
  const barTicks = useMemo(
    () => Math.max(1, Math.round(lengthTicks / Math.max(1, bars))),
    [lengthTicks, bars]
  );

  /** Snap notes to nearest beat/bar marker. */
  const doMagnet = () => {
    const idxs = selected.size ? selected : null;
    const beat = Math.max(1, Math.round(barTicks / 4));
    const next = snapNotesToMarkers(baseNotes, idxs, beat, Math.max(1, Math.round(beat / 2)));
    commit(next, selected.size ? [...selected].map(i => next[i]).filter(Boolean) : undefined);
  };
  const doSelectAll = () => setSelected(new Set(baseNotes.map((_, i) => i)));
  const doTranspose = (st: number) => {
    if (!selected.size) return;
    commit(transposeNotes(baseNotes, selected, st), [...selected]);
  };
  const doVelocity = (v: number) => {
    setVelocity(v);
    if (!selected.size) return;
    commit(setNotesVelocity(baseNotes, selected, v), [...selected]);
  };

  const handleSave = () => {
    onSave(role, draftEvents);
    setDirty(false);
  };

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved MIDI edits?")) return;
    // Restore pre-edit events if we had pushed draft for audio preview.
    if (dirty) onSyncPreview?.(role, originalEventsRef.current);
    onClose();
  };

  if (!open) return null;

  const cursor =
    tool === "draw" ? "crosshair"
      : tool === "erase" ? "cell"
        : dragRef.current?.mode === "move" ? "grabbing"
          : hoverEdge === "start" || hoverEdge === "end" ? "ew-resize"
            : hoverIdx != null ? "grab"
              : "default";

  return (
    <div className="midi-editor-overlay" role="dialog" aria-modal="true" aria-label="MIDI editor">
      <div className="midi-editor">
        <header className="midi-editor-head">
          <div className="min-w-0 flex items-center gap-3">
            <span className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white/10" style={{ background: color }} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold truncate tracking-tight">Piano Roll · {role}</h2>
                {dirty && <span className="pill bg-accent2/15 text-accent2 border border-accent2/40">unsaved</span>}
                {playing && (
                  <span className="pill bg-good/10 text-good border border-good/30">
                    {playMode === "solo" ? "solo" : "mix"}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                {fileName} · {baseNotes.length} notes · {bars} bars
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className={`btn-primary !py-1.5 !px-2.5 text-xs ${playing && playMode === "all" ? "on" : ""}`}
              onClick={() => void togglePlay("all")}
              title="Play all lanes (Space)"
            >
              {playing && playMode === "all" ? "Pause" : "All"}
            </button>
            <button
              type="button"
              className={`midi-btn-solo btn-accent2 !py-1.5 !px-2.5 text-xs ${playing && playMode === "solo" ? "on" : ""}`}
              onClick={() => void togglePlay("solo")}
              title="This MIDI only (Shift+Space)"
            >
              {playing && playMode === "solo" ? "Pause" : "Solo"}
            </button>
            <button
              type="button"
              className={`btn-accent2 !py-1.5 !px-2.5 text-xs ${playing && playMode === "solo" ? "ring-1 ring-accent2/40" : ""}`}
              onClick={() => void togglePlay("solo")}
              title="This MIDI only (Shift+Space)"
            >
              {playing && playMode === "solo" ? "⏸ Pause" : "▶ Solo"}
            </button>
            <div className="w-px h-6 bg-edge mx-1" />
            <button type="button" className="btn-ghost !py-1.5 !px-2.5 text-xs" onClick={handleClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary !py-1.5 !px-3 text-xs font-semibold" onClick={handleSave}>
              Save
            </button>
          </div>
        </header>

        <div className="midi-editor-toolbar">
          <div className="tool-group">
            <button type="button" className={`tool-btn ${tool === "select" ? "on" : ""}`} onClick={() => setTool("select")} title="Select (1)">Select</button>
            <button type="button" className={`tool-btn ${tool === "draw" ? "on" : ""}`} onClick={() => setTool("draw")} title="Draw (2)">Draw</button>
            <button type="button" className={`tool-btn ${tool === "erase" ? "on" : ""}`} onClick={() => setTool("erase")} title="Erase (3)">Erase</button>
          </div>
          <div className="tool-sep" />
          <div className="tool-group">
            <button type="button" className="tool-btn" onClick={undo} disabled={!history.length} title="Undo ⌘Z">Undo</button>
            <button type="button" className="tool-btn" onClick={redo} disabled={!future.length} title="Redo ⌘Y">Redo</button>
          </div>
          <div className="tool-sep" />
          <div className="tool-group">
            <button type="button" className="tool-btn" onClick={doCopy} disabled={!selected.size} title="Copy ⌘C">Copy</button>
            <button type="button" className="tool-btn" onClick={doPaste} title="Paste ⌘V">Paste</button>
            <button type="button" className="tool-btn" onClick={doDuplicate} disabled={!selected.size} title="Duplicate ⌘D">Dup</button>
            <button type="button" className="tool-btn danger" onClick={doDelete} disabled={!selected.size} title="Delete">Del</button>
          </div>
          <div className="tool-sep" />
          <div className="tool-group">
            <button type="button" className="tool-btn" onClick={doSelectAll} title="Select all ⌘A">All</button>
            <button type="button" className="tool-btn" onClick={doQuantize} title="Quantize to snap">Quantize</button>
            <button type="button" className="tool-btn" onClick={doMagnet} title="Snap to beat/bar (M)">Snap bar</button>
          </div>
          <div className="tool-sep" />
          <div className="tool-group">
            <button type="button" className="tool-btn" onClick={() => doTranspose(-12)} disabled={!selected.size} title="Octave down">−8ve</button>
            <button type="button" className="tool-btn" onClick={() => doTranspose(-1)} disabled={!selected.size} title="Semitone down">−1</button>
            <button type="button" className="tool-btn" onClick={() => doTranspose(1)} disabled={!selected.size} title="Semitone up">+1</button>
            <button type="button" className="tool-btn" onClick={() => doTranspose(12)} disabled={!selected.size} title="Octave up">+8ve</button>
          </div>
          <div className="tool-sep" />
          <label className="tool-label">
            Grid
            <select className="tool-select" value={snap} onChange={(e) => setSnap(+e.target.value)}>
              <option value={Math.max(1, Math.round(snapTicks / 2))}>32nd</option>
              <option value={snapTicks}>16th</option>
              <option value={snapTicks * 2}>8th</option>
              <option value={snapTicks * 4}>Quarter</option>
              <option value={1}>Free</option>
            </select>
          </label>
          <label className="tool-label">
            Vel
            <input
              type="range" min={1} max={127} value={velocity}
              onChange={(e) => doVelocity(+e.target.value)}
              className="w-16 accent-accent"
            />
            <span className="hex text-[11px] w-6 tabular-nums">{velocity}</span>
          </label>
          <label className="tool-label ml-auto">
            Zoom
            <input
              type="range" min={18} max={72} value={pitchSpan}
              onChange={(e) => setPitchSpan(+e.target.value)}
              className="w-20 accent-accent"
              title="Pitch zoom"
            />
          </label>
        </div>

        <div ref={wrapRef} className="midi-editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="midi-editor-canvas"
            style={{ cursor, touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => {
              if (!dragRef.current) {
                setHoverIdx(null);
                setHoverEdge(null);
              }
            }}
            onWheel={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.ctrlKey || e.metaKey) {
                setPitchSpan(s => Math.max(18, Math.min(72, s + (e.deltaY > 0 ? 2 : -2))));
              } else if (e.shiftKey) {
                // horizontal-ish: still scroll pitch slowly
                setScrollPitch(p => {
                  const max = Math.max(0, fullRange.hi - fullRange.lo - pitchSpan + 1);
                  return Math.max(0, Math.min(max, p + (e.deltaY > 0 ? 1 : -1)));
                });
              } else {
                setScrollPitch(p => {
                  const max = Math.max(0, fullRange.hi - fullRange.lo - pitchSpan + 1);
                  return Math.max(0, Math.min(max, p + (e.deltaY > 0 ? 1 : -1)));
                });
              }
            }}
          />
        </div>

        <footer className="midi-editor-foot">
          <span>
            {selected.size ? `${selected.size} selected` : "none selected"}
            {" · "}
            {playing ? (playMode === "solo" ? "solo lane" : "full mix") : "stopped"}
          </span>
          <span className="text-slate-500 hidden sm:inline">
            1–3 tools · Space play · Shift+Space solo · ⌘S save · M snap bar
          </span>
        </footer>
      </div>
    </div>
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Darken/lighten a hex/rgb color for note gradients. */
function shadeColor(input: string, amount: number): string {
  const hex = input.trim();
  let r = 94, g = 200, b = 255;
  if (hex.startsWith("#") && (hex.length === 7 || hex.length === 4)) {
    if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    }
  }
  const clamp = (v: number) => Math.max(0, Math.min(255, v + amount));
  return `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
}
