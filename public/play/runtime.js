// Hawkes Play: the runtime games built on hawkesgen.com run in. A thin, friendly layer over Babylon.js: scripts get one
// global, `game` (the API is public/play/API.md), and the runtime handles the scene, lights, a simple box physics,
// cameras, input (keyboard, mouse, touch), screen text, sound and errors. It runs inside a sandboxed page (no cookies,
// no storage), loaded with a bundle: { title, files: { path: text }, assets: { name: { url, mime } } }.
/* global BABYLON */
(function () {
  'use strict';
  const B = BABYLON;
  const RAD = Math.PI / 180;
  const EPS = 0.001;
  const TOUCH = 0.02;

  // ------------------------------------------------------------------ reporting to the editor (when inside one)
  const post = (msg) => { try { if (window.parent !== window) window.parent.postMessage({ source: 'hawkes-play', ...msg }, '*'); } catch {} };
  const fmt = (a) => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
  function where(err) {
    const m = /hawkes-script:\/\/([^\s:)]+):(\d+)(?::(\d+))?/.exec(String(err && err.stack || ''));
    return m ? { file: m[1], line: Math.max(1, Number(m[2]) - 2) } : {};
  }
  function report(err, file) {
    const w = where(err);
    const message = String(err && err.message || err);
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
    if (!box) return;
    box.hidden = false;
    const line = document.createElement('div');
    line.textContent = text;
    box.appendChild(line);
    while (box.children.length > 6) box.firstChild.remove();
  }
  function clearErrors() { const box = $('error'); if (box) { box.innerHTML = ''; box.hidden = true; } }

  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, disableWebGL2Support: false }, true);
  engine.enableOfflineSupport = false;
  window.addEventListener('resize', () => engine.resize());

  // ------------------------------------------------------------------ input (kept across restarts)
  const held = new Set();
  let pressedNow = new Set();
  let releasedNow = new Set();
  const keyName = (e) => { const k = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase(); return k; };
  const mouse = { x: 0, y: 0, down: false, pressed: false, dx: 0, dy: 0 };
  let keyHandlers = [];
  const stick = { x: 0, y: 0 };
  window.addEventListener('keydown', (e) => {
    const k = keyName(e);
    if (['space', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    if (!held.has(k)) { pressedNow.add(k); for (const h of keyHandlers) if (h.key === k) h.fn(); }
    held.add(k);
    unlockAudio();
  });
  window.addEventListener('keyup', (e) => { const k = keyName(e); held.delete(k); releasedNow.add(k); });
  window.addEventListener('blur', () => held.clear());
  canvas.addEventListener('pointermove', (e) => { const r = canvas.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.dx += e.movementX || 0; mouse.dy += e.movementY || 0; });
  canvas.addEventListener('pointerdown', (e) => { mouse.down = true; mouse.pressed = true; unlockAudio(); canvas.focus(); clickPick(e); });
  window.addEventListener('pointerup', () => { mouse.down = false; });
  canvas.addEventListener('click', () => { if (W && W.camera && W.camera.mode === 'fps' && !document.pointerLockElement && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch {} } });

  const touchUi = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  function buildTouch() {
    if (!touchUi || $('touch')) return;
    const wrap = document.createElement('div');
    wrap.id = 'touch';
    wrap.innerHTML = '<div class="pad"><div class="knob"></div></div><button class="tb a" data-key="space">A</button><button class="tb b" data-key="e">B</button>';
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
    for (const b of wrap.querySelectorAll('.tb')) {
      const k = b.dataset.key;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (!held.has(k)) { pressedNow.add(k); for (const h of keyHandlers) if (h.key === k) h.fn(); } held.add(k); unlockAudio(); });
      const up = () => { held.delete(k); releasedNow.add(k); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    }
  }

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

  function assetUrl(name) {
    const a = bundle && bundle.assets && bundle.assets[name];
    if (!a) throw new Error(`No asset named "${name}". Add it in the Assets panel, or check the spelling.`);
    return a.url;
  }
  const hex = (c, fallback = '#cccccc') => { try { return B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(String(c)) ? c : fallback); } catch { return B.Color3.FromHexString(fallback); } };
  const vec = (v, d = [0, 0, 0]) => (Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0] : v && typeof v === 'object' && 'x' in v ? [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0] : d);
  const posOf = (t) => (t && t.__entity ? [t.x, t.y, t.z] : vec(t));

  // ------------------------------------------------------------------ entities
  class Entity {
    constructor(node, opts, kind) {
      this.__entity = true;
      this.node = node;
      this.kind = kind;
      this.tag = opts.tag || null;
      this.name = opts.name || null;
      this.data = opts.data || {};
      this.physics = opts.physics || (kind === 'sprite' ? 'none' : 'static');
      this.vx = 0; this.vy = 0; this.vz = 0;
      this.grounded = false;
      this.alive = true;
      this.handlers = { hit: [], click: [] };
      this.half = [0.5, 0.5, 0.5];
      this.offset = [0, 0, 0];
      this.ready = Promise.resolve(this);
      this.animations = [];
      this._mat = null;
      this._touching = new Set();
      W.entities.add(this);
      node.metadata = { entity: this };
    }
    get mesh() { return this.node; }
    get x() { return this.node.position.x; } set x(v) { this.node.position.x = Number(v) || 0; }
    get y() { return this.node.position.y; } set y(v) { this.node.position.y = Number(v) || 0; }
    get z() { return this.node.position.z; } set z(v) { this.node.position.z = Number(v) || 0; }
    get position() { return [this.x, this.y, this.z]; }
    set position(v) { const p = vec(v); this.node.position.set(p[0], p[1], p[2]); }
    get velocity() { return [this.vx, this.vy, this.vz]; }
    set velocity(v) { const p = vec(v); this.vx = p[0]; this.vy = p[1]; this.vz = p[2]; }
    get rotation() { return this.node.rotation.y / RAD; }
    set rotation(deg) {
      if (Array.isArray(deg)) this.node.rotation.set((deg[0] || 0) * RAD, (deg[1] || 0) * RAD, (deg[2] || 0) * RAD);
      else this.node.rotation.y = (Number(deg) || 0) * RAD;
      this.measure();
    }
    turn(deg) { this.node.rotation.y += (Number(deg) || 0) * RAD; this.measure(); return this; }
    get scale() { const s = this.node.scaling; return s.x === s.y && s.y === s.z ? s.x : [s.x, s.y, s.z]; }
    set scale(v) { if (typeof v === 'number') this.node.scaling.setAll(v); else { const p = vec(v, [1, 1, 1]); this.node.scaling.set(p[0], p[1], p[2]); } this.measure(); }
    get forward() { const a = this.node.rotation.y; return { x: Math.sin(a), z: Math.cos(a) }; }
    get color() { return this._mat ? this._mat.diffuseColor.toHexString() : null; }
    set color(c) { if (this._mat) this._mat.diffuseColor = hex(c); }
    get opacity() { return this._mat ? this._mat.alpha : 1; }
    set opacity(v) { if (this._mat) this._mat.alpha = Math.max(0, Math.min(1, Number(v))); }
    get visible() { return this.node.isEnabled(); }
    set visible(v) { this.node.setEnabled(Boolean(v)); }
    get solid() { return this.alive && (this.physics === 'static' || this.physics === 'dynamic' || this.physics === 'kinematic') && this.node.isEnabled(); }

    /** The collider: a box (half extents and center offset) around the node as it is now. */
    measure() {
      if (this.kind === 'model' && !this._loaded) return;
      const n = this.node;
      n.computeWorldMatrix(true);
      let min, max;
      if (n.getHierarchyBoundingVectors) ({ min, max } = n.getHierarchyBoundingVectors(true));
      if (!min || !isFinite(min.x) || max.x - min.x < 1e-6 && max.y - min.y < 1e-6) return;
      this.half = [Math.max(0.01, (max.x - min.x) / 2), Math.max(0.01, (max.y - min.y) / 2), Math.max(0.01, (max.z - min.z) / 2)];
      this.offset = [(max.x + min.x) / 2 - n.position.x, (max.y + min.y) / 2 - n.position.y, (max.z + min.z) / 2 - n.position.z];
    }
    box(pad = 0) {
      const c = [this.x + this.offset[0], this.y + this.offset[1], this.z + this.offset[2]];
      return { min: [c[0] - this.half[0] - pad, c[1] - this.half[1] - pad, c[2] - this.half[2] - pad], max: [c[0] + this.half[0] + pad, c[1] + this.half[1] + pad, c[2] + this.half[2] + pad] };
    }
    overlaps(o, pad = 0) {
      const a = this.box(pad), b = o.box();
      return a.min[0] < b.max[0] && a.max[0] > b.min[0] && a.min[1] < b.max[1] && a.max[1] > b.min[1] && a.min[2] < b.max[2] && a.max[2] > b.min[2];
    }
    /** Moves along one axis, stopping at solid things. Returns true if something stopped it. */
    sweep(axis, d) {
      if (!d) return false;
      const steps = Math.max(1, Math.ceil(Math.abs(d) / Math.max(0.05, Math.min(...this.half))));
      const step = d / steps;
      const key = ['x', 'y', 'z'][axis];
      for (let s = 0; s < steps; s++) {
        this.node.position[key] += step;
        let hit = null;
        for (const o of W.entities) {
          if (o === this || !o.solid || !this.overlaps(o)) continue;
          const ob = o.box();
          const edge = step > 0 ? ob.min[axis] - this.half[axis] - this.offset[axis] - EPS : ob.max[axis] + this.half[axis] - this.offset[axis] + EPS;
          if (step > 0 ? edge < this.node.position[key] : edge > this.node.position[key]) this.node.position[key] = edge;
          hit = o;
        }
        if (hit) { this._contact(hit); return true; }
      }
      return false;
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
      return this;
    }
    moveTo(x, y, z) { this.position = Array.isArray(x) ? x : [x, y, z]; return this; }
    walk(dir, speed = 5) {
      const d = Array.isArray(dir) ? { x: dir[0], z: dir[1] } : dir || { x: 0, z: 0 };
      const len = Math.hypot(d.x || 0, d.z || 0);
      const k = len > 1 ? 1 / len : 1;
      this.vx = (d.x || 0) * k * speed;
      this.vz = (d.z || 0) * k * speed;
      if (len > 0.05) this.node.rotation.y = Math.atan2(d.x, d.z);
      if (this.physics !== 'dynamic') this.move(this.vx * W.dt, 0, this.vz * W.dt);
      return this;
    }
    jump(speed = 7) { if (!this.grounded) return false; this.vy = speed; this.grounded = false; return true; }
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
    on(event, fn) { if (this.handlers[event]) this.handlers[event].push(safe(fn)); return this; }
    _contact(o) {
      if (this._touching.has(o)) return;
      this._touching.add(o);
      o._touching.add(this);
      for (const h of this.handlers.hit) h(o);
      for (const h of o.handlers.hit) h(this);
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
    destroy() {
      if (!this.alive) return;
      this.alive = false;
      W.entities.delete(this);
      for (const o of this._touching) o._touching.delete(this);
      if (W.camera.target === this) W.camera.target = null;
      this.node.dispose(false, true);
    }
  }

  function material(opts, name) {
    const m = new B.StandardMaterial(name || 'm', W.scene);
    m.diffuseColor = hex(opts.color, '#cfcfcf');
    m.specularColor = new B.Color3(0.08, 0.08, 0.08);
    if (opts.emissive) m.emissiveColor = hex(opts.emissive);
    if (opts.texture) {
      const t = new B.Texture(assetUrl(opts.texture), W.scene, false, true, W.pixelated ? B.Texture.NEAREST_SAMPLINGMODE : B.Texture.TRILINEAR_SAMPLINGMODE);
      const tile = vec(opts.tile, [1, 1, 0]);
      t.uScale = tile[0] || 1; t.vScale = tile[1] || 1;
      t.hasAlpha = /png|webp|gif/.test(String(bundle.assets[opts.texture]?.mime || opts.texture));
      m.diffuseTexture = t;
      m.useAlphaFromDiffuseTexture = t.hasAlpha;
      if (!opts.color) m.diffuseColor = new B.Color3(1, 1, 1);
    }
    if (opts.opacity !== undefined) m.alpha = Number(opts.opacity);
    return m;
  }

  function place(e, opts) {
    const p = opts.position ? vec(opts.position) : [Number(opts.x) || 0, Number(opts.y) || 0, Number(opts.z) || 0];
    e.node.position.set(p[0], p[1], p[2]);
    if (opts.rotation !== undefined) { if (Array.isArray(opts.rotation)) e.node.rotation.set(opts.rotation[0] * RAD, opts.rotation[1] * RAD, opts.rotation[2] * RAD); else e.node.rotation.y = Number(opts.rotation) * RAD; }
    if (opts.scale !== undefined) { if (typeof opts.scale === 'number') e.node.scaling.setAll(opts.scale); else { const s = vec(opts.scale, [1, 1, 1]); e.node.scaling.set(s[0], s[1], s[2]); } }
    if (opts.visible === false) e.node.setEnabled(false);
    if (opts.velocity) e.velocity = opts.velocity;
    if (W.shadows && opts.shadow !== false && e.kind !== 'sprite') { for (const m of [e.node, ...e.node.getChildMeshes()]) if (m.getTotalVertices && m.getTotalVertices() > 0) { W.shadows.addShadowCaster(m); m.receiveShadows = true; } }
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

  function model(name, opts = {}) {
    const root = new B.TransformNode(`model:${name}`, W.scene);
    const e = new Entity(root, opts, 'model');
    e._loaded = false;
    const want = Number(opts.size) || 0;
    e.half = [want / 2 || 0.5, want / 2 || 0.5, want / 2 || 0.5];
    place(e, opts);
    const world = W;
    e.ready = B.SceneLoader.ImportMeshAsync('', '', assetUrl(name), W.scene, null, '.glb').then((r) => {
      if (!e.alive || world !== W) { for (const m of r.meshes) m.dispose(); return e; }
      const holder = new B.TransformNode('holder', W.scene);
      for (const m of r.meshes) if (!m.parent) m.parent = holder;
      for (const t of r.transformNodes) if (!t.parent) t.parent = holder;
      holder.computeWorldMatrix(true);
      let { min, max } = holder.getHierarchyBoundingVectors(true);
      const h = Math.max(1e-3, max.y - min.y);
      const k = want ? want / h : 1;
      holder.scaling.setAll(k);
      holder.computeWorldMatrix(true);
      ({ min, max } = holder.getHierarchyBoundingVectors(true));
      holder.position.set(-(min.x + max.x) / 2, -(min.y + max.y) / 2, -(min.z + max.z) / 2);
      holder.parent = root;
      root.computeWorldMatrix(true);
      e.animations = r.animationGroups || [];
      for (const a of e.animations) a.stop();
      if (opts.animation && !e.play(opts.animation)) { if (e.animations[0]) e.animations[0].start(true); } else if (!opts.animation && opts.autoplay !== false && e.animations[0]) e.animations[0].start(true);
      if (opts.color) for (const m of r.meshes) if (m.material && m.material.albedoColor) m.material.albedoColor = hex(opts.color);
      if (W.shadows && opts.shadow !== false) for (const m of r.meshes) if (m.getTotalVertices() > 0) { W.shadows.addShadowCaster(m); m.receiveShadows = true; }
      for (const m of r.meshes) m.metadata = { entity: e };
      e._loaded = true;
      e.measure();
      return e;
    }).catch((err) => { report(new Error(`Could not load ${name}: ${err.message || err}`)); return e; });
    return e;
  }

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

  function sprite(name, opts = {}) {
    const height = Number(opts.size) || 1;
    const plane = B.MeshBuilder.CreatePlane(`sprite:${name}`, { width: 1, height: 1, sideOrientation: B.Mesh.DOUBLESIDE }, W.scene);
    const e = new Entity(plane, { physics: 'none', ...opts }, 'sprite');
    const m = new B.StandardMaterial('sprite', W.scene);
    const t = new B.Texture(assetUrl(name), W.scene, false, true, W.pixelated || opts.pixel ? B.Texture.NEAREST_SAMPLINGMODE : B.Texture.TRILINEAR_SAMPLINGMODE);
    t.hasAlpha = true;
    m.diffuseTexture = t;
    m.useAlphaFromDiffuseTexture = true;
    m.emissiveColor = new B.Color3(1, 1, 1);
    m.disableLighting = true;
    m.backFaceCulling = false;
    if (opts.color) m.emissiveColor = hex(opts.color);
    plane.material = e._mat = m;
    e._tex = t;
    if (opts.billboard !== false) plane.billboardMode = B.Mesh.BILLBOARDMODE_Y;
    const frames = opts.frames || null;
    if (frames) { e._sheet = { cols: Math.max(1, frames.cols | 0), rows: Math.max(1, frames.rows | 0), from: 0, to: 0, fps: 0, loop: true, t: 0, frame: 0 }; setFrame(e, 0); }
    plane.scaling.set(height, height, 1);
    t.onLoadObservable.addOnce(() => {
      const sz = t.getSize();
      const cw = sz.width / (e._sheet ? e._sheet.cols : 1), ch = sz.height / (e._sheet ? e._sheet.rows : 1);
      plane.scaling.x = height * (cw / ch || 1);
      e.measure();
    });
    return place(e, opts);
  }

  // ------------------------------------------------------------------ camera
  function makeCamera() {
    const cam = new B.UniversalCamera('cam', new B.Vector3(0, 8, -14), W.scene);
    cam.setTarget(B.Vector3.Zero());
    cam.minZ = 0.05;
    cam.inputs.clear();
    const state = { mode: 'fixed', target: null, opts: {}, cam, arc: null, shake: 0, shakeTime: 0, yaw: 0, pitch: 0 };
    const api = {
      get target() { return state.target; },
      set target(v) { state.target = v; },
      follow(t, o = {}) { use(); Object.assign(state, { mode: 'follow', target: t, opts: { distance: 10, height: 5, smooth: 0.1, behind: false, ...o } }); snap(); return api; },
      topDown(t, o = {}) { use(); Object.assign(state, { mode: 'top', target: t, opts: { height: 18, smooth: 0.15, ...o } }); snap(); return api; },
      firstPerson(t, o = {}) { use(); Object.assign(state, { mode: 'fps', target: t, opts: { height: 0.6, sensitivity: 0.15, ...o }, yaw: t ? t.node.rotation.y : 0, pitch: 0 }); if (t) t.visible = o.showBody === true ? true : t.visible; return api; },
      fixed(p, look = [0, 0, 0]) { use(); const a = vec(p), b = vec(look); cam.position.set(a[0], a[1], a[2]); cam.setTarget(new B.Vector3(b[0], b[1], b[2])); state.mode = 'fixed'; state.target = null; return api; },
      orbit(t, o = {}) {
        const p = t && t.__entity ? t.position : vec(t);
        if (!state.arc) { state.arc = new B.ArcRotateCamera('orbit', -Math.PI / 2, 1.1, o.distance || 12, new B.Vector3(p[0], p[1], p[2]), W.scene); state.arc.minZ = 0.05; state.arc.wheelPrecision = 20; state.arc.lowerRadiusLimit = 1; }
        state.arc.radius = o.distance || state.arc.radius;
        state.arc.attachControl(canvas, true);
        W.scene.activeCamera = state.arc;
        Object.assign(state, { mode: 'orbit', target: t && t.__entity ? t : null, opts: o });
        return api;
      },
      shake(strength = 0.3, seconds = 0.3) { state.shake = strength; state.shakeTime = seconds; return api; },
      get babylon() { return W.scene.activeCamera; },
    };
    function use() { if (state.arc) { state.arc.detachControl(); } W.scene.activeCamera = cam; if (document.pointerLockElement) document.exitPointerLock(); }
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
        state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch + mouse.dy * state.opts.sensitivity * RAD));
        if (t && t.alive) { t.node.rotation.y = state.yaw; cam.position.set(t.x, t.y + state.opts.height, t.z); }
        cam.rotation.set(state.pitch, state.yaw, 0);
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
    state.yawNow = () => (state.mode === 'orbit' ? -state.arc.alpha - Math.PI / 2 : state.mode === 'fps' ? state.yaw : Math.atan2(cam.getTarget().x - cam.position.x, cam.getTarget().z - cam.position.z));
    state.api = api;
    return state;
  }

  // ------------------------------------------------------------------ screen ui
  function ui() {
    const items = new Map();
    const place = (el, o = {}) => {
      const x = o.x || 'left', y = o.y || 'top';
      el.style.left = el.style.right = el.style.top = el.style.bottom = el.style.transform = '';
      const tx = x === 'center' ? '-50%' : '0', ty = y === 'middle' ? '-50%' : '0';
      if (x === 'left') el.style.left = '16px'; else if (x === 'right') el.style.right = '16px'; else el.style.left = '50%';
      if (y === 'top') el.style.top = `${16 + stackIndex(el, x, y) * 34}px`; else if (y === 'bottom') el.style.bottom = `${16 + stackIndex(el, x, y) * 34}px`; else el.style.top = '50%';
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
        const el = document.createElement('div');
        el.className = 'ui-message';
        el.textContent = String(text);
        uiLayer.appendChild(el);
        setTimeout(() => el.classList.add('out'), Math.max(0.2, seconds) * 1000);
        setTimeout(() => el.remove(), Math.max(0.2, seconds) * 1000 + 400);
        return api;
      },
      remove(id) { const it = items.get(String(id)); if (it) { it.el.remove(); items.delete(String(id)); } return api; },
      clear() { for (const [, it] of items) it.el.remove(); items.clear(); uiLayer.querySelectorAll('.ui-message, .ui-over').forEach((e) => e.remove()); return api; },
    };
    return api;
  }

  // ------------------------------------------------------------------ the game object scripts see
  function makeGame() {
    const cfg = W.config;
    const game = {
      get time() { return W.time; },
      get paused() { return W.paused; },
      get dt() { return W.dt; },
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
        const el = document.createElement('div');
        el.className = 'ui-over';
        el.innerHTML = '<div class="ui-over-text"></div><button class="ui-button">Play again</button>';
        el.querySelector('.ui-over-text').textContent = String(text);
        el.querySelector('button').onclick = () => { W.restartAsked = true; };
        uiLayer.appendChild(el);
      },
      save(k, v) { saved.set(String(k), JSON.stringify(v)); },
      load(k, fallback = null) { const v = saved.get(String(k)); return v === undefined ? fallback : JSON.parse(v); },

      box: (o = {}) => { const s = size3(o.size, 1); return shape('box', () => B.MeshBuilder.CreateBox('box', { width: s[0], height: s[1], depth: s[2] }, W.scene), o); },
      sphere: (o = {}) => shape('sphere', () => B.MeshBuilder.CreateSphere('sphere', { diameter: (Number(o.radius) || 0.5) * 2, segments: 24 }, W.scene), o),
      capsule: (o = {}) => shape('capsule', () => B.MeshBuilder.CreateCapsule('capsule', { radius: Number(o.radius) || 0.4, height: Math.max((Number(o.radius) || 0.4) * 2, Number(o.height) || 1.8), tessellation: 16 }, W.scene), o),
      cylinder: (o = {}) => shape('cylinder', () => B.MeshBuilder.CreateCylinder('cylinder', { diameter: (Number(o.radius) || 0.5) * 2, height: Number(o.height) || 1, tessellation: 32 }, W.scene), o),
      plane: (o = {}) => { const s = Array.isArray(o.size) ? o.size : [Number(o.size) || 10, Number(o.size) || 10]; return shape('plane', () => B.MeshBuilder.CreateGround('plane', { width: s[0], height: s[1] ?? s[0] }, W.scene), o); },
      model,
      sprite,

      find: (name) => { for (const e of W.entities) if (e.name === name) return e; return null; },
      all: (tag) => [...W.entities].filter((e) => !tag || e.tag === tag),
      nearest(tag, from) { const p = posOf(from); let best = null, bd = Infinity; for (const e of W.entities) { if (tag && e.tag !== tag) continue; if (from && from.__entity && e === from) continue; const d = Math.hypot(e.x - p[0], e.y - p[1], e.z - p[2]); if (d < bd) { bd = d; best = e; } } return best; },

      sky(what) {
        if (W.skybox) { W.skybox.dispose(); W.skybox = null; }
        if (/^#/.test(String(what))) { const c = hex(what); W.scene.clearColor = new B.Color4(c.r, c.g, c.b, 1); if (W.scene.fogMode) W.scene.fogColor = c; return; }
        W.skybox = new B.PhotoDome('sky', assetUrl(what), { resolution: 32, size: 1000 }, W.scene);
      },
      light(o = {}) {
        const p = vec(o.position, [0, 5, 0]);
        let l;
        if (o.type === 'sun') { const d = vec(o.direction, [-0.4, -1, 0.3]); l = new B.DirectionalLight('sun', new B.Vector3(d[0], d[1], d[2]), W.scene); }
        else if (o.type === 'spot') { const d = vec(o.direction, [0, -1, 0]); l = new B.SpotLight('spot', new B.Vector3(...p), new B.Vector3(d[0], d[1], d[2]), (o.angle || 45) * RAD, 2, W.scene); }
        else { l = new B.PointLight('point', new B.Vector3(...p), W.scene); }
        l.diffuse = hex(o.color, '#ffffff');
        l.intensity = o.intensity ?? 1;
        if (o.range) l.range = o.range;
        return { light: l, set position(v) { const q = vec(v); l.position = new B.Vector3(...q); }, dispose: () => l.dispose() };
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
        if (!audio) return;
        loadBuffer(assetUrl(name)).then((buf) => {
          const src = audio.createBufferSource();
          src.buffer = buf;
          if (o.rate) src.playbackRate.value = o.rate;
          const g = audio.createGain();
          g.gain.value = o.volume ?? 1;
          src.connect(g).connect(audio.destination);
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
          const a = game.input.axis();
          const yaw = W.camera.yawNow();
          const s = Math.sin(yaw), c = Math.cos(yaw);
          return { x: a.x * c + a.y * s, z: -a.x * s + a.y * c };
        },
        get mouse() { return mouse; },
        onKey(k, fn) { keyHandlers.push({ key: String(k).toLowerCase(), fn: safe(fn) }); },
      },
      ui: W.ui,
      get camera() { return W.camera.api; },
      get scene() { return W.scene; },
      engine,
      BABYLON: B,
    };
    return game;
  }

  function clickPick(e) {
    if (!W || !W.scene) return;
    const r = canvas.getBoundingClientRect();
    const pick = W.scene.pick(e.clientX - r.left, e.clientY - r.top);
    let n = pick && pick.hit ? pick.pickedMesh : null;
    while (n && !(n.metadata && n.metadata.entity)) n = n.parent;
    const ent = n && n.metadata.entity;
    if (ent && ent.alive) for (const h of ent.handlers.click) h(pick.pickedPoint ? [pick.pickedPoint.x, pick.pickedPoint.y, pick.pickedPoint.z] : null);
  }

  // ------------------------------------------------------------------ physics, timers, the frame
  function step(dt) {
    W.time += dt;
    for (const t of W.timers) {
      if (t.dead || t.at > W.time) continue;
      t.fn();
      if (t.every) t.at += t.every; else t.dead = true;
    }
    W.timers = W.timers.filter((t) => !t.dead);
    for (const f of W.updates) f(dt, W.time);
    const g = W.config.gravity ?? -24;
    for (const e of W.entities) {
      if (!e.alive) continue;
      if (e.physics === 'dynamic') {
        e.vy = Math.max(-60, e.vy + g * dt);
        const was = e.grounded;
        e.grounded = false;
        e.sweep(0, e.vx * dt);
        e.sweep(2, e.vz * dt);
        if (e.sweep(1, e.vy * dt)) { if (e.vy < 0) e.grounded = true; e.vy = 0; }
        else if (was && e.vy <= 0) {
          // Stay on the ground over small steps and slopes instead of bouncing off them.
          const y = e.y;
          if (e.sweep(1, -0.06)) { e.grounded = true; e.vy = 0; } else e.y = y;
        }
      } else if (e.physics === 'kinematic' && (e.vx || e.vy || e.vz)) {
        e.move(e.vx * dt, e.vy * dt, e.vz * dt);
      }
      if (e._sheet && e._sheet.fps > 0) {
        const s = e._sheet;
        s.t += dt * s.fps;
        let f = s.from + Math.floor(s.t);
        if (f > s.to) { if (s.loop) { s.t = 0; f = s.from; } else f = s.to; }
        if (f !== s.frame) { s.frame = f; setFrame(e, f); }
      }
    }
    // Contacts: new touches fire hit (triggers included), ended ones are forgotten.
    const list = [...W.entities].filter((e) => e.alive && e.physics !== 'none' && e.node.isEnabled());
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a.physics === 'static' && b.physics === 'static') continue;
        if (!a.handlers.hit.length && !b.handlers.hit.length && !a._touching.has(b)) continue;
        if (a.overlaps(b, TOUCH)) a._contact(b);
        else if (a._touching.has(b)) { a._touching.delete(b); b._touching.delete(a); }
      }
    }
  }

  function frame() {
    if (!W) return;
    if (W.restartAsked) { start(); return; }
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000 || 0.016);
    W.dt = dt;
    if (!W.paused) step(dt);
    W.camera.update(dt);
    pressedNow = new Set();
    releasedNow = new Set();
    mouse.pressed = false;
    mouse.dx = 0; mouse.dy = 0;
    W.scene.render();
  }

  // ------------------------------------------------------------------ running a bundle
  function parseConfig(files) {
    try { return files['game.json'] ? JSON.parse(files['game.json']) : {}; } catch (e) { report(new Error(`game.json is not valid JSON: ${e.message}`), 'game.json'); return {}; }
  }

  function scriptOrder(files, cfg) {
    const all = Object.keys(files).filter((p) => /\.js$/i.test(p) && (p.startsWith('scripts/') || !p.includes('/')));
    const first = Array.isArray(cfg.scripts) ? cfg.scripts.filter((p) => all.includes(p)) : [];
    return [...first, ...all.filter((p) => !first.includes(p)).sort()];
  }

  function start() {
    if (W) {
      W.ui.clear();
      W.scene.dispose();
    }
    clearErrors();
    keyHandlers = [];
    const cfg = parseConfig(bundle.files);
    const scene = new B.Scene(engine);
    W = { scene, config: cfg, entities: new Set(), starts: [], updates: [], timers: [], time: 0, dt: 0.016, paused: false, restartAsked: false, state: {}, pixelated: Boolean(cfg.pixelated), file: null, skybox: null };
    W.ui = ui();
    const bg = hex(cfg.background, '#9fd3f0');
    scene.clearColor = new B.Color4(bg.r, bg.g, bg.b, 1);
    scene.ambientColor = new B.Color3(1, 1, 1);
    if (cfg.fog) { scene.fogMode = B.Scene.FOGMODE_LINEAR; scene.fogColor = hex(cfg.fog.color || cfg.background, '#9fd3f0'); scene.fogStart = cfg.fog.start ?? 40; scene.fogEnd = cfg.fog.end ?? 120; }
    if (cfg.lights !== false) {
      const hemi = new B.HemisphericLight('sky', new B.Vector3(0.2, 1, -0.3), scene);
      hemi.intensity = cfg.ambient ?? 0.7;
      hemi.groundColor = new B.Color3(0.35, 0.35, 0.4);
      const sun = new B.DirectionalLight('sun', new B.Vector3(-0.5, -1, 0.4), scene);
      sun.position = new B.Vector3(20, 40, -20);
      sun.intensity = cfg.sun ?? 0.9;
      if (cfg.shadows !== false) {
        const sg = new B.ShadowGenerator(1024, sun);
        sg.useBlurExponentialShadowMap = true;
        sg.blurKernel = 16;
        sg.bias = 0.0005;
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
    const game = makeGame();
    window.game = game;
    for (const path of scriptOrder(bundle.files, cfg)) {
      W.file = path;
      try {
        new Function('game', `${bundle.files[path]}\n//# sourceURL=hawkes-script://${path}`)(game);
      } catch (e) {
        report(e, path);
      }
    }
    W.file = null;
    for (const f of W.starts) f();
    post({ type: 'started', entities: W.entities.size });
  }

  let looping = false;
  function run(b) {
    bundle = b;
    document.title = b.title ? `${b.title} · Hawkes Play` : 'Hawkes Play';
    const loading = $('loading');
    if (loading) loading.hidden = true;
    // Warm the sound cache so the first effect plays on time.
    for (const [, a] of Object.entries(b.assets || {})) if (/^audio\//.test(a.mime || '') && a.url) fetch(a.url).catch(() => {});
    try { start(); } catch (e) { report(e); }
    if (!looping) { looping = true; engine.runRenderLoop(() => { try { frame(); } catch (e) { report(e); W && (W.paused = true); } }); }
  }

  window.HawkesPlay = { run, restart: () => { if (W) W.restartAsked = true; } };
  window.addEventListener('error', (e) => report(e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
})();
