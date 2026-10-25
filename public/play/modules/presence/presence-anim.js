// Presence, part 1e: animation clips as data (docs/animations.md). One clip format serves three rig classes, one file each in
// public/play/anim/<class>.json:
//   mixamo      a biped on the standard Mixamo skeleton (mixamorig:Hips, Spine, Spine1, Spine2, Neck, Head, LeftShoulder, LeftArm,
//               LeftForeArm, LeftHand and fingers, LeftUpLeg, LeftLeg, LeftFoot, LeftToeBase, the same on the right). `mixamorig:`,
//               `mixamorig7:`, `mixamorig_` and unprefixed names are the same bone.
//   quadruped   the template rig of dog, fox, sheep and horse: Root, Body, Head, LegFL/FR/BL/BR (each with a Tip), ArmL/ArmR (with Tip).
//   object      a rigid thing: one `Body`, which is the whole body (the rig's mover: anchors, hats and the rest follow it).
// A file is { class, clips: { name: { loop, seconds, ease, tracks, events } } }. A track is a bone with keys (t is 0 to 1 of the clip):
//   rot [[t, rx, ry, rz]] degrees (applied z, then x, then y: Babylon's yaw/pitch/roll), or q [[t, x, y, z, w]]
//   pos [[t, x, y, z]]    Hips / Root / Body only, in model heights (0.05 is 5% of the character's height: any size takes it)
//   scl [[t, sx, sy, sz]] Hips / Root / Body only
// All of them are DELTAS FROM THE MODEL'S REST POSE, in the model's axes at rest (glTF: y up, front +z, x the character's LEFT):
// local = restParentWorld^-1 * delta * restParentWorld * restLocal. So rx > 0 pitches a hanging limb back and nods a head down, ry > 0
// turns toward the character's left, rz > 0 rolls to the character's right, whatever the bone's own axes are (the template rigs'
// legs are turned 130 degrees, and a clip never knows). Mixamo's own library clips are absolute local rotations; `toDelta` converts one.
// A clip names a bone the model has or it does nothing for that bone; a bone a clip does not name stays at rest (or where another
// layer puts it).
//
// REST POSES. Mixamo clips assume Mixamo's T-pose. A re-rigged model (Gen's mesh.rig, MIA) may rest in another pose, so on binding
// the arms and legs are measured: each limb bone's direction at rest (to its child) is compared with the Mixamo one (arms along
// +/-x, legs down) and the difference becomes a fix (`fix`, a world rotation per bone) put before every clip delta, so a clip
// reads the same on an A-pose, a T-pose or a bent-knee rest. A row can set `restFix: false` (none) or `{ LeftArm: [rx, ry, rz] }`
// (degrees, instead of the measured one) for a model the measuring gets wrong. The quadruped and the object have one rest each
// (their template), so nothing is measured for them.
//
// PLAYING. A Player blends clips over FADE (0.15 s): one looping layer for what the body is doing (idle, walk, run, jump, fall,
// swim, drive), one-shots over it for emotes and takes (a one-shot moves only the bones it names), roles to clip names with
// fallbacks (`ROLE_CLIPS`). A role with no clip in the set is left to presence-models.js: the model's own GLB clip, then the
// procedural motion by form. Events in a clip (footstep, hop, a prop pop) are told to the listeners of `P.anim.on`.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const P = (H.presence = H.presence || {});
  const FADE = 0.15;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ------------------------------------------------------------------ the class skeletons
  const side = (pre) => ['Shoulder', 'Arm', 'ForeArm', 'Hand', ...['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((f) => [1, 2, 3, 4].map((i) => `Hand${f}${i}`)), 'UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End'].map((b) => pre + b);
  const MIXAMO_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End', ...side('Left'), ...side('Right')];
  const QUAD_BONES = ['Root', 'Body', 'Head', 'LegFL', 'LegFLTip', 'LegFR', 'LegFRTip', 'LegBL', 'LegBLTip', 'LegBR', 'LegBRTip', 'ArmL', 'ArmLTip', 'ArmR', 'ArmRTip'];
  /** bones: every name a clip may use; need: the bones a model must have for the set to fit it; moves: where pos and scl are allowed. */
  const CLASSES = {
    mixamo: { bones: MIXAMO_BONES, need: ['Hips', 'Spine', 'Head', 'LeftArm', 'LeftForeArm', 'RightArm', 'RightForeArm', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'], moves: ['Hips'] },
    quadruped: { bones: QUAD_BONES, need: ['Root', 'Body', 'Head', 'LegFL', 'LegFLTip', 'LegFR', 'LegFRTip', 'LegBL', 'LegBLTip', 'LegBR', 'LegBRTip'], moves: ['Root', 'Body'] },
    object: { bones: ['Body', 'ToastL', 'ToastR'], need: [], moves: ['Body', 'ToastL', 'ToastR'], parts: ['ToastL', 'ToastR'] },
  };
  /** The class a registry row uses: its `rig`, else from its form (a roller or a swimmer keeps its own procedural motion). */
  const FORM_CLASS = { biped: 'mixamo', bird: 'mixamo', quadruped: 'quadruped', thing: 'object', legless: 'object' };
  const classOf = (ent) => (ent.rig && ent.rig !== 'none' ? (CLASSES[ent.rig] ? ent.rig : null) : ent.rig === 'none' ? null : FORM_CLASS[ent.form] || null);
  /** A bone's name as the class writes it: Mixamo's prefix (mixamorig:, mixamorig7:, mixamorig_) is taken off. */
  const norm = (name) => String(name).replace(/^mixamorig\d*[:_]?/i, '');
  const EASES = ['linear', 'smooth', 'spline'];

  /** Which roles and emotes take which clips, first found wins. An emote is its own name. */
  /** Metres a clip's cycle covers when a row has no stride of its own for it: the walk and run are the registry's, a trot is between them. */
  const TROT_AT = 2.4, STRIDE_TROT = 2.2;
  const ROLE_CLIPS = { idle: ['idle'], walk: ['walk', 'run'], run: ['run', 'walk'], jump: ['jump', 'fall'], fall: ['fall', 'jump'], swim: ['swim'], drive: ['drive', 'sit'], sit: ['sit'] };

  // ------------------------------------------------------------------ quaternions [x, y, z, w] (Hamilton: a * b is b first)
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qinv = (a) => [-a[0], -a[1], -a[2], a[3]];
  const qnorm = (a) => { const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1; return [a[0] / l, a[1] / l, a[2] / l, a[3] / l]; };
  const QI = [0, 0, 0, 1];
  const qaxis = (x, y, z, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return [x * s, y * s, z * s, Math.cos(h)]; };
  /** Euler degrees to a quaternion: z first, then x, then y (the same as BABYLON.Quaternion.RotationYawPitchRoll(y, x, z)). */
  const qeuler = (rx, ry, rz) => qmul(qaxis(0, 1, 0, ry), qmul(qaxis(1, 0, 0, rx), qaxis(0, 0, 1, rz)));
  const qrot = (q, v) => { const [x, y, z, w] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]; return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]]; };
  /** The shortest turn taking direction a to direction b (unit vectors). */
  function qfromto(a, b) {
    const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (d < -0.999999) { const ax = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const c = [a[1] * ax[2] - a[2] * ax[1], a[2] * ax[0] - a[0] * ax[2], a[0] * ax[1] - a[1] * ax[0]]; return qnorm([c[0], c[1], c[2], 0]); }
    return qnorm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + d]);
  }
  /** Blend a toward b by k (normalised lerp along the short way). */
  function qblend(a, b, k) {
    const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1;
    return qnorm([a[0] + (s * b[0] - a[0]) * k, a[1] + (s * b[1] - a[1]) * k, a[2] + (s * b[2] - a[2]) * k, a[3] + (s * b[3] - a[3]) * k]);
  }
  const qangle = (q) => 2 * Math.acos(clamp(Math.abs(q[3]), 0, 1)) * 180 / Math.PI;

  // ------------------------------------------------------------------ clips: checking, compiling, sampling
  /** The problems of a class file (empty when it is sound): unknown bones, bad keys, a move on a bone that may not move. */
  function validate(cls, data) {
    const out = [], C = CLASSES[cls];
    if (!C) return [`unknown class "${cls}"`];
    if (!data || typeof data !== 'object' || !data.clips || typeof data.clips !== 'object') return ['no clips'];
    if (data.class !== cls) out.push(`class is "${data.class}", not "${cls}"`);
    const known = new Set(C.bones.map((b) => b.toLowerCase()));
    for (const [name, clip] of Object.entries(data.clips)) {
      const at = `clip "${name}"`;
      if (!(clip.seconds > 0)) out.push(`${at}: seconds must be more than 0`);
      if (typeof clip.loop !== 'boolean') out.push(`${at}: loop must be true or false`);
      if (clip.ease !== undefined && !EASES.includes(clip.ease)) out.push(`${at}: ease "${clip.ease}" is not one of ${EASES.join(', ')}`);
      if (!clip.tracks || typeof clip.tracks !== 'object' || !Object.keys(clip.tracks).length) out.push(`${at}: no tracks`);
      for (const [bone, tr] of Object.entries(clip.tracks || {})) {
        const b = norm(bone);
        if (!known.has(b.toLowerCase())) out.push(`${at}: the ${cls} skeleton has no bone "${bone}"`);
        if (tr.rot && tr.q) out.push(`${at}: ${bone} has both rot and q`);
        for (const [kind, width] of [['rot', 4], ['q', 5], ['pos', 4], ['scl', 4]]) {
          const keys = tr[kind];
          if (keys === undefined) continue;
          if ((kind === 'pos' || kind === 'scl') && !C.moves.some((m) => m.toLowerCase() === b.toLowerCase())) out.push(`${at}: ${bone} cannot have ${kind} (only ${C.moves.join(', ')} move)`);
          if (!Array.isArray(keys) || !keys.length) { out.push(`${at}: ${bone}.${kind} has no keys`); continue; }
          let last = -1;
          for (const k of keys) {
            if (!Array.isArray(k) || k.length !== width || !k.every(Number.isFinite)) { out.push(`${at}: ${bone}.${kind} key ${JSON.stringify(k)} needs ${width} numbers`); break; }
            if (k[0] < 0 || k[0] > 1 || k[0] <= last) { out.push(`${at}: ${bone}.${kind} times must rise within 0 to 1 (at ${k[0]})`); break; }
            last = k[0];
          }
        }
        if (!tr.rot && !tr.q && !tr.pos && !tr.scl) out.push(`${at}: ${bone} has no keys`);
      }
      for (const ev of clip.events || []) if (!(ev && typeof ev.name === 'string' && ev.t >= 0 && ev.t <= 1)) out.push(`${at}: an event needs a name and a time from 0 to 1`);
    }
    return out;
  }

  /** The clip ready to sample: tracks as a list by normalised bone, cached on the clip. */
  function compile(clip) {
    if (clip._c) return clip._c;
    const tracks = [];
    for (const [bone, tr] of Object.entries(clip.tracks || {})) tracks.push({ bone: norm(bone), rot: tr.rot || null, q: tr.q || null, pos: tr.pos || null, scl: tr.scl || null });
    const events = (clip.events || []).slice().sort((a, b) => a.t - b.t);
    return (clip._c = { tracks, events, loop: clip.loop !== false, seconds: clip.seconds || 1, air: clip.air === true, fade: clip.fade > 0 ? clip.fade : 0, ease: clip.ease || (clip.loop === false ? 'smooth' : 'spline'), bones: new Set(tracks.map((t) => t.bone)) });
  }

  /** The values of a key list at u (0 to 1): n numbers after the time. A looping clip wraps from its last key to its first. */
  function evalKeys(keys, n, u, loop, ease) {
    const m = keys.length, out = new Array(n);
    const flat = (k) => { for (let c = 0; c < n; c++) out[c] = k[1 + c]; return out; };
    if (m === 1 || (!loop && u <= keys[0][0])) return flat(keys[0]);
    if (!loop && u >= keys[m - 1][0]) return flat(keys[m - 1]);
    const idx = (j) => (loop ? ((j % m) + m) % m : clamp(j, 0, m - 1));
    const T = (j) => keys[idx(j)][0] + (loop ? (j < 0 ? -1 : j >= m ? 1 : 0) : 0);
    let i = -1; // the segment is key i to key i + 1 (-1: the last key, a lap earlier)
    for (let k = 0; k < m; k++) if (keys[k][0] <= u) i = k;
    const t0 = T(i), t1 = T(i + 1), a = t1 > t0 ? clamp((u - t0) / (t1 - t0), 0, 1) : 0;
    const p0 = keys[idx(i - 1)], p1 = keys[idx(i)], p2 = keys[idx(i + 1)], p3 = keys[idx(i + 2)];
    if (ease === 'linear') { for (let c = 0; c < n; c++) out[c] = p1[1 + c] + (p2[1 + c] - p1[1 + c]) * a; return out; }
    if (ease === 'smooth') { const s = a * a * (3 - 2 * a); for (let c = 0; c < n; c++) out[c] = p1[1 + c] + (p2[1 + c] - p1[1 + c]) * s; return out; }
    const a2 = a * a, a3 = a2 * a; // Catmull-Rom through the keys: no stop at each one
    for (let c = 0; c < n; c++) out[c] = 0.5 * ((2 * p1[1 + c]) + (-p0[1 + c] + p2[1 + c]) * a + (2 * p0[1 + c] - 5 * p1[1 + c] + 4 * p2[1 + c] - p3[1 + c]) * a2 + (-p0[1 + c] + 3 * p1[1 + c] - 3 * p2[1 + c] + p3[1 + c]) * a3);
    return out;
  }
  /** A compiled clip at u: Map(bone -> { q, p, s }) with only what the clip keys. */
  function sampleClip(c, u) {
    const out = new Map();
    out.air = c.air ? 1 : 0; // (a clip where the body leaves the ground: nothing holds it down)
    for (const tr of c.tracks) {
      const o = { q: null, p: null, s: null };
      if (tr.rot) { const e = evalKeys(tr.rot, 3, u, c.loop, c.ease); o.q = qeuler(e[0], e[1], e[2]); }
      else if (tr.q) { const e = evalKeys(tr.q, 4, u, c.loop, c.ease === 'spline' ? 'smooth' : c.ease); o.q = qnorm(e); }
      if (tr.pos) o.p = evalKeys(tr.pos, 3, u, c.loop, c.ease);
      if (tr.scl) o.s = evalKeys(tr.scl, 3, u, c.loop, c.ease);
      out.set(tr.bone, o);
    }
    return out;
  }
  /** A Mixamo library clip rotation (absolute, local) to the delta this format wants: delta = rp * (abs * rest^-1) * rp^-1, rp the parent's rest in the model's axes. */
  const toDelta = (abs, rest, rp) => qmul(rp, qmul(qmul(abs, qinv(rest)), qinv(rp)));

  // ------------------------------------------------------------------ the sets (the files) and getting them
  const data = {}; // class -> the file, once it has loaded
  const sets = {}; // class -> { clips: name -> compiled clip, names, problems }
  const loading = {};
  const listeners = [];
  function setData(cls, file) {
    const problems = validate(cls, file);
    const clips = {};
    if (file && file.clips) for (const [n, c] of Object.entries(file.clips)) { try { clips[n] = compile(c); } catch { /* a bad clip is a problem above */ } }
    sets[cls] = { cls, clips, names: Object.keys(clips), problems, file };
    data[cls] = file;
    return sets[cls];
  }
  /** Starts fetching a class's file once. The promise settles when it is there (or failed: the model then moves as before). */
  function load(cls, fetcher) {
    if (sets[cls]) return Promise.resolve(sets[cls]);
    if (loading[cls]) return loading[cls];
    const get = fetcher || ((c) => fetch(`/play/anim/${c}.json`).then((r) => { if (!r.ok) throw new Error(`anim ${c}: ${r.status}`); return r.json(); }));
    let p;
    try { p = Promise.resolve(get(cls)); } catch (e) { p = Promise.reject(e); }
    return (loading[cls] = p.then((f) => setData(cls, f), (e) => { loading[cls] = null; if (H.report) H.report(e, 'presence-anim'); return null; }));
  }
  const setOf = (cls) => sets[cls] || null;

  // ------------------------------------------------------------------ binding: a clip's bones to a model's nodes
  const quatOf = (n) => (n.rotationQuaternion ? [n.rotationQuaternion.x, n.rotationQuaternion.y, n.rotationQuaternion.z, n.rotationQuaternion.w] : (() => { const q = BABYLON.Quaternion.FromEulerAngles(n.rotation.x, n.rotation.y, n.rotation.z); return [q.x, q.y, q.z, q.w]; })());
  /** Directions the Mixamo T-pose has, bone to its child: what a model's rest is measured against. */
  const CANON = (() => { const o = []; for (const [s, x] of [['Left', 1], ['Right', -1]]) { o.push([`${s}Arm`, `${s}ForeArm`, [x, 0, 0]], [`${s}ForeArm`, `${s}Hand`, [x, 0, 0]], [`${s}UpLeg`, `${s}Leg`, [0, -1, 0]], [`${s}Leg`, `${s}Foot`, [0, -1, 0]]); } return o; })();

  /**
   * Finds a class's bones in a model's nodes (the roots a level was instanced under) and measures their rest.
   * Returns { cls, fit, missing, bones: Map(name -> { n, name, restQ, restP, restS, rpi, wrest, fix }) , unit }.
   */
  function bind(roots, cls, o = {}) {
    const C = CLASSES[cls], stop = new Set(roots), nodes = new Map();
    // (bones are transform nodes: a mesh called "body" or "head" is not the bone, and an exact name beats one that differs in case)
    const visit = (n) => { if (typeof n.getTotalIndices !== 'function') { const k = norm(n.name).toLowerCase(); if (!nodes.has(k) || norm(n.name) === C.bones.find((x) => x.toLowerCase() === k)) nodes.set(k, n); } for (const c of n.getChildren(undefined, true)) visit(c); };
    for (const r of roots) for (const c of r.getChildren(undefined, true)) visit(c);
    const b = { cls, bones: new Map(), unit: o.unit || 1, virtual: cls === 'object', fit: false, missing: [] };
    if (cls === 'object') { b.fit = true; return b; }
    b.missing = C.need.filter((n) => !nodes.has(n.toLowerCase()));
    b.fit = b.missing.length === 0;
    if (!b.fit) return b;
    const world = new Map(); // node -> { q, p } at rest, in the model's axes (the loader's own root is not part of it)
    const wof = (n) => {
      if (!n || stop.has(n)) return { q: QI, p: [0, 0, 0] };
      if (world.has(n)) return world.get(n);
      const par = wof(n.parent), q = quatOf(n), t = n.position, d = qrot(par.q, [t.x, t.y, t.z]);
      const r = { q: qmul(par.q, q), p: [par.p[0] + d[0], par.p[1] + d[1], par.p[2] + d[2]] };
      world.set(n, r);
      return r;
    };
    for (const name of C.bones) {
      const n = nodes.get(name.toLowerCase());
      if (!n) continue;
      const par = wof(n.parent), restQ = quatOf(n);
      b.bones.set(name, { n, name, restQ, restP: [n.position.x, n.position.y, n.position.z], restS: n.scaling ? [n.scaling.x, n.scaling.y, n.scaling.z] : [1, 1, 1], rpi: qinv(par.q), wrest: qmul(par.q, restQ), fix: QI, moves: C.moves.includes(name) });
    }
    // rest-pose fixes (mixamo): a limb's measured direction to the Mixamo one; a row's own `restFix` instead
    if (cls === 'mixamo' && o.restFix !== false) {
      const own = o.restFix && typeof o.restFix === 'object' ? o.restFix : null;
      const fixOf = new Map();
      for (const [bone, child, dir] of CANON) {
        const bb = b.bones.get(bone), cb = b.bones.get(child);
        if (!bb || !cb) continue;
        let total;
        if (own && own[bone]) total = qeuler(...own[bone]);
        else if (own) continue;
        else {
          const a = wof(bb.n).p, c = wof(cb.n).p, v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], l = Math.hypot(...v);
          if (l < 1e-6) continue;
          total = qfromto([v[0] / l, v[1] / l, v[2] / l], dir);
          if (qangle(total) < 2) continue;
        }
        // (a child rides on its parent's fix: its own is what is left after that)
        const par = bb.n.parent && [...b.bones.values()].find((x) => x.n === bb.n.parent);
        const pf = par && fixOf.get(par.name) ? fixOf.get(par.name) : QI;
        bb.fix = own && own[bone] ? total : qmul(qinv(pf), total);
        fixOf.set(bone, bb.fix);
      }
    }
    return b;
  }

  /** Puts a pose (Map bone -> { q, p, s }) on a binding's nodes; bones it left alone since last time go back to rest. */
  function apply(b, pose) {
    for (const [name, v] of pose) {
      const bb = b.bones.get(name);
      if (!bb) continue;
      const d = qmul(v.q || QI, bb.fix);
      const q = qmul(bb.rpi, qmul(d, bb.wrest));
      const nq = bb.n.rotationQuaternion || (bb.n.rotationQuaternion = new BABYLON.Quaternion());
      nq.set(q[0], q[1], q[2], q[3]);
      if (bb.moves) {
        if (v.p) { const t = qrot(bb.rpi, [v.p[0] * b.unit, v.p[1] * b.unit, v.p[2] * b.unit]); bb.n.position.set(bb.restP[0] + t[0], bb.restP[1] + t[1], bb.restP[2] + t[2]); }
        else bb.n.position.set(bb.restP[0], bb.restP[1], bb.restP[2]);
        if (v.s) bb.n.scaling.set(bb.restS[0] * v.s[0], bb.restS[1] * v.s[1], bb.restS[2] * v.s[2]);
      }
    }
    if (b.last) for (const name of b.last) if (!pose.has(name)) rest(b.bones.get(name));
    b.last = new Set(pose.keys());
  }
  function rest(bb) {
    if (!bb) return;
    const nq = bb.n.rotationQuaternion || (bb.n.rotationQuaternion = new BABYLON.Quaternion());
    nq.set(bb.restQ[0], bb.restQ[1], bb.restQ[2], bb.restQ[3]);
    bb.n.position.set(bb.restP[0], bb.restP[1], bb.restP[2]);
    if (bb.n.scaling) bb.n.scaling.set(bb.restS[0], bb.restS[1], bb.restS[2]);
  }
  function release(b) { if (b && b.last) { for (const name of b.last) rest(b.bones.get(name)); b.last = null; } }

  // ------------------------------------------------------------------ the player: layers, blends, one-shots, events
  class Player {
    constructor(set) { this.set = set; this.loops = []; this.shots = []; this.lastShot = null; }
    clip(name) { return this.set.clips[name] || null; }
    /** Moves time on by dt: `loop` { name, rate } is what the body is doing, `shot` { key, name } an emote or a take over it. Returns the events passed. */
    update(dt, loop, shot, emit) {
      const fire = (c, name, u0, u1) => { if (!c.events.length || !emit) return; for (const ev of c.events) if (u1 >= u0 ? ev.t > u0 && ev.t <= u1 : ev.t > u0 || ev.t <= u1) emit(ev, name); };
      // the looping layer: a new name fades in over FADE while the old fades out
      if (loop && (!this.loops.length || this.loops[this.loops.length - 1].name !== loop.name)) {
        const c = this.clip(loop.name);
        if (c) this.loops.push({ name: loop.name, c, u: 0, w: this.loops.length ? 0 : 1, rate: 1 });
      }
      const top = this.loops[this.loops.length - 1];
      for (const L of this.loops) {
        L.rate = L === top && loop ? loop.rate : L.rate;
        const u0 = L.u, adv = dt * L.rate / L.c.seconds;
        L.u = L.c.loop ? (L.u + adv) % 1 : Math.min(1, L.u + adv);
        if (L.c.loop || L.u > u0) fire(L.c, L.name, u0, L.u);
        L.w = L === top ? Math.min(1, L.w + dt / FADE) : Math.max(0, L.w - dt / FADE);
      }
      this.loops = this.loops.filter((L) => L === top || L.w > 0);
      // one-shots: a new key starts one; the others leave
      if (shot && (!this.lastShot || this.lastShot !== shot.key)) {
        const c = this.clip(shot.name);
        if (c) { for (const S of this.shots) S.out = true; this.shots.push({ key: shot.key, name: shot.name, c, u: 0, w: 0, out: false }); this.lastShot = shot.key; }
      } else if (!shot) this.lastShot = null;
      for (const S of this.shots) {
        if (!shot || shot.key !== S.key) S.out = true;
        const u0 = S.u, adv = dt / S.c.seconds;
        S.u = S.c.loop ? (S.u + adv) % 1 : Math.min(1, S.u + adv);
        if (S.c.loop || S.u > u0) fire(S.c, S.name, u0, S.u);
        const fade = S.c.fade || FADE; // (a clip that is a moment, a landing's squash, says how quick: `fade` seconds)
        if (!S.c.loop && S.u >= 1 - fade / S.c.seconds) S.out = true;
        S.w = S.out ? Math.max(0, S.w - dt / fade) : Math.min(1, S.w + dt / fade);
      }
      this.shots = this.shots.filter((S) => S.w > 0 || !S.out);
      return this;
    }
    /** The pose now: the loops blended by their weights, each one-shot laid over it by its weight on the bones it keys. */
    pose() {
      const out = new Map(), sum = this.loops.reduce((n, L) => n + L.w, 0) || 1;
      out.air = this.loops.reduce((n, L) => n + (L.c.air ? L.w / sum : 0), 0);
      const base = this.loops.map((L) => ({ w: L.w / sum, s: sampleClip(L.c, L.u) }));
      const bones = new Set();
      for (const L of this.loops) for (const k of L.c.bones) bones.add(k);
      for (const S of this.shots) for (const k of S.c.bones) bones.add(k);
      for (const k of bones) {
        let q = null, p = null, s = null, wq = 0;
        for (const { w, s: m } of base) {
          const v = m.get(k) || { q: null, p: null, s: null };
          const vq = v.q || QI;
          q = q ? qblend(q, vq, w / (wq + w || 1)) : vq; wq += w;
          if (v.p || p) { p = p || [0, 0, 0]; const vp = v.p || [0, 0, 0]; p = p.map((x, i) => x + vp[i] * w); }
          if (v.s || s) { s = s || [1, 1, 1]; const vs = v.s || [1, 1, 1]; s = s.map((x, i) => x + (vs[i] - 1) * w); }
        }
        out.set(k, { q: q || QI, p, s });
      }
      for (const S of this.shots) {
        const m = sampleClip(S.c, S.u), k = S.w;
        if (S.c.bones.has('Body')) out.air += ((S.c.air ? 1 : 0) - out.air) * k;
        for (const [bone, v] of m) {
          const cur = out.get(bone) || { q: QI, p: null, s: null };
          out.set(bone, { q: v.q ? qblend(cur.q, v.q, k) : cur.q, p: v.p ? (cur.p || [0, 0, 0]).map((x, i) => x + (v.p[i] - x) * k) : cur.p, s: v.s ? (cur.s || [1, 1, 1]).map((x, i) => x + (v.s[i] - x) * k) : cur.s });
        }
      }
      return out;
    }
  }

  // ------------------------------------------------------------------ on a model (presence-models.js calls these)
  /** Gives a rig's model the data clips of its class, when it has one (and starts loading the file). */
  function attach(rig, pm) {
    const cls = classOf(pm.ent);
    if (!cls) { pm.anim = null; return; }
    pm.anim = { cls, player: null, binds: new Map(), state: 'loading', events: [] };
    load(cls);
  }
  function bindingFor(pm, lvl) {
    const A = pm.anim;
    if (A.binds.has(lvl)) return A.binds.get(lvl);
    const b = bind(lvl.roots, A.cls, { unit: pm.ent.h / (pm.k || 1), restFix: pm.ent.restFix });
    A.binds.set(lvl, b);
    if (!b.fit) { A.state = 'unfit'; A.missing = b.missing; }
    return b;
  }
  /** A body that keeps its own gait (the fish's swim, the roll-bot's roll: a row's `keepGait`) takes the set only for standing, emotes and a hurt. */
  const OWN_GAIT = new Set(['walk', 'run', 'jump_start', 'jump', 'land', 'fall', 'swim', 'drive', 'knock_down', 'get_up']);
  const keepsGait = (ent, clipName) => Boolean(ent && ent.keepGait && OWN_GAIT.has(clipName));
  const hasClip = (A, name) => Boolean(A.player && A.player.clip(name));
  /** Which clip of the set a role takes, first found of its names (or null). */
  function roleClip(set, role, glb) {
    if (set.clips[role]) return role;
    if (glb) return null; // (the model's own clip for this role is next, before the set's stand-in: run is not walk if the file has a run)
    for (const n of ROLE_CLIPS[role] || [role]) if (set.clips[n]) return n;
    return null;
  }
  /**
   * One frame of data animation. ctx { dt, role, em, speed, glb, glbEmote, took, landed, stride }. Returns null when the set does not
   * move this body (not loaded, does not fit, no clip for this: the caller falls back), else { driven: true, emote, body }:
   * `body` is the object class's Body as { x, y, z (meters), rx, ry, rz (radians), sx, sy, sz }, else null.
   */
  function drive(rig, pm, lvl, ctx) {
    const A = pm.anim;
    if (!A || A.state === 'unfit') return null;
    const set = setOf(A.cls);
    if (!set) return null;
    const b = bindingFor(pm, lvl);
    if (!b.fit) return null;
    if (!A.player) A.player = new Player(set);
    const forced = rig.forceClip;
    if (forced && keepsGait(pm.ent, forced.name)) return null;
    let loop = null, shot = null, emote = false;
    if (forced) {
      const c = set.clips[forced.name];
      if (!c) return null;
      const pose = sampleClip(c, c.loop ? ((forced.t / c.seconds) % 1 + 1) % 1 : clamp(forced.t / c.seconds, 0, 1));
      A.player.loops = []; A.player.shots = []; A.player.lastShot = null;
      return finish(pm, b, pose);
    }
    const { role, em } = ctx;
    if (pm.ent.keepGait && role !== 'idle' && OWN_GAIT.has(role)) { release(b); A.player.loops = []; A.player.shots = []; return null; }
    if (em) {
      if (set.clips[em.def.name]) { shot = { key: em, name: em.def.name }; emote = true; }
      else if (ctx.glbEmote) { release(b); A.player.loops = []; A.player.shots = []; return null; } // (the model's own emote clip has the body)
    }
    // standing still for 8 to 12 s: the set's idle_sniff (a loop for a few seconds) or idle_fidget (a one-shot) plays once
    if (role === 'idle' && !em && !A.take) {
      if (A.sniff) { A.sniff.t += ctx.dt; if (A.sniff.t >= set.clips.idle_sniff.seconds) A.sniff = null; }
      else if (set.clips.idle_sniff || set.clips.idle_fidget) {
        A.idleT = (A.idleT || 0) + ctx.dt;
        if (A.idleNext === undefined) A.idleNext = 8 + Math.random() * 4;
        if (A.idleT >= A.idleNext) {
          A.idleT = 0; A.idleNext = 8 + Math.random() * 4;
          const picks = ['idle_sniff', 'idle_fidget'].filter((n) => set.clips[n]), n = picks[Math.floor(Math.random() * picks.length)];
          if (n === 'idle_sniff') A.sniff = { t: 0 }; else A.take = { key: {}, name: n, t: 0, idle: true };
        }
      }
    } else if (role !== 'idle') { A.idleT = 0; A.sniff = null; if (A.take && A.take.idle) A.take = null; }
    // a take-off and a landing are one-shots when the set has them (jump_start, land) over the role's loop
    if (ctx.took && set.clips.jump_start) A.take = { key: {}, name: 'jump_start', t: 0 };
    if (ctx.landed && set.clips.land) A.take = { key: {}, name: 'land', t: 0 };
    if (A.take) { A.take.t += ctx.dt; if (A.take.t >= set.clips[A.take.name].seconds) A.take = null; else if (!shot) shot = A.take; }
    let name = roleClip(set, role, ctx.glb);
    if (name === 'walk' && set.clips.trot && ctx.speed > TROT_AT) name = 'trot'; // (a quicker diagonal gait between the walk and the run)
    if (name === 'idle' && A.sniff) name = 'idle_sniff';
    if (name) {
      const walkish = name === 'walk' || name === 'trot' || name === 'run';
      loop = { name, rate: walkish ? clamp(ctx.speed / (ctx.stride[name] || (name === 'trot' ? STRIDE_TROT : ctx.stride.walk)), 0.4, 2.5) : 1 };
    } else if (!shot) { release(b); A.player.loops = []; A.player.shots = []; return null; }
    if (!loop && shot && !A.player.loops.length) { const idle = roleClip(set, 'idle', false); if (idle) loop = { name: idle, rate: 1 }; }
    const ev = A.events; ev.length = 0;
    A.player.update(ctx.dt, loop, shot, (e, clipName) => ev.push({ ...e, clip: clipName }));
    if (ev.length) for (const e of ev) for (const f of listeners) { try { f(e.name, rig, e); } catch { /* a listener's error is its own */ } }
    return finish(pm, b, A.player.pose(), emote);
  }
  /** How this model takes the toaster's clips: `hop` and `sway` multiply the clip's hop and lean (a row's `motion` sets them, else its proportions do). */
  function motionOf(pm) {
    if (pm.motion) return pm.motion;
    const b = pm.b, ent = pm.ent;
    let hop = 1, sway = 1;
    if (b) {
      const H = Math.max(1e-3, b.max.y - b.min.y), W = Math.max(b.max.x - b.min.x, b.max.z - b.min.z, 1e-3);
      sway = clamp(Math.pow(0.9 / (H / W), 0.6), 0.45, 1.3); // (the toaster is 0.91 tall and 1.0 wide: 1)
      hop = clamp(Math.sqrt(W / H) / 1.05, 0.55, 1.2);
    }
    if (ent.form === 'legless') { sway *= 1.4; hop *= 0.7; } // the duck waddles low and wide
    return (pm.motion = { hop: ent.motion && ent.motion.hop || hop, sway: ent.motion && ent.motion.sway || sway });
  }
  /** Whether the set owns the take-off, the landing and the stretch of this body (it has the clips), so models.js leaves its own out. */
  const A_own = (pm) => { const s = pm.anim && setOf(pm.anim.cls); return Boolean(s && s.clips.jump_start && s.clips.land && !pm.ent.keepGait); };
  /**
   * How far the body must go up (or down) so that its box, leaning as it does, rests on the ground: the box's lowest point after the
   * turn, against the half height it had upright (models.js already holds the bottom still while it squashes). A toaster rocking
   * on its waddle rocks over a corner; one knocked on its side lies on the floor and goes through nothing.
   */
  function groundSnap(pm, q, s) {
    const b = pm.b, k = pm.k;
    if (!b || !k) return 0;
    const hx = (b.max.x - b.min.x) / 2 * k, hy = pm.ent.h / 2, hz = (b.max.z - b.min.z) / 2 * k, sxz = 1 / Math.sqrt(s[1]);
    const ax = new BABYLON.Vector3(1, 0, 0).rotateByQuaternionToRef(q, new BABYLON.Vector3()), ay = new BABYLON.Vector3(0, 1, 0).rotateByQuaternionToRef(q, new BABYLON.Vector3()), az = new BABYLON.Vector3(0, 0, 1).rotateByQuaternionToRef(q, new BABYLON.Vector3());
    const low = Math.abs(ax.y) * hx * sxz * s[0] * Math.sqrt(s[1]) + Math.abs(ay.y) * hy * s[1] + Math.abs(az.y) * hz * sxz * s[2] * Math.sqrt(s[1]);
    return low - hy * s[1];
  }
  function finish(pm, b, pose, emote = false) {
    if (b.virtual) {
      const parts = {};
      for (const name of CLASSES.object.parts) {
        const w = pose.get(name);
        if (w) { const wq = w.q || QI, e = new BABYLON.Quaternion(wq[0], wq[1], wq[2], wq[3]).toEulerAngles(), p = w.p || [0, 0, 0]; parts[name] = { x: p[0], y: p[1], z: p[2], rx: e.x, ry: e.y, rz: e.z }; }
      }
      const v = pose.get('Body'), own = Boolean(A_own(pm));
      if (!v) return { driven: true, emote, own, parts, body: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 } };
      // The clip is in model heights and for the toaster's proportions: the hop and the sway follow this model's (a tall thin cactus
      // sways less than a wide toaster, a long shoe hops more, a duck waddles), and the body is held on the ground however it leans.
      const m = motionOf(pm), h = pm.ent.h, vq = v.q || QI, e = new BABYLON.Quaternion(vq[0], vq[1], vq[2], vq[3]).toEulerAngles(), p = v.p || [0, 0, 0], s = v.s || [1, 1, 1];
      const rx = e.x * m.sway, ry = e.y * m.sway, rz = e.z * m.sway;
      const y = p[1] * h * m.hop + (1 - (pose.air || 0)) * groundSnap(pm, BABYLON.Quaternion.FromEulerAngles(rx, ry, rz), s);
      // (models.js multiplies x and z by 1 / sqrt(sy) itself: what the clip adds is only its difference from keeping volume)
      return { driven: true, emote, own, parts, body: { x: p[0] * h * m.hop, y, z: p[2] * h * m.hop, rx, ry, rz, sx: s[0] * Math.sqrt(s[1]), sy: s[1], sz: s[2] * Math.sqrt(s[1]) } };
    }
    apply(b, pose);
    return { driven: true, emote, body: null };
  }

  P.anim = {
    CLASSES, ROLE_CLIPS, FADE, FORM_CLASS, classOf, motionOf, groundSnap, finish, norm, validate, compile, sampleClip, evalKeys, toDelta, setData, load, setOf, attach, drive, bind, apply, release, Player, hasClip, roleClip,
    q: { mul: qmul, inv: qinv, euler: qeuler, rot: qrot, fromTo: qfromto, blend: qblend, angle: qangle },
    /** Whether a rig's model plays this clip from data now (for /avatars): the set is loaded, fits the model, and has the clip. */
    has: (rig, name) => { const A = rig && rig.pm && rig.pm.anim; const s = A && setOf(A.cls); return Boolean(s && s.clips[name] && A.state !== 'unfit' && !keepsGait(rig.pm.ent, name)); },
    /** What a rig's data animation is doing, for the showcase and tests: { cls, state, clips, missing }. */
    info: (rig) => { const A = rig && rig.pm && rig.pm.anim; if (!A) return null; const s = setOf(A.cls); return { cls: A.cls, state: !s ? 'loading' : A.state === 'unfit' ? 'unfit' : 'ready', clips: s ? s.names : [], missing: A.missing || [], problems: s ? s.problems : [] }; },
    /** Listens to clip events: f(name, rig, event) for a footstep, a hop, a prop pop. */
    on: (f) => { listeners.push(f); return () => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; },
    reset: () => { for (const k of Object.keys(sets)) delete sets[k]; for (const k of Object.keys(loading)) delete loading[k]; for (const k of Object.keys(data)) delete data[k]; },
  };
})();
