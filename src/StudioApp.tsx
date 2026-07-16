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
import { parseSty, suggestRoleForTrack } from "./lib/binary/styReader";
import { StyleSection } from "./lib/binary/sff2Writer";
import { PlaybackEngine } from "./lib/audio/PlaybackEngine";
import {
  applySwing,
  duplicateEventsByAusLength,
  humanizeEvents,
  quantizeEvents,
  shiftEventsByTicks,
  snapEventsToKey
} from "./lib/midi/noteEdit";
import {
  DEFAULT_PIANO_SOUND_ID,
  findSound,
  ROLE_DEFAULT_SOUND_ID
} from "./lib/audio/gmPrograms";
import {
  autosaveProject,
  b64ToBytes,
  bytesToB64,
  downloadProjectFile,
  loadAutosave,
  ProjectSnapshot,
  readProjectFile
} from "./lib/project/projectStore";
import { BrandLogo } from "./components/BrandLogo";
import { useInView } from "./hooks/useInView";
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
  const [roleVolumes, setRoleVolumes] = useState<Partial<Record<StyleRole, number>>>({});
  const [rolePans, setRolePans] = useState<Partial<Record<StyleRole, number>>>({});
  const [roleSections, setRoleSections] = useState<Partial<Record<StyleRole, StyleSection>>>({});
  const [activeSection, setActiveSection] = useState<string>("Main A");
  const [requireAusCasm, setRequireAusCasm] = useState(false);
  const [exportWarnings, setExportWarnings] = useState<string[]>([]);
  const undoStack = useRef<{ midis: LoadedMidi[]; assignments: Record<number, StyleRole | "unassigned"> }[]>([]);
  const ausBytesRef = useRef<Uint8Array | null>(null);

  const engineRef = useRef<PlaybackEngine | null>(null);
  const [engineTick, setEngineTick] = useState(0);

  const pushUndo = useCallback(() => {
    undoStack.current = [
      ...undoStack.current.slice(-29),
      {
        midis: midis.map(m => ({
          ...m,
          bytes: m.bytes,
          parsed: {
            ...m.parsed,
            tracks: m.parsed.tracks.map(t => ({ ...t, events: t.events.slice() }))
          }
        })),
        assignments: { ...assignments }
      }
    ];
  }, [midis, assignments]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setMidis(prev.midis);
    setAssignments(prev.assignments);
  }, []);

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

  const applyAusBytes = useCallback((bytes: Uint8Array, name: string) => {
    const parsed = parseAus(bytes);
    ausBytesRef.current = bytes;
    setAusName(name);
    setAusParsed(parsed);
    setMeta(m => ({
      ...m,
      bpm: parsed.meta.bpm,
      timeSigNum: parsed.meta.timeSigNum,
      timeSigDen: parsed.meta.timeSigDen
    }));
    engineRef.current?.setBpm(parsed.meta.bpm);
    const hasAudio =
      parsed.audioChunks.some(c =>
        c.id === "AASM" || c.id === "AWav" || c.id === "AUDI" || c.id === "Adat"
      ) || !!parsed.audio;
    if (!hasAudio) {
      setError(
        "AUS loaded but no AASM/AWav/AUDI/Adat audio body was found. " +
        "Keyboard export will fail with “Data not loaded properly”. Re-export from Audio Phraser."
      );
    }
    return parsed;
  }, []);

  const onAusDrop = async (files: File[]) => {
    const file =
      files.find(f => f.name.toLowerCase().endsWith(".aus")) ??
      files.find(f => f.name.toLowerCase().endsWith(".sty")) ??
      files[0];
    if (!file) return;
    setError(null);
    setResult(null);
    setDecodedPcm(null);
    try {
      const bytes = await fileToBytes(file);
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".sty")) {
        await openStyBytes(bytes, file.name);
        return;
      }
      applyAusBytes(bytes, file.name);
    } catch (e) {
      setError(`Failed to parse file: ${(e as Error).message}`);
    }
  };

  const openStyBytes = async (bytes: Uint8Array, name: string) => {
    const opened = parseSty(bytes);
    ausBytesRef.current = bytes;
    setAusName(name);
    setAusParsed(opened.aus);
    setMeta(m => ({
      ...m,
      name: opened.name || m.name,
      bpm: opened.bpm,
      timeSigNum: opened.timeSigNum,
      timeSigDen: opened.timeSigDen,
      sections: opened.sections.length ? opened.sections : m.sections
    }));
    engineRef.current?.setBpm(opened.bpm);

    // Import non-conductor tracks as MIDI sources
    const styleTracks = opened.midi.tracks.slice(1).filter(t =>
      t.events.some(e => e.kind === "note-on" && e.velocity > 0)
    );
    const loaded: LoadedMidi[] = styleTracks.slice(0, 6).map((t, i) => {
      const smf = {
        format: 1 as const,
        ticksPerQuarter: opened.midi.ticksPerQuarter,
        tracks: [t],
        tempoBpm: opened.bpm,
        timeSigNumerator: opened.timeSigNum,
        timeSigDenominator: opened.timeSigDen,
        lengthTicks: t.events[t.events.length - 1]?.tick ?? 0
      };
      return {
        name: t.name || `Track ${i + 1}`,
        bytes: new Uint8Array(0),
        parsed: smf,
        trackIndex: 0
      };
    });
    setMidis(loaded);
    const nextAssign: Record<number, StyleRole | "unassigned"> = {};
    const taken = new Set<StyleRole>();
    loaded.forEach((m, i) => {
      const suggested = suggestRoleForTrack(i + 1, m.parsed.tracks[0]?.channelsUsed ?? []) as StyleRole;
      const role = (!taken.has(suggested) ? suggested : STYLE_CHANNELS.map(s => s.role).find(r => !taken.has(r))) as StyleRole | undefined;
      if (role) {
        nextAssign[i] = role;
        taken.add(role);
      } else nextAssign[i] = "unassigned";
    });
    setAssignments(nextAssign);
    setExportWarnings(opened.log);
    if (!opened.hasAudio) {
      setError("Opened .sty has no AASM/AWav audio body — re-export may fail on keyboard.");
    } else {
      setError(null);
    }
  };

  /** Expand multi-track / multi-channel SMF into one LoadedMidi per noteful track. */
  const expandMidiFile = async (file: File): Promise<LoadedMidi[]> => {
    if (!file.name.toLowerCase().endsWith(".mid") && !file.name.toLowerCase().endsWith(".midi")) return [];
    const bytes = await fileToBytes(file);
    const parsed = parseMidi(bytes);
    const noteful = parsed.tracks
      .map((t, ti) => ({ t, ti }))
      .filter(({ t }) => t.events.some(e => e.kind === "note-on" && e.velocity > 0));
    if (!noteful.length) {
      return [{
        name: file.name,
        bytes,
        parsed,
        trackIndex: 0
      }];
    }
    // Multi-track SMF → one source per track (up to 6 total later)
    if (noteful.length > 1) {
      return noteful.map(({ t, ti }) => ({
        name: `${file.name.replace(/\.(mid|midi)$/i, "")} · ${t.name || `Tr ${ti + 1}`}`,
        bytes,
        parsed: {
          ...parsed,
          tracks: parsed.tracks,
          lengthTicks: Math.max(parsed.lengthTicks, t.events[t.events.length - 1]?.tick ?? 0)
        },
        trackIndex: ti
      })).slice(0, 6);
    }
    return [{
      name: file.name,
      bytes,
      parsed,
      trackIndex: noteful[0].ti
    }];
  };

  const parseMidiFile = async (file: File): Promise<LoadedMidi | null> => {
    const list = await expandMidiFile(file);
    return list[0] ?? null;
  };

  const onMidiDrop = async (files: File[]) => {
    setError(null);
    const additions: LoadedMidi[] = [];
    for (const file of files) {
      try {
        const parts = await expandMidiFile(file);
        additions.push(...parts);
      } catch (e) {
        setError(`Failed to parse ${file.name}: ${(e as Error).message}`);
      }
    }
    if (!additions.length) return;

    const first = additions[0].parsed;
    setMeta(m => ({
      ...m,
      bpm: m.bpm === 120 ? first.tempoBpm : m.bpm,
      timeSigNum: m.timeSigNum === 4 ? first.timeSigNumerator : m.timeSigNum,
      timeSigDen: m.timeSigDen === 4 ? first.timeSigDenominator : m.timeSigDen
    }));

    setMidis(prev => {
      const combined = [...prev, ...additions].slice(0, 6);
      setAssignments(a => {
        const next = { ...a };
        const taken = new Set(Object.values(next).filter(v => v !== "unassigned")) as Set<StyleRole>;
        combined.forEach((m, i) => {
          if (next[i] && next[i] !== "unassigned") {
            taken.add(next[i] as StyleRole);
            return;
          }
          const ch = m.parsed.tracks[m.trackIndex]?.channelsUsed?.[0];
          const suggested = suggestRoleForTrack(i + 1, ch != null ? [ch] : []) as StyleRole;
          const role = (!taken.has(suggested)
            ? suggested
            : STYLE_CHANNELS.map(s => s.role).find(r => !taken.has(r as StyleRole))) as StyleRole | undefined;
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
      const vol = roleVolumes[role as StyleRole];
      const pan = rolePans[role as StyleRole];
      out.push({
        sourceName: m.name,
        track,
        targetChannel: sc.ch,
        role: role as AssignedTrack["role"],
        program: sound.program,
        bankMsb: sound.msb,
        bankLsb: sound.lsb,
        soundName: `${sound.name} (${sound.bank})`,
        volume: vol != null ? Math.round(vol * 127) : undefined,
        pan: pan != null ? Math.round(pan * 127) : undefined,
        section: roleSections[role as StyleRole]
      });
    }
    return out;
  }, [midis, assignments, roleSounds, roleVolumes, rolePans, roleSections]);

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
    pushUndo();
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
  }, [assignments, pushUndo]);

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
    setResult(null);
    setExportWarnings([]);
    if (!ausParsed) { setError("Please upload an .aus or .sty file first."); return; }
    if (assignedTracks.length === 0) { setError("Assign at least one MIDI track to a style channel."); return; }

    const hasAudioChunk =
      ausParsed.audioChunks.some(c => c.id === "AASM" || c.id === "AWav" || c.id === "AUDI" || c.id === "Adat") ||
      !!ausParsed.audio;
    if (!hasAudioChunk) {
      setError(
        "AUS has no AASM/AWav/AUDI/Adat audio body — keyboard would show “Data not loaded properly”. " +
        "Re-export the .aus from Audio Phraser and try again."
      );
      return;
    }

    try {
      const tpq = midis[0]?.parsed.ticksPerQuarter ?? 480;
      const bars = Math.max(1, ausParsed.meta.bars || 4);
      // Ensure active section is included in export set
      const sections = meta.sections.length ? [...meta.sections] : (["Main A"] as StyleSection[]);
      if (activeSection && !sections.includes(activeSection as StyleSection)) {
        // map Fill In UI label
        const mapped = activeSection === "Fill In" ? "Fill In AA" : activeSection;
        if (!sections.includes(mapped as StyleSection)) {
          /* keep meta.sections as user chose */
        }
      }
      const built = buildStyle({
        name: meta.name || "AudioStyle",
        category: meta.category,
        bpm: meta.bpm,
        timeSigNum: meta.timeSigNum,
        timeSigDen: meta.timeSigDen,
        sections,
        ticksPerQuarter: tpq,
        sectionBars: bars,
        sectionLengthTicks: loopLenTicks,
        aus: ausParsed,
        tracks: assignedTracks,
        preferAusCasm: true,
        requireAusCasm,
        includeMdb: true,
        includeOtsc: true,
        liftAusSetup: true
      });
      setResult(built);
      setExportWarnings(built.validation.warnings);
    } catch (e) {
      setError(`Compile failed: ${(e as Error).message}`);
    }
  };

  const buildSnapshot = useCallback((): ProjectSnapshot => ({
    version: 1,
    savedAt: new Date().toISOString(),
    ausName,
    ausB64: ausBytesRef.current ? bytesToB64(ausBytesRef.current) : null,
    midis: midis.map(m => ({
      name: m.name,
      b64: m.bytes.length ? bytesToB64(m.bytes) : "",
      trackIndex: m.trackIndex
    })),
    assignments,
    meta,
    keySnap,
    roleSounds,
    roleVolumes,
    rolePans,
    roleSections,
    activeSection,
    requireAusCasm
  }), [ausName, midis, assignments, meta, keySnap, roleSounds, roleVolumes, rolePans, roleSections, activeSection, requireAusCasm]);

  const restoreSnapshot = useCallback(async (snap: ProjectSnapshot) => {
    setMeta(snap.meta);
    setKeySnap(snap.keySnap);
    setRoleSounds(snap.roleSounds ?? {});
    setRoleVolumes(snap.roleVolumes ?? {});
    setRolePans(snap.rolePans ?? {});
    setRoleSections(snap.roleSections ?? {});
    setActiveSection(snap.activeSection || "Main A");
    setRequireAusCasm(!!snap.requireAusCasm);
    setAssignments(snap.assignments ?? {});
    if (snap.ausB64) {
      const bytes = b64ToBytes(snap.ausB64);
      applyAusBytes(bytes, snap.ausName || "project.aus");
    }
    const loaded: LoadedMidi[] = [];
    for (const m of snap.midis ?? []) {
      if (!m.b64) continue;
      try {
        const bytes = b64ToBytes(m.b64);
        const parsed = parseMidi(bytes);
        loaded.push({
          name: m.name,
          bytes,
          parsed,
          trackIndex: m.trackIndex ?? 0
        });
      } catch { /* skip broken midis */ }
    }
    setMidis(loaded);
    setError(null);
    setResult(null);
  }, [applyAusBytes]);

  // Autosave every 15s when project has content
  useEffect(() => {
    if (!ausParsed && midis.length === 0) return;
    const t = window.setTimeout(() => {
      void autosaveProject(buildSnapshot());
    }, 1500);
    return () => clearTimeout(t);
  }, [ausParsed, midis, assignments, meta, buildSnapshot]);

  // Offer restore on mount
  useEffect(() => {
    void (async () => {
      const snap = await loadAutosave();
      if (snap?.ausB64 || (snap?.midis?.length ?? 0) > 0) {
        // silent restore only if empty workspace
        if (!ausParsed && midis.length === 0) {
          try { await restoreSnapshot(snap!); } catch { /* ignore */ }
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync meta BPM → engine
  useEffect(() => {
    engineRef.current?.setBpm(meta.bpm);
  }, [meta.bpm]);

  // Global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        downloadProjectFile(buildSnapshot(), meta.name);
      }
      if (e.code === "Space") {
        e.preventDefault();
        const eng = engineRef.current;
        if (!eng) return;
        if (eng.state.playing) eng.stop();
        else void eng.play();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, buildSnapshot, meta.name]);

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

  const onVolumeChange = useCallback((role: StyleRole, vol01: number) => {
    setRoleVolumes(v => ({ ...v, [role]: vol01 }));
    engineRef.current?.setChannelUserGain(roleToEngineChannel(role), vol01);
  }, []);

  const onPanChange = useCallback((role: StyleRole, pan01: number) => {
    setRolePans(p => ({ ...p, [role]: pan01 }));
  }, []);

  const onSeekRatio = useCallback((ratio: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.seekTicks(Math.round(ratio * loopLenTicks));
  }, [loopLenTicks]);

  const onSectionSelect = useCallback((section: string) => {
    setActiveSection(section);
    // Toggle section into meta.sections for export
    const mapped = (section === "Fill In" ? "Fill In AA" : section) as StyleSection;
    setMeta(m => {
      if (m.sections.includes(mapped)) return m;
      return { ...m, sections: [...m.sections, mapped] };
    });
  }, []);

  const onRoleSectionChange = useCallback((role: StyleRole, section: StyleSection) => {
    setRoleSections(s => ({ ...s, [role]: section }));
  }, []);

  const onQuantizeRole = useCallback((role: StyleRole) => {
    const m = roleMidiMap[role];
    if (!m) return;
    const track = m.parsed.tracks[m.trackIndex];
    if (!track) return;
    pushUndo();
    onRoleEventsChange(role, quantizeEvents(track.events, snapTicks, 1));
  }, [roleMidiMap, snapTicks, onRoleEventsChange, pushUndo]);

  const onSwingRole = useCallback((role: StyleRole) => {
    const m = roleMidiMap[role];
    if (!m) return;
    const track = m.parsed.tracks[m.trackIndex];
    if (!track) return;
    pushUndo();
    onRoleEventsChange(role, applySwing(track.events, snapTicks, 0.3));
  }, [roleMidiMap, snapTicks, onRoleEventsChange, pushUndo]);

  const onHumanizeRole = useCallback((role: StyleRole) => {
    const m = roleMidiMap[role];
    if (!m) return;
    const track = m.parsed.tracks[m.trackIndex];
    if (!track) return;
    pushUndo();
    onRoleEventsChange(role, humanizeEvents(track.events, Math.max(2, snapTicks / 4), 6));
  }, [roleMidiMap, snapTicks, onRoleEventsChange, pushUndo]);

  const onBpmFromTransport = useCallback((bpm: number) => {
    setMeta(m => ({ ...m, bpm }));
    engineRef.current?.setBpm(bpm);
  }, []);

  const rolePickers = STYLE_CHANNELS.map(sc => ({
    role: sc.role,
    midi: roleMidiMap[sc.role] ?? null,
    color: ROLE_COLORS[sc.role],
    engineChannel: sc.ch - 1,
    mute: !!muteRoles[sc.role],
    solo: !!soloRoles[sc.role],
    soundId: roleSounds[sc.role] ?? ROLE_DEFAULT_SOUND_ID[sc.role] ?? DEFAULT_PIANO_SOUND_ID,
    volume: roleVolumes[sc.role] ?? 1,
    pan: rolePans[sc.role] ?? 0.5,
    section: roleSections[sc.role] ?? (activeSection as StyleSection) ?? "Main A"
  }));

  const stepAus = !!ausParsed;
  const stepMidi = assignedTracks.length > 0;
  const stepReady = canCompile;
  const stepDone = !!result;
  const footerReveal = useInView<HTMLElement>();

  return (
    <div className="st-root">
      <header className="st-nav anim-nav">
        <div className="st-nav-inner">
          <div className="flex items-center gap-3 min-w-0 anim-nav-item">
            {onBackHome && (
              <button type="button" className="st-btn st-btn-ghost" onClick={onBackHome}>
                ← Home
              </button>
            )}
            <BrandLogo size={80} onClick={onBackHome} className="st-brand" />
          </div>

          <div className="st-nav-meta hidden sm:flex anim-nav-item">
            <span className="st-pill st-pill-green">PSR-SX & Genos</span>
            <span className="st-pill">Live Audio · MIDI · Export</span>
          </div>

          <div className="st-nav-actions anim-nav-item">
            <button
              type="button"
              className="st-btn st-btn-ghost"
              title="Undo (Ctrl+Z)"
              onClick={undo}
            >
              Undo
            </button>
            <button
              type="button"
              className="st-btn st-btn-ghost"
              title="Save project (Ctrl+S)"
              onClick={() => downloadProjectFile(buildSnapshot(), meta.name)}
            >
              Save
            </button>
            <label className="st-btn st-btn-ghost" style={{ cursor: "pointer" }}>
              Load
              <input
                type="file"
                accept=".yssproj,application/json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  try {
                    const snap = await readProjectFile(f);
                    await restoreSnapshot(snap);
                  } catch (err) {
                    setError(`Project load failed: ${(err as Error).message}`);
                  }
                }}
              />
            </label>
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
            <p className="st-banner-kicker anim-page-kicker">Professional style editor</p>
            <h1 className="st-banner-title anim-page-title">Create, preview & export arranger styles</h1>
            <p className="st-banner-sub anim-page-lead">
              Load Live Audio Styles, route MIDI channels, edit the piano roll, then compile a keyboard-ready .sty — all in the browser.
            </p>
          </div>
          <div className="st-steps anim-fade-up anim-fade-up-d3">
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
                label={ausName ?? "Drop .aus or .sty here"}
                accept=".aus,.sty"
                hint="AASM / AWav preserved · open .sty to re-edit"
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
            timeSigNum={meta.timeSigNum}
            timeSigDen={meta.timeSigDen}
            projectBpm={meta.bpm}
            onBpmChange={onBpmFromTransport}
            activeSection={activeSection}
            onSectionSelect={onSectionSelect}
            onSeekRatio={onSeekRatio}
            onVolumeChange={onVolumeChange}
            onPanChange={onPanChange}
            onRoleSectionChange={onRoleSectionChange}
            onQuantizeRole={onQuantizeRole}
            onSwingRole={onSwingRole}
            onHumanizeRole={onHumanizeRole}
            enabledSections={meta.sections}
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
              warnings={exportWarnings}
              requireAusCasm={requireAusCasm}
              onRequireAusCasmChange={setRequireAusCasm}
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

        <footer
          ref={footerReveal.ref}
          className={`st-footer anim-footer ${footerReveal.inView ? "is-in" : ""}`}
        >
          <div className="anim-footer-col">Private by design · files never leave this device</div>
          <div className="hex anim-footer-col">SFF2 · SInt · CASM · AASM · AWav</div>
        </footer>
      </main>
    </div>
  );
}
