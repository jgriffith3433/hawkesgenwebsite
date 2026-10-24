// Juice: the feel of hits. Hit-stop (the world freezes for a few hundredths of a second on big hits and kills),
// slow motion on huge blasts (H.slow), screen shake that is stronger closer and bigger (every game.camera.shake goes
// through it, so "reduce motion" turns all of it down), a screen flash for close blasts, controller rumble and phone
// vibration, and the camera: the view widens at speed, dips when you land, bobs if asked, kicks up when a gun fires.
//   H.juice.hitStop(seconds)  H.juice.slowmo(scale, seconds)  H.juice.shake(amount, { at })  H.juice.flash(k)
//   H.juice.rumble(strong, weak, ms)  H.juice.recoil(amount)  H.juice.feel.on('land', fn)
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = H.juiceMath;
  const J = H.juice;
  const W = () => H.world;
  const G = () => H.game;
  const clamp = M.clamp;
  const online = () => Boolean(H.sync && H.sync.online);
  // Time for hit-stop and slow motion runs with the frames (real time in a browser; the seconds asked for in H.tick).
  let clockT = 0, lastWall = 0;
  const realNow = () => clockT;
  // Only while the world is being drawn (a real game page): tests and tools stepping a world with H.tick never stop
  // or slow it unless they ask (H.juice.feel.always = true).
  let drawnAt = -1e9;
  const drawing = () => J.feel.always || clockT - drawnAt < 0.5;
  const shareOwns = () => Boolean(H.share && H.share.cameraOwner);
  // The codex (/entities) shows things live: no freezing, slowing, shaking or flashing there.
  const codex = () => Boolean(H.hooks.codex);

  const listeners = { land: [], hitstop: [], slowmo: [] };
  const emit = (n, d) => { for (const f of listeners[n]) try { f(d); } catch (err) { H.report(err, 'juice'); } };

  // ------------------------------------------------------------------ hit-stop and slow motion (playing alone)
  // Online the world never stops: everyone's simulation would fall out of step. Shake and flashes still play.
  const stop = { until: 0, cool: 0 };
  const slo = { until: 0, ease: 0.3, scale: 1 };
  /** Freezes the world for `seconds` (at most 0.15). Only playing alone, never while building. */
  function hitStop(seconds) {
    const s = clamp(Number(seconds) || 0, 0, 0.15);
    if (!s || codex() || !J.allowed('hitstop') || online() || H.mode === 'build' || !W() || !drawing()) return false;
    // (One beat: hits right after one, a car grinding along a wall, don't freeze it again and again.)
    if (realNow() < (stop.cool || 0) && !stop.until) return false;
    stop.until = Math.max(stop.until, realNow() + s);
    stop.cool = stop.until + 0.4;
    H.slow('juice:hitstop', 0);
    J.feel.hitstops++;
    emit('hitstop', { seconds: s });
    return true;
  }
  /** Slows time to `scale` for `seconds` (real seconds), easing back. Only playing alone. */
  function slowmo(scale = 0.3, seconds = 1) {
    if (codex() || !J.allowed('slowmo') || online() || H.mode === 'build' || !W() || !drawing()) return false;
    slo.scale = clamp(Number(scale) || 0.3, 0.05, 0.95);
    slo.until = realNow() + clamp(Number(seconds) || 1, 0.1, 6);
    H.slow('juice:slowmo', slo.scale);
    J.feel.slowmos++;
    emit('slowmo', { scale: slo.scale, seconds });
    return true;
  }
  function runTime() {
    const t = realNow();
    if (stop.until && t >= stop.until) { stop.until = 0; H.slow('juice:hitstop', null); }
    if (slo.until) {
      if (t >= slo.until + slo.ease) { slo.until = 0; H.slow('juice:slowmo', null); }
      else if (t > slo.until) { const k = (t - slo.until) / slo.ease; H.slow('juice:slowmo', slo.scale + (1 - slo.scale) * k * k); }
    }
  }

  // ------------------------------------------------------------------ shake: trauma that decays; what you feel is trauma²
  const shk = { trauma: 0, t: 0 };
  /** Adds shake (0-1). o: { at: a point (less the farther it is), radius }. */
  function shake(amount, o = {}) {
    let k = Number(amount) || 0;
    if (o.at) { const c = camPos(); if (c) k *= clamp(1.3 - Math.hypot(o.at[0] - c.x, o.at[1] - c.y, o.at[2] - c.z) / (o.reach || 30), 0, 1); }
    if (k <= 0.005) return 0;
    shk.trauma = M.traumaAdd(shk.trauma, k);
    return shk.trauma;
  }
  const camPos = () => { const w = W(); const c = w && w.scene && w.scene.activeCamera; return c ? c.globalPosition || c.position : null; };
  // game.camera.shake(strength, seconds) (the engine's, every module's, scripts'): into the trauma. Short ones while
  // holding a tool are a gun going off: a recoil kick too.
  H.hooks.game.push((g, w) => {
    const api = w && w.camera && w.camera.api;
    if (!api) return;
    api.shake = (strength = 0.3, seconds = 0.3) => {
      const s = Number(strength) || 0, sec = Number(seconds) || 0.3;
      if (sec <= 0.13 && H.tools && H.tools.held) recoil(s * 2.2);
      // Strength is meters of jitter in the old shake (0.1 a tap, 0.6 a big crash): as trauma.
      shk.trauma = Math.max(shk.trauma, clamp(s * 1.25 * Math.min(1.5, 0.6 + sec * 1.4), 0, 1));
      return api;
    };
  });

  // ------------------------------------------------------------------ the flash (close blasts)
  let flashEl = null, flashK = 0;
  function flash(k = 0.6, color = '255,214,160') {
    if (codex() || !J.allowed('flash')) return;
    const v = clamp(k * (Number(J.settings.flash) || 1) * (J.reduceMotion ? 0.3 : 1), 0, 0.85);
    if (v < 0.03 || typeof document === 'undefined') return;
    if (!flashEl || !flashEl.isConnected) {
      flashEl = document.createElement('div');
      flashEl.className = 'juice-flash';
      flashEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;opacity:0;mix-blend-mode:screen;';
      (document.getElementById('ui') || document.body).appendChild(flashEl);
    }
    flashEl.style.background = `radial-gradient(ellipse at center, rgba(${color},1) 0%, rgba(${color},.55) 45%, rgba(${color},0) 80%)`;
    flashK = Math.max(flashK, v);
  }
  function runFlash(dt) {
    if (!flashEl) return;
    flashK = Math.max(0, flashK - dt * 3.2);
    flashEl.style.opacity = String(flashK.toFixed(3));
  }

  // ------------------------------------------------------------------ rumble: controllers and phones
  let rumbleAt = 0;
  function rumble(strong = 0.5, weak = 0.5, ms = 120) {
    if (codex() || !J.allowed('rumble')) return false;
    const t = realNow();
    if (t - rumbleAt < 0.06) return false;
    rumbleAt = t;
    J.feel.rumbles++;
    try {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected && p.vibrationActuator) : [];
      for (const p of pads) p.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch(() => {});
      if (!pads.length && H.touchUi && navigator.vibrate && strong > 0.35) navigator.vibrate(Math.round(clamp(ms * strong, 10, 200)));
    } catch { /* no rumble here */ }
    return true;
  }

  // ------------------------------------------------------------------ explosions, kills and crashes
  H.physics.on('explosion', (d) => {
    const w = W();
    if (!w || !J.on) return;
    const at = d.position, R = Number(d.radius) || 4.5, F = Number(d.force ?? 14);
    const boom = Math.max(0.1, Number(J.settings.boom) || 1);
    const c = camPos();
    const dist = c ? Math.hypot(at[0] - c.x, at[1] - c.y, at[2] - c.z) : 0;
    const k = M.blastShake(R * boom, dist, F);
    if (k > 0.01) shake(k);
    if (dist < R * 2.5 * boom) flash(clamp(1 - dist / (R * 2.5 * boom), 0, 1) * 0.7);
    if (k > 0.2) rumble(k, k * 0.6, 160 + R * 20);
    // Hit-stop for the close and big; slow motion for the huge (or a chain of them).
    hitStop(M.hitStopFor('blast', k));
    const sm = M.slowmoFor(R * boom, d.chain || 0, { big: Number(J.settings.slowmoRadius) || 10, scale: J.settings.slowmoScale, seconds: J.settings.slowmoSeconds });
    if (sm && dist < R * 6 + 20) slowmo(sm.scale, sm.seconds);
    // A punch of the field of view (the shockwave reaching you).
    fov.punch = Math.max(fov.punch, k * 0.08);
  });
  // Kills you made: a beat of hit-stop. Big crashes: hit-stop in the vehicle you're in, sparks are juice-fx.js's.
  H.hooks.world.push({
    enter() {
      const g = G();
      g.on('kill', () => { hitStop(M.hitStopFor('kill')); rumble(0.4, 0.7, 90); });
    },
    leave() { stop.until = 0; stop.cool = 0; slo.until = 0; H.slow('juice:hitstop', null); H.slow('juice:slowmo', null); shk.trauma = 0; flashK = 0; land.dip = 0; recoilK.v = 0; if (flashEl) flashEl.style.opacity = '0'; },
  });
  const myVehicle = () => (H.vehicles && H.vehicles.current) || null;
  J.sound && J.sound.hits.push(({ a, b, speed, at }) => {
    const veh = a.vehicle ? a : b.vehicle ? b : null;
    if (!veh || speed < 9) return;
    const mine = myVehicle() === veh;
    const k = clamp((speed - 8) / 22, 0, 1);
    if (mine) { hitStop(M.hitStopFor('crash', k)); rumble(k, k, 200); shake(k * 0.7); }
    else shake(k * 0.5, { at, reach: 25 });
  });

  // ------------------------------------------------------------------ the camera: FOV at speed, landing, bob, recoil
  const fov = { k: 0, punch: 0 };
  const land = { dip: 0, v: 0, air: false, minVy: 0, wasGrounded: true, airT: 0 };
  const bob = { phase: 0, amt: 0 };
  const recoilK = { v: 0 };
  /** Kicks the view up (a gun going off): amount 0-1. */
  function recoil(amount = 0.3) { if (J.allowed('recoil')) recoilK.v = clamp(recoilK.v + amount * 0.035, 0, 0.12); }
  const applied = { cam: null, x: 0, y: 0, z: 0, rx: 0, up: null, fov: 0 };
  let speedT = { last: null, v: 0 };
  function watchPlayer(dt) {
    const p = W() && W().player;
    if (!p || !p.alive || dt <= 0) return;
    const g = Boolean(p.grounded);
    if (!g) { land.airT += dt; land.minVy = Math.min(land.minVy, p.vy); }
    if (g && !land.wasGrounded && land.airT > 0.12 && !p._ragdoll) {
      const hit = -land.minVy;
      if (hit > 4) {
        const k = clamp((hit - 4) / 16, 0, 1);
        if (J.allowed('landing')) land.v -= k * 2.2;
        if (k > 0.45) { shake(k * 0.35); rumble(k * 0.7, k * 0.4, 110); }
        const surface = (() => { try { const on = p.standing && p.standing.alive ? p.standing : null; return on ? M.surfaceOf(on, [p.x, p.bottom, p.z]) : 'dirt'; } catch { return 'dirt'; } })();
        if (J.sound) J.sound.footstep(surface, { mine: true, loudness: clamp(0.3 + k * 0.7, 0.3, 1), pitch: 0.8 - k * 0.2, key: 'land' });
        if (k > 0.15 && J.sound) J.sound.play({ material: M.SURFACES.includes(surface) && !M.MATERIALS.includes(surface) ? 'dirt' : surface, loudness: 0.25 + k * 0.6, size: k > 0.6 ? 'crash' : 'knock', mine: true, key: 'land-thud', gap: 0.3, weight: 1.5 });
        emit('land', { speed: hit, surface, entity: p });
      }
    }
    if (g) { land.airT = 0; land.minVy = 0; }
    land.wasGrounded = g;
  }
  function runCamera(dt, render) {
    const w = W();
    if (!w || !w.scene) return;
    const cam = w.scene.activeCamera;
    // How fast the camera moves (wind, the FOV kick).
    if (cam) {
      const p = cam.globalPosition || cam.position;
      if (speedT.last && dt > 0) { const v = B.Vector3.Distance(p, speedT.last) / dt; speedT.v += (Math.min(v, 200) - speedT.v) * Math.min(1, dt * 4); }
      speedT.last = p.clone();
      J.feel.camSpeed = speedT.v;
    }
    shk.trauma = M.traumaDecay(shk.trauma, dt);
    shk.t += dt;
    // The landing dip: a spring pulled down, back up.
    land.v += (-land.dip * 60 - land.v * 9) * dt;
    land.dip = clamp(land.dip + land.v * dt, -0.45, 0.2);
    recoilK.v = Math.max(0, recoilK.v - dt * recoilK.v * 9 - dt * 0.01);
    fov.punch = Math.max(0, fov.punch - dt * 0.4);
    if (!render || !cam || shareOwns() || codex() || !cam.position || !cam.rotation) return;
    if (applied.cam) undo(); // (last frame's was never drawn: off before adding this one's)
    if (J.feel.cameraOverride) { try { J.feel.cameraOverride(cam, dt); } catch (err) { H.report(err, 'juice camera'); } }
    const motion = J.motion;
    const p = w.player;
    const ours = cam === (w.camera && w.camera.api && w.camera.api.babylon);
    const driving = p && p.controller === 'drive';
    // Speed (walking, flying, falling): a little wider. Vehicles widen their own view.
    let wantFov = 0;
    if (J.allowed('fov') && p && p.alive && !driving && ours) {
      const sp = Math.hypot(p.vx, p.vy * 0.5, p.vz);
      wantFov = clamp((sp - 8) / 40, 0, 0.14);
    }
    fov.k += (wantFov - fov.k) * Math.min(1, dt * 3);
    // Head bob (config.juice.bob): first person, walking on the ground.
    if (J.allowed('bob') && p && p.grounded && ours && w.camera.mode === 'fps') {
      const sp = Math.hypot(p.vx, p.vz);
      bob.amt += ((sp > 1 ? clamp(sp / 8, 0, 1) : 0) - bob.amt) * Math.min(1, dt * 8);
      bob.phase += dt * clamp(sp, 0, 12) * 1.25;
    } else bob.amt += (0 - bob.amt) * Math.min(1, dt * 8);
    // Shake: smooth noise (sums of sines), position and a little roll.
    const s = shk.trauma * shk.trauma * (Number(J.settings.shake) ?? 1) * motion;
    const t = shk.t;
    const n = (f, ph) => Math.sin(t * f + ph) * 0.6 + Math.sin(t * f * 2.13 + ph * 1.7) * 0.4;
    const dx = s * 0.38 * n(31, 0.3) + bob.amt * motion * Math.sin(bob.phase) * 0.025;
    const dy = s * 0.32 * n(27, 1.9) + (J.allowed('landing') ? land.dip * motion : 0) + bob.amt * motion * Math.abs(Math.cos(bob.phase)) * 0.04;
    const dz = s * 0.2 * n(23, 3.1);
    const rz = s * 0.05 * n(17, 4.2) + bob.amt * motion * Math.sin(bob.phase) * 0.004;
    const rx = -recoilK.v * motion + s * 0.02 * n(19, 5.3);
    const df = (fov.k + fov.punch) * motion;
    if (!dx && !dy && !dz && !rx && !rz && !df) return;
    cam.position.x += dx; cam.position.y += dy; cam.position.z += dz;
    cam.rotation.x += rx;
    // The roll tilts the up vector about the view, never rotation.z: Babylon turns its up vector with rotation.z
    // whenever that changes and keeps it, so a roll put back still left the view dutch once you looked around.
    const up = rz && cam.upVector ? cam.upVector.clone() : null;
    if (up) {
      const f = new B.Vector3(Math.sin(cam.rotation.y) * Math.cos(cam.rotation.x), -Math.sin(cam.rotation.x), Math.cos(cam.rotation.y) * Math.cos(cam.rotation.x));
      cam.upVector = up.rotateByQuaternionToRef(B.Quaternion.RotationAxis(f, rz), new B.Vector3());
    }
    if (typeof cam.fov === 'number') cam.fov += df;
    Object.assign(applied, { cam, x: dx, y: dy, z: dz, rx, up, fov: df });
  }
  // What was added for this frame's picture comes off again after it's drawn: the engine's camera (and vehicles' chase
  // camera, which eases from where it was) keeps its own state.
  function undo() {
    const a = applied;
    if (!a.cam) return;
    try {
      a.cam.position.x -= a.x; a.cam.position.y -= a.y; a.cam.position.z -= a.z;
      a.cam.rotation.x -= a.rx;
      if (a.up) a.cam.upVector = a.up;
      if (typeof a.cam.fov === 'number') a.cam.fov -= a.fov;
    } catch { /* gone */ }
    a.cam = null;
  }
  H.hooks.scene.push((scene) => { scene.onAfterRenderObservable.add(undo); });

  H.hooks.step.push((dt) => { if (W()) watchPlayer(dt); });
  H.hooks.frame.push((dt, render) => {
    if (!W()) return;
    // (Drawn frames: the wall clock, so a slow frame doesn't stretch a hit-stop. H.tick: the seconds asked for.)
    const wall = performance.now() / 1000;
    clockT += render && lastWall ? Math.min(1, Math.max(0, wall - lastWall)) : dt;
    lastWall = render ? wall : 0;
    if (render) drawnAt = clockT;
    try { runTime(); runFlash(dt); runCamera(dt, render); } catch (err) { H.report(err, 'juice feel'); }
  });

  J.hitStop = hitStop;
  J.slowmo = slowmo;
  J.shake = shake;
  J.flash = flash;
  J.rumble = rumble;
  J.recoil = recoil;
  J.feel = {
    on(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); return () => { const l = listeners[name]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; },
    get trauma() { return shk.trauma; },
    get stopped() { return Boolean(stop.until); },
    get slowed() { return Boolean(slo.until); },
    get dip() { return land.dip; },
    always: false, camSpeed: 0, hitstops: 0, slowmos: 0, rumbles: 0,
    cameraOverride: null,
    myVehicle,
  };
})();
