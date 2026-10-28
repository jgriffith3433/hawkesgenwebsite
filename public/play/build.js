// Building inside the game (the editor's sandbox only). You are a player in your own world:
//   - the HUD says what you're looking at, in plain words
//   - hold the mouse on something to grab it, move it around, throw it (scroll: closer/farther, Q/E: turn it)
//   - double-click something for its card, right there in the world: name, how it moves, color, size, what it does,
//     and a line to the assistant about it
//   - 1-9 (or the hotbar) puts a new thing where you look; Delete removes, C copies, Ctrl+Z undoes
//   - F (or double-tap space) flies; Tab switches between building and playing
// Every change is an op (src/scene.ts): applied here at once, then sent to the editor, which saves it and the server
// tells everyone else. The editor page talks to this through postMessage (see editor.js).
/* global HawkesPlay, HawkesNet, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const $ = (id) => document.getElementById(id);
  const RAD = Math.PI / 180;
  const toParent = (m) => H.post(m);
  const W = () => H.world;
  let makeBtn = null; // the card's "Make it with AI" button waiting for the editor's card to be answered
  const G = () => H.game;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const r2 = (n) => Math.round(n * 100) / 100;
  const touchUi = H.touchUi;

  let advanced = false;
  let target = null; // what the crosshair (or the mouse) is on
  let hit = null;
  let grab = null; // { e, dist, before, v, last, touch }
  let popup = null; // { e, el }
  let selected = null;
  let hl = null;
  let gizmos = null;

  // ------------------------------------------------------------------ words for things
  // Every kind's word, card and hotbar come from the kind registry (H.kinds, kinds.js and modules).
  const editorOf = (kind) => { const k = H.kinds.get(kind); return (k && k.editor) || {}; };
  const KIND = new Proxy({}, { get: (_, kind) => editorOf(String(kind)).word || null });
  const MOTION = { static: 'stays put', dynamic: 'falls · can be thrown', kinematic: 'moves by itself', trigger: 'walk-through zone', none: 'decoration · walk through' };
  function describe(e) {
    if (e.remotePlayer) return { name: e.name, bits: ['another player'] };
    const bits = [KIND[e.kind] || e.kind];
    if (e.waypoint) { bits[0] = { waypoint: 'a waypoint', checkpoint: 'a checkpoint: you come back here', finish: 'the finish', start: 'a start' }[e.waypoint.role] || 'a waypoint'; if (e.waypoint.next) bits.push(`leads to ${e.waypoint.next}`); }
    else if (e.kind !== 'light' && e.kind !== 'spawn') bits.push(MOTION[e.physics] || e.physics);
    for (const b of e.behaviors || []) {
      const d = b.def;
      bits.push(d ? (d.says ? d.says(b.o) : d.title || b.name) : `${b.name} (unknown)`);
    }
    if (e._waiting) bits.push('waiting for its model');
    return { name: e.name || e.sceneId || KIND[e.kind] || e.kind, bits };
  }
  const canGrab = (e) => {
    if (!e || !e.sceneId || e.remotePlayer || e.isPlayer || e.temporary) return false;
    if (e.grabbable === false) return false;
    const s = e.size;
    if (e.kind === 'plane' || Math.max(s[0], s[2]) > 14 || s[1] > 14) return false;
    if (HawkesNet && HawkesNet.online) { const o = HawkesNet.ownerOf(e.sceneId); if (o && o !== HawkesNet.me && e.held) return false; }
    return true;
  };

  // ------------------------------------------------------------------ edits: ops, undo, sending
  let seq = 0;
  const pending = new Map();
  const undoStack = [];
  const redoStack = [];
  function newId(base) {
    const b = String(base || 'thing').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'thing';
    for (;;) { const id = `${b}_${Math.random().toString(36).slice(2, 6)}`; if (!W().graph.entities[id]) return id; }
  }
  // Undo and redo are yours alone: each step remembers exactly which fields you changed (from what, to what), and
  // undoing puts back only the ones still as you left them, so a change someone else made since (another builder, a
  // friend playing) is never undone by you. Things you made are taken away, things you removed come back (with what
  // was inside them), unless someone has already done that. A step that the server refused is dropped from the list.
  const plain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const stable = (v) => JSON.stringify(v, (k, x) => (plain(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));
  const same = (a, b) => stable(a) === stable(b);
  const getAt = (o, path) => { let x = o; for (const k of path) { if (!plain(x)) return undefined; x = x[k]; } return x; };
  const setAt = (o, path, v) => { let x = o; path.slice(0, -1).forEach((k) => { if (!plain(x[k])) x[k] = {}; x = x[k]; }); x[path[path.length - 1]] = v; };
  /** The fields a patch changes on `base`, as paths (patches merge: objects into objects, anything else replaces). */
  function leaves(patch, base, path = [], out = []) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (plain(v) && plain(base && base[k])) leaves(v, base[k], [...path, k], out);
      else out.push([...path, k]);
    }
    return out;
  }
  /** The patch that turns `a` into `b` (keys gone from b are null). */
  function diff(a, b) {
    const p = {};
    for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
      if (k === 'id') continue;
      if (same(a[k], b[k])) continue;
      p[k] = b[k] === undefined ? null : plain(a[k]) && plain(b[k]) ? diff(a[k], b[k]) : clone(b[k]);
    }
    return p;
  }
  const mergeCopy = (base, patch) => H.merge(clone(base || {}), patch);
  /** What one edit did, kept for undoing it (taken before it's applied). */
  function remember(ops) {
    const g = W().graph;
    const steps = [];
    for (const op of ops) {
      if (op.op === 'create') steps.push({ kind: 'create', id: op.entity.id, spec: clone(op.entity) });
      else if (op.op === 'update' || op.op === 'replace') {
        const id = op.id || op.entity.id;
        const before = g.entities[id];
        if (!before) { if (op.op === 'replace') steps.push({ kind: 'create', id, spec: clone(op.entity) }); continue; }
        const patch = op.op === 'replace' ? diff(before, op.entity) : clone(op.patch);
        steps.push({ kind: 'update', id, before: clone(before), after: mergeCopy(before, patch), paths: leaves(patch, before) });
      } else if (op.op === 'delete') {
        const gone = [op.id];
        for (let i = 0; i < gone.length; i++) for (const s of Object.values(g.entities)) if (s.parent === gone[i] && !gone.includes(s.id)) gone.push(s.id);
        steps.push({ kind: 'delete', specs: gone.filter((id) => g.entities[id]).map((id) => clone(g.entities[id])) });
      } else if (op.op === 'config') {
        const before = clone(g.config || {});
        steps.push({ kind: 'config', before, after: mergeCopy(before, op.patch), paths: leaves(op.patch, before) });
      }
    }
    return steps;
  }
  /** The ops that take steps back (dir -1) or forward again (dir 1), only where things are still as they were left. */
  function replay(steps, dir) {
    const g = W().graph;
    const ops = [];
    let kept = 0;
    const list = dir < 0 ? [...steps].reverse() : steps;
    for (const s of list) {
      if (s.kind === 'create') {
        if (dir < 0) { if (g.entities[s.id]) ops.push({ op: 'delete', id: s.id }); }
        else if (!g.entities[s.id]) ops.push({ op: 'create', entity: clone(s.spec) });
      } else if (s.kind === 'delete') {
        if (dir < 0) { for (const sp of s.specs) if (!g.entities[sp.id]) ops.push({ op: 'create', entity: clone(sp) }); }
        else if (s.specs[0] && g.entities[s.specs[0].id]) ops.push({ op: 'delete', id: s.specs[0].id });
      } else {
        const now = s.kind === 'config' ? g.config : g.entities[s.id];
        if (!now) continue; // (someone removed it since)
        const [from, to] = dir < 0 ? [s.after, s.before] : [s.before, s.after];
        const patch = {};
        let any = false;
        for (const path of s.paths) {
          if (!same(getAt(now, path), getAt(from, path))) { kept++; continue; } // changed by someone else since: theirs
          const v = getAt(to, path);
          setAt(patch, path, v === undefined ? null : clone(v));
          any = true;
        }
        if (any) ops.push(s.kind === 'config' ? { op: 'config', patch } : { op: 'update', id: s.id, patch });
      }
    }
    return { ops, kept };
  }
  /** Changes the world: here first, then saved and shared. */
  function edit(ops, o = {}) {
    if (!ops.length) return;
    // A round world: what you did here is in the world around you, and the world file keeps it on the planet (undo and
    // redo are made from the world file: they already are).
    const sp = H.hooks.space;
    if (sp) { if (o.scene) sp.mark(ops); else sp.toScene(ops); }
    const steps = o.undo === false ? null : remember(ops);
    H.applyOps(ops, { local: true, fx: o.fx, short: o.short });
    const id = ++seq;
    pending.set(id, ops);
    toParent({ type: 'ops', ops, seq: id, fx: o.fx || null });
    if (steps && steps.length) { undoStack.push({ steps, label: o.label || '', seq: id }); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; }
    return id;
  }
  function travel(from, to, dir) {
    const u = from.pop();
    if (!u) { toast(dir < 0 ? 'Nothing to undo' : 'Nothing to redo'); return false; }
    const { ops, kept } = replay(u.steps, dir);
    // A removal taken back (undo of a delete, redo of a create) beams the thing in again, a short beam.
    const back = ops.some((x) => x.op === 'create');
    if (ops.length) u.seq = edit(ops, { undo: false, scene: true, fx: back && H.arrive ? 'beam' : undefined, short: back });
    to.push(u);
    const what = u.label || 'that';
    toast(!ops.length ? `Nothing left to ${dir < 0 ? 'undo' : 'redo'} in ${what}: someone changed it since` : `${dir < 0 ? 'Undid' : 'Redid'} ${what}${kept ? ' (kept the changes others made since)' : ''}`);
    return true;
  }
  function undo() { return travel(undoStack, redoStack, -1); }
  function redo() { return travel(redoStack, undoStack, 1); }
  /** The server refused an edit: it never happened, so it isn't on the list. */
  function refused(seqNo) { for (const s of [undoStack, redoStack]) { const i = s.findIndex((u) => u.seq === seqNo); if (i >= 0) s.splice(i, 1); } }
  const specOf = (e) => (e && e.sceneId ? W().graph.entities[e.sceneId] : null);
  const transformOf = (e) => ({ position: [r2(e.x), r2(e.y), r2(e.z)], rotation: e.rotation3.map((n) => Math.round(n * 10) / 10), scale: (() => { const s = e.node.scaling; return [r2(s.x), r2(s.y), r2(s.z)]; })() });
  function update(e, patch, label) { if (e && e.sceneId) edit([{ op: 'update', id: e.sceneId, patch }], { label }); }

  // ------------------------------------------------------------------ the HUD
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.innerHTML = `
    <div class="hud-cross" id="hudCross"></div>
    <div class="hud-look" id="hudLook" hidden><div class="hud-look-name" id="hudLookName"></div><div class="hud-look-bits" id="hudLookBits"></div></div>
    <div class="hud-hint" id="hudHint"></div>
    <div class="hud-top">
      <button class="hud-undo" id="hudUndo" type="button" title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
      <button class="hud-mode" id="hudMode" type="button" title="Tab"><span class="on">Building</span><span>Playing</span></button>
      <button class="hud-undo" id="hudRedo" type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
      <span class="hud-net" id="hudNet"></span>
    </div>
    <div class="hud-toast" id="hudToast"></div>
    <button class="hud-control" id="hudControl" type="button" title="Take control: move and look around (Esc to stop)"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>Take control</span></button>
    <div class="hud-controlling" id="hudControlling" hidden><b>CONTROLLING</b> · WASD FLY · SPACE/C UP & DOWN · F: WALK · HOLD Q: SPAWN · <kbd>ESC</kbd> TO RELEASE</div>
    <svg class="hud-leader" id="hudLeader"><line id="hudLine"/><circle id="hudDot" r="4"/></svg>
    <div class="hud-touch" id="hudTouch" hidden>
      <button class="tbtn" id="tGrab" type="button">✋<span>Grab</span></button>
      <button class="tbtn" id="tEdit" type="button">✎<span>Edit</span></button>
      <button class="tbtn" id="tFly" type="button">🕊<span>Fly</span></button>
    </div>`;
  document.body.appendChild(hud);
  /** The hotbar: every kind's editor.hotbar entries, by order; the first ten get the keys 1-9 and 0. */
  function hotbarList() {
    const all = [];
    for (const k of H.kinds.list()) for (const h of (k.editor && k.editor.hotbar) || []) all.push(h);
    all.sort((a, b) => (a.order ?? 500) - (b.order ?? 500));
    return all.map((h, i) => ({ ...h, k: i < 10 ? String((i + 1) % 10) : `#${i}` }));
  }
  $('hudMode').onclick = () => setMode(H.mode === 'build' ? 'play' : 'build');
  $('hudUndo').onclick = (ev) => { ev.stopPropagation(); undo(); };
  $('hudRedo').onclick = (ev) => { ev.stopPropagation(); redo(); };
  // A gamepad while building: D-pad left undoes, right redoes.
  let padUndo = { l: false, r: false };
  H.hooks.frame.push(() => {
    if (H.mode !== 'build' || !navigator.getGamepads) return;
    let gp = null;
    try { gp = [...navigator.getGamepads()].find((g) => g && g.connected); } catch { return; }
    if (!gp || !gp.buttons) return;
    const l = Boolean(gp.buttons[14] && gp.buttons[14].pressed), r = Boolean(gp.buttons[15] && gp.buttons[15].pressed);
    if (l && !padUndo.l) undo();
    if (r && !padUndo.r) redo();
    padUndo = { l, r };
  });
  // Building: the mouse is a pointer until you take control (the click has to happen in this frame to capture it).
  // If the browser won't capture the mouse, control still works: the cursor hides and moving the mouse looks around.
  let soft = false;
  $('hudControl').onclick = async (e) => {
    e.stopPropagation();
    if (popup) closePopup();
    const locked = await H.lockPointer();
    if (!locked) { soft = true; document.body.classList.add('soft-control'); }
    syncControl();
  };
  function release() { if (soft) { soft = false; document.body.classList.remove('soft-control'); } if (document.pointerLockElement) document.exitPointerLock(); if (grab && !grab.touch) dropGrab(false); syncControl(); }
  const controlling = () => H.mode !== 'build' || touchUi || H.input.mouse.locked || soft;
  H.hooks.canMove = controlling;
  H.hooks.lookAlways = () => soft && H.mode === 'build';
  document.addEventListener('pointerlockchange', () => { syncControl(); if (!document.pointerLockElement && grab && !grab.touch) dropGrab(false); });
  function syncControl() {
    const on = H.mode === 'build' && !touchUi && (H.input.mouse.locked || soft);
    $('hudControl').hidden = H.mode !== 'build' || touchUi || on;
    $('hudControlling').hidden = !on;
  }
  let toastT = 0;
  function toast(text) { const t = $('hudToast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); }

  function setMode(m) {
    if (soft) release();
    closePopup();
    dropGrab(false);
    if (m === 'build') H.game.input.release();
    H.setMode(m);
    syncMode();
    toParent({ type: 'mode', mode: m });
    if (m === 'play') {
      // The building UI stays a moment, then fades: you're playing now.
      hud.classList.add('intro');
      clearTimeout(setMode.t);
      setMode.t = setTimeout(() => hud.classList.remove('intro'), 2600);
      // No menu of its own at the start: the game takes the mouse (this runs inside the click, which browsers need).
      const p = W().player;
      const menu = document.querySelector('.ui-menu-wrap, .ui-popup-wrap, .ui-over');
      if (!menu && p && p.mouse !== 'free') H.game.input.capture();
    }
  }
  function syncMode() {
    const building = H.mode === 'build';
    hud.classList.toggle('playing', !building);
    document.body.classList.toggle('building', building);
    $('hudMode').children[0].classList.toggle('on', building);
    $('hudMode').children[1].classList.toggle('on', !building);
    // The editor's bar sits over the top of the game, and the hotbar over the bottom while building.
    H.hooks.uiTop = 64;
    syncControl();
    H.hooks.uiBottom = 90;
  }

  // ------------------------------------------------------------------ what you're looking at
  function aimRay() {
    const scene = W().scene;
    const cam = scene.activeCamera;
    const input = H.input;
    if (grab && grab.touch) return scene.createPickingRay(grab.sx, grab.sy, B.Matrix.Identity(), cam);
    if (input.mouse.locked || soft || touchUi || W().camera.mode === 'fps' && !hoverMode()) return cam.getForwardRay(200);
    return scene.createPickingRay(input.mouse.x, input.mouse.y, B.Matrix.Identity(), cam);
  }
  // Desktop without the mouse captured: point at things with the mouse, like an editor.
  const hoverMode = () => !touchUi && !H.input.mouse.locked && !soft;
  function pickAt(ray) {
    const w = W();
    const r = w.scene.pickWithRay(ray, (m) => { const en = H.entityOf(m); return Boolean(en && en.alive && en !== w.player && m.isEnabled() && m.isPickable !== false && !(m.metadata && m.metadata.decor) && !(grab && en === grab.e)); });
    return r && r.hit ? r : null;
  }
  function look() {
    const w = W();
    if (!w || !w.scene.activeCamera) return;
    hit = pickAt(aimRay());
    const e = hit ? H.entityOf(hit.pickedMesh) : null;
    const t = grab ? grab.e : e;
    if (t !== target) { target = t; highlight(); }
    const box = $('hudLook');
    if (!target || H.mode !== 'build') { box.hidden = true; } else {
      const d = describe(target);
      $('hudLookName').textContent = d.name;
      const dist = hit ? hit.distance : target.distanceTo(w.scene.activeCamera.position);
      $('hudLookBits').textContent = `${d.bits.join(' · ')} · ${dist.toFixed(1)} m`;
      box.hidden = false;
    }
    hint();
    const cross = $('hudCross');
    cross.classList.toggle('on', Boolean(target));
    cross.classList.toggle('grab', Boolean(grab));
    cross.hidden = (hoverMode() && !grab) || H.mode !== 'build';
  }
  function hint() {
    const h = $('hudHint');
    if (H.mode !== 'build') { h.textContent = ''; return; }
    if (popup) { h.textContent = 'ESC CLOSES THE CARD'; return; }
    if (grab) { h.textContent = touchUi ? 'DRAG TO MOVE · LET GO TO DROP · FLICK TO THROW' : 'MOVE TO CARRY · SCROLL: CLOSER / FARTHER · LET GO TO DROP · FLICK TO THROW'; return; }
    if (touchUi) { h.textContent = target ? 'HOLD TO GRAB · DOUBLE-TAP TO EDIT' : 'DRAG TO LOOK · + TO CREATE'; return; }
    h.textContent = target
      ? (canGrab(target) ? 'HOLD TO GRAB · DOUBLE-CLICK TO EDIT' : 'DOUBLE-CLICK TO EDIT')
      : (H.input.mouse.locked || soft ? '' : 'TAKE CONTROL TO MOVE · POINT AT SOMETHING TO GRAB OR EDIT · ENTER: ASSISTANT');
  }
  function highlight() {
    const w = W();
    if (!hl || hl._scene !== w.scene) { hl = new B.HighlightLayer('hl', w.scene, { isStroke: true, mainTextureRatio: 1 }); hl.innerGlow = false; hl.blurHorizontalSize = 0.6; hl.blurVerticalSize = 0.6; }
    hl.removeAllMeshes();
    const add = (e, c) => { if (!e || !e.alive) return; const ms = e.node.getChildMeshes ? [e.node, ...e.node.getChildMeshes()] : [e.node]; for (const m of ms) if (m instanceof B.Mesh && m.getTotalVertices() > 0 && !(m.metadata && m.metadata.decor)) try { hl.addMesh(m, c); } catch {} };
    if (H.mode !== 'build') return;
    if (target) add(target, grab ? new B.Color3(0.29, 0.62, 1) : new B.Color3(0.85, 0.9, 1));
    if (selected && selected !== target) add(selected, new B.Color3(0.66, 0.33, 0.97));
  }

  // ------------------------------------------------------------------ grabbing, carrying, throwing
  function startGrab(e, o = {}) {
    if (!canGrab(e) || H.mode !== 'build') return false;
    if (HawkesNet) HawkesNet.claim(e);
    const cam = W().scene.activeCamera;
    const dist = Math.max(1.6, Math.min(14, o.dist ?? e.distanceTo([cam.position.x, cam.position.y, cam.position.z])));
    grab = { e, dist, before: clone(specOf(e)), v: [0, 0, 0], last: e.position, touch: Boolean(o.touch), sx: o.sx, sy: o.sy };
    e.held = true;
    e.velocity = [0, 0, 0];
    H.hooks.holding = e.sceneId;
    highlight();
    return true;
  }
  /** Each step: the held thing goes where you look (bumping into walls on the way). */
  function carry(dt) {
    if (!grab) return;
    const e = grab.e;
    if (!e.alive) { grab = null; H.hooks.holding = null; return; }
    const ray = aimRay();
    const to = ray.origin.add(ray.direction.scale(grab.dist));
    const want = [to.x - e.offset[0], to.y - e.offset[1], to.z - e.offset[2]];
    const before = e.position;
    for (let axis = 0; axis < 3; axis++) {
      const cur = [e.x, e.y, e.z][axis];
      const d = (want[axis] - cur) * Math.min(1, dt * 20);
      if (e.physics === 'none' || e.physics === 'trigger') e.node.position[['x', 'y', 'z'][axis]] += d;
      else e.sweep(axis, d);
    }
    const now = e.position;
    const v = [(now[0] - before[0]) / dt, (now[1] - before[1]) / dt, (now[2] - before[2]) / dt];
    grab.v = grab.v.map((x, i) => x * 0.6 + v[i] * 0.4);
  }
  function dropGrab(throwIt = true) {
    if (!grab) return;
    const { e, before } = grab;
    grab = null;
    H.hooks.holding = null;
    if (!e.alive) return;
    e.held = false;
    e.wake();
    if (e.physics === 'dynamic' && throwIt) {
      const v = grab_v_clamp(e._lastV || [0, 0, 0]);
      e.velocity = v;
      settleThenSave(e, before);
    } else {
      saveMove(e, before);
    }
    highlight();
  }
  const grab_v_clamp = (v) => { const s = Math.hypot(...v); return s > 30 ? v.map((x) => (x / s) * 30) : v; };
  function saveMove(e, before) {
    if (!e.alive || !e.sceneId) return;
    const t = transformOf(e);
    const was = before && before.transform || {};
    if (JSON.stringify(t.position) === JSON.stringify(was.position) && JSON.stringify(t.rotation) === JSON.stringify(was.rotation || [0, 0, 0])) return;
    edit([{ op: 'update', id: e.sceneId, patch: { transform: t } }], { label: `moving ${e.name || 'it'}`, undo: before ? undefined : false });
    e.home = { position: e.position, rotation: e.rotation3 };
  }
  /** A thrown thing is saved where it comes to rest. */
  function settleThenSave(e, before) {
    const started = performance.now();
    const check = () => {
      if (!e.alive) return;
      if (e.held) return; // picked up again: that grab saves it
      if (e.sleeping || performance.now() - started > 6000) { saveMove(e, before); if (HawkesNet) HawkesNet.release(e); return; }
      setTimeout(check, 250);
    };
    setTimeout(check, 300);
  }
  H.hooks.step.push((dt) => {
    if (grab) {
      carry(dt);
      grab.e._lastV = grab.v;
      if (grab.e.physics === 'dynamic') grab.e.velocity = [0, 0, 0];
    }
  });
  H.hooks.frame.push(() => {
    if (grab && H.input.mouse.wheel) grab.dist = Math.max(1.6, Math.min(20, grab.dist - H.input.mouse.wheel * 0.7));
    if (H.mode === 'build' && !popup) keys();
  });

  // ------------------------------------------------------------------ keys
  function keys() {
    const k = H.input.pressed;
    const held = H.input.held;
    const ctrl = held.has('control') || held.has('meta');
    if (ctrl && k.has('z')) { held.has('shift') ? redo() : undo(); return; }
    if (ctrl && k.has('y')) { redo(); return; }
    if (ctrl) return;
    const t = grab ? grab.e : target;
    if ((k.has('delete') || k.has('backspace')) && t && t.sceneId && !t.temporary) removeThing(t);
    if (k.has('enter')) toParent({ type: 'focus-chat', mention: t && t.sceneId ? { id: t.sceneId, name: t.name || t.sceneId } : null });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') { e.preventDefault(); setMode(H.mode === 'build' ? 'play' : 'build'); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (H.mode === 'build') toParent({ type: 'save' }); }
    // Esc: closes the card or the handles; otherwise (the mouse is already free) the menu, like a game.
    if (e.key === 'Escape') { if (soft) release(); else if (popup) closePopup(); else if (gizmos && gizmos.target) toggleGizmo(null); else toParent({ type: 'menu' }); }
  });

  function removeThing(e) {
    if (grab && grab.e === e) { grab = null; H.hooks.holding = null; }
    const name = e.name || e.sceneId;
    edit([{ op: 'delete', id: e.sceneId }], { label: `removing ${name}` });
    poof(e.position);
    toast(`Removed ${name} · Ctrl+Z brings it back`);
    if (popup && popup.e === e) closePopup();
  }
  function copyThing(e) {
    const spec = clone(specOf(e));
    if (!spec) return;
    spec.id = newId(spec.name || spec.type);
    const p = e.position;
    const cam = W().scene.activeCamera;
    const right = cam.getDirection(B.Axis.X);
    const w = e.size[0] + 0.3;
    spec.transform = { ...(spec.transform || {}), position: [r2(p[0] + right.x * w), r2(p[1] + (e.physics === 'dynamic' ? 0.3 : 0)), r2(p[2] + right.z * w)] };
    if (H.hooks.space) spec.transform.rotation = e.rotation3.map((n) => Math.round(n * 10) / 10); // (here, turned as it is here)
    edit([{ op: 'create', entity: spec }], { label: `copying ${e.name || 'it'}`, fx: H.arrive ? 'beam' : 'materialize' }); // (a copy goes exactly beside it)
    toast(`Copied ${e.name || spec.type}`);
  }
  function placeFromHotbar(k) {
    if (H.mode !== 'build') return;
    const h = hotbarList().find((x) => x.k === k);
    if (!h) return;
    const w = W();
    const cam = w.scene.activeCamera;
    const spec = h.make(w.camera.yaw || 0);
    spec.id = newId(spec.name);
    let at;
    const r = pickAt(aimRay());
    const lift = H.kinds.lift(spec);
    if (r && r.distance > 1.2 && r.distance < 30) at = [r.pickedPoint.x, r.pickedPoint.y + lift, r.pickedPoint.z];
    else { const d = cam.getDirection(B.Axis.Z); at = [cam.position.x + d.x * 4, cam.position.y + d.y * 4, cam.position.z + d.z * 4]; }
    spec.transform = { ...(spec.transform || {}), position: at.map(r2) };
    if (H.arrive) H.arrive.plan(spec); // (it drops from the sky: a roof over the spot catches it)
    edit([{ op: 'create', entity: spec }], { label: `adding ${h.label.toLowerCase()}`, fx: 'materialize' });
    toast(`Added ${h.label.toLowerCase()} · double-click it to change it`);
  }

  /** Something from your library, put where you're looking: a model, a picture, a speaker, a screen. */
  function placeAsset(a) {
    if (!a || !a.name || !W()) return;
    if (H.mode !== 'build') setMode('build');
    const w = W();
    const cam = w.scene.activeCamera;
    const yaw = Math.round(((w.camera.yaw || 0) / RAD + 180) / 15) * 15;
    const title = a.title ? String(a.title).slice(0, 40) : null;
    if (a.ifUnused) {
      const g = W().graph;
      const uses = Object.values(g.entities || {}).some((sp) => JSON.stringify(sp).includes(`"${a.name}"`)) || (g.config && g.config.sky === a.name);
      if (uses) { toast(`${title || a.name} is in the game`); return; }
    }
    // A sky becomes the sky; a texture covers what you're pointing at (or a floor tile when that's nothing plain).
    if (a.as === 'sky') { edit([{ op: 'config', patch: { sky: a.name } }], { label: 'changing the sky' }); toast(`The sky is now ${title || a.name}`); return; }
    if (a.as === 'texture') {
      const sp = target && specOf(target);
      if (sp && editorOf(sp.type).textureable) {
        update(target, { material: { ...(sp.material || {}), texture: a.name, tile: (sp.material && sp.material.tile) || 2, color: '#ffffff' } }, `texturing ${sp.name || sp.id}`);
        toast(`${sp.name || 'It'} is now ${title || a.name}`);
        return;
      }
    }
    // The kind that takes this sort of asset (editor.asset in H.kinds: model takes meshes, sprite images...).
    const want = a.as === 'texture' ? 'texture' : a.kind;
    const taker = H.kinds.list().find((k) => k.editor && k.editor.asset && k.editor.asset.kind === want);
    const make = taker && (() => taker.editor.asset.make(a, { title, yaw }));
    if (!make) return;
    const spec = make();
    const lift = spec.lift ?? H.kinds.lift(spec); delete spec.lift;
    spec.id = newId(spec.name);
    const r = pickAt(aimRay());
    let at;
    if (r && r.distance > 1.2 && r.distance < 30) at = [r.pickedPoint.x, r.pickedPoint.y + lift, r.pickedPoint.z];
    else { const d = cam.getDirection(B.Axis.Z); at = [cam.position.x + d.x * 4, cam.position.y + d.y * 4, cam.position.z + d.z * 4]; }
    spec.transform = { ...(spec.transform || {}), position: at.map(r2) };
    if (H.arrive) H.arrive.plan(spec);
    edit([{ op: 'create', entity: spec }], { label: `adding ${spec.name}`, fx: 'materialize' });
    toast(`Added ${spec.name}${a.kind === 'audio' ? ' · touch it to hear it' : a.kind === 'video' ? ' · click it for sound' : ''}`);
  }

  // ------------------------------------------------------------------ mouse: hold to grab, double-click to edit
  const canvas = $('stage');
  let down = null;
  let lastClick = { t: 0, e: null };
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0 || H.mode !== 'build') return;
    if (popup) { closePopup(); return; }
    down = { t: performance.now(), x: ev.clientX, y: ev.clientY, e: target, started: false, moved: 0 };
  }, true);
  H.hooks.dragLook = () => H.mode !== 'build' ? !target || !canGrab(target) : touchUi;
  canvas.addEventListener('pointermove', (ev) => {
    if (!down || down.started || ev.pointerType !== 'mouse') return;
    down.moved = Math.abs(ev.clientX - down.x) + Math.abs(ev.clientY - down.y);
    if (!down.e || !canGrab(down.e)) return; // dragging on nothing does nothing while building
    if (down.moved > 6 || (ev.movementX || ev.movementY) && H.input.mouse.locked) beginHold();
  });
  function beginHold() { if (down && !down.started && down.e) { down.started = startGrab(down.e); } }
  setInterval(() => { if (down && !down.started && performance.now() - down.t > 170) beginHold(); }, 30);
  window.addEventListener('pointerup', (ev) => {
    if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
    const d = down;
    down = null;
    if (!d) return;
    if (d.started) { dropGrab(true); return; }
    // A click: two quick ones on the same thing open its card; one on its own captures the mouse to look around.
    const now = performance.now();
    if (d.e && lastClick.e === d.e && now - lastClick.t < 380) { openPopup(d.e); lastClick = { t: 0, e: null }; return; }
    lastClick = { t: now, e: d.e };
    if (d.e) { selected = d.e; highlight(); }
  });

  // On a phone: tap to point at something, hold it to grab it, double-tap to edit.
  let touchHold = null;
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' || H.mode !== 'build') return;
    const r = canvas.getBoundingClientRect();
    const sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const w = W();
    const ray = w.scene.createPickingRay(sx, sy, B.Matrix.Identity(), w.scene.activeCamera);
    const p = pickAt(ray);
    const e = p ? H.entityOf(p.pickedMesh) : null;
    const now = performance.now();
    if (e && lastClick.e === e && now - lastClick.t < 380) { openPopup(e); lastClick = { t: 0, e: null }; return; }
    lastClick = { t: now, e };
    if (popup) closePopup();
    if (!e) return;
    selected = e; highlight();
    touchHold = { id: ev.pointerId, e, sx, sy, t: setTimeout(() => { if (touchHold && touchHold.e === e && startGrab(e, { touch: true, sx: touchHold.sx, sy: touchHold.sy, dist: p.distance })) { touchHold.grabbing = true; if (navigator.vibrate) navigator.vibrate(15); } }, 380) };
  });
  H.hooks.touchDrag = (ev, dx, dy) => {
    if (!touchHold || ev.pointerId !== touchHold.id) return false;
    touchHold.sx += dx; touchHold.sy += dy;
    if (Math.abs(dx) + Math.abs(dy) > 3 && !touchHold.grabbing) { clearTimeout(touchHold.t); touchHold = null; return false; }
    if (grab && grab.touch) { grab.sx = touchHold.sx; grab.sy = touchHold.sy; return true; }
    return false;
  };
  const touchUp = (ev) => { if (!touchHold || ev.pointerId !== touchHold.id) return; clearTimeout(touchHold.t); if (touchHold.grabbing) dropGrab(true); touchHold = null; };
  canvas.addEventListener('pointerup', touchUp);
  canvas.addEventListener('pointercancel', touchUp);
  if (touchUi) {
    $('hudTouch').hidden = false;
    const tg = $('tGrab');
    tg.addEventListener('pointerdown', (ev) => { ev.preventDefault(); if (target) startGrab(target); });
    const tgUp = () => { if (grab && !grab.touch) dropGrab(true); };
    tg.addEventListener('pointerup', tgUp); tg.addEventListener('pointercancel', tgUp);
    $('tEdit').onclick = () => { const e = selected || target; if (e) openPopup(e); else toast('Tap something first'); };
    H.bindTouchKey($('tFly'), 'f');
  }

  // ------------------------------------------------------------------ the card: editing a thing, in the world
  const SWATCHES = ['#e04f5f', '#f97316', '#f4c430', '#34d399', '#22d3ee', '#4a9eff', '#a855f7', '#ec4899', '#f5f5f5', '#8a93a8', '#3a3f4b', '#b07a45'];
  function openPopup(e) {
    if (!e || !e.sceneId || H.mode !== 'build') return;
    if (grab) dropGrab(false);
    closePopup();
    if (document.pointerLockElement) document.exitPointerLock();
    selected = e;
    highlight();
    const el = document.createElement('div');
    el.className = 'card';
    el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    el.addEventListener('wheel', (ev) => ev.stopPropagation());
    document.body.appendChild(el);
    popup = { e, el, scale0: e.node.scaling.clone(), full: false, pinned: null };
    dragCard(el);
    renderCard();
    toParent({ type: 'selected', entity: { id: e.sceneId, name: e.name } });
    toParent({ type: 'card', open: true });
  }
  function closePopup() {
    if (!popup) return;
    popup.el.remove();
    popup = null;
    toParent({ type: 'card', open: false });
    toParent({ type: 'selected', entity: null });
    $('hudLeader').classList.remove('on');
  }
  /** The settings of one ability on the card (its settings description: H.abilities), and its presets. */
  function abilityForm(raw) {
    const b = typeof raw === 'string' ? { use: raw } : raw || {};
    const name = b.use || b.type;
    const def = H.behaviorDef(name);
    if (!def) return '';
    const sets = H.abilities ? H.abilities.settingsOf(name) : [];
    const val = (k) => (b[k] !== undefined ? b[k] : (def.defaults || {})[k]);
    const row = (s) => {
      const v = val(s.key), id = `ab-${s.key}`;
      const input = s.type === 'number' ? `<input id="${id}" data-ab="${esc(s.key)}" data-t="number" type="range" min="${s.min ?? 0}" max="${s.max ?? 100}" step="${s.step ?? 1}" value="${Number(v) || 0}"><output>${esc(String(v ?? ''))}${s.unit ? ` ${esc(s.unit)}` : ''}</output>`
        : s.type === 'bool' ? `<input id="${id}" data-ab="${esc(s.key)}" data-t="bool" type="checkbox" ${v ? 'checked' : ''}>`
        : s.type === 'choice' ? `<select id="${id}" data-ab="${esc(s.key)}" data-t="choice">${(s.options || []).map(([ov, ot]) => `<option value="${esc(ov)}" ${String(v) === String(ov) ? 'selected' : ''}>${esc(ot)}</option>`).join('')}</select>`
        : s.type === 'color' ? `<input id="${id}" data-ab="${esc(s.key)}" data-t="text" type="color" value="${/^#[0-9a-f]{6}$/i.test(v) ? v : '#4a9eff'}">`
        : s.type === 'thing' ? `<input id="${id}" data-ab="${esc(s.key)}" data-t="thing" list="ab-things" value="${esc(Array.isArray(v) ? v.join(', ') : v ?? '')}"><datalist id="ab-things">${Object.values(W().graph.entities).filter((x) => x.name).slice(0, 80).map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>`
        : `<input id="${id}" data-ab="${esc(s.key)}" data-t="text" value="${esc(v ?? '')}">`;
      return `<label class="ab-row" for="${id}"><span>${esc(s.label)}</span>${input}</label>`;
    };
    const presets = def.presets ? `<div class="ab-presets">${Object.entries(def.presets).map(([n, o]) => `<button type="button" class="card-btn" data-preset="${esc(JSON.stringify(o))}">${esc(n)}</button>`).join('')}</div>` : '';
    return `<div class="card-row ab-form"><label>${esc(def.title)}</label><div class="ab-says">${esc(def.says ? def.says({ ...(def.defaults || {}), ...b }) : '')}</div>${presets}${sets.map(row).join('') || '<div class="muted">Nothing to set.</div>'}</div>`;
  }

  function renderCard() {
    const { e, el } = popup;
    const spec = specOf(e) || {};
    const d = describe(e);
    const motionChoices = editorOf(e.kind).motion || [['static', 'Stays put'], ['dynamic', 'Falls & throws'], ['kinematic', 'Moves itself'], ['none', 'Walk-through']];
    const isLight = e.kind === 'light';
    const color = isLight ? (spec.light && spec.light.color) || '#ffffff' : (spec.material && spec.material.color) || e.color || '#cccccc';
    const behaviors = (spec.behaviors || []).map((b, i) => { const name = typeof b === 'string' ? b : b.use || b.type; const def = H.behaviorDef(name); return `<span class="chip${popup.editing === i ? ' on' : ''}" title="${esc(def && def.says ? def.says({ ...(def.defaults || {}), ...b }) : name)}"><button type="button" class="chip-name" data-edb="${i}" title="Its settings">${esc(def ? `${def.icon ? `${def.icon} ` : ''}${def.title}` : name)}</button><button type="button" data-unb="${i}" aria-label="Remove">×</button></span>`; }).join('');
    // Every ability, grouped (abilities module: H.abilities), else the plain list.
    const groups = new Map();
    for (const a of H.abilities ? H.abilities.list() : (H.behaviorMenu || []).map(([name, title]) => ({ name, title, group: 'More', icon: '' }))) { if (!groups.has(a.group)) groups.set(a.group, []); groups.get(a.group).push(a); }
    const ORDER = ['Riding', 'Hands', 'Moving you', 'Signals', 'Games', 'Motion', 'Physics', 'Looks', 'Talking', 'Sound'];
    const rank = (g) => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length);
    const menu = [...groups].sort((a, b) => rank(a[0]) - rank(b[0])).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map((a) => `<option value="${esc(a.name)}">${esc(`${a.icon ? `${a.icon} ` : ''}${a.title}`)}</option>`).join('')}</optgroup>`).join('');
    const editing = Number.isInteger(popup.editing) && (spec.behaviors || [])[popup.editing] ? abilityForm(spec.behaviors[popup.editing]) : '';
    if (!popup.full) return renderSimple(e, el, spec, isLight, color);
    el.className = 'card';
    const scaleNow = e.node.scaling.x / (popup.scale0.x || 1);
    el.innerHTML = `
      <div class="card-head">
        <input class="card-name" id="cName" value="${esc(e.name || '')}" placeholder="${esc(d.name)}" aria-label="Name">
        <button type="button" class="card-x" id="cClose" aria-label="Close">×</button>
      </div>
      <div class="card-kind">${esc(d.bits.join(' · '))}</div>
      ${isLight ? `<div class="card-row"><label>Brightness</label><input type="range" id="cBright" min="0" max="4" step="0.1" value="${(spec.light && spec.light.intensity) ?? 1}"></div>` : `<div class="card-row"><label>Size</label><input type="range" id="cSize" min="0.2" max="4" step="0.05" value="${scaleNow.toFixed(2)}"></div>`}
      <div class="card-row"><label>${isLight ? 'Light color' : 'Color'}</label><div class="swatches">${SWATCHES.map((c) => `<button type="button" style="background:${c}" data-c="${c}" class="${c.toLowerCase() === String(color).toLowerCase() ? 'on' : ''}" aria-label="${c}"></button>`).join('')}<input type="color" id="cColor" value="${/^#[0-9a-f]{6}$/i.test(color) ? color : '#cccccc'}" aria-label="Any color"></div></div>
      ${e._waiting ? `<div class="card-row"><button type="button" class="card-btn hot" id="cMake">Make “${esc(e._waiting)}” with AI</button></div>` : ''}
      <form class="card-ask" id="cAsk"><input id="cAskIn" placeholder="Ask the Overseer about ${esc(e.name || 'this')}…" autocomplete="off"><button type="submit">Ask</button></form>
      ${popup.full ? `<div class="card-more">
      ${motionChoices.length ? `<div class="card-row"><label>How it moves</label><div class="seg" id="cMotion">${motionChoices.map(([v, t]) => `<button type="button" data-v="${v}" class="${e.physics === v ? 'on' : ''}">${t}</button>`).join('')}</div></div>` : ''}
      ${e.waypoint ? `<div class="card-row"><label>What it is</label><div class="seg" id="cRole">${[['waypoint', 'Waypoint'], ['checkpoint', 'Checkpoint'], ['finish', 'Finish']].map(([v, t]) => `<button type="button" data-v="${v}" class="${e.waypoint.role === v ? 'on' : ''}">${t}</button>`).join('')}</div></div><div class="card-row"><label>Leads to</label><select id="cNext"><option value="">Nothing</option>${Object.values(W().graph.entities).filter((x) => x.type === 'waypoint' && x.id !== e.sceneId).map((x) => `<option value="${esc(x.id)}" ${e.waypoint.next === x.id ? 'selected' : ''}>${esc(x.name || x.id)}</option>`).join('')}</select></div>` : ''}
      ${e.physics === 'dynamic' ? `<div class="card-row"><label>Bounciness</label><input type="range" id="cBounce" min="0" max="0.95" step="0.05" value="${(spec.body && spec.body.bounce) || 0}"></div>` : ''}
      ${!isLight && e.kind !== 'spawn' ? `<div class="card-row"><label>Turn</label><input type="range" id="cTurn" min="-180" max="180" step="5" value="${Math.round(((e.rotation % 360) + 540) % 360 - 180)}"></div>` : ''}
      ${e.kind === 'text' ? `<div class="card-row"><label>Words</label><input class="card-in" id="cText" value="${esc((spec.shape && spec.shape.text) || '')}"></div>` : ''}
      ${e.kind !== 'spawn' ? `<div class="card-row"><label>What it does</label><div class="chips">${behaviors || '<span class="muted">Nothing on its own yet</span>'}<select id="cAdd" aria-label="Add an ability"><option value="">+ Ability…</option>${menu}</select></div></div>${editing}` : ''}
      </div>` : ''}
      ${kindCardButton(e)}
      <div class="card-foot">
        <button type="button" class="card-btn" id="cMore">${popup.full ? 'Less' : 'More…'}</button>
        ${H.looks && e.sceneId ? '<button type="button" class="card-btn" id="cLook" title="Choose how it looks: the library, yours, or a new one">🎨 Look</button>' : ''}
        <button type="button" class="card-btn" id="cCopy">Copy</button>
        <button type="button" class="card-btn" id="cChat">In chat</button>
        ${advanced ? '<button type="button" class="card-btn" id="cCode">Code</button><button type="button" class="card-btn" id="cGizmo">Gizmo</button>' : ''}
        <span class="grow"></span>
        <button type="button" class="card-btn bad" id="cDel">Remove</button>
      </div>`;
    const q = (id) => el.querySelector(`#${id}`);
    q('cClose').onclick = closePopup;
    q('cMore').onclick = () => { popup.full = !popup.full; renderCard(); };
    wireKindCard(el, e);
    q('cName').onchange = (ev) => { const v = ev.target.value.trim().slice(0, 60); if (v && v !== e.name) update(e, { name: v }, 'renaming'); };
    q('cName').onkeydown = (ev) => { if (ev.key === 'Enter') ev.target.blur(); };
    const motion = q('cMotion');
    if (motion) motion.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; update(e, { physics: b.dataset.v }, 'how it moves'); popup.e = W().byId.get(e.sceneId) || e; renderCard(); };
    const role = q('cRole');
    if (role) role.onclick = (ev) => { const b = ev.target.closest('button'); if (!b) return; update(e, { data: { role: b.dataset.v }, name: { waypoint: 'Waypoint', checkpoint: 'Checkpoint', finish: 'Finish' }[b.dataset.v] }, 'what it is'); refresh(); };
    const nx = q('cNext');
    if (nx) nx.onchange = () => { update(e, { data: { next: nx.value || null } }, 'the route'); refresh(); };
    const bounce = q('cBounce');
    if (bounce) bounce.onchange = () => { update(e, { body: { bounce: Number(bounce.value) } }, 'bounciness'); refresh(); };
    const setColor = (c) => { if (isLight) update(e, { light: { color: c } }, 'color'); else update(e, { material: { color: c } }, 'color'); refresh(); };
    for (const b of el.querySelectorAll('[data-c]')) b.onclick = () => setColor(b.dataset.c);
    q('cColor').onchange = (ev) => setColor(ev.target.value);
    q('cColor').oninput = (ev) => { const live = W().byId.get(e.sceneId); if (live && !isLight) live.color = ev.target.value; };
    const size = q('cSize');
    if (size) {
      size.oninput = () => { const live = W().byId.get(e.sceneId); if (live) { const k = Number(size.value); live.node.scaling.set(popup.scale0.x * k, popup.scale0.y * k, popup.scale0.z * k); live.measure(); } };
      size.onchange = () => { const live = W().byId.get(e.sceneId); if (live) update(live, { transform: { scale: [r2(live.node.scaling.x), r2(live.node.scaling.y), r2(live.node.scaling.z)] } }, 'size'); };
    }
    const turn = q('cTurn');
    if (turn) {
      turn.oninput = () => { const live = W().byId.get(e.sceneId); if (live) live.rotation = Number(turn.value); };
      turn.onchange = () => { const live = W().byId.get(e.sceneId); if (live) update(live, { transform: transformOf(live) }, 'turning'); };
    }
    const bright = q('cBright');
    if (bright) bright.onchange = () => { update(e, { light: { intensity: Number(bright.value) } }, 'brightness'); refresh(); };
    const txt = q('cText');
    if (txt) txt.onchange = () => { update(e, { shape: { text: txt.value.slice(0, 200) } }, 'the words'); refresh(); };
    for (const b of el.querySelectorAll('[data-unb]')) b.onclick = () => { const list = clone(spec.behaviors || []); list.splice(Number(b.dataset.unb), 1); popup.editing = null; update(e, { behaviors: list }, 'what it does'); refresh(); };
    for (const b of el.querySelectorAll('[data-edb]')) b.onclick = () => { const i = Number(b.dataset.edb); popup.editing = popup.editing === i ? null : i; renderCard(); };
    // An ability's settings: each control changes that one option (saved, undoable); a preset sets several at once.
    const setAbility = (patchOpts) => { const list = clone(spec.behaviors || []); const i = popup.editing; const cur = typeof list[i] === 'string' ? { use: list[i] } : list[i]; list[i] = { ...cur, ...patchOpts }; update(e, { behaviors: list }, 'its settings'); refresh(); };
    for (const inp of el.querySelectorAll('[data-ab]')) inp.onchange = () => { const k = inp.dataset.ab, t = inp.dataset.t; const v = t === 'number' ? Number(inp.value) : t === 'bool' ? inp.checked : t === 'thing' && /^-?[\d.]+\s*,\s*-?[\d.]+\s*,\s*-?[\d.]+$/.test(inp.value) ? inp.value.split(',').map(Number) : inp.value; setAbility({ [k]: v }); };
    for (const p of el.querySelectorAll('[data-preset]')) p.onclick = () => { try { setAbility(JSON.parse(p.dataset.preset)); } catch { /* not a preset */ } };
    const add = q('cAdd');
    if (add) add.onchange = () => {
      if (!add.value) return;
      const list = clone(spec.behaviors || []);
      list.push({ use: add.value });
      popup.editing = list.length - 1; // (its settings open at once)
      const patch = { behaviors: list };
      // Riding or carrying moves it: a thing that never moves would stay put under you.
      if (['drivable', 'flyable'].includes(add.value) && e.physics === 'static') patch.physics = 'kinematic';
      if (add.value === 'holdable' && e.physics !== 'dynamic') patch.physics = 'dynamic';
      // Some behaviors need the thing to move: say so with a sensible change, not an error.
      if (['hop', 'bouncy'].includes(add.value) && e.physics !== 'dynamic') patch.physics = 'dynamic';
      if (add.value === 'collectible' && e.physics === 'dynamic') patch.physics = 'static';
      update(e, patch, 'what it does');
      refresh();
    };
    const make = q('cMake');
    if (make) make.onclick = () => { toParent({ type: 'generate', kind: 'model', name: e._waiting, prompt: e.name || e._waiting.replace(/\.[a-z]+$/, '') }); make.disabled = true; make.textContent = 'Say yes on the card…'; makeBtn = make; };
    q('cAsk').onsubmit = (ev) => { ev.preventDefault(); const v = q('cAskIn').value.trim(); if (!v) return; toParent({ type: 'ask', text: v, mention: { id: e.sceneId, name: e.name || e.sceneId }, context: context() }); q('cAskIn').value = ''; q('cAskIn').placeholder = 'In the chat: press Enter to send it'; };
    q('cCopy').onclick = () => copyThing(W().byId.get(e.sceneId) || e);
    if (q('cLook')) q('cLook').onclick = () => { const t = W().byId.get(e.sceneId) || e; closePopup(); H.looks.open(t); };
    q('cChat').onclick = () => { toParent({ type: 'focus-chat', mention: { id: e.sceneId, name: e.name || e.sceneId } }); };
    q('cDel').onclick = () => removeThing(W().byId.get(e.sceneId) || e);
    const code = q('cCode');
    if (code) code.onclick = () => toParent({ type: 'open-code', entity: e.sceneId });
    const gz = q('cGizmo');
    if (gz) gz.onclick = () => toggleGizmo(W().byId.get(e.sceneId) || e);
    function refresh() { setTimeout(() => { if (popup) { popup.e = W().byId.get(e.sceneId) || popup.e; renderCard(); } }, 0); }
  }
  /** A kind's own settings (its editor.card: { label, open(ctx) }, e.g. the mirror's questions): a button on its card
   *  that opens them; ctx is { entity, spec, update(patch, label), close() } (close: the card). */
  function kindCardButton(e) {
    const c = editorOf(e.kind).card;
    return c && c.label ? `<div class="card-row"><button type="button" class="card-btn hot" id="cKind">${esc(c.label)}</button></div>` : '';
  }
  function wireKindCard(el, e) {
    const c = editorOf(e.kind).card;
    const b = el.querySelector('#cKind');
    if (!c || !b || typeof c.open !== 'function') return;
    b.onclick = () => {
      const live = W().byId.get(e.sceneId) || e;
      try { c.open({ entity: live, spec: specOf(live) || {}, update: (patch, label) => update(W().byId.get(e.sceneId) || live, patch, label || 'settings'), close: closePopup }); } catch (err) { H.report(err, `${e.kind} settings`); }
    };
  }
  /** The first card: just the name, a color wheel, a size slider and a round More button, floating with no box. */
  function renderSimple(e, el, spec, isLight, color) {
    el.className = 'card simple';
    const scaleNow = e.node.scaling.x / (popup.scale0.x || 1);
    const bright = (spec.light && spec.light.intensity) ?? 1;
    el.innerHTML = `
      <div class="card-head"><span class="sc-name">${esc(e.name || describe(e).name)}</span><button type="button" class="sc-x" id="cClose" aria-label="Close">×</button></div>
      <div class="sc-body">
        <div class="sc-wheel" id="cWheel" title="Color: around for the hue, toward the middle for paler"><i class="sc-dot" id="cDot" style="background:${esc(color)}"></i></div>
        <div class="sc-side">
          <div class="sc-neutrals">${['#ffffff', '#b8bfcc', '#6b7280', '#2b2f3a', '#0b0d12', '#b07a45'].map((c) => `<button type="button" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>
          <label class="sc-label">${isLight ? 'Brightness' : 'Size'}</label>
          <input type="range" class="sc-range" id="${isLight ? 'cBright' : 'cSize'}" min="${isLight ? 0 : 0.2}" max="4" step="${isLight ? 0.1 : 0.05}" value="${isLight ? bright : scaleNow.toFixed(2)}">
        </div>
        <button type="button" class="sc-more" id="cMore" title="More: how it moves, what it does, copy, remove…" aria-label="More"><span></span><span></span><span></span></button>
      </div>${kindCardButton(e)}`;
    const q = (id) => el.querySelector(`#${id}`);
    q('cClose').onclick = closePopup;
    q('cMore').onclick = () => { popup.full = true; renderCard(); };
    wireKindCard(el, e);
    const live = () => W().byId.get(e.sceneId);
    const setColor = (c, save) => {
      q('cDot').style.background = c;
      const x = live();
      if (x && !isLight) x.color = c;
      if (x && isLight && x._light) x._light.diffuse = BABYLON.Color3.FromHexString(c);
      if (save) update(x || e, isLight ? { light: { color: c } } : { material: { color: c } }, 'color');
    };
    for (const b of el.querySelectorAll('[data-c]')) b.onclick = () => setColor(b.dataset.c, true);
    // The wheel: the angle is the hue, the distance from the middle the strength.
    const wheel = q('cWheel');
    let picking = false, last = null;
    const pick = (ev) => {
      const r = wheel.getBoundingClientRect();
      const x = ev.clientX - (r.left + r.width / 2), y = ev.clientY - (r.top + r.height / 2);
      const sat = Math.min(1, Math.hypot(x, y) / (r.width / 2));
      const hue = ((Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360;
      last = hsl(hue, sat * 100, 55 - sat * 5);
      setColor(last, false);
    };
    wheel.addEventListener('pointerdown', (ev) => { picking = true; wheel.setPointerCapture(ev.pointerId); pick(ev); });
    wheel.addEventListener('pointermove', (ev) => { if (picking) pick(ev); });
    const done = () => { if (picking && last) setColor(last, true); picking = false; };
    wheel.addEventListener('pointerup', done);
    wheel.addEventListener('pointercancel', done);
    const size = q('cSize');
    if (size) {
      size.oninput = () => { const x = live(); if (x) { const k = Number(size.value); x.node.scaling.set(popup.scale0.x * k, popup.scale0.y * k, popup.scale0.z * k); x.measure(); } };
      size.onchange = () => { const x = live(); if (x) update(x, { transform: { scale: [r2(x.node.scaling.x), r2(x.node.scaling.y), r2(x.node.scaling.z)] } }, 'size'); };
    }
    const br = q('cBright');
    if (br) {
      br.oninput = () => { const x = live(); if (x && x._light) x._light.intensity = Number(br.value); };
      br.onchange = () => update(live() || e, { light: { intensity: Number(br.value) } }, 'brightness');
    }
  }
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, '0');
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  /** Cards can be dragged by their top out of the way; then they stay where they were put. */
  function dragCard(el) {
    let start = null;
    el.addEventListener('pointerdown', (ev) => {
      const head = ev.target.closest('.card-head, .card-kind, .sc-name');
      if (!head || ev.target.closest('input, button')) return;
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(el.style.transform) || [0, 0, 0];
      start = { x: ev.clientX, y: ev.clientY, ox: Number(m[1]), oy: Number(m[2]) };
      el.setPointerCapture(ev.pointerId);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (ev) => {
      if (!start || !popup) return;
      const x = Math.max(4, Math.min(innerWidth - 60, start.ox + ev.clientX - start.x));
      const y = Math.max(4, Math.min(innerHeight - 40, start.oy + ev.clientY - start.y));
      popup.pinned = { x, y };
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    });
    const end = () => { start = null; el.classList.remove('dragging'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** Keeps the card next to its thing as you move, with a line pointing at it. */
  function placeCard() {
    if (!popup) return;
    const w = W();
    const e = w.byId.get(popup.e.sceneId);
    if (!e) { closePopup(); return; }
    popup.e = e;
    const cam = w.scene.activeCamera;
    const eng = w.scene.getEngine();
    const k = eng.getHardwareScalingLevel ? eng.getHardwareScalingLevel() : 1 / (window.devicePixelRatio || 1); // (CSS pixels)
    const vw = eng.getRenderWidth(true) * k, vh = eng.getRenderHeight(true) * k;
    const p = B.Vector3.Project(new B.Vector3(e.x + e.offset[0], e.y + e.offset[1] + e.half[1] * 0.6, e.z + e.offset[2]), B.Matrix.Identity(), w.scene.getTransformMatrix(), cam.viewport.toGlobal(vw, vh));
    const behind = p.z < 0 || p.z > 1;
    const el = popup.el;
    const cw = el.offsetWidth, ch = el.offsetHeight;
    const narrow = vw < 640;
    let x, y;
    if (popup.pinned) { x = popup.pinned.x; y = popup.pinned.y; }
    else if (narrow) { x = (vw - cw) / 2; y = vh - ch - 12; }
    else { x = p.x + 40; y = p.y - ch / 2; if (x + cw > vw - 12) x = p.x - cw - 40; x = Math.max(12, Math.min(vw - cw - 12, x)); y = Math.max(12, Math.min(vh - ch - 12, y)); }
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    const line = $('hudLine'), dot = $('hudDot');
    const ax = x + (p.x > x + cw / 2 ? cw : 0), ay = Math.max(y + 20, Math.min(y + ch - 20, p.y));
    line.setAttribute('x1', ax); line.setAttribute('y1', ay); line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
    dot.setAttribute('cx', p.x); dot.setAttribute('cy', p.y);
    $('hudLeader').classList.toggle('on', !behind && !narrow && !popup.pinned);
  }

  // ------------------------------------------------------------------ advanced: move/turn/size handles
  function toggleGizmo(e) {
    const w = W();
    if (!gizmos || gizmos._scene !== w.scene) { if (gizmos) gizmos.dispose(); gizmos = new B.GizmoManager(w.scene); gizmos._scene = w.scene; gizmos.usePointerToAttachGizmos = false; gizmos.positionGizmoEnabled = true; gizmos.mode = 0; }
    if (!e) { gizmos.attachToNode(null); gizmos.target = null; return; }
    if (gizmos.target === e) {
      gizmos.mode = (gizmos.mode + 1) % 3;
      gizmos.positionGizmoEnabled = gizmos.mode === 0; gizmos.rotationGizmoEnabled = gizmos.mode === 1; gizmos.scaleGizmoEnabled = gizmos.mode === 2;
      toast(['Move handles', 'Turn handles', 'Size handles'][gizmos.mode] + ' (G again to switch, Esc to hide)');
    } else toast('Move handles (G switches, Esc hides)');
    gizmos.target = e;
    gizmos.attachToNode(e.node);
    const before = clone(specOf(e));
    const save = () => { if (!e.alive) return; e.measure(); e.wake(); const ops = [{ op: 'update', id: e.sceneId, patch: { transform: transformOf(e) } }]; edit(ops, { label: 'moving it' }); void before; };
    for (const g of [gizmos.gizmos.positionGizmo, gizmos.gizmos.rotationGizmo, gizmos.gizmos.scaleGizmo]) if (g && !g._hooked) { g._hooked = true; g.onDragEndObservable.add(() => { if (gizmos.target) { const t = gizmos.target; const ops = [{ op: 'update', id: t.sceneId, patch: { transform: transformOf(t) } }]; t.measure(); edit(ops, { label: 'moving it' }); } }); }
    void save;
  }

  // ------------------------------------------------------------------ effects: things arriving, the Gen beam
  function poof(at) { const g = G(); if (g) g.burst(at, { color: '#c8d8ff', count: 18, speed: 3 }); }
  function materialize(e, by) {
    if (!e || !e.alive) return;
    // The Overseer beams it in (H.overseer: its module beams every created thing itself); only the label is ours.
    if (H.overseer) { if (by) floatLabel(e, `${by} added ${e.name || KIND[e.kind] || 'something'}`); return; }
    const n = e.node;
    const s = n.scaling.clone();
    n.scaling.scaleInPlace(0.01);
    const start = performance.now();
    const obs = W().scene.onBeforeRenderObservable.add(() => {
      const k = Math.min(1, (performance.now() - start) / 450);
      const ease = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.08;
      n.scaling.set(s.x * ease, s.y * ease, s.z * ease);
      if (k >= 1) { n.scaling.copyFrom(s); e.measure(); W().scene.onBeforeRenderObservable.remove(obs); }
    });
    G().burst(e.position, { color: '#9ec5ff', count: 22, speed: 3 });
    if (by) floatLabel(e, `${by} added ${e.name || KIND[e.kind] || 'something'}`);
  }
  function floatLabel(e, str) {
    const t = H.textPlane(str, { size: 0.18 });
    t.isPickable = false; t.metadata = { decor: true };
    t.position.set(e.x, e.y + e.half[1] + 0.6, e.z);
    const start = performance.now();
    const scene = W().scene;
    const obs = scene.onBeforeRenderObservable.add(() => {
      const k = (performance.now() - start) / 2600;
      t.position.y += 0.004;
      t.visibility = Math.max(0, 1 - Math.max(0, k - 0.6) / 0.4);
      if (k >= 1) { scene.onBeforeRenderObservable.remove(obs); t.dispose(); }
    });
  }
  H.hooks.world.push({
    enter() { hl = null; gizmos = null; target = null; selected = null; if (popup) closePopup(); syncMode(); },
    ops(ops, touched, o) {
      if (popup) setTimeout(() => { if (popup && W().byId.get(popup.e.sceneId)) { popup.e = W().byId.get(popup.e.sceneId); if (!popup.el.contains(document.activeElement)) renderCard(); } else closePopup(); }, 0);
      if (o.fx === 'materialize' || o.remote && o.by) for (const e of touched) if (ops.some((x) => x.op === 'create' && x.entity && x.entity.id === e.sceneId)) materialize(e, o.remote ? o.by : null);
      if (o.fx === 'arrive') for (const e of touched) { if (!H.overseer) G().burst(e.position, { color: '#ffffff', count: 40, speed: 5 }); floatLabel(e, `${e.name || 'It'} arrived`); }
    },
    net(s, info) {
      const el = $('hudNet');
      el.textContent = s === 'online' ? (info.peers ? `● ${info.peers + 1} here` : '● live') : s === 'connecting' ? '○ connecting…' : s === 'removed' ? 'removed from this game' : '○ offline, retrying';
      el.className = `hud-net ${s}`;
    },
  });
  const beams = new Map();
  function beamFor(row) {
    const w = W();
    let at = null;
    for (const e of w.entities) if (e._waiting && e._waiting === row.name) at = [e.x, e.y, e.z];
    if (!at) { const p = w.player || null; const cam = w.scene.activeCamera; const d = cam.getDirection(B.Axis.Z); at = p ? [p.x + d.x * 4, p.bottom + 0.6, p.z + d.z * 4] : [0, 0.6, 0]; }
    return at;
  }
  function onGen(row) {
    const w = W();
    if (!w || !row || !row.task_id) return;
    let b = beams.get(row.task_id);
    if (!b && row.state !== 'done' && row.state !== 'failed') { b = makeBeam(beamFor(row), row.name || row.kind); beams.set(row.task_id, b); b.log(`${row.kind || 'asset'}: starting`); }
    if (!b) return;
    b.status(row);
    if (row.detail) b.log(row.detail);
    if (row.state === 'done' || row.state === 'failed') {
      b.log(row.state === 'done' ? 'Done' : (row.error || 'Failed'));
      b.finish(row.state === 'done');
      setTimeout(() => { b.end(row.state === 'done'); beams.delete(row.task_id); }, 1600);
    }
  }
  /** The Overseer's beam while Hawkes Gen makes something (H.overseer.beam, held until it's done): a wireframe box
   *  where it will be, a panel over it (the name, step n of m and what it's doing, a bar from the task's real progress),
   *  and each new log line floating up off the box and fading. */
  function makeBeam(at, label) {
    const scene = W().scene;
    const p = new B.Vector3(at[0], at[1], at[2]);
    const shaft = H.overseer ? H.overseer.beam([at[0], at[1] - 0.6, at[2]], { radius: 0.7, hold: true, ring: true }) : null;
    const beam = shaft ? null : B.MeshBuilder.CreateCylinder('beam', { diameterTop: 0.05, diameterBottom: 0.5, height: 60, tessellation: 12 }, scene);
    const bm = shaft ? null : new B.StandardMaterial('beam', scene);
    if (beam) {
      beam.position = p.add(new B.Vector3(0, 30, 0));
      bm.emissiveColor = new B.Color3(0.6, 0.8, 1); bm.disableLighting = true; bm.alpha = 0.25;
      beam.material = bm; beam.isPickable = false; beam.metadata = { decor: true };
    }
    const ghost = B.MeshBuilder.CreateBox('beam-ghost', { size: 1 }, scene);
    ghost.position = p.clone();
    const gm = new B.StandardMaterial('beam-ghost', scene);
    gm.wireframe = true; gm.emissiveColor = new B.Color3(0.55, 0.75, 1); gm.disableLighting = true;
    ghost.material = gm; ghost.isPickable = false; ghost.metadata = { decor: true };

    // The panel: one canvas, redrawn when what it shows changes (at most ~12 times a second).
    const PW = 640, PH = 176;
    const tex = new B.DynamicTexture('beam-panel', { width: PW, height: PH }, scene, true);
    tex.hasAlpha = true;
    const panel = B.MeshBuilder.CreatePlane('beam-panel', { width: 1.9, height: (1.9 * PH) / PW, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
    const pm = new B.StandardMaterial('beam-panel', scene);
    pm.diffuseTexture = tex; pm.useAlphaFromDiffuseTexture = true; pm.emissiveColor = new B.Color3(1, 1, 1); pm.disableLighting = true; pm.backFaceCulling = false;
    panel.material = pm; panel.billboardMode = B.Mesh.BILLBOARDMODE_ALL; panel.isPickable = false; panel.metadata = { decor: true };
    panel.position = p.add(new B.Vector3(0, 1.45, 0));
    const st = { target: 0.03, shown: 0, cap: 0.99, step: null, steps: null, doing: '', state: 'running', drawn: '', drawAt: 0 };
    const rr = (c, x, y, w, h, r) => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    function draw(force) {
      const pct = Math.round(st.shown * 100);
      const key = `${pct}|${st.step}|${st.steps}|${st.doing}|${st.state}`;
      const now = performance.now();
      if (!force && (key === st.drawn || now - st.drawAt < 80)) return;
      st.drawn = key; st.drawAt = now;
      const c = tex.getContext();
      const bad = st.state === 'failed';
      c.clearRect(0, 0, PW, PH);
      c.fillStyle = 'rgba(8,14,28,0.78)'; rr(c, 4, 4, PW - 8, PH - 8, 22); c.fill();
      c.strokeStyle = bad ? 'rgba(255,110,110,0.7)' : 'rgba(120,190,255,0.55)'; c.lineWidth = 3; rr(c, 4, 4, PW - 8, PH - 8, 22); c.stroke();
      c.textBaseline = 'middle'; c.textAlign = 'left';
      c.fillStyle = '#ffffff'; c.font = '700 40px system-ui, sans-serif';
      c.fillText(String(label).slice(0, 26), 28, 44);
      c.textAlign = 'right'; c.fillStyle = bad ? '#ff9a9a' : '#9fe0ff'; c.font = '700 36px system-ui, sans-serif';
      c.fillText(bad ? 'failed' : `${pct}%`, PW - 28, 44);
      c.textAlign = 'left'; c.fillStyle = 'rgba(210,230,255,0.85)'; c.font = '500 26px system-ui, sans-serif';
      const sub = st.state === 'done' ? 'Done' : `${st.steps ? `Step ${st.step} of ${st.steps} · ` : ''}${st.doing}`;
      c.fillText(sub.slice(0, 44), 28, 92);
      // The bar, with a mark between steps
      const bx = 28, by = 122, bw = PW - 56, bh = 26;
      c.fillStyle = 'rgba(255,255,255,0.12)'; rr(c, bx, by, bw, bh, 13); c.fill();
      const g = c.createLinearGradient(bx, 0, bx + bw, 0);
      const ends = bad ? ['#ff6b6b', '#ff9a5a'] : st.state === 'done' ? ['#5dffa8', '#9dffcf'] : ['#4a9eff', '#a855f7'];
      g.addColorStop(0, ends[0]); g.addColorStop(1, ends[1]);
      c.fillStyle = g; rr(c, bx, by, Math.max(bh, bw * st.shown), bh, 13); c.fill();
      if (st.steps > 1) { c.fillStyle = 'rgba(8,14,28,0.55)'; for (let i = 1; i < st.steps; i++) c.fillRect(bx + (bw * i) / st.steps - 1.5, by + 3, 3, bh - 6); }
      tex.update();
    }
    draw(true);

    // Log lines float up off the box and fade.
    const floats = [];
    let lastLine = '';
    const LIFE = 3.6;
    function float(text) {
      const plane = H.textPlane(text, { size: 0.12, background: 'rgba(10,18,34,0.6)', color: '#cfe8ff' });
      plane.isPickable = false; plane.metadata = { decor: true };
      plane.position = p.add(new B.Vector3((Math.random() - 0.5) * 0.6, 0.55, (Math.random() - 0.5) * 0.6));
      if (plane.material) plane.material.alpha = 0;
      floats.push({ plane, t: 0 });
      while (floats.length > 6) { const f = floats.shift(); f.plane.dispose(); }
    }
    const t0 = performance.now();
    let prev = t0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
      const t = (now - t0) / 1000;
      if (bm) bm.alpha = 0.18 + 0.12 * Math.sin(t * 5) + st.shown * 0.2;
      ghost.rotation.y = t; ghost.scaling.setAll(0.9 + 0.1 * Math.sin(t * 3));
      // Between the server's updates it creeps on, never past the end of the step it's on.
      if (st.state === 'running') st.target = Math.min(Math.max(st.target, st.cap), st.target + dt * 0.003);
      st.shown += (st.target - st.shown) * Math.min(1, dt * 3);
      draw(false);
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i];
        f.t += dt;
        f.plane.position.y += dt * 0.32;
        const k = f.t / LIFE;
        if (f.plane.material) f.plane.material.alpha = k < 0.15 ? k / 0.15 : Math.max(0, 1 - (k - 0.15) / 0.85);
        if (k >= 1) { f.plane.dispose(); floats.splice(i, 1); }
      }
    });
    return {
      get p() { return st.shown; },
      get target() { return st.target; },
      get floating() { return floats.length; },
      /** A log line: floats up off the box (the same line twice in a row only once). */
      log(s) {
        const line = String(s).slice(0, 48);
        if (!line || line === lastLine) return;
        lastLine = line;
        float(line);
      },
      /** The generation's row: progress (0-1), step of steps, what it's doing. */
      status(row) {
        if (row.steps) { st.step = row.step; st.steps = row.steps; st.cap = Math.min(0.99, row.step / row.steps - 0.01); }
        if (row.progress != null && Number.isFinite(Number(row.progress))) st.target = Math.max(st.target, Math.min(1, Number(row.progress)));
        if (row.detail) st.doing = String(row.detail).split(':')[0].slice(0, 40);
      },
      progress(v) { st.target = Math.max(st.target, Math.min(1, v)); },
      finish(ok) { st.state = ok ? 'done' : 'failed'; if (ok) { st.target = 1; st.cap = 1; } draw(true); },
      end(ok) {
        scene.onBeforeRenderObservable.remove(obs);
        if (ok && !shaft) G().burst(at, { color: '#ffffff', count: 50, speed: 6 });
        if (shaft) shaft.end(ok);
        for (const f of floats) f.plane.dispose();
        floats.length = 0;
        for (const m of [beam, ghost, panel]) if (m) m.dispose();
        tex.dispose();
      },
    };
  }

  // ------------------------------------------------------------------ what the assistant should know
  function context() {
    const w = W();
    if (!w) return null;
    const p = w.player;
    const cam = w.scene.activeCamera;
    const d = cam.getDirection(B.Axis.Z);
    const at = p ? p.position : [cam.position.x, cam.position.y, cam.position.z];
    // A round world: the assistant writes the world file, so it is told where things are on the planet (and which way is up).
    const sp = H.hooks.space;
    const pl = (v) => (sp ? sp.toPlanet(v) : v).map(r2);
    const dl = (v) => (sp ? sp.dirToPlanet(v) : v).map(r2);
    const near = [...w.entities].filter((e) => e.sceneId && e.alive).map((e) => ({ e, d: e.distanceTo(at) })).sort((a, b) => a.d - b.d).slice(0, 14)
      .map(({ e, d: dist }) => ({ id: e.sceneId, name: e.name, what: describe(e).bits.join(', '), distance: r2(dist), at: pl(e.position) }));
    const looking = target && target.sceneId ? { id: target.sceneId, name: target.name, what: describe(target).bits.join(', '), distance: hit ? r2(hit.distance) : null, at: pl(target.position), size: target.size.map(r2) } : null;
    const groundAhead = pickAt(cam.getForwardRay(40));
    return {
      mode: H.mode,
      player: { at: pl(at), facing: dl([d.x, d.y, d.z]), ...(sp ? { up: dl([0, 1, 0]) } : {}), flying: Boolean(p && p.flying), standingOn: p && p.standing && p.standing.sceneId || null },
      lookingAt: looking,
      lookPoint: groundAhead ? pl([groundAhead.pickedPoint.x, groundAhead.pickedPoint.y, groundAhead.pickedPoint.z]) : null,
      selected: selected && selected.sceneId ? { id: selected.sceneId, name: selected.name } : null,
      nearby: near,
      players: H.hooks.net ? H.hooks.net.players().map((x) => ({ name: x.name, at: x.entity ? pl(x.entity.position) : null })) : [],
    };
  }

  // ------------------------------------------------------------------ talking with the editor page
  window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (ev.source !== window.parent) return;
    switch (m.type) {
      case 'ack': {
        const ops = pending.get(m.seq);
        pending.delete(m.seq);
        if (m.errors && m.errors.length) { toast(m.errors[0]); refused(m.seq); if (ops) toParent({ type: 'resync' }); }
        return;
      }
      // The editor's card for a generation was answered: Make it started it, Not now lets the button come back.
      case 'generate-closed': {
        const b = makeBtn;
        makeBtn = null;
        if (!b) return;
        if (m.made) b.textContent = 'Making… (check the chat)'; else { b.disabled = false; b.textContent = `Make “${m.name || ''}” with AI`; }
        return;
      }
      case 'context?': return toParent({ type: 'context', id: m.id, context: context() });
      // The editor page opened a dialog over the game: give the mouse back.
      case 'release-mouse': if (document.pointerLockElement) document.exitPointerLock(); return;
      case 'gen': return onGen(m.row);
      case 'advanced': advanced = Boolean(m.on); if (!advanced) toggleGizmo(null); if (popup) renderCard(); return;
      case 'select': { const e = W().byId.get(m.id); if (e) { openPopup(e); } return; }
      case 'mode': return setMode(m.mode);
      case 'toast': return toast(m.text);
      // Something the editor page saw, for the game's scripts (e.g. 'asked': a message to the Overseer).
      case 'event': if (typeof m.name === 'string' && /^[a-z][\w-]{0,40}$/.test(m.name) && H.game && H.game.emit) H.game.emit(m.name, m.data && typeof m.data === 'object' ? m.data : {}); return;
      case 'undo': return void undo();
      case 'redo': return void redo();
      case 'place': return placeAsset(m.asset);
      case 'placeBasic': return placeFromHotbar(m.k);
      case 'basics?': return toParent({ type: 'basics', list: hotbarList().map((h) => ({ k: h.k, icon: h.icon, label: h.label })) });
      // The editor's "In this game" shelf: each word and the assets it uses (H.assets), and changing that choice
      // (config.assets: an edit like any other, so it's undoable and reaches everyone).
      case 'words?': return toParent({ type: 'words', words: H.assets.words(), assets: H.assets.list().map((a) => ({ id: a.id, name: a.name, url: a.url, type: a.type, title: a.title, words: a.words })) });
      case 'assetsConfig': {
        const word = String(m.word || '').toLowerCase().trim();
        if (word) edit([{ op: 'config', patch: { assets: { [word]: m.value ?? null } } }], { label: `the ${word} assets` });
        return toParent({ type: 'words', words: H.assets.words(), assets: H.assets.list().map((a) => ({ id: a.id, name: a.name, url: a.url, type: a.type, title: a.title, words: a.words })) });
      }
    }
  });

  H.hooks.frame.push(() => { look(); placeCard(); });
  H.hooks.autoLock = () => H.mode !== 'build'; // building never captures the mouse: you look by dragging
  H.hooks.quietErrors = true; // the editor shows errors itself
  window.HawkesBuild = { context, openPopup, edit, undo, redo, refused, describe, get target() { return target; } };
})();
