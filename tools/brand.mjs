// Draws the brand images from the sphere (the Overseer's pearl over its sky) with no dependencies: PNG files written by hand.
// node tools/brand.mjs  ->  public/brand/{favicon-16,favicon-32,apple-touch-icon,icon-192,icon-512,icon-maskable-512,og}.png and public/favicon.ico
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

/** Pixel colour at (u,v) in 0..1 of a scene whose sphere has radius r centred at (cx,cy) (in the same units, aspect applied by the caller). */
function shade(x, y, W, H, o) {
  const sky0 = [8, 10, 22], sky1 = [22, 38, 70];
  let c = o.flat ? [15, 42, 58] : mix(sky0, sky1, Math.min(1, Math.max(0, (y / H) * 0.9 + 0.1 * (x / W))));
  if (!o.flat) { // stars
    const s = hash(Math.floor(x / 3), Math.floor(y / 3));
    if (s > 0.992) c = mix(c, [230, 240, 255], 0.35 + 0.5 * hash(x, y));
  }
  const dx = x - o.cx, dy = y - o.cy, d = Math.hypot(dx, dy), r = o.r;
  const glow = Math.exp(-Math.pow(Math.max(0, d - r) / (r * 0.55), 1.4));
  c = mix(c, [63, 208, 164], glow * 0.38);
  if (d < r) {
    const nx = dx / r, ny = dy / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const lit = Math.max(0, -nx * 0.45 - ny * 0.55 + nz * 0.7);
    const rim = Math.pow(1 - nz, 2.2);
    let base = mix([20, 70, 96], [120, 235, 205], Math.min(1, lit));
    const band = 0.5 + 0.5 * Math.sin((ny * 5.5 + nx * 1.4) * 2.2);
    base = mix(base, [200, 250, 240], band * 0.08 * lit);
    base = mix(base, [190, 255, 235], rim * 0.55);
    const spec = Math.pow(Math.max(0, -nx * 0.35 - ny * 0.45 + nz * 0.82), 28);
    c = mix(base, [255, 255, 255], spec * 0.85);
  }
  const e = Math.abs(d - r); // soft edge
  return [c, Math.max(0, Math.min(1, (r - d) / 1.2 + 0.5)), e];
}
function render(W, H, o) {
  const buf = Buffer.alloc(W * H * 4), S = o.ss ?? 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let a = [0, 0, 0];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const [c] = shade(x + (i + 0.5) / S, y + (j + 0.5) / S, W, H, o); a = a.map((v, k) => v + c[k] / (S * S)); }
    const o4 = (y * W + x) * 4;
    let alpha = 255;
    if (o.round) { // rounded square corners for the favicon sizes
      const rr = W * o.round, px = Math.min(x + 0.5, W - x - 0.5), py = Math.min(y + 0.5, H - y - 0.5);
      if (px < rr && py < rr) alpha = Math.round(255 * Math.max(0, Math.min(1, rr - Math.hypot(rr - px, rr - py) + 0.5)));
    }
    buf[o4] = a[0]; buf[o4 + 1] = a[1]; buf[o4 + 2] = a[2]; buf[o4 + 3] = alpha;
  }
  return buf;
}
const square = (n, r, extra = {}) => png(n, n, render(n, n, { cx: n / 2, cy: n / 2, r: n * r, ss: n < 64 ? 4 : 2, ...extra }));
const w = (rel, b) => { fs.mkdirSync(path.dirname(path.join(OUT, rel)), { recursive: true }); fs.writeFileSync(path.join(OUT, rel), b); };

const f16 = square(16, 0.34, { round: 0.2 }), f32 = square(32, 0.34, { round: 0.2 });
w('brand/favicon-16.png', f16); w('brand/favicon-32.png', f32);
w('brand/apple-touch-icon.png', square(180, 0.34)); // iOS rounds it itself
w('brand/icon-192.png', square(192, 0.34, { round: 0.18 }));
w('brand/icon-512.png', square(512, 0.34, { round: 0.18 }));
w('brand/icon-maskable-512.png', square(512, 0.26)); // the safe zone: the sphere inside the middle 80%
// favicon.ico: two PNG images
{
  const imgs = [[16, f16], [32, f32]], head = Buffer.alloc(6 + 16 * imgs.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length; imgs.forEach(([s, b], i) => { const e = 6 + i * 16; head[e] = s; head[e + 1] = s; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(b.length, e + 8); head.writeUInt32LE(off, e + 12); off += b.length; });
  w('favicon.ico', Buffer.concat([head, ...imgs.map((x) => x[1])]));
}
// The share card: 1200x630, the sphere in its sky, left clear of text on the right for the title (set by the page's own tags).
w('brand/og.png', png(1200, 630, render(1200, 630, { cx: 600, cy: 330, r: 190, ss: 2 })));
console.log('brand images written');
