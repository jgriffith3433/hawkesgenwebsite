// Hawkes Play: the engine every game on hawkesgen.com runs in, in the editor and when published. A friendly layer over
// Babylon.js. A game is a world (scene.json: things with a shape, a look, a way of moving and behaviors, see WORLD.md)
// plus scripts (one global, `game`, see API.md). The engine gives every game a first-person player, box physics
// (falling, bouncing, pushing, carrying on platforms), fall catching, behaviors, screen text, sound and errors, and
// keeps running when the tab is in the background. It runs inside a sandboxed page (no cookies, no storage), loaded with
// a bundle: { title, files: { path: text }, assets: { name: { url, mime } } }. net.js (multiplayer) and build.js (the
// editor's tools) plug into the hooks at the bottom.
/* global BABYLON */
(function () {
  'use strict';
  const B = BABYLON;
  const RAD = Math.PI / 180;
  const EPS = 0.001;
  const TOUCH = 0.02;
  const STEP = 1 / 60;

  // ------------------------------------------------------------------ reporting to the editor (when inside one)
  const post = (msg) => { try { if (window.parent !== window) window.parent.postMessage({ source: 'hawkes-play', ...msg }, '*'); } catch {} };
  const fmt = (a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
  function where(err) {
    const m = /hawkes-script:\/\/([^\s:)]+):(\d+)(?::(\d+))?/.exec(String(err && err.stack || ''));
    return m ? { file: m[1], line: Math.max(1, Number(m[2]) - 2) } : {};
  }
  let reported = 0;
  function report(err, file) {
    const w = where(err);
    const message = String(err && err.message || err);
    if (++reported > 200) return;
    post({ type: 'error', message, file: w.file || file || null, line: w.line || null });
    showError(`${w.file || file || 'script'}${w.line ? `:${w.line}` : ''}: ${message}`);
  }
  const safe = (fn, file) => (...args) => { try { return fn(...args); } catch (e) { report(e, file); } };

  // ------------------------------------------------------------------ page parts
  const $ = (id) => document.getElementById(id);
  const canvas = $('stage');
  const uiLayer = $('ui');
  function showError(text) {
    const box = $('error');
    if (!box || hooks.quietErrors) return;
    box.hidden = false;
    const line = document.createElement('div');
    line.textContent = text;
    box.appendChild(line);
    while (box.children.length > 6) box.firstChild.remove();
  }
  function clearErrors() { reported = 0; const box = $('error'); if (box) { box.innerHTML = ''; box.hidden = true; } }

  // (The engine tests run this file in Node with Babylon's NullEngine: window.HawkesEngineFactory makes it.)
  const engine = window.HawkesEngineFactory ? window.HawkesEngineFactory(canvas) : new B.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, disableWebGL2Support: false }, true);
  engine.enableOfflineSupport = false;
  window.addEventListener('resize', () => engine.resize());

  // Extension points for net.js and build.js (and anything else layered on the engine).
  const hooks = { world: [], scene: [], step: [], afterStep: [], frame: [], push: [], destroy: [], contact: [], physics: null, quietErrors: false };

  // ------------------------------------------------------------------ registries: how modules extend the engine
  // Every module (its own file, listed in public/play/modules/<name>/module.json) adds to the engine through these, never
  // by editing this file. docs/engine-modules.md is the guide.
  const kindDefs = new Map(); // type -> { build, physics, maker, destroy, editor, codex }
  const featureDefs = new Map(); // config key -> { apply, update, change, dispose }
  const controllerDefs = new Map(); // player mode -> { enter, update, idle, exit, tools }
  const toolDefs = new Map(); // tool name -> { title, equip, unequip, step, frame }
  const registry = (map, what, check) => ({
    register(name, def) {
      const n = String(name);
      if (!n || !def || typeof def !== 'object') throw new Error(`${what}.register(name, { ... })`);
      if (check) check(n, def);
      map.set(n, { name: n, ...def });
      return map.get(n);
    },
    get: (name) => map.get(String(name)) || null,
    has: (name) => map.has(String(name)),
    list: () => [...map.values()],
  });
  const kinds = registry(kindDefs, 'H.kinds', (n, d) => { if (typeof d.build !== 'function') throw new Error(`H.kinds.register('${n}'): build(shape, opts, spec) is required`); });
  const registerKind = kinds.register;
  kinds.register = (name, def) => { const k = registerKind(name, def); if (game) addMaker(game, k); return k; };
  const features = registry(featureDefs, 'H.features', (n, d) => { if (typeof d.apply !== 'function') throw new Error(`H.features.register('${n}'): apply(value, ctx) is required`); });
  const controllers = registry(controllerDefs, 'H.controllers', (n, d) => { if (typeof d.update !== 'function') throw new Error(`H.controllers.register('${n}'): update(player, dt, ctx) is required`); });
  const tools = registry(toolDefs, 'H.tools');
  /** The tool in the player's hands now: { name, def, ctx } or null. */
  Object.defineProperty(tools, 'held', { get: () => (heldTool.def ? { name: heldTool.def.name, def: heldTool.def, ctx: heldTool.ctx } : null) });

  // ------------------------------------------------------------------ input (kept across restarts)
  const held = new Set();
  let pressedNow = new Set();
  let releasedNow = new Set();
  const keyName = (e) => (e.key === ' ' ? 'space' : String(e.key || '').toLowerCase());
  const mouse = { x: 0, y: 0, down: false, pressed: false, dx: 0, dy: 0, wheel: 0, locked: false, look: false };
  let keyHandlers = [];
  const stick = { x: 0, y: 0 };
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    const k = keyName(e);
    if (['space', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    if (!held.has(k)) { pressedNow.add(k); for (const h of keyHandlers) if (h.key === k) h.fn(); }
    held.add(k);
    unlockAudio();
  });
  window.addEventListener('keyup', (e) => { const k = keyName(e); held.delete(k); releasedNow.add(k); });
  window.addEventListener('blur', () => held.clear());
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    // Looking around: with the pointer locked (click the game), or by dragging with the right button.
    // Looking around: with the pointer captured (click the game), or by dragging (right button, or left on nothing).
    // (hooks.lookAlways: control without capture, where the browser won't capture the mouse.)
    if (mouse.locked || (e.pointerType === 'mouse' && (mouse.look || (mouse.dragLook && (e.buttons & 1)) || (hooks.lookAlways && hooks.lookAlways()) || (softLook && mode !== 'build')))) { mouse.dx += e.movementX || 0; mouse.dy += e.movementY || 0; }
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button === 2) { mouse.look = !hooks.dragLook || hooks.dragLook(e); return; }
    if (e.pointerType !== 'mouse') return;
    mouse.down = true; mouse.pressed = true; unlockAudio(); canvas.focus(); clickPick(e);
    mouse.dragLook = e.button === 0 && !mouse.locked && (!hooks.dragLook || hooks.dragLook(e));
  });
  window.addEventListener('pointerup', (e) => { if (e.button === 2) mouse.look = false; else if (e.pointerType === 'mouse') { mouse.down = false; mouse.dragLook = false; } });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
  document.addEventListener('pointerlockchange', () => { mouse.locked = document.pointerLockElement === canvas; for (const f of lockWatchers) f(mouse.locked); });
  const lockWatchers = [];
  /** Captures the mouse for first-person looking (the browser needs a click first). */
  /** Resolves true once the mouse is captured, false if the browser refuses (some embedded browsers always do). */
  function lockPointer() {
    if (touchUi || !canvas.requestPointerLock) return Promise.resolve(false);
    if (document.pointerLockElement === canvas) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; document.removeEventListener('pointerlockchange', on); document.removeEventListener('pointerlockerror', off); resolve(v); } };
      const on = () => done(document.pointerLockElement === canvas);
      const off = () => done(false);
      document.addEventListener('pointerlockchange', on);
      document.addEventListener('pointerlockerror', off);
      try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(off); } catch { off(); }
      setTimeout(() => done(document.pointerLockElement === canvas), 400);
    });
  }
  canvas.addEventListener('click', () => {
    const al = hooks.autoLock;
    if (al === false || (typeof al === 'function' && !al())) return;
    // "mouse": "free" (or an RTS view): the pointer stays a pointer.
    if (W && W.player && W.player.mouse === 'free') return;
    if (W && W.camera && (W.camera.mode === 'fps' || W.camera.mode === 'third')) lockPointer().then((ok) => { if (!ok) { softLook = true; document.body.classList.add('soft-control'); } });
  });
  // Where the browser refuses to capture the mouse: moving it over the game looks around until Esc.
  let softLook = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && softLook) { softLook = false; document.body.classList.remove('soft-control'); } });

  // A phone or tablet, not a laptop with a touchscreen (or a desktop window made small): the device says it's mobile
  // (Chromium), or its only pointer is a finger. ?touch=1 / ?touch=0 overrides, for testing.
  const touchUi = (() => {
    const force = new URLSearchParams(location.search).get('touch');
    if (force === '1' || force === '0') return force === '1';
    const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
    const ua = navigator.userAgentData;
    return ua && typeof ua.mobile === 'boolean' ? ua.mobile || coarseOnly : coarseOnly;
  })();
  const touch = { look: null, lx: 0, ly: 0, taps: [] };
  function buildTouch() {
    if (!touchUi || $('touch')) return;
    const wrap = document.createElement('div');
    wrap.id = 'touch';
    wrap.innerHTML = '<div class="pad"><div class="knob"></div></div><button class="tb a" data-key="space" aria-label="Jump">⤒</button><button class="tb b" data-key="e" aria-label="Action">B</button>';
    document.body.appendChild(wrap);
    const pad = wrap.querySelector('.pad');
    const knob = wrap.querySelector('.knob');
    let pid = null;
    const moveKnob = (e) => {
      const r = pad.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2, max = r.width / 2;
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      stick.x = dx / max; stick.y = -dy / max;
    };
    pad.addEventListener('pointerdown', (e) => { pid = e.pointerId; pad.setPointerCapture(pid); moveKnob(e); unlockAudio(); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) moveKnob(e); });
    const end = () => { pid = null; stick.x = 0; stick.y = 0; knob.style.transform = ''; };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
    for (const b of wrap.querySelectorAll('.tb')) bindTouchKey(b, b.dataset.key);
  }
  /** A screen button that holds a key while pressed (jump, action, fly...). */
  function bindTouchKey(b, k) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (!held.has(k)) { pressedNow.add(k); for (const h of keyHandlers) if (h.key === k) h.fn(); } held.add(k); unlockAudio(); });
    const up = () => { if (held.has(k)) { held.delete(k); releasedNow.add(k); } };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  }
  // On a phone: drag anywhere on the game to look around; a quick tap is a click.
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (touch.look !== null) return;
    touch.look = e.pointerId; touch.lx = e.clientX; touch.ly = e.clientY; touch.t0 = performance.now(); touch.moved = 0;
    const r = canvas.getBoundingClientRect();
    mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
    mouse.down = true; mouse.pressed = true; unlockAudio();
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== touch.look) return;
    const dx = e.clientX - touch.lx, dy = e.clientY - touch.ly;
    touch.lx = e.clientX; touch.ly = e.clientY; touch.moved += Math.abs(dx) + Math.abs(dy);
    if (!hooks.touchDrag || !hooks.touchDrag(e, dx, dy)) { mouse.dx += dx * 1.6; mouse.dy += dy * 1.6; }
  });
  const touchEnd = (e) => {
    if (e.pointerId !== touch.look) return;
    touch.look = null; mouse.down = false;
    if (touch.moved < 12 && performance.now() - touch.t0 < 350) clickPick(e);
  };
  canvas.addEventListener('pointerup', touchEnd); canvas.addEventListener('pointercancel', touchEnd);

  // ------------------------------------------------------------------ sound
  let audio = null;
  const buffers = new Map();
  let musicEl = null;
  let pendingMusic = null;
  function unlockAudio() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (audio.state === 'suspended') audio.resume();
    if (pendingMusic) { const p = pendingMusic; pendingMusic = null; p(); }
  }
  async function loadBuffer(url) {
    if (!buffers.has(url)) buffers.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => new Promise((ok, bad) => (audio || new (window.AudioContext || window.webkitAudioContext)()).decodeAudioData(b, ok, bad))));
    return buffers.get(url);
  }

  // ------------------------------------------------------------------ the world (one per run)
  let bundle = null;
  let W = null; // the current world: scene, entities, callbacks, timers, camera, ui
  const saved = new Map();
  let mode = 'play'; // 'play' (as players see it) or 'build' (the editor: markers, grabbing, popups)
  let clockOffset = 0; // shared time across players (net.js sets it), for behaviors that must line up

  const hasAsset = (name) => Boolean(bundle && bundle.assets && bundle.assets[name]);
  function assetUrl(name) {
    if (/^https:\/\//.test(String(name))) return name;
    const a = bundle && bundle.assets && bundle.assets[name];
    if (!a) throw new Error(`No asset named "${name}". Add it in the Assets panel, or check the spelling.`);
    return a.url;
  }
  const hex = (c, fallback = '#cccccc') => { try { return B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(String(c)) ? c : fallback); } catch { return B.Color3.FromHexString(fallback); } };
  const vec = (v, d = [0, 0, 0]) => (Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0] : v && typeof v === 'object' && 'x' in v ? [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0] : d);
  const posOf = (t) => (t && t.__entity ? [t.x, t.y, t.z] : vec(t));
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  // ------------------------------------------------------------------ entities
  class Entity {
    constructor(node, opts, kind) {
      this.__entity = true;
      this.node = node;
      this.kind = kind;
      this.tag = opts.tag || null;
      this.name = opts.name || null;
      this.data = opts.data || {};
      this.physics = opts.physics || (kindDefs.get(kind) && kindDefs.get(kind).physics) || 'static';
      const body = opts.body || {};
      this.bounce = Number(opts.bounce ?? body.bounce) || 0;
      this.friction = Number(opts.friction ?? body.friction ?? 0.6);
      this.mass = Math.max(0.05, Number(opts.mass ?? body.mass) || 1);
      this.grabbable = opts.grab ?? body.grab;
      this._v = [0, 0, 0]; // velocity (vx, vy, vz); physics.js sends it to the body when it changes
      this.grounded = false;
      this.standing = null;
      this.alive = true;
      this.handlers = { hit: [], click: [], leave: [] };
      this.half = [0.5, 0.5, 0.5];
      this.offset = [0, 0, 0];
      this.ready = Promise.resolve(this);
      this.animations = [];
      this.sceneId = null; // set for things from scene.json
      this.remote = false; // simulated by another player (net.js): it moves where they say
      this.held = false; // being carried (build.js): no gravity
      this.sleeping = false;
      this.gravity = 1;
      this.behaviors = [];
      this._mat = null;
      this._touching = new Set();
      this._still = 0;
      W.entities.add(this);
      node.metadata = { entity: this };
    }
    get mesh() { return this.node; }
    get x() { return this.node.position.x; } set x(v) { this.node.position.x = Number(v) || 0; this.wake(); }
    get y() { return this.node.position.y; } set y(v) { this.node.position.y = Number(v) || 0; this.wake(); }
    get z() { return this.node.position.z; } set z(v) { this.node.position.z = Number(v) || 0; this.wake(); }
    get position() { return [this.x, this.y, this.z]; }
    set position(v) { const p = vec(v); this.node.position.set(p[0], p[1], p[2]); this.wake(); }
    get vx() { return this._v[0]; } set vx(n) { this._v[0] = Number(n) || 0; this._vSet = true; }
    get vy() { return this._v[1]; } set vy(n) { this._v[1] = Number(n) || 0; this._vSet = true; }
    get vz() { return this._v[2]; } set vz(n) { this._v[2] = Number(n) || 0; this._vSet = true; }
    get velocity() { return [this.vx, this.vy, this.vz]; }
    set velocity(v) { const p = vec(v); this.vx = p[0]; this.vy = p[1]; this.vz = p[2]; this.wake(); }
    get rotation() { return this.node.rotation.y / RAD; }
    set rotation(deg) {
      if (Array.isArray(deg)) this.node.rotation.set((deg[0] || 0) * RAD, (deg[1] || 0) * RAD, (deg[2] || 0) * RAD);
      else this.node.rotation.y = (Number(deg) || 0) * RAD;
      this.measure();
    }
    get rotation3() { const r = this.node.rotation; return [r.x / RAD, r.y / RAD, r.z / RAD]; }
    turn(deg) { this.node.rotation.y += (Number(deg) || 0) * RAD; this.measure(); return this; }
    rotate(x = 0, y = 0, z = 0) { if (Array.isArray(x)) [x, y, z] = x; const r = this.node.rotation; r.x += (Number(x) || 0) * RAD; r.y += (Number(y) || 0) * RAD; r.z += (Number(z) || 0) * RAD; this.measure(); return this; }
    get scale() { const s = this.node.scaling; return s.x === s.y && s.y === s.z ? s.x : [s.x, s.y, s.z]; }
    set scale(v) { if (typeof v === 'number') this.node.scaling.setAll(v); else { const p = vec(v, [1, 1, 1]); this.node.scaling.set(p[0], p[1], p[2]); } this.measure(); }
    get forward() { const a = this.node.rotation.y; return { x: Math.sin(a), z: Math.cos(a) }; }
    get color() { return this._mat && this._mat.diffuseColor ? this._mat.diffuseColor.toHexString() : null; }
    set color(c) { if (this._mat && this._mat.diffuseColor) this._mat.diffuseColor = hex(c); }
    get emissive() { return this._mat && this._mat.emissiveColor ? this._mat.emissiveColor.toHexString() : null; }
    set emissive(c) { if (this._mat) this._mat.emissiveColor = hex(c, '#000000'); }
    get opacity() { return this._mat ? this._mat.alpha : 1; }
    set opacity(v) { if (this._mat) this._mat.alpha = Math.max(0, Math.min(1, Number(v))); }
    get visible() { return this.node.isEnabled(); }
    set visible(v) { this.node.setEnabled(Boolean(v)); }
    get solid() { return this.alive && (this.physics === 'static' || this.physics === 'dynamic' || this.physics === 'kinematic') && this.node.isEnabled() && !this.ghost; }
    get size() { return [this.half[0] * 2, this.half[1] * 2, this.half[2] * 2]; }
    get bottom() { return this.y + this.offset[1] - this.half[1]; }
    wake() { this.sleeping = false; this._still = 0; this._wakeBody = true; }

    /** The collider: a box (half extents and center offset) around the node as it is now. */
    measure() {
      if (this.kind === 'model' && !this._loaded) return;
      if (this.kind === 'light') { this.half = [0.2, 0.2, 0.2]; this.offset = [0, 0, 0]; return; }
      const n = this.node;
      n.computeWorldMatrix(true);
      let min, max;
      if (n.getHierarchyBoundingVectors) ({ min, max } = n.getHierarchyBoundingVectors(true, (m) => !(m.metadata && m.metadata.decor)));
      if (!min || !isFinite(min.x) || max.x - min.x < 1e-6 && max.y - min.y < 1e-6) return;
      this.half = [Math.max(0.01, (max.x - min.x) / 2), Math.max(0.01, (max.y - min.y) / 2), Math.max(0.01, (max.z - min.z) / 2)];
      this.offset = [(max.x + min.x) / 2 - n.position.x, (max.y + min.y) / 2 - n.position.y, (max.z + min.z) / 2 - n.position.z];
      this.measureLocal();
    }
    /** Its box when it isn't turned (half extents and center, scaled): what physics shapes are made from. */
    measureLocal() {
      const n = this.node, r = n.rotation.clone(), q = n.rotationQuaternion;
      n.rotationQuaternion = null; n.rotation.set(0, 0, 0);
      n.computeWorldMatrix(true);
      const { min, max } = n.getHierarchyBoundingVectors(true, (m) => !(m.metadata && m.metadata.decor));
      n.rotation.copyFrom(r); n.rotationQuaternion = q;
      n.computeWorldMatrix(true);
      if (!isFinite(min.x)) return;
      const lh = [Math.max(0.01, (max.x - min.x) / 2), Math.max(0.01, (max.y - min.y) / 2), Math.max(0.01, (max.z - min.z) / 2)];
      const lo = [(max.x + min.x) / 2 - n.position.x, (max.y + min.y) / 2 - n.position.y, (max.z + min.z) / 2 - n.position.z];
      const same = this._lhalf && lh.every((v, i) => Math.abs(v - this._lhalf[i]) < 1e-3) && lo.every((v, i) => Math.abs(v - this._loff[i]) < 1e-3);
      this._lhalf = lh; this._loff = lo;
      if (!same) this._mv = (this._mv || 0) + 1; // its shape changed: physics remakes the collider
    }
    box(pad = 0) {
      const c = [this.x + this.offset[0], this.y + this.offset[1], this.z + this.offset[2]];
      return { min: [c[0] - this.half[0] - pad, c[1] - this.half[1] - pad, c[2] - this.half[2] - pad], max: [c[0] + this.half[0] + pad, c[1] + this.half[1] + pad, c[2] + this.half[2] + pad] };
    }
    overlaps(o, pad = 0) {
      const a = this.box(pad), b = o.box();
      return a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2];
    }
    /** Moves along one axis, stopping at solid things. Returns what stopped it, or null. */
    sweep(axis, d) {
      if (!d) return null;
      const steps = Math.max(1, Math.ceil(Math.abs(d) / Math.max(0.05, Math.min(...this.half))));
      const step = d / steps;
      const key = ['x', 'y', 'z'][axis];
      for (let s = 0; s < steps; s++) {
        this.node.position[key] += step;
        let hit = null;
        for (const o of W.entities) {
          if (o === this || !o.solid || o.held || !this.overlaps(o)) continue;
          if (o === this.carrier || o.carrier === this) continue;
          const ob = o.box();
          const edge = step > 0 ? ob.min[axis] - this.half[axis] - this.offset[axis] - EPS : ob.max[axis] + this.half[axis] - this.offset[axis] + EPS;
          if (step > 0 ? edge < this.node.position[key] : edge > this.node.position[key]) this.node.position[key] = edge;
          hit = o;
        }
        if (hit) { this._contact(hit); return hit; }
      }
      return null;
    }
    move(dx = 0, dy = 0, dz = 0) {
      if (Array.isArray(dx) || (dx && typeof dx === 'object')) [dx, dy, dz] = vec(dx);
      if (this.physics === 'dynamic' || this.physics === 'kinematic') {
        this.sweep(0, Number(dx) || 0);
        this.sweep(2, Number(dz) || 0);
        if (this.sweep(1, Number(dy) || 0) && dy < 0) { this.grounded = true; this.vy = Math.max(0, this.vy); }
      } else {
        this.node.position.addInPlaceFromFloats(Number(dx) || 0, Number(dy) || 0, Number(dz) || 0);
      }
      this.wake();
      return this;
    }
    moveTo(x, y, z) { this.position = Array.isArray(x) ? x : [x, y, z]; return this; }
    walk(dir, speed = 5) {
      const d = Array.isArray(dir) ? { x: dir[0], z: dir[1] } : dir || { x: 0, z: 0 };
      const len = Math.hypot(d.x || 0, d.z || 0);
      const k = len > 1 ? 1 / len : 1;
      this.vx = (d.x || 0) * k * speed;
      this.vz = (d.z || 0) * k * speed;
      this._walked = true;
      if (this._upright === undefined && this.physics === 'dynamic') this._upright = true; // things that walk stay on their feet
      if (len > 0.05 && this !== W.player) this.node.rotation.y = Math.atan2(d.x, d.z);
      if (this.physics !== 'dynamic') this.move(this.vx * W.dt, 0, this.vz * W.dt);
      else if (len > 0.01) this.wake();
      return this;
    }
    jump(speed = 7) { if (!this.grounded) return false; this.vy = speed; this.grounded = false; this.standing = null; this.wake(); return true; }
    push(v) { const p = vec(v); this.vx += p[0]; this.vy += p[1]; this.vz += p[2]; this.grounded = false; this.wake(); return this; }
    lookAt(t) { const p = posOf(t); this.node.rotation.y = Math.atan2(p[0] - this.x, p[2] - this.z); return this; }
    distanceTo(t) { const p = posOf(t); return Math.hypot(p[0] - this.x, p[1] - this.y, p[2] - this.z); }
    touching(what) {
      for (const o of W.entities) {
        if (o === this || !o.alive || !o.node.isEnabled()) continue;
        if (typeof what === 'string' ? o.tag !== what : o !== what) continue;
        if (this.overlaps(o, TOUCH)) return true;
      }
      return false;
    }
    on(event, fn) { if (this.handlers[event]) this.handlers[event].push(safe(fn, W.file)); return this; }
    _contact(o) {
      if (this._touching.has(o)) return;
      this._touching.add(o);
      o._touching.add(this);
      for (const h of this.handlers.hit) h(o);
      for (const h of o.handlers.hit) h(this);
      for (const f of hooks.contact) f(this, o);
      runBehaviorHit(this, o);
      runBehaviorHit(o, this);
    }
    play(name, loop = true) {
      const g = this.animations.find((a) => a.name === name) || this.animations.find((a) => a.name.toLowerCase().includes(String(name).toLowerCase()));
      if (!g) return false;
      for (const a of this.animations) if (a !== g) a.stop();
      if (!g.isPlaying) g.start(loop, 1, g.from, g.to, false);
      return true;
    }
    animate(from, to, fps = 10, loop = true) { if (this._sheet) Object.assign(this._sheet, { from, to, fps, loop, t: 0, frame: from }); return this; }
    get frame() { return this._sheet ? this._sheet.frame : 0; }
    set frame(f) { if (this._sheet) { this._sheet.fps = 0; this._sheet.frame = f; setFrame(this, f); } }
    get flip() { return Boolean(this._flip); }
    set flip(v) { this._flip = Boolean(v); if (this._sheet) setFrame(this, this._sheet.frame); else if (this._tex) this._tex.uScale = this._flip ? -1 : 1; }
    say(text, seconds = 3) { showBubble(this, String(text), seconds); return this; }
    /** Runs fn(entity) when it is destroyed (modules clean up their own parts this way). */
    onDestroy(fn) { (this._onDestroy ||= []).push(fn); return this; }
    destroy() {
      if (!this.alive) return;
      this.alive = false;
      for (const b of this.behaviors) stopBehavior(this, b);
      this.behaviors = [];
      W.entities.delete(this);
      if (this.sceneId && W.byId.get(this.sceneId) === this) W.byId.delete(this.sceneId);
      for (const o of this._touching) o._touching.delete(this);
      if (W.camera.target === this) W.camera.target = null;
      if (W.player === this) W.player = null;
      if (this._bubble) this._bubble.dispose();
      // What its kind (H.kinds) and anyone else (e.onDestroy) need to undo.
      const k = kindDefs.get(this.kind);
      if (k && k.destroy) try { k.destroy(this); } catch (err) { report(err, `kind ${this.kind}`); }
      for (const f of this._onDestroy || []) try { f(this); } catch (err) { report(err); }
      for (const f of hooks.destroy) try { f(this); } catch (err) { report(err); }
      this.node.dispose(false, true);
      for (const e of W.entities) e.wake();
    }
  }

  function material(opts, name) {
    const m = new B.StandardMaterial(name || 'm', W.scene);
    m.diffuseColor = hex(opts.color, '#cfcfcf');
    m.specularColor = new B.Color3(0.08, 0.08, 0.08);
    if (opts.emissive) m.emissiveColor = hex(opts.emissive);
    if (opts.texture) {
      try {
        const t = new B.Texture(assetUrl(opts.texture), W.scene, false, true, W.pixelated ? B.Texture.NEAREST_SAMPLINGMODE : B.Texture.TRILINEAR_SAMPLINGMODE);
        const tile = vec(opts.tile, [1, 1, 0]);
        t.uScale = tile[0] || 1; t.vScale = tile[1] || 1;
        t.hasAlpha = /png|webp|gif/.test(String(bundle.assets[opts.texture]?.mime || opts.texture));
        m.diffuseTexture = t;
        m.useAlphaFromDiffuseTexture = t.hasAlpha;
        if (!opts.color) m.diffuseColor = new B.Color3(1, 1, 1);
      } catch (e) { if (!opts.lenient) throw e; }
    }
    if (opts.opacity !== undefined && opts.opacity !== null) m.alpha = Number(opts.opacity);
    return m;
  }

  function place(e, opts) {
    const p = opts.position ? vec(opts.position) : [Number(opts.x) || 0, Number(opts.y) || 0, Number(opts.z) || 0];
    e.node.position.set(p[0], p[1], p[2]);
    if (opts.rotation !== undefined && opts.rotation !== null) { if (Array.isArray(opts.rotation)) e.node.rotation.set((opts.rotation[0] || 0) * RAD, (opts.rotation[1] || 0) * RAD, (opts.rotation[2] || 0) * RAD); else e.node.rotation.y = Number(opts.rotation) * RAD; }
    if (opts.scale !== undefined && opts.scale !== null) { if (typeof opts.scale === 'number') e.node.scaling.setAll(opts.scale); else { const s = vec(opts.scale, [1, 1, 1]); e.node.scaling.set(s[0] || 1, s[1] || 1, s[2] || 1); } }
    if (opts.visible === false) e.node.setEnabled(false);
    if (opts.velocity) e.velocity = opts.velocity;
    if (W.shadows && opts.shadow !== false && e.kind !== 'sprite' && e.kind !== 'text') { for (const m of [e.node, ...e.node.getChildMeshes()]) if (m.getTotalVertices && m.getTotalVertices() > 0 && !(m.metadata && m.metadata.decor)) { W.shadows.addShadowCaster(m); m.receiveShadows = true; } }
    e.measure();
    return e;
  }

  function shape(kind, make, opts = {}) {
    const mesh = make();
    const e = new Entity(mesh, opts, kind);
    mesh.material = e._mat = material(opts, kind);
    mesh.receiveShadows = true;
    return place(e, opts);
  }
  const size3 = (s, d) => (Array.isArray(s) ? [s[0] ?? d, s[1] ?? d, s[2] ?? d] : [Number(s) || d, Number(s) || d, Number(s) || d]);


  function setFrame(e, f) {
    const s = e._sheet;
    const cols = s.cols, rows = s.rows;
    const i = Math.max(0, Math.min(cols * rows - 1, Math.floor(f)));
    const c = i % cols, r = Math.floor(i / cols);
    e._tex.uScale = (e._flip ? -1 : 1) / cols;
    e._tex.vScale = 1 / rows;
    e._tex.uOffset = (e._flip ? c + 1 : c) / cols;
    e._tex.vOffset = 1 - (r + 1) / rows;
  }


  /** A plane with text drawn on it: signs, labels, name tags. */
  function textPlane(text, o = {}) {
    const size = Number(o.size) || 0.5;
    const lines = String(text).split('\n').slice(0, 8);
    const px = 64;
    const ctxProbe = document.createElement('canvas').getContext('2d');
    ctxProbe.font = `600 ${px}px system-ui, sans-serif`;
    const w = Math.min(2048, Math.max(64, ...lines.map((l) => ctxProbe.measureText(l).width)) + px * 0.8);
    const h = lines.length * px * 1.25 + px * 0.5;
    const tex = new B.DynamicTexture('text', { width: Math.ceil(w), height: Math.ceil(h) }, W.scene, true);
    tex.hasAlpha = true;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, w, h);
    if (o.background !== false) { ctx.fillStyle = o.background || 'rgba(10,12,20,0.72)'; roundRect(ctx, 0, 0, w, h, px * 0.3); ctx.fill(); }
    ctx.font = `600 ${px}px system-ui, sans-serif`;
    ctx.fillStyle = o.color || '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, w / 2, px * 0.25 + px * 1.25 * (i + 0.5) + px * 0.1));
    tex.update();
    const plane = B.MeshBuilder.CreatePlane('text', { width: (w / px) * size, height: (h / px) * size, sideOrientation: B.Mesh.DOUBLESIDE }, W.scene);
    const m = new B.StandardMaterial('text', W.scene);
    m.diffuseTexture = tex; m.useAlphaFromDiffuseTexture = true; m.emissiveColor = new B.Color3(1, 1, 1); m.disableLighting = true; m.backFaceCulling = false;
    plane.material = m;
    if (o.billboard !== false) plane.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
    return plane;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function showBubble(e, str, seconds) {
    if (e._bubble) e._bubble.dispose();
    const b = textPlane(str, { size: 0.32 });
    b.isPickable = false;
    b.metadata = { decor: true };
    b.parent = e.node;
    b.position.set(0, e.half[1] + 0.5, 0);
    e._bubble = b;
    const world = W;
    setTimeout(() => { if (world === W && e._bubble === b) { b.dispose(); e._bubble = null; } }, seconds * 1000);
  }


  // ------------------------------------------------------------------ scene.json: things from the world file

  function optsFromSpec(spec) {
    const t = spec.transform || {};
    const m = spec.material || {};
    const body = spec.body || {};
    return {
      name: spec.name || null, tag: spec.tag || null, data: clone(spec.data) || {},
      physics: spec.physics || (kindDefs.get(spec.type) && kindDefs.get(spec.type).physics) || 'static',
      position: t.position, rotation: t.rotation, scale: t.scale,
      color: m.color, emissive: m.emissive, opacity: m.opacity, texture: m.texture, tile: m.tile,
      bounce: body.bounce, friction: body.friction, mass: body.mass, grab: body.grab,
      shadow: spec.shadow, visible: spec.visible, lenient: true,
    };
  }

  /** Builds one thing from its scene.json spec: its kind (H.kinds) makes it, the engine gives it its id and behaviors. */
  function fromSpec(spec) {
    const o = optsFromSpec(spec);
    const def = kindDefs.get(spec.type);
    let e;
    if (def) e = def.build(spec.shape || {}, o, spec);
    else e = shape('box', () => B.MeshBuilder.CreateBox('box', { size: 0.5 }, W.scene), o); // a kind no module knows (yet)
    if (!e || !e.__entity) throw new Error(`the kind "${spec.type}" built nothing (its build must return an entity)`);
    e.sceneId = spec.id;
    e.spec = spec;
    e.home = { position: e.position, rotation: e.rotation3 };
    W.byId.set(spec.id, e);
    attachBehaviors(e, spec.behaviors);
    return e;
  }

  /** Builds the whole world from scene.json. */
  function buildScene(graph) {
    W.graph = graph;
    for (const spec of Object.values(graph.entities || {})) {
      try { fromSpec(spec); } catch (e) { report(new Error(`${spec.name || spec.id}: ${e.message || e}`), 'scene.json'); }
    }
    // Parents after everything exists.
    for (const spec of Object.values(graph.entities || {})) if (spec.parent) setParent(spec.id, spec.parent);
    measureWorld();
  }
  function setParent(id, parentId) {
    const e = W.byId.get(id), p = W.byId.get(parentId);
    if (e && p) { e.node.setParent(p.node); e.carrier = p; }
  }
  /** Where the floor of the world is, so falling things are caught well below it. */
  function measureWorld() {
    let lowest = Infinity;
    for (const e of W.entities) if ((e.physics === 'static' || e.physics === 'kinematic') && e.sceneId) lowest = Math.min(lowest, e.bottom);
    W.catchY = Math.min(-25, (isFinite(lowest) ? lowest : 0) - 25);
  }

  /** Same rules as the server (src/scene.ts merge): arrays and values replace, null removes. */
  function merge(target, patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (k === '__proto__' || k === 'constructor') continue;
      if (v === null) delete target[k];
      else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) merge(target[k], v);
      else target[k] = clone(v);
    }
    return target;
  }
  const onlyTransform = (patch) => Object.keys(patch).every((k) => k === 'transform');

  /** World edits (from the editor, a friend, or the assistant), applied live. Returns the things they touched. */
  function applyOps(ops, o = {}) {
    if (!W) return [];
    const touched = [];
    for (const op of ops || []) {
      try {
        if (op.op === 'create' || op.op === 'replace') {
          const spec = clone(op.entity);
          if (!spec || !spec.id) continue;
          const old = W.byId.get(spec.id);
          if (old) old.destroy();
          W.graph.entities[spec.id] = spec;
          const e = fromSpec(spec);
          if (spec.parent) setParent(spec.id, spec.parent);
          touched.push(e);
        } else if (op.op === 'update') {
          const spec = W.graph.entities[op.id];
          if (!spec) continue;
          merge(spec, op.patch);
          const e = W.byId.get(op.id);
          if (e && onlyTransform(op.patch)) {
            const t = spec.transform || {};
            if (!e.remote || o.force) {
              place(e, { position: t.position || e.position, rotation: t.rotation, scale: t.scale, shadow: false });
              e.velocity = [0, 0, 0];
            }
            e.home = { position: vec(t.position, e.home.position), rotation: t.rotation || e.home.rotation };
            touched.push(e);
          } else {
            const keep = e ? { v: e.velocity, remote: e.remote } : null;
            if (e) e.destroy();
            const n = fromSpec(spec);
            if (spec.parent) setParent(spec.id, spec.parent);
            if (keep) n.remote = keep.remote;
            touched.push(n);
          }
        } else if (op.op === 'delete') {
          const gone = new Set([op.id]);
          for (let grew = true; grew;) { grew = false; for (const s of Object.values(W.graph.entities)) if (s.parent && gone.has(s.parent) && !gone.has(s.id)) { gone.add(s.id); grew = true; } }
          for (const id of gone) { delete W.graph.entities[id]; const e = W.byId.get(id); if (e) e.destroy(); }
        } else if (op.op === 'config') {
          merge(W.graph.config, op.patch);
          applyLook(effectiveConfig());
          changeFeatures(op.patch);
          if (op.patch && 'player' in op.patch && W.player && W.player.alive) applyPlayerSettings(W.player);
        }
      } catch (e) { report(e, 'scene.json'); }
    }
    measureWorld();
    for (const e of W.entities) e.wake();
    for (const f of hooks.world) if (f.ops) f.ops(ops, touched, o);
    return touched;
  }

  // ------------------------------------------------------------------ behaviors: what things do on their own
  const behaviorDefs = new Map(); // built-ins (behaviors.js) and ones scripts define with game.behavior
  const builtinDefs = new Map();
  function defineBehavior(name, def, builtin = false) {
    const n = String(name).toLowerCase();
    (builtin ? builtinDefs : behaviorDefs).set(n, def);
  }
  const findDef = (name) => behaviorDefs.get(String(name).toLowerCase()) || builtinDefs.get(String(name).toLowerCase()) || null;
  function attachBehaviors(e, list) {
    for (const raw of list || []) {
      if (!raw) continue;
      const b = typeof raw === 'string' ? { use: raw } : raw;
      const name = b.use || b.type;
      const def = findDef(name);
      const inst = { name, def, o: { ...(def && def.defaults || {}), ...b }, s: {} };
      e.behaviors.push(inst);
      if (!def) { if (W.started) report(new Error(`${e.name || e.sceneId}: no behavior called "${name}"`), 'scene.json'); continue; }
      if (W.started) startBehavior(e, inst);
    }
  }
  function startBehavior(e, b) { if (b.def && b.def.start && !b.started) { b.started = true; try { b.def.start(e, b.o, b.s, game); } catch (err) { report(err, `behavior ${b.name}`); } } else b.started = true; }
  function stopBehavior(e, b) { if (b.def && b.def.stop) try { b.def.stop(e, b.o, b.s, game); } catch (err) { report(err, `behavior ${b.name}`); } }
  function runBehaviorHit(e, other) {
    for (const b of e.behaviors) if (b.def && b.def.hit) try { b.def.hit(e, other, b.o, b.s, game); } catch (err) { report(err, `behavior ${b.name}`); }
  }
  function runBehaviors(dt) {
    for (const e of [...W.entities]) {
      if (!e.alive || !e.behaviors.length) continue;
      for (const b of e.behaviors) {
        if (!b.started) startBehavior(e, b);
        if (b.def && b.def.update && e.alive) try { b.def.update(e, dt, b.o, b.s, game); } catch (err) { report(err, `behavior ${b.name}`); b.def = null; }
      }
    }
  }

  // ------------------------------------------------------------------ camera
  function makeCamera() {
    const cam = new B.UniversalCamera('cam', new B.Vector3(0, 8, -14), W.scene);
    cam.setTarget(B.Vector3.Zero());
    cam.minZ = 0.05;
    cam.maxZ = 2000;
    cam.fov = 1.0;
    cam.inputs.clear();
    const state = { mode: 'fixed', target: null, opts: {}, cam, arc: null, shake: 0, shakeTime: 0, yaw: 0, pitch: 0, claimed: false };
    const claim = () => { if (!internal) state.claimed = true; };
    const api = {
      get target() { return state.target; },
      set target(v) { state.target = v; },
      get mode() { return state.mode; },
      follow(t, o = {}) { claim(); use(); Object.assign(state, { mode: 'follow', target: t, opts: { distance: 10, height: 5, smooth: 0.1, behind: false, ...o } }); snap(); return api; },
      topDown(t, o = {}) { claim(); use(); Object.assign(state, { mode: 'top', target: t, opts: { height: 18, smooth: 0.15, ...o } }); snap(); return api; },
      /** A commander's camera: WASD (or the screen edges) pans, the wheel zooms, the right mouse button turns. */
      strategy(at = [0, 0, 0], o = {}) { claim(); use(); const p = vec(at); Object.assign(state, { mode: 'strategy', target: null, focus: new B.Vector3(p[0], p[1], p[2]), opts: { distance: 30, pitch: 0.95, ...o } }); state.zoom = state.opts.distance; return api; },
      /** Behind the target, looking where the mouse looks: you see your character. */
      thirdPerson(t, o = {}) { claim(); use(); if (state.mode !== 'third') state.pitch = 0.32; Object.assign(state, { mode: 'third', target: t, opts: { distance: 5, height: 1.4, sensitivity: 0.15, ...o } }); return api; },
      firstPerson(t, o = {}) { claim(); use(); Object.assign(state, { mode: 'fps', target: t, opts: { height: t === W.player ? 1.6 : 0.6, sensitivity: 0.15, ...o }, yaw: t ? t.node.rotation.y : state.yaw, pitch: 0 }); if (t && t !== W.player) t.visible = o.showBody === true ? true : t.visible; return api; },
      fixed(p, look = [0, 0, 0]) { claim(); use(); const a = vec(p), b = vec(look); cam.position.set(a[0], a[1], a[2]); cam.setTarget(new B.Vector3(b[0], b[1], b[2])); state.mode = 'fixed'; state.target = null; return api; },
      orbit(t, o = {}) {
        claim();
        const p = t && t.__entity ? t.position : vec(t);
        if (!state.arc) { state.arc = new B.ArcRotateCamera('orbit', -Math.PI / 2, 1.1, o.distance || 12, new B.Vector3(p[0], p[1], p[2]), W.scene); state.arc.minZ = 0.05; state.arc.wheelPrecision = 20; state.arc.lowerRadiusLimit = 1; }
        state.arc.radius = o.distance || state.arc.radius;
        state.arc.attachControl(canvas, true);
        W.scene.activeCamera = state.arc;
        Object.assign(state, { mode: 'orbit', target: t && t.__entity ? t : null, opts: o });
        return api;
      },
      shake(strength = 0.3, seconds = 0.3) { state.shake = strength; state.shakeTime = seconds; return api; },
      get forward() { const c = W.scene.activeCamera; const d = c.getDirection(B.Axis.Z); return [d.x, d.y, d.z]; },
      get position() { const c = W.scene.activeCamera; return [c.position.x, c.position.y, c.position.z]; },
      get babylon() { return W.scene.activeCamera; },
    };
    let internal = false;
    state.internal = (fn) => { internal = true; try { return fn(); } finally { internal = false; } };
    function use() { if (state.arc) { state.arc.detachControl(); } W.scene.activeCamera = cam; }
    function want() {
      const t = state.target, o = state.opts;
      if (!t || !t.alive) return null;
      if (state.mode === 'top') return { pos: [t.x, t.y + o.height, t.z - 0.01], look: [t.x, t.y, t.z] };
      if (o.behind) { const f = t.forward; return { pos: [t.x - f.x * o.distance, t.y + o.height, t.z - f.z * o.distance], look: [t.x, t.y + 1, t.z] }; }
      const ang = (o.angle || 0) * RAD;
      return { pos: [t.x - Math.sin(ang) * o.distance, t.y + o.height, t.z - Math.cos(ang) * o.distance], look: [t.x, t.y + 0.5, t.z] };
    }
    function snap() { const w = want(); if (w) { cam.position.set(...w.pos); cam.setTarget(new B.Vector3(...w.look)); } }
    state.update = (dt) => {
      if (state.mode === 'orbit') { if (state.target && state.target.alive) state.arc.target.set(state.target.x, state.target.y, state.target.z); }
      else if (state.mode === 'fps') {
        const t = state.target;
        state.yaw += mouse.dx * state.opts.sensitivity * RAD;
        state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + mouse.dy * state.opts.sensitivity * RAD));
        if (t && t.alive) {
          t.node.rotation.y = state.yaw;
          const eye = t === W.player ? t.bottom + state.opts.height : t.y + state.opts.height;
          // Smooth the eye a little so steps and landings don't jolt the view.
          const k = state.eyeY === undefined ? 1 : Math.min(1, dt * 18);
          state.eyeY = state.eyeY === undefined ? eye : state.eyeY + (eye - state.eyeY) * k;
          cam.position.set(t.x, state.eyeY, t.z);
        }
        cam.rotation.set(state.pitch, state.yaw, 0);
      } else if (state.mode === 'strategy') {
        const o = state.opts;
        if (mouse.look) state.yaw += mouse.dx * 0.005;
        state.zoom = Math.max(6, Math.min(120, (state.zoom || o.distance) * (1 + mouse.wheel * 0.1)));
        const ax = game.input.axis();
        const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
        const pan = state.zoom * 0.9 * dt;
        state.focus.x += (ax.x * c + ax.y * s) * pan; state.focus.z += (-ax.x * s + ax.y * c) * pan;
        const back = new B.Vector3(-Math.sin(state.yaw) * Math.cos(o.pitch), Math.sin(o.pitch), -Math.cos(state.yaw) * Math.cos(o.pitch));
        cam.position.copyFrom(B.Vector3.Lerp(cam.position, state.focus.add(back.scale(state.zoom)), Math.min(1, dt * 10)));
        cam.setTarget(state.focus);
      } else if (state.mode === 'third') {
        const t = state.target, o = state.opts;
        state.yaw += mouse.dx * o.sensitivity * RAD;
        state.pitch = Math.max(-0.4, Math.min(1.2, state.pitch + mouse.dy * o.sensitivity * RAD));
        if (t && t.alive) {
          const head = new B.Vector3(t.x, (t === W.player ? t.bottom + 1.5 : t.y + o.height), t.z);
          const back = new B.Vector3(-Math.sin(state.yaw) * Math.cos(state.pitch), Math.sin(state.pitch), -Math.cos(state.yaw) * Math.cos(state.pitch));
          // Walls between you and the camera pull it in, so it never looks through them.
          let dist = o.distance;
          const hit = W.scene.pickWithRay(new B.Ray(head, back, o.distance), (m) => { const en = entityOf(m); return Boolean(en && en !== t && en.solid && !(m.metadata && m.metadata.decor)); });
          if (hit && hit.hit) dist = Math.max(0.8, hit.distance - 0.3);
          const want = head.add(back.scale(dist));
          const k = Math.min(1, dt * 14);
          cam.position.copyFrom(B.Vector3.Lerp(cam.position, want, k));
          cam.setTarget(head);
        }
      } else if (state.mode === 'follow' || state.mode === 'top') {
        const w = want();
        if (w) {
          const k = 1 - Math.pow(state.opts.smooth, dt * 10);
          cam.position.x += (w.pos[0] - cam.position.x) * k; cam.position.y += (w.pos[1] - cam.position.y) * k; cam.position.z += (w.pos[2] - cam.position.z) * k;
          cam.setTarget(new B.Vector3(...w.look));
        }
      }
      if (state.shakeTime > 0) {
        state.shakeTime -= dt;
        const c = W.scene.activeCamera, s = state.shake;
        c.position.x += (Math.random() - 0.5) * s; c.position.y += (Math.random() - 0.5) * s;
      }
    };
    state.yawNow = () => (state.mode === 'orbit' ? -state.arc.alpha - Math.PI / 2 : state.mode === 'fps' || state.mode === 'third' || state.mode === 'strategy' ? state.yaw : state.mode === 'top' ? 0 : Math.atan2(cam.getTarget().x - cam.position.x, cam.getTarget().z - cam.position.z));
    state.api = api;
    return state;
  }

  // ------------------------------------------------------------------ the player: first person, caught when falling
  function spawnPoint(role = 'player') {
    const r = String(role || 'player');
    let best = null;
    for (const e of W.entities) if (e.kind === 'spawn' && (e.data.role === r || e.tag === r || (!best && (!e.data.role || e.data.role === 'player')))) best = e;
    if (W.checkpoint && r === 'player') return W.checkpoint.slice();
    return best ? [best.x, best.bottom + 0.05, best.z] : [0, 0.05, 6];
  }
  /** The player everyone gets unless the game makes its own: a body to walk, jump, fly and build with. */
  /** How the player plays, from scene.json / game.json "player": { view, speed, jump, fly, doubleJump, gravity, distance }.
   *  The assistant changes these when someone says "let me fly", "jump higher", "I want to see my character". */
  function playerSettings() {
    const c = effectiveConfig().player;
    return c && typeof c === 'object' ? c : {};
  }
  function applyPlayerSettings(p) {
    const s = playerSettings();
    const want = controllerDefs.has(String(s.mode)) ? String(s.mode) : 'walk';
    p.mode = want;
    p.speed = Number(s.speed) || (controllerDefs.get(want) && controllerDefs.get(want).speed) || 6;
    p.jumpHeight = Number(s.jump) || 1.5;
    p.canFly = s.fly === true;
    p.doubleJump = s.doubleJump === true;
    p.baseGravity = s.gravity === undefined ? 1 : Math.max(0, Number(s.gravity));
    useController(p, mode === 'build' ? 'walk' : want, {}, true);
    p.mouse = s.mouse === 'free' || s.view === 'rts' ? 'free' : 'locked';
    if (s.tool !== undefined) p.tool = s.tool || null;
    else if (s.weapon !== undefined) p.weapon = s.weapon || null;
    p.gravity = p.flying ? 0 : p.baseGravity;
    setView(p, s.view || p.view || 'first', s.distance);
  }

  // ------------------------------------------------------------------ controllers: how the player moves (H.controllers)
  const controlCtx = (p, c) => ({ game, H: window.HawkesPlay, state: c.state, opts: c.opts, mode, player: p });
  /** Switches the player to a way of moving (a controller's name): its exit, then the new one's enter. */
  function useController(p, name, opts = {}, quiet = false) {
    const next = controllerDefs.get(String(name)) || controllerDefs.get('walk');
    if (!next) return;
    const cur = p._controller;
    if (cur && cur.def.exit) try { cur.def.exit(p, controlCtx(p, cur)); } catch (err) { report(err, `controller ${cur.name}`); }
    p._controller = { def: next, name: next.name, opts: opts || {}, state: {} };
    if (next.enter) try { next.enter(p, controlCtx(p, p._controller)); } catch (err) { report(err, `controller ${next.name}`); }
    if (!quiet && p === W.player) setView(p, p._view || 'first');
  }

  /** first (your eyes), third (behind you: you see your character), top (from above), rts (a commander's camera over
   *  the map with the mouse free: you click things instead of walking). */
  function setView(p, view, distance) {
    const v = ['first', 'third', 'top', 'rts'].includes(view) ? view : 'first';
    p._view = v;
    const rts = v === 'rts' && mode !== 'build';
    p.node.visibility = v === 'first' || rts || p._shipOn ? 0 : 1;
    if (p._visor) p._visor.setEnabled(v !== 'first' && !rts);
    p.ghost = rts;
    if (rts) { p.controls = false; p.gravity = 0; p.velocity = [0, 0, 0]; }
    if (rts && document.pointerLockElement) document.exitPointerLock();
    W.camera.internal(() => {
      if (W.camera.target !== p && W.camera.claimed && W.camera.mode !== 'fps' && W.camera.mode !== 'third' && W.camera.mode !== 'top') return;
      if (rts) W.camera.api.strategy([p.x, 0, p.z], { distance: Number(distance) || 30 });
      else if (v === 'third' || (v === 'rts' && mode === 'build')) W.camera.api.thirdPerson(p, { distance: Number(distance) || 5 });
      else if (v === 'top') W.camera.api.topDown(p, { height: Number(distance) || 18 });
      else W.camera.api.firstPerson(p, { height: 1.6 });
    });
  }

  function ensurePlayer() {
    if (W.player && W.player.alive) return W.player;
    const feet = spawnPoint();
    const p = shape('capsule', () => B.MeshBuilder.CreateCapsule('player', { radius: 0.35, height: 1.8, tessellation: 12 }, W.scene), { y: feet[1] + 0.9, x: feet[0], z: feet[2], color: hooks.myColor || '#4a9eff', physics: 'dynamic', tag: 'player', name: hooks.myName || 'You', shadow: true });
    p.node.isPickable = false;
    p.node.visibility = 0; // you don't see your own body; your friends do (net.js)
    p.health = 100;
    p.controls = W.config.controls !== false;
    p.flying = false;
    p.isPlayer = true;
    W.player = p;
    // A visor, so you can tell which way your character faces (shown when you can see yourself).
    const visor = B.MeshBuilder.CreateBox('visor', { width: 0.5, height: 0.14, depth: 0.12 }, W.scene);
    const vm = new B.StandardMaterial('visor', W.scene);
    vm.emissiveColor = new B.Color3(0.85, 0.95, 1); vm.disableLighting = true;
    visor.material = vm; visor.parent = p.node; visor.position.set(0, 0.5, 0.32); visor.metadata = { decor: true }; visor.isPickable = false;
    p._visor = visor;
    Object.defineProperty(p, 'view', { get: () => p._view, set: (v) => setView(p, v), configurable: true });
    // What it holds (H.tools: a gun, a shovel, a rod...) and how it moves (H.controllers).
    p.tool = null;
    Object.defineProperty(p, 'weapon', { get: () => p.tool, set: (v) => { p.tool = weaponTool(v); }, configurable: true });
    Object.defineProperty(p, 'controller', { get: () => (p._controller ? p._controller.name : null), configurable: true });
    p.control = (name, opts) => { useController(p, name, opts); return p; };
    const yaw = W.camera.yaw;
    applyPlayerSettings(p);
    if (W.keepPose) { p.position = W.keepPose.p; W.camera.yaw = W.keepPose.yaw; W.camera.pitch = W.keepPose.pitch; p.flying = W.keepPose.flying; W.keepPose = null; }
    else W.camera.yaw = yaw || (spawnYaw() ?? 0);
    buildTouch();
    return p;
  }
  function spawnYaw() { for (const e of W.entities) if (e.kind === 'spawn') return e.node.rotation.y; return null; }

  // ------------------------------------------------------------------ tools: what the player holds (H.tools)
  const heldTool = { key: null, def: null, ctx: null };
  /** config.player.weapon / player.weapon: a tool by another name ("rifle"), an unknown gun is the first one. */
  function weaponTool(v) {
    if (!v) return null;
    const t = typeof v === 'string' ? v : v.type;
    if (toolDefs.has(t) || !toolDefs.has('blaster')) return v;
    return typeof v === 'string' ? 'blaster' : { ...v, type: 'blaster' };
  }
  const toolName = (t) => (typeof t === 'string' ? t : t && (t.type || t.name)) || null;
  /** Each frame: the tool in the player's hands is the one they should hold (none while building, in an RTS view, or
   *  in a controller that says tools: false). */
  function syncTool() {
    const p = W && W.player;
    const c = p && p._controller;
    const t = p && p.alive && mode !== 'build' && p._view !== 'rts' && !(c && c.def.tools === false) ? p.tool : null;
    const def = t ? toolDefs.get(toolName(t)) : null;
    const key = def ? `${def.name}:${JSON.stringify(t)}` : null;
    if (key === heldTool.key) return;
    dropTool();
    if (!def) return;
    const opts = typeof t === 'object' ? { ...t } : {};
    heldTool.key = key; heldTool.def = def;
    heldTool.ctx = { game, H: window.HawkesPlay, player: p, opts, state: {}, name: def.name };
    if (def.equip) try { def.equip(heldTool.ctx); } catch (err) { report(err, `tool ${def.name}`); }
  }
  function dropTool() {
    const { def, ctx } = heldTool;
    heldTool.key = null; heldTool.def = null; heldTool.ctx = null;
    if (def && def.unequip) try { def.unequip(ctx); } catch (err) { report(err, `tool ${def.name}`); }
  }
  function toolTick(which, dt) {
    const { def, ctx } = heldTool;
    if (def && def[which]) try { def[which](dt, ctx); } catch (err) { report(err, `tool ${def.name}`); }
  }

  function controlPlayer(dt) {
    const p = W.player;
    if (!p || !p.alive || !p.controls || W.camera.target !== p) return;
    // Building is always walking (and flying around); playing, whatever the game or a module switched to.
    if (!p._controller || (mode === 'build' && p._controller.name !== 'walk')) useController(p, mode === 'build' ? 'walk' : p.mode || 'walk', {}, true);
    const c = p._controller;
    if (!c) return;
    const ctx = controlCtx(p, c);
    try {
      if (hooks.canMove && !hooks.canMove()) { if (c.def.idle) c.def.idle(p, ctx); else { p.velocity = [0, 0, 0]; p._walked = true; } return; }
      c.def.update(p, dt, ctx);
    } catch (err) { report(err, `controller ${c.name}`); }
  }

  /** Something fell out of the world: people go back to the start, things go back where they were. */
  function caught(e) {
    if (e === W.player) {
      respawn(true);
      return;
    }
    if (e.remotePlayer) return;
    if (e.sceneId && e.home) {
      e.position = e.home.position; e.velocity = [0, 0, 0];
      for (const f of hooks.world) if (f.reset) f.reset(e);
    } else e.destroy();
  }
  function respawn(fell) {
    const p = W.player;
    if (!p) return;
    const at = spawnPoint();
    p.position = [at[0], at[1] + 0.95, at[2]];
    p.velocity = [0, 0, 0];
    p.health = 100;
    p.flying = false;
    if (fell) game.ui.message('Caught you', 1.2);
    // Nothing to stand on (the floor was deleted?): a temporary pad so nobody falls forever.
    const below = rayDown([at[0], at[1] + 1, at[2]], 80);
    if (!below) {
      const old = game.find('_safety');
      if (old) old.destroy();
      const pad = game.cylinder({ x: at[0], y: at[1] - 0.15, z: at[2], radius: 2.5, height: 0.3, color: '#4a9eff', emissive: '#12305a', opacity: 0.8, name: '_safety', tag: '_safety' });
      pad.temporary = true;
      game.after(20, () => pad.destroy());
    }
    for (const f of hooks.world) if (f.respawn) f.respawn(p);
  }
  function rayDown(from, dist) {
    const ray = new B.Ray(new B.Vector3(from[0], from[1], from[2]), new B.Vector3(0, -1, 0), dist);
    const hit = W.scene.pickWithRay(ray, (m) => { const en = entityOf(m); return en && en !== W.player && en.solid; });
    return hit && hit.hit ? hit : null;
  }
  const entityOf = (m) => { let n = m; while (n && !(n.metadata && n.metadata.entity)) n = n.parent; return n ? n.metadata.entity : null; };

  function hurtPlayer(amount, from) {
    const p = W.player;
    if (!p || mode === 'build' && p.flying) return;
    if (amount < 0) { p.health = Math.min(p.maxHealth || 100, p.health - amount); return; }
    p.health = Math.max(0, p.health - amount);
    W.camera.api.shake(0.15, 0.2);
    game.emit('hurt', { entity: p, amount, from });
    if (p.health <= 0) { game.emit('death', { entity: p, by: from }); game.ui.message('Down! Back to the start', 1.6); respawn(false); }
    for (const f of hooks.world) if (f.hurt) f.hurt(p, amount, from);
  }
  /** Damage to anything: you, another player (told over the network), or a thing with health (combat.js). */
  function damage(target, amount, from) {
    if (!target || !target.alive) return false;
    if (target === W.player) { hurtPlayer(amount, from); return true; }
    if (target.remotePlayer) { if (hooks.net) hooks.net.send('_hurt', { to: target.netId, amount }); return true; }
    return hooks.damage ? hooks.damage(target, amount, from) : false;
  }

  // ------------------------------------------------------------------ screen ui
  function ui() {
    const items = new Map();
    const place = (el, o = {}) => {
      const x = o.x || 'left', y = o.y || 'top';
      el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.transform = '';
      const tx = x === 'center' ? '-50%' : '0', ty = y === 'middle' ? '-50%' : '0';
      if (x === 'left') el.style.left = '16px'; else if (x === 'right') el.style.right = '16px'; else el.style.left = '50%';
      if (y === 'top') el.style.top = `${(hooks.uiTop || 16) + stackIndex(el, x, y) * 34}px`; else if (y === 'bottom') el.style.bottom = `${(hooks.uiBottom || 16) + stackIndex(el, x, y) * 34}px`; else el.style.top = '50%';
      el.style.transform = `translate(${tx}, ${ty})`;
    };
    const stackIndex = (el, x, y) => { let i = 0; for (const [, it] of items) { if (it.el === el) break; if ((it.o.x || 'left') === x && (it.o.y || 'top') === y) i++; } return i; };
    const get = (id, tag, cls, o) => {
      let it = items.get(id);
      if (!it) { const el = document.createElement(tag); el.className = cls; uiLayer.appendChild(el); it = { el, o }; items.set(id, it); }
      it.o = o;
      return it;
    };
    const api = {
      text(id, text, o = {}) { const it = get(String(id), 'div', 'ui-text', o); it.el.textContent = String(text); it.el.style.fontSize = `${o.size || 22}px`; it.el.style.color = o.color || ''; place(it.el, o); return api; },
      bar(id, value, o = {}) {
        const it = get(String(id), 'div', 'ui-bar', o);
        if (!it.el.firstChild) it.el.innerHTML = '<span class="ui-bar-label"></span><div class="ui-bar-track"><div class="ui-bar-fill"></div></div>';
        it.el.querySelector('.ui-bar-label').textContent = o.label || '';
        const fill = it.el.querySelector('.ui-bar-fill');
        fill.style.width = `${Math.max(0, Math.min(1, Number(value) || 0)) * 100}%`;
        fill.style.background = o.color || '';
        place(it.el, o);
        return api;
      },
      button(id, label, fn, o = {}) {
        const it = get(String(id), 'button', 'ui-button', o);
        it.el.textContent = String(label);
        it.el.onclick = safe(() => { unlockAudio(); fn && fn(); });
        place(it.el, { x: 'center', y: 'middle', ...o });
        return api;
      },
      message(text, seconds = 2) {
        uiLayer.querySelectorAll('.ui-message').forEach((e) => e.remove());
        const el = document.createElement('div');
        el.className = 'ui-message';
        el.textContent = String(text);
        uiLayer.appendChild(el);
        setTimeout(() => el.classList.add('out'), Math.max(0.2, seconds) * 1000);
        setTimeout(() => el.remove(), Math.max(0.2, seconds) * 1000 + 400);
        return api;
      },
      remove(id) { const it = items.get(String(id)); if (it) { if (it.close) it.close(); else it.el.remove(); items.delete(String(id)); } return api; },
      clear() { for (const [, it] of items) it.el.remove(); items.clear(); attached.clear(); uiLayer.querySelectorAll('.ui-message, .ui-over, .ui-menu-wrap, .ui-popup-wrap').forEach((e) => e.remove()); if (W) W.paused = false; return api; },

      /** The game's look for all of this: { font, color, accent, panel, border, radius, blur } (also game.json "ui"). */
      theme(t = {}) {
        const set = (k, v) => { if (v !== undefined && v !== null) uiLayer.style.setProperty(k, String(v)); };
        set('--ui-font', t.font); set('--ui-fg', t.color); set('--ui-accent', t.accent); set('--ui-panel', t.panel);
        set('--ui-border', t.border); set('--ui-radius', t.radius !== undefined ? `${Number(t.radius) || 0}px` : undefined); set('--ui-blur', t.blur !== undefined ? `${Number(t.blur) || 0}px` : undefined);
        return api;
      },
      /** Your own CSS for the game's screens (classes you give panels and menus with class:). */
      style(css) { let el = document.getElementById('ui-style'); if (!el) { el = document.createElement('style'); el.id = 'ui-style'; document.head.appendChild(el); } el.textContent = String(css); return api; },
      /** A box on screen: { title, text or html, x, y, width, buttons: [{ label, onClick }], class, closable }. */
      panel(id, o = {}) {
        const it = get(String(id), 'div', 'ui-panel', o);
        it.el.className = `ui-panel ${o.class || ''}`;
        it.el.innerHTML = `${o.title ? '<div class="ui-panel-title"></div>' : ''}<div class="ui-panel-body"></div>${o.buttons && o.buttons.length ? '<div class="ui-panel-buttons"></div>' : ''}${o.closable ? '<button class="ui-x" aria-label="Close">×</button>' : ''}`;
        if (o.title) it.el.querySelector('.ui-panel-title').textContent = String(o.title);
        const body = it.el.querySelector('.ui-panel-body');
        if (o.html !== undefined) body.innerHTML = String(o.html); else body.textContent = String(o.text ?? '');
        buttons(it.el.querySelector('.ui-panel-buttons'), o.buttons, () => api.remove(id));
        if (o.closable) it.el.querySelector('.ui-x').onclick = () => api.remove(id);
        if (o.width) it.el.style.width = `${Number(o.width)}px`;
        place(it.el, { x: 'left', y: 'top', ...o });
        return { el: it.el, close: () => api.remove(id), update: (more) => api.panel(id, { ...o, ...more }) };
      },
      /** A menu over the game (it pauses while open): { title, items: [{ label, onClick }], pause, closable, class }. */
      menu(id, o = {}) {
        api.remove(id);
        const wrap = document.createElement('div');
        wrap.className = `ui-menu-wrap ${o.class || ''}`;
        wrap.innerHTML = `<div class="ui-menu">${o.title ? '<div class="ui-menu-title"></div>' : ''}${o.text ? '<div class="ui-menu-text"></div>' : ''}<div class="ui-menu-items"></div></div>`;
        if (o.title) wrap.querySelector('.ui-menu-title').textContent = String(o.title);
        if (o.text) wrap.querySelector('.ui-menu-text').textContent = String(o.text);
        const pause = o.pause !== false;
        const close = () => { wrap.remove(); items.delete(String(id)); document.removeEventListener('keydown', keys, true); if (pause && W) W.paused = false; };
        const list = buttons(wrap.querySelector('.ui-menu-items'), o.items, close);
        let at = 0;
        const focus = () => { list.forEach((b, i) => b.classList.toggle('on', i === at)); if (list[at]) list[at].focus(); };
        const keys = (e) => {
          const k = e.key;
          if (k === 'ArrowDown' || k === 's') { at = (at + 1) % list.length; focus(); e.preventDefault(); e.stopPropagation(); }
          else if (k === 'ArrowUp' || k === 'w') { at = (at - 1 + list.length) % list.length; focus(); e.preventDefault(); e.stopPropagation(); }
          else if (k === 'Escape' && o.closable !== false) { close(); e.stopPropagation(); }
        };
        document.addEventListener('keydown', keys, true);
        uiLayer.appendChild(wrap);
        items.set(String(id), { el: wrap, o, close });
        if (pause && W) W.paused = true;
        if (document.pointerLockElement) document.exitPointerLock();
        setTimeout(focus, 0);
        return { el: wrap, close };
      },
      /** A question with buttons; resolves to the label picked: await game.ui.popup('Open the door?', { buttons: ['Yes', 'No'] }). */
      popup(text, o = {}) {
        return new Promise((resolve) => {
          const labels = (o.buttons || ['OK']).map((b) => (typeof b === 'string' ? { label: b } : b));
          const wrap = document.createElement('div');
          wrap.className = `ui-popup-wrap ${o.class || ''}`;
          wrap.innerHTML = `<div class="ui-popup">${o.title ? '<div class="ui-menu-title"></div>' : ''}<div class="ui-popup-text"></div><div class="ui-panel-buttons"></div></div>`;
          if (o.title) wrap.querySelector('.ui-menu-title').textContent = String(o.title);
          wrap.querySelector('.ui-popup-text').textContent = String(text);
          const done = (label) => { wrap.remove(); if (o.pause !== false && W) W.paused = false; resolve(label); };
          buttons(wrap.querySelector('.ui-panel-buttons'), labels.map((b) => ({ ...b, onClick: () => { if (b.onClick) b.onClick(); done(b.label); } })), null);
          uiLayer.appendChild(wrap);
          if (o.pause !== false && W) W.paused = true;
          if (document.pointerLockElement) document.exitPointerLock();
          if (o.seconds) setTimeout(() => { if (wrap.isConnected) done(null); }, o.seconds * 1000);
        });
      },
      /** Asks for words; resolves to what they typed (or null). */
      ask(question, o = {}) {
        return new Promise((resolve) => {
          const wrap = document.createElement('div');
          wrap.className = `ui-popup-wrap ${o.class || ''}`;
          wrap.innerHTML = '<form class="ui-popup"><div class="ui-popup-text"></div><input class="ui-input" maxlength="200"><div class="ui-panel-buttons"><button class="ui-btn primary" type="submit">OK</button><button class="ui-btn" type="button">Cancel</button></div></form>';
          wrap.querySelector('.ui-popup-text').textContent = String(question);
          const input = wrap.querySelector('input');
          input.placeholder = o.placeholder || '';
          input.value = o.value || '';
          const done = (v) => { wrap.remove(); if (W) W.paused = false; resolve(v); };
          wrap.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(input.value); };
          wrap.querySelector('button[type=button]').onclick = () => done(null);
          uiLayer.appendChild(wrap);
          if (W) W.paused = true;
          if (document.pointerLockElement) document.exitPointerLock();
          setTimeout(() => input.focus(), 0);
        });
      },
      /** A label or panel that stays on a thing in the world: game.ui.attach('hp_bob', bob, { text: 'Bob' }). */
      attach(id, entity, o = {}) {
        const it = get(String(id), 'div', 'ui-attach', o);
        it.el.className = `ui-attach ${o.class || ''}`;
        if (o.html !== undefined) it.el.innerHTML = String(o.html); else it.el.textContent = String(o.text ?? '');
        attached.set(String(id), { el: it.el, entity, offset: o.offset ?? 0.4 });
        return { el: it.el, close: () => { attached.delete(String(id)); api.remove(id); } };
      },
      /** Your own HTML on screen (anything the other helpers don't cover). */
      html(id, html, o = {}) { const it = get(String(id), 'div', `ui-html ${o.class || ''}`, o); it.el.innerHTML = String(html); if (o.x || o.y) place(it.el, o); return it.el; },
      el(id) { const it = items.get(String(id)); return it ? it.el : null; },
    };
    function buttons(box, list, close) {
      if (!box || !list) return [];
      return list.map((b) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `ui-btn${b.primary ? ' primary' : ''}${b.class ? ` ${b.class}` : ''}`;
        el.textContent = String(b.label ?? '');
        el.onclick = safe(() => { unlockAudio(); if (b.onClick) b.onClick(); if (b.close !== false && close) close(); });
        box.appendChild(el);
        return el;
      });
    }
    // Labels on things follow them on screen (one frame hook for every world; this world's labels).
    const attached = new Map();
    ui.attached = attached;
    if (!ui.hooked) ui.hooked = hooks.frame.push(() => {
      const attached = ui.attached;
      if (!W || !attached || !attached.size) return;
      const cam = W.scene.activeCamera;
      const eng = W.scene.getEngine();
      const vw = eng.getRenderWidth(true) / (window.devicePixelRatio || 1), vh = eng.getRenderHeight(true) / (window.devicePixelRatio || 1);
      for (const [id, a] of attached) {
        if (!a.entity || !a.entity.alive) { a.el.remove(); attached.delete(id); continue; }
        const e = a.entity;
        const p = B.Vector3.Project(new B.Vector3(e.x, e.y + e.half[1] + a.offset, e.z), B.Matrix.Identity(), W.scene.getTransformMatrix(), cam.viewport.toGlobal(vw, vh));
        const show = p.z > 0 && p.z < 1 && e.visible;
        a.el.style.display = show ? '' : 'none';
        if (show) a.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      }
    });
    return api;
  }

  // ------------------------------------------------------------------ the game object scripts see
  let game = null;
  function makeGame() {
    const cfg = W.config;
    const net = hooks.net || null;
    const g = {
      get time() { return W.time; },
      /** Seconds on a clock every player shares (use it for things that must line up between players). */
      get now() { return (Date.now() + clockOffset) / 1000; },
      get paused() { return W.paused; },
      get dt() { return W.dt; },
      get mode() { return mode; },
      state: W.state,
      config: cfg,
      title: bundle.title,
      onStart(fn) { W.starts.push(safe(fn, W.file)); },
      onUpdate(fn) { const f = safe(fn, W.file); W.updates.push(f); return () => { W.updates = W.updates.filter((x) => x !== f); }; },
      after(s, fn) { const t = { at: W.time + Number(s), fn: safe(fn, W.file) }; W.timers.push(t); return () => { t.dead = true; }; },
      every(s, fn) { const t = { at: W.time + Number(s), every: Math.max(0.01, Number(s)), fn: safe(fn, W.file) }; W.timers.push(t); return () => { t.dead = true; }; },
      pause() { W.paused = true; },
      resume() { W.paused = false; },
      restart() { W.restartAsked = true; },
      over(text = 'Game over') {
        W.paused = true;
        if (document.pointerLockElement) document.exitPointerLock();
        const el = document.createElement('div');
        el.className = 'ui-over';
        el.innerHTML = '<div class="ui-over-text"></div><button class="ui-button">Play again</button>';
        el.querySelector('.ui-over-text').textContent = String(text);
        el.querySelector('button').onclick = () => { W.restartAsked = true; };
        uiLayer.appendChild(el);
      },
      save(k, v) { saved.set(String(k), JSON.stringify(v)); },
      load(k, fallback = null) { const v = saved.get(String(k)); return v === undefined ? fallback : JSON.parse(v); },

      // game.box(), game.model(), ...: every kind's maker (H.kinds), added below.

      find: (name) => { for (const e of W.entities) if (e.name === name || (e.sceneId && e.sceneId === name)) return e; return null; },
      all: (tag) => [...W.entities].filter((e) => !tag || e.tag === tag || e.name === tag),
      nearest(tag, from) { const p = posOf(from); let best = null, bd = Infinity; for (const e of W.entities) { if (tag && e.tag !== tag) continue; if (from && from.__entity && e === from) continue; const d = Math.hypot(e.x - p[0], e.y - p[1], e.z - p[2]); if (d < bd) { bd = d; best = e; } } return best; },
      /** A thing from scene.json by its id. */
      entity: (id) => W.byId.get(String(id)) || null,

      /** The player: a first-person body made for you (unless your scripts make their own camera). */
      get player() { return ensurePlayer(); },
      /** Puts the player at a spawn point (one with that role or tag) and returns them. */
      spawn(role = 'player') { const p = ensurePlayer(); const at = spawnPoint(role); p.position = [at[0], at[1] + 0.95, at[2]]; p.velocity = [0, 0, 0]; return p; },
      respawn() { respawn(false); },
      checkpoint(at) { W.checkpoint = at ? posOf(at) : null; },
      hurt(amount = 10) { hurtPlayer(Number(amount) || 0, null); },
      /** Your own events, and the engine's: 'death', 'kill', 'pickup', 'hurt', 'checkpoint', 'finish', 'gate'. */
      on(name, fn) { const list = W.events.get(name) || []; list.push(safe(fn, W.file)); W.events.set(name, list); },
      emit(name, data) { for (const f of W.events.get(name) || []) f(data); },
      /** Hurts a thing (or a player) by amount; things with health (the "health" or "enemy" behavior) can die. */
      damage(target, amount = 10, from = null) { return damage(target, Number(amount) || 0, from); },
      /** The first thing a ray hits: { entity, point, distance, normal } or null. */
      raycast(from, dir, dist = 100, o = {}) {
        const a = posOf(from);
        const d = Array.isArray(dir) ? vec(dir) : dir && 'y' in dir ? vec(dir) : [dir?.x || 0, 0, dir?.z || 0];
        const len = Math.hypot(...d) || 1;
        const ray = new B.Ray(new B.Vector3(a[0], a[1], a[2]), new B.Vector3(d[0] / len, d[1] / len, d[2] / len), Number(dist) || 100);
        const skip = o.ignore || (from && from.__entity ? from : W.player);
        const hit = W.scene.pickWithRay(ray, (m) => { const en = entityOf(m); return Boolean(en && en.alive && en !== skip && m.isPickable !== false && m.isEnabled() && !(m.metadata && m.metadata.decor) && (o.all || en.physics !== 'none' || en.kind === 'light')); });
        if (!hit || !hit.hit) return null;
        const n = hit.getNormal(true);
        return { entity: entityOf(hit.pickedMesh), point: [hit.pickedPoint.x, hit.pickedPoint.y, hit.pickedPoint.z], distance: hit.distance, normal: n ? [n.x, n.y, n.z] : [0, 1, 0] };
      },
      /** What the camera is looking at (the crosshair). */
      aim(dist = 100) { const c = W.scene.activeCamera; const d = c.getDirection(B.Axis.Z); return g.raycast([c.position.x, c.position.y, c.position.z], [d.x, d.y, d.z], dist, { ignore: W.player, all: true }); },
      /** A behavior anything can use: game.behavior('wobble', { update(thing, dt, options, memory, game) {} }). */
      behavior(name, def) { defineBehavior(name, def || {}); for (const e of W.entities) for (const b of e.behaviors) if (String(b.name).toLowerCase() === String(name).toLowerCase()) { b.def = def; b.o = { ...(def.defaults || {}), ...b.o }; b.started = false; } },
      net: {
        send: (name, data) => { if (hooks.net) hooks.net.send(name, data); },
        everyone: (name, data) => { if (hooks.net) hooks.net.send(name, data, true); else for (const f of W.netHandlers.get(name) || []) f(data, null); },
        on: (name, fn) => { const list = W.netHandlers.get(name) || []; list.push(safe(fn, W.file)); W.netHandlers.set(name, list); },
        get online() { return Boolean(hooks.net && hooks.net.online); },
        get isHost() { return !hooks.net || hooks.net.isHost; },
        get me() { return hooks.net ? hooks.net.me : null; },
        get players() { return hooks.net ? hooks.net.players() : []; },
      },
      /** Physics for scripts: raycast, overlap, explode, joint, shapes, layers (H.physics; API.md "Physics"). */
      get physics() { return window.HawkesPlay.physics; },

      sky(what) {
        if (W.skybox) { W.skybox.dispose(); W.skybox = null; }
        if (/^#/.test(String(what))) { const c = hex(what); W.scene.clearColor = new B.Color4(c.r, c.g, c.b, 1); if (W.scene.fogMode) W.scene.fogColor = c; gradientSky({ ...effectiveConfig(), background: what }); return; }
        if (W.dome) { W.dome.dispose(); W.dome = null; }
        W.skybox = new B.PhotoDome('sky', assetUrl(what), { resolution: 32, size: 1000 }, W.scene);
        W.skybox.mesh.isPickable = false;
      },
      burst(at, o = {}) {
        const p = posOf(at);
        const ps = new B.ParticleSystem('burst', o.count || 30, W.scene);
        ps.particleTexture = W.dot;
        ps.emitter = new B.Vector3(...p);
        ps.minEmitBox = ps.maxEmitBox = B.Vector3.Zero();
        const c = hex(o.color, '#ffcc00');
        ps.color1 = new B.Color4(c.r, c.g, c.b, 1); ps.color2 = new B.Color4(c.r, c.g, c.b, 0.8); ps.colorDead = new B.Color4(c.r, c.g, c.b, 0);
        ps.minSize = (o.size || 0.2) * 0.5; ps.maxSize = o.size || 0.2;
        ps.minLifeTime = 0.3; ps.maxLifeTime = o.life || 0.8;
        ps.manualEmitCount = o.count || 30;
        ps.minEmitPower = (o.speed || 4) * 0.5; ps.maxEmitPower = o.speed || 4;
        ps.direction1 = new B.Vector3(-1, 1, -1); ps.direction2 = new B.Vector3(1, 1.5, 1);
        ps.gravity = new B.Vector3(0, W.config.gravity ?? -24, 0).scale(0.3);
        ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
        ps.disposeOnStop = true;
        ps.targetStopDuration = (o.life || 0.8) + 0.1;
        ps.start();
      },
      sound(name, o = {}) {
        unlockAudio();
        if (!audio || !hasAsset(name)) return;
        loadBuffer(assetUrl(name)).then((buf) => {
          const src = audio.createBufferSource();
          src.buffer = buf;
          if (o.rate) src.playbackRate.value = o.rate;
          const gn = audio.createGain();
          gn.gain.value = o.volume ?? 1;
          src.connect(gn).connect(audio.destination);
          src.start();
        }).catch((e) => report(new Error(`Could not play ${name}: ${e.message || e}`)));
      },
      music(name, o = {}) {
        const start = () => {
          if (musicEl) musicEl.pause();
          musicEl = new Audio(assetUrl(name));
          musicEl.crossOrigin = 'anonymous';
          musicEl.loop = o.loop !== false;
          musicEl.volume = Math.max(0, Math.min(1, o.volume ?? 0.5));
          musicEl.play().catch(() => { pendingMusic = start; });
        };
        if (audio && audio.state === 'running') start(); else pendingMusic = start;
      },
      stopMusic() { pendingMusic = null; if (musicEl) { musicEl.pause(); musicEl = null; } },

      random: (a = 0, b = 1) => a + Math.random() * (b - a),
      randomInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      lerp: (a, b, t) => a + (b - a) * t,
      asset: assetUrl,
      hasAsset,
      log: (...args) => { post({ type: 'log', level: 'log', text: args.map(fmt).join(' '), file: W.file }); console.log(...args); },

      input: {
        key: (k) => held.has(String(k).toLowerCase()),
        pressed: (k) => pressedNow.has(String(k).toLowerCase()),
        released: (k) => releasedNow.has(String(k).toLowerCase()),
        axis() {
          buildTouch();
          let x = (held.has('d') || held.has('arrowright') ? 1 : 0) - (held.has('a') || held.has('arrowleft') ? 1 : 0);
          let y = (held.has('w') || held.has('arrowup') ? 1 : 0) - (held.has('s') || held.has('arrowdown') ? 1 : 0);
          if (stick.x || stick.y) { x = stick.x; y = stick.y; }
          const l = Math.hypot(x, y);
          return l > 1 ? { x: x / l, y: y / l } : { x, y };
        },
        direction() {
          const a = g.input.axis();
          const yaw = W.camera.yawNow();
          const s = Math.sin(yaw), c = Math.cos(yaw);
          return { x: a.x * c + a.y * s, z: -a.x * s + a.y * c };
        },
        get mouse() { return mouse; },
        /** Takes the mouse for looking around (call it from a button, like a menu's Start: browsers need a click).
         *  Where a browser won't capture it, moving the mouse looks around until Esc. */
        capture() {
          if (touchUi || (W.player && W.player.mouse === 'free')) return Promise.resolve(false);
          return lockPointer().then((ok) => { if (!ok) { softLook = true; document.body.classList.add('soft-control'); } return ok; });
        },
        /** Gives the mouse back (for menus, shops, maps). */
        release() { softLook = false; document.body.classList.remove('soft-control'); if (document.pointerLockElement) document.exitPointerLock(); },
        get captured() { return mouse.locked || softLook; },
        /** What's under the mouse (or the crosshair when the mouse is captured): { entity, point } or null. */
        pick() {
          const sc = W.scene;
          const r = mouse.locked ? sc.pickWithRay(sc.activeCamera.getForwardRay(500), (m) => !(m.metadata && m.metadata.decor) && m.isPickable) : sc.pick(mouse.x, mouse.y, (m) => !(m.metadata && m.metadata.decor) && m.isPickable);
          if (!r || !r.hit) return null;
          return { entity: entityOf(r.pickedMesh), point: [r.pickedPoint.x, r.pickedPoint.y, r.pickedPoint.z] };
        },
        onKey(k, fn) { keyHandlers.push({ key: String(k).toLowerCase(), fn: safe(fn) }); },
      },
      ui: W.ui,
      get camera() { return W.camera.api; },
      get scene() { return W.scene; },
      engine,
      BABYLON: B,
    };
    void net;
    for (const k of kindDefs.values()) addMaker(g, k);
    return g;
  }

  /** A kind's maker for scripts: maker: true is game.<type>(opts) (opts are the shape's fields too), a function is
   *  game.<type>(...args) as it says, a string names it differently. */
  function addMaker(g, k) {
    if (!k.maker) return;
    const name = typeof k.maker === 'string' ? k.maker : k.name;
    if (Object.prototype.hasOwnProperty.call(g, name) && !(g[name] && g[name].__maker)) return; // never over the engine's own calls
    g[name] = typeof k.maker === 'function' ? (...args) => k.maker(...args) : (o = {}) => k.build(o, o, null);
    g[name].__maker = true;
  }

  function clickPick(e) {
    if (!W || !W.scene || hooks.clicks === false) return;
    const r = canvas.getBoundingClientRect();
    const pick = mouse.locked ? W.scene.pickWithRay(W.scene.activeCamera.getForwardRay(200)) : W.scene.pick(e.clientX - r.left, e.clientY - r.top);
    const ent = pick && pick.hit ? entityOf(pick.pickedMesh) : null;
    if (ent && ent.alive) for (const h of ent.handlers.click) h(pick.pickedPoint ? [pick.pickedPoint.x, pick.pickedPoint.y, pick.pickedPoint.z] : null);
  }

  // ------------------------------------------------------------------ physics, timers, the frame
  function step(dt) {
    W.time += dt;
    W.dt = dt;
    for (const t of W.timers) {
      if (t.dead || t.at > W.time) continue;
      t.fn();
      if (t.every) t.at += t.every; else t.dead = true;
    }
    W.timers = W.timers.filter((t) => !t.dead);
    for (const e of W.entities) { e._walked = false; e._px = e.x; e._py = e.y; e._pz = e.z; }
    controlPlayer(dt);
    for (const f of W.updates) f(dt, W.time);
    runBehaviors(dt);
    for (const f of hooks.step) f(dt);
    toolTick('step', dt);
    runFeatures(dt);
    // Kinematic things with a velocity move by it (stopping at solid things).
    for (const e of W.entities) if (e.physics === 'kinematic' && e.alive && !e.remote && (e.vx || e.vy || e.vz)) e.move(e.vx * dt, e.vy * dt, e.vz * dt);
    // The physics step: Havok (physics.js) when it's loaded, the first box physics otherwise.
    if (hooks.physics && hooks.physics.ready) hooks.physics.step(dt);
    else legacyStep(dt);
    for (const e of [...W.entities]) {
      if (!e.alive) continue;
      if (e.physics === 'dynamic' && !e.remote && !e.held && e.y < W.catchY) caught(e);
      if (e._sheet && e._sheet.fps > 0) {
        const s = e._sheet;
        s.t += dt * s.fps;
        let f = s.from + Math.floor(s.t);
        if (f > s.to) { if (s.loop) { s.t = 0; f = s.from; } else f = s.to; }
        if (f !== s.frame) { s.frame = f; setFrame(e, f); }
      }
    }
    contacts();
    for (const f of hooks.afterStep) f(dt);
  }

  /** The first physics: boxes that don't turn, swept along each axis. It runs until Havok is ready (or if it can't load). */
  function legacyStep(dt) {
    const g = W.config.gravity ?? -24;
    // How far each non-falling thing moved this step: whatever stands on it rides along.
    for (const e of W.entities) {
      if (e.physics === 'dynamic' || !e.alive) { e._delta = null; continue; }
      const dx = e.x - e._px, dy = e.y - e._py, dz = e.z - e._pz;
      e._delta = dx || dy || dz ? [dx, dy, dz] : null;
    }
    W.probe = (W.probe || 0) + dt;
    const probing = W.probe > 0.5;
    if (probing) W.probe = 0;
    for (const e of [...W.entities]) {
      if (!e.alive || e.physics !== 'dynamic' || e.remote || e.held) continue;
      if (e._force) { const f = e._force; e._force = null; e.vx += (f[0] / e.mass) * dt; e.vy += (f[1] / e.mass) * dt; e.vz += (f[2] / e.mass) * dt; e.wake(); }
      if (e.sleeping) {
        // Still held up? (Its floor might have been moved or deleted, or started moving.)
        if (e.standing && e.standing._delta) e.wake();
        else {
          if (!probing) continue;
          e.node.position.y -= 0.05;
          let supported = false;
          for (const o of W.entities) if (o !== e && o.solid && e.overlaps(o)) { supported = true; break; }
          e.node.position.y += 0.05;
          if (supported) continue;
          e.wake();
        }
      }
      const st = e.standing;
      if (st && st.alive && st._delta && e.grounded) { e.node.position.x += st._delta[0]; e.node.position.y += st._delta[1]; e.node.position.z += st._delta[2]; }
      e.vy = Math.max(-60, e.vy + g * dt * e.gravity);
      const was = e.grounded;
      e.grounded = false;
      const hx = e.sweep(0, e.vx * dt);
      if (hx) collide(e, hx, 0);
      const hz = e.sweep(2, e.vz * dt);
      if (hz) collide(e, hz, 2);
      const hy = e.sweep(1, e.vy * dt);
      if (hy) {
        if (e.vy < 0) {
          if (e.bounce > 0 && -e.vy > 2.5) { e.vy = -e.vy * e.bounce; e.standing = null; }
          else { e.grounded = true; e.standing = hy; e.vy = 0; }
        } else e.vy = 0;
      } else if (was && e.vy <= 0 && e.gravity > 0) {
        // Stay on the ground over small steps and slopes instead of bouncing off them.
        const y = e.y;
        const under = e.sweep(1, -0.06);
        if (under) { e.grounded = true; e.standing = under; e.vy = 0; } else { e.node.position.y = y; e.standing = null; }
      } else if (!e.grounded) e.standing = null;
      // Friction on the ground, a little air drag otherwise.
      if (!e._walked) {
        const k = e.grounded ? Math.max(0, 1 - e.friction * 10 * dt) : Math.max(0, 1 - 0.15 * dt);
        e.vx *= k; e.vz *= k;
        if (Math.abs(e.vx) < 0.01) e.vx = 0;
        if (Math.abs(e.vz) < 0.01) e.vz = 0;
      }
      if (e.kind === 'sphere' && e.grounded) {
        // Balls roll.
        const sp = Math.hypot(e.vx, e.vz);
        if (sp > 0.05) { const r = e.half[0] || 0.5; e.node.rotation.x += (e.vz / r) * dt; e.node.rotation.z -= (e.vx / r) * dt; }
      }
      if (e.grounded && !e._walked && e !== W.player && Math.abs(e.vx) + Math.abs(e.vz) < 0.03 && (!st || !st._delta)) {
        e._still += dt;
        if (e._still > 0.6) e.sleeping = true;
      } else e._still = 0;
    }
  }

  /** Touching: new touches fire hit (triggers included), ended ones leave. Only things someone listens to are checked
   *  against everything (players, things with behaviors or hit handlers), each pair once, with each box worked out once. */
  function contacts() {
    const list = [];
    for (const e of W.entities) if (e.alive && e.physics !== 'none' && e.node.isEnabled()) { e._bb = e.box(); list.push(e); }
    const listens = (e) => e.handlers.hit.length || e.handlers.leave.length || e.behaviors.length || e === W.player || e.isPlayer;
    const watched = list.filter(listens);
    watched.forEach((e, i) => { e._wi = i; });
    const near = (a, b) => { const p = a._bb, q = b._bb; return p.min[0] - TOUCH < q.max[0] && p.max[0] + TOUCH > q.min[0] && p.min[1] - TOUCH < q.max[1] && p.max[1] + TOUCH > q.min[1] && p.min[2] - TOUCH < q.max[2] && p.max[2] + TOUCH > q.min[2]; };
    const leave = (a, b) => { a._touching.delete(b); b._touching.delete(a); for (const h of a.handlers.leave) h(b); for (const h of b.handlers.leave) h(a); };
    for (const a of watched) {
      for (const b of list) {
        if (b === a || (b._wi !== undefined && b._wi < a._wi && listens(b))) continue; // each pair once
        if (a.physics === 'static' && b.physics === 'static') continue;
        if (a.sleeping && b.sleeping) continue;
        if (!a.alive || !b.alive) continue;
        if (near(a, b)) a._contact(b);
        else if (a._touching.has(b)) leave(a, b);
      }
    }
    // Pairs nobody listens to any more still end.
    for (const a of list) {
      if (!a._touching.size || listens(a)) continue;
      for (const b of [...a._touching]) if (!listens(b) && b._bb && !near(a, b)) leave(a, b);
    }
    for (const e of watched) e._wi = undefined;
  }

  /** A falling thing ran into something sideways: bounce off it, or push it if it can move. */
  function collide(e, o, axis) {
    const key = axis === 0 ? 'vx' : 'vz';
    const v = e[key];
    if (o.physics === 'dynamic' && !o.held) {
      if (o.remote) { for (const f of hooks.push) f(o, e); }
      const share = e.mass / (e.mass + o.mass);
      o[key] = v * share * 1.1;
      o.wake();
      if (!e._walked) e[key] = v * (1 - share);
    } else if (e.bounce > 0 && Math.abs(v) > 1) e[key] = -v * e.bounce;
    else if (!e._walked) e[key] = 0;
  }

  // The frame: drawn when the tab is visible; when it's hidden the world keeps going (a worker keeps time, since
  // hidden tabs get no animation frames and slow timers), so a host keeps simulating for everyone else.
  let last = performance.now();
  let acc = 0;
  let framePressed = new Set();
  function advance(render) {
    if (!W) return;
    if (W.restartAsked) { start(); return; }
    framePressed = pressedNow;
    const now = performance.now();
    let elapsed = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!W.paused) {
      acc += elapsed;
      let n = 0;
      while (acc >= STEP && n < 8) {
        step(STEP); acc -= STEP; n++;
        // "Went down this frame" means once, however many steps the frame takes.
        if (n === 1) { pressedNow = new Set(); releasedNow = new Set(); mouse.pressed = false; }
      }
      if (n === 8) acc = 0;
    }
    W.camera.update(elapsed);
    if (W.motes && W.scene.activeCamera) W.motes.emitter = W.scene.activeCamera.position;
    syncTool();
    toolTick('frame', elapsed);
    for (const f of hooks.frame) f(elapsed, render, framePressed);
    pressedNow = new Set();
    releasedNow = new Set();
    mouse.pressed = false;
    mouse.dx = 0; mouse.dy = 0; mouse.wheel = 0;
    if (render) W.scene.render();
  }
  let ticker = null;
  function startTicker() {
    if (ticker) return;
    try {
      const src = 'let t=null;onmessage=(e)=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
      ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      ticker.onmessage = () => { if (document.hidden) { try { advance(false); } catch (e) { report(e); } } };
    } catch {
      ticker = { postMessage: (ms) => { clearInterval(ticker.t); if (ms > 0) ticker.t = setInterval(() => { if (document.hidden) advance(false); }, ms); }, t: null };
    }
    const sync = () => ticker.postMessage(document.hidden ? 50 : 0);
    document.addEventListener('visibilitychange', () => { last = performance.now(); sync(); });
    sync();
  }

  // ------------------------------------------------------------------ running a bundle
  function parseJson(files, path) {
    try { return files[path] ? JSON.parse(files[path]) : null; } catch (e) { report(new Error(`${path} is not valid JSON: ${e.message}`), path); return null; }
  }

  function scriptOrder(files, cfg) {
    const all = Object.keys(files).filter((p) => /\.js$/i.test(p) && (p.startsWith('scripts/') || p.startsWith('behaviors/') || !p.includes('/')));
    const first = Array.isArray(cfg.scripts) ? cfg.scripts.filter((p) => all.includes(p)) : [];
    // Behavior files first, so the world's things can use them from the start.
    const rest = all.filter((p) => !first.includes(p)).sort((a, b) => (a.startsWith('behaviors/') === b.startsWith('behaviors/') ? a.localeCompare(b) : a.startsWith('behaviors/') ? -1 : 1));
    return [...first, ...rest];
  }

  function effectiveConfig() {
    // game.json is the scripts' settings; scene.json's are the world's. game.json wins where both say something.
    return { ...((W.graph && W.graph.config) || {}), ...(W.gameJson || {}) };
  }
  function applyLook(cfg) {
    const scene = W.scene;
    const bg = hex(cfg.background, '#9fd3f0');
    scene.clearColor = new B.Color4(bg.r, bg.g, bg.b, 1);
    if (cfg.fog) { scene.fogMode = B.Scene.FOGMODE_LINEAR; scene.fogColor = hex(cfg.fog.color || cfg.background, '#9fd3f0'); scene.fogStart = cfg.fog.start ?? 40; scene.fogEnd = cfg.fog.end ?? 120; }
    else scene.fogMode = B.Scene.FOGMODE_NONE;
    if (W.hemi) W.hemi.intensity = cfg.ambient ?? 0.7;
    if (W.sun) W.sun.intensity = cfg.sun ?? 0.9;
    W.config.gravity = cfg.gravity ?? -24;
    if (cfg.sky && hasAsset(cfg.sky)) { try { game.sky(cfg.sky); } catch {} }
    else gradientSky(cfg);
  }

  /** A sky that fades from the horizon up, in the background's color, instead of a flat fill. ("sky": false: none.) */
  function gradientSky(cfg) {
    if (W.dome) { W.dome.dispose(); W.dome = null; }
    if (cfg.sky === false || W.skybox) return;
    const base = hex(cfg.background, '#9fd3f0');
    const top = base.scale(0.55), horizon = B.Color3.Lerp(base, new B.Color3(1, 1, 1), 0.35), below = base.scale(0.7);
    const tex = new B.DynamicTexture('sky', { width: 4, height: 256 }, W.scene, false);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, top.toHexString()); g.addColorStop(0.48, base.toHexString()); g.addColorStop(0.5, horizon.toHexString()); g.addColorStop(0.56, base.toHexString()); g.addColorStop(1, below.toHexString());
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 256); tex.update();
    const dome = B.MeshBuilder.CreateSphere('sky', { diameter: 1800, segments: 16, sideOrientation: B.Mesh.BACKSIDE }, W.scene);
    const m = new B.StandardMaterial('sky', W.scene);
    m.emissiveTexture = tex; m.disableLighting = true; m.backFaceCulling = false; m.fogEnabled = false;
    dome.material = m; dome.isPickable = false; dome.infiniteDistance = true; dome.applyFog = false;
    dome.metadata = { decor: true };
    W.dome = dome;
  }

  /** The game look: smoothing, a glow on everything that shines, filmic color, a vignette, drifting motes in the
   *  air, and (building) a faint grid on the ground. ("look": false: plain.) */
  function gameLook(cfg) {
    if (cfg.look === false) return;
    try {
      const glow = new B.GlowLayer('glow', W.scene, { blurKernelSize: touchUi ? 16 : 48, mainTextureRatio: touchUi ? 0.25 : 0.5 });
      glow.intensity = 0.55;
      glow.customEmissiveColorSelector = (mesh, sub, mat, color) => { const en = entityOf(mesh); if ((mesh.metadata && (mesh.metadata.noGlow || mesh.metadata.decor && mesh.name === 'text')) || (en && (en.kind === 'text' || en.kind === 'sprite' || en.kind === 'video'))) color.set(0, 0, 0, 0); else if (mat && mat.emissiveColor) color.set(mat.emissiveColor.r, mat.emissiveColor.g, mat.emissiveColor.b, 1); else color.set(0, 0, 0, 0); };
      W.glow = glow;
    } catch (e) { console.warn('glow', e); }
    try {
      // Motes: a few hundred specks of light drifting around wherever the camera is.
      const ps = new B.ParticleSystem('motes', touchUi ? 120 : 320, W.scene);
      ps.particleTexture = W.dot;
      ps.emitter = W.scene.activeCamera ? W.scene.activeCamera.position : B.Vector3.Zero();
      ps.minEmitBox = new B.Vector3(-18, -4, -18); ps.maxEmitBox = new B.Vector3(18, 8, 18);
      const c = hex(cfg.motes || '#cfe3ff');
      ps.color1 = new B.Color4(c.r, c.g, c.b, 0.55); ps.color2 = new B.Color4(c.r, c.g, c.b, 0.25); ps.colorDead = new B.Color4(c.r, c.g, c.b, 0);
      ps.minSize = 0.02; ps.maxSize = 0.07; ps.minLifeTime = 4; ps.maxLifeTime = 9;
      ps.emitRate = touchUi ? 14 : 36; ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
      ps.direction1 = new B.Vector3(-0.15, 0.05, -0.15); ps.direction2 = new B.Vector3(0.15, 0.25, 0.15); ps.minEmitPower = 0.1; ps.maxEmitPower = 0.35;
      ps.gravity = B.Vector3.Zero();
      if (cfg.motes !== false) ps.start();
      W.motes = ps;
    } catch (e) { console.warn('motes', e); }
    if (mode === 'build') {
      // The builder's grid: a meter at a time, fading out with distance.
      const lines = [];
      for (let i = -40; i <= 40; i += 2) { lines.push([new B.Vector3(i, 0.012, -40), new B.Vector3(i, 0.012, 40)]); lines.push([new B.Vector3(-40, 0.012, i), new B.Vector3(40, 0.012, i)]); }
      const grid = B.MeshBuilder.CreateLineSystem('grid', { lines }, W.scene);
      grid.color = new B.Color3(0.45, 0.75, 1); grid.alpha = 0.14; grid.isPickable = false; grid.metadata = { decor: true, noGlow: true };
      W.grid = grid;
    }
    try {
      // Built once, after it's set up (building it as each setting changes re-attached its effects: Babylon's
      // "reuse a post process not defined as reusable" errors).
      const p = new B.DefaultRenderingPipeline('look', true, W.scene, W.scene.cameras.slice(), false);
      p.fxaaEnabled = true;
      p.bloomEnabled = !touchUi;
      p.bloomThreshold = 0.82; p.bloomWeight = 0.28; p.bloomKernel = 48; p.bloomScale = 0.5;
      p.imageProcessingEnabled = true;
      p.prepare();
      const ip = p.imageProcessing;
      ip.toneMappingEnabled = true; ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.exposure = 1.1; ip.contrast = 1.12;
      ip.vignetteEnabled = true; ip.vignetteWeight = 1.6; ip.vignetteStretch = 0.25; ip.vignetteColor = new B.Color4(0, 0, 0, 0);
      p.automaticBuild = true;
      // Cameras made later get the look too. (Babylon announces a camera a moment after it's made, so the one the
      // pipeline already has comes through here as well: adding it twice re-attached every effect, with an error each.)
      W.scene.onNewCameraAddedObservable.add((c) => { try { if (!p.cameras.includes(c)) p.addCamera(c); } catch {} });
      W.look = p;
    } catch (e) { console.warn('look', e); }
  }

  // ------------------------------------------------------------------ world features: one config key each (H.features)
  // terrain, water, weather, time of day...: a module owns a key of the world's settings (scene.json config or game.json)
  // and gets apply(value, ctx) when the world starts with it set, change(value, old, ctx) (or dispose + apply) when an
  // edit changes it, update(dt, ctx) every step while it is on, and dispose(ctx) when it goes or the world ends.
  const featureCtx = (key, f) => ({ game, H: window.HawkesPlay, world: W, scene: W.scene, key, state: f.state, value: f.value });
  const featureOn = (v) => v !== undefined && v !== null && v !== false;
  function applyFeatures(cfg) {
    W.features = new Map();
    for (const def of featureDefs.values()) if (featureOn(cfg[def.name])) startFeature(def, cfg[def.name]);
  }
  function startFeature(def, value) {
    const f = { def, value: clone(value), state: {} };
    W.features.set(def.name, f);
    try { def.apply(f.value, featureCtx(def.name, f)); } catch (err) { report(err, `feature ${def.name}`); }
  }
  function stopFeature(key) {
    const f = W.features && W.features.get(key);
    if (!f) return;
    W.features.delete(key);
    if (f.def.dispose) try { f.def.dispose(featureCtx(key, f)); } catch (err) { report(err, `feature ${key}`); }
  }
  /** A config edit: the features whose keys it touched hear about it. */
  function changeFeatures(patch) {
    const cfg = effectiveConfig();
    for (const key of Object.keys(patch || {})) {
      const def = featureDefs.get(key);
      if (!def) continue;
      const f = W.features.get(key), value = cfg[key];
      if (!featureOn(value)) { stopFeature(key); continue; }
      if (f && def.change) { const old = f.value; f.value = clone(value); try { def.change(f.value, old, featureCtx(key, f)); } catch (err) { report(err, `feature ${key}`); } }
      else { stopFeature(key); startFeature(def, value); }
    }
  }
  function runFeatures(dt) {
    if (!W.features) return;
    for (const [key, f] of W.features) if (f.def.update) try { f.def.update(dt, featureCtx(key, f)); } catch (err) { report(err, `feature ${key}`); }
  }
  function disposeFeatures() { if (W && W.features) for (const key of [...W.features.keys()]) stopFeature(key); }

  function start(o = {}) {
    if (W) {
      // Keep where the player was, so a script change doesn't throw you back to the start.
      if (o.keep && W.player && W.player.alive) W.keepPose = { p: W.player.position, yaw: W.camera.yaw, pitch: W.camera.pitch, flying: W.player.flying };
      for (const f of hooks.world) if (f.leave) f.leave();
      dropTool();
      disposeFeatures();
      W.ui.clear();
      W.scene.dispose();
    }
    const keepPose = W && W.keepPose;
    clearErrors();
    keyHandlers = [];
    behaviorDefs.clear();
    const gameJson = parseJson(bundle.files, 'game.json') || {};
    // The world as it is now (with every edit since loading), unless a new scene.json just arrived.
    const graph = (W && W.graph && !o.newScene ? W.graph : parseJson(bundle.files, 'scene.json')) || { config: {}, entities: {} };
    if (!graph.entities || typeof graph.entities !== 'object') graph.entities = {};
    if (!graph.config || typeof graph.config !== 'object') graph.config = {};
    const scene = new B.Scene(engine);
    W = { scene, config: { ...graph.config, ...gameJson }, gameJson, graph, entities: new Set(), byId: new Map(), starts: [], updates: [], timers: [], time: 0, dt: STEP, paused: false, restartAsked: false, state: {}, pixelated: Boolean(gameJson.pixelated), file: null, skybox: null, player: null, netHandlers: new Map(), events: new Map(), catchY: -25, keepPose, started: false };
    for (const f of hooks.scene) try { f(scene, W); } catch (err) { report(err); } // physics.js: the scene's physics world
    W.ui = ui();
    uiLayer.removeAttribute('style');
    if (gameJson.ui && typeof gameJson.ui === 'object') W.ui.theme(gameJson.ui);
    scene.ambientColor = new B.Color3(1, 1, 1);
    const cfg = effectiveConfig();
    if (cfg.lights !== false) {
      W.hemi = new B.HemisphericLight('sky', new B.Vector3(0.2, 1, -0.3), scene);
      // Cool light from the sky, warm bounce from the ground: things look lit, not flat.
      W.hemi.diffuse = new B.Color3(0.92, 0.96, 1.05);
      W.hemi.groundColor = new B.Color3(0.42, 0.36, 0.34);
      W.hemi.specular = new B.Color3(0.15, 0.15, 0.18);
      W.sun = new B.DirectionalLight('sun', new B.Vector3(-0.5, -1, 0.4), scene);
      W.sun.position = new B.Vector3(20, 40, -20);
      W.sun.diffuse = new B.Color3(1, 0.96, 0.88);
      if (cfg.shadows !== false) {
        const sg = new B.ShadowGenerator(1024, W.sun);
        sg.useBlurExponentialShadowMap = true;
        sg.blurKernel = 24;
        sg.bias = 0.0005;
        sg.darkness = 0.35;
        W.shadows = sg;
      }
    }
    const dot = new B.DynamicTexture('dot', 64, scene, false);
    const ctx = dot.getContext();
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64); dot.update(); dot.hasAlpha = true;
    W.dot = dot;
    W.camera = makeCamera();
    gameLook(cfg);
    game = makeGame();
    window.game = game;
    applyLook(cfg);
    applyFeatures(cfg);
    buildScene(graph);
    for (const path of scriptOrder(bundle.files, cfg)) {
      W.file = path;
      try {
        new Function('game', `${bundle.files[path]}\n//# sourceURL=hawkes-script://${path}`)(game);
      } catch (e) {
        report(e, path);
      }
    }
    W.file = null;
    W.started = true;
    // Things whose behaviors come from scripts get them now that every script has run.
    for (const e of W.entities) for (const b of e.behaviors) if (!b.def) { b.def = findDef(b.name); b.o = { ...(b.def && b.def.defaults || {}), ...b.o }; if (!b.def) report(new Error(`${e.name || e.sceneId}: no behavior called "${b.name}"`), 'scene.json'); }
    for (const f of W.starts) f();
    // Nobody set up a camera: you get the first-person player. Building, you are always that player.
    if ((mode === 'build' && cfg.player !== false) || (!W.camera.claimed && cfg.player !== false)) {
      const p = ensurePlayer();
      if (mode === 'build') { p.controls = true; p.gravity = p.baseGravity ?? 1; }
      if (W.camera.target !== p || !['fps', 'third', 'top'].includes(W.camera.mode)) setView(p, p._view || 'first');
    } else if (W.player) W.camera.internal(() => { if (W.camera.mode === 'fixed') W.camera.api.firstPerson(W.player, { height: 1.6 }); });
    for (const f of hooks.world) if (f.enter) f.enter(W);
    post({ type: 'started', entities: W.entities.size });
  }

  let looping = false;
  function run(b, o = {}) {
    bundle = b;
    if (o.mode) mode = o.mode;
    document.title = b.title ? `${b.title} · Hawkes Play` : 'Hawkes Play';
    const loading = $('loading');
    if (loading) loading.hidden = true;
    // Warm the sound cache so the first effect plays on time.
    for (const [, a] of Object.entries(b.assets || {})) if (/^audio\//.test(a.mime || '') && a.url) fetch(a.url).catch(() => {});
    try { start({ newScene: true }); } catch (e) { report(e); } // a new bundle: its own world
    if (!looping && o.loop !== false) {
      looping = true;
      engine.runRenderLoop(() => { try { advance(true); } catch (e) { report(e); if (W) W.paused = true; } });
      startTicker();
    }
  }

  /** New files (a script or game.json was saved): the world is rebuilt and the scripts run again, keeping the
   *  player where they are. No page reload. A new scene.json (from outside the ops) is picked up the same way. */
  function reload(files) {
    if (!bundle) return;
    bundle = { ...bundle, files: { ...bundle.files, ...files } };
    for (const [p, v] of Object.entries(files)) if (v === null) delete bundle.files[p];
    try { start({ keep: true, newScene: 'scene.json' in files }); } catch (e) { report(e); }
  }
  /** The asset list changed (something was generated or added): things waiting for it appear. */
  function setAssets(assets) {
    if (!bundle) return;
    const before = bundle.assets || {};
    bundle = { ...bundle, assets };
    if (!W) return;
    for (const e of [...W.entities]) {
      const want = e._waiting || (e.spec && e.spec.material && e.spec.material.texture);
      if (e.sceneId && want && assets[want] && (!before[want] || before[want].url !== assets[want].url)) applyOps([{ op: 'replace', entity: W.graph.entities[e.sceneId] }], { fx: 'arrive' });
    }
  }
  /** Building or playing. Playing starts the game over from the top, as a player would: the world as built, every
   *  script again, the player at the start (and whatever the game does first: a title menu, a countdown...).
   *  Back to building keeps you where you were. */
  function setMode(m) {
    if (m === mode) return;
    mode = m;
    if (W) start({ keep: m === 'build' });
  }

  window.HawkesPlay = {
    run, reload, setAssets, setMode, applyOps, respawn: () => respawn(false),
    restart: () => { if (W) W.restartAsked = true; },
    behavior: (name, def) => defineBehavior(name, def, true),
    behaviorDef: (name) => findDef(name),
    hooks,
    lockPointer,
    bindTouchKey,
    setClockOffset: (ms) => { clockOffset = ms; },
    get world() { return W; },
    get game() { return game; },
    get mode() { return mode; },
    get bundle() { return bundle; },
    get input() { return { held, pressed: framePressed, released: releasedNow, mouse, stick, touchUi }; },
    entityOf, fromSpec, textPlane, hurtPlayer, merge, report, post, touchUi,
    // How modules extend the engine (docs/engine-modules.md).
    kinds, features, controllers, tools,
    /** Resolves when the engine can run a game (physics.js replaces it with its own readiness). */
    ready: Promise.resolve(),
    /** Steps the world by `seconds` (whole fixed steps) and runs one frame without drawing: for tests and tools. */
    tick(seconds = STEP) {
      if (!W) return;
      const n = Math.max(1, Math.round(seconds / STEP));
      for (let i = 0; i < n && W && !W.paused; i++) { step(STEP); if (i === 0) { pressedNow = new Set(); releasedNow = new Set(); mouse.pressed = false; } }
      if (!W) return;
      W.camera.update(n * STEP);
      syncTool();
      toolTick('frame', n * STEP);
      for (const f of hooks.frame) f(n * STEP, false, framePressed);
      mouse.dx = 0; mouse.dy = 0; mouse.wheel = 0;
    },
    /** The engine's building blocks, for modules that make kinds of things (kinds.js uses them). */
    lib: { Entity, shape, place, material, size3, hex, vec, clone, assetUrl, hasAsset, setFrame, showBubble, roundRect, posOf, attachBehaviors, runBehaviorHit, applyPlayerSettings, useController, effectiveConfig, STEP, RAD, get clockOffset() { return clockOffset; } },
  };
  window.addEventListener('error', (e) => report(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
})();
