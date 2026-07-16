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
  tone?: "dark" | "white" | "light";
  /**
   * Hide navbar once the user scrolls past the top of the page.
   * On home, also hide as soon as #hero leaves the top of the viewport.
   */
  hideOnScroll?: boolean;
  /** Optional hero id — hide when this element is no longer at the top */
  hideWhenPastId?: string;
}

/**
 * Viewport-fixed floating pill nav (portaled to body).
 * With hideOnScroll: visible only near the top / hero; gone after scroll.
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
      // Any meaningful scroll down → hide (all pages)
      if (window.scrollY > 32 || document.documentElement.scrollTop > 32) {
        return true;
      }

      if (hideWhenPastId) {
        const hero = document.getElementById(hideWhenPastId);
        if (hero) {
          const rect = hero.getBoundingClientRect();
          // Hero has scrolled up so its top is well above the bar
          if (rect.top < -40) return true;
          // Hero bottom left the top band of the screen
          if (rect.bottom < 100) return true;
        }
      }

      return false;
    };

    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setHidden(computeHidden());
      });
    };

    update();

    // Capture phase + multiple targets so we catch all scroll containers
    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener("scroll", update, opts);
    document.addEventListener("scroll", update, opts);
    document.body.addEventListener("scroll", update, opts);
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("wheel", update, { passive: true });
    window.addEventListener("touchmove", update, { passive: true });

    let io: IntersectionObserver | null = null;
    if (hideWhenPastId) {
      const hero = document.getElementById(hideWhenPastId);
      if (hero && typeof IntersectionObserver !== "undefined") {
        io = new IntersectionObserver(
          ([entry]) => {
            // Hide when hero is mostly out of the top of the viewport
            if (!entry.isIntersecting || entry.boundingClientRect.top < -20) {
              setHidden(true);
            } else if (window.scrollY <= 32) {
              setHidden(false);
            } else {
              setHidden(true);
            }
          },
          { root: null, threshold: [0, 0.05, 0.15, 0.35, 0.6, 1], rootMargin: "-80px 0px 0px 0px" }
        );
        io.observe(hero);
      }
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("scroll", update, true);
      document.body.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("wheel", update);
      window.removeEventListener("touchmove", update);
      io?.disconnect();
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

  const toneClass = tone === "light" || tone === "white" ? "sn-tone-light" : "sn-tone-dark";

  if (!mounted || typeof document === "undefined") return null;

  const nav = (
    <div
      className={`sn-root ${toneClass}${hidden ? " sn-root-hidden" : ""}`}
      data-site-nav
      data-hidden={hidden ? "true" : "false"}
      aria-hidden={hidden}
    >
      <nav className="sn-pill" aria-label="Main">
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
        <div className="sn-drawer">
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
