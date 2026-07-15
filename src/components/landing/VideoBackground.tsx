import { useEffect, useRef, useState } from "react";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260329_050842_be71947f-f16e-4a14-810c-06e83d23ddb5.mp4";

/**
 * Full-screen looping hero video.
 * Aggressive muted autoplay + retries so the clip starts on first paint.
 */
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let tries = 0;
    let retryTimer = 0;

    // Critical for autoplay policies
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

    const tryPlay = async () => {
      if (disposed || !video) return;
      try {
        video.muted = true;
        const p = video.play();
        if (p !== undefined) await p;
        if (!disposed) {
          setReady(true);
          setFailed(false);
        }
      } catch {
        // Retry a few times (network / policy)
        if (disposed) return;
        tries += 1;
        if (tries < 8) {
          retryTimer = window.setTimeout(() => void tryPlay(), 350 * tries);
        } else {
          setFailed(true);
        }
      }
    };

    const onCanPlay = () => {
      void tryPlay();
    };
    const onPlaying = () => {
      setReady(true);
      setFailed(false);
    };
    const onError = () => {
      setFailed(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void tryPlay();
    };
    // First user gesture unlocks autoplay if blocked
    const onPointer = () => {
      void tryPlay();
    };

    video.addEventListener("loadeddata", onCanPlay);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("canplaythrough", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    document.addEventListener("pointerdown", onPointer, { once: true, passive: true });
    document.addEventListener("touchstart", onPointer, { once: true, passive: true });

    // Kick off immediately — do NOT call load() (it can cancel autoplay)
    if (video.readyState >= 2) void tryPlay();
    else void tryPlay();

    // Fallback poll
    retryTimer = window.setTimeout(() => void tryPlay(), 500);

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      video.removeEventListener("loadeddata", onCanPlay);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("canplaythrough", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("touchstart", onPointer);
    };
  }, []);

  return (
    <div className={`lp-video-root ${ready ? "is-ready" : ""} ${failed ? "is-failed" : ""}`} aria-hidden>
      <div className="lp-video-underlay" />
      <video
        ref={videoRef}
        className="lp-video"
        src={VIDEO_URL}
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
      >
        <source src={VIDEO_URL} type="video/mp4" />
      </video>
      <div className="lp-video-scrim" />
    </div>
  );
}
