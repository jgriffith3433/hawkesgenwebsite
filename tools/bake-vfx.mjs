// Bakes the blast flipbooks: each Hawkes Gen still (public/play/vfx/<name>-src.png, black background) becomes an 8x8 sheet
// (/play/vfx/<name>.webp) by animating it per cell: scale, turn, cool and fade, alpha from luminance. Needs ffmpeg.
// node tools/bake-vfx.mjs [size=1024]   (the engine draws the sheet at 512 on a phone from the same file)
import fs from 'node:fs'; import zlib from 'node:zlib'; import { execFileSync } from 'node:child_process'; import path from 'node:path';
const dir = path.join(import.meta.dirname, '..', 'public', 'play', 'vfx');
const SIZE = Number(process.argv[2]) || 1024, G = 8, C = SIZE / G;
function readPng(file) {
  const b = fs.readFileSync(file); let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < b.length) { const n = b.readUInt32BE(p), t = b.toString('latin1', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; if (d[8] !== 8 || d[12]) throw new Error('8-bit non-interlaced only'); }
    if (t === 'IDAT') idat.push(d); p += 12 + n; }
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : 0; if (!ch) throw new Error('png type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat)), st = w * ch, out = Buffer.alloc(h * st);
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)], r = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)), o = y * st;
    for (let x = 0; x < st; x++) { const a = x >= ch ? out[o + x - ch] : 0, up = y ? out[o - st + x] : 0, c = x >= ch && y ? out[o - st + x - ch] : 0;
      let v = r[x]; if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[o + x] = v & 255; } }
  const lum = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) lum[i * 3 + k] = out[i * ch + (ch === 1 ? 0 : k)] / 255;
  return { w, h, d: lum };
}
function shrink(im, n) { // box filter to n x n
  const f = im.w / n, o = new Float32Array(n * n * 3);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let k = 0; k < 3; k++) { let s = 0, c = 0;
    for (let yy = Math.floor(y * f); yy < (y + 1) * f; yy++) for (let xx = Math.floor(x * f); xx < (x + 1) * f; xx++) { s += im.d[(yy * im.w + xx) * 3 + k]; c++; }
    o[(y * n + x) * 3 + k] = s / c; }
  return { w: n, h: n, d: o };
}
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const KINDS = {
  fireball: { src: 'fireball-src.png', center: [0.5, 0.52], span: 0.52, scale: (t) => 0.3 + 0.7 * (1 - (1 - t) ** 2), turn: (t) => t * 0.35,
    fade: (t) => Math.min(1, t * 14) * (1 - smooth(0.4, 1, t)), tint: (t, c) => [c[0], c[1] * (1 - 0.45 * t), c[2] * (1 - 0.8 * t)], alpha: (l) => smooth(0.05, 0.45, l), mask: null },
  smoke: { src: 'smoke-src.png', center: [0.5, 0.5], span: 0.42, scale: (t) => 0.55 + 0.5 * t, turn: (t) => -t * 0.5,
    fade: (t) => Math.sin(Math.PI * (0.1 + t * 0.9)) ** 0.7, tint: (t, c) => c, alpha: (l) => 0.92 * smooth(0.045, 0.11, l), mask: null },
  sparks: { src: 'sparks-src.png', center: [0.5, 0.52], span: 0.34, scale: (t) => 0.4 + 0.75 * (1 - (1 - t) ** 2), turn: (t) => t * 0.2,
    fade: (t) => Math.min(1, t * 20) * (1 - smooth(0.3, 1, t)), tint: (t, c) => [c[0], c[1] * (1 - 0.4 * t), c[2] * (1 - 0.75 * t)], alpha: (l) => smooth(0.08, 0.5, l),
    mask: (x, y) => 1 - smooth(0.3, 0.37, Math.hypot(x - 0.5, y - 0.52)) }, // sparkler handle is out past this
};
fs.mkdirSync(dir, { recursive: true });
for (const [name, k] of Object.entries(KINDS)) {
  const full = readPng(path.join(dir, k.src)), src = shrink(full, 512), N = src.w, soft = shrink(full, 32); // soft: a blurred copy, the silhouette of a dark cloud
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const sAt = (fx, fy) => { const x = Math.min(30.99, Math.max(0, fx * 32 - 0.5)), y = Math.min(30.99, Math.max(0, fy * 32 - 0.5)), x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0, g = (a, b) => soft.d[(b * 32 + a) * 3 + 1]; return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty; };
  const at = (fx, fy, ch) => { const x = Math.min(N - 1.001, Math.max(0, fx * N - 0.5)), y = Math.min(N - 1.001, Math.max(0, fy * N - 0.5)); const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0, g = (a, b) => src.d[(b * N + a) * 3 + ch];
    return (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty; };
  for (let i = 0; i < G * G; i++) {
    const t = i / (G * G - 1), sc = k.scale(t), tn = k.turn(t), fd = k.fade(t), co = Math.cos(tn), si = Math.sin(tn), ox = (i % G) * C, oy = Math.floor(i / G) * C;
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const u = ((x + 0.5) / C - 0.5) * 2, v = ((y + 0.5) / C - 0.5) * 2;
      // the cell's edge is a soft circle so no square shows up in the particle
      const edge = 1 - smooth(0.82, 1, Math.hypot(u, v)); if (edge <= 0) continue;
      const su = (u * co - v * si) / sc, sv = (u * si + v * co) / sc, fx = k.center[0] + su * k.span, fy = k.center[1] + sv * k.span;
      if (fx < 0 || fx > 1 || fy < 0 || fy > 1) continue;
      let c = [at(fx, fy, 0), at(fx, fy, 1), at(fx, fy, 2)]; let l = Math.max(c[0], c[1], c[2]);
      if (name === 'smoke') { l = sAt(fx, fy); c = c.map((q) => 0.05 + q * 0.8); }
      c = k.tint(t, c);
      const a = k.alpha(l) * fd * edge * (k.mask ? k.mask(fx, fy) : 1), o = ((oy + y) * SIZE + ox + x) * 4;
      // un-premultiply by the alpha so the colour stays bright where the alpha is soft
      const inv = a > 0.02 ? (name === 'smoke' ? 1 : Math.min(3, 1 / Math.max(l, 0.2))) : 0;
      px[o] = Math.min(255, c[0] * inv * 255 * (name === 'smoke' ? 1 : 1)); px[o + 1] = Math.min(255, c[1] * inv * 255); px[o + 2] = Math.min(255, c[2] * inv * 255); px[o + 3] = Math.min(255, a * 255);
    }
  }
  const raw = path.join(dir, `${name}.rgba`); fs.writeFileSync(raw, px);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${SIZE}x${SIZE}`, '-i', raw, '-c:v', 'libwebp', '-lossless', '0', '-quality', '82', '-pix_fmt', 'yuva420p', path.join(dir, `${name}.webp`)]);
  fs.unlinkSync(raw); console.log(name, fs.statSync(path.join(dir, `${name}.webp`)).size);
}
