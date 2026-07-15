import { useCallback, useRef, useState } from "react";

interface Props {
  label: string;
  accept: string;
  multiple?: boolean;
  hint?: string;
  variant?: "cyan" | "violet";
  loaded?: boolean;
  onFiles: (files: File[]) => void;
}

/** Drag-and-drop upload zone with keyboard fallback. */
export function DropZone({ label, accept, multiple, hint, variant = "cyan", loaded, onFiles }: Props) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((list: FileList | null) => {
    if (!list) return;
    onFiles(Array.from(list));
  }, [onFiles]);

  return (
    <div
      className={`dz ${over ? "on" : ""} ${loaded ? "border-solid" : ""}`}
      style={loaded ? {
        borderColor: variant === "violet" ? "rgba(167,139,250,0.4)" : "rgba(62,207,255,0.4)",
        background: variant === "violet"
          ? "rgba(167,139,250,0.06)"
          : "rgba(62,207,255,0.06)"
      } : undefined}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") inputRef.current?.click(); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          handleFiles(e.currentTarget.files);
          e.currentTarget.value = "";
        }}
      />
      <div className="flex flex-col items-center gap-1">
        <div className="dz-icon" style={variant === "violet" ? { color: "#c4b5fd", borderColor: "rgba(167,139,250,0.25)", background: "linear-gradient(145deg, rgba(167,139,250,0.15), rgba(62,207,255,0.08))" } : undefined}>
          {loaded ? <CheckGlyph /> : <UploadGlyph />}
        </div>
        <div className="dz-title">{label}</div>
        {hint && <div className="dz-hint">{hint}</div>}
      </div>
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M12 3v12" strokeLinecap="round" />
      <path d="M7 8l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
