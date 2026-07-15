import { StyleBuildResult } from "../lib/binary/styleStitcher";

interface Props {
  ready: boolean;
  disabled: boolean;
  result: StyleBuildResult | null;
  onCompile: () => void;
  onDownload: () => void;
  error: string | null;
}

export function ExportPanel({ ready, disabled, result, onCompile, onDownload, error }: Props) {
  return (
    <div className="card h-full">
      <div className="card-h">
        <div>
          <div className="card-title">Export · .sty</div>
          <div className="card-desc">Compile SFF2 style for PSR-SX / Genos keyboards</div>
        </div>
        {ready
          ? <span className="pill pill-mint">Ready</span>
          : <span className="pill pill-muted">Need AUS + MIDI</span>}
      </div>
      <div className="card-b space-y-4">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <button className="btn-primary flex-1" onClick={onCompile} disabled={disabled}>
            <BuildGlyph /> Compile style
          </button>
          <button className="btn-accent2 flex-1" onClick={onDownload} disabled={!result}>
            <DownloadGlyph /> Download .sty
          </button>
        </div>

        {error && <div className="alert-error">{error}</div>}

        {result && (
          <div className="space-y-3 anim-in">
            <div className="alert-ok">
              Style compiled and validated. Copy the file to USB and load it under
              Style → User / Expansion on your keyboard.
              {result.casmSource === "generated" && (
                <> CASM was generated (AUS had no valid CASM) — if the keyboard rejects it, re-export the .aus from Audio Phraser with CASM intact.</>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Stat label="SMF" value={fmt(result.smfSize)} />
              <Stat label="CASM" value={`${fmt(result.casmSize)}${result.casmSource === "aus" ? " · AUS" : " · gen"}`} />
              <Stat label="Audio" value={fmt(result.audioSize)} />
              <Stat label="Total" value={fmt(result.styBytes.length)} accent />
            </div>
            <details>
              <summary className="text-xs muted cursor-pointer hover:text-frost-200 transition list-none">
                <span className="lane-btn">View build log</span>
              </summary>
              <pre className="hex mt-3 p-3.5 rounded-xl text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed"
                style={{ background: "rgba(0,0,0,0.35)", border: "1px solid var(--border)" }}>
{result.log.join("\n")}
              </pre>
            </details>
          </div>
        )}

        {!result && !error && (
          <div className="alert-info">
            <strong className="text-cyan-soft">Workflow:</strong>{" "}
            Drop an <span className="hex text-accent">.aus</span> → assign MIDI lanes →
            set name/tempo → Compile → Download
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat-box" style={accent ? { borderColor: "rgba(62,207,255,0.3)", background: "rgba(62,207,255,0.06)" } : undefined}>
      <div className="label">{label}</div>
      <div className="value" style={accent ? { color: "#7ddfff" } : undefined}>{value}</div>
    </div>
  );
}

function fmt(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function BuildGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M14.7 6.3a5 5 0 1 0 3 3l4.6 4.6-3 3-4.6-4.6a5 5 0 0 0-3-3z" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 21h16" strokeLinecap="round" />
    </svg>
  );
}
