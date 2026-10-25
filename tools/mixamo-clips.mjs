// Turns the clips of a rigged GLB or a Mixamo FBX into the engine's clip data (docs/animations.md 2D): quaternion keys per Mixamo bone,
// the Hips' position in model heights, a key every 2 to 3 frames after simplification, the loop flag from the name, footstep events.
//
//   node tools/mixamo-clips.mjs <file.glb|file.fbx> [--into public/play/anim/mixamo.json] [options]
//
//   GLB   what Gen's blender.character exports after `retarget` onto the Mixamo-rigged person (library clips, motion:ual1/Walk_Loop...).
//         Every animation in the file is a clip.
//   FBX   a clip downloaded from mixamo.com ("FBX Binary", with skin or without: only the skeleton and its curves are read). The clip is
//         named after the file (Walking.fbx -> walking) or --name.
//
//   --into <file>     merge into that class file (default: print a summary and write nothing). Clips with the same name are replaced
//                     unless the file's clip is marked "own": true (ours are authored by tools/mixamo-own-clips.mjs and survive)
//   --name <name>     name for the one clip of an FBX (or a GLB with one clip)
//   --rename a=b,...  rename clips (library names map to the table of docs/animations.md by default: Idle_Loop -> idle ...)
//   --only a,b        take only these clips (their names before renaming)
//   --loop / --once   force the loop flag of every clip taken (default: names ending _Loop, and the looping roles of the table)
//   --no-fix          do not write the limbs as T-pose deltas (see restFixes: default on, so the clips read the same on A-pose and T-pose models)
//   --keep-travel     keep the Hips' travel along the ground (default: removed from loops, the body is moved by the game)
//   --height <m>      the character's height in the file's own units (default: measured from the mesh, or from the Head bone)
//   --fps <n>         sampling rate (default 30);  --tolerance <deg> key simplification error (default 1.5)
//
// Rotations are written as deltas from the model's rest pose in the model's axes (`P.anim.toDelta`: rp * abs * rest^-1 * rp^-1), `q` keys
// [t, x, y, z, w]; `pos` of Hips is [t, x, y, z] in model heights. See presence-anim.js for how they are played.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const D = Math.PI / 180;

// ------------------------------------------------------------------------------------------------------------ names
/** The standard Mixamo bone, from any prefix (`mixamorig:`, `mixamorig7:`, `mixamorig_`, none). */
export const norm = (n) => String(n).replace(/^mixamorig\d*[:_]/i, '');
export const MIXAMO_BONES = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/mixamo-skeleton.json'), 'utf8')).bones);

/** Library and Mixamo names to the names of docs/animations.md section 2A. */
export const NAMES = {
  idle_loop: 'idle', walk_loop: 'walk', walking: 'walk', jog_fwd_loop: 'run', running: 'run', sprint_loop: 'sprint', jump_start: 'jump_start', jump_loop: 'jump', jump_land: 'land',
  swim_fwd_loop: 'swim', swim_idle_loop: 'swim_idle', sitting_enter: 'sit_down', sitting_idle_loop: 'sit', sitting_exit: 'stand_up', driving_loop: 'drive', dance_loop: 'dance',
  hit_chest: 'hurt', hit_knockback: 'knock_down', death01: 'death', idle_talking_loop: 'idle_talk', yes: 'nod', wave: 'wave',
};
const LOOPING = new Set(['idle', 'idle_look', 'walk', 'run', 'sprint', 'jump', 'fall', 'swim', 'swim_idle', 'sit', 'sleep', 'drive', 'dance', 'fish_reel', 'aim', 'idle_talk']);
export const nameOf = (raw) => NAMES[String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] || String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const loops = (raw, name) => /_loop$/i.test(raw) || LOOPING.has(name);

// ------------------------------------------------------------------------------------------------------------ math
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qnorm = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]; };
const qdot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
const qslerp = (a, b, k) => {
  let d = qdot(a, b); if (d < 0) { b = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) return qnorm([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k]);
  const th = Math.acos(d), s = Math.sin(th), x = Math.sin((1 - k) * th) / s, y = Math.sin(k * th) / s;
  return [a[0] * x + b[0] * y, a[1] * x + b[1] * y, a[2] * x + b[2] * y, a[3] * x + b[3] * y];
};
/** Degrees between two rotations. */
const qangle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(qdot(a, b)))) / D;
const qrot = (q, v) => { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)); return [r[0], r[1], r[2]]; };
const qeuler = (x, y, z) => { // FBX order XYZ: X applied first, so R = Rz * Ry * Rx; degrees in
  const e = (a, i) => { const h = a * D / 2; const q = [0, 0, 0, Math.cos(h)]; q[i] = Math.sin(h); return q; };
  return qmul(e(z, 2), qmul(e(y, 1), e(x, 0)));
};
const lerpAt = (times, vals, t) => { // vals: arrays of equal width
  if (t <= times[0]) return vals[0];
  if (t >= times[times.length - 1]) return vals[vals.length - 1];
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  const k = (t - times[lo]) / (times[hi] - times[lo] || 1);
  return vals[lo].map((v, i) => v + (vals[hi][i] - v) * k);
};
const slerpAt = (times, vals, t) => {
  if (t <= times[0]) return vals[0];
  if (t >= times[times.length - 1]) return vals[vals.length - 1];
  let lo = 0, hi = times.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (times[m] <= t) lo = m; else hi = m; }
  return qslerp(vals[lo], vals[hi], (t - times[lo]) / (times[hi] - times[lo] || 1));
};

// ------------------------------------------------------------------------------------------------------------ the common shape
// A skeleton is { nodes: [{ name, parent, q, p, s }] } (rest, local) and a take is { name, seconds, rot: Map(node -> { times, q[] }), pos: Map(node -> { times, v[] }) }.
function worlds(nodes) {
  for (const n of nodes) n.wq = null;
  const go = (i) => {
    const n = nodes[i]; if (n.wq) return n;
    if (n.parent < 0) { n.wq = n.q; n.ws = n.s; n.wp = n.p; return n; }
    const par = go(n.parent);
    n.wq = qmul(par.wq, n.q); n.ws = par.ws * n.s;
    const r = qrot(par.wq, n.p); n.wp = [par.wp[0] + r[0] * par.ws, par.wp[1] + r[1] * par.ws, par.wp[2] + r[2] * par.ws];
    return n;
  };
  nodes.forEach((_, i) => go(i));
}

/**
 * Gen's mesh.rig writes the character lying on its back (the skeleton along -z, the front +y; tools/mixamo-upright.mjs stands the game's
 * models up with +90 degrees about x on the root, and that is what a model in the game has). Clips are deltas in the model's axes, so a
 * lying file is stood up the same way before its rest is read: when the Hips-to-Head line is not mostly +y, the skeleton's root turns +90 about x.
 */
export function standUp(skel) {
  const find = (n) => skel.nodes.find((x) => norm(x.name) === n);
  const hips = find('Hips'), head = find('Head');
  if (!hips || !head) return skel;
  const v = [head.wp[0] - hips.wp[0], head.wp[1] - hips.wp[1], head.wp[2] - hips.wp[2]], l = Math.hypot(...v) || 1;
  if (v[1] / l >= 0.5) return skel;
  const turn = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  let root = hips; while (root.parent >= 0) root = skel.nodes[root.parent]; // (the skeleton's own root, like the Armature: a mesh beside it stays)
  root.q = qmul(turn, root.q); root.p = qrot(turn, root.p);
  worlds(skel.nodes);
  skel.stood = true;
  if (skel.measure) skel.height = skel.measure();
  return skel;
}

// ------------------------------------------------------------------------------------------------------------ GLB
export function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8')); else if (type === 0x004e4942) bin = data;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  const J = json, N = J.nodes || [];
  const COMP = { 5120: [1, Int8Array], 5121: [1, Uint8Array], 5122: [2, Int16Array], 5123: [2, Uint16Array], 5125: [4, Uint32Array], 5126: [4, Float32Array] };
  const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessor = (i) => {
    const a = J.accessors[i], bv = J.bufferViews[a.bufferView], [size, T] = COMP[a.componentType], w = WIDTH[a.type];
    const stride = bv.byteStride || size * w, start = (bv.byteOffset || 0) + (a.byteOffset || 0), out = [];
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const read = (o) => (T === Float32Array ? view.getFloat32(o, true) : T === Uint16Array ? view.getUint16(o, true) : T === Int16Array ? view.getInt16(o, true) : T === Uint32Array ? view.getUint32(o, true) : T === Uint8Array ? view.getUint8(o) : view.getInt8(o));
    for (let k = 0; k < a.count; k++) { const row = []; for (let c = 0; c < w; c++) row.push(read(start + k * stride + c * size)); out.push(row); }
    return out;
  };
  const parent = N.map(() => -1);
  N.forEach((n, i) => (n.children || []).forEach((c) => { parent[c] = i; }));
  const nodes = N.map((n, i) => {
    const s = n.scale ? n.scale[0] : 1;
    return { name: n.name || `node${i}`, parent: parent[i], q: n.rotation ? qnorm(n.rotation) : [0, 0, 0, 1], p: n.translation || [0, 0, 0], s };
  });
  worlds(nodes);
  // the character's height: the mesh's box in the world (measured again once the file is stood up)
  const measure = () => {
    let lo = Infinity, hi = -Infinity;
    N.forEach((n, i) => {
      if (n.mesh === undefined) return;
      for (const prim of J.meshes[n.mesh].primitives) {
        const a = J.accessors[prim.attributes.POSITION]; if (!a.min || !a.max) continue;
        const w = nodes[i];
        for (const x of [a.min[0], a.max[0]]) for (const y of [a.min[1], a.max[1]]) for (const z of [a.min[2], a.max[2]]) {
          const r = qrot(w.wq, [x * w.ws, y * w.ws, z * w.ws]); lo = Math.min(lo, w.wp[1] + r[1]); hi = Math.max(hi, w.wp[1] + r[1]);
        }
      }
    });
    return hi > lo ? hi - lo : 0;
  };
  const height = measure();
  const takes = (J.animations || []).map((an, ai) => {
    const take = { name: an.name || `clip${ai}`, seconds: 0, rot: new Map(), pos: new Map() };
    for (const ch of an.channels) {
      const s = an.samplers[ch.sampler], node = ch.target.node, times = accessor(s.input).map((r) => r[0]), vals = accessor(s.output);
      take.seconds = Math.max(take.seconds, times[times.length - 1] || 0);
      if (ch.target.path === 'rotation') take.rot.set(node, { times, q: vals.map(qnorm) });
      else if (ch.target.path === 'translation') take.pos.set(node, { times, v: vals });
    }
    return take;
  });
  return { nodes, takes, height, measure };
}

// ------------------------------------------------------------------------------------------------------------ FBX (binary, what mixamo.com gives)
export function readFbxTree(buf) {
  if (buf.subarray(0, 20).toString('latin1') !== 'Kaydara FBX Binary  ') throw new Error('not a binary FBX (download "FBX Binary" from Mixamo)');
  const version = buf.readUInt32LE(23), wide = version >= 7500;
  const rdU = (o) => (wide ? Number(buf.readBigUInt64LE(o)) : buf.readUInt32LE(o));
  const head = wide ? 25 : 13;
  const prop = (o) => {
    const t = String.fromCharCode(buf[o]); o++;
    const arr = (size, read) => {
      const len = buf.readUInt32LE(o), enc = buf.readUInt32LE(o + 4), clen = buf.readUInt32LE(o + 8); o += 12;
      let data = buf.subarray(o, o + clen); o += clen;
      if (enc === 1) data = zlib.inflateSync(data);
      const out = new Array(len); for (let i = 0; i < len; i++) out[i] = read(data, i * size); return out;
    };
    switch (t) {
      case 'Y': { const v = buf.readInt16LE(o); return [v, o + 2]; }
      case 'C': return [buf[o] !== 0, o + 1];
      case 'I': return [buf.readInt32LE(o), o + 4];
      case 'F': return [buf.readFloatLE(o), o + 4];
      case 'D': return [buf.readDoubleLE(o), o + 8];
      case 'L': return [Number(buf.readBigInt64LE(o)), o + 8];
      case 'S': case 'R': { const n = buf.readUInt32LE(o); const raw = buf.subarray(o + 4, o + 4 + n); return [t === 'S' ? raw.toString('latin1') : raw, o + 4 + n]; }
      case 'f': { const v = arr(4, (d, i) => d.readFloatLE(i)); return [v, o]; }
      case 'd': { const v = arr(8, (d, i) => d.readDoubleLE(i)); return [v, o]; }
      case 'l': { const v = arr(8, (d, i) => Number(d.readBigInt64LE(i))); return [v, o]; }
      case 'i': { const v = arr(4, (d, i) => d.readInt32LE(i)); return [v, o]; }
      case 'b': { const v = arr(1, (d, i) => d[i] !== 0); return [v, o]; }
      default: throw new Error(`FBX property type ${t}`);
    }
  };
  const node = (o) => {
    const end = rdU(o), nprops = rdU(o + (wide ? 8 : 4)), nlen = buf[o + (wide ? 24 : 12)];
    if (!end) return [null, o + head];
    const name = buf.subarray(o + head, o + head + nlen).toString('latin1');
    let p = o + head + nlen; const props = [];
    for (let i = 0; i < nprops; i++) { const [v, np] = prop(p); props.push(v); p = np; }
    const children = [];
    while (p < end) { const [c, np] = node(p); p = np; if (c) children.push(c); }
    return [{ name, props, children }, end];
  };
  const top = []; let o = 27;
  while (o + head <= buf.length) { const [n, np] = node(o); o = np; if (!n) break; top.push(n); }
  return top;
}

/** A Mixamo FBX as a skeleton and one take (the curves are on the models' Lcl Rotation / Translation). */
export function readFbx(buf, fileName = 'clip') {
  const top = readFbxTree(buf), get = (n, name) => (n.children || []).filter((c) => c.name === name);
  const objects = get({ children: top }, 'Objects')[0], conns = get({ children: top }, 'Connections')[0];
  const models = new Map(), curveNodes = new Map(), curves = new Map();
  const P70 = (n) => { const out = {}; for (const p of get(get(n, 'Properties70')[0] || { children: [] }, 'P')) out[p.props[0]] = p.props.slice(4); return out; };
  for (const o of objects.children) {
    const id = o.props[0], name = String(o.props[1] || '').split('\0')[0];
    if (o.name === 'Model') { const pr = P70(o); models.set(id, { id, name, pr, parent: null }); }
    else if (o.name === 'AnimationCurveNode') curveNodes.set(id, { id, name, kind: null, model: null, curves: {} });
    else if (o.name === 'AnimationCurve') { const t = get(o, 'KeyTime')[0], v = get(o, 'KeyValueFloat')[0]; if (t && v) curves.set(id, { times: t.props[0].map((x) => x / 46186158000), vals: v.props[0] }); }
  }
  for (const c of conns.children) {
    if (c.name !== 'C') continue;
    const [type, a, b, propName] = c.props;
    if (type === 'OO' && models.has(a) && models.has(b)) models.get(a).parent = b;
    else if (type === 'OP' && curveNodes.has(a) && models.has(b)) { const cn = curveNodes.get(a); cn.model = b; cn.kind = propName; }
    else if (type === 'OP' && curves.has(a) && curveNodes.has(b)) curveNodes.get(b).curves[String(propName).replace('d|', '')] = curves.get(a);
  }
  const list = [...models.values()], idx = new Map(list.map((m, i) => [m.id, i]));
  const num = (m, k, d) => (m.pr[k] ? m.pr[k].map(Number) : d);
  const pre = list.map((m) => { const r = num(m, 'PreRotation', [0, 0, 0]); return qeuler(r[0], r[1], r[2]); });
  const nodes = list.map((m, i) => {
    const r = num(m, 'Lcl Rotation', [0, 0, 0]), p = num(m, 'Lcl Translation', [0, 0, 0]), s = num(m, 'Lcl Scaling', [1, 1, 1]);
    return { name: m.name, parent: m.parent !== null && idx.has(m.parent) ? idx.get(m.parent) : -1, q: qmul(pre[i], qeuler(r[0], r[1], r[2])), p, s: s[0] };
  });
  worlds(nodes);
  const take = { name: fileName, seconds: 0, rot: new Map(), pos: new Map() };
  for (const cn of curveNodes.values()) {
    if (cn.model === null || !idx.has(cn.model)) continue;
    const i = idx.get(cn.model), cx = cn.curves.X, cy = cn.curves.Y, cz = cn.curves.Z, base = cn.kind === 'Lcl Rotation' ? num(models.get(cn.model), 'Lcl Rotation', [0, 0, 0]) : num(models.get(cn.model), 'Lcl Translation', [0, 0, 0]);
    const ref = cx || cy || cz; if (!ref || !['Lcl Rotation', 'Lcl Translation'].includes(cn.kind)) continue;
    const times = [...new Set([cx, cy, cz].filter(Boolean).flatMap((c) => c.times))].sort((a, b) => a - b);
    const at = (c, k, t) => (c ? lerpAt(c.times, c.vals.map((v) => [v]), t)[0] : base[k]);
    take.seconds = Math.max(take.seconds, times[times.length - 1]);
    if (cn.kind === 'Lcl Rotation') take.rot.set(i, { times, q: times.map((t) => qnorm(qmul(pre[i], qeuler(at(cx, 0, t), at(cy, 1, t), at(cz, 2, t))))) });
    else take.pos.set(i, { times, v: times.map((t) => [at(cx, 0, t), at(cy, 1, t), at(cz, 2, t)]) });
  }
  const t0 = Math.min(...[...take.rot.values(), ...take.pos.values()].map((x) => x.times[0]));
  if (Number.isFinite(t0) && t0 > 0) { for (const x of [...take.rot.values(), ...take.pos.values()]) x.times = x.times.map((t) => t - t0); take.seconds -= t0; }
  return { nodes, takes: [take], height: 0 };
}

// ------------------------------------------------------------------------------------------------------------ rest fixes
/** The shortest turn from direction a to direction b (unit vectors). */
const qfromto = (a, b) => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) return [0, 0, 1, 0];
  return qnorm([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0], 1 + d]);
};
const CANON = [];
for (const [s, x] of [['Left', 1], ['Right', -1]]) CANON.push([`${s}Arm`, `${s}ForeArm`, [x, 0, 0]], [`${s}ForeArm`, `${s}Hand`, [x, 0, 0]], [`${s}UpLeg`, `${s}Leg`, [0, -1, 0]], [`${s}Leg`, `${s}Foot`, [0, -1, 0]]);

/**
 * The engine's rest fix of the source model (presence-anim.js bind): a limb's direction at rest turned to Mixamo's T-pose direction. The engine
 * plays `delta * fix`, so a clip written for the T-pose reads right on an A-pose model; a clip retargeted onto this model's own rest already
 * has the model's pose in it, so it is written as `delta * fix^-1`, and the engine's `* fix` gives the same pose back on this model (and the
 * T-pose reading on every other Mixamo model).
 */
export function restFixes(skel) {
  const byName = new Map(skel.nodes.map((n, i) => [norm(n.name), i])), fixOf = new Map(), out = new Map();
  for (const [bone, child, dir] of CANON) {
    const a = byName.get(bone), c = byName.get(child);
    if (a === undefined || c === undefined) continue;
    const pa = skel.nodes[a].wp, pc = skel.nodes[c].wp, v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]], l = Math.hypot(...v);
    if (l < 1e-6) continue;
    const total = qfromto([v[0] / l, v[1] / l, v[2] / l], dir);
    if (qangle(total, [0, 0, 0, 1]) < 2) continue;
    const par = skel.nodes[a].parent >= 0 ? norm(skel.nodes[skel.nodes[a].parent].name) : null;
    const pf = par && fixOf.get(par) ? fixOf.get(par) : [0, 0, 0, 1];
    const fix = qmul(qinv(pf), total);
    fixOf.set(bone, fix); out.set(bone, fix);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------------ the conversion
const r4 = (x) => Math.round(x * 10000) / 10000;

/** Keeps the frames a spline needs: every second or third one, and any where dropping it would be off by more than `tol` degrees. */
function simplify(frames, tol, dist, loop) {
  const n = frames.length, keep = new Array(n).fill(false);
  keep[0] = true; keep[n - 1] = true;
  for (let i = 0; i < n; i += 3) keep[i] = true;
  // every dropped frame must be within tol of the interpolation of its neighbours kept
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let i = 1; i < n - 1; i++) {
      if (keep[i]) continue;
      let a = i - 1; while (!keep[a]) a--;
      let b = i + 1; while (!keep[b]) b++;
      if (dist(frames[i], frames[a], frames[b], (i - a) / (b - a)) > tol) { keep[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  void loop;
  return keep;
}

/** One take to a clip. `opts`: fps, tolerance, keepTravel, loop (true/false/undefined), height. */
export function convertTake(skel, take, o = {}) {
  const fps = o.fps || 30, tol = o.tolerance ?? 1.5, nodes = skel.nodes;
  const raw = take.name, name = o.name || nameOf(raw), loop = o.loop ?? loops(raw, name);
  const seconds = Math.max(take.seconds, 1 / fps), frames = Math.max(2, Math.round(seconds * fps)), n = loop ? frames : frames + 1;
  const times = Array.from({ length: n }, (_, i) => i / frames);
  const height = o.height || skel.height || 0;
  const tracks = {}, fixes = o.fix === false ? new Map() : restFixes(skel);
  for (let i = 0; i < nodes.length; i++) {
    const bone = norm(nodes[i].name);
    if (!MIXAMO_BONES.has(bone)) continue;
    const rp = nodes[i].parent >= 0 ? nodes[nodes[i].parent].wq : [0, 0, 0, 1], rest = nodes[i].q, tr = {};
    const rot = take.rot.get(i);
    if (rot) {
      const qs = times.map((u) => { const abs = slerpAt(rot.times, rot.q, u * frames / fps); const d = qnorm(qmul(rp, qmul(qmul(abs, qinv(rest)), qinv(rp)))); return fixes.has(bone) ? qnorm(qmul(d, qinv(fixes.get(bone)))) : d; });
      for (let k = 1; k < qs.length; k++) if (qdot(qs[k], qs[k - 1]) < 0) qs[k] = qs[k].map((v) => -v); // one hemisphere
      if (qs.some((q) => qangle(q, [0, 0, 0, 1]) > 0.3)) {
        const keep = simplify(qs, tol, (q, a, b, k) => qangle(q, qslerp(a, b, k)), loop);
        const ks = []; qs.forEach((q, k) => { if (keep[k] && !(loop && k === n - 1)) ks.push([r4(times[k]), r4(q[0]), r4(q[1]), r4(q[2]), r4(q[3])]); });
        tr.q = ks;
      }
    }
    const pos = take.pos.get(i);
    if (pos && bone === 'Hips' && height > 0) {
      const ws = nodes[i].parent >= 0 ? nodes[nodes[i].parent].ws : 1;
      let vs = times.map((u) => { const v = lerpAt(pos.times, pos.v, u * frames / fps), d = qrot(rp, [v[0] - nodes[i].p[0], v[1] - nodes[i].p[1], v[2] - nodes[i].p[2]]); return d.map((x) => x * ws / height); });
      if (loop && !o.keepTravel) { // the game moves the body: take the drift out of x and z (a straight line from the first frame to the one after the last)
        const last = vs[vs.length - 1], per = vs.length;
        vs = vs.map((v, k) => [v[0] - last[0] * k / per, v[1], v[2] - last[2] * k / per]);
        const m0 = vs.reduce((s, v) => s + v[0], 0) / vs.length, m2 = vs.reduce((s, v) => s + v[2], 0) / vs.length;
        vs = vs.map((v) => [v[0] - m0, v[1], v[2] - m2]);
      }
      if (vs.some((v) => Math.hypot(v[0], v[1], v[2]) > 0.002)) {
        const keep = simplify(vs, 0.002, (v, a, b, k) => Math.hypot(...v.map((x, c) => x - (a[c] + (b[c] - a[c]) * k))), loop);
        const ks = []; vs.forEach((v, k) => { if (keep[k] && !(loop && k === n - 1)) ks.push([r4(times[k]), r4(v[0]), r4(v[1]), r4(v[2])]); });
        tr.pos = ks;
      }
    }
    if (tr.q || tr.pos) tracks[bone] = tr;
  }
  const clip = { loop, seconds: Math.round(seconds * 1000) / 1000, ease: 'spline' };
  if (!loop) clip.ease = 'smooth';
  const events = footsteps(name, tracks, loop);
  if (events.length) clip.events = events;
  clip.tracks = tracks;
  return { name, clip };
}

/** Footsteps on walk and run: when each thigh is furthest forward the heel is down. */
function footsteps(name, tracks, loop) {
  if (!loop || !/^(walk|run|sprint)/.test(name)) return [];
  const out = [];
  for (const [side, bone] of [['L', 'LeftUpLeg'], ['R', 'RightUpLeg']]) {
    const ks = tracks[bone] && tracks[bone].q; if (!ks || ks.length < 3) continue;
    // pitch about x of each key (negative rx swings the thigh forward, docs/animations.md: rx > 0 pitches a hanging limb back)
    let best = 0, bt = 0;
    for (const k of ks) { const pitch = 2 * Math.atan2(k[1], k[4]) / D; if (-pitch > best) { best = -pitch; bt = k[0]; } }
    out.push({ t: r4(bt), name: 'footstep', foot: side });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function importFile(file, o = {}) {
  const buf = fs.readFileSync(file), ext = path.extname(file).toLowerCase();
  const skel = standUp(ext === '.fbx' ? readFbx(buf, path.basename(file, '.fbx')) : readGlb(buf));
  const only = o.only && new Set(o.only), clips = {};
  const takes = skel.takes.filter((t) => !only || only.has(t.name));
  if (!takes.length) throw new Error(`${file} has no clips${only ? ` named ${[...only].join(', ')}` : ''}`);
  for (const take of takes) {
    const one = takes.length === 1;
    const { name, clip } = convertTake(skel, take, { ...o, name: one && o.name ? o.name : o.rename && o.rename[take.name] });
    clips[name] = clip;
  }
  return clips;
}

// ------------------------------------------------------------------------------------------------------------ the command
function main(argv) {
  const args = argv.slice(2), o = { rename: {} };
  let file = null, into = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--into') into = args[++i];
    else if (a === '--name') o.name = args[++i];
    else if (a === '--rename') for (const p of args[++i].split(',')) { const [x, y] = p.split('='); o.rename[x] = y; }
    else if (a === '--only') o.only = args[++i].split(',');
    else if (a === '--loop') o.loop = true;
    else if (a === '--once') o.loop = false;
    else if (a === '--keep-travel') o.keepTravel = true;
    else if (a === '--no-fix') o.fix = false;
    else if (a === '--height') o.height = Number(args[++i]);
    else if (a === '--fps') o.fps = Number(args[++i]);
    else if (a === '--tolerance') o.tolerance = Number(args[++i]);
    else if (!a.startsWith('--')) file = a;
    else { console.error(`unknown option ${a}`); process.exit(2); }
  }
  if (!file) { console.error('usage: node tools/mixamo-clips.mjs <file.glb|file.fbx> [--into public/play/anim/mixamo.json] [--name n] [--only a,b] [--rename a=b] [--loop|--once]'); process.exit(2); }
  const clips = importFile(file, o);
  for (const [n, c] of Object.entries(clips)) {
    const keys = Object.values(c.tracks).reduce((s, t) => s + (t.q ? t.q.length : 0) + (t.pos ? t.pos.length : 0), 0);
    console.log(`${n.padEnd(14)} ${c.loop ? 'loop' : 'once'} ${String(c.seconds).padStart(6)} s  ${String(Object.keys(c.tracks).length).padStart(2)} bones  ${keys} keys${c.events ? `  ${c.events.length} events` : ''}`);
  }
  if (!into) { console.log('(nothing written: pass --into <class file>)'); return; }
  const target = path.resolve(into), data = JSON.parse(fs.readFileSync(target, 'utf8'));
  for (const [n, c] of Object.entries(clips)) {
    if (data.clips[n] && data.clips[n].own) { console.log(`kept our own ${n}`); continue; }
    data.clips[n] = { ...c, source: path.basename(file) };
  }
  fs.writeFileSync(target, JSON.stringify(data));
  console.log(`wrote ${Object.keys(clips).length} clips into ${into}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv);
