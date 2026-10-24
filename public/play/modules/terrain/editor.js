// The terraform brush (building only: loaded in the editor's sandbox). A "Terrain" button opens it: raise, lower,
// flatten, smooth, paint (grass, dirt, rock, snow, sand), a size and a strength. Drag on the ground to shape it (on a
// phone, hold "Brush" and look where to shape). Each stroke is one edit saved in scene.json config.terrain.edits, so
// it's part of the game and everyone building sees it. With no terrain yet, the panel offers one ("Add ground").
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const T = window.HawkesTerrainCore;
  const BUDGET = 120 * 1024; // config.terrain's share of the scene (the whole scene may be 240 KB)
  const TOOLS = [['raise', '▲', 'Raise'], ['lower', '▼', 'Lower'], ['flatten', '▬', 'Flatten'], ['smooth', '≈', 'Smooth'], ['paint', '🖌', 'Paint']];
  const st = { open: false, tool: 'raise', layer: 'dirt', size: 6, strength: 1, stroke: null, ring: null, hover: null, seq: 1000000 };

  const css = document.createElement('style');
  css.textContent = `
    .tb-terrain { position: fixed; left: 12px; top: 120px; z-index: 6; font: 500 12px/1.3 system-ui, sans-serif; color: #e8eef7; }
    .tb-terrain > button.tb-open { background: rgba(14,18,28,.82); color: #e8eef7; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; padding: 7px 11px; cursor: pointer; font: inherit; }
    .tb-terrain .tb-panel { margin-top: 6px; background: rgba(14,18,28,.9); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 10px; width: 216px; display: grid; gap: 8px; }
    .tb-terrain .tb-row { display: flex; gap: 4px; flex-wrap: wrap; }
    .tb-terrain .tb-row button { flex: 1; min-width: 36px; background: rgba(255,255,255,.08); color: inherit; border: 1px solid transparent; border-radius: 8px; padding: 6px 4px; cursor: pointer; font: inherit; }
    .tb-terrain .tb-row button.on { border-color: #4a9eff; background: rgba(74,158,255,.22); }
    .tb-terrain label { display: grid; grid-template-columns: 60px 1fr 28px; align-items: center; gap: 6px; }
    .tb-terrain input[type=range] { width: 100%; }
    .tb-terrain select { background: #1b2232; color: inherit; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: 4px; font: inherit; }
    .tb-terrain .tb-note { opacity: .7; font-size: 11px; }
    .tb-terrain .tb-hold { display: none; }
    body.touch .tb-terrain .tb-hold, .tb-terrain.touch .tb-hold { display: block; width: 100%; padding: 12px; border-radius: 10px; background: rgba(74,158,255,.3); color: #fff; border: 1px solid #4a9eff; font: 600 14px system-ui; touch-action: none; }`;
  document.head.appendChild(css);

  const el = document.createElement('div');
  el.className = `tb-terrain${H.touchUi ? ' touch' : ''}`;
  el.hidden = true;
  el.innerHTML = `<button class="tb-open" type="button">⛰ Terrain</button><div class="tb-panel" hidden></div>`;
  document.body.appendChild(el);
  const panel = el.querySelector('.tb-panel');
  el.querySelector('.tb-open').onclick = (e) => { e.stopPropagation(); st.open = !st.open; render(); };
  el.addEventListener('pointerdown', (e) => e.stopPropagation());

  const config = () => (H.world && H.world.graph && H.world.graph.config) || {};
  const terrainCfg = () => { const c = config().terrain; return c && typeof c === 'object' ? c : c ? (typeof c === 'string' ? { shape: c } : {}) : null; };
  function send(patch, label) {
    const ops = [{ op: 'config', patch }];
    H.applyOps(ops, { local: true });
    H.post({ type: 'ops', ops, seq: ++st.seq });
    if (label) toast(label);
  }
  function toast(text) { if (H.game && H.game.ui) H.game.ui.message(text, 1.4); }

  function render() {
    const on = Boolean(H.terrain && H.terrain.active);
    panel.hidden = !st.open;
    if (!st.open) return;
    if (!on) {
      panel.innerHTML = `<div>No terrain in this world yet.</div>
        <select class="tb-shape">${Object.entries(T.SHAPES).map(([k, v]) => `<option value="${k}">${k}: ${v.what}</option>`).join('')}</select>
        <button class="tb-add" type="button" style="padding:8px;border-radius:8px;background:#4a9eff;color:#fff;border:0;cursor:pointer">Add ground</button>
        <div class="tb-note">Big ground you can drive across, dig into and shape. The assistant can make it too: "make an island with a beach".</div>`;
      panel.querySelector('.tb-add').onclick = () => { send({ terrain: { shape: panel.querySelector('.tb-shape').value } }, 'Terrain added'); render(); };
      return;
    }
    const c = terrainCfg() || {};
    const used = JSON.stringify(c).length;
    panel.innerHTML = `
      <div class="tb-row">${TOOLS.map(([k, i, t]) => `<button type="button" data-tool="${k}" class="${st.tool === k ? 'on' : ''}" title="${t}">${i}<br>${t}</button>`).join('')}</div>
      ${st.tool === 'paint' ? `<div class="tb-row">${T.LAYERS.map((l) => `<button type="button" data-layer="${l}" class="${st.layer === l ? 'on' : ''}">${l}</button>`).join('')}<button type="button" data-layer="erase" class="${st.layer === 'erase' ? 'on' : ''}">erase</button></div>` : ''}
      <label>Size <input type="range" min="1" max="40" step="1" value="${st.size}" data-k="size"><span>${st.size}</span></label>
      <label>Strength <input type="range" min="0.2" max="3" step="0.1" value="${st.strength}" data-k="strength"><span>${st.strength}</span></label>
      <button class="tb-hold" type="button">Hold to brush</button>
      <div class="tb-row"><button type="button" class="tb-undo">Undo stroke</button><button type="button" class="tb-clear">Clear edits</button></div>
      <div class="tb-note">${H.touchUi ? 'Hold the button and look where to shape.' : 'Drag on the ground to shape it.'} ${(c.edits || []).length} edits · ${Math.round(used / 1024)} of ${BUDGET / 1024} KB</div>`;
    panel.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => { st.tool = b.dataset.tool; render(); }; });
    panel.querySelectorAll('[data-layer]').forEach((b) => { b.onclick = () => { st.layer = b.dataset.layer; render(); }; });
    panel.querySelectorAll('input[type=range]').forEach((r) => { r.oninput = () => { st[r.dataset.k] = Number(r.value); r.nextElementSibling.textContent = r.value; }; });
    panel.querySelector('.tb-undo').onclick = () => {
      const list = (terrainCfg() || {}).edits || [];
      if (!list.length) return toast('No terrain edits to undo');
      send({ terrain: { edits: list.slice(0, -1) } }, 'Undid a terrain stroke');
      render();
    };
    panel.querySelector('.tb-clear').onclick = () => { send({ terrain: { edits: [] } }, 'Terrain back to its shape'); render(); };
    const hold = panel.querySelector('.tb-hold');
    hold.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); begin(null); st.holding = true; });
    const up = () => { if (st.holding) { st.holding = false; finish(); } };
    hold.addEventListener('pointerup', up); hold.addEventListener('pointercancel', up); hold.addEventListener('pointerleave', up);
  }

  // ------------------------------------------------------------------ brushing
  const canvas = () => document.querySelector('canvas');
  /** The ground under the mouse (or the crosshair): [x, y, z] or null. */
  function groundAt(ev) {
    const w = H.world;
    if (!w || !H.terrain || !H.terrain.active) return null;
    const pred = (m) => { const e = H.entityOf(m); return Boolean(e && e.isTerrain && m.isPickable); };
    let pick;
    if (ev && !document.pointerLockElement) { const r = canvas().getBoundingClientRect(); pick = w.scene.pick(ev.clientX - r.left, ev.clientY - r.top, pred); }
    else pick = w.scene.pickWithRay(w.scene.activeCamera.getForwardRay(300), pred);
    return pick && pick.hit ? [pick.pickedPoint.x, pick.pickedPoint.y, pick.pickedPoint.z] : null;
  }
  const q = (v) => Math.round(v * 10) / 10;
  function amount() {
    if (st.tool === 'raise' || st.tool === 'lower') return q(0.12 * st.strength * Math.max(1, st.size / 6));
    if (st.tool === 'smooth') return q(Math.min(1, 0.25 * st.strength));
    if (st.tool === 'paint') return st.layer === 'erase' ? -1 : T.LAYERS.indexOf(st.layer);
    return 0;
  }
  function begin(ev) {
    if (!brushing()) return false;
    const p = groundAt(ev);
    if (!p) return false;
    const op = st.tool;
    const a = op === 'flatten' ? q(p[1]) : amount();
    st.stroke = { op, r: q(st.size), a, pts: [], last: null, ev };
    dab(p);
    return true;
  }
  function dab(p) {
    const s = st.stroke;
    if (!s) return;
    const x = q(p[0]), z = q(p[2]);
    if (s.last && Math.hypot(x - s.last[0], z - s.last[1]) < Math.max(0.3, s.r * 0.3)) return;
    if (s.pts.length >= 400) return;
    s.last = [x, z];
    s.pts.push(x, z);
    H.terrain._applyLocal([[s.op, s.r, s.a, x, z]]);
  }
  function finish() {
    const s = st.stroke;
    st.stroke = null;
    if (!s || !s.pts.length) return;
    const editOne = [s.op, s.r, s.a, ...s.pts];
    const c = terrainCfg() || {};
    const list = [...(c.edits || []), editOne];
    if (JSON.stringify({ ...c, edits: list }).length > BUDGET) { toast('The terrain is full of edits: undo some, or ask the assistant for a new shape'); return; }
    const t = H.terrain._cur;
    if (t) t.preview.set(JSON.stringify(editOne), true);
    send({ terrain: { edits: list } });
    render();
  }
  const brushing = () => st.open && H.mode === 'build' && H.terrain && H.terrain.active;

  // Desktop: drag on the ground with the brush open. Caught before the editor's grab (it can't grab the ground anyway).
  window.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0 || ev.target !== canvas() || !brushing()) return;
    if (begin(ev)) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  window.addEventListener('pointermove', (ev) => { st.hoverEv = ev; if (st.stroke && st.stroke.ev) { const p = groundAt(ev); if (p) dab(p); } }, true);
  window.addEventListener('pointerup', () => { if (st.stroke && st.stroke.ev) finish(); }, true);

  // The ring that shows where and how big the brush is; the hold-to-brush stroke follows the crosshair.
  function ring() {
    const w = H.world;
    if (!brushing()) { if (st.ring && !st.ring.isDisposed()) st.ring.setEnabled(false); return; }
    const p = st.holding || document.pointerLockElement || H.touchUi ? groundAt(null) : groundAt(st.hoverEv);
    if (st.stroke && !st.stroke.ev && p) dab(p);
    if (!st.ring || st.ring.isDisposed() || st.ring.getScene() !== w.scene) {
      st.ring = B.MeshBuilder.CreateLines('terrain-brush', { points: Array.from({ length: 49 }, () => new B.Vector3()), updatable: true }, w.scene);
      st.ring.color = new B.Color3(0.3, 0.75, 1); st.ring.isPickable = false; st.ring.metadata = { decor: true, noGlow: true };
    }
    if (!p) { st.ring.setEnabled(false); return; }
    st.ring.setEnabled(true);
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * Math.PI * 2, x = p[0] + Math.cos(a) * st.size, z = p[2] + Math.sin(a) * st.size;
      pts.push(new B.Vector3(x, (H.terrain.heightAt(x, z) ?? p[1]) + 0.15, z));
    }
    B.MeshBuilder.CreateLines('terrain-brush', { points: pts, instance: st.ring });
  }
  H.hooks.frame.push(() => {
    el.hidden = H.mode !== 'build';
    if (el.hidden && st.stroke) finish();
    try { ring(); } catch (err) { /* a world being rebuilt */ }
  });
})();
