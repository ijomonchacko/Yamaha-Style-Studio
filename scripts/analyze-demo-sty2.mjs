import { readFileSync } from "fs";
import { readFourCC, readU32BE } from "../src/lib/binary/bytes.ts";
import { findSmfEnd } from "../src/lib/binary/sff2Writer.ts";

const raw = new Uint8Array(readFileSync("working demo sty.sty"));
const smfEnd = findSmfEnd(raw);
console.log("size", raw.length, "smfEnd", smfEnd, "format", raw[8], raw[9], "tpq", (raw[12] << 8) | raw[13]);

// CASM hits
for (let i = 0; i < raw.length - 4; i++) {
  if (raw[i] === 0x43 && raw[i + 1] === 0x41 && raw[i + 2] === 0x53 && raw[i + 3] === 0x4d) {
    const sz = readU32BE(raw, i + 4);
    const end = i + 8 + sz;
    const next = end + 4 <= raw.length ? readFourCC(raw, end) : "?";
    console.log("CASM@", i, "size", sz, "end", end, "next", next, "inSMF?", i < smfEnd);
  }
}

console.log("at smfEnd", smfEnd, readFourCC(raw, smfEnd), readU32BE(raw, smfEnd + 4));
console.log("gap smfEnd..53085", smfEnd, "to", 53085, "len", 53085 - smfEnd);

// Walk from smfEnd with resync
let off = smfEnd;
let guard = 0;
console.log("=== walk from smfEnd ===");
while (off + 8 <= raw.length && guard++ < 20) {
  const id = readFourCC(raw, off);
  const sz = readU32BE(raw, off + 4);
  const plausible = /^[A-Za-z0-9 ]{4}$/.test(id) && sz >= 0 && off + 8 + sz <= raw.length;
  console.log(off, id, "sz", sz, "ok", plausible);
  if (!plausible) {
    // scan forward for known tags
    const tags = ["CASM", "OTSc", "MDB ", "AASM", "AWav", "AUDI", "AFil", "FNRc"];
    let best = -1;
    for (const t of tags) {
      for (let i = off + 1; i < Math.min(raw.length - 4, off + 5000); i++) {
        if (
          raw[i] === t.charCodeAt(0) &&
          raw[i + 1] === t.charCodeAt(1) &&
          raw[i + 2] === t.charCodeAt(2) &&
          raw[i + 3] === t.charCodeAt(3)
        ) {
          if (best < 0 || i < best) best = i;
          break;
        }
      }
    }
    if (best < 0) break;
    console.log("  resync ->", best, readFourCC(raw, best));
    off = best;
    continue;
  }
  off += 8 + sz;
}

// AASM + AFil
const aasm = 61822;
const afil = 62148;
console.log("AASM", readFourCC(raw, aasm), readU32BE(raw, aasm + 4));
console.log("AFil", readFourCC(raw, afil), readU32BE(raw, afil + 4));
// AFil first nested?
let p = afil + 8;
const end = Math.min(raw.length, afil + 8 + readU32BE(raw, afil + 4));
for (let n = 0; n < 15 && p + 8 <= end; n++) {
  const id = readFourCC(raw, p);
  const sz = readU32BE(raw, p + 4);
  if (!/^[A-Za-z0-9 ]{4}$/.test(id) || p + 8 + sz > end + 100) {
    console.log(" AFil raw head", [...raw.subarray(afil + 8, afil + 40)].map(b => b.toString(16).padStart(2, "0")).join(" "));
    break;
  }
  console.log(" AFil>", id, sz);
  p += 8 + sz;
}

// ContempRock comparison if present
try {
  const ref = new Uint8Array(readFileSync("public/ContempRock.S568.sty"));
  console.log("ContempRock size", ref.length, "fmt", ref[8], ref[9]);
  const se = findSmfEnd(ref);
  console.log("ContempRock smfEnd", se);
  off = se;
  guard = 0;
  console.log("=== ContempRock tops ===");
  while (off + 8 <= ref.length && guard++ < 15) {
    const id = readFourCC(ref, off);
    const sz = readU32BE(ref, off + 4);
    if (!/^[A-Za-z0-9 ]{4}$/.test(id) || off + 8 + sz > ref.length) break;
    console.log(off, id, sz);
    off += 8 + sz;
  }
} catch (e) {
  console.log("no ContempRock", e.message);
}
