import { ParsedMidi } from "../lib/binary/midiParser";

export interface LoadedMidi {
  name: string;
  bytes: Uint8Array;
  parsed: ParsedMidi;
  trackIndex: number;
}

export const STYLE_CHANNELS = [
  { role: "Bass",     ch: 11 },
  { role: "Chord 1",  ch: 12 },
  { role: "Chord 2",  ch: 13 },
  { role: "Pad",      ch: 14 },
  { role: "Phrase 1", ch: 15 },
  { role: "Phrase 2", ch: 16 }
] as const;

export type StyleRole = typeof STYLE_CHANNELS[number]["role"];

interface Props {
  midis: LoadedMidi[];
  assignments: Record<number, StyleRole | "unassigned">;
  onChange: (midiIndex: number, role: StyleRole | "unassigned") => void;
  onRemove: (midiIndex: number) => void;
  onTrackChange: (midiIndex: number, trackIndex: number) => void;
}

export function ChannelMatrix({ midis, assignments, onChange, onRemove, onTrackChange }: Props) {
  const takenRoles = new Set<StyleRole>();
  for (const key of Object.keys(assignments)) {
    const v = assignments[+key];
    if (v !== "unassigned") takenRoles.add(v);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="card-title">Channel routing</div>
          <div className="card-desc">Map MIDI sources → PSR channels 11–16</div>
        </div>
        <span className="pill pill-muted">{midis.length} source · {takenRoles.size}/6 routed</span>
      </div>

      {midis.length === 0 ? (
        <div className="alert-info">
          Upload <span className="text-accent2">.mid</span> files (or drop onto studio lanes) to route them here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid var(--border)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th className="pl-4">Source</th>
                <th>Track</th>
                <th>MIDI ch.</th>
                <th>Style channel</th>
                <th>Length</th>
                <th className="pr-4" />
              </tr>
            </thead>
            <tbody>
              {midis.map((m, i) => {
                const current = assignments[i] ?? "unassigned";
                const track = m.parsed.tracks[m.trackIndex] ?? m.parsed.tracks[0];
                return (
                  <tr key={i}>
                    <td className="pl-4">
                      <div className="font-semibold truncate max-w-[180px]" title={m.name}>{m.name}</div>
                      <div className="text-[11px] muted">{m.bytes.length.toLocaleString()} B</div>
                    </td>
                    <td>
                      <select
                        className="select w-40 !py-2"
                        value={m.trackIndex}
                        onChange={(e) => onTrackChange(i, +e.target.value)}
                      >
                        {m.parsed.tracks.map((t, ti) => (
                          <option key={ti} value={ti}>{ti + 1}. {t.name || `Track ${ti + 1}`}</option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs muted hex">
                      {track?.channelsUsed.length
                        ? track.channelsUsed.map(c => c + 1).join(", ")
                        : "—"}
                    </td>
                    <td>
                      <select
                        className="select w-44 !py-2"
                        value={current}
                        onChange={(e) => onChange(i, e.target.value as StyleRole | "unassigned")}
                      >
                        <option value="unassigned">— Unassigned</option>
                        {STYLE_CHANNELS.map(sc => (
                          <option
                            key={sc.role}
                            value={sc.role}
                            disabled={takenRoles.has(sc.role) && current !== sc.role}
                          >
                            Ch {sc.ch} · {sc.role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-xs hex muted">
                      {track?.events.length ? m.parsed.lengthTicks.toLocaleString() : "0"}
                    </td>
                    <td className="pr-4 text-right">
                      <button type="button" className="btn-ghost !py-1.5 !px-3 text-xs" onClick={() => onRemove(i)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
