/**
 * Style stitcher — builds a keyboard-loadable SFF2 .sty from .aus + MIDI.
 *
 * Real Yamaha audio styles (PSR-SX / Genos) are laid out as:
 *
 *   MThd + MTrk (conductor with SFF2 / SInt markers + timed section markers)
 *   [ optional extra MTrk for MIDI style channels ]
 *   CASM  (CSEG → Sdec + Ctb2×N)   — often lifted from the .aus
 *   AASM…AWav…Adat…AInf…           — audio body lifted from the .aus
 *
 * Missing SFF2/SInt markers, zero-length section markers, or a malformed CASM
 * causes the keyboard error "Data not loaded properly".
 */

import { AusParseResult } from "./ausParser";
import { Bytes, concat, writeVLQ } from "./bytes";
import {
  buildSmf1, MidiTrack, remapTrackChannel
} from "./midiParser";
import {
  buildCasm, ChannelDef, DEFAULT_CHANNELS, extractAudioBody,
  extractCasmFromAus, FULL_SECTION_LIST, isValidCasm, StyleSection,
  validateStyleBytes, StyleValidation
} from "./sff2Writer";

export interface AssignedTrack {
  sourceName: string;
  track: MidiTrack;
  targetChannel: number;
  role: ChannelDef["role"];
  program?: number;
  bankMsb?: number;
  bankLsb?: number;
  soundName?: string;
}

export interface StyleBuildOptions {
  name: string;
  category: string;
  bpm: number;
  timeSigNum: number;
  timeSigDen: number;
  sections: StyleSection[];
  ticksPerQuarter: number;
  aus: AusParseResult;
  tracks: AssignedTrack[];
  channels?: ChannelDef[];
  /** Prefer CASM embedded in the .aus when present (recommended). */
  preferAusCasm?: boolean;
  /** Include OTSc/MDB placeholders (usually not needed for audio styles). */
  includeExtras?: boolean;
  /**
   * Length of one style section in ticks. Defaults to 4 bars of the time signature.
   * Section markers must be spaced — putting them all at tick 0 makes zero-length
   * sections and keyboards reject the file.
   */
  sectionLengthTicks?: number;
  /** Bars per section when sectionLengthTicks is not set (default 4). */
  sectionBars?: number;
}

export interface StyleBuildResult {
  styBytes: Bytes;
  smfSize: number;
  casmSize: number;
  audioSize: number;
  log: string[];
  validation: StyleValidation;
  casmSource: "aus" | "generated";
}

/** Convert user-visible "PSR channel 11..16" into the SMF's 0-based channel. */
export function styleChannelToMidi(psrChannel: number): number {
  return Math.max(0, Math.min(15, psrChannel - 1));
}

export function buildStyle(opts: StyleBuildOptions): StyleBuildResult {
  const log: string[] = [];
  const channels = opts.channels ?? DEFAULT_CHANNELS;
  const preferAusCasm = opts.preferAusCasm !== false;
  const tpq = Math.max(1, opts.ticksPerQuarter || 480);
  const bars = Math.max(1, opts.sectionBars ?? 4);
  const ticksPerBar = tpq * opts.timeSigNum * (4 / Math.max(1, opts.timeSigDen));
  const sectionLen = Math.max(
    tpq,
    opts.sectionLengthTicks ?? Math.round(ticksPerBar * bars)
  );

  // ---- 1. Conductor track with mandatory SFF2 / SInt markers ------------
  const sections = opts.sections.length ? opts.sections : (["Main A"] as StyleSection[]);
  const conductor = buildConductorTrack({
    bpm: opts.bpm,
    num: opts.timeSigNum,
    den: opts.timeSigDen,
    name: opts.name,
    sections,
    sectionLengthTicks: sectionLen
  });
  const trackPayloads: Bytes[] = [conductor];

  // Measure longest assigned track so section grid covers MIDI content.
  let maxTrackTicks = 0;
  for (const at of opts.tracks) {
    for (const e of at.track.events) {
      if (e.tick > maxTrackTicks) maxTrackTicks = e.tick;
    }
  }

  for (const at of opts.tracks) {
    const midiCh = styleChannelToMidi(at.targetChannel);
    const raw = remapTrackChannel(at.track, midiCh, {
      program: at.program ?? 0,
      bankMsb: at.bankMsb ?? 0,
      bankLsb: at.bankLsb ?? 0
    });
    trackPayloads.push(raw);
    const sound = at.soundName ?? `GM#${(at.program ?? 0) + 1}`;
    log.push(`Wrapped "${at.sourceName}" → ${at.role} (MIDI ch ${midiCh + 1}) · ${sound}`);
  }

  const smf = buildSmf1(trackPayloads, tpq);
  log.push(
    `SMF built: ${trackPayloads.length} tracks, ${smf.length} bytes · ` +
    `section grid ${sectionLen} ticks (${bars} bars) · max MIDI ${maxTrackTicks} ticks`
  );

  // ---- 2. CASM ----------------------------------------------------------
  let casm: Bytes;
  let casmSource: "aus" | "generated" = "generated";
  const ausCasm = preferAusCasm ? extractCasmFromAus(opts.aus.raw) : null;
  if (ausCasm && isValidCasm(ausCasm)) {
    casm = ausCasm;
    casmSource = "aus";
    log.push(`CASM: lifted from .aus (${casm.length} B) — preserves keyboard channel map`);
  } else {
    if (preferAusCasm && ausCasm) {
      log.push("CASM: .aus CASM found but failed structural check — generating fallback");
    } else if (preferAusCasm) {
      log.push("CASM: no valid CASM in .aus — generating Ctb2 tables");
    }
    const casmSections = sections.length >= 4 ? sections : FULL_SECTION_LIST;
    casm = buildCasm({ sections: casmSections, channels });
    casmSource = "generated";
    log.push(`CASM: generated Ctb2 tables (${casm.length} B) · ${casmSections.length} sections`);
  }

  // ---- 3. Audio body (AASM→EOF preferred) -------------------------------
  const audio = extractAudioBody(opts.aus.raw);
  if (!audio) {
    throw new Error(
      "No AASM/AWav/AUDI audio body found in .aus — keyboard will reject the style."
    );
  }
  if (audio.body.length < 64) {
    throw new Error(
      `Audio body too small (${audio.body.length} B) — keyboard will reject the style.`
    );
  }
  const audioBlock = audio.body;
  log.push(`Audio body: ${audio.source} · ${audioBlock.length.toLocaleString()} bytes`);

  // ---- 4. Concatenate in Yamaha order -----------------------------------
  // SMF → CASM → AASM/audio. Do NOT insert fake OTSc/MDB before AASM —
  // real audio styles go CASM straight into AASM.
  const parts: Bytes[] = [smf, casm, audioBlock];
  if (opts.includeExtras) {
    // Reserved for future optional extras after audio (rarely needed).
  }

  const styBytes = concat(parts);
  log.push(`Final .sty size: ${styBytes.length.toLocaleString()} bytes`);
  log.push("Structure: MThd/MTrk(SFF2·SInt + timed sections) → CASM → AASM/audio");

  // ---- 5. Hard validation before returning downloadable bytes -----------
  const validation = validateStyleBytes(styBytes);
  for (const w of validation.warnings) log.push(`⚠ ${w}`);
  if (!validation.ok) {
    for (const e of validation.errors) log.push(`✗ ${e}`);
    throw new Error(
      "Export would be rejected by keyboard (“Data not loaded properly”): " +
      validation.errors.join(" · ")
    );
  }
  log.push(
    `Validation OK · SFF2/SInt · CASM(${casmSource}) · audio · ` +
    `${styBytes.length.toLocaleString()} B`
  );

  return {
    styBytes,
    smfSize: smf.length,
    casmSize: casm.length,
    audioSize: audioBlock.length,
    log,
    validation,
    casmSource
  };
}

/**
 * Conductor MTrk payload with the markers Yamaha requires to accept a style:
 *   time-sig, tempo, "SFF2", track name, XG-ish setup sysex, "SInt",
 *   timed section marker(s), End of Track.
 *
 * CRITICAL: section markers must be spaced by sectionLengthTicks.
 * Putting every section at delta 0 creates zero-length sections and
 * keyboards report "Data not loaded properly".
 */
function buildConductorTrack(opts: {
  bpm: number;
  num: number;
  den: number;
  name: string;
  sections: StyleSection[];
  sectionLengthTicks: number;
}): Bytes {
  const usPerQuarter = Math.round(60_000_000 / Math.max(20, Math.min(500, opts.bpm)));
  const denomPow = Math.round(Math.log2(opts.den || 4));
  // Track name: 32 bytes space/null padded (Yamaha convention).
  const nameRaw = new TextEncoder().encode(opts.name.slice(0, 31));
  const namePad = new Uint8Array(32);
  namePad.fill(0x00);
  namePad.set(nameRaw);

  const parts: Bytes[] = [];
  const push = (bytes: number[] | Uint8Array) => {
    parts.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  };
  /** Absolute-tick event writer (delta from previous event). */
  let lastTick = 0;
  const at = (tick: number, bytes: number[] | Uint8Array) => {
    const delta = Math.max(0, tick - lastTick);
    parts.push(writeVLQ(delta));
    push(bytes);
    lastTick = tick;
  };

  // tick 0: time signature
  at(0, [0xff, 0x58, 0x04, opts.num & 0xff, denomPow & 0xff, 24, 8]);
  // tick 0: tempo
  at(0, [
    0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff,
    (usPerQuarter >> 8) & 0xff,
    usPerQuarter & 0xff
  ]);
  // tick 0: marker "SFF2" — REQUIRED for SX/Genos style loader
  at(0, [0xff, 0x06, 0x04, 0x53, 0x46, 0x46, 0x32]);
  // tick 0: track name (meta 0x03), 32-byte field
  at(0, concat([new Uint8Array([0xff, 0x03, 0x20]), namePad]));

  // Yamaha style setup sysex (from working ContempRock / Audio Phraser dumps)
  // XG system on
  at(0, [0xf0, 0x08, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]);
  // Channel volume / bank init for style rhythm parts (minimal safe set)
  at(0, [0xb8, 0x00, 0x7f]); // ch9 bank MSB
  at(0, [0xb9, 0x00, 0x7f]); // ch10 bank MSB
  at(0, [0xb8, 0x20, 0x00]);
  at(0, [0xb9, 0x20, 0x00]);
  at(0, [0xc8, 0x00]);
  at(0, [0xc9, 0x00]);

  // Marker "SInt" — Style Intro / section-init boundary (REQUIRED)
  at(0, [0xff, 0x06, 0x04, 0x53, 0x49, 0x6e, 0x74]);

  // Timed section markers so the keyboard can split Main A / B / …
  // First section starts at tick 0 (same as ContempRock "Main A" after SInt
  // setup — we place Main A at sectionLengthTicks*0 after a short pad of 0).
  // ContempRock places first section later; for audio styles a non-zero first
  // section offset of 0 is OK as long as subsequent ones advance.
  const sectionNames: StyleSection[] = opts.sections.length ? opts.sections : ["Main A"];
  const unique = dedupeSections(sectionNames).slice(0, 8);
  for (let i = 0; i < unique.length; i++) {
    const label = new TextEncoder().encode(unique[i]);
    // Meta marker: FF 06 <len> <text> — len as single byte when < 128
    if (label.length > 127) continue;
    const tick = i * opts.sectionLengthTicks;
    at(tick, concat([new Uint8Array([0xff, 0x06, label.length]), label]));
  }

  // End of track after last section window so the SMF has non-zero duration.
  const eotTick = Math.max(lastTick, unique.length * opts.sectionLengthTicks);
  at(eotTick, [0xff, 0x2f, 0x00]);
  return concat(parts);
}

function dedupeSections(sections: StyleSection[]): StyleSection[] {
  const seen = new Set<string>();
  const out: StyleSection[] = [];
  for (const s of sections) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.length ? out : ["Main A"];
}
