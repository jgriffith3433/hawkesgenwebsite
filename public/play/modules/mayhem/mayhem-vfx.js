// Mayhem, part 5: the layers of a blast (J, 2026-11-11: "every barrel and the rocket go up like a AAA set piece").
// Each blast is built from layers, every one pooled so a chain of five allocates nothing after the first:
//   fireball   GPU particles, an 8x8 flipbook, additive, three size classes (S/M/L) by the blast's radius
//   smoke      a rising column of soft particles that drifts with the wind (H.wind.dir) and lingers 6 to 8 s
//   shockwave  a fast ring along the ground, with dust kicked up in the colour of the surface under it
//   sparks     stretched streaks (trails) that cool from white to red
//   flash      one pooled point light, 0.15 s, that lights the ground and props nearby
//   scorch     a mark on the ground (a flat plane lifted 3 cm, polygon offset), fading over 60 s
//   ripple     heat distortion (a post-process alive for half a second), desktop High only, the first blast of a chain
// The rocket (vehicles' class 'rocket') gets an exhaust flame, a dust burst at the pad and a smoke trail all the way up.
// Flipbooks: three 8x8 sheets (fire, smoke, sparks), 512 px on a phone and 1024 px elsewhere. They are drawn in code in slices
// after the world starts (no hitch at the first blast); `H.mayhem.vfx.useSheets({ fire, smoke, sparks })` replaces them with
// images (Hawkes Gen sprite sheets) when the game has them. Until the sheets are drawn `ready()` is false and mayhem.js
// makes its older effects. Numbers are in mayhem-math.js vfxPlan; `sample()` is what the playtest logs (per layer).
// Hit-stop, slow motion, shake, the boom and the Havok debris are not touched.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const X = H.mayhem;
  const M = H.mayhemMath;
  const W = () => H.world;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const GRID = 8;

  const log = { blasts: 0, fire: 0, smoke: 0, sparks: 0, shock: 0, dust: 0, flash: 0, scorch: 0, ripple: 0, exhaust: 0, padDust: 0, trail: 0, last: null, flashFrames: 0, smokeAlive: 0, allocations: 0 };
  let ready = false, building = false, sheetSize = 512, scene0 = null;
  const sheets = {}; // name -> { tex, ctx, size }
  const pools = {};
  let lights = [], scorch = null, rings = [], columns = [], flashes = [], ripple = null;

  // ------------------------------------------------------------------ the flipbooks, drawn in code
  const rngOf = (seed) => (M && M.rng ? M.rng(seed) : Math.random);
  /** One cell of a sheet. t 0..1 is the moment in the animation; `i` seeds the lobes (the same lobes in every frame of a sheet). */
  function drawCell(ctx, kind, cx, cy, s, t) {
    const r = rngOf(kind === 'fire' ? 11 : kind === 'smoke' ? 23 : 37);
    ctx.save();
    ctx.beginPath(); ctx.rect(cx, cy, s, s); ctx.clip();
    ctx.translate(cx + s / 2, cy + s / 2);
    if (kind === 'fire') {
      const grow = 1 - Math.pow(1 - t, 2), fade = clamp(1 - Math.max(0, t - 0.35) / 0.65, 0, 1);
      for (let l = 0; l < 14; l++) {
        const a = r() * 6.283, d = r() * 0.34 * grow * s, rad = (0.14 + r() * 0.14 + 0.12 * grow) * s * (0.6 + 0.5 * (1 - t * 0.5));
        const x = Math.cos(a) * d, y = Math.sin(a) * d - t * 0.1 * s * r();
        const heat = clamp(1 - t * 1.25 + (1 - l / 14) * 0.2, 0, 1);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(255,${Math.round(210 + 45 * heat)},${Math.round(120 * heat + 40)},${0.9 * fade})`);
        g.addColorStop(0.45, `rgba(255,${Math.round(110 + 80 * heat)},20,${0.7 * fade})`);
        g.addColorStop(1, 'rgba(120,20,0,0)');
        ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    } else if (kind === 'smoke') {
      const grow = 0.55 + 0.45 * t, fade = Math.sin(Math.PI * clamp(0.12 + t * 0.88, 0, 1)) ** 0.7;
      for (let l = 0; l < 16; l++) {
        const a = r() * 6.283, d = r() * 0.3 * grow * s, rad = (0.15 + r() * 0.16) * s * grow;
        const x = Math.cos(a) * d + Math.sin(t * 3 + l) * 0.01 * s, y = Math.sin(a) * d - t * 0.05 * s;
        const v = Math.round(70 + r() * 90 + (1 - t) * 20);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${v},${v - 2},${v - 6},${0.5 * fade})`);
        g.addColorStop(0.6, `rgba(${v},${v - 2},${v - 6},${0.22 * fade})`);
        g.addColorStop(1, `rgba(${v},${v},${v},0)`);
        ctx.fillStyle = g; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    } else {
      // sparks: a bright core with a short tail, cooling white to deep red over the sheet
      const heat = 1 - t;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.18);
      g.addColorStop(0, `rgba(255,${Math.round(150 + 105 * heat)},${Math.round(60 + 160 * heat * heat)},1)`);
      g.addColorStop(0.5, `rgba(255,${Math.round(90 + 60 * heat)},20,0.6)`);
      g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.fillRect(-s * 0.2, -s * 0.2, s * 0.4, s * 0.4);
      ctx.fillStyle = `rgba(255,${Math.round(120 + 80 * heat)},40,0.5)`;
      ctx.fillRect(-s * 0.46, -s * 0.02, s * 0.46, s * 0.04);
    }
    ctx.restore();
  }
  function makeSheet(name, size) {
    const tex = new B.DynamicTexture(`mh-sheet-${name}`, size, W().scene, true);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, size, size);
    tex.hasAlpha = true;
    sheets[name] = { tex, ctx, size, next: 0 };
    return sheets[name];
  }
  /** Draws a few cells at a time so the page never stalls (the whole sheet takes a few frames' worth of slices). */
  function drawSlice(name, n) {
    const sh = sheets[name], cell = sh.size / GRID;
    for (let k = 0; k < n && sh.next < GRID * GRID; k++, sh.next++) {
      const i = sh.next;
      drawCell(sh.ctx, name, (i % GRID) * cell, Math.floor(i / GRID) * cell, cell, i / (GRID * GRID - 1));
    }
    return sh.next >= GRID * GRID;
  }
  function build() {
    if (ready || building || !W() || !W().scene) return;
    building = true;
    try {
      const plan = M.vfxPlan(5, 1, (H.device && H.device.tier) || 'desktop');
      sheetSize = plan.sheet;
      ['fire', 'smoke', 'sparks'].forEach((n) => makeSheet(n, sheetSize));
    } catch (err) { building = false; return; } // no canvas (a headless run): the older effects stay
    const scene = W().scene;
    const step = () => {
      if (W() && W().scene !== scene) { building = false; return; }
      const names = Object.keys(sheets);
      let all = true;
      for (const n of names) if (!drawSlice(n, 4)) all = false;
      if (!all) { setTimeout(step, 0); return; }
      for (const n of names) try { sheets[n].tex.update(); } catch { /* fine */ }
      try { init(); ready = true; } catch (err) { H.report(err, 'mayhem vfx'); }
      // Hawkes Gen's art over the drawn stand-ins (they stay if a file does not load)
      try { useSheets({ fire: '/play/vfx/fireball.webp', smoke: '/play/vfx/smoke.webp', sparks: '/play/vfx/sparks.webp' }); } catch { /* the drawn ones stay */ }
      building = false;
    };
    setTimeout(step, 50);
  }
  /** Gen's sprite sheets (8x8) in place of the drawn ones: { fire, smoke, sparks } as urls; each is drawn into its texture. */
  function useSheets(urls) {
    for (const name of Object.keys(urls || {})) {
      const sh = sheets[name];
      if (!sh || !urls[name]) continue;
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { sh.ctx.clearRect(0, 0, sh.size, sh.size); sh.ctx.drawImage(img, 0, 0, sh.size, sh.size); sh.tex.update(); log.sheets = (log.sheets || 0) + 1; };
      img.src = urls[name];
    }
  }

  // ------------------------------------------------------------------ pooled particle systems, many emit points
  // One system per kind and size, a queue of where its next particles start and which way they go (the same way the
  // vehicles' surface effects do it); the system takes from the queue as it makes them. Nothing is made per blast.
  function makePool(name, o) {
    const sc = W().scene;
    const ps = new B.ParticleSystem(`mhv-${name}`, o.cap, sc);
    ps.particleTexture = sheets[o.sheet].tex;
    ps.emitter = new B.Vector3(0, -1000, 0);
    ps.emitRate = 0;
    ps.minSize = o.size[0]; ps.maxSize = o.size[1];
    ps.minLifeTime = o.life[0]; ps.maxLifeTime = o.life[1];
    ps.minEmitPower = 1; ps.maxEmitPower = 1;
    ps.gravity = new B.Vector3(0, o.gravity || 0, 0);
    ps.blendMode = o.add ? B.ParticleSystem.BLENDMODE_ADD : B.ParticleSystem.BLENDMODE_STANDARD;
    ps.minAngularSpeed = o.spin ? -o.spin : 0; ps.maxAngularSpeed = o.spin || 0;
    ps.updateSpeed = 1 / 60;
    ps.isAnimationSheetEnabled = true;
    const cell = sheets[o.sheet].size / GRID;
    ps.spriteCellWidth = cell; ps.spriteCellHeight = cell;
    ps.startSpriteCellID = 0; ps.endSpriteCellID = GRID * GRID - 1;
    ps.spriteCellChangeSpeed = o.sheet === 'sparks' ? 0.8 : 1;
    ps.spriteRandomStartCell = o.sheet === 'sparks';
    if (o.stretch) ps.billboardMode = B.ParticleSystem.BILLBOARDMODE_STRETCHED;
    if (o.grow) { ps.addSizeGradient(0, 0.6); ps.addSizeGradient(1, o.grow); }
    (o.colors || []).forEach((c) => ps.addColorGradient(c[0], new B.Color4(c[1], c[2], c[3], c[4])));
    if (o.drag) { ps.addDragGradient(0, 0.1); ps.addDragGradient(1, o.drag); }
    ps.renderingGroupId = 0;
    const p = { ps, q: [], qi: 0, cap: o.cap, name, queued: 0 };
    ps.startPositionFunction = (wm, pos) => { const e = p.q[p.qi]; if (e) pos.copyFromFloats(e[0], e[1], e[2]); else pos.copyFromFloats(0, -1000, 0); };
    ps.startDirectionFunction = (wm, dir) => {
      const e = p.q[p.qi++];
      if (e) dir.copyFromFloats(e[3], e[4], e[5]); else dir.copyFromFloats(0, 1, 0);
      if (p.qi >= p.q.length) { p.q.length = 0; p.qi = 0; }
    };
    ps.start();
    pools[name] = p;
    log.allocations++;
    return p;
  }
  /** n particles at `at`, thrown `dir` (its length: the speed), spread randomly; the pool's room is respected. */
  function emit(name, at, dir, n, spread = 0.3, scatter = 0.3) {
    const p = pools[name];
    if (!p || n <= 0) return 0;
    n = Math.min(n | 0, Math.max(0, Math.floor(p.cap * 0.9) - p.q.length + p.qi), 48);
    for (let i = 0; i < n; i++) {
      const r = () => (Math.random() - 0.5) * 2;
      p.q.push([at[0] + r() * scatter, at[1] + Math.abs(r()) * scatter * 0.5, at[2] + r() * scatter, dir[0] * (1 + r() * spread), dir[1] * (1 + r() * spread), dir[2] * (1 + r() * spread)]);
    }
    p.ps.manualEmitCount = (p.ps.manualEmitCount > 0 ? p.ps.manualEmitCount : 0) + n;
    return n;
  }
  const SMOKE_COLORS = [[0, 0.95, 0.5, 0.15, 0], [0.12, 0.7, 0.38, 0.2, 0.85], [0.35, 0.2, 0.19, 0.19, 0.8], [0.8, 0.36, 0.35, 0.35, 0.5], [1, 0.4, 0.4, 0.4, 0]];
  const FIRE_COLORS = [[0, 1, 0.85, 0.5, 0], [0.1, 1, 0.8, 0.45, 1], [0.7, 1, 0.45, 0.12, 0.8], [1, 0.4, 0.08, 0.02, 0]];
  const CLASS = { S: 0.55, M: 1, L: 1.6 };
  function init() {
    scene0 = W().scene;
    const phone = H.device && H.device.tier === 'phone';
    for (const c of Object.keys(CLASS)) {
      const k = CLASS[c];
      makePool(`fire${c}`, { sheet: 'fire', add: true, cap: phone ? 40 : 90, size: [1.2 * k, 2.6 * k], life: [0.45, 0.9], gravity: 1.5, spin: 1.2, colors: FIRE_COLORS });
      makePool(`smoke${c}`, { sheet: 'smoke', cap: phone ? 60 : 130, size: [1.6 * k, 3.6 * k], life: [6, 8], gravity: 0.5, spin: 0.35, grow: 2.4, colors: SMOKE_COLORS, drag: 0.7 });
    }
    makePool('sparks', { sheet: 'sparks', add: true, cap: phone ? 80 : 200, size: [0.25, 0.5], life: [0.5, 1.1], gravity: -14, stretch: true, colors: [[0, 1, 1, 1, 1], [1, 1, 0.4, 0.1, 0]] });
    makePool('dust', { sheet: 'smoke', cap: phone ? 60 : 140, size: [0.9, 2.1], life: [1.1, 2.2], gravity: 0.2, spin: 0.5, grow: 2.2, drag: 3, colors: [[0, 0.7, 0.62, 0.5, 0], [0.1, 0.7, 0.62, 0.5, 0.6], [1, 0.7, 0.62, 0.5, 0]] });
    makePool('exhaust', { sheet: 'fire', add: true, cap: phone ? 60 : 120, size: [1.1, 2.0], life: [0.25, 0.5], spin: 1, colors: FIRE_COLORS });
    makePool('trail', { sheet: 'smoke', cap: phone ? 90 : 220, size: [1.8, 3.2], life: [7, 9], gravity: 0.1, spin: 0.3, grow: 2.6, colors: SMOKE_COLORS, drag: 1 });
    const sc = W().scene;
    // the flash: pooled lights (their count never changes, so nothing recompiles when a blast goes off)
    const nl = M.vfxPlan(5, 1, H.device && H.device.tier).lights;
    lights = [];
    for (let i = 0; i < nl; i++) {
      const l = new B.PointLight(`mhv-flash-${i}`, new B.Vector3(0, -1000, 0), sc);
      l.diffuse = new B.Color3(1, 0.62, 0.26); l.specular = new B.Color3(0, 0, 0); l.intensity = 0; l.range = 20;
      lights.push(l);
    }
    // the ground ring: a few flat discs reused
    const tex = new B.DynamicTexture('mhv-ring', 128, sc, true);
    try {
      const c = tex.getContext(); c.clearRect(0, 0, 128, 128);
      const g = c.createRadialGradient(64, 64, 34, 64, 64, 62);
      g.addColorStop(0, 'rgba(255,220,160,0)'); g.addColorStop(0.7, 'rgba(255,225,170,0.85)'); g.addColorStop(0.85, 'rgba(255,190,110,0.5)'); g.addColorStop(1, 'rgba(255,160,70,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128); tex.update();
    } catch { /* fine */ }
    tex.hasAlpha = true;
    rings = [];
    for (let i = 0; i < 4; i++) {
      const mesh = B.MeshBuilder.CreateGround(`mhv-ring-${i}`, { width: 1, height: 1 }, sc);
      const m = new B.StandardMaterial(`mhv-ring-${i}`, sc);
      m.emissiveTexture = tex; m.opacityTexture = tex; m.diffuseColor = new B.Color3(0, 0, 0); m.specularColor = new B.Color3(0, 0, 0);
      m.disableLighting = true; m.backFaceCulling = false; m.alphaMode = B.Engine.ALPHA_ADD; m.disableDepthWrite = true; m.zOffset = -3;
      mesh.material = m; mesh.isPickable = false; mesh.metadata = { decor: true }; mesh.setEnabled(false);
      rings.push({ mesh, m, t: 1, d: 0.35, R: 1 });
    }
    // scorch marks: planes with a shared texture, each its own alpha
    const st = new B.DynamicTexture('mhv-scorch', 128, sc, true);
    try {
      const c = st.getContext(); c.clearRect(0, 0, 128, 128);
      const g = c.createRadialGradient(64, 64, 0, 64, 64, 62);
      g.addColorStop(0, 'rgba(8,6,5,0.95)'); g.addColorStop(0.4, 'rgba(18,13,10,0.8)'); g.addColorStop(0.75, 'rgba(30,22,16,0.32)'); g.addColorStop(1, 'rgba(30,22,16,0)');
      c.fillStyle = g; c.fillRect(0, 0, 128, 128);
      const r = rngOf(5);
      c.strokeStyle = 'rgba(10,8,6,0.5)'; c.lineWidth = 2;
      for (let i = 0; i < 18; i++) { const a = r() * 6.283, l0 = 20 + r() * 12, l1 = l0 + 14 + r() * 24; c.beginPath(); c.moveTo(64 + Math.cos(a) * l0, 64 + Math.sin(a) * l0); c.lineTo(64 + Math.cos(a) * l1, 64 + Math.sin(a) * l1); c.stroke(); }
      st.update();
    } catch { /* fine */ }
    st.hasAlpha = true;
    const cap = phone ? 8 : 20;
    scorch = { tex: st, marks: [], at: 0, cap };
    for (let i = 0; i < cap; i++) {
      const mesh = B.MeshBuilder.CreateGround(`mhv-scorch-${i}`, { width: 1, height: 1 }, sc);
      const m = new B.StandardMaterial(`mhv-scorch-${i}`, sc);
      m.diffuseTexture = st; m.useAlphaFromDiffuseTexture = true; m.specularColor = new B.Color3(0, 0, 0); m.backFaceCulling = false;
      m.zOffset = -2 - (i % 4) * 0.25; m.disableDepthWrite = true;
      mesh.material = m; mesh.isPickable = false; mesh.metadata = { decor: true }; mesh.receiveShadows = false; mesh.rotationQuaternion = new B.Quaternion(); mesh.setEnabled(false);
      scorch.marks.push({ mesh, m, born: -1, seconds: 60 });
    }
  }

  // ------------------------------------------------------------------ one blast
  const tierNow = () => (H.device && H.device.tier) || 'desktop';
  const highQuality = () => tierNow() === 'desktop' && (!H.quality || H.quality() === 'auto' || H.quality() === 'high');
  const windDir = () => { const d = H.wind && H.wind.on ? H.wind.dir : null; return d ? [d[0], d[1]] : [0.93, 0.37]; };
  const SURF = { sand: [0.86, 0.78, 0.58], snow: [0.95, 0.97, 1], grass: [0.5, 0.48, 0.36], dirt: [0.55, 0.45, 0.33], stone: [0.62, 0.62, 0.62], wood: [0.6, 0.5, 0.38] };
  const camPos = () => { const c = W() && W().scene && W().scene.activeCamera; return c ? c.globalPosition || c.position : null; };

  /** All layers of one blast at `at` (radius R). d: Mayhem's detail for it ({ k, light, embers, ring }). */
  function blast(at, R, d = {}, o = {}) {
    if (!ready) return false;
    const k = d.k == null ? 1 : d.k, chain = o.chain || 0;
    const plan = M.vfxPlan(R, k, tierNow(), chain);
    const here = { at: [...at], R, size: plan.size, chain, layers: {} };
    const wd = windDir();
    // fireball: the flipbook, scaled by the blast's size class, a core that rises
    const nf = emit(`fire${plan.size}`, at, [0, 1.8, 0], plan.fire, 0.8, R * 0.18);
    here.layers.fireball = nf; log.fire += nf;
    // sparks with trails
    const sp = emit('sparks', at, [0, 6 + R * 0.7, 0], plan.sparks, 0.9, 0.3);
    if (sp) for (let i = 0; i < sp; i++) { const q = pools.sparks.q[pools.sparks.q.length - 1 - i]; if (q) { const a = Math.random() * 6.283, s = 3 + Math.random() * (5 + R * 0.9); q[3] = Math.cos(a) * s; q[5] = Math.sin(a) * s; } }
    here.layers.sparks = sp; log.sparks += sp;
    // the smoke column: fed over about a second so it rises, not pops (see update)
    const pg = pools[`smoke${plan.size}`];
    if (pg) { pg.ps.gravity.x = wd[0] * 0.55; pg.ps.gravity.z = wd[1] * 0.55; }
    columns.push({ at: [...at], R, size: plan.size, left: plan.smoke, per: plan.smoke / 1.1, t: 0, rise: 0 });
    here.layers.smoke = plan.smoke; log.smoke += plan.smoke;
    // the ground: a ring that races out, dust in the surface's colour, a scorch mark
    let ground = null;
    try { ground = H.physics.raycast([at[0], at[1] + 0.6, at[2]], [0, -1, 0], Math.max(2.5, R * 0.9)); } catch { /* no ground */ }
    const gp = ground ? ground.point : [at[0], at[1] - 0.6, at[2]];
    const n = (ground && ground.normal) || [0, 1, 0];
    if (d.ring !== false) {
      const ring = rings.find((r) => r.t >= 1) || rings.reduce((a, b) => (a.t > b.t ? a : b));
      ring.t = 0; ring.d = 0.35; ring.R = plan.ring; ring.at = gp;
      ring.mesh.position.set(gp[0], gp[1] + 0.05, gp[2]); ring.mesh.setEnabled(true); ring.mesh.scaling.setAll(0.5);
      here.layers.shockwave = true; log.shock++;
    }
    let surface = 'dirt';
    try { if (ground && ground.entity && H.juiceMath && H.juiceMath.surfaceOf) surface = H.juiceMath.surfaceOf(ground.entity, gp); } catch { /* dirt */ }
    const col = SURF[surface] || SURF.dirt, dp = pools.dust;
    if (dp) { dp.ps.color1 = new B.Color4(col[0], col[1], col[2], 0.7); dp.ps.color2 = new B.Color4(col[0] * 0.85, col[1] * 0.85, col[2] * 0.85, 0.5); }
    let nd = 0;
    for (let i = 0; i < plan.dust; i += 1) {
      const a = (i / plan.dust) * 6.283 + Math.random() * 0.4, s = 6 + R * 1.1;
      nd += emit('dust', [gp[0] + Math.cos(a) * 0.6, gp[1] + 0.2, gp[2] + Math.sin(a) * 0.6], [Math.cos(a) * s, 0.8, Math.sin(a) * s], 1, 0.35, 0.1);
    }
    here.layers.dust = { n: nd, surface }; log.dust += nd;
    if (scorch && !(H.juice && H.juice.allowed && !H.juice.allowed('decals'))) {
      const m = scorch.marks[scorch.at++ % scorch.cap], size = plan.scorchSize * clamp(1 - (at[1] - gp[1]) / Math.max(1, R), 0.35, 1) * 2;
      const up = new B.Vector3(n[0], n[1], n[2]).normalize(), ax = B.Vector3.Cross(B.Vector3.Up(), up);
      if (ax.lengthSquared() > 1e-6) B.Quaternion.RotationAxisToRef(ax.normalize(), Math.acos(clamp(B.Vector3.Dot(B.Vector3.Up(), up), -1, 1)), m.mesh.rotationQuaternion); else m.mesh.rotationQuaternion.copyFromFloats(0, 0, 0, 1);
      m.mesh.rotationQuaternion.multiplyInPlace(B.Quaternion.RotationAxis(B.Vector3.Up(), Math.random() * 6.283));
      m.mesh.position.set(gp[0] + up.x * (0.03 + (scorch.at % 7) * 0.002), gp[1] + up.y * (0.03 + (scorch.at % 7) * 0.002), gp[2] + up.z * (0.03 + (scorch.at % 7) * 0.002));
      m.mesh.scaling.set(size, 1, size); m.m.alpha = 1; m.born = performance.now() / 1000; m.seconds = plan.scorchSeconds; m.mesh.setEnabled(true);
      here.layers.scorch = { size: Math.round(size * 10) / 10, seconds: m.seconds }; log.scorch++;
    }
    // the flash
    if (d.light !== false && lights.length) {
      const li = lights[(log.flash) % lights.length];
      flashes = flashes.filter((x) => x.light !== li); // a light has one flash at a time: the newest
      flashes.push({ light: li, t: 0, hold: plan.flash, total: plan.flash + 0.12, peak: 6 + R * 0.7, at: [at[0], at[1] + 1.2, at[2]], range: plan.flashRange, frames: 0 });
      here.layers.flash = { seconds: plan.flash, range: Math.round(plan.flashRange) }; log.flash++;
    }
    // the heat ripple
    if (plan.distortion && highQuality() && d.k >= 0.9) { if (startRipple(at)) { here.layers.ripple = true; log.ripple++; } }
    log.blasts++; log.last = here;
    return true;
  }

  function startRipple(at) {
    const sc = W().scene, cam = sc.activeCamera;
    if (!cam || ripple) return false;
    try {
      if (!B.Effect.ShadersStore.hpHeatFragmentShader) {
        B.Effect.ShadersStore.hpHeatFragmentShader = 'precision highp float; varying vec2 vUV; uniform sampler2D textureSampler; uniform vec2 center; uniform float radius; uniform float amp; uniform float aspect;\n'
          + 'void main(void){ vec2 d = vUV - center; d.x *= aspect; float r = length(d); float ring = exp(-pow((r - radius) / 0.05, 2.0)); vec2 dir = d / max(r, 0.0001); vec2 off = dir * ring * amp; off.x /= aspect; gl_FragColor = texture2D(textureSampler, vUV - off); }';
      }
      const eng = sc.getEngine(), w = eng.getRenderWidth(), h = eng.getRenderHeight();
      const p = B.Vector3.Project(new B.Vector3(at[0], at[1] + 1, at[2]), B.Matrix.Identity(), sc.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      const front = B.Vector3.Dot(new B.Vector3(at[0], at[1], at[2]).subtract(cam.globalPosition || cam.position), cam.getForwardRay().direction) > 0;
      if (!front) return false;
      const pp = new B.PostProcess('mhv-heat', 'hpHeat', ['center', 'radius', 'amp', 'aspect'], null, 1.0, cam);
      ripple = { pp, t: 0, d: 0.6, c: [p.x / w, 1 - p.y / h], aspect: w / h };
      pp.onApply = (eff) => { const k = ripple ? ripple.t / ripple.d : 1; eff.setFloat2('center', ripple ? ripple.c[0] : 0.5, ripple ? ripple.c[1] : 0.5); eff.setFloat('radius', 0.04 + k * 0.5); eff.setFloat('amp', 0.018 * (1 - k)); eff.setFloat('aspect', ripple ? ripple.aspect : 1); };
      return true;
    } catch (err) { ripple = null; return false; }
  }

  // ------------------------------------------------------------------ the rocket (vehicles' class 'rocket'): exhaust, pad dust, trail
  const pad = new WeakMap(); // entity -> { lifted: bool }
  let acc = { exhaust: 0, trail: 0, dust: 0 };
  function rockets(dt) {
    if (!H.vehicles || !H.vehicles.list) return;
    acc.exhaust += dt; acc.trail += dt; acc.dust += dt;
    const phone = tierNow() === 'phone', scale = phone ? 0.5 : 1;
    for (const e of H.vehicles.list()) {
      const v = e.vehicle;
      if (!v || !e.alive || !v.def || v.def.class !== 'rocket' || !v.flames || !v.flames[0]) continue;
      const fl = v.flames[0];
      const thrust = clamp(v.throttleNow || 0, 0, 1.3);
      if (thrust < 0.05 || !fl.isEnabled()) { if (pad.has(e)) pad.get(e).on = false; continue; }
      fl.computeWorldMatrix(true);
      const c = fl.getAbsolutePosition(), up = fl.getDirection(B.Vector3.Up());
      const noz = [c.x + up.x * 3 * fl.scaling.y, c.y + up.y * 3 * fl.scaling.y, c.z + up.z * 3 * fl.scaling.y];
      const out = [-up.x * (14 + 10 * thrust), -up.y * (14 + 10 * thrust), -up.z * (14 + 10 * thrust)];
      if (acc.exhaust > 1 / 30) {
        const n = emit('exhaust', noz, out, Math.max(1, Math.round((3 + 4 * thrust) * scale)), 0.35, 0.5);
        log.exhaust += n;
      }
      if (acc.trail > 1 / 20) {
        const n = emit('trail', noz, [-up.x * 2.5, -up.y * 2.5, -up.z * 2.5], Math.max(1, Math.round(2 * scale)), 0.9, 0.6);
        log.trail += n;
      }
      // the pad: dust thrown out from under the engine while it is close to the ground
      let st = pad.get(e);
      if (!st) { st = { on: false, burst: 0 }; pad.set(e, st); }
      let hit = null;
      try { hit = H.physics.raycast([noz[0], noz[1] + 1, noz[2]], [0, -1, 0], 22); } catch { /* none */ }
      if (hit && hit.point[1] > noz[1] - 20) {
        const h = Math.max(0.1, noz[1] - hit.point[1]), near = clamp(1 - h / 20, 0, 1);
        if (acc.dust > 1 / 12 || !st.on) {
          let surface = 'dirt';
          try { if (hit.entity && H.juiceMath && H.juiceMath.surfaceOf) surface = H.juiceMath.surfaceOf(hit.entity, hit.point); } catch { /* dirt */ }
          const col = SURF[surface] || SURF.dirt;
          pools.dust.ps.color1 = new B.Color4(col[0], col[1], col[2], 0.7); pools.dust.ps.color2 = new B.Color4(col[0] * 0.85, col[1] * 0.85, col[2] * 0.85, 0.5);
          const nn = Math.round((st.on ? 4 : 20) * near * scale) + 1;
          for (let i = 0; i < nn; i++) { const a = Math.random() * 6.283, s = (6 + near * 8) * (0.6 + Math.random() * 0.6); log.padDust += emit('dust', [hit.point[0] + Math.cos(a) * 1.5, hit.point[1] + 0.2, hit.point[2] + Math.sin(a) * 1.5], [Math.cos(a) * s, 0.7, Math.sin(a) * s], 1, 0.3, 0.2); }
        }
      }
      st.on = true;
    }
    if (acc.exhaust > 1 / 30) acc.exhaust = 0;
    if (acc.trail > 1 / 20) acc.trail = 0;
    if (acc.dust > 1 / 12) acc.dust = 0;
  }

  // ------------------------------------------------------------------ every frame
  function update(dt) {
    if (!ready) { if (!building && W() && W().scene) build(); return; }
    if (!W() || W().scene !== scene0) { ready = false; dispose(); return; }
    dt = Math.min(dt, 0.1);
    // columns: the smoke fed up from the ground over about a second
    for (let i = columns.length - 1; i >= 0; i--) {
      const c = columns[i];
      c.t += dt;
      const n = Math.min(c.left, Math.max(1, Math.round(c.per * dt)));
      for (let j = 0; j < n; j++) {
        const h = Math.min(1, c.t / 1.1), y = c.at[1] + 0.4 + h * c.R * 1.3;
        emit(`smoke${c.size}`, [c.at[0], y, c.at[2]], [(Math.random() - 0.5) * 1.2, 3.2 + c.R * 0.35, (Math.random() - 0.5) * 1.2], 1, 0.4, c.R * 0.22 * (1 - h * 0.4));
      }
      c.left -= n;
      if (c.left <= 0 || c.t > 2) columns.splice(i, 1);
    }
    // flashes
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.t += dt; f.frames++;
      const l = f.light;
      l.position.set(f.at[0], f.at[1], f.at[2]); l.range = f.range;
      l.intensity = f.t < f.hold ? f.peak : f.peak * Math.max(0, 1 - (f.t - f.hold) / (f.total - f.hold));
      if (f.t >= f.total) { l.intensity = 0; l.position.y = -1000; log.flashFrames = Math.max(log.flashFrames, f.frames); flashes.splice(i, 1); }
    }
    // rings
    for (const r of rings) {
      if (r.t >= 1) continue;
      r.t = Math.min(1, r.t + dt / r.d);
      const e = 1 - Math.pow(1 - r.t, 2.2);
      r.mesh.scaling.setAll(Math.max(0.3, r.R * 2 * e)); r.m.alpha = 0.9 * (1 - r.t);
      if (r.t >= 1) r.mesh.setEnabled(false);
    }
    // scorch: fades over its seconds
    const now = performance.now() / 1000;
    if (scorch) for (const m of scorch.marks) {
      if (m.born < 0) continue;
      const k = (now - m.born) / m.seconds;
      if (k >= 1) { m.born = -1; m.mesh.setEnabled(false); } else m.m.alpha = 0.92 * (1 - k * k * 0.6) * (1 - k);
    }
    if (ripple) { ripple.t += dt; if (ripple.t >= ripple.d) { try { ripple.pp.dispose(); } catch { /* gone */ } ripple = null; } }
    let alive = 0; for (const k of Object.keys(pools)) if (k.startsWith('smoke') || k === 'trail') alive += pools[k].ps.getActiveCount();
    log.smokeAlive = alive;
    rockets(dt);
  }
  function dispose() {
    for (const p of Object.values(pools)) try { p.ps.dispose(); } catch { /* gone */ }
    for (const k of Object.keys(pools)) delete pools[k];
    for (const l of lights) try { l.dispose(); } catch { /* gone */ }
    for (const r of rings) try { r.mesh.dispose(); r.m.dispose(); } catch { /* gone */ }
    if (scorch) for (const m of scorch.marks) try { m.mesh.dispose(); m.m.dispose(); } catch { /* gone */ }
    if (ripple) try { ripple.pp.dispose(); } catch { /* gone */ }
    for (const s of Object.values(sheets)) try { s.tex.dispose(); } catch { /* gone */ }
    for (const k of Object.keys(sheets)) delete sheets[k];
    lights = []; rings = []; scorch = null; columns = []; flashes = []; ripple = null; ready = false; building = false;
  }

  X.frames.push(update);
  H.hooks.world.push({ enter() { build(); }, leave() { dispose(); } });

  X.vfx = {
    ready: () => ready, blast, useSheets, plan: M.vfxPlan,
    /** What the playtest reads: the cumulative count of each layer, and the last blast's layers. */
    sample: () => ({ ready, sheet: sheetSize, tier: tierNow(), pools: Object.keys(pools).length, ...log, scorchLive: scorch ? scorch.marks.filter((m) => m.born >= 0).length : 0, columnsFeeding: columns.length }),
    reset: () => { for (const k of Object.keys(log)) if (typeof log[k] === 'number' && k !== 'allocations') log[k] = 0; log.last = null; },
  };
  window.__mayhemVfx = () => X.vfx.sample();
})();
