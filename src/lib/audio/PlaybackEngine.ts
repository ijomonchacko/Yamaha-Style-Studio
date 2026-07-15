/**
 * Web Audio playback engine.
 *
 *   1. PcmLooper  — AUS drum/audio loop (AudioBufferSourceNode)
 *   2. GmPlayer   — real GM SoundFont samples via `smplr` (no oscillators)
 *
 * MIDI program-change events from the source file select the instrument.
 * Notes are scheduled sample-accurately against AudioContext.currentTime.
 */

import { Soundfont, type Soundfont as SoundfontInst } from "smplr";
import { MidiEvent } from "../binary/midiParser";
import { gmProgramName, ROLE_DEFAULT_PROGRAM } from "./gmPrograms";

export interface TransportState {
  playing: boolean;
  loop: boolean;
  bpm: number;
  positionTicks: number;
  loopLengthTicks: number;
  positionSec: number;
  loopLengthSec: number;
  /** SoundFont load status for the UI. */
  sfStatus: "idle" | "loading" | "ready" | "error";
  sfMessage?: string;
}

const CHANNEL_GAIN: Record<number, number> = {
  10: 0.85, 11: 0.70, 12: 0.70, 13: 0.55, 14: 0.65, 15: 0.65
};

interface LoadedPcm {
  buffer: AudioBuffer;
  sourceBpm: number;
  durationSec: number;
}

type ActiveStop = {
  stop: (when?: number) => void;
  /** Latest time this voice is allowed to sound (loop wrap). */
  releaseBy: number;
};

export class PlaybackEngine {
  private ctx: AudioContext;
  private masterGain: GainNode;
  /** All GM/MIDI instruments route here so loop wrap can duck SF tails. */
  private midiBus: GainNode;
  private channelGains = new Map<number, GainNode>();
  private muted = new Set<number>();
  private soloed = new Set<number>();
  /**
   * Editor isolation: when set, only this MIDI channel is audible
   * (AUS/PCM follows `pcm` flag). Overrides mute/solo for preview.
   */
  private isolation: { channel: number; pcm: boolean } | null = null;

  private pcm: LoadedPcm | null = null;
  private pcmSource: AudioBufferSourceNode | null = null;
  private pcmGain: GainNode;
  private pcmMuted = false;
  private pcmSoloed = false;

  /** programNumber → loaded Soundfont instance */
  private instruments = new Map<number, SoundfontInst>();
  private instrumentLoading = new Map<number, Promise<SoundfontInst | null>>();
  /** channel → active GM program */
  private channelProgram = new Map<number, number>();
  /** style channel → forced program (user sound picker; overrides MIDI program events). */
  private styleProgramOverride = new Map<number, number>();
  /** Per pitch key → stacked voices (same pitch can overlap after reload/loop). */
  private activeNotes = new Map<string, ActiveStop[]>();

  private schedulerTimer: number | null = null;
  private lookaheadMs = 20;
  private scheduleAheadTime = 0.2;
  /**
   * smplr Voice.stop() keeps audio for ampRelease AFTER the stop time
   * (default 0.3s). Keep this near-zero so tails cannot ring into bar 1.
   */
  private ampReleaseSec = 0.008;
  /** Hard silence just before loop point (MIDI bus duck). */
  private loopGapSec = 0.025;
  /**
   * Monotonic schedule head: which loop pass + per-track event indices.
   * NEVER reset while still on the same pass — that re-fired bar-1 notes
   * every 20ms and caused the end→start resonance pile-up.
   */
  private schedulePass = 0;
  private eventCursor: number[] = [];
  private pendingLoopDuckPass = -1;

  private loopStartCtxTime = 0;

  private tracks: { channel: number; events: MidiEvent[]; program: number }[] = [];
  private ticksPerQuarter = 480;
  private loopLengthTicks = 0;

  state: TransportState = {
    playing: false, loop: true, bpm: 120,
    positionTicks: 0, loopLengthTicks: 0,
    positionSec: 0, loopLengthSec: 0,
    sfStatus: "idle"
  };
  onTick?: (t: TransportState) => void;

  private uiTimer: number | null = null;

  constructor() {
    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.95;
    this.masterGain.connect(this.ctx.destination);

    this.midiBus = this.ctx.createGain();
    this.midiBus.gain.value = 1;
    this.midiBus.connect(this.masterGain);

    this.pcmGain = this.ctx.createGain();
    this.pcmGain.gain.value = 0.9;
    this.pcmGain.connect(this.masterGain);

    for (const ch of [10, 11, 12, 13, 14, 15]) {
      const g = this.ctx.createGain();
      g.gain.value = CHANNEL_GAIN[ch] ?? 0.6;
      g.connect(this.masterGain);
      this.channelGains.set(ch, g);
      this.channelProgram.set(ch, ROLE_DEFAULT_PROGRAM[ch] ?? 0);
    }
  }

  async unlock(): Promise<void> {
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }
  }

  get contextState(): AudioContextState { return this.ctx.state; }

  loadPcm(pcm: Float32Array, sampleRate: number, channels: number, sourceBpm: number) {
    const chCount = Math.max(1, Math.min(2, channels | 0));
    const rate = sampleRate > 0 ? sampleRate : 44100;
    const frameCount = Math.floor(pcm.length / chCount);
    if (frameCount < 128) return;
    const buffer = this.ctx.createBuffer(chCount, frameCount, rate);
    for (let ch = 0; ch < chCount; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) data[i] = pcm[i * chCount + ch] || 0;
    }
    this.installBuffer(buffer, sourceBpm);
  }

  async loadEncoded(bytes: Uint8Array, sourceBpm: number): Promise<AudioBuffer> {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const buffer = await this.ctx.decodeAudioData(copy.buffer);
    this.installBuffer(buffer, sourceBpm);
    return buffer;
  }

  private installBuffer(buffer: AudioBuffer, sourceBpm: number) {
    const safeSourceBpm = sourceBpm > 0 ? sourceBpm : 120;
    this.pcm = { buffer, sourceBpm: safeSourceBpm, durationSec: buffer.duration };
    if (this.state.playing) this.restartPcmSource();
  }

  getLoadedPcm(): { pcm: Float32Array; channels: number; sampleRate: number; durationSec: number } | null {
    if (!this.pcm) return null;
    const b = this.pcm.buffer;
    const ch = b.numberOfChannels;
    const len = b.length;
    const out = new Float32Array(len * ch);
    for (let c = 0; c < ch; c++) {
      const data = b.getChannelData(c);
      for (let i = 0; i < len; i++) out[i * ch + c] = data[i];
    }
    return { pcm: out, channels: ch, sampleRate: b.sampleRate, durationSec: b.duration };
  }

  /**
   * Load MIDI tracks for preview.
   *
   * Multi-timbral source files keep their original channel + program mapping
   * so each part plays with its real GM instrument. The assigned style
   * `channel` is only used for mute/solo grouping of that lane.
   */
  loadTracks(
    tracks: { channel: number; events: MidiEvent[]; program?: number }[],
    ticksPerQuarter: number,
    loopLengthTicksOverride?: number
  ) {
    const programsNeeded = new Set<number>();
    this.styleProgramOverride.clear();

    this.tracks = tracks.map(t => {
      // User-selected sound always wins (default Grand Piano).
      const forced =
        t.program != null
          ? ((t.program % 128) + 128) % 128
          : (ROLE_DEFAULT_PROGRAM[t.channel] ?? 0);
      this.styleProgramOverride.set(t.channel, forced);
      this.channelProgram.set(t.channel, forced);
      programsNeeded.add(forced);

      const loopCap = loopLengthTicksOverride && loopLengthTicksOverride > 0
        ? loopLengthTicksOverride
        : Number.POSITIVE_INFINITY;

      // Ignore embedded program-changes so picker stays in control.
      // Drop notes near/after loop end (prevents wrap resonance into bar 1).
      // Clamp note-offs that would fire at the exact loop boundary.
      const events: MidiEvent[] = [];
      for (const e of t.events) {
        if (e.kind !== "note-on" && e.kind !== "note-off") continue;
        if (e.tick >= loopCap) continue;
        // Drop late note-ons near wrap; duration + bus duck kill residual tails.
        const edge = loopCap > 4
          ? loopCap - Math.max(1, Math.floor(ticksPerQuarter / 16))
          : loopCap;
        if (e.kind === "note-on" && e.velocity > 0 && e.tick >= edge) continue;
        if (e.kind === "note-off" && e.tick >= edge) {
          events.push({ ...e, tick: Math.max(0, edge - 1) });
          continue;
        }
        events.push(e);
      }
      events.sort((a, b) => a.tick - b.tick || (a.kind === "note-off" ? 0 : 1) - (b.kind === "note-off" ? 0 : 1));

      return { channel: t.channel, events, program: forced };
    });

    this.ticksPerQuarter = ticksPerQuarter;
    this.eventCursor = this.tracks.map(() => 0);

    let maxTick = 0;
    for (const t of this.tracks) {
      const last = t.events[t.events.length - 1];
      if (last && last.tick > maxTick) maxTick = last.tick;
    }
    const barTicks = ticksPerQuarter * 4;
    const autoLen = Math.max(barTicks, Math.ceil(maxTick / barTicks) * barTicks || barTicks);
    this.loopLengthTicks = loopLengthTicksOverride && loopLengthTicksOverride > 0
      ? loopLengthTicksOverride
      : autoLen;
    this.state.loopLengthTicks = this.loopLengthTicks;
    this.state.loopLengthSec = this.ticksToSec(this.loopLengthTicks);

    void this.preloadPrograms(Array.from(programsNeeded));

    if (this.state.playing) {
      // Soft-kill current voices, then resume from current absolute schedule head.
      this.releaseAllNotes(this.ctx.currentTime + 0.005);
      this.pendingLoopDuckPass = -1;
      this.resetMidiBusGain();
      const loopSec = this.ticksToSec(this.loopLengthTicks);
      const elapsed = Math.max(0, this.ctx.currentTime - this.loopStartCtxTime);
      const absPass = loopSec > 0 ? Math.floor(elapsed / loopSec) : 0;
      const posSec = loopSec > 0 ? elapsed - absPass * loopSec : 0;
      const posTicks = loopSec > 0 ? (posSec / loopSec) * this.loopLengthTicks : 0;
      this.schedulePass = Math.max(0, absPass);
      this.eventCursor = this.tracks.map(t => {
        let i = 0;
        while (i < t.events.length && t.events[i].tick < posTicks) i++;
        return i;
      });
    }
    this.emit();
  }

  /** Change the GM program for a style lane while playing / idle. */
  setStyleProgram(styleChannel: number, program: number) {
    const p = ((program % 128) + 128) % 128;
    this.styleProgramOverride.set(styleChannel, p);
    this.channelProgram.set(styleChannel, p);
    const t = this.tracks.find(x => x.channel === styleChannel);
    if (t) t.program = p;
    void this.ensureInstrument(p);
  }

  private async preloadPrograms(programs: number[]) {
    const unique = Array.from(new Set(programs.map(p => ((p % 128) + 128) % 128)));
    if (!unique.length) return;
    this.state.sfStatus = "loading";
    this.state.sfMessage = `Loading ${unique.length} instrument${unique.length === 1 ? "" : "s"}…`;
    this.emit();
    try {
      await Promise.all(unique.map(p => this.ensureInstrument(p)));
      this.state.sfStatus = "ready";
      this.state.sfMessage = `${unique.length} GM instrument${unique.length === 1 ? "" : "s"} ready`;
    } catch (e) {
      this.state.sfStatus = "error";
      this.state.sfMessage = (e as Error).message;
    }
    this.emit();
  }

  private async ensureInstrument(program: number): Promise<SoundfontInst | null> {
    const p = ((program % 128) + 128) % 128;
    const existing = this.instruments.get(p);
    if (existing) return existing;
    const inflight = this.instrumentLoading.get(p);
    if (inflight) return inflight;

    const name = gmProgramName(p);
    const promise = (async () => {
      try {
        // Route through midiBus so loop-wrap duck can kill SF release tails.
        const inst = Soundfont(this.ctx, {
          instrument: name,
          kit: "FluidR3_GM",
          destination: this.midiBus,
          volume: 90
        });
        await inst.load;
        this.instruments.set(p, inst);
        return inst;
      } catch (err) {
        // Fallback: acoustic grand if a patch name is missing from the kit.
        try {
          const fallback = Soundfont(this.ctx, {
            instrument: "acoustic_grand_piano",
            kit: "FluidR3_GM",
            destination: this.midiBus,
            volume: 90
          });
          await fallback.load;
          this.instruments.set(p, fallback);
          return fallback;
        } catch {
          console.warn("SoundFont load failed for", name, err);
          return null;
        }
      } finally {
        this.instrumentLoading.delete(p);
      }
    })();

    this.instrumentLoading.set(p, promise);
    return promise;
  }

  setBpm(bpm: number) {
    const clamped = Math.max(30, Math.min(300, bpm));
    this.state.bpm = clamped;
    if (this.pcm && this.pcmSource && this.pcm.sourceBpm > 0) {
      this.pcmSource.playbackRate.value = this.state.bpm / this.pcm.sourceBpm;
    }
    this.state.loopLengthSec = this.ticksToSec(this.loopLengthTicks);
    this.emit();
  }

  setLoop(loop: boolean) {
    this.state.loop = loop;
    if (this.pcmSource) this.pcmSource.loop = loop;
    this.emit();
  }

  setChannelMute(midiChannel: number, muted: boolean) {
    if (muted) this.muted.add(midiChannel); else this.muted.delete(midiChannel);
    this.recomputeGains();
  }
  setChannelSolo(midiChannel: number, soloed: boolean) {
    if (soloed) this.soloed.add(midiChannel); else this.soloed.delete(midiChannel);
    this.recomputeGains();
  }
  setPcmMute(m: boolean) { this.pcmMuted = m; this.recomputeGains(); }
  setPcmSolo(s: boolean) { this.pcmSoloed = s; this.recomputeGains(); }

  /**
   * Solo one MIDI lane for editor preview.
   * `null` clears isolation (full mix again).
   * `withPcm: false` = this MIDI only (no AUS drums / other lanes).
   */
  setIsolation(midiChannel: number | null, withPcm = false) {
    this.isolation =
      midiChannel == null ? null : { channel: midiChannel, pcm: withPcm };
    this.recomputeGains();
  }

  clearIsolation() {
    if (!this.isolation) return;
    this.isolation = null;
    this.recomputeGains();
  }

  private recomputeGains() {
    if (this.isolation) {
      const iso = this.isolation;
      this.pcmGain.gain.setTargetAtTime(iso.pcm ? 0.9 : 0, this.ctx.currentTime, 0.02);
      for (const [ch, gain] of this.channelGains) {
        const on = ch === iso.channel;
        gain.gain.setTargetAtTime(on ? (CHANNEL_GAIN[ch] ?? 0.6) : 0, this.ctx.currentTime, 0.02);
      }
      return;
    }
    const anySolo = this.pcmSoloed || this.soloed.size > 0;
    const pcmActive = !this.pcmMuted && (!anySolo || this.pcmSoloed);
    this.pcmGain.gain.setTargetAtTime(pcmActive ? 0.9 : 0, this.ctx.currentTime, 0.02);
    for (const [ch, gain] of this.channelGains) {
      const chActive = !this.muted.has(ch) && (!anySolo || this.soloed.has(ch));
      gain.gain.setTargetAtTime(chActive ? (CHANNEL_GAIN[ch] ?? 0.6) : 0, this.ctx.currentTime, 0.02);
    }
  }

  private channelAudible(channel: number): boolean {
    if (this.isolation) return channel === this.isolation.channel;
    if (this.muted.has(channel)) return false;
    const anySolo = this.pcmSoloed || this.soloed.size > 0;
    if (anySolo && !this.soloed.has(channel)) return false;
    return true;
  }

  async play() {
    if (this.state.playing) return;
    if (this.ctx.state === "suspended") {
      try { await this.ctx.resume(); } catch { /* ignore */ }
    }

    // Ensure instruments for current tracks are loading/ready before first notes.
    const progs = this.tracks.map(t => t.program);
    if (progs.length) await this.preloadPrograms(progs);

    this.state.playing = true;
    this.loopStartCtxTime = this.ctx.currentTime + 0.08;
    this.schedulePass = 0;
    this.eventCursor = this.tracks.map(() => 0);
    this.pendingLoopDuckPass = -1;
    this.resetMidiBusGain();
    this.releaseAllNotes(this.ctx.currentTime);

    if (this.pcm) this.startPcmSource(this.loopStartCtxTime);

    this.schedulerTimer = window.setInterval(() => this.scheduler(), this.lookaheadMs);
    this.uiTimer = window.setInterval(() => this.emitPosition(), 33);
    this.emit();
  }

  stop() {
    if (!this.state.playing) return;
    this.state.playing = false;
    this.state.positionTicks = 0;
    this.state.positionSec = 0;
    this.schedulePass = 0;
    this.pendingLoopDuckPass = -1;
    this.eventCursor = this.tracks.map(() => 0);
    // Keep isolation while editor is open; LivePreview clears on close.

    if (this.pcmSource) {
      try { this.pcmSource.stop(); } catch { /* no-op */ }
      this.pcmSource.disconnect();
      this.pcmSource = null;
    }
    if (this.schedulerTimer !== null) { clearInterval(this.schedulerTimer); this.schedulerTimer = null; }
    if (this.uiTimer !== null) { clearInterval(this.uiTimer); this.uiTimer = null; }

    // Immediate release of every tracked voice so Stop never leaves hanging MIDI.
    this.releaseAllNotes(this.ctx.currentTime);
    this.resetMidiBusGain();
    this.emit();
  }

  private resetMidiBusGain() {
    const g = this.midiBus.gain;
    const now = this.ctx.currentTime;
    try {
      g.cancelScheduledValues(now);
      g.setValueAtTime(1, now);
    } catch { /* ignore */ }
  }

  /**
   * Duck MIDI bus to silence just before the loop point so smplr ampRelease
   * tails cannot ring into the next pass (bar 1). Fully open again by the
   * boundary so next-pass attacks are not clipped.
   */
  private scheduleLoopDuck(boundary: number) {
    const g = this.midiBus.gain;
    const fade = 0.012;
    const muteStart = boundary - this.loopGapSec;
    try {
      const armAt = Math.max(this.ctx.currentTime, muteStart - fade - 0.005);
      g.cancelScheduledValues(armAt);
      g.setValueAtTime(1, armAt);
      g.linearRampToValueAtTime(0.0001, muteStart);
      g.setValueAtTime(0.0001, boundary - 0.002);
      g.linearRampToValueAtTime(1, boundary);
    } catch { /* ignore */ }
  }

  /**
   * Soft-release all active GM voices (avoids click/pop at loop end).
   * Map is always cleared so Stop / reload cannot leave untracked orphans.
   */
  private releaseAllNotes(when: number) {
    const now = this.ctx.currentTime;
    const t = Math.max(when, now + 0.001);
    let i = 0;
    for (const list of this.activeNotes.values()) {
      for (const n of list) {
        try { n.stop(t + i * 0.0005); } catch { /* already stopped */ }
        i++;
      }
    }
    this.activeNotes.clear();
    // Safety: stop any untracked smplr voices still in the graph.
    for (const inst of this.instruments.values()) {
      try { inst.stop({ time: t }); } catch { /* ignore */ }
    }
  }

  private startPcmSource(when: number, offsetSec = 0) {
    if (!this.pcm) return;
    if (this.pcmSource) {
      try { this.pcmSource.stop(); } catch { /* ignore */ }
      try { this.pcmSource.disconnect(); } catch { /* ignore */ }
      this.pcmSource = null;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.pcm.buffer;
    src.loop = this.state.loop;
    src.loopStart = 0;
    src.loopEnd = this.pcm.durationSec;
    const rate = this.pcm.sourceBpm > 0 ? this.state.bpm / this.pcm.sourceBpm : 1;
    src.playbackRate.value = Number.isFinite(rate) && rate > 0 ? rate : 1;
    src.connect(this.pcmGain);
    const off = ((offsetSec % this.pcm.durationSec) + this.pcm.durationSec) % this.pcm.durationSec;
    src.start(when, off);
    this.pcmSource = src;
  }

  private restartPcmSource() {
    if (!this.pcm || !this.state.playing) return;
    const alignmentSec = this.ticksToSec(this.loopLengthTicks) || this.pcm.durationSec || 1;
    const elapsed = this.ctx.currentTime - this.loopStartCtxTime;
    const phase = ((elapsed % alignmentSec) + alignmentSec) % alignmentSec;
    const offsetSec = (phase / alignmentSec) * this.pcm.durationSec;
    this.startPcmSource(this.ctx.currentTime + 0.01, offsetSec);
  }

  private ticksToSec(ticks: number): number {
    const secondsPerBeat = 60 / this.state.bpm;
    return (ticks / this.ticksPerQuarter) * secondsPerBeat;
  }

  private scheduler() {
    if (!this.state.playing) return;
    const now = this.ctx.currentTime;
    const horizon = now + this.scheduleAheadTime;
    const loopSec = this.ticksToSec(this.loopLengthTicks);
    if (loopSec <= 0) return;

    // Hold + ampRelease must finish before the bus mute window.
    const preWrapHold = this.ampReleaseSec + this.loopGapSec + 0.012;

    // Monotonic head: schedule each (pass, event) exactly once.
    let guard = 0;
    while (guard++ < 16) {
      const pass = this.schedulePass;
      const passStart = this.loopStartCtxTime + pass * loopSec;
      const passEnd = passStart + loopSec;
      const releaseAt = this.state.loop ? passEnd - preWrapHold : passEnd;

      if (passStart >= horizon) break;

      const passHorizonTick = Math.min(
        this.loopLengthTicks,
        Math.max(0, ((horizon - passStart) / loopSec) * this.loopLengthTicks)
      );

      for (let ti = 0; ti < this.tracks.length; ti++) {
        const evs = this.tracks[ti].events;
        let ci = this.eventCursor[ti] ?? 0;
        while (ci < evs.length && evs[ci].tick <= passHorizonTick) {
          const when = passStart + this.ticksToSec(evs[ci].tick);
          if (!(when >= releaseAt && this.state.loop)) {
            // Skip events already in the past (mid-play reload safety).
            if (when >= now - 0.02) {
              this.scheduleEvent(evs[ci], when, this.tracks[ti].channel, releaseAt);
            }
          }
          ci++;
        }
        this.eventCursor[ti] = ci;
      }

      // Once the lookahead reaches the release edge, this pass is fully scheduled.
      if (horizon >= releaseAt) {
        if (this.state.loop) {
          const boundaryPass = pass + 1;
          if (boundaryPass !== this.pendingLoopDuckPass) {
            this.scheduleLoopDuck(passEnd);
            this.pendingLoopDuckPass = boundaryPass;
          }
          this.schedulePass = pass + 1;
          this.eventCursor = this.tracks.map(() => 0);
          this.pruneReleasedNotes();
          continue;
        }
        if (now >= passEnd) this.stop();
      }
      break;
    }

    if (!this.state.loop && (now - this.loopStartCtxTime) > loopSec) {
      this.stop();
    }
  }

  private emitPosition() {
    if (!this.state.playing) return;
    const loopSec = this.ticksToSec(this.loopLengthTicks);
    const elapsed = this.ctx.currentTime - this.loopStartCtxTime;
    const posSec = loopSec > 0 ? ((elapsed % loopSec) + loopSec) % loopSec : 0;
    this.state.positionSec = posSec;
    this.state.positionTicks = loopSec > 0 ? (posSec / loopSec) * this.loopLengthTicks : 0;
    this.state.loopLengthSec = loopSec;
    this.emit();
  }

  private scheduleEvent(
    ev: MidiEvent,
    when: number,
    styleChannel: number,
    passReleaseAt?: number
  ) {
    if (!this.channelAudible(styleChannel)) return;
    // Program changes ignored — sound picker owns the instrument.
    if (ev.kind === "program") return;
    if (ev.kind === "note-on") {
      this.noteOn(styleChannel, ev.note, ev.velocity, when, passReleaseAt);
    } else if (ev.kind === "note-off") {
      this.noteOff(styleChannel, ev.note, when);
    }
  }

  private noteOn(
    styleChannel: number,
    note: number,
    velocity: number,
    when: number,
    passReleaseAt?: number
  ) {
    if (velocity <= 0) {
      this.noteOff(styleChannel, note, when);
      return;
    }

    const program =
      this.styleProgramOverride.get(styleChannel)
      ?? this.channelProgram.get(styleChannel)
      ?? ROLE_DEFAULT_PROGRAM[styleChannel]
      ?? 0;
    const inst = this.instruments.get(((program % 128) + 128) % 128);
    if (!inst) {
      void this.ensureInstrument(program);
      return;
    }

    const startAt = Math.max(when, this.ctx.currentTime + 0.001);
    // Hold ends at releaseAt; smplr then adds ampRelease after stop.
    let maxDur = 4;
    if (passReleaseAt != null && Number.isFinite(passReleaseAt)) {
      maxDur = Math.max(0.02, Math.min(4, passReleaseAt - startAt));
    }
    if (maxDur < 0.02) return;

    const key = `${styleChannel}-${note}`;
    const existing = this.activeNotes.get(key);
    if (existing?.length) {
      const stealAt = Math.max(startAt - 0.004, this.ctx.currentTime);
      for (const v of existing) {
        try { v.stop(stealAt); } catch { /* ignore */ }
      }
      this.activeNotes.delete(key);
    }

    try {
      // Unique stopId per voice so re-triggers / wrap do not share smplr ids.
      const stopId = `${styleChannel}:${note}:${startAt.toFixed(5)}`;
      const stop = inst.start({
        note,
        velocity: Math.max(1, Math.min(110, velocity)),
        time: startAt,
        duration: maxDur,
        ampRelease: this.ampReleaseSec,
        stopId,
      });
      const releaseBy = passReleaseAt != null && Number.isFinite(passReleaseAt)
        ? passReleaseAt
        : startAt + maxDur;
      const silenceBy = releaseBy + this.ampReleaseSec + 0.004;
      const handle: ActiveStop = {
        releaseBy: silenceBy,
        stop: (t?: number) => {
          try { stop(t ?? this.ctx.currentTime); } catch { /* */ }
        }
      };
      const list = this.activeNotes.get(key);
      if (list) list.push(handle);
      else this.activeNotes.set(key, [handle]);
    } catch (e) {
      console.warn("SoundFont note-on failed", e);
    }
  }

  private noteOff(styleChannel: number, note: number, when: number) {
    const key = `${styleChannel}-${note}`;
    const list = this.activeNotes.get(key);
    if (!list?.length) return;
    const t = Math.max(when - 0.008, this.ctx.currentTime);
    for (const active of list) {
      try { active.stop(t); } catch { /* ignore */ }
    }
    this.activeNotes.delete(key);
  }

  /** Drop voices whose full silence deadline has passed (after loop wrap). */
  private pruneReleasedNotes() {
    const now = this.ctx.currentTime;
    for (const [key, list] of this.activeNotes) {
      const keep = list.filter(n => n.releaseBy > now + 0.01);
      if (keep.length) this.activeNotes.set(key, keep);
      else this.activeNotes.delete(key);
    }
  }

  private emit() { this.onTick?.({ ...this.state }); }

  dispose() {
    this.stop();
    for (const inst of this.instruments.values()) {
      try { inst.disconnect(); } catch { /* ignore */ }
    }
    this.instruments.clear();
    this.ctx.close().catch(() => {});
  }
}
