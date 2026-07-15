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
  /** XG / GM bank select MSB (CC0). Default 0. */
  bankMsb?: number;
  /** XG bank select LSB (CC32). Default 0. */
  bankLsb?: number;
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
 * Section / SFF2 markers belong inside the conductor track (see styleStitcher),
 * not as a separate optional marker track.
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
