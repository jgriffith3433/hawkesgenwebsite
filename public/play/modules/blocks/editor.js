// Building with blocks (the editor's sandbox only). A "⛏ Blocks" button opens it: with no blocks yet it offers a world
// (hills, caves, flat, desert, snowy, empty) round where you are; with blocks, click takes the block you look at out,
// shift+click (or R) puts the picked block on the face you look at, and the bar under the game picks (every block, no bag while
// building). What you change is saved as config.blocks.edits, a moment after you stop, so it is part of the game.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const C = window.HawkesBlocksCore;
  const MAX_EDITS = 9000; // (about 110 KB of the world file, which may hold 240 KB in all)
  const st = { open: false, seq: 2000000, saveAt: 0, world: 'hills' };

  const css = document.createElement('style');
  css.textContent = `
    .bb-blocks { position: fixed; left: 12px; top: 160px; z-index: 6; font: 500 12px/1.3 system-ui, sans-serif; color: #e8eef7; }
    .bb-blocks > button { background: rgba(14,18,28,.82); color: #e8eef7; border: 1px solid rgba(255,255,255,.18); border-radius: 10px; padding: 7px 11px; cursor: pointer; font: inherit; }
    .bb-blocks > button.on { border-color: #4a9eff; background: rgba(74,158,255,.25); }
    .bb-blocks .bb-panel { margin-top: 6px; background: rgba(14,18,28,.9); border: 1px solid rgba(255,255,255,.14); border-radius: 12px; padding: 10px; width: 220px; display: grid; gap: 8px; }
    .bb-blocks select, .bb-blocks .bb-go { background: #1b2232; color: inherit; border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: 6px; font: inherit; }
    .bb-blocks .bb-go { background: #4a9eff; border: 0; color: #fff; cursor: pointer; }
    .bb-blocks .bb-note { opacity: .7; font-size: 11px; }`;
  document.head.appendChild(css);
  const el = document.createElement('div');
  el.className = 'bb-blocks';
  el.hidden = true;
  el.innerHTML = '<button type="button" class="bb-open">⛏ Blocks</button><div class="bb-panel" hidden></div>';
  document.body.appendChild(el);
  const panel = el.querySelector('.bb-panel');
  const openBtn = el.querySelector('.bb-open');
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  openBtn.onclick = (e) => { e.stopPropagation(); st.open = !st.open; render(); };

  const config = () => (H.world && H.world.graph && H.world.graph.config) || {};
  const active = () => Boolean(H.blocks && H.blocks.active);
  const editing = () => st.open && H.mode === 'build' && active();
  function send(patch, label) {
    const ops = [{ op: 'config', patch }];
    H.applyOps(ops, { local: true });
    H.post({ type: 'ops', ops, seq: ++st.seq });
    if (label && H.game) H.game.ui.message(label, 1.4);
  }
  function render() {
    openBtn.classList.toggle('on', st.open);
    panel.hidden = !st.open;
    if (H.blocks) H.blocks._.ui.show(editing());
    if (!st.open) return;
    if (!active()) {
      panel.innerHTML = `<div>No blocks in this world yet.</div>
        <select class="bb-world">${Object.entries(C.WORLDS).map(([k, v]) => `<option value="${k}" ${k === st.world ? 'selected' : ''}>${k}: ${v}</option>`).join('')}</select>
        <button type="button" class="bb-go">Grow a block world here</button>
        <div class="bb-note">48 by 48 blocks, 32 tall, round where you stand. The assistant can make one too: "make a voxel mining game".</div>`;
      panel.querySelector('.bb-world').onchange = (e) => { st.world = e.target.value; };
      panel.querySelector('.bb-go').onclick = () => {
        const p = H.world && H.world.player;
        const at = p ? (H.hooks.space ? scenePoint(p) : [Math.round(p.x), Math.round(p.bottom) - 14, Math.round(p.z)]) : [0, 0, 0];
        send({ blocks: { world: st.world, at, seed: Math.floor(Math.random() * 100000) } }, 'A block world');
        render();
      };
      return;
    }
    const n = (config().blocks && config().blocks.edits || []).length;
    panel.innerHTML = `<div><b>Click</b> takes a block out, <b>shift+click</b> or <b>R</b> puts the picked one in. The bar picks.</div>
      <div class="bb-note">${n} change${n === 1 ? '' : 's'} saved in the world. Players mine with the pickaxe (config.player.tool "pickaxe").</div>
      <button type="button" class="bb-go bb-off">Remove the blocks</button>`;
    panel.querySelector('.bb-off').onclick = () => { if (window.confirm('Remove the whole block world?')) { send({ blocks: null }, 'Blocks removed'); render(); } };
  }
  /** Where the player is, in the world file's frame (a round world), the blocks' bottom middle a bit under their feet. */
  function scenePoint(p) {
    const sc = H.planet && H.planet.frame && H.planet.frame.toScene ? H.planet.frame.toScene({ position: [p.x, p.bottom - 14, p.z], rotation: 0 }) : { position: [p.x, p.bottom - 14, p.z] };
    return sc.position.map((v) => Math.round(v));
  }
  // The world's changes, saved a moment after the last one (one config op, not one per block).
  function saveSoon() { st.saveAt = performance.now() + 700; }
  function save() {
    st.saveAt = 0;
    if (!active()) return;
    const raw = config().blocks;
    if (!raw || typeof raw !== 'object') return;
    const edits = H.blocks.edits();
    if (edits.length > MAX_EDITS) { H.game.ui.message(`Too many changes to save (${edits.length}, at most ${MAX_EDITS})`, 2); return; }
    send({ blocks: { ...raw, edits } });
    render();
  }

  const canvas = () => document.getElementById('stage');
  function act(place) {
    const hit = H.blocks.aim(12);
    if (!hit) return false;
    if (place) {
      const x = hit.x + hit.n[0], y = hit.y + hit.n[1], z = hit.z + hit.n[2];
      if (!H.blocks.place(x, y, z, H.blocks.picked)) return false;
    } else if (hit.floor || !H.blocks.mine(hit.x, hit.y, hit.z)) return false;
    saveSoon();
    return true;
  }
  // Desktop: clicks on the game while the panel is open are for the blocks (caught before the editor's grab).
  window.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0 || ev.target !== canvas() || !editing()) return;
    if (act(ev.shiftKey)) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  H.hooks.frame.push(() => {
    el.hidden = H.mode !== 'build';
    if (!editing()) return;
    const g = H.game;
    if (g && g.input.pressed('r')) act(true);
    if (st.saveAt && performance.now() > st.saveAt) save();
  });
})();
