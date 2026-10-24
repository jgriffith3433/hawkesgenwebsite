// The wall tool, in the editor: V where a wall starts, V again where it ends (it keeps going from there; X stops).
// Looking at a wall (one you drew, or a wall thing), N cuts a doorway with a door where you look, M a window.
// On a phone, the 🧱 button is V. Every wall is a "wall" thing in scene.json, so undo, the assistant and friends see it.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const RAD = Math.PI / 180;
  const W = () => H.world;
  const snap = (v, s = 0.25) => Math.round(v / s) * s;
  const r2 = (n) => Math.round(n * 100) / 100;
  let start = null, preview = null, marker = null, btn = null;

  function point() {
    const hit = H.game && H.game.aim(40);
    if (!hit) return null;
    return { at: [snap(hit.point[0]), r2(hit.point[1]), snap(hit.point[2])], entity: hit.entity, raw: hit.point };
  }
  function clear() {
    start = null;
    if (preview) { preview.dispose(); preview = null; }
    if (marker) { marker.dispose(); marker = null; }
  }
  function toast(t) { if (H.game) H.game.ui.message(t, 1.6); }
  function mark(at) {
    const m = new B.StandardMaterial('wall-tool', W().scene);
    m.emissiveColor = new B.Color3(0.49, 0.95, 0.76); m.disableLighting = true; m.alpha = 0.6;
    marker = B.MeshBuilder.CreateCylinder('wall-start', { diameter: 0.35, height: 3, tessellation: 12 }, W().scene);
    marker.position.set(at[0], at[1] + 1.5, at[2]);
    marker.material = m; marker.isPickable = false; marker.metadata = { decor: true };
    preview = B.MeshBuilder.CreateBox('wall-preview', { width: 1, height: 2.8, depth: 0.2 }, W().scene);
    preview.material = m; preview.isPickable = false; preview.metadata = { decor: true };
    preview.setEnabled(false);
  }
  /** The wall from a to b, as a scene thing. */
  function wallSpec(a, b) {
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    let yaw = Math.atan2(-dz, dx) / RAD;
    yaw = Math.round(yaw / 15) * 15;
    return { type: 'wall', name: 'Wall', transform: { position: [r2((a[0] + b[0]) / 2), r2(a[1]), r2((a[2] + b[2]) / 2)], rotation: [0, yaw, 0] }, shape: { length: r2(len + 0.2), height: 2.8 } };
  }
  /** The wall thing (scene) a looked-at piece belongs to, and where along it (meters from its middle). */
  function wallAt(p) {
    let e = p && p.entity;
    if (e && e._homesOwner) e = e._homesOwner;
    if (!e || e.kind !== 'wall' || !e.sceneId) return null;
    const yaw = e.node.rotation.y;
    const dx = p.raw[0] - e.x, dz = p.raw[2] - e.z;
    return { e, along: r2(dx * Math.cos(yaw) - dz * Math.sin(yaw)) };
  }
  function cut(kind) {
    const w = wallAt(point());
    if (!w) { toast('Look at a wall (one drawn with V) to cut a ' + kind); return; }
    const spec = W().graph.entities[w.e.sceneId];
    const openings = ((spec.shape && spec.shape.openings) || []).concat([{ type: kind, at: w.along }]);
    window.HawkesBuild.edit([{ op: 'update', id: w.e.sceneId, patch: { shape: { openings } } }], { label: `a ${kind} in the wall` });
    toast(kind === 'door' ? 'A doorway with a door' : 'A window');
  }
  function newId() { for (;;) { const id = `wall_${Math.random().toString(36).slice(2, 6)}`; if (!W().graph.entities[id]) return id; } }

  H.hooks.frame.push(() => {
    const building = H.mode === 'build' && W() && window.HawkesBuild;
    if (H.touchUi) {
      if (building && !btn) {
        btn = document.createElement('button');
        btn.textContent = '🧱';
        btn.title = 'Wall tool';
        btn.style.cssText = 'position:fixed;right:max(22px,env(safe-area-inset-right));bottom:250px;width:54px;height:54px;border-radius:50%;border:1px solid rgba(255,255,255,.45);background:rgba(255,255,255,.14);color:#fff;font:22px/1 system-ui;z-index:6;touch-action:none';
        H.bindTouchKey(btn, 'v');
        document.body.appendChild(btn);
      } else if (!building && btn) { btn.remove(); btn = null; }
    }
    if (!building) { if (start) clear(); return; }
    const k = H.input.pressed;
    if (k.has('x') && start) { clear(); toast('Wall tool off'); return; }
    if (k.has('n')) cut('door');
    if (k.has('m')) cut('window');
    const p = start || k.has('v') ? point() : null;
    if (start && preview && p) {
      const dx = p.at[0] - start[0], dz = p.at[2] - start[2], len = Math.hypot(dx, dz);
      preview.setEnabled(len > 0.3);
      preview.scaling.x = Math.max(0.01, len + 0.2);
      preview.position.set((start[0] + p.at[0]) / 2, start[1] + 1.4, (start[2] + p.at[2]) / 2);
      preview.rotation.y = Math.round((Math.atan2(-dz, dx) / RAD) / 15) * 15 * RAD;
    }
    if (!k.has('v') || !p) return;
    if (!start) { start = p.at; mark(start); toast('Wall: V again where it ends · X stops'); return; }
    const len = Math.hypot(p.at[0] - start[0], p.at[2] - start[2]);
    if (len < 0.5) { clear(); toast('Wall tool off'); return; }
    const spec = wallSpec(start, p.at);
    spec.id = newId();
    window.HawkesBuild.edit([{ op: 'create', entity: spec }], { label: 'a wall', fx: 'materialize' });
    const next = p.at;
    clear();
    start = next; mark(start);
    toast('V: the next wall from here · N door · M window · X stops');
  });
  H.hooks.world.push({ leave() { start = null; preview = null; marker = null; } });
})();
