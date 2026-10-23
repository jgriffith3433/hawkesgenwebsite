// A complete small engine module, in its own file, touching nothing else: a kind of thing, a tool and a controller.
// Copy it to public/play/modules/<name>/<name>.js (with a module.json listing it) to start a module of your own;
// docs/engine-modules.md explains each part. The engine tests load it to prove the seams hold.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;

  // A kind: a glowing beacon (a thin cylinder). Scenes hold it as { "type": "beacon" }, scripts make one with game.beacon().
  H.kinds.register('beacon', {
    physics: 'static',
    maker: true,
    build(shape, o) {
      const r = Number(shape.radius) || 0.25, h = Number(shape.height) || 2.5;
      const e = H.lib.shape('beacon', () => B.MeshBuilder.CreateCylinder('beacon', { diameter: r * 2, height: h, tessellation: 12 }, H.world.scene), { ...o, emissive: o.emissive || '#22d3ee' });
      e.data.beacon = true;
      return e;
    },
    editor: { word: 'a beacon', lift: (spec) => (Number(spec.shape && spec.shape.height) || 2.5) / 2, hotbar: [{ order: 900, icon: '⟟', label: 'Beacon', make: () => ({ type: 'beacon', name: 'Beacon' }) }] },
    codex: { group: 'More', what: 'A glowing beacon (the sample module).', spec: { type: 'beacon', name: 'Beacon', transform: { position: [0, 1.25, 0] } }, fields: [['shape.radius', 'meters', '0.25'], ['shape.height', 'meters', '2.5']] },
  });

  // A tool: the crate gun. Click (or call fire) to drop a crate where you look.
  function fire(ctx) {
    const g = ctx.game, p = ctx.player;
    const f = p.forward;
    ctx.state.made = (ctx.state.made || 0) + 1;
    return g.box({ size: 0.5, x: p.x + f.x * 2, y: p.y + 1, z: p.z + f.z * 2, physics: 'dynamic', color: ctx.opts.color || '#f97316', tag: 'crate-gun' });
  }
  H.tools.register('crate-gun', {
    title: 'Crate gun',
    fire,
    equip(ctx) { ctx.state.made = 0; },
    step(dt, ctx) { if (H.input.mouse.pressed) fire(ctx); },
  });

  // A controller: hovering a meter and a half over whatever is below, moved with WASD.
  H.controllers.register('hover', {
    title: 'Hovering: WASD moves, you float over the ground',
    speed: 5,
    enter(p, ctx) { ctx.state.height = Number(ctx.opts.height) || 1.5; },
    idle(p) { p.velocity = [0, 0, 0]; p._walked = true; },
    update(p, dt, ctx) {
      p.gravity = 0;
      const a = ctx.game.input.direction();
      const below = ctx.game.raycast([p.x, p.bottom + 0.1, p.z], [0, -1, 0], 20, { ignore: p });
      const floor = below ? below.point[1] : 0;
      p.velocity = [a.x * p.speed, (floor + ctx.state.height - p.bottom) * 4, a.z * p.speed];
      p._walked = true;
    },
  });
})();
