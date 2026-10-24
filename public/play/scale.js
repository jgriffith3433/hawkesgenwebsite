// Scale: keeping a world playable when it fills up (a hundred animals, a pile of crates, an explosion's debris).
//   H.budget = { entities, bodies, shadows, detail }  per device (a phone gets less); games and modules may lower or
//   raise them (game.json "budget": { ... } too).
//   - entities: past it, the oldest things scripts made (never the world's own, never players) are removed with a puff
//   - bodies:   at most this many dynamic things are simulated; the farthest from the camera rest where they are
//               (frozen) until you come closer
//   - shadows:  only the nearest this-many things cast shadows
//   - detail:   round things get fewer sides (kinds.js)
// Shared materials and instanced copies (game.many, "instanced": true) are in runtime.js; this file does the budgets.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const phone = Boolean(H.touchUi);
  const DEFAULTS = phone ? { entities: 900, bodies: 150, shadows: 30, detail: 0.5 } : { entities: 2500, bodies: 400, shadows: 160, detail: 1 };
  H.budget = { ...DEFAULTS };
  let born = 0;
  let t = 0;
  let warned = false;

  H.hooks.world.push({
    enter(w) {
      const b = w.config && w.config.budget;
      H.budget = { ...DEFAULTS, ...(b && typeof b === 'object' ? b : {}) };
      warned = false;
      t = 1;
    },
  });

  function each(dt) {
    const w = H.world;
    if (!w) return;
    for (const e of w.entities) if (!e._born) e._born = ++born;
    t += dt;
    if (t < 0.5) return;
    t = 0;
    const cam = w.scene.activeCamera;
    const c = cam ? cam.globalPosition || cam.position : { x: 0, y: 0, z: 0 };
    const dist = (e) => (e.x - c.x) ** 2 + (e.y - c.y) ** 2 + (e.z - c.z) ** 2;

    // Too many things: the oldest made by scripts go.
    const made = [];
    for (const e of w.entities) if (!e.sceneId && !e.isPlayer && !e.remotePlayer && e !== w.player && !e.keep && e.kind !== 'light') made.push(e);
    const over = w.entities.size - H.budget.entities;
    if (over > 0) {
      made.sort((a, b) => a._born - b._born);
      for (const e of made.slice(0, over)) { if (H.game) H.game.burst(e.position, { color: '#c8d8ff', count: 6, speed: 2 }); e.destroy(); }
      if (!warned) { warned = true; console.warn(`Hawkes Play: more than ${H.budget.entities} things; the oldest made ones make room (H.budget.entities)`); }
    }

    // Too many moving things: the farthest rest (frozen) until the camera comes near.
    const dyn = [];
    for (const e of w.entities) if (e.physics === 'dynamic' && e.alive && !e.remote && !e.held && !e.isPlayer) dyn.push(e);
    if (dyn.length > H.budget.bodies) {
      dyn.sort((a, b) => dist(a) - dist(b));
      dyn.forEach((e, i) => { const f = i >= H.budget.bodies; if (e._frozen !== f) { e._frozen = f; if (!f) e.wake(); } });
    } else for (const e of dyn) if (e._frozen) { e._frozen = false; e.wake(); }

    // Shadows from the nearest things only.
    const sg = w.shadows;
    if (sg) {
      const casters = [];
      for (const e of w.entities) if (e._casters && e._casters.size && e.alive && e.node.isEnabled()) casters.push(e);
      const list = sg.getShadowMap() && sg.getShadowMap().renderList;
      if (list) {
        if (casters.length > H.budget.shadows) casters.sort((a, b) => dist(a) - dist(b));
        const keep = [];
        for (const e of casters.slice(0, H.budget.shadows)) for (const m of e._casters) if (!m.isDisposed()) keep.push(m);
        // Shadows not from entities (a module's own meshes) stay.
        const owned = new Set();
        for (const e of casters) for (const m of e._casters) owned.add(m);
        const others = list.filter((m) => !owned.has(m) && !m.isDisposed());
        list.length = 0;
        list.push(...others, ...keep);
      }
    }
  }
  H.hooks.step.push(each);
})();
