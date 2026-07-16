/**
 * Offline fixture: build a synthetic AUS+MIDI style and validate structure.
 * Run: node scripts/validate-export.mjs  (via npm run test:export → tsx)
 */
import { pathToFileURL } from "url";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (rel) => import(pathToFileURL(join(root, rel)).href);

const { buildStyle } = await load("src/lib/binary/styleStitcher.ts");
const { parseAus } = await load("src/lib/binary/ausParser.ts");
const { parseMidi, buildSmf1 } = await load("src/lib/binary/midiParser.ts");
const {
  validateStyleBytes,
  walkStyleTopChunks,
  findSmfEnd,
  isValidCasm,
  buildCasm,
  DEFAULT_CHANNELS,
  FULL_SECTION_LIST
} = await load("src/lib/binary/sff2Writer.ts");
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

// ContempRock reference (MIDI-only style — no audio expected)
const styPath = join(root, "public/ContempRock.S568.sty");
try {
  const sty = new Uint8Array(readFileSync(styPath));
  const v = validateStyleBytes(sty);
  assert(v.hasSff2 && v.hasSInt, "ContempRock has SFF markers");
  assert(v.hasCasm, "ContempRock has CASM");
  assert(findSmfEnd(sty) > 0, "ContempRock SMF end");
} catch (e) {
  console.warn("Skip ContempRock:", e.message);
}

const casm = buildCasm({ sections: FULL_SECTION_LIST, channels: DEFAULT_CHANNELS });
assert(isValidCasm(casm), "generated CASM valid");

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
  preferAusCasm: true
});

assert(built.validation.ok, "build validation ok");
assert(built.casmSource === "aus", "CASM lifted from AUS");
assert(built.mdbSize > 0, "MDB written");
assert(built.otscSize > 0, "OTSc written");
assert(readFourCC(built.styBytes, 0) === "MThd", "starts with MThd");

const tops = walkStyleTopChunks(built.styBytes).map(c => c.id);
assert(tops.includes("CASM") && tops.includes("AASM"), "CASM + AASM present");
assert(tops.includes("MDB ") || tops.includes("MDB"), "MDB present");
assert(tops.includes("OTSc"), "OTSc present");

const outDir = join(root, "tmp");
try { mkdirSync(outDir, { recursive: true }); } catch { /* */ }
writeFileSync(join(outDir, "fixture.sty"), built.styBytes);
console.log("Wrote tmp/fixture.sty", built.styBytes.length, "bytes");
console.log("Layout:", tops.join(" → "));

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll export fixture checks passed.");
