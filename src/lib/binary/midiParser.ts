/**
 * Standard MIDI File (SMF) parser + builder.
 *
 * Handles SMF-0 and SMF-1 files, exposes note-on / note-off / control events
 * per track for the in-browser preview synth, and provides a `buildSmf1`
 * function that emits a fresh multi-track SMF suitable for wrapping in an
 * SFF2 style header.
 *
 * References:
 *   - Standard MIDI File 1.0 (MMA / AMEI)
 *   - Yamaha SFF2 spec: an SFF2 style begins with a normal MThd + N × MTrk
 *     block, followed by the CASM, OTSc, MDB, etc.
 */

import {
  Bytes, concat, readU16BE, readU32BE, readVLQ, tag, writeU16BE, writeU32BE, writeVLQ, readFourCC
} from "./bytes";

export type MidiEvent =
  | { kind: "note-on";     tick: number; channel: number; note: number; velocity: number }
  | { kind: "note-off";    tick: number; channel: number; note: number; velocity: number }
  | { kind: "cc";          tick: number; channel: number; controller: number; value: number }
  | { kind: "program";     tick: number; channel: number; program: number }
  | { kind: "pitch-bend";  tick: number; channel: number; value: number }
  | { kind: "tempo";       tick: number; usPerQuarter: number }
  | { kind: "time-sig";    tick: number; numerator: number; denominator: number }
  | { kind: "meta";        tick: number; type: number; data: Bytes }
  | { kind: "sysex";       tick: number; data: Bytes };

export interface MidiTrack {
  index: number;
  name: string;
  events: MidiEvent[];
  /** Channels actually used by this track (0-15). */
  channelsUsed: number[];
  /** Raw MTrk bytes (payload, without header) — used when rewriting the file. */
  raw: Bytes;
}

export interface ParsedMidi {
  format: 0 | 1 | 2;
  ticksPerQuarter: number;
  tracks: MidiTrack[];
  tempoBpm: number;
  timeSigNumerator: number;
  timeSigDenominator: number;
  /** Total ticks of the longest track (approximate loop length). */
  lengthTicks: number;
}

/** Parse a Standard MIDI File. */
export function parseMidi(raw: Bytes): ParsedMidi {
  if (readFourCC(raw, 0) !== "MThd") throw new Error("Not a MIDI file (missing MThd header)");
  const headerLen = readU32BE(raw, 4);
  const format = readU16BE(raw, 8) as 0 | 1 | 2;
  const numTracks = readU16BE(raw, 10);
  const division = readU16BE(raw, 12);
  const ticksPerQuarter = division & 0x8000 ? 96 : division; // fallback for SMPTE
  let cursor = 8 + headerLen;

  const tracks: MidiTrack[] = [];
  let tempoBpm = 120;
  let tsNum = 4, tsDen = 4;
  let maxLen = 0;

  for (let t = 0; t < numTracks && cursor < raw.length; t++) {
    if (readFourCC(raw, cursor) !== "MTrk") {
      // resync — scan forward for next MTrk
      const next = findFourCC(raw, "MTrk", cursor);
      if (next < 0) break;
      cursor = next;
    }
    const trackLen = readU32BE(raw, cursor + 4);
    const trackStart = cursor + 8;
    const trackEnd = trackStart + trackLen;
    const rawTrack = raw.subarray(trackStart, trackEnd);
    const { events, channels, endTick, name } = decodeTrackEvents(rawTrack);
    tracks.push({
      index: t,
      name: name || `Track ${t + 1}`,
      events,
      channelsUsed: channels,
      raw: rawTrack
    });
    for (const e of events) {
      if (e.kind === "tempo") tempoBpm = 60_000_000 / e.usPerQuarter;
      if (e.kind === "time-sig") { tsNum = e.numerator; tsDen = e.denominator; }
    }
    maxLen = Math.max(maxLen, endTick);
    cursor = trackEnd;
  }

  return {
    format,
    ticksPerQuarter,
    tracks,
    tempoBpm: Math.round(tempoBpm),
    timeSigNumerator: tsNum,
    timeSigDenominator: tsDen,
    lengthTicks: maxLen
  };
}

function findFourCC(hay: Bytes, fcc: string, from: number): number {
  const n = tag(fcc);
  for (let i = from; i <= hay.length - 4; i++) {
    if (hay[i] === n[0] && hay[i+1] === n[1] && hay[i+2] === n[2] && hay[i+3] === n[3]) return i;
  }
  return -1;
}

function decodeTrackEvents(raw: Bytes): { events: MidiEvent[]; channels: number[]; endTick: number; name: string } {
  const events: MidiEvent[] = [];
  const chSet = new Set<number>();
  let tick = 0;
  let runningStatus = 0;
  let name = "";
  let i = 0;

  while (i < raw.length) {
    const { value: delta, size } = readVLQ(raw, i);
    i += size;
    tick += delta;

    let status = raw[i];
    if (status < 0x80) {
      // running status
      status = runningStatus;
    } else {
      runningStatus = status;
      i++;
    }
    const type = status & 0xf0;
    const channel = status & 0x0f;

    if (status === 0xff) {
      // meta
      const metaType = raw[i++];
      const { value: len, size: lsz } = readVLQ(raw, i);
      i += lsz;
      const data = raw.subarray(i, i + len);
      i += len;
      if (metaType === 0x03) name = new TextDecoder("latin1").decode(data);
      else if (metaType === 0x51 && data.length === 3) {
        const us = (data[0] << 16) | (data[1] << 8) | data[2];
        events.push({ kind: "tempo", tick, usPerQuarter: us });
      } else if (metaType === 0x58 && data.length >= 4) {
        events.push({ kind: "time-sig", tick, numerator: data[0], denominator: 1 << data[1] });
      } else {
        events.push({ kind: "meta", tick, type: metaType, data });
      }
      if (metaType === 0x2f) break; // end of track
      continue;
    }
    if (status === 0xf0 || status === 0xf7) {
      const { value: len, size: lsz } = readVLQ(raw, i);
      i += lsz;
      events.push({ kind: "sysex", tick, data: raw.subarray(i, i + len) });
      i += len;
      continue;
    }

    switch (type) {
      case 0x80: { // note off
        const note = raw[i++], vel = raw[i++];
        events.push({ kind: "note-off", tick, channel, note, velocity: vel });
        chSet.add(channel); break;
      }
      case 0x90: { // note on (vel 0 => note off)
        const note = raw[i++], vel = raw[i++];
        if (vel === 0) events.push({ kind: "note-off", tick, channel, note, velocity: 0 });
        else events.push({ kind: "note-on", tick, channel, note, velocity: vel });
        chSet.add(channel); break;
      }
      case 0xa0: i += 2; break; // aftertouch
      case 0xb0: {
        const ctrl = raw[i++], val = raw[i++];
        events.push({ kind: "cc", tick, channel, controller: ctrl, value: val });
        chSet.add(channel); break;
      }
      case 0xc0: {
        const prog = raw[i++];
        events.push({ kind: "program", tick, channel, program: prog });
        chSet.add(channel); break;
      }
      case 0xd0: i += 1; break; // channel pressure
      case 0xe0: {
        const lsb = raw[i++], msb = raw[i++];
        events.push({ kind: "pitch-bend", tick, channel, value: ((msb << 7) | lsb) - 8192 });
        chSet.add(channel); break;
      }
      default:
        // Unknown status — abort track to avoid endless loops
        i = raw.length;
    }
  }

  return { events, channels: Array.from(chSet).sort((a,b) => a - b), endTick: tick, name };
}

export interface RemapOptions {
  /** Force a GM program (and optional XG bank) at tick 0; drop source program changes. */
  program?: number;
  /** XG bank select MSB (CC0). Default 0. */
  bankMsb?: number;
  /** XG bank select LSB (CC32). Default 0. */
  bankLsb?: number;
}

/**
 * Expand SMF-0 / multi-timbral style tracks into one virtual track per MIDI channel
 * that has note-ons. Yamaha .sty files are often format 0: one MTrk with ch 8–15.
 */
export function splitMidiByChannel(midi: ParsedMidi): ParsedMidi {
  const byCh = new Map<number, MidiEvent[]>();
  let maxTick = 0;

  for (const tr of midi.tracks) {
    for (const e of tr.events) {
      if (e.tick > maxTick) maxTick = e.tick;
      if (
        e.kind === "note-on" ||
        e.kind === "note-off" ||
        e.kind === "cc" ||
        e.kind === "program" ||
        e.kind === "pitch-bend"
      ) {
        const ch = e.channel;
        if (!byCh.has(ch)) byCh.set(ch, []);
        byCh.get(ch)!.push(e);
      }
    }
  }

  // Prefer style channels 8–15 (Rhythm Sub … Phrase 2); fall back to all with notes
  const preferred = [8, 9, 10, 11, 12, 13, 14, 15];
  const withNotes = [...byCh.entries()]
    .filter(([, evs]) => evs.some(e => e.kind === "note-on" && e.velocity > 0))
    .map(([ch]) => ch)
    .sort((a, b) => a - b);

  const channels = preferred.filter(c => withNotes.includes(c));
  const finalChs = channels.length ? channels : withNotes;

  if (finalChs.length <= 1 && midi.tracks.length > 1) {
    // Already multi-track SMF-1 with separate parts — keep as-is
    const multiNoteful = midi.tracks.filter(t =>
      t.events.some(e => e.kind === "note-on" && e.velocity > 0)
    );
    if (multiNoteful.length > 1) return midi;
  }

  if (!finalChs.length) return midi;

  const ROLE_NAMES: Record<number, string> = {
    8: "Rhythm 2",
    9: "Rhythm 1",
    10: "Bass",
    11: "Chord 1",
    12: "Chord 2",
    13: "Pad",
    14: "Phrase 1",
    15: "Phrase 2"
  };

  const tracks: MidiTrack[] = finalChs.map((ch, index) => {
    const events = (byCh.get(ch) ?? []).slice().sort((a, b) => a.tick - b.tick);
    return {
      index,
      name: ROLE_NAMES[ch] ?? `MIDI ch ${ch + 1}`,
      events,
      channelsUsed: [ch],
      raw: new Uint8Array(0)
    };
  });

  return {
    format: 1,
    ticksPerQuarter: midi.ticksPerQuarter,
    tracks,
    tempoBpm: midi.tempoBpm,
    timeSigNumerator: midi.timeSigNumerator,
    timeSigDenominator: midi.timeSigDenominator,
    lengthTicks: Math.max(midi.lengthTicks, maxTick)
  };
}

/**
 * Rewrite a source track so that every channel-scoped event is remapped to a
 * new target channel (0-15). Meta and sysex events are copied unchanged.
 * The returned bytes are payload only (no MTrk header).
 */
export function remapTrackChannel(
  track: MidiTrack,
  targetChannel: number,
  opts?: RemapOptions
): Bytes {
  const parts: Bytes[] = [];
  let lastTick = 0;
  const forceProgram = opts?.program != null;
  const bankMsb = opts?.bankMsb ?? 0;
  const bankLsb = opts?.bankLsb ?? 0;
  const program = opts?.program != null ? ((opts.program % 128) + 128) % 128 : 0;

  const push = (tick: number, statusByte: number, data: number[]) => {
    parts.push(writeVLQ(Math.max(0, tick - lastTick)));
    parts.push(new Uint8Array([statusByte, ...data]));
    lastTick = tick;
  };

  if (forceProgram) {
    // Bank select then program — Yamaha XG / GM order for PSR-SX920
    push(0, 0xb0 | targetChannel, [0, bankMsb & 0x7f]);
    push(0, 0xb0 | targetChannel, [32, bankLsb & 0x7f]);
    push(0, 0xc0 | targetChannel, [program]);
  }

  for (const e of track.events) {
    switch (e.kind) {
      case "note-on":    push(e.tick, 0x90 | targetChannel, [e.note, e.velocity]); break;
      case "note-off":   push(e.tick, 0x80 | targetChannel, [e.note, e.velocity]); break;
      case "cc": {
        // Skip bank-select from source when we force our own sound
        if (forceProgram && (e.controller === 0 || e.controller === 32)) break;
        push(e.tick, 0xb0 | targetChannel, [e.controller, e.value]);
        break;
      }
      case "program": {
        if (forceProgram) break;
        push(e.tick, 0xc0 | targetChannel, [e.program]);
        break;
      }
      case "pitch-bend": {
        const v = e.value + 8192;
        push(e.tick, 0xe0 | targetChannel, [v & 0x7f, (v >> 7) & 0x7f]);
        break;
      }
      case "tempo": {
        parts.push(writeVLQ(Math.max(0, e.tick - lastTick)));
        parts.push(new Uint8Array([0xff, 0x51, 0x03,
          (e.usPerQuarter >> 16) & 0xff,
          (e.usPerQuarter >> 8) & 0xff,
          e.usPerQuarter & 0xff]));
        lastTick = e.tick;
        break;
      }
      case "time-sig": {
        parts.push(writeVLQ(Math.max(0, e.tick - lastTick)));
        const denomPow = Math.round(Math.log2(e.denominator));
        parts.push(new Uint8Array([0xff, 0x58, 0x04, e.numerator, denomPow, 24, 8]));
        lastTick = e.tick;
        break;
      }
      case "meta": {
        parts.push(writeVLQ(Math.max(0, e.tick - lastTick)));
        parts.push(new Uint8Array([0xff, e.type]));
        parts.push(writeVLQ(e.data.length));
        parts.push(e.data);
        lastTick = e.tick;
        break;
      }
      case "sysex": {
        parts.push(writeVLQ(Math.max(0, e.tick - lastTick)));
        parts.push(new Uint8Array([0xf0]));
        parts.push(writeVLQ(e.data.length));
        parts.push(e.data);
        lastTick = e.tick;
        break;
      }
    }
  }
  // End of Track
  parts.push(writeVLQ(0));
  parts.push(new Uint8Array([0xff, 0x2f, 0x00]));
  return concat(parts);
}

/**
 * Build an SMF-1 file from an array of MTrk payloads.
 * Prefer {@link buildSmf0} for Yamaha arranger styles (PSR-SX / Genos).
 */
export function buildSmf1(trackPayloads: Bytes[], ticksPerQuarter: number): Bytes {
  const parts: Bytes[] = [];
  parts.push(tag("MThd"));
  parts.push(writeU32BE(6));
  parts.push(writeU16BE(1));
  parts.push(writeU16BE(trackPayloads.length));
  parts.push(writeU16BE(Math.max(1, ticksPerQuarter & 0x7fff)));

  for (const t of trackPayloads) {
    parts.push(tag("MTrk"));
    parts.push(writeU32BE(t.length));
    parts.push(t);
  }
  return concat(parts);
}

/**
 * Build SMF Format 0 — single multi-channel MTrk.
 *
 * Real Yamaha PSR-SX / Genos / Audio Phraser styles are almost always Format 0
 * (one MTrk with channels 8–15). Format 1 multi-track SMF is a common cause of
 * keyboard “Data not loaded properly” when paired with SFF2 CASM.
 *
 * `trackPayloads[0]` should be the conductor (markers/tempo); remaining payloads
 * are style parts already remapped to their target MIDI channels.
 */
export function buildSmf0(trackPayloads: Bytes[], ticksPerQuarter: number): Bytes {
  if (!trackPayloads.length) {
    return buildSmf1([], ticksPerQuarter);
  }
  if (trackPayloads.length === 1) {
    const parts: Bytes[] = [];
    parts.push(tag("MThd"));
    parts.push(writeU32BE(6));
    parts.push(writeU16BE(0)); // format 0
    parts.push(writeU16BE(1));
    parts.push(writeU16BE(Math.max(1, ticksPerQuarter & 0x7fff)));
    parts.push(tag("MTrk"));
    parts.push(writeU32BE(trackPayloads[0].length));
    parts.push(trackPayloads[0]);
    return concat(parts);
  }

  // Merge all MTrk payloads into one absolute-timed event stream, then re-encode
  type AbsEv = { tick: number; bytes: number[] };
  const abs: AbsEv[] = [];

  for (const payload of trackPayloads) {
    let i = 0;
    let tick = 0;
    let running = 0;
    while (i < payload.length) {
      // delta VLQ
      let delta = 0;
      let b: number;
      do {
        b = payload[i++];
        delta = (delta << 7) | (b & 0x7f);
      } while (b & 0x80 && i < payload.length);
      tick += delta;
      if (i >= payload.length) break;

      let status = payload[i];
      const start = i;
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
        // Skip End-of-Track from non-primary tracks; keep one EOT at the end
        if (mt === 0x2f) {
          i += len;
          continue;
        }
        const data = payload.subarray(i, i + len);
        i += len;
        const bytes = [0xff, mt, ...Array.from(writeVLQ(len)), ...data];
        abs.push({ tick, bytes });
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
        abs.push({ tick, bytes: [status, ...Array.from(writeVLQ(len)), ...data] });
        continue;
      }

      const type = status & 0xf0;
      let dataLen = 2;
      if (type === 0xc0 || type === 0xd0) dataLen = 1;
      const data = payload.subarray(i, i + dataLen);
      i += dataLen;
      abs.push({ tick, bytes: [status, ...data] });
      void start;
    }
  }

  abs.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);

  const out: Bytes[] = [];
  let lastTick = 0;
  for (const ev of abs) {
    out.push(writeVLQ(Math.max(0, ev.tick - lastTick)));
    out.push(new Uint8Array(ev.bytes));
    lastTick = ev.tick;
  }
  out.push(writeVLQ(0));
  out.push(new Uint8Array([0xff, 0x2f, 0x00]));
  const body = concat(out);

  return concat([
    tag("MThd"),
    writeU32BE(6),
    writeU16BE(0), // format 0 — Yamaha arranger standard
    writeU16BE(1),
    writeU16BE(Math.max(1, ticksPerQuarter & 0x7fff)),
    tag("MTrk"),
    writeU32BE(body.length),
    body
  ]);
}
