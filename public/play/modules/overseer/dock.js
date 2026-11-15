// The Overseer is a real place: its hull is solid, and a lit docking bay on its side opens into a hangar with a landing
// pad. Fly a rocket or a space ship up, in through the opening, settle on the pad: "Docked". Get out and walk the
// hangar; get back in and fly down. Who is docked is shared online (H.overseer.docked).
// The way in is helped: a ship that flies at the bay gets an approach readout (distance, speed, align, and what to do),
// and a gentle catch (dock-math.js) eases a careful one onto the pad; a climb that fails says so (`ascent-failed`) and
// the Overseer answers (below). `H.cameraAim` frames the planet below and the bay ahead while a rocket or ship climbs.
// The hull and the hangar are static things in the world (their colliders exist wherever you are, so a ship parked
// on the pad stays there for everyone); you only see them up close: from afar the ship is drawn in the sky's far layer.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const G = () => H.game;
  const OV = H.overseer;
  const { clamp, PHONE } = H.sky._;
  const mat = OV._.mat;

  let D = null; // this world's dock: { O, hullE, hangarE, glow, cyan, frame, pad, yaw, ... }

  /** The hangar's numbers, in the bay's own frame (z out of the bay, x across it, y up from the ship's middle). */
  function frameOf(O) {
    const b = O.bay, r = O.r;
    const front = Math.sqrt(Math.max(0, r * r - b.floor * b.floor)) + r * 0.012;
    return { r, yaw: b.yaw, halfW: b.halfW, floor: b.floor, top: b.top, back: front - b.depth, front, apron: r * 0.06, padZ: front - b.depth * 0.42, padR: Math.min(26, b.halfW * 0.42) };
  }
  function boxAt(scene, size, at) { const m = B.MeshBuilder.CreateBox('ov-hangar', { width: size[0], height: size[1], depth: size[2] }, scene); m.position.set(at[0], at[1], at[2]); return m; }

  /** Soft painted metal on the hangar walls when the island material set is on disk (probe first so a miss stays the grey paint). */
  function dressHangarMetal(material, scene) {
    const phone = H.device && H.device.tier === 'phone';
    const alb = `/play/materials/island/metal-albedo${phone ? '-1k' : ''}.webp`;
    const nrm = `/play/materials/island/metal-normal${phone ? '-1k' : ''}.webp`;
    if (typeof Image === 'undefined') return;
    const img = new Image();
    img.onload = () => {
      try {
        const t = new B.Texture(alb, scene, false, true, B.Texture.TRILINEAR_SAMPLINGMODE);
        t.uScale = t.vScale = 4;
        t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE;
        material.diffuseTexture = t;
        material.diffuseColor = new B.Color3(1, 1, 1);
        const b = new B.Texture(nrm, scene, false, true, B.Texture.TRILINEAR_SAMPLINGMODE);
        b.uScale = b.vScale = 4;
        b.wrapU = b.wrapV = B.Texture.WRAP_ADDRESSMODE;
        b.level = 0.55;
        material.bumpTexture = b;
        if (window.__islandMats) window.__islandMats.hangarMetal = true;
      } catch { /* keep the grey paint */ }
    };
    img.onerror = () => { /* Gen art not imported yet */ };
    img.src = alb;
  }

  function build(O, w) {
    const scene = w.scene;
    const f = frameOf(O);
    const c = O.cfg.position;
    // The hull: solid (its exact triangles), with the bay cut out.
    const hullMesh = (function () {
      const segs = PHONE ? 56 : 72;
      const s = B.MeshBuilder.CreateSphere('ov-hull', { diameter: 2 * f.r, segments: segs }, scene);
      const pos = s.getVerticesData(B.VertexBuffer.PositionKind), nor = s.getVerticesData(B.VertexBuffer.NormalKind), uv = s.getVerticesData(B.VertexBuffer.UVKind);
      const idx = s.getIndices(), keep = [];
      const ux = Math.sin(f.yaw), uz = Math.cos(f.yaw);
      const pad = f.r * 0.03;
      for (let i = 0; i < idx.length; i += 3) {
        let cx = 0, cy = 0, cz = 0;
        for (let k = 0; k < 3; k++) { const j = idx[i + k] * 3; cx += pos[j]; cy += pos[j + 1]; cz += pos[j + 2]; }
        cx /= 3; cy /= 3; cz /= 3;
        const along = cx * ux + cz * uz, side = cx * uz - cz * ux;
        if (along > 0 && Math.abs(side) < f.halfW + pad && cy > f.floor - pad && cy < f.top + pad) continue;
        keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      const vd = new B.VertexData();
      vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = keep;
      const m = new B.Mesh('ov-hull', scene);
      vd.applyToMesh(m);
      s.dispose();
      return m;
    })();
    hullMesh.material = O.mats.hull;
    const hullE = new L.Entity(hullMesh, { physics: 'static', name: 'The Overseer', tag: 'overseer', grab: false, friction: 0.8 }, 'overseer');
    hullE.temporary = true; hullE.keep = true; hullE.data.overseer = 'hull';
    L.place(hullE, { position: c, shadow: false });
    H.physics.setShape(hullE, H.physics.shapes.mesh(hullE));
    // The hangar: a floor with an apron out of the opening, walls, a ceiling, the back wall.
    const node = new B.TransformNode('ov-hangar-root', scene);
    const t = 2.5;
    const len = f.front + f.apron - f.back;
    const parts = [
      boxAt(scene, [f.halfW * 2 + 8, t, len], [0, f.floor - t / 2, f.back + len / 2]),                          // floor
      boxAt(scene, [f.halfW * 2 + 8, t, f.front - f.back], [0, f.top + t / 2, (f.front + f.back) / 2]),          // ceiling
      boxAt(scene, [t, f.top - f.floor, f.front - f.back], [-f.halfW - t / 2, (f.top + f.floor) / 2, (f.front + f.back) / 2]),
      boxAt(scene, [t, f.top - f.floor, f.front - f.back], [f.halfW + t / 2, (f.top + f.floor) / 2, (f.front + f.back) / 2]),
      boxAt(scene, [f.halfW * 2, f.top - f.floor, t], [0, (f.top + f.floor) / 2, f.back - t / 2]),              // back wall
    ];
    const hangar = B.Mesh.MergeMeshes(parts, true, true);
    hangar.name = 'ov-hangar';
    hangar.material = mat(scene, 'ov-hangar', { diffuse: new B.Color3(0.36, 0.39, 0.45), spec: new B.Color3(0.2, 0.2, 0.22), power: 32, emissive: new B.Color3(0.07, 0.08, 0.1) });
    // Painted hangar metal from the island PBR set (when Gen files have landed under /play/materials/island/).
    dressHangarMetal(hangar.material, scene);
    hangar.parent = null;
    const hangarE = new L.Entity(hangar, { physics: 'static', name: 'Overseer hangar', tag: 'overseer', grab: false, friction: 0.9 }, 'overseer');
    hangarE.temporary = true; hangarE.keep = true; hangarE.data.overseer = 'hangar';
    L.place(hangarE, { position: c, rotation: [0, f.yaw / L.RAD, 0], shadow: false });
    H.physics.setShape(hangarE, H.physics.shapes.mesh(hangarE));
    // Its lights (decor): warm strips on the ceiling and around the opening, the cyan pad and the guide lights.
    const warm = [], cyan = [];
    for (let i = 0; i < 5; i++) { const z = f.back + 10 + i * (f.front - f.back - 20) / 4; warm.push(boxAt(scene, [f.halfW * 1.6, 0.4, 1.4], [0, f.top - 0.3, z])); }
    for (const s of [-1, 1]) warm.push(boxAt(scene, [1.6, f.top - f.floor, 1.6], [s * (f.halfW - 0.8), (f.top + f.floor) / 2, f.front - 0.6]));
    warm.push(boxAt(scene, [f.halfW * 2, 1.6, 1.6], [0, f.top - 0.8, f.front - 0.6]));
    // Pad markings sit a few cm above the hangar floor; material zOffset keeps them from flickering against it.
    const padRing = B.MeshBuilder.CreateTorus('ov-pad', { diameter: f.padR * 2, thickness: 0.7, tessellation: 64 }, scene);
    padRing.position.set(0, f.floor + 0.1, f.padZ);
    cyan.push(padRing);
    const inner = B.MeshBuilder.CreateTorus('ov-pad', { diameter: f.padR * 1.1, thickness: 0.35, tessellation: 48 }, scene);
    inner.position.set(0, f.floor + 0.1, f.padZ);
    cyan.push(inner);
    cyan.push(boxAt(scene, [0.5, 0.12, f.padR * 1.6], [0, f.floor + 0.09, f.padZ]), boxAt(scene, [f.padR * 1.6, 0.12, 0.5], [0, f.floor + 0.09, f.padZ]));
    for (let i = 0; i < 8; i++) for (const s of [-1, 1]) cyan.push(boxAt(scene, [1, 0.2, 1], [s * (f.halfW - 6), f.floor + 0.12, f.padZ + f.padR + 6 + i * ((f.front + f.apron - f.padZ - f.padR - 8) / 8)]));
    const warmM = B.Mesh.MergeMeshes(warm, true, true), cyanM = B.Mesh.MergeMeshes(cyan, true, true);
    warmM.material = mat(scene, 'ov-light', { emissive: new B.Color3(1, 0.88, 0.66), unlit: true });
    cyanM.material = mat(scene, 'ov-pad', { emissive: L.hex(O.cfg.glow, '#8fd8ff'), unlit: true });
    cyanM.material.zOffset = -2;
    for (const m of [warmM, cyanM]) { m.parent = node; m.isPickable = false; m.metadata = { decor: true, overseer: true }; }
    node.position.set(c[0], c[1], c[2]);
    node.rotation.y = f.yaw;
    for (const m of [hullMesh, hangar]) m.receiveShadows = false;
    const d = { O, f, hullE, hangarE, node, lights: [warmM, cyanM], c, docked: false, landed: false, inside: false };
    d.show = (on) => {
      // (The Observatory, inside the ship, hides the hull and the hangar's look so its windows open on the sky: `hidden`.)
      for (const m of [hullMesh, hangar, warmM, cyanM]) m.layerMask = on && !d.hidden ? 0x0FFFFFFF : 0;
    };
    O.near = d;
    d.show(O.lod === 'near');
    return d;
  }

  /** The bay's turn in the world: its yaw and, in a round world, the frame's turn since it was built. It is read off the
   *  hangar itself (the engine turns every thing when the frame moves), so what is computed here is where the walls are. */
  function turn() {
    const n = D.hangarE && D.hangarE.alive ? D.hangarE.node : null;
    if (n && n.rotationQuaternion) return n.rotationQuaternion;
    if (n) return B.Quaternion.FromEulerAngles(n.rotation.x, n.rotation.y, n.rotation.z);
    return B.Quaternion.RotationAxis(B.Axis.Y, D.f.yaw);
  }
  const rotate = (v, q) => { const r = new B.Vector3(v[0], v[1], v[2]).applyRotationQuaternion(q); return [r.x, r.y, r.z]; };
  /** A direction/velocity in the bay's frame ([across, up, out]; no shift to the ship's middle). */
  function localVec(v) { return rotate(v, turn().conjugate()); }
  /** ...and back out of it. */
  function worldVec(l) { return rotate(l, turn()); }
  /** A point in the bay's frame: [across, up (from the ship's middle), out]. */
  function local(p) {
    if (!D) return null;
    return localVec([p[0] - D.c[0], p[1] - D.c[1], p[2] - D.c[2]]);
  }
  /** A point of the bay's frame in world meters. */
  function pointAt(x, y, z) {
    const w = worldVec([x, y, z]);
    return [D.c[0] + w[0], D.c[1] + w[1], D.c[2] + w[2]];
  }
  /** Inside the hangar (or over its apron)? */
  function inHangar(p) {
    const l = local(p);
    if (!l) return false;
    const f = D.f;
    return Math.abs(l[0]) < f.halfW + 2 && l[1] > f.floor - 2 && l[1] < f.top + 2 && l[2] > f.back - 2 && l[2] < f.front + f.apron + 2;
  }
  function onPad(p) {
    const l = local(p);
    if (!l) return false;
    const f = D.f;
    return Math.hypot(l[0], l[2] - f.padZ) < f.padR + 3 && l[1] > f.floor - 1 && l[1] < f.floor + 8;
  }

  // ------------------------------------------------------------------ who is docked (shared)
  let docked = {}; // id -> name
  const me = () => (H.sync && H.sync.online && H.sync.me ? H.sync.me : 'local');
  const dockAct = H.sync && H.sync.action ? H.sync.action('overseer:dock', (d) => { if (!d || !d.who) return; if (d.on) docked[d.who] = String(d.name || 'Someone').slice(0, 40); else delete docked[d.who]; }) : null;
  if (H.sync && H.sync.state) H.sync.state('overseer:docked', { rate: 1, get: () => ({ list: docked }), set: (st) => { if (st && st.list && typeof st.list === 'object') docked = { ...st.list }; } });
  function setDocked(on) {
    if (!D || D.docked === on) return;
    D.docked = on;
    const name = (W() && W().player && W().player.name) || 'You';
    if (dockAct) dockAct({ who: me(), name, on });
    else if (on) docked[me()] = name; else delete docked[me()];
    if (G()) G().emit(on ? 'docked' : 'undocked', { who: me() });
  }
  function chime() {
    try {
      const ac = H.audio && H.audio.context;
      if (!ac || ac.state !== 'running') return;
      const t0 = ac.currentTime;
      const out = ac.createGain(); out.gain.value = 0.0001; out.connect(H.audio.effects || H.audio.master);
      out.gain.exponentialRampToValueAtTime(0.12, t0 + 0.05); out.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      [523.25, 659.25, 783.99].forEach((fq, i) => { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = fq; o.connect(out); o.start(t0 + i * 0.12); o.stop(t0 + 1.8); });
    } catch { /* no sound */ }
  }

  /** A ship settles on the pad: the Docked moment (once per landing). Flying in and `dockShip` both end here. */
  function settle(veh) {
    if (!D || D.landed) return;
    D.landed = true;
    if (G()) { G().ui.message('Docked', 2.4); G().emit('docked-pad', { vehicle: veh }); }
    chime();
    OV.speak('Welcome aboard.', 'overseer-welcome-aboard.mp3', 3);
  }
  /** Put a ship on the pad, and let it dock as a flown one does (the Docked moment, the
   *  `docked-pad` event the Observatory's lift and the island's journey listen for). For a playtest's setup shortcut and
   *  tests: a player flies in. The player is put on foot beside it when `out` is true. */
  function dockShip(veh, out) {
    if (!D || !veh || !veh.alive) return false;
    const f = D.f;
    const p = W() && W().player;
    if (H.vehicles && H.vehicles.current === veh && H.vehicles.exit) { try { H.vehicles.exit(true); } catch { /* still seated */ } }
    const at = pointAt(0, f.floor + 3, f.padZ);
    veh.position = at;
    veh.velocity = [0, 0, 0];
    D.landed = false;
    settle(veh);
    if (out && p) { const beside = pointAt(7, f.floor + 1.2, f.padZ + 6); p.position = beside; p.velocity = [0, 0, 0]; }
    return true;
  }

  // ------------------------------------------------------------------ each step: inside, landed, docked
  let hudEl = null;
  function hud(on) {
    if (typeof document === 'undefined' || !document.body) return;
    if (!on || H.hooks.codex) { if (hudEl) hudEl.hidden = true; return; }
    if (!hudEl) {
      hudEl = document.createElement('div');
      hudEl.className = 'ov-dock';
      const st = document.createElement('style');
      st.textContent = '.ov-dock{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top));transform:translateX(-50%);padding:7px 16px;border-radius:999px;background:rgba(8,14,26,.62);border:1px solid rgba(143,216,255,.35);color:#dff3ff;font:600 12px/1.3 var(--hud,Rajdhani,Inter,system-ui,sans-serif);letter-spacing:.16em;text-transform:uppercase;pointer-events:none;z-index:7;text-shadow:0 0 10px rgba(120,200,255,.6)}.ov-dock b{color:#8fd8ff}';
      document.head.appendChild(st);
      document.body.appendChild(hudEl);
    }
    const names = Object.values(docked);
    const txt = `The Overseer · ${D && D.hidden ? 'observatory' : 'hangar'}${names.length ? ` · docked: ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` +${names.length - 4}` : ''}` : ''}`;
    if (hudEl.textContent !== txt) hudEl.textContent = txt;
    hudEl.hidden = false;
  }

  // ------------------------------------------------------------------ the approach: readout, catch, failed climbs
  const FLIES = (veh) => Boolean(veh && veh.alive && veh.vehicle && veh.vehicle.def && (veh.vehicle.def.class === 'rocket' || veh.vehicle.def.class === 'ship'));
  const altOf = (y) => (H.planet && H.planet.altitude ? H.planet.altitude(y) : y);
  const DM = () => H.dockMath;
  const trip = { veh: null, max: 0, failed: false, ejectedAt: -99, last: null };
  let apEl = null;
  function approachHud(g, on) {
    if (typeof document === 'undefined' || !document.body) return;
    if (!on || H.hooks.codex) { if (apEl) apEl.hidden = true; return; }
    if (!apEl) {
      apEl = document.createElement('div');
      apEl.className = 'ov-approach';
      const st = document.createElement('style');
      st.textContent = '.ov-approach{position:fixed;left:50%;bottom:max(96px,calc(env(safe-area-inset-bottom) + 84px));transform:translateX(-50%);display:flex;gap:14px;align-items:center;padding:8px 18px;border-radius:14px;background:rgba(8,14,26,.66);border:1px solid rgba(143,216,255,.38);color:#dff3ff;font:600 13px/1.25 var(--hud,Rajdhani,Inter,system-ui,sans-serif);letter-spacing:.06em;pointer-events:none;z-index:7;text-shadow:0 0 10px rgba(120,200,255,.5)}.ov-approach[hidden]{display:none}.ov-approach .c{display:flex;flex-direction:column;align-items:center;min-width:64px}.ov-approach .c i{font:700 10px system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#8fd8ff;font-style:normal}.ov-approach .c b{font-size:17px}.ov-approach .c.bad b{color:#ffb4a2}.ov-approach .c.ok b{color:#b9f5c8}.ov-approach .adv{font-size:13px;color:#fff;max-width:170px}';
      document.head.appendChild(st);
      document.body.appendChild(apEl);
      apEl.cells = {};
      for (const k of ['dist', 'speed', 'align']) { const c = document.createElement('div'); c.className = 'c'; const i = document.createElement('i'); const b = document.createElement('b'); c.appendChild(i); c.appendChild(b); apEl.appendChild(c); apEl.cells[k] = { c, i, b }; }
      apEl.adv = document.createElement('div'); apEl.adv.className = 'adv'; apEl.appendChild(apEl.adv);
    }
    const km = (m) => (m >= 1500 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
    const turn = Math.abs(g.lateral) > 6 ? (g.lateral > 0 ? ' ◀' : ' ▶') : '';
    const put = (k, label, text, cls) => { const x = apEl.cells[k]; x.i.textContent = label; x.b.textContent = text; x.c.className = `c ${cls || ''}`; };
    put('dist', 'Bay', km(g.distance));
    put('speed', 'Speed', `${Math.round(g.speed)} / ${Math.round(g.allowed)} m/s`, g.tooFast ? 'bad' : g.speed > g.allowed ? '' : 'ok');
    put('align', 'Align', `${Math.round(g.align)}°${turn}`, g.speed > 3 && g.align > 25 ? 'bad' : g.align < 12 ? 'ok' : '');
    apEl.adv.textContent = D.catching ? 'The Overseer is guiding you in' : g.advice;
    apEl.hidden = false;
  }
  function ascentFailed(why, veh) {
    if (trip.failed) return;
    trip.failed = true;
    const d = { why, vehicle: veh || null, handled: false, maxAltitude: Math.round(trip.max) };
    if (G()) G().emit('ascent-failed', d);
    // A game that answers sets handled; else the Overseer does, in its voice (a new rocket is the game's to give).
    if (!d.handled) OV.speak(why === 'fuel' ? 'The fire has gone out. Fall back; try again.' : 'Down you come. It is a long way up. Go again.', null, 5);
  }
  /** Each step for the flier: readout, catch, and a failed climb. */
  function approach(w, veh, at, dt) {
    if (!FLIES(veh)) {
      if (trip.veh && (!trip.veh.alive || (trip.veh.vehicle && trip.veh.vehicle.wrecked)) && w.time - trip.ejectedAt > 0 && trip.max > 60) ascentFailed('wrecked', trip.veh);
      if (trip.veh && w.time - trip.ejectedAt > 6) { trip.veh = null; }
      D.gauge = null; D.catching = false; approachHud(null, false);
      return;
    }
    const v = veh.vehicle;
    if (trip.veh !== veh) { trip.veh = veh; trip.max = 0; trip.failed = false; }
    trip.ejectedAt = w.time;
    const l = local(at), vel = [veh.velocity ? veh.velocity[0] : v.vel.x, veh.velocity ? veh.velocity[1] : v.vel.y, veh.velocity ? veh.velocity[2] : v.vel.z];
    const lv = localVec(vel);
    const dm = DM();
    if (!dm) return;
    const alt = altOf(at[1]);
    trip.max = Math.max(trip.max, alt);
    const g = dm.gauge(l, lv, D.f);
    D.gauge = g;
    // The catch (off by H.overseer.assist = false, and not while it is parked on the pad or hurt).
    let catching = false;
    if (OV.assist !== false && !v.wrecked && !D.landed) {
      const gr = Math.abs(Number(w.config && w.config.gravity) || -24);
      const plan = dm.catchPlan(l, lv, D.f, { g: gr });
      if (plan.active && plan.k > 0.02) {
                const a = worldVec(plan.acc);
        const h = Math.min(0.1, dt || 1 / 60);
        // (A push added to the entity's own velocity, as a kick is: it joins the body's, gravity's step and all.)
        veh.vx += a[0] * h; veh.vy += a[1] * h; veh.vz += a[2] * h;
        catching = plan.k > 0.15;
      }
    }
    if (catching && !D.catching && G()) G().emit('bay-catch', { distance: Math.round(g.distance) });
    D.catching = catching;
    // The readout: once the bay is within ~5 km (or always up past the thin air).
    approachHud(g, g.distance < 5000 && !D.inside);
    // A climb that failed.
    if (!trip.failed && !D.inside) {
      if (v.def.class === 'rocket' && v.fuel <= 0.5 && !v.grounded && alt > 80 && v.vel.y < 0) ascentFailed('fuel', veh);
      else if (v.grounded && trip.max > 300 && alt < 30) ascentFailed('fell', veh);
    }
  }
  /** The camera: the planet below, the bay ahead. A point to look toward and how much (0..1), while a rocket or ship climbs. */
  H.cameraAim = (veh) => {
    if (!D || !FLIES(veh) || D.inside) return null;
    const hg = OV.hangar;
    if (!hg) return null;
    const alt = altOf(veh.position[1]);
    const near = D.gauge ? D.gauge.distance : 1e9;
    const k = Math.max(DM() ? DM().smooth(120, 1600, alt) * 0.55 : 0, DM() ? DM().smooth(2500, 300, near) * 0.45 : 0);
    return k > 0.01 ? { point: hg.mouth, k } : null;
  };

  H.hooks.step.push((dt) => {
    const w = W();
    if (!D || !w) return;
    const p = w.player;
    if (!p || !p.alive) { hud(false); return; }
    const veh = H.vehicles && H.vehicles.current;
    const at = veh && veh.alive ? veh.position : p.position;
    const inside = inHangar(at) || Boolean(D.hidden); // (in the Observatory you are still docked: observatory.js)
    D.inside = inside;
    try { approach(w, veh, at, dt); } catch (err) { H.report(err, 'overseer approach'); }
    if (inside !== D.docked) setDocked(inside);
    // The moment: a ship you fly settles on the pad.
    if (veh && veh.alive && veh.vehicle) {
      const v = veh.vehicle;
      const still = v.vel && v.vel.length() < 2.5;
      if (onPad(at) && still && (v.grounded || v.vel.length() < 0.8)) {
        settle(veh);
      } else if (!onPad(at)) D.landed = false;
    } else if (!inside) D.landed = false;
    if ((w.time * 4 | 0) !== (D.hudT | 0)) { D.hudT = w.time * 4; hud(inside); }
  });

  OV.onEnter((O, w) => { D = null; try { D = build(O, w); } catch (err) { H.report(err, 'overseer hangar'); D = null; } });
  OV.onLeave(() => {
    if (!D) return;
    for (const e of [D.hullE, D.hangarE]) if (e && e.alive) e.destroy();
    if (D.node) D.node.dispose();
    D = null;
  });
  OV.onLod((lod) => { if (D) D.show(lod === 'near'); });
  // A round world: the frame moved under you; the hull and hangar (things in the world) went with it, the lights and the
  // hangar's middle follow here.
  if (H.planet && H.planet.frame && H.planet.frame.onRebase) H.planet.frame.onRebase(() => {
    if (!D || !D.O || D.O !== OV.ship) return;
    D.c = D.O.cfg.position;
    D.node.position.set(D.c[0], D.c[1], D.c[2]);
    D.node.rotationQuaternion = H.planet.frame.toLocalQ().multiply(B.Quaternion.RotationAxis(B.Axis.Y, D.f.yaw));
  });
  H.hooks.world.push({ enter() { if (!OV.on) D = null; docked = {}; hud(false); }, leave() { if (D && D.docked) setDocked(false); D = null; hud(false); } });

  Object.defineProperties(OV, Object.getOwnPropertyDescriptors({
    /** Who is docked now: { id: name } (you, as 'local' offline). */
    get docked() { return { ...docked }; },
    /** The hangar: where its pad is (world meters) and whether you are inside. */
    get hangar() {
      if (!D) return null;
      const f = D.f, at = pointAt;
      return { pad: at(0, f.floor, f.padZ), mouth: at(0, f.floor, f.front + f.apron), floor: at(0, f.floor, f.padZ)[1], inside: D.inside, landed: D.landed, yaw: f.yaw, width: f.halfW * 2, height: f.top - f.floor };
    },
    /** The bay's numbers for the Observatory (observatory.js): the ship's middle (world meters), the hangar frame, the node
     *  that follows a round world's frame, and `interior(true)` to hide the hull and hangar's look while inside. */
    get bay() { return D ? { c: D.c.slice(), f: D.f, yaw: D.f.yaw, node: D.node, at: pointAt, vec: localVec, dir: worldVec } : null; },
    interior(on) { if (D) { D.hidden = Boolean(on); D.show(OV.lod === 'near'); } },
    /** The approach readout now (distance, speed, closing, align, lateral, height, allowed, tooFast, state, advice), or null. */
    get approach() { return D && D.gauge ? { ...D.gauge, catching: Boolean(D.catching) } : null; },
    dockShip,
    inHangar, onPad,
  }));
})();
