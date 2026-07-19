import { useEffect, useRef } from "react";

/** Hero background from current landing prompt (Taskora-style dark SaaS). */
export const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260201_052917_7fc4e418-3123-40bf-b5ba-394c28eb4b3a.mp4";

/**
 * Full-bleed hero video — muted loop, instant paint (no fade gate).
 */
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let retryTimer = 0;
    let tries = 0;

    video.muted = true;
    video.defaultMuted = true;
    video.volume = 0;
    video.playsInline = true;
    video.loop = true;
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("autoplay", "");

    if (!video.getAttribute("src") && !video.currentSrc) {
      video.src = HERO_VIDEO;
    }

    const tryPlay = () => {
      if (disposed || !video) return;
      video.muted = true;
      video.volume = 0;
      if (!video.paused) return;
      const p = video.play();
      if (p !== undefined) {
        void p.catch(() => {
          if (disposed) return;
          tries += 1;
          if (tries < 8) {
            retryTimer = window.setTimeout(tryPlay, 200 * tries);
          }
        });
      }
    };

    const onVis = () => {
      if (document.visibilityState === "visible") tryPlay();
    };

    video.addEventListener("loadeddata", tryPlay);
    video.addEventListener("canplay", tryPlay);
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("pointerdown", tryPlay, { once: true, passive: true });

    tryPlay();
    if (video.readyState < 2) video.load();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      video.removeEventListener("loadeddata", tryPlay);
      video.removeEventListener("canplay", tryPlay);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return (
    <div className="lp-video-root is-ready" aria-hidden>
      <div className="lp-video-underlay lp-video-underlay-dark" />
      <video
        ref={videoRef}
        className="lp-video lp-video-dim"
        src={HERO_VIDEO}
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
      />
      <div className="lp-video-scrim lp-video-scrim-dark" />
    </div>
  );
}
