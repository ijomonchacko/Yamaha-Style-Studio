import { StyleSection } from "../lib/binary/sff2Writer";

export interface StyleMetaState {
  name: string;
  category: string;
  bpm: number;
  timeSigNum: number;
  timeSigDen: number;
  sections: StyleSection[];
}

const SECTION_OPTIONS: StyleSection[] = [
  "Main A", "Main B", "Main C", "Main D",
  "Intro A", "Intro B", "Intro C",
  "Ending A", "Ending B", "Ending C",
  "Fill In AA", "Fill In BB", "Fill In CC", "Fill In DD", "Break"
];

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

  const toggleSection = (s: StyleSection) => {
    const has = value.sections.includes(s);
    set("sections", has ? value.sections.filter(x => x !== s) : [...value.sections, s]);
  };

  return (
    <div className="card h-full">
      <div className="card-h">
        <div>
          <div className="card-title">Style settings</div>
          <div className="card-desc">Name, tempo, meter & sections</div>
        </div>
      </div>
      <div className="card-b space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <label className="block sm:col-span-2">
            <span className="field-label">Style name</span>
            <input
              className="input"
              value={value.name}
              maxLength={40}
              placeholder="My Audio Style"
              onChange={(e) => set("name", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="field-label">Category</span>
            <select
              className="select"
              value={value.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="field-label">Tempo (BPM)</span>
            <input
              type="number"
              className="input hex"
              min={30} max={300}
              value={value.bpm}
              onChange={(e) => set("bpm", Math.max(30, Math.min(300, +e.target.value || 120)))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2.5 sm:col-span-2">
            <label className="block">
              <span className="field-label">Time sig · top</span>
              <input
                type="number"
                className="input hex"
                min={1} max={16}
                value={value.timeSigNum}
                onChange={(e) => set("timeSigNum", Math.max(1, Math.min(16, +e.target.value || 4)))}
              />
            </label>
            <label className="block">
              <span className="field-label">Bottom</span>
              <select
                className="select"
                value={value.timeSigDen}
                onChange={(e) => set("timeSigDen", +e.target.value)}
              >
                {[2, 4, 8, 16].map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div>
          <div className="field-label">Sections</div>
          <div className="flex flex-wrap gap-1.5">
            {SECTION_OPTIONS.map(s => {
              const on = value.sections.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSection(s)}
                  className={`pill transition-all ${on ? "pill-cyan" : "pill-muted hover:border-accent/40"}`}
                >{s}</button>
              );
            })}
          </div>
          <p className="text-[11px] muted mt-2">
            Main A is used when nothing is selected.
          </p>
        </div>
      </div>
    </div>
  );
}
