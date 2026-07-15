import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropZone } from "./components/DropZone";
import { AusInspector } from "./components/AusInspector";
import { ChannelMatrix, LoadedMidi, STYLE_CHANNELS, StyleRole } from "./components/ChannelMatrix";
import { StyleMetadataForm, StyleMetaState } from "./components/StyleMetadataForm";
import { ExportPanel } from "./components/ExportPanel";
import { KeySnapState, LivePreview, ROLE_COLORS, roleToEngineChannel } from "./components/LivePreview";
import { AusParseResult, parseAus } from "./lib/binary/ausParser";
import { MidiEvent, parseMidi } from "./lib/binary/midiParser";
import { downloadBytes, fileToBytes } from "./lib/binary/bytes";
import { AssignedTrack, buildStyle, StyleBuildResult, styleChannelToMidi } from "./lib/binary/styleStitcher";
import { PlaybackEngine } from "./lib/audio/PlaybackEngine";
import { duplicateEventsByAusLength, shiftEventsByTicks, snapEventsToKey } from "./lib/midi/noteEdit";
import {
  DEFAULT_PIANO_SOUND_ID,
  findSound,
  ROLE_DEFAULT_SOUND_ID
} from "./lib/audio/gmPrograms";
import { BrandLogo } from "./components/BrandLogo";
import "./studio.css";

interface StudioAppProps {
  onBackHome?: () => void;
}

/**
 * Studio application shell. Owns:
 *   - The parsed .aus + list of loaded MIDI files.
 *   - Role assignments, style metadata, PlaybackEngine, compile result.
 * All parsing runs client-side.
 */
export function StudioApp({ onBackHome }: StudioAppProps) {
  const [ausName, setAusName] = useState<string | null>(null);
  const [ausParsed, setAusParsed] = useState<AusParseResult | null>(null);
  const [midis, setMidis] = useState<LoadedMidi[]>([]);
  const [assignments, setAssignments] = useState<Record<number, StyleRole | "unassigned">>({});
  const [meta, setMeta] = useState<StyleMetaState>({
    name: "My Audio Style",
    category: "Pop&Rock",
    bpm: 120,
    timeSigNum: 4,
    timeSigDen: 4,
    sections: ["Main A"]
  });

  const [result, setResult] = useState<StyleBuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Decoded PCM ready to draw as a waveform. Populated after AudioContext
   *  decodes the encoded AUDI container (Ogg/WAV/etc). */
  const [decodedPcm, setDecodedPcm] = useState<{
    pcm: Float32Array; channels: number; sampleRate: number; durationSec: number;
  } | null>(null);

  // Preview mute/solo state (kept in App so it survives re-renders of LivePreview)
  const [muteRoles, setMuteRoles] = useState<Partial<Record<StyleRole, boolean>>>({});
  const [soloRoles, setSoloRoles] = useState<Partial<Record<StyleRole, boolean>>>({});
  const [pcmMute, setPcmMute] = useState(false);
  const [pcmSolo, setPcmSolo] = useState(false);
  const [keySnap, setKeySnap] = useState<KeySnapState>({
    root: "C",
    mode: "major",
    target: "scale"
  });
  /** Per-role GM/XG sound (default Grand Piano for every lane). */
  const [roleSounds, setRoleSounds] = useState<Partial<Record<StyleRole, string>>>({});

  const engineRef = useRef<PlaybackEngine | null>(null);
  const [engineTick, setEngineTick] = useState(0);

  /**
   * Create the AudioContext eagerly (on mount) so PCM and MIDI can be loaded
   * into the engine as soon as files are dropped. The context starts in
   * "suspended" state — the first user gesture (Play button) will resume it,
   * which is what the browser autoplay policy actually requires.
   */
  useEffect(() => {
    if (!engineRef.current) {
      try {
        engineRef.current = new PlaybackEngine();
        setEngineTick(x => x + 1);
      } catch (e) {
        setError(`Web Audio init failed: ${(e as Error).message}`);
      }
    }
    return () => { engineRef.current?.dispose(); engineRef.current = null; };
  }, []);

  /** Kept for API compatibility with LivePreview — engine already exists. */
  const ensureEngine = useCallback(() => {
    if (!engineRef.current) engineRef.current = new PlaybackEngine();
    return engineRef.current;
  }, []);

  // ---- File intake ------------------------------------------------------

  const onAusDrop = async (files: File[]) => {
    const file = files.find(f => f.name.toLowerCase().endsWith(".aus")) ?? files[0];
    if (!file) return;
    setError(null);
    setDecodedPcm(null);
    try {
      const bytes = await fileToBytes(file);
      const parsed = parseAus(bytes);
      setAusName(file.name);
      setAusParsed(parsed);

      // Adopt the tempo + time-sig recovered from the AUS file. This overrides
      // the default 120/4 so the waveform, bar grid, playhead and MIDI stay
      // locked to whatever the AUS was authored at.
      setMeta(m => ({
        ...m,
        bpm: parsed.meta.bpm,
        timeSigNum: parsed.meta.timeSigNum,
        timeSigDen: parsed.meta.timeSigDen
      }));
    } catch (e) {
      setError(`Failed to parse .aus: ${(e as Error).message}`);
    }
  };

  const parseMidiFile = async (file: File): Promise<LoadedMidi | null> => {
    if (!file.name.toLowerCase().endsWith(".mid") && !file.name.toLowerCase().endsWith(".midi")) return null;
    const bytes = await fileToBytes(file);
    const parsed = parseMidi(bytes);
    const firstNoteful = parsed.tracks.findIndex(t => t.channelsUsed.length > 0);
    return { name: file.name, bytes, parsed, trackIndex: firstNoteful === -1 ? 0 : firstNoteful };
  };

  const onMidiDrop = async (files: File[]) => {
    setError(null);
    const additions: LoadedMidi[] = [];
    for (const file of files) {
      try {
        const m = await parseMidiFile(file);
        if (m) additions.push(m);
      } catch (e) {
        setError(`Failed to parse ${file.name}: ${(e as Error).message}`);
      }
    }
    if (!additions.length) return;

    // Auto-suggest the first BPM/time-sig from a dropped MIDI (only if the
    // user hasn't already customised them away from the default 120/4).
    const first = additions[0].parsed;
    setMeta(m => ({
      ...m,
      bpm: m.bpm === 120 ? first.tempoBpm : m.bpm,
      timeSigNum: m.timeSigNum === 4 ? first.timeSigNumerator : m.timeSigNum,
      timeSigDen: m.timeSigDen === 4 ? first.timeSigDenominator : m.timeSigDen
    }));

    setMidis(prev => {
      const combined = [...prev, ...additions].slice(0, 6);
      // Auto-assign first N roles that aren't taken yet
      setAssignments(a => {
        const next = { ...a };
        const taken = new Set(Object.values(next).filter(v => v !== "unassigned")) as Set<StyleRole>;
        combined.forEach((_, i) => {
          if (next[i]) return;
          const role = STYLE_CHANNELS.map(s => s.role).find(r => !taken.has(r as StyleRole)) as StyleRole | undefined;
          if (role) { next[i] = role; taken.add(role); }
          else next[i] = "unassigned";
        });
        return next;
      });
      return combined;
    });
  };

  const removeMidi = (idx: number) => {
    setMidis(prev => prev.filter((_, i) => i !== idx));
    setAssignments(a => {
      const next: typeof a = {};
      const keys = Object.keys(a).map(Number).sort((x, y) => x - y);
      for (const k of keys) {
        if (k === idx) continue;
        next[k > idx ? k - 1 : k] = a[k];
      }
      return next;
    });
  };

  /** Live preview drop → assign an existing loaded MIDI to a role, or ingest a new file. */
  const onLiveDropRole = async (role: StyleRole, files: File[]) => {
    // Parse first file (roles are 1:1)
    let loaded: LoadedMidi | null = null;
    try {
      loaded = await parseMidiFile(files[0]);
    } catch (e) {
      setError(`Failed to parse ${files[0].name}: ${(e as Error).message}`);
      return;
    }
    if (!loaded) return;

    setMidis(prev => {
      // Remove any existing MIDI currently occupying this role.
      let stripped = prev;
      setAssignments(a => {
        const next = { ...a };
        for (const k of Object.keys(next).map(Number)) {
          if (next[k] === role) next[k] = "unassigned";
        }
        return next;
      });
      const newList = [...stripped, loaded!].slice(-6);
      setAssignments(a => {
        const next = { ...a };
        next[newList.length - 1] = role;
        return next;
      });
      return newList;
    });
  };

  const clearRole = (role: StyleRole) => {
    setAssignments(a => {
      const next = { ...a };
      for (const k of Object.keys(next).map(Number)) {
        if (next[k] === role) next[k] = "unassigned";
      }
      return next;
    });
  };

  // ---- Derived: routed AssignedTracks --------------------------------

  const assignedTracks: AssignedTrack[] = useMemo(() => {
    const out: AssignedTrack[] = [];
    for (let i = 0; i < midis.length; i++) {
      const role = assignments[i];
      if (!role || role === "unassigned") continue;
      const sc = STYLE_CHANNELS.find(s => s.role === role);
      if (!sc) continue;
      const m = midis[i];
      const track = m.parsed.tracks[m.trackIndex] ?? m.parsed.tracks[0];
      if (!track) continue;
      const soundId = roleSounds[role as StyleRole]
        ?? ROLE_DEFAULT_SOUND_ID[role]
        ?? DEFAULT_PIANO_SOUND_ID;
      const sound = findSound(soundId);
      out.push({
        sourceName: m.name,
        track,
        targetChannel: sc.ch,
        role: role as AssignedTrack["role"],
        program: sound.program,
        bankMsb: sound.msb,
        bankLsb: sound.lsb,
        soundName: `${sound.name} (${sound.bank})`
      });
    }
    return out;
  }, [midis, assignments, roleSounds]);

  /** Role → LoadedMidi resolver used by the LivePreview lanes. */
  const roleMidiMap = useMemo(() => {
    const map: Partial<Record<StyleRole, LoadedMidi>> = {};
    for (let i = 0; i < midis.length; i++) {
      const role = assignments[i];
      if (role && role !== "unassigned") map[role as StyleRole] = midis[i];
    }
    return map;
  }, [midis, assignments]);

  const loopLenTicks = useMemo(() => {
    const tpq = midis[0]?.parsed.ticksPerQuarter ?? 480;
    const bar = tpq * (meta.timeSigNum || 4);
    // Prefer the AUS-declared bar count when present, so the drum loop and
    // grid line up even when no MIDI has been dropped yet.
    const ausBars = ausParsed?.meta.bars ?? 0;
    let maxTick = ausBars > 0 ? ausBars * bar : 0;
    for (const at of assignedTracks) {
      const last = at.track.events[at.track.events.length - 1];
      if (last && last.tick > maxTick) maxTick = last.tick;
    }
    return Math.max(bar, Math.ceil(maxTick / bar) * bar || bar);
  }, [assignedTracks, midis, ausParsed, meta.timeSigNum]);

  const loopBars = useMemo(() => {
    const tpq = midis[0]?.parsed.ticksPerQuarter ?? 480;
    const bar = tpq * (meta.timeSigNum || 4);
    return Math.max(1, Math.round(loopLenTicks / bar));
  }, [loopLenTicks, midis, meta.timeSigNum]);

  /** One AUS pattern length in ticks (period used for tile/duplicate). */
  const ausLengthTicks = useMemo(() => {
    const tpq = midis[0]?.parsed.ticksPerQuarter ?? 480;
    const bar = tpq * (meta.timeSigNum || 4);
    const ausBars = ausParsed?.meta.bars ?? 0;
    if (ausBars > 0) return ausBars * bar;
    return loopLenTicks;
  }, [midis, meta.timeSigNum, ausParsed, loopLenTicks]);

  const snapTicks = useMemo(() => {
    const tpq = midis[0]?.parsed.ticksPerQuarter ?? 480;
    return Math.max(1, Math.round(tpq / 4)); // 16th notes
  }, [midis]);

  /** Update events on the track assigned to a role (drag / resize / copy). */
  const onRoleEventsChange = useCallback((role: StyleRole, events: MidiEvent[]) => {
    setMidis(list => {
      const idx = list.findIndex((_, i) => assignments[i] === role);
      if (idx < 0) return list;
      return list.map((m, i) => {
        if (i !== idx) return m;
        const ti = m.trackIndex;
        const tracks = m.parsed.tracks.map((t, tIdx) => {
          if (tIdx !== ti) return t;
          return { ...t, events: events.slice(), channelsUsed: t.channelsUsed };
        });
        const lengthTicks = Math.max(
          m.parsed.lengthTicks,
          ...tracks.map(t => t.events[t.events.length - 1]?.tick ?? 0)
        );
        return {
          ...m,
          parsed: { ...m.parsed, tracks, lengthTicks }
        };
      });
    });
  }, [assignments]);

  /** Shift all events on a role's track later (+) or earlier (−). */
  const onShiftRoleTiming = useCallback((role: StyleRole, deltaTicks: number) => {
    if (!deltaTicks) return;
    setMidis(list => {
      const idx = list.findIndex((_, i) => assignments[i] === role);
      if (idx < 0) return list;
      return list.map((m, i) => {
        if (i !== idx) return m;
        const ti = m.trackIndex;
        const tracks = m.parsed.tracks.map((t, tIdx) => {
          if (tIdx !== ti) return t;
          return { ...t, events: shiftEventsByTicks(t.events, deltaTicks) };
        });
        const lengthTicks = Math.max(
          m.parsed.lengthTicks,
          ...tracks.map(t => t.events[t.events.length - 1]?.tick ?? 0)
        );
        return {
          ...m,
          parsed: { ...m.parsed, tracks, lengthTicks }
        };
      });
    });
  }, [assignments]);

  /** Tile the role's pattern across AUS length (and up to project loop). */
  const onDuplicateToAus = useCallback((role: StyleRole) => {
    const period = ausLengthTicks;
    if (period <= 0) return;
    const target = Math.max(period, loopLenTicks);
    setMidis(list => {
      const idx = list.findIndex((_, i) => assignments[i] === role);
      if (idx < 0) return list;
      return list.map((m, i) => {
        if (i !== idx) return m;
        const ti = m.trackIndex;
        const tracks = m.parsed.tracks.map((t, tIdx) => {
          if (tIdx !== ti) return t;
          const next = duplicateEventsByAusLength(t.events, period, target);
          return { ...t, events: next };
        });
        const lengthTicks = Math.max(
          m.parsed.lengthTicks,
          ...tracks.map(t => t.events[t.events.length - 1]?.tick ?? 0)
        );
        return {
          ...m,
          parsed: { ...m.parsed, tracks, lengthTicks }
        };
      });
    });
  }, [assignments, ausLengthTicks, loopLenTicks]);

  const applyKeySnapToMidiIndex = useCallback((list: LoadedMidi[], idx: number, snap: KeySnapState): LoadedMidi[] => {
    if (snap.mode === "chromatic") return list;
    return list.map((m, i) => {
      if (i !== idx) return m;
      const ti = m.trackIndex;
      const tracks = m.parsed.tracks.map((t, tIdx) => {
        if (tIdx !== ti) return t;
        return {
          ...t,
          events: snapEventsToKey(t.events, snap.root, snap.mode, snap.target)
        };
      });
      return { ...m, parsed: { ...m.parsed, tracks } };
    });
  }, []);

  const onSnapRoleToKey = useCallback((role: StyleRole) => {
    setMidis(list => {
      const idx = list.findIndex((_, i) => assignments[i] === role);
      if (idx < 0) return list;
      return applyKeySnapToMidiIndex(list, idx, keySnap);
    });
  }, [assignments, keySnap, applyKeySnapToMidiIndex]);

  const onSnapAllToKey = useCallback(() => {
    if (keySnap.mode === "chromatic") return;
    setMidis(list => {
      let next = list;
      for (let i = 0; i < list.length; i++) {
        const role = assignments[i];
        if (!role || role === "unassigned") continue;
        next = applyKeySnapToMidiIndex(next, i, keySnap);
      }
      return next;
    });
  }, [assignments, keySnap, applyKeySnapToMidiIndex]);

  // ---- Engine synchronisation --------------------------------------

  // Feed PCM (or encoded container) to the engine whenever the parsed AUS
  // or engine instance changes. Real Audio Phraser AUS files use Afmt/Adat
  // raw PCM; older layouts may embed Ogg/WAV inside AUDI.
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !ausParsed?.audio) return;
    const audio = ausParsed.audio;
    let cancelled = false;

    (async () => {
      try {
        if (audio.pcm.length > 0) {
          // Primary path: already-decoded Float32 from Afmt/Adat (or raw PCM).
          eng.loadPcm(audio.pcm, audio.sampleRate, audio.channels, ausParsed.meta.bpm || 120);
          if (cancelled) return;
          setDecodedPcm({
            pcm: audio.pcm,
            channels: audio.channels,
            sampleRate: audio.sampleRate,
            durationSec: audio.durationSec
          });
        } else if (audio.encodedBytes && audio.encodedMime) {
          await eng.unlock();
          await eng.loadEncoded(audio.encodedBytes, ausParsed.meta.bpm || 120);
          if (cancelled) return;
          const dec = eng.getLoadedPcm();
          if (dec) setDecodedPcm(dec);
        } else {
          if (!cancelled) {
            setError("AUS has no playable audio (no Adat/Afmt or AUDI container found).");
            setDecodedPcm(null);
          }
          return;
        }
        eng.setBpm(meta.bpm);
      } catch (e) {
        if (!cancelled) {
          setError(`Could not load AUS audio (${audio.encodedMime ?? "pcm"}): ${(e as Error).message}`);
          setDecodedPcm(null);
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ausParsed, engineTick]);

  // BPM slider changes: just rescale playback, don't reload PCM.
  useEffect(() => {
    engineRef.current?.setBpm(meta.bpm);
  }, [meta.bpm]);

  // Feed routed MIDI to the engine whenever assignments/tracks/sounds change.
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const trackFeed = assignedTracks.map(at => ({
      channel: styleChannelToMidi(at.targetChannel),
      events: at.track.events,
      program: at.program ?? 0
    }));
    const ticks = midis[0]?.parsed.ticksPerQuarter ?? 480;
    eng.loadTracks(trackFeed, ticks, loopLenTicks);

    for (const at of assignedTracks) {
      const ch = styleChannelToMidi(at.targetChannel);
      const role = at.role as StyleRole;
      eng.setChannelMute(ch, !!muteRoles[role]);
      eng.setChannelSolo(ch, !!soloRoles[role]);
      if (at.program != null) eng.setStyleProgram(ch, at.program);
    }
  }, [assignedTracks, midis, engineTick, loopLenTicks, muteRoles, soloRoles]);

  // ---- Compile action -------------------------------------------------

  const canCompile = !!ausParsed && assignedTracks.length > 0;
  const compile = () => {
    setError(null);
    if (!ausParsed) { setError("Please upload an .aus file first."); return; }
    if (assignedTracks.length === 0) { setError("Assign at least one MIDI track to a style channel."); return; }
    try {
      const built = buildStyle({
        name: meta.name,
        category: meta.category,
        bpm: meta.bpm,
        timeSigNum: meta.timeSigNum,
        timeSigDen: meta.timeSigDen,
        sections: meta.sections.length ? meta.sections : ["Main A"],
        ticksPerQuarter: midis[0]?.parsed.ticksPerQuarter ?? 480,
        aus: ausParsed,
        tracks: assignedTracks
      });
      setResult(built);
    } catch (e) {
      setError(`Compile failed: ${(e as Error).message}`);
    }
  };

  const download = () => {
    if (!result) return;
    const safe = meta.name.replace(/[^\w\-]+/g, "_") || "audio_style";
    downloadBytes(`${safe}.sty`, result.styBytes, "application/octet-stream");
  };

  // ---- Mute/Solo handlers (bridge UI state ↔ engine) --------------------

  const toggleMute = (role: StyleRole) => {
    const ch = roleToEngineChannel(role);
    const next = !muteRoles[role];
    setMuteRoles(r => ({ ...r, [role]: next }));
    engineRef.current?.setChannelMute(ch, next);
  };
  const toggleSolo = (role: StyleRole) => {
    const ch = roleToEngineChannel(role);
    const next = !soloRoles[role];
    setSoloRoles(r => ({ ...r, [role]: next }));
    engineRef.current?.setChannelSolo(ch, next);
  };
  const togglePcmMute = () => {
    const n = !pcmMute; setPcmMute(n); engineRef.current?.setPcmMute(n);
  };
  const togglePcmSolo = () => {
    const n = !pcmSolo; setPcmSolo(n); engineRef.current?.setPcmSolo(n);
  };

  const onSoundChange = useCallback((role: StyleRole, soundId: string) => {
    setRoleSounds(s => ({ ...s, [role]: soundId }));
    const sound = findSound(soundId);
    const ch = roleToEngineChannel(role);
    engineRef.current?.setStyleProgram(ch, sound.program);
  }, []);

  const rolePickers = STYLE_CHANNELS.map(sc => ({
    role: sc.role,
    midi: roleMidiMap[sc.role] ?? null,
    color: ROLE_COLORS[sc.role],
    engineChannel: sc.ch - 1,
    mute: !!muteRoles[sc.role],
    solo: !!soloRoles[sc.role],
    soundId: roleSounds[sc.role] ?? ROLE_DEFAULT_SOUND_ID[sc.role] ?? DEFAULT_PIANO_SOUND_ID
  }));

  const stepAus = !!ausParsed;
  const stepMidi = assignedTracks.length > 0;
  const stepReady = canCompile;
  const stepDone = !!result;

  return (
    <div className="st-root">
      <header className="st-nav">
        <div className="st-nav-inner">
          <div className="flex items-center gap-3 min-w-0">
            {onBackHome && (
              <button type="button" className="st-btn st-btn-ghost" onClick={onBackHome}>
                ← Home
              </button>
            )}
            <BrandLogo size={80} onClick={onBackHome} className="st-brand" />
          </div>

          <div className="st-nav-meta hidden sm:flex">
            <span className="st-pill st-pill-green">PSR-SX & Genos</span>
            <span className="st-pill">Live Audio · MIDI · Export</span>
          </div>

          <div className="st-nav-actions">
            <button
              type="button"
              className="st-btn st-btn-solid"
              onClick={() => document.getElementById("st-daw")?.scrollIntoView({ behavior: "smooth" })}
            >
              Live Preview
            </button>
          </div>
        </div>
      </header>

      <main className="st-main">
        <section className="st-banner">
          <div>
            <p className="st-banner-kicker">Professional style editor</p>
            <h1 className="st-banner-title">Create, preview & export arranger styles</h1>
            <p className="st-banner-sub">
              Load Live Audio Styles, route MIDI channels, edit the piano roll, then compile a keyboard-ready .sty — all in the browser.
            </p>
          </div>
          <div className="st-steps">
            <span className={`st-step ${stepAus ? "done" : "active"}`}>
              <span className="st-step-num">{stepAus ? "✓" : "1"}</span> Load AUS
            </span>
            <span className={`st-step ${stepMidi ? "done" : stepAus ? "active" : ""}`}>
              <span className="st-step-num">{stepMidi ? "✓" : "2"}</span> MIDI
            </span>
            <span className={`st-step ${stepReady ? "done" : stepMidi ? "active" : ""}`}>
              <span className="st-step-num">{stepReady ? "✓" : "3"}</span> Studio
            </span>
            <span className={`st-step ${stepDone ? "done" : stepReady ? "active" : ""}`}>
              <span className="st-step-num">{stepDone ? "✓" : "4"}</span> Export
            </span>
          </div>
        </section>

        <section className="st-grid-2">
          <div className="st-card">
            <div className="st-card-h">
              <div>
                <h2 className="st-card-title">Live Audio Style · .aus</h2>
                <p className="st-card-desc">From Yamaha Audio Phraser</p>
              </div>
              {ausName
                ? <span className="st-pill st-pill-green">Loaded</span>
                : <span className="st-pill">Required</span>}
            </div>
            <div className="st-card-b">
              <DropZone
                label={ausName ?? "Drop .aus here or click to browse"}
                accept=".aus"
                hint="AASM / AWav audio body preserved for keyboard load"
                loaded={!!ausName}
                variant="cyan"
                onFiles={onAusDrop}
              />
            </div>
          </div>

          <div className="st-card">
            <div className="st-card-h">
              <div>
                <h2 className="st-card-title">MIDI parts · .mid</h2>
                <p className="st-card-desc">Bulk import or drop onto DAW lanes</p>
              </div>
              {midis.length > 0
                ? <span className="st-pill st-pill-violet">{midis.length} file{midis.length === 1 ? "" : "s"}</span>
                : <span className="st-pill">Optional bulk</span>}
            </div>
            <div className="st-card-b">
              <DropZone
                label="Drop .mid file(s) here"
                accept=".mid,.midi"
                multiple
                hint="Bass · Chord · Pad · Phrase → channels 11–16"
                loaded={midis.length > 0}
                variant="violet"
                onFiles={onMidiDrop}
              />
            </div>
          </div>
        </section>

        <section id="st-daw">
          <p className="st-section-label">Live Preview · Style Track Mixer</p>
          <LivePreview
            engine={engineRef.current}
            audio={ausParsed?.audio ?? null}
            decodedPcm={decodedPcm}
            ausMeta={ausParsed?.meta ?? null}
            rolePickers={rolePickers}
            loopLengthTicks={loopLenTicks}
            loopBars={loopBars}
            ausLengthTicks={ausLengthTicks}
            snapTicks={snapTicks}
            keySnap={keySnap}
            onKeySnapChange={setKeySnap}
            onDropMidi={onLiveDropRole}
            onClearRole={clearRole}
            onToggleMute={toggleMute}
            onToggleSolo={toggleSolo}
            onPcmMute={togglePcmMute}
            onPcmSolo={togglePcmSolo}
            pcmMute={pcmMute}
            pcmSolo={pcmSolo}
            ensureEngine={ensureEngine}
            onRoleEventsChange={onRoleEventsChange}
            onShiftRoleTiming={onShiftRoleTiming}
            onDuplicateToAus={onDuplicateToAus}
            onSnapRoleToKey={onSnapRoleToKey}
            onSnapAllToKey={onSnapAllToKey}
            onSoundChange={onSoundChange}
            projectName={meta.name}
          />
        </section>

        <section className="st-grid-settings" id="st-export">
          <div>
            <p className="st-section-label">Project settings</p>
            <StyleMetadataForm value={meta} onChange={setMeta} />
          </div>
          <div>
            <p className="st-section-label">Compile & download</p>
            <ExportPanel
              ready={canCompile}
              disabled={!canCompile}
              result={result}
              onCompile={compile}
              onDownload={download}
              error={error}
            />
          </div>
        </section>

        <details className="st-card st-adv">
          <summary className="st-card-h">
            <div>
              <h2 className="st-card-title">Advanced tools</h2>
              <p className="st-card-desc">Channel routing matrix · AUS chunk inspector</p>
            </div>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="st-card-b space-y-8">
            <ChannelMatrix
              midis={midis}
              assignments={assignments}
              onChange={(i, r) => setAssignments(a => ({ ...a, [i]: r }))}
              onRemove={removeMidi}
              onTrackChange={(i, ti) => setMidis(list => list.map((m, idx) => idx === i ? { ...m, trackIndex: ti } : m))}
            />
            <div style={{ borderTop: "1px solid var(--st-line)", paddingTop: "1.5rem" }}>
              <AusInspector fileName={ausName} parsed={ausParsed} />
            </div>
          </div>
        </details>

        <footer className="st-footer">
          <div>Private by design · files never leave this device</div>
          <div className="hex">SFF2 · SInt · CASM · AASM · AWav</div>
        </footer>
      </main>
    </div>
  );
}
