/**
 * Style stitcher — builds a keyboard-loadable SFF2 .sty from .aus + MIDI.
 *
 * Forum-safe path (psr tutorial):
 *   SMF Format 0 (SFF2 + SInt [+ optional timeline MIDI only])
 *   → CASM from AUS only (never a demo STY body)
 *   → AASM + AFil/AWav audio from AUS only
 *
 * Never grafts ContempRock/demo MIDI channels into the export.
 */

import { AusParseResult } from "./ausParser";
import { Bytes, concat, readFourCC, readU32BE, writeVLQ } from "./bytes";
import {
  buildSmf0, MidiEvent, MidiTrack, remapTrackChannel
} from "./midiParser";
import {
  buildCasm, buildMdb, buildOtsc, ChannelDef, DEFAULT_CHANNELS, extractAudioBody,
  extractCasmFromAus, extractForumAudioBody, extractOtsc, extractSectionsFromCasm,
  findEffectiveSmfEnd, findSmfEnd, FULL_SECTION_LIST, isCompleteStyleCarrier,
  isSubstantialOtsc, isValidCasm, StyleSection, validateStyleBytes, StyleValidation,
  yamahaSectionCode
} from "./sff2Writer";
import { getDefaultOtsc } from "./defaultOtsc";

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
  /** Optional reverb send 0–127 written as CC91 at tick 0. */
  reverb?: number;
  /** Optional chorus send 0–127 written as CC93 at tick 0. */
  chorus?: number;
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
  /**
   * Insert OTSc after CASM (default true).
   * Required for Live Audio Style Editor — missing OTSc causes SRJRRR L11 crash.
   */
  includeOtsc?: boolean;
  sectionLengthTicks?: number;
  sectionBars?: number;
  /**
   * Per-section length overrides (bars). When set, conductor markers use
   * cumulative bar lengths instead of equal sectionLengthTicks.
   */
  sectionBarMap?: Partial<Record<StyleSection, number>>;
  /** Lift setup sysex from AUS SMF conductor when present (default true). */
  liftAusSetup?: boolean;
  /**
   * When re-exporting an opened .sty, keep post-SMF chunks (CASM/AASM/MDB/OTSc)
   * byte-for-byte from the original file. Only the SMF block is rebuilt.
   */
  preservePostSmfFrom?: Bytes;
  /**
   * Blank AUS → STY: when true (or auto when no MIDI tracks), prefer a byte-stable
   * conversion that keeps the Audio Phraser SMF + CASM + AASM intact.
   */
  blankAusConvert?: boolean;
  /**
   * Forum-safe convert (default true for AUS path):
   * - CASM + AASM/AFil only from the opened .aus
   * - zero demo-template MIDI
   * - timeline MIDI parts included only when provided in `tracks`
   */
  forumSafe?: boolean;
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
  // Default true: refuse export without real CASM (avoids keyboard “Data not loaded”)
  const requireAusCasm = opts.requireAusCasm !== false;
  const includeMdb = opts.includeMdb !== false;
  const includeOtsc = opts.includeOtsc !== false;
  const liftAusSetup = opts.liftAusSetup !== false;
  const forumSafe = opts.forumSafe !== false;
  const tpq = Math.max(1, opts.ticksPerQuarter || 480);
  const ticksPerBar = Math.round(tpq * opts.timeSigNum * (4 / Math.max(1, opts.timeSigDen)));
  const ausBars = Math.max(1, opts.sectionBars ?? opts.aus.meta.bars ?? 4);
  const noMidiParts = !opts.tracks.length;
  const blankConvert = opts.blankAusConvert === true || (opts.blankAusConvert !== false && noMidiParts);

  // ---- CASM: AUS only (never inject demo STY CASM/MIDI) ----
  let casm: Bytes;
  let casmSource: "aus" | "generated" = "generated";
  const ausCasm = preferAusCasm ? extractCasmFromAus(opts.aus.raw) : null;
  if (ausCasm && isValidCasm(ausCasm)) {
    casm = ausCasm;
    casmSource = "aus";
    log.push(`CASM: lifted from AUS only (${casm.length} B) — no demo template`);
  } else if (requireAusCasm) {
    throw new Error(
      "No valid CASM in the opened .aus/.sty. " +
      "Audio Phraser must embed CASM in the .aus. " +
      "Without it, PSR-SX / Genos show “Data not loaded properly”. " +
      "Re-export the Live Audio Style from Audio Phraser, or open a .sty that already loads."
    );
  } else {
    const casmSections = FULL_SECTION_LIST;
    casm = buildCasm({ sections: casmSections, channels });
    casmSource = "generated";
    log.push(
      `CASM: generated full SFF2 Ctb2 (${casm.length} B) · ${casmSections.length} sections — ` +
      "may still fail on some keyboards; prefer AUS CASM"
    );
  }

  // Forum audio: AASM (+ AFil) from AUS only — never from a demo STY graft
  const forumAudio =
    extractForumAudioBody(opts.aus.raw) ?? extractAudioBody(opts.aus.raw);

  // Resolve OTSc early — Live Audio Style Editor requires CASM → OTSc → AASM
  const otscBlock = resolveOtsc(opts.aus.raw, includeOtsc, log);

  // ---- Blank AUS (no timeline MIDI): pure AUS → STY ----
  if (blankConvert && noMidiParts) {
    if (forumSafe && forumAudio && casmSource === "aus") {
      // Prefer byte-stable full carrier when AUS already has SMF+CASM+OTSc+audio
      if (isCompleteStyleCarrier(opts.aus.raw)) {
        let styBytes = opts.aus.raw;
        let validation = validateStyleBytes(styBytes);
        // Inject OTSc if source AUS is missing it (common Audio Phraser export)
        if (!validation.ok && validation.errors.some(e => /OTSc/i.test(e)) && otscBlock) {
          styBytes = injectOtscAfterCasm(styBytes, otscBlock);
          validation = validateStyleBytes(styBytes);
          log.push(`Blank carrier: injected OTSc (${otscBlock.length} B) for Style Editor safety`);
        }
        const smfEnd = findEffectiveSmfEnd(styBytes);
        for (const w of validation.warnings) log.push(`⚠ ${w}`);
        if (!validation.ok) {
          log.push("Blank carrier validation failed — re-packing SMF→CASM→OTSc→AASM/AFil");
        } else {
          log.push("Blank AUS → STY: byte-stable (no demo MIDI, AUS only)");
          log.push("Method: SMF + CASM + OTSc + AASM/AFil");
          log.push(`Final .sty: ${styBytes.length.toLocaleString()} B`);
          log.push("Structure: SMF → CASM → OTSc → AASM/AFil");
          log.push(`Validation OK · CASM(aus) · ${styBytes.length.toLocaleString()} B`);
          return {
            styBytes,
            smfSize: smfEnd > 0 ? smfEnd : 0,
            casmSize: casm.length,
            audioSize: forumAudio.body.length,
            mdbSize: 0,
            otscSize: otscBlock?.length ?? 0,
            log,
            validation,
            casmSource
          };
        }
      }

      // Rebuild minimal conductor SMF + AUS CASM + OTSc + AUS audio
      const sections = dedupeSections(
        extractSectionsFromCasm(casm).length
          ? extractSectionsFromCasm(casm)
          : (opts.sections.length ? opts.sections : (["Main A"] as StyleSection[]))
      );
      const sectionLen = Math.max(tpq, opts.sectionLengthTicks ?? ticksPerBar * ausBars);
      const setupEvents = liftAusSetup ? extractAusSetupEvents(opts.aus.raw) : [];
      const conductor = buildConductorTrack({
        bpm: opts.bpm,
        num: opts.timeSigNum,
        den: opts.timeSigDen,
        name: opts.name,
        sections,
        sectionLengthTicks: sectionLen,
        sectionBarMap: opts.sectionBarMap,
        ticksPerBar,
        setupEvents
      });
      const smf = buildSmf0([conductor], tpq);
      const parts: Bytes[] = [smf, casm];
      let otscSize = 0;
      if (otscBlock) {
        parts.push(otscBlock);
        otscSize = otscBlock.length;
      }
      parts.push(forumAudio.body);
      const styBytes = concat(parts);
      log.push("Blank convert: SMF(conductor) + CASM(AUS) + OTSc + audio(AUS)");
      log.push("Method: SMF → CASM → OTSc → AASM/AFil · zero demo STY");
      log.push(`Audio (AUS only): ${forumAudio.source} · ${forumAudio.body.length.toLocaleString()} B`);
      log.push("No demo STY MIDI channels included");
      const validation = validateStyleBytes(styBytes);
      for (const w of validation.warnings) log.push(`⚠ ${w}`);
      if (!validation.ok) {
        for (const e of validation.errors) log.push(`✗ ${e}`);
        throw new Error(
          "Export would crash Style Editor or fail load: " +
          validation.errors.join(" · ")
        );
      }
      log.push(`Validation OK · CASM(aus) · OTSc · ${styBytes.length.toLocaleString()} B`);
      return {
        styBytes,
        smfSize: smf.length,
        casmSize: casm.length,
        audioSize: forumAudio.body.length,
        mdbSize: 0,
        otscSize,
        log,
        validation,
        casmSource
      };
    }
  }

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

  // SX920: conductor section markers must match CASM Sdec when CASM is lifted.
  const casmSections = casmSource === "aus" ? extractSectionsFromCasm(casm) : [];
  const sections = dedupeSections(
    casmSections.length
      ? casmSections
      : (opts.sections.length ? opts.sections : (["Main A"] as StyleSection[]))
  );
  if (casmSections.length) {
    log.push(`Sections: aligned to CASM Sdec (${sections.length}) — required for SX920`);
  }

  const setupEvents = liftAusSetup ? extractAusSetupEvents(opts.aus.raw) : [];
  if (setupEvents.length) {
    log.push(`Conductor setup: lifted ${setupEvents.length} sysex/CC events from .aus SMF`);
  } else {
    log.push("Conductor setup: using built-in XG/style init");
  }

  const sectionOffsets = computeSectionOffsets(
    sections,
    sectionLen,
    ticksPerBar,
    opts.sectionBarMap
  );
  const conductor = buildConductorTrack({
    bpm: opts.bpm,
    num: opts.timeSigNum,
    den: opts.timeSigDen,
    name: opts.name,
    sections,
    sectionLengthTicks: sectionLen,
    sectionBarMap: opts.sectionBarMap,
    ticksPerBar,
    setupEvents
  });
  const trackPayloads: Bytes[] = [conductor];

  // Timeline MIDI only — never import demo ContempRock channels
  const defaultSection = sections[0] ?? "Main A";
  for (const at of opts.tracks) {
    const section = at.section && sections.includes(at.section) ? at.section : defaultSection;
    const offset = sectionOffsets.get(section) ?? 0;
    const midiCh = styleChannelToMidi(at.targetChannel);
    const isRhythm = midiCh === 8 || midiCh === 9;
    const shifted = shiftTrackEvents(at.track, offset);
    const withCc = injectChannelCc(shifted, midiCh, {
      volume: at.volume,
      pan: at.pan,
      reverb: at.reverb,
      chorus: at.chorus
    });
    const raw = isRhythm
      ? remapTrackChannel(withCc, midiCh)
      : remapTrackChannel(withCc, midiCh, {
          program: at.program ?? 0,
          bankMsb: at.bankMsb ?? 0,
          bankLsb: at.bankLsb ?? 0
        });
    trackPayloads.push(raw);
    const sound = isRhythm
      ? "Rhythm kit (ch)"
      : (at.soundName ?? `GM#${(at.program ?? 0) + 1}`);
    const mixBits = [
      at.volume != null ? `vol ${at.volume}` : null,
      at.pan != null ? `pan ${at.pan}` : null,
      at.reverb != null ? `rvb ${at.reverb}` : null,
      at.chorus != null ? `cho ${at.chorus}` : null
    ].filter(Boolean).join(" · ");
    log.push(
      `Timeline MIDI "${at.sourceName}" → ${at.role} @ ${section} (tick ${offset}) · ch ${midiCh + 1} · ${sound}` +
      (mixBits ? ` · ${mixBits}` : "")
    );
  }
  if (noMidiParts) {
    log.push("No timeline MIDI — Live Audio only (AUS only)");
  }

  // Yamaha PSR-SX / Genos styles are SMF Format 0 (single multi-channel MTrk).
  const smf = buildSmf0(trackPayloads, tpq);
  log.push(
    `SMF: Format 0 · ${trackPayloads.length} parts (conductor${opts.tracks.length ? `+${opts.tracks.length} timeline` : " only"}) · ${smf.length} B · ` +
    `section ${sectionLen} ticks (${contentBars} bars · AUS ${ausBars} / MIDI ${midiBars})`
  );

  let styBytes: Bytes;
  let audioSize = 0;
  let mdbSize = 0;
  let otscSize = 0;

  // STY re-edit only: preserve original post-SMF tail from the opened .sty
  if (opts.preservePostSmfFrom) {
    const src = opts.preservePostSmfFrom;
    const srcSmfEnd = findEffectiveSmfEnd(src);
    if (srcSmfEnd < 0 || srcSmfEnd >= src.length) {
      throw new Error("Cannot preserve post-SMF: original style has no valid SMF end.");
    }
    const tail = src.subarray(srcSmfEnd);
    if (tail.length < 16) {
      throw new Error("Original style post-SMF region is empty — cannot preserve CASM/audio.");
    }
    styBytes = concat([smf, tail]);
    // If preserved tail lacks OTSc but has Live Audio, inject default OTSc
    let v = validateStyleBytes(styBytes);
    if (!v.ok && v.errors.some(e => /OTSc/i.test(e)) && otscBlock) {
      styBytes = injectOtscAfterCasm(styBytes, otscBlock);
      otscSize = otscBlock.length;
      log.push(`STY re-export: injected OTSc (${otscSize} B) into preserved tail`);
      v = validateStyleBytes(styBytes);
    }
    const audio = extractAudioBody(src) ?? extractForumAudioBody(src);
    audioSize = audio?.body.length ?? 0;
    mdbSize = 0;
    if (!otscSize) {
      const existing = extractOtsc(styBytes);
      otscSize = existing?.length ?? 0;
    }
    log.push(
      `STY re-export: preserved post-SMF (${tail.length.toLocaleString()} B) — CASM/audio from opened .sty`
    );
    log.push(`Final .sty: ${styBytes.length.toLocaleString()} B (SMF rebuilt + original tail)`);
    log.push("Structure: SMF(new) → [original post-SMF chunks]");
  } else if (forumSafe) {
    // Forum-safe AUS path: SMF → CASM → OTSc → AASM/AFil (matches working Live Audio STY)
    if (!forumAudio) {
      throw new Error(
        "No AASM/AFil/AWav/AUDI audio body found in .aus — keyboard will reject the style."
      );
    }
    if (forumAudio.body.length < 64) {
      throw new Error(`Audio body too small (${forumAudio.body.length} B) — keyboard will reject the style.`);
    }
    audioSize = forumAudio.body.length;
    log.push(`Audio (AUS only): ${forumAudio.source} · ${audioSize.toLocaleString()} B`);
    const parts: Bytes[] = [smf, casm];
    if (otscBlock) {
      parts.push(otscBlock);
      otscSize = otscBlock.length;
      log.push(`OTSc: ${otscSize.toLocaleString()} B (Style Editor safety)`);
    } else {
      log.push("⚠ OTSc missing — Style Editor may crash (SRJRRR L11)");
    }
    parts.push(forumAudio.body);
    styBytes = concat(parts);
    log.push(
      opts.tracks.length
        ? `SMF(Format0 + ${opts.tracks.length} timeline part(s)) → CASM → OTSc → AASM/AFil`
        : "SMF(Format0 conductor) → CASM → OTSc → AASM/AFil — zero demo MIDI"
    );
    log.push("Method: AUS-only · no ContempRock/demo graft");
    log.push(`Final .sty: ${styBytes.length.toLocaleString()} B`);
  } else {
    // Legacy non-forum path — still use CASM → OTSc → audio order
    const audio = extractAudioBody(opts.aus.raw);
    if (!audio) {
      throw new Error("No AASM/AWav/AUDI audio body found in .aus — keyboard will reject the style.");
    }
    if (audio.body.length < 64) {
      throw new Error(`Audio body too small (${audio.body.length} B) — keyboard will reject the style.`);
    }
    log.push(`Audio: ${audio.source} · ${audio.body.length.toLocaleString()} B`);
    audioSize = audio.body.length;

    const parts: Bytes[] = [smf, casm];
    if (otscBlock) {
      parts.push(otscBlock);
      otscSize = otscBlock.length;
      log.push(`OTSc: ${otscSize} B`);
    }
    parts.push(audio.body);
    if (includeMdb && !audio.source.includes("EOF")) {
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
    } else if (includeMdb) {
      log.push("MDB: skipped (audio body is AASM→EOF; trailers already in audio block)");
    }

    styBytes = concat(parts);
    log.push(`Final .sty: ${styBytes.length.toLocaleString()} B`);
    log.push("Structure: SMF(Format0·SFF2·SInt) → CASM → OTSc → AASM…");
  }

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
    audioSize,
    mdbSize,
    otscSize,
    log,
    validation,
    casmSource
  };
}

/** PSR display channel (1-based) → MIDI 0-based — Yamaha style map. */
export const PSR_STYLE_CHANNEL_MAP: ReadonlyArray<{
  role: string;
  psrCh: number;
  midiCh: number;
}> = [
  { role: "Rhythm 2 (Sub)", psrCh: 9, midiCh: 8 },
  { role: "Rhythm 1 (Main)", psrCh: 10, midiCh: 9 },
  { role: "Bass", psrCh: 11, midiCh: 10 },
  { role: "Chord 1", psrCh: 12, midiCh: 11 },
  { role: "Chord 2", psrCh: 13, midiCh: 12 },
  { role: "Pad", psrCh: 14, midiCh: 13 },
  { role: "Phrase 1", psrCh: 15, midiCh: 14 },
  { role: "Phrase 2", psrCh: 16, midiCh: 15 }
];

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
  mix: { volume?: number; pan?: number; reverb?: number; chorus?: number }
): MidiTrack {
  const extras: MidiEvent[] = [];
  const pushCc = (controller: number, value: number | undefined) => {
    if (value == null) return;
    extras.push({
      kind: "cc",
      tick: 0,
      channel,
      controller,
      value: Math.max(0, Math.min(127, value | 0))
    });
  };
  pushCc(7, mix.volume);
  pushCc(10, mix.pan);
  pushCc(91, mix.reverb);
  pushCc(93, mix.chorus);
  if (!extras.length) return track;
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
  sectionBarMap?: Partial<Record<StyleSection, number>>;
  ticksPerBar?: number;
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
    // Minimal XG System On + rhythm banks (ch 9/10 = MIDI 8/9)
    at(0, [0xf0, 0x08, 0x43, 0x10, 0x4c, 0x00, 0x00, 0x7e, 0x00, 0xf7]);
    at(0, [0xb8, 0x00, 0x7f]);
    at(0, [0xb9, 0x00, 0x7f]);
    at(0, [0xb8, 0x20, 0x00]);
    at(0, [0xb9, 0x20, 0x00]);
    at(0, [0xc8, 0x00]);
    at(0, [0xc9, 0x00]);
  }

  at(0, [0xff, 0x06, 0x04, 0x53, 0x49, 0x6e, 0x74]);

  // Multi-section map: all CASM sections get markers (cap 16 for conductor size)
  const unique = opts.sections.slice(0, 16);
  const offsets = computeSectionOffsets(
    unique,
    opts.sectionLengthTicks,
    opts.ticksPerBar ?? opts.sectionLengthTicks,
    opts.sectionBarMap
  );
  let endTick = 0;
  for (const sec of unique) {
    const label = new TextEncoder().encode(yamahaSectionCode(sec));
    if (label.length > 127) continue;
    const tick = offsets.get(sec) ?? 0;
    at(tick, concat([new Uint8Array([0xff, 0x06, label.length]), label]));
    const len = sectionLengthFor(
      sec,
      opts.sectionLengthTicks,
      opts.ticksPerBar ?? opts.sectionLengthTicks,
      opts.sectionBarMap
    );
    endTick = Math.max(endTick, tick + len);
  }

  const eotTick = Math.max(lastTick, endTick, opts.sectionLengthTicks);
  at(eotTick, [0xff, 0x2f, 0x00]);
  return concat(parts);
}

function sectionLengthFor(
  sec: StyleSection,
  defaultTicks: number,
  ticksPerBar: number,
  map?: Partial<Record<StyleSection, number>>
): number {
  const bars = map?.[sec];
  if (bars != null && bars > 0 && ticksPerBar > 0) {
    return Math.max(1, Math.round(bars * ticksPerBar));
  }
  // Fills / break default to 1 bar when using equal-length mode with multi-section
  if (map && (sec.startsWith("Fill In") || sec === "Break")) {
    return Math.max(1, ticksPerBar);
  }
  return Math.max(1, defaultTicks);
}

function computeSectionOffsets(
  sections: StyleSection[],
  defaultLen: number,
  ticksPerBar: number,
  map?: Partial<Record<StyleSection, number>>
): Map<StyleSection, number> {
  const out = new Map<StyleSection, number>();
  let tick = 0;
  for (const s of sections) {
    out.set(s, tick);
    tick += sectionLengthFor(s, defaultLen, ticksPerBar, map);
  }
  return out;
}

function resolveOtsc(ausRaw: Bytes, include: boolean, log: string[]): Bytes | null {
  if (!include) {
    log.push("OTSc: disabled by option");
    return null;
  }
  const fromSrc = extractOtsc(ausRaw);
  if (fromSrc && isSubstantialOtsc(fromSrc)) {
    log.push(`OTSc: lifted from source (${fromSrc.length} B)`);
    return fromSrc;
  }
  try {
    const def = getDefaultOtsc();
    if (def && isSubstantialOtsc(def)) {
      log.push(`OTSc: default 4-slot template (${def.length} B) — required for Style Editor`);
      return def;
    }
  } catch (e) {
    log.push(`OTSc: default template failed — ${(e as Error).message}`);
  }
  const stub = buildOtsc();
  log.push(`OTSc: empty stub only (${stub.length} B) — Style Editor may still crash`);
  return stub;
}

/** Insert OTSc immediately after the CASM chunk (or after SMF if no CASM). */
export function injectOtscAfterCasm(sty: Bytes, otsc: Bytes): Bytes {
  // Drop any existing OTSc first so we never double-insert
  let base = sty;
  if (extractOtsc(sty)) base = removeChunk(sty, "OTSc");

  const casm = extractCasmFromAus(base);
  if (casm) {
    const off = findBytesOffset(base, casm.subarray(0, Math.min(12, casm.length)));
    if (off >= 0) {
      const casmEnd = off + casm.length;
      return concat([base.subarray(0, casmEnd), otsc, base.subarray(casmEnd)]);
    }
  }
  const smfEnd = findEffectiveSmfEnd(base);
  if (smfEnd > 0) {
    return concat([base.subarray(0, smfEnd), otsc, base.subarray(smfEnd)]);
  }
  return concat([base, otsc]);
}

function findBytesOffset(hay: Bytes, needle: Bytes): number {
  if (!needle.length || needle.length > hay.length) return -1;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function removeChunk(buf: Bytes, fourCC: string): Bytes {
  const a = fourCC.charCodeAt(0), b = fourCC.charCodeAt(1);
  const c = fourCC.charCodeAt(2), d = fourCC.charCodeAt(3);
  for (let i = 0; i <= buf.length - 8; i++) {
    if (buf[i] !== a || buf[i + 1] !== b || buf[i + 2] !== c || buf[i + 3] !== d) continue;
    const size =
      ((buf[i + 4] << 24) | (buf[i + 5] << 16) | (buf[i + 6] << 8) | buf[i + 7]) >>> 0;
    if (i + 8 + size <= buf.length) {
      return concat([buf.subarray(0, i), buf.subarray(i + 8 + size)]);
    }
  }
  return buf;
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
