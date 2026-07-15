import { AusParseResult } from "../lib/binary/ausParser";
import { hexDump } from "../lib/binary/bytes";

interface Props {
  fileName: string | null;
  parsed: AusParseResult | null;
}

export function AusInspector({ fileName, parsed }: Props) {
  if (!parsed) {
    return (
      <div>
        <div className="card-title mb-1">AUS container</div>
        <div className="card-desc mb-3">Chunk map & PCM details</div>
        <div className="alert-info">
          Drop a <span className="text-accent">.aus</span> file to inspect audio chunks.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="card-title">AUS container</div>
          <div className="card-desc">Chunk map & PCM details</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill pill-cyan">{fileName ?? "unknown"}</span>
          <span className="pill pill-muted hex">{parsed.raw.length.toLocaleString()} B</span>
        </div>
      </div>

      <div>
        <div className="field-label">Detected chunks</div>
        <div className="flex flex-wrap gap-1.5">
          {parsed.chunks.length === 0 && (
            <span className="text-xs text-bad">No SFF-style chunks recognised.</span>
          )}
          {parsed.chunks.map((c, i) => (
            <span
              key={i}
              className={`pill ${
                parsed.audioChunks.includes(c) ? "pill-mint" : "pill-muted"
              }`}
              title={`offset 0x${c.offset.toString(16)} · ${c.size} B`}
            >
              {c.id}
              <span className="opacity-60 hex ml-0.5">{c.size}B</span>
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <MiniStat label="BPM" value={String(parsed.meta.bpm)} hint={parsed.meta.source} />
        <MiniStat label="Bars" value={String(parsed.meta.bars)} hint={`${parsed.meta.timeSigNum}/${parsed.meta.timeSigDen}`} />
        <MiniStat
          label="Loop"
          value={parsed.audio ? `${parsed.audio.durationSec.toFixed(2)}s` : "—"}
          hint={parsed.audio ? `${parsed.audio.sampleRate / 1000}kHz` : "duration"}
        />
      </div>

      {parsed.audio && (
        <div className="text-xs muted">
          PCM · {parsed.audio.sampleRate.toLocaleString()} Hz · {parsed.audio.channels} ch ·{" "}
          {parsed.audio.bitsPerSample}-bit
        </div>
      )}

      {parsed.warnings.length > 0 && (
        <ul className="text-xs space-y-1 list-disc pl-4" style={{ color: "var(--amber)" }}>
          {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      <details>
        <summary className="text-xs muted cursor-pointer hover:text-frost-200 transition">
          Hex preview (first 512 B)
        </summary>
        <pre className="hex mt-2 p-3 rounded-xl text-[11px] overflow-x-auto leading-relaxed"
          style={{ background: "rgba(0,0,0,0.35)", border: "1px solid var(--border)" }}>
{hexDump(parsed.raw, 512)}
        </pre>
      </details>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-box">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className="text-[10px] muted mt-0.5 truncate">{hint}</div>
    </div>
  );
}
