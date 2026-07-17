import { readFileSync, writeFileSync } from "fs";
import { parseSty } from "../src/lib/binary/styReader.ts";
import { walkStyleTopChunks, findSmfEnd, extractCasmFromAus, extractAudioBody, extractSectionsFromCasm, isValidCasm, validateStyleBytes } from "../src/lib/binary/sff2Writer.ts";
import { parseMidi } from "../src/lib/binary/midiParser.ts";
import { readFourCC, readU32BE } from "../src/lib/binary/bytes.ts";

const raw = new Uint8Array(readFileSync(new URL("../working demo sty.sty", import.meta.url)));
const lines = [];
const log = (...a) => lines.push(a.join(" "));

log("=== FILE ===");
log("size", String(raw.length));
log("format", String(raw[8]), String(raw[9]), "tracks", String((raw[10]<<8)|raw[11]), "tpq", String((raw[12]<<8)|raw[13]));
const smfEnd = findSmfEnd(raw);
log("smfEnd", String(smfEnd));

const tops = walkStyleTopChunks(raw);
log("=== TOP CHUNKS ===");
for (const c of tops) log(c.id, "off", String(c.offset), "size", String(c.size));

const casm = extractCasmFromAus(raw);
log("=== CASM ===");
log("valid", String(!!casm && isValidCasm(casm)), "len", String(casm?.length ?? 0));
if (casm) {
  log("sections", extractSectionsFromCasm(casm).join(" | "));
  let p = 8;
  const end = Math.min(casm.length, 8 + readU32BE(casm, 4));
  let cseg=0, ctb2=0, ctab=0;
  const sdecs = [];
  while (p+8<=end) {
    const id = readFourCC(casm,p); const sz=readU32BE(casm,p+4);
    if (id==="CSEG") {
      cseg++;
      let q=p+8, qend=p+8+sz;
      while (q+8<=qend) {
        const nid=readFourCC(casm,q); const nsz=readU32BE(casm,q+4);
        if (nid==="Ctb2") ctb2++;
        if (nid==="Ctab") ctab++;
        if (nid==="Sdec") sdecs.push(new TextDecoder("latin1").decode(casm.subarray(q+8,q+8+nsz)));
        q+=8+nsz;
      }
    }
    p+=8+sz;
  }
  log("CSEG", String(cseg), "Ctb2", String(ctb2), "Ctab", String(ctab));
  for (const s of sdecs) log("Sdec:", s);
}

const audio = extractAudioBody(raw);
log("=== AUDIO ===", audio ? audio.source + " " + audio.body.length : "none");

const aasm = tops.find(c=>c.id==="AASM");
if (aasm) {
  log("AASM full", String(aasm.full.length), "payload", String(aasm.size));
  const payload = raw.subarray(aasm.offset+8, aasm.offset+8+aasm.size);
  let i=0, n=0;
  while (i+8<=payload.length && n<40) {
    const id = String.fromCharCode(payload[i],payload[i+1],payload[i+2],payload[i+3]);
    const sz = readU32BE(payload, i+4);
    if (!/^[A-Za-z0-9 ]{4}$/.test(id) || sz < 0 || i+8+sz > payload.length) break;
    log(" nested", id, "sz", String(sz));
    i += 8+sz; n++;
  }
}

const opened = parseSty(raw);
log("=== PARSE ===");
log("name", opened.name, "bpm", String(opened.bpm), "ts", opened.timeSigNum+"/"+opened.timeSigDen);
log("sections", opened.sections.join(","));
log("hasCasm", String(opened.hasCasm), "hasAudio", String(opened.hasAudio));
log("midi tracks", String(opened.midi.tracks.length), "lenTicks", String(opened.midi.lengthTicks));
for (const t of opened.midi.tracks) {
  const notes = t.events.filter(e=>e.kind==="note-on" && e.velocity>0).length;
  log(" track", String(t.index), t.name||"-", "ch", t.channelsUsed.join(",")||"-", "notes", String(notes));
}

const v = validateStyleBytes(raw);
log("=== VALIDATE ===");
log(JSON.stringify(v));

const midi = parseMidi(raw.subarray(0, smfEnd));
const markers = [];
for (const t of midi.tracks) {
  for (const e of t.events) {
    if (e.kind==="meta" && e.type===0x06) markers.push({tick:e.tick, text:new TextDecoder("latin1").decode(e.data)});
  }
}
log("=== MARKERS ===", String(markers.length));
for (const m of markers.slice(0,50)) log(String(m.tick), m.text);

// Between SMF end and CASM?
log("bytes before CASM after smf", String((tops[0]?.offset??0) - smfEnd));
// Order of chunks
log("layout", tops.map(c=>c.id).join(" -> "));

writeFileSync(new URL("../tmp/demo-sty-analysis.txt", import.meta.url), lines.join("\n"));
console.log(lines.join("\n"));
