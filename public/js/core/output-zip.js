import { outputBudget, MAX_ZIP_BYTES } from './page-split.js';
const table = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
// Stored ZIP, bounded and yielding during both CRC and array assembly. A cancelled
// archive never reaches the adapter's explicit download action.
export async function createOutputZip(results, { signal, onProgress } = {}) {
  outputBudget(results); signal?.throwIfAborted();
  const encoder = new TextEncoder(), entries = results.map((item) => ({ ...item, nameBytes: encoder.encode(item.name) }));
  const total = entries.reduce((n, item) => n + item.bytes.length + 76 + 2 * item.nameBytes.length, 22);
  if (total > MAX_ZIP_BYTES) throw new RangeError('The complete ZIP exceeds 100 MiB.');
  const out = new Uint8Array(total), view = new DataView(out.buffer); let offset = 0;
  const u16 = (value) => { view.setUint16(offset, value, true); offset += 2; };
  const u32 = (value) => { view.setUint32(offset, value, true); offset += 4; };
  async function copy(bytes) { for (let start = 0; start < bytes.length; start += 1048576) { signal?.throwIfAborted(); const chunk = bytes.subarray(start, start + 1048576); out.set(chunk, offset); offset += chunk.length; await pause(); } }
  for (const [index, item] of entries.entries()) {
    let crc = 0xffffffff;
    for (let start = 0; start < item.bytes.length; start += 262144) { signal?.throwIfAborted(); for (let j = start; j < Math.min(item.bytes.length, start + 262144); j++) crc = table[(crc ^ item.bytes[j]) & 255] ^ crc >>> 8; await pause(); }
    item.crc = (crc ^ 0xffffffff) >>> 0; item.offset = offset;
    u32(0x04034b50); u16(20); u16(0x800); u16(0); u16(0); u16(23585); u32(item.crc); u32(item.bytes.length); u32(item.bytes.length); u16(item.nameBytes.length); u16(0);
    await copy(item.nameBytes); await copy(item.bytes); onProgress?.((index + 1) / entries.length * 95);
  }
  const central = offset;
  for (const item of entries) { signal?.throwIfAborted(); u32(0x02014b50); u16(20); u16(20); u16(0x800); u16(0); u16(0); u16(23585); u32(item.crc); u32(item.bytes.length); u32(item.bytes.length); u16(item.nameBytes.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(item.offset); await copy(item.nameBytes); }
  const centralSize = offset - central;
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(centralSize); u32(central); u16(0);
  signal?.throwIfAborted(); onProgress?.(100); return out;
}
