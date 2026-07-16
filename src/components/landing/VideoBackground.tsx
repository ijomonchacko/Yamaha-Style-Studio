import { useEffect, useRef, useState } from "react";

/**
 * Local nature hero loop (stored in /public so it always loads offline).
 * Remote CDN clips were failing on the home page.
 */
const VIDEO_SRC = `${import.meta.env.BASE_URL}hero-nature.mp4`;

/**
 * Full-screen looping nature video behind the landing page.
 * Uses a local asset + aggressive muted autoplay. Falls back to a
 * soft nature canvas animation if the file cannot play.
 */
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // ---- Video autoplay ----
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let tries = 0;
    let retryTimer = 0;

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.playsInline = true;
    video.loop = true;
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("autoplay", "");

    // Prefer local file (stable). Bust cache only once per session if needed.
    if (!video.src || !video.src.includes("hero-nature")) {
      video.src = VIDEO_SRC;
    }

    const tryPlay = async () => {
      if (disposed || !video) return;
      try {
        video.muted = true;
        video.volume = 0;
        if (video.paused) {
          const p = video.play();
          if (p !== undefined) await p;
        }
        if (!disposed) {
          setReady(true);
          setFailed(false);
        }
      } catch {
        if (disposed) return;
        tries += 1;
        if (tries < 10) {
          retryTimer = window.setTimeout(() => void tryPlay(), 280 * tries);
        } else {
          setFailed(true);
        }
      }
    };

    const onReady = () => void tryPlay();
    const onPlaying = () => {
      setReady(true);
      setFailed(false);
    };
    const onError = () => setFailed(true);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tryPlay();
    };
    const onPointer = () => void tryPlay();

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("canplaythrough", onReady);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    document.addEventListener("pointerdown", onPointer, { once: true, passive: true });
    document.addEventListener("touchstart", onPointer, { once: true, passive: true });

    void tryPlay();
    retryTimer = window.setTimeout(() => void tryPlay(), 400);

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("canplaythrough", onReady);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, []);

  // ---- Nature canvas fallback (soft forest / mist animation) ----
  useEffect(() => {
    if (!failed) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let t = 0;
    const particles = Array.from({ length: 48 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 1.2 + Math.random() * 3.5,
      s: 0.15 + Math.random() * 0.45,
      a: 0.08 + Math.random() * 0.2
    }));

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      t += 0.004;
      const w = window.innerWidth;
      const h = window.innerHeight;

      // Deep forest gradient sky
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, "#1a2e24");
      sky.addColorStop(0.35, "#243d2f");
      sky.addColorStop(0.7, "#1c3328");
      sky.addColorStop(1, "#121f1a");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Soft sun glow
      const gx = w * (0.62 + Math.sin(t * 0.4) * 0.02);
      const gy = h * 0.28;
      const sun = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(w, h) * 0.45);
      sun.addColorStop(0, "rgba(180, 220, 140, 0.28)");
      sun.addColorStop(0.35, "rgba(90, 160, 100, 0.12)");
      sun.addColorStop(1, "rgba(20, 40, 30, 0)");
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);

      // Rolling hills
      for (let layer = 0; layer < 4; layer++) {
        const baseY = h * (0.55 + layer * 0.1);
        const amp = 18 + layer * 12;
        const speed = t * (0.3 + layer * 0.12);
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 8) {
          const y =
            baseY +
            Math.sin(x * 0.004 + speed + layer) * amp +
            Math.sin(x * 0.01 - speed * 0.7) * (amp * 0.35);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        const alpha = 0.35 + layer * 0.12;
        ctx.fillStyle = `rgba(${18 + layer * 10}, ${48 + layer * 14}, ${32 + layer * 8}, ${alpha})`;
        ctx.fill();
      }

      // Floating pollen / light dust
      for (const p of particles) {
        p.y -= p.s * 0.0015;
        p.x += Math.sin(t * 2 + p.y * 10) * 0.0004;
        if (p.y < -0.05) {
          p.y = 1.05;
          p.x = Math.random();
        }
        ctx.beginPath();
        ctx.fillStyle = `rgba(210, 240, 190, ${p.a})`;
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Soft vignette
      const vig = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.85);
      vig.addColorStop(0, "rgba(0,0,0,0)");
      vig.addColorStop(1, "rgba(0,0,0,0.35)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [failed]);

  return (
    <div
      className={`lp-video-root ${ready ? "is-ready" : ""} ${failed ? "is-failed" : ""}`}
      aria-hidden
    >
      <div className="lp-video-underlay" />

      {/* Nature canvas fallback — only visible when video fails */}
      {failed && (
        <canvas ref={canvasRef} className="lp-video-canvas" />
      )}

      <video
        ref={videoRef}
        className="lp-video"
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        poster=""
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>

      <div className="lp-video-scrim" />
    </div>
  );
}
