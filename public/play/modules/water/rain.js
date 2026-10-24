// Weather: rain and storms (H.features 'weather': config.weather). Streaks of rain around you, rings on every water
// near you, a darker sky, the sound of it (a game sound named "rain" when there is one), lightning and thunder in a
// storm. You get wet standing in it, fish bite more, and the 'rain' event lets fires (Mayhem) go out.
//   "weather": "rain" | "storm" | "drizzle" | "clear" | { "rain": 0.7, "wind": [2, 0], "dark": 0.4, "lightning": true }
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const G = () => H.game;
  const X = H.water._;
  const clamp = X.clamp;
  const PHONE = X.PHONE;

  function read(v) {
    if (v === 'clear' || v === 'sun' || v === 'sunny') return { rain: 0, wind: [0, 0], dark: 0, lightning: false };
    if (v === 'storm' || v === 'thunderstorm') return { rain: 1, wind: [3, 1], dark: 0.55, lightning: true };
    if (v === 'drizzle') return { rain: 0.3, wind: [0.5, 0], dark: 0.15, lightning: false };
    if (v === true || v === 'rain' || v === 'rainy') return { rain: 0.65, wind: [1, 0], dark: 0.3, lightning: false };
    const o = v && typeof v === 'object' ? v : {};
    const rain = clamp(X.num(o.rain, 0.65), 0, 1);
    return {
      rain,
      wind: Array.isArray(o.wind) ? [X.num(o.wind[0], 0), X.num(o.wind[1], 0)] : [rain * 1.5, 0],
      dark: clamp(X.num(o.dark, rain * 0.45), 0, 0.9),
      lightning: o.lightning === true,
    };
  }

  const state = { on: false, rain: 0 };
  function streaks(ctx, s) {
    const sc = ctx.scene;
    const cap = PHONE ? 600 : 2000;
    const ps = new B.ParticleSystem('rain', cap, sc);
    ps.particleTexture = W().dot;
    ps.emitter = new B.Vector3(0, 0, 0);
    ps.minEmitBox = new B.Vector3(-22, 14, -22); ps.maxEmitBox = new B.Vector3(22, 18, 22);
    ps.color1 = new B.Color4(0.75, 0.82, 0.92, 0.5); ps.color2 = new B.Color4(0.65, 0.75, 0.9, 0.35); ps.colorDead = new B.Color4(0.7, 0.8, 0.9, 0);
    ps.minSize = 0.03; ps.maxSize = 0.05;
    ps.minScaleY = 8; ps.maxScaleY = 14;
    ps.billboardMode = B.ParticleSystem.BILLBOARDMODE_STRETCHED;
    ps.minLifeTime = 0.8; ps.maxLifeTime = 0.95;
    ps.minEmitPower = 20; ps.maxEmitPower = 24;
    ps.gravity = B.Vector3.Zero();
    ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    ctx.state.ps = ps;
    aim(ctx, s);
    ps.start();
  }
  function aim(ctx, s) {
    const ps = ctx.state.ps;
    if (!ps) return;
    const d = new B.Vector3(s.wind[0] * 0.06, -1, s.wind[1] * 0.06).normalize();
    ps.direction1 = d; ps.direction2 = d;
    ps.emitRate = Math.round((PHONE ? 650 : 2100) * s.rain);
  }

  // The sound of rain: a game sound named "rain" (looped), or filtered noise.
  function startSound(ctx, s) {
    const asset = X.assetNamed('rain');
    if (asset) {
      try { const a = new Audio(L.assetUrl(asset)); a.loop = true; a.volume = clamp(s.rain * 0.6, 0, 1); a.crossOrigin = 'anonymous'; a.play().catch(() => { ctx.state.pending = a; }); ctx.state.audio = a; } catch { /* no sound */ }
      return;
    }
    const ac = X.audioCtx();
    if (!ac) return;
    const src = ac.createBufferSource(); src.buffer = X.noiseBuffer(ac); src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.4;
    const lo = ac.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 5000;
    const gn = ac.createGain(); gn.gain.value = 0;
    src.connect(f).connect(lo).connect(gn).connect(ac.destination);
    src.start();
    ctx.state.noise = { src, gn };
  }
  function soundLevel(ctx, s) {
    const n = ctx.state.noise;
    if (n) { try { n.gn.gain.setTargetAtTime(s.rain * 0.16, n.gn.context.currentTime, 0.4); } catch {} }
    if (ctx.state.audio) ctx.state.audio.volume = clamp(s.rain * 0.6, 0, 1);
  }
  function stopSound(ctx) {
    const n = ctx.state.noise;
    if (n) { try { n.gn.gain.setTargetAtTime(0, n.gn.context.currentTime, 0.2); const src = n.src; setTimeout(() => { try { src.stop(); src.disconnect(); } catch {} }, 900); } catch {} }
    if (ctx.state.audio) ctx.state.audio.pause();
    ctx.state.noise = null; ctx.state.audio = null;
  }
  function thunder(delay) {
    const ac = X.audioCtx();
    if (!ac || ac.state !== 'running') return;
    const t0 = ac.currentTime + delay;
    const src = ac.createBufferSource(); src.buffer = X.noiseBuffer(ac);
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160;
    const gn = ac.createGain(); gn.gain.setValueAtTime(0.0001, t0); gn.gain.exponentialRampToValueAtTime(0.9, t0 + 0.15); gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
    src.connect(f).connect(gn).connect(ac.destination); src.start(t0, Math.random()); src.stop(t0 + 2.8);
  }

  // Rings where the rain hits water near you: a few meshes, reused.
  function rings(ctx) {
    const sc = ctx.scene;
    const list = [];
    for (let i = 0; i < (PHONE ? 8 : 18); i++) {
      const m = B.MeshBuilder.CreateTorus('rain-ring', { diameter: 1, thickness: 0.03, tessellation: 16 }, sc);
      const mat = new B.StandardMaterial('rain-ring', sc);
      mat.emissiveColor = new B.Color3(0.85, 0.93, 1); mat.disableLighting = true; mat.alpha = 0;
      m.material = mat; m.isPickable = false; m.metadata = { decor: true, noGlow: true }; m.scaling.y = 0.2; m.setEnabled(false);
      list.push({ m, mat, t: 1, x: 0, z: 0 });
    }
    ctx.state.rings = list;
    ctx.state.next = 0;
  }

  function light(ctx, s, flash = 0) {
    const w = W(), cfg = L.effectiveConfig();
    if (w.hemi) w.hemi.intensity = (cfg.ambient ?? 0.7) * (1 - s.dark * 0.45) + flash * 1.5;
    if (w.sun) w.sun.intensity = (cfg.sun ?? 0.9) * (1 - s.dark * 0.75) + flash;
    // A grey haze when the world has no fog of its own (and your head isn't under water).
    if (!cfg.fog && !(H.water && H.water.underwater) && s.rain > 0.05) {
      const sc = ctx.scene, bg = L.hex(cfg.background, '#9fd3f0');
      const grey = B.Color3.Lerp(bg, new B.Color3(0.45, 0.5, 0.55), 0.35 + s.dark * 0.4);
      sc.fogMode = B.Scene.FOGMODE_LINEAR; sc.fogColor = grey; sc.fogStart = 25 + (1 - s.rain) * 60; sc.fogEnd = 110 + (1 - s.rain) * 120;
      ctx.state.haze = true;
    }
  }

  H.features.register('weather', {
    apply(value, ctx) {
      const s = read(value);
      ctx.state.s = s;
      state.on = true; state.rain = s.rain;
      if (s.rain > 0) { streaks(ctx, s); rings(ctx); startSound(ctx, s); soundLevel(ctx, s); }
      ctx.state.t = 0; ctx.state.bolt = 4 + Math.random() * 6;
      G().emit('weather', { ...s });
    },
    change(value, old, ctx) {
      const s = read(value);
      const had = ctx.state.s.rain > 0;
      ctx.state.s = s; state.rain = s.rain;
      if (s.rain > 0 && !had) { streaks(ctx, s); rings(ctx); startSound(ctx, s); }
      if (s.rain <= 0 && had) { if (ctx.state.ps) ctx.state.ps.dispose(); ctx.state.ps = null; stopSound(ctx); for (const r of ctx.state.rings || []) r.m.dispose(); ctx.state.rings = null; }
      aim(ctx, s); soundLevel(ctx, s);
      if (ctx.state.haze && (s.rain <= 0.05)) { X.restoreFog(ctx.scene); ctx.state.haze = false; }
      G().emit('weather', { ...s });
    },
    update(dt, ctx) {
      const s = ctx.state.s, w = W();
      ctx.state.t += dt;
      const cam = ctx.scene.activeCamera;
      if (ctx.state.pending) { const a = ctx.state.pending; ctx.state.pending = null; a.play().catch(() => { ctx.state.pending = a; }); }
      let flash = 0;
      if (s.lightning) {
        ctx.state.bolt -= dt;
        if (ctx.state.bolt <= 0) { ctx.state.bolt = 6 + Math.random() * 12; ctx.state.flashT = 0.35; thunder(0.4 + Math.random() * 1.6); G().emit('lightning', {}); }
        if (ctx.state.flashT > 0) { ctx.state.flashT -= dt; flash = ctx.state.flashT > 0.22 || (ctx.state.flashT < 0.12 && ctx.state.flashT > 0.05) ? 1 : 0; }
      }
      light(ctx, s, flash);
      if (!cam || s.rain <= 0) return;
      const c = cam.globalPosition;
      if (ctx.state.ps) ctx.state.ps.emitter.set(c.x - s.wind[0] * 0.8, c.y - 16, c.z - s.wind[1] * 0.8);
      // Rings on the water around you.
      const rs = ctx.state.rings;
      if (rs && X.live().length) {
        const want = s.rain * (PHONE ? 10 : 26) * dt;
        let n = Math.floor(want) + (Math.random() < want % 1 ? 1 : 0);
        while (n-- > 0) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 14;
          const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
          const y = H.water.surfaceAt(x, z);
          if (y === null || y > c.y + 2) continue;
          const ring = rs[ctx.state.next++ % rs.length];
          Object.assign(ring, { t: 0, x, z });
          ring.m.position.set(x, y + 0.02, z);
          ring.m.setEnabled(true);
        }
        for (const ring of rs) {
          if (ring.t >= 1) continue;
          ring.t += dt / 0.7;
          if (ring.t >= 1) { ring.m.setEnabled(false); continue; }
          ring.m.scaling.x = ring.m.scaling.z = 0.1 + ring.t * 0.6;
          ring.mat.alpha = 0.6 * (1 - ring.t);
          const y = H.water.surfaceAt(ring.x, ring.z);
          if (y !== null) ring.m.position.y = y + 0.02;
        }
      }
      // Standing out in it gets you wet (a roof over your head keeps you dry), and fires don't like it.
      if (ctx.state.t - (ctx.state.wetAt || 0) > 2) {
        ctx.state.wetAt = ctx.state.t;
        const p = w.player;
        if (p && p.alive && s.rain > 0.2 && H.water.wet) {
          const roof = G().raycast([p.x, p.bottom + 1.9, p.z], [0, 1, 0], 40, { ignore: p });
          if (!roof) H.water.wet(p, 4 + s.rain * 4);
        }
        G().emit('rain', { intensity: s.rain });
      }
    },
    dispose(ctx) {
      if (ctx.state.ps) ctx.state.ps.dispose();
      for (const r of ctx.state.rings || []) r.m.dispose();
      stopSound(ctx);
      const w = W(), cfg = L.effectiveConfig();
      if (w && w.hemi) w.hemi.intensity = cfg.ambient ?? 0.7;
      if (w && w.sun) w.sun.intensity = cfg.sun ?? 0.9;
      if (ctx.state.haze && w && w.scene === ctx.scene) X.restoreFog(ctx.scene);
      state.on = false; state.rain = 0;
    },
  });

  /** How hard it is raining now (0 to 1). */
  Object.defineProperty(H.water, 'rain', { get: () => (state.on ? state.rain : 0), configurable: true });
})();
