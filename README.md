# Yamaha Style Studio

Browser app to design, edit, and export **Yamaha PSR-SX / Genos** arranger styles from Live Audio Styles (`.aus`) and MIDI.

Files never leave your device — all parse / compile runs client-side.

## Quick start

```bash
npm install
npm run dev
```

Open the studio route, then:

1. Drop a **`.aus`** (Audio Phraser) or open an existing **`.sty`**
2. Drop **`.mid`** files (multi-track SMFs expand to multiple lanes)
3. Route Bass / Chord / Pad / Phrase → channels 11–16
4. Preview, edit piano roll, set name / tempo / sections
5. **Compile** → **Download `.sty`** → USB → Style → User

Project files: **Save / Load** (`.yssproj`) or autosave in IndexedDB. Shortcuts: `Space` play/stop · `Ctrl/Cmd+Z` undo · `Ctrl/Cmd+S` save project.

## Keyboard export (SFF2)

Compiled structure:

```
MThd/MTrk (SFF2 + SInt + timed section markers + MIDI)
→ CASM (lifted from AUS when valid, else generated Ctb2)
→ AASM… audio body (byte-preserved from AUS)
→ MDB (name, category, tempo)
→ OTSc (empty One-Touch slots)
```

Export validates structure before download. Prefer **CASM lifted from AUS**. Optional checkbox **Require AUS CASM** blocks generated fallback.

If the keyboard says **“Data not loaded properly”**:

- Re-export a complete `.aus` from Audio Phraser (with CASM + AASM)
- Confirm build log shows validation OK and CASM source
- Copy the full file to FAT32 USB; load from User memory

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:export` | Fixture structure validation |

## Targets & limits

- **Targets:** PSR-SX / Genos-class SFF2 audio styles
- **Sections:** markers + per-lane section assignment; one AUS audio body for the style
- **Not full multipad / OTS designer** — empty OTSc slots only
- Preview uses GM SoundFonts (`smplr`); offline needs network once for fonts

## License

See `LICENSE`.
