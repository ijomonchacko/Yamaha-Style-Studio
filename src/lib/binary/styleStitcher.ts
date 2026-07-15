/**
 * Style stitcher — builds a keyboard-loadable SFF2 .sty from .aus + MIDI.
 *
 * Real Yamaha audio styles (PSR-SX / Genos) are laid out as:
 *
 *   MThd + MTrk (conductor with SFF2 / SInt markers + section markers)
 *   [ optional extra MTrk for MIDI style channels ]
 *   CASM  (CSEG → Sdec + Ctb2×N)   — often lifted from the .aus
 *   AASM…AWav…Adat…AInf…           — audio body lifted from the .aus
 *
 * Missing SFF2/SInt markers or a malformed CASM causes the keyboard error
 * "Data not loaded properly".
 */

import { AusParseResult } from "./ausParser";
import { Bytes, concat } from "./bytes";
import {
  buildSmf1, MidiTrack, remapTrackChannel
} from "./midiParser";
import {
  buildCasm, ChannelDef, DEFAULT_CHANNELS, extractAudioBody,
  extractCasmFromAus, FULL_SECTION_LIST, StyleSection
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
}

export interface StyleBuildResult {
  styBytes: Bytes;
  smfSize: number;
  casmSize: number;
  audioSize: number;
  log: string[];
}

/** Convert user-visible "PSR channel 11..16" into the SMF's 0-based channel. */
export function styleChannelToMidi(psrChannel: number): number {
  return Math.max(0, Math.min(15, psrChannel - 1));
}

export function buildStyle(opts: StyleBuildOptions): StyleBuildResult {
  const log: string[] = [];
  const channels = opts.channels ?? DEFAULT_CHANNELS;
  const preferAusCasm = opts.preferAusCasm !== false;

  // ---- 1. Conductor track with mandatory SFF2 / SInt markers ------------
  const sections = opts.sections.length ? opts.sections : (["Main A"] as StyleSection[]);
  const conductor = buildConductorTrack({
    bpm: opts.bpm,
    num: opts.timeSigNum,
    den: opts.timeSigDen,
    name: opts.name,
    sections
  });
  const trackPayloads: Bytes[] = [conductor];

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

  // No extra marker track — section markers live inside the conductor (SFF2 style).
  const smf = buildSmf1(trackPayloads, opts.ticksPerQuarter);
  log.push(`SMF built: ${trackPayloads.length} tracks, ${smf.length} bytes (SFF2+SInt markers)`);

  // ---- 2. CASM ----------------------------------------------------------
  let casm: Bytes;
  const ausCasm = preferAusCasm ? extractCasmFromAus(opts.aus.raw) : null;
  if (ausCasm && ausCasm.length > 16) {
    casm = ausCasm;
    log.push(`CASM: lifted from .aus (${casm.length} B) — preserves keyboard channel map`);
  } else {
    const casmSections = sections.length >= 4 ? sections : FULL_SECTION_LIST;
    casm = buildCasm({ sections: casmSections, channels });
    log.push(`CASM: generated Ctb2 tables (${casm.length} B) · ${casmSections.length} sections`);
  }

  // ---- 3. Audio body (AASM→EOF preferred) -------------------------------
  const audio = extractAudioBody(opts.aus.raw);
  if (!audio) {
    throw new Error(
      "No AASM/AWav/AUDI audio body found in .aus — keyboard will reject the style."
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
  log.push("Structure: MThd/MTrk(SFF2·SInt) → CASM → AASM/audio");

  return {
    styBytes,
    smfSize: smf.length,
    casmSize: casm.length,
    audioSize: audioBlock.length,
    log
  };
}

/**
 * Conductor MTrk payload with the markers Yamaha requires to accept a style:
 *   time-sig, tempo, "SFF2", track name, XG-ish setup sysex, "SInt",
 *   section marker(s), End of Track.
 */
function buildConductorTrack(opts: {
  bpm: number;
  num: number;
  den: number;
  name: string;
  sections: StyleSection[];
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

  // delta 0, time signature
  push([0x00, 0xff, 0x58, 0x04, opts.num & 0xff, denomPow & 0xff, 24, 8]);
  // delta 0, tempo
  push([
    0x00, 0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff,
    (usPerQuarter >> 8) & 0xff,
    usPerQuarter & 0xff
  ]);
  // delta 0, marker "SFF2" — REQUIRED for SX/Genos style loader
  push([0x00, 0xff, 0x06, 0x04, 0x53, 0x46, 0x46, 0x32]);
  // delta 0, track name (meta 0x03), 32-byte field
  push([0x00, 0xff, 0x03, 0x20]);
  push(namePad);

  // Yamaha style setup sysex (from working ContempRock / Audio Phraser dumps)
  // XG system on
  push([0x00, 0xf0, 0x08, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]);
  // Channel volume / bank init for style rhythm parts (minimal safe set)
  push([0x00, 0xb8, 0x00, 0x7f]); // ch9 bank MSB
  push([0x00, 0xb9, 0x00, 0x7f]); // ch10 bank MSB
  push([0x00, 0xb8, 0x20, 0x00]);
  push([0x00, 0xb9, 0x20, 0x00]);
  push([0x00, 0xc8, 0x00]);
  push([0x00, 0xc9, 0x00]);

  // Marker "SInt" — Style Intro / section-init boundary (REQUIRED)
  push([0x00, 0xff, 0x06, 0x04, 0x53, 0x49, 0x6e, 0x74]);

  // Section markers so the keyboard can split Main A / B / …
  const sectionNames = opts.sections.length ? opts.sections : ["Main A"];
  for (const s of sectionNames.slice(0, 8)) {
    const label = new TextEncoder().encode(s);
    push([0x00, 0xff, 0x06, label.length]);
    push(label);
  }

  // End of track
  push([0x00, 0xff, 0x2f, 0x00]);
  return concat(parts);
}
