import { useEffect, useRef, useState } from "react";

/** Hero background from current landing prompt (Taskora-style dark SaaS). */
export const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260201_052917_7fc4e418-3123-40bf-b5ba-394c28eb4b3a.mp4";

/**
 * Full-bleed hero video — muted loop, ~50% opacity, gradient into #050505.
 */
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);

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
    video.setAttribute("autoplay", "");

    if (!video.src || !video.src.includes("hf_20260201")) {
      video.src = HERO_VIDEO;
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
        if (!disposed) setReady(true);
      } catch {
        if (disposed) return;
        tries += 1;
        if (tries < 12) {
          retryTimer = window.setTimeout(() => void tryPlay(), 300 * tries);
        }
      }
    };

    const onReady = () => void tryPlay();
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("playing", () => setReady(true));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void tryPlay();
    });
    document.addEventListener("pointerdown", () => void tryPlay(), { once: true, passive: true });

    void tryPlay();
    retryTimer = window.setTimeout(() => void tryPlay(), 400);

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
    };
  }, []);

  return (
    <div className={`lp-video-root ${ready ? "is-ready" : ""}`} aria-hidden>
      <div className="lp-video-underlay lp-video-underlay-dark" />
      <video
        ref={videoRef}
        className="lp-video lp-video-dim"
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
      >
        <source src={HERO_VIDEO} type="video/mp4" />
      </video>
      <div className="lp-video-scrim lp-video-scrim-dark" />
    </div>
  );
}
