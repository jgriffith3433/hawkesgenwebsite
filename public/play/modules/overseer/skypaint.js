// The painted sky (H.skyPaint; config.skyPaint, the sandbox has it): four painted 360 panoramas (dawn, noon, dusk, night)
// on the sky's dome, crossfaded by H.sky.clock, plus a slow scrolling cloud layer, a sun disc and a moon where the
// directional light points, twinkling stars at night, fog and haze taken from the horizon of the current sky, and the
// sky as the reflection environment (lighting.js asks H.skyPaint.face).
//   - Files: /play/sky/<name>-4k.webp (desktop) and <name>-2k.webp (phone tier), loaded AFTER the first frames, so the
//     first paint is the old gradient dome; the painted sky fades in when they are in (`reveal`).
//   - Blend: the weights follow the hour's target at most 1/BLEND_S a second (20 s for a whole sky), so a clock that jumps
//     still dissolves instead of popping.
//   - window.__skyPaint is what the playtest reads.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const NAMES = ['dawn', 'noon', 'dusk', 'night'];
  const BLEND_S = 20;       // seconds a whole crossfade takes at the quickest
  const WAIT_FRAMES = 45;   // frames drawn before the textures are asked for
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const wrap = (h) => ((Number(h) % 24) + 24) % 24;

  // Each sky owns the hours around its key; between two keys the weights cross over smoothly.
  const KEYS = [[2.5, 3], [6.3, 0], [12, 1], [18.9, 2], [22.2, 3], [26.5, 3]]; // hour, sky (night wraps)
  /** The weights of dawn, noon, dusk and night at an hour (they sum to 1). */
  function weightsAt(hour) {
    let h = wrap(hour);
    if (h < KEYS[0][0]) h += 24;
    const w = [0, 0, 0, 0];
    for (let i = 0; i < KEYS.length - 1; i++) {
      const [h0, s0] = KEYS[i], [h1, s1] = KEYS[i + 1];
      if (h >= h0 && h <= h1) { const t = smooth(h0, h1, h); w[s0] += 1 - t; w[s1] += t; break; }
    }
    return w;
  }
  /** One step of the follower: each weight moves toward its target by at most dt / BLEND_S. */
  function follow(cur, target, dt) {
    const step = dt / BLEND_S;
    const out = cur.map((c, i) => c + clamp(target[i] - c, -step, step));
    const sum = out.reduce((a, b) => a + b, 0) || 1;
    return out.map((v) => v / sum);
  }

  const st = { tex: [null, null, null, null], hor: [null, null, null, null], zen: [null, null, null, null], tiny: [null, null, null, null], w: [0, 1, 0, 0], loaded: 0, reveal: 0, started: false, frames: 0, mat: null, time: 0, size: '4k', bytes: 0, jumps: 0, last: null };
  H.skyPaint = { NAMES, KEYS, weightsAt, follow, BLEND_S, state: st, ready: false, face: null };

  // ------------------------------------------------------------------ the shader
  B.Effect.ShadersStore.hpSkyPaintVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main(void) { vDir = position; gl_Position = viewProjection * world * vec4(position, 1.0); }`;
  B.Effect.ShadersStore.hpSkyPaintFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform sampler2D tDawn;
uniform sampler2D tNoon;
uniform sampler2D tDusk;
uniform sampler2D tNight;
uniform vec4 wts;       // dawn, noon, dusk, night
uniform vec3 hor;       // the blended horizon colour
uniform vec3 fall;      // the gradient dome's colour up high, until the paintings are in
uniform vec3 toSun;
uniform vec3 toMoon;
uniform vec4 misc;      // reveal, space, time, dark
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vh(i), vh(i + vec2(1, 0)), f.x), mix(vh(i + vec2(0, 1)), vh(i + vec2(1, 1)), f.x), f.y); }
void main(void) {
  vec3 d = normalize(vDir);
  float reveal = misc.x, space = misc.y, time = misc.z, dark = misc.w;
  float ey = max(d.y, 0.015);
  vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, 0.5 - asin(ey) / 3.14159265);
  vec3 c = vec3(0.0);
  if (wts.x > 0.002) c += texture2D(tDawn, uv).rgb * wts.x;
  if (wts.y > 0.002) c += texture2D(tNoon, uv).rgb * wts.y;
  if (wts.z > 0.002) c += texture2D(tDusk, uv).rgb * wts.z;
  if (wts.w > 0.002) c += texture2D(tNight, uv).rgb * wts.w;
  // The seam: the first degrees above the sea melt into the horizon colour, and below it is the horizon colour.
  float melt = 1.0 - smoothstep(0.0, 0.1, d.y);
  c = mix(c, hor, melt);
  if (d.y < 0.0) c = mix(hor, hor * 0.9, clamp(-d.y * 5.0, 0.0, 1.0));
  float nightW = wts.w, dayW = 1.0 - wts.w;
  // A slow cloud layer over the paintings: it scrolls across the sky, lit by the horizon's light.
  if (d.y > 0.02) {
    vec2 cp = d.xz / (d.y + 0.35) * 2.2 + vec2(time * 0.012, time * 0.004);
    float n = vnoise(cp) * 0.55 + vnoise(cp * 2.1 + 7.0) * 0.3 + vnoise(cp * 4.3 + 3.0) * 0.15;
    float cl = smoothstep(0.52, 0.82, n) * smoothstep(0.02, 0.22, d.y) * (1.0 - smoothstep(0.6, 0.95, d.y));
    c = mix(c, mix(hor * 1.08, vec3(1.0), 0.25 * dayW), cl * (0.2 + 0.1 * dayW) * (1.0 - 0.7 * nightW));
  }
  // Stars twinkle (night only, over the painted ones): a few cells brighten and dim at their own rates.
  float sv = nightW * smoothstep(0.02, 0.2, d.y) * (1.0 - space * 0.0);
  if (sv > 0.01) {
    vec3 g = floor(d * 190.0);
    float s = hash(g);
    if (s > 0.985) {
      vec3 ctr = (g + 0.5 + (vec3(hash(g + 1.7), hash(g + 3.1), hash(g + 5.3)) - 0.5) * 0.6) / 190.0;
      float k = smoothstep(0.0034, 0.0, length(d - normalize(ctr)));
      float tw = 0.55 + 0.45 * sin(time * (1.5 + 4.0 * fract(s * 91.0)) + s * 80.0);
      c += vec3(0.85 + 0.15 * hash(g + 9.0), 0.92, 1.0) * k * sv * tw;
    }
  }
  // The sun: a disc and its glow where the sun is; the moon: a soft pale disc where the directional light comes from.
  float sd = max(dot(d, toSun), 0.0);
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.35), vec3(1.0, 0.97, 0.9), smoothstep(-0.05, 0.35, toSun.y));
  float sunUp = smoothstep(-0.06, 0.02, toSun.y);
  c += sunCol * sunUp * (smoothstep(0.99955, 0.9998, sd) * 2.2 + pow(sd, 180.0) * 0.3 + pow(sd, 8.0) * 0.1 * dayW);
  float md = max(dot(d, toMoon), 0.0);
  float moonUp = nightW * smoothstep(0.0, 0.06, toMoon.y);
  c += vec3(0.78, 0.86, 1.0) * moonUp * (smoothstep(0.99975, 0.9999, md) * 1.1 + pow(md, 220.0) * 0.25 + pow(md, 14.0) * 0.06);
  // Until the paintings are in, the old gradient shows (the first frames); then the painted sky fades in.
  vec3 grad = mix(hor, fall, pow(clamp(d.y, 0.0, 1.0), 0.5));
  c = mix(grad, c, reveal);
  c *= 1.0 - space * 0.97;
  c *= 1.0 - dark * 0.45;
  gl_FragColor = vec4(c, 1.0);
}`;

  // ------------------------------------------------------------------ loading
  function summarize(img, i) {
    // Horizon colour: the band 1 to 6 degrees above the sea, averaged round the whole sky; the zenith too; a 64x32 copy
    // for the reflection environment.
    try {
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 32;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, 64, 32);
      const px = cx.getImageData(0, 0, 64, 32).data;
      st.tiny[i] = px;
      const rowAt = (el) => Math.round((0.5 - el / 180) * 32);
      const avg = (r0, r1) => { let r = 0, g = 0, b = 0, n = 0; for (let y = Math.min(r0, r1); y <= Math.max(r0, r1); y++) for (let x = 0; x < 64; x++) { const k = (clamp(y, 0, 31) * 64 + x) * 4; r += px[k]; g += px[k + 1]; b += px[k + 2]; n++; } return [r / n / 255, g / n / 255, b / n / 255]; };
      st.hor[i] = avg(rowAt(8), rowAt(2));
      st.zen[i] = avg(0, 2);
    } catch { st.hor[i] = [[0.95, 0.75, 0.55], [0.7, 0.85, 0.95], [0.9, 0.5, 0.4], [0.05, 0.07, 0.15]][i]; st.zen[i] = st.hor[i]; }
  }
  function loadAll(w) {
    const phone = H.device && H.device.tier === 'phone' || H.touchUi;
    st.size = phone ? '2k' : '4k';
    const base = (window.HAWKES_SKY_BASE || '/play/sky/');
    NAMES.forEach((name, i) => {
      const url = `${base}${name}-${st.size}.webp`;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        summarize(img, i);
        const t = new B.Texture(url, w.scene, true, true, B.Texture.TRILINEAR_SAMPLINGMODE);
        t.wrapU = B.Texture.WRAP_ADDRESSMODE; t.wrapV = B.Texture.CLAMP_ADDRESSMODE;
        t.anisotropicFilteringLevel = 1;
        st.tex[i] = t;
        st.loaded++;
        if (st.loaded === 4) { H.skyPaint.ready = true; if (window.__skyPaintLog) window.__skyPaintLog('textures-ready'); }
      };
      img.onerror = () => { st.failed = (st.failed || 0) + 1; };
      img.src = url;
    });
    H.skyPaint.requested = performance.now();
  }
  // How many bytes the sky textures took (the playtest reads it; the resource timing API knows).
  function sizeBytes() {
    try { return performance.getEntriesByType('resource').filter((e) => /\/sky\/[a-z]+-[24]k\.webp/.test(e.name)).reduce((a, e) => a + (e.encodedBodySize || e.transferSize || 0), 0); } catch { return 0; }
  }

  // ------------------------------------------------------------------ the dome and the world's haze
  function mixColors(list, w) { const o = [0, 0, 0]; for (let i = 0; i < 4; i++) if (list[i]) for (let k = 0; k < 3; k++) o[k] += list[i][k] * w[i]; return o; }
  const FOG_K = [0.8, 1, 0.82, 0.62]; // the haze reaches less far at dawn, dusk and night

  function enter(w, s) {
    const cfg = L.effectiveConfig();
    if (!cfg.skyPaint || !s.domeMesh) return;
    const scene = w.scene;
    const dome = s.domeMesh;
    const plain = dome.material;
    const m = new B.ShaderMaterial('hp-sky-paint', scene, { vertex: 'hpSkyPaint', fragment: 'hpSkyPaint' }, { attributes: ['position'], uniforms: ['world', 'viewProjection', 'wts', 'hor', 'fall', 'toSun', 'toMoon', 'misc'], samplers: ['tDawn', 'tNoon', 'tDusk', 'tNight'] });
    m.backFaceCulling = false; m.disableDepthWrite = true;
    const dummy = new B.RawTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, B.Constants.TEXTUREFORMAT_RGBA, scene);
    const hor = new B.Color3(), fall = new B.Color3(), moon = new B.Vector3(0, 1, 0), sun = new B.Vector3(0.5, 1, -0.4);
    m.onBindObservable.add(() => {
      const e = m.getEffect();
      if (!e) return;
      const t = st.tex;
      e.setTexture('tDawn', t[0] || dummy); e.setTexture('tNoon', t[1] || dummy); e.setTexture('tDusk', t[2] || dummy); e.setTexture('tNight', t[3] || dummy);
      e.setFloat4('wts', st.w[0], st.w[1], st.w[2], st.w[3]);
      e.setColor3('hor', hor); e.setColor3('fall', fall);
      e.setFloat3('toSun', sun.x, sun.y, sun.z);
      e.setFloat3('toMoon', moon.x, moon.y, moon.z);
      e.setFloat4('misc', st.reveal, s.space || 0, st.time, s.darkLook || 0);
    });
    dome.material = m;
    st.mat = m;
    const fog0 = { start: null, end: null };
    let lastNow = performance.now();
    H.hooks.frame.push(() => {
      try {
        const now = performance.now();
        const dt = Math.min(0.25, (now - lastNow) / 1000); lastNow = now;
        st.time += dt;
        if (!st.started && ++st.frames >= WAIT_FRAMES) { st.started = true; loadAll(w); }
        const c = s.clock;
        const hour = H.lighting && H.lighting.on && Number.isFinite(H.lighting.hour) ? H.lighting.hour : c ? c.hour : 16.9;
        sun.copyFrom(H.sky._.sunToward(hour));
        const target = weightsAt(hour);
        const before = st.w;
        st.w = follow(st.w, target, dt);
        // A jump in the picture from one frame to the next (the playtest's pop check): the biggest weight change.
        const delta = Math.max(...st.w.map((v, i) => Math.abs(v - before[i])));
        st.maxStep = Math.max(st.maxStep || 0, delta);
        st.reveal = st.loaded === 4 ? clamp(st.reveal + dt / 4, 0, 1) : st.reveal;
        // Colours of the current sky.
        const hc = mixColors(st.hor, st.w), zc = mixColors(st.zen, st.w);
        if (st.loaded === 4) {
          hor.copyFromFloats(hc[0], hc[1], hc[2]);
          fall.copyFromFloats(zc[0], zc[1], zc[2]);
        } else if (s.look) { hor.copyFrom(s.look.horizon); fall.copyFrom(s.look.zenith); }
        // The moon is where the directional light comes from at night (against it by day, mirrored so it never sits under the sea).
        if (w.sun) { moon.copyFrom(w.sun.direction).scaleInPlace(-1); if (moon.y < 0.05) moon.y = 0.05; moon.normalize(); }
        if (st.loaded === 4 && s.space < 0.99) {
          // The sea and the far things fade into the horizon of the sky: that is the fog colour and the haze colour.
          const hz = new B.Color3(hc[0], hc[1], hc[2]);
          const scn = w.scene;
          s.horizon = hz;
          if (scn.fogMode !== B.Scene.FOGMODE_NONE) {
            const lightK = 1 - 0.35 * st.w[3];
            const fc = new B.Color3(hz.r * lightK, hz.g * lightK, hz.b * lightK);
            scn.fogColor = fc; s.wrote.fogc = fc; s.base.fogc = fc;
            // Haze density: the world's fog distances times the sky's own reach.
            if (fog0.end === null && s.base.foge) { fog0.start = s.base.fogs; fog0.end = s.base.foge; }
            if (fog0.end !== null) { const k = FOG_K.reduce((a, v, i) => a + v * st.w[i], 0); s.base.fogs = fog0.start * k; s.base.foge = fog0.end * k; }
          }
        }
        st.last = { hour, w: st.w.slice(), horizon: hc, bytes: (st.bytes = sizeBytes()) };
        window.__skyPaint = { ready: H.skyPaint.ready, tier: st.size, loaded: st.loaded, weights: st.w.slice(), target, hour, reveal: st.reveal, horizon: hc, bytes: st.bytes, maxStep: st.maxStep, firstRequestAfterFrames: WAIT_FRAMES, frames: st.frames, fogColor: w.scene.fogColor ? [w.scene.fogColor.r, w.scene.fogColor.g, w.scene.fogColor.b] : null, moon: [moon.x, moon.y, moon.z], sun: [s.sunDir.x, s.sunDir.y, s.sunDir.z] };
      } catch (err) { H.report(err, 'sky paint'); }
    });
    void plain;
  }
  H.skyPaint.face = function (face, size) {
    // A face of the reflection cube from the four low-res paintings, blended by the current weights.
    if (!H.skyPaint.ready) return null;
    const FACE = [(u, v) => [1, -v, -u], (u, v) => [-1, -v, u], (u, v) => [u, 1, v], (u, v) => [u, -1, -v], (u, v) => [u, -v, 1], (u, v) => [-u, -v, -1]];
    const out = new Uint8Array(size * size * 4);
    const hc = mixColors(st.hor, st.w);
    let k = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [dx, dy, dz] = FACE[face]((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const l = Math.hypot(dx, dy, dz) || 1;
      let r = 0, g = 0, b = 0;
      if (dy / l > 0.02) {
        const u = Math.atan2(dz, dx) / (2 * Math.PI) + 0.5, v = 0.5 - Math.asin(dy / l) / Math.PI;
        const tx = Math.min(63, Math.floor((u % 1) * 64)), ty = Math.min(31, Math.floor(v * 32));
        for (let i = 0; i < 4; i++) { if (st.w[i] < 0.002 || !st.tiny[i]) continue; const p = (ty * 64 + tx) * 4; r += st.tiny[i][p] * st.w[i]; g += st.tiny[i][p + 1] * st.w[i]; b += st.tiny[i][p + 2] * st.w[i]; }
      } else { r = hc[0] * 255 * 0.8; g = hc[1] * 255 * 0.8; b = hc[2] * 255 * 0.8; }
      out[k++] = r; out[k++] = g; out[k++] = b; out[k++] = 255;
    }
    return out;
  };
  H.skyPaint.onceEnter = enter;
  if (H.sky && H.sky.onEnter) H.sky.onEnter(enter);
})();
