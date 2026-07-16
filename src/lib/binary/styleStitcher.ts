/**
 * Style stitcher — builds a keyboard-loadable SFF2 .sty from .aus + MIDI.
 *
 * Layout:
 *   MThd + MTrk (conductor: SFF2 / SInt + timed section markers)
 *   [ style MIDI tracks ]
 *   CASM (from AUS when valid, else generated Ctb2)
 *   AASM… audio body
 *   MDB  (name / category / tempo)
 *   OTSc (empty One-Touch slots)
 */

import { AusParseResult } from "./ausParser";
import { Bytes, concat, readFourCC, readU32BE, writeVLQ } from "./bytes";
import {
  buildSmf1, MidiEvent, MidiTrack, remapTrackChannel
} from "./midiParser";
import {
  buildCasm, buildMdb, buildOtsc, ChannelDef, DEFAULT_CHANNELS, extractAudioBody,
  extractCasmFromAus, findSmfEnd, FULL_SECTION_LIST, isValidCasm, StyleSection,
  validateStyleBytes, StyleValidation, yamahaSectionCode
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
  /** Optional volume 0–127 written as CC7 at tick 0. */
  volume?: number;
  /** Optional pan 0–127 written as CC10 at tick 0. */
  pan?: number;
  /** Section this track belongs to (default Main A / shared). */
  section?: StyleSection;
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
  preferAusCasm?: boolean;
  /**
   * When true (default), refuse export if AUS has no valid CASM and generation
   * would be required — set false to allow generated Ctb2 fallback.
   */
  requireAusCasm?: boolean;
  /** Write MDB after audio (default true). */
  includeMdb?: boolean;
  /** Write empty OTSc after MDB (default true). */
  includeOtsc?: boolean;
  sectionLengthTicks?: number;
  sectionBars?: number;
  /** Lift setup sysex from AUS SMF conductor when present (default true). */
  liftAusSetup?: boolean;
}

export interface StyleBuildResult {
  styBytes: Bytes;
  smfSize: number;
  casmSize: number;
  audioSize: number;
  mdbSize: number;
  otscSize: number;
  log: string[];
  validation: StyleValidation;
  casmSource: "aus" | "generated";
}

export function styleChannelToMidi(psrChannel: number): number {
  return Math.max(0, Math.min(15, psrChannel - 1));
}

export function buildStyle(opts: StyleBuildOptions): StyleBuildResult {
  const log: string[] = [];
  const channels = opts.channels ?? DEFAULT_CHANNELS;
  const preferAusCasm = opts.preferAusCasm !== false;
  const requireAusCasm = opts.requireAusCasm === true;
  const includeMdb = opts.includeMdb !== false;
  const includeOtsc = opts.includeOtsc !== false;
  const liftAusSetup = opts.liftAusSetup !== false;
  const tpq = Math.max(1, opts.ticksPerQuarter || 480);
  const ticksPerBar = Math.round(tpq * opts.timeSigNum * (4 / Math.max(1, opts.timeSigDen)));
  const ausBars = Math.max(1, opts.sectionBars ?? opts.aus.meta.bars ?? 4);

  let maxTrackTicks = 0;
  for (const at of opts.tracks) {
    for (const e of at.track.events) {
      if (e.tick > maxTrackTicks) maxTrackTicks = e.tick;
    }
  }
  const midiBars = Math.max(1, Math.ceil(maxTrackTicks / Math.max(1, ticksPerBar)));
  const contentBars = Math.max(ausBars, midiBars);
  const sectionLen = Math.max(
    tpq,
    opts.sectionLengthTicks ?? Math.round(ticksPerBar * contentBars)
  );

  const sections = dedupeSections(
    opts.sections.length ? opts.sections : (["Main A"] as StyleSection[])
  );

  const setupEvents = liftAusSetup ? extractAusSetupEvents(opts.aus.raw) : [];
  if (setupEvents.length) {
    log.push(`Conductor setup: lifted ${setupEvents.length} sysex/CC events from .aus SMF`);
  } else {
    log.push("Conductor setup: using built-in XG/style init");
  }

  const conductor = buildConductorTrack({
    bpm: opts.bpm,
    num: opts.timeSigNum,
    den: opts.timeSigDen,
    name: opts.name,
    sections,
    sectionLengthTicks: sectionLen,
    setupEvents
  });
  const trackPayloads: Bytes[] = [conductor];

  // Place each track at its section offset (default = first selected section).
  const defaultSection = sections[0] ?? "Main A";
  for (const at of opts.tracks) {
    const section = at.section && sections.includes(at.section) ? at.section : defaultSection;
    const secIdx = Math.max(0, sections.indexOf(section));
    const offset = secIdx * sectionLen;
    const midiCh = styleChannelToMidi(at.targetChannel);
    const shifted = shiftTrackEvents(at.track, offset);
    const withCc = injectChannelCc(shifted, midiCh, at.volume, at.pan);
    const raw = remapTrackChannel(withCc, midiCh, {
      program: at.program ?? 0,
      bankMsb: at.bankMsb ?? 0,
      bankLsb: at.bankLsb ?? 0
    });
    trackPayloads.push(raw);
    const sound = at.soundName ?? `GM#${(at.program ?? 0) + 1}`;
    log.push(
      `Wrapped "${at.sourceName}" → ${at.role} @ ${section} (tick ${offset}) · ch ${midiCh + 1} · ${sound}`
    );
  }

  const smf = buildSmf1(trackPayloads, tpq);
  log.push(
    `SMF: ${trackPayloads.length} tracks, ${smf.length} B · section ${sectionLen} ticks ` +
    `(${contentBars} bars · AUS ${ausBars} / MIDI ${midiBars})`
  );

  // ---- CASM ----
  let casm: Bytes;
  let casmSource: "aus" | "generated" = "generated";
  const ausCasm = preferAusCasm ? extractCasmFromAus(opts.aus.raw) : null;
  if (ausCasm && isValidCasm(ausCasm)) {
    casm = ausCasm;
    casmSource = "aus";
    log.push(`CASM: lifted from .aus (${casm.length} B)`);
  } else {
    if (requireAusCasm) {
      throw new Error(
        "No valid CASM in .aus — re-export from Audio Phraser, or disable “Require AUS CASM” to use generated tables (may fail on keyboard)."
      );
    }
    if (preferAusCasm && ausCasm) {
      log.push("CASM: .aus CASM invalid — generating Ctb2 fallback");
    } else {
      log.push("CASM: no AUS CASM — generating Ctb2 tables");
    }
    const casmSections = sections.length >= 4 ? sections : FULL_SECTION_LIST;
    casm = buildCasm({ sections: casmSections, channels });
    casmSource = "generated";
    log.push(`CASM: generated (${casm.length} B) · ${casmSections.length} sections`);
  }

  // ---- Audio ----
  const audio = extractAudioBody(opts.aus.raw);
  if (!audio) {
    throw new Error("No AASM/AWav/AUDI audio body found in .aus — keyboard will reject the style.");
  }
  if (audio.body.length < 64) {
    throw new Error(`Audio body too small (${audio.body.length} B) — keyboard will reject the style.`);
  }
  log.push(`Audio: ${audio.source} · ${audio.body.length.toLocaleString()} B`);

  // ---- Assemble: SMF → CASM → AASM → MDB → OTSc ----
  const parts: Bytes[] = [smf, casm, audio.body];
  let mdbSize = 0;
  let otscSize = 0;
  if (includeMdb) {
    const mdb = buildMdb({
      name: opts.name,
      category: opts.category,
      bpm: opts.bpm,
      timeSigNum: opts.timeSigNum,
      timeSigDen: opts.timeSigDen
    });
    parts.push(mdb);
    mdbSize = mdb.length;
    log.push(`MDB: ${mdbSize} B · ${opts.name} / ${opts.category} / ${opts.bpm} BPM`);
  }
  if (includeOtsc) {
    const otsc = buildOtsc();
    parts.push(otsc);
    otscSize = otsc.length;
    log.push(`OTSc: empty 4-slot block (${otscSize} B)`);
  }

  const styBytes = concat(parts);
  log.push(`Final .sty: ${styBytes.length.toLocaleString()} B`);
  log.push("Structure: SMF(SFF2·SInt) → CASM → AASM → MDB → OTSc");

  const validation = validateStyleBytes(styBytes);
  for (const w of validation.warnings) log.push(`⚠ ${w}`);
  if (!validation.ok) {
    for (const e of validation.errors) log.push(`✗ ${e}`);
    throw new Error(
      "Export would be rejected by keyboard (“Data not loaded properly”): " +
      validation.errors.join(" · ")
    );
  }
  if (casmSource === "generated") {
    validation.warnings.push(
      "CASM was generated — prefer AUS CASM for highest keyboard compatibility."
    );
    log.push("⚠ CASM generated (not lifted from AUS)");
  }
  log.push(`Validation OK · CASM(${casmSource}) · ${styBytes.length.toLocaleString()} B`);

  return {
    styBytes,
    smfSize: smf.length,
    casmSize: casm.length,
    audioSize: audio.body.length,
    mdbSize,
    otscSize,
    log,
    validation,
    casmSource
  };
}

function shiftTrackEvents(track: MidiTrack, offsetTicks: number): MidiTrack {
  if (!offsetTicks) return track;
  return {
    ...track,
    events: track.events.map(e => ({ ...e, tick: e.tick + offsetTicks }))
  };
}

function injectChannelCc(
  track: MidiTrack,
  channel: number,
  volume?: number,
  pan?: number
): MidiTrack {
  if (volume == null && pan == null) return track;
  const extras: MidiEvent[] = [];
  if (volume != null) {
    extras.push({
      kind: "cc",
      tick: 0,
      channel,
      controller: 7,
      value: Math.max(0, Math.min(127, volume | 0))
    });
  }
  if (pan != null) {
    extras.push({
      kind: "cc",
      tick: 0,
      channel,
      controller: 10,
      value: Math.max(0, Math.min(127, pan | 0))
    });
  }
  return { ...track, events: [...extras, ...track.events] };
}

/** Pull XG/style setup sysex + early CC from AUS SMF conductor (before first section marker). */
export function extractAusSetupEvents(ausRaw: Bytes): MidiEvent[] {
  const smfEnd = findSmfEnd(ausRaw);
  if (smfEnd < 14 || readFourCC(ausRaw, 0) !== "MThd") return [];
  // First MTrk payload
  if (readFourCC(ausRaw, 14) !== "MTrk") return [];
  const tlen = readU32BE(ausRaw, 18);
  const payload = ausRaw.subarray(22, 22 + tlen);
  const events: MidiEvent[] = [];
  let i = 0;
  let tick = 0;
  let running = 0;
  while (i < payload.length) {
    let delta = 0;
    let b: number;
    do {
      b = payload[i++];
      delta = (delta << 7) | (b & 0x7f);
    } while (b & 0x80 && i < payload.length);
    tick += delta;
    if (i >= payload.length) break;
    let status = payload[i];
    if (status < 0x80) {
      status = running;
    } else {
      running = status;
      i++;
    }
    if (status === 0xff) {
      const mt = payload[i++];
      let len = 0;
      do {
        b = payload[i++];
        len = (len << 7) | (b & 0x7f);
      } while (b & 0x80 && i < payload.length);
      const data = payload.subarray(i, i + len);
      i += len;
      if (mt === 0x06) {
        const text = new TextDecoder("latin1").decode(data);
        // Stop before section content markers (after SInt)
        if (text !== "SFF1" && text !== "SFF2" && text !== "SInt" && !text.startsWith("SFF")) {
          // first real section marker — stop collecting setup
          break;
        }
      }
      if (mt === 0x2f) break;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      let len = 0;
      do {
        b = payload[i++];
        len = (len << 7) | (b & 0x7f);
      } while (b & 0x80 && i < payload.length);
      const data = payload.subarray(i, i + len);
      i += len;
      // store without trailing F7 if present
      const body = data.length && data[data.length - 1] === 0xf7 ? data.subarray(0, data.length - 1) : data;
      events.push({ kind: "sysex", tick: 0, data: new Uint8Array(body) });
      continue;
    }
    const type = status & 0xf0;
    const ch = status & 0x0f;
    if (type === 0xb0) {
      const ctrl = payload[i++];
      const val = payload[i++];
      // Keep bank/volume/pan/reverb/chorus style init
      if (ctrl === 0 || ctrl === 32 || ctrl === 7 || ctrl === 10 || ctrl === 91 || ctrl === 93) {
        events.push({ kind: "cc", tick: 0, channel: ch, controller: ctrl, value: val });
      }
    } else if (type === 0xc0) {
      const prog = payload[i++];
      events.push({ kind: "program", tick: 0, channel: ch, program: prog });
    } else if (type === 0x80 || type === 0x90) {
      i += 2; // skip notes in setup region
    } else if (type === 0xe0 || type === 0xa0) {
      i += 2;
    } else if (type === 0xd0) {
      i += 1;
    } else {
      break;
    }
    // Cap setup collection
    if (events.length > 120) break;
  }
  return events;
}

function buildConductorTrack(opts: {
  bpm: number;
  num: number;
  den: number;
  name: string;
  sections: StyleSection[];
  sectionLengthTicks: number;
  setupEvents: MidiEvent[];
}): Bytes {
  const usPerQuarter = Math.round(60_000_000 / Math.max(20, Math.min(500, opts.bpm)));
  const denomPow = Math.round(Math.log2(opts.den || 4));
  const nameRaw = new TextEncoder().encode(opts.name.slice(0, 31));
  const namePad = new Uint8Array(32);
  namePad.fill(0x00);
  namePad.set(nameRaw);

  const parts: Bytes[] = [];
  const push = (bytes: number[] | Uint8Array) => {
    parts.push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  };
  let lastTick = 0;
  const at = (tick: number, bytes: number[] | Uint8Array) => {
    const delta = Math.max(0, tick - lastTick);
    parts.push(writeVLQ(delta));
    push(bytes);
    lastTick = tick;
  };

  at(0, [0xff, 0x58, 0x04, opts.num & 0xff, denomPow & 0xff, 24, 8]);
  at(0, [
    0xff, 0x51, 0x03,
    (usPerQuarter >> 16) & 0xff,
    (usPerQuarter >> 8) & 0xff,
    usPerQuarter & 0xff
  ]);
  at(0, [0xff, 0x06, 0x04, 0x53, 0x46, 0x46, 0x32]);
  at(0, concat([new Uint8Array([0xff, 0x03, 0x20]), namePad]));

  if (opts.setupEvents.length) {
    for (const e of opts.setupEvents) {
      if (e.kind === "sysex") {
        // F0 <vlq len including F7> data F7
        const body = e.data;
        const withF7 = body.length && body[body.length - 1] === 0xf7
          ? body
          : concat([body, new Uint8Array([0xf7])]);
        at(0, concat([new Uint8Array([0xf0]), writeVLQ(withF7.length), withF7]));
      } else if (e.kind === "cc") {
        at(0, [0xb0 | (e.channel & 0x0f), e.controller & 0x7f, e.value & 0x7f]);
      } else if (e.kind === "program") {
        at(0, [0xc0 | (e.channel & 0x0f), e.program & 0x7f]);
      }
    }
  } else {
    at(0, [0xf0, 0x08, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]);
    at(0, [0xb8, 0x00, 0x7f]);
    at(0, [0xb9, 0x00, 0x7f]);
    at(0, [0xb8, 0x20, 0x00]);
    at(0, [0xb9, 0x20, 0x00]);
    at(0, [0xc8, 0x00]);
    at(0, [0xc9, 0x00]);
  }

  at(0, [0xff, 0x06, 0x04, 0x53, 0x49, 0x6e, 0x74]);

  const unique = opts.sections.slice(0, 8);
  for (let i = 0; i < unique.length; i++) {
    const label = new TextEncoder().encode(yamahaSectionCode(unique[i]));
    if (label.length > 127) continue;
    const tick = i * opts.sectionLengthTicks;
    at(tick, concat([new Uint8Array([0xff, 0x06, label.length]), label]));
  }

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
