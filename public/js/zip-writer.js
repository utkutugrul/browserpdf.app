'use strict';

// Minimal stored (uncompressed) ZIP writer with zero dependencies, shared
// by the docx writer and the tools that bundle multiple downloads into one
// archive. Every unzip implementation can read stored entries.

/* ---------- CRC-32 (required by the ZIP format) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* ---------- Stored (uncompressed) ZIP writer ---------- */

// Fixed DOS timestamp (2026-01-01 00:00) so output is deterministic.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function zipStore(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v) => new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);

  for (const { name, data } of files) {
    const nameBytes = encoder.encode(name);
    const crc = crc32(data);
    const header = [
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), // sig, version, UTF-8 flag, stored
      u16(DOS_TIME), u16(DOS_DATE),
      u32(crc), u32(data.length), u32(data.length),
      u16(nameBytes.length), u16(0),
    ];
    central.push({ nameBytes, crc, size: data.length, offset });
    for (const part of header) chunks.push(part);
    chunks.push(nameBytes, data);
    offset += header.reduce((s, p) => s + p.length, 0) + nameBytes.length + data.length;
  }

  const centralStart = offset;
  for (const entry of central) {
    const rec = [
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0),
      u16(DOS_TIME), u16(DOS_DATE),
      u32(entry.crc), u32(entry.size), u32(entry.size),
      u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(entry.offset),
    ];
    for (const part of rec) chunks.push(part);
    chunks.push(entry.nameBytes);
    offset += rec.reduce((s, p) => s + p.length, 0) + entry.nameBytes.length;
  }
  chunks.push(
    u32(0x06054b50), u16(0), u16(0),
    u16(central.length), u16(central.length),
    u32(offset - centralStart), u32(centralStart), u16(0)
  );

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
