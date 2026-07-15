/**
 * GM + Yamaha XG instrument list for PSR-SX920-compatible styles.
 * Preview uses FluidR3 GM (program 0–127). Export writes program-change
 * and optional XG bank select (CC0 MSB / CC32 LSB) for the keyboard.
 */

export const GM_PROGRAMS: readonly string[] = [
  "acoustic_grand_piano", "bright_acoustic_piano", "electric_grand_piano", "honkytonk_piano",
  "electric_piano_1", "electric_piano_2", "harpsichord", "clavinet",
  "celesta", "glockenspiel", "music_box", "vibraphone",
  "marimba", "xylophone", "tubular_bells", "dulcimer",
  "drawbar_organ", "percussive_organ", "rock_organ", "church_organ",
  "reed_organ", "accordion", "harmonica", "tango_accordion",
  "acoustic_guitar_nylon", "acoustic_guitar_steel", "electric_guitar_jazz", "electric_guitar_clean",
  "electric_guitar_muted", "overdriven_guitar", "distortion_guitar", "guitar_harmonics",
  "acoustic_bass", "electric_bass_finger", "electric_bass_pick", "fretless_bass",
  "slap_bass_1", "slap_bass_2", "synth_bass_1", "synth_bass_2",
  "violin", "viola", "cello", "contrabass",
  "tremolo_strings", "pizzicato_strings", "orchestral_harp", "timpani",
  "string_ensemble_1", "string_ensemble_2", "synth_strings_1", "synth_strings_2",
  "choir_aahs", "voice_oohs", "synth_choir", "orchestra_hit",
  "trumpet", "trombone", "tuba", "muted_trumpet",
  "french_horn", "brass_section", "synth_brass_1", "synth_brass_2",
  "soprano_sax", "alto_sax", "tenor_sax", "baritone_sax",
  "oboe", "english_horn", "bassoon", "clarinet",
  "piccolo", "flute", "recorder", "pan_flute",
  "blown_bottle", "shakuhachi", "whistle", "ocarina",
  "lead_1_square", "lead_2_sawtooth", "lead_3_calliope", "lead_4_chiff",
  "lead_5_charang", "lead_6_voice", "lead_7_fifths", "lead_8_bass__lead",
  "pad_1_new_age", "pad_2_warm", "pad_3_polysynth", "pad_4_choir",
  "pad_5_bowed", "pad_6_metallic", "pad_7_halo", "pad_8_sweep",
  "fx_1_rain", "fx_2_soundtrack", "fx_3_crystal", "fx_4_atmosphere",
  "fx_5_brightness", "fx_6_goblins", "fx_7_echoes", "fx_8_scifi",
  "sitar", "banjo", "shamisen", "koto",
  "kalimba", "bagpipe", "fiddle", "shanai",
  "tinkle_bell", "agogo", "steel_drums", "woodblock",
  "taiko_drum", "melodic_tom", "synth_drum", "reverse_cymbal",
  "guitar_fret_noise", "breath_noise", "seashore", "bird_tweet",
  "telephone_ring", "helicopter", "applause", "gunshot"
];

/** Friendly GM Level-1 names (same order as GM_PROGRAMS). */
export const GM_DISPLAY_NAMES: readonly string[] = [
  "Acoustic Grand Piano", "Bright Piano", "Electric Grand", "Honky-Tonk",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
  "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
  "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Nylon Guitar", "Steel Guitar", "Jazz Guitar", "Clean Guitar",
  "Muted Guitar", "Overdrive Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Finger Bass", "Pick Bass", "Fretless Bass",
  "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass",
  "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
  "Choir Aahs", "Voice Oohs", "Synth Choir", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
  "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
  "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute",
  "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Square Lead", "Saw Lead", "Calliope Lead", "Chiff Lead",
  "Charang Lead", "Voice Lead", "Fifths Lead", "Bass+Lead",
  "New Age Pad", "Warm Pad", "Polysynth Pad", "Choir Pad",
  "Bowed Pad", "Metallic Pad", "Halo Pad", "Sweep Pad",
  "Rain FX", "Soundtrack FX", "Crystal FX", "Atmosphere FX",
  "Brightness FX", "Goblins FX", "Echoes FX", "Sci-Fi FX",
  "Sitar", "Banjo", "Shamisen", "Koto",
  "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
  "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
  "Telephone", "Helicopter", "Applause", "Gunshot"
];

export type SoundBank = "GM" | "XG";

export interface StyleSound {
  id: string;
  name: string;
  /** GM program 0–127 (preview + base tone). */
  program: number;
  bank: SoundBank;
  /** XG bank select MSB (CC0). GM = 0. */
  msb: number;
  /** XG bank select LSB (CC32). GM = 0. */
  lsb: number;
  category: string;
}

/** Default for every style lane until the user picks another sound. */
export const DEFAULT_PIANO_PROGRAM = 0;
export const DEFAULT_PIANO_SOUND_ID = "gm-0";

/**
 * Curated GM + popular XG voices used on PSR-SX series.
 * XG entries keep a GM program for browser preview; bank MSB/LSB go into export.
 */
export const STYLE_SOUNDS: readonly StyleSound[] = [
  // —— Piano (default family) ——
  { id: "gm-0", name: "Grand Piano", program: 0, bank: "GM", msb: 0, lsb: 0, category: "Piano" },
  { id: "gm-1", name: "Bright Piano", program: 1, bank: "GM", msb: 0, lsb: 0, category: "Piano" },
  { id: "gm-2", name: "Electric Grand", program: 2, bank: "GM", msb: 0, lsb: 0, category: "Piano" },
  { id: "gm-4", name: "Electric Piano 1", program: 4, bank: "GM", msb: 0, lsb: 0, category: "Piano" },
  { id: "gm-5", name: "Electric Piano 2", program: 5, bank: "GM", msb: 0, lsb: 0, category: "Piano" },
  { id: "xg-piano-ballad", name: "Ballad Piano (XG)", program: 0, bank: "XG", msb: 0, lsb: 112, category: "Piano" },
  { id: "xg-piano-rock", name: "Rock Piano (XG)", program: 1, bank: "XG", msb: 0, lsb: 112, category: "Piano" },
  { id: "xg-cp80", name: "CP80 (XG)", program: 2, bank: "XG", msb: 0, lsb: 112, category: "Piano" },
  { id: "xg-dx-ep", name: "DX Electric Piano (XG)", program: 4, bank: "XG", msb: 0, lsb: 112, category: "Piano" },

  // —— Bass ——
  { id: "gm-32", name: "Acoustic Bass", program: 32, bank: "GM", msb: 0, lsb: 0, category: "Bass" },
  { id: "gm-33", name: "Finger Bass", program: 33, bank: "GM", msb: 0, lsb: 0, category: "Bass" },
  { id: "gm-34", name: "Pick Bass", program: 34, bank: "GM", msb: 0, lsb: 0, category: "Bass" },
  { id: "gm-35", name: "Fretless Bass", program: 35, bank: "GM", msb: 0, lsb: 0, category: "Bass" },
  { id: "gm-36", name: "Slap Bass", program: 36, bank: "GM", msb: 0, lsb: 0, category: "Bass" },
  { id: "gm-38", name: "Synth Bass 1", program: 38, bank: "GM", msb: 0, lsb: 0, category: "Bass" },
  { id: "gm-39", name: "Synth Bass 2", program: 39, bank: "GM", msb: 0, lsb: 0, category: "Bass" },
  { id: "xg-bass-finger", name: "Finger Bass (XG)", program: 33, bank: "XG", msb: 0, lsb: 40, category: "Bass" },
  { id: "xg-bass-pick", name: "Pick Bass (XG)", program: 34, bank: "XG", msb: 0, lsb: 40, category: "Bass" },

  // —— Guitar ——
  { id: "gm-24", name: "Nylon Guitar", program: 24, bank: "GM", msb: 0, lsb: 0, category: "Guitar" },
  { id: "gm-25", name: "Steel Guitar", program: 25, bank: "GM", msb: 0, lsb: 0, category: "Guitar" },
  { id: "gm-26", name: "Jazz Guitar", program: 26, bank: "GM", msb: 0, lsb: 0, category: "Guitar" },
  { id: "gm-27", name: "Clean Guitar", program: 27, bank: "GM", msb: 0, lsb: 0, category: "Guitar" },
  { id: "gm-29", name: "Overdrive Guitar", program: 29, bank: "GM", msb: 0, lsb: 0, category: "Guitar" },
  { id: "gm-30", name: "Distortion Guitar", program: 30, bank: "GM", msb: 0, lsb: 0, category: "Guitar" },
  { id: "xg-guitar-clean", name: "Clean Guitar (XG)", program: 27, bank: "XG", msb: 0, lsb: 24, category: "Guitar" },
  { id: "xg-guitar-mute", name: "Muted Guitar (XG)", program: 28, bank: "XG", msb: 0, lsb: 24, category: "Guitar" },

  // —— Strings / Pad ——
  { id: "gm-48", name: "String Ensemble", program: 48, bank: "GM", msb: 0, lsb: 0, category: "Strings" },
  { id: "gm-49", name: "String Ensemble 2", program: 49, bank: "GM", msb: 0, lsb: 0, category: "Strings" },
  { id: "gm-50", name: "Synth Strings", program: 50, bank: "GM", msb: 0, lsb: 0, category: "Strings" },
  { id: "gm-40", name: "Violin", program: 40, bank: "GM", msb: 0, lsb: 0, category: "Strings" },
  { id: "gm-42", name: "Cello", program: 42, bank: "GM", msb: 0, lsb: 0, category: "Strings" },
  { id: "gm-46", name: "Harp", program: 46, bank: "GM", msb: 0, lsb: 0, category: "Strings" },
  { id: "gm-88", name: "New Age Pad", program: 88, bank: "GM", msb: 0, lsb: 0, category: "Pad" },
  { id: "gm-89", name: "Warm Pad", program: 89, bank: "GM", msb: 0, lsb: 0, category: "Pad" },
  { id: "gm-91", name: "Choir Pad", program: 91, bank: "GM", msb: 0, lsb: 0, category: "Pad" },
  { id: "gm-94", name: "Halo Pad", program: 94, bank: "GM", msb: 0, lsb: 0, category: "Pad" },
  { id: "gm-52", name: "Choir Aahs", program: 52, bank: "GM", msb: 0, lsb: 0, category: "Pad" },
  { id: "xg-strings", name: "Orchestra Strings (XG)", program: 48, bank: "XG", msb: 0, lsb: 40, category: "Strings" },
  { id: "xg-warm-pad", name: "Warm Pad (XG)", program: 89, bank: "XG", msb: 0, lsb: 64, category: "Pad" },

  // —— Brass / Reed / Wind ——
  { id: "gm-56", name: "Trumpet", program: 56, bank: "GM", msb: 0, lsb: 0, category: "Brass" },
  { id: "gm-61", name: "Brass Section", program: 61, bank: "GM", msb: 0, lsb: 0, category: "Brass" },
  { id: "gm-60", name: "French Horn", program: 60, bank: "GM", msb: 0, lsb: 0, category: "Brass" },
  { id: "gm-65", name: "Alto Sax", program: 65, bank: "GM", msb: 0, lsb: 0, category: "Woodwind" },
  { id: "gm-66", name: "Tenor Sax", program: 66, bank: "GM", msb: 0, lsb: 0, category: "Woodwind" },
  { id: "gm-73", name: "Flute", program: 73, bank: "GM", msb: 0, lsb: 0, category: "Woodwind" },
  { id: "gm-71", name: "Clarinet", program: 71, bank: "GM", msb: 0, lsb: 0, category: "Woodwind" },
  { id: "gm-68", name: "Oboe", program: 68, bank: "GM", msb: 0, lsb: 0, category: "Woodwind" },
  { id: "xg-brass", name: "Big Brass (XG)", program: 61, bank: "XG", msb: 0, lsb: 40, category: "Brass" },
  { id: "xg-sax", name: "Alto Sax (XG)", program: 65, bank: "XG", msb: 0, lsb: 40, category: "Woodwind" },

  // —— Organ / Accordion ——
  { id: "gm-16", name: "Drawbar Organ", program: 16, bank: "GM", msb: 0, lsb: 0, category: "Organ" },
  { id: "gm-17", name: "Perc Organ", program: 17, bank: "GM", msb: 0, lsb: 0, category: "Organ" },
  { id: "gm-18", name: "Rock Organ", program: 18, bank: "GM", msb: 0, lsb: 0, category: "Organ" },
  { id: "gm-19", name: "Church Organ", program: 19, bank: "GM", msb: 0, lsb: 0, category: "Organ" },
  { id: "gm-21", name: "Accordion", program: 21, bank: "GM", msb: 0, lsb: 0, category: "Organ" },

  // —— Synth lead ——
  { id: "gm-80", name: "Square Lead", program: 80, bank: "GM", msb: 0, lsb: 0, category: "Synth" },
  { id: "gm-81", name: "Saw Lead", program: 81, bank: "GM", msb: 0, lsb: 0, category: "Synth" },
  { id: "gm-87", name: "Bass+Lead", program: 87, bank: "GM", msb: 0, lsb: 0, category: "Synth" },
  { id: "xg-saw", name: "Saw Lead (XG)", program: 81, bank: "XG", msb: 0, lsb: 64, category: "Synth" },

  // —— Ethnic / mallets ——
  { id: "gm-11", name: "Vibraphone", program: 11, bank: "GM", msb: 0, lsb: 0, category: "Mallets" },
  { id: "gm-12", name: "Marimba", program: 12, bank: "GM", msb: 0, lsb: 0, category: "Mallets" },
  { id: "gm-104", name: "Sitar", program: 104, bank: "GM", msb: 0, lsb: 0, category: "World" },
  { id: "gm-105", name: "Banjo", program: 105, bank: "GM", msb: 0, lsb: 0, category: "World" },
  { id: "gm-108", name: "Kalimba", program: 108, bank: "GM", msb: 0, lsb: 0, category: "World" }
];

export const SOUND_CATEGORIES: readonly string[] = [
  "Piano", "Bass", "Guitar", "Strings", "Pad", "Brass", "Woodwind", "Organ", "Synth", "Mallets", "World"
];

/** Sensible defaults — all piano until user changes (per request). */
export const ROLE_DEFAULT_PROGRAM: Record<number, number> = {
  10: DEFAULT_PIANO_PROGRAM,
  11: DEFAULT_PIANO_PROGRAM,
  12: DEFAULT_PIANO_PROGRAM,
  13: DEFAULT_PIANO_PROGRAM,
  14: DEFAULT_PIANO_PROGRAM,
  15: DEFAULT_PIANO_PROGRAM
};

export const ROLE_DEFAULT_SOUND_ID: Record<string, string> = {
  "Bass": DEFAULT_PIANO_SOUND_ID,
  "Chord 1": DEFAULT_PIANO_SOUND_ID,
  "Chord 2": DEFAULT_PIANO_SOUND_ID,
  "Pad": DEFAULT_PIANO_SOUND_ID,
  "Phrase 1": DEFAULT_PIANO_SOUND_ID,
  "Phrase 2": DEFAULT_PIANO_SOUND_ID
};

export function gmProgramName(program: number): string {
  const p = ((program % 128) + 128) % 128;
  return GM_PROGRAMS[p] ?? "acoustic_grand_piano";
}

export function gmDisplayName(program: number): string {
  const p = ((program % 128) + 128) % 128;
  return GM_DISPLAY_NAMES[p] ?? `Program ${p + 1}`;
}

export function findSound(id: string | undefined | null): StyleSound {
  return STYLE_SOUNDS.find(s => s.id === id) ?? STYLE_SOUNDS[0];
}

export function soundsByCategory(): { category: string; sounds: StyleSound[] }[] {
  return SOUND_CATEGORIES.map(category => ({
    category,
    sounds: STYLE_SOUNDS.filter(s => s.category === category)
  })).filter(g => g.sounds.length > 0);
}
