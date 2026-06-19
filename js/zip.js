// Minimal, dependency-free ZIP writer (STORE / no compression).
// Enough to assemble a valid .docx (which is just a ZIP with a fixed layout).
// Works in the browser and in Node (uses Uint8Array / TextEncoder only).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();
export function toBytes(input) {
  return typeof input === "string" ? enc.encode(input) : input;
}

// entries: [{ name: string, data: Uint8Array | string }]
export function makeZip(entries) {
  const files = entries.map((e) => {
    const data = toBytes(e.data);
    return { name: enc.encode(e.name), data, crc: crc32(data) };
  });

  const chunks = [];
  const central = [];
  let offset = 0;

  const u16 = (n) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n) =>
    new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  for (const f of files) {
    const local = concat([
      u32(0x04034b50), // local file header signature
      u16(20), u16(0), u16(0), // version, flags, method(STORE=0)
      u16(0), u16(0), // mod time/date
      u32(f.crc),
      u32(f.data.length), u32(f.data.length), // comp / uncomp size
      u16(f.name.length), u16(0), // name len, extra len
      f.name,
      f.data,
    ]);
    central.push(
      concat([
        u32(0x02014b50), // central dir header signature
        u16(20), u16(20), u16(0), u16(0),
        u16(0), u16(0),
        u32(f.crc),
        u32(f.data.length), u32(f.data.length),
        u16(f.name.length), u16(0), u16(0),
        u16(0), u16(0), u32(0),
        u32(offset),
        f.name,
      ])
    );
    chunks.push(local);
    offset += local.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) {
    chunks.push(c);
    centralSize += c.length;
  }

  const eocd = concat([
    u32(0x06054b50), // end of central directory signature
    u16(0), u16(0),
    u16(files.length), u16(files.length),
    u32(centralSize), u32(centralStart),
    u16(0),
  ]);
  chunks.push(eocd);

  return concat(chunks);
}

function concat(arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let p = 0;
  for (const a of arrays) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
