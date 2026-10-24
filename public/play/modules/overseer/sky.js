// The sky (H.sky): the one owner of the time of day, the sun, the light and the sky itself, in every game.
//   - The clock: config.time ("night", 14, { "hour": 6, "minutes": 12 }), the events module's clock and game.sky.hour are
//     one clock. Night darkens the world, dawn and dusk warm it; the sun moves with the hour.
//   - The light: the world's ambient and sun, times the time of day, the dark (events: disasters, zombie nights), the
//     weather (water: rain, storms, lightning) and the altitude (thin air: a black sky and a harsh sun). Modules report
//     what they want with H.sky.set(owner, { dark, flash }); nobody else writes the lights each frame.
//   - The sky: a dome drawn behind everything (scattering-like: the haze at the horizon, a deep blue up high, a warm
//     sunset, stars at night and in space, the sun's disc), and the far layer it lives in (H.sky.bg): a second camera
//     with a far reach for things beyond the world's own (the planet, the Overseer, beams from the ship), drawn into the
//     background before the world, so nothing in the world is ever hidden by them.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const PHONE = Boolean(H.touchUi);
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const BG_MASK = 0x10000000; // the far layer's meshes: no ordinary camera sees them (default masks are 0x0FFFFFFF)

  // ------------------------------------------------------------------ the clock
  const TIMES = { midnight: 0, night: 22, dawn: 6, sunrise: 6.3, morning: 9, day: 12, noon: 12, midday: 12, afternoon: 15.5, evening: 18.6, sunset: 18.6, dusk: 19.2 };
  /** How much daylight there is at an hour (1 by day, 0.12 at night, a ramp at dawn and dusk). */
  function daylight(h) { if (h >= 7 && h <= 18) return 1; if (h < 5 || h > 20) return 0.12; return h < 7 ? 0.12 + (h - 5) / 2 * 0.88 : 1 - (h - 18) / 2 * 0.88; }
  const wrap = (h) => ((Number(h) % 24) + 24) % 24;
  /** An hour from a word or a number ("night", "noon", 21.5), or null. */
  function hourOf(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? wrap(v) : null;
    if (typeof v === 'string') { const w = v.trim().toLowerCase(); if (TIMES[w] !== undefined) return TIMES[w]; const n = Number(w.replace(/[^0-9.:-]/g, '').replace(':', '.')); return w && Number.isFinite(n) ? wrap(n) : null; }
    return null;
  }
  /** This world's sky state (made the first time anyone asks: the events module may ask before the world starts). */
  function S() {
    const w = W();
    if (!w) return null;
    if (!w._sky) w._sky = { clock: null, owners: new Map(), wrote: {}, base: {}, alt: 0, air: 1, space: 0, day: 1, sunDir: DEFAULT_SUN.clone(), bg: null, onBg: [] };
    return w._sky;
  }
  const DEFAULT_SUN = new B.Vector3(0.5, 1, -0.4).normalize(); // toward the sun (the world's light comes from it)
  /** The clock (made if `create`): { hour, day (seconds a day takes), light (it changes the light), run, jumped }. */
  function clock(create) {
    const s = S();
    if (!s) return null;
    if (!s.clock && create) s.clock = { hour: 8, day: 720, light: true, run: true, jumped: false };
    return s.clock;
  }
  /** config.time: a word or an hour stops the clock there; an object ({ hour, minutes | day, run, light }) runs it. */
  function setTime(v) {
    const s = S();
    if (!s) return;
    if (v === undefined || v === null || v === false) { if (s.fromConfig) { s.clock = null; s.fromConfig = false; } return; }
    const c = clock(true);
    s.fromConfig = true;
    if (typeof v === 'object') {
      const h = hourOf(v.hour ?? v.start ?? v.time);
      if (h !== null) { c.hour = h; c.jumped = true; }
      if (v.minutes !== undefined) c.day = Math.max(10, num(v.minutes, 12) * 60);
      if (v.day !== undefined) c.day = Math.max(10, num(v.day, 720));
      c.run = v.run !== undefined ? v.run !== false : !v.stopped;
      if (v.light !== undefined) c.light = v.light !== false;
      return;
    }
    if (v === true || v === 'cycle' || v === 'day and night' || v === 'running') { c.run = true; return; }
    const h = hourOf(v);
    if (h !== null) { c.hour = h; c.run = false; c.jumped = true; }
  }

  /** Where the sun is at an hour (a direction toward it); no clock: the world's fixed sun. */
  function sunToward(h) {
    if (h === null || h === undefined) return DEFAULT_SUN.clone();
    const a = (wrap(h) - 6) / 12 * Math.PI;
    return new B.Vector3(-Math.cos(a) * 0.85, Math.sin(a), 0.42).normalize();
  }

  // ------------------------------------------------------------------ the far layer (H.sky.bg)
  /** Makes the far layer for a world: its camera follows the player's camera each frame (same view, a far reach), and
   *  what it sees is drawn behind the world. Meshes join with add(mesh, group): group 0 the sky, 1 the planet, 2 the
   *  ship and its beams (each group is drawn over the one before). */
  function makeBg(s, w) {
    const scene = w.scene;
    const cam = new B.FreeCamera('hp-skycam', new B.Vector3(0, 0, 0), scene);
    cam.layerMask = BG_MASK; cam.minZ = 20; cam.maxZ = 4e5; cam.inputs.clear();
    cam.rotationQuaternion = new B.Quaternion();
    if (scene.activeCamera === cam && w.camera) scene.activeCamera = w.camera.cam;
    let rtt = null, layer = null;
    try {
      rtt = new B.RenderTargetTexture('hp-sky', { ratio: PHONE ? 0.6 : 1 }, scene, false, true);
      rtt.activeCamera = cam;
      rtt.renderList = [];
      rtt.clearColor = new B.Color4(0, 0, 0, 1);
      scene.customRenderTargets.push(rtt);
      layer = new B.Layer('hp-sky', null, scene, true);
      layer.texture = rtt;
    } catch (err) { console.warn('sky layer', err); }
    const bg = {
      cam, rtt, layer, mask: BG_MASK,
      /** Puts a mesh in the far layer (group: 0 sky, 1 planet, 2 ship). */
      add(mesh, group = 2) {
        mesh.layerMask = BG_MASK;
        mesh.renderingGroupId = group;
        mesh.isPickable = false;
        mesh.metadata = { ...(mesh.metadata || {}), decor: true, noGlow: true, sky: true };
        if (rtt && !rtt.renderList.includes(mesh)) rtt.renderList.push(mesh);
        return mesh;
      },
      /** Takes it out of the far layer (back to the world's own camera, group 0). */
      remove(mesh) {
        if (rtt) { const i = rtt.renderList.indexOf(mesh); if (i >= 0) rtt.renderList.splice(i, 1); }
        mesh.layerMask = 0x0FFFFFFF;
        mesh.renderingGroupId = 0;
      },
      has(mesh) { return Boolean(rtt && rtt.renderList.includes(mesh)); },
    };
    const M = new B.Matrix(), SC = new B.Vector3(), Q = new B.Quaternion(), P = new B.Vector3();
    bg.sync = () => {
      const main = scene.activeCamera;
      if (!main || main === cam) return;
      try {
        main.getViewMatrix(true).invertToRef(M);
        M.decompose(SC, Q, P);
        cam.position.copyFrom(P);
        cam.rotationQuaternion.copyFrom(Q);
        cam.fov = main.fov; cam.fovMode = main.fovMode;
      } catch { return; }
      // The post effects belong to the player's camera (the look adds every new camera: not this one).
      const look = W() && W().look;
      if (look && look.cameras && look.cameras.includes && look.cameras.includes(cam) && look.removeCamera) try { look.removeCamera(cam); } catch {}
      for (const f of s.onBg) try { f(main, cam); } catch (err) { H.report(err, 'sky'); }
    };
    scene.onBeforeRenderObservable.add(bg.sync);
    return bg;
  }

  // ------------------------------------------------------------------ the dome
  B.Effect.ShadersStore.hpSkyVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main(void) { vDir = position; gl_Position = viewProjection * world * vec4(position, 1.0); }`;
  B.Effect.ShadersStore.hpSkyFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform vec3 horizon;
uniform vec3 zenith;
uniform vec3 nightCol;
uniform vec3 toSun;
uniform vec4 sky; // day, space, dark, dip (how far the horizon has sunk, as a sine)
uniform float stars;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main(void) {
  vec3 d = normalize(vDir);
  float day = sky.x, space = sky.y, dark = sky.z, dip = sky.w;
  float h = d.y + dip;
  float t = clamp(h, 0.0, 1.0);
  vec3 dayc = mix(horizon, zenith, pow(t, 0.5));
  // Below the horizon (the planet usually covers it): the haze, a little darker.
  if (h < 0.0) dayc = mix(horizon, horizon * 0.82, clamp(-h * 6.0, 0.0, 1.0));
  // Dawn and dusk: warm toward the sun when it's low.
  float sd = max(dot(d, toSun), 0.0);
  float low = 1.0 - smoothstep(-0.05, 0.4, toSun.y);
  dayc = mix(dayc, vec3(1.0, 0.52, 0.28), low * (pow(sd, 5.0) * 0.8 + 0.18) * (1.0 - t * 0.85) * step(-0.25, toSun.y));
  vec3 c = mix(nightCol * (0.55 + 0.45 * (1.0 - t)), dayc, day);
  // Thin air: the sky goes black from the top down, a thin bright band hugs the horizon.
  float band = exp(-abs(h) * 22.0);
  c = mix(c, horizon * band * 0.9 * max(day, 0.15), space * (0.55 + 0.45 * clamp(t * 3.0, 0.0, 1.0)));
  // Stars: at night and above the air.
  float sv = clamp(max((1.0 - day) * 1.15, space) * (1.0 - dark) * stars, 0.0, 1.0) * smoothstep(-0.12, 0.08, h + space * 0.3);
  if (sv > 0.01) {
    vec3 g = floor(d * 260.0);
    float s = hash(g);
    if (s > 0.993) {
      vec3 ctr = (g + 0.5 + (vec3(hash(g + 1.7), hash(g + 3.1), hash(g + 5.3)) - 0.5) * 0.6) / 260.0;
      float k = smoothstep(0.0028, 0.0, length(d - normalize(ctr)));
      c += vec3(0.85 + 0.15 * hash(g + 9.0), 0.9, 1.0) * k * sv * (0.45 + 0.55 * fract(s * 97.0));
    }
  }
  // The sun: a disc and its glow (sharper above the air).
  vec3 sunCol = mix(vec3(1.0, 0.62, 0.35), vec3(1.0, 0.97, 0.9), smoothstep(-0.05, 0.35, toSun.y));
  float above = step(-0.02, toSun.y + dip);
  c += sunCol * above * (smoothstep(0.99955, 0.9998, sd) * (2.5 + space * 3.0) + pow(sd, 180.0) * (0.25 + space * 0.6) + pow(sd, 6.0) * 0.12 * day * (1.0 - space));
  c *= 1.0 - dark * 0.55;
  gl_FragColor = vec4(c, 1.0);
}`;
  function makeDome(s, w) {
    const scene = w.scene;
    const dome = B.MeshBuilder.CreateSphere('hp-sky-dome', { diameter: 2000, segments: PHONE ? 16 : 24, sideOrientation: B.Mesh.BACKSIDE }, scene);
    const m = new B.ShaderMaterial('hp-sky', scene, { vertex: 'hpSky', fragment: 'hpSky' }, { attributes: ['position'], uniforms: ['world', 'viewProjection', 'horizon', 'zenith', 'nightCol', 'toSun', 'sky', 'stars'] });
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.onBindObservable.add(() => {
      const e = m.getEffect();
      if (!e || !s.look) return;
      const k = s.look;
      e.setColor3('horizon', k.horizon); e.setColor3('zenith', k.zenith); e.setColor3('nightCol', k.night);
      e.setFloat3('toSun', s.sunDir.x, s.sunDir.y, s.sunDir.z);
      e.setFloat4('sky', s.dayLook, s.space, s.darkLook, s.dip || 0);
      e.setFloat('stars', s.starsOn ? 1 : 0);
    });
    dome.material = m;
    dome.alwaysSelectAsActiveMesh = true;
    s.bg.add(dome, 0);
    // (Big enough to lie past the far camera's near plane, which moves out as you climb: high up it would clip the corners.)
    s.onBg.push((main, cam) => { dome.position.copyFrom(cam.position); dome.scaling.setAll(Math.max(1, (cam.minZ * 3) / 1000)); });
    return dome;
  }

  // ------------------------------------------------------------------ the light, each frame
  /** A value someone else may set (a script, a module): what they set is the base; we write base * our factors. */
  function owned(s, key, cur) {
    if (s.wrote[key] === undefined || Math.abs(cur - s.wrote[key]) > 1e-6) s.base[key] = cur;
    return s.base[key];
  }
  function ownedColor(s, key, cur) {
    const w = s.wrote[key];
    if (!w || Math.abs(cur.r - w.r) + Math.abs(cur.g - w.g) + Math.abs(cur.b - w.b) > 1e-4) s.base[key] = new B.Color3(cur.r, cur.g, cur.b);
    return s.base[key];
  }
  const NIGHT = new B.Color3(0.03, 0.04, 0.1);
  const SPACE = new B.Color3(0.004, 0.006, 0.014);
  function compose() {
    const w = W(), s = S();
    if (!w || !s || !w.scene) return;
    const cfg = L.effectiveConfig();
    const scene = w.scene;
    const cam = scene.activeCamera;
    const P = H.planet;
    const camY = cam ? cam.globalPosition.y : 0;
    s.alt = P ? P.altitude(camY) : camY;
    s.air = P ? P.air(camY) : 1;
    s.space = P && P.on ? 1 - smooth(0.012, 0.5, s.air) : 0;
    const above = P ? camY - P.surface : 0;
    s.dip = P && P.on && above > 0 ? Math.sin(Math.acos(clamp(P.radius / (P.radius + above), -1, 1))) : 0;
    const c = s.clock;
    const lit = Boolean(c && c.light !== false);
    const day = lit ? daylight(c.hour) : 1;
    let dE = 0, dW = 0, flash = 0;
    for (const o of s.owners.values()) { if (o.weather) dW = Math.max(dW, num(o.dark, 0)); else dE = Math.max(dE, num(o.dark, 0)); flash = Math.max(flash, num(o.flash, 0)); }
    dE = clamp(dE, 0, 1); dW = clamp(dW, 0, 1);
    const f = day * (1 - 0.85 * dE);
    const k = Math.max(0.1, f);
    s.day = day;
    s.sunDir = lit ? sunToward(c.hour) : DEFAULT_SUN.clone();
    s.dayLook = clamp((day - 0.12) / 0.88, 0, 1) * (1 - 0.8 * dE);
    s.darkLook = clamp(dW * 0.8 + dE * 0.3, 0, 0.9);
    s.starsOn = cfg.stars !== false;
    // The lights: the world's (or what a script set), times the day, the dark, the weather and the thin air.
    if (w.hemi) {
      const base = owned(s, 'hemi', w.hemi.intensity);
      const v = base * Math.max(0.2, k) * (1 - dW * 0.45) * (1 - 0.55 * s.space) + flash * 1.5;
      w.hemi.intensity = v; s.wrote.hemi = v;
    }
    if (w.sun) {
      const base = owned(s, 'sun', w.sun.intensity);
      const v = base * k * (1 - dW * 0.75) * (1 + 0.35 * s.space) + flash;
      w.sun.intensity = v; s.wrote.sun = v;
      // The light falls from the sun (from the moon's side at night: a little light from above, never from below).
      const d = s.sunDir.scale(-1);
      if (d.y > -0.25) { d.y = -0.25; d.normalize(); }
      if (lit) w.sun.direction.copyFrom(d);
    }
    // The sky's colors: the world's background (or what a script or the events module set) by day.
    const bgBase = ownedColor(s, 'clear', scene.clearColor);
    const horizonDay = B.Color3.Lerp(bgBase, new B.Color3(1, 1, 1), 0.35);
    const zenithDay = bgBase.scale(0.55);
    s.look = { horizon: horizonDay, zenith: zenithDay, night: NIGHT };
    let clear = B.Color3.Lerp(NIGHT, bgBase, f);
    clear = B.Color3.Lerp(clear, SPACE, s.space);
    scene.clearColor = new B.Color4(clear.r, clear.g, clear.b, 1);
    s.wrote.clear = clear;
    s.horizon = B.Color3.Lerp(B.Color3.Lerp(NIGHT.scale(1.6), horizonDay, f), SPACE, s.space * 0.7);
    // Fog: whoever set it (the world, rain, a disaster) keeps its colour by day; it darkens at night and thins as you climb.
    if (scene.fogMode !== B.Scene.FOGMODE_NONE) {
      const fc = ownedColor(s, 'fogc', scene.fogColor || new B.Color3(0.6, 0.8, 0.9));
      const out = B.Color3.Lerp(NIGHT, fc, f);
      scene.fogColor = out; s.wrote.fogc = out;
      const up = 1 + Math.max(0, s.alt - 20) / 45;
      const fs = owned(s, 'fogs', scene.fogStart), fe = owned(s, 'foge', scene.fogEnd), fd = owned(s, 'fogd', scene.fogDensity);
      scene.fogStart = fs * up; scene.fogEnd = fe * up; scene.fogDensity = fd / up;
      s.wrote.fogs = scene.fogStart; s.wrote.foge = scene.fogEnd; s.wrote.fogd = scene.fogDensity;
      s.fogOn = true;
    } else s.fogOn = false;
    // The world's own sky: ours is drawn behind everything instead of the engine's gradient (a photo sky stays, and
    // fades as you leave the air).
    if (w.dome && cfg.sky !== false && s.bg && s.bg.rtt) { const d = w.dome.mesh || w.dome; if (d.isEnabled && d.isEnabled()) d.setEnabled(false); }
    if (w.skybox && w.skybox.mesh) w.skybox.mesh.visibility = 1 - s.space;
    if (s.domeMesh) s.domeMesh.setEnabled(cfg.sky !== false);
  }

  // ------------------------------------------------------------------ every world, every step and frame
  let composeHooked = false;
  H.hooks.world.push({
    enter(w) {
      // The light is worked out after every other module's frame (they report what they want first).
      if (!composeHooked) { composeHooked = true; H.hooks.frame.push(() => { try { compose(); } catch (err) { H.report(err, 'sky'); } }); }
      const s = S();
      if (!s) return;
      setTime(L.effectiveConfig().time);
      try { s.bg = makeBg(s, w); } catch (err) { H.report(err, 'sky'); s.bg = null; }
      if (s.bg) try { s.domeMesh = makeDome(s, w); } catch (err) { H.report(err, 'sky dome'); }
      for (const f of hooksEnter) try { f(w, s); } catch (err) { H.report(err, 'sky'); }
      compose();
    },
    ops(ops) {
      const cfgOp = (ops || []).find((o) => o && o.op === 'config' && o.patch && 'time' in o.patch);
      if (cfgOp) setTime(L.effectiveConfig().time);
    },
  });
  const hooksEnter = [];
  // The clock runs (in game time); the host's hour is everyone's.
  H.hooks.step.push((dt) => {
    const s = W() && W()._sky;
    const c = s && s.clock;
    if (c && c.run !== false && H.mode === 'play') c.hour = (c.hour + dt * 24 / Math.max(10, c.day)) % 24;
  });
  if (H.sync && H.sync.state) {
    H.sync.state('sky', {
      rate: 2,
      get: () => { const c = W() && W()._sky && W()._sky.clock; return c ? { h: Math.round(c.hour * 100) / 100, r: c.run ? 1 : 0 } : null; },
      set: (st) => { if (!st || st.h === undefined) return; const c = clock(true); if (c && Math.abs(c.hour - st.h) > 0.08 && Math.abs(c.hour - st.h) < 23.9) c.hour = st.h; if (c && st.r !== undefined) c.run = Boolean(st.r); },
    });
  }

  // ------------------------------------------------------------------ the API
  H.sky = {
    TIMES, daylight, hourOf, BG_MASK,
    /** The hour (0-24) of the world's clock, or null when it has none. Setting it makes one (stopped there). */
    get hour() { const c = clock(false); return c ? c.hour : null; },
    set hour(h) { const v = hourOf(h); if (v === null) return; const c = clock(true); c.hour = v; c.jumped = true; },
    clock, setTime,
    /** How much daylight there is now (0.12 at night to 1), counting the clock only. */
    get day() { const s = S(); return s ? s.day : 1; },
    /** 0 on the ground to 1 above the air: how much the sky has turned to space where the camera is. */
    get space() { const s = S(); return s ? s.space : 0; },
    /** The camera's height above the planet's surface, and the air there (1 at the surface). */
    get altitude() { const s = S(); return s ? s.alt : 0; },
    get air() { const s = S(); return s ? s.air : 1; },
    /** The direction toward the sun (a Babylon Vector3). */
    get sunDir() { const s = S(); return s ? s.sunDir.clone() : DEFAULT_SUN.clone(); },
    /** The color of the haze at the horizon now (for far things: they fade into it). */
    get horizon() { const s = S(); return s && s.horizon ? s.horizon.clone() : new B.Color3(0.7, 0.85, 0.95); },
    /** Whether the world's fog is on (far things fade into the fog's color then). */
    get fogOn() { const s = S(); return Boolean(s && s.fogOn); },
    /** What a module wants from the light: { dark: 0-1, flash: 0-1, weather: true (rain's kind of dark) }; null: nothing. */
    set(owner, v) { const s = S(); if (!s) return; if (!v) s.owners.delete(owner); else s.owners.set(owner, v); },
    /** The far layer: add(mesh, group), remove(mesh), cam. Null when this world has none (no screen). */
    get bg() { const s = S(); return s ? s.bg : null; },
    /** fn(mainCamera, farCamera) every frame before drawing (place far things for this view). */
    onBg(fn) { const s = S(); if (s) s.onBg.push(fn); },
    /** fn(world, skyState) when a world starts, after the sky is made (the planet and the ship hook in here). */
    onEnter(fn) { hooksEnter.push(fn); },
    compose,
    _: { S, sunToward, smooth, clamp, num, PHONE },
  };

  // The codex's page (and the key's owner: the sky reads config.time itself, every world).
  H.features.register('time', {
    apply() {}, change() {}, dispose() {},
    codex: {
      title: 'Time of day', group: 'World features',
      what: 'The time of day: night darkens the world, dawn and dusk warm it, the sun moves; a running clock turns day into night. One clock for the whole world (the events module uses it too).',
      value: 'dusk',
      fields: [['(a word)', 'dawn, morning, noon, afternoon, dusk, night, midnight (stays there)', "none: the world's own light"], ['(a number)', 'an hour, 0-24', ''], ['hour', 'where a running clock starts', '8'], ['minutes', 'how long a day takes (it runs)', '12'], ['run', 'false: stopped', 'true']],
    },
  });

  // game.sky: still the call that sets a sky picture or color; it also reads and sets the time of day.
  H.hooks.game.push((game) => {
    const old = game.sky;
    if (typeof old !== 'function') return;
    const fn = function (what) { return old.call(game, what); };
    Object.defineProperties(fn, {
      hour: { get: () => H.sky.hour, set: (h) => { H.sky.hour = h; }, enumerable: true },
      time: { get: () => H.sky.hour, set: (v) => { H.sky.setTime(v); }, enumerable: true },
      day: { get: () => H.sky.day, enumerable: true },
      space: { get: () => H.sky.space, enumerable: true },
      altitude: { get: () => H.sky.altitude, enumerable: true },
    });
    game.sky = fn;
  });
})();
