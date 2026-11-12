// Mayhem, part 5: the island's small props react (J, 2026-11-12: "the world reacts to everything the player does").
// Fences, crates, signposts and the pier's barrels and pots are `breakable` things with `data.prop` ({ material, rebuild,
// with }); mayhem.js breaks them (a vehicle over their `strength`, a blast over `blast`) into 4 to 12 pieces. This file adds
// what is around that: pieces float or sink by material, a blast that does not break a prop topples it, a broken or
// toppled prop is rebuilt at home after `rebuild` seconds once nobody is looking, and `window.__props` keeps the log
// (break, topple, splash, restore) the playtest reads. Never touches a quest thing (mayhem.js protectedProp).
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const X = H.mayhem;
  const M = H.mayhemMath;
  const W = () => H.world;
  const G = () => H.game;

  const state = window.__props = { log: [], counts: {}, pieces: {}, maxPieces: 0 };
  const note = (type, d) => {
    state.counts[type] = (state.counts[type] || 0) + 1;
    state.log.push({ type, t: Math.round((W() ? W().time : 0) * 100) / 100, ...d });
    if (state.log.length > 300) state.log.shift();
  };
  const propOf = (e) => (e && e.data && e.data.prop) || null;
  const idOf = (e) => (e && (e.sceneId || e.name)) || '?';
  const props = () => (W() ? [...W().entities].filter((e) => e.alive && propOf(e) && e.sceneId) : []);

  // ------------------------------------------------------------------ rebuilding, out of view
  const pending = new Set();
  /** In front of the camera and near: rebuilding now would be seen. */
  function seen(e) {
    const w = W(), cam = w && w.scene && w.scene.activeCamera;
    if (!cam || !e.home) return false;
    const p = e.home.position;
    const dx = p[0] - cam.position.x, dy = p[1] - cam.position.y, dz = p[2] - cam.position.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 70) return false;
    if (d < 6) return true;
    const f = cam.getForwardRay(1).direction;
    return (dx * f.x + dy * f.y + dz * f.z) / d > 0.35;
  }
  function restore(e) {
    if (!e.alive) return;
    pending.delete(e);
    if (e._propStatic) { e.physics = 'static'; e._propStatic = false; }
    e._shattered = false; e._toppled = false; e.dead = false; e.ghost = false; e.visible = true;
    if (e.maxHp) e.hp = e.maxHp;
    if (e.upright === false && e._wasUpright !== undefined) e.upright = e._wasUpright;
    e.velocity = [0, 0, 0];
    if (e.home) { e.position = e.home.position; e.rotation = e.home.rotation; }
    note('restore', { id: idOf(e) });
    G().emit('prop-restored', { entity: e });
  }
  /** Back at home after `seconds`, but only once the player is not looking at the spot (tries again every few seconds). */
  function rebuildLater(e, seconds, waited = 0) {
    if (pending.has(e) && !waited && waited !== 0) return;
    pending.add(e);
    const g = G();
    g.after(seconds, () => {
      if (!e.alive) return;
      if (seen(e) && waited < 60) return rebuildLater(e, 4, waited + 4);
      restore(e);
    });
  }

  // ------------------------------------------------------------------ a break: float or sink, partners, rebuild
  function onBreak({ entity: e, pieces }) {
    const pr = propOf(e);
    const mid = [e.x, e.y, e.z];
    const pm = M.propMaterial(pr && pr.material);
    for (const p of pieces || []) if (pm) p.data.density = pm.density;
    state.pieces[idOf(e)] = (pieces || []).length;
    state.maxPieces = Math.max(state.maxPieces, (pieces || []).length);
    note('break', { id: idOf(e), pieces: (pieces || []).length, material: pr ? pr.material : null, at: mid.map((v) => Math.round(v * 10) / 10) });
    if (!pr || e.temporary) return;
    // The rest of a thing made of several (a signpost's board and words) goes with it.
    for (const id of pr.with || []) {
      const o = G().entity(id);
      if (!o || !o.alive || o._shattered) continue;
      if (o.kind === 'text') { o.visible = false; o._shattered = true; o.dead = true; } else if (X.shatterLocal) X.shatterLocal(o, { at: mid, force: 5, pieces: 4 });
      rebuildLater(o, pr.rebuild || 120);
    }
    rebuildLater(e, pr.rebuild || 120);
  }

  // ------------------------------------------------------------------ a blast that does not break a prop knocks it over
  const launches = [];
  function topple(e, at, R, F) {
    if (!e.alive || e._shattered || e._toppled || e.dead || X.protectedProp(e)) return;
    const dx = e.x - at[0], dz = e.z - at[2];
    const d = Math.hypot(dx, e.y - at[1], dz);
    const k = M.falloff(d, R);
    if (k <= 0.02) return;
    if (e.physics !== 'dynamic') { e._propStatic = true; e.physics = 'dynamic'; }
    e._toppled = true;
    const l = Math.hypot(dx, dz) || 1;
    const push = Math.max(2.5, F * k * 0.5);
    launches.push({ e, v: [(dx / l) * push, 1.5 + k * 4, (dz / l) * push], wait: 2 });
    note('topple', { id: idOf(e), dist: Math.round(d * 10) / 10 });
    G().emit('topple', { entity: e, distance: d });
    rebuildLater(e, (propOf(e) && propOf(e).rebuild) || 120);
  }
  function onBlast(d) {
    if (!W() || !d || d.authoritative === false) return;
    const at = d.position, R = d.radius || 5, F = d.force || 18;
    for (const e of props()) if (!e._shattered) topple(e, at, R, F);
  }
  // A step after the body turns dynamic: the shove and the spin (a body made this step ignores a velocity set in it).
  X.steps.push(() => {
    for (let i = launches.length - 1; i >= 0; i--) {
      const l = launches[i];
      if (--l.wait > 0) continue;
      launches.splice(i, 1);
      if (!l.e.alive) continue;
      X.launch(l.e, l.v);
      X.tumble(l.e, 1.2);
    }
  });

  // ------------------------------------------------------------------ splashes: logged with what fell in
  function onSplash(d) {
    const e = d && d.entity;
    note('splash', { id: idOf(e), size: Math.round((d.size || 0) * 100) / 100, player: Boolean(e && e.isPlayer), debris: Boolean(e && e.data && e.data.debris), at: (d.at || []).map((v) => Math.round(v * 10) / 10) });
  }

  H.hooks.world.push({
    enter() {
      state.log.length = 0; state.counts = {}; state.pieces = {}; state.maxPieces = 0;
      const g = G();
      g.on('break', onBreak);
      g.on('explosion', onBlast);
      g.on('splash', onSplash);
    },
    leave() { pending.clear(); launches.length = 0; },
  });
  X.props = { state, restore, topple: (e, at, R, F) => topple(e, at, R, F), rebuildLater, seen };
})();
