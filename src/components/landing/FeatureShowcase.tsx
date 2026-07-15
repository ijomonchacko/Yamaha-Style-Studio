/** Showcase panels for Live Audio + MIDI — subtle, professional motion. */

export function LiveAudioShowcase() {
  const spectrum = [28, 52, 38, 72, 45, 88, 62, 40, 78, 55, 92, 48, 68, 35, 82, 58, 44, 75, 50, 90, 42, 66, 54, 80];
  const bars = [2, 4, 6, 8, 10, 12, 14, 16];

  return (
    <div className="fx-card fx-card-light">
      <div className="fx-card-top">
        <div>
          <div className="fx-card-label">Live Audio · .AUS</div>
          <div className="fx-card-title">Waveform + spectrum analysis</div>
        </div>
        <span className="fx-badge live">● LIVE</span>
      </div>

      <div className="fx-wave-wrap">
        <svg className="fx-wave-svg" viewBox="0 0 400 88" preserveAspectRatio="none">
          <defs>
            <linearGradient id="fxWaveGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2bb8e8" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#2bb8e8" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <path className="fx-wave-fill" d="M0 44 Q25 18 50 44 T100 44 T150 44 T200 30 T250 58 T300 40 T350 50 T400 44 V88 H0 Z" fill="url(#fxWaveGrad)" />
          <path className="fx-wave-line fx-wave-a" d="M0 44 Q25 18 50 44 T100 44 T150 44 T200 30 T250 58 T300 40 T350 50 T400 44" fill="none" stroke="#2bb8e8" strokeWidth="1.8" />
          <path className="fx-wave-line fx-wave-b" d="M0 48 Q30 62 60 48 T120 48 T180 36 T240 56 T300 44 T360 52 T400 48" fill="none" stroke="#7c6af0" strokeWidth="1.2" opacity="0.55" />
          <line className="fx-playhead" x1="40" y1="6" x2="40" y2="82" stroke="#e11d48" strokeWidth="1.25" opacity="0.85" />
        </svg>
      </div>

      <div className="fx-spectrum" aria-hidden>
        {spectrum.map((h, i) => (
          <span
            key={i}
            className="fx-bar"
            style={{ height: `${h}%`, animationDelay: `${(i % 8) * 0.1}s` }}
          />
        ))}
      </div>

      <div className="fx-stats">
        <div className="fx-stat"><span className="fx-stat-v">125</span><span className="fx-stat-l">BPM</span></div>
        <div className="fx-stat"><span className="fx-stat-v">2</span><span className="fx-stat-l">Bars</span></div>
        <div className="fx-stat"><span className="fx-stat-v">48k</span><span className="fx-stat-l">Sample</span></div>
        <div className="fx-stat"><span className="fx-stat-v">AASM</span><span className="fx-stat-l">Chunk</span></div>
      </div>

      <div className="fx-timeline">
        <div className="fx-timeline-label">Loop length · bars</div>
        <div className="fx-timeline-bars">
          {bars.map((b, i) => (
            <div key={b} className="fx-tl-col">
              <div className="fx-tl-fill" style={{ height: `${30 + (i % 4) * 16}%`, animationDelay: `${i * 0.08}s` }} />
              <span>{b}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="fx-chips">
        <span>AWav</span><span>Adat</span><span>AInf</span><span>Stereo PCM</span>
      </div>
    </div>
  );
}

export function MidiEditorShowcase() {
  const notes = [
    { l: 6, t: 20, w: 12, c: "#5ec8ff", d: 0 },
    { l: 16, t: 40, w: 9, c: "#9b8cff", d: 0.2 },
    { l: 24, t: 30, w: 15, c: "#e8a0c0", d: 0.35 },
    { l: 36, t: 48, w: 10, c: "#e8c56a", d: 0.15 },
    { l: 44, t: 24, w: 13, c: "#5ec8ff", d: 0.4 },
    { l: 54, t: 44, w: 8, c: "#6bc9a0", d: 0.1 },
    { l: 62, t: 34, w: 16, c: "#9b8cff", d: 0.25 },
    { l: 74, t: 50, w: 9, c: "#e0a070", d: 0.18 },
    { l: 82, t: 28, w: 11, c: "#5ec8ff", d: 0.3 }
  ];

  const channels = [
    { name: "Bass", pct: 82, color: "#e0a070" },
    { name: "Chord 1", pct: 68, color: "#5ec8ff" },
    { name: "Chord 2", pct: 54, color: "#6eb8e0" },
    { name: "Pad", pct: 71, color: "#9b8cff" },
    { name: "Phrase 1", pct: 46, color: "#e8a0c0" },
    { name: "Phrase 2", pct: 39, color: "#e8c56a" }
  ];

  const velocity = [42, 68, 52, 78, 46, 72, 58, 70, 44, 80, 55, 66, 50, 74, 60];

  return (
    <div className="fx-card fx-card-dark fx-midi">
      <div className="fx-card-top">
        <div>
          <div className="fx-card-label light">MIDI Editor · Piano Roll</div>
          <div className="fx-card-title light">Notes · velocity · channels</div>
        </div>
        <span className="fx-badge edit">EDIT</span>
      </div>

      <div className="fx-roll">
        <div className="fx-roll-keys" />
        <div className="fx-roll-grid">
          {notes.map((n, i) => (
            <span
              key={i}
              className="fx-note"
              style={{
                left: `${n.l}%`,
                top: `${n.t}%`,
                width: `${n.w}%`,
                background: n.c,
                animationDelay: `${n.d}s`
              }}
            />
          ))}
          <div className="fx-roll-playhead" />
        </div>
      </div>

      {/* Soft MIDI event stream (subtle, not flashy) */}
      <div className="fx-midi-stream" aria-hidden>
        <span>Note On · C2</span>
        <span>CC 11</span>
        <span>Prog · Bass</span>
        <span>Note Off</span>
        <span>Quantize</span>
      </div>

      <div className="fx-vel">
        <div className="fx-vel-label">Velocity graph</div>
        <div className="fx-vel-bars">
          {velocity.map((v, i) => (
            <span
              key={i}
              className="fx-vel-bar"
              style={{ height: `${v}%`, animationDelay: `${i * 0.07}s` }}
            />
          ))}
        </div>
      </div>

      <div className="fx-chan">
        <div className="fx-chan-label">Channel activity · ch 11–16</div>
        {channels.map(ch => (
          <div key={ch.name} className="fx-chan-row">
            <span className="fx-chan-name">{ch.name}</span>
            <div className="fx-chan-track">
              <div className="fx-chan-fill" style={{ width: `${ch.pct}%`, background: ch.color }} />
            </div>
            <span className="fx-chan-pct">{ch.pct}%</span>
          </div>
        ))}
      </div>

      <div className="fx-chips dark">
        <span>Quantize</span><span>Key snap</span><span>Solo</span><span>GM / XG</span>
      </div>
    </div>
  );
}
