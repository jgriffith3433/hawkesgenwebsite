// How the player moves: one controller per way of moving (H.controllers.register). config.player.mode picks one
// ("walk", "flight"); a module adds its own (driving, swimming, riding) and switches the player to it with
// game.player.control('drive', { vehicle }) and back with game.player.control('walk').
// Each controller is { enter(player, ctx), update(player, dt, ctx), idle(player, ctx), exit(player, ctx), speed, tools }:
//   ctx = { game, H, state (yours, per use), opts (what control() was given), mode ('build' or 'play') }
//   idle runs instead of update while the player may not move (a menu, the editor not in control)
//   speed is the default config.player.speed for this mode; tools: false hides held tools (guns) while in it
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;

  // ------------------------------------------------------------------ walking (and flying around while building)
  H.controllers.register('walk', {
    title: 'Walking: WASD, space jumps, shift runs (F flies where allowed)',
    speed: 6,
    idle(p) { if (!p.flying) p.walk({ x: 0, z: 0 }, 0); else { p.velocity = [0, 0, 0]; p._walked = true; } },
    update(p, dt, ctx) {
      const game = ctx.game, input = game.input, building = ctx.mode === 'build';
      const a = input.direction();
      const sprint = input.key('shift') && !p.flying;
      if (input.pressed('f') && (building || p.canFly)) { p.flying = !p.flying; p.vy = 0; game.ui.message(p.flying ? 'Flying: you go where you look, space up, C down' : 'Walking', 1.4); }
      // (E is always "use"; holding Q is the spawn wheel: neither moves you.)
      if (p.flying) {
        p.gravity = 0;
        let sp = input.key('shift') ? 16 : 8;
        // A round world, building: the higher you are, the faster you fly (8 m/s at the ground, 100 m/s 100 m up, 10 km/s 10 km up:
        // 150 km up in about 10 s, 5 holding shift), so you can climb until you see the whole planet and cross it in seconds. No ceiling.
        const P = H.planet;
        p._fast = false;
        if (building && P && P.round) {
          const h = Math.max(0, P.heightOf([p.x, p.bottom, p.z]));
          sp *= 1 + Math.min(h, P.radius * 20) / 8; // (no ceiling; the speed stops growing 20 radii out)
          // High and fast: moved straight (no collision casts that far a step); never more than a fraction of the height.
          p._fast = h > 40 && sp > 60;
        }
        // Forward and back go where the camera looks, up and down too (look down and press W to dive); sideways stays
        // level. Space and C (or Ctrl) still rise and sink straight up and down.
        const ax = input.axis();
        const cam = game.camera.babylon;
        const look = cam ? cam.getDirection(B.Axis.Z) : new B.Vector3(a.x, 0, a.z);
        const yaw = Math.atan2(look.x, look.z);
        const side = { x: Math.cos(yaw), z: -Math.sin(yaw) };
        const up = input.key('space');
        const down = input.key('c') || input.key('control');
        p.vx = (look.x * ax.y + side.x * ax.x) * sp;
        p.vz = (look.z * ax.y + side.z * ax.x) * sp;
        p.vy = look.y * ax.y * sp + (up ? sp : 0) - (down ? sp : 0);
        p._walked = true;
        p.wake();
        return;
      }
      p.gravity = p.baseGravity ?? 1;
      p._fast = false;
      // Thrown by a launch pad (p._flung): the throw carries on through the air, the keys steer a little; landing ends it.
      if (p._flung && !p.grounded) {
        const sp = (p.speed || 6) * 0.35;
        p.vx = p._flung.vx + a.x * sp; p.vz = p._flung.vz + a.z * sp; p._walked = true;
      } else {
        if (p._flung && p.grounded) p._flung = null;
        p.walk(a, (p.speed || 6) * (sprint ? 1.6 : 1));
      }
      // Facing where you walk when you can see yourself.
      if (p._view !== 'first' && Math.hypot(a.x, a.z) > 0.1) { const want = Math.atan2(a.x, a.z); let d = want - p.node.rotation.y; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; p.node.rotation.y += d * Math.min(1, dt * 12); }
      if (p.grounded) p._doubled = false;
      if (input.pressed('space')) {
        const g = Math.abs(H.world.config.gravity ?? 24) * (p.gravity || 1);
        const speed = Math.sqrt(2 * g * (p.jumpHeight || 1.5)) || 8.5;
        if (p.jump(speed)) { /* jumped */ }
        else if (p.doubleJump && !p._doubled) { p._doubled = true; p.vy = speed; game.burst([p.x, p.bottom, p.z], { color: '#c8d8ff', count: 10, speed: 2 }); }
        else if ((building || p.canFly) && performance.now() - (p._lastJump || 0) < 300) { p.flying = true; game.ui.message('Flying: you go where you look, space up, C down, F lands', 1.4); }
        p._lastJump = performance.now();
      }
    },
  });

  // ------------------------------------------------------------------ flight: always moving forward, steered
  /** A small craft (a nose, wings, a glowing engine) instead of the walking body. */
  function ship(p) {
    const sc = H.world.scene;
    const root = new B.TransformNode('ship', sc);
    root.parent = p.node;
    const hex = (c) => B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(String(c)) ? c : '#4a9eff');
    const hull = new B.StandardMaterial('ship', sc); hull.diffuseColor = hex(H.hooks.myColor || '#4a9eff'); hull.specularColor = new B.Color3(0.5, 0.5, 0.6);
    const glow = new B.StandardMaterial('ship-glow', sc); glow.emissiveColor = new B.Color3(0.4, 0.9, 1); glow.disableLighting = true;
    const part = (m, mat, x, y, z) => { m.material = mat; m.parent = root; m.position.set(x, y, z); m.isPickable = false; m.metadata = { decor: true }; return m; };
    part(B.MeshBuilder.CreateCylinder('ship-body', { diameterTop: 0.05, diameterBottom: 0.55, height: 2.2, tessellation: 16 }, sc), hull, 0, 0, 0.2).rotation.x = Math.PI / 2;
    part(B.MeshBuilder.CreateBox('ship-wing', { width: 2.6, height: 0.06, depth: 0.7 }, sc), hull, 0, -0.05, -0.2);
    part(B.MeshBuilder.CreateBox('ship-fin', { width: 0.06, height: 0.5, depth: 0.5 }, sc), hull, 0, 0.25, -0.6);
    part(B.MeshBuilder.CreateBox('ship-tip-l', { width: 0.08, height: 0.08, depth: 0.5 }, sc), glow, -1.3, -0.05, -0.2);
    part(B.MeshBuilder.CreateBox('ship-tip-r', { width: 0.08, height: 0.08, depth: 0.5 }, sc), glow, 1.3, -0.05, -0.2);
    part(B.MeshBuilder.CreateCylinder('ship-engine', { diameter: 0.34, height: 0.12, tessellation: 16 }, sc), glow, 0, 0, -0.9).rotation.x = Math.PI / 2;
    return root;
  }
  H.controllers.register('flight', {
    title: 'Flying a craft: always forward, steered by the mouse or WASD, space boosts',
    speed: 20,
    tools: false,
    enter(p) { if (p._ship) p._ship.dispose(); p._ship = ship(p); p._shipOn = true; },
    exit(p) { if (p._ship) { p._ship.dispose(); p._ship = null; } p._shipOn = false; },
    idle(p) { p.velocity = [0, 0, 0]; p._walked = true; },
    update(p, dt, ctx) {
      const cam = H.world.camera, input = ctx.game.input;
      p.gravity = 0;
      // The heading is the camera's yaw and pitch (0 is level, so you start flying straight ahead).
      if (!ctx.state.ready) { ctx.state.ready = true; cam.pitch = 0; }
      const ax = input.axis();
      cam.yaw += ax.x * dt * 1.4;
      cam.pitch = Math.max(-0.4, Math.min(0.9, cam.pitch - ax.y * dt * 1.1));
      const cp = Math.cos(cam.pitch);
      const f = { x: Math.sin(cam.yaw) * cp, y: -Math.sin(cam.pitch), z: Math.cos(cam.yaw) * cp };
      const sp = (p.speed || 20) * (input.key('space') ? 1.8 : 1);
      p.velocity = [f.x * sp, f.y * sp, f.z * sp];
      p._walked = true;
      p.node.rotation.y = cam.yaw;
      if (p._ship) { p._ship.rotation.z += (-ax.x * 0.6 - p._ship.rotation.z) * Math.min(1, dt * 6); p._ship.rotation.x = cam.pitch; }
    },
  });
})();
