/**
 * Key / scale helpers for snapping MIDI notes to major or minor chords.
 */

export type ScaleMode = "major" | "minor" | "chromatic";

export const NOTE_NAMES = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"
] as const;

export type RootName = (typeof NOTE_NAMES)[number];

/** Pitch-class intervals from root (0–11). */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor
const MAJOR_CHORD = [0, 4, 7];              // I triad
const MINOR_CHORD = [0, 3, 7];              // i triad
const MAJOR_CHORD_7 = [0, 4, 7, 11];
const MINOR_CHORD_7 = [0, 3, 7, 10];

export type SnapTarget = "scale" | "triad" | "seventh";

export function rootToPc(root: RootName | number): number {
  if (typeof root === "number") return ((root % 12) + 12) % 12;
  const i = NOTE_NAMES.indexOf(root as RootName);
  return i >= 0 ? i : 0;
}

export function scalePitchClasses(root: RootName | number, mode: ScaleMode): number[] {
  const r = rootToPc(root);
  if (mode === "chromatic") return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(x => (x + r) % 12);
  const intervals = mode === "major" ? MAJOR_SCALE : MINOR_SCALE;
  return intervals.map(i => (i + r) % 12);
}

export function chordPitchClasses(
  root: RootName | number,
  mode: ScaleMode,
  target: SnapTarget = "triad"
): number[] {
  if (mode === "chromatic") return scalePitchClasses(root, mode);
  if (target === "scale") return scalePitchClasses(root, mode);
  const r = rootToPc(root);
  const intervals =
    target === "seventh"
      ? (mode === "major" ? MAJOR_CHORD_7 : MINOR_CHORD_7)
      : (mode === "major" ? MAJOR_CHORD : MINOR_CHORD);
  return intervals.map(i => (i + r) % 12);
}

/** Nearest MIDI note whose pitch class is in `allowed`. Prefer same octave. */
export function snapMidiNote(note: number, allowed: number[]): number {
  if (!allowed.length) return Math.max(0, Math.min(127, note));
  const n = Math.max(0, Math.min(127, Math.round(note)));
  const pc = ((n % 12) + 12) % 12;
  if (allowed.includes(pc)) return n;

  let best = n;
  let bestDist = Infinity;
  for (const a of allowed) {
    // candidates: same octave and ±1 octave around n
    for (let oct = -1; oct <= 1; oct++) {
      const cand = n - pc + a + oct * 12;
      if (cand < 0 || cand > 127) continue;
      const d = Math.abs(cand - n);
      if (d < bestDist || (d === bestDist && cand >= n)) {
        bestDist = d;
        best = cand;
      }
    }
  }
  return best;
}

export function formatKey(root: RootName | number, mode: ScaleMode): string {
  const name = typeof root === "number" ? NOTE_NAMES[((root % 12) + 12) % 12] : root;
  if (mode === "chromatic") return "Chromatic";
  return `${name} ${mode === "major" ? "Major" : "Minor"}`;
}
