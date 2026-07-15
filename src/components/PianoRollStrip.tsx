import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MidiEvent } from "../lib/binary/midiParser";
import {
  extractNotes,
  noteRangeOf,
  replaceNotes,
  resizeNote,
  RolledNote,
  shiftEventsByTicks,
  snapTick
} from "../lib/midi/noteEdit";

interface Props {
  events: MidiEvent[];
  channel: number;
  lengthTicks: number;
  playhead: number;
  bars?: number;
  height?: number;
  color?: string;
  playing?: boolean;
  /** Snap grid in ticks (e.g. tpq/4). */
  snapTicks?: number;
  editable?: boolean;
  selectedIndex?: number | null;
  onSelect?: (index: number | null) => void;
  onEventsChange?: (events: MidiEvent[]) => void;
}

type DragMode = "track" | "move" | "resize-start" | "resize-end" | "copy";

interface DragState {
  mode: DragMode;
  index: number;
  notes0: RolledNote[];
  originX: number;
  originY: number;
  startTick: number;
  startNote: number;
  endTick: number;
  pointerId: number;
  /** Live whole-track delta (track mode only). */
  trackDelta?: number;
}

const EDGE_PX = 6;

/**
 * Interactive piano-roll strip:
 *  - Drag empty area → shift entire MIDI on the timeline
 *  - Drag note body → move that note (time + pitch), fine sensitivity
 *  - Drag note edges → resize one note
 *  - Alt/Ctrl-drag a note → copy that note
 */
export function PianoRollStrip({
  events,
  channel: _channel,
  lengthTicks,
  playhead,
  bars = 4,
  height = 80,
  color = "#a78bfa",
  playing = false,
  snapTicks = 120,
  editable = false,
  selectedIndex = null,
  onSelect,
  onEventsChange
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverEdge, setHoverEdge] = useState<"start" | "end" | "body" | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragPreview, setDragPreview] = useState<RolledNote[] | null>(null);

  const baseNotes = useMemo(() => extractNotes(events), [events]);
  const notes = dragPreview ?? baseNotes;
  const noteRange = useMemo(() => noteRangeOf(notes), [notes]);

  const layout = useCallback((w: number, h: number) => {
    const span = Math.max(1, noteRange.hi - noteRange.lo);
    const rowH = h / span;
    return { span, rowH, w, h };
  }, [noteRange]);

  const noteRect = useCallback((n: RolledNote, w: number, h: number) => {
    const { rowH } = layout(w, h);
    const x1 = (n.start / lengthTicks) * w;
    const x2 = (Math.min(n.end, lengthTicks) / lengthTicks) * w;
    const y = h - ((n.note - noteRange.lo + 0.5) * rowH);
    const nh = Math.max(4, rowH * 0.72);
    return {
      x: x1,
      y: y - nh / 2,
      w: Math.max(3, x2 - x1),
      h: nh
    };
  }, [layout, lengthTicks, noteRange.lo]);

  const hitTest = useCallback((mx: number, my: number, w: number, h: number) => {
    // Topmost note wins (iterate reverse)
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

  // Draw
  useEffect(() => {
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

    // Backdrop with subtle pitch lanes
    ctx.fillStyle = "rgba(10,14,24,0.95)";
    ctx.fillRect(0, 0, w, h);

    const { rowH } = layout(w, h);
    for (let p = noteRange.lo; p <= noteRange.hi; p++) {
      const y = h - ((p - noteRange.lo + 0.5) * rowH);
      const isBlack = [1, 3, 6, 8, 10].includes(p % 12);
      if (isBlack) {
        ctx.fillStyle = "rgba(255,255,255,0.025)";
        ctx.fillRect(0, y - rowH / 2, w, rowH);
      }
    }

    // Beat + bar grid
    if (bars > 0) {
      const beatsPerBar = 4;
      const totalBeats = bars * beatsPerBar;
      for (let i = 1; i < totalBeats; i++) {
        const x = Math.round((w / totalBeats) * i) + 0.5;
        const isBar = i % beatsPerBar === 0;
        ctx.strokeStyle = isBar ? "rgba(148,163,184,0.22)" : "rgba(148,163,184,0.07)";
        ctx.lineWidth = isBar ? 1.25 : 1;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    }

    if (notes.length === 0) {
      ctx.fillStyle = "rgba(148,163,184,0.4)";
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(editable ? "drag timeline to shift all MIDI" : "no MIDI on this channel", w / 2, h / 2);
    } else {
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const r = noteRect(n, w, h);
        const selected = selectedIndex === i;
        const hovered = hoverIdx === i;
        const alpha = 0.22 + 0.68 * (n.velocity / 127);

        // Note body
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        roundRect(ctx, r.x, r.y, r.w, r.h, 2.5);
        ctx.fill();

        // Border / selection
        ctx.globalAlpha = selected ? 1 : hovered ? 0.85 : 0.35;
        ctx.strokeStyle = selected ? "#fff" : hovered ? "#e2e8f0" : "rgba(0,0,0,0.35)";
        ctx.lineWidth = selected ? 1.5 : 1;
        roundRect(ctx, r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1), 2.5);
        ctx.stroke();

        // Resize handles when selected/hovered
        if (editable && (selected || hovered) && r.w > EDGE_PX * 2.5) {
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = selected ? "#fff" : "rgba(255,255,255,0.7)";
          const hw = 3;
          const hh = Math.max(4, r.h - 4);
          ctx.fillRect(r.x + 1, r.y + (r.h - hh) / 2, hw, hh);
          ctx.fillRect(r.x + r.w - hw - 1, r.y + (r.h - hh) / 2, hw, hh);
        }
      }
      ctx.globalAlpha = 1;
    }

    // Playhead
    if (playhead >= 0 && playhead <= 1) {
      const px = playhead * w;
      ctx.strokeStyle = playing ? "#f472b6" : "rgba(244,114,182,0.45)";
      ctx.lineWidth = 2;
      ctx.shadowColor = playing ? "rgba(244,114,182,0.55)" : "transparent";
      ctx.shadowBlur = playing ? 6 : 0;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, [
    notes, noteRange, lengthTicks, playhead, bars, color, playing,
    selectedIndex, hoverIdx, layout, noteRect, editable
  ]);

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

  const commitNotes = (nextNotes: RolledNote[]) => {
    if (!onEventsChange) return;
    onEventsChange(replaceNotes(events, nextNotes));
  };

  const commitTrackDelta = (deltaTicks: number) => {
    if (!onEventsChange || !deltaTicks) return;
    onEventsChange(shiftEventsByTicks(events, deltaTicks));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable || !onEventsChange) return;
    if (e.button !== 0) return;
    const { x, y, w, h } = localXY(e);
    const hit = hitTest(x, y, w, h);
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    const notes0 = baseNotes.map(n => ({ ...n }));

    // Empty area → drag entire track on the timeline.
    if (!hit) {
      onSelect?.(null);
      if (notes0.length === 0) return;
      dragRef.current = {
        mode: "track",
        index: -1,
        notes0,
        originX: x,
        originY: y,
        startTick: 0,
        startNote: 0,
        endTick: 0,
        pointerId: e.pointerId
      };
      setDragPreview(notes0);
      return;
    }

    const copy = e.altKey || e.ctrlKey || e.metaKey;
    let index = hit.index;
    let working = notes0;

    if (copy) {
      const src = working[index];
      working = [...working, { ...src }];
      index = working.length - 1;
    }

    onSelect?.(index);
    const n = working[index];
    // Note body → move one note; edges resize; empty area = track (set above).
    const mode: DragMode =
      copy ? "copy"
        : hit.edge === "start" ? "resize-start"
          : hit.edge === "end" ? "resize-end"
            : "move";

    dragRef.current = {
      mode,
      index,
      notes0: working,
      originX: x,
      originY: y,
      startTick: n.start,
      startNote: n.note,
      endTick: n.end,
      pointerId: e.pointerId
    };
    setDragPreview(working);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const { x, y, w, h } = localXY(e);
    const drag = dragRef.current;

    if (!drag) {
      if (!editable) return;
      const hit = hitTest(x, y, w, h);
      setHoverIdx(hit?.index ?? null);
      setHoverEdge(hit?.edge ?? null);
      return;
    }

    e.preventDefault();
    let next = drag.notes0.map(n => ({ ...n }));
    const dx = x - drag.originX;
    // Timeline: 1px ≈ lengthTicks/w — fine enough; snap handles grid.
    const dTickRaw = (dx / Math.max(1, w)) * lengthTicks;

    if (drag.mode === "track") {
      // Shift entire MIDI by the same snapped delta; clamp so earliest event stays >= 0.
      const step = Math.max(1, snapTicks);
      const snappedDelta = Math.round(dTickRaw / step) * step;
      let minStart = Infinity;
      for (const n of drag.notes0) minStart = Math.min(minStart, n.start);
      if (!Number.isFinite(minStart)) minStart = 0;
      const delta = Math.max(-minStart, snappedDelta);
      drag.trackDelta = delta;
      next = drag.notes0.map(n => ({
        ...n,
        start: n.start + delta,
        end: n.end + delta
      }));
    } else if (drag.mode === "move" || drag.mode === "copy") {
      const dy = y - drag.originY;
      // Fixed px/semitone — small mouse moves only nudge 1 pitch at a time.
      const PX_PER_SEMI = 28;
      const dPitch = -Math.trunc(dy / PX_PER_SEMI);
      const origin = drag.notes0[drag.index];
      const dur = origin.end - origin.start;
      let start = snapTick(origin.start + dTickRaw, snapTicks);
      start = Math.max(0, Math.min(lengthTicks - 1, start));
      const note = Math.max(0, Math.min(127, origin.note + dPitch));
      next[drag.index] = { ...origin, note, start, end: start + dur };
    } else if (drag.mode === "resize-end") {
      const origin = drag.notes0[drag.index];
      let end = snapTick(origin.end + dTickRaw, snapTicks);
      end = Math.max(origin.start + Math.max(1, snapTicks || 1), Math.min(lengthTicks, end));
      next = resizeNote(next, drag.index, "end", end);
    } else if (drag.mode === "resize-start") {
      const origin = drag.notes0[drag.index];
      let start = snapTick(origin.start + dTickRaw, snapTicks);
      start = Math.max(0, Math.min(origin.end - Math.max(1, snapTicks || 1), start));
      next = resizeNote(next, drag.index, "start", start);
    }

    setDragPreview(next);
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.preventDefault();
    try { (e.target as HTMLElement).releasePointerCapture?.(drag.pointerId); } catch { /* */ }
    if (drag.mode === "track") {
      commitTrackDelta(drag.trackDelta ?? 0);
    } else if (dragPreview) {
      commitNotes(dragPreview);
    }
    dragRef.current = null;
    setDragPreview(null);
  };

  const cursor = !editable
    ? "default"
    : dragRef.current
      ? dragRef.current.mode.startsWith("resize") ? "ew-resize" : "grabbing"
      : hoverEdge === "start" || hoverEdge === "end"
        ? "ew-resize"
        : hoverIdx != null
          ? "grab"
          : "ew-resize";

  return (
    <div ref={wrapRef} className="relative piano-roll-wrap">
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height, display: "block", cursor, touchAction: "none" }}
        className="rounded-lg border border-edge piano-roll-canvas"
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
      />
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
