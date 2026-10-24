// Gameplay parts any game can use without writing code: health, weapons, enemies that think, pickups and race gates.
// They are behaviors and player settings (WORLD.md), so a builder (or the assistant) makes a shooter by giving things
// { "use": "enemy" } and the player { "weapon": "rifle" }, the way the Overseer games are made.
//   - health:  { "use": "health", "hp": 100 }: it can be hurt and destroyed (and come back after `respawn` seconds)
//   - enemy:   sees players (line of sight), chases, keeps its distance, strafes, shoots, retreats when hurt, searches
//   - pickup:  { "use": "pickup", "gives": "health" | "ammo" | "weapon", "amount": 25, "weapon": "shotgun" }
//   - gate:    a ring to fly or run through, in order (data.next), for races
//   - weapons: config.player.weapon "blaster" | "rifle" | "shotgun" | "launcher" (or { type, damage, rate, ammo, ... })
// Playing together: the host (or whoever owns a thing) runs its enemies; shots, hits and deaths are sent to the others.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const RAD = Math.PI / 180;
  const def = (names, d) => { for (const n of [].concat(names)) H.behavior(n, d); };
  const hexc = (c, f = '#ffffff') => B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(String(c)) ? c : f);

  // ------------------------------------------------------------------ health: anything can be hurt and destroyed
  /** The engine's damage for things (players are handled by the runtime). Returns true if it had health. */
  H.hooks.damage = (e, amount, from) => {
    if (!e.alive) return false;
    if (e.remote && e.sceneId) { G().net.send('_dmg', { id: e.sceneId, amount }); flash(e); return true; }
    if (e.hp === undefined) {
      // No health: a hit still pushes loose things.
      if (e.physics === 'dynamic' && from && from.__entity) { const d = [e.x - from.x, e.z - from.z]; const l = Math.hypot(...d) || 1; e.push([d[0] / l * amount * 0.12, 1.2, d[1] / l * amount * 0.12]); }
      return false;
    }
    e.hp = Math.max(0, e.hp - amount);
    e._hurtAt = performance.now();
    flash(e);
    G().emit('hurt', { entity: e, amount, from });
    if (e.hp <= 0) die(e, from);
    return true;
  };
  function flash(e) {
    const m = e.ownMaterial ? e.ownMaterial() : e._mat;
    if (!m || !m.emissiveColor) return;
    if (!e._baseEmissive) e._baseEmissive = m.emissiveColor.clone();
    m.emissiveColor = new B.Color3(1, 0.25, 0.2);
    clearTimeout(e._flashT);
    e._flashT = setTimeout(() => { if (e.alive && m) m.emissiveColor = e._baseEmissive.clone(); }, 90);
  }
  function die(e, by) {
    const g = G();
    g.burst([e.x, e.y, e.z], { color: e.color || '#ff6040', count: 46, speed: 6, size: 0.25 });
    g.burst([e.x, e.y, e.z], { color: '#ffffff', count: 16, speed: 3, size: 0.12 });
    g.emit('death', { entity: e, by });
    if (by && by === g.player) g.emit('kill', { entity: e });
    if (e.sceneId && e.temporary) g.net.send('_dead', { id: e.sceneId });
    const respawn = e._respawn || 0;
    if (respawn > 0 && !e.temporary) {
      e.visible = false; e.ghost = true;
      setTimeout(() => { if (!e.alive) return; e.hp = e.maxHp; e.visible = true; e.ghost = false; if (e.home) e.position = e.home.position; }, respawn * 1000);
    } else if (e.sceneId && !e.temporary) { e.visible = false; e.ghost = true; e.hp = 0; e.dead = true; }
    else e.destroy();
  }
  def(['health', 'hp', 'destructible'], {
    title: 'Can be destroyed', says: (o) => `has ${o.hp} health${o.respawn ? `, comes back after ${o.respawn} s` : ''}`,
    defaults: { hp: 100, respawn: 0 },
    start(e, o) { e.maxHp = e.hp = Number(o.hp) || 100; e._respawn = Number(o.respawn) || 0; },
  });

  // ------------------------------------------------------------------ weapons
  const WEAPONS = {
    blaster: { damage: 20, rate: 4, ammo: 24, reload: 1.1, range: 90, spread: 0.008, pellets: 1, color: '#4ad8ff', kind: 'hitscan', kick: 0.05 },
    rifle: { damage: 13, rate: 10, ammo: 36, reload: 1.5, range: 120, spread: 0.014, pellets: 1, color: '#ffd24a', kind: 'hitscan', kick: 0.035 },
    shotgun: { damage: 9, rate: 1.3, ammo: 8, reload: 1.8, range: 35, spread: 0.08, pellets: 9, color: '#ff8a3d', kind: 'hitscan', kick: 0.12 },
    launcher: { damage: 70, rate: 0.9, ammo: 6, reload: 2.2, range: 120, spread: 0.004, pellets: 1, color: '#ff4ad8', kind: 'rocket', speed: 30, radius: 4.5, kick: 0.16 },
  };
  /** A weapon's settings from a name or an object ({ type, ...changes }). */
  function weaponOf(w) {
    if (!w) return null;
    const o = typeof w === 'string' ? { type: w } : w;
    const base = WEAPONS[o.type] || WEAPONS.blaster;
    return { ...base, ...o, type: WEAPONS[o.type] ? o.type : 'blaster' };
  }
  H.weapons = WEAPONS;

  const gun = { spec: null, mesh: null, mag: 0, reloading: 0, cool: 0, kick: 0, bob: 0, hud: null };
  /** The gun in your hands: a few shapes and a glowing strip, held in front of the camera. */
  function buildViewModel(w) {
    const sc = W().scene;
    if (gun.mesh) gun.mesh.dispose();
    const root = new B.TransformNode('viewmodel', sc);
    const dark = new B.StandardMaterial('vm', sc); dark.diffuseColor = new B.Color3(0.12, 0.13, 0.17); dark.specularColor = new B.Color3(0.4, 0.4, 0.45);
    const lit = new B.StandardMaterial('vm-lit', sc); lit.emissiveColor = hexc(w.color).scale(0.75); lit.disableLighting = true;
    const part = (m, mat, x, y, z) => { m.material = mat; m.parent = root; m.position.set(x, y, z); m.isPickable = false; m.metadata = { decor: true }; m.renderingGroupId = 1; return m; };
    const long = w.type === 'rifle' || w.type === 'launcher';
    part(B.MeshBuilder.CreateBox('vm-body', { width: 0.11, height: 0.13, depth: long ? 0.62 : 0.44 }, sc), dark, 0, 0, 0);
    part(B.MeshBuilder.CreateBox('vm-grip', { width: 0.08, height: 0.18, depth: 0.09 }, sc), dark, 0, -0.13, -0.1).rotation.x = 0.3;
    part(B.MeshBuilder.CreateCylinder('vm-barrel', { diameter: w.type === 'launcher' ? 0.12 : w.type === 'shotgun' ? 0.07 : 0.045, height: 0.34, tessellation: 12 }, sc), dark, 0, 0.02, long ? 0.42 : 0.32).rotation.x = Math.PI / 2;
    part(B.MeshBuilder.CreateBox('vm-strip', { width: 0.115, height: 0.025, depth: long ? 0.5 : 0.34 }, sc), lit, 0, 0.05, 0.02);
    part(B.MeshBuilder.CreateBox('vm-sight', { width: 0.03, height: 0.04, depth: 0.08 }, sc), lit, 0, 0.09, -0.1);
    const muzzle = part(B.MeshBuilder.CreateSphere('vm-flash', { diameter: 0.16, segments: 8 }, sc), lit, 0, 0.02, long ? 0.62 : 0.52);
    muzzle.visibility = 0;
    sc.setRenderingAutoClearDepthStencil(1, true); // drawn over the world, so it never pokes into walls
    gun.mesh = root; gun.muzzle = muzzle; gun.spec = w;
  }
  function hud() {
    if (gun.hud && gun.hud.isConnected) return gun.hud;
    const el = document.createElement('div');
    el.className = 'wp-hud';
    el.innerHTML = '<div class="wp-cross"><i></i><i></i><i></i><i></i></div><div class="wp-ammo"><b>0</b><span>/ 0</span><em></em></div><div class="wp-hp"><div class="wp-hp-bar"><i></i></div><span>100</span></div><div class="wp-hit"></div>';
    document.getElementById('ui').appendChild(el);
    gun.hud = el;
    return el;
  }
  /** The weapon HUD: ammo, reload, health. */
  function drawHud() {
    const w = gun.spec, p = W() && W().player;
    const el = hud();
    el.hidden = !w;
    if (!w || !p) return;
    el.querySelector('.wp-ammo b').textContent = gun.reloading > 0 ? '··' : gun.mag;
    el.querySelector('.wp-ammo span').textContent = `/ ${gun.reserve}`;
    el.querySelector('.wp-ammo em').style.width = gun.reloading > 0 ? `${(1 - gun.reloading / w.reload) * 100}%` : '0';
    el.querySelector('.wp-hp-bar i').style.width = `${Math.max(0, p.health)}%`;
    el.querySelector('.wp-hp span').textContent = Math.ceil(p.health);
    el.classList.toggle('low', p.health < 30);
  }
  function startReload() {
    const w = gun.spec;
    if (!w || gun.reloading > 0 || gun.mag >= w.ammo || gun.reserve <= 0) return;
    gun.reloading = w.reload;
  }
  /** One trigger pull: pellets with spread, from the camera, hitting the first thing in the way. */
  function fire() {
    const w = gun.spec, g = G(), sc = W().scene, cam = sc.activeCamera, p = g.player;
    if (!w || gun.reloading > 0) return;
    if (gun.mag <= 0) { startReload(); return; }
    gun.mag--; gun.cool = 1 / w.rate; gun.kick = 1;
    const from = gun.muzzle ? gun.muzzle.getAbsolutePosition().clone() : cam.position.clone();
    if (gun.muzzle) { gun.muzzle.visibility = 1; gun.muzzle.scaling.setAll(0.8 + Math.random() * 0.6); setTimeout(() => { if (gun.muzzle) gun.muzzle.visibility = 0; }, 45); }
    g.camera.shake(w.kick * 0.6, 0.06);
    const dir0 = cam.getDirection(B.Axis.Z);
    if (w.kind === 'rocket') { rocket(from, dir0, w, p); g.net.send('_rocket', { a: v3(from), d: v3(dir0), w: { speed: w.speed, color: w.color } }); return; }
    for (let i = 0; i < w.pellets; i++) {
      const d = dir0.add(new B.Vector3((Math.random() - 0.5) * 2 * w.spread, (Math.random() - 0.5) * 2 * w.spread, (Math.random() - 0.5) * 2 * w.spread)).normalize();
      const hit = g.raycast([cam.position.x, cam.position.y, cam.position.z], [d.x, d.y, d.z], w.range, { ignore: p, all: false });
      const to = hit ? new B.Vector3(...hit.point) : cam.position.add(d.scale(w.range));
      tracer(from, to, w.color);
      g.net.send('_shot', { a: v3(from), b: v3(to), c: w.color });
      if (hit) { impact(to, w.color); if (hit.entity) { g.damage(hit.entity, w.damage, p); hitMarker(hit.entity); } }
    }
    if (gun.mag === 0) setTimeout(startReload, 250);
  }
  const v3 = (v) => [Math.round(v.x * 100) / 100, Math.round(v.y * 100) / 100, Math.round(v.z * 100) / 100];
  function hitMarker(e) {
    if (e.hp === undefined && !e.isPlayer) return;
    const el = hud().querySelector('.wp-hit');
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }
  /** A streak of light from the gun to what it hit. */
  function tracer(a, b, color) {
    const sc = W().scene;
    const len = B.Vector3.Distance(a, b);
    if (len < 0.05) return;
    const t = B.MeshBuilder.CreateCylinder('tracer', { diameter: 0.035, height: len, tessellation: 6 }, sc);
    const m = new B.StandardMaterial('tracer', sc); m.emissiveColor = hexc(color); m.disableLighting = true; m.alpha = 0.9;
    t.material = m; t.isPickable = false; t.metadata = { decor: true };
    t.position = a.add(b).scale(0.5);
    const dir = b.subtract(a).normalize();
    const axis = B.Vector3.Cross(B.Axis.Y, dir);
    const ang = Math.acos(Math.max(-1, Math.min(1, B.Vector3.Dot(B.Axis.Y, dir))));
    if (axis.length() > 1e-6) t.rotationQuaternion = B.Quaternion.RotationAxis(axis.normalize(), ang);
    const start = performance.now();
    const obs = sc.onBeforeRenderObservable.add(() => { const k = (performance.now() - start) / 110; m.alpha = 0.9 * (1 - k); t.scaling.x = t.scaling.z = 1 - k * 0.6; if (k >= 1) { sc.onBeforeRenderObservable.remove(obs); t.dispose(); } });
  }
  function impact(at, color) { G().burst([at.x, at.y, at.z], { color, count: 10, speed: 3, size: 0.1, life: 0.35 }); }
  /** A rocket: flies, and blows up on the first thing it touches (or after a few seconds), hurting and pushing around it. */
  function rocket(from, dir, w, owner, remote = false) {
    const g = G(), sc = W().scene;
    const r = B.MeshBuilder.CreateSphere('rocket', { diameter: 0.22, segments: 8 }, sc);
    const m = new B.StandardMaterial('rocket', sc); m.emissiveColor = hexc(w.color); m.disableLighting = true; r.material = m; r.isPickable = false; r.metadata = { decor: true };
    r.position = from.clone();
    const v = dir.scale(w.speed || 30);
    let life = 0;
    const obs = sc.onBeforeRenderObservable.add(() => {
      const dt = sc.getEngine().getDeltaTime() / 1000;
      life += dt;
      const step = v.scale(dt);
      const ray = new B.Ray(r.position, step.normalizeToNew(), step.length() + 0.15);
      const hit = sc.pickWithRay(ray, (mm) => { const en = H.entityOf(mm); return Boolean(en && en.alive && en !== owner && en.solid !== false && !(mm.metadata && mm.metadata.decor) && (en.physics !== 'none' || en.hp !== undefined)); });
      if ((hit && hit.hit) || life > 4) {
        sc.onBeforeRenderObservable.remove(obs);
        const at = hit && hit.hit ? hit.pickedPoint : r.position;
        r.dispose();
        boom(at, w, owner, remote);
        return;
      }
      r.position.addInPlace(step);
      if (Math.random() < 0.7) g.burst([r.position.x, r.position.y, r.position.z], { color: '#ffb070', count: 2, speed: 0.5, size: 0.12, life: 0.3 });
    });
  }
  function boom(at, w, owner, remote) {
    const g = G();
    g.burst([at.x, at.y, at.z], { color: w.color || '#ff4ad8', count: 60, speed: 9, size: 0.35, life: 0.7 });
    g.burst([at.x, at.y, at.z], { color: '#fff2c0', count: 30, speed: 5, size: 0.2, life: 0.4 });
    const p = g.player;
    if (p && B.Vector3.Distance(at, new B.Vector3(p.x, p.y, p.z)) < (w.radius || 4.5) + 3) g.camera.shake(0.35, 0.3);
    if (remote) return;
    // Real pushes (mass-aware with Havok) and damage that falls off with distance: H.physics.explode.
    // Damage here (the one who fired gets the kills); the push is the host's, for everyone (H.sync.explode).
    // (One 'explosion' event per player: H.sync.explode announces it; the damage-only call doesn't.)
    H.physics.explode([at.x, at.y, at.z], { radius: w.radius || 4.5, force: 0, damage: w.damage, owner, push: false, event: false });
    H.sync.explode([at.x, at.y, at.z], { radius: w.radius || 4.5, force: 14, damage: w.damage || 0, info: { weapon: 'launcher' } });
  }

  // The guns are tools (H.tools): config.player.weapon / tool "rifle", or { "type": "rifle", ...changes }.
  // Firing and reloading every step, the gun's sway and the HUD every frame.
  const gunTool = (type) => ({
    title: { blaster: 'Blaster', rifle: 'Rifle', shotgun: 'Shotgun', launcher: 'Rocket launcher' }[type] || type,
    kind: 'weapon',
    equip(ctx) {
      const w = weaponOf({ ...ctx.opts, type });
      buildViewModel(w);
      gun.mag = w.ammo; gun.reserve = w.ammo * 3; gun.reloading = 0; gun.cool = 0; gun.kick = 0;
      drawHud();
    },
    unequip() { if (gun.mesh) { gun.mesh.dispose(); gun.mesh = null; } gun.spec = null; gun.muzzle = null; if (gun.hud) gun.hud.hidden = true; },
    step(dt) {
      const w = gun.spec, input = H.input;
      if (!w) return;
      if (gun.cool > 0) gun.cool -= dt;
      if (gun.reloading > 0) {
        gun.reloading -= dt;
        if (gun.reloading <= 0) { const take = Math.min(w.ammo - gun.mag, gun.reserve); gun.mag += take; gun.reserve -= take; gun.reloading = 0; }
      }
      if (input.held.has('r')) startReload();
      const trigger = input.mouse.down && (input.mouse.locked || input.touchUi || (W().player && W().player.mouse === 'free'));
      if (trigger && gun.cool <= 0 && !W().paused) fire();
    },
    frame(dt) {
      drawHud();
      const w = W();
      if (!gun.mesh || !w) return;
      const cam = w.scene.activeCamera;
      gun.mesh.parent = cam;
      gun.mesh.setEnabled(w.player && w.player._view === 'first');
      const p = w.player;
      const moving = p && Math.hypot(p.vx, p.vz) > 0.5 && p.grounded;
      gun.bob += dt * (moving ? 9 : 2);
      gun.kick = Math.max(0, gun.kick - dt * 9);
      const sway = moving ? 0.012 : 0.003;
      const rl = gun.reloading > 0 && gun.spec ? Math.sin(Math.PI * (1 - gun.reloading / gun.spec.reload)) : 0;
      gun.mesh.scaling.setAll(0.62);
      gun.mesh.position.set(0.21 + Math.cos(gun.bob) * sway, -0.19 + Math.abs(Math.sin(gun.bob)) * sway - rl * 0.14, 0.5 - gun.kick * 0.06);
      gun.mesh.rotation.set(-gun.kick * 0.18 + rl * 0.6, -0.05, rl * 0.3);
    },
  });
  for (const type of Object.keys(WEAPONS)) H.tools.register(type, gunTool(type));

  // ------------------------------------------------------------------ enemies that think
  /** The nearest player it can actually see (nothing solid in between), within sight. */
  function seen(e, sight) {
    const g = G();
    let best = null, bd = Infinity;
    for (const t of g.all('player')) {
      if (!t.alive || !t.visible || t.ghost) continue;
      const d = e.distanceTo(t);
      if (d > sight || d >= bd) continue;
      if (blocked(e, t, d)) continue;
      best = t; bd = d;
    }
    return best;
  }
  /** Something solid between an enemy's eyes and a target (the player's own body isn't hit by rays: compare distances). */
  function blocked(e, t, d) {
    const g = G();
    const eye = [e.x, e.y + e.half[1] * 0.6, e.z];
    const to = [t.x - eye[0], t.y + 0.4 - eye[1], t.z - eye[2]];
    const hit = g.raycast(eye, to, d + 0.5, { ignore: e });
    return Boolean(hit && hit.entity && hit.entity !== t && hit.distance < d - 0.5);
  }
  def(['enemy', 'bot', 'monster'], {
    title: 'An enemy', says: (o) => `an enemy: sees ${o.sight} m, ${o.melee ? 'hits up close' : `shoots from ${o.range} m`}, ${o.hp} health`,
    defaults: { hp: 60, speed: 3.4, sight: 30, range: 14, damage: 7, rate: 1.4, accuracy: 0.7, melee: false, color: '#ff3b3b', respawn: 0 },
    start(e, o, s) {
      if (e.hp === undefined) { e.maxHp = e.hp = Number(o.hp) || 60; e._respawn = Number(o.respawn) || 0; }
      s.state = 'idle'; s.t = 0; s.cool = 1 + Math.random(); s.strafe = Math.random() < 0.5 ? 1 : -1; s.flip = 2; s.home = e.position;
      if (e.physics !== 'dynamic') e.physics = 'dynamic';
      // An eye that says what it's doing: green looking around, amber noticed you, red fighting.
      const eye = B.MeshBuilder.CreateBox('eye', { width: Math.min(0.5, e.half[0] * 1.5), height: 0.1, depth: 0.08 }, W().scene);
      const m = new B.StandardMaterial('eye', W().scene); m.disableLighting = true; m.emissiveColor = hexc('#3dff8a');
      eye.material = m; eye.parent = e.node; eye.position.set(0, e.half[1] * 0.55, e.half[2] + 0.02); eye.isPickable = false; eye.metadata = { decor: true };
      s.eye = m;
    },
    update(e, dt, o, s, g) {
      if (e.remote || e.dead || g.mode === 'build' && !g.state._botsInBuild) { if (!e.remote && e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0); return; }
      s.t += dt; s.cool -= dt; s.flip -= dt; s.look = (s.look || 0) - dt;
      if (s.look <= 0) { s.look = 0.2; s.target = seen(e, o.sight); }
      const t = s.target;
      const hurt = e.hp < e.maxHp * 0.3;
      if (t) { s.last = t.position; s.lost = 0; if (s.state === 'idle' || s.state === 'search') { s.state = 'alert'; s.t = 0; } }
      else if (s.state === 'attack' || s.state === 'alert' || s.state === 'retreat') { s.lost = (s.lost || 0) + dt; if (s.lost > 3) { s.state = 'search'; s.t = 0; } }
      if (s.state === 'alert' && s.t > 0.45) s.state = hurt && t ? 'retreat' : 'attack';
      if (s.state === 'attack' && hurt && Math.random() < dt * 0.4) { s.state = 'retreat'; s.t = 0; }
      if (s.state === 'retreat' && s.t > 2.5) s.state = 'attack';
      if (s.state === 'search' && s.t > 6) s.state = 'idle';
      s.eye.emissiveColor = hexc(s.state === 'idle' || s.state === 'search' ? '#3dff8a' : s.state === 'alert' ? '#ffc23d' : '#ff3b3b');
      let dir = { x: 0, z: 0 }, speed = o.speed;
      if (s.state === 'idle') {
        // Wander near home.
        if (!s.goal || s.t > 5 || Math.hypot(s.goal[0] - e.x, s.goal[1] - e.z) < 0.6) { s.goal = [s.home[0] + g.random(-6, 6), s.home[2] + g.random(-6, 6)]; s.t = 0; }
        dir = { x: s.goal[0] - e.x, z: s.goal[1] - e.z }; speed = o.speed * 0.4;
      } else if (s.state === 'search' && s.last) {
        dir = { x: s.last[0] - e.x, z: s.last[2] - e.z }; speed = o.speed * 0.7;
      } else if (t && (s.state === 'attack' || s.state === 'alert')) {
        const d = e.distanceTo(t);
        const to = { x: t.x - e.x, z: t.z - e.z };
        const l = Math.hypot(to.x, to.z) || 1;
        if (o.melee) dir = to;
        else if (d > o.range) dir = to;
        else if (d < o.range * 0.45) dir = { x: -to.x, z: -to.z };
        else { if (s.flip <= 0) { s.strafe *= -1; s.flip = 1.2 + Math.random() * 2; } dir = { x: (-to.z / l) * s.strafe, z: (to.x / l) * s.strafe }; speed = o.speed * 0.7; }
        if (s.state === 'attack' && s.cool <= 0) { s.cool = 1 / o.rate * (0.7 + Math.random() * 0.6); attack(e, t, o, d); }
      } else if (s.state === 'retreat' && s.last) {
        dir = { x: e.x - s.last[0], z: e.z - s.last[2] };
      }
      e.walk(dir, speed);
      if (t && s.state !== 'idle') e.lookAt(t);
      // Stuck against something: hop.
      if (Math.hypot(dir.x, dir.z) > 0.2 && e.grounded && Math.hypot(e.vx, e.vz) > 0.5) { const moved = Math.hypot(e.x - (s.px ?? e.x), e.z - (s.pz ?? e.z)); if (moved < speed * dt * 0.15) e.jump(7); }
      s.px = e.x; s.pz = e.z;
    },
    stop(e, o, s) { if (s.eye) s.eye.dispose(); },
  });
  function attack(e, t, o, d) {
    const g = G();
    if (o.melee) { if (d < 1.8) { g.damage(t, o.damage, e); g.burst(t.position, { color: '#ff3b3b', count: 8 }); } return; }
    const from = new B.Vector3(e.x + e.forward.x * 0.5, e.y + e.half[1] * 0.4, e.z + e.forward.z * 0.5);
    const aim = new B.Vector3(t.x, t.y + 0.4, t.z);
    // Misses on purpose sometimes; harder to hit a player who's moving fast.
    const miss = Math.random() > o.accuracy - Math.min(0.3, Math.hypot(t.vx || 0, t.vz || 0) * 0.03);
    const off = miss ? new B.Vector3(g.random(-1.2, 1.2), g.random(-0.6, 0.9), g.random(-1.2, 1.2)) : B.Vector3.Zero();
    const to = aim.add(off);
    const dir = to.subtract(from).normalize();
    const dist = B.Vector3.Distance(from, to);
    const hit = g.raycast([from.x, from.y, from.z], [dir.x, dir.y, dir.z], dist + 0.5, { ignore: e });
    const wall = hit && hit.entity !== t && hit.distance < dist - 0.4;
    const end = wall ? new B.Vector3(...hit.point) : miss ? from.add(dir.scale(dist + 8)) : to;
    tracer(from, end, o.color);
    g.net.send('_shot', { a: v3(from), b: v3(end), c: o.color });
    if (wall) impact(end, o.color);
    else if (!miss) { impact(end, o.color); g.damage(t, o.damage, e); }
  }

  // ------------------------------------------------------------------ pickups and race gates
  def(['pickup', 'powerup'], {
    title: 'A pickup', says: (o) => (o.gives === 'weapon' ? `gives a ${o.weapon}` : `gives ${o.amount} ${o.gives}`) + (o.respawn ? `, back after ${o.respawn} s` : ''),
    defaults: { gives: 'health', amount: 25, weapon: 'shotgun', respawn: 15 },
    start(e, o, s) { e.ghost = true; s.y = e.home ? e.home.position[1] : e.y; },
    update(e, dt, o, s, g) {
      e.node.rotation.y += dt * 1.6;
      if (!e.held) e.node.position.y = s.y + Math.sin(g.now * 2.2) * 0.12;
      const p = g.player;
      if (!p || !e.visible || g.mode === 'build' || e.distanceTo(p) > 1.4) return;
      if (o.gives === 'health') { if (p.health >= (p.maxHealth || 100)) return; H.hurtPlayer(-Number(o.amount || 25), e); }
      else if (o.gives === 'ammo') { if (!gun.spec) return; gun.reserve += Number(o.amount || 24); }
      else if (o.gives === 'weapon') { p.weapon = o.weapon; }
      e.visible = false;
      g.burst(e.position, { color: e.color || '#34d399', count: 24 });
      g.ui.message(o.gives === 'weapon' ? `Got the ${o.weapon}` : `+${o.amount} ${o.gives}`, 1);
      g.emit('pickup', { entity: e, gives: o.gives });
      if (o.respawn > 0) g.after(o.respawn, () => { if (e.alive) e.visible = true; });
    },
  });
  def(['gate', 'ring'], {
    title: 'A gate to go through', says: (o) => `a gate worth ${o.points} points${o.next ? `, then ${o.next}` : ''}`,
    defaults: { points: 100, next: null },
    update(e, dt, o, s, g) {
      const p = g.player;
      if (!p || s.done) return;
      // Through the ring: close to its middle and to the plane it stands in.
      const n = B.Vector3.TransformNormal(B.Axis.Y, e.node.getWorldMatrix()).normalize();
      const rel = new B.Vector3(p.x - e.x, p.y - e.y, p.z - e.z);
      const along = B.Vector3.Dot(rel, n);
      const across = rel.subtract(n.scale(along)).length();
      const r = Math.max(e.half[0], e.half[1], e.half[2]);
      if (Math.abs(along) < 1.2 && across < r * 0.9) {
        s.done = true;
        g.state.score = (g.state.score || 0) + Number(o.points || 100);
        g.burst(e.position, { color: e.color || '#22d3ee', count: 40, speed: 6 });
        e.opacity = 0.25;
        g.emit('gate', { entity: e, points: o.points });
        const next = o.next && g.entity(o.next);
        if (next && next._mat) { next.emissive = next.color || '#ffffff'; }
      }
    },
  });

  // ------------------------------------------------------------------ playing together: shots, hits, deaths
  H.hooks.world.push({
    enter() {
      const g = G();
      g.net.on('_shot', (d) => { if (d && d.a && d.b) tracer(new B.Vector3(...d.a), new B.Vector3(...d.b), d.c || '#ffffff'); });
      g.net.on('_rocket', (d) => { if (d && d.a) rocket(new B.Vector3(...d.a), new B.Vector3(...d.d), d.w || {}, null, true); });
      g.net.on('_dmg', (d) => { const e = d && g.entity(d.id); if (e && !e.remote) H.hooks.damage(e, Number(d.amount) || 0, null); });
      g.net.on('_hurt', (d) => { if (d && g.net.me && d.to === g.net.me.id) H.hurtPlayer(Number(d.amount) || 0, null); });
      g.net.on('_dead', (d) => { const e = d && g.entity(d.id); if (e) { g.burst(e.position, { color: e.color || '#ff6040', count: 40, speed: 6 }); e.destroy(); } });
      g.net.on('_spawn', (d) => { if (d && d.spec && !g.entity(d.spec.id)) { const c = H.fromSpec(d.spec); c.temporary = true; c.remote = true; } });
    },
  });
  if (H.behaviorMenu) H.behaviorMenu.push(['enemy', 'An enemy'], ['health', 'Can be destroyed'], ['pickup', 'A pickup'], ['gate', 'A gate to go through']);
  H.gameplay = { weaponOf, WEAPONS, get gun() { return gun; } };
})();
