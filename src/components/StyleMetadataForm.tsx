export interface StyleMetaState {
  name: string;
  category: string;
  bpm: number;
  timeSigNum: number;
  timeSigDen: number;
  sections: import("../lib/binary/sff2Writer").StyleSection[];
}

const CATEGORY_OPTIONS = [
  "Pop&Rock", "Ballad", "Dance", "R&B", "Jazz", "Latin",
  "World", "Ballroom", "Country", "Movie&Show", "Entertainer"
];

interface Props {
  value: StyleMetaState;
  onChange: (next: StyleMetaState) => void;
}

export function StyleMetadataForm({ value, onChange }: Props) {
  const set = <K extends keyof StyleMetaState>(k: K, v: StyleMetaState[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div className="st-panel st-meta-panel">
      <div className="st-panel-h">
        <div>
          <h2 className="st-panel-title">Style settings</h2>
          <p className="st-panel-sub">Name, category, tempo & meter</p>
        </div>
      </div>
      <div className="st-panel-body">
        <div className="st-meta-grid">
          <label className="st-field st-field-full">
            <span className="st-field-label">Style name</span>
            <input
              className="st-input"
              value={value.name}
              maxLength={40}
              placeholder="My Audio Style"
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label className="st-field">
            <span className="st-field-label">Category</span>
            <select
              className="st-select"
              value={value.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="st-field">
            <span className="st-field-label">Tempo (BPM)</span>
            <input
              type="number"
              className="st-input st-input-num"
              min={30}
              max={300}
              value={value.bpm}
              onChange={(e) => set("bpm", Math.max(30, Math.min(300, +e.target.value || 120)))}
            />
          </label>
          <label className="st-field st-field-full">
            <span className="st-field-label">Time signature</span>
            <div className="st-timesig">
              <input
                type="number"
                className="st-input st-input-num"
                min={1}
                max={16}
                value={value.timeSigNum}
                onChange={(e) => set("timeSigNum", Math.max(1, Math.min(16, +e.target.value || 4)))}
                aria-label="Time signature numerator"
              />
              <span className="st-timesig-sep">/</span>
              <select
                className="st-select"
                value={value.timeSigDen}
                onChange={(e) => set("timeSigDen", +e.target.value)}
                aria-label="Time signature denominator"
              >
                {[2, 4, 8, 16].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </label>
        </div>
        <p className="st-meta-hint">
          Sections are controlled in the Live Preview timeline (Main A–D, fills, intro/ending).
        </p>
      </div>
    </div>
  );
}
