import { useEffect, useMemo, useRef } from "react";

interface Props {
  pcm: Float32Array | null;
  channels: number;
  /** 0..1 progress within the loop, drawn as a moving vertical bar. */
  playhead: number;
  /** Number of bar-grid divisions to overlay (0 = no grid). */
  bars?: number;
  height?: number;
  color?: string;
  playing?: boolean;
}

/**
 * Renders a mini-waveform of the AUS PCM with a live playhead.
 * Uses an offscreen-computed min/max peak envelope so the same buffer can be
 * downsampled cheaply on every resize.
 */
export function Waveform({
  pcm, channels, playhead, bars = 4, height = 96, color = "#6ee7ff", playing = false
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const peaks = useMemo(() => computePeaks(pcm, channels, 900), [pcm, channels]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Backdrop
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "rgba(21,27,43,0.9)");
    bg.addColorStop(1, "rgba(15,20,32,0.9)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Bar grid
    if (bars > 0) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
      ctx.lineWidth = 1;
      for (let i = 1; i < bars; i++) {
        const x = Math.round((w / bars) * i) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    }

    // Center line
    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    // Waveform
    if (peaks && peaks.length > 1) {
      const step = w / peaks.length;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < peaks.length; i++) {
        const { min, max } = peaks[i];
        const x = i * step;
        const y1 = ((1 - max) * h) / 2;
        const y2 = ((1 - min) * h) / 2;
        const barH = Math.max(1, y2 - y1);
        ctx.fillRect(x, y1, Math.max(1, step - 0.5), barH);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.fillStyle = "rgba(148,163,184,0.35)";
      ctx.font = "11px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("no audio decoded", w / 2, h / 2);
    }

    // Playhead
    if (playhead >= 0 && playhead <= 1) {
      const px = Math.min(w - 1, Math.max(0, playhead * w));
      ctx.strokeStyle = playing ? "#f472b6" : "rgba(244,114,182,0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      // Glow
      ctx.fillStyle = "rgba(244,114,182,0.12)";
      ctx.fillRect(Math.max(0, px - 6), 0, 12, h);
    }
  }, [peaks, playhead, bars, color, playing]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height, display: "block" }}
      className="rounded-lg border border-edge bg-panel2"
    />
  );
}

/** Downsample PCM into `bins` min/max peak buckets — cheap for redraws. */
function computePeaks(
  pcm: Float32Array | null,
  channels: number,
  bins: number
): { min: number; max: number }[] | null {
  if (!pcm || pcm.length < 8) return null;
  const chCount = Math.max(1, channels);
  const frameCount = Math.floor(pcm.length / chCount);
  const bucket = Math.max(1, Math.floor(frameCount / bins));
  const out: { min: number; max: number }[] = [];
  for (let b = 0; b < bins; b++) {
    let mn = 1, mx = -1;
    const start = b * bucket;
    const end = Math.min(frameCount, start + bucket);
    for (let i = start; i < end; i++) {
      // Mixdown to mono for the visualization
      let v = 0;
      for (let c = 0; c < chCount; c++) v += pcm[i * chCount + c];
      v /= chCount;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn === 1 && mx === -1) { mn = 0; mx = 0; }
    out.push({ min: mn, max: mx });
  }
  return out;
}
