import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { LoadedMidi, STYLE_CHANNELS, StyleRole } from "./ChannelMatrix";
import { PianoRollStrip } from "./PianoRollStrip";
import { MidiEditor } from "./MidiEditor";
import { Waveform } from "./Waveform";
import { AudioSlice, AusMetadata } from "../lib/binary/ausParser";
import { PlaybackEngine, TransportState } from "../lib/audio/PlaybackEngine";
import { MidiEvent } from "../lib/binary/midiParser";
import {
  formatKey,
  NOTE_NAMES,
  RootName,
  ScaleMode,
  SnapTarget
} from "../lib/midi/keyTheory";
import {
  DEFAULT_PIANO_SOUND_ID,
  findSound,
  soundsByCategory,
  StyleSound
} from "../lib/audio/gmPrograms";

export interface KeySnapState {
  root: RootName;
  mode: ScaleMode;
  target: SnapTarget;
}

interface Props {
  engine: PlaybackEngine | null;
  audio: AudioSlice | null;
  decodedPcm: { pcm: Float32Array; channels: number; sampleRate: number; durationSec: number } | null;
  ausMeta: AusMetadata | null;
  rolePickers: {
    role: StyleRole;
    midi: LoadedMidi | null;
    color: string;
    engineChannel: number;
    mute: boolean;
    solo: boolean;
    soundId: string;
  }[];
  loopLengthTicks: number;
  loopBars: number;
  ausLengthTicks: number;
  snapTicks: number;
  keySnap: KeySnapState;
  onKeySnapChange: (next: KeySnapState) => void;
  onDropMidi: (role: StyleRole, files: File[]) => void;
  onClearRole: (role: StyleRole) => void;
  onToggleMute: (role: StyleRole) => void;
  onToggleSolo: (role: StyleRole) => void;
  onPcmMute: () => void;
  onPcmSolo: () => void;
  pcmMute: boolean;
  pcmSolo: boolean;
  ensureEngine: () => PlaybackEngine;
  onRoleEventsChange: (role: StyleRole, events: MidiEvent[]) => void;
  onShiftRoleTiming: (role: StyleRole, deltaTicks: number) => void;
  onDuplicateToAus: (role: StyleRole) => void;
  onSnapRoleToKey: (role: StyleRole) => void;
  onSnapAllToKey: () => void;
  onSoundChange: (role: StyleRole, soundId: string) => void;
  projectName?: string;
}

const SECTIONS = [
  "Intro A", "Intro B", "Intro C",
  "Main A", "Main B", "Main C", "Main D",
  "Fill In", "Break",
  "Ending A", "Ending B", "Ending C"
];

/** DAW-style live preview matching the landing page product mockup. */
export function LivePreview(props: Props) {
  const [state, setState] = useState<TransportState>({
    playing: false, loop: true, bpm: 120,
    positionTicks: 0, loopLengthTicks: 0, positionSec: 0, loopLengthSec: 0,
    sfStatus: "idle"
  });
  const [selected, setSelected] = useState<Partial<Record<StyleRole, number | null>>>({});
  const [editorRole, setEditorRole] = useState<StyleRole | null>(null);
  const [activeSection, setActiveSection] = useState("Main A");

  useEffect(() => {
    if (!props.engine) return;
    props.engine.onTick = setState;
    return () => { if (props.engine) props.engine.onTick = undefined; };
  }, [props.engine]);

  const editorPicker = editorRole
    ? props.rolePickers.find(r => r.role === editorRole)
    : null;

  const playhead = state.loopLengthTicks > 0
    ? state.positionTicks / state.loopLengthTicks
    : 0;

  const handlePlay = async () => {
    const eng = props.ensureEngine();
    await eng.unlock();
    if (props.decodedPcm && !eng.getLoadedPcm()) {
      eng.loadPcm(
        props.decodedPcm.pcm,
        props.decodedPcm.sampleRate,
        props.decodedPcm.channels,
        props.ausMeta?.bpm ?? state.bpm
      );
    }
    await eng.play();
  };

  const bars = Math.max(1, props.loopBars);
  const currentBar = Math.min(bars, Math.floor(playhead * bars) + 1);
  const soundGroups = useMemo(() => soundsByCategory(), []);
  const title = props.projectName?.trim() || "Untitled Style";

  return (
    <div className="daw" onPointerDown={() => props.engine?.unlock()}>
      {/* Title bar — macOS-style like mockup */}
      <div className="daw-titlebar">
        <div className="daw-dots" aria-hidden>
          <span /><span /><span />
        </div>
        <div className="daw-title">
          Yamaha Style Studio · {title}
        </div>
        <div className="daw-title-actions">
          {props.ausMeta && (
            <span className="daw-chip soft">
              Live Audio · {props.ausMeta.bpm} BPM · {props.ausMeta.bars} bar{props.ausMeta.bars === 1 ? "" : "s"}
            </span>
          )}
          {state.sfStatus === "loading" && <span className="daw-chip">Loading sounds…</span>}
          {state.sfStatus === "ready" && <span className="daw-chip green">GM ready</span>}
        </div>
      </div>

      {/* Transport */}
      <div className="daw-transport">
        <div className="daw-transport-btns">
          <button
            type="button"
            className="daw-play"
            onClick={handlePlay}
            disabled={state.playing}
            title="Play"
          >
            <PlayGlyph />
          </button>
          <button
            type="button"
            className="daw-stop"
            onClick={() => props.engine?.stop()}
            disabled={!state.playing}
            title="Stop"
          >
            <StopGlyph />
          </button>
        </div>

        <div className="daw-time">
          {state.playing ? "▶" : "■"} {currentBar} / {bars}
        </div>

        <label className="daw-chip" style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={state.loop}
            onChange={(e) => props.engine?.setLoop(e.target.checked)}
            style={{ accentColor: "#3ecfff" }}
          />
          Loop
        </label>

        <span className="daw-chip soft" style={{ fontFamily: "JetBrains Mono, monospace" }}>
          ♩ {state.bpm} · 4/4
        </span>

        <div className="daw-tempo">
          <span>TEMPO</span>
          <input
            type="range"
            min={40}
            max={240}
            value={state.bpm}
            onChange={(e) => props.engine?.setBpm(+e.target.value)}
            disabled={!props.engine}
          />
          <span className="bpm">{state.bpm}</span>
        </div>
      </div>

      <div className="daw-body">
        {/* Section rail */}
        <aside className="daw-rail">
          <div className="daw-rail-label">Sections</div>
          {SECTIONS.map(s => (
            <div
              key={s}
              className={`daw-sec ${activeSection === s ? "on" : ""}`}
              onClick={() => setActiveSection(s)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setActiveSection(s); }}
            >
              {s}
            </div>
          ))}
        </aside>

        <div className="daw-center">
          {/* Key bar */}
          <div className="daw-keybar">
            <span className="daw-keybar-label">Key</span>
            {NOTE_NAMES.map(n => (
              <button
                key={n}
                type="button"
                className={`daw-key ${props.keySnap.root === n ? "on" : ""}`}
                onClick={() => props.onKeySnapChange({ ...props.keySnap, root: n as RootName })}
              >{n}</button>
            ))}
            <button
              type="button"
              className={`daw-mode ${props.keySnap.mode === "major" ? "on" : ""}`}
              onClick={() => props.onKeySnapChange({ ...props.keySnap, mode: "major" })}
            >Major</button>
            <button
              type="button"
              className={`daw-mode ${props.keySnap.mode === "minor" ? "on" : ""}`}
              onClick={() => props.onKeySnapChange({ ...props.keySnap, mode: "minor" })}
            >Minor</button>
            <button
              type="button"
              className={`daw-mode ${props.keySnap.mode === "chromatic" ? "on" : ""}`}
              onClick={() => props.onKeySnapChange({ ...props.keySnap, mode: "chromatic" })}
            >Off</button>
            {([
              ["scale", "Scale"],
              ["triad", "Triad"],
              ["seventh", "7th"]
            ] as const).map(([t, label]) => (
              <button
                key={t}
                type="button"
                disabled={props.keySnap.mode === "chromatic"}
                className={`daw-mode ${props.keySnap.target === t ? "on-alt" : ""}`}
                onClick={() => props.onKeySnapChange({ ...props.keySnap, target: t })}
              >{label}</button>
            ))}
            <button
              type="button"
              className="daw-chip accent"
              style={{ marginLeft: "auto" }}
              disabled={props.keySnap.mode === "chromatic"}
              onClick={props.onSnapAllToKey}
            >
              Apply key · {formatKey(props.keySnap.root, props.keySnap.mode)}
            </button>
          </div>

          {/* Tracks */}
          <div className="daw-tracks">
            <DawTrack
              label="Live Audio"
              channel={props.decodedPcm
                ? `${props.decodedPcm.channels}ch · ${props.decodedPcm.durationSec.toFixed(2)}s`
                : props.audio?.encodedMime ? "decoding…" : "no audio"}
              color="#3ecfff"
              mute={props.pcmMute}
              solo={props.pcmSolo}
              onMute={props.onPcmMute}
              onSolo={props.onPcmSolo}
              active={!!props.decodedPcm}
              droppable={false}
              onDrop={() => {}}
            >
              <Waveform
                pcm={props.decodedPcm?.pcm ?? null}
                channels={props.decodedPcm?.channels ?? 1}
                playhead={playhead}
                playing={state.playing}
                bars={bars}
                height={56}
                color="#3ecfff"
              />
            </DawTrack>

            {props.rolePickers.map(rp => {
              const sound = findSound(rp.soundId);
              const step = Math.max(1, props.snapTicks);
              return (
                <DawTrack
                  key={rp.role}
                  label={rp.role}
                  channel={`ch ${rp.engineChannel + 1}`}
                  color={rp.color}
                  mute={rp.mute}
                  solo={rp.solo}
                  onMute={() => props.onToggleMute(rp.role)}
                  onSolo={() => props.onToggleSolo(rp.role)}
                  onDrop={(files) => props.onDropMidi(rp.role, files)}
                  onClear={rp.midi ? () => props.onClearRole(rp.role) : undefined}
                  onFillAus={rp.midi && props.ausLengthTicks > 0
                    ? () => props.onDuplicateToAus(rp.role)
                    : undefined}
                  onTuneKey={rp.midi && props.keySnap.mode !== "chromatic"
                    ? () => props.onSnapRoleToKey(rp.role)
                    : undefined}
                  onShiftEarlier={rp.midi
                    ? () => props.onShiftRoleTiming(rp.role, -step)
                    : undefined}
                  onShiftLater={rp.midi
                    ? () => props.onShiftRoleTiming(rp.role, step)
                    : undefined}
                  onEdit={rp.midi ? () => setEditorRole(rp.role) : undefined}
                  droppable
                  active={!!rp.midi}
                  hint={rp.midi?.name}
                  sound={sound}
                  soundGroups={soundGroups}
                  onSoundChange={(id) => props.onSoundChange(rp.role, id)}
                >
                  {rp.midi ? (
                    <PianoRollStrip
                      events={rp.midi.parsed.tracks[rp.midi.trackIndex]?.events ?? []}
                      channel={rp.engineChannel}
                      lengthTicks={props.loopLengthTicks}
                      playhead={playhead}
                      playing={state.playing}
                      bars={bars}
                      color={rp.color}
                      height={56}
                      snapTicks={props.snapTicks}
                      editable
                      selectedIndex={selected[rp.role] ?? null}
                      onSelect={(idx) => setSelected(s => ({ ...s, [rp.role]: idx }))}
                      onEventsChange={(ev) => props.onRoleEventsChange(rp.role, ev)}
                    />
                  ) : (
                    <EmptyDropLane color={rp.color} />
                  )}
                </DawTrack>
              );
            })}
          </div>
        </div>
      </div>

      {editorPicker?.midi && editorRole && (
        <MidiEditor
          open
          role={editorRole}
          fileName={editorPicker.midi.name}
          color={editorPicker.color}
          events={editorPicker.midi.parsed.tracks[editorPicker.midi.trackIndex]?.events ?? []}
          lengthTicks={props.loopLengthTicks}
          bars={bars}
          snapTicks={props.snapTicks}
          playhead={playhead}
          playing={state.playing}
          defaultChannel={editorPicker.engineChannel}
          onClose={() => {
            props.engine?.stop();
            props.engine?.clearIsolation();
            setEditorRole(null);
          }}
          onSave={(role, events) => {
            props.engine?.stop();
            props.engine?.clearIsolation();
            props.onRoleEventsChange(role, events);
            setEditorRole(null);
          }}
          onSyncPreview={(role, events) => {
            props.onRoleEventsChange(role, events);
          }}
          onPlayMode={async (mode) => {
            const eng = props.ensureEngine();
            if (mode === "stop") {
              eng.stop();
              eng.clearIsolation();
              return;
            }
            if (state.playing) eng.stop();
            if (mode === "solo") {
              eng.setIsolation(editorPicker.engineChannel, false);
            } else {
              eng.clearIsolation();
            }
            await handlePlay();
          }}
        />
      )}
    </div>
  );
}

interface DawTrackProps {
  label: string;
  channel: string;
  hint?: string;
  color: string;
  active: boolean;
  mute: boolean;
  solo: boolean;
  droppable: boolean;
  onMute: () => void;
  onSolo: () => void;
  onDrop: (files: File[]) => void;
  onClear?: () => void;
  onFillAus?: () => void;
  onTuneKey?: () => void;
  onShiftEarlier?: () => void;
  onShiftLater?: () => void;
  onEdit?: () => void;
  sound?: StyleSound;
  soundGroups?: { category: string; sounds: StyleSound[] }[];
  onSoundChange?: (soundId: string) => void;
  children: React.ReactNode;
}

function DawTrack(props: DawTrackProps) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    const arr = Array.from(list).filter(f =>
      f.name.toLowerCase().endsWith(".mid") || f.name.toLowerCase().endsWith(".midi"));
    if (arr.length) props.onDrop(arr);
  }, [props]);

  return (
    <div
      className={`daw-track ${over ? "over" : ""} ${props.active ? "" : "empty"}`}
      onDragEnter={props.droppable ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragOver={props.droppable ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={props.droppable ? () => setOver(false) : undefined}
      onDrop={props.droppable ? (e) => {
        e.preventDefault(); setOver(false);
        onFiles(e.dataTransfer.files);
      } : undefined}
    >
      <div className="daw-track-side">
        <div className="daw-track-name">
          <span className="daw-track-dot" style={{ background: props.color, color: props.color }} />
          {props.label}
        </div>
        <div className="daw-track-ch">{props.channel}</div>
        {props.hint && <div className="daw-track-file" title={props.hint}>{props.hint}</div>}
        {props.onSoundChange && props.sound && props.soundGroups && (
          <select
            className="daw-sound"
            value={props.sound.id}
            onChange={(e) => props.onSoundChange?.(e.target.value)}
          >
            {props.soundGroups.map(g => (
              <optgroup key={g.category} label={g.category}>
                {g.sounds.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.bank === "XG" ? " · XG" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {props.droppable && (
          <input
            ref={inputRef}
            type="file"
            accept=".mid,.midi"
            className="hidden"
            onChange={(e) => {
              onFiles(e.currentTarget.files);
              e.currentTarget.value = "";
            }}
          />
        )}
      </div>

      <div
        className="daw-track-lane"
        onClick={props.droppable ? (e) => {
          const t = e.target as HTMLElement;
          if (t.closest("[data-midi-add]")) {
            e.preventDefault();
            e.stopPropagation();
            inputRef.current?.click();
          }
        } : undefined}
      >
        {props.children}
      </div>

      <div className="daw-track-ctrls">
        {props.onEdit && (
          <button type="button" className="daw-tbtn accent" onClick={props.onEdit}>Edit</button>
        )}
        <button
          type="button"
          className={`daw-tbtn ${props.solo ? "solo-on" : ""}`}
          onClick={props.onSolo}
        >Solo</button>
        <button
          type="button"
          className={`daw-tbtn ${props.mute ? "mute-on" : ""}`}
          onClick={props.onMute}
        >Mute</button>
        {props.onFillAus && (
          <button type="button" className="daw-tbtn" onClick={props.onFillAus} title="Tile to AUS length">Fill</button>
        )}
        {props.onTuneKey && (
          <button type="button" className="daw-tbtn" onClick={props.onTuneKey} title="Snap to key">Key</button>
        )}
        {props.onShiftEarlier && (
          <button type="button" className="daw-tbtn" onClick={props.onShiftEarlier} title="Earlier">«</button>
        )}
        {props.onShiftLater && (
          <button type="button" className="daw-tbtn" onClick={props.onShiftLater} title="Later">»</button>
        )}
        {props.onClear && (
          <button type="button" className="daw-tbtn" onClick={props.onClear}>Clear</button>
        )}
      </div>
    </div>
  );
}

function EmptyDropLane({ color }: { color: string }) {
  return (
    <div
      data-midi-add
      className="daw-empty-lane"
      style={{ background: `linear-gradient(90deg, transparent, ${color}18 50%, transparent)` }}
      title="Click to browse or drop .mid here"
    >
      <span className="daw-empty-plus" style={{ color }}>+</span>
      <span>Drop MIDI or click +</span>
    </div>
  );
}

function PlayGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function StopGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  );
}

export const ROLE_COLORS: Record<StyleRole, string> = {
  "Bass":     "#fb923c",
  "Chord 1":  "#3ecfff",
  "Chord 2":  "#38bdf8",
  "Pad":      "#a78bfa",
  "Phrase 1": "#f472b6",
  "Phrase 2": "#f5b942"
};

export function roleToEngineChannel(role: StyleRole): number {
  const sc = STYLE_CHANNELS.find(s => s.role === role);
  return sc ? sc.ch - 1 : 0;
}

export { DEFAULT_PIANO_SOUND_ID };
