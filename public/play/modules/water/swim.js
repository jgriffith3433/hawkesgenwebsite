// Swimming and diving: the 'swim' controller (H.controllers). The player switches to it on their own when the water
// comes up to their chest (while playing, walking, not flying), and back to walking when they can stand again or
// climb out. WASD swims where you look (look down and swim forward to dive), space swims up and, at the surface, jumps
// out (onto a pool's edge), C dives. Breath runs out under water (config.water.breath / shape.breath seconds; false:
// never). Phones: the jump button swims up, a dive button appears while swimming.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const X = H.water._;
  const clamp = X.clamp;
  const EYE = 1.6; // the player's eyes above their feet (runtime.js firstPerson height)
  const FLOAT = 1.25; // floating: feet this far under the surface (head and shoulders out)

  /** The water around the player: { body, surface, depth (surface above their feet), eyesUnder } or null. */
  function around(p) {
    const wa = X.waterAt(p.x, p.z, p.bottom + 0.3);
    if (!wa) return null;
    return { body: wa.body, surface: wa.surface, depth: wa.surface - p.bottom, eyesUnder: wa.surface > p.bottom + EYE - 0.05 };
  }
  const breathOf = (b) => (b && b.breath === false ? Infinity : Math.max(3, Number(b && b.breath) || 25));

  function leave(p) { if (p.controller === 'swim') p.control('walk'); }

  H.controllers.register('swim', {
    title: 'Swimming: WASD swims where you look, space swims up (and climbs out at the surface), C dives',
    speed: 3.6,
    tools: false,
    enter(p, ctx) {
      const w = around(p);
      ctx.state.air = ctx.state.max = breathOf(w && w.body);
      ctx.state.t = 0;
      p.gravity = 0;
      p.flying = false;
      p.vy *= 0.25;
      if (H.touchUi) {
        const pad = document.getElementById('touch');
        if (pad && !pad.querySelector('.water-dive')) {
          const b = document.createElement('button');
          b.className = 'tb water-tb2 water-dive';
          b.setAttribute('aria-label', 'Dive');
          b.textContent = '⤓';
          pad.appendChild(b);
          H.bindTouchKey(b, 'c');
          ctx.state.button = b;
        }
      }
      ctx.game.emit('swim', { swimming: true, entity: p });
    },
    exit(p, ctx) {
      p.gravity = p.baseGravity ?? 1;
      if (ctx.state.button) ctx.state.button.remove();
      ctx.game.ui.remove('water-air');
      if (p.node.rotation.x) { p.node.rotation.x = 0; p.measure(); }
      ctx.game.emit('swim', { swimming: false, entity: p });
    },
    idle(p) {
      const w = around(p);
      p.velocity = [0, w ? clamp((w.surface - FLOAT - p.bottom) * 3, -2, 2) : 0, 0];
      p._walked = true;
    },
    update(p, dt, ctx) {
      const g = ctx.game, input = g.input, st = ctx.state;
      const w = around(p);
      if (!w) { leave(p); return; }
      st.t += dt;
      // Shallow enough to stand: walk again.
      if (w.depth < 1.0 && p.grounded) { leave(p); return; }
      const a = input.axis();
      const yaw = W().camera.yawNow();
      let fx = Math.sin(yaw), fy = 0, fz = Math.cos(yaw);
      if (p._view === 'first' && W().scene.activeCamera) { const d = W().scene.activeCamera.getDirection(B.Axis.Z); fx = d.x; fy = d.y; fz = d.z; }
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const sp = (p.speed || 3.6) * (input.key('shift') ? 1.5 : 1);
      let vx = (fx * a.y + rx * a.x) * sp, vy = fy * a.y * sp, vz = (fz * a.y + rz * a.x) * sp;
      const atSurface = p.bottom > w.surface - FLOAT - 0.25;
      // Space at the surface: a big kick up and forward, out of the water (onto a pool's edge, a dock, a boat).
      if (atSurface && input.pressed('space')) {
        leave(p);
        p.gravity = p.baseGravity ?? 1;
        p.vy = 9.5;
        p.vx = Math.sin(yaw) * 3; p.vz = Math.cos(yaw) * 3;
        p.grounded = false;
        H.water.splash([p.x, w.surface, p.z], 0.6);
        return;
      }
      if (input.key('space')) vy = sp;
      const down = input.key('c') || input.key('control');
      if (down) vy = -sp;
      const diving = down || vy < -1;
      if (atSurface && !diving) vy = clamp((w.surface - FLOAT - p.bottom) * 4, -3, 3);
      else if (!diving && Math.abs(vy) < 0.3) vy = 0.7; // people float: let go and you drift up
      const cur = w.body.current;
      if (cur) { vx += cur[0]; vz += cur[1]; }
      const k = Math.min(1, dt * 5);
      p.vx += (vx - p.vx) * k; p.vy += (vy - p.vy) * k; p.vz += (vz - p.vz) * k;
      p._walked = true;
      p.wake();
      const moving = Math.hypot(a.x, a.y) > 0.1;
      // Facing where you swim when you can see yourself, leaning into the stroke.
      if (p._view !== 'first') {
        if (moving) { const want = Math.atan2(vx, vz); let d = want - p.node.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.node.rotation.y += d * Math.min(1, dt * 8); }
        const lean = moving ? (atSurface ? 0.9 : 1.25) : 0.25;
        p.node.rotation.x += (lean - p.node.rotation.x) * Math.min(1, dt * 4);
      }
      // Strokes at the surface ripple; under water you breathe out bubbles.
      if (atSurface && moving && st.t - (st.ripple || 0) > 0.45) { st.ripple = st.t; H.water.ripple(p.x, p.z, 0.4); if (Math.random() < 0.35) H.water.sound('plop', { at: p, volume: 0.25 }); }
      if (st.t - (st.wetAt || -9) > 1) { st.wetAt = st.t; if (H.water.wet) H.water.wet(p, 8); }
      // Breath.
      if (w.eyesUnder && isFinite(st.max)) {
        st.air = Math.max(0, st.air - dt);
        if (st.t - (st.bubbles || 0) > 0.9) { st.bubbles = st.t; g.burst([p.x, p.bottom + EYE, p.z], { color: '#c8f0ff', count: 3, speed: 0.8, size: 0.09, life: 1.2 }); }
        if (st.air <= 0) { st.drown = (st.drown || 0) + dt; if (st.drown >= 1) { st.drown = 0; g.hurt(10); } }
      } else { st.air = Math.min(st.max, st.air + dt * 5); st.drown = 0; }
      if (isFinite(st.max) && st.air < st.max - 0.01) g.ui.bar('water-air', st.air / st.max, { label: st.air <= 0 ? 'Out of air!' : 'Air', x: 'center', y: 'bottom', color: st.air / st.max < 0.25 ? '#f87171' : '#7dd3fc' });
      else g.ui.remove('water-air');
    },
  });

  // Into the water you go: walking in until it's up to your chest starts swimming; wading up to there slows you down.
  H.hooks.step.push(() => {
    const w = W();
    const p = w && w.player;
    if (!p || !p.alive || H.mode === 'build' || !p.controls || !X.live().length) return;
    const c = p.controller;
    if (c !== 'walk' || p.flying) return;
    const wi = around(p);
    if (!wi) return;
    if (wi.body.swim !== false && wi.depth > 1.15) { p.control('swim'); return; }
    if (wi.depth > 0.35 && p.grounded) { const k = clamp(1 - wi.depth * 0.35, 0.55, 1); p.vx *= k; p.vz *= k; }
  });

  H.water.swimming = () => { const p = W() && W().player; return Boolean(p && p.controller === 'swim'); };
  void G;
})();
