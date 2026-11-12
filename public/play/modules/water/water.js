// Water: oceans, lakes, pools and tanks with moving waves, floating and sinking, splashes, the underwater look.
// The rest of the module builds on this file: swim.js (swimming and diving), bucket.js (a bucket of water dumped on
// someone, wet things), rain.js (the weather feature), fishing.js (rods, fish, the catch log).
//
//   config.water (H.features 'water')  the world's sea: true, a level, or { level, color, waves, ... } (WORLD.md)
//   the "water" kind                    a box of water of any size: pools, ponds, lakes, rivers as boxes, tanks
//   H.water / game.water               surfaceAt(x, z), inWater(pos), buoyancy(entity, opts), splash, ... (API.md)
//
// Everything dynamic that touches water floats or sinks by its density (data.density, 1 = water) through forces in a
// before-step hook, so it works on the legacy physics today and tips and rolls properly on Havok (forces at points).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const G = () => H.game;
  const PHONE = Boolean(H.touchUi);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = (v, d) => (v === undefined || v === null || v === '' || !isFinite(Number(v)) ? d : Number(v));

  // ------------------------------------------------------------------ waves: one formula for the shader and for floating
  // Four summed Gerstner waves (two on a phone), the first running with the wind (H.wind.dir, the ambience's wind) and
  // the others turned off it, shorter and smaller. A Gerstner wave moves a point sideways as well as up, so a crest is
  // sharp and a trough broad. The shader moves each grid point p to p + D(p) and lifts it by h(p); `waveEval` finds the p
  // that lands under (x, z) (three fixed-point steps) and returns the same h: barrels, the bobber and boats ride the
  // surface you see. The shader's distance fade (160 m and out) is the only difference, and nothing floats that far.
  const WAVE_SPEC = [[0, 1, 1], [0.55, 0.62, 0.5], [-0.8, 0.4, 0.25], [1.35, 0.27, 0.12]];
  const windDir = () => {
    const d = H.wind && H.wind.dir;
    if (d && isFinite(d[0]) && isFinite(d[1]) && Math.hypot(d[0], d[1]) > 1e-3) { const n = Math.hypot(d[0], d[1]); return [d[0] / n, d[1] / n]; }
    return [0.93, 0.37];
  };
  /** The waves of a body now: [{ x, z, k, om, a, e }] (direction, wavenumber, angular speed, height, sideways swing). */
  function waveSet(b) {
    if (!b.amp) return [];
    const d = windDir(), n = PHONE ? 2 : 4;
    const key = `${d[0].toFixed(3)},${d[1].toFixed(3)},${b.amp},${b.len},${b.speed},${n}`;
    if (b._wsKey === key) return b._ws;
    const ws = WAVE_SPEC.slice(0, n).map(([rot, lf, af]) => {
      const c = Math.cos(rot), s = Math.sin(rot);
      const k = (2 * Math.PI) / (b.len * lf), a = b.amp * af;
      const q = Math.min(1, 0.45 / (k * a * n));
      return { x: d[0] * c - d[1] * s, z: d[0] * s + d[1] * c, k, om: Math.sqrt(9.8 * k) * b.speed, a, e: q * a };
    });
    b._wsKey = key; b._ws = ws; b._wsum = ws.reduce((u, w) => u + w.a, 0);
    return ws;
  }
  /** Height and slope of the surface over (x, z) at time t. */
  function waveEval(b, x, z, t) {
    const ws = waveSet(b);
    if (!ws.length) return { h: 0, dx: 0, dz: 0 };
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) {
      let sx = 0, sz = 0;
      for (const w of ws) { const c = w.e * Math.cos(w.k * (w.x * px + w.z * pz) - w.om * t); sx += w.x * c; sz += w.z * c; }
      px = x - sx; pz = z - sz;
    }
    let h = 0, dx = 0, dz = 0;
    for (const w of ws) {
      const ph = w.k * (w.x * px + w.z * pz) - w.om * t;
      h += w.a * Math.sin(ph);
      const c = w.a * w.k * Math.cos(ph);
      dx += c * w.x; dz += c * w.z;
    }
    return { h, dx, dz };
  }
  const waveHeight = (b, x, z, t) => (b.amp ? waveEval(b, x, z, t).h : 0);
  /** The slope of the waves at a point ([dh/dx, dh/dz]): things drift down it a little. */
  const waveSlope = (b, x, z, t) => { if (!b.amp) return [0, 0]; const r = waveEval(b, x, z, t); return [r.dx, r.dz]; };
  const now = () => (W() ? W().time : 0);

  // ------------------------------------------------------------------ the colour of the sea by depth (shader and CPU agree)
  // Pale turquoise over sand, the body's own blue a few metres out, deep blue past about 12 m.
  const SHALLOW = [0.42, 0.95, 0.86];
  function rampColors(b) {
    const base = colorsOf(b.color);
    return { shallow: B.Color3.Lerp(base.base, new B.Color3(...SHALLOW), 0.7), mid: base.base, deep: base.deep };
  }
  const sstep = (a, c, v) => { const t = clamp((v - a) / (c - a), 0, 1); return t * t * (3 - 2 * t); };
  /** The sea's colour (r, g, b 0 to 1) where the water is `depth` metres deep. */
  function rampAt(b, depth) {
    const r = rampColors(b);
    const t1 = sstep(0.2, 3, depth), t2 = sstep(2.5, 14, depth);
    const m = (p, q, t) => p + (q - p) * t;
    return [0, 1, 2].map((i) => { const ch = ['r', 'g', 'b'][i]; return m(m(r.shallow[ch], r.mid[ch], t1), r.deep[ch], t2); });
  }

  // ------------------------------------------------------------------ procedural foam and water-normal textures
  // Tileable, made in code (no files): ridged noise for lacy foam, a smooth noise's slopes for the ripple normals.
  function periodicNoise(N, cells, seed) {
    const g = new Float32Array(cells * cells);
    let s = seed >>> 0 || 1;
    for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; }
    const out = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const fx = (x / N) * cells, fy = (y / N) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const ux = tx * tx * (3 - 2 * tx), uy = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % cells) * cells + (x0 % cells)], b2 = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)], d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      out[y * N + x] = a + (b2 - a) * ux + (c - a) * uy + (a - b2 - c + d) * ux * uy;
    }
    return out;
  }
  const texCache = new WeakMap();
  function seaTextures(sc) {
    if (texCache.has(sc)) return texCache.get(sc);
    const N = PHONE ? 128 : 256, f = new Uint8Array(N * N * 4), nm = new Uint8Array(N * N * 4);
    const o1 = periodicNoise(N, 6, 11), o2 = periodicNoise(N, 12, 23), o3 = periodicNoise(N, 24, 37), o4 = periodicNoise(N, 48, 51);
    const hgt = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const n = (o1[i] * 0.5 + o2[i] * 0.3 + o3[i] * 0.15 + o4[i] * 0.05);
      const ridge = 1 - Math.abs(2 * n - 1);
      const v = Math.pow(ridge, 3.2);
      f[i * 4] = f[i * 4 + 1] = f[i * 4 + 2] = Math.round(clamp(v * 1.15, 0, 1) * 255); f[i * 4 + 3] = 255;
      hgt[i] = o2[i] * 0.55 + o3[i] * 0.3 + o4[i] * 0.15;
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const dx = hgt[y * N + ((x + 1) % N)] - hgt[y * N + ((x + N - 1) % N)], dy = hgt[((y + 1) % N) * N + x] - hgt[((y + N - 1) % N) * N + x];
      const nx = -dx * 5, ny = -dy * 5, l = Math.hypot(nx, ny, 1);
      nm[i * 4] = Math.round((nx / l * 0.5 + 0.5) * 255); nm[i * 4 + 1] = Math.round((ny / l * 0.5 + 0.5) * 255); nm[i * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nm[i * 4 + 3] = 255;
    }
    const make = (data, name) => {
      const t = B.RawTexture.CreateRGBATexture(data, N, N, sc, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
      t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.name = name;
      return t;
    };
    const out = { foam: make(f, 'sea-foam'), normal: make(nm, 'sea-normal'), size: N };
    texCache.set(sc, out);
    return out;
  }

  // ------------------------------------------------------------------ the sea's depth map: how deep the water is round you
  // Sampled from the terrain's height once, into a small texture round the camera (R: the ground's height under the surface,
  // G: foam round things that stand in the water: pier posts, rocks, a wreck). The fragment reads it, so foam and colour
  // follow the real shore at texel size, not at the size of the mesh's triangles.
  const DEPTH_N = PHONE ? 128 : 256, DEPTH_SPAN = PHONE ? 192 : 256;
  function obstacleBoxes(b) {
    const w = W(), out = [];
    if (!w) return out;
    for (const e of w.entities) {
      if (!e.alive || e.isPlayer || e.remotePlayer || e.physics === 'dynamic' || e.data.waterPart || e.data.water || e.tag === 'seabed') continue;
      let bx;
      try { bx = e.box(); } catch { continue; }
      if (!bx || bx.min[1] > b.level + 0.5 || bx.max[1] < b.level - 0.3) continue;
      if (bx.max[0] - bx.min[0] > 24 || bx.max[2] - bx.min[2] > 24) continue;
      out.push(bx);
    }
    return out;
  }
  function depthMapFor(b, cam) {
    const sc = W().scene;
    let d = b._depth;
    const world = W();
    const need = !d || d.world !== world || Math.abs(cam.x - d.cx) > DEPTH_SPAN * 0.25 || Math.abs(cam.z - d.cz) > DEPTH_SPAN * 0.25;
    if (need) {
      if (d && d.tex) d.tex.dispose();
      const cx = Math.round(cam.x / 32) * 32, cz = Math.round(cam.z / 32) * 32, N = DEPTH_N, span = DEPTH_SPAN, ref = b.level;
      const ground = new Uint8Array(N * N);
      const hasT = H.terrain && typeof H.terrain.heightAt === 'function';
      for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
        let g = null;
        if (hasT) { try { g = H.terrain.heightAt(cx - span / 2 + (c + 0.5) * span / N, cz - span / 2 + (r + 0.5) * span / N); } catch { g = null; } }
        ground[r * N + c] = g === null || g === undefined || !isFinite(g) ? 0 : Math.round(clamp((g - ref + 12) / 15, 0, 1) * 255);
      }
      const data = new Uint8Array(N * N * 4);
      const tex = B.RawTexture.CreateRGBATexture(data, N, N, sc, false, false, B.Texture.BILINEAR_SAMPLINGMODE);
      tex.wrapU = tex.wrapV = B.Texture.CLAMP_ADDRESSMODE;
      d = b._depth = { world, tex, data, ground, cx, cz, N, span, ref, ents: -1 };
    }
    const ents = W().entities.length;
    if (need || ents !== d.ents) {
      d.ents = ents;
      const { N, span, data, ground } = d, texel = span / N, boxes = obstacleBoxes(b);
      const obs = new Uint8Array(N * N);
      for (const bx of boxes) {
        const c0 = Math.max(0, Math.floor((bx.min[0] - 1.2 - (d.cx - span / 2)) / texel)), c1 = Math.min(N - 1, Math.ceil((bx.max[0] + 1.2 - (d.cx - span / 2)) / texel));
        const r0 = Math.max(0, Math.floor((bx.min[2] - 1.2 - (d.cz - span / 2)) / texel)), r1 = Math.min(N - 1, Math.ceil((bx.max[2] + 1.2 - (d.cz - span / 2)) / texel));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
          const x = d.cx - span / 2 + (c + 0.5) * texel, z = d.cz - span / 2 + (r + 0.5) * texel;
          const dx = Math.max(bx.min[0] - x, 0, x - bx.max[0]), dz = Math.max(bx.min[2] - z, 0, z - bx.max[2]);
          const v = Math.round(clamp(1 - Math.hypot(dx, dz) / 1.1, 0, 1) * 255);
          if (v > obs[r * N + c]) obs[r * N + c] = v;
        }
      }
      for (let i = 0; i < N * N; i++) { data[i * 4] = ground[i]; data[i * 4 + 1] = obs[i]; data[i * 4 + 3] = 255; }
      d.tex.update(data);
      d.posts = boxes.length;
    }
    return d;
  }
  /** How deep the sea is at (x, z), from the terrain (metres under the level, no waves); null with no terrain. */
  function depthOfSea(b, x, z) {
    if (!(H.terrain && typeof H.terrain.heightAt === 'function')) return null;
    let g = null;
    try { g = H.terrain.heightAt(x, z); } catch { g = null; }
    return g === null || g === undefined || !isFinite(g) ? null : b.level - g;
  }

  B.Effect.ShadersStore.hawkesWaterVertexShader = `
precision highp float;
attribute vec3 position;
attribute float shore;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float time;
uniform float nw;
uniform float wsum;
uniform vec4 wA[4];
uniform vec2 wB[4];
uniform vec3 curve;
uniform vec3 camPos;
varying vec3 vW;
varying vec3 vN;
varying float vH;
varying float vShore;
void main(void) {
  vec4 wp = world * vec4(position, 1.0);
  vec2 p = wp.xz;
  float h = 0.0;
  vec2 d = vec2(0.0);
  vec2 s = vec2(0.0);
  for (int i = 0; i < 4; i++) {
    if (float(i) >= nw) break;
    float ph = wA[i].z * dot(wA[i].xy, p) - wB[i].x * time;
    h += wA[i].w * sin(ph);
    d += wA[i].w * wA[i].z * cos(ph) * wA[i].xy;
    s += wB[i].y * cos(ph) * wA[i].xy;
  }
  // Waves far from you are smaller than the grid can draw (and than a pixel): they fade out instead of aliasing.
  float fade = 1.0 - smoothstep(160.0, 700.0, length(wp.xyz - camPos));
  h *= fade; d *= fade; s *= fade;
  wp.y += h;
  wp.xz += s;
  vW = wp.xyz;
  // The planet's curve (H.planet): far water sinks below the horizon.
  vec2 cd = wp.xz - curve.xy;
  wp.y -= dot(cd, cd) * curve.z;
  vN = normalize(vec3(-d.x, 1.0, -d.y));
  vH = wsum > 0.0 ? h / wsum : 0.0;
  vShore = shore;
  gl_Position = viewProjection * wp;
}`;
  B.Effect.ShadersStore.hawkesWaterFragmentShader = `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying float vH;
varying float vShore;
uniform vec3 camPos;
uniform vec3 deep;
uniform vec3 mid;
uniform vec3 shallow;
uniform vec3 skyCol;
uniform vec3 sunDir;
uniform float alpha;
uniform float time;
uniform float foam;
uniform float hq;
uniform float useMap;
uniform float level;
uniform float boxDepth;
uniform vec4 mapA;
uniform vec2 mapB;
uniform vec2 windDir;
uniform vec4 fog;
uniform vec3 fogCol;
uniform sampler2D depthMap;
uniform sampler2D foamTex;
uniform sampler2D normTex;
void main(void) {
  vec3 V = normalize(camPos - vW);
  float dist = length(camPos - vW);
  float under = camPos.y < vW.y ? 1.0 : 0.0;
  // How deep the water is here, from the depth map (the sea) or the box's own depth (pools and ponds).
  float depth = boxDepth;
  float ob = 0.0;
  float shoreNear = vShore;
  if (useMap > 0.5) {
    vec2 uv = (vW.xz - mapA.xy) / mapA.z;
    vec4 m = texture2D(depthMap, uv);
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float win = smoothstep(0.0, 0.05, edge);
    depth = mix(30.0, level - (mapB.x + m.r * 15.0 - 12.0), win);
    ob = m.g * win;
    shoreNear = 0.0;
  }
  // Far away (and seen from high up) the waves are smaller than a pixel: the surface calms to one sheen instead of
  // shimmering noise, and the foam thins.
  float calm = clamp((dist - 80.0) / 520.0, 0.0, 1.0);
  vec2 fp = vW.xz;
  float fm = texture2D(foamTex, fp * 0.21 + windDir * time * 0.035).r;
  float fm2 = texture2D(foamTex, fp * 0.37 - windDir * time * 0.05 + vec2(0.37, 0.61)).r;
  vec3 N = normalize(vN);
  vec3 n1 = texture2D(normTex, fp * 0.16 + windDir * time * 0.045).rgb * 2.0 - 1.0;
  vec3 nrm = n1;
  if (hq > 0.5) { vec3 n2 = texture2D(normTex, fp * 0.43 - windDir * time * 0.07 + vec2(0.5, 0.2)).rgb * 2.0 - 1.0; nrm = normalize(n1 + n2); }
  N = normalize(N + vec3(nrm.x, 0.0, nrm.y) * (0.5 - 0.3 * calm));
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), calm * 0.8));
  if (under > 0.5) N = -N;
  // Colour by depth: pale turquoise over the sand, the sea's blue a few metres out, deep blue beyond.
  vec3 col = mix(shallow, mid, smoothstep(0.2, 3.0, depth));
  col = mix(col, deep, smoothstep(2.5, 14.0, depth));
  // Fresnel: more of the sky (a gradient from the horizon to the zenith, warmed toward the sun) at a low angle.
  float cosv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.03 + 0.97 * pow(1.0 - cosv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 zenith = skyCol * vec3(0.55, 0.72, 1.05);
  vec3 sky = mix(skyCol, zenith, clamp(R.y * 1.6, 0.0, 1.0));
  sky += vec3(1.0, 0.82, 0.55) * pow(max(dot(R, sunDir), 0.0), 6.0) * 0.35;
  col = mix(col, sky, clamp(fres * 1.15, 0.0, 0.85) * (1.0 - under));
  // Sun glints: the sun's mirror image in the small ripples.
  vec3 Hh = normalize(V + sunDir);
  float sp = pow(max(dot(N, Hh), 0.0), 220.0) * 1.6 + pow(max(dot(N, Hh), 0.0), 40.0) * 0.18;
  col += vec3(1.0, 0.95, 0.82) * sp * (1.0 - under) * (1.0 - calm * 0.5);
  // Foam: a surge line running up the beach and back, lacy foam where it is shallow, a ring round every post and rock,
  // and the white tops of the crests.
  float sh = (1.0 - smoothstep(0.0, 1.0, depth)) * step(-0.6, depth);
  sh = max(sh, shoreNear);
  float surge = 0.5 + 0.5 * sin(time * 1.1 - depth * 3.2 + fm * 4.0);
  float line = smoothstep(0.62, 1.0, sin(depth * 6.5 - time * 1.6 + fm * 3.0)) * (1.0 - smoothstep(0.0, 1.6, depth));
  float shoreFoam = clamp(sh * smoothstep(0.3, 0.75, fm * 0.8 + fm2 * 0.4 + sh * 0.35 * surge + 0.1) + line * 0.7 * (0.4 + 0.6 * surge), 0.0, 1.0);
  float ringPulse = 0.5 + 0.5 * sin(time * 2.2 - ob * 9.0 + fm * 5.0);
  float obFoam = ob * smoothstep(0.25, 0.6, fm * 0.7 + fm2 * 0.5 + ob * 0.45 + ringPulse * 0.15);
  float crest = smoothstep(0.55, 1.0, vH) * smoothstep(0.35, 0.8, fm2) * 0.8;
  float f = clamp((shoreFoam + obFoam + crest) * foam * (1.0 - calm * 0.85), 0.0, 1.0);
  col = mix(col, vec3(0.96, 0.99, 1.0), f * 0.92);
  // See-through over the sand (the sea bed shows, bent by the ripples), solid when deep, solid in foam and at a low angle.
  float clear = mix(0.42, alpha, smoothstep(0.0, 2.5, depth));
  float a = mix(clear, 1.0, max(fres * 0.7, f));
  if (under > 0.5) { col = mix(col, shallow * 1.3 + vec3(0.15), 0.35); a = 0.75; }
  float ff = 1.0;
  if (fog.x == 1.0) ff = exp(-dist * fog.w);
  else if (fog.x == 2.0) ff = exp(-pow(dist * fog.w, 2.0));
  else if (fog.x == 3.0) ff = clamp((fog.z - dist) / max(0.001, fog.z - fog.y), 0.0, 1.0);
  col = mix(fogCol, col, ff);
  gl_FragColor = vec4(col, a);
}`;

  // ------------------------------------------------------------------ water bodies (the sea, and every "water" thing)
  // { id, kind: 'ocean' | 'box', world, amp, len, speed, color, clarity, salt, fish, current, foam, ... }
  let bodies = [];
  let nextId = 1;
  const live = () => { const w = W(); if (bodies.some((b) => b.world !== w)) bodies = bodies.filter((b) => b.world === w); return bodies; };

  function colorsOf(hex) {
    const c = L.hex(hex, '#1f7fb3');
    return { base: c, deep: c.scale(0.3), shallow: B.Color3.Lerp(c, new B.Color3(0.45, 0.9, 0.9), 0.2).scale(0.85) };
  }
  /** Waves by size: a pool barely ripples, a lake laps, the sea rolls. */
  const defaultAmp = (size) => clamp(size / 120, 0.02, 0.3);

  function surfaceMaterial(b) {
    const sc = W().scene;
    const m = new B.ShaderMaterial('water-surface', sc, { vertex: 'hawkesWater', fragment: 'hawkesWater' }, {
      attributes: ['position', 'shore'],
      uniforms: ['world', 'viewProjection', 'time', 'nw', 'wsum', 'wA', 'wB', 'camPos', 'deep', 'mid', 'shallow', 'skyCol', 'sunDir', 'alpha', 'foam', 'hq', 'useMap', 'level', 'boxDepth', 'mapA', 'mapB', 'windDir', 'fog', 'fogCol', 'curve'],
      samplers: ['depthMap', 'foamTex', 'normTex'],
      needAlphaBlending: true,
    });
    m.backFaceCulling = false;
    const wA = new Float32Array(16), wB = new Float32Array(8);
    m.onBindObservable.add(() => {
      const e = m.getEffect();
      if (!e) return;
      const s = W().scene, cam = s.activeCamera;
      const cl = rampColors(b);
      const ws = waveSet(b);
      wA.fill(0); wB.fill(0);
      ws.forEach((w, i) => { wA.set([w.x, w.z, w.k, w.a], i * 4); wB.set([w.om, w.e], i * 2); });
      e.setFloat('time', now());
      e.setFloat('nw', ws.length);
      e.setFloat('wsum', b._wsum || 0);
      e.setArray4('wA', wA);
      e.setArray2('wB', wB);
      if (cam) e.setFloat3('camPos', cam.globalPosition.x, cam.globalPosition.y, cam.globalPosition.z);
      // (A round world's sea is a ball round its middle, under the frame's origin; elsewhere the curve is from you.)
      const round = Boolean(H.planet && H.planet.round);
      e.setFloat3('curve', cam && !round ? cam.globalPosition.x : 0, cam && !round ? cam.globalPosition.z : 0, H.planet && H.planet.on ? 1 / (2 * (H.planet.radius + (round ? b.level : 0))) : 0);
      e.setColor3('deep', cl.deep);
      e.setColor3('mid', cl.mid);
      e.setColor3('shallow', cl.shallow);
      const cc = s.clearColor;
      e.setFloat3('skyCol', Math.min(1, cc.r * 1.1 + 0.08), Math.min(1, cc.g * 1.1 + 0.08), Math.min(1, cc.b * 1.1 + 0.08));
      const sun = W().sun ? W().sun.direction : new B.Vector3(-0.5, -1, 0.4);
      const sd = sun.scale(-1).normalize();
      e.setFloat3('sunDir', sd.x, sd.y, sd.z);
      e.setFloat('alpha', b.alpha);
      e.setFloat('foam', b.foam ? 1 : 0);
      e.setFloat('hq', PHONE ? 0 : 1);
      const wd = windDir();
      e.setFloat2('windDir', wd[0], wd[1]);
      const tx = seaTextures(s);
      e.setTexture('foamTex', tx.foam);
      e.setTexture('normTex', tx.normal);
      if (b.kind === 'ocean' && cam) {
        const d = depthMapFor(b, cam.globalPosition);
        e.setTexture('depthMap', d.tex);
        e.setFloat('useMap', 1);
        e.setFloat('level', b.level);
        e.setFloat4('mapA', d.cx - d.span / 2, d.cz - d.span / 2, d.span, 0);
        e.setFloat2('mapB', d.ref, 0);
        e.setFloat('boxDepth', 30);
      } else {
        e.setTexture('depthMap', tx.normal);
        e.setFloat('useMap', 0);
        e.setFloat('level', b.level || 0);
        e.setFloat4('mapA', 0, 0, 1, 0);
        e.setFloat2('mapB', 0, 0);
        e.setFloat('boxDepth', b.size ? b.size[1] : 2);
      }
      e.setFloat4('fog', s.fogMode, s.fogStart, s.fogEnd, s.fogDensity);
      e.setColor3('fogCol', s.fogColor || new B.Color3(0.6, 0.8, 0.9));
    });
    return m;
  }

  /** A flat grid mesh (rows x cols quads) with a "shore" value per vertex (foam where the ground is near the surface).
   *  spread > 1 packs vertices toward the middle (the sea: fine near you, coarse far away). */
  function gridMesh(name, w, d, rows, cols, spread = 1) {
    const sc = W().scene;
    const pos = [], idx = [];
    const map = (u) => Math.sign(u) * Math.pow(Math.abs(u), spread);
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) pos.push(map(c / cols * 2 - 1) * w / 2, 0, map(r / rows * 2 - 1) * d / 2);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c, b2 = a + 1, c2 = a + cols + 1, d2 = c2 + 1; idx.push(a, c2, b2, b2, c2, d2); }
    const m = new B.Mesh(name, sc);
    const vd = new B.VertexData();
    vd.positions = pos; vd.indices = idx;
    vd.applyToMesh(m, true);
    m.setVerticesData('shore', new Float32Array(pos.length / 3), true, 1);
    m.isPickable = false;
    m.metadata = { decor: true, noGlow: true, water: true };
    return m;
  }

  /** Foam where the ground (H.terrain) comes up near the surface. */
  function updateShore(b) {
    const m = b.surface;
    if (!m || !H.terrain || typeof H.terrain.heightAt !== 'function') return;
    m.computeWorldMatrix(true);
    const pos = m.getVerticesData(B.VertexBuffer.PositionKind);
    const out = new Float32Array(pos.length / 3);
    const wm = m.getWorldMatrix();
    const v = new B.Vector3();
    for (let i = 0; i < out.length; i++) {
      B.Vector3.TransformCoordinatesFromFloatsToRef(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], wm, v);
      let g = null;
      try { g = H.terrain.heightAt(v.x, v.z); } catch { g = null; }
      out[i] = g === null || g === undefined || !isFinite(g) ? 0 : clamp(1 - (v.y - g) / 0.9, 0, 1) * (g < v.y + 0.6 ? 1 : 0);
    }
    m.updateVerticesData('shore', out);
  }

  // ------------------------------------------------------------------ the sea (config.water)
  function readSea(v) {
    const o = v === true ? {} : typeof v === 'number' ? { level: v } : typeof v === 'object' ? v : {};
    return {
      level: num(o.level, 0),
      color: o.color || '#1f7fb3',
      amp: num(o.waves, 0.2),
      len: Math.max(1, num(o.wavelength, 14)),
      speed: num(o.speed, 1),
      clarity: clamp(num(o.clarity, 0.5), 0, 1),
      depth: Math.max(1, num(o.depth, 20)),
      floor: o.floor !== false,
      floorColor: o.floorColor || '#c2b280',
      foam: o.foam !== false,
      fish: o.fish === undefined ? true : o.fish,
      salt: o.salt !== false,
      current: Array.isArray(o.current) ? [num(o.current[0], 0), num(o.current[1], 0)] : null,
      breath: o.breath === false ? false : num(o.breath, 25),
      swim: o.swim !== false,
      alpha: clamp(num(o.opacity, 0.94), 0.2, 1),
    };
  }
  /** An ocean planet (a round world with planet.seabed): its ground is the sea floor, so there is no floor of our own,
   *  and the sea reaches as far as the ground round you does. */
  function onOceanPlanet(s) {
    if (!(H.planet && H.planet.round && H.planet.seabed < 0)) return s;
    return { ...s, floor: false, depth: Math.max(1, s.level - H.planet.seabed) };
  }
  function makeSea(v) {
    const s = onOceanPlanet(readSea(v));
    const b = { id: 'sea', kind: 'ocean', world: W(), ...s, alpha: s.alpha };
    const size = H.planet && H.planet.round && H.planet.seabed < 0 && H.planet.frame.reach ? 2 * H.planet.frame.reach : 1600;
    b.surface = gridMesh('sea', size, size, PHONE ? 72 : 150, PHONE ? 72 : 150, size > 1600 ? 2.6 : 2.2);
    b.size = size;
    b.oceanPlanet = size > 1600;
    b.surface.material = surfaceMaterial(b);
    b.surface.position.y = s.level;
    b.surface.alwaysSelectAsActiveMesh = true;
    seaFloor(b);
    bodies.push(b);
    return b;
  }
  function seaFloor(b) {
    if (b.floorEntity && b.floorEntity.alive) b.floorEntity.destroy();
    b.floorEntity = null;
    if (!b.floor) return;
    const y = b.level - b.depth;
    const e = L.shape('box', () => B.MeshBuilder.CreateBox('seabed', { width: 2000, height: 1, depth: 2000 }, W().scene), { physics: 'static', color: b.floorColor, position: [0, y - 0.5, 0], shadow: false, name: 'Sea floor', tag: 'seabed' });
    e.temporary = true;
    e.data.waterPart = true;
    e.node.isPickable = true;
    b.floorEntity = e;
  }
  function changeSea(b, v) {
    const s = onOceanPlanet(readSea(v));
    const floorChanged = s.level - s.depth !== b.level - b.depth || s.floor !== b.floor || s.floorColor !== b.floorColor;
    Object.assign(b, s);
    b.surface.position.y = b.level;
    if (floorChanged) seaFloor(b);
    b.shoreAt = 0;
  }
  function removeBody(b) {
    bodies = bodies.filter((x) => x !== b);
    if (b.surface && !b.surface.isDisposed()) { if (b.surface.material) b.surface.material.dispose(); b.surface.dispose(); }
    if (b.floorEntity && b.floorEntity.alive) b.floorEntity.destroy();
    for (const p of b.parts || []) if (p.alive) p.destroy();
  }

  H.features.register('water', {
    codex: {
      title: 'The sea', group: 'World features',
      what: 'A sea with waves: swim and dive, things float or sink, boats bob, everything sounds muffled under water.',
      value: { level: -0.3, waves: 0.3 },
      fields: [['level', 'height of the surface (meters)', '0'], ['waves', 'wave height (0 calm, 0.6 rough)', '0.2'], ['wavelength', 'meters', '14'], ['speed', 'how fast they roll', '1']],
    },
    apply(value, ctx) { ctx.state.sea = makeSea(value); },
    change(value, old, ctx) { if (ctx.state.sea) changeSea(ctx.state.sea, value); else ctx.state.sea = makeSea(value); },
    dispose(ctx) { if (ctx.state.sea) removeBody(ctx.state.sea); ctx.state.sea = null; },
  });
  const sea = () => live().find((b) => b.kind === 'ocean') || null;

  // ------------------------------------------------------------------ the "water" kind: a box of water of any size
  // shape: { size: [w, h, d], waves, wavelength, speed, clarity, fish, salt, current: [x, z], basin, rim, foam }
  // The thing is the water's volume (see-through sides: a tank), its top the moving surface. basin: true (or a color)
  // adds a floor and walls around it (a pool); rim is how far the walls stand above the water.
  function readBox(shape) {
    const size = Array.isArray(shape.size) ? L.size3(shape.size, 1).map((v) => Math.max(0.2, num(v, 1))) : [Math.max(0.2, num(shape.width, 8)), Math.max(0.1, num(shape.height, 2)), Math.max(0.2, num(shape.length ?? shape.depth, 8))];
    const basin = shape.basin === true || shape.basin === 'pool' ? '#dce8ee' : shape.basin === 'pond' ? '#6d5b3e' : typeof shape.basin === 'string' && /^#/.test(shape.basin) ? shape.basin : null;
    return {
      size,
      amp: num(shape.waves, defaultAmp(Math.min(size[0], size[2]))),
      len: Math.max(0.5, num(shape.wavelength, clamp(Math.min(size[0], size[2]) / 3, 1.5, 14))),
      speed: num(shape.speed, 1),
      clarity: clamp(num(shape.clarity, basin === '#dce8ee' ? 0.9 : 0.55), 0, 1),
      fish: shape.fish === undefined ? (basin === '#dce8ee' ? false : true) : shape.fish,
      salt: shape.salt === true,
      current: Array.isArray(shape.current) ? [num(shape.current[0], 0), num(shape.current[1], 0)] : null,
      foam: shape.foam !== false,
      basin,
      rim: num(shape.rim, basin === '#6d5b3e' ? 0.12 : 0.3),
      breath: shape.breath === false ? false : num(shape.breath, 25),
      swim: shape.swim !== false,
    };
  }

  function buildBox(shape, o) {
    const s = readBox(shape || {});
    const sc = W().scene;
    const [w, h, d] = s.size;
    const vol = B.MeshBuilder.CreateBox('water', { width: w, height: h, depth: d }, sc);
    // No top face: the moving surface is the top.
    const pos = vol.getVerticesData(B.VertexBuffer.PositionKind), idx = vol.getIndices(), keep = [];
    for (let i = 0; i < idx.length; i += 3) { const y = pos[idx[i] * 3 + 1] + pos[idx[i + 1] * 3 + 1] + pos[idx[i + 2] * 3 + 1]; if (y < (3 * h) / 2 - 1e-4) keep.push(idx[i], idx[i + 1], idx[i + 2]); }
    vol.setIndices(keep);
    const color = o.color || shape.color || '#1f7fb3';
    const mat = new B.StandardMaterial('water', sc);
    mat.diffuseColor = L.hex(color, '#1f7fb3');
    mat.specularColor = new B.Color3(0.2, 0.2, 0.2);
    mat.emissiveColor = mat.diffuseColor.scale(0.15);
    mat.alpha = clamp(num(o.opacity, 0.35), 0.05, 1);
    mat.backFaceCulling = false;
    vol.material = mat;
    const e = new L.Entity(vol, { ...o, physics: 'none' }, 'water');
    e._mat = mat;
    e.physics = 'none';
    const b = { id: `water${nextId++}`, kind: 'box', world: W(), entity: e, color, alpha: 0.78, ...s };
    b.surface = gridMesh('water-top', w, d, clamp(Math.round(w / 1.2), 2, PHONE ? 32 : 64), clamp(Math.round(d / 1.2), 2, PHONE ? 32 : 64));
    b.surface.parent = vol;
    b.surface.position.y = h / 2;
    b.surface.material = surfaceMaterial(b);
    Object.defineProperty(b, 'color', { get: () => e.color || color, configurable: true });
    e.water = b;
    e.data.water = true;
    L.place(e, { ...o, shadow: false });
    if (s.basin) makeBasin(b);
    bodies.push(b);
    e.onDestroy(() => removeBody(b));
    b.shoreAt = 0;
    return e;
  }

  /** A floor and four walls around a box of water: a pool (or a pond's banks). Static things that follow the water. */
  function makeBasin(b) {
    const t = 0.4;
    const mk = (name) => {
      const p = L.shape('box', () => B.MeshBuilder.CreateBox(name, { size: 1 }, W().scene), { physics: 'static', color: b.basin, name: `${b.entity.name || 'Water'} ${name}`, shadow: true });
      p.temporary = true;
      p.data.waterPart = b.entity;
      return p;
    };
    b.parts = ['floor', 'wall', 'wall', 'wall', 'wall'].map(mk);
    b.partsKey = '';
    b.partT = t;
    placeBasin(b);
  }
  function placeBasin(b) {
    const e = b.entity, n = e.node;
    if (!b.parts) return;
    const key = `${n.position.x},${n.position.y},${n.position.z},${n.rotation.y},${n.scaling.x},${n.scaling.y},${n.scaling.z},${n.isEnabled()}`;
    if (key === b.partsKey) return;
    b.partsKey = key;
    const [w0, h0, d0] = b.size;
    const w = w0 * n.scaling.x, h = h0 * n.scaling.y, d = d0 * n.scaling.z, t = b.partT, rim = b.rim;
    const yaw = n.rotation.y, c = Math.cos(yaw), s = Math.sin(yaw);
    const at = (lx, ly, lz) => [n.position.x + lx * c + lz * s, n.position.y + ly, n.position.z - lx * s + lz * c];
    const set = (p, size, local) => { p.node.scaling.set(size[0], size[1], size[2]); p.node.rotation.y = yaw; p.position = at(...local); p.visible = n.isEnabled(); p.measure(); };
    const wallH = h + rim + t;
    set(b.parts[0], [w + 2 * t, t, d + 2 * t], [0, -h / 2 - t / 2, 0]);
    set(b.parts[1], [t, wallH, d + 2 * t], [-(w / 2 + t / 2), (rim - t) / 2, 0]);
    set(b.parts[2], [t, wallH, d + 2 * t], [w / 2 + t / 2, (rim - t) / 2, 0]);
    set(b.parts[3], [w, wallH, t], [0, (rim - t) / 2, -(d / 2 + t / 2)]);
    set(b.parts[4], [w, wallH, t], [0, (rim - t) / 2, d / 2 + t / 2]);
  }

  H.kinds.register('water', {
    physics: 'none',
    build: (shape, o) => buildBox(shape || {}, o),
    editor: {
      word: 'water',
      lift: (spec) => { const sh = (spec && spec.shape) || {}; const h = Array.isArray(sh.size) ? num(sh.size[1], 2) : num(sh.height, 2); return h / 2; },
      textureable: false,
      motion: [],
      hotbar: [
        { order: 400, icon: '🏊', label: 'Pool', make: () => ({ type: 'water', name: 'Pool', shape: { size: [8, 1.6, 5], basin: true } }) },
        { order: 401, icon: '🐟', label: 'Pond', make: () => ({ type: 'water', name: 'Pond', shape: { size: [10, 1.2, 10], basin: 'pond' }, material: { color: '#2a7f8f' } }) },
      ],
    },
    codex: {
      group: 'Water',
      what: 'Water of any size: a pool (basin: true), a pond, a lake, a river (a long box with a current), a fish tank. You can swim in it, things float or sink in it, and you can fish in it (WORLD.md "Water"). The whole sea is config.water.',
      spec: { type: 'water', name: 'Pool', transform: { position: [0, 0.8, 0] }, shape: { size: [8, 1.6, 5], basin: true } },
      fields: [
        ['shape.size', '[width, depth of the water, length] in meters', '[8, 2, 8]'],
        ['shape.basin', 'true: a pool\'s floor and walls; "pond": earthy banks; a color', 'none (a tank)'],
        ['shape.rim', 'how far the walls stand above the water', '0.3'],
        ['shape.waves', 'wave height in meters (0: still)', 'by size'],
        ['shape.current', '[x, z] m/s: a river\'s flow', 'none'],
        ['shape.fish', 'true, false, or a list of fish ids', 'true (pools: false)'],
        ['shape.clarity', '0 murky to 1 clear (seeing underwater)', '0.55'],
        ['material.color', 'the water\'s color', '#1f7fb3'],
      ],
    },
  });

  // ------------------------------------------------------------------ queries
  /** Where a box of water is: its center, size and turn, from its thing (it may move, turn and scale). */
  function boxFrame(b) {
    const n = b.entity.node;
    if (!b.entity.alive || !n.isEnabled()) return null;
    const sx = Math.abs(n.scaling.x), sy = Math.abs(n.scaling.y), sz = Math.abs(n.scaling.z);
    const p = n.parent ? n.getAbsolutePosition() : n.position;
    return { x: p.x, y: p.y, z: p.z, hw: (b.size[0] * sx) / 2, hh: (b.size[1] * sy) / 2, hd: (b.size[2] * sz) / 2, yaw: n.rotation.y };
  }
  function contains(b, x, z) {
    if (b.kind === 'ocean') return true;
    const f = boxFrame(b);
    if (!f) return false;
    const dx = x - f.x, dz = z - f.z, c = Math.cos(-f.yaw), s = Math.sin(-f.yaw);
    const lx = dx * c + dz * s, lz = -dx * s + dz * c;
    return Math.abs(lx) <= f.hw && Math.abs(lz) <= f.hd;
  }
  function baseLevel(b) { if (b.kind === 'ocean') return b.level; const f = boxFrame(b); return f ? f.y + f.hh : -Infinity; }
  function bottomOf(b) { if (b.kind === 'ocean') return b.floor ? b.level - b.depth : -Infinity; const f = boxFrame(b); return f ? f.y - f.hh : Infinity; }
  function surfaceOf(b, x, z, t = now()) { return baseLevel(b) + waveHeight(b, x, z, t); }

  /** The water at a point: the body whose water reaches it ({ body, surface, depth: meters under the surface }), or null.
   *  Without y: the highest water over (x, z). */
  function waterAt(x, z, y) {
    let best = null, bs = -Infinity;
    for (const b of live()) {
      if (!contains(b, x, z)) continue;
      if (y !== undefined && y !== null && bottomOf(b) > y + 0.01) continue;
      const s = surfaceOf(b, x, z);
      if (s > bs) { bs = s; best = b; }
    }
    if (!best) return null;
    return { body: best, surface: bs, depth: y === undefined || y === null ? null : bs - y };
  }
  const posOf = (p) => (p && p.__entity ? [p.x + p.offset[0], p.y + p.offset[1], p.z + p.offset[2]] : L.vec(p));

  /** The height of the water's surface at (x, z), waves included, or null where there is no water. */
  function surfaceAt(x, z, y) { const w = waterAt(Number(x) || 0, Number(z) || 0, y); return w ? w.surface : null; }
  /** True if a point (or a thing's middle) is under water. */
  function inWater(pos) { const p = posOf(pos); const w = waterAt(p[0], p[2], p[1]); return Boolean(w && w.depth > 0); }
  /** How far under the surface a point (or a thing's middle) is: positive under water, negative above it, null with no water there. */
  function depthAt(pos) { const p = posOf(pos); const w = waterAt(p[0], p[2], p[1]); return w ? w.depth : null; }

  // ------------------------------------------------------------------ floating and sinking
  const HEAVY = /rock|stone|boulder|anchor|metal|iron|steel|brick|cannon|lead|gold|safe|anvil|statue|concrete|car\b|truck/i;
  const LIGHT = /boat|raft|log|wood|crate|barrel|ball|duck|buoy|bobber|float|plank|foam|bottle|leaf|cork|board|kayak|canoe|ship/i;
  /** How dense a thing is next to water (1 = water: under 1 floats, over 1 sinks): data.density, or a guess from its name. */
  function densityOf(e) {
    const d = e.data && e.data.density;
    if (d !== undefined && d !== null && isFinite(Number(d))) return Math.max(0.02, Number(d));
    const words = `${e.name || ''} ${e.tag || ''}`;
    if (HEAVY.test(words)) return 2.5;
    if (LIGHT.test(words)) return 0.45;
    if (e.kind === 'sphere') return 0.4;
    return 0.6;
  }

  /** Floats (or sinks) a thing for this step: a lift by how much of it is under water, against its density
   *  (opts.density, data.density, 1 = water), water drag and the current. Call it every step for a boat; things
   *  that move on their own get it automatically. Returns { submerged (0 to 1), surface, depth, body } or null.
   *  On Havok the lift is applied at up to four points, so boats tip and right themselves. */
  function buoyancy(e, opts = {}) {
    if (!e || !e.alive || e.physics !== 'dynamic' || e.held) return null;
    const bx = e.box();
    const cx = (bx.min[0] + bx.max[0]) / 2, cz = (bx.min[2] + bx.max[2]) / 2;
    const ht = Math.max(0.05, bx.max[1] - bx.min[1]);
    const w = waterAt(cx, cz, bx.min[1]);
    if (!w) return null;
    const b = w.body, t = now();
    if (opts.manual !== false) e._waterManualAt = W().time;
    // Where it is wet: the lowest corners of the thing itself (turned with it), so a tipped hull gets more lift on its
    // low side (it rights itself on Havok). Small things: one point under the middle. opts.points: your own points, in
    // the thing's own space ([x, y, z] from its middle), e.g. a boat's hull.
    const lh = e._lhalf || e.half, lo = e._loff || e.offset;
    const m = e.node.computeWorldMatrix(true);
    const local = opts.points ? opts.points.map((q) => L.vec(q))
      : lh[0] > 0.6 || lh[2] > 0.6 ? [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => [sx * lh[0] * 0.85, sy * lh[1], sz * lh[2] * 0.85])))
      : null;
    const v3 = new B.Vector3();
    // (On the first physics a thing's box is already turned: no turning twice.)
    let pts = !local ? [[cx, bx.min[1], cz]] : local.map((q) => { if (!e._lhalf) return [e.x + lo[0] + q[0], e.y + lo[1] + q[1], e.z + lo[2] + q[2]]; B.Vector3.TransformCoordinatesFromFloatsToRef(q[0] + lo[0], q[1] + lo[1], q[2] + lo[2], m, v3); return [v3.x, v3.y, v3.z]; });
    if (!opts.points && pts.length > 4) pts = pts.sort((u, w) => u[1] - w[1]).slice(0, 4);
    const density = opts.density !== undefined ? Math.max(0.02, Number(opts.density) || 1) : densityOf(e);
    const g = Math.abs(H.physics.gravity || 24) * (e.gravity ?? 1);
    let sub = 0, surf = 0;
    const each = [];
    for (const [px, py, pz] of pts) {
      const s = surfaceOf(b, px, pz, t);
      const k = clamp((s - py) / ht, 0, 1);
      each.push([px, py, pz, s, k]);
      sub += k; surf += s;
    }
    sub /= pts.length; surf /= pts.length;
    if (sub <= 0) return { submerged: 0, surface: surf, depth: surf - bx.min[1], body: b.id };
    // Resting on the bottom and heavier than water: nothing to do (let it sleep).
    if (density >= 1 && (e.grounded || e.sleeping || Math.hypot(e.vx, e.vy, e.vz) < 0.08) && !opts.always) return { submerged: sub, surface: surf, depth: surf - bx.min[1], body: b.id };
    const lift = (e.mass * g) / density / pts.length * (opts.lift ?? 1);
    for (const [px, py, pz, s, k] of each) if (k > 0) e.force([0, lift * k, 0], [px, py + Math.min(s - py, ht) / 2, pz]);
    const drag = (opts.drag ?? 1.6) * sub * e.mass;
    const fx = -e.vx * drag, fy = -e.vy * drag * 1.4, fz = -e.vz * drag;
    let cxF = 0, czF = 0;
    const cur = b.current;
    if (cur) { cxF = (cur[0] - e.vx) * e.mass * 0.8 * sub; czF = (cur[1] - e.vz) * e.mass * 0.8 * sub; }
    // The waves push floating things down their slopes a little: they drift.
    const sl = waveSlope(b, cx, cz, t);
    const drift = e.mass * g * 0.15 * Math.min(1, sub * 2) * (density < 1 ? 1 : 0);
    e.force([fx + cxF - sl[0] * drift, fy, fz + czF - sl[1] * drift]);
    // Water slows spinning too (a torque against it: setting the spin would undo the lift's righting push).
    if (H.physics.engine === 'havok' && opts.spin !== false) { const av = e.angularVelocity, RAD = Math.PI / 180, k = -(opts.spinDrag ?? 0.4) * sub * e.mass * Math.max(0.3, (ht * ht) / 6); e.torque([av[0] * RAD * k, av[1] * RAD * k, av[2] * RAD * k]); }
    if (e.grounded) e.grounded = false;
    return { submerged: sub, surface: surf, depth: surf - bx.min[1], body: b.id };
  }

  // Everything that moves floats or sinks on its own (unless something else floats it: a boat calling buoyancy).
  H.physics.beforeStep(() => {
    const w = W();
    if (!w || !live().length) return;
    for (const e of w.entities) {
      if (e.physics !== 'dynamic' || !e.alive || e.isPlayer || e.remotePlayer || e.remote || e.held || e.data.noWater) continue;
      if (e._waterManualAt !== undefined && e._waterManualAt >= w.time - 0.05) continue;
      if (e.sleeping && densityOf(e) >= 1) continue;
      buoyancy(e, { manual: false });
    }
    // The sea floor is far down: things that sink stop there instead of being caught as "fallen out of the world".
    const s = sea();
    if (s && s.floor) w.catchY = Math.min(w.catchY, s.level - s.depth - 25);
  });

  // ------------------------------------------------------------------ splashes, ripples and their sounds
  const ripples = [];
  function ripple(x, z, size = 1) {
    const w = W();
    if (!w) return;
    if (ripples.length > (PHONE ? 8 : 20)) { const r = ripples.shift(); r.mesh.dispose(); }
    const y = surfaceAt(x, z);
    if (y === null) return;
    const m = B.MeshBuilder.CreateTorus('ripple', { diameter: 1, thickness: 0.05, tessellation: 28 }, w.scene);
    const mat = new B.StandardMaterial('ripple', w.scene);
    mat.emissiveColor = new B.Color3(0.9, 0.97, 1); mat.disableLighting = true; mat.alpha = 0.7;
    m.material = mat; m.isPickable = false; m.metadata = { decor: true, noGlow: true };
    m.scaling.y = 0.15;
    m.position.set(x, y + 0.02, z);
    ripples.push({ mesh: m, mat, x, z, t: 0, life: 1.1 + size * 0.5, grow: 1.5 + size * 3, world: w });
  }
  function stepRipples(dt) {
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1 || r.world !== W() || r.mesh.isDisposed()) { r.mesh.dispose(); ripples.splice(i, 1); continue; }
      const s = 0.4 + r.grow * Math.sqrt(k);
      r.mesh.scaling.x = r.mesh.scaling.z = s;
      r.mat.alpha = 0.7 * (1 - k);
      const y = surfaceAt(r.x, r.z);
      if (y !== null) r.mesh.position.y = y + 0.02;
    }
  }

  /** A splash at a point: spray, rings on the water and a sound. size: 0.2 (a pebble) to 3 (a cannonball). */
  function splash(at, size = 1, o = {}) {
    const w = W(), g = G();
    if (!w || !g) return;
    const p = posOf(at);
    const sz = clamp(Number(size) || 1, 0.1, 4);
    const ps = new B.ParticleSystem('splash', Math.round(clamp(16 + sz * 70, 10, PHONE ? 90 : 240)), w.scene);
    ps.particleTexture = w.dot;
    ps.emitter = new B.Vector3(p[0], p[1], p[2]);
    const r = 0.15 + sz * 0.35;
    ps.minEmitBox = new B.Vector3(-r, 0, -r); ps.maxEmitBox = new B.Vector3(r, 0.1, r);
    const c = L.hex(o.color || '#dff4ff');
    ps.color1 = new B.Color4(c.r, c.g, c.b, 0.95); ps.color2 = new B.Color4(c.r * 0.8, c.g * 0.92, c.b, 0.8); ps.colorDead = new B.Color4(c.r, c.g, c.b, 0);
    ps.minSize = 0.06 + sz * 0.04; ps.maxSize = 0.14 + sz * 0.1;
    ps.minLifeTime = 0.35; ps.maxLifeTime = 0.6 + sz * 0.35;
    ps.manualEmitCount = ps.getCapacity();
    ps.minEmitPower = 2 + sz * 1.5; ps.maxEmitPower = 3.5 + sz * 3.5;
    ps.direction1 = new B.Vector3(-0.7, 1.4, -0.7); ps.direction2 = new B.Vector3(0.7, 2.2, 0.7);
    ps.gravity = new B.Vector3(0, -16, 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    ps.disposeOnStop = true;
    ps.targetStopDuration = ps.maxLifeTime + 0.2;
    ps.start();
    if (o.ripples !== false) { ripple(p[0], p[2], sz); if (sz > 0.8) setTimeout(() => ripple(p[0], p[2], sz * 0.6), 180); }
    if (o.sound !== false) sound('splash', { at: p, size: sz });
    if (sz > 1.6 && g.player) { const d = Math.hypot(g.player.x - p[0], g.player.z - p[2]); if (d < 6 + sz * 2) g.camera.shake(0.05 * sz, 0.25); }
  }

  // Sounds: a game asset named "splash", "plop", "bite", "reel", "catch", "snap" or "rain" when it has one; otherwise a
  // small synthesized stand-in. Everything is muffled while your ears are under water.
  // The engine's audio (H.audio): one context; every sound goes through its master, and under water a low-pass filter
  // between the master and the speakers muffles everything (the engine's sounds, music and every module's).
  let noise = null, muffle = null;
  const audioCtx = () => H.audio.context;
  const out = () => H.audio.effects || H.audio.master;
  function setMuffle(on) {
    const ctx = audioCtx();
    if (!ctx) return;
    if (on && !muffle) { muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 520; muffle.Q.value = 0.7; H.audio.effect('water', muffle); }
    else if (!on && muffle) { H.audio.effect('water', null); muffle = null; }
  }
  /** The game's sound for a word ("splash", "rain"): an asset id or name (H.assets), or null. */
  function assetNamed(word) {
    return H.assets.pick(String(word), { kind: 'sound', mix: true });
  }
  function noiseBuffer(ctx) {
    if (noise && noise.sampleRate === ctx.sampleRate) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noise;
  }
  /** Plays one of the water sounds: 'splash', 'plop', 'bite', 'reel', 'catch', 'snap', 'drip'. o: { at, size, volume }. */
  function sound(name, o = {}) {
    const g = G();
    let vol = o.volume ?? 1;
    if (o.at && g && W() && W().scene.activeCamera) { const c = W().scene.activeCamera.globalPosition; const p = posOf(o.at); vol *= 1 / (1 + Math.hypot(c.x - p[0], c.y - p[1], c.z - p[2]) / 10); }
    if (vol < 0.03) return;
    const asset = assetNamed(name);
    if (asset && g) { g.sound(asset, { volume: clamp(vol, 0, 1), rate: o.rate }); return; }
    // The site's own recordings of the fishing sounds (runtime.js siteSound), before the synthesized ones.
    const SITE = { cast: 'fishing-cast', bite: 'fish-bite', catch: 'fish-catch', reel: 'fishing-reel' };
    try { if (SITE[name] && H.lib && H.lib.siteSound && H.lib.siteSound(SITE[name], { volume: clamp(vol, 0, 1) })) return; } catch { /* the synth */ }
    const ctx = audioCtx();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime, size = clamp(o.size ?? 1, 0.1, 4);
    const gainOut = ctx.createGain();
    gainOut.connect(out());
    const env = (gain, a, peak, dec) => { gain.gain.setValueAtTime(0.0001, t0); gain.gain.exponentialRampToValueAtTime(peak, t0 + a); gain.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec); };
    const tone = (f0, f1, dur, type = 'sine', peak = 0.2, delay = 0) => {
      const os = ctx.createOscillator(), gn = ctx.createGain();
      os.type = type; os.frequency.setValueAtTime(f0, t0 + delay); os.frequency.exponentialRampToValueAtTime(f1, t0 + delay + dur);
      gn.gain.setValueAtTime(0.0001, t0 + delay); gn.gain.exponentialRampToValueAtTime(peak * vol, t0 + delay + 0.01); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
      os.connect(gn).connect(gainOut); os.start(t0 + delay); os.stop(t0 + delay + dur + 0.05);
    };
    const hiss = (f0, f1, dur, peak, type = 'lowpass') => {
      const src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx);
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
      const gn = ctx.createGain(); env(gn, 0.008, Math.max(0.001, peak * vol), dur);
      src.connect(f).connect(gn).connect(gainOut); src.start(t0, Math.random()); src.stop(t0 + dur + 0.1);
    };
    if (name === 'splash') { hiss(2600 + size * 400, 300, 0.25 + size * 0.35, 0.35 + size * 0.12); tone(260 / (0.6 + size * 0.4), 90, 0.18 + size * 0.1, 'sine', 0.25); }
    else if (name === 'plop' || name === 'drip') tone(name === 'drip' ? 900 : 380, name === 'drip' ? 2200 : 1100, 0.09, 'sine', 0.22);
    else if (name === 'bite') { tone(300, 900, 0.08, 'sine', 0.3); tone(320, 1000, 0.08, 'sine', 0.3, 0.12); hiss(1800, 400, 0.2, 0.18); }
    else if (name === 'reel') tone(1400 + Math.random() * 300, 900, 0.03, 'square', 0.05);
    else if (name === 'catch') { tone(523, 523, 0.14, 'triangle', 0.25); tone(659, 659, 0.14, 'triangle', 0.25, 0.12); tone(784, 784, 0.3, 'triangle', 0.25, 0.24); }
    else if (name === 'snap') { hiss(5000, 2000, 0.12, 0.4, 'highpass'); tone(900, 200, 0.15, 'sawtooth', 0.12); }
    else if (name === 'cast') hiss(1200, 4000, 0.35, 0.12, 'bandpass');
    setTimeout(() => { try { out.disconnect(); } catch {} }, 3000);
  }

  // Things going into the water splash (a cannonball off the board is a big one), come out wet, and stop burning.
  function watchEntries(dt) {
    const w = W();
    if (!w || !live().length) return;
    for (const e of w.entities) {
      if (!e.alive || !(e.physics === 'dynamic' || e.isPlayer || e.remotePlayer)) continue;
      const bot = e.bottom;
      const wa = waterAt(e.x, e.z, bot + 0.5);
      const s = wa ? wa.surface : null;
      const prev = e._wPrev;
      e._wPrev = bot;
      if (s === null || prev === undefined) { e._wIn = false; continue; }
      const wasIn = Boolean(e._wIn);
      const isIn = bot < s;
      e._wIn = isIn;
      if (isIn === wasIn) continue;
      const vy = (bot - prev) / Math.max(dt, 1e-4);
      if (isIn && vy < -1.8) {
        // Sized by mass (a barrel against a splinter), by volume where a thing has none set.
        const vol = Math.max(e.size[0] * e.size[1] * e.size[2], (e.mass > 1 ? e.mass : 0) / 500);
        const size = clamp((-vy / 10) * Math.cbrt(Math.max(0.01, vol)) * (e.isPlayer || e.remotePlayer ? 1.4 : 1), 0.2, 3.5);
        splash([e.x, s, e.z], size);
        G().emit('splash', { at: [e.x, s, e.z], size, entity: e });
        if (size > 1.4) pushAround([e.x, s, e.z], size, e);
      } else if (!isIn && vy > 1.5) {
        ripple(e.x, e.z, 0.5);
      }
      if (isIn) {
        G().emit('extinguish', { at: [e.x, s, e.z], radius: Math.max(e.half[0], e.half[2]) + 0.3, entity: e, by: 'water' });
        if (H.water.wet) H.water.wet(e, 10);
      }
    }
  }
  /** A big splash pushes floating things away (only what this player simulates). */
  function pushAround(at, size, skip) {
    const r = 1 + size * 1.2;
    for (const o of H.physics.overlap(H.physics.shapes.sphere(r), at, { ignore: skip })) {
      if (o.physics !== 'dynamic' || o.isPlayer || o.remote || o.held) continue;
      if (H.sync && H.sync.mine && !H.sync.mine(o)) continue;
      const dx = o.x - at[0], dz = o.z - at[2], l = Math.hypot(dx, dz) || 1;
      o.impulse([(dx / l) * size * 2 * o.mass, size * 1.5 * o.mass, (dz / l) * size * 2 * o.mass]);
    }
  }
  H.physics.afterStep(watchEntries);

  // ------------------------------------------------------------------ under water: fog, tint, light ripples, muffled sound
  const under = { on: false, el: null, body: null };
  function overlay() {
    if (under.el && under.el.isConnected) return under.el;
    if (!document.getElementById('water-style')) {
      const st = document.createElement('style');
      st.id = 'water-style';
      st.textContent = `
#water-under { position: fixed; inset: 0; pointer-events: none; z-index: 2; opacity: 0; transition: opacity .25s; background: radial-gradient(ellipse at 50% 0%, rgba(120,220,255,.25), rgba(0,40,70,.35) 70%, rgba(0,20,40,.6)); }
#water-under.on { opacity: 1; }
#water-under::before, #water-under::after { content: ''; position: absolute; inset: -20%; opacity: .5; mix-blend-mode: screen;
  background: radial-gradient(ellipse 22% 9% at 30% 30%, rgba(190,245,255,.35), transparent 70%), radial-gradient(ellipse 16% 7% at 68% 22%, rgba(190,245,255,.3), transparent 70%),
              radial-gradient(ellipse 26% 8% at 52% 58%, rgba(190,245,255,.25), transparent 70%), radial-gradient(ellipse 14% 6% at 20% 72%, rgba(190,245,255,.25), transparent 70%),
              radial-gradient(ellipse 18% 7% at 82% 66%, rgba(190,245,255,.25), transparent 70%);
  animation: water-caustics 6s ease-in-out infinite alternate; }
#water-under::after { animation-duration: 8.5s; animation-direction: alternate-reverse; transform: rotate(35deg); opacity: .35; }
@keyframes water-caustics { from { transform: translate(-4%, -3%) rotate(-4deg) scale(1); } to { transform: translate(4%, 3%) rotate(5deg) scale(1.12); } }
#water-wet { position: fixed; inset: 0; pointer-events: none; z-index: 2; opacity: 0; transition: opacity 1.2s; background: radial-gradient(circle at 20% 30%, rgba(255,255,255,.18) 0 6px, transparent 9px), radial-gradient(circle at 75% 20%, rgba(255,255,255,.14) 0 8px, transparent 12px), radial-gradient(circle at 60% 75%, rgba(255,255,255,.16) 0 5px, transparent 8px), radial-gradient(circle at 30% 80%, rgba(255,255,255,.12) 0 7px, transparent 10px), radial-gradient(circle at 88% 62%, rgba(255,255,255,.15) 0 4px, transparent 7px); }
#water-wet.on { opacity: 1; transition: opacity .1s; }
#touch .tb.water-tb { right: max(22px, env(safe-area-inset-right)); bottom: 108px; font-size: 24px; }
#touch .tb.water-tb2 { right: 100px; bottom: 174px; font-size: 20px; }
.water-hud { position: fixed; left: 50%; bottom: 88px; transform: translateX(-50%); width: min(420px, calc(100vw - 32px)); color: #fff; font: 600 13px/1.2 system-ui, sans-serif; text-shadow: 0 1px 3px rgba(0,0,0,.7); pointer-events: none; z-index: 4; text-align: center; }
.water-hud .row { margin-top: 6px; }
.water-hud .track { position: relative; height: 14px; border-radius: 8px; background: rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.55); overflow: hidden; margin-top: 3px; }
.water-hud .fill { position: absolute; left: 0; top: 0; bottom: 0; background: #4ade80; transition: width .08s; }
.water-hud .zone { position: absolute; top: 0; bottom: 0; background: rgba(74,222,128,.28); border-left: 1px solid rgba(255,255,255,.6); border-right: 1px solid rgba(255,255,255,.6); }
.water-hud .mark { position: absolute; top: -2px; bottom: -2px; width: 4px; margin-left: -2px; background: #fff; border-radius: 2px; box-shadow: 0 0 6px #fff; }
.water-hud .big { font: 800 28px/1.1 system-ui, sans-serif; letter-spacing: .02em; }
.water-card { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); min-width: 240px; max-width: calc(100vw - 32px); padding: 14px 18px; border-radius: 14px; background: rgba(10,16,28,.82); border: 1px solid rgba(255,255,255,.25); color: #fff; font: 600 14px/1.35 system-ui, sans-serif; text-align: center; z-index: 6; pointer-events: none; animation: water-pop .25s ease-out; }
.water-card .name { font: 800 24px/1.1 system-ui, sans-serif; margin: 2px 0 6px; }
.water-card .tag { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
@keyframes water-pop { from { transform: translateX(-50%) scale(.85); opacity: 0; } to { transform: translateX(-50%) scale(1); opacity: 1; } }
.water-log { position: fixed; right: 16px; top: 64px; width: min(340px, calc(100vw - 32px)); max-height: calc(100vh - 140px); overflow: auto; padding: 12px 14px; border-radius: 14px; background: rgba(10,16,28,.88); border: 1px solid rgba(255,255,255,.22); color: #fff; font: 500 13px/1.35 system-ui, sans-serif; z-index: 6; }
.water-log h3 { margin: 0 0 8px; font: 800 18px/1.1 system-ui, sans-serif; }
.water-log .fish { display: flex; gap: 8px; align-items: center; padding: 5px 0; border-top: 1px solid rgba(255,255,255,.1); }
.water-log .dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.water-log .fish.unknown { opacity: .45; }
.water-log .sum { opacity: .8; margin-bottom: 4px; }
.water-log .fish .what { flex: 1; } .water-log .fish .best { text-align: right; font-size: 12px; opacity: .9; }
.water-log .sil { flex: none; }
.water-log .fish.unknown { opacity: .75; } .water-log .fish.unknown .best { opacity: .6; }
.water-new { position: fixed; left: 50%; top: 32%; transform: translateX(-50%); z-index: 7; pointer-events: none; text-align: center; color: #fff; text-shadow: 0 2px 8px rgba(0,0,0,.7); animation: water-new 2.5s ease-out forwards; }
.water-new .head { font: 800 13px/1 system-ui, sans-serif; letter-spacing: .2em; text-transform: uppercase; color: var(--c, #fde047); }
.water-new .sp { font: 900 34px/1.1 system-ui, sans-serif; margin-top: 4px; }
.water-new i { position: absolute; left: 50%; top: 50%; width: 8px; height: 8px; border-radius: 2px; animation: water-bit 1.4s ease-out forwards; }
@keyframes water-new { 0% { opacity: 0; transform: translateX(-50%) scale(.6); } 12% { opacity: 1; transform: translateX(-50%) scale(1.08); } 20% { transform: translateX(-50%) scale(1); } 80% { opacity: 1; } 100% { opacity: 0; transform: translateX(-50%) translateY(-18px); } }
@keyframes water-bit { from { transform: translate(0, 0) rotate(0); opacity: 1; } to { transform: translate(var(--x), var(--y)) rotate(320deg); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .water-new i { display: none; } .water-new { animation-duration: 2.5s; } }
.water-log .x { position: absolute; right: 10px; top: 8px; background: none; border: 0; color: #fff; font-size: 20px; cursor: pointer; pointer-events: auto; }
`;
      document.head.appendChild(st);
    }
    const el = document.createElement('div');
    el.id = 'water-under';
    document.body.appendChild(el);
    under.el = el;
    return el;
  }
  /** The world's own fog, as runtime.js applyLook sets it (put back when your head comes out of the water). */
  function restoreFog(sc) {
    const cfg = L.effectiveConfig();
    if (cfg.fog) { sc.fogMode = B.Scene.FOGMODE_LINEAR; sc.fogColor = L.hex(cfg.fog.color || cfg.background, '#9fd3f0'); sc.fogStart = cfg.fog.start ?? 40; sc.fogEnd = cfg.fog.end ?? 120; }
    else sc.fogMode = B.Scene.FOGMODE_NONE;
    const bg = L.hex(cfg.background, '#9fd3f0');
    sc.clearColor = new B.Color4(bg.r, bg.g, bg.b, 1);
  }
  function underwater() {
    const w = W();
    if (!w || !w.scene.activeCamera) return;
    const c = w.scene.activeCamera.globalPosition;
    const wa = live().length ? waterAt(c.x, c.z, c.y) : null;
    const isUnder = Boolean(wa && wa.depth > 0.02);
    if (isUnder) {
      const sc = w.scene, b = wa.body;
      const col = colorsOf(b.color).base;
      const fc = B.Color3.Lerp(col.scale(0.55), new B.Color3(0.05, 0.25, 0.3), 0.3);
      sc.fogMode = B.Scene.FOGMODE_EXP2;
      sc.fogDensity = 0.02 + (1 - b.clarity) * 0.12 + Math.min(0.05, wa.depth * 0.002);
      sc.fogColor = fc;
      sc.clearColor = new B.Color4(fc.r, fc.g, fc.b, 1);
      if (!under.on) { overlay().classList.add('on'); setMuffle(true); G().emit('underwater', { under: true }); }
      under.on = true; under.body = b;
    } else if (under.on) {
      under.on = false; under.body = null;
      restoreFog(w.scene);
      overlay().classList.remove('on');
      setMuffle(false);
      G().emit('underwater', { under: false });
    }
  }

  // ------------------------------------------------------------------ every frame: the sea follows you, foam, pools' walls
  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w) return;
    const cam = w.scene.activeCamera;
    for (const b of live()) {
      if (b.kind === 'ocean' && cam) {
        const p = cam.globalPosition;
        b.surface.position.x = Math.round(p.x / 2) * 2; b.surface.position.z = Math.round(p.z / 2) * 2;
        // An ocean planet's sea reaches the horizon as you climb (up to 12 km round you; past that, the ball's sea).
        if (b.oceanPlanet) {
          const h = Math.max(0, H.planet.heightOf([p.x, p.y, p.z]) - b.level), R = H.planet.radius;
          const k = Math.max(1, Math.min(12000, Math.sqrt(2 * R * h + h * h) * 1.1) / (b.size / 2));
          b.surface.scaling.x = k; b.surface.scaling.z = k;
        }
      }
      if (b.kind === 'box') placeBasin(b);
      if (H.terrain && b.foam && b.kind !== 'ocean' && w.time - (b.shoreAt || -99) > 3) {
        const key = b.kind === 'ocean' ? `${b.surface.position.x},${b.surface.position.z},${b.level}` : `${b.entity.x},${b.entity.y},${b.entity.z}`;
        if (key !== b.shoreKey || w.time - (b.shoreAt || -99) > 6) { b.shoreKey = key; updateShore(b); }
        b.shoreAt = w.time;
      }
    }
    stepRipples(dt);
    underwater();
  });
  H.hooks.world.push({
    leave() { if (under.on) { under.on = false; if (under.el) under.el.classList.remove('on'); setMuffle(false); } for (const r of ripples) r.mesh.dispose(); ripples.length = 0; },
  });

  // ------------------------------------------------------------------ rising and falling water (floods, tides)
  let rising = null;
  /** Moves the sea's level to `level` over `seconds` (a flood, a tide). Only on this player's screen, like any script. */
  function rise(level, seconds = 5) {
    const s = sea();
    if (!s) { H.applyOps([{ op: 'config', patch: { water: { level: Number(level) || 0 } } }]); return; }
    rising = { from: s.level, to: Number(level) || 0, t: 0, dur: Math.max(0.01, Number(seconds) || 0), body: s };
  }
  H.hooks.step.push((dt) => {
    if (!rising) return;
    const r = rising;
    if (r.body.world !== W()) { rising = null; return; }
    r.t += dt;
    const k = clamp(r.t / r.dur, 0, 1);
    r.body.level = r.from + (r.to - r.from) * (k * k * (3 - 2 * k));
    r.body.surface.position.y = r.body.level;
    if (k >= 1) { seaFloor(r.body); rising = null; }
  });

  // ------------------------------------------------------------------ H.water and game.water
  /** game.water(opts) makes a box of water (like game.box): { size: [w, h, d], x, y, z, basin, waves, color, ... }. */
  function water(o = {}) { return buildBox(o, { ...o, color: o.color, opacity: o.opacity, lenient: true }); }
  // (Descriptors, not Object.assign: the getters below must stay getters.)
  Object.defineProperties(water, Object.getOwnPropertyDescriptors({
    /** The one wave function (shader and floating agree): the height of the waves alone, over the level, at (x, z) and time t (default now). */
    waveAt: (x, z, t) => { const b = sea(); return b ? waveHeight(b, Number(x) || 0, Number(z) || 0, t === undefined ? now() : Number(t)) : 0; },
    /** How deep the sea is at (x, z) from the terrain (m under its level), or null. */
    seaDepthAt: (x, z) => { const b = sea(); return b ? depthOfSea(b, Number(x) || 0, Number(z) || 0) : null; },
    /** The colour [r, g, b] the sea shows over `depth` metres of water. */
    colorAtDepth: (depth) => { const b = sea(); return b ? rampAt(b, Number(depth) || 0) : null; },
    /** What the sea is drawing with (for the playtest): waves, tier, depth map, textures. */
    stats() {
      const b = sea();
      if (!b) return null;
      const d = b._depth, ws = waveSet(b);
      return { waves: ws.length, phone: PHONE, wind: windDir(), amp: b.amp, len: b.len, level: b.level, foam: Boolean(b.foam), depthMap: d ? { size: d.N, span: d.span, obstacles: d.posts || 0 } : null, textures: Boolean(texCache.has(W().scene)), grid: b.surface && b.surface.getTotalVertices() };
    },
    surfaceAt, inWater, depthAt, buoyancy, splash, ripple, sound, rise, densityOf,
    /** The water at a point: { body, surface, depth } (body: { id, kind, salt, fish, clarity, ... }) or null. */
    at: (pos) => { const p = posOf(pos); return waterAt(p[0], p[2], p[1]); },
    /** Every body of water in the world: the sea and every water thing. */
    bodies: () => live().slice(),
    get sea() { return sea(); },
    get level() { const s = sea(); return s ? s.level : null; },
    set level(v) { const s = sea(); if (s) { s.level = Number(v) || 0; s.surface.position.y = s.level; seaFloor(s); } },
    get underwater() { return under.on; },
    _: { waveHeight, waveSlope, waveEval, waveSet, rampAt, depthOfSea, depthMapFor, seaTextures, surfaceOf, contains, bottomOf, baseLevel, waterAt, assetNamed, overlay, posOf, live, PHONE, clamp, num, readSea, readBox, audioCtx, noiseBuffer, restoreFog, colorsOf },
  }));
  H.water = water;

  // game.water for scripts (every new game object, before any script runs).
  H.hooks.game.push((g) => { g.water = water; });
})();
