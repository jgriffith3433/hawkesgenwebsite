// Registry anchors for a Mixamo-rigged GLB (docs/characters.md, "Mixamo models"): the offset and the turn that put an anchor at a
// point of the model (in the file's own units, y up, front +z, its left at +x) when it hangs on a bone.
//   node tools/mixamo-anchors.mjs <model.glb> [bone for each anchor: head=mixamorig:Head ...]
// Babylon hangs a glTF under __root__, which mirrors x and leaves node data as authored, so the anchor's world matrix is
// A * W(bone) * Mirror. `at` puts the origin at the point, `rot` (radians, as rotation.set takes them) makes the anchor's axes the
// body's (y up, +z forward, x mirrored like everything under the root).
import fs from 'node:fs';
import { createRequire } from 'node:module';
const B = createRequire(import.meta.url)('babylonjs');

const b = fs.readFileSync(process.argv[2]);
const jl = b.readUInt32LE(12);
const j = JSON.parse(b.subarray(20, 20 + jl).toString());
const bin = b.subarray(20 + jl + 8);
const parent = new Map();
j.nodes.forEach((n, i) => (n.children || []).forEach((c) => parent.set(c, i)));
const local = (n) => B.Matrix.Compose(
  new B.Vector3(...(n.scale || [1, 1, 1])), new B.Quaternion(...(n.rotation || [0, 0, 0, 1])), new B.Vector3(...(n.translation || [0, 0, 0])));
const world = (i) => { let m = local(j.nodes[i]); for (let p = parent.get(i); p !== undefined; p = parent.get(p)) m = m.multiply(local(j.nodes[p])); return m; };
const MIRROR = B.Matrix.Scaling(-1, 1, 1);
const index = (name) => j.nodes.findIndex((n) => n.name === name);

// the model's vertices in the file's world (bind pose = rest), to measure the head
const root = world(j.scenes[0].nodes[0]);
const pts = [];
for (const m of j.meshes) for (const p of m.primitives) {
  const a = j.accessors[p.attributes.POSITION], bv = j.bufferViews[a.bufferView], off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  for (let i = 0; i < a.count; i++) pts.push(B.Vector3.TransformCoordinates(new B.Vector3(bin.readFloatLE(off + i * 12), bin.readFloatLE(off + i * 12 + 4), bin.readFloatLE(off + i * 12 + 8)), root));
}
const top = Math.max(...pts.map((p) => p.y));
const headBone = world(index('mixamorig:Head'));
const hy = headBone.m[13];
const head = pts.filter((p) => p.y > hy + 0.05);
const lo = (k) => Math.min(...head.map((p) => p[k])), hi = (k) => Math.max(...head.map((p) => p[k]));
const W = hi('x') - lo('x'), zc = (lo('z') + hi('z')) / 2, front = hi('z');
const body = pts.filter((p) => p.y < hy - 0.05);
const bz = (Math.min(...body.map((p) => p.z)) + Math.max(...body.map((p) => p.z))) / 2;
const bd = Math.max(...body.map((p) => p.z)) - Math.min(...body.map((p) => p.z));
// where the things are worn, from the head's size: the same ratios the pilot's rows used (docs/characters.md)
const point = {
  head: [0, top, zc],
  face: [0, top - 0.445 * W, front - 0.02 * W],
  neck: [0, top - 1.0 * W, zc],
  back: [0, top - 1.2 * W - 0.1 * (top - W), bz - bd * 0.45],
  rump: [0, top * 0.22 + 0.02, bz - bd * 0.45],
};
const bones = { head: 'mixamorig:Head', face: 'mixamorig:Head', neck: 'mixamorig:Neck', back: 'mixamorig:Spine2', rump: 'mixamorig:Hips' };
for (const a of process.argv.slice(3)) { const [k, v] = a.split('='); bones[k] = v; }
console.error(JSON.stringify({ top: +top.toFixed(3), headWidth: +W.toFixed(3), headCentreZ: +zc.toFixed(3), front: +front.toFixed(3) }));
const out = {};
for (const [name, node] of Object.entries(bones)) {
  const wb = world(index(node));
  const wr = wb.multiply(MIRROR); // bone to the holder's frame
  const P = new B.Vector3(-point[name][0], point[name][1], point[name][2]); // the holder's x is the file's, mirrored
  const at = B.Vector3.TransformCoordinates(P, wr.clone().invert());
  // The linear part of bone-to-holder with the scale taken out (it has the mirror in it: determinant -1). A * W has to be the mirror:
  // R_A * R_W = M, so R_A = M * R_W^-1, a proper rotation.
  const rW = wr.clone();
  const ln = (r) => Math.hypot(wr.m[r * 4], wr.m[r * 4 + 1], wr.m[r * 4 + 2]);
  for (let r = 0; r < 3; r++) { const n = ln(r); for (let c = 0; c < 3; c++) rW.m[r * 4 + c] /= n; }
  rW.m[12] = rW.m[13] = rW.m[14] = 0; rW.markAsUpdated();
  const rA = MIRROR.multiply(rW.clone().invert());
  const qq = B.Quaternion.FromRotationMatrix(rA);
  const eu = qq.toEulerAngles();
  out[name] = { node, at: at.asArray().map((v) => +v.toFixed(4)), rot: eu.asArray().map((v) => +v.toFixed(4)) };
}
console.log(JSON.stringify(out, null, 1));
// self-check: the anchor's origin lands on its point, and its y is up and its z forward (x is mirrored with everything under the root)
for (const [name, a] of Object.entries(out)) {
  const A = B.Matrix.Compose(new B.Vector3(1, 1, 1), B.Quaternion.FromEulerAngles(...a.rot), new B.Vector3(...a.at));
  const m = A.multiply(world(index(a.node))).multiply(MIRROR);
  const o = B.Vector3.TransformCoordinates(B.Vector3.Zero(), m);
  const d = (v) => B.Vector3.TransformNormal(v, m).normalize().asArray().map((x) => +x.toFixed(2));
  const want = point[name];
  const err = Math.hypot(-want[0] - o.x, want[1] - o.y, want[2] - o.z);
  console.error(name.padEnd(5), 'off by', +err.toFixed(4), 'y ->', d(B.Vector3.Up()), 'z ->', d(new B.Vector3(0, 0, 1)));
}
