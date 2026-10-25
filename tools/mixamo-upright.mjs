// Stands up a Mixamo-rigged GLB that Gen's mesh.rig made (docs/characters.md, "Mixamo models").
// mesh.rig's output comes out lying on its back (rotated 90 degrees about X) and sized so the lying thickness is 1.8 m, so the
// figure is about 3 m tall. The skeleton and the skin are right; only the root is wrong. This turns the root node (Armature)
// +90 degrees about X, puts the feet on y = 0 and centres it. Nothing else in the file changes. It is not scaled: the engine fits
// the model to its row's height by its bounds, and the clip player's hip travel is in the bones' own units, which a scale would change.
//   node tools/mixamo-upright.mjs <near.glb> <low.glb> <out-near.glb> <out-low.glb>
// Gen's bake is 2048 px: the embedded pictures are also scaled down to 1024 px (ffmpeg, JPEG), the size the other models use.
// Both levels get the one transform, worked out from the near level's bounds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function read(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString());
  const rest = b.subarray(20 + jl); // BIN chunk header and data
  return { json, rest };
}
const TEX = 1024;
/** The embedded JPEGs scaled to TEX px (ffmpeg); the buffer is laid out again, every view on 4 bytes. */
function shrink(json, rest) {
  const bin = rest.subarray(8);
  const imgViews = new Set((json.images || []).map((i) => i.bufferView));
  const parts = json.bufferViews.map((bv, i) => {
    let d = bin.subarray(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
    if (imgViews.has(i)) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tex-'));
      fs.writeFileSync(path.join(dir, 'in.jpg'), d);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(dir, 'in.jpg'), '-vf', `scale=${TEX}:${TEX}:flags=lanczos`, '-q:v', '3', path.join(dir, 'out.jpg')]);
      d = fs.readFileSync(path.join(dir, 'out.jpg'));
      fs.rmSync(dir, { recursive: true });
    }
    return d;
  });
  let off = 0;
  const chunks = [];
  json.bufferViews.forEach((bv, i) => { bv.byteOffset = off; bv.byteLength = parts[i].length; chunks.push(parts[i]); const pad = (4 - (parts[i].length % 4)) % 4; chunks.push(Buffer.alloc(pad)); off += parts[i].length + pad; });
  json.buffers[0].byteLength = off;
  const head = Buffer.alloc(8); head.writeUInt32LE(off, 0); head.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, ...chunks]);
}
function write(file, json, rest) {
  rest = shrink(json, rest);
  let s = JSON.stringify(json);
  while (Buffer.byteLength(s) % 4) s += ' ';
  const jb = Buffer.from(s);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + jb.length + rest.length, 8);
  head.writeUInt32LE(jb.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  fs.writeFileSync(file, Buffer.concat([head, jb, rest]));
}
function bounds(json) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const m of json.meshes) for (const p of m.primitives) {
    const a = json.accessors[p.attributes.POSITION];
    for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a.min[k]); hi[k] = Math.max(hi[k], a.max[k]); }
  }
  return { lo, hi };
}

const [nearIn, lowIn, nearOut, lowOut] = process.argv.slice(2);
const near = read(nearIn);
const { lo, hi } = bounds(near.json);
// Rotation +90 deg about X sends (x, y, z) to (x, -z, y): the old -z is up. Height is the old z extent.
const height = hi[2] - lo[2];
const s = 1;
const t = [-s * (lo[0] + hi[0]) / 2, s * hi[2], -s * (lo[1] + hi[1]) / 2];
const q = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
for (const [src, out] of [[near, nearOut], [read(lowIn), lowOut]]) {
  const roots = src.json.scenes[0].nodes;
  if (roots.length !== 1) throw new Error('expected one root node');
  const n = src.json.nodes[roots[0]];
  if (n.rotation || n.translation || n.scale) throw new Error('the root already has a transform');
  n.rotation = q; n.translation = t.map((v) => +v.toFixed(5));
  write(out, src.json, src.rest);
}
console.log(JSON.stringify({ height, scale: +s.toFixed(5), translation: t.map((v) => +v.toFixed(4)) }));
