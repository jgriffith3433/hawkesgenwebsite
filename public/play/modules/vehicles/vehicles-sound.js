// Vehicles, part 6: how vehicles sound. Sounds only, never forces. The numbers (pure, tested in
// test/engine/vehicles-sound.test.ts) are H.vehicles.sound.math; the rest plays recorded loops made with Hawkes Gen
// (public/play/audio/sfx/veh-*.mp3, filed in hawkes.library.json "vehicle-sound").
//   wheeled   a 4-gear engine model (rpm from speed and the gear's ratio, a drop at each shift, load on hills and under
//             throttle), four engine loops (idle, low, mid, high) crossfaded by rpm with a pitch bend inside each band, a
//             dip and a clunk at a shift; a tyre loop by the ground under the wheels (road, sand, grass, shallows; the same
//             lookup as the dust), scaled by speed and slip; thumps when it lands; the horn.
//   helicopter  rotor loops at low and full collective, pitch by the spool, a turbine whine, a startup and a shutdown, and
//             a doppler shift (a sound's pitch drops as it passes the camera).
//   rocket    an ignition, a roar that follows the climb and goes dull with distance, a rumble tail after the burn.
// Everything goes through the sfx bus (H.audio.effects), placed in 3D with H.audio.spatial when the mix has it. A phone
// keeps 2 engine layers playing, a desktop up to 4. Until the files are there, the old synthesised engines play (owns()).
// window.__vehicleSound and game events 'vehicle-sound' say what it does (layer gains, shifts, surfaces, doppler, rocket).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const V = H.vehicles;
  const W = () => H.world;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const r2 = (x) => Math.round(x * 100) / 100;

  // ------------------------------------------------------------------ the numbers (no engine in them)
  const RATIOS = [3.2, 2.1, 1.45, 1.0];            // the 4 gears
  const IDLE = 0.14, SHIFT_UP = 0.94, SHIFT_DOWN = 0.38;
  const CENTERS = [0.08, 0.38, 0.68, 1.0];         // the engine loops' places on the rpm scale: idle, low, mid, high
  const SOUND_SPEED = 120;                         // m/s: slower than air, so a fly-by is heard (a game's metre is generous)
  const math = {
    RATIOS, CENTERS, IDLE,
    /** The fastest this gear goes before the redline (m/s). */
    redline(gear, top) { return top * 1.05 / RATIOS[clamp(gear, 1, RATIOS.length) - 1]; },
    /** rpm (0-1.2) in a gear: from idle at a stop to the redline, plus the load (throttle and hill) leaning on it. */
    rpm(speed, gear, top, load = 0) { return clamp(IDLE + (1 - IDLE) * Math.abs(speed) / math.redline(gear, top) + 0.08 * clamp(load, 0, 1), 0, 1.2); },
    /** The gear after this frame: up at the redline (later on a hill: load holds it), down when the note sinks. Returns the gear. */
    gearFor(gear, speed, top, load = 0) {
      let g = clamp(gear, 1, RATIOS.length);
      const up = SHIFT_UP + 0.04 * clamp(load, 0, 1);
      if (g < RATIOS.length && math.rpm(speed, g, top, load) >= up) g++;
      else if (g > 1 && math.rpm(speed, g, top, load) < SHIFT_DOWN) g--;
      return g;
    },
    /** How hard the engine works: the throttle and the slope under the nose (fwdY is the nose's rise, 0-1). */
    load(throttle, fwdY) { return clamp(Math.abs(throttle) * 0.6 + Math.max(0, fwdY) * 2.2, 0, 1); },
    /** The gain of each of the four engine loops at this rpm: neighbours cross over; wide: a bit more overlap (desktop). Sum of squares 1. */
    layerGains(rpm, wide = false) {
      const out = CENTERS.map((c, i) => {
        const lo = CENTERS[i - 1] ?? -1, hi = CENTERS[i + 1] ?? 3;
        const half = (rpm < c ? c - lo : hi - c) * (wide ? 1.35 : 1);
        return Math.cos(clamp(Math.abs(rpm - c) / half, 0, 1) * Math.PI / 2);
      });
      const n = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
      return out.map((x) => x / n);
    },
    /** Keeps only the loudest n (a phone plays 2) and renormalises. */
    topLayers(gains, n) {
      const keep = new Set(gains.map((g, i) => [g, i]).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]));
      const out = gains.map((g, i) => (keep.has(i) ? g : 0));
      const s = Math.sqrt(out.reduce((a, x) => a + x * x, 0)) || 1;
      return out.map((x) => x / s);
    },
    /** The pitch of a layer: its own band bends the note with the rpm. */
    layerRate(rpm, i) { return clamp(1 + (rpm - CENTERS[i]) * 0.55, 0.72, 1.32); },
    /** The tyre loop's volume (0-1) and pitch from speed and a slide. */
    tyre(speed, slip, ground) {
      const s = clamp(Math.abs(speed) / 18, 0, 1);
      const base = ground === 'shallows' ? 1.1 : ground === 'sand' ? 0.8 : 0.9;
      return { gain: clamp((s < 0.04 ? 0 : Math.pow(s, 0.7)) * base * (1 + (slip ? 0.35 : 0)), 0, 1.2), rate: 0.8 + 0.5 * s + (slip ? 0.06 : 0) };
    },
    /** Which tyre loop a ground uses (the ground names are vfx's: road, sand, grass, shallows, hard). */
    tyreLoop(ground) { return ground === 'sand' ? 'sand' : ground === 'grass' ? 'grass' : ground === 'shallows' ? 'water' : 'road'; },
    /** The dip at a shift: 1 normally, down to 0.45 and back over 0.3 s (t: seconds since the shift). */
    shiftDip(t) { return t < 0 || t > 0.3 ? 1 : 1 - 0.55 * Math.sin(Math.PI * t / 0.3); },
    /** Doppler: the playback rate for a source moving at radial speed vr (m/s, positive = going away). */
    doppler(vr) { return clamp(SOUND_SPEED / (SOUND_SPEED + clamp(vr, -80, 80)), 0.6, 1.5); },
    /** Rotor loops: the low one fades out and the full one in with the collective; the whine follows the spool. */
    rotor(collective, spool) {
      const c = clamp(collective, 0, 1);
      return { low: Math.cos(c * Math.PI / 2) * spool, full: Math.sin(c * Math.PI / 2) * spool, whine: spool * (0.5 + 0.5 * (1 - c * 0.4)), rate: 0.55 + 0.6 * spool * (0.7 + 0.3 * c) };
    },
    /** The rocket's roar: loudness by the throttle, pitch by the climb (m/s), the filter by distance (m). */
    roar(throttle, climb, dist) {
      return { gain: clamp(throttle, 0, 1), rate: 0.85 + clamp(climb, 0, 300) / 300 * 0.5 + clamp(throttle, 0, 1) * 0.15, cutoff: clamp(16000 / (1 + dist / 70), 500, 16000) };
    },
    /** What each class plays at most at once. */
    maxLayers(tier) { return tier === 'phone' ? 2 : 4; },
  };

  // ------------------------------------------------------------------ the files
  const DIR = '/play/audio/sfx/veh-';
  const FILES = {
    car: ['engine-idle', 'engine-low', 'engine-mid', 'engine-high', 'tyre-road', 'tyre-sand', 'tyre-grass', 'tyre-water', 'gear-clunk', 'suspension-thump', 'horn', 'engine-start'],
    heli: ['heli-rotor-low', 'heli-rotor-full', 'heli-whine', 'heli-start', 'heli-stop'],
    rocket: ['rocket-ignite', 'rocket-roar', 'rocket-rumble'],
  };
  const buffers = new Map(), loading = new Map();
  let ac = null;
  const ctxOf = () => { if (!ac) { try { ac = H.audio && H.audio.context; } catch { ac = null; } } return ac; };
  function load(kind) {
    if (loading.has(kind)) return loading.get(kind);
    const c = ctxOf();
    if (!c || typeof fetch !== 'function') return null;
    const p = Promise.all(FILES[kind].map((n) => fetch(`${DIR}${n}.mp3`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((b) => c.decodeAudioData(b)).then((buf) => { buffers.set(n, buf); }).catch(() => { /* a missing file: that part stays quiet */ })))
      .then(() => true);
    loading.set(kind, p);
    return p;
  }
  const kindOf = (v) => (v.def.class === 'wheeled' && !v.def.twoWheels ? 'car' : v.def.class === 'wheeled' ? 'car' : v.def.class === 'heli' ? 'heli' : v.type === 'rocket' ? 'rocket' : null);
  const has = (n) => buffers.has(n);
  /** True when the recorded sounds for this vehicle are loaded (the old synthesised engine stays until then). */
  function owns(v) {
    const k = kindOf(v);
    if (!k) return false;
    if (!loading.has(k)) load(k);
    return k === 'car' ? has('engine-mid') : k === 'heli' ? has('heli-rotor-full') : has('rocket-roar');
  }

  // ------------------------------------------------------------------ what it says
  const sense = { voices: 0, layers: [], rpm: 0, gear: 1, throttle: 0, speed: 0, ground: null, tyre: null, shifts: 0, surfaceSwitches: 0, doppler: null, rocket: null, maxLayers: 0, log: [], bytes: 0 };
  const say = (what, data) => {
    const rec = { t: Math.round(performance.now()), what, ...data };
    sense.log.push(rec); if (sense.log.length > 80) sense.log.shift();
    try { if (window.game && window.game.emit) window.game.emit('vehicle-sound', rec); } catch { /* none */ }
  };

  // ------------------------------------------------------------------ voices
  const voices = new Map(); // vehicle entity -> voice
  const busOf = () => H.audio.effects || H.audio.master;
  function loop(name, out) {
    const buf = buffers.get(name), c = ctxOf();
    if (!buf) return null;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const g = c.createGain(); g.gain.value = 0;
    src.connect(g).connect(out); src.start(0, Math.random() * buf.duration);
    return { src, g, name };
  }
  function shot(name, out, gain = 1, rate = 1) {
    const buf = buffers.get(name), c = ctxOf();
    if (!buf) return null;
    const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g).connect(out); src.start();
    return { src, g };
  }
  function makeVoice(e, v) {
    const c = ctxOf(), kind = kindOf(v);
    const input = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000;
    input.connect(lp);
    const voice = { e, v, kind, input, lp, loops: {}, sp: null, mine: false, gear: 1, shiftT: 9, ground: null, pendG: null, pendT: 0, tyre: null, lastAir: 0, wasGrounded: true, vy: 0, spool: 0, dist: null, prevD: null, rate: 1, burning: false, horn: null, doppler: 1, minDop: 1, maxDop: 1, burnT: 0 };
    voice.setPlace = (mine) => {
      if (voice.mine === mine && voice.placed) return;
      voice.mine = mine; voice.placed = true;
      try { lp.disconnect(); } catch { /* fine */ }
      if (voice.sp) { try { voice.sp.stop(); } catch { /* fine */ } try { voice.sp.input.disconnect(); } catch { /* fine */ } voice.sp = null; }
      // Your own vehicle is heard from inside it (straight to the bus); the others from where they are.
      const sp = !mine && H.audio.spatial ? H.audio.spatial(() => { const p = e.node.position; return [p.x, p.y, p.z]; }, { who: `veh:${e.name || v.type}`, ref: kind === 'rocket' ? 30 : 6, rolloff: kind === 'rocket' ? 0.35 : 0.9, max: kind === 'rocket' ? 5000 : 160, bus: busOf() }) : null;
      if (sp) { lp.connect(sp.input); voice.sp = sp; } else lp.connect(busOf());
      voice.out = lp; voice.dest = sp ? sp.input : busOf();
    };
    return voice;
  }
  function dispose(voice) {
    const c = ctxOf(), t = c ? c.currentTime : 0;
    for (const l of Object.values(voice.loops)) { if (!l) continue; try { l.g.gain.setTargetAtTime(0, t, 0.08); l.src.stop(t + 0.5); } catch { /* fine */ } }
    if (voice.sp) { try { voice.sp.stop(); } catch { /* fine */ } }
    setTimeout(() => { try { voice.input.disconnect(); voice.lp.disconnect(); if (voice.sp) voice.sp.input.disconnect(); } catch { /* fine */ } }, 700);
  }
  const ensure = (voice, name) => { if (!(name in voice.loops)) voice.loops[name] = loop(name, voice.input); return voice.loops[name]; };
  const setG = (l, g, rate, t, k = 0.06) => { if (!l) return; try { l.g.gain.setTargetAtTime(g, t, k); if (rate) l.src.playbackRate.setTargetAtTime(rate, t, 0.08); } catch { /* fine */ } };

  // ------------------------------------------------------------------ wheeled
  const wheelPoint = (w) => { const n = w.tire || w.steerNode; n.computeWorldMatrix(true); const p = n.getAbsolutePosition(); return [p.x, p.y - (w.r || 0.35), p.z]; };
  function groundOf(v) {
    const grounds = {}; let slip = false;
    const classify = V.vfx && V.vfx.math ? V.vfx.math.classify : (s) => (s === 'sand' ? 'sand' : s === 'grass' ? 'grass' : 'road');
    for (const w of v.wheels) {
      if (!w.contact) continue;
      const at = wheelPoint(w);
      let wy = null; try { wy = H.water && H.water.surfaceAt ? H.water.surfaceAt(at[0], at[2]) : null; } catch { /* none */ }
      const wet = wy !== null && wy !== undefined && at[1] < wy + 0.12;
      let surface = 'dirt';
      try { surface = wet ? 'water' : w.ground ? H.juiceMath.surfaceOf(w.ground, at) : H.terrain && H.terrain.materialAt ? (H.terrain.materialAt(at[0], at[2]) || 'dirt') : 'dirt'; } catch { /* dirt */ }
      const g = classify(surface, wet);
      grounds[g] = (grounds[g] || 0) + 1;
      if (w.slip) slip = true;
    }
    let top = null, n = 0;
    for (const k of Object.keys(grounds)) if (grounds[k] > n) { top = k; n = grounds[k]; }
    return { ground: top, slip };
  }
  function wheeled(voice, dt, mine, tier) {
    const v = voice.v, c = ctxOf(), t = c.currentTime;
    const top = v.def.engine.top || 30;
    const speed = Math.abs(B.Vector3.Dot(v.vel, v.fwd));
    const throttle = Math.abs(v.throttleNow || 0);
    const load = math.load(throttle, v.fwd.y);
    const driven = Boolean(v.seats[0].who) || Boolean(v.autopilot);
    // The gears: a shift drops the note, dips the volume for 0.3 s and clunks.
    const g = math.gearFor(voice.gear, speed, top, load);
    voice.shiftT += dt;
    if (g !== voice.gear) {
      const up = g > voice.gear;
      say('shift', { vehicle: voice.e.name || v.def.title, from: voice.gear, to: g, dir: up ? 'up' : 'down', speed: r2(speed), mine });
      voice.gear = g; voice.shiftT = 0;
      if (mine) sense.shifts++;
      shot('gear-clunk', voice.input, mine ? 0.7 : 0.45, up ? 1 : 0.9);
    }
    const rpm = math.rpm(speed, voice.gear, top, load) * (v.boosting ? 1.08 : 1);
    voice.rpm = voice.rpm === undefined ? rpm : voice.rpm + (rpm - voice.rpm) * Math.min(1, dt * (voice.shiftT < 0.3 ? 14 : 7));
    const dip = math.shiftDip(voice.shiftT);
    const n = math.maxLayers(tier);
    const gains = math.topLayers(math.layerGains(voice.rpm, tier !== 'phone'), n);
    const body = (driven ? 1 : 0) * dip * (mine ? 0.9 : 0.6) * (0.55 + 0.45 * Math.max(throttle, 0.3));
    const bend = v.def.twoWheels ? 1.2 : 1;
    ['engine-idle', 'engine-low', 'engine-mid', 'engine-high'].forEach((name, i) => {
      const gi = gains[i] * body;
      const l = gi > 0.002 || voice.loops[name] ? ensure(voice, name) : null;
      setG(l, gi, math.layerRate(voice.rpm, i) * bend, t, 0.05);
    });
    // The tyres, by the ground under them (steady 0.15 s before a switch), scaled by speed and slip.
    const gr = groundOf(v);
    if (gr.ground && gr.ground !== voice.ground) {
      if (gr.ground !== voice.pendG) { voice.pendG = gr.ground; voice.pendT = 0; }
      voice.pendT += dt;
      if (voice.pendT >= 0.15 && speed > 0.5) {
        const from = voice.tyre;
        voice.ground = gr.ground; voice.pendG = null; voice.tyre = math.tyreLoop(gr.ground);
        if (voice.tyre !== from) {
          say('surface', { vehicle: voice.e.name || v.def.title, from, to: voice.tyre, ground: gr.ground, speed: r2(speed), mine });
          if (mine) sense.surfaceSwitches++;
        }
      }
    } else voice.pendG = null;
    for (const name of ['road', 'sand', 'grass', 'water']) {
      const on = name === voice.tyre;
      const ty = math.tyre(speed, gr.slip, voice.ground);
      const gi = on && v.grounded !== false ? ty.gain * (mine ? 0.7 : 0.5) : 0;
      const l = gi > 0.002 || voice.loops['tyre-' + name] ? ensure(voice, 'tyre-' + name) : null;
      setG(l, gi, ty.rate, t, on ? 0.12 : 0.1);
    }
    // Landing: a thump from the springs, by how hard it came down.
    const grounded = Boolean(v.grounded);
    if (grounded && !voice.wasGrounded && voice.vy < -3) shot('suspension-thump', voice.input, clamp(-voice.vy / 14, 0.25, 1) * (mine ? 0.9 : 0.6), 0.9 + Math.random() * 0.2);
    voice.wasGrounded = grounded; voice.vy = v.vel.y;
    // The horn.
    if (v.horn && !voice.horn) { const h = shot('horn', voice.input, 0.55); voice.horn = h || true; } else if (!v.horn) voice.horn = null;
    if (mine) {
      sense.rpm = r2(voice.rpm); sense.gear = voice.gear; sense.throttle = r2(throttle); sense.speed = r2(speed); sense.ground = voice.ground; sense.tyre = voice.tyre;
      sense.layers = gains.map((x, i) => r2(x * body)); sense.maxLayers = n;
      sense.active = sense.layers.filter((x) => x > 0.02).length;
      layerLog(sense.layers);
    }
  }
  // The layers heard are logged when the set of active ones changes (rest to top speed logs each in turn).
  let lastSet = '';
  function layerLog(ls) {
    const set = ls.map((x) => (x > 0.05 ? 1 : 0)).join('');
    if (set !== lastSet) { lastSet = set; say('layers', { active: set, gains: ls, rpm: sense.rpm, gear: sense.gear, speed: sense.speed }); }
  }

  // ------------------------------------------------------------------ helicopter
  let camPrev = null;
  function heli(voice, dt, mine, cam) {
    const v = voice.v, c = ctxOf(), t = c.currentTime;
    const spool = v.spool || 0;
    const r = math.rotor(v.collective || 0, spool);
    if (spool > 0.05 && voice.spool <= 0.05) { shot('heli-start', voice.input, 0.8); say('heli', { phase: 'start', vehicle: voice.e.name || v.def.title, mine }); }
    if (spool < voice.spool && voice.spool > 0.05 && spool <= 0.05) { shot('heli-stop', voice.input, 0.7); say('heli', { phase: 'stop', vehicle: voice.e.name || v.def.title, mine }); }
    voice.spool = spool;
    // The doppler: the rate of change of the distance to the camera.
    let dop = 1;
    if (cam && !mine) {
      const d = B.Vector3.Distance(cam.globalPosition || cam.position, voice.e.node.position);
      if (voice.prevD !== null && dt > 0) {
        const vr = (d - voice.prevD) / dt;
        const target = math.doppler(vr);
        voice.doppler += (target - voice.doppler) * Math.min(1, dt * 10);
        dop = voice.doppler;
        if (spool > 0.3) {
          voice.minDop = Math.min(voice.minDop, dop); voice.maxDop = Math.max(voice.maxDop, dop);
          if (voice.lastDop > 1.04 && dop < 0.97 && voice.prevD < 90) {
            const rec = { vehicle: voice.e.name || v.def.title, before: r2(voice.lastDop), after: r2(dop), drop: r2(voice.lastDop - dop), distance: r2(d), pass: true };
            sense.doppler = rec; say('doppler', rec); voice.lastDop = dop;
          } else if (dop > 1.04 || !voice.lastDop) voice.lastDop = Math.max(voice.lastDop || 1, dop);
        }
      }
      voice.prevD = d;
    } else { voice.doppler = 1; voice.prevD = null; }
    const run = Boolean(v.seats[0].who) || Boolean(v.autopilot) || spool > 0.02;
    const body = (run ? 1 : 0) * (mine ? 0.9 : 0.8);
    setG(ensure(voice, 'heli-rotor-low'), r.low * body, r.rate * dop, t, 0.1);
    setG(ensure(voice, 'heli-rotor-full'), r.full * body, r.rate * dop * 1.02, t, 0.1);
    setG(ensure(voice, 'heli-whine'), r.whine * body * 0.5, (0.7 + 0.8 * spool) * dop, t, 0.15);
    if (mine) { sense.rotor = { collective: r2(v.collective || 0), spool: r2(spool), low: r2(r.low * body), full: r2(r.full * body), rate: r2(r.rate) }; }
  }

  // ------------------------------------------------------------------ rocket
  function rocket(voice, dt, mine, cam) {
    const v = voice.v, c = ctxOf(), t = c.currentTime;
    const burning = (v.throttleNow || 0) > 0.01 && (v.fuel || 0) > 0 && !v.wrecked;
    const climb = Math.max(0, v.vel.y);
    const d = cam ? B.Vector3.Distance(cam.globalPosition || cam.position, voice.e.node.position) : 0;
    const roar = math.roar(v.throttleNow || 0, climb, mine ? 0 : d);
    if (burning && !voice.burning) {
      voice.burning = true; voice.burnT = 0;
      shot('rocket-ignite', voice.input, 1);
      sense.rocket = { phase: 'ignition', vehicle: voice.e.name || v.def.title, distance: r2(d) };
      say('rocket', sense.rocket);
    }
    if (burning) {
      voice.burnT += dt;
      if (voice.burnT > 0.6 && !voice.roaring) { voice.roaring = true; sense.rocket = { phase: 'roar', vehicle: voice.e.name || v.def.title, climb: r2(climb), cutoff: Math.round(roar.cutoff), distance: r2(d) }; say('rocket', sense.rocket); }
    }
    if (!burning && voice.burning) {
      voice.burning = false; voice.roaring = false;
      const h = voice.burnT > 1.5; // a real climb, not a flicker
      if (h) { shot('rocket-rumble', voice.input, 0.9); sense.rocket = { phase: 'rumble', vehicle: voice.e.name || v.def.title, burned: r2(voice.burnT), distance: r2(d) }; say('rocket', sense.rocket); }
    }
    setG(ensure(voice, 'rocket-roar'), burning ? roar.gain * (voice.burnT > 0.5 ? 1 : 0.4) * (mine ? 0.8 : 1) : 0, roar.rate, t, 0.12);
    try { voice.lp.frequency.setTargetAtTime(mine ? 14000 : roar.cutoff, t, 0.1); } catch { /* fine */ }
    voice.roarCut = roar.cutoff;
  }

  // ------------------------------------------------------------------ every frame
  const SEEN = 4;
  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w || !w.scene || !(dt > 0) || !V.list || !ctxOf()) return;
    if (ac.state === 'suspended') return;
    try {
      const cam = w.scene.activeCamera;
      const me = V.current ? V.current.vehicle : null;
      const tier = H.device && H.device.tier;
      const live = new Set();
      const cands = [];
      for (const e of V.list()) {
        const v = e.vehicle;
        if (!v || !e.alive || !v.vel || !kindOf(v) || v.wrecked) continue;
        const kind = kindOf(v), mine = v === me;
        const near = cam ? B.Vector3.Distance(cam.position, e.node.position) : 0;
        const active = Boolean(v.seats[0].who) || Boolean(v.autopilot) || (kind === 'heli' && v.spool > 0.02) || (kind === 'rocket' && ((v.throttleNow || 0) > 0.01 || voices.has(e)));
        if (!active && !(voices.get(e) && voices.get(e).burning)) continue;
        if (!mine && kind !== 'rocket' && near > 130) continue;
        if (!owns(v)) continue;
        cands.push({ e, v, kind, mine, near });
      }
      cands.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || a.near - b.near);
      for (const { e, v, kind, mine } of cands.slice(0, SEEN)) {
        live.add(e);
        let voice = voices.get(e);
        if (!voice) { voice = makeVoice(e, v); voices.set(e, voice); if (kind === 'car') shot('engine-start', voice.input, 0.8); }
        voice.setPlace(mine);
        if (kind === 'car') wheeled(voice, dt, mine, tier);
        else if (kind === 'heli') heli(voice, dt, mine, cam);
        else rocket(voice, dt, mine, cam);
      }
      for (const [e, voice] of voices) if (!live.has(e)) { dispose(voice); voices.delete(e); }
      sense.voices = voices.size;
      if (!me) { sense.layers = []; sense.active = 0; lastSet = ''; }
    } catch (err) { H.report(err, 'vehicles sound'); }
  });
  H.hooks.world.push({ enter() { for (const k of ['log']) sense[k] = []; sense.shifts = sense.surfaceSwitches = 0; sense.doppler = sense.rocket = null; lastSet = ''; }, leave() { for (const [, voice] of voices) dispose(voice); voices.clear(); camPrev = null; } });
  void camPrev;

  V.sound = {
    math, owns, files: FILES,
    /** What the playtest reads: layer gains, gear, the tyre loop, shifts, surface switches, the doppler and the rocket. */
    sample() { return { ...sense, voices: voices.size, loaded: buffers.size, tier: H.device && H.device.tier }; },
  };
  try { Object.defineProperty(window, '__vehicleSound', { get: () => V.sound.sample(), configurable: true }); } catch { /* fine */ }
})();
