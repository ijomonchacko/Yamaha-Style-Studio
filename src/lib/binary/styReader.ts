/**
 * Open an existing Yamaha .sty for re-edit in Style Studio.
 */

import { parseAus, AusParseResult } from "./ausParser";
import { Bytes, readFourCC } from "./bytes";
import { parseMidi, ParsedMidi } from "./midiParser";
import {
  extractAudioBody,
  extractCasmFromAus,
  findSmfEnd,
  StyleSection,
  walkStyleTopChunks
} from "./sff2Writer";

export interface OpenedStyle {
  aus: AusParseResult;
  raw: Bytes;
  midi: ParsedMidi;
  sections: StyleSection[];
  name: string;
  bpm: number;
  timeSigNum: number;
  timeSigDen: number;
  hasCasm: boolean;
  hasAudio: boolean;
  log: string[];
}

const KNOWN_SECTIONS = new Set([
  "Main A", "Main B", "Main C", "Main D",
  "Intro A", "Intro B", "Intro C",
  "Ending A", "Ending B", "Ending C",
  "Fill In AA", "Fill In BB", "Fill In CC", "Fill In DD",
  "Fill In BA", "Break"
]);

export function parseSty(raw: Bytes): OpenedStyle {
  const log: string[] = [];
  if (raw.length < 22 || readFourCC(raw, 0) !== "MThd") {
    throw new Error("Not a Yamaha style (missing MThd).");
  }

  const smfEnd = findSmfEnd(raw);
  if (smfEnd < 0) throw new Error("Could not parse SMF block in .sty.");

  const midi = parseMidi(raw.subarray(0, smfEnd));
  log.push(`SMF: format ${midi.format}, ${midi.tracks.length} tracks, ${midi.ticksPerQuarter} TPQ`);

  const sections: StyleSection[] = [];
  let name = "Opened Style";
  const cond = midi.tracks[0];
  if (cond) {
    for (const e of cond.events) {
      if (e.kind === "meta" && e.type === 0x03) {
        const n = new TextDecoder("latin1").decode(e.data).replace(/\0/g, "").trim();
        if (n) name = n;
      }
      if (e.kind === "meta" && e.type === 0x06) {
        const m = new TextDecoder("latin1").decode(e.data);
        if (m === "SFF1" || m === "SFF2" || m === "SInt") continue;
        const mapped = (m === "Fill In BA" ? "Break" : m) as StyleSection;
        if (KNOWN_SECTIONS.has(mapped) && !sections.includes(mapped)) {
          sections.push(mapped);
        }
      }
    }
  }
  if (!sections.length) sections.push("Main A");

  // Full style as AUS carrier so CASM + AASM are available on re-export.
  const aus = parseAus(raw);
  const audio = extractAudioBody(raw);
  const casm = extractCasmFromAus(raw);
  const tops = walkStyleTopChunks(raw);
  log.push(`Chunks: ${tops.map(c => c.id).join(" → ") || "(none)"}`);
  log.push(casm ? `CASM: ${casm.length} B` : "CASM: none");
  log.push(audio ? `Audio: ${audio.source} ${audio.body.length} B` : "Audio: none");

  return {
    aus,
    raw,
    midi,
    sections,
    name,
    bpm: midi.tempoBpm || aus.meta.bpm || 120,
    timeSigNum: midi.timeSigNumerator || 4,
    timeSigDen: midi.timeSigDenominator || 4,
    hasCasm: !!casm,
    hasAudio: !!audio,
    log
  };
}

export function suggestRoleForTrack(trackIndex: number, channelsUsed: number[]): string {
  const ch = channelsUsed[0] ?? (9 + trackIndex);
  if (ch === 10 || ch === 9) return "Bass";
  if (ch === 11) return "Chord 1";
  if (ch === 12) return "Chord 2";
  if (ch === 13) return "Pad";
  if (ch === 14) return "Phrase 1";
  if (ch === 15) return "Phrase 2";
  const roles = ["Bass", "Chord 1", "Chord 2", "Pad", "Phrase 1", "Phrase 2"];
  return roles[Math.min(roles.length - 1, Math.max(0, trackIndex - 1))] ?? "Bass";
}
