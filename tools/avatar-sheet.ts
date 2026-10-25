// Lays PNGs made by tools/avatar-preview.ts side by side (a row) and one row under another, for the before/after pictures in docs/.
//   node --disable-warning=ExperimentalWarning tools/avatar-sheet.ts <out.png> <a.png,b.png,...> [<c.png,d.png> ...]   each argument is a row
import fs from 'node:fs'; import zlib from 'node:zlib';
function decode(file: string) {
  const b = fs.readFileSync(file); let o = 8, w = 0, h = 0; const idat: Buffer[] = [];
  while (o < b.length) { const len = b.readUInt32BE(o), type = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len); if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); } if (type === 'IDAT') idat.push(d); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) raw.copy(px, y * w * 3, y * (w * 3 + 1) + 1, (y + 1) * (w * 3 + 1));
  return { w, h, px };
}
const [out, ...rows] = process.argv.slice(2);
const imgs = rows.map((r) => r.split(',').map(decode));
const W = Math.max(...imgs.map((r) => r.reduce((n, i) => n + i.w, 0))), Hh = imgs.reduce((n, r) => n + Math.max(...r.map((i) => i.h)), 0);
const px = Buffer.alloc(W * Hh * 3, 235);
let y0 = 0;
for (const r of imgs) {
  let x0 = 0; const rh = Math.max(...r.map((i) => i.h));
  for (const i of r) { for (let y = 0; y < i.h; y++) i.px.copy(px, ((y0 + y) * W + x0) * 3, y * i.w * 3, (y + 1) * i.w * 3); x0 += i.w; }
  y0 += rh;
}
const raw = Buffer.alloc((W * 3 + 1) * Hh);
for (let y = 0; y < Hh; y++) px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(Hh, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
