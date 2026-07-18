import { StyleBuildResult } from "../lib/binary/styleStitcher";

interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}

interface Props {
  ready: boolean;
  disabled: boolean;
  result: StyleBuildResult | null;
  onCompile: () => void;
  onDownload: () => void;
  error: string | null;
  warnings?: string[];
  requireAusCasm?: boolean;
  onRequireAusCasmChange?: (v: boolean) => void;
  checklist?: ChecklistItem[];
  modeLabel?: string;
  onSaveProject?: () => void;
  onLoadProject?: () => void;
}

/**
 * Keyboard export panel.
 * Layout: SMF Format 0 → CASM → OTSc → AASM/AFil (Style Editor safe).
 */
export function ExportPanel({
  ready,
  disabled,
  result,
  onCompile,
  onDownload,
  error,
  warnings = [],
  requireAusCasm,
  onRequireAusCasmChange,
  checklist = [],
  modeLabel,
  onSaveProject,
  onLoadProject
}: Props) {
  const log = result?.log ?? [];
  const hasTimelineMidi = log.some(l => /Timeline MIDI/i.test(l));
  const readyCount = checklist.filter(i => i.ok).length;
  const readyTotal = checklist.length;
  const v = result?.validation;
  const postChecks = v?.checks ?? [];
  const allPostOk = !!v?.ok;

  return (
    <div className="st-panel export-panel">
      <div className="st-panel-h">
        <div>
          <h2 className="st-panel-title">Keyboard export</h2>
          <p className="st-panel-sub">
            SFF2 · PSR-SX · Genos · SX920
            {modeLabel ? ` · ${modeLabel}` : ""}
          </p>
        </div>
        <span className={`export-status ${ready ? "is-ready" : ""}`}>
          {ready ? "Ready" : "Not ready"}
        </span>
      </div>

      <div className="st-panel-body export-panel-body">
        <div className="export-layout-row">
          <span className="export-layout-label">Layout</span>
          <code className="export-layout-chain">
            {v?.layout || "SMF F0 → CASM → OTSc → AASM/AFil"}
          </code>
        </div>

        {checklist.length > 0 && (
          <div className="export-ready-row">
            <span className="export-ready-count">
              Pre-flight {readyCount}/{readyTotal}
            </span>
            <div className="export-ready-dots" aria-hidden>
              {checklist.map(item => (
                <span
                  key={item.id}
                  className={item.ok ? "is-on" : ""}
                  title={item.label}
                />
              ))}
            </div>
          </div>
        )}

        {checklist.length > 0 && (
          <ul className="export-check-list">
            {checklist.map(item => (
              <li key={item.id} className={item.ok ? "is-ok" : "is-bad"}>
                <span className="export-check-mark">{item.ok ? "✓" : "✗"}</span>
                <span className="export-check-label">{item.label}</span>
                {item.detail && (
                  <span className="export-check-detail">{item.detail}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        {onRequireAusCasmChange != null && (
          <label className="export-casm-toggle">
            <input
              type="checkbox"
              checked={!!requireAusCasm}
              onChange={(e) => onRequireAusCasmChange(e.target.checked)}
            />
            <span>
              <strong>Require source CASM</strong>
              <small>Fail if AUS has no CASM — recommended for SX920</small>
            </span>
          </label>
        )}

        {(onSaveProject || onLoadProject) && (
          <div className="export-project-row">
            {onSaveProject && (
              <button type="button" className="export-btn-secondary" onClick={onSaveProject}>
                Save project
              </button>
            )}
            {onLoadProject && (
              <button type="button" className="export-btn-secondary" onClick={onLoadProject}>
                Load project
              </button>
            )}
          </div>
        )}

        <div className="export-actions">
          <button
            type="button"
            className="export-btn-primary"
            onClick={onCompile}
            disabled={disabled}
          >
            Compile .sty
          </button>
          <button
            type="button"
            className="export-btn-secondary"
            onClick={onDownload}
            disabled={!result || !allPostOk}
          >
            Download
          </button>
        </div>

        {error && (
          <div className="export-error">
            <strong>Export blocked</strong>
            <p>{error}</p>
          </div>
        )}

        {warnings.length > 0 && !error && (
          <div className="export-warn">
            {warnings.slice(0, 4).map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        )}

        <div className={`export-result-slot ${result ? "has-result" : ""}`}>
          {result ? (
            <>
              <div className="export-result-line">
                <span className={`export-result-dot ${allPostOk ? "" : "is-fail"}`} />
                <span className="export-result-text">
                  {allPostOk ? "PASS · Style Editor safe" : "FAIL · do not load on keyboard"}
                  <em>
                    {result.casmSource === "aus" ? " · CASM AUS" : " · CASM gen"}
                    {result.otscSize > 0 ? " · OTSc" : " · no OTSc"}
                    {hasTimelineMidi ? " · MIDI" : " · Live Audio"}
                  </em>
                </span>
                <span className="export-result-total">{fmt(result.styBytes.length)}</span>
              </div>

              {postChecks.length > 0 && (
                <ul className="export-validator">
                  {postChecks.map(c => (
                    <li key={c.id} className={c.ok ? "is-ok" : "is-bad"}>
                      <span>{c.ok ? "PASS" : "FAIL"}</span>
                      <b>{c.label}</b>
                      {c.detail && <em>{c.detail}</em>}
                    </li>
                  ))}
                </ul>
              )}

              {v && v.errors.length > 0 && (
                <div className="export-error">
                  <strong>Validator errors</strong>
                  {v.errors.map((e, i) => (
                    <p key={i}>{e}</p>
                  ))}
                </div>
              )}

              <div className="export-stats">
                <div><span>SMF</span><b>{fmt(result.smfSize)}</b></div>
                <div><span>CASM</span><b>{fmt(result.casmSize)}</b></div>
                <div><span>OTSc</span><b>{fmt(result.otscSize)}</b></div>
                <div><span>Audio</span><b>{fmt(result.audioSize)}</b></div>
              </div>
              <details className="export-log">
                <summary>Build log</summary>
                <pre>{result.log.join("\n")}</pre>
              </details>
            </>
          ) : (
            <p className="export-idle-line">
              Compile builds SMF → CASM → OTSc → Live Audio.
              OTSc is required so Style Editor does not crash (SRJRRR).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
