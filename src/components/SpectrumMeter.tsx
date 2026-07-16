import { useEffect, useRef } from "react";

interface Props {
  /** 0–1 level (RMS-ish) driving bar heights. */
  level?: number;
  bars?: number;
  height?: number;
  color?: string;
}

/** Lightweight animated spectrum-style meter for lane energy feedback. */
export function SpectrumMeter({
  level = 0.35,
  bars = 16,
  height = 28,
  color = "#3ecfff"
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
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
      phase.current += 0.08;
      const gap = 2;
      const bw = Math.max(2, (w - gap * (bars - 1)) / bars);
      for (let i = 0; i < bars; i++) {
        const wave = 0.35 + 0.65 * Math.abs(Math.sin(phase.current + i * 0.45));
        const amp = Math.min(1, level * wave * (0.7 + (i / bars) * 0.5));
        const bh = Math.max(2, amp * (h - 2));
        const x = i * (bw + gap);
        const y = h - bh;
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.35 + amp * 0.65;
        ctx.fillRect(x, y, bw, bh);
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [level, bars, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: "100%", height, display: "block", borderRadius: 6 }}
      aria-hidden
    />
  );
}
