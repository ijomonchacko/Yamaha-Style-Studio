const fs = require("fs");
const b64 = fs.readFileSync("tmp/otsc.b64", "utf8").trim();
const lines = [];
for (let i = 0; i < b64.length; i += 96) lines.push(b64.slice(i, i + 96));
const b64Expr = lines.map((l, i) => (i === lines.length - 1 ? `  "${l}"` : `  "${l}" +`)).join("\n");
const body = `/** Default Yamaha OTSc (4 OTS slots) from known-good SFF2 style.
 * Style Editor crashes (SRJRRR) without a real OTSc after CASM on Live Audio styles.
 */
const B64 =
${b64Expr};

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/\\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Buf = (globalThis as any).Buffer;
  if (Buf) return new Uint8Array(Buf.from(clean, "base64"));
  throw new Error("No base64 decoder");
}

let cached: Uint8Array | null = null;

/** Full OTSc chunk including FourCC + size header. */
export function getDefaultOtsc(): Uint8Array {
  if (!cached) cached = b64ToBytes(B64);
  return new Uint8Array(cached);
}

export const DEFAULT_OTSC_SIZE = ${Buffer.from(b64, "base64").length};
`;
fs.writeFileSync("src/lib/binary/defaultOtsc.ts", body);
console.log("wrote defaultOtsc.ts", Buffer.from(b64, "base64").length, "bytes");
