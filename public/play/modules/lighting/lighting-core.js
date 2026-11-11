// Lighting, the plain logic (no Babylon, no page): which tier a graphics setting means, what each tier spends, the colour
// grade of every hour (and the 3D lookup table it bakes into), the exposure and sun and sky colours of an hour, and the
// sky the reflections are made from. lighting.js puts it on the screen.
//
//   tierFor(quality, device)   'desktop' | 'tablet' | 'phone' | 'low'   (Auto keeps the device's tier; Low cuts further)
//   TIERS[tier]                { cascades, shadowMap, pcf, ssao, bloom, bloomScale, bloomKernel, bloomWeight, envSize, lut }
//   gradeAt(hour)              { name, lift, gain, gamma, sat, contrast }  blended between dawn, noon, dusk and night
//   gradeName(hour)            'dawn' | 'noon' | 'dusk' | 'night' (the nearest key)
//   applyGrade(rgb, grade)     [r, g, b] 0-1 -> graded
//   buildLut(size, grade, out) the size^3 RGBA bytes (x red, y green, z blue) of a grade
//   exposureAt(hour)           the filmic exposure of an hour
//   sunColorAt(hour) / skyColorAt(hour) / groundColorAt(hour)   [r, g, b]
//   skyFace(face, size, hour, sunDir, out)  RGBA bytes of one face of the cube the reflections come from
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const wrap = (h) => ((Number(h) % 24) + 24) % 24;

  // ------------------------------------------------------------------ tiers
  const TIERS = {
    desktop: { cascades: 4, shadowMap: 2048, pcf: 'high', ssao: true, bloom: true, bloomScale: 0.75, bloomKernel: 64, bloomWeight: 0.34, envSize: 64, lut: 24, shadowRange: 220 },
    tablet: { cascades: 3, shadowMap: 1024, pcf: 'medium', ssao: false, bloom: true, bloomScale: 0.5, bloomKernel: 48, bloomWeight: 0.3, envSize: 32, lut: 16, shadowRange: 140 },
    phone: { cascades: 2, shadowMap: 1024, pcf: 'low', ssao: false, bloom: true, bloomScale: 0.5, bloomKernel: 32, bloomWeight: 0.28, envSize: 32, lut: 16, shadowRange: 80 },
    low: { cascades: 1, shadowMap: 512, pcf: 'low', ssao: false, bloom: false, bloomScale: 0.5, bloomKernel: 16, bloomWeight: 0.2, envSize: 16, lut: 8, shadowRange: 40 },
  };
  /** The graphics setting (auto, low, medium, high) on a device ({ tier: 'phone' | 'tablet' | 'desktop' }). */
  function tierFor(quality, device) {
    if (quality === 'low') return 'low';
    if (quality === 'medium') return 'tablet';
    if (quality === 'high') return 'desktop';
    const t = device && device.tier;
    return t === 'phone' || t === 'tablet' ? t : 'desktop';
  }

  // ------------------------------------------------------------------ the grade of every hour
  // lift tints the shadows, gain the highlights, gamma > 1 darkens the middle; each is a multiplier on a channel.
  const KEYS = [
    { h: 0, name: 'night', lift: [0.86, 0.96, 1.22], gain: [0.78, 0.9, 1.3], gamma: [1.06, 1.0, 0.9], sat: 0.8, contrast: 1.06 },
    { h: 4.6, name: 'night', lift: [0.86, 0.96, 1.22], gain: [0.78, 0.9, 1.3], gamma: [1.06, 1.0, 0.9], sat: 0.8, contrast: 1.06 },
    { h: 6.2, name: 'dawn', lift: [1.08, 0.98, 0.9], gain: [1.16, 1.03, 0.84], gamma: [0.96, 1.0, 1.06], sat: 1.14, contrast: 1.08 },
    { h: 9, name: 'noon', lift: [1.01, 1.0, 0.99], gain: [1.05, 1.02, 0.96], gamma: [1, 1, 1], sat: 1.05, contrast: 1.04 },
    { h: 12, name: 'noon', lift: [1, 1, 1], gain: [1, 1, 1], gamma: [1, 1, 1], sat: 1.04, contrast: 1.03 },
    { h: 15.5, name: 'noon', lift: [1.02, 1.0, 0.97], gain: [1.08, 1.03, 0.92], gamma: [0.99, 1, 1.02], sat: 1.08, contrast: 1.05 },
    { h: 18.7, name: 'dusk', lift: [1.1, 0.88, 1.06], gain: [1.22, 0.94, 0.92], gamma: [0.94, 1.04, 1.0], sat: 1.2, contrast: 1.1 },
    { h: 20.6, name: 'night', lift: [0.86, 0.96, 1.22], gain: [0.78, 0.9, 1.3], gamma: [1.06, 1.0, 0.9], sat: 0.8, contrast: 1.06 },
    { h: 24, name: 'night', lift: [0.86, 0.96, 1.22], gain: [0.78, 0.9, 1.3], gamma: [1.06, 1.0, 0.9], sat: 0.8, contrast: 1.06 },
  ];
  function between(h) {
    h = wrap(h);
    for (let i = 0; i < KEYS.length - 1; i++) if (h >= KEYS[i].h && h <= KEYS[i + 1].h) return [KEYS[i], KEYS[i + 1], smooth(KEYS[i].h, KEYS[i + 1].h, h)];
    return [KEYS[0], KEYS[0], 0];
  }
  function gradeAt(hour) {
    const [a, b, t] = between(hour);
    return {
      name: t < 0.5 ? a.name : b.name,
      lift: mix3(a.lift, b.lift, t), gain: mix3(a.gain, b.gain, t), gamma: mix3(a.gamma, b.gamma, t),
      sat: lerp(a.sat, b.sat, t), contrast: lerp(a.contrast, b.contrast, t),
    };
  }
  /** Which of the four looks an hour is nearest: dawn, noon, dusk or night. */
  function gradeName(hour) { return gradeAt(hour).name; }
  function applyGrade(rgb, g) {
    const out = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      let v = clamp(rgb[i], 0, 1);
      v = v * g.gain[i];                                           // highlights tint
      v = v + (g.lift[i] - 1) * (1 - v) * (1 - v) * 0.5;           // shadows tint
      v = Math.pow(clamp(v, 0, 1), g.gamma[i]);
      out[i] = v;
    }
    const l = out[0] * 0.2126 + out[1] * 0.7152 + out[2] * 0.0722;
    for (let i = 0; i < 3; i++) {
      let v = l + (out[i] - l) * g.sat;
      v = (v - 0.5) * g.contrast + 0.5;
      out[i] = clamp(v, 0, 1);
    }
    return out;
  }
  /** The grade as a size^3 lookup table of RGBA bytes: index = r + g * size + b * size * size. */
  function buildLut(size, grade, out) {
    const n = size * size * size * 4;
    const data = out && out.length >= n ? out : new Uint8Array(n);
    let k = 0;
    for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
      const c = applyGrade([r / (size - 1), g / (size - 1), b / (size - 1)], grade);
      data[k++] = Math.round(c[0] * 255); data[k++] = Math.round(c[1] * 255); data[k++] = Math.round(c[2] * 255); data[k++] = 255;
    }
    return data;
  }

  // ------------------------------------------------------------------ exposure, sun and sky colors by hour
  const EXPOSURE = [[0, 1.45], [4.6, 1.4], [6.2, 1.1], [9, 1.02], [12, 0.98], [15.5, 1.02], [18.7, 1.1], [20.6, 1.4], [24, 1.45]];
  function curve(points, h) {
    h = wrap(h);
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      if (h >= a[0] && h <= b[0]) { const t = smooth(a[0], b[0], h); return Array.isArray(a[1]) ? mix3(a[1], b[1], t) : lerp(a[1], b[1], t); }
    }
    return points[0][1];
  }
  const exposureAt = (h) => curve(EXPOSURE, h);
  const SUN = [[0, [0.55, 0.65, 1]], [4.6, [0.55, 0.65, 1]], [6.2, [1, 0.66, 0.36]], [8.5, [1, 0.9, 0.74]], [12, [1, 0.97, 0.9]], [15.5, [1, 0.88, 0.68]], [18.7, [1, 0.5, 0.34]], [20.6, [0.55, 0.65, 1]], [24, [0.55, 0.65, 1]]];
  const SKY = [[0, [0.28, 0.36, 0.62]], [4.6, [0.28, 0.36, 0.62]], [6.2, [0.85, 0.7, 0.72]], [9, [0.62, 0.8, 1.02]], [15.5, [0.64, 0.8, 1.02]], [18.7, [0.88, 0.58, 0.72]], [20.6, [0.28, 0.36, 0.62]], [24, [0.28, 0.36, 0.62]]];
  const GROUND = [[0, [0.12, 0.14, 0.2]], [4.6, [0.12, 0.14, 0.2]], [6.2, [0.5, 0.4, 0.34]], [12, [0.46, 0.4, 0.34]], [18.7, [0.5, 0.36, 0.32]], [20.6, [0.12, 0.14, 0.2]], [24, [0.12, 0.14, 0.2]]];
  const sunColorAt = (h) => curve(SUN, h);
  const skyColorAt = (h) => curve(SKY, h);
  const groundColorAt = (h) => curve(GROUND, h);

  // ------------------------------------------------------------------ the sky the reflections are made from
  // Faces in Babylon's cube order: +x, -x, +y, -y, +z, -z. A face pixel (u, v) in -1..1 is a direction; the colour is the
  // sky's gradient (the horizon warmer, the zenith deeper), a warm glow round the sun and the ground a dim mirror of it.
  const FACE = [
    (u, v) => [1, -v, -u], (u, v) => [-1, -v, u], (u, v) => [u, 1, v], (u, v) => [u, -1, -v], (u, v) => [u, -v, 1], (u, v) => [-u, -v, -1],
  ];
  function skyAt(dir, hour, sun) {
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const d = [dir[0] / l, dir[1] / l, dir[2] / l];
    const zen = skyColorAt(hour);
    const hor = mix3(zen, [1, 1, 1], 0.38);
    const sc = sunColorAt(hour);
    const gr = groundColorAt(hour);
    const up = smooth(-0.05, 0.6, d[1]);
    let c = mix3(hor, zen, up);
    const sd = Math.max(0, d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2]);
    const glow = Math.pow(sd, 8) * 0.55 + Math.pow(sd, 90) * 1.2;
    c = [c[0] + sc[0] * glow, c[1] + sc[1] * glow, c[2] + sc[2] * glow];
    const below = smooth(0.02, -0.25, d[1]);
    c = mix3(c, mix3(gr, hor, 0.25), below);
    const night = hour < 5 || hour > 20.5 ? 0.35 : hour < 6.5 ? 0.35 + (hour - 5) / 1.5 * 0.65 : hour > 19 ? 1 - (hour - 19) / 1.5 * 0.65 : 1;
    return [c[0] * night, c[1] * night, c[2] * night];
  }
  function skyFace(face, size, hour, sunDir, out) {
    const data = out && out.length >= size * size * 4 ? out : new Uint8Array(size * size * 4);
    const sun = (() => { const l = Math.hypot(sunDir[0], sunDir[1], sunDir[2]) || 1; return [sunDir[0] / l, sunDir[1] / l, sunDir[2] / l]; })();
    let k = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const c = skyAt(FACE[face]((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1), hour, sun);
      data[k++] = Math.round(clamp(c[0], 0, 1) * 255); data[k++] = Math.round(clamp(c[1], 0, 1) * 255); data[k++] = Math.round(clamp(c[2], 0, 1) * 255); data[k++] = 255;
    }
    return data;
  }

  const api = { TIERS, tierFor, KEYS, gradeAt, gradeName, applyGrade, buildLut, exposureAt, sunColorAt, skyColorAt, groundColorAt, skyAt, skyFace };
  if (typeof window !== 'undefined') { window.HawkesLightingCore = api; if (window.HawkesPlay) window.HawkesPlay.lightingCore = api; }
})();
