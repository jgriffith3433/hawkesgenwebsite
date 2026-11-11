// Juice: sound everywhere, from the physics. Impacts by the two materials and how hard they met (the game's sound for
// the word when it has one, "metal crash", "wood hit"..., else synthesized), footsteps by surface for you, the nearest
// creatures and other players, rolling and scraping loops for things that roll and slide, tire squeal, wind at speed,
// whooshes for things that fly past. Every sound is placed in the world (a panner) and goes through H.audio.effects
// (falling back to master); a voice budget with priorities keeps it to a few dozen at once however many cows there are.
//   H.juice.sound.impact(a, b, { speed, at })   H.juice.sound.play(material | words, { at, loudness, size })
//   H.juice.sound.footstep(surface, { at, loudness })   H.juice.sound.whoosh(at, speed)
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = H.juiceMath;
  const J = H.juice;
  const W = () => H.world;
  const clamp = M.clamp;
  const ctx = () => H.audio.context;
  const bus = () => H.audio.effects || H.audio.master;
  const live = () => { const a = ctx(); return a && a.state === 'running' && bus() ? a : null; };
  const camPos = () => { const w = W(); const c = w && w.scene && w.scene.activeCamera; return c ? c.globalPosition || c.position : null; };
  const distTo = (at) => { const c = camPos(); return c && at ? Math.hypot(at[0] - c.x, at[1] - c.y, at[2] - c.z) : 0; };

  // ------------------------------------------------------------------ voices: a budget, and a panner for each sound
  const budget = new M.VoiceBudget(J.budget.voices);
  J.onChange(() => { budget.max = J.budget.voices; });
  let lastLevel = J.level;
  const clock = () => { const a = ctx(); return a ? a.currentTime : performance.now() / 1000; };

  let noiseBuf = null;
  function noise(a) {
    if (noiseBuf && noiseBuf.sampleRate === a.sampleRate) return noiseBuf;
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  /** Where a sound goes: a panner at `at` (or straight for sounds at your own ears), then the effects bus. */
  function outFor(a, at, gain) {
    const dest = bus();
    const g = a.createGain();
    g.gain.value = gain;
    if (at) {
      const p = a.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3; p.maxDistance = 150; p.rolloffFactor = 1.1;
      setPos(p, at);
      g.connect(p).connect(dest);
      return { g, p };
    }
    g.connect(dest);
    return { g, p: null };
  }
  function setPos(p, at) {
    if (p.positionX) { p.positionX.value = at[0]; p.positionY.value = at[1]; p.positionZ.value = at[2]; } else p.setPosition(at[0], at[1], at[2]);
  }
  // The listener is the camera (every frame).
  function listen() {
    const a = live();
    const w = W();
    const c = w && w.scene && w.scene.activeCamera;
    if (!a || !c) return;
    const p = c.globalPosition || c.position;
    const f = c.getDirection(B.Axis.Z), u = c.getDirection(B.Axis.Y);
    const L = a.listener;
    try {
      if (L.positionX) {
        L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
        L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = u.x; L.upY.value = u.y; L.upZ.value = u.z;
      } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
    } catch { /* fine */ }
  }

  // ------------------------------------------------------------------ the game's sound for a word, decoded once
  const buffers = new Map();
  // (Words with no sound are remembered for a couple of seconds: every impact asked again, a cost of its own.)
  const none = { at: 0, world: null, words: new Set() };
  function assetFor(words) {
    if (!H.assets || !H.assets.pick) return null;
    const now = performance.now();
    if (none.world !== W() || now - none.at > 2000) { none.world = W(); none.at = now; none.words.clear(); }
    for (const w of words) {
      if (none.words.has(w)) continue;
      try { const id = H.assets.pick(w, { kind: 'sound', mix: true }); if (id) return id; } catch { /* no assets */ }
      none.words.add(w);
    }
    return null;
  }
  function bufferOf(id) {
    const a = ctx();
    const url = H.assets.url ? H.assets.url(id) : H.lib.assetUrl(id);
    if (!a || !url) return null;
    if (!buffers.has(url)) {
      buffers.set(url, null);
      // A sound that won't load (gone, refused, not audio) stays silent for a minute instead of being asked for on every hit.
      fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.arrayBuffer(); }).then((b) => a.decodeAudioData(b)).then((buf) => buffers.set(url, buf))
        .catch(() => setTimeout(() => { if (buffers.get(url) === null) buffers.delete(url); }, 60000));
    }
    return buffers.get(url);
  }

  // ------------------------------------------------------------------ synthesized hits: a tone that rings plus a burst
  function synthHit(a, out, v, loud, pitch, size, t) {
    const big = size === 'crash' ? 1.6 : size === 'knock' ? 1.1 : 0.7;
    const dur = v.dur * big;
    // The burst: noise through the material's band.
    if (v.noise > 0) {
      const n = a.createBufferSource(); n.buffer = noise(a);
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = v.q;
      bp.frequency.setValueAtTime(v.band * pitch, t);
      if (v.sweep) bp.frequency.exponentialRampToValueAtTime(v.band * pitch * 0.35, t + dur);
      const ng = a.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(loud * v.noise, t + 0.004); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.7);
      n.connect(bp).connect(ng).connect(out);
      n.start(t, Math.random() * 1.5, dur); n.stop(t + dur + 0.02);
    }
    // The ring: a few partials (metal and glass ring; wood and stone thunk).
    const ring = v.ring * big;
    for (let i = 0; i < v.partials.length; i++) {
      const o = a.createOscillator();
      o.type = i === 0 && (v.tone < 200) ? 'triangle' : 'sine';
      const f = v.tone * v.partials[i] * pitch * (size === 'crash' ? 0.8 : 1);
      o.frequency.setValueAtTime(f, t);
      if (v.sweep) o.frequency.exponentialRampToValueAtTime(f * 2.2, t + ring);
      const og = a.createGain();
      const k = loud * (1 - v.noise * 0.6) / (1 + i * 0.9);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(Math.max(0.0002, k), t + 0.003); og.gain.exponentialRampToValueAtTime(0.0001, t + ring / (1 + i * 0.35));
      o.connect(og).connect(out); o.start(t); o.stop(t + ring + 0.05);
    }
    return Math.max(dur, ring) + 0.05;
  }
  /** Plays a sound: { material, words, loudness, pitch, size, at, weight, key, gap, mine }. Returns true if it played. */
  function play(s) {
    if (!J.allowed('sounds')) return false;
    const at = s.at || null;
    const d = s.mine ? 0 : distTo(at);
    if (d > 90) return false;
    const pri = M.priorityOf(s.loudness ?? (s.loudness = 0.6), d, s.weight || 1);
    const a = live();
    const now = clock();
    const words = s.words || [s.material];
    const asset = a ? assetFor(words) : null;
    const buf = asset ? bufferOf(asset) : null;
    const v = M.VOICE[s.material] || M.VOICE.stone;
    const len = buf ? buf.duration : Math.max(v.dur, v.ring) * 1.6 + 0.05;
    const voice = budget.request({ priority: pri, now, until: now + len, key: s.key, gap: s.gap });
    if (!voice) return false;
    J.sound.played++;
    if (!a) return true; // (no sound here: tests, or before the first click; the budget still counts it)
    try {
      const vol = clamp(s.loudness, 0, 1.2) * 0.8;
      const { g } = outFor(a, s.mine ? null : at, 1);
      voice.stop = () => { try { g.gain.setTargetAtTime(0, a.currentTime, 0.01); } catch { /* fine */ } };
      if (buf) {
        const src = a.createBufferSource(); src.buffer = buf;
        src.playbackRate.value = clamp(s.pitch || 1, 0.5, 2);
        g.gain.value = vol;
        src.connect(g); src.start();
      } else {
        synthHit(a, g, v, vol, s.pitch || 1, s.size || 'knock', a.currentTime + 0.002);
      }
    } catch { budget.release(voice); return false; }
    return true;
  }

  // ------------------------------------------------------------------ impacts from the physics
  const pairT = new Map();
  /** Two things hit: the sound of their materials at that speed (m/s), where they met. */
  function impact(a, b, o = {}) {
    const ma = M.materialOf(a), mb = M.materialOf(b);
    const mass = Math.min(a && a.physics === 'dynamic' ? a.mass : 1e9, b && b.physics === 'dynamic' ? b.mass : 1e9);
    const s = M.impactSound(ma, mb, o.impulse, { speed: o.speed, mass: Number.isFinite(mass) && mass < 1e9 ? mass : 1 });
    if (!s) return null;
    const at = o.at || (a ? [a.x, a.y, a.z] : null);
    const key = `${(a && (a.sceneId || a.name)) || '?'}|${(b && (b.sceneId || b.name)) || '?'}`;
    play({ ...s, at, key: o.key || key, gap: 0.09, weight: o.weight || 1 });
    return s;
  }
  // How fast two things met: the event's speed (Havok), or how fast they were closing before the step (Mayhem keeps
  // each thing's velocity from before the step, `_pv`).
  const before = (e) => (e && e.physics === 'dynamic' ? (e._pv || [e.vx || 0, e.vy || 0, e.vz || 0]) : [0, 0, 0]);
  function speedOf(c) {
    const va = before(c.a), vb = before(c.b);
    const rel = Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]);
    return Math.max(Number(c.speed) || 0, Math.min(rel, 60));
  }
  const touching = new Map(); // pair key -> { a, b, at, t }
  const pairKey = (a, b) => { const x = a._jid || (a._jid = ++ids), y = b._jid || (b._jid = ++ids); return x < y ? `${x}:${y}` : `${y}:${x}`; };
  let ids = 0;
  H.physics.on('collision', (c) => {
    if (!W()) return;
    const { a, b } = c;
    if (!a || !b || (a.physics !== 'dynamic' && b.physics !== 'dynamic')) return;
    const speed = speedOf(c);
    if (touching.size < 300 && speed > 0.5) touching.set(pairKey(a, b), { a, b, t: 0 });
    if (speed < 1.2) return;
    const at = c.point || [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
    const s = impact(a, b, { speed, at });
    if (s) {
      for (const f of J.sound.hits) try { f({ a, b, at, speed, sound: s }); } catch (err) { H.report(err, 'juice'); }
    }
  });
  H.physics.on('collision-end', ({ a, b }) => { if (a && b) touching.delete(pairKey(a, b)); });

  // ------------------------------------------------------------------ loops: rolling, scraping, tire squeal, wind
  // A few looping voices, given each frame to the loudest things rolling or sliding near you.
  const loops = [];
  function makeLoop(a, kind) {
    const src = a.createBufferSource(); src.buffer = noise(a); src.loop = true;
    const f = a.createBiquadFilter(); f.type = 'bandpass';
    const f2 = a.createBiquadFilter(); f2.type = 'lowpass';
    const { g, p } = outFor(a, kind === 'wind' ? null : [0, 0, 0], 0);
    src.connect(f).connect(f2).connect(g);
    src.start();
    return { kind, src, f, f2, g, p, owner: null, level: 0 };
  }
  function loopFor(a, kind) {
    let l = loops.find((x) => x.kind === kind && !x.taken);
    if (!l && loops.filter((x) => x.kind === kind).length < (kind === 'wind' ? 1 : Math.max(1, J.budget.loops))) { l = makeLoop(a, kind); loops.push(l); }
    if (l) l.taken = true;
    return l;
  }
  const SURF_ROLL = { stone: [380, 0.8], wood: [520, 1.2], metal: [900, 2], dirt: [260, 0.7], plastic: [600, 1], glass: [1400, 2], flesh: [200, 0.6], water: [500, 0.6] };
  function runLoops(dt) {
    const a = live();
    if (!a) return;
    for (const l of loops) l.taken = false;
    const want = [];
    const cam = camPos();
    if (cam && J.allowed('sounds')) {
      for (const [k, c] of touching) {
        const { a: x, b: y } = c;
        if (!x.alive || !y.alive) { touching.delete(k); continue; }
        const mover = x.physics === 'dynamic' && !x.sleeping ? x : y.physics === 'dynamic' && !y.sleeping ? y : null;
        if (!mover || mover.sleeping || mover.held || mover._ragPart) continue;
        const other = mover === x ? y : x;
        const v = Math.hypot(mover.vx - (other.physics === 'dynamic' ? other.vx : 0), mover.vy - (other.physics === 'dynamic' ? other.vy : 0), mover.vz - (other.physics === 'dynamic' ? other.vz : 0));
        if (v < 1.2) continue;
        const d = Math.hypot(mover.x - cam.x, mover.y - cam.y, mover.z - cam.z);
        if (d > 45) continue;
        const spin = mover.angularVelocity || [0, 0, 0];
        const round = mover.kind === 'sphere' || mover.kind === 'cylinder' || /ball|wheel|barrel|log/.test(String(mover.name || mover.kind).toLowerCase());
        const rolling = round && Math.hypot(...spin) * (Math.PI / 180) * Math.max(...mover.half) > v * 0.5;
        // (Touching contacts are kept only while Havok says so: a bounce ends the pair.)
        want.push({ kind: rolling ? 'roll' : 'scrape', at: [mover.x, mover.bottom, mover.z], speed: v, mat: M.materialOf(other), own: M.materialOf(mover), pri: v / (1 + d / 8), key: k });
      }
      // Skidding tires (vehicles: wheels on the ground that slip).
      if (H.vehicles && H.vehicles.list) {
        for (const e of H.vehicles.list()) {
          const v = e.vehicle;
          if (!v || !v.wheels) continue;
          const slip = v.wheels.filter((w) => w.contact && w.slip).length;
          if (!slip) continue;
          const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
          const sp = v.vel ? v.vel.length() : Math.hypot(e.vx, e.vz);
          if (d < 60 && sp > 3) want.push({ kind: 'squeal', at: [e.x, e.bottom, e.z], speed: sp, pri: (slip * sp) / (1 + d / 10), key: `veh:${e.sceneId || e.name}` });
        }
      }
    }
    want.sort((p, q) => q.pri - p.pri);
    const t = a.currentTime;
    const used = new Set();
    for (const w of want.slice(0, Math.max(1, J.budget.loops))) {
      const l = loopFor(a, w.kind === 'squeal' ? 'squeal' : 'contact');
      if (!l) continue;
      used.add(l);
      if (l.p) setPos(l.p, w.at);
      const r = SURF_ROLL[w.mat] || SURF_ROLL.stone;
      let gain, freq, q, lp;
      if (w.kind === 'squeal') { gain = clamp(w.speed / 25, 0.05, 0.35); freq = 2300 + w.speed * 20; q = 9; lp = 6000; }
      else if (w.kind === 'roll') { gain = clamp(w.speed / 18, 0.03, 0.4); freq = r[0] * (0.6 + w.speed / 12); q = r[1]; lp = 1800; }
      else { gain = clamp(w.speed / 14, 0.03, 0.45) * (w.own === 'metal' || w.mat === 'metal' ? 1.2 : 1); freq = (w.own === 'metal' || w.mat === 'metal' ? 2600 : r[0] * 2.2) * (0.8 + w.speed / 20); q = w.own === 'metal' || w.mat === 'metal' ? 5 : 1.2; lp = 7000; }
      l.f.frequency.setTargetAtTime(freq, t, 0.04); l.f.Q.setTargetAtTime(q, t, 0.05); l.f2.frequency.setTargetAtTime(lp, t, 0.05);
      l.g.gain.setTargetAtTime(gain, t, 0.05);
    }
    // Wind: how fast you (the camera) are going, or falling.
    const wind = loopFor(a, 'wind');
    if (wind) {
      used.add(wind);
      const s = J.feel ? J.feel.camSpeed : 0;
      const k = J.allowed('sounds') ? clamp((s - 7) / 35, 0, 1) : 0;
      wind.f.frequency.setTargetAtTime(300 + k * 1400, t, 0.2); wind.f.Q.value = 0.6; wind.f2.frequency.setTargetAtTime(2500 + k * 4000, t, 0.2);
      wind.g.gain.setTargetAtTime(k * 0.32, t, 0.25);
    }
    for (const l of loops) if (!used.has(l)) l.g.gain.setTargetAtTime(0, t, 0.08);
    void dt;
  }
  function dropLoops() { for (const l of loops) { try { l.src.stop(); l.g.disconnect(); } catch { /* gone */ } } loops.length = 0; }

  // ------------------------------------------------------------------ footsteps: you, the nearest creatures, other players
  const STEP_VOICE = {
    grass: { band: 2400, q: 0.7, dur: 0.09, low: 0.3, tone: 0 },
    dirt: { band: 700, q: 0.8, dur: 0.08, low: 0.6, tone: 0 },
    sand: { band: 3200, q: 0.5, dur: 0.13, low: 0.15, tone: 0 },
    snow: { band: 1500, q: 1.4, dur: 0.14, low: 0.2, tone: 0, crunch: true },
    stone: { band: 1700, q: 1.1, dur: 0.05, low: 0.7, tone: 120 },
    wood: { band: 900, q: 1.3, dur: 0.07, low: 0.5, tone: 210 },
    metal: { band: 2800, q: 4, dur: 0.06, low: 0.3, tone: 640 },
    water: { band: 1100, q: 0.7, dur: 0.18, low: 0.3, tone: 0, sweep: true },
    glass: { band: 3500, q: 3, dur: 0.05, low: 0.2, tone: 1800 },
    plastic: { band: 1300, q: 1.2, dur: 0.05, low: 0.4, tone: 420 },
    flesh: { band: 500, q: 0.8, dur: 0.07, low: 0.6, tone: 0 },
  };
  /** A footstep on a surface (grass, dirt, sand, snow, stone, wood, metal, water...). o: { at, loudness, pitch, mine, key }. */
  function footstep(surface, o = {}) {
    const sf = STEP_VOICE[surface] ? surface : 'dirt';
    if (!J.allowed('sounds') || !J.allowed('footsteps')) return false;
    if (o.mine && H.soundscape && H.soundscape.step(sf, o)) { J.sound.steps++; return true; }
    const a = live();
    const at = o.at || null;
    const d = o.mine ? 0 : distTo(at);
    if (d > 30) return false;
    const now = clock();
    const voice = budget.request({ priority: M.priorityOf(o.loudness ?? 0.3, d, o.mine ? 1.2 : 0.6), now, until: now + 0.2, key: o.key, gap: 0.12 });
    if (!voice) return false;
    J.sound.steps++;
    if (!a) return true;
    try {
      const v = STEP_VOICE[sf];
      const id = assetFor([`footstep ${sf}`, `${sf} footstep`, `step ${sf}`, `${sf} step`, 'footstep']);
      const buf = id ? bufferOf(id) : null;
      const { g } = outFor(a, o.mine ? null : at, 1);
      const vol = clamp(o.loudness ?? 0.3, 0, 1) * 0.6;
      const t = a.currentTime + 0.002, pitch = (o.pitch || 1) * (0.9 + Math.random() * 0.2);
      if (buf) { const s = a.createBufferSource(); s.buffer = buf; s.playbackRate.value = pitch; g.gain.value = vol; s.connect(g); s.start(); return true; }
      const n = a.createBufferSource(); n.buffer = noise(a);
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = v.q; bp.frequency.setValueAtTime(v.band * pitch, t);
      if (v.sweep) bp.frequency.exponentialRampToValueAtTime(v.band * 0.4, t + v.dur);
      const ng = a.createGain();
      ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      if (v.crunch) { ng.gain.setValueAtTime(vol * 0.4, t + 0.03); ng.gain.linearRampToValueAtTime(vol * 0.8, t + 0.05); }
      ng.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
      n.connect(bp).connect(ng).connect(g); n.start(t, Math.random() * 1.5, v.dur + 0.02); n.stop(t + v.dur + 0.03);
      // The heel: a low thump (and a tone on hard floors).
      const o1 = a.createOscillator(); o1.type = 'sine'; o1.frequency.setValueAtTime((v.tone || 85) * pitch, t); o1.frequency.exponentialRampToValueAtTime((v.tone || 85) * pitch * 0.7, t + 0.05);
      const og = a.createGain(); og.gain.setValueAtTime(vol * v.low, t); og.gain.exponentialRampToValueAtTime(0.0001, t + (v.tone > 400 ? 0.09 : 0.06));
      o1.connect(og).connect(g); o1.start(t); o1.stop(t + 0.12);
    } catch { /* fine */ }
    return true;
  }
  /** Where (and on what) a thing stands: its standing thing, or a ray down. */
  function groundUnder(e) {
    const at = [e.x, e.bottom, e.z];
    let on = e.standing && e.standing.alive ? e.standing : null;
    if (!on) { try { const hit = H.physics.raycast([e.x, e.bottom + 0.3, e.z], [0, -1, 0], 1.2, { ignore: [e] }); if (hit) on = hit.entity; } catch { /* no physics */ } }
    if (H.water && H.water.inWater) { try { if (H.water.inWater([e.x, e.bottom + 0.1, e.z])) return { surface: 'water', at }; } catch { /* fine */ } }
    return { surface: on ? M.surfaceOf(on, at) : (H.terrain && H.terrain.active ? M.surfaceOf({ isTerrain: true }, at) : 'dirt'), at, on };
  }
  const walkers = new WeakMap(); // entity -> { d, last: [x, z], side }
  function stride(speed, size = 1) { return clamp((0.55 + speed * 0.1) * Math.sqrt(size), 0.35, 2.2); }
  function stepAlong(e, dt, o) {
    let s = walkers.get(e);
    if (!s) { s = { d: 0, last: [e.x, e.z], side: 0, air: false, vy: 0 }; walkers.set(e, s); }
    const moved = Math.hypot(e.x - s.last[0], e.z - s.last[1]);
    s.last = [e.x, e.z];
    const speed = dt > 0 ? moved / dt : 0;
    const grounded = o.grounded ?? e.grounded;
    if (!grounded || speed < 0.8 || speed > 25 || moved > 3) { if (!grounded) s.d = 0; return null; }
    s.d += moved;
    if (s.d < stride(speed, o.size)) return null;
    s.d = 0; s.side = 1 - s.side;
    return { speed, side: s.side };
  }
  function runSteps(dt) {
    const w = W();
    if (!w || dt <= 0) return;
    const p = w.player;
    const cam = camPos();
    // You: grounded, walking (not driving, swimming or flying).
    if (p && p.alive && !p._ragdoll && (!p.controller || p.controller === 'walk') && !p.flying) {
      const st = stepAlong(p, dt, {});
      if (st) {
        const g = groundUnder(p);
        footstep(g.surface, { mine: true, loudness: clamp(0.2 + st.speed / 22, 0.15, 0.6), key: 'me' });
        if (J.fx && J.fx.footprint) J.fx.footprint(g.surface, p, st.side);
        if (J.fx && J.fx.dust && st.speed > 7 && /dirt|sand|snow/.test(g.surface)) J.fx.dust([p.x, p.bottom, p.z], { amount: 0.25, surface: g.surface });
      }
    }
    // The nearest few creatures and other players walking.
    const max = J.budget.creatureSteps;
    if (!max || !cam) return;
    const near = [];
    for (const e of w.entities) {
      if (!e.alive || e === p || e._ragdoll || !(e.living || e.remotePlayer) || !e.visible) continue;
      const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
      if (d < 26) near.push({ e, distance: d });
    }
    for (const { e } of M.pickNearest(near, max)) {
      const r = e.living;
      if (r && (r.flying || r.sp.swims || r.sp.flies && r.alt > 0)) continue;
      const size = r ? (r.tall || 1) : 1.8;
      const st = stepAlong(e, dt, { grounded: e.remotePlayer ? Math.abs(e.y - (e._jy ?? e.y)) < 0.05 : e.grounded, size: size / 1.8 });
      e._jy = e.y;
      if (!st) continue;
      const g = groundUnder(e);
      const heavy = r ? clamp(Math.log10(1 + (r.sp.mass || 50) * r.size) / 3, 0.15, 1) : 0.5;
      footstep(g.surface === 'grass' && heavy > 0.7 ? 'dirt' : g.surface, { at: g.at, loudness: 0.12 + heavy * 0.35, pitch: clamp(1.4 - heavy * 0.6, 0.6, 1.5), key: `st:${e.sceneId || e.name || e._jid}` });
      if (J.fx && J.fx.footprint && st.speed > 1) J.fx.footprint(g.surface, e, st.side);
    }
  }

  // ------------------------------------------------------------------ whooshes: things that fly past
  /** A whoosh at a point, for something going `speed` m/s. */
  function whoosh(at, speed = 15, o = {}) {
    if (!J.allowed('sounds')) return false;
    const d = distTo(at);
    if (d > 35) return false;
    const now = clock();
    const voice = budget.request({ priority: M.priorityOf(clamp(speed / 30, 0.1, 1), d, 0.8), now, until: now + 0.6, key: o.key, gap: 0.5 });
    if (!voice) return false;
    J.sound.whooshes++;
    const a = live();
    if (!a) return true;
    try {
      const id = assetFor(['whoosh', 'swoosh', 'swish']);
      const buf = id ? bufferOf(id) : null;
      const { g } = outFor(a, at, 1);
      const vol = clamp(speed / 30, 0.1, 0.7) * 0.6, dur = clamp(0.5 - speed / 200, 0.25, 0.5);
      if (buf) { const s = a.createBufferSource(); s.buffer = buf; s.playbackRate.value = clamp(speed / 18, 0.7, 1.6); g.gain.value = vol; s.connect(g); s.start(); return true; }
      const t = a.currentTime;
      const n = a.createBufferSource(); n.buffer = noise(a);
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.2;
      bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(900 + speed * 50, t + dur * 0.5); bp.frequency.exponentialRampToValueAtTime(400, t + dur);
      const ng = a.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(vol, t + dur * 0.45); ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      n.connect(bp).connect(ng).connect(g); n.start(t, Math.random(), dur + 0.05); n.stop(t + dur + 0.06);
    } catch { /* fine */ }
    return true;
  }
  const flying = new WeakMap(); // entity -> { fast, t }
  let scanAt = 0;
  function runWhooshes(dt) {
    const w = W();
    const cam = camPos();
    scanAt += dt;
    if (!w || !cam || scanAt < 0.05) return;
    scanAt = 0;
    for (const e of w.entities) {
      if (!e.alive || e.physics !== 'dynamic' || e.sleeping || e.isPlayer || e.held || e._ragPart && e._ragPart.name !== 'torso') continue;
      const sp = Math.hypot(e.vx, e.vy, e.vz);
      let f = flying.get(e);
      if (sp < 11 || e.grounded) { if (f) f.fast = false; continue; }
      const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
      if (d > 30) continue;
      if (!f) { f = { fast: false, near: false }; flying.set(e, f); }
      // Once when it starts flying (thrown, blasted), and once more when it goes right past you.
      const close = d < 4;
      if (!f.fast || (close && !f.near)) whoosh([e.x, e.y, e.z], sp, { key: `wh:${e._jid || (e._jid = ++ids)}` });
      f.fast = true; f.near = close;
    }
  }

  // ------------------------------------------------------------------ every frame; worlds come and go
  H.hooks.frame.push((dt) => {
    if (!W()) return;
    try {
      if (J.level !== lastLevel) { lastLevel = J.level; budget.max = J.budget.voices; }
      listen();
      runSteps(dt);
      runWhooshes(dt);
      runLoops(dt);
    } catch (err) { H.report(err, 'juice sound'); }
  });
  H.hooks.world.push({
    enter() { touching.clear(); budget.clear(); },
    leave() { touching.clear(); budget.clear(); dropLoops(); },
  });

  J.sound = {
    play, impact, footstep, whoosh, budget,
    /** fn({ a, b, at, speed, sound }) for every impact that made a sound (juice-fx.js puts sparks and dust on them). */
    hits: [],
    played: 0, steps: 0, whooshes: 0,
    get loops() { return loops.filter((l) => l.g.gain.value > 0.01).map((l) => l.kind); },
    STEP_VOICE,
  };
})();
