// Contraptions (J, 2026-10-27: "players can literally do anything"): things joined to each other or to the world with
// the physics engine's joints, as abilities any thing stacks. `hinge` (a door, a gate, a flap: it swings round an edge),
// `motor` (a wheel, a fan, a windmill, a turntable: it turns by itself, or while a signal is on), `spring` (it bounces
// back where it was), `rope` (it hangs, swings, is towed: a rope you see), `glue` (stuck fast to another thing), `piston`
// (it slides back and forth along a line, or out while a signal is on). `to` is another thing's name or id; empty is the
// world itself. The thing moves (it becomes dynamic) unless it says otherwise. Docs: WORLD.md "Contraptions".
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
  const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const axisOf = (a, d = 'y') => (Array.isArray(a) ? a.map(Number) : AXES[String(a || d).toLowerCase()] || AXES[d]);

  /** The thing called `word` (a name or an id), the nearest of that name; null for the world. */
  function find(word, from) {
    const w = W();
    if (!w || !word) return null;
    const s = String(word), byId = w.byId.get(s);
    if (byId && byId !== from) return byId;
    const low = s.toLowerCase();
    let best = null, bd = Infinity;
    for (const e of w.entities) {
      if (!e.alive || e === from || e === w.player || String(e.name || '').toLowerCase() !== low) continue;
      const d = Math.hypot(e.x - from.x, e.y - from.y, e.z - from.z);
      if (d < bd) { best = e; bd = d; }
    }
    return best;
  }
  /** A point on the thing in its own space (meters before scaling): its middle, an edge, its top, or [x, y, z]. */
  function pivot(e, at, axis) {
    if (Array.isArray(at)) return at.map(Number);
    const s = e.node.scaling, h = [e.half[0] / (s.x || 1), e.half[1] / (s.y || 1), e.half[2] / (s.z || 1)];
    const a = String(at || 'center').toLowerCase();
    if (a === 'top') return [0, h[1], 0];
    if (a === 'bottom') return [0, -h[1], 0];
    if (a === 'left' || a === 'edge') return axis[0] ? [0, 0, -h[2]] : [-h[0], 0, 0]; // (a door on a y hinge swings round its left edge)
    if (a === 'right') return axis[0] ? [0, 0, h[2]] : [h[0], 0, 0];
    if (a === 'front') return [0, 0, h[2]];
    if (a === 'back') return [0, 0, -h[2]];
    return [0, 0, 0];
  }
  /** Makes the joint once both things have bodies (the first steps), and keeps it. */
  function join(e, s, type, opts, o) {
    if (s.j || s.failed) return s.j;
    if (o.moves !== false && e.physics === 'static') e.physics = 'dynamic';
    if (!e._pb) return null; // (its body comes in the step)
    const other = o.to ? find(o.to, e) : null;
    if (o.to && !other) { if (!s.told) { s.told = true; H.report(new Error(`${e.name || 'A thing'}: nothing called "${o.to}" to join to`), 'contraptions'); } return null; }
    if (other && !other._pb && other.physics !== 'none') return null;
    try { s.j = H.physics.joint(type, e, other, opts); } catch (err) { s.failed = true; H.report(err, 'contraptions'); }
    if (!s.j) s.failed = true;
    return s.j;
  }
  const signalOn = (name) => !name || Boolean(H.signals && H.signals.get(String(name)));
  const part = (name, def) => H.behavior(name, { group: 'Contraptions', ...def, stop(e, o, s) { if (s.j) s.j.remove(); s.j = null; if (s.line) { s.line.dispose(); s.line = null; } if (def.stop) def.stop(e, o, s); } });

  part('hinge', {
    title: 'Swings on a hinge', icon: '🚪', says: (o) => `swings round its ${o.at || 'edge'}${o.to ? ` on ${o.to}` : ''}`,
    defaults: { to: '', axis: 'y', at: 'edge', min: -100, max: 100, collide: false },
    settings: [{ key: 'to', label: 'Hinged to (empty: the world)', type: 'thing' }, { key: 'axis', label: 'Turns round', type: 'choice', options: ['y', 'x', 'z'] }, { key: 'at', label: 'Where', type: 'choice', options: ['edge', 'right', 'top', 'bottom', 'center'] }, { key: 'min', label: 'Swings from', type: 'number', min: -180, max: 0, unit: '°' }, { key: 'max', label: 'Swings to', type: 'number', min: 0, max: 180, unit: '°' }],
    presets: [{ label: 'Door', values: { axis: 'y', at: 'edge', min: -100, max: 100 } }, { label: 'Trapdoor', values: { axis: 'x', at: 'back', min: -95, max: 0 } }, { label: 'Swing', values: { axis: 'x', at: 'top', min: -80, max: 80 } }],
    update(e, dt, o, s) { const ax = axisOf(o.axis); join(e, s, 'hinge', { pivotA: pivot(e, o.at, ax), axis: ax, limits: [num(o.min, -100), num(o.max, 100)], collide: Boolean(o.collide) }, o); },
  });
  part('motor', {
    title: 'Turns by itself (a motor)', icon: '⚙️', says: (o) => `turns at ${o.speed}°/s${o.signal ? ` while "${o.signal}" is on` : ''}`,
    defaults: { to: '', axis: 'y', at: 'center', speed: 90, force: 2000, signal: '' },
    settings: [{ key: 'speed', label: 'Speed', type: 'number', min: -1440, max: 1440, step: 15, unit: '°/s' }, { key: 'force', label: 'Strength', type: 'number', min: 10, max: 100000 }, { key: 'axis', label: 'Turns round', type: 'choice', options: ['y', 'x', 'z'] }, { key: 'to', label: 'Mounted on (empty: the world)', type: 'thing' }, { key: 'signal', label: 'Runs while signal', type: 'text' }],
    presets: [{ label: 'Turntable', values: { axis: 'y', speed: 45 } }, { label: 'Wheel', values: { axis: 'x', speed: 360 } }, { label: 'Fan', values: { axis: 'z', speed: 720 } }],
    update(e, dt, o, s) {
      const ax = axisOf(o.axis), j = join(e, s, 'hinge', { pivotA: pivot(e, o.at, ax), axis: ax }, o);
      if (!j) return;
      const want = signalOn(o.signal) ? num(o.speed, 90) : 0;
      if (s.speed !== want) { s.speed = want; j.motor(want, num(o.force, 2000)); }
    },
  });
  part('spring', {
    title: 'Springs back', icon: '🪀', says: (o) => `springs back to where it is${o.to ? ` on ${o.to}` : ''}`,
    defaults: { to: '', stiffness: 60, damping: 2, give: 0 },
    settings: [{ key: 'to', label: 'On (empty: the world)', type: 'thing' }, { key: 'stiffness', label: 'Stiffness', type: 'number', min: 1, max: 2000 }, { key: 'damping', label: 'Damping', type: 'number', min: 0, max: 100, step: 0.5 }, { key: 'give', label: 'Free play', type: 'number', min: 0, max: 5, step: 0.1, unit: 'm' }],
    update(e, dt, o, s) { join(e, s, 'spring', { stiffness: num(o.stiffness, 60), damping: num(o.damping, 2), min: -num(o.give, 0), max: num(o.give, 0) }, o); },
  });
  part('glue', {
    title: 'Stuck to another thing', icon: '🧷', says: (o) => (o.to ? `stuck fast to ${o.to}` : 'stuck fast where it is'),
    defaults: { to: '' },
    settings: [{ key: 'to', label: 'Stuck to (empty: the world)', type: 'thing' }],
    update(e, dt, o, s) { join(e, s, 'fixed', {}, o); },
  });
  part('rope', {
    title: 'On a rope', icon: '🪢', says: (o) => `on a rope${o.to ? ` to ${o.to}` : ''}${o.length ? ` ${o.length} m long` : ''}`,
    defaults: { to: '', length: 0, at: 'top', color: '#c8a46a', show: true, anchor: '' },
    settings: [{ key: 'to', label: 'Tied to (empty: the point above it)', type: 'thing' }, { key: 'length', label: 'Length (0: as it is now)', type: 'number', min: 0, max: 100, step: 0.5, unit: 'm' }, { key: 'at', label: 'Tied at', type: 'choice', options: ['top', 'center', 'front', 'back'] }, { key: 'color', label: 'Color', type: 'color' }],
    update(e, dt, o, s) {
      if (!s.j && !s.failed) {
        if (o.moves !== false && e.physics === 'static') e.physics = 'dynamic';
        if (!e._pb) return;
        const other = o.to ? find(o.to, e) : null;
        if (o.to && !other) return;
        const pa = pivot(e, o.at);
        e.node.computeWorldMatrix(true);
        const from = B.Vector3.TransformCoordinates(new B.Vector3(pa[0], pa[1], pa[2]), e.node.getWorldMatrix());
        // Tied to the world: a point above it, the rope's length up (or 3 m).
        const len0 = num(o.length, 0);
        const top = other ? [other.x, other.y + other.half[1], other.z] : Array.isArray(o.anchor) ? o.anchor.map(Number) : [from.x, from.y + (len0 || 3), from.z];
        const len = len0 || Math.max(0.3, Math.hypot(top[0] - from.x, top[1] - from.y, top[2] - from.z));
        s.top = top; s.len = len;
        try {
          if (other) s.j = H.physics.joint('distance', e, other, { pivotA: pa, pivotB: [0, other.half[1] / (other.node.scaling.y || 1), 0], max: len });
          else {
            // (A rope to the world: tied to a point that isn't on the thing.)
            s.j = H.physics.joint('distance', e, null, { pivotA: pa, max: len, worldPivot: top });
          }
        } catch (err) { s.failed = true; H.report(err, 'contraptions'); }
        if (!s.j) { s.failed = true; return; }
        s.pa = pa;
      }
      if (!s.j || o.show === false) return;
      // The rope you see: from the knot on the thing to where it is tied.
      e.node.computeWorldMatrix(true);
      const a = B.Vector3.TransformCoordinates(new B.Vector3(s.pa[0], s.pa[1], s.pa[2]), e.node.getWorldMatrix());
      const other = o.to ? find(o.to, e) : null;
      const b = other ? new B.Vector3(other.x, other.y + other.half[1], other.z) : new B.Vector3(s.top[0], s.top[1], s.top[2]);
      if (!s.line || s.line.isDisposed()) { s.line = B.MeshBuilder.CreateLines('rope', { points: [a, b], updatable: true }, W().scene); s.line.color = B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#c8a46a'); s.line.isPickable = false; s.line.metadata = { decor: true }; }
      else B.MeshBuilder.CreateLines('rope', { points: [a, b], instance: s.line });
    },
  });
  part('piston', {
    title: 'Slides along a line (a piston)', icon: '🔩', says: (o) => `slides ${o.range} m along ${o.axis}${o.signal ? ` while "${o.signal}" is on` : ', back and forth'}`,
    defaults: { to: '', axis: 'y', range: 2, speed: 1.5, force: 5000, signal: '' },
    settings: [{ key: 'axis', label: 'Along', type: 'choice', options: ['y', 'x', 'z'] }, { key: 'range', label: 'How far', type: 'number', min: 0.1, max: 30, step: 0.1, unit: 'm' }, { key: 'speed', label: 'Speed', type: 'number', min: 0.1, max: 20, step: 0.1, unit: 'm/s' }, { key: 'signal', label: 'Out while signal (empty: back and forth)', type: 'text' }, { key: 'to', label: 'On (empty: the world)', type: 'thing' }],
    presets: [{ label: 'Lift', values: { axis: 'y', range: 4, speed: 1 } }, { label: 'Crusher', values: { axis: 'y', range: 2, speed: 3 } }, { label: 'Pusher', values: { axis: 'z', range: 2, speed: 2 } }],
    update(e, dt, o, s) {
      const ax = axisOf(o.axis), j = join(e, s, 'slider', { axis: ax, limits: [0, num(o.range, 2)] }, o);
      if (!j) return;
      if (!s.home) s.home = [e.x, e.y, e.z];
      const k = ax.indexOf(1), at = [e.x, e.y, e.z][k] - s.home[k], range = num(o.range, 2), sp = num(o.speed, 1.5);
      let dir;
      if (o.signal) dir = signalOn(o.signal) ? 1 : -1;
      else { if (s.dir === undefined) s.dir = 1; if (at >= range - 0.05) s.dir = -1; else if (at <= 0.05) s.dir = 1; dir = s.dir; }
      if (s.want !== dir) { s.want = dir; j.motor(dir * sp, num(o.force, 5000)); }
    },
  });
})();
