import { useRef } from "react";
import { VideoBackground } from "./VideoBackground";
import { StudioMockup } from "./StudioMockup";
import { BrandLogo } from "../BrandLogo";
import { LiveAudioShowcase, MidiEditorShowcase } from "./FeatureShowcase";
import {
  AiSparkleIcon,
  FolderIcon,
  MidiIcon,
  SparkleIcon,
  UpArrowIcon,
  UploadIcon
} from "./icons";
import "../../community.css";

interface Props {
  onLaunchStudio: () => void;
  onOpenDocs: () => void;
}

const NAV = [
  { id: "home", label: "Home" },
  { id: "features", label: "Features" },
  { id: "live-audio", label: "Live Audio" },
  { id: "midi", label: "MIDI Editor" },
  { id: "community", label: "Community" }
] as const;

export function LandingPage({ onLaunchStudio, onOpenDocs }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollTo = (id: string) => {
    if (id === "home") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="lp-root">
      <VideoBackground />

      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <BrandLogo size={88} onClick={() => scrollTo("home")} className="lp-brand" />

          <ul className="lp-menu">
            {NAV.map(item => (
              <li key={item.id}>
                <button type="button" className="lp-menu-item" onClick={() => scrollTo(item.id)}>
                  {item.label}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="lp-menu-item" onClick={onOpenDocs}>
                Docs
              </button>
            </li>
          </ul>

          <div className="lp-nav-actions">
            <button type="button" className="lp-btn-solid" onClick={onLaunchStudio}>
              Launch Studio
            </button>
          </div>
        </div>
      </nav>

      <section className="lp-hero" id="home">
        <div className="lp-hero-content">
          <div className="lp-badge">
            <span className="lp-badge-new">
              <SparkleIcon size={12} />
              NEW
            </span>
            <span className="lp-badge-text">Professional Yamaha Style Editor</span>
          </div>

          <h1 className="lp-headline">
            Create Yamaha Styles<br className="hidden sm:block" /> Without Limits
          </h1>

          <p className="lp-subtitle">
            Design, edit and build Yamaha PSR-SX &amp; Genos styles directly in your browser.
            Edit Live Audio Styles (.aus), MIDI channels, intros, endings, fills, multipads and
            export fully compatible arranger styles.
          </p>

          <div className="lp-editor-panel">
            <div className="lp-editor-top">
              <div className="lp-editor-top-left">
                <span className="lp-editor-label">Live Audio Style</span>
                <span className="lp-compat-badge">Compatible with Yamaha PSR-SX &amp; Genos</span>
              </div>
              <div className="lp-editor-ai">
                <AiSparkleIcon size={13} />
                <span>AI Assisted Editing</span>
              </div>
            </div>

            <div className="lp-editor-input-row">
              <input
                ref={inputRef}
                className="lp-editor-input"
                type="text"
                readOnly
                placeholder="Open a Yamaha Style (.sty), Live Audio Style (.aus) or MIDI file..."
                onClick={onLaunchStudio}
              />
              <button type="button" className="lp-editor-submit" onClick={onLaunchStudio} aria-label="Launch studio">
                <UpArrowIcon size={16} />
              </button>
            </div>

            <div className="lp-editor-bottom">
              <div className="lp-editor-actions">
                <button type="button" className="lp-chip-btn" onClick={onLaunchStudio}>
                  <UploadIcon size={13} /> Upload Style
                </button>
                <button type="button" className="lp-chip-btn" onClick={onLaunchStudio}>
                  <MidiIcon size={13} /> Import MIDI
                </button>
                <button type="button" className="lp-chip-btn" onClick={onLaunchStudio}>
                  <FolderIcon size={13} /> Open .AUS
                </button>
              </div>
              <span className="lp-editor-formats">Supports .STY · .AUS · .MID</span>
            </div>
          </div>

          <div className="lp-cta-row">
            <button type="button" className="lp-btn-solid lp-btn-lg" onClick={onLaunchStudio}>
              Get Started
            </button>
            <button type="button" className="lp-btn-ghost lp-btn-lg" onClick={() => scrollTo("features")}>
              Explore Features
            </button>
          </div>
        </div>

        <div className="lp-mock-wrap">
          <StudioMockup />
        </div>
      </section>

      <section className="lp-section" id="features">
        <div className="lp-section-inner">
          <p className="lp-kicker">Features</p>
          <h2 className="lp-section-title">Everything you need to ship keyboard-ready styles</h2>
          <div className="lp-feature-grid">
            {[
              { t: "Live Audio Styles", d: "Load .aus components, preview waveforms, and preserve AASM/AWav for keyboard load." },
              { t: "MIDI Channel Matrix", d: "Route Bass, Chord, Pad and Phrase parts to PSR channels 11–16 with GM/XG sounds." },
              { t: "Piano Roll Editor", d: "Draw, quantize, transpose and solo lanes with a full-screen professional roll." },
              { t: "SFF2 Export", d: "Compile SMF + CASM + audio into a .sty that loads on PSR-SX and Genos." },
              { t: "Browser-native", d: "No install, no upload servers. Your files stay on your machine." },
              { t: "Arranger sections", d: "Intros, mains, fills, breaks and endings mapped for real-world performance." }
            ].map(f => (
              <article key={f.t} className="lp-feature-card">
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-section lp-section-alt" id="live-audio">
        <div className="lp-section-inner lp-feature-block">
          <div className="lp-feature-copy">
            <p className="lp-kicker">Live Audio Styles</p>
            <h2 className="lp-section-title">Edit .aus the way keyboards expect</h2>
            <p className="lp-section-copy">
              Preview PCM loops, lock tempo and bar length, then stitch audio with MIDI parts.
              The exporter keeps Yamaha structure so styles open without “data not loaded” errors.
            </p>
            <ul className="lp-detail-list">
              <li>
                <strong>Waveform preview</strong>
                <span>See stereo PCM from AWav / Adat with playhead sync to the style loop.</span>
              </li>
              <li>
                <strong>Spectrum &amp; level graphs</strong>
                <span>Animated frequency bars help you judge loop energy before export.</span>
              </li>
              <li>
                <strong>Bar timeline</strong>
                <span>Match 1–16 bar patterns to Main A / fills and keep SFF2 markers valid.</span>
              </li>
              <li>
                <strong>Chunk-safe export</strong>
                <span>AASM → AWav body is preserved byte-for-byte for PSR-SX &amp; Genos.</span>
              </li>
            </ul>
            <div className="lp-feature-footer">
              <div className="lp-metric-row">
                <div className="lp-metric"><b>AASM</b><span>Audio assembly</span></div>
                <div className="lp-metric"><b>48 kHz</b><span>PCM preview</span></div>
                <div className="lp-metric"><b>SFF2</b><span>Keyboard load</span></div>
              </div>
            </div>
          </div>
          <LiveAudioShowcase />
        </div>
      </section>

      <section className="lp-section" id="midi">
        <div className="lp-section-inner lp-feature-block reverse">
          <div className="lp-feature-copy">
            <p className="lp-kicker">MIDI Editor</p>
            <h2 className="lp-section-title">Shape every style channel</h2>
            <p className="lp-section-copy">
              Drag notes on lane strips or open the full editor. Snap to musical key, fill to AUS length,
              and audition with GM soundfonts before export.
            </p>
            <ul className="lp-detail-list">
              <li>
                <strong>Full piano roll</strong>
                <span>Draw, move, resize, quantize and transpose with solo / full-mix preview.</span>
              </li>
              <li>
                <strong>Velocity graph</strong>
                <span>See dynamics across the loop so bass and phrases sit correctly in the mix.</span>
              </li>
              <li>
                <strong>Channel activity</strong>
                <span>Bass · Chord · Pad · Phrase map to PSR channels 11–16 with GM/XG sounds.</span>
              </li>
              <li>
                <strong>Key snap tools</strong>
                <span>Major / minor / scale / triad / 7th snap keeps styles keyboard-friendly.</span>
              </li>
            </ul>
            <div className="lp-feature-footer">
              <div className="lp-metric-row">
                <div className="lp-metric"><b>ch 11–16</b><span>Style parts</span></div>
                <div className="lp-metric"><b>GM + XG</b><span>Sounds</span></div>
                <div className="lp-metric"><b>Solo</b><span>Lane audition</span></div>
              </div>
            </div>
          </div>
          <MidiEditorShowcase />
        </div>
      </section>

      <section className="lp-section lp-community" id="community">
        <div className="lp-section-inner">
          <div className="lp-community-banner">
            <div className="lp-community-banner-copy">
              <p className="lp-kicker">Community</p>
              <h2 className="lp-section-title">Thank you to the arranger community</h2>
              <p className="lp-section-copy">
                Yamaha Style Studio stands on decades of shared knowledge from keyboard players,
                style creators, and forum volunteers. These communities keep PSR / Genos / Tyros
                learning alive — we are grateful for their tutorials, style archives, and support.
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
              <a
                key={c.name}
                className="lp-community-card"
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ animationDelay: `${0.08 + i * 0.08}s` }}
              >
                <div className="lp-community-card-top">
                  <span className="lp-community-icon" aria-hidden>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  </span>
                  <span className="lp-community-tag">{c.tag}</span>
                </div>
                <h3>{c.name}</h3>
                <p>{c.blurb}</p>
                <div className="lp-community-card-foot">
                  <span className="lp-community-meta">{c.meta}</span>
                  <span className="lp-community-ext">Visit site ↗</span>
                </div>
              </a>
            ))}
          </div>

          <div className="lp-community-bottom">
            <p className="lp-community-note">
              Independent tool — not affiliated with Yamaha Corporation or the forums above.
              Please follow each site’s rules and support their creators.
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
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <BrandLogo size={100} />
            <p className="lp-footer-tag">
              Browser-native style builder for Yamaha PSR-SX &amp; Genos.
              Create Live Audio Styles, edit MIDI, export SFF2 .sty — privately on your device.
            </p>
          </div>
          <div className="lp-footer-col">
            <h4>Product</h4>
            <button type="button" onClick={() => scrollTo("features")}>Features</button>
            <button type="button" onClick={() => scrollTo("live-audio")}>Live Audio</button>
            <button type="button" onClick={() => scrollTo("midi")}>MIDI Editor</button>
            <button type="button" onClick={onLaunchStudio}>Launch Studio</button>
          </div>
          <div className="lp-footer-col">
            <h4>Explore</h4>
            <button type="button" onClick={() => scrollTo("community")}>Community</button>
            <button type="button" onClick={onOpenDocs}>Documentation</button>
            <button type="button" onClick={onLaunchStudio}>Get Started</button>
            <button type="button" onClick={() => scrollTo("home")}>Home</button>
          </div>
          <div className="lp-footer-col">
            <h4>Formats</h4>
            <span>.AUS · Live Audio Style</span>
            <span>.STY · SFF2 Style</span>
            <span>.MID · MIDI tracks</span>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span>© {new Date().getFullYear()} Yamaha Style Studio · Independent tool · Compatible with PSR-SX &amp; Genos</span>
          <span className="hex">SFF2 · CASM · AASM</span>
        </div>
      </footer>
    </div>
  );
}
