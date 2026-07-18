/**
 * SFF2 CASM / OTSc / MDB builders for Yamaha PSR-SX / Genos styles.
 *
 * Real Audio Phraser .aus / .sty files use:
 *   - Sdec with comma-separated section names (not null-separated)
 *   - Ctb2 (47-byte) channel tables for SFF2, not the old 16-byte Ctab
 *   - AASM audio assembly block (lifted from the .aus)
 *
 * Incorrect CASM layout is a common cause of keyboard
 * "Data not loaded properly" errors.
 */

import {
  Bytes, concat, readFourCC, readU16BE, readU32BE, tag, writeU16BE, writeU32BE
} from "./bytes";

export type StyleSection =
  | "Main A" | "Main B" | "Main C" | "Main D"
  | "Intro A" | "Intro B" | "Intro C"
  | "Ending A" | "Ending B" | "Ending C"
  | "Fill In AA" | "Fill In BB" | "Fill In CC" | "Fill In DD"
  | "Break";

/** MIDI channel index (0-based) used inside the wrapped SMF. */
export type MidiChan = number;

export interface ChannelDef {
  role: "Rhythm Sub" | "Rhythm Main" | "Bass" | "Chord 1" | "Chord 2" | "Pad" | "Phrase 1" | "Phrase 2";
  midiChannel: MidiChan;
  ntr: "Root Trans" | "Root Fixed" | "Guitar" | "Bypass";
  ntt: "Bypass" | "Melody" | "Chord" | "Bass" | "Melodic Minor" | "Harmonic Minor";
  highKey: number;
  noteLimitLo: number;
  noteLimitHi: number;
  rtr: "Stop" | "Pitch Shift" | "Pitch Shift to Root" | "Retrigger" | "Retrigger to Root" | "Note Generator";
  /** 8-char voice name written into Ctb2 (space-padded). */
  voiceName?: string;
}

export interface CasmSpec {
  sections: StyleSection[];
  channels: ChannelDef[];
}

/** Standard 8 style channels for an SFF2 file targeting PSR-SX920. */
export const DEFAULT_CHANNELS: ChannelDef[] = [
  { role: "Rhythm Sub",  midiChannel: 8,  ntr: "Bypass",     ntt: "Bypass", highKey: 127, noteLimitLo: 0,  noteLimitHi: 127, rtr: "Stop", voiceName: "Rhythm2 " },
  { role: "Rhythm Main", midiChannel: 9,  ntr: "Bypass",     ntt: "Bypass", highKey: 127, noteLimitLo: 0,  noteLimitHi: 127, rtr: "Stop", voiceName: "Rhythm1 " },
  { role: "Bass",        midiChannel: 10, ntr: "Root Trans", ntt: "Bass",   highKey: 60,  noteLimitLo: 24, noteLimitHi: 60,  rtr: "Pitch Shift to Root", voiceName: "Bass    " },
  { role: "Chord 1",     midiChannel: 11, ntr: "Root Trans", ntt: "Chord",  highKey: 84,  noteLimitLo: 36, noteLimitHi: 84,  rtr: "Pitch Shift", voiceName: "Chord1  " },
  { role: "Chord 2",     midiChannel: 12, ntr: "Root Trans", ntt: "Chord",  highKey: 84,  noteLimitLo: 36, noteLimitHi: 84,  rtr: "Pitch Shift", voiceName: "Chord2  " },
  { role: "Pad",         midiChannel: 13, ntr: "Root Trans", ntt: "Chord",  highKey: 96,  noteLimitLo: 36, noteLimitHi: 96,  rtr: "Pitch Shift", voiceName: "Pad     " },
  { role: "Phrase 1",    midiChannel: 14, ntr: "Bypass",     ntt: "Melody", highKey: 96,  noteLimitLo: 36, noteLimitHi: 96,  rtr: "Retrigger", voiceName: "Phrase1 " },
  { role: "Phrase 2",    midiChannel: 15, ntr: "Bypass",     ntt: "Melody", highKey: 96,  noteLimitLo: 36, noteLimitHi: 96,  rtr: "Retrigger", voiceName: "Phrase2 " }
];

const NTR_MAP = { "Root Trans": 0, "Root Fixed": 1, "Guitar": 2, "Bypass": 3 } as const;
const NTT_MAP = {
  "Bypass": 0, "Melody": 1, "Chord": 2, "Bass": 3, "Melodic Minor": 4, "Harmonic Minor": 5
} as const;
const RTR_MAP = {
  "Stop": 0, "Pitch Shift": 1, "Pitch Shift to Root": 2,
  "Retrigger": 3, "Retrigger to Root": 4, "Note Generator": 5
} as const;

const SECTION_CODES: Record<StyleSection, string> = {
  "Main A": "Main A", "Main B": "Main B", "Main C": "Main C", "Main D": "Main D",
  "Intro A": "Intro A", "Intro B": "Intro B", "Intro C": "Intro C",
  "Ending A": "Ending A", "Ending B": "Ending B", "Ending C": "Ending C",
  "Fill In AA": "Fill In AA", "Fill In BB": "Fill In BB",
  "Fill In CC": "Fill In CC", "Fill In DD": "Fill In DD", "Break": "Fill In BA"
};

export function yamahaSectionCode(s: StyleSection): string {
  return SECTION_CODES[s];
}

/**
 * Full default section list used by real Audio Phraser exports.
 * Keyboards expect a rich Sdec list even when only Main A has MIDI data.
 */
export const FULL_SECTION_LIST: StyleSection[] = [
  "Main A", "Main B", "Main C", "Main D",
  "Fill In AA", "Fill In BB", "Fill In CC", "Fill In DD",
  "Intro A", "Intro B", "Intro C",
  "Ending A", "Ending B", "Ending C",
  "Break"
];

/** Known top-level style chunks after the SMF block. */
const STYLE_TOP_TAGS = new Set([
  "CASM", "OTSc", "MDB ", "AASM", "AWav", "AFil", "AUDI", "FNRc", "MTRK", "CSEG"
]);

export interface StyleTopChunk {
  id: string;
  offset: number;
  size: number;
  /** Full chunk bytes: FourCC + BE size + payload. */
  full: Bytes;
}

/**
 * Locate the end of the SMF block (MThd + N × MTrk).
 * Returns the byte offset of the first post-SMF chunk, or -1 if invalid.
 */
export function findSmfEnd(buf: Bytes): number {
  if (buf.length < 14 || readFourCC(buf, 0) !== "MThd") return -1;
  const headerLen = readU32BE(buf, 4);
  if (headerLen < 6 || 8 + headerLen > buf.length) return -1;
  const numTracks = readU16BE(buf, 10);
  let cursor = 8 + headerLen;
  for (let t = 0; t < numTracks && cursor + 8 <= buf.length; t++) {
    if (readFourCC(buf, cursor) !== "MTrk") {
      // Allow a short resync for corrupted padding between tracks.
      const next = findFourCCOffset(buf, "MTrk", cursor);
      if (next < 0 || next > cursor + 64) break;
      cursor = next;
    }
    const trackLen = readU32BE(buf, cursor + 4);
    if (cursor + 8 + trackLen > buf.length) return -1;
    cursor += 8 + trackLen;
  }
  return cursor;
}

/**
 * Walk top-level FourCC chunks that follow a valid SMF header.
 * Falls back to a full-file FourCC scan when the file has no MThd.
 */
export function walkStyleTopChunks(buf: Bytes): StyleTopChunk[] {
  const chunks: StyleTopChunk[] = [];
  let off = findSmfEnd(buf);
  if (off < 0) off = 0;

  while (off + 8 <= buf.length) {
    const id = readFourCC(buf, off);
    const size = readU32BE(buf, off + 4);
    if (!isPlausibleFourCC(id) || size > buf.length - (off + 8)) {
      // Resync to next known top-level tag.
      const next = scanNextTopTag(buf, off + 1);
      if (next < 0) break;
      off = next;
      continue;
    }
    chunks.push({
      id,
      offset: off,
      size,
      full: buf.subarray(off, off + 8 + size)
    });
    off += 8 + size;
  }
  return chunks;
}

function isPlausibleFourCC(id: string): boolean {
  if (id.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const c = id.charCodeAt(i);
    const ok =
      (c >= 0x30 && c <= 0x39) ||
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      c === 0x20;
    if (!ok) return false;
  }
  return true;
}

function scanNextTopTag(buf: Bytes, from: number): number {
  // AFil = forum Live Audio waveform chunk (with AASM descriptor)
  const tags = ["CASM", "OTSc", "MDB ", "AASM", "AWav", "AFil", "AUDI", "FNRc"];
  let best = -1;
  for (const t of tags) {
    const i = findFourCCOffset(buf, t, from);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

/**
 * Build a CASM chunk with SFF2 Ctb2 tables.
 *
 *   "CASM" u32
 *     "CSEG" u32
 *       "Sdec" u32 + comma-separated section names
 *       "Ctb2" u32 + 47-byte channel table  (× N channels)
 */
export function buildCasm(spec: CasmSpec): Bytes {
  const cseg = buildCseg(spec);
  const payload = concat([tag("CSEG"), writeU32BE(cseg.length), cseg]);
  return concat([tag("CASM"), writeU32BE(payload.length), payload]);
}

function buildCseg(spec: CasmSpec): Bytes {
  // Real SFF2 Sdec: comma-separated names, no trailing null.
  const names = (spec.sections.length ? spec.sections : ["Main A" as StyleSection])
    .map(s => yamahaSectionCode(s))
    .join(",");
  const sdecPayload = new TextEncoder().encode(names);
  const sdec = concat([tag("Sdec"), writeU32BE(sdecPayload.length), sdecPayload]);

  const ctabs = spec.channels.map(ch => buildCtb2(ch));
  return concat([sdec, ...ctabs]);
}

/**
 * SFF2 channel table (Ctb2, 47 bytes) — matches Audio Phraser / SX920 layout.
 *
 * Layout (verified against real .aus / .sty dumps):
 *   0        source MIDI channel (0-15)
 *   1..8     voice name (8 chars, space-padded)
 *   9        destination style channel
 *   10       editable (1)
 *   11       note-mute (0)
 *   12..18   chord-mute / reserved (0)
 *   19       NTR
 *   20       NTT
 *   21       high key
 *   22       note limit low
 *   23       note limit high
 *   24       RTR
 *   25..26   reserved
 *   27..46   triad NTR/NTT/limits repeats + pad (Yamaha chord-type slots)
 */
function buildCtb2(ch: ChannelDef): Bytes {
  const body = new Uint8Array(47);
  const name = padName(ch.voiceName ?? roleToName(ch.role), 8);
  body[0] = ch.midiChannel & 0x0f;
  for (let i = 0; i < 8; i++) body[1 + i] = name[i];
  body[9] = ch.midiChannel & 0x0f;
  body[10] = 1; // editable
  body[11] = 0;
  // bytes 12-18 already 0
  body[19] = NTR_MAP[ch.ntr];
  body[20] = NTT_MAP[ch.ntt];
  body[21] = ch.highKey & 0x7f;
  body[22] = ch.noteLimitLo & 0x7f;
  body[23] = ch.noteLimitHi & 0x7f;
  body[24] = RTR_MAP[ch.rtr];
  body[25] = ch.role === "Bass" ? 1 : 0;
  body[26] = 0;

  // Chord-type slots (major / minor / other) — mirror primary rules so SX920
  // has valid data for every recognition mode (matches real AUS Ctb2 padding).
  const slot = (base: number) => {
    body[base] = NTR_MAP[ch.ntr];
    body[base + 1] = NTT_MAP[ch.ntt];
    body[base + 2] = ch.highKey & 0x7f;
    body[base + 3] = ch.noteLimitLo & 0x7f;
    body[base + 4] = ch.noteLimitHi & 0x7f;
    body[base + 5] = RTR_MAP[ch.rtr];
    body[base + 6] = ch.role === "Bass" ? 1 : 0;
  };
  slot(27);
  slot(34);
  // remaining 40-46 stay 0

  // Rhythm parts use the simpler mute-friendly pattern from real AUS dumps.
  if (ch.role === "Rhythm Main" || ch.role === "Rhythm Sub") {
    body.fill(0, 11);
    body[10] = 1;
    body[19] = 2; // bypass-like
    body[20] = 0;
    body[21] = 0x7f;
    body[22] = 0x01;
    body[23] = 0x00;
    body[24] = 0x06;
    body[25] = 0x00;
    body[26] = 0x7f;
    // triad copies from real Rhythm1 Ctb2
    body[27] = 0x01;
    body[28] = 0x01;
    body[29] = 0x00;
    body[30] = 0x06;
    body[31] = 0x00;
    body[32] = 0x7f;
    body[33] = 0x01;
    body[34] = 0x01;
    body[35] = 0x00;
    body[36] = 0x06;
    body[37] = 0x00;
    body[38] = 0x7f;
    body[39] = 0x01;
  }

  return concat([tag("Ctb2"), writeU32BE(body.length), body]);
}

function padName(s: string, len: number): number[] {
  const enc = new TextEncoder().encode(s.slice(0, len));
  const out = new Array(len).fill(0x20);
  for (let i = 0; i < enc.length; i++) out[i] = enc[i];
  return out;
}

function roleToName(role: ChannelDef["role"]): string {
  const map: Record<ChannelDef["role"], string> = {
    "Rhythm Sub": "Rhythm2 ",
    "Rhythm Main": "Rhythm1 ",
    "Bass": "Bass    ",
    "Chord 1": "Chord1  ",
    "Chord 2": "Chord2  ",
    "Pad": "Pad     ",
    "Phrase 1": "Phrase1 ",
    "Phrase 2": "Phrase2 "
  };
  return map[role];
}

export interface MdbSpec {
  name: string;
  category: string;
  bpm: number;
  timeSigNum: number;
  timeSigDen: number;
}

/** Optional MDB — not required for audio styles; kept for MIDI-only exports. */
export function buildMdb(spec: MdbSpec): Bytes {
  const enc = new TextEncoder();
  const name = enc.encode(spec.name.slice(0, 40) + "\0");
  const cat = enc.encode(spec.category.slice(0, 20) + "\0");
  const body = concat([
    tag("MNam"), writeU32BE(name.length), name,
    tag("Ctgy"), writeU32BE(cat.length), cat,
    tag("Tmpo"), writeU32BE(4), writeU32BE(Math.max(20, Math.min(500, spec.bpm)) * 1000),
    tag("TSig"), writeU32BE(2), new Uint8Array([spec.timeSigNum & 0xff, spec.timeSigDen & 0xff])
  ]);
  return concat([tag("MDB "), writeU32BE(body.length), body]);
}

/**
 * Minimal empty OTSc (4 empty OTSs slots).
 * Prefer getDefaultOtsc() from defaultOtsc.ts for Style Editor safety —
 * empty OTSc alone can still crash some SX firmware paths (SRJRRR L11).
 */
export function buildOtsc(): Bytes {
  const emptySlot = concat([tag("OTSs"), writeU32BE(2), writeU16BE(0)]);
  const body = concat([emptySlot, emptySlot, emptySlot, emptySlot]);
  return concat([tag("OTSc"), writeU32BE(body.length), body]);
}

/**
 * Lift a real OTSc chunk from a known-good .sty if present.
 * Returns null when missing or malformed.
 */
export function extractOtsc(buf: Bytes): Bytes | null {
  const tops = walkStyleTopChunks(buf);
  const hit = tops.find(c => c.id === "OTSc");
  if (hit && hit.full.length >= 16) return hit.full;
  const off = findFourCCOffset(buf, "OTSc");
  if (off < 0 || off + 8 > buf.length) return null;
  const size = readU32BE(buf, off + 4);
  if (size < 8 || size > buf.length - (off + 8)) return null;
  return buf.subarray(off, off + 8 + size);
}

/** True when OTSc has nested MTrk/OTSs payload (real OTS, not empty stub). */
export function isSubstantialOtsc(otsc: Bytes): boolean {
  if (otsc.length < 32 || readFourCC(otsc, 0) !== "OTSc") return false;
  const size = readU32BE(otsc, 4);
  if (size + 8 > otsc.length || size < 16) return false;
  // Real SX OTS embeds 4× MTrk sysex banks (~2KB each) or OTSs slots
  const body = otsc.subarray(8, 8 + size);
  const hasMtrk = findFourCCOffset(body, "MTrk") >= 0;
  const hasOtss = findFourCCOffset(body, "OTSs") >= 0;
  return (hasMtrk || hasOtss) && otsc.length >= 64;
}

/**
 * Locate a FourCC tag in a buffer (first hit). Returns offset or -1.
 */
export function findFourCCOffset(buf: Bytes, fourCC: string, from = 0): number {
  if (fourCC.length !== 4) return -1;
  const a = fourCC.charCodeAt(0), b = fourCC.charCodeAt(1);
  const c = fourCC.charCodeAt(2), d = fourCC.charCodeAt(3);
  for (let i = from; i <= buf.length - 4; i++) {
    if (buf[i] === a && buf[i + 1] === b && buf[i + 2] === c && buf[i + 3] === d) return i;
  }
  return -1;
}

/**
 * Extract a top-level RIFF-style chunk (FourCC + BE size + payload) as full bytes.
 * Prefer post-SMF top-level walk so MIDI body false-positives are ignored.
 */
export function extractChunk(buf: Bytes, fourCC: string): Bytes | null {
  const top = walkStyleTopChunks(buf).find(c => c.id === fourCC);
  if (top) return top.full;

  // Fallback: first structurally valid occurrence (size must fit).
  let from = 0;
  while (from < buf.length) {
    const off = findFourCCOffset(buf, fourCC, from);
    if (off < 0 || off + 8 > buf.length) return null;
    const size = readU32BE(buf, off + 4);
    if (size > 0 && size <= buf.length - (off + 8) && size < buf.length) {
      return buf.subarray(off, off + 8 + size);
    }
    from = off + 1;
  }
  return null;
}

/**
 * Validate a CASM block has at least one CSEG with Sdec + channel table.
 */
export function isValidCasm(casm: Bytes): boolean {
  if (casm.length < 16) return false;
  if (readFourCC(casm, 0) !== "CASM") return false;
  const size = readU32BE(casm, 4);
  if (size + 8 !== casm.length && size + 8 > casm.length) return false;
  const end = Math.min(casm.length, 8 + size);
  let p = 8;
  let hasCseg = false;
  let hasSdec = false;
  let hasTable = false;
  while (p + 8 <= end) {
    const id = readFourCC(casm, p);
    const sz = readU32BE(casm, p + 4);
    if (sz > end - (p + 8)) break;
    if (id === "CSEG") {
      hasCseg = true;
      let q = p + 8;
      const qend = p + 8 + sz;
      while (q + 8 <= qend) {
        const nid = readFourCC(casm, q);
        const nsz = readU32BE(casm, q + 4);
        if (nsz > qend - (q + 8)) break;
        if (nid === "Sdec" && nsz > 0) hasSdec = true;
        if ((nid === "Ctb2" || nid === "Ctab") && nsz >= 16) hasTable = true;
        q += 8 + nsz;
      }
    }
    p += 8 + sz;
  }
  return hasCseg && hasSdec && hasTable;
}

const SDEC_NAME_MAP: Record<string, StyleSection> = {
  "Main A": "Main A", "Main B": "Main B", "Main C": "Main C", "Main D": "Main D",
  "Intro A": "Intro A", "Intro B": "Intro B", "Intro C": "Intro C",
  "Ending A": "Ending A", "Ending B": "Ending B", "Ending C": "Ending C",
  "Fill In AA": "Fill In AA", "Fill In BB": "Fill In BB",
  "Fill In CC": "Fill In CC", "Fill In DD": "Fill In DD",
  "Fill In BA": "Break", "Break": "Break"
};

/**
 * Read section names from the first Sdec inside a CASM block.
 * SX920 rejects styles when SMF section markers do not match CASM Sdec.
 */
export function extractSectionsFromCasm(casm: Bytes): StyleSection[] {
  if (!isValidCasm(casm)) return [];
  const size = readU32BE(casm, 4);
  const end = Math.min(casm.length, 8 + size);
  let p = 8;
  while (p + 8 <= end) {
    const id = readFourCC(casm, p);
    const sz = readU32BE(casm, p + 4);
    if (sz > end - (p + 8)) break;
    if (id === "CSEG") {
      let q = p + 8;
      const qend = p + 8 + sz;
      while (q + 8 <= qend) {
        const nid = readFourCC(casm, q);
        const nsz = readU32BE(casm, q + 4);
        if (nsz > qend - (q + 8)) break;
        if (nid === "Sdec" && nsz > 0) {
          const text = new TextDecoder("latin1").decode(casm.subarray(q + 8, q + 8 + nsz));
          const out: StyleSection[] = [];
          for (const part of text.split(/[,;\0]+/)) {
            const name = part.trim();
            if (!name) continue;
            const mapped = SDEC_NAME_MAP[name];
            if (mapped && !out.includes(mapped)) out.push(mapped);
          }
          return out;
        }
        q += 8 + nsz;
      }
    }
    p += 8 + sz;
  }
  return [];
}

/**
 * True when buffer already looks like a loadable SFF2 style (blank AUS → STY copy).
 */
export function isCompleteStyleCarrier(buf: Bytes): boolean {
  if (buf.length < 64 || readFourCC(buf, 0) !== "MThd") return false;
  const smfEnd = findEffectiveSmfEnd(buf);
  if (smfEnd < 0) return false;
  const smfRegion = buf.subarray(0, Math.min(smfEnd + 64, buf.length));
  const hasSff2 = containsAscii(smfRegion, "SFF2") || containsAscii(smfRegion, "SFF1");
  const hasSInt = containsAscii(smfRegion, "SInt");
  const casm = extractCasmFromAus(buf);
  const audio = extractAudioBody(buf) ?? extractForumAudioBody(buf);
  return hasSff2 && hasSInt && !!casm && isValidCasm(casm) && !!audio && audio.body.length >= 64;
}

/**
 * Audio body for Live Audio styles (forum + SX920):
 *   Prefer AASM…EOF (includes AFil / AWav / AInf trailers)
 *   Else AFil…EOF, AWav, AUDI
 * Uses post-SMF walk first so MIDI false positives are ignored.
 */
export function extractAudioBody(ausRaw: Bytes): { body: Bytes; source: string } | null {
  const tops = walkStyleTopChunks(ausRaw);
  for (const prefer of ["AASM", "AFil", "AWav", "AUDI"] as const) {
    const hit = tops.find(c => c.id === prefer);
    if (hit) {
      // From this chunk through EOF — forum styles: AASM then AFil; SX: AASM/AWav…
      return { body: ausRaw.subarray(hit.offset), source: `${prefer}→EOF` };
    }
  }

  // Fallback scan (AUS may have odd nesting / short MTrk length).
  for (const prefer of ["AASM", "AFil", "AWav", "AUDI"] as const) {
    const off = findFourCCOffset(ausRaw, prefer);
    if (off >= 0 && off + 8 <= ausRaw.length) {
      return { body: ausRaw.subarray(off), source: `${prefer}→EOF (scan)` };
    }
  }
  return null;
}

/**
 * Forum-safe audio only: AASM (+ following AFil/AWav) without OTSc/MDB/FNRc before it.
 * Returns null if no Live Audio chunks found.
 */
export function extractForumAudioBody(ausRaw: Bytes): { body: Bytes; source: string } | null {
  // Prefer contiguous AASM…EOF (includes AFil when present after AASM)
  const aasm = findFourCCOffset(ausRaw, "AASM");
  if (aasm >= 0 && aasm + 8 <= ausRaw.length) {
    const size = readU32BE(ausRaw, aasm + 4);
    // If size is sane and next sibling is AFil, still take AASM→EOF (cleanest)
    if (size >= 0 && aasm + 8 + size <= ausRaw.length) {
      return { body: ausRaw.subarray(aasm), source: "AASM→EOF (forum)" };
    }
    return { body: ausRaw.subarray(aasm), source: "AASM→EOF (forum-scan)" };
  }
  const afil = findFourCCOffset(ausRaw, "AFil");
  if (afil >= 0) return { body: ausRaw.subarray(afil), source: "AFil→EOF (forum)" };
  return extractAudioBody(ausRaw);
}

/**
 * Prefer a proven CASM block embedded in the source .aus/.sty.
 * Scans whole file (some working styles place CASM before declared SMF end).
 */
export function extractCasmFromAus(ausRaw: Bytes): Bytes | null {
  const tops = walkStyleTopChunks(ausRaw);
  const casm = tops.find(c => c.id === "CASM");
  if (casm && isValidCasm(casm.full)) return casm.full;

  // Prefer the longest valid CASM (real tables beat MIDI false positives).
  let best: Bytes | null = null;
  let from = 0;
  while (from < ausRaw.length) {
    const off = findFourCCOffset(ausRaw, "CASM", from);
    if (off < 0) break;
    const size = readU32BE(ausRaw, off + 4);
    if (size > 0 && size <= ausRaw.length - (off + 8) && size < ausRaw.length) {
      const full = ausRaw.subarray(off, off + 8 + size);
      if (isValidCasm(full) && (!best || full.length > best.length)) {
        best = full;
      }
    }
    from = off + 1;
  }
  return best;
}

/**
 * Effective end of SMF for stitching: if a valid CASM starts before findSmfEnd
 * (common on real Live Audio styles), use CASM offset so we don't swallow CASM into SMF.
 */
export function findEffectiveSmfEnd(buf: Bytes): number {
  const smfEnd = findSmfEnd(buf);
  let from = 0;
  let casmOff = -1;
  while (from < buf.length) {
    const off = findFourCCOffset(buf, "CASM", from);
    if (off < 0) break;
    const size = readU32BE(buf, off + 4);
    if (size > 40 && size <= buf.length - (off + 8)) {
      const full = buf.subarray(off, off + 8 + size);
      if (isValidCasm(full)) {
        casmOff = off;
        break;
      }
    }
    from = off + 1;
  }
  if (casmOff >= 0 && (smfEnd < 0 || casmOff < smfEnd)) return casmOff;
  return smfEnd;
}

/**
 * Structural validation of a compiled .sty before download.
 * Catches the classic keyboard "Data not loaded properly" failure modes.
 */
export interface StyleValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  hasSff2: boolean;
  hasSInt: boolean;
  hasCasm: boolean;
  hasAudio: boolean;
  hasOtsc: boolean;
  /** Section markers found in SMF conductor (meta 0x06). */
  smfSections: string[];
  /** Sections declared in CASM Sdec. */
  casmSections: StyleSection[];
  /** Pass/fail checklist for UI. */
  checks: { id: string; label: string; ok: boolean; detail?: string }[];
  casmSourceHint?: string;
  /** Expected keyboard layout string. */
  layout: string;
}

export function validateStyleBytes(sty: Bytes): StyleValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: StyleValidation["checks"] = [];

  const failEmpty = (msg: string): StyleValidation => ({
    ok: false,
    errors: [msg],
    warnings,
    hasSff2: false,
    hasSInt: false,
    hasCasm: false,
    hasAudio: false,
    hasOtsc: false,
    smfSections: [],
    casmSections: [],
    checks: [{ id: "size", label: "File size", ok: false, detail: msg }],
    layout: ""
  });

  if (sty.length < 64) {
    return failEmpty("Style file is too small to be valid.");
  }

  if (readFourCC(sty, 0) !== "MThd") {
    errors.push("Missing MThd header — keyboard will reject this file.");
  }
  checks.push({ id: "mthd", label: "MThd header", ok: readFourCC(sty, 0) === "MThd" });

  // Format 0 required for Yamaha styles
  const isFmt0 = sty.length >= 10 && sty[8] === 0 && sty[9] === 0;
  if (!isFmt0 && readFourCC(sty, 0) === "MThd") {
    errors.push("SMF must be Format 0 (Yamaha styles are single-track multi-channel).");
  }
  checks.push({ id: "fmt0", label: "SMF Format 0", ok: isFmt0 });

  const smfEnd = findSmfEnd(sty);
  if (smfEnd < 0) {
    errors.push("Could not parse SMF track block (MThd/MTrk).");
  }
  checks.push({ id: "smf", label: "SMF parseable", ok: smfEnd > 0 });

  // Scan conductor / SMF region for required markers.
  const smfRegion = sty.subarray(0, smfEnd > 0 ? smfEnd : Math.min(sty.length, 65536));
  const hasSff2 = containsAscii(smfRegion, "SFF2") || containsAscii(smfRegion, "SFF1");
  const hasSInt = containsAscii(smfRegion, "SInt");
  if (!hasSff2) errors.push('Missing required marker "SFF2" (or SFF1) in conductor track.');
  if (!hasSInt) errors.push('Missing required marker "SInt" in conductor track.');
  checks.push({ id: "sff2", label: "SFF2 / SFF1 marker", ok: hasSff2 });
  checks.push({ id: "sint", label: "SInt marker", ok: hasSInt });

  const smfSections = extractSmfSectionMarkers(smfRegion);

  const tops = walkStyleTopChunks(sty);
  let casmChunk = tops.find(c => c.id === "CASM");
  // Some working Live Audio styles place CASM before declared SMF end — accept scan.
  let hasCasm = !!casmChunk && isValidCasm(casmChunk.full);
  if (!hasCasm) {
    const scanned = extractCasmFromAus(sty);
    if (scanned && isValidCasm(scanned)) {
      hasCasm = true;
      const off = findFourCCOffset(sty, "CASM");
      if (off >= 0) {
        casmChunk = { id: "CASM", offset: off, size: readU32BE(sty, off + 4), full: scanned };
      }
      warnings.push("CASM found via scan (before declared SMF end) — common on Live Audio styles.");
    }
  }
  if (!casmChunk && !hasCasm) {
    errors.push("Missing CASM chunk after SMF — keyboard will show “Data not loaded properly”.");
  } else if (!hasCasm) {
    errors.push("CASM chunk is present but malformed (need CSEG → Sdec + Ctb2/Ctab).");
  }
  checks.push({
    id: "casm",
    label: "CASM (CSEG + Sdec + Ctb2)",
    ok: hasCasm,
    detail: casmChunk ? `${casmChunk.size} B` : undefined
  });

  const casmSections = hasCasm && casmChunk
    ? extractSectionsFromCasm(casmChunk.full)
    : [];

  // Style Editor crash (SRJRRR L11): Live Audio styles need OTSc between CASM and AASM
  const otscChunk = tops.find(c => c.id === "OTSc") ?? (() => {
    const raw = extractOtsc(sty);
    if (!raw) return undefined;
    const off = findFourCCOffset(sty, "OTSc");
    return off >= 0
      ? { id: "OTSc", offset: off, size: readU32BE(sty, off + 4), full: raw }
      : undefined;
  })();
  const hasOtsc = !!otscChunk && isSubstantialOtsc(otscChunk.full);

  const audioChunk = tops.find(
    c => c.id === "AASM" || c.id === "AFil" || c.id === "AWav" || c.id === "AUDI"
  );
  let hasAudio = !!audioChunk && audioChunk.full.length >= 32;
  if (!hasAudio) {
    const body = extractAudioBody(sty);
    hasAudio = !!(body && body.body.length >= 32);
  }
  if (!hasAudio) {
    warnings.push(
      "No AASM/AFil/AWav/AUDI audio body — OK for MIDI-only styles; Live Audio needs AASM/AFil from .aus."
    );
  }
  checks.push({
    id: "audio",
    label: "Live Audio body (AASM/AFil)",
    ok: true,
    detail: hasAudio
      ? (audioChunk ? `${audioChunk.id} ${audioChunk.size} B` : "present")
      : "none (MIDI-only OK)"
  });

  // OTSc required when Live Audio present — prevents Style Editor SRJRRR crash
  if (hasAudio && !hasOtsc) {
    errors.push(
      "Missing OTSc after CASM — Style Editor can crash (Unexpected error / SRJRRR L11). " +
      "Working Live Audio styles use SMF → CASM → OTSc → AASM/AFil."
    );
  } else if (hasAudio && otscChunk && !isSubstantialOtsc(otscChunk.full)) {
    errors.push("OTSc is empty/stub — Style Editor needs a real 4-slot OTS block.");
  }
  checks.push({
    id: "otsc",
    label: "OTSc (One Touch Setting)",
    ok: hasAudio ? hasOtsc : true,
    detail: hasOtsc
      ? `${otscChunk!.size} B`
      : hasAudio
        ? "REQUIRED for Style Editor"
        : "optional (MIDI-only)"
  });

  // Order: CASM before OTSc before audio (when all present)
  if (casmChunk && audioChunk && casmChunk.offset > audioChunk.offset) {
    errors.push("Invalid order: audio body appears before CASM.");
  }
  if (casmChunk && otscChunk && otscChunk.offset < casmChunk.offset) {
    errors.push("Invalid order: OTSc appears before CASM.");
  }
  if (otscChunk && audioChunk && otscChunk.offset > audioChunk.offset) {
    errors.push(
      "Invalid order: OTSc after audio — keyboard Style Editor expects CASM → OTSc → AASM."
    );
  }
  const orderOk =
    !(casmChunk && audioChunk && casmChunk.offset > audioChunk.offset) &&
    !(casmChunk && otscChunk && otscChunk.offset < casmChunk.offset) &&
    !(otscChunk && audioChunk && otscChunk.offset > audioChunk.offset);
  checks.push({
    id: "order",
    label: "Chunk order (CASM → OTSc → audio)",
    ok: orderOk,
    detail: tops.map(c => c.id).join(" → ") || "(none)"
  });

  // Multi-section: SMF markers should cover CASM Sdec (or subset)
  if (casmSections.length && smfSections.length) {
    const missing = casmSections.filter(
      s => !smfSections.some(m => sectionNamesMatch(m, s))
    );
    if (missing.length) {
      warnings.push(
        `SMF section markers missing vs CASM Sdec: ${missing.slice(0, 6).join(", ")}` +
        (missing.length > 6 ? "…" : "")
      );
    }
    checks.push({
      id: "sections",
      label: "Multi-section map (SMF ↔ CASM)",
      ok: missing.length === 0,
      detail: `SMF ${smfSections.length} · CASM ${casmSections.length}`
    });
  } else if (casmSections.length) {
    warnings.push("CASM has Sdec sections but SMF has no section markers.");
    checks.push({
      id: "sections",
      label: "Multi-section map (SMF ↔ CASM)",
      ok: false,
      detail: `CASM ${casmSections.length} · SMF 0`
    });
  } else {
    checks.push({
      id: "sections",
      label: "Multi-section map (SMF ↔ CASM)",
      ok: smfSections.length > 0,
      detail: smfSections.length ? `${smfSections.length} markers` : "none"
    });
  }

  if (casmChunk && casmChunk.size < 40) {
    warnings.push("CASM is unusually small; verify channel tables on keyboard.");
  }
  if (hasAudio && audioChunk && audioChunk.size < 64) {
    warnings.push("Audio body is unusually small.");
  }

  const mdb = tops.find(c => c.id === "MDB ");
  if (mdb) warnings.push(`MDB present (${mdb.size} B)`);

  const structure = tops.map(c => c.id).join(" → ");
  if (tops.length === 0) {
    errors.push("No top-level style chunks found after SMF.");
  } else {
    warnings.push(`Top-level layout: ${structure || "(empty)"}`);
  }

  const layout = hasAudio
    ? "SMF F0 → CASM → OTSc → AASM/AFil"
    : "SMF F0 → CASM → [OTSc]";

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    hasSff2,
    hasSInt,
    hasCasm,
    hasAudio: hasAudio || !!extractAudioBody(sty),
    hasOtsc,
    smfSections,
    casmSections,
    checks,
    layout
  };
}

/** Pull FF 06 marker texts from SMF conductor region. */
export function extractSmfSectionMarkers(smfRegion: Bytes): string[] {
  const out: string[] = [];
  const skip = new Set(["SFF1", "SFF2", "SInt"]);
  for (let i = 0; i < smfRegion.length - 3; i++) {
    if (smfRegion[i] !== 0xff || smfRegion[i + 1] !== 0x06) continue;
    // VLQ length
    let j = i + 2;
    let len = 0;
    let b: number;
    do {
      if (j >= smfRegion.length) break;
      b = smfRegion[j++];
      len = (len << 7) | (b & 0x7f);
    } while (b & 0x80);
    if (len <= 0 || len > 64 || j + len > smfRegion.length) continue;
    const text = new TextDecoder("latin1").decode(smfRegion.subarray(j, j + len)).replace(/\0+$/, "").trim();
    if (!text || skip.has(text)) continue;
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

function sectionNamesMatch(smfName: string, casm: StyleSection): boolean {
  const a = smfName.trim().toLowerCase();
  const b = yamahaSectionCode(casm).toLowerCase();
  if (a === b) return true;
  if (a === "fill in ba" && casm === "Break") return true;
  if (a === "break" && casm === "Break") return true;
  return false;
}

function containsAscii(buf: Bytes, s: string): boolean {
  const n = new TextEncoder().encode(s);
  outer: for (let i = 0; i <= buf.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (buf[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

// Silence unused warning for STYLE_TOP_TAGS in case tree-shakers care.
void STYLE_TOP_TAGS;
