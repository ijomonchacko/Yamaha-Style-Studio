/**
 * Low-level byte helpers used by the AUS / MIDI / SFF2 parsers.
 * Everything is browser-safe and works on plain Uint8Array buffers.
 */

export type Bytes = Uint8Array;

export function ascii(...chars: string[]): number[] {
  const out: number[] = [];
  for (const c of chars) for (let i = 0; i < c.length; i++) out.push(c.charCodeAt(i) & 0xff);
  return out;
}

export function tag(fourCC: string): Bytes {
  if (fourCC.length !== 4) throw new Error(`FourCC must be 4 chars: "${fourCC}"`);
  return new Uint8Array([
    fourCC.charCodeAt(0), fourCC.charCodeAt(1),
    fourCC.charCodeAt(2), fourCC.charCodeAt(3)
  ]);
}

export function readFourCC(buf: Bytes, off: number): string {
  return String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
}

/** Big-endian 32-bit reader (SMF / SFF chunks). */
export function readU32BE(buf: Bytes, off: number): number {
  return (
    ((buf[off] << 24) >>> 0) +
    (buf[off + 1] << 16) +
    (buf[off + 2] << 8) +
    buf[off + 3]
  ) >>> 0;
}
export function writeU32BE(v: number): Bytes {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

export function readU16BE(buf: Bytes, off: number): number {
  return ((buf[off] << 8) | buf[off + 1]) & 0xffff;
}
export function writeU16BE(v: number): Bytes {
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}

/** SMF variable-length quantity. */
export function readVLQ(buf: Bytes, off: number): { value: number; size: number } {
  let value = 0, size = 0, byte = 0;
  do {
    byte = buf[off + size++];
    value = (value << 7) | (byte & 0x7f);
    if (size > 4) throw new Error("VLQ overflow");
  } while (byte & 0x80);
  return { value, size };
}
export function writeVLQ(value: number): Bytes {
  if (value < 0) throw new Error("VLQ must be non-negative");
  const stack = [value & 0x7f];
  value >>>= 7;
  while (value > 0) {
    stack.unshift((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  return new Uint8Array(stack);
}

/** Concat many Uint8Array pieces into one. */
export function concat(parts: Bytes[]): Bytes {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Naive but fast substring search of `needle` inside `hay` starting at `from`. */
export function findBytes(hay: Bytes, needle: Bytes, from = 0): number {
  const n = needle.length;
  const end = hay.length - n;
  outer: for (let i = from; i <= end; i++) {
    for (let j = 0; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** All match indices of `needle` inside `hay`. */
export function findAllBytes(hay: Bytes, needle: Bytes): number[] {
  const hits: number[] = [];
  let from = 0;
  while (true) {
    const i = findBytes(hay, needle, from);
    if (i < 0) break;
    hits.push(i);
    from = i + 1;
  }
  return hits;
}

/** Hex dump for the debug drawer. */
export function hexDump(buf: Bytes, maxBytes = 512): string {
  const n = Math.min(buf.length, maxBytes);
  const lines: string[] = [];
  for (let i = 0; i < n; i += 16) {
    const slice = buf.subarray(i, Math.min(i + 16, n));
    const hex = Array.from(slice, b => b.toString(16).padStart(2, "0")).join(" ");
    const asc = Array.from(slice, b => (b >= 32 && b < 127 ? String.fromCharCode(b) : ".")).join("");
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex.padEnd(48, " ")}  ${asc}`);
  }
  if (buf.length > n) lines.push(`… ${buf.length - n} more bytes`);
  return lines.join("\n");
}

export async function fileToBytes(file: File): Promise<Bytes> {
  return new Uint8Array(await file.arrayBuffer());
}

export function downloadBytes(name: string, bytes: Bytes, mime = "application/octet-stream") {
  // Ensure the underlying buffer is a plain ArrayBuffer (not SharedArrayBuffer),
  // which is what the Blob() BlobPart type requires under strict TS DOM libs.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
