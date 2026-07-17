/**
 * Offline fixture suite for AUS→STY / STY re-export.
 * Run: npm run test:export
 */
import { pathToFileURL } from "url";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(pathToFileURL(join(root, rel)).href);

const { buildStyle, styleChannelToMidi, PSR_STYLE_CHANNEL_MAP } = await load(
  "src/lib/binary/styleStitcher.ts"
);
const { parseAus } = await load("src/lib/binary/ausParser.ts");
const { parseMidi, buildSmf1, splitMidiByChannel } = await load("src/lib/binary/midiParser.ts");
const {
  validateStyleBytes,
  walkStyleTopChunks,
  findSmfEnd,
  isValidCasm,
  buildCasm,
  DEFAULT_CHANNELS,
  FULL_SECTION_LIST,
  extractCasmFromAus,
  extractAudioBody,
  extractForumAudioBody,
  extractSectionsFromCasm,
  isCompleteStyleCarrier,
  findEffectiveSmfEnd
} = await load("src/lib/binary/sff2Writer.ts");
const { parseSty, suggestRoleForTrack } = await load("src/lib/binary/styReader.ts");
const { writeVLQ, concat, tag, writeU32BE, readFourCC } = await load("src/lib/binary/bytes.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

// —— 1. CASM channel map (Yamaha PSR style) ——
assert(DEFAULT_CHANNELS.length === 8, "DEFAULT_CHANNELS has 8 roles");
assert(DEFAULT_CHANNELS[0].role === "Rhythm Sub" && DEFAULT_CHANNELS[0].midiChannel === 8, "Rhy Sub ch 8");
assert(DEFAULT_CHANNELS[1].role === "Rhythm Main" && DEFAULT_CHANNELS[1].midiChannel === 9, "Rhy Main ch 9");
assert(DEFAULT_CHANNELS[2].role === "Bass" && DEFAULT_CHANNELS[2].midiChannel === 10, "Bass ch 10");
assert(styleChannelToMidi(10) === 9, "PSR 10 → MIDI 9 (Rhy Main)");
assert(styleChannelToMidi(11) === 10, "PSR 11 → MIDI 10 (Bass)");
assert(PSR_STYLE_CHANNEL_MAP.length === 8, "PSR map has 8 entries");

// —— 2. ContempRock STY open + channel split ——
const styPath = join(root, "public/ContempRock.S568.sty");
const styRaw = new Uint8Array(readFileSync(styPath));
const opened = parseSty(styRaw);
assert(opened.hasCasm, "ContempRock has CASM");
assert(opened.midi.tracks.length >= 6, `ContempRock split into parts (got ${opened.midi.tracks.length})`);
assert(suggestRoleForTrack(1, [9]) === "Rhythm 1", "ch9 → Rhythm 1");
assert(suggestRoleForTrack(1, [8]) === "Rhythm 2", "ch8 → Rhythm 2");
assert(suggestRoleForTrack(1, [10]) === "Bass", "ch10 → Bass");

const vRef = validateStyleBytes(styRaw);
assert(vRef.hasSff2 || vRef.hasSInt || findSmfEnd(styRaw) > 0, "ContempRock SMF parseable");
assert(vRef.hasCasm, "ContempRock CASM validates");

// —— 3. Generated CASM structure ——
const casm = buildCasm({ sections: FULL_SECTION_LIST, channels: DEFAULT_CHANNELS });
assert(isValidCasm(casm), "generated CASM valid");

// —— 4. Synthetic AUS → STY build ——
function makeSmfWithMarkers() {
  const body = concat([
    new Uint8Array([0x00, 0xff, 0x58, 0x04, 4, 2, 24, 8]),
    new Uint8Array([0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]),
    new Uint8Array([0x00, 0xff, 0x06, 0x04, 0x53, 0x46, 0x46, 0x32]),
    new Uint8Array([0x00, 0xff, 0x06, 0x04, 0x53, 0x49, 0x6e, 0x74]),
    new Uint8Array([0x00, 0xff, 0x2f, 0x00])
  ]);
  return buildSmf1([body], 480);
}

const aasm = concat([tag("AASM"), writeU32BE(128), new Uint8Array(128)]);
const fakeAus = concat([makeSmfWithMarkers(), casm, aasm]);
const aus = parseAus(fakeAus);

const noteTrack = concat([
  writeVLQ(0), new Uint8Array([0x90, 60, 100]),
  writeVLQ(480), new Uint8Array([0x80, 60, 0]),
  writeVLQ(0), new Uint8Array([0xff, 0x2f, 0x00])
]);
const midi = parseMidi(buildSmf1([noteTrack], 480));

const built = buildStyle({
  name: "FixtureStyle",
  category: "Pop&Rock",
  bpm: 120,
  timeSigNum: 4,
  timeSigDen: 4,
  sections: ["Main A", "Main B"],
  ticksPerQuarter: 480,
  sectionBars: 4,
  aus,
  tracks: [{
    sourceName: "t.mid",
    track: midi.tracks[0],
    targetChannel: 11,
    role: "Bass",
    program: 33,
    volume: 100,
    pan: 64
  }],
  includeMdb: true,
  includeOtsc: true,
  preferAusCasm: true,
  requireAusCasm: true
});

assert(built.validation.ok, "build validation ok");
assert(built.casmSource === "aus", "CASM lifted from AUS");
// Live Audio path: SMF Format 0 + CASM + AASM only (no synthetic MDB/OTSc after AASM→EOF)
assert(readFourCC(built.styBytes, 0) === "MThd", "starts with MThd");
assert(built.styBytes[8] === 0 && built.styBytes[9] === 0, "SMF Format 0 (Yamaha)");

const tops = walkStyleTopChunks(built.styBytes).map(c => c.id);
assert(tops.includes("CASM") && tops.includes("AASM"), "CASM + AASM present");
assert(built.log.some(l => l.includes("Format 0")), "build log reports Format 0");

// —— 5. Fail-closed without CASM ——
let threw = false;
try {
  const noCasmAus = parseAus(concat([makeSmfWithMarkers(), aasm]));
  buildStyle({
    name: "Bad",
    category: "Pop&Rock",
    bpm: 120,
    timeSigNum: 4,
    timeSigDen: 4,
    sections: ["Main A"],
    ticksPerQuarter: 480,
    aus: noCasmAus,
    tracks: [{
      sourceName: "t.mid",
      track: midi.tracks[0],
      targetChannel: 11,
      role: "Bass",
      program: 0
    }],
    requireAusCasm: true
  });
} catch {
  threw = true;
}
assert(threw, "export without CASM throws when requireAusCasm");

// —— 6. STY re-export preserve post-SMF ——
const re = buildStyle({
  name: "Reexport",
  category: "Pop&Rock",
  bpm: opened.bpm,
  timeSigNum: opened.timeSigNum,
  timeSigDen: opened.timeSigDen,
  sections: opened.sections,
  ticksPerQuarter: opened.midi.ticksPerQuarter,
  sectionBars: 4,
  aus: opened.aus,
  tracks: opened.midi.tracks.slice(0, 4).map((t, i) => ({
    sourceName: t.name,
    track: t,
    targetChannel: (t.channelsUsed[0] ?? 10) + 1,
    role: "Bass",
    program: 0
  })),
  preferAusCasm: true,
  requireAusCasm: true,
  preservePostSmfFrom: styRaw
});
assert(re.validation.hasCasm, "re-export preserves CASM");
const reTops = walkStyleTopChunks(re.styBytes).map(c => c.id);
assert(reTops.includes("CASM"), "re-export has CASM chunk");
assert(re.styBytes.length > styRaw.length * 0.5, "re-export size reasonable");

// —— 7. SMF-0 split ——
const split = splitMidiByChannel(parseMidi(styRaw.subarray(0, findSmfEnd(styRaw))));
assert(split.tracks.length >= 6, `splitMidiByChannel → ${split.tracks.length} tracks`);

// —— 8. extract helpers ——
assert(!!extractCasmFromAus(styRaw), "extractCasmFromAus on ContempRock");
// ContempRock may have no AASM — that is OK for MIDI-only styles
const audio = extractAudioBody(styRaw);
console.log("INFO: ContempRock audio body", audio ? `${audio.source} ${audio.body.length}B` : "none");

const outDir = join(root, "tmp");
try { mkdirSync(outDir, { recursive: true }); } catch { /* */ }
// —— 9. Blank AUS → STY (forum-safe, no MIDI) ——
assert(isCompleteStyleCarrier(fakeAus), "synthetic complete AUS carrier");
const casmSecs = extractSectionsFromCasm(casm);
assert(casmSecs.length >= 4, `CASM Sdec sections parsed (${casmSecs.length})`);
const blank = buildStyle({
  name: "BlankConvert",
  category: "Pop&Rock",
  bpm: 120,
  timeSigNum: 4,
  timeSigDen: 4,
  sections: ["Main A"],
  ticksPerQuarter: 480,
  sectionBars: 4,
  aus,
  tracks: [],
  preferAusCasm: true,
  requireAusCasm: true,
  blankAusConvert: true,
  forumSafe: true
});
assert(blank.validation.ok, "blank AUS convert validates");
assert(blank.casmSource === "aus", "blank convert uses source CASM");
assert(
  blank.log.some(l => l.includes("byte-stable") || l.includes("AUS only") || l.includes("Blank convert")),
  "blank convert is AUS-only"
);
// Must not be larger than AUS by demo-template bloat
assert(blank.styBytes.length <= fakeAus.length + 4096, "blank convert not bloated by demo STY");

// —— 10. With timeline MIDI: forum-safe AUS CASM + audio + only user MIDI ——
const withMidi = buildStyle({
  name: "Aligned",
  category: "Pop&Rock",
  bpm: 120,
  timeSigNum: 4,
  timeSigDen: 4,
  sections: ["Main A"],
  ticksPerQuarter: 480,
  sectionBars: 4,
  aus,
  tracks: [{
    sourceName: "t.mid",
    track: midi.tracks[0],
    targetChannel: 11,
    role: "Bass",
    program: 33
  }],
  preferAusCasm: true,
  requireAusCasm: true,
  forumSafe: true
});
assert(withMidi.validation.ok, "MIDI+AUS AUS-only ok");
assert(withMidi.casmSource === "aus", "with MIDI still uses AUS CASM");
assert(
  withMidi.log.some(l => l.includes("Timeline MIDI") || l.includes("AUS only") || l.includes("AUS-only")),
  "MIDI path is AUS-only (no demo graft)"
);
assert(
  withMidi.log.some(l => l.includes("Timeline MIDI") || l.includes("parts")),
  "timeline MIDI mentioned in log"
);

// —— 11. Forum audio helpers + working demo sty (if present) ——
assert(!!extractForumAudioBody(fakeAus), "extractForumAudioBody on synthetic AUS");
try {
  const demoPath = join(root, "working demo sty.sty");
  const demoRaw = new Uint8Array(readFileSync(demoPath));
  const demoAudio = extractForumAudioBody(demoRaw) || extractAudioBody(demoRaw);
  assert(!!demoAudio, "working demo has AASM/AFil audio");
  assert(demoAudio.source.includes("AASM") || demoAudio.source.includes("AFil"), "demo audio source tag");
  const demoCasm = extractCasmFromAus(demoRaw);
  assert(!!demoCasm && isValidCasm(demoCasm), "working demo CASM valid");
  const eff = findEffectiveSmfEnd(demoRaw);
  assert(eff > 0, `findEffectiveSmfEnd on demo (${eff})`);
  console.log("INFO: working demo audio", demoAudio.source, demoAudio.body.length, "casm", demoCasm.length, "smfEff", eff);
} catch (e) {
  console.log("INFO: working demo sty not tested:", e.message || e);
}

writeFileSync(join(outDir, "fixture.sty"), built.styBytes);
writeFileSync(join(outDir, "reexport.sty"), re.styBytes);
writeFileSync(join(outDir, "blank.sty"), blank.styBytes);
console.log("Wrote tmp/fixture.sty", built.styBytes.length, "bytes");
console.log("Wrote tmp/reexport.sty", re.styBytes.length, "bytes");
console.log("Wrote tmp/blank.sty", blank.styBytes.length, "bytes");
console.log("AUS layout:", tops.join(" → "));
console.log("Re-export layout:", reTops.join(" → "));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll export fixture checks passed.");
