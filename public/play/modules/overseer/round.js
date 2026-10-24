// A round world (config.planet.sphere: true): the ground is a whole planet (50 km across by default) that you walk, fly
// and build on all the way round. How it works:
//   - The world file keeps things on the planet: positions are in the planet's own frame (its middle is
//     [0, -radius, 0], the start is on top, at [0, 0, 0]), and a rotation is turned from standing upright where the
//     thing is (so [0, 90, 0] stands it up facing east wherever it is).
//   - The engine runs in a frame around you: you are near x = z = 0 and "up" (away from the middle) is +y, so physics,
//     the camera, the controllers, building and every module work as they do on flat ground, and float32 stays precise
//     (nothing far from the frame's origin moves). When you've gone a few hundredths of a degree round the planet (about
//     100 m on the ground), the frame moves under you: everything is moved and turned by one small rotation (the nodes,
//     the bodies and their velocities, the characters, the camera, what modules keep), so nothing jumps or jitters.
//   - Gravity points to the middle for every body (physics.js: Havok pulls along -y, exact under you; bodies away from
//     you get the rest each step). Things more than 1.5 km from you rest until you come back.
//   - The ground: a curved patch a few km round you (fine near you, coarser far off; the same mesh is its collider),
//     painted from the planet's own lands (the same colours as the ball from space), and the whole planet in the sky's
//     far layer beyond the camera's reach (planet.js), so from high up you see the ball you were standing on.
//   - H.planet.frame: toPlanet(p), toLocal(p), onRebase(fn(tr)), rebase(), and tr = { point, dir, quat } for a module's
//     own positions (Living things' goals, the Overseer, the hangar).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const { PHONE } = H.sky._;
  const P = H.planet;
  const RAD = Math.PI / 180;

  // ------------------------------------------------------------------ the frame
  // O: where the frame's origin is on the planet (planet meters, double precision); Q: how it's turned (local -> planet).
  const F = { on: false, R: 50000, O: [0, 0, 0], Q: new B.Quaternion(0, 0, 0, 1), Qi: new B.Quaternion(0, 0, 0, 1), rebases: 0 };
  const listeners = [];
  function reset() { F.O = [0, 0, 0]; F.Q.set(0, 0, 0, 1); F.Qi.set(0, 0, 0, 1); }

  /** A vector turned by a quaternion, in double precision (Babylon's own goes through a float32 matrix). */
  function rot(q, x, y, z) {
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
  }
  const vec = (v) => L.vec(v);
  /** A point in the world around you -> on the planet. */
  function toPlanet(p) { const v = vec(p); const r = rot(F.Q, v[0], v[1], v[2]); return [F.O[0] + r[0], F.O[1] + r[1], F.O[2] + r[2]]; }
  /** A point on the planet -> in the world around you. */
  function toLocal(p) { const v = vec(p); return rot(F.Qi, v[0] - F.O[0], v[1] - F.O[1], v[2] - F.O[2]); }
  const dirToPlanet = (d) => { const v = vec(d); return rot(F.Q, v[0], v[1], v[2]); };
  /** Standing upright at a point on the planet: +y turned to point away from the middle (planet frame). */
  function upright(pp, out = new B.Quaternion()) {
    const x = pp[0], y = pp[1] + F.R, z = pp[2];
    const l = Math.hypot(x, y, z);
    if (l < 1e-9) return out.set(0, 0, 0, 1);
    return fromUp(x / l, y / l, z / l, out);
  }
  /** The shortest turn from +y to a direction (exact right up to the opposite side: Babylon's gives up near it). */
  function fromUp(x, y, z, out = new B.Quaternion()) {
    const w = 1 + y;
    if (w < 1e-12) return out.set(1, 0, 0, 0); // straight down: half a turn about x
    // (cross(+y, d), 1 + dot(+y, d)), normalized.
    out.set(z, 0, -x, w);
    return out.normalize();
  }
  const eulerOf = (r) => (Array.isArray(r) ? [Number(r[0]) || 0, Number(r[1]) || 0, Number(r[2]) || 0] : [0, Number(r) || 0, 0]);
  const quatOf = (deg) => B.Quaternion.FromEulerAngles(deg[0] * RAD, deg[1] * RAD, deg[2] * RAD);
  const degOf = (q) => { const e = q.toEulerAngles(); return [e.x / RAD, e.y / RAD, e.z / RAD]; };
  const r2 = (n) => Math.round(n * 100) / 100;
  const r1 = (n) => Math.round(n * 10) / 10 || 0;

  /** A transform from the world file -> { position, rotation } around you. */
  function fromScene(t) {
    const pos = vec(t.position);
    const q = F.Qi.multiply(upright(pos)).multiply(quatOf(eulerOf(t.rotation ?? 0)));
    return { position: toLocal(pos), rotation: degOf(q) };
  }
  /** A pose around you -> the world file's { position, rotation } (rounded as the editor rounds). */
  function toSceneT(pos, rotDeg) {
    const pp = toPlanet(pos);
    const q = upright(pp).conjugate().multiply(F.Q).multiply(quatOf(eulerOf(rotDeg)));
    return { position: pp.map(r2), rotation: degOf(q).map(r1) };
  }
  const done = new WeakSet();
  /** Edits made here (in the world around you), in place: their transforms go onto the planet. */
  function toScene(ops) {
    const w = W();
    for (const op of ops || []) {
      if (!op || typeof op !== 'object' || done.has(op)) continue;
      done.add(op);
      if ((op.op === 'create' || op.op === 'replace') && op.entity && op.entity.transform) {
        const t = op.entity.transform;
        Object.assign(t, toSceneT(t.position || [0, 0, 0], t.rotation ?? 0));
      } else if (op.op === 'update' && op.patch && op.patch.transform && typeof op.patch.transform === 'object') {
        const t = op.patch.transform;
        if (t.position === undefined && t.rotation === undefined) continue;
        const e = w && w.byId.get(op.id);
        const pos = t.position || (e ? e.position : null);
        if (!pos) continue;
        Object.assign(t, toSceneT(pos, t.rotation ?? (e ? e.rotation3 : 0)));
      }
    }
    return ops;
  }
  /** Edits already in the world file's frame (undo, redo): nothing to change. */
  function mark(ops) { for (const op of ops || []) if (op && typeof op === 'object') done.add(op); return ops; }
  /** Fell through the ground (well under the planet's surface). */
  const below = (e) => P.heightOf(e.position) < -40;
  const space = { fromScene, toScene, mark, below, toPlanet, toLocal, dirToPlanet };

  // ------------------------------------------------------------------ moving the frame under you
  const TQ = new B.Quaternion();
  /** Moves the frame so that `at` (a point around you) is over its origin, with up as +y there. */
  function rebaseTo(at) {
    const w = W();
    if (!F.on || !w) return;
    const R = F.R;
    const a = vec(at);
    const len = Math.hypot(a[0], a[1] + R, a[2]);
    if (len < 1) return;
    const u = [a[0] / len, (a[1] + R) / len, a[2] / len];
    const o = [u[0] * R, u[1] * R - R, u[2] * R]; // the ground under it
    const r = fromUp(u[0], u[1], u[2]);
    const ri = r.conjugate();
    // The new frame (where the old one put o, turned by r).
    F.O = toPlanet(o);
    F.Q = F.Q.multiply(r).normalize();
    F.Qi = F.Q.conjugate();
    F.rebases++;
    const tr = {
      r, ri, o,
      point: (p) => { const v = vec(p); return rot(ri, v[0] - o[0], v[1] - o[1], v[2] - o[2]); },
      dir: (d) => { const v = vec(d); return rot(ri, v[0], v[1], v[2]); },
      quat: (q) => ri.multiply(q),
    };
    const pl = w.player;
    // Every thing in the world (not the ground, which stays under you; children go with their parents).
    for (const e of w.entities) {
      if (!e.alive || e._frameFixed || e.node.parent) continue;
      const n = e.node, p = tr.point([n.position.x, n.position.y, n.position.z]);
      n.position.set(p[0], p[1], p[2]);
      if (n.rotationQuaternion) n.rotationQuaternion = ri.multiply(n.rotationQuaternion);
      else { B.Quaternion.FromEulerAnglesToRef(n.rotation.x, n.rotation.y, n.rotation.z, TQ); ri.multiply(TQ).toEulerAnglesToRef(n.rotation); }
      if (e === pl) { n.rotation.x = 0; n.rotation.z = 0; }
      const v = tr.dir(e._v); e._v[0] = v[0]; e._v[1] = v[1]; e._v[2] = v[2];
      if (e.home) e.home = { position: tr.point(e.home.position), rotation: degOf(ri.multiply(quatOf(eulerOf(e.home.rotation)))) };
    }
    // What is now far from you rests at once (off the ground patch nothing holds it up).
    rest(0, true);
    if (H.physics && H.physics.rebase) H.physics.rebase(tr);
    // The camera: where it is, and which way it looks (the same way, from the new up).
    const c = w.camera;
    if (c) {
      const cam = c.cam;
      if (cam) { const p = tr.point([cam.position.x, cam.position.y, cam.position.z]); cam.position.set(p[0], p[1], p[2]); }
      if (c.focus) { const p = tr.point([c.focus.x, c.focus.y, c.focus.z]); c.focus.set(p[0], p[1], p[2]); }
      if (c.arc && c.arc.target) { const p = tr.point([c.arc.target.x, c.arc.target.y, c.arc.target.z]); c.arc.target.set(p[0], p[1], p[2]); }
      c.eyeY = undefined; // (the first-person eye snaps to the moved player: it's where it was)
      const cp = Math.cos(c.pitch || 0);
      const d = tr.dir([Math.sin(c.yaw || 0) * cp, -Math.sin(c.pitch || 0), Math.cos(c.yaw || 0) * cp]);
      c.yaw = Math.atan2(d[0], d[2]);
      c.pitch = -Math.asin(Math.max(-1, Math.min(1, d[1])));
      if (pl && pl.alive && c.mode === 'fps' && c.target === pl) pl.node.rotation.y = c.yaw;
    }
    if (w.checkpoint) w.checkpoint = tr.point(w.checkpoint);
    for (const f of listeners) try { f(tr, w); } catch (err) { H.report(err, 'round world'); }
  }
  /** Each step (after physics): the frame follows you once you've gone far enough round. */
  function follow() {
    const w = W();
    const p = w && w.player;
    if (!F.on || !p || !p.alive || p.remote) return;
    const x = p.x, y = p.y + F.R, z = p.z;
    // How far round from the frame's up you are (radians): 100 m on a 50 km planet, the same angle anywhere.
    const ang = Math.atan2(Math.hypot(x, z), y);
    if (ang > F.limit) rebaseTo([x, p.y, z]);
  }

  // ------------------------------------------------------------------ things far away rest
  let farT = 0;
  function rest(dt, now) {
    const w = W();
    if (!F.on || !w) return;
    farT += dt;
    if (farT < 0.25 && !now) return;
    farT = 0;
    const p = w.player;
    const at = p && p.alive ? p.position : [0, 0, 0];
    const far2 = F.far * F.far;
    for (const e of w.entities) {
      if (e._frameFixed || e.isPlayer || e.remotePlayer) continue;
      if (e.physics !== 'dynamic' && !e._cc) { if (e._far) e._far = false; continue; }
      const dx = e.x - at[0], dy = e.y - at[1], dz = e.z - at[2];
      const far = dx * dx + dy * dy + dz * dz > far2;
      if (far !== Boolean(e._far)) { e._far = far; if (!far) e.wake(); else e.velocity = [0, 0, 0]; }
    }
  }

  // ------------------------------------------------------------------ the ground: a curved patch of the planet round you
  /** The ground's colours: the planet's lands (H.planet's BIOME_GLSL), from where each point is on the planet, with a
   *  fine grain fixed to the planet too (its noise repeats every 2048 m, so the frame's origin is passed wrapped). */
  class GroundPlugin extends B.MaterialPluginBase {
    constructor(material) { super(material, 'HpGround', 220, { HP_GROUND: false }, true); this._enable(true); this.st = null; }
    prepareDefines(defines) { defines.HP_GROUND = true; }
    getClassName() { return 'HpGroundPlugin'; }
    getUniforms() {
      const decl = '#ifdef HP_GROUND\nuniform vec4 hpgRx; uniform vec4 hpgRy; uniform vec4 hpgRz; uniform vec4 hpgC; uniform vec4 hpgFine;\n' + P.BIOME_UNIFORMS + '#endif\n';
      return {
        ubo: [{ name: 'hpgRx', size: 4, type: 'vec4' }, { name: 'hpgRy', size: 4, type: 'vec4' }, { name: 'hpgRz', size: 4, type: 'vec4' }, { name: 'hpgC', size: 4, type: 'vec4' }, { name: 'hpgFine', size: 4, type: 'vec4' },
          { name: 'bLand', size: 3, type: 'vec3' }, { name: 'bLand2', size: 3, type: 'vec3' }, { name: 'bSand', size: 3, type: 'vec3' }, { name: 'bRock', size: 3, type: 'vec3' }, { name: 'bSnow', size: 3, type: 'vec3' }],
        vertex: decl, fragment: decl,
      };
    }
    bindForSubMesh(ubo) {
      const s = this.st;
      if (!s) return;
      const x = rot(F.Q, 1, 0, 0), y = rot(F.Q, 0, 1, 0), z = rot(F.Q, 0, 0, 1);
      ubo.updateFloat4('hpgRx', x[0], x[1], x[2], 0);
      ubo.updateFloat4('hpgRy', y[0], y[1], y[2], 0);
      ubo.updateFloat4('hpgRz', z[0], z[1], z[2], 0);
      ubo.updateFloat4('hpgC', F.O[0], F.O[1] + F.R, F.O[2], F.R);
      const wrap = (v) => ((v % 2048) + 2048) % 2048;
      ubo.updateFloat4('hpgFine', wrap(F.O[0]), wrap(F.O[1]), wrap(F.O[2]), 0);
      for (const k of Object.keys(s.colors)) ubo.updateColor3(k, s.colors[k]);
    }
    getCustomCode(type) {
      if (type === 'vertex') {
        return {
          CUSTOM_VERTEX_DEFINITIONS: '#ifdef HP_GROUND\nvarying vec3 vHpBiome;\n' + P.BIOME_GLSL + '\n#endif\n',
          // The lands change over kilometres: worked out per vertex.
          CUSTOM_VERTEX_MAIN_END: '#ifdef HP_GROUND\n{ vec3 hpR = vPositionW.x * hpgRx.xyz + vPositionW.y * hpgRy.xyz + vPositionW.z * hpgRz.xyz; vHpBiome = biome(normalize(hpR + hpgC.xyz), hpgC.w); }\n#endif\n',
        };
      }
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef HP_GROUND\nvarying vec3 vHpBiome;\nfloat hpgHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat hpgNoise(vec3 p, float per) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); vec3 a = mod(i, per), b = mod(i + 1.0, per);\n  return mix(mix(mix(hpgHash(vec3(a.x, a.y, a.z)), hpgHash(vec3(b.x, a.y, a.z)), f.x), mix(hpgHash(vec3(a.x, b.y, a.z)), hpgHash(vec3(b.x, b.y, a.z)), f.x), f.y), mix(mix(hpgHash(vec3(a.x, a.y, b.z)), hpgHash(vec3(b.x, a.y, b.z)), f.x), mix(hpgHash(vec3(a.x, b.y, b.z)), hpgHash(vec3(b.x, b.y, b.z)), f.x), f.y), f.z); }\n#endif\n',
        // The grain underfoot (planet meters, wrapped every 2048 m: the same pattern however the frame has moved).
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: '#ifdef HP_GROUND\n{ vec3 hpF = vPositionW.x * hpgRx.xyz + vPositionW.y * hpgRy.xyz + vPositionW.z * hpgRz.xyz + hpgFine.xyz;\n  float g = hpgNoise(hpF * 0.5, 1024.0) * 0.4 + hpgNoise(hpF * 0.125, 256.0) * 0.35 + hpgNoise(hpF * 0.015625, 32.0) * 0.25;\n  baseColor.rgb = vHpBiome * (0.8 + 0.4 * g); }\n#endif\n',
      };
    }
  }
  /** The patch: rings round the middle, close together near it (a metre) and wider out to its edge (the planet's
   *  curve is exact at every vertex; between them the sag is a few mm near you). Its middle is the frame's origin. */
  function groundMesh(scene, R) {
    const rings = PHONE ? 52 : 72, segs = PHONE ? 112 : 160;
    const edge = Math.min(3000, R * 0.6), a = 5.4, ea = Math.exp(a) - 1;
    const pos = [0, 0, 0], nor = [0, 1, 0], idx = [];
    for (let i = 1; i <= rings; i++) {
      const r = edge * (Math.exp((a * i) / rings) - 1) / ea;
      const y = -(r * r) / (R + Math.sqrt(Math.max(0, R * R - r * r))); // the sphere's drop, without losing precision
      for (let j = 0; j < segs; j++) {
        const t = (j / segs) * Math.PI * 2, x = Math.sin(t) * r, z = Math.cos(t) * r;
        pos.push(x, y, z);
        nor.push(x / R, (y + R) / R, z / R);
      }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + j, 1 + ((j + 1) % segs));
    for (let i = 1; i < rings; i++) {
      const a0 = 1 + (i - 1) * segs, b0 = 1 + i * segs;
      for (let j = 0; j < segs; j++) {
        const j1 = (j + 1) % segs;
        idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
      }
    }
    const m = new B.Mesh('hp-ground', scene);
    const vd = new B.VertexData();
    vd.positions = pos; vd.normals = nor; vd.indices = idx;
    vd.applyToMesh(m);
    return m;
  }
  let ground = null;
  function makeGround(w) {
    const scene = w.scene;
    const mesh = groundMesh(scene, F.R);
    const mat = new B.StandardMaterial('hp-ground', scene);
    mat.diffuseColor = new B.Color3(1, 1, 1);
    mat.specularColor = new B.Color3(0.03, 0.03, 0.03);
    mat.backFaceCulling = false;
    mat.hpNoCurve = true;
    const plug = new GroundPlugin(mat);
    plug.st = { colors: P.biomeColors(P.config.biome || P.BIOMES.earth) };
    mesh.material = mat;
    mesh.receiveShadows = true;
    const e = new L.Entity(mesh, { physics: 'static', name: 'The ground', tag: 'ground', grab: false, friction: 0.8 }, 'planet');
    e.temporary = true; e.keep = true; e.noCull = true; e._frameFixed = true; e.grabbable = false;
    L.place(e, { position: [0, 0, 0], shadow: false });
    H.physics.setShape(e, H.physics.shapes.mesh(e));
    ground = { e, mesh, mat, plug, R: F.R };
    return ground;
  }

  // ------------------------------------------------------------------ each world
  function configure(w) {
    const cf = P.configure ? P.configure() : null;
    const on = Boolean(cf && cf.on && cf.round);
    const R = on ? cf.radius : F.R;
    const changed = on !== F.on || (on && R !== F.R);
    F.on = on;
    F.R = R;
    // Rebased when you've gone this far round (radians): 100 m on a 50 km planet; and things rest past F.far.
    F.limit = Math.max(0.0005, Math.min(0.01, 100 / R));
    F.far = Math.min(1500, R * 0.5);
    H.hooks.space = on ? space : null;
    if (w) w.round = on ? { radius: R } : null;
    return changed;
  }
  H.hooks.scene.push((scene, w) => {
    // A world that reloads around the player (an edit, a hot reload) keeps the frame; a new start is at the start.
    const kept = Boolean(w.keepPose);
    const wasR = F.R, wasOn = F.on;
    configure(w);
    if (!kept || wasOn !== F.on || wasR !== F.R) reset();
    ground = null;
    if (F.on) try { makeGround(w); } catch (err) { H.report(err, 'round world'); }
  });
  H.hooks.world.push({
    enter(w) { if (F.on && !ground) try { makeGround(w); } catch (err) { H.report(err, 'round world'); } },
    ops(ops) {
      const w = W();
      if (!w || !(ops || []).some((o) => o && o.op === 'config' && o.patch && 'planet' in o.patch)) return;
      const cf = P.config;
      const on = Boolean(cf && cf.on && cf.round);
      // Round or flat, or a new size: the world starts again (where things are means something else now).
      if (on !== F.on || (on && cf.radius !== F.R)) { w.restartAsked = true; return; }
      if (ground && ground.plug) ground.plug.st = { colors: P.biomeColors(cf.biome || P.BIOMES.earth) };
    },
    leave() { ground = null; },
  });
  H.hooks.afterStep.push(() => { try { follow(); } catch (err) { H.report(err, 'round world'); } });
  H.hooks.step.push((dt) => rest(dt));

  // The codex's page: a small round world to walk round.
  H.features.register('round planet', {
    apply() {}, change() {}, dispose() {},
    codex: {
      key: 'planet',
      title: 'A round planet', group: 'World features',
      what: 'The whole world is a planet: walk, fly and build all the way round it. Gravity pulls to its middle, things stand up wherever they are, and from high up (fly up: faster the higher you are) you see the ball you were standing on. New games start on one, 50 km across. Here, a tiny one.',
      value: { sphere: true, radius: 400, biome: 'earth' },
      fields: [['sphere', 'true: the world is round (walk, fly and build all the way round)', 'false'], ['radius', 'meters (a new game: 50000; at least 200)', '50000'], ['biome', 'its lands: earth, forest, desert, ice, alien...', 'earth'], ['clouds', '0-1, seen from high up', 'by biome'], ['air', "the air's scale height (m): space begins about 10 km up", '1800']],
    },
  });

  P.frame = {
    /** Whether the world is round (and this frame is in use). */
    get on() { return F.on; },
    /** Where the frame's origin is on the planet (planet meters) and how many times it has moved. */
    get origin() { return F.O.slice(); },
    get rebases() { return F.rebases; },
    /** The frame's turn, local -> planet (a copy). */
    get rotation() { return F.Q.clone(); },
    toPlanet, toLocal, dirToPlanet,
    dirToLocal: (d) => { const v = vec(d); return rot(F.Qi, v[0], v[1], v[2]); },
    /** The planet -> local turn (for things drawn fixed to the planet: the ball in the far layer). */
    toLocalQ: () => F.Qi,
    fromScene, toScene, upright,
    /** fn(tr, world) after the frame moved: tr.point(p), tr.dir(v), tr.quat(q) turn what a module keeps. */
    onRebase(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    /** Moves the frame now (to the player, or to a point around you). */
    rebase(at) { const w = W(); rebaseTo(at || (w && w.player ? w.player.position : [0, 0, 0])); },
    get limit() { return F.limit; },
    get far() { return F.far; },
  };
})();
