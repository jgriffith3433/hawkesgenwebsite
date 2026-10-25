// Mayhem, part 4: how the rocket launcher and blasts feel. The numbers (pure, tested in test/engine/mayhem.test.ts) are
// H.mayhemMath (soundDelay, chainSchedule, detail, boomLayers, emberCount, launcherKick); this file only adds looks and
// sounds around what mayhem.js already does, never forces. A launcher fires with a muzzle flash, a puff and a backblast,
// the model kicks back; barrels set off by a blast go off one after another along the shock (a rolling chain, never all at
// once); each blast throws embers, and its boom comes in three layers (crack, boom, rumble) that reach you later the
// farther you are. Hit-stop, slow motion, the shake that falls off with distance, the screen flash and the scorch marks
// are Juice's (juice-feel.js, juice-fx.js) and hear the same 'explosion' event. Budget: the later blasts of a chain make
// less (fewer particles, no light, no embers), and the number of effects alive caps what a blast adds, so ten barrels
// stay inside H.budget on a phone. H.mayhem.feel.sample() gives the counts the playtest logs.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const X = H.mayhem;
  const M = H.mayhemMath;
  const W = () => H.world;
  const G = () => H.game;
  const hexc = (c) => B.Color3.FromHexString(c);

  const stats = { chains: 0, rolled: 0, firstGap: 0, maxLive: 0, embers: 0, muzzle: 0, layers: 0, lastDetail: 1, lastDelays: [], lastBlowAt: [] };
  let lastBoom = { at: null, t: -1e9 };
  let emberLive = 0;
  const live = () => X.fxCount() + emberLive;
  /** Most effects a blast may add on top of what is alive: lights bound it on a phone, so does the tier. */
  const cap = () => (H.budget && H.budget.lights ? H.budget.lights * 6 : 24);

  // ------------------------------------------------------------------ the rolling chain
  // Barrels that die in the same moment (a blast hurt them all) are collected for one step, then set off in order of
  // distance from the blast, `gap` apart, instead of all at once.
  let pending = [];
  function chain(e) {
    if (pending.indexOf(e) < 0) pending.push(e);
  }
  function flush() {
    if (!pending.length) return;
    const list = pending.filter((e) => e && e.alive && !e._exploded);
    pending = [];
    if (!list.length) return;
    const t = performance.now();
    const src = t - lastBoom.t < 1500 ? lastBoom.at : null;
    const dist = (e) => (src ? Math.hypot(e.x - src[0], e.y - src[1], e.z - src[2]) : 0);
    const delays = M.chainSchedule(list.map(dist), { speed: 16, gap: 0.12, cap: 2.4 });
    list.forEach((e, i) => X.blowUp(e, delays[i]));
    if (list.length > 1) {
      stats.chains++; stats.rolled += list.length;
      stats.lastDelays = [...delays].sort((a, b) => a - b);
      stats.firstGap = stats.lastDelays[1] - stats.lastDelays[0];
    }
  }
  X.steps.push(flush);

  /** A blast went off (runBoom tells us): where, for the next chain's distances. Returns how much show to make. */
  function note(at, chainNo) {
    lastBoom = { at, t: performance.now() };
    const d = M.detail(chainNo, live(), X.quality, cap());
    stats.lastDetail = d.k;
    stats.maxLive = Math.max(stats.maxLive, live());
    return d;
  }

  // ------------------------------------------------------------------ embers
  function embers(at, R, k) {
    if (!W() || !W().dot) return null;
    const n = M.emberCount(R, k * [1, 0.55, 0.3][X.quality]);
    if (n < 3) return null;
    const ps = new B.ParticleSystem('mh-embers', n, W().scene);
    ps.particleTexture = W().dot; ps.emitter = new B.Vector3(at[0], at[1] + 0.3, at[2]);
    ps.minEmitBox = new B.Vector3(-0.3, 0, -0.3); ps.maxEmitBox = new B.Vector3(0.3, 0.3, 0.3);
    ps.color1 = new B.Color4(1, 0.78, 0.25, 1); ps.color2 = new B.Color4(1, 0.4, 0.08, 1); ps.colorDead = new B.Color4(0.3, 0.05, 0, 0);
    ps.minSize = 0.05; ps.maxSize = 0.15;
    ps.minLifeTime = 0.9; ps.maxLifeTime = 2.2;
    ps.manualEmitCount = n;
    ps.minEmitPower = 3; ps.maxEmitPower = 3 + R * 0.9;
    ps.direction1 = new B.Vector3(-1, 1.2, -1); ps.direction2 = new B.Vector3(1, 3, 1);
    ps.gravity = new B.Vector3(0, -4, 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    ps.disposeOnStop = true; ps.targetStopDuration = 2.4;
    emberLive++; stats.embers++;
    ps.onDisposeObservable.add(() => { emberLive = Math.max(0, emberLive - 1); });
    ps.start();
    return ps;
  }

  // ------------------------------------------------------------------ a boom in three layers, late by distance
  function boomSound(at, R, asset, k) {
    const c = W() && W().scene && W().scene.activeCamera;
    const p = c ? c.globalPosition || c.position : null;
    const dist = p ? Math.hypot(at[0] - p.x, at[1] - p.y, at[2] - p.z) : 0;
    const L = M.boomLayers(R, dist);
    stats.layers++;
    const a = H.audio && H.audio.context;
    // The game has its own boom: one clip, late by distance and duller by volume. Else three synthesized layers.
    if (X.hasSound('boom', asset) || !a || a.state !== 'running') {
      const play = () => X.sound('boom', { at, size: R, asset });
      if (L.crack.delay > 0.03) setTimeout(play, L.crack.delay * 1000); else play();
      return L;
    }
    const t0 = a.currentTime, noise = X.noise();
    if (!noise) return L;
    const layer = (cfg, type, f0, f1, seconds, peak) => {
      if (cfg.gain < 0.02) return;
      const t = t0 + cfg.delay;
      const src = a.createBufferSource(); src.buffer = noise; src.start(t, Math.random(), seconds + 0.05); src.stop(t + seconds + 0.05);
      const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(40, Math.min(f1, cfg.cutoff)), t + seconds);
      const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * cfg.gain), t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      src.connect(f).connect(g).connect(H.audio.master);
    };
    layer(L.crack, 'highpass', 1800, 900, 0.22, 0.7 * k + 0.2);
    layer(L.boom, 'lowpass', Math.min(2400, L.boom.cutoff), 70, L.boom.seconds, 0.9);
    layer(L.rumble, 'lowpass', 400, 45, L.rumble.seconds, 0.6);
    // The thump under it: a sine falling away.
    if (L.boom.gain > 0.02) {
      const t = t0 + L.boom.delay;
      const os = a.createOscillator(); os.type = 'sine'; os.frequency.setValueAtTime(110, t); os.frequency.exponentialRampToValueAtTime(28, t + 0.6);
      const og = a.createGain(); og.gain.setValueAtTime(0.8 * L.boom.gain, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      os.connect(og).connect(H.audio.master); os.start(t); os.stop(t + 0.75);
    }
    return L;
  }

  // ------------------------------------------------------------------ the launcher: muzzle flash, puff and backblast
  function muzzle(from, dir, mine) {
    const g = G();
    if (!W() || !g) return;
    const K = M.launcherKick(1);
    stats.muzzle++;
    const tip = [from[0] + dir[0] * 0.55, from[1] + dir[1] * 0.55, from[2] + dir[2] * 0.55];
    if (live() < cap()) {
      const ball = B.MeshBuilder.CreateSphere('mh-muzzle', { diameter: 1, segments: 8 }, W().scene);
      const m = X.glowMat('mh-muzzle', '#ffd08a', 0.95);
      ball.material = m; ball.isPickable = false; ball.metadata = { decor: true }; ball.position.set(tip[0], tip[1], tip[2]);
      let t = 0;
      X.addFx({
        update(dt) { t += dt; const k = t / K.flash; ball.scaling.setAll(0.55 - 0.3 * k); m.alpha = 0.95 * Math.max(0, 1 - k); return t < K.flash; },
        dispose() { ball.dispose(); m.dispose(); },
      });
    }
    g.burst(tip, { color: '#a39d95', count: X.q(10), speed: 2.6, size: 0.5, life: 0.9 });
    g.burst([from[0] - dir[0] * 0.5, from[1] - dir[1] * 0.5, from[2] - dir[2] * 0.5], { color: '#ffb36b', count: X.q(8), speed: 4, size: 0.2, life: 0.3 });
    if (mine) {
      g.camera.shake(K.camera, 0.12);
      if (H.juice && H.juice.flash) H.juice.flash(0.16);
    }
    return K;
  }

  H.hooks.world.push({
    leave() { pending = []; lastBoom = { at: null, t: -1e9 }; emberLive = 0; },
  });

  X.feel = {
    math: M, chain, note, embers, boomSound, muzzle, flush,
    sample: () => ({ ...stats, live: live(), cap: cap(), pending: pending.length }),
    reset: () => { Object.assign(stats, { chains: 0, rolled: 0, firstGap: 0, maxLive: 0, embers: 0, muzzle: 0, layers: 0, lastDelays: [] }); },
  };
})();
