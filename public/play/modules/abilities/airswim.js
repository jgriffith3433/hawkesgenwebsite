// Swimming in the air (config.player.mode "air-swim"; J, 2026-10-27: "make it so I can swim in the air"): the 'air-swim'
// controller. You float; WASD swims where you look (look up and swim forward to rise), space swims up, C down; let go and
// you drift slowly down, like sinking in water but softer. The body swims (its swim pose) wherever you are.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  H.controllers.register('air-swim', {
    title: 'Swimming in the air: WASD swims where you look, space up, C down',
    speed: 5,
    enter(p, ctx) { p.gravity = 0; p.flying = false; p._airSwim = true; p.vy *= 0.2; ctx.game.emit('swim', { swimming: true, entity: p, air: true }); },
    exit(p, ctx) { p.gravity = p.baseGravity ?? 1; p._airSwim = false; if (p.node.rotation.x) { p.node.rotation.x = 0; p.measure(); } ctx.game.emit('swim', { swimming: false, entity: p, air: true }); },
    idle(p) { p.velocity = [p.vx * 0.9, -0.4, p.vz * 0.9]; p._walked = true; },
    update(p, dt, ctx) {
      const input = ctx.game.input;
      const a = input.axis();
      const yaw = W().camera.yawNow();
      let fx = Math.sin(yaw), fy = 0, fz = Math.cos(yaw);
      const cam = W().scene.activeCamera;
      if (cam) { const d = cam.getDirection(B.Axis.Z); fx = d.x; fy = d.y; fz = d.z; }
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      const sp = (p.speed || 5) * (input.key('shift') ? 1.6 : 1);
      let vx = (fx * a.y + rx * a.x) * sp, vy = fy * a.y * sp, vz = (fz * a.y + rz * a.x) * sp;
      if (input.key('space') || input.key(' ')) vy = sp;
      if (input.key('c') || input.key('control')) vy = -sp;
      const moving = Math.hypot(a.x, a.y) > 0.1 || Math.abs(vy) > 0.1;
      if (!moving) vy = -0.4; // let go: drift slowly down
      const k = Math.min(1, dt * (moving ? 4 : 8)); // (letting go stops the swim quickly, then the slow drift)
      p.gravity = 0; // (every step: settings and the walk controller set it back otherwise)
      if (vy > 0.1) p.grounded = false; // (swimming up leaves the ground)
      p.velocity = [p.vx + (vx - p.vx) * k, p.vy + (vy - p.vy) * k, p.vz + (vz - p.vz) * k];
      // On the ground with nothing pressed: stand (the body's swim pose stays for the air).
      if (p.grounded && !moving) p.vy = 0;
      p._walked = true;
      p.wake();
      if (p._view !== 'first') {
        if (Math.hypot(vx, vz) > 0.3) { const want = Math.atan2(vx, vz); let d = want - p.node.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.node.rotation.y += d * Math.min(1, dt * 8); }
        const lean = moving ? clamp(1.2 - vy * 0.08, 0.6, 1.5) : 0.3;
        p.node.rotation.x += (lean - p.node.rotation.x) * Math.min(1, dt * 4);
      }
    },
  });
})();
