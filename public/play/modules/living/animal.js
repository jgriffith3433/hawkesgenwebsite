// Living things, part 2b: how the animals move and what they are like (docs/characters.md "Movement" and section 5d).
// species.js builds a body from joints; `drive` below poses it each frame: a gait that fits the species (a horse's four
// beats, walk, trot, gallop; a cow's plod; a bear's roll; a rabbit's hop; a chicken's head thrust; a penguin's waddle; a
// dinosaur's stomp with the tail as counterweight), an idle of its own (a cat stretches, a dog pants and wags, a bird
// fluffs, a horse paws, a rabbit twitches, a deer freezes alert, a bear sways, a dinosaur roars), real eyes that blink and
// look, ears and tails on damped springs (they flop, trail the head and settle), breathing. Everything is procedural, no
// clips; one call per animal per frame, no allocation. The world's creatures (species.js animate) and the player's own
// animal body (presence-bodies.js) both call it, so a herd and the mirror's dog move the same way.
// drive(rig, a, c) -> fx { dy, pitch, roll }: how the whole body sits (the caller applies it to its root).
//   a: the animal's state bag { t, phase, lie, eat, flap } (the caller keeps t, lie and eat); rig: species.js buildBody's.
//   c: { dt, speed (m/s), state (idle walk run eat sleep sit dance knocked attack cheer fly swim flop), sp, happy,
//        flying, inWater, seed, look: { yaw, pitch } | null (radians from the body's front to what it watches) }.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const living = (H.living = H.living || {});
  const TAU = Math.PI * 2;
  const lerp = (a, b, k) => a + (b - a) * k;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  /** A damped spring on { p, v }: frequency hz, damping ratio z (< 1 overshoots). Sub-stepped so a late frame can't blow up. */
  function spring(s, target, dt, hz, z) {
    const n = Math.max(1, Math.min(5, Math.ceil(dt / 0.02))), h = Math.min(dt, 0.1) / n, w = TAU * hz;
    for (let i = 0; i < n; i++) { s.v += ((target - s.p) * w * w - 2 * z * w * s.v) * h; s.p += s.v * h; }
    return s.p;
  }

  // ------------------------------------------------------------------ gaits
  // amp: leg swing, bob: body bounce, stride: steps per meter, roll/pitch: the body's sway and rock, nod: head nod,
  // head: head carried lower (+) or higher (-), tail: tail carried higher (+).
  const GAITS = {
    cat: { amp: 0.9, bob: 0.45, stride: 1.2, roll: 0.035, pitch: 0.02, nod: 0.3, head: 0.12, tail: 0.1 },
    dog: { amp: 1.05, bob: 1, stride: 1.1, roll: 0.02, pitch: 0.03, nod: 0.6, head: 0, tail: 0.25 },
    wolf: { amp: 1.05, bob: 0.7, stride: 0.95, roll: 0.025, pitch: 0.03, nod: 0.4, head: 0.1, tail: -0.1 },
    horse: { amp: 1, bob: 1.1, stride: 0.85, roll: 0.012, pitch: 0.04, nod: 1.8, head: -0.05, tail: 0.3 },
    cow: { amp: 0.7, bob: 0.5, stride: 0.75, roll: 0.045, pitch: 0.01, nod: 1.2, head: 0.1, tail: 0 },
    bear: { amp: 0.75, bob: 0.4, stride: 0.7, roll: 0.09, pitch: 0.02, nod: 0.7, head: 0.12, tail: 0 },
    pig: { amp: 0.8, bob: 0.9, stride: 1.5, roll: 0.04, pitch: 0.02, nod: 2.2, head: 0.1, tail: 0 },
    sheep: { amp: 0.85, bob: 1.6, stride: 1.1, roll: 0.02, pitch: 0.03, nod: 1, head: 0, tail: 0 },
    deer: { amp: 1.1, bob: 1.3, stride: 0.95, roll: 0.01, pitch: 0.05, nod: 1, head: -0.15, tail: 0.3 },
    rabbit: { amp: 1, bob: 1, stride: 1, roll: 0, pitch: 0.2, nod: 0.5, head: 0, tail: 0 },
    chicken: { amp: 1, bob: 1, stride: 1.2, roll: 0.03, pitch: 0, nod: 0, head: 0, tail: 0 },
    bird: { amp: 1, bob: 1, stride: 1.2, roll: 0, pitch: 0, nod: 0, head: 0, tail: 0 },
    penguin: { amp: 0.7, bob: 0.5, stride: 1, roll: 0.2, pitch: 0, nod: 0, head: 0, tail: 0 },
    dino: { amp: 0.8, bob: 1, stride: 0.7, roll: 0.03, pitch: 0.04, nod: 0.3, head: 0, tail: 0 },
    fish: { amp: 0, bob: 0, stride: 1, roll: 0, pitch: 0, nod: 0, head: 0, tail: 0 },
  };
  const PLAIN = { amp: 1, bob: 1, stride: 1, roll: 0, pitch: 0, nod: 1, head: 0, tail: 0 };
  // Where each leg is in the cycle (in turns), [front left, front right, rear left, rear right].
  const OFFS = {
    walk: [0.25, 0.75, 0, 0.5], // a four-beat walk: one foot at a time
    trot: [0, 0.5, 0.5, 0], // diagonal pairs
    gallop: [0.45, 0.53, 0, 0.08], // the rears push, then the fronts reach
    bound: [0, 0, 0.3, 0.3], // a hop: the fronts together, the rears together
  };
  // The idle events: one now and then, in a gap of seconds apart, lasting `dur`.
  const EVENTS = { stretch: [2.8, 7, 14], fluff: [1.1, 5, 11], paw: [1.8, 6, 12], chew: [0.9, 4, 9], alert: [2.6, 5, 10], roar: [1.8, 8, 16], twitch: [1.8, 4, 8], sniff: [0.01, 1e9, 1e9], pant: [0.01, 1e9, 1e9], sway: [0.01, 1e9, 1e9] };

  const wrap = (v) => { while (v > Math.PI) v -= TAU; while (v < -Math.PI) v += TAU; return v; };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function state(rig, a) {
    if (a.d) return a.d;
    const d = (a.d = {
      off: OFFS.walk.map((v) => v * TAU), idleW: 0, exert: 0, ev: null, gap: rnd(2, 6), blinkIn: rnd(1, 4), bl: 0, dbl: false, sleepC: 0,
      lx: 0, ly: 0, tp: Math.random() * 6, tRate: 1.5, tAmp: 0.18, tipY: { p: 0, v: 0 }, tipX: { p: 0, v: 0 }, jerk: 0, jerkIn: rnd(0.5, 1.5), hy: 0, hyT: 0, peck: 0,
      speedPrev: 0, dyPrev: 0, headPrev: 0, hyPrev: 0, flick: [rnd(2, 6), rnd(2, 6)], flickT: [0, 0], lookW: 0,
    });
    return d;
  }

  function drive(rig, a, c) {
    const dt = Math.min(0.25, Math.max(1e-4, c.dt)), sp = c.sp || rig.sp || {}, s = rig.size || 1, G = GAITS[sp.gait] || PLAIN;
    const d = state(rig, a), t = a.t || 0, st = c.state || 'idle';
    const speed = c.speed || 0, moving = speed > 0.15, plan = rig.plan;
    const k = Math.min(1, dt * 8);
    const lie = a.lie || 0, eat = a.eat || 0;
    const f = { headX: 0, headY: 0, headZ: 0, front: 0, rear: 0, pitch: 0, roll: 0, dy: 0, tongue: 0, puff: 0, breath: 0, wingOut: 0, perk: 0, tailUp: 0, tailYaw: 0, tr: null, ta: null, close: 0, nose: 1, paw: 0 };

    // ---- the cycle
    const strideBase = plan === 'quad' ? 2.2 : 3.2;
    a.phase = (a.phase || 0) + dt * (moving ? (speed / Math.max(0.2, s)) * strideBase * G.stride + 1 : st === 'dance' ? 7 : 0);
    const ph = a.phase;
    const rel = speed / Math.max(0.4, sp.walk || 1);
    const mode = sp.hops ? 'bound' : rel < 1.5 ? 'walk' : rel < 2.8 ? 'trot' : 'gallop';
    const gal = moving && mode === 'gallop';
    d.exert = clamp(d.exert + (moving && rel > 1.8 ? dt * 0.5 : -dt * 0.12), 0, 1);

    // ---- idle: a weight for standing still, and the event of this species now and then
    d.idleW = lerp(d.idleW, st === 'idle' && !moving ? 1 : 0, Math.min(1, dt * 2.5));
    const w = d.idleW;
    const idle = sp.idle || '';
    let env = 0, p = 0;
    if (d.ev) {
      d.ev.t += dt; p = d.ev.t / d.ev.dur;
      if (p >= 1 || w < 0.3) { d.ev = null; d.gap = rnd(EVENTS[idle][1], EVENTS[idle][2]); }
      else env = Math.pow(Math.sin(p * Math.PI), 0.6);
    } else if (w > 0.8 && EVENTS[idle] && EVENTS[idle][1] < 1e8) {
      d.gap -= dt;
      if (d.gap <= 0) d.ev = { t: 0, dur: EVENTS[idle][0] * rnd(0.85, 1.2) };
    }
    switch (idle) {
      case 'stretch': // a cat: bows with its front legs far out and its tail up, then rises
        f.pitch += 0.34 * env; f.front -= 1.0 * env; f.rear += 0.2 * env; f.headX -= 0.75 * env; f.tailUp += 0.6 * env; f.close = Math.max(f.close, 0.8 * env);
        f.tr = 1.3; f.ta = 0.4; break;
      case 'pant': { // a dog: tongue out, chest going, and its tail wagging even when it's only standing
        const pantW = Math.max(w * (sp.gait === 'dog' ? 0.8 : 0.35), d.exert);
        f.tongue = pantW * (0.7 + 0.3 * Math.sin(t * 13)); f.breath += 0.035 * pantW * Math.sin(t * 13);
        f.headX -= 0.08 * w; f.roll += sp.gait === 'dog' ? Math.sin(t * 11) * 0.03 * w : 0;
        if (sp.gait === 'dog' && w > 0.05) { f.tr = 11; f.ta = 0.72 * w + 0.18 * (1 - w); }
        break;
      }
      case 'fluff': // a bird: ruffles up and shakes, now and then
        f.puff += 0.15 * env; f.roll += Math.sin(t * 48) * 0.07 * env; f.wingOut += (rig.wings && rig.wings[0] && rig.wings[0].upright ? 0.9 : 0.45) * env; f.headX += 0.3 * env;
        if (plan === 'bird' && !sp.upright && !sp.dino) {
          // Looks about in jerks, and pecks.
          d.jerkIn -= dt;
          if (d.jerkIn <= 0) { d.jerkIn = rnd(0.7, 1.8); d.hyT = (Math.random() - 0.5) * 1.3; if (Math.random() < 0.3) d.peck = 1; }
          d.hy = lerp(d.hy, d.hyT, Math.min(1, dt * 14)); d.peck = Math.max(0, d.peck - dt * 3.5);
          f.headY += d.hy * w; f.headX += Math.sin(clamp(d.peck, 0, 1) * Math.PI) * 0.9 * w;
        } else if (sp.upright) { f.roll += Math.sin(t * 1.6) * 0.05 * w; f.headY += Math.sin(t * 0.6) * 0.3 * w; }
        break;
      case 'chew': // a cow or a sheep: chews, flicks its tail
        f.headX += 0.12 * w; f.headY += Math.sin(t * 5.5) * 0.035 * w; if (env) f.tailYaw += Math.sin(p * TAU * 3) * 0.9 * env;
        break;
      case 'sniff': // a pig: snout down, nose going
        f.headX += (0.28 + Math.sin(t * 9) * 0.07) * w; f.nose = 1 + 0.2 * Math.sin(t * 14) * w; f.tr = 3; f.ta = 0.25 * w;
        break;
      case 'paw': // a horse: paws the ground with a front hoof, tail swishing
        f.paw = env; f.headX += (0.35 + Math.sin(t * 9) * 0.1) * env; f.tr = 2.2; f.ta = 0.38 * w + 0.18 * (1 - w); f.pitch += 0.03 * env;
        break;
      case 'alert': // a deer: head up, ears forward, frozen, tail up
        f.headX -= 0.4 * env; f.perk += env; f.tailUp += 0.5 * env; break;
      case 'sway': // a bear: swings its big head from side to side, rocking
        f.headY += Math.sin(t * 0.8) * 0.35 * w; f.headX += (0.1 + Math.sin(t * 0.5) * 0.08) * w; f.roll += Math.sin(t * 0.8) * 0.03 * w; break;
      case 'twitch': // a rabbit: nose and ears going, sits up now and then
        f.headX += Math.sin(t * 14) * 0.03 * w; f.perk += (0.4 + 0.4 * Math.sin(t * 0.7)) * w + env; f.pitch -= 0.45 * env; break;
      case 'roar': // a dinosaur: head sweeps, tail sways, and now and then it lifts its head and roars
        f.headY += Math.sin(t * 0.45) * 0.5 * w; f.tailYaw += Math.sin(t * 0.7) * 0.3 * w; f.breath += 0.02 * w;
        f.headX -= 0.55 * env; f.headX += Math.sin(t * 30) * 0.04 * env; f.puff += 0.06 * env; f.pitch -= 0.08 * env; break;
    }
    // Breathing: always on, never a still frame.
    const br = Math.sin(t * TAU / 3.2);
    if (rig.torso) {
      const base = rig.torsoBase, sy = 1 + 0.025 * br + f.puff + f.breath, sxz = 1 - 0.0125 * br + f.puff * 0.8;
      rig.torso.scaling.set(base.x * sxz, base.y * sy, base.z * sxz);
    }

    // ---- legs and the body's motion
    if (plan === 'quad') {
      const target = OFFS[mode];
      const kk = Math.min(1, dt * 4);
      const swing = (moving ? Math.min(gal ? 1.05 : 0.75, 0.25 + speed * 0.09) : 0) * G.amp;
      const pl = sp.hops ? ph * 0.5 : ph;
      for (const h of rig.hips) {
        d.off[h.idx] = lerp(d.off[h.idx], target[h.idx] * TAU, kk);
        const fold = lie * (h.front ? -1.35 : 1.35);
        let x = Math.sin(pl + d.off[h.idx]) * swing + fold + (h.front ? f.front : f.rear);
        if (h.idx === 1) x -= f.paw * (0.5 + 0.5 * Math.sin(t * 9)) * 0.9; // the front right paws
        h.n.rotation.x = lerp(h.n.rotation.x, x, k);
      }
      if (moving) {
        f.dy += gal ? (0.5 + 0.5 * Math.sin(ph + 0.4)) * 0.07 * s * G.bob : Math.abs(Math.sin(ph)) * 0.035 * s * G.bob;
        f.pitch += Math.sin(ph + 1.2) * G.pitch * (gal ? 3 : 1) * (sp.hops ? 0 : 1);
        f.roll += Math.sin(ph) * G.roll * (gal ? 0.4 : 1);
        if (sp.hops) { f.dy += Math.abs(Math.sin(pl)) * 0.18 * s; f.pitch -= Math.cos(pl) * G.pitch; }
        f.headX += Math.sin(ph * 2) * 0.06 * G.nod + G.head;
        f.tailUp += G.tail;
      }
    } else if (plan === 'bird') {
      const hop = sp.flies && moving;
      const swing = moving ? Math.min(0.75, 0.25 + speed * 0.09) * G.amp : 0;
      for (const h of rig.hips) {
        const fold = lie * 0.9;
        h.n.rotation.x = lerp(h.n.rotation.x, Math.sin(ph + (hop ? 0 : h.ph)) * swing + fold, k);
      }
      if (moving) {
        if (sp.upright) { f.roll += Math.sin(ph) * G.roll; f.dy += Math.abs(Math.sin(ph)) * 0.03 * s; f.wingOut += 0.25 + 0.2 * Math.abs(Math.sin(ph)); }
        else if (sp.dino) { f.roll += Math.sin(ph) * G.roll; f.pitch += Math.sin(ph * 2) * G.pitch; f.dy -= Math.abs(Math.sin(ph)) * 0.04 * s; f.headX -= Math.sin(ph * 2) * G.pitch * 0.8; f.tailYaw -= Math.sin(ph) * 0.22; }
        else if (hop) f.dy += Math.abs(Math.sin(ph * 0.5)) * 0.06 * s;
        else { f.roll += Math.sin(ph) * G.roll; f.dy += Math.abs(Math.sin(ph)) * 0.03 * s; }
      }
      // A chicken keeps its head still in the air and thrusts it forward on each step.
      if (rig.head && rig.headPos && !sp.upright && !sp.dino) rig.head.position.z = lerp(rig.head.position.z, rig.headPos.z + (moving ? Math.sin(ph - 0.6) * 0.045 * s * 1.0 : 0), k);
    } else if (plan === 'fish' && rig.torso) {
      rig.torso.rotation.y = Math.sin(d.tp * 0.5 - 0.8) * (c.inWater ? 0.1 : 0.25); // the body waves behind the tail
    }
    if (st === 'dance') f.dy += Math.abs(Math.sin(t * 7)) * 0.12 * s;
    if (st === 'cheer') f.dy += Math.max(0, Math.sin(t * 9)) * 0.25 * s;
    f.dy -= lie * ((sp.legH || 0) * s * 0.85);
    const fxOut = (rig.fx = rig.fx || { dy: 0, pitch: 0, roll: 0 });
    fxOut.dy = f.dy; fxOut.pitch = f.pitch; fxOut.roll = f.roll;

    // ---- arms (a dinosaur's), wings
    for (const ar of rig.arms) {
      let x = -Math.sin(ph + ar.ph) * (moving ? 0.5 : 0) * 0.8;
      if (st === 'cheer') x = -2.9; else if (st === 'dance') x = -1.6 + Math.sin(t * 7 + ar.ph) * 0.9; else if (st === 'attack') x = -1.5 + Math.sin(t * 14) * 0.5;
      ar.n.rotation.x = lerp(ar.n.rotation.x, x, k);
    }
    const flapping = st === 'fly' || (st === 'run' && plan === 'bird') || st === 'cheer' || c.flying;
    a.flap = (a.flap || 0) + dt * (flapping ? (c.flying ? 22 : 16) : 0);
    for (const wg of rig.wings) {
      const fl = flapping ? Math.sin(a.flap) * (wg.upright ? 0.7 : 0.9) : 0;
      if (wg.upright) wg.n.rotation.z = lerp(wg.n.rotation.z, wg.side * (0.15 + Math.abs(fl) + f.wingOut), k);
      else wg.n.rotation.z = lerp(wg.n.rotation.z, wg.side * (fl + f.wingOut * 0.7), Math.min(1, dt * 20));
    }

    // ---- looking: the head follows what the animal watches (when it stands, close by), the pupils follow more
    const look = c.look;
    d.lookW = lerp(d.lookW, look && look.near > 0 && (st === 'idle' || st === 'sit') ? look.near : 0, Math.min(1, dt * 3));
    const hy0 = rig.head ? rig.head.rotation.y : 0;
    if (rig.head) {
      const wander = !moving && st === 'idle' ? Math.sin(t * 0.7 + (c.seed || 0)) * 0.5 * (1 - d.lookW) : 0;
      const watch = look ? clamp(look.yaw, -0.9, 0.9) * 0.4 * d.lookW : 0;
      const peck = plan === 'bird' && st === 'eat' ? Math.max(0, Math.sin(t * 6)) * 0.9 : 0;
      const nod = lerp(rig.head.rotation.x, rig.headBase + f.headX + eat * (plan === 'quad' ? 0.95 : 0.5) + peck + lie * 0.35 - (st === 'cheer' ? 0.3 : 0), k);
      rig.head.rotation.x = nod;
      rig.head.rotation.y = lerp(hy0, wander + watch + f.headY + (st === 'dance' ? Math.sin(t * 3.5) * 0.4 : 0), Math.min(1, dt * 3));
      rig.head.rotation.z = lerp(rig.head.rotation.z, f.headZ + (look ? clamp(look.pitch, -0.5, 0.5) * 0 : 0), k);
    }
    if (rig.nose) rig.nose.scaling.y = lerp(rig.nose.scaling.y, (rig.noseY || (rig.noseY = rig.nose.scaling.y)) * f.nose, k);
    if (rig.tongue) {
      const on = f.tongue > 0.08 && lie < 0.5;
      if (on !== rig.tongue.isEnabled()) rig.tongue.setEnabled(on);
      if (on) { const base = rig.tongueS || (rig.tongueS = rig.tongue.scaling.clone()); rig.tongue.scaling.set(base.x, base.y * (0.4 + f.tongue * 1.8), base.z * (0.6 + f.tongue * 0.7)); }
    }

    // ---- eyes: blink every 2.5 to 6 s (a double one 15% of the time), shut asleep, pupils follow
    if (rig.eyes && rig.eyes.length) {
      d.sleepC = lerp(d.sleepC, st === 'sleep' ? 1 : lie > 0.3 ? 0.6 : 0, Math.min(1, dt * 3));
      d.blinkIn -= dt;
      if (d.blinkIn <= 0 && !d.bl) { d.bl = 1e-4; d.dbl = Math.random() < 0.15; d.blinkIn = rnd(2.5, 6); }
      let shut = 0;
      if (d.bl) {
        d.bl += dt; const q = d.bl / 0.2;
        shut = q < 0.4 ? q / 0.4 : 1 - (q - 0.4) / 0.6;
        if (q >= 1) { d.bl = 0; shut = 0; if (d.dbl) { d.dbl = false; d.blinkIn = 0.12; } }
      }
      shut = Math.max(shut, d.sleepC, f.close);
      const tx = look && d.lookW > 0.05 && Math.abs(look.yaw) < 2.2 ? clamp(Math.sin(look.yaw - hy0), -1, 1) : 0;
      const ty = look && d.lookW > 0.05 ? clamp(look.pitch * 1.5, -1, 1) : 0;
      d.lx = lerp(d.lx, tx, Math.min(1, dt * 10)); d.ly = lerp(d.ly, ty, Math.min(1, dt * 10));
      const sc = 1 - 0.92 * shut;
      for (const e of rig.eyes) {
        if (e.sc !== sc) { e.n.scaling.y = sc; e.sc = sc; }
        e.p.position.x = d.lx * e.r * 0.17; e.p.position.y = d.ly * e.r * 0.13;
      }
    }

    // ---- ears: on springs (they trail the head and the bounce, flick now and then, perk, flatten at a run, droop asleep)
    if (rig.ears && rig.ears.length) {
      const dyV = (f.dy - d.dyPrev) / dt, hv = ((rig.head ? rig.head.rotation.x : 0) - d.headPrev) / dt, yv = wrap((rig.head ? rig.head.rotation.y : 0) - d.hyPrev) / dt;
      const accel = clamp((speed - d.speedPrev) / dt, -8, 8);
      const droop = clamp(lie * 0.8 + eat * 0.3, 0, 1);
      const run = clamp(speed / Math.max(1, (sp.run || 5) * 0.6), 0, 1);
      for (let i = 0; i < rig.ears.length; i++) {
        const ear = rig.ears[i], back = ear.style === 'floppy' ? 1 : -1;
        d.flick[i] -= dt;
        if (d.flick[i] <= 0) { d.flick[i] = rnd(3, 8); d.flickT[i] = 0.25; }
        let fl = 0;
        if (d.flickT[i] > 0) { fl = Math.sin((1 - d.flickT[i] / 0.25) * Math.PI); d.flickT[i] -= dt; }
        const perk = clamp(f.perk, 0, 1);
        let tx = back * (run * 0.45 + accel * 0.012) - back * 0.25 * perk + clamp(dyV * 0.25, -0.35, 0.35) * -back - hv * 0.04;
        let tz = ear.z0 * (1 - 0.6 * perk) - ear.side * (fl * 0.55 + clamp(yv * 0.06, -0.3, 0.3));
        if (ear.style === 'long') tz = lerp(tz, ear.side * 1.15, droop * 0.9);
        else if (ear.style === 'floppy') tz += ear.side * 0.25 * droop;
        else tz += -ear.side * 0.35 * droop;
        ear.n.rotation.x = spring(ear.x, tx, dt, 4, 0.4);
        ear.n.rotation.z = spring(ear.z, tz, dt, 4, 0.4);
      }
      d.dyPrev = f.dy; d.headPrev = rig.head ? rig.head.rotation.x : 0; d.hyPrev = rig.head ? rig.head.rotation.y : 0; d.speedPrev = speed;
    }

    // ---- tail: a wag (fast when happy, frantic for a fish out of water), a sway otherwise; the tip trails the root
    if (rig.tail) {
      const happy = c.happy || st === 'dance' || st === 'cheer';
      let rate = plan === 'fish' ? (c.inWater ? 8 : 22) : happy ? 16 : moving ? 6 : 1.5;
      let amp = plan === 'fish' ? 0.5 : happy ? 0.7 : 0.18;
      if (f.tr != null && !happy && !moving) { rate = f.tr; amp = Math.max(amp, f.ta); }
      d.tRate = lerp(d.tRate, rate, Math.min(1, dt * 4)); d.tAmp = lerp(d.tAmp, amp, Math.min(1, dt * 4));
      d.tp += dt * d.tRate;
      const yaw = Math.sin(d.tp) * d.tAmp + f.tailYaw;
      rig.tail.rotation.y = yaw;
      rig.tail.rotation.x = lerp(rig.tail.rotation.x, rig.tailBase + (st === 'sleep' ? 0.4 : 0) + f.tailUp, k);
      if (rig.tailTip) {
        const dyAcc = clamp(-(f.dy - d.dyPrev) / dt * 0.3, -0.5, 0.5);
        rig.tailTip.rotation.y = spring(d.tipY, yaw * 0.9, dt, 3.2, 0.35) - yaw * 0.5;
        rig.tailTip.rotation.x = spring(d.tipX, (sp.gait === 'cat' ? 0.45 : 0) + dyAcc, dt, 3, 0.4);
      }
    }
    return fxOut;
  }

  /** What an animal looks at: the camera, when it's near (the pupils and then the head turn toward it). */
  function lookAt(rig, e, r) {
    const sc = H.world && H.world.scene, cam = sc && sc.activeCamera;
    if (!cam || !e.node) return null;
    const cp = cam.globalPosition || cam.position, dx = cp.x - e.x, dz = cp.z - e.z, dist = Math.hypot(dx, dz);
    if (dist > 22 || dist < 0.3) return null;
    const q = e.node.rotationQuaternion, yaw = q ? q.toEulerAngles().y : e.node.rotation.y;
    return { yaw: wrap(Math.atan2(dx, dz) - yaw), pitch: Math.atan2(cp.y - (e.y + (rig.height || 1) * 0.8), dist), near: 1 - dist / 22 };
  }

  living.drive = drive;
  living.lookAt = lookAt;
  living.GAITS = GAITS;
})();
