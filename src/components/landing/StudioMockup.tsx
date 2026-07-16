/**
 * Large Yamaha Style Studio product mockup (hero product shot).
 * No AI assistant panel.
 */
export function StudioMockup({ large = false }: { large?: boolean }) {
  return (
    <div className={`lp-dash liquid-glass ${large ? "lp-dash-large" : ""}`}>
      <div className="lp-dash-preview lp-dash-preview-full">
        <StudioShell />
      </div>
    </div>
  );
}

function StudioShell() {
  return (
    <div className="lp-mock lp-mock-in-dash" aria-hidden>
      <div className="lp-mock-shell">
        <div className="lp-mock-titlebar">
          <div className="lp-mock-dots">
            <span /><span /><span />
          </div>
          <div className="lp-mock-title">Yamaha Style Studio · Project</div>
          <div className="lp-mock-title-actions">
            <span className="lp-mock-chip">Save</span>
            <span className="lp-mock-chip accent">Export Style</span>
          </div>
        </div>

        <div className="lp-mock-body lp-mock-body-no-ai">
          <aside className="lp-mock-rail">
            <div className="lp-mock-rail-label">Sections</div>
            {["Intro A", "Intro B", "Intro C", "Main A", "Main B", "Main C", "Main D", "Fill In", "Break", "Ending A", "Ending B", "Ending C"].map((s, i) => (
              <div key={s} className={`lp-mock-sec ${i === 3 ? "on" : ""}`}>{s}</div>
            ))}
          </aside>

          <div className="lp-mock-center">
            <div className="lp-mock-toolbar">
              <span className="lp-mock-tempo">♩ 128 BPM · 4/4</span>
              <div className="lp-mock-transport">
                <span className="dot" />
                <span className="bar" />
                <span className="play" />
              </div>
              <span className="lp-mock-chip soft">Live Audio Style</span>
            </div>

            <div className="lp-mock-tracks">
              <TrackRow name="Live Audio" color="#3ecfff" type="wave" />
              <TrackRow name="Drum" color="#f5b942" type="drum" />
              <TrackRow name="Bass" color="#fb923c" type="notes" />
              <TrackRow name="Chord 1" color="#a78bfa" type="notes" />
              <TrackRow name="Chord 2" color="#38bdf8" type="notes" />
              <TrackRow name="Phrase 1" color="#f472b6" type="notes" />
              <TrackRow name="Phrase 2" color="#34d399" type="notes" />
            </div>

            <div className="lp-mock-roll">
              <div className="lp-mock-roll-keys" />
              <div className="lp-mock-roll-grid">
                {Array.from({ length: 18 }).map((_, i) => (
                  <span
                    key={i}
                    className="lp-mock-note"
                    style={{
                      left: `${6 + (i * 17) % 88}%`,
                      top: `${8 + (i * 11) % 72}%`,
                      width: `${8 + (i % 5) * 4}%`,
                      background: i % 3 === 0 ? "#3ecfff" : i % 3 === 1 ? "#a78bfa" : "#f472b6",
                      opacity: 0.55 + (i % 4) * 0.1
                    }}
                  />
                ))}
              </div>
            </div>
          </div>

          <aside className="lp-mock-side">
            <div className="lp-mock-panel">
              <div className="lp-mock-panel-h">Style Track Mixer</div>
              <div className="lp-mock-faders">
                {["Au", "Dr", "Bs", "C1", "C2", "P1"].map((l, i) => (
                  <div key={l} className="lp-mock-fader">
                    <div className="lp-mock-fader-track">
                      <div className="lp-mock-fader-fill" style={{ height: `${35 + (i * 11) % 50}%` }} />
                    </div>
                    <span>{l}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="lp-mock-panel">
              <div className="lp-mock-panel-h">Export</div>
              <div className="lp-mock-export-meta">SFF2 · CASM · AASM</div>
              <div className="lp-mock-export-meta soft">PSR-SX &amp; Genos</div>
              <div className="lp-mock-export-btn">Export Style</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function TrackRow({ name, color, type }: { name: string; color: string; type: "wave" | "drum" | "notes" }) {
  return (
    <div className="lp-mock-track">
      <div className="lp-mock-track-label" style={{ borderLeftColor: color }}>{name}</div>
      <div className="lp-mock-track-lane">
        {type === "wave" && (
          <div className="lp-mock-mini-wave" style={{ background: `linear-gradient(90deg, transparent, ${color}55, transparent)` }} />
        )}
        {type === "drum" && Array.from({ length: 12 }).map((_, i) => (
          <span key={i} className="lp-mock-hit" style={{ left: `${i * 8 + 4}%`, background: color }} />
        ))}
        {type === "notes" && Array.from({ length: 7 }).map((_, i) => (
          <span
            key={i}
            className="lp-mock-block"
            style={{
              left: `${8 + i * 12}%`,
              width: `${6 + (i % 3) * 3}%`,
              background: color
            }}
          />
        ))}
      </div>
    </div>
  );
}
