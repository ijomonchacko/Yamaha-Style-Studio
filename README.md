# Yamaha Style Studio

Browser app to design, edit, and export **Yamaha PSR-SX / Genos / SX920** arranger styles from Live Audio Styles (`.aus`) and MIDI.

Files never leave your device — all parse / compile runs client-side.

## Quick start

```bash
npm install
npm run dev
```

1. Drop a **`.aus`** (Audio Phraser) or open an existing **`.sty`**
2. Optionally drop **`.mid`** files onto timeline lanes (Bass / Chord / Pad / Phrase)
3. Preview, set name / tempo
4. **Compile .sty** → **Download** → USB → Style → User

## AUS → STY layout (default)

```
SMF Format 0 (SFF2 + SInt [+ optional timeline MIDI only])
→ CASM (from your .aus only)
→ AASM / AFil (Live Audio from your .aus only)
```

| Source | Used? |
|--------|--------|
| Your `.aus` CASM | Yes |
| Your `.aus` AASM / AFil / AWav | Yes |
| Timeline MIDI you assigned | Only if present |
| Demo / template MIDI channels | **Never** |

- **AUS only** (no MIDI lanes) → pure Live Audio `.sty`
- **AUS + timeline MIDI** → Live Audio + your parts only

Build log should include:

- `CASM: lifted from AUS only`
- `Audio (AUS only): AASM→EOF` or `AFil…`
- `No demo STY MIDI channels included`

### Why not “demo STY + append AUS”?

Older converters inject a full working template style (all 8 channels + CASM) then append AUS audio. That pollutes the file with foreign MIDI and often causes channel clash or wrong CASM pairing. We never do that.

## Keyboard export validation

Export validates structure before download. Prefer **Require source CASM** (on by default).

If the keyboard says **“Data not loaded properly”**:

- Re-export a complete `.aus` from Audio Phraser (CASM + AASM/AFil)
- Confirm build log: CASM from AUS + AASM/AFil audio
- Copy the full file to FAT32 USB; load from User memory

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:export` | Fixture + structure tests |

## Targets & limits

- **Targets:** PSR-SX / Genos / SX920 SFF2 Live Audio styles
- **Sections:** timeline section pills; CASM Sdec aligned when lifted from AUS
- Preview uses GM SoundFonts (`smplr`); offline needs network once for fonts

## License

See `LICENSE`.
