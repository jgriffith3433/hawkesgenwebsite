// Vehicles, part 4: how driving feels. The numbers (pure, tested in test/engine/vehicles-feel.test.ts) are H.vehicles.feel.math;
// the rest watches the vehicles each frame and adds only looks and sounds, never forces: the view widens and trails with
// speed, the body leans in bends and dives under braking, dust and spray by surface, an engine that climbs through
// gears with load, tire squeal, a landing (dip, dust, thud, shake), bumps, a drift that swings the camera, and
// headlights that come on at night. The physics in vehicles.js is untouched. Phones: Juice's level (reduced / minimal)
// halves and stops the particles; reduce motion turns the camera effects down.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const V = H.vehicles;
  const X = V._;
  const W = () => H.world;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

  // ------------------------------------------------------------------ the math (no engine in it)
  const DUST = { sand: 1, dirt: 0.9, snow: 0.8, grass: 0.5, stone: 0.12, wood: 0.1, metal: 0.05 };
  const math = {
    clamp, smooth,
    /** The view's widening (radians) at a speed: wheeled vehicles ease in over the top speed; boost adds; reduce motion
     *  leaves a third. Flying vehicles keep the old, gentler widening. */
    fovKick(speed, top, o = {}) {
      const k = o.motion === undefined ? 1 : o.motion;
      const r = clamp(speed / Math.max(1, top), 0, 1.3);
      const base = o.flying ? clamp(speed / 90, 0, 0.12) : 0.2 * Math.pow(smooth(r), 1.1);
      return (base + (o.boosting ? 0.12 : 0) + (o.drift ? clamp(o.drift, 0, 1) * 0.04 : 0)) * k;
    },
    /** The chase camera trails: how fast it follows (1/s: 9 standing, down to 5.5 flat out) and how much farther back (m). */
    camLag(speed, top) { const r = smooth(speed / Math.max(1, top)); return { rate: 9 - 3.5 * r, back: 0.9 * r }; },
    /** The body leans out of a bend: roll (radians, around forward; positive tips the right side up) from sideways acceleration to the right (m/s²). */
    roll(lat, o = {}) { return clamp(lat * (o.k ?? 0.016), -(o.max ?? 0.14), o.max ?? 0.14); },
    /** Nose dives under braking and squats under power: pitch (radians, positive nose down) from forward acceleration. */
    pitch(lon, o = {}) { return clamp(-lon * (o.k ?? 0.009), -(o.max ?? 0.07), o.max ?? 0.07); },
    /** A spring that eases a lean toward a target (critically damped, stable at any dt). */
    ease(cur, target, dt, rate = 10) { return cur + (target - cur) * (1 - Math.exp(-rate * dt)); },
    /** The camera swings toward the slide of a drift: yaw (radians) from the sideways speed. */
    driftYaw(vlat, speed) { return speed < 4 ? 0 : clamp(Math.atan2(vlat, Math.max(4, speed)) * 0.5, -0.3, 0.3); },
    /** How much dust a wheel kicks up (0-1.4): the surface, the speed, a slide or a launch. */
    dustAmount(surface, speed, o = {}) {
      const s = DUST[surface] ?? 0.5;
      if (speed < 3) return 0;
      return clamp(s * (clamp(speed / 22, 0, 1) * 0.55 + (o.slip ? 0.6 : 0) + (o.throttle ? 0.15 : 0)), 0, 1.4);
    },
    /** Seconds between puffs from one wheel: faster is more often (phones, half as often, from a level's particle share). */
    dustEvery(speed, share = 1) { return clamp(0.32 - speed * 0.007, 0.08, 0.32) / Math.max(0.2, share); },
    /** The engine's note (0-1.3) from speed and load: it climbs through gears and drops a little at each change, and
     *  full throttle (load 1) holds it higher than coasting. */
    engineRpm(speed, top, load = 0, o = {}) {
      const gears = o.gears || 5, r = clamp(Math.abs(speed) / Math.max(1, top), 0, 1.3);
      const g = Math.min(gears - 1e-6, r * gears), within = g - Math.floor(g);
      const rpm = 0.2 + 0.5 * within + 0.28 * Math.min(1, r) + 0.2 * clamp(load, 0, 1);
      return clamp(rpm, 0, 1.3) * (o.boosting ? 1.12 : 1);
    },
    /** Tire squeal 0-1: sliding sideways, or the handbrake on at speed. */
    skid(vlat, speed, handbrake) {
      if (speed < 3) return 0;
      return clamp(Math.max((Math.abs(vlat) - 2) / 8, handbrake && speed > 5 ? 0.55 : 0), 0, 1);
    },
    /** A landing from a fall at this speed (m/s): the camera dip (m), the shake (0-1), the dust (0-1.4), the thud's loudness. */
    landing(impact) {
      if (impact < 3.5) return null;
      const k = clamp((impact - 3.5) / 14, 0, 1);
      return { dip: 0.06 + 0.3 * k, shake: 0.12 + 0.5 * k, dust: 0.3 + 1.1 * k, loudness: 0.3 + 0.7 * k, size: k > 0.5 ? 'crash' : 'knock' };
    },
    /** A bump: how fast a wheel's spring was squashed (m/s) at a speed: a small camera shake, or 0. */
    bump(compSpeed, speed) { return compSpeed < 1.6 || speed < 6 ? 0 : clamp((compSpeed - 1.6) * 0.045, 0, 0.22); },
    /** Headlights come on when the day is dark (H.sky.day < 0.45) and off when it is light again (> 0.6): hysteresis. */
    lightsWanted(day, on) { return on ? day < 0.6 : day < 0.45; },
  };

  // ------------------------------------------------------------------ the live part
  const state = new WeakMap(); // vehicle -> what it was doing last frame
  const sense = { fov: 0, roll: 0, pitch: 0, rpm: 0, dip: 0, skid: 0, dust: 0, puffs: 0, landed: 0, bumps: 0, night: 0, camBack: 0 };
  const J = () => H.juice;
  function st(v) {
    let s = state.get(v);
    if (!s) { s = { vel: v.vel.clone(), roll: 0, pitch: 0, lat: 0, lon: 0, air: 0, minVy: 0, wasGrounded: true, dip: 0, dipV: 0, puff: 0, comp: [], autoLights: false, manual: false, rpm: 0, skid: 0, bump: 0 }; state.set(v, s); }
    return s;
  }
  const level = () => (J() && J().level) || 'full';
  const share = () => { const j = J(); return j && j.allowed('particles') ? (j.budget ? j.budget.particles : 1) : 0; };
  const motion = () => { const j = J(); return j && j.motion !== undefined ? j.motion : 1; };
  const surfaceAt = (w, at) => { try { return w.ground ? H.juiceMath.surfaceOf(w.ground, at) : 'dirt'; } catch { return 'dirt'; } };

  // The tire squeal and the thud: one noise through a band, heard for the local vehicle only.
  let ac = null, skidGain = null, skidFilter = null;
  function skidSound(level01, surface) {
    try {
      if (!ac) {
        ac = H.audio && H.audio.context;
        if (!ac) return;
        const len = ac.sampleRate, buf = ac.createBuffer(1, len, ac.sampleRate), ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
        skidFilter = ac.createBiquadFilter(); skidFilter.type = 'bandpass'; skidFilter.Q.value = 4;
        skidGain = ac.createGain(); skidGain.gain.value = 0;
        src.connect(skidFilter).connect(skidGain).connect(H.audio.effects || H.audio.master);
        src.start();
      }
      const loose = /dirt|sand|snow|grass/.test(surface);
      const t = ac.currentTime;
      skidFilter.frequency.setTargetAtTime(loose ? 700 : 1700 + level01 * 700, t, 0.05);
      skidGain.gain.setTargetAtTime(level01 * (loose ? 0.12 : 0.1), t, 0.05);
    } catch { /* no sound here */ }
  }
  function skidOff() { if (skidGain && ac) { try { skidGain.gain.setTargetAtTime(0, ac.currentTime, 0.05); } catch { /* fine */ } } }

  function wheelPoint(w) {
    const t = w.tire || w.steerNode;
    const p = t.getAbsolutePosition();
    return [p.x, p.y - (w.r || 0.35), p.z];
  }

  function stepOne(v, dt, mine, cam) {
    const D = v.def, s = st(v);
    const speed = v.vel.length();
    const top = D.engine.top || 30;
    // Acceleration along the vehicle's own axes, smoothed.
    if (dt > 0) {
      const ax = (v.vel.x - s.vel.x) / dt, ay = (v.vel.y - s.vel.y) / dt, az = (v.vel.z - s.vel.z) / dt;
      const a = new B.Vector3(ax, ay, az);
      const clampA = (x) => clamp(x, -40, 40);
      s.lat += (clampA(-B.Vector3.Dot(a, v.right)) - s.lat) * Math.min(1, dt * 8);   // (right-hand bend, accel to the left, leans right)
      s.lon += (clampA(B.Vector3.Dot(a, v.fwd)) - s.lon) * Math.min(1, dt * 8);
    }
    s.vel.copyFrom(v.vel);
    const wheeled = D.class === 'wheeled';
    const level01 = motion();
    // The lean: the body (not the wheels) tips; reduce motion lessens it.
    if (wheeled && v.body && speed > 0.5) {
      s.roll = math.ease(s.roll, math.roll(s.lat) * level01, dt, 9);
      s.pitch = math.ease(s.pitch, math.pitch(s.lon) * level01, dt, 9);
    } else { s.roll = math.ease(s.roll, 0, dt, 6); s.pitch = math.ease(s.pitch, 0, dt, 6); }
    if (v.body) { v.body.rotation.z = s.roll; v.body.rotation.x = s.pitch; }

    const vlat = B.Vector3.Dot(v.vel, v.right);
    const fwdSpeed = B.Vector3.Dot(v.vel, v.fwd);
    const handbrake = Boolean(v.cur && v.cur.brake) && !D.hop;
    const near = !cam || B.Vector3.Distance(cam.position, v.e.node.position) < 60;

    if (wheeled && near) {
      // Landings.
      const grounded = v.grounded;
      if (!grounded) { s.air += dt; s.minVy = Math.min(s.minVy, v.vel.y); }
      if (grounded && !s.wasGrounded && s.air > 0.2) {
        const land = math.landing(-s.minVy);
        if (land) landed(v, s, land, mine);
      }
      if (grounded) { s.air = 0; s.minVy = 0; }
      s.wasGrounded = grounded;
      // Dust under the wheels by surface; sliding kicks more. Phones make half as many, minimal none.
      const sh = share();
      s.puff -= dt;
      if (sh > 0 && grounded && s.puff <= 0 && speed > 3) {
        s.puff = math.dustEvery(speed, sh);
        const slip = Math.abs(vlat) > 3 || handbrake;
        const rear = v.wheels.filter((w) => w.contact && w.rear);
        const wheels = rear.length ? rear : v.wheels.filter((w) => w.contact);
        const w = wheels.length ? wheels[Math.floor(Math.random() * wheels.length)] : null;
        if (w) {
          const at = wheelPoint(w), surface = surfaceAt(w, at);
          const amount = math.dustAmount(surface, speed, { slip, throttle: Math.abs(v.throttleNow || 0) > 0.3 });
          if (amount > 0.08 && J() && J().fx) { J().fx.dust(at, { amount: amount * Math.min(1, sh + 0.2), surface }); sense.puffs++; sense.dust = amount; }
        }
      }
      // Bumps: a wheel's spring squashed fast at speed.
      let comp = 0;
      v.wheels.forEach((w, i) => { const last = s.comp[i] || 0; if (w.contact && dt > 0) comp = Math.max(comp, (w.comp - last) / dt); s.comp[i] = w.contact ? w.comp : 0; });
      if (mine) {
        const b = math.bump(comp, speed);
        if (b > 0 && J() && J().allowed('shake') && level() !== 'minimal') { J().shake(b); sense.bumps++; }
      }
    }
    // Tire squeal (yours): sliding or the handbrake at speed.
    if (mine) {
      const sk = wheeled && v.grounded ? math.skid(vlat, speed, handbrake) : 0;
      s.skid += (sk - s.skid) * Math.min(1, dt * 10);
      sense.skid = s.skid;
      if (s.skid > 0.03) {
        const w = v.wheels.find((x) => x.contact);
        skidSound(s.skid, w ? surfaceAt(w, wheelPoint(w)) : 'stone');
      } else skidOff();
      // The dip after a landing is a spring; the camera reads it.
      s.dipV += (-s.dip * 90 - s.dipV * 11) * dt;
      s.dip = clamp(s.dip + s.dipV * dt, -0.5, 0.2);
      sense.dip = s.dip; sense.roll = s.roll; sense.pitch = s.pitch;
      sense.drift = math.driftYaw(vlat, speed);
    }
    // The note of the engine for the sound code: speed and load.
    s.rpm = wheeled ? math.engineRpm(Math.abs(fwdSpeed), top, Math.abs(v.throttleNow || 0), { boosting: v.boosting }) : null;
    if (mine) sense.rpm = s.rpm;
    // Boats throw spray behind them.
    if (D.class === 'boat' && near && speed > 5) {
      s.puff -= dt;
      const sh = share();
      if (s.puff <= 0 && sh > 0 && J() && J().fx && v.submerged > 0.05) {
        s.puff = math.dustEvery(speed, sh) * 1.5;
        const back = v.e.node.position.add(v.fwd.scale(-D.size[2] * 0.45));
        J().fx.burst('spray', [back.x, back.y + 0.1, back.z], { count: Math.round(6 + speed * 0.6), dir: [0, 0.5, 0], speed: 0.8 });
        sense.puffs++;
      }
    }
    // Headlights at night, for the one you drive; the L key still wins.
    if (mine && D.lamps && H.sky && typeof H.sky.day === 'number' && (H.budget.lights ?? 4) >= 2) {
      if (s.autoLights && !v.lights) { s.manual = true; s.autoLights = false; }
      const want = math.lightsWanted(H.sky.day, v.lights);
      if (!s.manual && want && !v.lights) { X.setLights(v, true); s.autoLights = true; }
      else if (!s.manual && !want && v.lights && s.autoLights) { X.setLights(v, false); s.autoLights = false; }
      sense.night = v.lights ? 1 : 0;
    }
  }

  function landed(v, s, land, mine) {
    sense.landed++;
    const j = J();
    if (mine) { s.dipV -= land.dip * 22; s.dip -= land.dip * 0.2; }
    if (!j) return;
    if (mine && j.allowed('shake')) j.shake(land.shake);
    if (mine && j.rumble) j.rumble(land.shake, land.shake * 0.5, 160);
    const sh = share();
    for (const w of v.wheels) {
      if (!w.contact || sh <= 0) continue;
      const at = wheelPoint(w);
      if (j.fx) j.fx.dust(at, { amount: land.dust * 0.55 * Math.min(1, sh + 0.2), surface: surfaceAt(w, at) });
      if (sh < 0.8) break; // (a phone: one puff from the first wheel, not four)
    }
    if (j.sound && j.allowed('sounds')) {
      const w = v.wheels.find((x) => x.contact);
      const surface = w ? surfaceAt(w, wheelPoint(w)) : 'stone';
      const p = v.e.node.position;
      try { j.sound.play({ material: H.juiceMath.MATERIALS.includes(surface) ? surface : 'metal', size: land.size, loudness: land.loudness, at: [p.x, p.y, p.z], mine, key: 'veh-land', gap: 0.25, weight: 1.5 }); } catch { /* fine */ }
    }
  }

  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w || !(dt > 0)) return;
    try {
      const cam = w.scene.activeCamera;
      const me = V.current ? V.current.vehicle : null;
      for (const e of V.list()) {
        const v = e.vehicle;
        if (!v || !e.alive || v.sleeping || !v.vel) continue;
        const mine = v === me;
        if (!mine && !(v.seats[0].who || v.autopilot)) { const s = state.get(v); if (s && (s.roll || s.pitch) && v.body) { v.body.rotation.z = v.body.rotation.x = 0; s.roll = s.pitch = 0; } continue; }
        stepOne(v, dt, mine, cam);
      }
      if (!me) { sense.fov = 0; sense.camBack = 0; skidOff(); }
    } catch (err) { H.report(err, 'vehicles feel'); }
  });
  H.hooks.world.push({ enter() { sense.landed = sense.bumps = sense.puffs = 0; }, leave() { skidOff(); } });

  /** What the chase camera asks each frame (vehicles-play.js camera()): the extra view, the follow rate, the dip, the swing. */
  function camera(v, speed, flying, boosting) {
    const D = v.def, s = st(v), top = D.engine.top || 30, m = motion();
    const lag = flying || D.class !== 'wheeled' ? { rate: 9, back: 0 } : math.camLag(speed, top);
    const vlat = B.Vector3.Dot(v.vel, v.right);
    const drift = D.class === 'wheeled' ? math.skid(vlat, speed, Boolean(v.cur && v.cur.brake)) : 0;
    const fov = math.fovKick(speed, top, { flying, boosting, motion: m, drift });
    sense.fov = fov; sense.camBack = lag.back * m;
    return { fov, rate: lag.rate, back: lag.back * m, dip: s.dip * m, yaw: D.class === 'wheeled' ? math.driftYaw(vlat, speed) * m : 0 };
  }

  V.feel = {
    math, camera,
    /** The engine's note (0-1.3) for a wheeled vehicle, or null (the sound code keeps its own for the rest). */
    rpm(v) { const s = state.get(v); return s && s.rpm !== null ? s.rpm : null; },
    /** For playtests and the console: the latest of what the local vehicle is doing to the view and the sound. */
    sample() { return { ...sense }; },
  };
})();
