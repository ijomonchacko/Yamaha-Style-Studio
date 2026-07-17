import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropZone } from "./components/DropZone";
import {
  LoadedMidi,
  STYLE_CHANNELS,
  StyleRole,
  styleRoleToCasmRole
} from "./components/ChannelMatrix";
import { StyleMetadataForm, StyleMetaState } from "./components/StyleMetadataForm";
import { ExportPanel } from "./components/ExportPanel";
import { KeySnapState, LivePreview, ROLE_COLORS, roleToEngineChannel } from "./components/LivePreview";
import { AusParseResult, parseAus } from "./lib/binary/ausParser";
import { buildSmf1, MidiEvent, parseMidi, remapTrackChannel } from "./lib/binary/midiParser";
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
  clearAutosave,
  downloadProjectFile,
  hasAnyAutosave,
  loadAutosave,
  ProjectSnapshot
} from "./lib/project/projectStore";
import { extractCasmFromAus, extractAudioBody } from "./lib/binary/sff2Writer";
import { useInView } from "./hooks/useInView";
import "./studio.css";

export type StudioMode = "aus" | "sty";

interface StudioAppProps {
  onBackHome?: () => void;
  onOpenDocs?: () => void;
}

/**
 * Studio application shell. Owns:
 *   - The parsed .aus + list of loaded MIDI files.
 *   - Role assignments, style metadata, PlaybackEngine, compile result.
 * All parsing runs client-side.
 */
export function StudioApp({ onBackHome, onOpenDocs }: StudioAppProps) {
  /** null = mode picker; never auto-restore previous project into wrong mode */
  const [studioMode, setStudioMode] = useState<StudioMode | null>(null);
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
  /** Fail-closed: only export with real CASM from source file */
  const [requireAusCasm, setRequireAusCasm] = useState(true);
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

  /** Stop transport + clear PCM/MIDI so previous file never keeps playing. */
  const resetEngineAndSession = useCallback(() => {
    engineRef.current?.resetForNewFile();
    setDecodedPcm(null);
    setResult(null);
    setExportWarnings([]);
    setMuteRoles({});
    setSoloRoles({});
  }, []);

  const applyAusBytes = useCallback((bytes: Uint8Array, name: string) => {
    resetEngineAndSession();
    setMidis([]);
    setAssignments({});
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
        c.id === "AASM" || c.id === "AFil" || c.id === "AWav" || c.id === "AUDI" || c.id === "Adat"
      ) || !!parsed.audio;
    if (!hasAudio) {
      setError(
        "AUS loaded but no AASM/AFil/AWav/AUDI/Adat audio body was found. " +
        "Keyboard export will fail with “Data not loaded properly”. Re-export from Audio Phraser."
      );
    } else {
      setError(null);
    }
    return parsed;
  }, [resetEngineAndSession]);

  const onAusDrop = async (files: File[]) => {
    const file =
      files.find(f => f.name.toLowerCase().endsWith(".aus")) ??
      files.find(f => f.name.toLowerCase().endsWith(".sty")) ??
      files[0];
    if (!file) return;
    setError(null);
    try {
      const bytes = await fileToBytes(file);
      const lower = file.name.toLowerCase();
      if (studioMode === "aus" && lower.endsWith(".sty")) {
        setError("AUS Editor only accepts .aus (Live Audio Style). Switch to STY Editor for .sty files.");
        return;
      }
      if (studioMode === "sty" && lower.endsWith(".aus")) {
        setError("STY Editor only accepts .sty. Switch to AUS Editor for Live Audio .aus files.");
        return;
      }
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
    resetEngineAndSession();
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

    // Channel-split parts (SMF-0 multi-timbral or SMF-1 tracks). Do NOT skip track 0 —
    // Yamaha format-0 styles put ALL channels on a single MTrk.
    const styleTracks = opened.midi.tracks
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => t.events.some(e => e.kind === "note-on" && e.velocity > 0));

    // Prefer style channels 8–15; cap at 8 lanes for the UI
    const prioritized = [...styleTracks].sort((a, b) => {
      const ca = a.t.channelsUsed[0] ?? 99;
      const cb = b.t.channelsUsed[0] ?? 99;
      const score = (c: number) => (c >= 8 && c <= 15 ? c : 100 + c);
      return score(ca) - score(cb);
    });

    const loaded: LoadedMidi[] = prioritized.slice(0, 8).map(({ t, idx }) => {
      const lengthTicks = Math.max(
        opened.midi.lengthTicks,
        t.events.reduce((mx, e) => (e.tick > mx ? e.tick : mx), 0)
      );
      const ch = t.channelsUsed[0] ?? 0;
      const smf = {
        format: 1 as const,
        ticksPerQuarter: opened.midi.ticksPerQuarter,
        tracks: [{ ...t, index: 0, channelsUsed: [ch] }],
        tempoBpm: opened.bpm,
        timeSigNumerator: opened.timeSigNum,
        timeSigDenominator: opened.timeSigDen,
        lengthTicks
      };
      // Rebuild minimal SMF bytes so project save/restore keeps the track
      const payload = remapTrackChannel(t, ch);
      const smfBytes = buildSmf1([payload], opened.midi.ticksPerQuarter);
      return {
        name: t.name || `Track ${idx + 1}`,
        bytes: smfBytes,
        parsed: smf,
        trackIndex: 0
      };
    });
    setMidis(loaded);
    const nextAssign: Record<number, StyleRole | "unassigned"> = {};
    const taken = new Set<StyleRole>();
    loaded.forEach((m, i) => {
      const chs = m.parsed.tracks[0]?.channelsUsed ?? [];
      const suggested = suggestRoleForTrack(i + 1, chs) as StyleRole;
      const valid = STYLE_CHANNELS.some(s => s.role === suggested) ? suggested : undefined;
      const role = (
        valid && !taken.has(valid)
          ? valid
          : STYLE_CHANNELS.map(s => s.role).find(r => !taken.has(r))
      ) as StyleRole | undefined;
      if (role) {
        nextAssign[i] = role;
        taken.add(role);
      } else nextAssign[i] = "unassigned";
    });
    setAssignments(nextAssign);
    setExportWarnings([
      ...opened.log,
      loaded.length
        ? `Imported ${loaded.length} MIDI track(s) into timeline (Rhythm 1/2 + style parts).`
        : "No note-on MIDI tracks found in .sty (audio-only or empty SMF)."
    ]);
    // MIDI-only STY is normal — no error, no empty Live Audio lane
    if (!opened.hasAudio && !loaded.length) {
      setError("Opened .sty has no MIDI notes and no Live Audio body — nothing to preview.");
    } else {
      setError(null);
    }
    // Ensure no leftover PCM from a previous AUS session
    if (!opened.hasAudio) {
      setDecodedPcm(null);
      engineRef.current?.clearPcm();
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
        role: styleRoleToCasmRole(role as StyleRole) as AssignedTrack["role"],
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
    // Prefer AUS bar count for Live Audio loops; for opened .sty MIDI, use full SMF span
    // so section markers / long arrangements are not clipped to a tiny AUS meta.bars.
    const ausBars = ausParsed?.meta.bars ?? 0;
    let maxTick = 0;
    for (const at of assignedTracks) {
      for (const e of at.track.events) {
        if (e.tick > maxTick) maxTick = e.tick;
      }
    }
    for (const m of midis) {
      if (m.parsed.lengthTicks > maxTick) maxTick = m.parsed.lengthTicks;
    }
    if (maxTick <= 0 && ausBars > 0) maxTick = ausBars * bar;
    // At least one bar; snap up to whole bars
    return Math.max(bar, Math.ceil(Math.max(maxTick, bar) / bar) * bar);
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
    if (!eng) return;
    if (!ausParsed?.audio) {
      eng.clearPcm();
      setDecodedPcm(null);
      return;
    }
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
          eng.clearPcm();
          if (!cancelled) {
            setDecodedPcm(null);
          }
          return;
        }
        eng.setBpm(meta.bpm);
      } catch (e) {
        eng.clearPcm();
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
      // Map CASM role / channel back to UI StyleRole for mute/solo state
      const uiRole = STYLE_CHANNELS.find(s => s.ch === at.targetChannel)?.role;
      if (uiRole) {
        eng.setChannelMute(ch, !!muteRoles[uiRole]);
        eng.setChannelSolo(ch, !!soloRoles[uiRole]);
      }
      if (at.program != null && ch !== 8 && ch !== 9) {
        eng.setStyleProgram(ch, at.program);
      }
    }
  }, [assignedTracks, midis, engineTick, loopLenTicks, muteRoles, soloRoles]);

  // ---- Compile action -------------------------------------------------

  // Blank AUS (CASM+AASM, no MIDI) converts to STY; MIDI-only STY can re-export with tail
  const hasAusAudioBody =
    !!ausParsed &&
    (ausParsed.audioChunks.some(c =>
      c.id === "AASM" || c.id === "AFil" || c.id === "AWav" || c.id === "AUDI" || c.id === "Adat"
    ) || !!ausParsed.audio || !!(ausBytesRef.current && extractAudioBody(ausBytesRef.current)));
  const canCompile =
    !!ausParsed &&
    (assignedTracks.length > 0 || hasAusAudioBody || studioMode === "sty");
  const compile = () => {
    setError(null);
    setResult(null);
    setExportWarnings([]);
    if (!ausParsed) { setError("Please upload an .aus or .sty file first."); return; }

    const blankAus = studioMode === "aus" && assignedTracks.length === 0;
    if (assignedTracks.length === 0 && !hasAusAudioBody && studioMode !== "sty") {
      setError("Assign at least one MIDI track to a style channel, or load Live Audio.");
      return;
    }

    if (studioMode === "aus" && !hasAusAudioBody) {
      setError(
        "AUS has no AASM/AFil/AWav audio body — keyboard would show “Data not loaded properly”. " +
        "Re-export the .aus from Audio Phraser and try again."
      );
      return;
    }

    try {
      const tpq = midis[0]?.parsed.ticksPerQuarter ?? 480;
      const bars = Math.max(1, ausParsed.meta.bars || 4);
      const sections = meta.sections.length ? [...meta.sections] : (["Main A"] as StyleSection[]);
      // STY re-edit only: keep original CASM/audio tail. AUS path is always forum-safe (no demo MIDI).
      const preserveTail =
        studioMode === "sty" && ausBytesRef.current && ausBytesRef.current.length > 64
          ? ausBytesRef.current
          : undefined;

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
        // Timeline MIDI only when user assigned lanes — never demo ContempRock parts
        tracks: assignedTracks,
        preferAusCasm: true,
        requireAusCasm: requireAusCasm !== false,
        includeMdb: false,
        includeOtsc: false,
        liftAusSetup: true,
        preservePostSmfFrom: preserveTail,
        blankAusConvert: blankAus,
        // Forum-safe: AUS CASM + AASM/AFil only; timeline MIDI if present
        forumSafe: studioMode === "aus"
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

  // Mode-isolated autosave (AUS vs STY never overwrite each other)
  useEffect(() => {
    if (!studioMode) return;
    if (!ausParsed && midis.length === 0) return;
    const t = window.setTimeout(() => {
      void autosaveProject(buildSnapshot(), studioMode);
    }, 1500);
    return () => clearTimeout(t);
  }, [studioMode, ausParsed, midis, assignments, meta, buildSnapshot]);

  // Do NOT auto-restore — user picks mode first.
  const [hasAutosave, setHasAutosave] = useState(false);
  useEffect(() => {
    void (async () => {
      setHasAutosave(await hasAnyAutosave());
    })();
  }, []);

  const enterMode = useCallback(async (mode: StudioMode, restore = false) => {
    engineRef.current?.resetForNewFile();
    setDecodedPcm(null);
    setResult(null);
    setError(null);
    setExportWarnings([]);
    setMuteRoles({});
    setSoloRoles({});
    if (!restore) {
      setAusName(null);
      setAusParsed(null);
      setMidis([]);
      setAssignments({});
      ausBytesRef.current = null;
      // Clear only the mode being opened — other mode cache stays
      await clearAutosave(mode);
    } else {
      const snap = await loadAutosave(mode);
      if (snap) {
        try {
          await restoreSnapshot(snap);
        } catch (e) {
          setError(`Could not restore session: ${(e as Error).message}`);
        }
      }
    }
    setStudioMode(mode);
    setHasAutosave(await hasAnyAutosave());
  }, [restoreSnapshot]);

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

  if (!studioMode) {
    return (
      <div className="st-root st-mode-gate-wrap">
        <header className="st-chrome st-chrome-gate">
          <div className="st-chrome-inner">
            <div className="st-chrome-left">
              <button
                type="button"
                className="st-chrome-brand"
                onClick={onBackHome}
                aria-label="Home"
              >
                <span className="st-chrome-yss">YSS</span>
              </button>
              <nav className="st-chrome-links" aria-label="Studio">
                <button type="button" className="st-chrome-link" onClick={onBackHome}>
                  Home
                </button>
                {onOpenDocs && (
                  <button type="button" className="st-chrome-link" onClick={onOpenDocs}>
                    Docs
                  </button>
                )}
              </nav>
            </div>
          </div>
        </header>
        <div className="st-mode-gate">
          <div className="st-mode-badge">Yamaha Style Studio</div>
          <h1 className="st-mode-title">What do you want to open?</h1>
          <p className="st-mode-lead">
            Pick one workspace. Sessions stay separate — nothing is auto-loaded from a previous project.
          </p>
          <div className="st-mode-cards">
            <button type="button" className="st-mode-card st-mode-card-aus" onClick={() => void enterMode("aus")}>
              <span className="st-mode-card-icon">♪</span>
              <strong>AUS Editor</strong>
              <span className="st-mode-card-file">.aus</span>
              <span>Live Audio from Audio Phraser + MIDI → keyboard .sty</span>
              <span className="st-mode-card-cta">Open AUS Editor →</span>
            </button>
            <button type="button" className="st-mode-card st-mode-card-sty" onClick={() => void enterMode("sty")}>
              <span className="st-mode-card-icon">≡</span>
              <strong>STY Editor</strong>
              <span className="st-mode-card-file">.sty</span>
              <span>Open full styles · Rhythm 1/2 · re-edit &amp; re-export</span>
              <span className="st-mode-card-cta">Open STY Editor →</span>
            </button>
          </div>
          {hasAutosave && (
            <div className="st-mode-restore">
              <div className="st-mode-restore-text">
                <strong>Saved session found</strong>
                <span>Restore only if you want the previous project back.</span>
              </div>
              <div className="st-mode-restore-actions">
                <button type="button" className="st-btn st-btn-solid" onClick={() => void enterMode("aus", true)}>
                  Restore · AUS
                </button>
                <button type="button" className="st-btn st-btn-solid" onClick={() => void enterMode("sty", true)}>
                  Restore · STY
                </button>
                <button
                  type="button"
                  className="st-btn st-btn-ghost"
                  onClick={() => {
                    void clearAutosave();
                    setHasAutosave(false);
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const isStyMode = studioMode === "sty";
  const hasLiveAudio = !!decodedPcm;

  return (
    <div className="st-root">
      {/* Single full-width fixed chrome — not a floating pill */}
      <header className="st-chrome">
        <div className="st-chrome-inner">
          <div className="st-chrome-left">
            <button
              type="button"
              className="st-chrome-brand"
              onClick={onBackHome}
              aria-label="Yamaha Style Studio — Home"
              title="Home"
            >
              <span className="st-chrome-yss">YSS</span>
            </button>
            <nav className="st-chrome-links" aria-label="Studio">
              <button type="button" className="st-chrome-link" onClick={onBackHome}>
                Home
              </button>
              {onOpenDocs && (
                <button type="button" className="st-chrome-link" onClick={onOpenDocs}>
                  Docs
                </button>
              )}
            </nav>
          </div>

          <div className="st-chrome-mid">
            <span className="st-chrome-mode">
              {studioMode === "aus" ? "AUS Editor" : "STY Editor"}
            </span>
            <button
              type="button"
              className="st-mode-switch"
              onClick={() => setStudioMode(null)}
              title="Switch AUS / STY workspace"
            >
              Switch workspace
            </button>
          </div>

          <div className="st-chrome-actions">
            <button
              type="button"
              className="st-btn st-btn-solid"
              onClick={() => document.getElementById("st-export")?.scrollIntoView({ behavior: "smooth" })}
            >
              Export
            </button>
          </div>
        </div>
      </header>

      <main className="st-main">
        <section className="st-banner">
          <div>
            <p className="st-banner-kicker anim-page-kicker">
              {isStyMode ? "STY Editor" : "AUS Editor"}
            </p>
            <h1 className="st-banner-title anim-page-title">
              {isStyMode
                ? "Open, preview & re-export arranger styles"
                : "Build Live Audio styles for PSR-SX & Genos"}
            </h1>
            <p className="st-banner-sub anim-page-lead">
              {isStyMode
                ? "Drop a .sty file to load Rhythm 1/2 and style MIDI parts. No separate .aus is required unless the style has Live Audio."
                : "Load a Live Audio Style (.aus), route MIDI to channels 11–16, preview, then export a keyboard-ready .sty."}
            </p>
          </div>
          <div className="st-steps anim-fade-up anim-fade-up-d3">
            <span className={`st-step ${stepAus ? "done" : "active"}`}>
              <span className="st-step-num">{stepAus ? "✓" : "1"}</span>
              {isStyMode ? "Load STY" : "Load AUS"}
            </span>
            <span className={`st-step ${stepMidi ? "done" : stepAus ? "active" : ""}`}>
              <span className="st-step-num">{stepMidi ? "✓" : "2"}</span>
              {isStyMode ? "Parts" : "MIDI"}
            </span>
            <span className={`st-step ${stepReady ? "done" : stepMidi ? "active" : ""}`}>
              <span className="st-step-num">{stepReady ? "✓" : "3"}</span> Studio
            </span>
            <span className={`st-step ${stepDone ? "done" : stepReady ? "active" : ""}`}>
              <span className="st-step-num">{stepDone ? "✓" : "4"}</span> Export
            </span>
          </div>
        </section>

        <section className="st-grid-2" id="st-upload">
          <div className="st-card">
            <div className="st-card-h">
              <div>
                <h2 className="st-card-title">
                  {isStyMode ? "Yamaha Style · .sty" : "Live Audio Style · .aus"}
                </h2>
                <p className="st-card-desc">
                  {isStyMode
                    ? "Full SFF2 style (Rhythm + MIDI parts)"
                    : "From Yamaha Audio Phraser"}
                </p>
              </div>
              {ausName
                ? <span className="st-pill st-pill-green">Loaded</span>
                : <span className="st-pill">Required</span>}
            </div>
            <div className="st-card-b">
              <DropZone
                label={
                  ausName
                    ?? (isStyMode ? "Drop .sty here" : "Drop .aus here")
                }
                accept={isStyMode ? ".sty" : ".aus"}
                hint={
                  isStyMode
                    ? "Opens SMF + CASM · Rhythm 1/2 in timeline"
                    : "AASM / AWav preserved for keyboard load"
                }
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
                <p className="st-card-desc">
                  {isStyMode
                    ? "Optional extra MIDI · or use parts from the .sty"
                    : "Bulk import or drop onto DAW lanes"}
                </p>
              </div>
              {midis.length > 0
                ? <span className="st-pill st-pill-violet">{midis.length} file{midis.length === 1 ? "" : "s"}</span>
                : <span className="st-pill">{isStyMode ? "From STY or drop" : "Optional bulk"}</span>}
            </div>
            <div className="st-card-b">
              <DropZone
                label="Drop .mid file(s) here"
                accept=".mid,.midi"
                multiple
                hint={
                  isStyMode
                    ? "Rhythm 1/2 · Bass · Chord · Pad · Phrase"
                    : "Bass · Chord · Pad · Phrase → channels 11–16"
                }
                loaded={midis.length > 0}
                variant="violet"
                onFiles={onMidiDrop}
              />
            </div>
          </div>
        </section>

        <section id="st-daw">
          <p className="st-section-label">
            {isStyMode ? "Style Preview · Rhythm & MIDI lanes" : "Live Preview · Style Track Mixer"}
          </p>
          <LivePreview
            engine={engineRef.current}
            audio={hasLiveAudio ? (ausParsed?.audio ?? null) : null}
            decodedPcm={hasLiveAudio ? decodedPcm : null}
            ausMeta={hasLiveAudio ? (ausParsed?.meta ?? null) : null}
            showLiveAudioLane={hasLiveAudio || !isStyMode}
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

        <section className="st-export-wrap" id="st-export">
          <p className="st-section-label">Settings & export</p>
          <div className="st-grid-settings">
            <StyleMetadataForm value={meta} onChange={setMeta} />
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
              modeLabel={
                isStyMode
                  ? "STY re-export"
                  : assignedTracks.length === 0
                    ? "AUS only"
                    : "AUS + timeline MIDI"
              }
              checklist={[
                {
                  id: "source",
                  label: isStyMode ? "Style file loaded" : "AUS file loaded",
                  ok: !!ausParsed
                },
                {
                  id: "casm",
                  label: "CASM from AUS",
                  ok: !!(ausBytesRef.current && extractCasmFromAus(ausBytesRef.current)),
                  detail: requireAusCasm ? "required" : "optional"
                },
                {
                  id: "audio",
                  label: isStyMode
                    ? "Audio body (if Live Audio)"
                    : "AASM / AFil from AUS",
                  ok: isStyMode
                    ? true
                    : !!(ausBytesRef.current && extractAudioBody(ausBytesRef.current))
                },
                {
                  id: "parts",
                  label:
                    assignedTracks.length === 0 && !isStyMode
                      ? "No timeline MIDI"
                      : "Timeline MIDI (assigned lanes)",
                  ok: assignedTracks.length > 0 || isStyMode || hasAusAudioBody,
                  detail:
                    assignedTracks.length === 0 && !isStyMode
                      ? "optional"
                      : `${assignedTracks.length} part(s)`
                },
                {
                  id: "meta",
                  label: "Name & tempo set",
                  ok: meta.name.trim().length > 0 && meta.bpm > 0
                }
              ]}
            />
          </div>
        </section>

        <footer
          ref={footerReveal.ref}
          className={`st-footer anim-footer ${footerReveal.inView ? "is-in" : ""}`}
        >
          <div className="anim-footer-col">Private by design · files never leave this device</div>
          <div className="hex anim-footer-col">SFF2 · SInt · CASM · AASM · AFil</div>
        </footer>
      </main>
    </div>
  );
}
