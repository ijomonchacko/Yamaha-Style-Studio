import { useEffect, useRef } from "react";

const VIDEO_URL =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260329_050842_be71947f-f16e-4a14-810c-06e83d23ddb5.mp4";

/**
 * Fixed full-screen looping video.
 * No opacity fades after load (fade-to-0 was causing pale flash on scroll/loop).
 * Video stays at opacity 1 with a dark underlay as fallback.
 */
export function VideoBackground() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    const wrap = wrapRef.current;
    if (!video || !wrap) return;

    // Always fully visible once mounted — never animate opacity down
    wrap.style.opacity = "1";

    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;
    video.preload = "auto";
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    let disposed = false;

    const ensurePlaying = () => {
      if (disposed) return;
      wrap.style.opacity = "1";
      if (video.paused) {
        void video.play().catch(() => { /* autoplay may need gesture */ });
      }
    };

    // Keep seamless loop without blank frames
    const onTimeUpdate = () => {
      // If decoder stalls near end, soft-seek slightly early
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      if (video.duration - video.currentTime < 0.08 && video.currentTime > 0.2) {
        // Let native loop handle it; just force opacity
        wrap.style.opacity = "1";
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") ensurePlaying();
    };

    // Throttled scroll resume — do not touch opacity
    let scrollTO = 0;
    const onScroll = () => {
      if (scrollTO) return;
      scrollTO = window.setTimeout(() => {
        scrollTO = 0;
        if (video.paused) ensurePlaying();
      }, 200);
    };

    video.addEventListener("loadeddata", ensurePlaying);
    video.addEventListener("canplay", ensurePlaying);
    video.addEventListener("playing", () => { wrap.style.opacity = "1"; });
    video.addEventListener("timeupdate", onTimeUpdate);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("scroll", onScroll, { passive: true });

    // Single load
    try {
      video.load();
    } catch { /* ignore */ }
    ensurePlaying();

    return () => {
      disposed = true;
      if (scrollTO) window.clearTimeout(scrollTO);
      video.removeEventListener("loadeddata", ensurePlaying);
      video.removeEventListener("canplay", ensurePlaying);
      video.removeEventListener("playing", () => { wrap.style.opacity = "1"; });
      video.removeEventListener("timeupdate", onTimeUpdate);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="lp-video-root" aria-hidden>
      <div className="lp-video-underlay" />
      <div ref={wrapRef} className="lp-video-fade" style={{ opacity: 1 }}>
        <video
          ref={videoRef}
          className="lp-video"
          src={VIDEO_URL}
          muted
          playsInline
          autoPlay
          loop
          preload="auto"
          disablePictureInPicture
        />
      </div>
      <div className="lp-video-scrim" />
    </div>
  );
}
