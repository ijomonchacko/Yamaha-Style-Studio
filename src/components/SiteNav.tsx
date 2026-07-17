import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";

export type SiteNavLink = {
  id: string;
  label: string;
  onClick: () => void;
  active?: boolean;
};

interface Props {
  links: SiteNavLink[];
  onLogoClick: () => void;
  primaryLabel?: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  tone?: "dark" | "white" | "light" | "studio";
  hideOnScroll?: boolean;
  hideWhenPastId?: string;
}

/**
 * Viewport-fixed full-width nav bar (portaled to document.body).
 * Edge-to-edge; not a floating pill. Studio uses its own chrome.
 */
export function SiteNav({
  links,
  onLogoClick,
  primaryLabel = "Launch Studio",
  onPrimary,
  secondaryLabel,
  onSecondary,
  tone = "dark",
  hideOnScroll = true,
  hideWhenPastId
}: Props) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!hideOnScroll && !hideWhenPastId) {
      setHidden(false);
      return;
    }

    let raf = 0;
    const computeHidden = (): boolean => {
      if (window.scrollY > 32 || document.documentElement.scrollTop > 32) return true;
      if (hideWhenPastId) {
        const hero = document.getElementById(hideWhenPastId);
        if (hero) {
          const rect = hero.getBoundingClientRect();
          if (rect.top < -40 || rect.bottom < 100) return true;
        }
      }
      return false;
    };

    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setHidden(computeHidden()));
    };

    update();
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("scroll", update, opts);
    document.addEventListener("scroll", update, opts);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [hideOnScroll, hideWhenPastId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (hidden) setOpen(false);
  }, [hidden]);

  const toneClass =
    tone === "studio"
      ? "sn-tone-studio"
      : tone === "light" || tone === "white"
        ? "sn-tone-light"
        : "sn-tone-dark";

  if (!mounted || typeof document === "undefined") return null;

  const nav = (
    <div
      className={`sn-root ${toneClass}${hidden ? " sn-root-hidden" : ""}`}
      data-site-nav
      data-hidden={hidden ? "true" : "false"}
      aria-hidden={hidden}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        width: "100%",
        maxWidth: "none",
        zIndex: 2147483646,
        transform: "none",
        pointerEvents: "none"
      }}
    >
      <nav
        className="sn-pill"
        aria-label="Main"
        style={{ pointerEvents: "auto", width: "100%", maxWidth: "none", borderRadius: 0 }}
      >
        <button
          type="button"
          className="sn-logo-plate"
          onClick={onLogoClick}
          aria-label="Yamaha Style Studio"
          title="Yamaha Style Studio"
          tabIndex={hidden ? -1 : 0}
        >
          <span className="sn-yss">YSS</span>
        </button>

        <ul className="sn-links">
          {links.map(link => (
            <li key={link.id}>
              <button
                type="button"
                className={`sn-link ${link.active ? "is-active" : ""}`}
                onClick={() => {
                  setOpen(false);
                  link.onClick();
                }}
                tabIndex={hidden ? -1 : 0}
              >
                {link.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="sn-actions">
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              className="sn-btn-ghost"
              onClick={() => {
                setOpen(false);
                onSecondary();
              }}
              tabIndex={hidden ? -1 : 0}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            className="sn-btn-solid"
            onClick={() => {
              setOpen(false);
              onPrimary();
            }}
            tabIndex={hidden ? -1 : 0}
          >
            {primaryLabel}
          </button>
          <button
            type="button"
            className="sn-burger"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen(v => !v)}
            tabIndex={hidden ? -1 : 0}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>

      {open && !hidden && (
        <div className="sn-drawer" style={{ pointerEvents: "auto" }}>
          {links.map(link => (
            <button
              key={link.id}
              type="button"
              className={`sn-drawer-link ${link.active ? "is-active" : ""}`}
              onClick={() => {
                setOpen(false);
                link.onClick();
              }}
            >
              {link.label}
            </button>
          ))}
          {secondaryLabel && onSecondary && (
            <button
              type="button"
              className="sn-drawer-link"
              onClick={() => {
                setOpen(false);
                onSecondary();
              }}
            >
              {secondaryLabel}
            </button>
          )}
          <button
            type="button"
            className="sn-btn-solid sn-drawer-cta"
            onClick={() => {
              setOpen(false);
              onPrimary();
            }}
          >
            {primaryLabel}
          </button>
        </div>
      )}
    </div>
  );

  return createPortal(nav, document.body);
}
