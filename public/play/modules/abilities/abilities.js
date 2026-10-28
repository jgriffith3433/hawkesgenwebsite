// Abilities (J, 2026-10-27: "players can do anything"): small things any thing can do, stacked on it as behaviors
// (scene.json behaviors: [{ use: 'drivable' }, { use: 'teleport', to: 'Tower' }]). A couch that drives, a crate you can
// sit in, a teapot that flies, a rock that's a teleporter, a lever that opens the castle gate. They work everywhere: in a
// game being played, while building, and on the island. Each has a settings description (`settings`: what the build
// card draws as controls, and what WORLD.md lists) so anything is tweakable without code.
//   Riding: seat (sit on it), drivable (sit and drive it), flyable (sit and fly it)
//   Hands: holdable (pick it up with E, throw it with a click or F)
//   Moving you: teleport (to a thing or a place), boost (a speed pad that pushes you its way), cannon (E: fired out of it),
//               gravity (a zone of low or no gravity)
//   Signals: button (E: a pulse), lever (E: on/off), plate (on while someone stands on it); door / opens answer a signal,
//            shows (appears or vanishes on a signal: secret walls, bridges)
//   Games: hill (king of the hill: points for every second you hold it, the top three shown)
// H.signals: get(name), set(name, on), toggle(name), pulse(name, seconds), list(): shared online (the host decides; late
// joiners get them), and every change is game.on('signal', { name, on }) (rules: "when": { "signal": "gate" }).
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const W = () => H.world;
  const G = () => H.game;
  const RAD = Math.PI / 180;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const def = (names, d) => { for (const n of [].concat(names)) H.behavior(n, d); };
  const me = () => { const w = W(); return w && w.player && w.player.alive ? w.player : null; };
  const nameOf = (e) => e.name || e.sceneId || 'it';
  /** Is point p inside thing e's box (turned with it round y)? */
  function inside(e, p, pad = 0) {
    const a = -e.node.rotation.y, dx = p[0] - e.x, dz = p[2] - e.z;
    const lx = dx * Math.cos(a) - dz * Math.sin(a), lz = dx * Math.sin(a) + dz * Math.cos(a);
    return Math.abs(lx) <= e.half[0] + pad && Math.abs(p[1] - e.y) <= e.half[1] + pad + 0.9 && Math.abs(lz) <= e.half[2] + pad;
  }
  /** The thing a word names: an id, a name, or the nearest with that tag. */
  function find(word, from) {
    const w = W();
    if (!w || !word) return null;
    if (Array.isArray(word)) return { position: word };
    const s = String(word);
    const byId = w.byId.get(s);
    if (byId) return byId;
    const low = s.toLowerCase();
    let best = null, bd = Infinity;
    for (const e of w.entities) {
      if (!e.alive || e === from || e.isPlayer) continue;
      if (String(e.name || '').toLowerCase() !== low && String(e.tag || (e.data && e.data.tag) || '').toLowerCase() !== low) continue;
      const d = from ? Math.hypot(e.x - from.x, e.z - from.z) : 0;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // ------------------------------------------------------------------ signals: things telling each other
  const sig = new Map();
  const listeners = new Set();
  function setLocal(name, on) {
    const n = String(name), v = Boolean(on);
    if (sig.get(n) === v) return;
    sig.set(n, v);
    for (const f of listeners) try { f(n, v); } catch (err) { H.report(err, 'signals'); }
    try { const g = G(); if (g && g.emit) g.emit('signal', { name: n, on: v }); } catch (err) { H.report(err, 'signals'); }
  }
  const signalAct = H.sync && H.sync.action ? H.sync.action('_signal', (d) => { if (d && d.n) setLocal(d.n, d.v); }) : (d) => setLocal(d.n, d.v);
  if (H.sync && H.sync.state) {
    try {
      H.sync.state('signals', {
        get: () => Object.fromEntries(sig),
        set: (copy) => { for (const [k, v] of Object.entries(copy || {})) setLocal(k, v); },
        rate: 2,
      });
    } catch (err) { H.report(err, 'signals'); }
  }
  const pulses = new Map();
  H.signals = {
    get: (name) => Boolean(sig.get(String(name))),
    set: (name, on = true) => { if (name) signalAct({ n: String(name), v: Boolean(on) }); },
    toggle: (name) => { if (name) signalAct({ n: String(name), v: !sig.get(String(name)) }); },
    /** On for a moment (a button), then off again. */
    pulse(name, seconds = 1) {
      if (!name) return;
      const n = String(name);
      signalAct({ n, v: true });
      clearTimeout(pulses.get(n));
      pulses.set(n, setTimeout(() => signalAct({ n, v: false }), Math.max(0.1, seconds) * 1000));
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    list: () => Object.fromEntries(sig),
    _reset() { sig.clear(); for (const t of pulses.values()) clearTimeout(t); pulses.clear(); },
  };
  H.hooks.game.push((g) => { g.signal = H.signals; });

  // ------------------------------------------------------------------ E near things: one offer for every ability that has one
  /** Abilities with an E offer register here: fn(thing, behavior, player) -> { label, act, priority?, reach? } | null. */
  const usable = new Map();
  H.use.register('abilities', {
    build: true,
    near(p) {
      const w = W();
      if (!w || riding) return riding ? { label: riding.mode === 'sit' ? `Get up from ${nameOf(riding.e)}` : `Get off ${nameOf(riding.e)}`, act: () => getOff(), priority: 100, distance: 0 } : null;
      if (holding) return { label: `Drop ${nameOf(holding.e)}`, act: () => drop(false), priority: 90, distance: 0 };
      let best = null;
      for (const e of w.entities) {
        if (!e.alive || !e.behaviors.length || e.isPlayer) continue;
        const d = Math.hypot(e.x - p.x, e.y - p.y, e.z - p.z) - Math.max(e.half[0], e.half[2]);
        if (d > 2.6 || (best && d >= best.distance)) continue;
        for (const b of e.behaviors) {
          const f = b.def && usable.get(b.def);
          if (!f) continue;
          const o = f(e, b, p);
          if (o) { best = { ...o, distance: d }; break; }
        }
      }
      return best;
    },
  });

  // ------------------------------------------------------------------ riding: sit, drive, fly
  let riding = null; // { e, mode, b, saved, speed, yaw, vy }
  function getOn(e, mode, b) {
    const p = me(), g = G();
    if (!p || riding) return;
    if (H.sync && H.sync.online && mode !== 'sit' && e.sceneId) {
      const who = H.sync.holder(e);
      if (who && who !== H.sync.me) { g.ui.message('Someone else is at the controls', 1.5); return; }
      H.sync.claim(e, { hold: true });
    }
    riding = { e, mode, b, saved: { physics: p.physics, controls: p.controls, gravity: p.gravity, ePhysics: e.physics, flying: p.flying }, speed: 0, yaw: e.node.rotation.y, vy: 0 };
    p.held = true;
    p.physics = 'trigger';
    p.velocity = [0, 0, 0];
    if (mode !== 'sit') { p.controls = false; if (e.physics === 'dynamic' || e.physics === 'static') e.physics = 'kinematic'; }
    g.ui.message(mode === 'drive' ? `${nameOf(e)}: W/S drive, A/D steer, E gets off` : mode === 'fly' ? `${nameOf(e)}: W/S forward and back, A/D turn, Space up, C down, E gets off` : 'E to get up', 2.6);
    try { g.emit('ride', { thing: e, mode, on: true }); } catch { /* fine */ }
  }
  function getOff() {
    const r = riding;
    if (!r) return;
    riding = null;
    const p = me(), g = G();
    if (p) {
      p.held = false;
      p.physics = r.saved.physics === 'trigger' ? 'dynamic' : r.saved.physics;
      p.controls = r.saved.controls !== false;
      p.gravity = r.saved.gravity;
      const side = [Math.cos(r.e.node.rotation.y), 0, -Math.sin(r.e.node.rotation.y)];
      const out = Math.max(r.e.half[0], r.e.half[2]) + 0.8;
      p.position = [r.e.x + side[0] * out, r.e.y + r.e.half[1] + 0.6, r.e.z + side[2] * out];
      p.velocity = [0, 0, 0];
    }
    if (r.mode !== 'sit' && r.e.alive && r.saved.ePhysics !== r.e.physics) r.e.physics = r.saved.ePhysics === 'static' ? 'static' : r.saved.ePhysics;
    if (H.sync && H.sync.online && r.e.sceneId && r.mode !== 'sit') H.sync.release(r.e);
    try { g.emit('ride', { thing: r.e, mode: r.mode, on: false }); } catch { /* fine */ }
  }
  function groundBelow(x, y, z, e) {
    try { const hit = H.physics.raycast([x, y + 2, z], [0, -1, 0], 60, { ignore: [e, me()].filter(Boolean) }); return hit && hit.point ? hit.point[1] : null; } catch { return null; }
  }
  // Each step: the rider sits on it; a driver or pilot moves it.
  H.hooks.step.push((dt) => {
    const r = riding;
    if (!r) return;
    const p = me(), g = G(), e = r.e;
    if (!p || !e.alive) { riding = null; if (p) { p.held = false; p.physics = 'dynamic'; p.controls = true; } return; }
    const o = r.b.o;
    if (r.mode === 'drive' || r.mode === 'fly') {
      const a = g.input.axis();
      const top = num(o.speed, r.mode === 'fly' ? 18 : 14);
      r.speed += (a.y * top - r.speed) * Math.min(1, dt * (a.y ? 1.6 : 2.4));
      r.yaw += -a.x * num(o.turn, 90) * RAD * dt * (r.mode === 'drive' ? clamp(Math.abs(r.speed) / 4, 0, 1) * Math.sign(r.speed || 1) : 1);
      let x = e.x + Math.sin(r.yaw) * r.speed * dt, z = e.z + Math.cos(r.yaw) * r.speed * dt, y = e.y;
      if (r.mode === 'fly') {
        const up = (g.input.key(' ') || g.input.key('space') ? 1 : 0) - (g.input.key('c') || g.input.key('shift') ? 1 : 0);
        r.vy += (up * num(o.lift, 8) - r.vy) * Math.min(1, dt * 3);
        y += r.vy * dt;
        const gy = groundBelow(x, y, z, e);
        if (gy !== null && y - e.half[1] < gy) y = gy + e.half[1];
      } else {
        const gy = groundBelow(x, y, z, e);
        if (gy !== null) y += (gy + e.half[1] + num(o.hover, 0) - y) * Math.min(1, dt * 10);
      }
      e.node.position.set(x, y, z);
      e.node.rotation.y = r.yaw;
      e.velocity = [0, 0, 0];
      e.wake && e.wake();
    }
    const seat = [e.x, e.y + e.half[1] + num(o.height, 0.5), e.z];
    p.position = seat;
    p.velocity = [0, 0, 0];
    p._seatedAt = W().time;
  });
  const RIDE_SETTINGS = (fly) => [
    { key: 'speed', label: 'Top speed', type: 'number', min: 2, max: 80, step: 1, unit: 'm/s' },
    { key: 'turn', label: 'Turning', type: 'number', min: 20, max: 240, step: 5, unit: '°/s' },
    ...(fly ? [{ key: 'lift', label: 'Climb speed', type: 'number', min: 1, max: 30, step: 1, unit: 'm/s' }] : [{ key: 'hover', label: 'Hover above the ground', type: 'number', min: 0, max: 5, step: 0.1, unit: 'm' }]),
    { key: 'height', label: 'Seat height', type: 'number', min: 0, max: 4, step: 0.1, unit: 'm' },
  ];
  def(['seat', 'sit', 'chair-seat'], {
    title: 'You can sit on it', group: 'Riding', icon: '🪑', says: () => 'you can sit on it (E)',
    defaults: { height: 0.4, label: '' }, settings: [{ key: 'height', label: 'Seat height', type: 'number', min: 0, max: 4, step: 0.1, unit: 'm' }, { key: 'label', label: 'What E says', type: 'text' }],
  });
  def(['drivable', 'drive', 'rideable-vehicle'], {
    title: 'You can drive it', group: 'Riding', icon: '🛞', says: (o) => `you can get on and drive it (${o.speed} m/s)`,
    defaults: { speed: 14, turn: 90, hover: 0, height: 0.5 }, settings: RIDE_SETTINGS(false),
    presets: { 'Go-kart': { speed: 18, turn: 140 }, 'Sports car': { speed: 34, turn: 110 }, 'Hovercraft': { speed: 16, turn: 80, hover: 0.8 }, 'Slow and steady': { speed: 6, turn: 60 } },
  });
  def(['flyable', 'fly', 'flying-ride'], {
    title: 'You can fly it', group: 'Riding', icon: '🪽', says: (o) => `you can get on and fly it (${o.speed} m/s)`,
    defaults: { speed: 18, turn: 90, lift: 8, height: 0.5 }, settings: RIDE_SETTINGS(true),
    presets: { 'Magic carpet': { speed: 14, turn: 100, lift: 6 }, 'Jet': { speed: 50, turn: 70, lift: 14 }, 'Balloon': { speed: 5, turn: 40, lift: 3 } },
  });
  for (const [n, mode] of [['seat', 'sit'], ['drivable', 'drive'], ['flyable', 'fly']]) {
    usable.set(H.behaviorDef(n), (e, b) => (H.sync && H.sync.online && mode !== 'sit' && H.sync.holder(e) && H.sync.holder(e) !== H.sync.me ? null
      : { label: b.o.label || (mode === 'sit' ? `Sit on ${nameOf(e)}` : mode === 'drive' ? `Drive ${nameOf(e)}` : `Fly ${nameOf(e)}`), act: () => getOn(e, mode, b) }));
  }

  // ------------------------------------------------------------------ hands: pick it up, throw it
  let holding = null; // { e, b, saved }
  function pickUp(e, b) {
    const p = me(), g = G();
    if (!p || holding || riding) return;
    if (H.sync && H.sync.online && e.sceneId) { const who = H.sync.holder(e); if (who && who !== H.sync.me) return; H.sync.claim(e, { hold: true }); }
    holding = { e, b, saved: { physics: e.physics } };
    e.held = true;
    e.physics = 'kinematic';
    g.ui.message(`Holding ${nameOf(e)}: click or F throws it, E puts it down`, 2.2);
  }
  function drop(thrown) {
    const h = holding;
    if (!h) return;
    holding = null;
    const e = h.e, p = me(), g = G();
    e.held = false;
    e.physics = h.saved.physics === 'static' || h.saved.physics === 'none' ? 'dynamic' : h.saved.physics || 'dynamic';
    if (thrown && p) {
      const f = g.camera && g.camera.forward ? g.camera.forward : [Math.sin(p.node.rotation.y), 0, Math.cos(p.node.rotation.y)];
      const k = num(h.b.o.throw, 14);
      e.velocity = [f[0] * k, f[1] * k + 3, f[2] * k];
      try { g.emit('throw', { thing: e }); } catch { /* fine */ }
    } else e.velocity = [0, 0, 0];
    if (H.sync && H.sync.online && e.sceneId) H.sync.release(e);
  }
  H.hooks.step.push(() => {
    const h = holding;
    if (!h) return;
    const p = me(), g = G();
    if (!p || !h.e.alive) { holding = null; return; }
    const yaw = p.node.rotation.y;
    const reach = 1.1 + Math.max(h.e.half[0], h.e.half[2]);
    h.e.node.position.set(p.x + Math.sin(yaw) * reach, p.y + 0.4, p.z + Math.cos(yaw) * reach);
    h.e.velocity = [0, 0, 0];
    if (g.input.pressed('f') || (g.input.mouse && g.input.mouse.pressed && g.input.captured)) drop(true);
  });
  def(['holdable', 'carry', 'throwable', 'pick-up'], {
    title: 'You can pick it up and throw it', group: 'Hands', icon: '✋', says: (o) => `you can pick it up (E) and throw it (${o.throw} m/s)`,
    defaults: { throw: 14 }, settings: [{ key: 'throw', label: 'Throw strength', type: 'number', min: 2, max: 50, step: 1, unit: 'm/s' }],
  });
  usable.set(H.behaviorDef('holdable'), (e, b) => (e.held ? null : { label: `Pick up ${nameOf(e)}`, act: () => pickUp(e, b) }));

  // ------------------------------------------------------------------ moving you: teleport, boost, cannon, gravity
  const cooled = new WeakMap();
  const cool = (e, s) => { const t = W().time, last = cooled.get(e) || -1e9; if (t - last < s) return false; cooled.set(e, t); return true; };
  def(['teleport', 'teleporter', 'portal'], {
    title: 'Teleports you', group: 'Moving you', icon: '🌀', says: (o) => (o.to ? `teleports you to ${Array.isArray(o.to) ? o.to.join(', ') : o.to}` : 'teleports you (set where to)'),
    defaults: { to: '', effect: true }, settings: [{ key: 'to', label: 'To (a thing’s name, or x, y, z)', type: 'thing' }],
    start(e) { if (e.physics !== 'none') e.ghost = true; },
    hit(e, other, o, s, game) {
      if (other !== game.player || !o.to || !cool(e, 1.2)) return;
      const t = find(o.to, e);
      if (!t) { game.ui.message(`Nothing called ${o.to}`, 1.5); return; }
      const p = t.position || [t.x, t.y, t.z];
      const out = t.half ? [p[0] + Math.sin(t.node.rotation.y) * (t.half[2] + 1.2), p[1] + t.half[1] + 0.2, p[2] + Math.cos(t.node.rotation.y) * (t.half[2] + 1.2)] : [p[0], p[1] + 1, p[2]];
      if (t.half) cooled.set(t, W().time); // (arriving on the other pad doesn't send you straight back)
      if (o.effect !== false) game.burst(other.position, { color: '#a78bfa', count: 26, speed: 5 });
      other.position = out;
      other.velocity = [0, 0, 0];
      if (o.effect !== false) game.burst(out, { color: '#a78bfa', count: 26, speed: 5 });
      game.emit('teleport', { thing: e, to: out });
    },
  });
  def(['boost', 'speed-pad', 'conveyor', 'push'], {
    title: 'Pushes you its way', group: 'Moving you', icon: '⏩', says: (o) => `pushes you forward (${o.power} m/s)`,
    defaults: { power: 22, up: 2 }, settings: [{ key: 'power', label: 'Push', type: 'number', min: 2, max: 80, step: 1, unit: 'm/s' }, { key: 'up', label: 'Lift', type: 'number', min: 0, max: 20, step: 0.5, unit: 'm/s' }],
    start(e) { if (e.physics !== 'none') e.ghost = true; },
    hit(e, other, o, s, game) {
      if (other.physics !== 'dynamic' && other !== game.player) return;
      const f = e.forward;
      other.velocity = [f.x * o.power, Math.max(other.vy, o.up), f.z * o.power];
      if (cool(e, 0.4)) game.burst(other.position, { color: '#34d399', count: 10, speed: 3 });
    },
  });
  def(['cannon', 'launcher', 'catapult'], {
    title: 'Fires you out of it', group: 'Moving you', icon: '💥', says: (o) => `fires you out (E, ${o.power} m/s)`,
    defaults: { power: 30, angle: 40 }, settings: [{ key: 'power', label: 'Power', type: 'number', min: 5, max: 90, step: 1, unit: 'm/s' }, { key: 'angle', label: 'Angle up', type: 'number', min: 0, max: 85, step: 1, unit: '°' }],
  });
  usable.set(H.behaviorDef('cannon'), (e, b) => ({
    label: `Get fired out of ${nameOf(e)}`,
    act: () => {
      const p = me(), g = G();
      if (!p) return;
      const yaw = e.node.rotation.y, a = num(b.o.angle, 40) * RAD, k = num(b.o.power, 30);
      p.position = [e.x + Math.sin(yaw) * (e.half[2] + 0.8), e.y + e.half[1] + 0.5, e.z + Math.cos(yaw) * (e.half[2] + 0.8)];
      p.velocity = [Math.sin(yaw) * Math.cos(a) * k, Math.sin(a) * k, Math.cos(yaw) * Math.cos(a) * k];
      g.burst(p.position, { color: '#fbbf24', count: 40, speed: 7 });
      if (g.camera && g.camera.shake) try { g.camera.shake(0.5, 0.3); } catch { /* fine */ }
      g.emit('cannon', { thing: e });
    },
  }));
  const zones = new Set();
  def(['gravity', 'low-gravity', 'zero-gravity', 'moon'], {
    title: 'Changes gravity inside', group: 'Moving you', icon: '🌙', says: (o) => (o.factor === 0 ? 'no gravity inside' : `gravity × ${o.factor} inside`),
    defaults: { factor: 0.25 }, settings: [{ key: 'factor', label: 'Gravity inside', type: 'number', min: 0, max: 3, step: 0.05, unit: '×' }],
    presets: { Moon: { factor: 0.17 }, 'No gravity': { factor: 0 }, 'Heavy planet': { factor: 2 } },
    start(e, o, s) { if (e.physics !== 'none') e.ghost = true; zones.add(s); s.e = e; s.o = o; },
    stop(e, o, s) { zones.delete(s); },
  });
  let inZone = null;
  H.hooks.step.push(() => {
    const p = me();
    if (!p || riding || H.mode === 'build') { if (inZone && p) { p.gravity = inZone.base; inZone = null; } return; }
    let z = null;
    for (const s of zones) if (s.e.alive && inside(s.e, p.position)) { z = s; break; }
    if (z && !inZone) inZone = { base: p.gravity, s: z };
    if (z) { inZone.s = z; p.gravity = inZone.base * num(z.o.factor, 0.25); }
    else if (inZone) { p.gravity = inZone.base; inZone = null; }
  });

  // ------------------------------------------------------------------ signals: buttons, levers, plates, and what answers them
  const SIGNAL = { key: 'signal', label: 'Signal name', type: 'text' };
  def(['button', 'push-button'], {
    title: 'A button (sends a signal)', group: 'Signals', icon: '🔘', says: (o) => `a button: E sends "${o.signal}" for ${o.seconds} s`,
    defaults: { signal: 'open', seconds: 1 }, settings: [SIGNAL, { key: 'seconds', label: 'How long', type: 'number', min: 0.2, max: 30, step: 0.1, unit: 's' }],
  });
  usable.set(H.behaviorDef('button'), (e, b) => ({ label: `Press ${nameOf(e)}`, act: () => { H.signals.pulse(b.o.signal, num(b.o.seconds, 1)); press(e); } }));
  def(['lever', 'switch-signal', 'toggle'], {
    title: 'A lever (turns a signal on and off)', group: 'Signals', icon: '🎚', says: (o) => `a lever: E turns "${o.signal}" on and off`,
    defaults: { signal: 'open' }, settings: [SIGNAL],
    update(e, dt, o, s) { const want = H.signals.get(o.signal) ? -30 : 30; s.a = (s.a ?? want) + (want - (s.a ?? want)) * Math.min(1, dt * 8); e.node.rotation.z = s.a * RAD; },
  });
  usable.set(H.behaviorDef('lever'), (e, b) => ({ label: `${H.signals.get(b.o.signal) ? 'Pull back' : 'Pull'} ${nameOf(e)}`, act: () => { H.signals.toggle(b.o.signal); press(e); } }));
  def(['plate', 'pressure-plate', 'floor-switch'], {
    title: 'A pressure plate (on while stood on)', group: 'Signals', icon: '⬛', says: (o) => `a pressure plate: "${o.signal}" is on while someone or something stands on it`,
    defaults: { signal: 'open' }, settings: [SIGNAL],
    update(e, dt, o, s, game) {
      // Only my own player and things I simulate count here; others count on their own screens (a plate is shared).
      const w = W();
      let on = false;
      for (const x of w.entities) { if (x === e || !x.alive || x.physics === 'static' || x.physics === 'none' || x.ghost) continue; if ((x === game.player || (x.physics === 'dynamic' && (!H.sync || H.sync.mine(x)))) && inside(e, [x.x, x.bottom, x.z], 0.05)) { on = true; break; } }
      if (on !== Boolean(s.on)) { s.on = on; if (on || H.signals.get(o.signal)) H.signals.set(o.signal, on); }
      e.node.position.y = (s.y ?? (s.y = e.y)) - (on ? 0.06 : 0);
    },
  });
  function press(e) { try { const g = G(); g.burst([e.x, e.y + e.half[1], e.z], { color: '#fde68a', count: 10, speed: 2 }); g.emit('press', { thing: e }); } catch { /* fine */ } }
  def(['shows', 'appears', 'secret', 'vanishes'], {
    title: 'Appears or vanishes on a signal', group: 'Signals', icon: '👻', says: (o) => (o.hide ? `vanishes while "${o.signal}" is on` : `appears while "${o.signal}" is on`),
    defaults: { signal: 'open', hide: false }, settings: [SIGNAL, { key: 'hide', label: 'Vanish instead of appear', type: 'bool' }],
    update(e, dt, o, s) {
      const on = H.signals.get(o.signal) !== Boolean(o.hide);
      if (H.mode === 'build') { e.visible = true; return; } // (building, you see it to place it)
      if (s.on === on) return;
      s.on = on;
      e.visible = on;
      e.ghost = !on;
      try { G().burst([e.x, e.y, e.z], { color: '#c4b5fd', count: 14, speed: 3 }); } catch { /* fine */ }
    },
  });
  // A door answers a signal too: opens when it's on (and, with none, when someone comes near: as before).
  const door = H.behaviorDef('opens');
  if (door) {
    const near = door.update;
    door.defaults = { ...door.defaults, signal: '', axis: 'y' };
    door.settings = [{ key: 'height', label: 'How far it moves', type: 'number', min: 0.5, max: 20, step: 0.1, unit: 'm' }, { key: 'axis', label: 'Which way', type: 'choice', options: [['y', 'Up'], ['x', 'Sideways'], ['z', 'Back']] }, { key: 'speed', label: 'Speed', type: 'number', min: 0.5, max: 20, step: 0.5, unit: 'm/s' }, { key: 'distance', label: 'Opens when someone is within', type: 'number', min: 0, max: 20, step: 0.5, unit: 'm' }, { ...SIGNAL, label: 'Or on a signal (then it waits for it)' }];
    door.says = (o) => (o.signal ? `opens when "${o.signal}" is on` : `opens (moves ${o.height} m) when someone comes within ${o.distance} m`);
    door.update = function (e, dt, o, s, game) {
      if (!o.signal && (o.axis || 'y') === 'y') return near.call(this, e, dt, o, s, game);
      if (e.held) return;
      const want = o.signal ? (H.signals.get(o.signal) ? 1 : 0) : (game.nearest('player', e) && game.nearest('player', e).distanceTo(e) < o.distance ? 1 : 0);
      s.k += Math.sign(want - s.k) * Math.min(Math.abs(want - s.k), dt * o.speed / Math.max(0.1, o.height));
      const i = o.axis === 'x' ? 0 : o.axis === 'z' ? 2 : 1;
      if (!s.home) s.home = [e.x, e.y, e.z];
      const p = s.home.slice();
      if (i === 1) p[1] = s.y + s.k * o.height;
      else { const yaw = e.node.rotation.y; const dir = i === 0 ? [Math.cos(yaw), -Math.sin(yaw)] : [Math.sin(yaw), Math.cos(yaw)]; p[0] += dir[0] * s.k * o.height; p[2] += dir[1] * s.k * o.height; }
      e.node.position.set(p[0], p[1], p[2]);
    };
  }

  // ------------------------------------------------------------------ games: king of the hill
  const hill = { mine: 0, board: new Map(), shownT: 0 };
  def(['hill', 'king-of-the-hill', 'capture-zone'], {
    title: 'King of the hill (points for holding it)', group: 'Games', icon: '👑', says: (o) => `king of the hill: ${o.points} point${o.points === 1 ? '' : 's'} a second while you stand on it`,
    defaults: { points: 1 }, settings: [{ key: 'points', label: 'Points a second', type: 'number', min: 1, max: 10, step: 1 }],
    start(e, o, s, game) {
      if (!game.state._hillNet) { game.state._hillNet = true; game.net.on('_hill', (d) => { if (d && d.who) hill.board.set(String(d.who), { name: String(d.name || 'Someone').slice(0, 24), n: Number(d.n) || 0 }); }); }
    },
    update(e, dt, o, s, game) {
      const p = game.player;
      if (!p || H.mode === 'build' || !inside(e, [p.x, p.bottom + 0.1, p.z], 0.3)) { s.t = 0; return; }
      s.t = (s.t || 0) + dt;
      if (s.t < 1) return;
      s.t -= 1;
      hill.mine += num(o.points, 1);
      const who = (H.sync && H.sync.me) || 'me';
      const name = (H.presence && H.presence.look && H.presence.look.name) || 'You';
      hill.board.set(who, { name, n: hill.mine });
      game.net.send('_hill', { who, name, n: hill.mine });
      game.burst([p.x, p.y + 1.2, p.z], { color: '#facc15', count: 6, speed: 2 });
      const top = [...hill.board.values()].sort((a, b) => b.n - a.n).slice(0, 3);
      game.ui.text('_hill', `👑 ${top.map((t, i) => `${i + 1}. ${t.name} ${t.n}`).join('   ')}`, { x: 'center', y: 'top', size: 20 });
    },
  });

  // ------------------------------------------------------------------ settings for the behaviors that were here before
  const SET = {
    spin: [{ key: 'speed', label: 'Speed', type: 'number', min: -720, max: 720, step: 5, unit: '°/s' }, { key: 'axis', label: 'Around', type: 'choice', options: [['y', 'Up'], ['x', 'Side'], ['z', 'Front']] }],
    bob: [{ key: 'height', label: 'How high', type: 'number', min: 0, max: 10, step: 0.1, unit: 'm' }, { key: 'speed', label: 'Speed', type: 'number', min: 0.1, max: 5, step: 0.1 }],
    patrol: [{ key: 'range', label: 'How far', type: 'number', min: 0.5, max: 60, step: 0.5, unit: 'm' }, { key: 'axis', label: 'Which way', type: 'choice', options: [['x', 'Sideways'], ['z', 'Forward'], ['y', 'Up and down']] }, { key: 'speed', label: 'Speed', type: 'number', min: 0.1, max: 6, step: 0.1 }],
    wander: [{ key: 'radius', label: 'How far it roams', type: 'number', min: 1, max: 80, step: 1, unit: 'm' }, { key: 'speed', label: 'Speed', type: 'number', min: 0.5, max: 12, step: 0.5, unit: 'm/s' }],
    bouncy: [{ key: 'bounce', label: 'Bounce', type: 'number', min: 0, max: 1.5, step: 0.05 }],
    collectible: [{ key: 'points', label: 'Points', type: 'number', min: 1, max: 100, step: 1 }, { key: 'respawn', label: 'Comes back after', type: 'number', min: 0, max: 300, step: 1, unit: 's' }],
    hurts: [{ key: 'damage', label: 'Damage', type: 'number', min: 1, max: 100, step: 1 }],
    launch: [{ key: 'power', label: 'Power', type: 'number', min: 4, max: 80, step: 1, unit: 'm/s' }],
    glow: [{ key: 'color', label: 'Color', type: 'color' }],
    talks: [{ key: 'text', label: 'What it says', type: 'text' }],
    sound: [{ key: 'asset', label: 'Sound', type: 'text' }],
  };
  const GROUP = { spin: 'Motion', bob: 'Motion', patrol: 'Motion', wander: 'Motion', follow: 'Motion', 'look-at-player': 'Motion', hop: 'Motion', bouncy: 'Physics', collectible: 'Games', hurts: 'Games', checkpoint: 'Games', goal: 'Games', launch: 'Moving you', opens: 'Signals', glow: 'Looks', talks: 'Talking', spawner: 'Games', sound: 'Sound' };
  for (const [n, sets] of Object.entries(SET)) { const d = H.behaviorDef(n); if (d && !d.settings) d.settings = sets.filter((x) => d.defaults && x.key in d.defaults); }
  for (const [n, g] of Object.entries(GROUP)) { const d = H.behaviorDef(n); if (d && !d.group) d.group = g; }

  /** What the build card and the docs read: every ability (behavior) with its settings, grouped. */
  H.abilities = {
    list: () => H.behaviorList().filter(({ def: d }) => d && d.title && !d.hidden).map(({ name, def: d }) => ({ name, title: d.title, group: d.group || 'More', icon: d.icon || '◆', defaults: d.defaults || {}, settings: settingsOf(d), presets: d.presets || null })),
    settingsOf: (name) => { const d = H.behaviorDef(name); return d ? settingsOf(d) : []; },
    get riding() { return riding ? { thing: riding.e, mode: riding.mode } : null; },
    get holding() { return holding ? holding.e : null; },
    getOff, drop: () => drop(false),
    /** Picks a thing up as if it were holdable (a flag, a ball): o.throw (m/s). */
    pick: (e, o = {}) => pickUp(e, { o: { throw: 14, ...o } }), getOn: (e, mode) => { const b = e && e.behaviors.find((x) => x.def && ['seat', 'drivable', 'flyable'].some((n) => H.behaviorDef(n) === x.def)); if (b) getOn(e, mode || (b.def === H.behaviorDef('drivable') ? 'drive' : b.def === H.behaviorDef('flyable') ? 'fly' : 'sit'), b); },
    inside,
  };
  /** A behavior's settings: its own description, else one made from its defaults (numbers, words, yes/no). */
  function settingsOf(d) {
    if (Array.isArray(d.settings)) return d.settings;
    return Object.entries(d.defaults || {}).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v)).map(([key, v]) => ({ key, label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), type: typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'bool' : 'text' }));
  }
  // A new world: nobody rides or holds anything from the last one.
  H.hooks.game.push(() => { riding = null; holding = null; inZone = null; hill.mine = 0; hill.board.clear(); H.signals._reset(); });
})();
