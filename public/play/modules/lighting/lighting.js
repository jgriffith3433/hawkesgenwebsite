// Lighting (config.lighting): the island lit like a game with a real light stack. One owner for what makes a picture
// look lit rather than flat, on top of the sky (H.sky owns the clock, the sun's strength and direction; this reads them):
//   - Shadows: the sun's shadows are cascaded (4 on desktop High, 3 on a tablet, 2 on a phone and on Low, with a short
//     reach), percentage-closer filtered and soft, with a bias and a normal bias tuned so the ground shows no acne and
//     nothing floats above its own shadow. Replaces the runtime's single map (casters move over; scale.js keeps culling
//     them through W.shadows.getShadowMap()). Where cascades are not supported: one filtered map.
//   - Reflections: an environment made from the day's sky (six faces, built here from the hour; mips are its roughness
//     levels) so PBR metal, wet sand and paint reflect the sky, and a hemispheric fill of the sky's and ground's colour.
//   - The picture: the engine's pipeline (W.look) gets ACES tone mapping, an exposure for the hour, bloom over what is
//     brighter than the day (the glow layer's emissives: the beam, beacons, glints, lamps), FXAA, a vignette, and on
//     desktop High SSAO2 (never on a touch screen).
//   - The grade: a 3D lookup table per time of day (dawn gold, noon neutral, dusk orange-magenta, night moonlit blue),
//     blended by the hour.
// Graphics (the game menu: Auto / Low / Medium / High, H.setQuality) retiers all of it live.
//   config.lighting: true | { hour: 16.9 (the hour it holds while the world's clock does not change the light),
//                             shadows: false, ssao: false, grade: false }
//   H.lighting: { tier, hour, setHour(h), release(), state(), retier() };  window.__look = { tier, tonemap, bloom, ssao,
//   cascades, grade } (what the island-look playtest reads).
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = window.BABYLON;
  const C = H.lightingCore;
  const W = () => H.world;
  const warn = (what, err) => { try { H.report ? H.report(err, `lighting ${what}`) : console.warn(`lighting ${what}`, err); } catch { /* none */ } };

  const st = {
    on: false, opts: {}, tier: 'desktop', hour: 12, pinned: 16.9, grade: 'noon', csm: null, csmOn: false,
    env: null, envHour: -99, lut: null, lutData: null, lutSize: 0, lutHour: -99, ssao: null, ssaoAt: 0, ssaoOn: false,
    timer: 0, released: null, tonemap: 'none', bloom: false, cascades: 1,
  };

  const color3 = (a) => new B.Color3(a[0], a[1], a[2]);
  const tierNow = () => C.tierFor(H.quality ? H.quality() : 'auto', H.device);
  const spec = () => C.TIERS[st.tier];

  /** The hour the light is at: the world's clock when it changes the light, otherwise the held hour. */
  function hourNow() {
    const c = H.sky && H.sky.clock ? H.sky.clock(false) : null;
    if (c && c.light !== false && Number.isFinite(c.hour)) return c.hour;
    return st.pinned;
  }
  const clockLit = () => { const c = H.sky && H.sky.clock ? H.sky.clock(false) : null; return Boolean(c && c.light !== false); };

  // ------------------------------------------------------------------ shadows
  function csmSupported(w) { const eng = w.scene.getEngine(); return Boolean(B.CascadedShadowGenerator && eng && eng.webGLVersion > 1); }
  const QUALITY = (name) => ({ high: B.ShadowGenerator.QUALITY_HIGH, medium: B.ShadowGenerator.QUALITY_MEDIUM, low: B.ShadowGenerator.QUALITY_LOW })[name];

  function tuneShadows(g, sp) {
    g.usePercentageCloserFiltering = true;
    g.filteringQuality = QUALITY(sp.pcf);
    g.setDarkness(0.3);
    g.bias = 0.0004;        // (the depth bias: acne on the terrain's slopes)
    g.normalBias = 0.018;   // (along the normal, in meters: it holds the shadow to the foot, no gap beneath characters, vehicles, props)
    if (st.csmOn) {
      g.numCascades = Math.max(2, sp.cascades);
      g.lambda = 0.82;
      g.stabilizeCascades = true;
      g.cascadeBlendPercentage = 0.12;
      g.depthClamp = true;
      g.autoCalcDepthBounds = false;
      const cam = W().scene.activeCamera;
      g.shadowMaxZ = Math.min(sp.shadowRange, cam && cam.maxZ ? cam.maxZ : sp.shadowRange);
    }
  }
  function setupShadows(w) {
    const old = w.shadows;
    if (!w.sun || !old || st.opts.shadows === false) return;
    const sp = spec();
    const casters = (() => { try { return old.getShadowMap().renderList.slice(); } catch { return []; } })();
    if (csmSupported(w)) {
      try {
        try { old.dispose(); } catch { /* gone */ }
        const g = new B.CascadedShadowGenerator(sp.shadowMap, w.sun);
        st.csmOn = true; st.csm = g;
        tuneShadows(g, sp);
        for (const m of casters) if (m && !m.isDisposed()) g.addShadowCaster(m);
        w.shadows = g;
        return;
      } catch (err) { warn('cascades', err); st.csmOn = false; st.csm = null; }
    }
    // One filtered map: the runtime's own, softened (a world that cannot do cascades).
    try {
      if (old.usePercentageCloserFiltering !== undefined && w.scene.getEngine().webGLVersion > 1) { old.useBlurExponentialShadowMap = false; tuneShadows(old, sp); }
      st.csm = null;
    } catch (err) { warn('shadows', err); }
  }
  /** A retier changes the cascades' count, reach, filter and map in place (casters kept: other modules hold the generator). */
  function retierShadows(w) {
    const g = w.shadows;
    if (!g || st.opts.shadows === false) return;
    const sp = spec();
    try {
      const map = g.getShadowMap();
      const list = map && map.renderList ? map.renderList.slice() : null;
      if (g.mapSize !== sp.shadowMap) g.mapSize = sp.shadowMap;
      tuneShadows(g, sp);
      const m2 = g.getShadowMap();
      if (list && m2 && (!m2.renderList || m2.renderList.length < list.length)) m2.renderList = list;
    } catch (err) { warn('retier shadows', err); }
    st.cascades = st.csmOn ? Math.max(2, sp.cascades) : 1;
  }

  // ------------------------------------------------------------------ reflections: the sky as an environment
  function makeEnv(w, hour) {
    const sp = spec();
    const size = sp.envSize;
    const sd = H.sky && H.sky._ ? H.sky._.sunToward(hour) : { x: 0.3, y: 0.8, z: 0.4 };
    const faces = [];
    for (let f = 0; f < 6; f++) faces.push(C.skyFace(f, size, hour, [sd.x, sd.y, sd.z]));
    try {
      if (st.env && st.env._hpSize === size) {
        try { st.env.update(faces, B.Constants.TEXTUREFORMAT_RGBA, B.Constants.TEXTURETYPE_UNSIGNED_BYTE, false); st.envHour = hour; return; } catch { /* make a new one */ }
      }
      if (st.env) { try { st.env.dispose(); } catch { /* gone */ } st.env = null; }
      const t = new B.RawCubeTexture(w.scene, faces, size, B.Constants.TEXTUREFORMAT_RGBA, B.Constants.TEXTURETYPE_UNSIGNED_BYTE, true, false, B.Texture.TRILINEAR_SAMPLINGMODE);
      t._hpSize = size; t.name = 'hp-sky-env';
      w.scene.environmentTexture = t;
      st.env = t; st.envHour = hour;
    } catch (err) { warn('environment', err); st.envHour = hour; }
  }

  // ------------------------------------------------------------------ the picture: tone, bloom, vignette, SSAO, the grade
  function setupLook(w) {
    const p = w.look;
    if (!p) return;
    const sp = spec();
    try {
      p.automaticBuild = false; // (one build for all of it: changing a setting at a time re-attached the effects)
      p.fxaaEnabled = true;
      p.bloomEnabled = Boolean(sp.bloom);
      p.bloomThreshold = 0.86; p.bloomWeight = sp.bloomWeight; p.bloomKernel = sp.bloomKernel; p.bloomScale = sp.bloomScale;
      p.imageProcessingEnabled = true;
      const ip = p.imageProcessing;
      ip.toneMappingEnabled = true; ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.contrast = 1.06;
      ip.vignetteEnabled = true; ip.vignetteWeight = 1.3; ip.vignetteStretch = 0.2; ip.vignetteColor = new B.Color4(0.02, 0.02, 0.05, 0); ip.vignetteBlendMode = B.ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
      if (st.opts.grade !== false) makeGrade(w, ip);
      p.prepare();
      p.automaticBuild = true;
    } catch (err) { warn('pipeline', err); try { p.automaticBuild = true; } catch { /* gone */ } }
  }
  function makeGrade(w, ip) {
    const eng = w.scene.getEngine();
    if (!B.RawTexture3D || eng.webGLVersion < 2) { st.lut = null; return; }
    try {
      const sp = spec();
      st.lutSize = sp.lut;
      st.lutData = C.buildLut(sp.lut, C.gradeAt(st.hour));
      const t = new B.RawTexture3D(st.lutData, sp.lut, sp.lut, sp.lut, B.Constants.TEXTUREFORMAT_RGBA, w.scene, false, false, B.Texture.BILINEAR_SAMPLINGMODE, B.Constants.TEXTURETYPE_UNSIGNED_BYTE);
      t.wrapU = t.wrapV = t.wrapR = B.Texture.CLAMP_ADDRESSMODE;
      t.level = 1; t.name = 'hp-grade';
      ip.colorGradingEnabled = true;
      ip.colorGradingTexture = t;
      st.lut = t; st.lutHour = st.hour;
    } catch (err) { warn('grade', err); st.lut = null; }
  }
  function updateGrade() {
    if (!st.lut || Math.abs(wrapDiff(st.hour, st.lutHour)) < 0.04) return;
    try { C.buildLut(st.lutSize, C.gradeAt(st.hour), st.lutData); st.lut.update(st.lutData); st.lutHour = st.hour; } catch (err) { warn('grade update', err); st.lut = null; }
  }
  const wrapDiff = (a, b) => { let d = a - b; while (d > 12) d -= 24; while (d < -12) d += 24; return d; };

  function wantSsao() {
    return Boolean(spec().ssao && !H.touchUi && st.opts.ssao !== false && W().scene.getEngine().webGLVersion > 1 && B.SSAO2RenderingPipeline);
  }
  function setupSsao(w) {
    if (st.ssao || !wantSsao()) return;
    try {
      const cam = w.scene.activeCamera;
      if (!cam) return;
      const s = new B.SSAO2RenderingPipeline('hp-ssao', w.scene, { ssaoRatio: 0.5, blurRatio: 1 }, [cam], false);
      s.radius = 2.2; s.totalStrength = 0.9; s.expensiveBlur = false; s.samples = 12; s.maxZ = 90;
      st.ssao = s;
    } catch (err) { warn('ssao', err); st.ssao = null; }
  }
  function dropSsao(w) {
    if (!st.ssao) return;
    try { w.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('hp-ssao', w.scene.cameras); st.ssao.dispose(); } catch (err) { warn('ssao off', err); }
    st.ssao = null;
  }

  // ------------------------------------------------------------------ the hour, every so often
  function lights(w, hour) {
    if (w.sun) {
      w.sun.diffuse = color3(C.sunColorAt(hour));
      w.sun.specular = color3(C.sunColorAt(hour));
      // A clock that does not change the light leaves the sun's direction as it was: we hold it low and raking.
      if (!clockLit() && H.sky && H.sky._) {
        const d = H.sky._.sunToward(hour).scale(-1);
        if (d.y > -0.25) { d.y = -0.25; d.normalize(); }
        w.sun.direction.copyFrom(d);
      }
    }
    if (w.hemi) {
      w.hemi.diffuse = color3(C.skyColorAt(hour));
      w.hemi.groundColor = color3(C.groundColorAt(hour));
      w.hemi.specular = new B.Color3(0.1, 0.1, 0.12);
    }
    const night = hour < 5 || hour > 20.5;
    w.scene.environmentIntensity = night ? 0.45 : 1;
  }
  function refresh(w) {
    st.hour = hourNow();
    st.grade = C.gradeName(st.hour);
    lights(w, st.hour);
    if (w.look) {
      try { w.look.imageProcessing.exposure = C.exposureAt(st.hour); } catch { /* gone */ }
      st.tonemap = w.look.imageProcessing.toneMappingEnabled ? 'ACES' : 'none';
      st.bloom = Boolean(w.look.bloomEnabled);
    }
    updateGrade();
    if (Math.abs(wrapDiff(st.hour, st.envHour)) > 0.3) makeEnv(w, st.hour);
    publish();
  }
  function publish() {
    st.ssaoOn = Boolean(st.ssao);
    const look = { tier: st.tier, tonemap: st.tonemap, bloom: st.bloom, ssao: st.ssaoOn, cascades: st.cascades, grade: st.grade };
    try { window.__look = look; } catch { /* none */ }
    return look;
  }

  function retier() {
    const w = W();
    if (!st.on || !w) return;
    const next = tierNow();
    const changed = next !== st.tier;
    st.tier = next;
    retierShadows(w);
    if (w.look) {
      const sp = spec();
      try {
        w.look.automaticBuild = false;
        w.look.bloomEnabled = Boolean(sp.bloom); w.look.bloomWeight = sp.bloomWeight; w.look.bloomKernel = sp.bloomKernel; w.look.bloomScale = sp.bloomScale;
        w.look.prepare(); w.look.automaticBuild = true;
      } catch (err) { warn('retier look', err); }
    }
    if (!wantSsao()) dropSsao(w); else if (changed) st.ssaoAt = 0.8;
    if (changed && st.env) { st.envHour = -99; }
    refresh(w);
  }

  // ------------------------------------------------------------------ the world
  function apply(value) {
    const w = W();
    if (!w || !w.scene) return;
    st.opts = value && typeof value === 'object' ? value : {};
    st.pinned = Number.isFinite(Number(st.opts.hour)) ? Number(st.opts.hour) : 16.9;
    st.tier = tierNow();
    st.on = true;
    st.hour = hourNow();
    st.cascades = 1;
    setupShadows(w);
    st.cascades = st.csmOn ? Math.max(2, spec().cascades) : 1;
    setupLook(w);
    st.timer = 0; st.ssaoAt = 1.5; // (SSAO waits for the first frames: the world is on screen first)
    refresh(w);
  }
  function remove() {
    const w = W();
    st.on = false;
    if (w) dropSsao(w);
    if (st.env) { try { st.env.dispose(); } catch { /* gone */ } st.env = null; }
    if (st.lut) { try { st.lut.dispose(); } catch { /* gone */ } st.lut = null; }
    st.csm = null; st.csmOn = false; st.envHour = -99; st.lutHour = -99;
    try { delete window.__look; } catch { /* none */ }
  }
  H.features.register('lighting', {
    apply(value) { apply(value); },
    change(value) { remove(); apply(value); },
    dispose() { remove(); },
    codex: {
      title: 'Lighting', group: 'World features',
      what: 'A real light stack: a low raking sun with cascaded soft shadows, the sky reflected in metal and paint, filmic tone, bloom on what glows and a colour grade for each hour (dawn gold, noon neutral, dusk orange-magenta, night blue). Follows the Graphics setting.',
      value: { hour: 16.9 },
      fields: [['hour', 'the hour it holds while the clock does not change the light', '16.9'], ['shadows', 'false: leave the engine\'s shadows', 'true'], ['ssao', 'false: no ambient occlusion on desktop High', 'true'], ['grade', 'false: no colour grade', 'true']],
    },
  });
  H.hooks.world.push({ leave() { if (st.on) remove(); } });
  H.hooks.frame.push((dt) => {
    if (!st.on) return;
    const w = W();
    if (!w || !w.scene) return;
    st.timer += dt;
    if (st.ssaoAt > 0) { st.ssaoAt -= dt; if (st.ssaoAt <= 0) setupSsao(w); }
    if (st.timer < 0.25) return;
    st.timer = 0;
    try { refresh(w); } catch (err) { warn('frame', err); }
  });
  // The graphics setting (the game menu) retiers all of it.
  if (H.setQuality && !H.setQuality._lit) {
    const base = H.setQuality;
    const wrapped = function (q) { const r = base.apply(this, arguments); try { retier(); } catch (err) { warn('quality', err); } return r; };
    wrapped._lit = true;
    H.setQuality = wrapped;
  }

  // ------------------------------------------------------------------ for the playtest and the console
  H.lighting = {
    get tier() { return st.tier; },
    get hour() { return st.hour; },
    get on() { return st.on; },
    /** Puts the world's clock at an hour, stopped, and lets it change the light (the playtest's dawn, noon, dusk, night). */
    setHour(h) {
      const c = H.sky && H.sky.clock ? H.sky.clock(true) : null;
      if (!c) return null;
      if (!st.released) st.released = { hour: c.hour, run: c.run, light: c.light };
      const v = H.sky.hourOf ? H.sky.hourOf(h) : Number(h);
      c.hour = v; c.run = false; c.light = true; c.jumped = true;
      const w = W(); if (w && st.on) refresh(w);
      return v;
    },
    /** Gives the clock back as it was before setHour. */
    release() {
      const c = H.sky && H.sky.clock ? H.sky.clock(false) : null;
      if (c && st.released) { c.hour = st.released.hour; c.run = st.released.run; c.light = st.released.light; }
      st.released = null;
      const w = W(); if (w && st.on) refresh(w);
    },
    retier,
    state: () => ({ ...publish(), hour: st.hour, cascadesBuilt: st.csmOn, env: Boolean(st.env), lut: Boolean(st.lut), pinned: st.pinned }),
  };
})();
