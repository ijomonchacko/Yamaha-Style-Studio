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
  "CASM", "OTSc", "MDB ", "AASM", "AWav", "AUDI", "FNRc", "MTRK", "CSEG"
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
  const tags = ["CASM", "OTSc", "MDB ", "AASM", "AWav", "AUDI", "FNRc"];
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

/** Optional empty One-Touch Settings (4 slots). */
export function buildOtsc(): Bytes {
  const emptySlot = concat([tag("OTSs"), writeU32BE(2), writeU16BE(0)]);
  const body = concat([emptySlot, emptySlot, emptySlot, emptySlot]);
  return concat([tag("OTSc"), writeU32BE(body.length), body]);
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

/**
 * Audio body for SFF2 styles: everything from AASM (preferred) or AWav to EOF.
 * Uses post-SMF top-level walk so MIDI false positives are ignored.
 */
export function extractAudioBody(ausRaw: Bytes): { body: Bytes; source: string } | null {
  const tops = walkStyleTopChunks(ausRaw);
  for (const prefer of ["AASM", "AWav", "AUDI"] as const) {
    const hit = tops.find(c => c.id === prefer);
    if (hit) {
      // Take from this chunk through EOF — real styles keep trailing AInf etc.
      return { body: ausRaw.subarray(hit.offset), source: `${prefer}→EOF` };
    }
  }

  // Fallback substring search with size sanity (legacy / partial containers).
  for (const prefer of ["AASM", "AWav", "AUDI"] as const) {
    const off = findFourCCOffset(ausRaw, prefer);
    if (off >= 0 && off + 8 <= ausRaw.length) {
      return { body: ausRaw.subarray(off), source: `${prefer}→EOF (scan)` };
    }
  }
  return null;
}

/**
 * Prefer a proven CASM block embedded in the source .aus (post-SMF only).
 */
export function extractCasmFromAus(ausRaw: Bytes): Bytes | null {
  const tops = walkStyleTopChunks(ausRaw);
  const casm = tops.find(c => c.id === "CASM");
  if (casm && isValidCasm(casm.full)) return casm.full;

  // Fallback: first valid CASM in the whole buffer (skips MIDI false hits).
  let from = 0;
  while (from < ausRaw.length) {
    const off = findFourCCOffset(ausRaw, "CASM", from);
    if (off < 0) return null;
    const size = readU32BE(ausRaw, off + 4);
    if (size > 0 && size <= ausRaw.length - (off + 8)) {
      const full = ausRaw.subarray(off, off + 8 + size);
      if (isValidCasm(full)) return full;
    }
    from = off + 1;
  }
  return null;
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
  casmSourceHint?: string;
}

export function validateStyleBytes(sty: Bytes): StyleValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (sty.length < 64) {
    errors.push("Style file is too small to be valid.");
    return { ok: false, errors, warnings, hasSff2: false, hasSInt: false, hasCasm: false, hasAudio: false };
  }

  if (readFourCC(sty, 0) !== "MThd") {
    errors.push("Missing MThd header — keyboard will reject this file.");
  }

  const smfEnd = findSmfEnd(sty);
  if (smfEnd < 0) {
    errors.push("Could not parse SMF track block (MThd/MTrk).");
  }

  // Scan conductor / SMF region for required markers.
  const smfRegion = sty.subarray(0, smfEnd > 0 ? smfEnd : Math.min(sty.length, 65536));
  const hasSff2 = containsAscii(smfRegion, "SFF2") || containsAscii(smfRegion, "SFF1");
  const hasSInt = containsAscii(smfRegion, "SInt");
  if (!hasSff2) errors.push('Missing required marker "SFF2" (or SFF1) in conductor track.');
  if (!hasSInt) errors.push('Missing required marker "SInt" in conductor track.');

  const tops = walkStyleTopChunks(sty);
  const casmChunk = tops.find(c => c.id === "CASM");
  const hasCasm = !!casmChunk && isValidCasm(casmChunk.full);
  if (!casmChunk) {
    errors.push("Missing CASM chunk after SMF — keyboard will show “Data not loaded properly”.");
  } else if (!hasCasm) {
    errors.push("CASM chunk is present but malformed (need CSEG → Sdec + Ctb2/Ctab).");
  }

  const audioChunk = tops.find(c => c.id === "AASM" || c.id === "AWav" || c.id === "AUDI");
  const hasAudio = !!audioChunk && audioChunk.full.length >= 32;
  if (!hasAudio) {
    // Also accept AASM→EOF body even if size field is odd.
    const body = extractAudioBody(sty);
    if (!body || body.body.length < 32) {
      errors.push("Missing AASM/AWav/AUDI audio body — keyboard will reject the style.");
    }
  }

  // Order check: CASM should appear before audio.
  if (casmChunk && audioChunk && casmChunk.offset > audioChunk.offset) {
    errors.push("Invalid order: audio body appears before CASM.");
  }

  if (casmChunk && casmChunk.size < 40) {
    warnings.push("CASM is unusually small; verify channel tables on keyboard.");
  }
  if (hasAudio && audioChunk && audioChunk.size < 64) {
    warnings.push("Audio body is unusually small.");
  }

  // Expected structure: SMF → CASM → audio (no required OTSc for audio styles)
  const structure = tops.map(c => c.id).join(" → ");
  if (tops.length === 0) {
    errors.push("No top-level style chunks found after SMF.");
  } else {
    warnings.push(`Top-level layout: ${structure || "(empty)"}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    hasSff2,
    hasSInt,
    hasCasm,
    hasAudio: hasAudio || !!extractAudioBody(sty)
  };
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
