// The island's hours and weather (H.weather, window.__weather). Two layers over the soundscape's per-area beds:
//  1. Time of day: four ambience beds (dawn chorus, midday cicadas, dusk gulls and waves, night crickets / frogs / owl /
//     surf) crossfaded by H.sky.clock, never faster than FADE_S (30 s) however fast the clock jumps.
//  2. A rain shower that rolls in at random (or on H.weather.force()), 60-120 s: the sky and fog darken (H.sky 'weather'),
//     rain falls round the camera, splashes on the ground, rings on the sea, a wet sheen on surfaces, lightning with
//     thunder late by distance, and rain that sounds like what is over you (open ground, pier boards or a hut, the
//     hangar's metal roof).
// A phone plays at most two beds at once (area, hour and rain beds together) and lighter rain. Files are
// /play/audio/sfx/<name>.mp3 (tod-*, rain-*, thunder-*); a missing file just leaves that bed out (thunder falls back to a
// synthesized rumble). No fetch loops: a bed's file is fetched when it is first wanted. The frame hook drives everything.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = window.BABYLON;
  if (!H || !B || H.weather || !H.soundscape) return;
  const DIR = '/play/audio/sfx/';
  const FADE_S = 30; // a bed goes from silent to full (or back) in no less than this
  const PHONE = H.device && H.device.tier === 'phone';
  const MAX_BEDS = PHONE ? 2 : 99;
  const S = H.soundscape;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);

  // Each bed: its file and how loud it plays (Gen takes are normalised, so these are only balance).
  const TOD = { dawn: 'tod-dawn', day: 'tod-day', dusk: 'tod-dusk', night: 'tod-night' };
  const TOD_GAIN = { dawn: 0.8, day: 0.7, dusk: 0.8, night: 0.8 };
  const RAIN = { ground: 'rain-ground', wood: 'rain-wood', metal: 'rain-metal' };
  const RAIN_GAIN = { ground: 0.85, wood: 0.9, metal: 0.8 };

  const bufs = new Map(), beds = {}, log = [], pending = [];
  const st = {
    hour: null, bed: null, wt: { dawn: 0, day: 0, dusk: 0, night: 0 },
    rain: { on: false, level: 0, t: 0, dur: 0, next: rnd(120, 300), lightning: false, bolt: 0, flashT: 0, forced: false },
    surface: 'ground', roofed: 0, wet: 0, wetApplied: -1, flashes: 0, thunders: 0, last: 0, roofAt: 0, roof: null, active: [], skySet: false,
  };

  function note(ev, data) {
    const e = Object.assign({ t: Math.round(performance.now()), ev }, data);
    log.push(e); if (log.length > 300) log.shift();
    try { const g = H.game; if (g && g.emit) g.emit('soundscape', e); } catch { /* none listening */ }
  }
  function load(name) {
    if (!bufs.has(name)) {
      const ctx = H.audio.context;
      bufs.set(name, fetch(`${DIR}${name}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status)))).then((b) => ctx.decodeAudioData(b)).catch(() => null));
    }
    return bufs.get(name);
  }
  function bed(name) {
    if (!beds[name]) beds[name] = { name, w: 0, target: 0, src: null, g: null, loading: false, missing: false };
    return beds[name];
  }
  /** Moves a bed's weight toward its target by at most slew a second; makes its source when wanted, stops it when faded out. */
  function drive(b, dt, slew) {
    const ctx = H.audio.context, dest = H.audio.ambience || H.audio.background;
    if (!ctx || ctx.state !== 'running' || !dest) return;
    if ((b.target > 0 || b.w > 0) && !b.src && !b.loading && !b.missing) {
      b.loading = true;
      load(b.name).then((buf) => {
        b.loading = false;
        if (!buf) { b.missing = true; return; }
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = buf; s.loop = true; g.gain.value = 0;
        s.connect(g).connect(dest); s.start(0, Math.random() * buf.duration);
        b.src = s; b.g = g;
      });
    }
    const d = b.target - b.w;
    b.w += Math.abs(d) <= slew * dt ? d : Math.sign(d) * slew * dt;
    if (b.g) b.g.gain.setTargetAtTime(b.w, ctx.currentTime, 0.25);
    if (b.src && b.w <= 0.0005 && b.target <= 0) { try { b.src.stop(); b.src.disconnect(); b.g.disconnect(); } catch { /* gone */ } b.src = null; b.g = null; b.w = 0; }
  }

  // ---------------------------------------------------------------- the hour
  function hourNow() {
    const c = H.sky && H.sky.clock ? H.sky.clock(false) : null;
    if (c && Number.isFinite(c.hour)) return ((c.hour % 24) + 24) % 24;
    return Number.isFinite(H.lighting && H.lighting.hour) ? H.lighting.hour : 16.9;
  }
  /** How much of each hour's bed there is at an hour (they overlap a little and are normalised). */
  function hourWeights(h) {
    const w = {
      dawn: smooth(4.2, 6, h) * (1 - smooth(8, 10, h)),
      day: smooth(8, 10, h) * (1 - smooth(16.5, 18, h)),
      dusk: smooth(16.5, 18, h) * (1 - smooth(20, 21.6, h)),
      night: h < 12 ? 1 - smooth(4.2, 6.2, h) : smooth(19.6, 21.6, h),
    };
    const sum = w.dawn + w.day + w.dusk + w.night || 1;
    for (const k in w) w[k] /= sum;
    return w;
  }

  // ---------------------------------------------------------------- the rain: particles, rings, wet sheen
  const fx = { ps: null, splash: null, rings: [], next: 0, mats: null };
  function build(scene) {
    if (fx.ps) return;
    const dot = H.world.dot;
    const ps = new B.ParticleSystem('wx-rain', PHONE ? 260 : 1500, scene);
    ps.particleTexture = dot; ps.emitter = new B.Vector3(0, 0, 0);
    ps.minEmitBox = new B.Vector3(-20, 14, -20); ps.maxEmitBox = new B.Vector3(20, 18, 20);
    ps.color1 = new B.Color4(0.78, 0.85, 0.95, 0.5); ps.color2 = new B.Color4(0.65, 0.76, 0.9, 0.35); ps.colorDead = new B.Color4(0.7, 0.8, 0.9, 0);
    ps.minSize = 0.03; ps.maxSize = 0.05; ps.minScaleY = 8; ps.maxScaleY = 13;
    ps.billboardMode = B.ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.minLifeTime = 0.8; ps.maxLifeTime = 0.95; ps.minEmitPower = 20; ps.maxEmitPower = 24;
    ps.direction1 = new B.Vector3(0.05, -1, 0.02); ps.direction2 = new B.Vector3(0.05, -1, 0.02); ps.gravity = B.Vector3.Zero(); ps.emitRate = 0;
    fx.ps = ps; ps.start();
    const sp = new B.ParticleSystem('wx-splash', PHONE ? 40 : 160, scene);
    sp.particleTexture = dot; sp.emitter = new B.Vector3(0, 0, 0);
    sp.minEmitBox = new B.Vector3(-9, 0, -9); sp.maxEmitBox = new B.Vector3(9, 0.02, 9);
    sp.color1 = new B.Color4(0.9, 0.95, 1, 0.45); sp.color2 = new B.Color4(0.8, 0.9, 1, 0.3); sp.colorDead = new B.Color4(0.9, 0.95, 1, 0);
    sp.minSize = 0.05; sp.maxSize = 0.12; sp.minLifeTime = 0.15; sp.maxLifeTime = 0.3;
    sp.minEmitPower = 0.5; sp.maxEmitPower = 1.2; sp.direction1 = new B.Vector3(-0.4, 1, -0.4); sp.direction2 = new B.Vector3(0.4, 1.4, 0.4);
    sp.gravity = new B.Vector3(0, -5, 0); sp.emitRate = 0;
    fx.splash = sp; sp.start();
    for (let i = 0; i < (PHONE ? 6 : 16); i++) {
      const m = B.MeshBuilder.CreateTorus('wx-ring', { diameter: 1, thickness: 0.03, tessellation: 16 }, scene);
      const mat = new B.StandardMaterial('wx-ring', scene);
      mat.emissiveColor = new B.Color3(0.85, 0.93, 1); mat.disableLighting = true; mat.alpha = 0;
      m.material = mat; m.isPickable = false; m.metadata = { decor: true, noGlow: true }; m.scaling.y = 0.2; m.setEnabled(false);
      fx.rings.push({ m, mat, t: 1, x: 0, z: 0 });
    }
  }
  function teardown() {
    if (fx.ps) { fx.ps.dispose(); fx.ps = null; }
    if (fx.splash) { fx.splash.dispose(); fx.splash = null; }
    for (const r of fx.rings) { if (r.m.material) r.m.material.dispose(); r.m.dispose(); }
    fx.rings = [];
  }
  /** Wet: Standard and PBR materials a little darker and shinier as the ground soaks (and back again). */
  function wetMaterials(scene, amount) {
    if (!fx.mats) {
      fx.mats = [];
      for (const m of scene.materials || []) {
        if (!m || m.disableLighting || /sky|water|sea|ocean|rain|ring|glow|beam|particle|hologram|ov-/i.test(m.name || '')) continue;
        const cls = m.getClassName ? m.getClassName() : '';
        if (cls === 'PBRMaterial') fx.mats.push({ m, pbr: true, rough: m.roughness, alb: m.albedoColor ? m.albedoColor.clone() : null });
        else if (cls === 'StandardMaterial') fx.mats.push({ m, pbr: false, pow: m.specularPower, spec: m.specularColor ? m.specularColor.clone() : null, dif: m.diffuseColor ? m.diffuseColor.clone() : null });
        if (fx.mats.length >= 160) break;
      }
    }
    for (const e of fx.mats) {
      const m = e.m;
      if (m.isDisposed && m.isDisposed()) continue;
      if (e.pbr) {
        if (typeof e.rough === 'number') m.roughness = e.rough * (1 - 0.45 * amount);
        if (e.alb) m.albedoColor.copyFrom(e.alb.scale(1 - 0.22 * amount));
      } else {
        m.specularPower = e.pow + 40 * amount;
        if (e.spec) m.specularColor.copyFrom(e.spec.scale(1 + 0.9 * amount));
        if (e.dif) m.diffuseColor.copyFrom(e.dif.scale(1 - 0.2 * amount));
      }
    }
  }

  // ---------------------------------------------------------------- thunder
  function thunderNow(distance) {
    const ctx = H.audio.context, dest = H.audio.effects || H.audio.master;
    st.thunders++;
    note('thunder', { distance: Math.round(distance), n: st.thunders });
    try { const g = H.game; if (g && g.emit) g.emit('thunder', { distance }); } catch { /* none */ }
    if (!ctx || ctx.state !== 'running' || !dest) return;
    const near = 1 - smooth(300, 2000, distance); // farther: duller and softer
    const id = 1 + Math.floor(Math.random() * 3);
    load(`thunder-${id}`).then((buf) => {
      const f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'lowpass'; f.frequency.value = 900 + near * 7000; g.gain.value = 0.45 + near * 0.55;
      let s;
      if (buf) { s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = 0.95 + Math.random() * 0.1; }
      else { // a synthesized rumble when the file is not there
        const len = ctx.sampleRate * 3, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.9));
        s = ctx.createBufferSource(); s.buffer = nb; f.frequency.value = 220;
      }
      s.connect(f).connect(g).connect(dest); s.start();
    });
  }
  function strike() {
    st.flashes++;
    st.rain.flashT = 0.35;
    const distance = rnd(350, 1700);
    pending.push({ at: performance.now() + (distance / 343) * 1000, distance });
    note('lightning', { n: st.flashes, distance: Math.round(distance), thunderIn: Math.round((distance / 343) * 10) / 10 });
    try { const g = H.game; if (g && g.emit) g.emit('lightning', {}); } catch { /* none */ }
  }

  // ---------------------------------------------------------------- the shower
  function start(o) {
    const r = st.rain;
    r.on = true; r.t = 0; r.forced = Boolean(o.forced);
    r.dur = clamp(Number(o.seconds) || rnd(60, 120), 5, 600);
    r.lightning = o.lightning !== false;
    r.bolt = o.firstBolt ?? rnd(5, 12);
    note('rain-start', { seconds: Math.round(r.dur), lightning: r.lightning, forced: r.forced });
    const sc = H.world && H.world.scene; if (sc) build(sc);
  }
  function stop() {
    const r = st.rain;
    if (!r.on) return;
    r.on = false; r.next = rnd(150, 420);
    note('rain-stop', {});
  }
  /** What roof is over the player: 'metal' (the Overseer's hangar), 'wood' (a hut, the pier's shelter) or null (open sky). */
  function overhead(p) {
    const g = H.game;
    if (!g || !g.raycast) return null;
    const hit = g.raycast([p.x, p.bottom + 1.9, p.z], [0, 1, 0], 40, { ignore: p, all: true });
    const en = hit && hit.entity;
    if (!en) return null;
    if (en.data && en.data.overseer) return 'metal';
    if (/hut|house|shed|roof|pier|dock|shelter|cabin/i.test(`${en.name || ''} ${en.tag || ''}`) && hit.distance < 8) return 'wood';
    return null;
  }

  function frame() {
    const ctx = H.audio.context, w = H.world, p = w && w.player;
    if (!p || !w.scene) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - st.last) / 1000));
    st.last = now;
    if (document.hidden || dt === 0) return;
    const r = st.rain;
    // ---- the hour
    const h = hourNow();
    st.hour = h;
    const wt = hourWeights(h);
    st.wt = wt;
    const dom = Object.keys(wt).reduce((a, b) => (wt[b] > wt[a] ? b : a));
    if (dom !== st.bed) { note('bed-change', { from: st.bed, to: dom, hour: Math.round(h * 100) / 100, fadeSeconds: FADE_S }); st.bed = dom; }
    // ---- the weather clock
    if (!r.on) {
      r.next -= dt;
      // Another system's weather (config.weather) means it is already raining: leave it be.
      if (r.next <= 0 && !(H.water && H.water.rain > 0)) start({});
    } else {
      r.t += dt;
      if (r.t >= r.dur) stop();
    }
    r.level += clamp((r.on ? 1 : 0) - r.level, -dt / 10, dt / 8); // rolls in over 8 s, clears over 10 s
    const lvl = r.level * (1 - smooth(120, 260, p.y)); // none from up in the sky
    // ---- what is over the player
    if (now - st.roofAt > 250) { st.roofAt = now; st.roof = overhead(p); }
    const roof = st.roof;
    const onPier = S.weights(p.x).pier > 0.5 && p.y > -1;
    const surface = roof === 'metal' ? 'metal' : (roof === 'wood' || onPier) ? 'wood' : 'ground';
    if (surface !== st.surface) { note('rain-surface', { from: st.surface, to: surface, raining: lvl > 0.05 }); st.surface = surface; }
    st.roofed += clamp((roof ? 1 : 0) - st.roofed, -dt * 2, dt * 2);
    // ---- thunder after its flash
    for (let i = pending.length - 1; i >= 0; i--) if (now >= pending[i].at) { thunderNow(pending[i].distance); pending.splice(i, 1); }
    // ---- the sky, the sheen, the particles
    let flash = 0;
    if (r.on && r.lightning && lvl > 0.5) {
      r.bolt -= dt;
      if (r.bolt <= 0) { r.bolt = rnd(9, 22); strike(); }
    }
    if (r.flashT > 0) { r.flashT -= dt; flash = r.flashT > 0.22 || (r.flashT < 0.12 && r.flashT > 0.05) ? 1 : 0; }
    if (H.sky && H.sky.set) {
      const want = lvl > 0.01 || r.flashT > 0;
      if (want) H.sky.set('weather', { dark: 0.42 * lvl, flash, weather: true });
      else if (st.skySet) H.sky.set('weather', null);
      st.skySet = want;
    }
    st.wet += clamp(lvl - st.wet, -dt / 40, dt / 10);
    if (Math.abs(st.wet - st.wetApplied) > 0.04 || (st.wet < 0.001 && st.wetApplied > 0)) {
      st.wetApplied = st.wet < 0.001 ? 0 : st.wet;
      if (fx.mats || st.wet > 0) wetMaterials(w.scene, st.wetApplied);
    }
    if (lvl > 0.01 && !fx.ps) build(w.scene);
    const cam = w.scene.activeCamera;
    if (fx.ps && cam) {
      const c = cam.globalPosition, open = 1 - st.roofed * 0.85;
      fx.ps.emitter.set(c.x, c.y - 16, c.z);
      fx.ps.emitRate = Math.round((PHONE ? 240 : 1400) * lvl * open);
      fx.splash.emitter.set(c.x, p.bottom + 0.05, c.z);
      fx.splash.emitRate = Math.round((PHONE ? 45 : 170) * lvl * open);
      if (lvl > 0.05 && H.water && H.water.surfaceAt) {
        const want = lvl * (PHONE ? 8 : 22) * dt;
        let n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
        while (n-- > 0) {
          const a = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * 16;
          const x = c.x + Math.cos(a) * rad, z = c.z + Math.sin(a) * rad;
          const y = H.water.surfaceAt(x, z);
          if (y === null || y === undefined || y > c.y + 2) continue;
          const ring = fx.rings[fx.next++ % fx.rings.length];
          Object.assign(ring, { t: 0, x, z }); ring.m.position.set(x, y + 0.02, z); ring.m.setEnabled(true);
        }
      }
      for (const ring of fx.rings) {
        if (ring.t >= 1) continue;
        ring.t += dt / 0.7;
        if (ring.t >= 1) { ring.m.setEnabled(false); continue; }
        ring.m.scaling.x = ring.m.scaling.z = 0.1 + ring.t * 0.6; ring.mat.alpha = 0.6 * (1 - ring.t);
        const y = H.water.surfaceAt(ring.x, ring.z); if (y !== null && y !== undefined) ring.m.position.y = y + 0.02;
      }
      if (lvl <= 0.005 && !r.on && st.wet < 0.01 && !fx.rings.some((q) => q.t < 1)) teardown();
    }
    // ---- the beds
    if (!ctx || ctx.state !== 'running') return;
    const cand = [];
    const area = S.targets();
    for (const k in area) cand.push({ id: `area:${k}`, v: area[k], area: k });
    for (const k in TOD) cand.push({ id: `tod:${k}`, v: wt[k] * TOD_GAIN[k], tod: k });
    const rainMix = surface === 'metal' ? { metal: 1 } : surface === 'wood' ? { wood: 1, ground: 0.25 } : { ground: 1 };
    for (const k in RAIN) cand.push({ id: `rain:${k}`, v: (rainMix[k] || 0) * RAIN_GAIN[k] * lvl * 1.4, rain: k });
    // A phone keeps the two strongest beds (the ones playing now win ties); the rest fade out.
    let keep = null;
    if (MAX_BEDS < cand.length) {
      const score = (c) => c.v + (st.active.includes(c.id) ? 0.12 : 0);
      keep = new Set(cand.filter((c) => c.v > 0.02).sort((a, b) => score(b) - score(a)).slice(0, MAX_BEDS).map((c) => c.id));
    }
    const duck = 1 - 0.45 * lvl; // under rain the other beds sit back
    for (const c of cand) {
      const on = (!keep || keep.has(c.id)) && c.v > 0.02;
      if (c.area) { S.mask[c.area] = on ? duck : 0; continue; }
      const b = bed(c.tod ? TOD[c.tod] : RAIN[c.rain]);
      b.target = on ? c.v * (c.tod ? duck : 1) : 0;
      // ToD: reach the target (or silence) in FADE_S seconds, whatever its level — absolute 1/FADE_S would finish a
      // 0.8 bed in ~24 s and trip the playtest's "≥ 30 s" check.
      const todSlew = Math.max(Math.abs(b.target), b.w, 0.05) / FADE_S;
      drive(b, dt, c.tod ? todSlew : 0.6);
    }
    const act = cand.filter((c) => c.v > 0.02 && (!keep || keep.has(c.id))).map((c) => c.id);
    if (act.join() !== st.active.join()) { st.active = act; note('beds', { active: act }); }
  }
  H.hooks.frame.push(() => { try { frame(); } catch (err) { H.report(err, 'weather'); } });

  const api = {
    /** Starts a shower now: { seconds (60-120 by default), lightning (true) }. For the playtest and the console. */
    force(o = {}) { if (st.rain.on) { st.rain.t = 0; if (o.seconds) st.rain.dur = Number(o.seconds); } else start({ ...o, forced: true, firstBolt: o.firstBolt ?? 4 }); },
    clear() { stop(); },
    /** A lightning flash now, thunder to follow. */
    strike,
    fadeSeconds: FADE_S,
  };
  H.weather = api;
  Object.defineProperty(window, '__weather', {
    configurable: true,
    get: () => ({
      raining: st.rain.on, level: Math.round(st.rain.level * 100) / 100, seconds: Math.round(st.rain.t), duration: Math.round(st.rain.dur),
      surface: st.surface, hour: st.hour, bed: st.bed, fadeSeconds: FADE_S, hourWeights: st.wt, phone: PHONE, maxBeds: MAX_BEDS,
      active: st.active.slice(), activeBeds: st.active.length, wet: Math.round(st.wet * 100) / 100,
      beds: Object.values(beds).map((b) => ({ name: b.name, w: Math.round(b.w * 1000) / 1000, target: Math.round(b.target * 1000) / 1000, playing: Boolean(b.src), missing: b.missing })),
      flashes: st.flashes, thunders: st.thunders, pendingThunder: pending.length,
      particles: fx.ps ? fx.ps.getActiveCount() : 0, splashes: fx.splash ? fx.splash.getActiveCount() : 0,
      ringsLive: fx.rings.filter((q) => q.t < 1).length, log: log.slice(), force: api.force, clear: api.clear, strike: api.strike,
    }),
  });
})();
