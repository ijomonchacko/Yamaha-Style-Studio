/**
 * Note-level edit helpers for piano-roll interaction.
 * Works on parsed MidiEvent[] (note-on/off pairs) while preserving non-note events.
 */

import type { MidiEvent } from "../binary/midiParser";
import {
  chordPitchClasses,
  RootName,
  ScaleMode,
  SnapTarget,
  snapMidiNote
} from "./keyTheory";

export interface RolledNote {
  note: number;
  start: number;
  end: number;
  velocity: number;
  channel: number;
}

export function extractNotes(events: MidiEvent[]): RolledNote[] {
  const open = new Map<string, { tick: number; vel: number; channel: number }>();
  const out: RolledNote[] = [];
  for (const e of events) {
    if (e.kind === "note-on" && e.velocity > 0) {
      open.set(`${e.channel}:${e.note}`, { tick: e.tick, vel: e.velocity, channel: e.channel });
    } else if (e.kind === "note-off" || (e.kind === "note-on" && e.velocity === 0)) {
      const key = `${e.channel}:${e.note}`;
      const on = open.get(key);
      if (on) {
        out.push({
          note: e.note,
          start: on.tick,
          end: Math.max(on.tick + 1, e.tick),
          velocity: on.vel,
          channel: on.channel
        });
        open.delete(key);
      }
    }
  }
  const lastTick = events[events.length - 1]?.tick ?? 0;
  for (const [key, on] of open) {
    const note = Number(key.split(":")[1]);
    out.push({
      note,
      start: on.tick,
      end: Math.max(on.tick + 1, lastTick),
      velocity: on.vel,
      channel: on.channel
    });
  }
  out.sort((a, b) => a.start - b.start || a.note - b.note);
  return out;
}

/** Rebuild events: keep non-note events, replace all notes from the rolled list. */
export function replaceNotes(events: MidiEvent[], notes: RolledNote[]): MidiEvent[] {
  const nonNotes = events.filter(e => e.kind !== "note-on" && e.kind !== "note-off");
  const noteEvents: MidiEvent[] = [];
  for (const n of notes) {
    const start = Math.max(0, Math.round(n.start));
    const end = Math.max(start + 1, Math.round(n.end));
    const note = Math.max(0, Math.min(127, Math.round(n.note)));
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));
    const ch = Math.max(0, Math.min(15, n.channel | 0));
    noteEvents.push({ kind: "note-on", tick: start, channel: ch, note, velocity: vel });
    noteEvents.push({ kind: "note-off", tick: end, channel: ch, note, velocity: 0 });
  }
  const merged = [...nonNotes, ...noteEvents];
  merged.sort((a, b) => a.tick - b.tick || kindOrder(a) - kindOrder(b));
  return merged;
}

function kindOrder(e: MidiEvent): number {
  if (e.kind === "note-off") return 0;
  if (e.kind === "note-on") return 1;
  return 2;
}

export function snapTick(tick: number, snap: number): number {
  if (snap <= 0) return Math.max(0, Math.round(tick));
  return Math.max(0, Math.round(tick / snap) * snap);
}

/**
 * Shift every event tick by deltaTicks (whole-track timing).
 * Positive = delay / start later; negative = earlier / end sooner.
 * Clamps ticks to >= 0 and re-sorts.
 */
export function shiftEventsByTicks(events: MidiEvent[], deltaTicks: number): MidiEvent[] {
  const d = Math.round(deltaTicks);
  if (!d || !events.length) return events;
  const next = events.map(e => ({
    ...e,
    tick: Math.max(0, Math.round(e.tick + d))
  }));
  next.sort((a, b) => a.tick - b.tick || kindOrder(a) - kindOrder(b));
  return next;
}

export function moveNote(
  notes: RolledNote[],
  index: number,
  dTick: number,
  dPitch: number
): RolledNote[] {
  if (index < 0 || index >= notes.length) return notes;
  const n = notes[index];
  const dur = n.end - n.start;
  const start = Math.max(0, n.start + dTick);
  const note = Math.max(0, Math.min(127, n.note + dPitch));
  const next = notes.slice();
  next[index] = { ...n, note, start, end: start + dur };
  return next;
}

export function resizeNote(
  notes: RolledNote[],
  index: number,
  edge: "start" | "end",
  tick: number
): RolledNote[] {
  if (index < 0 || index >= notes.length) return notes;
  const n = notes[index];
  const t = Math.max(0, tick);
  const next = notes.slice();
  if (edge === "start") {
    const start = Math.min(t, n.end - 1);
    next[index] = { ...n, start };
  } else {
    const end = Math.max(t, n.start + 1);
    next[index] = { ...n, end };
  }
  return next;
}

export function duplicateNoteAt(
  notes: RolledNote[],
  index: number,
  offsetTick: number
): { notes: RolledNote[]; newIndex: number } {
  if (index < 0 || index >= notes.length) return { notes, newIndex: index };
  const src = notes[index];
  const copy: RolledNote = {
    ...src,
    start: Math.max(0, src.start + offsetTick),
    end: Math.max(1, src.end + offsetTick)
  };
  const next = [...notes, copy];
  return { notes: next, newIndex: next.length - 1 };
}

/**
 * Tile events by AUS period so the track fills targetLengthTicks.
 * Only events whose tick is in [0, period) are used as the source pattern.
 * Non-note events at tick 0 (program/cc) are kept once; notes/cc within the
 * period are repeated at +k*period while tick < targetLength.
 */
export function duplicateEventsByAusLength(
  events: MidiEvent[],
  periodTicks: number,
  targetLengthTicks: number
): MidiEvent[] {
  if (periodTicks <= 0 || targetLengthTicks <= 0) return events;

  const period = Math.max(1, Math.round(periodTicks));
  const target = Math.max(period, Math.round(targetLengthTicks));
  const copies = Math.ceil(target / period);
  if (copies <= 1) return events;

  // Split: pattern content in [0, period), and anything already beyond period.
  const pattern: MidiEvent[] = [];
  const beyond: MidiEvent[] = [];
  const setup: MidiEvent[] = []; // program/cc/meta/sysex at tick 0

  for (const e of events) {
    if (e.kind === "meta" || e.kind === "tempo" || e.kind === "time-sig") {
      setup.push(e);
      continue;
    }
    if (
      e.tick === 0 &&
      (e.kind === "program" || e.kind === "cc" || e.kind === "pitch-bend")
    ) {
      setup.push(e);
      continue;
    }
    if (e.tick < period) pattern.push(e);
    else beyond.push(e);
  }

  const tiled: MidiEvent[] = [...setup];
  for (let k = 0; k < copies; k++) {
    const base = k * period;
    for (const e of pattern) {
      const tick = e.tick + base;
      if (tick >= target) continue;
      tiled.push(cloneAt(e, tick));
    }
  }

  // Keep events that already lived past the first period if they don't collide
  // with tiled range (prefer pattern tiling for the AUS fill).
  for (const e of beyond) {
    if (e.tick >= target) continue;
    // Only keep if no identical note already tiled at that tick
    if (!hasDuplicateNote(tiled, e)) tiled.push(e);
  }

  tiled.sort((a, b) => a.tick - b.tick || kindOrder(a) - kindOrder(b));
  return tiled;
}

function cloneAt(e: MidiEvent, tick: number): MidiEvent {
  switch (e.kind) {
    case "note-on":
      return { kind: "note-on", tick, channel: e.channel, note: e.note, velocity: e.velocity };
    case "note-off":
      return { kind: "note-off", tick, channel: e.channel, note: e.note, velocity: e.velocity };
    case "cc":
      return { kind: "cc", tick, channel: e.channel, controller: e.controller, value: e.value };
    case "program":
      return { kind: "program", tick, channel: e.channel, program: e.program };
    case "pitch-bend":
      return { kind: "pitch-bend", tick, channel: e.channel, value: e.value };
    default:
      return { ...e, tick } as MidiEvent;
  }
}

function hasDuplicateNote(events: MidiEvent[], e: MidiEvent): boolean {
  if (e.kind !== "note-on" && e.kind !== "note-off") return false;
  return events.some(
    x =>
      x.kind === e.kind &&
      x.tick === e.tick &&
      "note" in x &&
      x.note === e.note &&
      x.channel === e.channel
  );
}

export function noteRangeOf(notes: RolledNote[]): { lo: number; hi: number } {
  if (notes.length === 0) return { lo: 48, hi: 72 };
  let lo = 127, hi = 0;
  for (const n of notes) {
    if (n.note < lo) lo = n.note;
    if (n.note > hi) hi = n.note;
  }
  return { lo: Math.max(0, lo - 2), hi: Math.min(127, hi + 2) };
}

/** Delete notes by index set. */
export function deleteNotesAt(notes: RolledNote[], indices: Iterable<number>): RolledNote[] {
  const drop = new Set(indices);
  return notes.filter((_, i) => !drop.has(i));
}

/** Move a set of notes by the same time/pitch delta (clamped). Pitch only changes when dPitch ≠ 0. */
export function moveNotes(
  notes: RolledNote[],
  indices: Iterable<number>,
  dTick: number,
  dPitch: number
): RolledNote[] {
  const set = new Set(indices);
  if (!set.size) return notes;
  let minStart = Infinity;
  for (const i of set) {
    const n = notes[i];
    if (n) minStart = Math.min(minStart, n.start);
  }
  if (!Number.isFinite(minStart)) minStart = 0;
  const tickDelta = Math.round(dTick) === 0 ? 0 : Math.max(-minStart, Math.round(dTick));
  const pitchDelta = Math.round(dPitch);
  if (tickDelta === 0 && pitchDelta === 0) return notes;
  const next = notes.slice();
  for (const i of set) {
    const n = next[i];
    if (!n) continue;
    const dur = Math.max(1, n.end - n.start);
    const start = Math.max(0, n.start + tickDelta);
    // Only touch pitch when explicitly requested — time nudges must never retune notes.
    const note = pitchDelta === 0
      ? n.note
      : Math.max(0, Math.min(127, n.note + pitchDelta));
    next[i] = { ...n, note, start, end: start + dur };
  }
  return next;
}

/** After re-sort, find indices of notes matching the given identities. */
export function findNoteIndices(notes: RolledNote[], targets: RolledNote[]): number[] {
  const used = new Set<number>();
  const out: number[] = [];
  for (const t of targets) {
    let found = -1;
    for (let i = 0; i < notes.length; i++) {
      if (used.has(i)) continue;
      const n = notes[i];
      if (
        n.note === t.note &&
        n.start === t.start &&
        n.end === t.end &&
        n.velocity === t.velocity &&
        n.channel === t.channel
      ) {
        found = i;
        break;
      }
    }
    if (found >= 0) {
      used.add(found);
      out.push(found);
    }
  }
  return out;
}

/**
 * Snap note starts to the nearest marker (bar or beat) when within radius.
 * Soft magnet — only moves if already close. Duration preserved.
 */
export function snapNotesToMarkers(
  notes: RolledNote[],
  indices: Iterable<number> | null,
  markerTicks: number,
  softRadiusTicks: number
): RolledNote[] {
  const step = Math.max(1, Math.round(markerTicks));
  const radius = Math.max(1, Math.round(softRadiusTicks));
  const set = indices ? new Set(indices) : null;
  return notes.map((n, i) => {
    if (set && !set.has(i)) return n;
    const nearest = Math.round(n.start / step) * step;
    const dist = Math.abs(n.start - nearest);
    if (dist === 0 || dist > radius) return n;
    const start = Math.max(0, nearest);
    const dur = Math.max(1, n.end - n.start);
    return { ...n, start, end: start + dur };
  });
}

/** Duplicate selected notes, offset in time; returns new notes + new indices. */
export function duplicateNotesAt(
  notes: RolledNote[],
  indices: Iterable<number>,
  offsetTick: number
): { notes: RolledNote[]; newIndices: number[] } {
  const srcIdx = [...new Set(indices)].filter(i => i >= 0 && i < notes.length).sort((a, b) => a - b);
  if (!srcIdx.length) return { notes, newIndices: [] };
  const copies: RolledNote[] = [];
  for (const i of srcIdx) {
    const src = notes[i];
    copies.push({
      ...src,
      start: Math.max(0, src.start + offsetTick),
      end: Math.max(1, src.end + offsetTick)
    });
  }
  const next = [...notes, ...copies];
  const newIndices = copies.map((_, k) => notes.length + k);
  return { notes: next, newIndices };
}

/** Paste clipboard notes at pasteTick (aligns earliest start to pasteTick). */
export function pasteNotesAt(
  notes: RolledNote[],
  clipboard: RolledNote[],
  pasteTick: number,
  channel?: number
): { notes: RolledNote[]; newIndices: number[] } {
  if (!clipboard.length) return { notes, newIndices: [] };
  let minStart = Infinity;
  for (const n of clipboard) minStart = Math.min(minStart, n.start);
  if (!Number.isFinite(minStart)) minStart = 0;
  const delta = Math.round(pasteTick) - minStart;
  const copies = clipboard.map(n => {
    const start = Math.max(0, n.start + delta);
    const end = Math.max(start + 1, n.end + delta);
    return {
      ...n,
      start,
      end,
      channel: channel != null ? channel : n.channel
    };
  });
  const next = [...notes, ...copies];
  const newIndices = copies.map((_, k) => notes.length + k);
  return { notes: next, newIndices };
}

/** Quantize note starts (and optionally ends) to snap grid. */
export function quantizeNotes(
  notes: RolledNote[],
  indices: Iterable<number> | null,
  snap: number,
  mode: "start" | "both" = "start"
): RolledNote[] {
  if (snap <= 0) return notes;
  const set = indices ? new Set(indices) : null;
  return notes.map((n, i) => {
    if (set && !set.has(i)) return n;
    const start = snapTick(n.start, snap);
    if (mode === "both") {
      const end = Math.max(start + 1, snapTick(n.end, snap));
      return { ...n, start, end };
    }
    const dur = n.end - n.start;
    return { ...n, start, end: start + dur };
  });
}

/**
 * Soft nudge: if a note is slightly off a bar line (within softRadiusTicks),
 * pull its start to that bar. Never jumps more than the radius — so it will
 * not leap a whole bar earlier or later.
 *
 * Default radius = ½ bar (catches common import / drag offsets).
 */
export function nudgeNotesToBarStart(
  notes: RolledNote[],
  indices: Iterable<number> | null,
  barTicks: number,
  softRadiusTicks?: number
): RolledNote[] {
  const bar = Math.max(1, Math.round(barTicks));
  // Half bar by default — soft attach without leaping bars.
  const radius = softRadiusTicks != null && softRadiusTicks > 0
    ? Math.round(softRadiusTicks)
    : Math.max(1, Math.floor(bar / 2));
  const set = indices ? new Set(indices) : null;

  return notes.map((n, i) => {
    if (set && !set.has(i)) return n;
    const start = Math.max(0, n.start);
    // Prefer the start of the bar this note lives in (never previous bar).
    // If very close to the *next* bar (within radius), allow attach forward.
    const thisBar = Math.floor(start / bar) * bar;
    const nextBar = thisBar + bar;
    const distBack = start - thisBar;
    const distFwd = nextBar - start;

    let target = start;
    if (distBack > 0 && distBack <= radius && distBack <= distFwd) {
      target = thisBar;
    } else if (distFwd > 0 && distFwd <= radius && distFwd < distBack) {
      target = nextBar;
    } else if (distBack > 0 && distBack <= radius) {
      target = thisBar;
    }

    if (target === start) return n;
    const nextStart = Math.max(0, target);
    const dur = Math.max(1, n.end - n.start);
    return { ...n, start: nextStart, end: nextStart + dur };
  });
}

/**
 * Hard attach: pin each note to the downbeat of the bar it currently occupies.
 * Only moves earlier within the same bar — never into a previous bar, never
 * past the next bar. Duration preserved.
 *
 * Use when notes sit inside a bar and should sit flush on that bar’s start.
 */
export function attachNotesToBarStart(
  notes: RolledNote[],
  indices: Iterable<number> | null,
  barTicks: number,
  _softRadiusTicks?: number
): RolledNote[] {
  const bar = Math.max(1, Math.round(barTicks));
  const set = indices ? new Set(indices) : null;

  return notes.map((n, i) => {
    if (set && !set.has(i)) return n;
    const start = Math.max(0, n.start);
    const barStart = Math.floor(start / bar) * bar;
    if (start === barStart) return n;
    const dur = Math.max(1, n.end - n.start);
    return { ...n, start: barStart, end: barStart + dur };
  });
}

/** Set velocity on selected notes. */
export function setNotesVelocity(
  notes: RolledNote[],
  indices: Iterable<number>,
  velocity: number
): RolledNote[] {
  const set = new Set(indices);
  const vel = Math.max(1, Math.min(127, Math.round(velocity)));
  return notes.map((n, i) => (set.has(i) ? { ...n, velocity: vel } : n));
}

/** Transpose selected notes by semitones. */
export function transposeNotes(
  notes: RolledNote[],
  indices: Iterable<number>,
  semitones: number
): RolledNote[] {
  return moveNotes(notes, indices, 0, semitones);
}

/** Clone notes for clipboard (plain objects). */
export function cloneNotes(notes: RolledNote[]): RolledNote[] {
  return notes.map(n => ({ ...n }));
}

/**
 * Snap every note-on/off pitch to the given key (scale, triad, or seventh).
 * Note-on and matching note-off stay paired by original pitch.
 */
export function snapEventsToKey(
  events: MidiEvent[],
  root: RootName | number,
  mode: ScaleMode,
  target: SnapTarget = "scale"
): MidiEvent[] {
  if (mode === "chromatic") return events;
  const allowed = chordPitchClasses(root, mode, target);
  // Map original pitch → snapped pitch per channel stream order so on/off match.
  // Use per-channel open stack: when we see note-on, record mapping; note-off uses it.
  const openMap = new Map<string, number>(); // `${ch}:${origNote}` → snapped (last on)
  // For simultaneous same pitch, stack depths
  const stacks = new Map<string, number[]>();

  return events.map(e => {
    if (e.kind !== "note-on" && e.kind !== "note-off") return e;
    const key = `${e.channel}:${e.note}`;
    if (e.kind === "note-on" && e.velocity > 0) {
      const snapped = snapMidiNote(e.note, allowed);
      const st = stacks.get(key) ?? [];
      st.push(snapped);
      stacks.set(key, st);
      openMap.set(key, snapped);
      return { ...e, note: snapped };
    }
    // note-off or note-on vel 0
    const st = stacks.get(key);
    let snapped = openMap.get(key) ?? snapMidiNote(e.note, allowed);
    if (st && st.length) {
      snapped = st.pop()!;
      stacks.set(key, st);
    }
    return { ...e, note: snapped };
  });
}

/** Snap rolled notes (for live drag preview). */
export function snapRolledToKey(
  notes: RolledNote[],
  root: RootName | number,
  mode: ScaleMode,
  target: SnapTarget = "scale"
): RolledNote[] {
  if (mode === "chromatic") return notes;
  const allowed = chordPitchClasses(root, mode, target);
  return notes.map(n => ({ ...n, note: snapMidiNote(n.note, allowed) }));
}

/** Quantize note-on/off pairs to a grid (strength 0–1 blends toward grid). */
export function quantizeEvents(
  events: MidiEvent[],
  gridTicks: number,
  strength = 1
): MidiEvent[] {
  const g = Math.max(1, Math.round(gridTicks));
  const s = Math.max(0, Math.min(1, strength));
  const notes = extractNotes(events);
  const q = notes.map(n => {
    const startQ = snapTick(n.start, g);
    const endQ = Math.max(startQ + 1, snapTick(n.end, g));
    return {
      ...n,
      start: Math.round(n.start + (startQ - n.start) * s),
      end: Math.round(n.end + (endQ - n.end) * s)
    };
  });
  return replaceNotes(events, q);
}

/** Apply swing: delay off-grid 8th/16th subdivisions (ratio 0–1). */
export function applySwing(
  events: MidiEvent[],
  gridTicks: number,
  amount = 0.3
): MidiEvent[] {
  const g = Math.max(1, Math.round(gridTicks));
  const a = Math.max(0, Math.min(0.75, amount));
  if (a === 0) return events;
  const notes = extractNotes(events).map(n => {
    const cell = Math.floor(n.start / g);
    if (cell % 2 === 1) {
      const delay = Math.round(g * a);
      return { ...n, start: n.start + delay, end: n.end + delay };
    }
    return n;
  });
  return replaceNotes(events, notes);
}

/** Humanize timing ±ticks and velocity ±vel. */
export function humanizeEvents(
  events: MidiEvent[],
  timingTicks = 8,
  velocityDelta = 8
): MidiEvent[] {
  const notes = extractNotes(events).map(n => {
    const jt = Math.round((Math.random() * 2 - 1) * timingTicks);
    const jv = Math.round((Math.random() * 2 - 1) * velocityDelta);
    return {
      ...n,
      start: Math.max(0, n.start + jt),
      end: Math.max(1, n.end + jt),
      velocity: Math.max(1, Math.min(127, n.velocity + jv))
    };
  });
  return replaceNotes(events, notes);
}

/** Scale all note velocities by factor (1 = unchanged). */
export function scaleVelocities(events: MidiEvent[], factor: number): MidiEvent[] {
  const f = Math.max(0.1, Math.min(2, factor));
  return events.map(e => {
    if (e.kind === "note-on" && e.velocity > 0) {
      return { ...e, velocity: Math.max(1, Math.min(127, Math.round(e.velocity * f))) };
    }
    return e;
  });
}

/** Inject or replace CC7 / CC10 at tick 0 for a channel. */
export function setChannelVolumePan(
  events: MidiEvent[],
  channel: number,
  volume?: number,
  pan?: number
): MidiEvent[] {
  const rest = events.filter(
    e => !(e.kind === "cc" && e.channel === channel && (e.controller === 7 || e.controller === 10) && e.tick === 0)
  );
  const extras: MidiEvent[] = [];
  if (volume != null) {
    extras.push({ kind: "cc", tick: 0, channel, controller: 7, value: Math.max(0, Math.min(127, volume | 0)) });
  }
  if (pan != null) {
    extras.push({ kind: "cc", tick: 0, channel, controller: 10, value: Math.max(0, Math.min(127, pan | 0)) });
  }
  return [...extras, ...rest].sort((a, b) => a.tick - b.tick || kindOrder(a) - kindOrder(b));
}
