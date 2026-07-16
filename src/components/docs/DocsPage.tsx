import { useEffect, useState } from "react";
import { useInView } from "../../hooks/useInView";
import "../../docs.css";

interface Props {
  onHome: () => void;
  onLaunchStudio: () => void;
}

type TocItem = {
  id: string;
  label: string;
  /** Nested under section 4 (a/b/c style) */
  nest?: "child" | "parent";
};

const TOC: TocItem[] = [
  { id: "overview", label: "Overview" },
  { id: "tools", label: "Tools you need" },
  { id: "source-audio", label: "1 · Prepare source audio" },
  { id: "rx12", label: "2 · Isolate drums with RX 12" },
  { id: "export-stems", label: "3 · Export clean stems" },
  { id: "audio-phraser", label: "4 · Build .aus in Audio Phraser", nest: "parent" },
  { id: "tempo-rhythm", label: "4a · Tempo & rhythm lock", nest: "child" },
  { id: "stretching", label: "4b · Careful with stretching", nest: "child" },
  { id: "import-studio", label: "5 · Import .aus here" },
  { id: "midi-parts", label: "6 · Add MIDI style parts" },
  { id: "preview-edit", label: "7 · Preview & edit" },
  { id: "export-sty", label: "8 · Compile & load on keyboard" },
  { id: "checklist", label: "Quick checklist" },
  { id: "troubleshooting", label: "Troubleshooting" }
];

export function DocsPage({ onHome, onLaunchStudio }: Props) {
  const [active, setActive] = useState<string>("overview");
  const footerReveal = useInView<HTMLElement>();

  useEffect(() => {
    const ids = TOC.map(t => t.id);
    const onScroll = () => {
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= 120) current = id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="docs-root">
      {/* SiteNav is rendered by App (fixed portal) */}
      <div className="docs-layout sn-page-pad">
        <aside className="docs-toc">
          <div className="docs-toc-title">Guide</div>
          {TOC.map(item => (
            <button
              key={item.id}
              type="button"
              className={[
                "docs-toc-item",
                active === item.id ? "on" : "",
                item.nest === "child" ? "nested" : "",
                item.nest === "parent" ? "parent" : ""
              ].filter(Boolean).join(" ")}
              onClick={() => scrollTo(item.id)}
            >
              {item.nest === "child" && <span className="docs-toc-bullet" aria-hidden />}
              <span>{item.label}</span>
            </button>
          ))}
        </aside>

        <article className="docs-content">
          <header className="docs-hero">
            <p className="docs-kicker anim-page-kicker">Documentation</p>
            <h1 className="anim-page-title">From song file to Yamaha Live Audio Style</h1>
            <p className="docs-lead anim-page-lead">
              A complete workflow: isolate drums &amp; percussion with <strong>iZotope RX 12</strong>,
              build a Live Audio Style in <strong>Yamaha Audio Phraser</strong>, then finish MIDI parts
              and export a keyboard-ready <strong>.sty</strong> in Yamaha Style Studio.
            </p>
          </header>

          <section id="overview" className="docs-sec">
            <h2>Overview</h2>
            <p>
              Yamaha arranger keyboards (PSR-SX / Genos) can play <em>Live Audio Styles</em> — styles that
              mix real audio loops with traditional MIDI accompaniment channels. The official path is:
            </p>
            <ol className="docs-steps">
              <li>Prepare a clean drum / percussion audio loop</li>
              <li>Create a <code>.aus</code> Live Audio Style component in Yamaha Audio Phraser</li>
              <li>Import that <code>.aus</code> into Yamaha Style Studio</li>
              <li>Add Bass, Chord, Pad, Phrase MIDI parts</li>
              <li>Compile and download a full SFF2 <code>.sty</code> for USB load</li>
            </ol>
            <div className="docs-callout">
              <strong>Goal of this guide</strong>
              <p>
                Get a professional-sounding Live Audio Style from any commercial track or multi-track
                project, without “Data not loaded properly” errors on the keyboard.
              </p>
            </div>
          </section>

          <section id="tools" className="docs-sec">
            <h2>Tools you need</h2>
            <div className="docs-grid-3">
              <div className="docs-card">
                <h3>iZotope RX 12</h3>
                <p>Music Rebalance / Stem Separation to pull drums &amp; percussion from a full mix.</p>
              </div>
              <div className="docs-card">
                <h3>Yamaha Audio Phraser</h3>
                <p>Official Yamaha app that creates Live Audio Style <code>.aus</code> components.</p>
              </div>
              <div className="docs-card">
                <h3>Yamaha Style Studio</h3>
                <p>This browser app — merge <code>.aus</code> + MIDI, preview, export <code>.sty</code>.</p>
              </div>
            </div>
            <p className="docs-note">
              Optional: any DAW (Cubase, Logic, Reaper, Ableton) for trimming, tempo-matching, and exporting WAV.
            </p>
          </section>

          <section id="source-audio" className="docs-sec">
            <h2>1 · Prepare source audio</h2>
            <p>Start with the highest quality file you can get:</p>
            <ul>
              <li>WAV / AIFF preferred (44.1 or 48 kHz, 16/24-bit)</li>
              <li>Avoid heavily compressed MP3 if possible</li>
              <li>Pick a section with a clear groove (verse or chorus loop works well)</li>
              <li>Note the tempo (BPM) and time signature — you will need them later</li>
            </ul>
            <div className="docs-tip">
              <strong>Tip</strong>
              <p>
                If you already have a multi-track project with a dry drum bus, skip RX and export that
                bus as mono or stereo WAV. RX is for full mixes where drums are not separated.
              </p>
            </div>
          </section>

          <section id="rx12" className="docs-sec">
            <h2>2 · Isolate drums &amp; percussion with iZotope RX 12</h2>
            <p>
              Audio Phraser expects a focused rhythm loop — not a full song with vocals and bass.
              Use RX 12 to separate stems so the Live Audio channel is clean.
            </p>

            <h3>Recommended RX modules</h3>
            <ul>
              <li>
                <strong>Music Rebalance</strong> (fast) — boost Drums, reduce Vocals / Bass / Other
              </li>
              <li>
                <strong>Stem Separation</strong> (higher quality, RX Advanced) — export dedicated Drums stem
              </li>
              <li>
                Optional cleanup: <strong>Spectral De-noise</strong>, <strong>De-click</strong>, <strong>De-reverb</strong>
              </li>
            </ul>

            <h3>Step-by-step in RX 12</h3>
            <ol className="docs-steps">
              <li>Open RX 12 → <strong>File → Open</strong> your mix (or drag the file in).</li>
              <li>
                Select the loop region you want (e.g. 2, 4, or 8 bars). Use the time ruler and set
                a loop selection that starts on a downbeat.
              </li>
              <li>
                Open <strong>Music Rebalance</strong> (or <strong>Stem Separation</strong>):
                <ul>
                  <li>Set <em>Drums</em> to 100% (or Isolate)</li>
                  <li>Set <em>Vocals</em>, <em>Bass</em>, <em>Other</em> toward Mute / low levels</li>
                </ul>
              </li>
              <li>Preview. Listen for bleed (ghost vocals, bass notes). Adjust Sensitivity if available.</li>
              <li>
                Render / Process. If using Stem Separation, export the <strong>Drums</strong> stem only.
              </li>
              <li>
                Optional: run a light <strong>De-noise</strong> if the isolation left a hissy floor.
                Do not over-process — keep punch.
              </li>
            </ol>

            <div className="docs-callout warn">
              <strong>What to keep vs remove</strong>
              <p>
                Keep kick, snare, hats, percussion, and room. Remove lead vocals, melody instruments,
                and melodic bass if possible. A little harmonic bleed is OK; obvious sung lyrics are not.
              </p>
            </div>
          </section>

          <section id="export-stems" className="docs-sec">
            <h2>3 · Export clean stems for Audio Phraser</h2>
            <ol className="docs-steps">
              <li>
                Export as <strong>WAV</strong>, stereo or mono, 44.1 kHz or 48 kHz, 16-bit or 24-bit.
              </li>
              <li>
                Trim to an exact number of bars at a constant tempo (2 bars is a great starting point).
              </li>
              <li>
                Ensure the first sample is on the downbeat and the loop end connects smoothly
                (no click). Crossfade the loop ends in your DAW if needed.
              </li>
              <li>
                Name the file clearly, e.g. <code>Groove_125bpm_2bar_drums.wav</code>.
              </li>
            </ol>
            <div className="docs-tip">
              <strong>Tempo matching</strong>
              <p>
                If the original song is 124.7 BPM, either warp it to a round 125 BPM in your DAW or
                keep the exact tempo and enter that same BPM later in Audio Phraser and Style Studio.
              </p>
            </div>
          </section>

          <section id="audio-phraser" className="docs-sec">
            <h2>4 · Build a Live Audio Style (.aus) in Yamaha Audio Phraser</h2>
            <p>
              Yamaha Audio Phraser is the official tool that packages your drum audio into a Live Audio
              Style component the keyboard understands.
            </p>
            <ol className="docs-steps">
              <li>Install and open <strong>Yamaha Audio Phraser</strong> on your computer.</li>
              <li>Create a new project / style session.</li>
              <li>
                Import your cleaned drum WAV as the Live Audio source. Set:
                <ul>
                  <li>Tempo (BPM) to match your loop</li>
                  <li>Time signature (usually 4/4)</li>
                  <li>Bar length (1, 2, 4… matching your WAV)</li>
                </ul>
              </li>
              <li>
                Assign the audio to the appropriate style section if prompted (often <strong>Main A</strong>
                first). You can expand to other sections later.
              </li>
              <li>
                Preview inside Audio Phraser. Confirm the loop points, gain, and that the groove feels locked
                (see tempo &amp; stretching sections below before you export).
              </li>
              <li>
                <strong>Export / Save as Live Audio Style component</strong> → file extension{" "}
                <code>.aus</code>.
              </li>
            </ol>
            <div className="docs-callout">
              <strong>Why .aus matters</strong>
              <p>
                The <code>.aus</code> file contains the audio body (AASM / AWav / Adat / AInf) plus metadata
                Yamaha Style Studio lifts into the final keyboard <code>.sty</code>. Do not rename the
                extension or edit the binary in a text editor.
              </p>
            </div>
          </section>

          <section id="tempo-rhythm" className="docs-sec">
            <h2>4a · Fix tempo &amp; rhythm so Audio Phraser locks perfectly</h2>
            <p>
              If BPM or bar length is wrong, the keyboard will drift, cut the loop early, or feel “off”
              when you change style tempo. Get this right inside Audio Phraser before export.
            </p>

            <h3>Measure BPM before you open Audio Phraser</h3>
            <ol className="docs-steps">
              <li>
                In your DAW or a tap-tempo tool, confirm the loop’s real tempo (e.g. 125.0 BPM, not “about 125”).
              </li>
              <li>
                Count bars carefully: a 2-bar loop in 4/4 is 8 quarter notes. Wrong bar count is the most
                common cause of rhythm errors later.
              </li>
              <li>
                Prefer rounding only if you already time-stretched the WAV in the DAW to that exact BPM.
                Do not invent a BPM that the audio does not match.
              </li>
            </ol>

            <h3>Set tempo &amp; bars correctly in Audio Phraser</h3>
            <ol className="docs-steps">
              <li>
                After import, set <strong>Tempo (BPM)</strong> to the same value as your source loop.
              </li>
              <li>
                Set <strong>time signature</strong> (usually 4/4; use 3/4, 6/8, etc. only if the groove is truly that).
              </li>
              <li>
                Set <strong>number of bars</strong> to match the audio length exactly (1, 2, 4, 8…).
                If Audio Phraser shows a different length, fix bars or re-trim the WAV — do not force a mismatch.
              </li>
              <li>
                Align the <strong>start marker</strong> to the first downbeat (kick / snare grid).
                Zoom in: silence or a half-beat offset will make every fill and MIDI part feel late.
              </li>
              <li>
                Align the <strong>end marker</strong> so the loop repeats without a gap or double-hit.
                Play 4–8 loops in a row; the backbeat must stay steady.
              </li>
              <li>
                Use Audio Phraser’s metronome / click if available. The audio hits should land on the click,
                not float between beats.
              </li>
            </ol>

            <h3>Rhythm checklist (do this before export)</h3>
            <ul>
              <li>First sample = beat 1 of bar 1</li>
              <li>Loop length = exact whole bars at the set BPM</li>
              <li>No click, pop, or double kick at the loop seam</li>
              <li>Metronome stays locked for at least 8 continuous loops</li>
              <li>Same BPM will be used later in Style Studio project settings</li>
            </ul>

            <div className="docs-tip">
              <strong>Best practice</strong>
              <p>
                Fix tempo and length in your DAW first (trim + optional high-quality warp), then import into
                Audio Phraser with almost no further timing changes. Audio Phraser should confirm the groove,
                not repair a sloppy loop.
              </p>
            </div>
          </section>

          <section id="stretching" className="docs-sec">
            <h2>4b · Be careful when stretching audio in Audio Phraser</h2>
            <p>
              Audio Phraser can time-stretch audio to fit a tempo or bar length. Used lightly it is fine;
              used aggressively it ruins drums (smeared transients, rubbery kicks, flammed snares).
            </p>

            <h3>When stretching is OK</h3>
            <ul>
              <li>Very small corrections (about ±1–2% / a few BPM)</li>
              <li>Matching a loop that is already almost on tempo</li>
              <li>Tiny end-marker nudges after a good DAW export</li>
            </ul>

            <h3>When to avoid stretching</h3>
            <ul>
              <li>Large tempo jumps (e.g. 100 → 130 BPM) inside Audio Phraser</li>
              <li>Stretching to “fill” wrong bar counts instead of re-trimming the WAV</li>
              <li>Repeated re-stretch on the same clip (quality degrades each pass)</li>
              <li>Percussion-heavy loops where attack clarity is critical</li>
            </ul>

            <h3>Safe workflow (recommended)</h3>
            <ol className="docs-steps">
              <li>
                In your DAW, set project tempo to the target style BPM.
              </li>
              <li>
                Warp / elastic-audio the drum stem with a drum-friendly algorithm (transient / rhythmic mode).
              </li>
              <li>
                Bounce / export a new WAV at that exact tempo and exact bar length.
              </li>
              <li>
                Import into Audio Phraser and set the same BPM + bars — stretch amount should be near zero.
              </li>
              <li>
                If Audio Phraser still offers stretch, use the smallest adjustment possible and re-listen
                on headphones for smeared hi-hats or soft kicks.
              </li>
            </ol>

            <div className="docs-callout warn">
              <strong>Warning signs of over-stretching</strong>
              <p>
                Metallic or watery hats, flabby kick, “swimming” snare, loop that only sounds OK at one tempo,
                or groove that falls apart when you change style tempo on the keyboard. If you hear these,
                go back to the DAW, re-export a clean timed loop, and rebuild the <code>.aus</code>.
              </p>
            </div>

            <div className="docs-callout">
              <strong>Keyboard tempo changes</strong>
              <p>
                Arrangers will speed up / slow down Live Audio when the player changes style tempo.
                Starting from a clean, correctly timed <code>.aus</code> (minimal stretch) keeps the groove
                usable across a wider BPM range on PSR-SX / Genos.
              </p>
            </div>
          </section>

          <section id="import-studio" className="docs-sec">
            <h2>5 · Import the .aus into Yamaha Style Studio</h2>
            <ol className="docs-steps">
              <li>Open Yamaha Style Studio in your browser → <strong>Launch Studio</strong>.</li>
              <li>
                In <strong>Live Audio Style · .aus</strong>, drop your file or click to browse.
              </li>
              <li>
                Wait for parse + PCM decode. You should see tempo / bars detected and a waveform on the
                Live Audio track in the DAW preview.
              </li>
              <li>
                Check the Advanced inspector (optional) for chunks like AWav, Adat, AInf — confirms a valid export.
              </li>
            </ol>
            <p>
              All processing stays in your browser. The file is not uploaded to any server.
            </p>
          </section>

          <section id="midi-parts" className="docs-sec">
            <h2>6 · Add MIDI style parts</h2>
            <p>
              Live Audio covers drums. You still need MIDI for Bass, Chords, Pad, and Phrases so the
              keyboard can reharmonize when you play chords with your left hand.
            </p>
            <ol className="docs-steps">
              <li>
                Prepare short MIDI loops (same bar length / tempo as the AUS) in your DAW, or export
                individual tracks as <code>.mid</code>.
              </li>
              <li>
                Drop MIDI onto the studio lanes:
                <ul>
                  <li><strong>Bass</strong> → style channel 11</li>
                  <li><strong>Chord 1 / Chord 2</strong> → 12 / 13</li>
                  <li><strong>Pad</strong> → 14</li>
                  <li><strong>Phrase 1 / Phrase 2</strong> → 15 / 16</li>
                </ul>
              </li>
              <li>Pick GM / XG sounds from each lane’s sound menu for preview and export mapping.</li>
              <li>
                Use <strong>Fill</strong> to tile a short pattern to the AUS length, and <strong>Key</strong>
                tools to snap notes to a musical key if needed.
              </li>
            </ol>
            <div className="docs-tip">
              <strong>Writing for styles</strong>
              <p>
                Write MIDI in a neutral key (often C) with simple chordal patterns. The keyboard’s CASM
                rules transpose and re-voice parts when you play other chords on the instrument.
              </p>
            </div>
          </section>

          <section id="preview-edit" className="docs-sec">
            <h2>7 · Preview &amp; edit in the Live Studio</h2>
            <ul>
              <li><strong>Play / Stop</strong> — AUS audio + MIDI together with loop</li>
              <li><strong>Solo / Mute</strong> — isolate lanes while balancing the arrangement</li>
              <li><strong>Edit</strong> — full piano roll (draw, quantize, transpose, velocity)</li>
              <li><strong>Tempo</strong> — audition feel; final export uses your Style settings BPM</li>
              <li><strong>Style settings</strong> — name, category, time signature, sections</li>
            </ul>
          </section>

          <section id="export-sty" className="docs-sec">
            <h2>8 · Compile &amp; load on the keyboard</h2>
            <ol className="docs-steps">
              <li>Set style name, category, BPM, and sections under Project settings.</li>
              <li>Click <strong>Compile style</strong> then <strong>Download .sty</strong>.</li>
              <li>
                Copy the file to a USB stick (FAT32 recommended for many Yamaha models).
              </li>
              <li>
                On the keyboard: insert USB → Style → User / Expansion → load the style.
              </li>
              <li>
                Play left-hand chords and start Main A. You should hear Live Audio drums + MIDI parts.
              </li>
            </ol>
            <div className="docs-callout">
              <strong>What the exporter builds</strong>
              <p>
                SMF conductor with SFF2 / SInt markers → CASM (from AUS when present) → full AASM audio body.
                That structure is what keeps PSR-SX / Genos from rejecting the file.
              </p>
            </div>
          </section>

          <section id="checklist" className="docs-sec">
            <h2>Quick checklist</h2>
            <div className="docs-check">
              {[
                "Source audio selected and tempo known",
                "Drums / percussion isolated in RX 12 (or exported from multi-track)",
                "Loop trimmed to exact bars, no click at loop point",
                "WAV imported into Yamaha Audio Phraser",
                "BPM, time signature, and bar count match the audio exactly",
                "Loop start/end locked to downbeats; metronome stays in time",
                "No heavy time-stretch in Audio Phraser (prefer DAW warp if needed)",
                ".aus exported successfully from Audio Phraser",
                ".aus loaded in Yamaha Style Studio with visible waveform",
                "MIDI parts assigned to Bass / Chord / Pad / Phrase",
                "Preview sounds balanced; key / fill applied if needed",
                ".sty compiled and tested on keyboard via USB"
              ].map(item => (
                <label key={item} className="docs-check-item">
                  <span className="docs-check-box" />
                  {item}
                </label>
              ))}
            </div>
          </section>

          <section id="troubleshooting" className="docs-sec">
            <h2>Troubleshooting</h2>
            <div className="docs-faq">
              <div>
                <h3>Keyboard says “Data not loaded properly”</h3>
                <p>
                  The keyboard rejected the <code>.sty</code> structure. Fix checklist:
                </p>
                <ul>
                  <li>Use a complete Audio Phraser <code>.aus</code> (must contain AASM/AWav audio and ideally CASM).</li>
                  <li>Compile again in Style Studio — export now validates SFF2/SInt markers, CASM, and audio body before download.</li>
                  <li>In the build log, prefer <strong>CASM: lifted from .aus</strong>. If it says generated, re-export the AUS from Audio Phraser with CASM intact.</li>
                  <li>Copy the full file to USB (FAT32), load under Style → User / Expansion (not a truncated copy).</li>
                </ul>
              </div>
              <div>
                <h3>Drums sound muddy or full of vocals</h3>
                <p>
                  Re-run RX Stem Separation / Music Rebalance with stronger vocal suppression. Shorten the
                  loop to a cleaner section. Light high-pass on non-kick content can help.
                </p>
              </div>
              <div>
                <h3>MIDI does not line up with the audio loop</h3>
                <p>
                  Match BPM and bar count exactly. Use lane timing « » and Fill to AUS length. Quantize MIDI
                  to the same grid (16th / 8th) as your source groove.
                </p>
              </div>
              <div>
                <h3>Groove drifts or feels late on the keyboard</h3>
                <p>
                  Re-open Audio Phraser and verify BPM + bars against a metronome. Re-align start to the first
                  downbeat. Avoid large stretch; re-export a correctly timed WAV from your DAW, then rebuild
                  the <code>.aus</code>. Use the same BPM in Style Studio settings when compiling.
                </p>
              </div>
              <div>
                <h3>Drums sound smeared / rubbery after Audio Phraser</h3>
                <p>
                  That is usually over-stretching. Undo stretch or start over: warp in the DAW with a
                  transient-friendly algorithm, bounce a new WAV, import with near-zero stretch in Audio Phraser.
                </p>
              </div>
              <div>
                <h3>AUS won’t load in the studio</h3>
                <p>
                  Confirm the file ends with <code>.aus</code> and was exported by Audio Phraser. Try a
                  different browser if decode fails. Check the Advanced AUS inspector for warnings.
                </p>
              </div>
            </div>
          </section>

          <footer
            ref={footerReveal.ref}
            className={`docs-end anim-footer ${footerReveal.inView ? "is-in" : ""}`}
          >
            <p className="anim-footer-col">Ready to build?</p>
            <div className="docs-end-actions anim-footer-col">
              <button type="button" className="docs-btn docs-btn-solid" onClick={onLaunchStudio}>Launch Studio</button>
              <button type="button" className="docs-btn docs-btn-ghost" onClick={onHome}>Go to Home</button>
            </div>
          </footer>
        </article>
      </div>
    </div>
  );
}
