// The Overseer (H.overseer): the giant sphere-shaped ship high in the sky of every game, and the beams it sends down.
//   - The look: a luminous pearl of white ceramic with thin glowing seams, two slowly turning rings of light, a soft halo,
//     a lit docking bay on its side and the beam emitter at its lowest point. Hazy by day, glowing at night. Far away
//     it is drawn in the sky's far layer (H.sky.bg: a handful of draw calls, nothing in the world is hidden by it);
//     close up (flying to it) the same ship is in the world, with a real hull and hangar (dock.js).
//   - Beams: whatever appears is beamed in. H.overseer.beam(target, opts) sends a shaft of light from the emitter to a
//     spot (a ring on the ground, the thing growing into being); the player spawning, things the assistant and the
//     builder add (scene ops with fx "materialize" / "arrive"), spawn guns and spawnMany (one wide beam for a batch),
//     and Hawkes Gen assets as they arrive all use it. A few at once at most (cheap on phones).
//   - Alive: it reacts (presence, below): the halo brightens and the rings quicken while it speaks (the speech desk's
//     line, for as long as it lasts), the emitter flares before a beam opens, the seams glow stronger at night, a message
//     to it turns its bay toward the player (seen from afar), a long silence is slow breathing, and a low hum rises as the
//     player climbs toward it (silent on the ground; through the background, so a voice ducks it). Same meshes, no new
//     draw calls. game.overseer.presence() samples all of it.
//   - config.overseer: true (the default: every game has it) or false, or { position: [x, y, z], radius, color, glow,
//     intro: "first" | "always" | false, beams: false }. A model asset for the word "overseer" replaces the stand-in
//     hull when J makes one (H.assets.for('overseer')).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const G = () => H.game;
  const { clamp, num, smooth, PHONE } = H.sky._;
  const RAD = Math.PI / 180;

  const DEFAULTS = { position: [-3000, 4200, 9700], radius: 1400, color: '#eef1f6', glow: '#8fd8ff', intro: 'first', beams: true };
  /** config.overseer as an object (null: this game has none). */
  function read(cfg) {
    const v = cfg.overseer;
    if (v === false || v === 'off' || v === 'none') return null;
    const o = v && typeof v === 'object' ? v : {};
    const p = Array.isArray(o.position) && o.position.length === 3 ? o.position.map((x, i) => num(x, DEFAULTS.position[i])) : DEFAULTS.position.slice();
    return {
      position: p,
      radius: clamp(num(o.radius, DEFAULTS.radius), 40, 4000),
      color: o.color || DEFAULTS.color,
      glow: o.glow || DEFAULTS.glow,
      intro: o.intro === undefined ? DEFAULTS.intro : o.intro,
      beams: o.beams !== false,
      model: o.model || null,
    };
  }

  // ------------------------------------------------------------------ shapes
  /** A ring of light made of dashes (so you can see it turn): one mesh. */
  function dashedRing(scene, name, radius, thick, n, gap) {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const len = (Math.PI * 2 * radius / n) * (1 - gap);
      const b = B.MeshBuilder.CreateBox(name, { width: thick, height: thick * 0.6, depth: len }, scene);
      b.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      b.rotation.y = -a;
      parts.push(b);
    }
    return B.Mesh.MergeMeshes(parts, true, true);
  }
  /** The thin glowing seams over the hull, the emitter at the bottom and the bay's glow: one mesh. */
  function seams(scene, r, bayYaw) {
    const parts = [];
    for (const lat of [-52, -24, 20, 46]) {
      const t = B.MeshBuilder.CreateTorus('ov-seam', { diameter: 2 * r * Math.cos(lat * RAD) * 1.004, thickness: r * 0.007, tessellation: PHONE ? 48 : 72 }, scene);
      t.position.y = r * Math.sin(lat * RAD);
      parts.push(t);
    }
    for (const lon of [30, 90, 150]) {
      const t = B.MeshBuilder.CreateTorus('ov-seam', { diameter: 2 * r * 1.004, thickness: r * 0.005, tessellation: PHONE ? 48 : 72 }, scene);
      t.rotation.set(Math.PI / 2, 0, 0);
      t.rotation.y = lon * RAD;
      parts.push(t);
    }
    // The emitter: a glowing eye at the lowest point.
    const eye = B.MeshBuilder.CreateSphere('ov-eye', { diameter: r * 0.11, segments: 12 }, scene);
    eye.position.y = -r * 0.99;
    parts.push(eye);
    const ring = B.MeshBuilder.CreateTorus('ov-eye-ring', { diameter: r * 0.26, thickness: r * 0.012, tessellation: 40 }, scene);
    ring.position.y = -r * 0.965;
    parts.push(ring);
    const m = B.Mesh.MergeMeshes(parts, true, true);
    return m;
  }
  /** The hull: a sphere with the docking bay cut out of its side (facing `bayYaw`). */
  function hull(scene, name, r, segs, bay) {
    const s = B.MeshBuilder.CreateSphere(name, { diameter: 2 * r, segments: segs, updatable: false }, scene);
    if (!bay) return s;
    const pos = s.getVerticesData(B.VertexBuffer.PositionKind), nor = s.getVerticesData(B.VertexBuffer.NormalKind), uv = s.getVerticesData(B.VertexBuffer.UVKind);
    const idx = s.getIndices();
    const keep = [];
    const ux = Math.sin(bay.yaw), uz = Math.cos(bay.yaw);
    for (let i = 0; i < idx.length; i += 3) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) { const j = idx[i + k] * 3; cx += pos[j]; cy += pos[j + 1]; cz += pos[j + 2]; }
      cx /= 3; cy /= 3; cz /= 3;
      const along = cx * ux + cz * uz, side = cx * uz - cz * ux;
      const inBay = along > 0 && Math.abs(side) < bay.halfW + r * 0.02 && cy > bay.floor - r * 0.02 && cy < bay.top + r * 0.02;
      if (!inBay) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    const vd = new B.VertexData();
    vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = keep;
    const m = new B.Mesh(name, scene);
    vd.applyToMesh(m);
    s.dispose();
    return m;
  }
  /** A soft round glow (the halo, the far beam's sparkle). */
  let glowTex = null;
  function glowTexture(scene) {
    if (glowTex && glowTex.getScene() === scene) return glowTex;
    const t = new B.DynamicTexture('ov-glow', 128, scene, false);
    const c = t.getContext();
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.32, 'rgba(255,255,255,0.35)'); g.addColorStop(0.62, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128); t.update(); t.hasAlpha = true;
    glowTex = t;
    return t;
  }
  function mat(scene, name, o) {
    const m = new B.StandardMaterial(name, scene);
    m.diffuseColor = o.diffuse || new B.Color3(0, 0, 0);
    m.specularColor = o.spec || new B.Color3(0, 0, 0);
    if (o.power) m.specularPower = o.power;
    m.emissiveColor = o.emissive || new B.Color3(0, 0, 0);
    if (o.unlit) m.disableLighting = true;
    if (o.alpha !== undefined) m.alpha = o.alpha;
    m.fogEnabled = false;
    m.hpNoCurve = true; // (the ship is placed by hand: planet.js's curve would shear something this big)
    return m;
  }

  // ------------------------------------------------------------------ the ship, for one world
  let O = null; // { cfg, scene, far, near, decor, lod, ... }
  /** The bay: the side facing the world's middle, a little below the equator. */
  function bayOf(cfg) {
    const [x, , z] = cfg.position, r = cfg.radius;
    const yaw = Math.atan2(-x, -z) || 0;
    return { yaw, halfW: r * 0.115, floor: -r * 0.072, top: r * 0.036, depth: r * 0.28, r };
  }
  function build(w, cfg) {
    const scene = w.scene;
    const r = cfg.radius;
    const bay = bayOf(cfg);
    const pearl = L.hex(cfg.color, DEFAULTS.color), glow = L.hex(cfg.glow, DEFAULTS.glow);
    const mats = {
      hull: mat(scene, 'ov-hull', { diffuse: pearl.clone(), spec: new B.Color3(0.55, 0.57, 0.6), power: 48, emissive: pearl.scale(0.05) }),
      seam: mat(scene, 'ov-seam', { emissive: glow.clone(), unlit: true }),
      ring: mat(scene, 'ov-ring', { emissive: B.Color3.Lerp(glow, new B.Color3(1, 1, 1), 0.45), unlit: true, alpha: 0.9 }),
      halo: mat(scene, 'ov-halo', { emissive: B.Color3.Lerp(glow, new B.Color3(1, 1, 1), 0.6), unlit: true }),
    };
    try {
      mats.hull.emissiveFresnelParameters = new B.FresnelParameters({ leftColor: B.Color3.Lerp(glow, new B.Color3(1, 1, 1), 0.5).scale(0.55), rightColor: new B.Color3(0, 0, 0), power: 2.2, bias: 0.05 });
    } catch {}
    mats.halo.opacityTexture = glowTexture(scene);
    mats.halo.alphaMode = B.Engine.ALPHA_ADD;
    mats.halo.disableDepthWrite = true;
    mats.ring.alphaMode = B.Engine.ALPHA_ADD;
    // The decor: the same meshes near and far (rings turn, the halo glows), under one node.
    const decor = new B.TransformNode('ov-decor', scene);
    const seam = seams(scene, r, bay.yaw); seam.material = mats.seam; seam.parent = decor;
    const ringA = dashedRing(scene, 'ov-ring-a', r * 1.42, r * 0.018, PHONE ? 48 : 72, 0.28); ringA.material = mats.ring;
    const ringB = dashedRing(scene, 'ov-ring-b', r * 1.66, r * 0.011, PHONE ? 64 : 96, 0.45); ringB.material = mats.ring;
    const turn = new B.TransformNode('ov-turn', scene); turn.parent = decor; // (the bay turns toward whoever asked: presence)
    seam.parent = turn;
    const tiltA = new B.TransformNode('ov-tilt-a', scene); tiltA.parent = turn; tiltA.rotation.set(14 * RAD, 0, 8 * RAD); ringA.parent = tiltA;
    const tiltB = new B.TransformNode('ov-tilt-b', scene); tiltB.parent = turn; tiltB.rotation.set(-24 * RAD, 30 * RAD, -12 * RAD); ringB.parent = tiltB;
    const halo = B.MeshBuilder.CreatePlane('ov-halo', { size: r * 4.4 }, scene);
    halo.material = mats.halo; halo.billboardMode = B.Mesh.BILLBOARDMODE_ALL; halo.parent = turn;
    // The bay's light, seen from afar (the hangar itself is dock.js's, close up).
    const bayGlow = B.MeshBuilder.CreatePlane('ov-bay-glow', { width: bay.halfW * 2, height: bay.top - bay.floor }, scene);
    bayGlow.material = mat(scene, 'ov-bay', { emissive: new B.Color3(1, 0.86, 0.62), unlit: true });
    bayGlow.parent = turn;
    const bayDist = Math.sqrt(Math.max(0, r * r - bay.halfW * bay.halfW)) * 0.985;
    bayGlow.position.set(Math.sin(bay.yaw) * bayDist, (bay.floor + bay.top) / 2, Math.cos(bay.yaw) * bayDist);
    bayGlow.rotation.y = bay.yaw + Math.PI;
    // The far hull (no hole: the bay's light covers it).
    const farHull = hull(scene, 'ov-hull-far', r, PHONE ? 36 : 48, null);
    farHull.material = mats.hull;
    const decorMeshes = [seam, ringA, ringB, halo, bayGlow];
    for (const m of [farHull, ...decorMeshes]) { m.isPickable = false; m.metadata = { decor: true, noGlow: true, overseer: true }; m.receiveShadows = false; m.alwaysSelectAsActiveMesh = true; }
    return { cfg, scene, r, bay, mats, decor, turn, seam, ringA, ringB, halo, bayGlow, farHull, decorMeshes, lod: null, near: null, model: null, t: 0 };
  }

  /** The most the air hazes it, and the least it differs from the sky behind it (0..1 brightness) however hazy. */
  const HAZE_MAX = 0.4, MIN_CONTRAST = 0.14;
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  /** About the colour the hull shows (lit pearl, hazed toward the horizon colour). */
  function hullSeen(pearl, hz, night, hor) {
    const lit = pearl.scale((1 - hz * 0.7) * (0.55 + 0.45 * (1 - night)));
    return B.Color3.Lerp(lit.add(pearl.scale(0.05 + 0.2 * night)), hor, hz * 0.75);
  }

  /** How far it looks lower than it is (the planet's curve), blended in as it gets far (so close up it's exact). */
  function farOffset(d) { const P = H.planet; return P && P.on ? P.drop(d) * smooth(1200, 3200, d) : 0; }
  const center = () => (O ? new B.Vector3(O.cfg.position[0], O.cfg.position[1], O.cfg.position[2]) : null);
  /** Where the emitter is as drawn from where the camera is now (beams start here). */
  function emitterSeen() {
    if (!O) return null;
    const c = center(), cam = O.scene.activeCamera;
    const d = cam ? Math.hypot(c.x - cam.globalPosition.x, c.z - cam.globalPosition.z) : 0;
    return new B.Vector3(c.x, c.y - O.r * 0.99 - farOffset(d), c.z);
  }

  /** The far layer can show it only when it really was built (its render target and the layer that draws it). */
  const farOk = () => { const bg = H.sky.bg; return Boolean(bg && bg.rtt && bg.layer); };
  /** Near (in the world, with its hangar) or far (the sky's far layer). */
  function setLod(lod) {
    if (!O || O.lod === lod) return;
    const bg = H.sky.bg;
    O.lod = lod;
    O.proxy = null; // (update() decides again)
    const far = lod === 'far' && farOk();
    for (const m of O.decorMeshes) { if (far) bg.add(m, 2); else if (bg) bg.remove(m); }
    if (bg) { if (far) bg.add(O.farHull, 2); else bg.remove(O.farHull); }
    O.farHull.setEnabled(Boolean(far) && !O.model);
    O.halo.setEnabled(Boolean(far));
    if (O.near) O.near.show(!far);
    if (O.model) { for (const m of O.model.meshes) { if (far) bg.add(m, 2); else if (bg) bg.remove(m); } }
    for (const f of lodListeners) try { f(lod); } catch (err) { H.report(err, 'overseer'); }
  }
  const lodListeners = [];

  function update(main) {
    if (!O) return;
    const c = center(), p = main.globalPosition;
    const d = B.Vector3.Distance(c, p);
    const nearAt = O.r + 900, farAt = O.r + 1150;
    if (!farOk()) setLod('near');
    else if (O.lod !== 'near' && d < nearAt) setLod('near');
    else if (O.lod !== 'far' && d > farAt) setLod('far');
    const dxz = Math.hypot(c.x - p.x, c.z - p.z);
    // Without the far layer, the world's own camera reaches only maxZ: farther than that it is drawn as a stand-in sphere
    // of the same look and the same size on the screen, pulled in along the line of sight (a failed far layer must never
    // lose the ship).
    const reach = (main.maxZ || 2000) * 0.8;
    const proxy = O.lod === 'near' && d > reach;
    const k = proxy ? reach / d : 1;
    if (proxy !== O.proxy) {
      O.proxy = proxy;
      O.farHull.setEnabled(proxy && !O.model);
      O.halo.setEnabled(proxy);
      if (!proxy) { O.decor.scaling.setAll(1); O.farHull.scaling.setAll(1); if (O.model && O.model.root) O.model.root.scaling.setAll(1); }
    }
    const off = O.lod === 'far' || proxy ? farOffset(dxz) : 0;
    O.decor.position.set(c.x, c.y - off, c.z);
    if (proxy) {
      O.decor.position.set(p.x + (c.x - p.x) * k, p.y + (c.y - off - p.y) * k, p.z + (c.z - p.z) * k);
      O.decor.scaling.setAll(k); O.farHull.scaling.setAll(k);
      if (O.model && O.model.root) O.model.root.scaling.setAll(k);
    }
    O.farHull.position.copyFrom(O.decor.position);
    if (O.model && O.model.root) O.model.root.position.copyFrom(O.decor.position);
    // A round world: it hangs over its place on the planet, turned with the planet (you see it tilt as you go round).
    const q = H.planet && H.planet.round ? H.planet.frame.toLocalQ() : null;
    O.decor.rotationQuaternion = q; O.farHull.rotationQuaternion = q;
    if (O.model && O.model.root) O.model.root.rotationQuaternion = q;
    // Hazy by day, glowing at night: the hull fades into the sky with distance through the air, the seams shine.
    const sky = H.sky;
    const night = 1 - clamp((sky.day - 0.12) / 0.88, 0, 1);
    const hz = Math.min(HAZE_MAX, (1 - Math.exp(-d / 16000)) * (1 - sky.space) * (1 - night * 0.6)) * (O.lod === 'far' || O.proxy ? 1 : 0.2);
    const pearl = L.hex(O.cfg.color, DEFAULTS.color), glow = L.hex(O.cfg.glow, DEFAULTS.glow), hor = sky.horizon;
    // (The haze never takes it below MIN_CONTRAST against the sky behind it: a disc by day must still read.)
    O.mats.hull.diffuseColor = pearl.scale(1 - hz * 0.7);
    O.mats.hull.emissiveColor = B.Color3.Lerp(pearl.scale(0.05 + 0.2 * night), hor, hz * 0.75);
    if (O.lod === 'far' || O.proxy) {
      const seen = hullSeen(pearl, hz, night, hor);
      const gap = MIN_CONTRAST - Math.abs(lum(seen) - lum(hor));
      if (gap > 0) {
        // Away from the sky's brightness: darker when the sky is bright, lighter when it is dark.
        if (lum(hor) > 0.5) { const f = Math.max(0.25, 1 - gap / Math.max(0.05, lum(seen))); O.mats.hull.diffuseColor = O.mats.hull.diffuseColor.scale(f); O.mats.hull.emissiveColor = O.mats.hull.emissiveColor.scale(f); }
        else O.mats.hull.emissiveColor = O.mats.hull.emissiveColor.add(new B.Color3(gap, gap, gap));
      }
    }
    // Alive (presence): night brings the seams up, speech lifts them a little, a long silence breathes.
    const pulse = Math.sin(P.ph);
    const shine = 0.75 + NIGHT_SEAMS * night + 0.25 * sky.space + flareK * 1.6 + 0.25 * P.speak + 0.12 * P.idle * pulse;
    O.mats.seam.emissiveColor = B.Color3.Lerp(glow.scale(shine), hor, hz * 0.4);
    O.mats.ring.emissiveColor = B.Color3.Lerp(B.Color3.Lerp(glow, new B.Color3(1, 1, 1), 0.45).scale(0.65 + 0.7 * night + 0.45 * P.speak), hor, hz * 0.5);
    // A gentle pulse of the halo (about every seven seconds; quicker while it speaks, slower and deeper when it is idle).
    O.halo.scaling.setAll(1 + (0.04 + 0.05 * P.idle) * pulse + 0.07 * P.speak);
    O.mats.halo.alpha = clamp(0.18 + 0.5 * night + 0.15 * sky.space - hz * 0.1 + flareK * 0.35 + 0.05 * pulse + 0.24 * P.speak, 0.08, 0.95);
  }
  /** The emitter flares as the ship sends something down (arrive.js): seams and halo brighten, then settle. */
  let flareK = 0;
  function flare(k = 0.5) { flareK = Math.min(1.5, flareK + Math.max(0, Number(k) || 0)); }
  // The rings turn slowly (game time: they slow down with the world's slow motion, and stop when it stops).
  H.hooks.step.push((dt) => {
    if (flareK > 0.001) flareK *= Math.exp(-dt * 2.2); else flareK = 0;
    if (!O) return;
    O.t += dt;
    presenceStep(dt);
    const quick = 1 + RINGS_SPEAKING * P.speak;
    O.ringA.rotation.y += dt * 0.035 * quick;
    O.ringB.rotation.y -= dt * 0.022 * quick;
    O.seam.rotation.y += dt * 0.004;
  });

  // ------------------------------------------------------------------ presence: the ship is alive
  const NIGHT_SEAMS = 1.3, RINGS_SPEAKING = 3.2, IDLE_AFTER = 40, ATTEND = 14, WINDUP = 0.28;
  /** speak 0..1 (it is saying a line), idle 0..1 (silent a long time: breathing), quiet (seconds since anything), attend
   *  (seconds left of facing the player), turn (the bay's turn, radians), ph (the halo's phase), hum 0..1 (the hum's level). */
  const P = { speak: 0, idle: 0, quiet: 0, attend: 0, turn: 0, ph: 0, hum: 0, idleAfter: IDLE_AFTER };
  const TV = new B.Vector3(), TQ = new B.Quaternion();
  const wrapPi = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
  /** Where the hum is at: 0 on the ground, then up as the player climbs and the ship gets near (altitude in meters above
   *  the surface, distance to the ship in meters, radius). */
  function humFor(alt, dist, r) {
    const up = smooth(25, 320, alt);
    const near = 1 - smooth(r * 1.15, 14000, dist);
    return up * (0.08 + 0.92 * near);
  }
  /** The turn that puts the bay toward the camera (radians from where the bay is built), or 0. */
  function wantTurn() {
    const cam = O.scene.activeCamera;
    if (!cam || !(O.lod === 'far' || O.proxy)) return 0; // (close up the real hangar is where it is)
    const c = center(), p = cam.globalPosition;
    TV.set(p.x - c.x, p.y - c.y, p.z - c.z);
    const q = O.decor.rotationQuaternion;
    if (q) { q.conjugateToRef(TQ); TV.rotateByQuaternionToRef(TQ, TV); }
    if (Math.hypot(TV.x, TV.z) < 1) return 0;
    return wrapPi(Math.atan2(TV.x, TV.z) - O.bay.yaw);
  }
  function presenceStep(dt) {
    const talking = Boolean(H.speech && H.speech.current);
    const active = talking || beams.length > 0 || P.attend > 0 || flareK > 0.05;
    P.quiet = active ? 0 : P.quiet + dt;
    P.attend = Math.max(0, P.attend - dt);
    P.speak += ((talking ? 1 : 0) - P.speak) * (1 - Math.exp(-dt * (talking ? 5 : 2.5)));
    P.idle += ((P.quiet > P.idleAfter ? 1 : 0) - P.idle) * (1 - Math.exp(-dt * 0.4));
    P.ph += dt * (0.9 + 1.8 * P.speak - 0.35 * P.idle);
    const want = P.attend > 0 ? wantTurn() : 0;
    P.turn += wrapPi(want - P.turn) * (1 - Math.exp(-dt * 1.4));
    if (Math.abs(P.turn) < 1e-4 && !want) P.turn = 0;
    O.turn.rotation.y = P.turn;
  }
  /** The player asked it something: it turns its bay toward them for a while. */
  function attend(seconds = ATTEND) { P.attend = Math.max(P.attend, Math.max(0, Number(seconds) || 0)); P.quiet = 0; }

  // The hum: two low sines and a soft triangle through a low-pass, into the background (so a voice ducks it and the music
  // slider sets it); made only while it is audible, let go when it is not.
  let hum = null;
  function stopHum() {
    if (!hum) return;
    const h = hum; hum = null;
    try { const ac = H.audio.context, t = ac.currentTime; h.out.gain.cancelScheduledValues(t); h.out.gain.setTargetAtTime(0, t, 0.08); for (const o of h.oscs) o.stop(t + 0.5); setTimeout(() => { try { h.out.disconnect(); } catch { /* gone */ } }, 700); } catch { /* gone */ }
  }
  function humStep(dt) {
    let level = 0;
    const cam = O && O.scene.activeCamera;
    if (cam) {
      const c = center(), p = cam.globalPosition;
      level = humFor(H.sky.altitude, Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z), O.r);
    }
    P.hum += (level - P.hum) * (1 - Math.exp(-dt * (level > P.hum ? 0.8 : 1.6)));
    if (P.hum < 0.002) { P.hum = level === 0 ? 0 : P.hum; if (hum) stopHum(); return; }
    const a = H.audio, ac = a && a.context;
    if (!ac || !a.running) return;
    try {
      if (!hum) {
        const bed = a.background;
        if (!bed) return;
        const out = ac.createGain(), lp = ac.createBiquadFilter();
        out.gain.value = 0; lp.type = 'lowpass'; lp.frequency.value = 220;
        out.connect(lp); lp.connect(bed);
        const oscs = [[46, 'sine', 1], [69, 'sine', 0.5], [92, 'triangle', 0.22]].map(([f, type, g]) => {
          const o = ac.createOscillator(), og = ac.createGain();
          o.type = type; o.frequency.value = f; og.gain.value = g; o.connect(og); og.connect(out); o.start();
          return o;
        });
        hum = { out, lp, oscs, base: [46, 69, 92] };
      }
      const t = ac.currentTime;
      hum.out.gain.setTargetAtTime(P.hum * 0.1, t, 0.25);
      hum.oscs.forEach((o, i) => o.frequency.setTargetAtTime(hum.base[i] * (1 + 0.35 * P.hum), t, 0.4));
      hum.lp.frequency.setTargetAtTime(160 + 260 * P.hum, t, 0.4);
    } catch { /* no sound */ }
  }
  H.hooks.frame.push((dt) => { if (O) try { humStep(dt); } catch (err) { H.report(err, 'overseer hum'); } });
  /** A debug sample of how alive it is: game.overseer.presence(). */
  function presence() {
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const cam = O && O.scene.activeCamera;
    let distance = null;
    if (O && cam) { const c = center(), p = cam.globalPosition; distance = Math.round(Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z)); }
    return {
      on: Boolean(O),
      speaking: r3(P.speak), flare: r3(flareK), idle: r3(P.idle), quiet: r3(P.quiet), attending: P.attend > 0, turn: r3(P.turn),
      halo: O ? { alpha: r3(O.mats.halo.alpha), scale: r3(O.halo.scaling.x) } : null,
      rings: O ? { speed: r3(1 + RINGS_SPEAKING * P.speak) } : null,
      seams: O ? { glow: r3(lum(O.mats.seam.emissiveColor)) } : null,
      night: r3(1 - clamp((H.sky.day - 0.12) / 0.88, 0, 1)),
      hum: { level: r3(P.hum), playing: Boolean(hum), altitude: Math.round(H.sky.altitude), distance },
      beams: beams.length,
    };
  }

  /** A model for the Overseer (the word "overseer" in the game's assets): it replaces the stand-in hull. */
  function wearModel() {
    if (!O || O.model !== null && O.model !== undefined && O.model !== false) return;
    let id = null;
    try { id = O.cfg.model || (H.assets && H.assets.pick ? H.assets.pick('overseer', { kind: 'model' }) : null); } catch { id = null; }
    if (!id) return;
    let url;
    try { url = L.assetUrl(id); } catch { return; }
    O.model = false;
    const scene = O.scene, world = W();
    B.SceneLoader.ImportMeshAsync('', '', url, scene, null, '.glb').then((res) => {
      if (!O || world !== W()) { for (const m of res.meshes) m.dispose(); return; }
      const root = new B.TransformNode('ov-model', scene);
      for (const m of res.meshes) if (!m.parent) m.parent = root;
      root.computeWorldMatrix(true);
      const { min, max } = root.getHierarchyBoundingVectors(true);
      const size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) || 1;
      const holder = new B.TransformNode('ov-model-root', scene);
      root.parent = holder;
      root.scaling.setAll((O.r * 2) / size);
      root.position.set(-(min.x + max.x) / 2 * root.scaling.x, -(min.y + max.y) / 2 * root.scaling.y, -(min.z + max.z) / 2 * root.scaling.z);
      for (const m of res.meshes) { m.isPickable = false; m.metadata = { decor: true, overseer: true }; if (m.material) { m.material.fogEnabled = false; m.material.hpNoCurve = true; } }
      O.model = { root: holder, meshes: res.meshes.filter((m) => m.getTotalVertices && m.getTotalVertices() > 0) };
      O.farHull.setEnabled(false);
      const lod = O.lod; O.lod = null; setLod(lod || 'far');
    }).catch(() => { if (O) O.model = null; });
  }

  // ------------------------------------------------------------------ beams
  B.Effect.ShadersStore.hpBeamVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUV;
void main(void) { vec4 wp = world * vec4(position, 1.0); vW = wp.xyz; vN = normalize((world * vec4(normal, 0.0)).xyz); vUV = uv; gl_Position = viewProjection * wp; }`;
  B.Effect.ShadersStore.hpBeamFragmentShader = `
precision highp float;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUV;
uniform vec3 camPos;
uniform vec3 color;
uniform vec4 p; // strength, time, nearest, farthest (meters from the camera)
void main(void) {
  float d = length(vW - camPos);
  if (d < p.z || d > p.w) discard;
  vec3 V = normalize(camPos - vW);
  float core = pow(abs(dot(normalize(vN), V)), 1.6);
  float pulse = 0.72 + 0.28 * sin(vUV.y * 90.0 - p.y * 9.0);
  float ends = smoothstep(0.0, 0.004, vUV.y) * (1.0 - 0.5 * smoothstep(0.9, 1.0, vUV.y));
  gl_FragColor = vec4(color * core * pulse * ends * p.x, 1.0);
}`;
  let beamGeo = null;
  function beamMesh(scene, name) {
    if (!beamGeo || beamGeo.getScene() !== scene || beamGeo.isDisposed()) {
      beamGeo = B.MeshBuilder.CreateCylinder('ov-beam-src', { height: 1, diameterTop: 2, diameterBottom: 2, tessellation: PHONE ? 12 : 18, cap: B.Mesh.NO_CAP, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
      beamGeo.bakeTransformIntoVertices(B.Matrix.Translation(0, 0.5, 0));
      beamGeo.setEnabled(false);
      beamGeo.isPickable = false;
      beamGeo.metadata = { decor: true, noGlow: true };
    }
    const m = beamGeo.clone(name);
    m.setEnabled(true);
    m.isPickable = false;
    m.metadata = { decor: true, noGlow: true, beam: true };
    m.alwaysSelectAsActiveMesh = true;
    return m;
  }
  function beamMaterial(scene, near) {
    const m = new B.ShaderMaterial('ov-beam', scene, { vertex: 'hpBeam', fragment: 'hpBeam' }, { attributes: ['position', 'normal', 'uv'], uniforms: ['world', 'viewProjection', 'camPos', 'color', 'p'], needAlphaBlending: true });
    m.alphaMode = B.Engine.ALPHA_ADD;
    m.disableDepthWrite = true;
    m.backFaceCulling = false;
    m.hpNear = near;
    return m;
  }
  const MAX_BEAMS = PHONE ? 4 : 9;
  let beams = [];
  const posOfTarget = (t) => {
    if (!t) return null;
    if (t.__entity) return t.alive ? [t.x, t.bottom !== undefined ? t.bottom : t.y, t.z] : null;
    if (Array.isArray(t)) return [num(t[0], 0), num(t[1], 0), num(t[2], 0)];
    if (typeof t === 'object' && 'x' in t) return [num(t.x, 0), num(t.y, 0), num(t.z, 0)];
    return null;
  };
  /** A beam of light from the Overseer's emitter to a spot (a thing, or [x, y, z]).
   *  opts: { radius (at the bottom, m), seconds (1.6), hold (stays until .end()), color, entity (grows into being),
   *  ring (true), sound (true), label } → { end(ok), move(target), alive }. */
  function beam(target, opts = {}) {
    const w = W();
    if (!w || !w.scene) return null;
    const scene = w.scene;
    const at0 = posOfTarget(target);
    if (!at0) return null;
    while (beams.length >= MAX_BEAMS) { const old = beams.shift(); old.kill(); }
    const color = L.hex(opts.color || (O ? O.cfg.glow : DEFAULTS.glow), '#8fd8ff');
    const radius = clamp(num(opts.radius, 1.1), 0.3, 120);
    const seconds = Math.max(0.3, num(opts.seconds, 1.6));
    const near = beamMesh(scene, 'ov-beam'), nm = beamMaterial(scene, true);
    near.material = nm;
    let far = null, fm = null;
    const bg = H.sky.bg;
    if (bg) { far = beamMesh(scene, 'ov-beam-far'); fm = beamMaterial(scene, false); far.material = fm; bg.add(far, 2); }
    // The ring on the ground, and the thing growing into being.
    let ring = null;
    if (opts.ring !== false) {
      ring = B.MeshBuilder.CreateTorus('ov-beam-ring', { diameter: 2, thickness: 0.05, tessellation: PHONE ? 24 : 40 }, scene);
      ring.material = mat(scene, 'ov-beam-ring', { emissive: B.Color3.Lerp(color, new B.Color3(1, 1, 1), 0.4), unlit: true, alpha: 0.9 });
      ring.material.alphaMode = B.Engine.ALPHA_ADD;
      ring.isPickable = false; ring.metadata = { decor: true };
    }
    const ent = opts.entity && opts.entity.__entity && opts.entity !== w.player ? opts.entity : null;
    let grow = null;
    if (ent && ent.alive && !opts.noGrow) { grow = { s: ent.node.scaling.clone(), done: false }; ent.node.scaling.scaleInPlace(0.01); }
    let tgt = target;
    const b = {
      t: -WINDUP, seconds, hold: Boolean(opts.hold), radius, ended: false, endT: 0, alive: true, near, far, ring, nm, fm, color, boost: 0,
      move(t) { tgt = t; return b; },
      /** A surge down the shaft (something is being sent): brighter for a moment. */
      pulse(k = 1) { b.boost = Math.min(3, b.boost + k); return b; },
      end(ok = true) { if (b.ended) return; b.ended = true; b.endT = b.t; if (ok !== false && G()) { const p = posOfTarget(tgt); if (p) G().burst([p[0], p[1] + 0.5, p[2]], { color: '#e8f6ff', count: PHONE ? 14 : 30, speed: 4 }); } },
      kill() {
        if (!b.alive) return;
        b.alive = false;
        if (grow && !grow.done && ent && ent.alive) { ent.node.scaling.copyFrom(grow.s); ent.measure(); grow.done = true; }
        if (far && H.sky.bg) H.sky.bg.remove(far);
        for (const m of [near, far, ring]) if (m && !m.isDisposed()) m.dispose();
        for (const m of [nm, fm, ring && ring.material]) if (m) m.dispose();
        beams = beams.filter((x) => x !== b);
      },
      frame(dt, cam) {
        b.t += dt;
        if (b.boost) b.boost = b.boost > 0.01 ? b.boost * Math.exp(-dt * 3.5) : 0;
        const p = posOfTarget(tgt) || at0;
        const top = emitterSeen() || new B.Vector3(p[0], p[1] + 400, p[2]);
        const P = H.planet;
        const bot = new B.Vector3(p[0], p[1] - (P ? P.dropAt(p[0], p[2]) : 0), p[2]);
        const dir = top.subtract(bot);
        const len = dir.length();
        const q = new B.Quaternion();
        B.Quaternion.FromUnitVectorsToRef(B.Axis.Y, dir.scale(1 / Math.max(1e-6, len)), q);
        // In: the shaft widens from nothing; out: it thins and fades.
        const tIn = smooth(0, 0.22, b.t);
        const life = b.hold && !b.ended ? 1 : b.ended ? 1 - smooth(b.endT, b.endT + 0.45, b.t) : 1 - smooth(b.seconds - 0.45, b.seconds, b.t);
        const k = tIn * life;
        const widthTop = Math.max(10, b.radius * 0.5) * (O ? O.r / 1400 : 1);
        for (const [m, mm, nearPass] of [[near, nm, true], [far, fm, false]]) {
          if (!m) continue;
          m.position.copyFrom(bot);
          m.rotationQuaternion = q;
          // A cone: wide at the emitter, as wide as the thing at the bottom (the mesh's sides lean between them).
          m.scaling.set(b.radius * Math.max(0.05, k), len, b.radius * Math.max(0.05, k));
          mm._hp = { k, near: nearPass, top: widthTop };
        }
        if (ring) {
          const rt = clamp((b.t - 0.12) / 0.9, 0, 1);
          const s = b.radius * (0.6 + rt * 1.6);
          ring.position.set(bot.x, bot.y + 0.05, bot.z);
          ring.scaling.set(s, 1, s);
          ring.material.alpha = (1 - rt) * 0.9 * life * smooth(0, 0.1, b.t);
          if (rt >= 1 && !b.hold) ring.setEnabled(false);
        }
        if (grow && !grow.done && ent) {
          if (!ent.alive) grow.done = true;
          else {
            const g = smooth(0.18, 0.7, b.t);
            const e2 = g + Math.sin(g * Math.PI) * 0.08;
            ent.node.scaling.set(grow.s.x * Math.max(0.01, e2), grow.s.y * Math.max(0.01, e2), grow.s.z * Math.max(0.01, e2));
            if (g >= 1) { ent.node.scaling.copyFrom(grow.s); ent.measure(); grow.done = true; }
          }
        }
        if ((b.ended && b.t > b.endT + 0.5) || (!b.hold && !b.ended && b.t > b.seconds)) b.kill();
      },
    };
    for (const [mm, nearPass] of [[nm, true], [fm, false]]) {
      if (!mm) continue;
      mm.onBindObservable.add(() => {
        const e = mm.getEffect(), c = scene.activeCamera;
        if (!e || !c) return;
        const cp = c.globalPosition;
        const reach = (c.maxZ || 2000) * 0.9;
        e.setFloat3('camPos', cp.x, cp.y, cp.z);
        e.setColor3('color', b.color);
        const k = mm._hp ? mm._hp.k : 0;
        e.setFloat4('p', k * (0.55 + 0.5 * (1 - Math.min(1, b.radius / 30))) * (1 + b.boost), b.t, nearPass ? 0 : reach, nearPass ? reach : 1e9);
      });
    }
    // The shaft leans from the target out to the emitter: its top is wider than its bottom.
    const topK = Math.max(10, radius * 0.5) * (O ? O.r / 1400 : 1) / radius;
    for (const m of [near, far]) if (m) scaleTop(m, topK);
    beams.push(b);
    flare(0.7); // the emitter flares first; the shaft opens a moment later (WINDUP)
    if (opts.sound !== false) whoosh(at0, radius);
    if (G()) G().emit('beam', { at: at0, radius, entity: ent || null });
    return b;
  }
  /** Makes a beam mesh a cone: its top ring `k` times as wide as its bottom (each beam has its own copy). */
  function scaleTop(m, k) {
    const pos = m.getVerticesData(B.VertexBuffer.PositionKind);
    if (!pos) return;
    const out = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { const s = pos[i + 1] > 0.5 ? k : 1; out[i] = pos[i] * s; out[i + 1] = pos[i + 1]; out[i + 2] = pos[i + 2] * s; }
    m.makeGeometryUnique();
    m.setVerticesData(B.VertexBuffer.PositionKind, out, false);
    m.refreshBoundingInfo();
  }
  /** The sound of a beam: a game sound with the word "beam", or a soft made-up shimmer. */
  function whoosh(at, radius) {
    try {
      const g = G();
      const id = H.assets && H.assets.pick ? H.assets.pick('beam', { kind: 'sound' }) : null;
      if (id && g && g.sound) { g.sound(id); return; }
      const ac = H.audio && H.audio.context;
      if (!ac || ac.state !== 'running') return;
      const cam = W() && W().scene.activeCamera;
      const d = cam ? Math.hypot(at[0] - cam.globalPosition.x, at[1] - cam.globalPosition.y, at[2] - cam.globalPosition.z) : 0;
      const vol = clamp(0.16 / (1 + d / 25), 0, 0.16) * (radius > 6 ? 1.4 : 1);
      if (vol < 0.004) return;
      const t0 = ac.currentTime;
      const out = ac.createGain(); out.gain.setValueAtTime(0.0001, t0); out.gain.exponentialRampToValueAtTime(vol, t0 + 0.08); out.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
      out.connect(H.audio.master);
      for (const [f0, f1, type] of [[1320, 440, 'sine'], [990, 660, 'triangle']]) {
        const o = ac.createOscillator(); o.type = type;
        o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + 1.2);
        o.connect(out); o.start(t0); o.stop(t0 + 1.45);
      }
    } catch { /* no sound */ }
  }
  H.hooks.frame.push((dt) => {
    const w = W(), cam = w && w.scene && w.scene.activeCamera;
    if (!cam || !beams.length) return;
    for (const b of [...beams]) try { b.frame(dt, cam); } catch (err) { H.report(err, 'beam'); b.kill(); }
  });

  /** Beams a thing in (it grows out of the light), or several at once (one wide beam over them all). */
  function materialize(list, opts = {}) {
    const ents = (Array.isArray(list) ? list : [list]).filter((e) => e && e.__entity && e.alive);
    if (!ents.length) return null;
    if (O && O.cfg && !O.cfg.beams) return null;
    if (ents.length === 1) {
      const e = ents[0];
      return beam(e, { radius: clamp(Math.max(e.half[0], e.half[2]) * 1.6 + 0.4, 0.6, 40), entity: e, ...opts });
    }
    let sx = 0, sz = 0, minY = Infinity;
    for (const e of ents) { sx += e.x; sz += e.z; minY = Math.min(minY, e.bottom); }
    const cx = sx / ents.length, cz = sz / ents.length;
    let rad = 1;
    for (const e of ents) rad = Math.max(rad, Math.hypot(e.x - cx, e.z - cz) + Math.max(e.half[0], e.half[2]));
    const grow = ents.length <= 24;
    const b = beam([cx, minY, cz], { radius: clamp(rad * 1.05, 2, 90), seconds: 2, ...opts, entity: null });
    if (b && grow) for (const e of ents) growIn(e);
    return b;
  }
  /** The scale-in alone (for a batch under one wide beam). */
  function growIn(e) {
    if (!e || !e.alive || e === (W() && W().player)) return;
    const s = e.node.scaling.clone();
    e.node.scaling.scaleInPlace(0.01);
    const scene = W().scene;
    let t = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      t += scene.getEngine().getDeltaTime() / 1000;
      const g = smooth(0.15, 0.65, t);
      if (!e.alive) { scene.onBeforeRenderObservable.remove(obs); return; }
      const k = Math.max(0.01, g + Math.sin(g * Math.PI) * 0.08);
      e.node.scaling.set(s.x * k, s.y * k, s.z * k);
      if (g >= 1) { e.node.scaling.copyFrom(s); e.measure(); scene.onBeforeRenderObservable.remove(obs); }
    });
    // Without frames (a hidden tab, tests) it's full size a moment later anyway.
    setTimeout(() => { if (e.alive && e.node.scaling.x < s.x * 0.999) { e.node.scaling.copyFrom(s); e.measure(); } }, 1200);
  }

  // ------------------------------------------------------------------ what gets beamed in
  H.hooks.scene.push((scene, w) => { w._overseerKept = Boolean(w.keepPose); });
  H.hooks.world.push({
    leave() { stopHum(); },
    enter(w) {
      beams = [];
      O = null;
      stopHum(); Object.assign(P, { speak: 0, idle: 0, quiet: 0, attend: 0, turn: 0, ph: 0, hum: 0 });
      const cfg = localize(read(L.effectiveConfig()));
      if (cfg) {
        try { O = build(w, cfg); } catch (err) { H.report(err, 'overseer'); O = null; }
        if (O) { setLod(farOk() ? 'far' : 'near'); for (const f of enterListeners) try { f(O, w); } catch (err) { H.report(err, 'overseer'); } wearModel(); }
      }
      // The player arrives in a beam (unless the intro does it, or the world only reloaded around them).
      const p = w.player;
      if (p && p.alive && !w._overseerKept && !(H.overseer.introWanted && H.overseer.introWanted())) setTimeout(() => { if (W() === w && p.alive) beamPlayer(p); }, 60);
    },
    respawn(p) { beamPlayer(p); },
    ops(ops, touched, o) {
      const w = W();
      if (!w) return;
      if ((ops || []).some((x) => x && x.op === 'config' && x.patch && 'overseer' in x.patch)) { reconfigure(); return; }
      if (H.arrive) { H.arrive.ops(ops, touched, o); return; } // (arrive.js: dropped, grown or beamed in by what it is)
      if (!(o.fx === 'materialize' || o.fx === 'arrive' || (o.remote && o.by))) return;
      const made = touched.filter((e) => e && e.alive && ops.some((x) => (x.op === 'create' || (o.fx === 'arrive' && x.op === 'replace')) && x.entity && x.entity.id === e.sceneId));
      if (made.length) materialize(made.length === 1 ? made[0] : made);
    },
  });
  const enterListeners = [];
  /** A round world: config.overseer.position is on the planet (above the start by default); the ship is placed around
   *  you from there, and again whenever the frame moves (round.js). */
  function localize(cfg) {
    if (!cfg || !(H.planet && H.planet.round && H.planet.frame.on)) return cfg;
    cfg.home = cfg.position.slice();
    cfg.position = H.planet.frame.toLocal(cfg.home);
    return cfg;
  }
  if (H.planet && H.planet.frame && H.planet.frame.onRebase) H.planet.frame.onRebase(() => { if (O && O.cfg.home) O.cfg.position = H.planet.frame.toLocal(O.cfg.home); });
  function beamPlayer(p) {
    if (!p || !p.alive || (O && O.cfg && !O.cfg.beams)) return null;
    return beam(p, { radius: 1.3, seconds: 1.8, sound: true });
  }
  function reconfigure() {
    const w = W();
    if (!w) return;
    // Rebuilding the ship is the simplest way to take a new position or look (the hangar too).
    for (const f of leaveListeners) try { f(O); } catch (err) { H.report(err, 'overseer'); }
    if (O) disposeShip();
    O = null;
    const cfg = localize(read(L.effectiveConfig()));
    if (!cfg) return;
    try { O = build(w, cfg); } catch (err) { H.report(err, 'overseer'); return; }
    setLod(farOk() ? 'far' : 'near');
    for (const f of enterListeners) try { f(O, w); } catch (err) { H.report(err, 'overseer'); }
    wearModel();
  }
  const leaveListeners = [];
  function disposeShip() {
    const bg = H.sky.bg;
    for (const m of [O.farHull, ...O.decorMeshes]) { if (bg) bg.remove(m); if (!m.isDisposed()) m.dispose(); }
    for (const m of Object.values(O.mats)) m.dispose();
    O.decor.dispose();
    if (O.model && O.model.root) O.model.root.dispose();
  }
  // Spawn guns and spawnMany: one beam over the batch (thrown grenades are not beamed: they're thrown).
  H.hooks.game.push((game) => {
    game.on('spawned', (d) => {
      if (H.arrive) return; // (Mayhem hands its batches to arrive.js itself, for everyone)
      const list = d && Array.isArray(d.things) ? d.things.filter((e) => e && e.alive && !(e.data && (e.data.grenade || e.data.sticky))) : [];
      if (list.length) materialize(list);
    });
    game.overseer = {
      /** A beam of light from the Overseer to a thing or a point: game.overseer.beam(crate), .beam([0, 0, 5], { radius: 4 }). */
      beam: (t, o) => beam(t, o || {}),
      /** Beams something in: it grows out of the light. */
      materialize: (e, o) => materialize(e, o || {}),
      /** Where the ship is ([x, y, z]), or null when this game has none. */
      get position() { return O ? O.cfg.position.slice() : null; },
      get radius() { return O ? O.r : 0; },
      /** Words from the Overseer, over the picture (seconds: how long). */
      say: (text, seconds, o) => say(text, seconds, o),
      /** Words and its voice: speak('Welcome aboard.', 'overseer-welcome-aboard.mp3'). Every line it has: VOICES. */
      speak: (text, name, seconds, o) => speak(text, name, seconds, o),
      /** How alive it is right now (speaking, flare, idle, turn, halo, hum...): a debug sample. */
      presence: () => presence(),
    };
    game.on('asked', () => attend());
  });
  /** The Overseer speaks: its words are a line in the game's chat (H.chat; the editor's chat in the editor), never a
   *  caption over the picture (J, 2026-10-24: "All captions should be in the chat window, period"). Every line goes
   *  through the speech desk (speech.js): one at a time, the later waiting or, if important, cutting in gently.
   *  `seconds` is the least time it holds the desk; o: { priority: 'low' | 'normal' | 'important', owner, voice }. */
  function say(text, seconds = 4, o = {}) {
    const t = String(text || '').trim();
    if (!t) return null;
    if (H.speech) return H.speech.say({ text: t, seconds, priority: o.priority, owner: o.owner, voice: o.voice, external: o.external, action: o.action, onEnd: o.onEnd });
    if (H.chat) H.chat.line({ kind: 'overseer', text: t, keep: Math.max(14, Number(seconds) || 0), now: true });
    return null;
  }
  H.sky.onEnter(() => {
    // Placed for this view every frame, before the sky's far layer draws.
    H.sky.onBg((main) => { try { update(main); } catch (err) { H.report(err, 'overseer'); } });
  });
  // Without a far layer (no screen: tests, or one that failed to build) it still has a place and a look.
  H.hooks.frame.push(() => { const w = W(); if (O && !farOk() && w && w.scene.activeCamera) update(w.scene.activeCamera); });

  // The codex's page (overseer.js reads config.overseer itself: every game has it, unless it's false).
  H.features.register('overseer', {
    apply() {}, change() {}, dispose() {},
    codex: {
      title: 'The Overseer', group: 'World features',
      what: 'The giant sphere-shaped ship in the sky of every game: everything that appears comes down from it (dropped out of the sky to land where asked, or on the roof over it; plants grow up out of the ground; mountains rise over five seconds; lights and signs are beamed in), the assistant speaks as it, and a rocket or a space ship can fly up and dock in its hangar. Here, a small one close by.',
      value: { position: [0, 16, 0], radius: 9, intro: false },
      fields: [['position', '[x, y, z] meters', '[-3000, 4200, 9700]'], ['radius', 'meters', '1400'], ['color', 'the hull', '#eef1f6'], ['glow', 'seams, rings, beams', '#8fd8ff'], ['intro', '"first", "always" or false', 'first'], ['beams', 'false: things just appear', 'true'], ['arrive', 'how things come in: auto (dropped from the sky, plants grown, lights beamed), drop, grow, beam, none', 'auto'], ['(false)', 'no Overseer in this game', '']],
    },
  });

  // ------------------------------------------------------------------ the Overseer's voice
  // Everything it says, spoken (the starter pack's "overseer" voice shelf: community/starter.mjs, by name -> the
  // community library's id). Any game plays them through the public community route; a game's own asset by the same
  // name wins. New lines: add them to the starter pack, make them (tools/starter.mjs make voice), then here.
  const VOICES = {
    'overseer-a-new-one.mp3': 'a_2e4236a4f60b4f15', 'overseer-welcome-aboard.mp3': 'a_ceea2f1d5cf68b50', 'overseer-is-duck.mp3': 'a_33ec5fb3050ccaf5',
    'overseer-is-potato.mp3': 'a_de63438973351455', 'overseer-is-mushroom.mp3': 'a_33390ba6b35b07cf', 'overseer-is-banana.mp3': 'a_5f27bf90c9ece2c9',
    'overseer-is-teapot.mp3': 'a_393a4c32c63637b4', 'overseer-is-cone.mp3': 'a_edfb51c5ca40e3dc', 'overseer-is-cactus.mp3': 'a_9911a88f7dd0fd42',
    'overseer-is-toaster.mp3': 'a_6a01c9caca211602', 'overseer-is-shoe.mp3': 'a_2a65deb07e22e8d6', 'overseer-is-fish.mp3': 'a_dec9d95b90601d01',
    'overseer-is-dinosaur.mp3': 'a_a7c59e8e3cd53968', 'overseer-is-horse.mp3': 'a_0a8447d0b306fec0', 'overseer-is-sheep.mp3': 'a_2f08b9ca67eaa9b4',
    'overseer-is-cow.mp3': 'a_3ab5910a08e35b19', 'overseer-is-chicken.mp3': 'a_30313b0c91108e15', 'overseer-is-penguin.mp3': 'a_b314c71f232ea63d',
    'overseer-is-rabbit.mp3': 'a_3f1f067a50fc532a', 'overseer-is-bear.mp3': 'a_8e59609d0dccb727', 'overseer-is-pig.mp3': 'a_c8ab6d53fa981ec7',
    'overseer-is-fox.mp3': 'a_3e8a5574ebf6d4f9', 'overseer-is-cat.mp3': 'a_2cf3eda01cb0713d', 'overseer-is-dog.mp3': 'a_e88d6e1ed2e81ff2',
    'overseer-is-rollbot.mp3': 'a_a3c0bc3d2cde517a', 'overseer-is-robot.mp3': 'a_69ccb99202e9fcb5', 'overseer-is-tvbot.mp3': 'a_b4d98a1639e6ea52',
    'overseer-is-person.mp3': 'a_7070c29cdc240b5c', 'overseer-mirror-done.mp3': 'a_7a79bc1e721339aa', 'overseer-mirror-view.mp3': 'a_92afa99ab3bb1365',
    'overseer-mirror-name.mp3': 'a_76a84299626f8402', 'overseer-mirror-what.mp3': 'a_c0e328781a118af8', 'overseer-mirror-open.mp3': 'a_045f8213473256ee',
    'overseer-mirror-look.mp3': 'a_994bf59af90bf68b', 'overseer-your-world.mp3': 'a_996ee77e57857b6a', 'overseer-ask.mp3': 'a_e8eb1d1e6dc695fb',
    'overseer-destruction.mp3': 'a_96af75c7b29f0446', 'overseer-intro.mp3': 'a_f5c151efa39d35c9', 'overseer-the-sea-gives.mp3': 'a_e86b71afc8a4d1c7',
    'overseer-found-your-way.mp3': 'a_bacd20f46737e756',
  };
  /** Where a line's voice is (a game's own asset first, else the community library's), or null. */
  function voiceUrl(name) {
    try { if (H.lib.hasAsset(name)) return H.lib.assetUrl(name); } catch { /* not this game's */ }
    const id = VOICES[name];
    return id ? `/v1/community/${id}/file` : null;
  }
  /** An Audio for a line, through the game's sound (H.audio), not yet playing; null when there's no voice for it.
   *  While it plays, the music and ambience duck under it. */
  function voice(name) {
    const url = voiceUrl(name);
    if (!url || typeof Audio === 'undefined') return null;
    try {
      const a = new Audio(url);
      a.crossOrigin = 'anonymous';
      if (H.audio && H.audio.media) H.audio.media(a, { voice: true });
      return duckWhile(a);
    } catch { return null; }
  }
  /** The background (music, the sea) ducks while this audio of the Overseer's plays, and comes back after. */
  let speaking = 0;
  function duckWhile(a) {
    if (!a || a.__ducks) return a;
    a.__ducks = true;
    let on = false;
    const start = () => { if (on) return; on = true; speaking++; if (H.audio && H.audio.duck) H.audio.duck('overseer', 0.22); };
    const stop = () => { if (!on) return; on = false; speaking = Math.max(0, speaking - 1); if (!speaking && H.audio && H.audio.duck) H.audio.duck('overseer', null); };
    a.addEventListener('playing', start);
    for (const ev of ['ended', 'pause', 'error', 'emptied']) a.addEventListener(ev, stop);
    return a;
  }
  /** Says it: the words in the chat and, when there's a voice for it, spoken (both through the speech desk, which
   *  lets nothing overlap and types the words out over the voice's length). */
  function speak(text, name, seconds, o = {}) {
    return say(text, seconds, { ...o, voice: name || undefined });
  }

  H.overseer = {
    DEFAULTS, read, VOICES, voiceUrl, voice, speak, duckWhile,
    get on() { return Boolean(O); },
    get ship() { return O; },
    get position() { return O ? O.cfg.position.slice() : null; },
    get radius() { return O ? O.r : 0; },
    get config() { return O ? { ...O.cfg } : null; },
    get lod() { return O ? O.lod : null; },
    /** The emitter (the lowest point), in world meters. */
    emitter() { return O ? [O.cfg.position[0], O.cfg.position[1] - O.r * 0.99, O.cfg.position[2]] : null; },
    emitterSeen, beam, materialize, growIn, say, setLod, flare, presence, attend,
    get beams() { return beams.length; },
    MAX_BEAMS,
    onEnter(fn) { enterListeners.push(fn); },
    onLeave(fn) { leaveListeners.push(fn); },
    onLod(fn) { lodListeners.push(fn); },
    _: { P, humFor, NIGHT_SEAMS, WINDUP, mat, bayOf, center, farOffset, farOk, lum, hullSeen, HAZE_MAX, MIN_CONTRAST },
  };
})();
