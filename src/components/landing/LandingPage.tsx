import { useRef, type ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform
} from "framer-motion";
import { Star } from "lucide-react";
import { VideoBackground } from "./VideoBackground";
import { StudioMockup } from "./StudioMockup";
import { BrandLogo } from "../BrandLogo";
import { LiveAudioShowcase, MidiEditorShowcase } from "./FeatureShowcase";
import { useInView } from "../../hooks/useInView";
import "../../community.css";
import "../../landing.css";

interface Props {
  onLaunchStudio: () => void;
  onOpenDocs: () => void;
}

const easeOut = [0.22, 1, 0.36, 1] as const;

function FadeUp({
  children,
  delay = 0,
  className = "",
  y = 28
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.7, delay, ease: easeOut }}
    >
      {children}
    </motion.div>
  );
}

const cardVariants = {
  hidden: { opacity: 0, y: 36, scale: 0.96, filter: "blur(6px)" },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
    transition: {
      duration: 0.65,
      delay: 0.06 + i * 0.08,
      ease: easeOut
    }
  })
};

const listVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.12 }
  }
};

const listItemVariants = {
  hidden: { opacity: 0, x: -16 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.5, ease: easeOut }
  }
};

/** Three bottom “photo” slots — product stats over our large mockup. */
function HeroStatCards() {
  const cards = [
    {
      label: "Live Audio",
      value: ".AUS",
      trend: "+AASM",
      up: true,
      bars: [40, 62, 48, 78, 55, 88, 70]
    },
    {
      label: "MIDI Parts",
      value: "ch 11–16",
      trend: "GM+XG",
      up: true,
      bars: [55, 42, 70, 60, 82, 48, 75]
    },
    {
      label: "Keyboard Export",
      value: "SFF2",
      trend: "STY",
      up: true,
      bars: [48, 68, 52, 90, 64, 72, 85]
    }
  ];

  return (
    <div className="lp-hero-stats">
      {cards.map((c, i) => (
        <motion.div
          key={c.label}
          className="lp-hero-stat"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, delay: 0.1 + i * 0.08, ease: easeOut }}
        >
          <div className="lp-hero-stat-top">
            <span className="lp-hero-stat-label">{c.label}</span>
            <span className={`lp-hero-stat-trend ${c.up ? "up" : "down"}`}>{c.trend}</span>
          </div>
          <div className="lp-hero-stat-value">{c.value}</div>
          <div className="lp-hero-stat-bars" aria-hidden>
            {c.bars.map((h, j) => (
              <span key={j} style={{ height: `${h}%` }} />
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function LandingPage({ onLaunchStudio, onOpenDocs }: Props) {
  const heroRef = useRef<HTMLElement>(null);
  const footerReveal = useInView<HTMLElement>();
  const reduce = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: heroRef,
    offset: ["start start", "end start"]
  });

  // Parallax only on hero children — never on ancestors of the fixed nav
  const dashboardY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "-12%"]);
  const contentY = useTransform(scrollYProgress, [0, 1], reduce ? ["0%", "0%"] : ["0%", "-30%"]);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.55], reduce ? [1, 1] : [1, 0]);

  const scrollTo = (id: string) => {
    if (id === "home" || id === "hero") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lp-root lp-root-prompt lp-root-dark">
      <VideoBackground />

      {/* SiteNav is rendered by App (fixed portal) */}
      <section ref={heroRef} className="lp-hero lp-hero-prompt sn-page-pad" id="hero">
        <motion.div
          className="lp-hero-copy"
          style={{ y: contentY, opacity: contentOpacity }}
        >
          <FadeUp delay={0}>
            <div className="lp-hero-badge lp-hero-badge-trust">
              <span className="lp-hero-badge-star" aria-hidden>
                <Star size={12} fill="url(#starGrad)" stroke="none" />
                <svg width="0" height="0" aria-hidden>
                  <defs>
                    <linearGradient id="starGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#60a5fa" />
                      <stop offset="100%" stopColor="#2563eb" />
                    </linearGradient>
                  </defs>
                </svg>
              </span>
              Built for PSR-SX &amp; Genos creators
            </div>
          </FadeUp>

          <FadeUp delay={0.1}>
            <h1 className="lp-hero-title-prompt">
              Create Yamaha{" "}
              <em className="lp-hero-italic">Styles</em>
              {" "}in your browser
            </h1>
          </FadeUp>

          <FadeUp delay={0.2}>
            <p className="lp-hero-lead-prompt">
              Import Live Audio (.aus) from Audio Phraser, edit MIDI on channels 11–16,
              preview the mix, then export SFF2 .sty files that load on PSR-SX and Genos.
            </p>
          </FadeUp>

          <FadeUp delay={0.3} className="lp-hero-cta-wrap">
            <button type="button" className="lp-btn-primary-pill lp-btn-cabin" onClick={onLaunchStudio}>
              Launch Studio
            </button>
          </FadeUp>
        </motion.div>

        <motion.div className="lp-mock-wrap lp-mock-wrap-large" style={{ y: dashboardY }}>
          <div className="lp-product-shot">
            <StudioMockup large />
            <HeroStatCards />
          </div>
        </motion.div>
      </section>

      <section className="lp-section" id="features">
        <div className="lp-section-inner">
          <FadeUp>
            <p className="lp-kicker">Features</p>
            <h2 className="lp-section-title">Everything you need to ship keyboard-ready styles</h2>
          </FadeUp>
          <div className="lp-feature-grid">
            {[
              { t: "Live Audio Styles", d: "Load .aus components, preview waveforms, and preserve AASM/AWav for keyboard load.", icon: "♪" },
              { t: "MIDI Channel Matrix", d: "Route Bass, Chord, Pad and Phrase parts to PSR channels 11–16 with GM/XG sounds.", icon: "🎚" },
              { t: "Piano Roll Editor", d: "Draw, quantize, transpose and solo lanes with a full-screen professional roll.", icon: "🎹" },
              { t: "SFF2 Export", d: "Compile SMF + CASM + audio into a .sty that loads on PSR-SX and Genos.", icon: "⇪" },
              { t: "Browser-native", d: "No install, no upload servers. Your files stay on your machine.", icon: "◎" },
              { t: "Arranger sections", d: "Intros, mains, fills, breaks and endings mapped for real-world performance.", icon: "≡" }
            ].map((f, i) => (
              <motion.article
                key={f.t}
                className="lp-feature-card lp-feature-card-anim"
                custom={i}
                variants={reduce ? undefined : cardVariants}
                initial={reduce ? false : "hidden"}
                whileInView="show"
                viewport={{ once: true, amount: 0.2 }}
                whileHover={reduce ? undefined : { y: -8, scale: 1.02, transition: { duration: 0.25 } }}
              >
                <span className="lp-feature-card-icon" aria-hidden>{f.icon}</span>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
                <span className="lp-feature-card-shine" aria-hidden />
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="live-audio">
        <div className="lp-section-inner lp-feature-block">
          <motion.div
            className="lp-feature-copy"
            initial={reduce ? false : { opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.75, ease: easeOut }}
          >
            <p className="lp-kicker">Live Audio Styles</p>
            <h2 className="lp-section-title">Edit .aus the way keyboards expect</h2>
            <p className="lp-section-copy">
              Preview PCM loops, lock tempo and bar length, then stitch audio with MIDI parts.
              The exporter keeps Yamaha structure so styles open without “data not loaded” errors.
            </p>
            <motion.ul
              className="lp-detail-list"
              variants={listVariants}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
            >
              {[
                { t: "Waveform preview", d: "See stereo PCM from AWav / Adat with playhead sync to the style loop." },
                { t: "Waveform scrub & transport", d: "Click the waveform to seek; tempo stays locked to export BPM." },
                { t: "Bar timeline", d: "Match 1–16 bar patterns to Main A / fills and keep SFF2 markers valid." },
                { t: "Chunk-safe export", d: "AASM → AWav body is preserved byte-for-byte for PSR-SX & Genos." }
              ].map(item => (
                <motion.li key={item.t} variants={reduce ? undefined : listItemVariants}>
                  <strong>{item.t}</strong>
                  <span>{item.d}</span>
                </motion.li>
              ))}
            </motion.ul>
            <div className="lp-feature-footer">
              <div className="lp-metric-row">
                <div className="lp-metric"><b>AASM</b><span>Audio assembly</span></div>
                <div className="lp-metric"><b>48 kHz</b><span>PCM preview</span></div>
                <div className="lp-metric"><b>SFF2</b><span>Keyboard load</span></div>
              </div>
            </div>
          </motion.div>
          <motion.div
            className="lp-feature-visual"
            initial={reduce ? false : { opacity: 0, x: 48, scale: 0.94 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.8, ease: easeOut }}
          >
            <LiveAudioShowcase />
          </motion.div>
        </div>
      </section>

      <section className="lp-section" id="midi">
        <div className="lp-section-inner lp-feature-block reverse">
          <motion.div
            className="lp-feature-copy"
            initial={reduce ? false : { opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.75, ease: easeOut }}
          >
            <p className="lp-kicker">MIDI Editor</p>
            <h2 className="lp-section-title">Shape every style channel</h2>
            <p className="lp-section-copy">
              Drag notes on lane strips or open the full editor. Snap to musical key, fill to AUS length,
              and audition with GM soundfonts before export.
            </p>
            <motion.ul
              className="lp-detail-list"
              variants={listVariants}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, amount: 0.3 }}
            >
              {[
                { t: "Full piano roll", d: "Draw, move, resize, quantize and transpose with solo / full-mix preview." },
                { t: "Velocity graph", d: "See dynamics across the loop so bass and phrases sit correctly in the mix." },
                { t: "Channel activity", d: "Bass · Chord · Pad · Phrase map to PSR channels 11–16 with GM/XG sounds." },
                { t: "Key snap tools", d: "Major / minor / scale / triad / 7th snap keeps styles keyboard-friendly." }
              ].map(item => (
                <motion.li key={item.t} variants={reduce ? undefined : listItemVariants}>
                  <strong>{item.t}</strong>
                  <span>{item.d}</span>
                </motion.li>
              ))}
            </motion.ul>
            <div className="lp-feature-footer">
              <div className="lp-metric-row">
                <div className="lp-metric"><b>ch 11–16</b><span>Style parts</span></div>
                <div className="lp-metric"><b>GM + XG</b><span>Sounds</span></div>
                <div className="lp-metric"><b>Solo</b><span>Lane audition</span></div>
              </div>
            </div>
          </motion.div>
          <motion.div
            className="lp-feature-visual"
            initial={reduce ? false : { opacity: 0, x: -48, scale: 0.94 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ duration: 0.8, ease: easeOut }}
          >
            <MidiEditorShowcase />
          </motion.div>
        </div>
      </section>

      <section className="lp-section lp-community" id="community">
        <div className="lp-section-inner">
          <FadeUp y={32}>
            <div className="lp-community-banner">
              <div className="lp-community-banner-copy">
                <p className="lp-kicker">Community</p>
                <h2 className="lp-section-title">Thank you to the arranger community</h2>
                <p className="lp-section-copy">
                  Yamaha Style Studio stands on decades of shared knowledge from keyboard players,
                  style creators, and forum volunteers.
                </p>
                <div className="lp-community-pills">
                  <span>PSR-SX</span>
                  <span>Genos</span>
                  <span>Live Audio</span>
                  <span>Style creators</span>
                </div>
              </div>
              <div className="lp-community-banner-art" aria-hidden>
                <div className="lp-community-orb" />
                <div className="lp-community-quote">
                  <p>“Share the knowledge. Build better styles together.”</p>
                  <span>For every arranger who helped someone load their first User style.</span>
                </div>
              </div>
            </div>
          </FadeUp>

          <div className="lp-community-grid">
            {[
              {
                name: "PSR Tutorial",
                url: "https://www.psrtutorial.com/",
                tag: "Tutorials & styles",
                blurb: "Long-running hub for Yamaha arranger tutorials, free styles, and practical how-tos.",
                meta: "psrtutorial.com"
              },
              {
                name: "Keyboard Forums",
                url: "https://www.keyboardforums.com/",
                tag: "Discussion",
                blurb: "Keyboard players discussing arranger styles, gear, and performance tips across brands.",
                meta: "keyboardforums.com"
              },
              {
                name: "YamahaMusicians",
                url: "https://www.yamahamusicians.com/",
                tag: "Players & gear",
                blurb: "Community of Yamaha keyboard musicians sharing tips, songs, and gear talk.",
                meta: "yamahamusicians.com"
              }
            ].map((c, i) => (
              <motion.a
                key={c.name}
                className="lp-community-card lp-community-card-anim"
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                custom={i}
                variants={reduce ? undefined : cardVariants}
                initial={reduce ? false : "hidden"}
                whileInView="show"
                viewport={{ once: true, amount: 0.25 }}
                whileHover={reduce ? undefined : { y: -10, scale: 1.025, transition: { duration: 0.25 } }}
              >
                <div className="lp-community-card-top">
                  <span className="lp-community-icon" aria-hidden>♪</span>
                  <span className="lp-community-tag">{c.tag}</span>
                </div>
                <h3>{c.name}</h3>
                <p>{c.blurb}</p>
                <div className="lp-community-card-foot">
                  <span className="lp-community-meta">{c.meta}</span>
                  <span className="lp-community-ext">Visit site ↗</span>
                </div>
              </motion.a>
            ))}
          </div>

          <FadeUp delay={0.15} y={20}>
            <div className="lp-community-bottom">
              <p className="lp-community-note">
                Independent tool — not affiliated with Yamaha Corporation or the forums above.
              </p>
              <div className="lp-community-cta">
                <button type="button" className="lp-btn-solid lp-btn-lg" onClick={onLaunchStudio}>
                  Launch Studio
                </button>
                <button type="button" className="lp-btn-ghost lp-btn-lg" onClick={onOpenDocs}>
                  Read the guide
                </button>
              </div>
            </div>
          </FadeUp>
        </div>
      </section>

      <footer
        ref={footerReveal.ref}
        className={`lp-footer anim-footer ${footerReveal.inView ? "is-in" : ""}`}
      >
        <div className="lp-footer-grid">
          <div className="lp-footer-brand anim-footer-col">
            <BrandLogo size={96} variant="dark" />
            <p className="lp-footer-tag">
              Browser-native style builder for Yamaha PSR-SX &amp; Genos.
              Create Live Audio Styles, edit MIDI, export SFF2 .sty — privately on your device.
            </p>
          </div>
          <div className="lp-footer-col anim-footer-col">
            <h4>Product</h4>
            <button type="button" onClick={() => scrollTo("features")}>Features</button>
            <button type="button" onClick={() => scrollTo("live-audio")}>Live Audio</button>
            <button type="button" onClick={() => scrollTo("midi")}>MIDI Editor</button>
            <button type="button" onClick={onLaunchStudio}>Launch Studio</button>
          </div>
          <div className="lp-footer-col anim-footer-col">
            <h4>Explore</h4>
            <button type="button" onClick={() => scrollTo("community")}>Community</button>
            <button type="button" onClick={onOpenDocs}>Documentation</button>
            <button type="button" onClick={onLaunchStudio}>Get Started</button>
            <button type="button" onClick={() => scrollTo("hero")}>Home</button>
          </div>
          <div className="lp-footer-col anim-footer-col">
            <h4>Formats</h4>
            <span>.AUS · Live Audio Style</span>
            <span>.STY · SFF2 Style</span>
            <span>.MID · MIDI tracks</span>
          </div>
        </div>
        <div className="lp-footer-bottom anim-footer-col">
          <span>© {new Date().getFullYear()} Yamaha Style Studio · Independent tool · Compatible with PSR-SX &amp; Genos</span>
          <span className="hex">SFF2 · CASM · AASM</span>
        </div>
      </footer>
    </div>
  );
}
