// Mayhem's tools (H.tools): rocket-launcher, grenade, sticky-bomb (alias detonator), spawn-gun, gravity-gun, lasso,
// flamethrower, matches. Click (or the Fire button on a phone) uses one; R (the Alt button) does its second thing;
// Q (the ⇄ button) switches between the tools you've picked up (the belt). game.player.tool = 'grenade' holds one;
// config.player.tools = ['rocket-launcher', 'gravity-gun'] starts you with a belt.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const M = H.mayhemMath;
  const X = H.mayhem;
  const W = () => H.world;
  const G = () => H.game;
  const vec = L.vec;
  const r2 = (n) => Math.round(n * 100) / 100;
  const r2v = (a) => [r2(a[0]), r2(a[1]), r2(a[2])];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hexc = (c, f = '#ffffff') => L.hex(c, f);
  const online = () => Boolean(H.sync && H.sync.online);
  const me = () => (H.sync ? H.sync.me : null);
  const havok = () => H.physics && H.physics.engine === 'havok';
  const MAYHEM_TOOLS = ['rocket-launcher', 'grenade', 'sticky-bomb', 'detonator', 'spawn-gun', 'gravity-gun', 'lasso', 'flamethrower', 'matches'];

  // ------------------------------------------------------------------ input: the trigger, alt and next
  const I = () => H.input;
  /** Can the player use a tool now (playing, in control of the view)? */
  function aiming() {
    const w = W();
    if (!w || H.mode === 'build' || w.paused) return false;
    const p = w.player;
    return I().mouse.locked || H.touchUi || Boolean(p && p.mouse === 'free') || document.body.classList.contains('soft-control');
  }
  const fireHeld = () => aiming() && (I().held.has('mfire') || (!H.touchUi && I().mouse.down));
  /** The trigger going down this step (once, however many steps a frame takes). */
  function trigger(st) {
    const down = fireHeld();
    const pressed = (down && !st._down) || (aiming() && !H.touchUi && I().mouse.pressed && !st._down);
    st._down = down;
    return pressed;
  }
  /** A key tapped this step (R, or the phone's Alt button): once, even when a frame runs several steps or the key
   *  went down and up between two steps. */
  function keyTap(st, slot, keys) {
    const held = keys.some((k) => I().held.has(k));
    const set = I().pressed;
    let tap = held && !st[slot];
    if (!tap && set !== st[slot + 'Set'] && keys.some((k) => set.has(k))) tap = true;
    st[slot] = held; st[slot + 'Set'] = set;
    return tap && H.mode !== 'build';
  }

  // ------------------------------------------------------------------ the camera's aim
  function cam() { return W().scene.activeCamera; }
  function aimRay() { const c = cam(); const d = c.getDirection(B.Axis.Z); return { from: [c.position.x, c.position.y, c.position.z], dir: [d.x, d.y, d.z] }; }
  function aimHit(dist = 60) { const r = aimRay(); return G().raycast(r.from, r.dir, dist, { ignore: W().player }); }
  /** Where things leave the hand: the view model's muzzle, or just in front of the camera. */
  function handPos(st, ahead = 0.9) {
    if (st.vm && st.vm.muzzle && st.vm.root.isEnabled()) { const p = st.vm.muzzle.getAbsolutePosition(); return [p.x, p.y, p.z]; }
    const r = aimRay();
    return [r.from[0] + r.dir[0] * ahead, r.from[1] + r.dir[1] * ahead - 0.15, r.from[2] + r.dir[2] * ahead];
  }

  // ------------------------------------------------------------------ view models (stand-in shapes in your hands)
  function viewModel(kind, color) {
    const sc = W().scene;
    const root = new B.TransformNode('mh-vm', sc);
    const dark = new B.StandardMaterial('mh-vm', sc); dark.diffuseColor = new B.Color3(0.13, 0.14, 0.18); dark.specularColor = new B.Color3(0.4, 0.4, 0.45);
    const lit = new B.StandardMaterial('mh-vm-lit', sc); lit.emissiveColor = hexc(color); lit.disableLighting = true;
    const mats = [dark, lit];
    const part = (m, mat, x, y, z) => { m.material = mat; m.parent = root; m.position.set(x, y, z); m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = 1; return m; };
    const box = (w, h, d) => B.MeshBuilder.CreateBox('mh-vm', { width: w, height: h, depth: d }, sc);
    const cyl = (dia, h) => B.MeshBuilder.CreateCylinder('mh-vm', { diameter: dia, height: h, tessellation: 14 }, sc);
    let muzzle;
    if (kind === 'rocket-launcher') {
      part(cyl(0.17, 0.85), dark, 0, 0.02, 0.18).rotation.x = Math.PI / 2;
      part(B.MeshBuilder.CreateTorus('mh-vm', { diameter: 0.19, thickness: 0.03, tessellation: 18 }, sc), lit, 0, 0.02, 0.6).rotation.x = Math.PI / 2;
      part(box(0.08, 0.18, 0.09), dark, 0, -0.14, 0).rotation.x = 0.3;
      part(box(0.04, 0.06, 0.12), lit, 0, 0.13, -0.05);
      muzzle = part(box(0.02, 0.02, 0.02), lit, 0, 0.02, 0.64);
    } else if (kind === 'grenade' || kind === 'sticky-bomb') {
      part(B.MeshBuilder.CreateSphere('mh-vm', { diameter: 0.17, segments: 10 }, sc), kind === 'grenade' ? dark : lit, 0, 0, 0.12);
      part(box(0.05, 0.06, 0.05), kind === 'grenade' ? lit : dark, 0, 0.1, 0.12);
      if (kind === 'sticky-bomb') { const det = part(box(0.08, 0.14, 0.04), dark, -0.22, -0.02, 0.05); det.rotation.z = 0.3; part(box(0.03, 0.03, 0.02), lit, -0.23, 0.05, 0.075); }
      muzzle = part(box(0.01, 0.01, 0.01), lit, 0, 0, 0.2);
    } else if (kind === 'lasso') {
      part(B.MeshBuilder.CreateTorus('mh-vm', { diameter: 0.3, thickness: 0.03, tessellation: 20 }, sc), lit, 0, 0, 0.15).rotation.y = Math.PI / 2;
      part(B.MeshBuilder.CreateTorus('mh-vm', { diameter: 0.26, thickness: 0.03, tessellation: 20 }, sc), lit, 0.03, 0, 0.15).rotation.y = Math.PI / 2;
      muzzle = part(box(0.01, 0.01, 0.01), lit, 0, 0.1, 0.3);
    } else if (kind === 'matches') {
      part(box(0.14, 0.04, 0.09), lit, 0, -0.04, 0.1);
      part(box(0.015, 0.015, 0.18), dark, 0.02, 0.0, 0.22);
      muzzle = part(B.MeshBuilder.CreateSphere('mh-vm', { diameter: 0.03, segments: 6 }, sc), lit, 0.02, 0, 0.32);
    } else {
      // Guns: spawn gun (a dish), gravity gun (prongs), flamethrower (a tank and a nozzle).
      part(box(0.13, 0.15, 0.5), dark, 0, 0, 0.05);
      part(box(0.08, 0.18, 0.09), dark, 0, -0.14, -0.08).rotation.x = 0.3;
      part(box(0.135, 0.025, 0.36), lit, 0, 0.065, 0.04);
      if (kind === 'spawn-gun') part(B.MeshBuilder.CreateCylinder('mh-vm', { diameterTop: 0.22, diameterBottom: 0.06, height: 0.12, tessellation: 18 }, sc), lit, 0, 0, 0.36).rotation.x = Math.PI / 2;
      if (kind === 'gravity-gun') for (const a of [0, 2.09, 4.18]) { const pr = part(box(0.025, 0.025, 0.2), lit, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0.38); pr.rotation.y = Math.cos(a) * -0.3; pr.rotation.x = Math.sin(a) * 0.3; }
      if (kind === 'flamethrower') { part(cyl(0.12, 0.34), lit, 0, -0.03, -0.16); part(cyl(0.05, 0.3), dark, 0, 0.0, 0.42).rotation.x = Math.PI / 2; }
      muzzle = part(box(0.01, 0.01, 0.01), lit, 0, 0.0, kind === 'flamethrower' ? 0.6 : 0.44);
    }
    muzzle.visibility = 0;
    sc.setRenderingAutoClearDepthStencil(1, true);
    return { root, muzzle, lit, kick: 0, bob: 0, dispose() { root.dispose(); for (const m of mats) m.dispose(); } };
  }
  function swayViewModel(vm, dt) {
    const w = W();
    if (!vm || !w) return;
    const p = w.player;
    vm.root.parent = cam();
    vm.root.setEnabled(Boolean(p && p._view === 'first'));
    const moving = p && Math.hypot(p.vx, p.vz) > 0.5 && p.grounded;
    vm.bob += dt * (moving ? 9 : 2);
    vm.kick = Math.max(0, vm.kick - dt * 6);
    const sway = moving ? 0.012 : 0.003;
    vm.root.scaling.setAll(0.62);
    vm.root.position.set(0.21 + Math.cos(vm.bob) * sway, -0.19 + Math.abs(Math.sin(vm.bob)) * sway, 0.5 - vm.kick * 0.08);
    vm.root.rotation.set(-vm.kick * 0.25, -0.05, 0);
  }

  // ------------------------------------------------------------------ the HUD: crosshair, tips, phone buttons
  const hud = { cross: null, tip: null, tipT: 0, touch: null, held: null };
  function ui() { return document.getElementById('ui') || document.body; }
  function tip(html, seconds = 3.5) {
    X.styles();
    if (!hud.tip || !hud.tip.isConnected) { hud.tip = document.createElement('div'); hud.tip.className = 'mh-tip'; ui().appendChild(hud.tip); }
    hud.tip.innerHTML = html;
    hud.tip.classList.remove('out'); hud.tip.hidden = false;
    hud.tipT = seconds;
  }
  function crosshair(on) {
    X.styles();
    if (!hud.cross || !hud.cross.isConnected) { hud.cross = document.createElement('div'); hud.cross.className = 'mh-cross'; ui().appendChild(hud.cross); }
    hud.cross.hidden = !on;
  }
  /** Phone buttons while holding a mayhem tool: Fire, the tool's second thing, and next tool. */
  function touchButtons(alt) {
    if (!H.touchUi) return;
    X.styles();
    if (!hud.touch || !hud.touch.isConnected) {
      const el = document.createElement('div');
      el.className = 'mh-touch';
      el.innerHTML = '<button type="button" class="mh-fire">FIRE</button><button type="button" class="mh-alt"></button><button type="button" class="mh-next" aria-label="Next tool">⇄</button>';
      document.body.appendChild(el);
      H.bindTouchKey(el.querySelector('.mh-fire'), 'mfire');
      H.bindTouchKey(el.querySelector('.mh-alt'), 'malt');
      H.bindTouchKey(el.querySelector('.mh-next'), 'mnext');
      hud.touch = el;
    }
    hud.touch.hidden = false;
    const key = `${alt}|${belt.length > 1}`;
    if (hud.touchKey === key) return;
    hud.touchKey = key;
    const a = hud.touch.querySelector('.mh-alt');
    a.textContent = alt || ''; a.hidden = !alt;
    hud.touch.querySelector('.mh-next').hidden = belt.length < 2;
  }
  function hideHud() { if (hud.cross) hud.cross.hidden = true; if (hud.touch) hud.touch.hidden = true; }
  X.frames.push((dt) => {
    if (hud.tip && hud.tipT > 0) { hud.tipT -= dt; if (hud.tipT <= 0) hud.tip.classList.add('out'); }
    // The belt: Q (or ⇄) switches to the next tool you have.
    const p = W().player;
    if (p && H.mode !== 'build' && belt.length > 1 && (I().pressed.has('q') || I().pressed.has('mnext'))) {
      const name = toolName(p.tool);
      const i = belt.findIndex((b) => b.name === name);
      const next = belt[(i + 1) % belt.length];
      p.tool = next.opts && Object.keys(next.opts).length ? { type: next.name, ...next.opts } : next.name;
    }
    const held = p && MAYHEM_TOOLS.includes(toolName(p.tool)) && H.mode !== 'build';
    if (!held) hideHud();
  });

  // ------------------------------------------------------------------ the belt: the tools you have
  const belt = []; // [{ name, opts }]
  const toolName = (t) => (typeof t === 'string' ? t : t && (t.type || t.name)) || null;
  const TITLES = { 'rocket-launcher': 'Rocket launcher', grenade: 'Grenades', 'sticky-bomb': 'Sticky bombs', detonator: 'Sticky bombs', 'spawn-gun': 'Spawn gun', 'gravity-gun': 'Gravity gun', lasso: 'Lasso', flamethrower: 'Flamethrower', matches: 'Matches' };
  /** Puts a tool in the player's hands (and on the belt, so Q comes back to it). */
  function giveTool(name, opts = {}) {
    const p = G() && G().player;
    if (!p) return;
    const n = String(name);
    if (!belt.some((b) => b.name === n)) belt.push({ name: n, opts: opts || {} });
    p.tool = opts && Object.keys(opts).length ? { type: n, ...opts } : n;
    const title = TITLES[n] || (H.tools.get(n) && H.tools.get(n).title) || n;
    tip(`Got the <b>${title}</b>${belt.length > 1 ? ` · ${H.touchUi ? '⇄' : 'Q'} switches tools` : ''}`, 3);
  }
  X.giveTool = giveTool;
  Object.defineProperty(X, 'belt', { get: () => belt.map((b) => b.name), configurable: true });
  X.leaves.push(() => { belt.length = 0; hud.held = null; for (const r of [...ropes]) dropRope(r); projectiles.length = 0; myStickies.clear(); remoteFlames.clear(); });
  // config.player.tools: the belt a world starts with.
  H.hooks.world.push({
    enter() {
      const s = (L.effectiveConfig().player || {});
      const list = Array.isArray(s.tools) ? s.tools : [];
      for (const t of list) { const n = toolName(t); if (n && !belt.some((b) => b.name === n)) belt.push({ name: n, opts: typeof t === 'object' ? { ...t, type: undefined } : {} }); }
      const p = W().player;
      if (p && !p.tool && belt.length) p.tool = belt[0].name;
    },
  });

  // A tool's common parts: a view model, the HUD, a first tip.
  function base(kind, color, o) {
    return {
      title: TITLES[kind],
      kind: 'mayhem',
      equip(ctx) {
        ctx.state.vm = viewModel(kind, color);
        ctx.state.cool = 0;
        ctx.state._down = fireHeld();
        if (!belt.some((b) => b.name === kind)) belt.push({ name: kind, opts: ctx.opts || {} });
        if (o.tip) tip(typeof o.tip === 'function' ? o.tip(ctx) : o.tip, 4);
        if (o.equip) o.equip(ctx);
      },
      unequip(ctx) { if (o.unequip) o.unequip(ctx); if (ctx.state.vm) ctx.state.vm.dispose(); hideHud(); },
      step(dt, ctx) {
        const st = ctx.state;
        if (st.cool > 0) st.cool -= dt;
        if (keyTap(st, '_alt', ['r', 'malt']) && o.onAlt) o.onAlt(ctx);
        o.step(dt, ctx);
      },
      frame(dt, ctx) {
        swayViewModel(ctx.state.vm, dt);
        crosshair(H.mode !== 'build');
        touchButtons(typeof o.alt === 'function' ? o.alt(ctx) : o.alt);
        if (o.frame) o.frame(dt, ctx);
      },
    };
  }

  // ------------------------------------------------------------------ rockets
  const projectiles = []; // { node, v, life, real, o, trail, ignore }
  const rocketAction = H.sync.action('mayhem:rocket', (d) => launchRocket(d));
  function launchRocket(d) {
    const sc = W().scene;
    const node = new B.TransformNode('mh-rocket', sc);
    const body = B.MeshBuilder.CreateCylinder('mh-rocket', { diameter: 0.14, height: 0.6, tessellation: 10 }, sc);
    const mat = new B.StandardMaterial('mh-rocket', sc); mat.diffuseColor = new B.Color3(0.25, 0.27, 0.3);
    body.material = mat; body.rotation.x = Math.PI / 2; body.parent = node;
    const nose = B.MeshBuilder.CreateCylinder('mh-rocket-nose', { diameterTop: 0, diameterBottom: 0.14, height: 0.2, tessellation: 10 }, sc);
    const glow = new B.StandardMaterial('mh-rocket-glow', sc); glow.emissiveColor = hexc(d.o.color || '#ff6b3d'); glow.disableLighting = true;
    nose.material = glow; nose.rotation.x = Math.PI / 2; nose.position.z = 0.4; nose.parent = node;
    for (const m of [body, nose]) { m.isPickable = false; m.metadata = { decor: true }; }
    node.position.set(...d.from);
    const dir = new B.Vector3(...d.dir).normalize();
    node.lookAt(node.position.add(dir));
    // Fire and smoke behind it.
    const trail = new B.ParticleSystem('mh-trail', 160, sc);
    trail.particleTexture = W().dot; trail.emitter = node;
    trail.minEmitBox = trail.maxEmitBox = new B.Vector3(0, 0, -0.35);
    trail.color1 = new B.Color4(1, 0.7, 0.3, 1); trail.color2 = new B.Color4(0.5, 0.48, 0.45, 0.6); trail.colorDead = new B.Color4(0.3, 0.3, 0.3, 0);
    trail.minSize = 0.15; trail.maxSize = 0.45; trail.addSizeGradient(0, 0.3); trail.addSizeGradient(1, 1.4);
    trail.minLifeTime = 0.2; trail.maxLifeTime = 0.7; trail.emitRate = 160;
    trail.direction1 = new B.Vector3(-0.2, -0.2, -0.2); trail.direction2 = new B.Vector3(0.2, 0.2, 0.2); trail.minEmitPower = 0.2; trail.maxEmitPower = 0.6;
    trail.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    trail.start();
    const real = !online() || d.by === me();
    projectiles.push({ node, mats: [mat, glow], v: dir.scale(d.o.speed || 32), life: 0, real, o: d.o, trail, by: d.by });
    X.sound('whoosh', { at: d.from });
  }
  X.steps.push((dt) => {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const pr = projectiles[i];
      pr.life += dt;
      const step = pr.v.scale(dt);
      const from = pr.node.position;
      const hit = G().raycast([from.x, from.y, from.z], [step.x, step.y, step.z], step.length() + 0.2, { ignore: W().player });
      const theirs = hit && hit.entity && hit.entity.remotePlayer && !pr.real && pr.life < 0.3;
      if ((hit && !theirs) || pr.life > 5) {
        const at = hit ? [hit.point[0] - step.x * 0.02, hit.point[1] - step.y * 0.02, hit.point[2] - step.z * 0.02] : [from.x, from.y, from.z];
        if (pr.real) X.explode(at, { radius: pr.o.radius, force: pr.o.force, damage: pr.o.damage, fire: pr.o.fire, color: pr.o.color });
        endProjectile(pr);
        projectiles.splice(i, 1);
        continue;
      }
      from.addInPlace(step);
    }
  });
  function endProjectile(pr) {
    pr.trail.stop();
    const t = pr.trail;
    setTimeout(() => t.dispose(), 900);
    pr.node.dispose(false, true);
    for (const m of pr.mats) m.dispose();
  }
  H.tools.register('rocket-launcher', base('rocket-launcher', '#ff6b3d', {
    tip: `<b>Rocket launcher</b> · ${H.touchUi ? 'FIRE' : 'click'} fires`,
    step(dt, ctx) {
      const st = ctx.state, o = ctx.opts;
      if (trigger(st) && st.cool <= 0) {
        st.cool = 1 / (Number(o.rate) || 1.4);
        st.vm.kick = 1;
        const r = aimRay();
        // Aim from the hand at what the crosshair is on.
        const hand = handPos(st);
        const target = aimHit(200);
        const to = target ? target.point : [r.from[0] + r.dir[0] * 200, r.from[1] + r.dir[1] * 200, r.from[2] + r.dir[2] * 200];
        const dir = [to[0] - hand[0], to[1] - hand[1], to[2] - hand[2]];
        const l = Math.hypot(...dir) || 1;
        rocketAction({ from: r2v(hand), dir: dir.map((x) => r2(x / l)), by: me(), o: { radius: Number(o.radius) || 5.5, force: Number(o.force ?? 20), damage: Number(o.damage ?? 60), fire: Boolean(o.fire), speed: Number(o.speed) || 32, color: o.color || null } });
        G().camera.shake(0.12, 0.12);
        X.credit();
      }
    },
  }));

  // ------------------------------------------------------------------ grenades: hold to aim (an arc), let go to throw
  let dotSrc = null;
  function arcDots(n) {
    const sc = W().scene;
    if (!dotSrc || dotSrc.getScene() !== sc || dotSrc.isDisposed()) {
      dotSrc = B.MeshBuilder.CreateSphere('mh-arc', { diameter: 0.09, segments: 6 }, sc);
      const m = new B.StandardMaterial('mh-arc', sc); m.emissiveColor = new B.Color3(1, 0.85, 0.5); m.disableLighting = true; m.alpha = 0.85;
      dotSrc.material = m; dotSrc.isPickable = false; dotSrc.metadata = { decor: true }; dotSrc.position.y = -10000;
    }
    const out = [];
    for (let i = 0; i < n; i++) { const d = dotSrc.createInstance('mh-arc'); d.isPickable = false; d.metadata = { decor: true }; out.push(d); }
    return out;
  }
  function throwVelocity(speed) {
    const r = aimRay();
    return [r.dir[0] * speed, r.dir[1] * speed + speed * 0.25, r.dir[2] * speed];
  }
  function thrown(kind, ctx, speed) {
    const o = ctx.opts;
    const hand = handPos(ctx.state, 0.7);
    const p = W().player;
    const v = throwVelocity(speed);
    if (p) { v[0] += p.vx * 0.5; v[2] += p.vz * 0.5; }
    const r = kind === 'grenade' ? 0.15 : 0.13;
    const spec = { type: 'sphere', name: kind === 'grenade' ? 'Grenade' : 'Sticky bomb', shape: { radius: r, segments: 10 }, material: { color: kind === 'grenade' ? '#3d4f2a' : '#d6334f', emissive: '#000000' }, physics: 'dynamic', body: { bounce: kind === 'grenade' ? 0.35 : 0, mass: 0.5, friction: 0.9 }, shadow: false };
    const data = kind === 'grenade'
      ? { grenade: { fuse: Number(o.fuse) || 2.5, radius: Number(o.radius) || 5, force: Number(o.force ?? 18), damage: Number(o.damage ?? 50), fire: Boolean(o.fire) }, by: me() }
      : { sticky: { radius: Number(o.radius) || 4.5, force: Number(o.force ?? 16), damage: Number(o.damage ?? 45), fire: Boolean(o.fire) }, by: me() };
    const made = X.spawnMany(spec, 1, { at: hand, ground: false, velocity: v, owner: me(), data, effects: false });
    X.sound('throw', { at: hand });
    X.credit();
    return made[0] || null;
  }
  H.tools.register('grenade', base('grenade', '#9bd24a', {
    tip: `<b>Grenades</b> · hold ${H.touchUi ? 'FIRE' : 'the mouse'} to aim, let go to throw`,
    equip(ctx) { ctx.state.dots = arcDots(16); for (const d of ctx.state.dots) d.setEnabled(false); ctx.state.charge = 0; },
    unequip(ctx) { for (const d of ctx.state.dots || []) d.dispose(); },
    step(dt, ctx) {
      const st = ctx.state;
      const down = fireHeld();
      if (down && st.cool <= 0) { st.aiming = true; st.charge = Math.min(1, st.charge + dt / 0.8); }
      else if (st.aiming && !down) {
        st.aiming = false;
        thrown('grenade', ctx, 11 + st.charge * 9);
        st.charge = 0; st.cool = 0.5; st.vm.kick = 1;
      }
      st._down = down;
    },
    frame(dt, ctx) {
      const st = ctx.state;
      // The arc: where it would go.
      const show = st.aiming;
      if (!st.dots) return;
      if (!show) { for (const d of st.dots) d.setEnabled(false); return; }
      const v = throwVelocity(11 + st.charge * 9);
      const from = handPos(st, 0.7);
      const g = W().config.gravity ?? -24;
      let stop = false;
      st.dots.forEach((d, i) => {
        const t = (i + 1) * 0.06;
        const p = M.arc(from, v, g, t);
        if (!stop && i > 0) { const q = M.arc(from, v, g, t - 0.06); const hit = G().raycast(q, [p[0] - q[0], p[1] - q[1], p[2] - q[2]], Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), { ignore: W().player }); if (hit) stop = true; }
        d.setEnabled(!stop); d.position.set(p[0], p[1], p[2]);
      });
    },
  }));
  // Fuses: the thrower's machine counts down and sets it off; it blinks faster near the end.
  X.steps.push((dt) => {
    for (const e of W().entities) {
      const gr = e.data && e.data.grenade;
      if (!gr || !e.alive) continue;
      e._fuse = (e._fuse || 0) + dt;
      const left = gr.fuse - e._fuse;
      const blink = Math.sin(e._fuse * (left < 0.8 ? 40 : 14)) > 0;
      if (e._mat) e._mat.emissiveColor = blink ? new B.Color3(1, 0.25, 0.1) : new B.Color3(0, 0, 0);
      if (Math.floor(e._fuse * 2) !== Math.floor((e._fuse - dt) * 2) && !e.remote) X.sound('beep', { at: e.position, volume: 0.4 });
      if (left <= 0 && !e.remote && !e._exploded) {
        e._exploded = true;
        X.explode([e.x, e.y, e.z], { radius: gr.radius, force: gr.force, damage: gr.damage, fire: gr.fire, remove: e.sceneId });
      }
    }
  });

  // ------------------------------------------------------------------ sticky bombs: stick where they land, R sets them off
  const myStickies = new Set();
  const stickAction = H.sync.action('mayhem:stick', (d) => {
    const e = G().entity(d.id);
    if (!e || !e.alive) return;
    const to = d.to ? G().entity(d.to) : null;
    e.physics = 'none';
    e.velocity = [0, 0, 0];
    e.position = d.at;
    e._stuck = to ? { to, local: d.local } : { to: null };
    X.sound('beep', { at: d.at, volume: 0.5 });
  });
  H.physics.on('collision', ({ a, b }) => {
    for (const [s, o] of [[a, b], [b, a]]) {
      if (!s || !s.data || !s.data.sticky || s._stuck || s.remote || !s.alive || (o && o.isPlayer)) continue;
      s._stuck = { pending: true };
      let local = null;
      if (o && o.sceneId && o.physics !== 'static') {
        const inv = o.node.getWorldMatrix().clone().invert();
        const l = B.Vector3.TransformCoordinates(new B.Vector3(s.x, s.y, s.z), inv);
        local = [r2(l.x), r2(l.y), r2(l.z)];
      }
      stickAction({ id: s.sceneId, to: local ? o.sceneId : null, local, at: r2v(s.position) });
    }
  });
  X.steps.push(() => {
    for (const e of W().entities) {
      const st = e._stuck;
      if (!st || !e.alive) continue;
      if (st.to) {
        if (!st.to.alive || st.to.dead) { e._stuck = null; e.physics = 'dynamic'; continue; }
        const p = B.Vector3.TransformCoordinates(new B.Vector3(...st.local), st.to.node.getWorldMatrix());
        e.node.position.copyFrom(p);
      }
      if (e._mat && e.data.sticky) e._mat.emissiveColor = Math.sin(performance.now() / 160) > 0 ? new B.Color3(1, 0.1, 0.2) : new B.Color3(0.2, 0, 0);
    }
  });
  function detonate() {
    const list = [...myStickies].filter((e) => e.alive);
    myStickies.clear();
    if (!list.length) { tip('No sticky bombs out: throw some first', 1.6); return; }
    list.forEach((e, i) => {
      const go = () => { if (!e.alive || e._exploded) return; e._exploded = true; const s = e.data.sticky; X.explode([e.x, e.y, e.z], { radius: s.radius, force: s.force, damage: s.damage, fire: s.fire, remove: e.sceneId }); };
      if (i === 0) go(); else G().after(i * 0.12, go);
    });
    X.credit();
  }
  const stickyTool = base('sticky-bomb', '#ff3b5c', {
    tip: () => `<b>Sticky bombs</b> · ${H.touchUi ? 'FIRE' : 'click'} throws, ${H.touchUi ? 'BOOM' : 'R'} sets them all off`,
    alt: 'BOOM',
    step(dt, ctx) {
      const st = ctx.state;
      if (trigger(st) && st.cool <= 0) {
        for (const e of [...myStickies]) if (!e.alive) myStickies.delete(e);
        if (myStickies.size >= (Number(ctx.opts.max) || 10)) { tip(`That's ${myStickies.size}: set them off first (${H.touchUi ? 'BOOM' : 'R'})`, 1.8); st.cool = 0.4; return; }
        const e = thrown('sticky-bomb', ctx, Number(ctx.opts.speed) || 17);
        if (e) myStickies.add(e);
        st.cool = 0.35; st.vm.kick = 1;
      }
    },
    onAlt(ctx) { detonate(); ctx.state.vm.kick = 0.5; },
  });
  H.tools.register('sticky-bomb', stickyTool);
  H.tools.register('detonator', { ...stickyTool, title: 'Sticky bombs (remote detonator)' });

  // ------------------------------------------------------------------ the spawn gun
  const SPAWN_ITEMS = ['cow', 'barrel', 'crate', 'pig', 'sheep', 'chicken', 'penguin', 'ball', 'box'];
  function spawnItems(o) {
    const list = Array.isArray(o.items) && o.items.length ? o.items.map(String) : [...SPAWN_ITEMS];
    if (o.what) { const w = String(o.what); const i = list.indexOf(w); if (i >= 0) list.splice(i, 1); list.unshift(w); }
    // The game's own models too.
    const assets = (H.bundle && H.bundle.assets) || {};
    for (const n of Object.keys(assets)) if (/\.glb$/i.test(n) && !/_low\.glb$/i.test(n) && list.length < 20 && !list.includes(n)) list.push(n);
    return list;
  }
  const label = (w) => String(w).replace(/\.glb$/i, '').replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
  H.tools.register('spawn-gun', base('spawn-gun', '#38bdf8', {
    tip: (ctx) => `<b>Spawn gun: ${label(spawnItems(ctx.opts)[0])}</b> · ${H.touchUi ? 'FIRE' : 'click'} spawns, ${H.touchUi ? 'NEXT' : 'R or the wheel'} changes${H.touchUi ? '' : ', shift-click makes 10'}`,
    alt: 'NEXT',
    equip(ctx) { ctx.state.items = spawnItems(ctx.opts); ctx.state.i = 0; },
    onAlt(ctx) { ctx.state.next = true; },
    step(dt, ctx) {
      const st = ctx.state;
      if (trigger(st) && st.cool <= 0) {
        st.cool = 0.25; st.vm.kick = 0.6;
        const what = st.items[st.i];
        const hit = aimHit(60);
        const r = aimRay();
        const at = hit ? [hit.point[0] + hit.normal[0] * 0.1, hit.point[1] + hit.normal[1] * 0.1, hit.point[2] + hit.normal[2] * 0.1] : [r.from[0] + r.dir[0] * 12, r.from[1] + r.dir[1] * 12, r.from[2] + r.dir[2] * 12];
        const n = I().held.has('shift') ? 10 : Math.max(1, Math.min(50, Number(ctx.opts.count) || 1));
        X.spawnMany(what, n, { at, area: n > 1 ? 1 + Math.sqrt(n) : null, pattern: ctx.opts.pattern || 'scatter' });
        X.credit();
      }
    },
    frame(dt, ctx) {
      const st = ctx.state;
      const w = I().mouse.wheel;
      if (st.next || (w && aiming())) {
        st.next = false;
        st.i = (st.i + (w < 0 ? -1 : 1) + st.items.length) % st.items.length;
        tip(`Spawn gun: <b>${label(st.items[st.i])}</b>`, 1.6);
      }
    },
  }));

  // ------------------------------------------------------------------ the gravity gun: pick up, hold, throw anything
  function canHold(e) {
    if (!e || !e.alive || e.isPlayer || e.remotePlayer || e.dead || e.held) return false;
    if (['light', 'text', 'spawn', 'waypoint', 'trigger', 'tool-pickup', 'plane', 'video', 'mirror'].includes(e.kind)) return false;
    if (e.physics === 'none' || e.physics === 'trigger') return false;
    const s = e.size;
    if (Math.max(...s) > (e.physics === 'dynamic' ? 8 : 4)) return false;
    return true;
  }
  function beam(st, from, to, color) {
    const sc = W().scene;
    const pts = [new B.Vector3(...from), new B.Vector3(...to)];
    if (!st.beam || st.beam.isDisposed()) {
      st.beam = B.MeshBuilder.CreateLines('mh-beam', { points: pts, updatable: true }, sc);
      st.beam.color = hexc(color); st.beam.isPickable = false; st.beam.metadata = { decor: true };
    } else B.MeshBuilder.CreateLines('mh-beam', { points: pts, instance: st.beam });
  }
  function drop(st, speed) {
    const e = st.hold;
    st.hold = null;
    if (st.beam) { st.beam.dispose(); st.beam = null; }
    if (!e || !e.alive) return;
    e.held = false;
    e.wake();
    if (speed) {
      const r = aimRay();
      X.launch(e, [r.dir[0] * speed, r.dir[1] * speed + 1, r.dir[2] * speed]);
      X.tumble(e, 1.5);
      e._thrownAt = performance.now();
      X.sound('throw', { at: e.position });
      X.credit();
    } else e.velocity = [0, 0, 0];
  }
  H.tools.register('gravity-gun', base('gravity-gun', '#f59e0b', {
    tip: `<b>Gravity gun</b> · ${H.touchUi ? 'FIRE' : 'click'} picks up and throws, ${H.touchUi ? 'DROP' : 'R'} drops${H.touchUi ? '' : ', the wheel pulls it closer'}`,
    alt: 'DROP',
    unequip(ctx) { drop(ctx.state, 0); },
    onAlt(ctx) { if (ctx.state.hold) drop(ctx.state, 0); },
    step(dt, ctx) {
      const st = ctx.state;
      if (st.hold && !st.hold.alive) drop(st, 0);
      if (trigger(st) && st.cool <= 0) {
        st.cool = 0.25;
        if (st.hold) { drop(st, Number(ctx.opts.power) || 30); st.vm.kick = 1; G().camera.shake(0.08, 0.1); }
        else {
          const hit = aimHit(Number(ctx.opts.range) || 24);
          const e = hit && hit.entity;
          if (canHold(e)) {
            if (e.physics !== 'dynamic') { e._wasPhysics = e.physics; e.physics = 'dynamic'; }
            if (H.sync) H.sync.claim(e);
            e.held = true; e.velocity = [0, 0, 0];
            if (e._tumble) e._tumble = null;
            st.hold = e;
            st.dist = clamp(hit.distance, 2.2 + Math.max(...e.half), 8);
            X.sound('zap', { at: e.position, volume: 0.5 });
          } else { X.sound('zap', { volume: 0.2 }); }
        }
      }
      const e = st.hold;
      if (!e) return;
      // Hold it in front of you: it goes where you look, bumping into walls on the way, and turns slowly.
      const r = aimRay();
      const want = [r.from[0] + r.dir[0] * st.dist - e.offset[0], r.from[1] + r.dir[1] * st.dist - e.offset[1], r.from[2] + r.dir[2] * st.dist - e.offset[2]];
      for (let ax = 0; ax < 3; ax++) { const cur = [e.x, e.y, e.z][ax]; const d = (want[ax] - cur) * Math.min(1, dt * 14); if (e.physics === 'dynamic') e.sweep(ax, d); else e.node.position[['x', 'y', 'z'][ax]] += d; }
      e.node.rotation.y += dt * 0.6;
      e.velocity = [0, 0, 0];
    },
    frame(dt, ctx) {
      const st = ctx.state;
      const w = I().mouse.wheel;
      if (w && st.hold) st.dist = clamp(st.dist + (w > 0 ? -0.6 : 0.6), 1.8, 14);
      if (st.hold && st.hold.alive) { const p = st.hold.position; beam(st, handPos(st), p, '#ffb347'); st.vm.lit.emissiveColor = new B.Color3(1, 0.7 + Math.random() * 0.2, 0.2); }
    },
  }));

  // ------------------------------------------------------------------ the lasso: tie things to you, to each other, to the world
  // A rope keeps its two ends within `len`: a pull on whichever end can move (a thing you lasso follows you; lasso a
  // post and you swing from it). With Havok it's a real distance joint.
  const ropes = new Set(); // { id, a, b, len, line, by, joint }
  const ropeAction = H.sync.action('mayhem:rope', (d) => makeRope(d));
  const cutAction = H.sync.action('mayhem:cut', (d) => { for (const r of [...ropes]) if (d.ids.includes(r.id)) dropRope(r); });
  function refOf(x) {
    if (!x) return null;
    if (x.isPlayer) return { player: me() };
    if (x.__entity) {
      // Things a script made have no id: give them one (it lives as long as the game runs).
      if (!x.sceneId && x.alive) { x.sceneId = `mh~${Math.random().toString(36).slice(2, 9)}`; x.temporary = true; W().byId.set(x.sceneId, x); }
      return x.sceneId ? { id: x.sceneId } : null;
    }
    return { p: r2v(vec(x)) };
  }
  function resolve(ref) {
    if (!ref) return null;
    if (ref.p) return { point: ref.p };
    if ('player' in ref) {
      if (ref.player === me()) return { e: W().player };
      const pl = H.hooks.net && H.hooks.net.players().find((x) => x.id === ref.player);
      return pl && pl.entity ? { e: pl.entity, remote: true } : null;
    }
    const e = G().entity(ref.id);
    return e ? { e } : null;
  }
  function makeRope(d) {
    const a = resolve(d.a), b = resolve(d.b);
    if (!a || !b) return;
    for (const r of [...ropes]) if (r.id === d.id) dropRope(r);
    const sc = W().scene;
    const pts = Array.from({ length: 12 }, () => B.Vector3.Zero());
    const line = B.MeshBuilder.CreateLines('mh-rope', { points: pts, updatable: true }, sc);
    line.color = hexc('#d9b38c'); line.isPickable = false; line.metadata = { decor: true };
    const rope = { id: d.id, a: d.a, b: d.b, len: d.len, line, pts, by: d.by, joint: null };
    if (havok() && a.e && b.e && !a.e.isPlayer && !b.e.isPlayer) { try { rope.joint = H.physics.joint('distance', a.e, b.e, { min: 0, max: d.len }); } catch {} }
    ropes.add(rope);
    X.sound('rope', { at: a.e ? a.e.position : a.point });
  }
  function dropRope(r) { ropes.delete(r); if (r.line) r.line.dispose(); if (r.joint) try { r.joint.remove(); } catch {} }
  const endPos = (x) => (x.point ? x.point : [x.e.x + x.e.offset[0], x.e.y + x.e.offset[1], x.e.z + x.e.offset[2]]);
  /** Can this end be pulled here? A thing this machine moves, or me. */
  const pullable = (x) => Boolean(x.e && x.e.alive && !x.remote && (x.e.isPlayer || (x.e.physics === 'dynamic' && !x.e.remote && !x.e.held)));
  X.steps.push(() => {
    for (const r of [...ropes]) {
      const a = resolve(r.a), b = resolve(r.b);
      if (!a || !b || (a.e && !a.e.alive) || (b.e && !b.e.alive)) { dropRope(r); continue; }
      if (r.joint) continue;
      const pa = endPos(a), pb = endPos(b);
      const d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const dist = Math.hypot(...d);
      if (dist <= r.len || dist < 1e-4) continue;
      const n = d.map((x) => x / dist), excess = dist - r.len;
      // The player drags things (things don't drag the player, unless the other end can't move: then you swing).
      let wa = pullable(a) ? 1 / (a.e.isPlayer ? 1e6 : a.e.mass) : 0, wb = pullable(b) ? 1 / (b.e.isPlayer ? 1e6 : b.e.mass) : 0;
      if (a.e && a.e.isPlayer && !wb) wa = 1;
      if (b.e && b.e.isPlayer && !wa) wb = 1;
      if (!wa && !wb) continue;
      const ka = wa / (wa + wb), kb = wb / (wa + wb);
      const move = (e, s, k) => {
        for (let ax = 0; ax < 3; ax++) e.sweep(ax, n[ax] * excess * k * s);
        const vn = (e.vx * n[0] + e.vy * n[1] + e.vz * n[2]) * s;
        if (vn < 0) { e.vx -= n[0] * vn * s; e.vy -= n[1] * vn * s; e.vz -= n[2] * vn * s; }
        e.wake();
      };
      if (ka > 0.001) move(a.e, 1, ka);
      if (kb > 0.001) move(b.e, -1, kb);
    }
  });
  X.frames.push(() => {
    for (const r of ropes) {
      const a = resolve(r.a), b = resolve(r.b);
      if (!a || !b) continue;
      const pa = endPos(a), pb = endPos(b);
      // The player's end is in their hand.
      if (a.e && a.e === W().player) { pa[1] += 0.3; }
      const dist = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      const sag = Math.max(0, r.len - dist) * 0.45 + 0.05;
      for (let i = 0; i < r.pts.length; i++) {
        const t = i / (r.pts.length - 1);
        r.pts[i].set(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t - Math.sin(Math.PI * t) * sag, pa[2] + (pb[2] - pa[2]) * t);
      }
      B.MeshBuilder.CreateLines('mh-rope', { points: r.pts, instance: r.line });
    }
  });
  /** Ties two things (or a thing and a point) together with a rope of `len` meters. Scripts: game.mayhem.rope(a, b). */
  X.rope = (a, b, len) => {
    const ra = refOf(a), rb = refOf(b);
    if (!ra || !rb) return null;
    const pa = a.__entity ? a.position : vec(a), pb = b.__entity ? b.position : vec(b);
    const d = { id: `rope${Math.random().toString(36).slice(2, 7)}`, a: ra, b: rb, len: r2(Number(len) || Math.max(1.5, Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]))), by: me() };
    ropeAction(d);
    return d.id;
  };
  X.cutRopes = (all = false) => { const ids = [...ropes].filter((r) => all || r.by === me()).map((r) => r.id); if (ids.length) cutAction({ ids }); return ids.length; };
  H.tools.register('lasso', base('lasso', '#d9b38c', {
    tip: `<b>Lasso</b> · ${H.touchUi ? 'FIRE' : 'click'} ropes a thing to you, again ties it to what you aim at, ${H.touchUi ? 'CUT' : 'R'} cuts the ropes`,
    alt: 'CUT',
    step(dt, ctx) {
      const st = ctx.state;
      if (!(trigger(st) && st.cool <= 0)) return;
      st.cool = 0.3; st.vm.kick = 1;
      const range = Number(ctx.opts.range) || 30;
      const hit = aimHit(range);
      if (!hit) { tip('Nothing in reach of the rope', 1.2); return; }
      const p = W().player;
      const leash = [...ropes].find((r) => r.by === me() && r.a && 'player' in r.a && r.a.player === me());
      const target = hit.entity && hit.entity.alive && hit.entity.kind !== 'plane' && Math.max(...hit.entity.size) < 30 ? hit.entity : null;
      if (leash) {
        // Tie what you're holding to this: a thing, or the spot you aim at.
        const held = resolve(leash.b);
        if (target && held && held.e === target) return;
        const ref = target ? refOf(target) : { p: r2v(hit.point) };
        if (!ref) return;
        cutAction({ ids: [leash.id] });
        const from = held ? endPos(held) : p.position;
        const to = target ? target.position : hit.point;
        ropeAction({ id: `rope${Math.random().toString(36).slice(2, 7)}`, a: ref, b: leash.b, len: r2(Math.max(1.2, Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) * 0.9)), by: me() });
        tip('Tied', 1);
      } else {
        const ref = target ? refOf(target) : { p: r2v(hit.point) };
        if (!ref) { tip('That one can’t be roped (it isn’t in the world)', 1.4); return; }
        const mine = [...ropes].filter((r) => r.by === me());
        if (mine.length >= (Number(ctx.opts.max) || 8)) cutAction({ ids: [mine[0].id] });
        ropeAction({ id: `rope${Math.random().toString(36).slice(2, 7)}`, a: { player: me() }, b: ref, len: r2(Math.max(1.5, Math.min(hit.distance, Number(ctx.opts.length) || hit.distance))), by: me() });
        if (target && target.data && target.data.critter) X.panic(target, p.position);
      }
      X.credit();
    },
    onAlt() { const n = X.cutRopes(); tip(n ? 'Cut' : 'No ropes to cut', 0.8); },
  }));

  // ------------------------------------------------------------------ fire: the flamethrower and matches
  function flameSystem(n = 260) {
    const sc = W().scene;
    const ps = new B.ParticleSystem('mh-flame', n, sc);
    ps.particleTexture = W().dot;
    ps.emitter = B.Vector3.Zero();
    ps.minEmitBox = ps.maxEmitBox = B.Vector3.Zero();
    ps.color1 = new B.Color4(1, 0.8, 0.3, 1); ps.color2 = new B.Color4(1, 0.35, 0.05, 1); ps.colorDead = new B.Color4(0.2, 0.2, 0.2, 0);
    ps.minSize = 0.15; ps.maxSize = 0.4; ps.addSizeGradient(0, 0.4); ps.addSizeGradient(1, 3);
    ps.minLifeTime = 0.25; ps.maxLifeTime = 0.5;
    ps.emitRate = 0;
    ps.minEmitPower = 10; ps.maxEmitPower = 14;
    ps.gravity = new B.Vector3(0, 4, 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    ps.start();
    return ps;
  }
  const flameAction = H.sync.action('mayhem:flame', (d) => { if (d.by === me()) return; if (d.on) remoteFlames.add(d.by); else remoteFlames.delete(d.by); });
  const remoteFlames = new Set();
  const remoteFlamePs = new Map();
  X.frames.push(() => {
    // Other players' flamethrowers: flames from their avatar, the way they face.
    const players = H.hooks.net ? H.hooks.net.players() : [];
    for (const [id, ps] of remoteFlamePs) if (!remoteFlames.has(id)) { ps.dispose(); remoteFlamePs.delete(id); }
    for (const id of remoteFlames) {
      const pl = players.find((x) => x.id === id);
      if (!pl || !pl.entity) continue;
      let ps = remoteFlamePs.get(id);
      if (!ps) { ps = flameSystem(160); ps.emitRate = 160; remoteFlamePs.set(id, ps); }
      const e = pl.entity, f = e.forward;
      ps.emitter = new B.Vector3(e.x + f.x * 0.6, e.y + 0.4, e.z + f.z * 0.6);
      ps.direction1 = new B.Vector3(f.x - 0.08, 0.02, f.z - 0.08); ps.direction2 = new B.Vector3(f.x + 0.08, 0.1, f.z + 0.08);
    }
  });
  /** Burns what's in the flame: things along the aim up to `reach` (or the first wall). */
  function burnAlong(reach, dmg) {
    const r = aimRay();
    const hit = G().raycast(r.from, r.dir, reach, { ignore: W().player });
    const end = hit ? hit.distance : reach;
    const touched = new Set();
    if (hit && hit.entity) touched.add(hit.entity);
    for (let s = 1.5; s < end; s += 1.5) {
      const at = [r.from[0] + r.dir[0] * s, r.from[1] + r.dir[1] * s, r.from[2] + r.dir[2] * s];
      for (const e of H.physics.overlap(H.physics.shapes.sphere(0.4 + s * 0.12), at, { ignore: W().player })) touched.add(e);
    }
    for (const e of touched) {
      if (e.isPlayer) continue;
      X.ignite(e);
      if (dmg && (e.hp !== undefined || e.remotePlayer)) G().damage(e, dmg, W().player);
    }
    return touched.size;
  }
  H.tools.register('flamethrower', base('flamethrower', '#ff8c1a', {
    tip: `<b>Flamethrower</b> · hold ${H.touchUi ? 'FIRE' : 'the mouse'}: things catch fire, burn and spread it`,
    equip(ctx) { ctx.state.ps = flameSystem(); ctx.state.tick = 0; ctx.state.on = false; },
    unequip(ctx) { if (ctx.state.ps) ctx.state.ps.dispose(); if (ctx.state.on) flameAction({ on: false, by: me() }); },
    step(dt, ctx) {
      const st = ctx.state;
      const on = fireHeld() && !(H.water && H.water.inWater && (() => { try { return H.water.inWater(handPos(st)); } catch { return false; } })());
      if (on !== st.on) { st.on = on; if (online()) flameAction({ on, by: me() }); }
      st._down = on;
      if (!on) return;
      st.tick -= dt;
      if (st.tick <= 0) { st.tick = 0.12; burnAlong(Number(ctx.opts.reach) || 8, Number(ctx.opts.damage ?? 3)); X.sound('fire', { volume: 0.5 }); X.credit(); }
    },
    frame(dt, ctx) {
      const st = ctx.state;
      if (!st.ps) return;
      const r = aimRay();
      st.ps.emitter = new B.Vector3(...handPos(st, 0.8));
      const d = new B.Vector3(...r.dir);
      st.ps.direction1 = d.add(new B.Vector3(-0.07, -0.05, -0.07)); st.ps.direction2 = d.add(new B.Vector3(0.07, 0.08, 0.07));
      st.ps.emitRate = st.on ? (H.mayhem.quality > 1 ? 120 : 320) : 0;
      if (st.on) st.vm.kick = 0.2 + Math.random() * 0.15;
    },
  }));
  H.tools.register('matches', base('matches', '#ffd166', {
    tip: `<b>Matches</b> · ${H.touchUi ? 'FIRE' : 'click'} lights what's in front of you`,
    equip(ctx) {
      const sc = W().scene;
      const ps = new B.ParticleSystem('mh-match', 30, sc);
      ps.particleTexture = W().dot; ps.emitter = ctx.state.vm.muzzle; ps.color1 = new B.Color4(1, 0.8, 0.3, 1); ps.color2 = new B.Color4(1, 0.4, 0.1, 1); ps.colorDead = new B.Color4(0, 0, 0, 0);
      ps.minSize = 0.02; ps.maxSize = 0.05; ps.minLifeTime = 0.1; ps.maxLifeTime = 0.25; ps.emitRate = 0; ps.direction1 = new B.Vector3(0, 1, 0); ps.direction2 = new B.Vector3(0, 1, 0); ps.minEmitPower = 0.1; ps.maxEmitPower = 0.3;
      ps.blendMode = B.ParticleSystem.BLENDMODE_ADD; ps.renderingGroupId = 1; ps.start();
      ctx.state.ps = ps;
    },
    unequip(ctx) { if (ctx.state.ps) ctx.state.ps.dispose(); },
    step(dt, ctx) {
      const st = ctx.state;
      if (st.lit > 0) { st.lit -= dt; if (st.lit <= 0 && st.ps) st.ps.emitRate = 0; }
      if (!(trigger(st) && st.cool <= 0)) return;
      st.cool = 0.5; st.lit = 1.2; if (st.ps) st.ps.emitRate = 60;
      const hit = aimHit(Number(ctx.opts.reach) || 3.5);
      if (hit && hit.entity && X.ignite(hit.entity)) { tip(`${hit.entity.name || 'It'} is on fire`, 1.2); X.credit(); }
      else tip(hit && hit.entity ? 'That won’t burn' : 'Nothing close enough to light', 1.2);
      X.sound('fire', { volume: 0.4 });
    },
  }));
})();
