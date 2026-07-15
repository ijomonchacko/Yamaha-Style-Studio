/**
 * Yamaha .aus (Audio Style Section) parser.
 *
 * An `.aus` file is a proprietary Yamaha container used by the Audio Phraser
 * tool. It bundles one or more raw PCM (16-bit little-endian) audio loops
 * together with metadata chunks and — critically — the `AUDI`/`MInt`/`SPCC`
 * markers that a Public/PSR SFF2 style expects when it references audio content.
 *
 * The container is chunked in the same "FourCC + BE-uint32 length + payload"
 * style used by RIFF/SFF. We scan for the known audio-relevant tags and
 * expose them as `AusChunk` records so the stitcher can copy the exact bytes
 * (including their length prefix) into the target `.sty` payload.
 *
 * Because the container occasionally omits an outer wrapper (some Audio
 * Phraser exports drop straight into `AUDI`), we fall back to a full-file
 * marker scan if the header dispatch doesn't yield anything usable.
 */

import {
  Bytes, concat, findAllBytes, findBytes, readU32BE, tag, writeU32BE
} from "./bytes";

export interface AusChunk {
  /** FourCC tag, e.g. "AUDI", "MInt", "SPCC" */
  id: string;
  /** Absolute offset in the source .aus file where the tag begins. */
  offset: number;
  /** Payload length as declared by the BE-uint32 that follows the tag. */
  size: number;
  /** Full chunk bytes: FourCC(4) + size(4) + payload(size). */
  full: Bytes;
  /** Payload only, without the 8-byte header. */
  payload: Bytes;
}

export interface AudioSlice {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Decoded 16-bit LE PCM samples normalised to Float32 in [-1, 1].
   *  For encoded containers (OGG/MP3) this is populated after the browser
   *  decodes the container asynchronously. */
  pcm: Float32Array;
  /** Duration in seconds. */
  durationSec: number;
  /** MIME type of the encoded container, if the AUDI held one. */
  encodedMime?: string;
  /** Raw encoded bytes lifted out of AUDI, ready for decodeAudioData(). */
  encodedBytes?: Uint8Array;
}

export interface AusMetadata {
  /** BPM the AUS loop was recorded at (best guess). */
  bpm: number;
  /** Number of musical bars the AUS loop covers. */
  bars: number;
  /** Time-signature numerator (usually 4). */
  timeSigNum: number;
  /** Time-signature denominator (usually 4). */
  timeSigDen: number;
  /** How we determined the BPM (spcc-tag / mint-tag / duration-fit / default). */
  source: "spcc" | "mint" | "duration-fit" | "default";
}

export interface AusParseResult {
  raw: Bytes;
  chunks: AusChunk[];
  /** Chunks that will be injected verbatim into the .sty (AUDI/MInt/SPCC/etc.). */
  audioChunks: AusChunk[];
  /** Best-effort decoded PCM for the in-browser playback preview. */
  audio?: AudioSlice;
  /** Loop metadata (BPM/bars/time-sig) recovered from the AUS. */
  meta: AusMetadata;
  /** Non-fatal notes for the UI. */
  warnings: string[];
}

/** Tags that must be preserved when we bake the .sty file. */
const AUDIO_TAGS = [
  "AUDI", "MInt", "SPCC", "SdBS", "SdIx", "SdWv", "AInf",
  // Real Audio Phraser exports (PSR-SX / Genos) use AWav/Afmt/Adat instead of AUDI
  "AWav", "Afmt", "Adat", "Sfmt", "SPnt", "BPnt", "APnt"
];

/**
 * Parse an `.aus` file into its constituent chunks + a decoded PCM slice.
 *
 * Real Yamaha Audio Phraser `.aus` files are full SFF2-style MIDI files that
 * embed audio as:
 *   AWav → WAVE → Afmt (BE WAVE-fmt) + Sfmt + SPnt
 *   Adat → raw 16-bit LE PCM body
 *   AInf → beat/slice map
 *
 * Older/alternate layouts put Ogg/WAV inside an AUDI chunk. We handle both.
 */
export function parseAus(raw: Bytes): AusParseResult {
  const warnings: string[] = [];
  const chunks: AusChunk[] = [];

  // Marker scan for all known audio-related tags. Structured walks fail on
  // real AUS files because they begin with MThd/MTrk/CASM and nest oddly.
  for (const t of AUDIO_TAGS) {
    const needle = tag(t);
    for (const off of findAllBytes(raw, needle)) {
      if (off + 8 > raw.length) continue;
      const size = readU32BE(raw, off + 4);
      if (size < 0 || size > raw.length - (off + 8)) continue;
      if (chunks.some(c => c.offset === off)) continue;
      chunks.push({
        id: t,
        offset: off,
        size,
        full: raw.subarray(off, off + 8 + size),
        payload: raw.subarray(off + 8, off + 8 + size)
      });
    }
  }
  chunks.sort((a, b) => a.offset - b.offset);
  if (chunks.length) warnings.push(`Located ${chunks.length} audio-related chunk(s).`);

  const audioChunks = chunks.filter(c => AUDIO_TAGS.includes(c.id));

  // Prefer the real Audio Phraser path (Afmt + Adat), fall back to AUDI.
  let audio: AudioSlice | undefined;
  audio = decodeAwavAdat(raw, audioChunks, warnings);
  if (!audio) {
    const audi = audioChunks.find(c => c.id === "AUDI");
    if (audi) audio = decodeAudiPayload(audi.payload, warnings);
  }

  const meta = recoverAusMetadata(raw, audioChunks, audio, warnings);

  return { raw, chunks, audioChunks, audio, meta, warnings };
}

/**
 * Decode the standard Audio Phraser layout:
 *   Afmt — big-endian WAVE-style format (PCM, channels, rate, bits)
 *   Adat — raw 16-bit little-endian interleaved PCM
 */
function decodeAwavAdat(
  raw: Bytes,
  audioChunks: AusChunk[],
  warnings: string[]
): AudioSlice | undefined {
  const afmt = audioChunks.find(c => c.id === "Afmt");
  const adat = audioChunks.find(c => c.id === "Adat");
  if (!afmt || !adat) return undefined;

  // Afmt payload is a WAVE `fmt ` structure with BE multi-byte fields.
  const p = afmt.payload;
  if (p.length < 16) {
    warnings.push("Afmt too short — cannot read sample format.");
    return undefined;
  }
  const audioFormat = (p[0] << 8) | p[1];
  const channels    = (p[2] << 8) | p[3];
  const sampleRate  = ((p[4] << 24) >>> 0) + (p[5] << 16) + (p[6] << 8) + p[7];
  const bits        = (p[14] << 8) | p[15];

  if (audioFormat !== 1) {
    warnings.push(`Afmt format ${audioFormat} is not linear PCM — preview may fail.`);
  }
  if (channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 96000 || bits !== 16) {
    warnings.push(
      `Afmt looks unusual: ${channels}ch @ ${sampleRate} Hz / ${bits}-bit — still attempting decode.`
    );
  }

  // Adat declares the real PCM length (e.g. 0x0007c080). Some exports write
  // a truncated size field; if the declared payload is tiny, extend to the
  // next known trailer tag (AInf) or end-of-file.
  let pcmBytes = adat.payload;
  if (pcmBytes.length < 4096) {
    const ainf = audioChunks.find(c => c.id === "AInf");
    const pcmStart = adat.offset + 8;
    const pcmEnd = ainf ? ainf.offset : raw.length;
    if (pcmEnd > pcmStart + 4096) {
      pcmBytes = raw.subarray(pcmStart, pcmEnd);
      warnings.push(
        `Adat size field was ${adat.size} B — extended PCM to ${pcmBytes.length.toLocaleString()} B (until AInf/EOF).`
      );
    }
  }
  if (pcmBytes.length < 1024) {
    warnings.push(`Adat payload too small (${pcmBytes.length} B).`);
    return undefined;
  }

  const ch = channels >= 1 && channels <= 2 ? channels : 2;
  const rate = sampleRate >= 8000 && sampleRate <= 96000 ? sampleRate : 44100;
  const slice = decodePcm16(pcmBytes, rate, ch, 16);

  // Soft-normalise quiet Yamaha loops so the browser preview is audible.
  // Real AUS drum loops often peak well below full scale.
  const peak = peakAbs(slice.pcm);
  if (peak > 0 && peak < 0.35) {
    const gain = Math.min(0.9 / peak, 8);
    for (let i = 0; i < slice.pcm.length; i++) slice.pcm[i] *= gain;
    warnings.push(`AUS PCM peak ${peak.toFixed(3)} — applied ×${gain.toFixed(2)} preview gain.`);
  }

  warnings.push(
    `Decoded AWav/Adat PCM: ${ch}ch @ ${rate} Hz · ${bits}-bit · ` +
    `${slice.durationSec.toFixed(2)}s (${pcmBytes.length.toLocaleString()} B).`
  );
  return slice;
}

function peakAbs(pcm: Float32Array): number {
  let peak = 0;
  const step = Math.max(1, Math.floor(pcm.length / 50000));
  for (let i = 0; i < pcm.length; i += step) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
  }
  return peak;
}

/**
 * Attempt to decode the AUDI payload into a playable form.
 *
 * The reality of Yamaha `.aus`: the AUDI chunk is almost always a container
 * of encoded audio — **Ogg Vorbis** on Genos/PSR-SX (from ~2015 onward),
 * occasionally an embedded RIFF/WAVE for older Audio Phraser exports, and
 * on rare boot-loader dumps a raw 16-bit PCM stream.
 *
 * Rather than try to decode Vorbis or MP3 in JavaScript, we detect the
 * container by scanning for its magic bytes, lift the encoded slice out
 * verbatim, and hand it to `AudioContext.decodeAudioData()` — the browser
 * already ships a hardware-accelerated decoder for every format the Yamaha
 * uses. This finally makes preview playback actually work.
 *
 * Detection is done by magic bytes anywhere in the first ~2 KB of AUDI:
 *   - "OggS"                → audio/ogg (Vorbis)
 *   - "RIFF"…"WAVE"         → audio/wav
 *   - "fLaC"                → audio/flac
 *   - "ID3" or 0xFF 0xFB..  → audio/mpeg
 */
function decodeAudiPayload(payload: Bytes, warnings: string[]): AudioSlice | undefined {
  // ---- Ogg Vorbis (most common on SX/Genos) --------------------------
  const oggOff = findBytes(payload, tag("OggS"));
  if (oggOff >= 0) {
    // OGG stream runs until the end of AUDI. There is no length header
    // inside AUDI beyond the outer chunk size, so slice from the first
    // OggS page to the end.
    const encoded = payload.subarray(oggOff);
    warnings.push(`AUDI holds Ogg Vorbis (${encoded.length.toLocaleString()} B) — will decode via browser.`);
    return {
      sampleRate: 44100, channels: 2, bitsPerSample: 16,
      pcm: new Float32Array(0), durationSec: 0,
      encodedMime: "audio/ogg", encodedBytes: new Uint8Array(encoded)
    };
  }

  // ---- RIFF / WAVE --------------------------------------------------
  const riffOff = findBytes(payload, tag("RIFF"));
  if (riffOff >= 0 && findBytes(payload, tag("WAVE"), riffOff) === riffOff + 8) {
    // Read the RIFF size (little-endian) so we grab exactly the wave.
    const view = new DataView(payload.buffer, payload.byteOffset + riffOff);
    const riffSize = view.getUint32(4, true) + 8;
    const encoded = payload.subarray(riffOff, Math.min(payload.length, riffOff + riffSize));
    warnings.push(`AUDI holds RIFF/WAVE (${encoded.length.toLocaleString()} B) — will decode via browser.`);
    return {
      sampleRate: 44100, channels: 2, bitsPerSample: 16,
      pcm: new Float32Array(0), durationSec: 0,
      encodedMime: "audio/wav", encodedBytes: new Uint8Array(encoded)
    };
  }

  // ---- FLAC --------------------------------------------------------
  const flacOff = findBytes(payload, tag("fLaC"));
  if (flacOff >= 0) {
    const encoded = payload.subarray(flacOff);
    warnings.push(`AUDI holds FLAC (${encoded.length.toLocaleString()} B) — will decode via browser.`);
    return {
      sampleRate: 44100, channels: 2, bitsPerSample: 16,
      pcm: new Float32Array(0), durationSec: 0,
      encodedMime: "audio/flac", encodedBytes: new Uint8Array(encoded)
    };
  }

  // ---- MP3 (ID3 tag or MPEG frame sync) -----------------------------
  const id3 = findBytes(payload, new Uint8Array([0x49, 0x44, 0x33])); // "ID3"
  let mp3Off = id3;
  if (mp3Off < 0) {
    // Scan the first 512 bytes for MPEG frame sync 0xFF 0xFB / 0xFA / 0xF3 / 0xF2
    for (let i = 0; i < Math.min(payload.length - 1, 2048); i++) {
      if (payload[i] === 0xff && (payload[i+1] & 0xe0) === 0xe0) { mp3Off = i; break; }
    }
  }
  if (mp3Off >= 0) {
    const encoded = payload.subarray(mp3Off);
    warnings.push(`AUDI holds MP3 (${encoded.length.toLocaleString()} B) — will decode via browser.`);
    return {
      sampleRate: 44100, channels: 2, bitsPerSample: 16,
      pcm: new Float32Array(0), durationSec: 0,
      encodedMime: "audio/mpeg", encodedBytes: new Uint8Array(encoded)
    };
  }

  // ---- Fallback: raw 16-bit LE PCM ---------------------------------
  // Some very old Audio Phraser exports really do dump raw PCM. Try the
  // heuristic decoder for those.
  return decodeRawPcmFallback(payload, warnings);
}

/**
 * Last-resort raw-PCM decoder — only used when no known container magic
 * bytes were found inside AUDI.
 */
function decodeRawPcmFallback(payload: Bytes, warnings: string[]): AudioSlice | undefined {
  const headerOffsets = [0, 0x10, 0x18, 0x20, 0x2c, 0x40, 0x48, 0x50, 0x80];
  const rates          = [44100, 48000, 32000, 22050];
  const channelCounts  = [2, 1];

  let best: { slice: AudioSlice; score: number } | null = null;
  for (const hdr of headerOffsets) {
    if (hdr + 1024 > payload.length) continue;
    const body = payload.subarray(hdr);
    if (body.length < 4096) continue;
    const trim = body.length - (body.length % 4);
    if (trim < 4096) continue;
    const bodyTrim = body.subarray(0, trim);

    for (const ch of channelCounts) {
      for (const rate of rates) {
        const slice = decodePcm16(bodyTrim, rate, ch, 16);
        const score = scorePcm(slice.pcm);
        if (!best || score > best.score) best = { slice, score };
      }
    }
  }

  if (best && best.score > 0.15) {
    warnings.push(
      `Decoded AUDI as raw PCM: ${best.slice.channels}ch @ ${best.slice.sampleRate} Hz ` +
      `(confidence ${best.score.toFixed(2)}).`
    );
    return best.slice;
  }

  warnings.push("Could not identify AUDI container — preview playback disabled.");
  return best?.slice;
}

/**
 * Score a candidate PCM decode. Real audio has:
 *   - A near-zero mean (DC offset shouldn't be huge)
 *   - Non-trivial RMS but not clipped
 *   - A zero-crossing rate roughly consistent with musical content
 * Random 16-bit misinterpretation typically has extreme DC bias or looks
 * either dead-silent or fully saturated.
 */
function scorePcm(pcm: Float32Array): number {
  if (pcm.length < 1024) return 0;
  // Sample sparsely for speed on big loops
  const step = Math.max(1, Math.floor(pcm.length / 8192));
  let sum = 0, sumSq = 0, zc = 0, prev = 0, n = 0;
  for (let i = 0; i < pcm.length; i += step) {
    const s = pcm[i];
    sum += s; sumSq += s * s;
    if ((s >= 0) !== (prev >= 0)) zc++;
    prev = s; n++;
  }
  const mean = sum / n;
  const rms = Math.sqrt(sumSq / n - mean * mean);
  const zcr = zc / n;

  if (!Number.isFinite(rms) || rms < 0.001) return 0;      // dead silence
  if (rms > 0.9) return 0.1;                                // clipped
  if (Math.abs(mean) > 0.2) return 0.1;                     // huge DC bias

  // Sweet spot: RMS between 0.02 and 0.6, ZCR between 0.02 and 0.4
  const rmsScore = 1 - Math.min(1, Math.abs(Math.log10(rms / 0.15)));
  const zcrScore = zcr > 0.02 && zcr < 0.4 ? 1 - Math.abs(zcr - 0.1) * 3 : 0;
  return Math.max(0, rmsScore * 0.6 + Math.max(0, zcrScore) * 0.4);
}

function decodePcm16(bytes: Bytes, sampleRate: number, channels: number, bitsPerSample: number): AudioSlice {
  if (bitsPerSample !== 16) bitsPerSample = 16;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = Math.floor(bytes.length / 2);
  const pcm = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    pcm[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  const durationSec = channels > 0 && sampleRate > 0
    ? (total / channels) / sampleRate
    : 0;
  return { sampleRate, channels, bitsPerSample, pcm, durationSec };
}

/**
 * Recover the musical BPM + bar count of the AUS loop.
 *
 * Yamaha Audio Phraser writes tempo hints into the SPCC block (slice
 * performance) and sometimes into MInt (audio-to-MIDI map). When those are
 * absent or unreadable we fall back to a duration-fit search: given the
 * decoded loop duration in seconds, pick the (bars, BPM) combination whose
 * implied length matches the audio best, preferring musical values.
 */
function recoverAusMetadata(
  raw: Bytes,
  audioChunks: AusChunk[],
  audio: AudioSlice | undefined,
  warnings: string[]
): AusMetadata {
  const sfmt = audioChunks.find(c => c.id === "Sfmt");
  const spnt = audioChunks.find(c => c.id === "SPnt");
  const spcc = audioChunks.find(c => c.id === "SPCC");
  const mint = audioChunks.find(c => c.id === "MInt");

  // Prefer SMF meta at file head: FF 51 03 tt tt tt / FF 58 04 nn dd cc bb
  const fromSmf = scanFileSmfMeta(raw);
  let timeSigNum = fromSmf.timeSigNum ?? 4;
  let timeSigDen = fromSmf.timeSigDen ?? 4;

  // Sfmt mirrors the same time-sig bytes after the tempo field
  if (!fromSmf.timeSigNum && sfmt && sfmt.payload.length >= 16) {
    for (let i = 8; i < Math.min(sfmt.payload.length - 3, 24); i++) {
      const nn = sfmt.payload[i];
      const dd = sfmt.payload[i + 1];
      const cc = sfmt.payload[i + 2];
      const bb = sfmt.payload[i + 3];
      if (nn >= 1 && nn <= 16 && dd >= 0 && dd <= 4 && cc === 0x18 && (bb === 0x08 || bb === 0x04)) {
        timeSigNum = nn;
        timeSigDen = 1 << dd;
        break;
      }
    }
  }

  const smfBpm = fromSmf.bpm
    ?? findSmfTempoBpm(sfmt?.payload)
    ?? findSmfTempoBpm(spnt?.payload)
    ?? findSmfTempoBpm(spcc?.payload)
    ?? findSmfTempoBpm(mint?.payload);

  const pick = (bpm: number, source: AusMetadata["source"], label: string): AusMetadata => {
    const bars = audio && audio.durationSec > 0.05
      ? estimateBars(audio.durationSec, bpm, timeSigNum)
      : 4;
    warnings.push(`AUS metadata: ${label} ${bpm} BPM · ${bars} bar${bars === 1 ? "" : "s"} · ${timeSigNum}/${timeSigDen}.`);
    return { bpm, bars, timeSigNum, timeSigDen, source };
  };

  if (smfBpm) return pick(smfBpm, "spcc", "SMF tempo");
  if (audio && audio.durationSec > 0.1) {
    const fit = fitBpmFromDuration(audio.durationSec, timeSigNum);
    warnings.push(
      `AUS metadata: fitted ${fit.bpm} BPM · ${fit.bars} bar${fit.bars === 1 ? "" : "s"} ` +
      `from ${audio.durationSec.toFixed(2)}s loop.`
    );
    return { bpm: fit.bpm, bars: fit.bars, timeSigNum, timeSigDen, source: "duration-fit" };
  }

  return { bpm: 120, bars: 4, timeSigNum, timeSigDen, source: "default" };
}

/** Scan first ~256 bytes of an AUS (which starts as SMF) for tempo + time-sig.
 *  Only the first hit of each kind is kept — later false matches in CASM/etc. */
function scanFileSmfMeta(raw: Bytes): { bpm?: number; timeSigNum?: number; timeSigDen?: number } {
  const out: { bpm?: number; timeSigNum?: number; timeSigDen?: number } = {};
  const end = Math.min(raw.length - 6, 256);
  for (let i = 0; i < end; i++) {
    if (out.bpm === undefined && raw[i] === 0xff && raw[i + 1] === 0x51 && raw[i + 2] === 0x03) {
      const us = ((raw[i + 3] << 16) + (raw[i + 4] << 8) + raw[i + 5]) >>> 0;
      if (us >= 250_000 && us <= 1_500_000) {
        const bpm = Math.round(60_000_000 / us);
        if (bpm >= 40 && bpm <= 240) out.bpm = bpm;
      }
    }
    if (out.timeSigNum === undefined && raw[i] === 0xff && raw[i + 1] === 0x58 && raw[i + 2] === 0x04) {
      const nn = raw[i + 3];
      const dd = raw[i + 4];
      if (nn >= 1 && nn <= 16 && dd >= 0 && dd <= 4) {
        out.timeSigNum = nn;
        out.timeSigDen = 1 << dd;
      }
    }
    if (out.bpm !== undefined && out.timeSigNum !== undefined) break;
  }
  return out;
}

/** Read SMF-style 3-byte microseconds-per-quarter → BPM. */
function findSmfTempoBpm(payload: Bytes | undefined): number | null {
  if (!payload || payload.length < 3) return null;
  const end = Math.min(payload.length - 3, 64);
  for (let i = 0; i < end; i++) {
    const us = ((payload[i] << 16) + (payload[i + 1] << 8) + payload[i + 2]) >>> 0;
    if (us >= 250_000 && us <= 1_500_000) {
      const bpm = 60_000_000 / us;
      if (bpm >= 40 && bpm <= 240) return Math.round(bpm);
    }
  }
  return null;
}

function estimateBars(durationSec: number, bpm: number, tsNum: number): number {
  const secondsPerBar = (60 / bpm) * tsNum;
  if (secondsPerBar <= 0) return 4;
  const raw = durationSec / secondsPerBar;
  // Snap to nearest whole bar count in a practical range.
  const rounded = Math.max(1, Math.min(32, Math.round(raw)));
  // Prefer exact-ish fits (within 8%)
  if (Math.abs(raw - rounded) / Math.max(raw, 0.01) < 0.08) return rounded;
  const candidates = [1, 2, 3, 4, 6, 8, 12, 16];
  let best = rounded, bestErr = Infinity;
  for (const c of candidates) {
    const err = Math.abs(raw - c);
    if (err < bestErr) { bestErr = err; best = c; }
  }
  return best;
}

/**
 * Given a loop duration in seconds, find the (bpm, bars) pair that best
 * explains it. Preference order: BPM close to 100–130, bar count in {2, 4, 8}.
 */
function fitBpmFromDuration(durationSec: number, tsNum: number): { bpm: number; bars: number } {
  let best = { bpm: 120, bars: 4, score: -Infinity };
  for (const bars of [1, 2, 4, 8, 16]) {
    const beats = bars * tsNum;
    const bpm = (beats / durationSec) * 60;
    if (bpm < 50 || bpm > 220) continue;
    // Score: prefer musically common BPMs and small bar counts
    const bpmScore   = -Math.abs(bpm - 115) / 115;
    const barsScore  = bars === 4 ? 0.3 : bars === 2 ? 0.2 : bars === 8 ? 0.1 : 0;
    const roundScore = Math.abs(bpm - Math.round(bpm)) < 0.2 ? 0.1 : 0;
    const score = bpmScore + barsScore + roundScore;
    if (score > best.score) best = { bpm: Math.round(bpm), bars, score };
  }
  return { bpm: best.bpm, bars: best.bars };
}

/**
 * Serialise chunks back to a single byte array with fresh headers.
 * Used by the stitcher when it wants to rebuild the AUDI section cleanly
 * (for example to strip out preview-only sub-chunks).
 */
export function serialiseChunks(list: AusChunk[]): Bytes {
  const parts: Bytes[] = [];
  for (const c of list) {
    parts.push(tag(c.id));
    parts.push(writeU32BE(c.payload.length));
    parts.push(c.payload);
    if (c.payload.length & 1) parts.push(new Uint8Array([0])); // 2-byte align
  }
  return concat(parts);
}
