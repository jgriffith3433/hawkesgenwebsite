// Mood (config.mood; J, 2026-10-27: "make a scary game"): how a world feels, made from the engine's own parts.
// "scary": the dark comes in (the sky's darkness), fog close round you, a flashlight in your hand (T, or the 🔦 button),
// a low drone and wind made live (WebAudio, no files), creaks far off, grain and a dark vignette, and a heartbeat that
// quickens when something is near. Behaviors: `stalker` (comes for you when you aren't looking at it, stops when you are;
// `mode: "chase"` always comes), `scare` (a place that jump-scares you once), `flicker` (a light or a thing that flickers).
// H.mood.scare({ text, image }) is a jump scare from a script. Everything is undone when the mood goes.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const PRESETS = {
    scary: { dark: 0.82, fog: 30, fogColor: '#07090d', flashlight: true, sound: true, grain: true, heartbeat: true },
    eerie: { dark: 0.55, fog: 55, fogColor: '#1a2026', flashlight: true, sound: true, grain: false, heartbeat: true },
    calm: { dark: 0, fog: 0, flashlight: false, sound: false, grain: false, heartbeat: false },
  };
  const st = { on: false, o: null, light: null, lightOn: true, audio: null, el: null, btn: null, near: Infinity, beat: 0, creak: 6, flash: 0 };

  function read(v) {
    if (!v) return null;
    const base = typeof v === 'string' ? PRESETS[v] || PRESETS.scary : PRESETS[v.preset] || PRESETS.scary;
    const o = { ...base, ...(typeof v === 'object' ? v : {}) };
    o.dark = clamp(Number(o.dark) || 0, 0, 1);
    o.fog = Math.max(0, Number(o.fog) || 0);
    return o;
  }

  // ------------------------------------------------------------------ sound, made live
  function startSound() {
    const A = H.audio, ctx = A && A.context, master = A && A.master;
    if (!ctx || !master || st.audio) return;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(master);
    out.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 3);
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 220; low.connect(out);
    const osc = [41, 55.3, 61.7].map((f, i) => { const o = ctx.createOscillator(); o.type = i === 1 ? 'sawtooth' : 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = i === 1 ? 0.05 : 0.18; o.connect(g); g.connect(low); o.start(); return o; });
    // Wind: noise through a band that wanders.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const band = ctx.createBiquadFilter(); band.type = 'bandpass'; band.frequency.value = 400; band.Q.value = 0.8;
    const wind = ctx.createGain(); wind.gain.value = 0.12;
    noise.connect(band); band.connect(wind); wind.connect(out); noise.start();
    st.audio = { ctx, out, osc, noise, band, buf };
  }
  function stopSound() {
    const a = st.audio;
    if (!a) return;
    st.audio = null;
    try { a.out.gain.linearRampToValueAtTime(0, a.ctx.currentTime + 0.6); } catch { /* fine */ }
    setTimeout(() => { for (const o of a.osc) try { o.stop(); } catch { /* fine */ } try { a.noise.stop(); a.out.disconnect(); } catch { /* fine */ } }, 700);
  }
  /** A short sound made of a filtered noise burst and/or a tone: creaks, thumps, the scare's sting. */
  function blip({ freq = 60, to = null, noise = 0, tone = 1, seconds = 0.15, gain = 0.5, filter = 900 }) {
    const A = H.audio, ctx = A && A.context, master = A && A.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime, g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    g.connect(master);
    if (tone) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + seconds); const og = ctx.createGain(); og.gain.value = tone; o.connect(og); og.connect(g); o.start(t); o.stop(t + seconds + 0.05); }
    if (noise && st.audio) { const s = ctx.createBufferSource(); s.buffer = st.audio.buf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = filter; const ng = ctx.createGain(); ng.gain.value = noise; s.connect(f); f.connect(ng); ng.connect(g); s.start(t, Math.random()); s.stop(t + seconds + 0.05); }
  }

  // ------------------------------------------------------------------ the look: fog, grain, the flashlight
  function overlay() {
    if (st.el) return;
    const css = document.createElement('style');
    css.textContent = `
      .md-veil { position: fixed; inset: 0; z-index: 3; pointer-events: none; background: radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.72) 100%); }
      .md-veil.grain::after { content: ''; position: absolute; inset: -50%; opacity: .09; background-image: repeating-radial-gradient(circle at 17% 32%, #fff 0 1px, transparent 1px 3px), repeating-radial-gradient(circle at 71% 64%, #fff 0 1px, transparent 1px 4px); animation: md-grain .4s steps(3) infinite; }
      @keyframes md-grain { 0% { transform: translate(0,0); } 33% { transform: translate(-3%,2%); } 66% { transform: translate(2%,-3%); } }
      .md-scare { position: fixed; inset: 0; z-index: 40; pointer-events: none; display: grid; place-items: center; background: rgba(255,255,255,.9); animation: md-scare .9s ease-out forwards; }
      .md-scare img { max-width: 80vw; max-height: 80vh; }
      .md-scare b { font: 900 clamp(40px, 10vw, 120px)/1 system-ui, sans-serif; color: #7f0000; text-shadow: 0 0 30px #000; }
      @keyframes md-scare { 0% { background: rgba(255,255,255,.95); } 12% { background: rgba(0,0,0,.92); } 100% { background: rgba(0,0,0,0); opacity: 0; } }
      .md-torch { position: fixed; right: 14px; bottom: max(150px, calc(env(safe-area-inset-bottom) + 140px)); z-index: 6; width: 52px; height: 52px; border-radius: 50%; border: 1px solid rgba(255,255,255,.35); background: rgba(10,12,18,.7); font-size: 22px; pointer-events: auto; }`;
    document.head.appendChild(css);
    st.el = document.createElement('div');
    st.el.className = 'md-veil';
    document.body.appendChild(st.el);
    if (H.touchUi) {
      st.btn = document.createElement('button');
      st.btn.type = 'button'; st.btn.className = 'md-torch'; st.btn.textContent = '🔦';
      st.btn.addEventListener('pointerdown', (e) => { e.stopPropagation(); toggleLight(); });
      document.body.appendChild(st.btn);
    }
  }
  function torch() {
    if (st.light && !st.light.isDisposed()) return st.light;
    const w = W();
    const l = new B.SpotLight('mood-torch', new B.Vector3(0.15, -0.1, 0), new B.Vector3(0, -0.05, 1), 0.75, 12, w.scene);
    l.diffuse = new B.Color3(1, 0.95, 0.82); l.specular = new B.Color3(0.4, 0.4, 0.35);
    l.intensity = 2.2; l.range = 32;
    st.light = l;
    return l;
  }
  function toggleLight() { st.lightOn = !st.lightOn; if (G() && G().sound) G().sound('click'); blip({ freq: 1800, to: 1200, seconds: 0.04, gain: 0.15 }); }

  function apply(o) {
    st.on = true; st.o = o; st.lightOn = true; st.creak = 4; st.beat = 0;
    if (H.sky && H.sky.set) H.sky.set('mood', o.dark > 0 ? { dark: o.dark } : null);
    const sc = W().scene;
    st.fogWas = { mode: sc.fogMode, color: sc.fogColor && sc.fogColor.clone(), start: sc.fogStart, end: sc.fogEnd };
    if (o.fog > 0) { sc.fogMode = B.Scene.FOGMODE_LINEAR; sc.fogColor = B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(o.fogColor) ? o.fogColor : '#07090d'); sc.fogStart = Math.max(1, o.fog * 0.12); sc.fogEnd = o.fog; }
    overlay();
    st.el.hidden = false;
    st.el.classList.toggle('grain', Boolean(o.grain));
    if (st.btn) st.btn.hidden = !o.flashlight;
    if (o.sound) startSound();
  }
  function remove() {
    st.on = false;
    if (H.sky && H.sky.set) H.sky.set('mood', null);
    const w = W();
    if (w && st.fogWas) { const sc = w.scene; sc.fogMode = st.fogWas.mode; if (st.fogWas.color) sc.fogColor = st.fogWas.color; sc.fogStart = st.fogWas.start; sc.fogEnd = st.fogWas.end; }
    if (st.light) { st.light.dispose(); st.light = null; }
    if (st.el) st.el.hidden = true;
    if (st.btn) st.btn.hidden = true;
    stopSound();
  }

  /** A jump scare: a flash, a sting, the screen shakes, a face or words for a moment. */
  function scare(o = {}) {
    const g = G();
    st.flash = 1;
    blip({ freq: 70, to: 38, noise: 0.9, tone: 0.8, seconds: 0.9, gain: 0.9, filter: 1400 });
    blip({ freq: 1250, to: 900, tone: 0.25, seconds: 0.6, gain: 0.35 });
    if (W() && W().camera && W().camera.api) W().camera.api.shake(0.6, 0.5);
    overlay();
    const el = document.createElement('div');
    el.className = 'md-scare';
    if (o.image) { const img = document.createElement('img'); img.src = H.lib.assetUrl ? H.lib.assetUrl(o.image) || o.image : o.image; img.alt = ''; el.appendChild(img); }
    else if (o.text) { const b = document.createElement('b'); b.textContent = String(o.text); el.appendChild(b); }
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 950);
    if (g) g.emit('scare', { text: o.text || null, by: o.by || null });
    if (H.haptic) try { H.haptic(80); } catch { /* fine */ }
  }

  // ------------------------------------------------------------------ the things that make it scary
  /** Whether the player is looking at a thing (in front, within the view's middle, not far past the flashlight). */
  function seen(e) {
    const w = W(), cam = w && w.scene.activeCamera;
    if (!cam) return false;
    const p = cam.globalPosition, d = cam.getDirection(B.Axis.Z);
    const v = new B.Vector3(e.x - p.x, e.y - p.y, e.z - p.z), dist = v.length();
    if (dist < 0.01) return true;
    const dot = B.Vector3.Dot(v.scale(1 / dist), d);
    const lit = !st.on || !st.o || st.o.dark < 0.5 || (st.o.flashlight && st.lightOn && dist < 30) || dist < 6;
    return dot > 0.8 && lit;
  }
  H.behavior('stalker', {
    title: 'Comes for you', group: 'Scary', icon: '👁',
    says: (o) => (o.mode === 'chase' ? 'comes for you' : 'comes for you when you look away'),
    defaults: { speed: 3.2, mode: 'unseen', reach: 1.4, damage: 25, sight: 45, scare: true, text: '' },
    settings: [
      { key: 'mode', label: 'Moves', type: 'choice', options: ['unseen', 'chase'] },
      { key: 'speed', label: 'Speed', type: 'number', min: 0.5, max: 15, unit: 'm/s' },
      { key: 'damage', label: 'Hurts', type: 'number', min: 0, max: 100 },
      { key: 'sight', label: 'Notices from', type: 'number', min: 3, max: 200, unit: 'm' },
      { key: 'scare', label: 'Jump scare when it gets you', type: 'bool' },
      { key: 'text', label: 'Says', type: 'text' },
    ],
    start(e, o, s) { s.home = e.position; s.cool = 0; s.moved = 0; if (e.physics === 'dynamic') e.upright = true; },
    update(e, dt, o, s, g) {
      if (e.remote || g.mode === 'build' || e.dead) return;
      const p = W().player;
      if (!p || !p.alive) return;
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      st.near = Math.min(st.near, d);
      s.cool = Math.max(0, s.cool - dt);
      if (d > (Number(o.sight) || 45) || s.cool > 0) { if (e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0); return; }
      const looked = seen(e);
      const go = o.mode === 'chase' ? (looked ? 0.6 : 1.2) : looked ? 0 : 1;
      const sp = (Number(o.speed) || 3.2) * go;
      if (sp > 0) {
        const dir = { x: (p.x - e.x) / (d || 1), z: (p.z - e.z) / (d || 1) };
        if (e.physics === 'dynamic') e.walk(dir, sp);
        else { e.position = [e.x + dir.x * sp * dt, e.y, e.z + dir.z * sp * dt]; e.lookAt([p.x, e.y, p.z]); }
        s.moved += sp * dt;
      } else if (e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0);
      if (d < (Number(o.reach) || 1.4) + e.half[0]) {
        if (o.scare !== false) scare({ text: o.text, by: e });
        if (Number(o.damage)) g.damage(p, Number(o.damage), e);
        g.emit('caught', { by: e });
        s.cool = 4;
        e.position = s.home;
        e.velocity = [0, 0, 0];
      }
    },
  });
  H.behavior('scare', {
    title: 'A jump scare', group: 'Scary', icon: '😱',
    says: (o) => (o.once === false ? 'jump-scares you every time' : 'jump-scares you once'),
    defaults: { text: '', image: '', once: true, delay: 0 },
    settings: [{ key: 'text', label: 'Words', type: 'text' }, { key: 'image', label: 'A picture (an asset)', type: 'text' }, { key: 'once', label: 'Only once', type: 'bool' }, { key: 'delay', label: 'After', type: 'number', min: 0, max: 10, unit: 's' }],
    start(e) { if (e.physics === 'none') e.physics = 'trigger'; else e.ghost = true; },
    hit(e, other, o, s, g) {
      if (other !== g.player || s.done || (s.t && W().time - s.t < 3)) return;
      s.t = W().time;
      if (o.once !== false) s.done = true;
      const run = () => scare({ text: o.text, image: o.image, by: e });
      if (Number(o.delay) > 0) g.after(Number(o.delay), run); else run();
    },
  });
  H.behavior('flicker', {
    title: 'Flickers', group: 'Scary', icon: '💡',
    says: () => 'flickers',
    defaults: { rate: 1, low: 0.05 },
    settings: [{ key: 'rate', label: 'How often', type: 'number', min: 0.1, max: 6 }, { key: 'low', label: 'Darkest', type: 'number', min: 0, max: 1, step: 0.05 }],
    start(e, o, s) { s.lights = W().scene.lights.filter((l) => l === e.node || (l.parent && (l.parent === e.node || (l.parent.isDescendantOf && l.parent.isDescendantOf(e.node))))); s.base = s.lights.map((l) => l.intensity); s.t = 0; s.k = 1; },
    update(e, dt, o, s) {
      s.t -= dt * (Number(o.rate) || 1);
      if (s.t <= 0) { s.t = 0.05 + Math.random() * (Math.random() < 0.2 ? 1.5 : 0.25); s.k = Math.random() < 0.35 ? Number(o.low) || 0.05 : 0.7 + Math.random() * 0.3; }
      s.lights.forEach((l, i) => { l.intensity = s.base[i] * s.k; });
      if (!s.lights.length) e.visible = s.k > 0.5;
    },
    stop(e, o, s) { (s.lights || []).forEach((l, i) => { l.intensity = s.base[i]; }); e.visible = true; },
  });

  // ------------------------------------------------------------------ every frame: the flashlight, heartbeat, creaks
  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w || !st.on || !st.o) { st.near = Infinity; return; }
    const g = G();
    if (g && g.input && g.input.pressed('t') && st.o.flashlight) toggleLight();
    const l = st.o.flashlight ? torch() : null;
    if (l) { l.parent = w.scene.activeCamera; l.setEnabled(st.lightOn && H.mode !== 'build'); l.intensity = 2.2 * (0.94 + Math.random() * 0.06); }
    // The heartbeat: faster and louder as something comes.
    if (st.o.heartbeat && st.near < 18) {
      const k = 1 - st.near / 18;
      st.beat -= dt;
      if (st.beat <= 0) { st.beat = 1.1 - k * 0.65; blip({ freq: 52, to: 40, seconds: 0.12, gain: 0.25 + k * 0.5 }); setTimeout(() => blip({ freq: 48, to: 36, seconds: 0.1, gain: 0.18 + k * 0.4 }), 170); }
    }
    st.near = Infinity;
    if (st.audio) {
      st.creak -= dt;
      if (st.creak <= 0) { st.creak = 7 + Math.random() * 14; blip({ freq: 140 + Math.random() * 90, to: 90, noise: 0.5, tone: 0.2, seconds: 0.5 + Math.random() * 0.5, gain: 0.18, filter: 600 + Math.random() * 900 }); }
      st.audio.band.frequency.value = 300 + Math.sin(w.time * 0.23) * 160 + Math.sin(w.time * 0.07) * 90;
    }
    if (st.flash > 0) { st.flash = Math.max(0, st.flash - dt * 3); if (H.sky && H.sky.set) H.sky.set('mood', { dark: st.o.dark * (1 - st.flash), flash: st.flash }); }
  });

  H.features.register('mood', {
    apply(value) { const o = read(value); if (o) apply(o); },
    change(value) { const o = read(value); remove(); if (o) apply(o); },
    dispose() { remove(); },
    codex: {
      title: 'Mood', group: 'World features',
      what: 'How the world feels. "scary": dark, fog close round you, a flashlight (L), a drone and wind, creaks, grain, a heartbeat when something is near.',
      value: 'scary',
      fields: [['preset', 'scary, eerie, calm', 'scary'], ['dark', '0-1', '0.82'], ['fog', 'meters you see', '30'], ['flashlight', 'true: T toggles it', 'true'], ['sound', 'the drone, wind and creaks', 'true'], ['grain', 'film grain and a vignette', 'true'], ['heartbeat', 'when something is near', 'true']],
    },
  });
  H.hooks.world.push({ leave() { if (st.on) remove(); } });

  const api = { scare: (o) => scare(o || {}), get on() { return st.on; }, get flashlight() { return Boolean(st.on && st.o && st.o.flashlight && st.lightOn); }, toggleFlashlight: toggleLight, PRESETS };
  H.mood = api;
  H.hooks.game.push((game) => { game.mood = api; });
})();
