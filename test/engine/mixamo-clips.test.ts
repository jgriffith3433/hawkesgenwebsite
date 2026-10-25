// tools/mixamo-clips.mjs (docs/animations.md 2D): a small rigged GLB with a looping walk and a one-shot, and a binary FBX the way Mixamo
// writes one (Models with PreRotation, curve nodes, KeyTime in FBX ticks), become clip data the engine validates: quaternion keys as
// deltas from the rest pose, Hips in model heights, loops closed, travel taken out, footsteps, names mapped, merging that keeps our own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import * as cp from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from './harness.ts';
// @ts-ignore a plain .mjs tool
import { importFile, nameOf, MIXAMO_BONES } from '../../tools/mixamo-clips.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const A = H.presence.anim;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mixamo-clips-'));
const D = Math.PI / 180;
const qx = (deg: number) => [Math.sin(deg * D / 2), 0, 0, Math.cos(deg * D / 2)];

// ---- a GLB: Armature (turned like Blender's export) > Hips > Spine > Head, and a leg chain; two animations at 30 fps
function makeGlb(file: string) {
  const names = ['Armature', 'mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:Head', 'mixamorig:LeftUpLeg', 'mixamorig:LeftLeg', 'mixamorig:RightUpLeg', 'mixamorig:RightLeg', 'Cube'];
  const nodes: any[] = names.map((name) => ({ name }));
  nodes[0].children = [1]; nodes[0].scale = [1, 1, 1];
  nodes[1].translation = [0, 1, 0]; nodes[1].children = [2, 4, 6];
  nodes[2].translation = [0, 0.3, 0]; nodes[2].children = [3]; nodes[3].translation = [0, 0.5, 0];
  nodes[4].translation = [0.1, -0.05, 0]; nodes[4].children = [5]; nodes[5].translation = [0, -0.45, 0];
  nodes[6].translation = [-0.1, -0.05, 0]; nodes[6].children = [7]; nodes[7].translation = [0, -0.45, 0];
  const bufs: Buffer[] = [], views: any[] = [], accs: any[] = [];
  const add = (arr: number[], type: string, width: number, min?: number[], max?: number[]) => {
    const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeFloatLE(v, i * 4));
    views.push({ buffer: 0, byteOffset: bufs.reduce((s, x) => s + x.length, 0), byteLength: b.length }); bufs.push(b);
    accs.push({ bufferView: views.length - 1, componentType: 5126, count: arr.length / width, type, ...(min ? { min, max } : {}) });
    return accs.length - 1;
  };
  // the mesh: a box 2 units tall, so the character's height is 2
  const pos = add([-0.3, 0, -0.2, 0.3, 2, 0.2], 'VEC3', 3, [-0.3, 0, -0.2], [0.3, 2, 0.2]);
  nodes[8].mesh = 0;
  const frames = 30, t = Array.from({ length: frames + 1 }, (_, i) => i / 30), tOnce = Array.from({ length: 16 }, (_, i) => i / 30);
  const animations: any[] = [];
  const clip = (name: string, times: number[], rotL: (u: number) => number[], hips: (u: number, n: number) => number[], travel = 0) => {
    const n = times.length, ti = add(times, 'SCALAR', 1, [times[0]], [times[n - 1]]);
    const rl = add(times.flatMap((u, i) => rotL(i / (n - 1))), 'VEC4', 4);
    const rr = add(times.flatMap((u, i) => rotL((i / (n - 1) + 0.5) % 1)), 'VEC4', 4);
    const hp = add(times.flatMap((u, i) => hips(i / (n - 1), i).map((v, c) => v + (c === 2 ? travel * u : 0))), 'VEC3', 3);
    animations.push({ name, samplers: [{ input: ti, output: rl, interpolation: 'LINEAR' }, { input: ti, output: rr, interpolation: 'LINEAR' }, { input: ti, output: hp, interpolation: 'LINEAR' }],
      channels: [{ sampler: 0, target: { node: 4, path: 'rotation' } }, { sampler: 1, target: { node: 6, path: 'rotation' } }, { sampler: 2, target: { node: 1, path: 'translation' } }] });
  };
  // Walk_Loop: the left thigh swings 30 degrees about x each way (forward is negative rx in the game's convention), the hips bob and travel 1.4 units
  clip('Walk_Loop', t, (u) => qx(-30 * Math.sin(2 * Math.PI * u)), (u) => [0, 1 + 0.04 * Math.abs(Math.sin(2 * Math.PI * u * 2)), 0], 1.4);
  // Wave: a one-shot, the leg lifts and settles
  clip('Wave', tOnce, (u) => qx(40 * Math.sin(Math.PI * u)), () => [0, 1, 0]);
  const json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 8] }], nodes, meshes: [{ primitives: [{ attributes: { POSITION: pos } }] }], accessors: accs, bufferViews: views, buffers: [{ byteLength: bufs.reduce((s, x) => s + x.length, 0) }], animations };
  let j = Buffer.from(JSON.stringify(json)); j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 0x20)]);
  let bin = Buffer.concat(bufs); bin = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + bin.length, 8);
  const ch = (type: number, d: Buffer) => { const h = Buffer.alloc(8); h.writeUInt32LE(d.length, 0); h.writeUInt32LE(type, 4); return Buffer.concat([h, d]); };
  fs.writeFileSync(file, Buffer.concat([head, ch(0x4e4f534a, j), ch(0x004e4942, bin)]));
}

// ---- a binary FBX the way Mixamo writes it (version 7400: 32-bit offsets), with one compressed array
type Prop = { t: string; v: any };
const I = (v: number): Prop => ({ t: 'I', v }), L = (v: number): Prop => ({ t: 'L', v }), Dd = (v: number): Prop => ({ t: 'D', v }), S = (v: string): Prop => ({ t: 'S', v }), arr = (t: string, v: number[]): Prop => ({ t, v });
function fbxNode(name: string, props: Prop[], children: any[] = []): Buffer {
  const pb = Buffer.concat(props.map((p) => {
    if (p.t === 'I') { const b = Buffer.alloc(5); b.write('I'); b.writeInt32LE(p.v, 1); return b; }
    if (p.t === 'L') { const b = Buffer.alloc(9); b.write('L'); b.writeBigInt64LE(BigInt(p.v), 1); return b; }
    if (p.t === 'D') { const b = Buffer.alloc(9); b.write('D'); b.writeDoubleLE(p.v, 1); return b; }
    if (p.t === 'S') { const s = Buffer.from(p.v, 'latin1'), b = Buffer.alloc(5 + s.length); b.write('S'); b.writeUInt32LE(s.length, 1); s.copy(b, 5); return b; }
    const size = p.t === 'f' ? 4 : 8, raw = Buffer.alloc(p.v.length * size); // 'd' doubles, 'f' floats, 'l' int64
    p.v.forEach((x: number, i: number) => (p.t === 'd' ? raw.writeDoubleLE(x, i * 8) : p.t === 'f' ? raw.writeFloatLE(x, i * 4) : raw.writeBigInt64LE(BigInt(x), i * 8)));
    const z = zlib.deflateSync(raw), b = Buffer.alloc(13); b.write(p.t); b.writeUInt32LE(p.v.length, 1); b.writeUInt32LE(1, 5); b.writeUInt32LE(z.length, 9);
    return Buffer.concat([b, z]);
  }));
  return Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from([0, 0, 0, 0]), Buffer.from([0, 0, 0, 0]), Buffer.from([name.length]), Buffer.from(name, 'latin1'), pb, ...children, ...(children.length ? [Buffer.alloc(13)] : [])]);
}
/** Builds nodes with correct end offsets: each node is written at a known absolute position. */
function writeFbx(model: { name: string; pre: number[]; lcl: number[]; pos: number[]; parent: number; id: number }[], curves: { id: number; node: number; kind: string; axis: string; times: number[]; vals: number[] }[]): Buffer {
  const header = Buffer.concat([Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'latin1'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(7400); return b; })()]);
  type N = { name: string; props: Prop[]; kids: N[] };
  const n = (name: string, props: Prop[] = [], kids: N[] = []): N => ({ name, props, kids });
  const p70 = (rows: [string, number[]][]) => n('Properties70', [], rows.map(([k, v]) => n('P', [S(k), S('Vector3D'), S(''), S('A'), ...v.map(Dd)])));
  const objects = n('Objects', [], [
    ...model.map((m) => n('Model', [L(m.id), S(`${m.name}\0\x01Model`), S('LimbNode')], [p70([['PreRotation', m.pre], ['Lcl Rotation', m.lcl], ['Lcl Translation', m.pos]])])),
    ...[...new Set(curves.map((c) => `${c.node}:${c.kind}`))].map((k, i) => n('AnimationCurveNode', [L(9000 + i), S('R\0\x01AnimCurveNode'), S('')])),
    ...curves.map((c) => n('AnimationCurve', [L(c.id), S('\0\x01AnimCurve'), S('')], [n('KeyTime', [arr('l', c.times.map((t) => Math.round(t * 46186158000)))]), n('KeyValueFloat', [arr('f', c.vals)])])),
  ]);
  const keys = [...new Set(curves.map((c) => `${c.node}:${c.kind}`))];
  const conns = n('Connections', [], [
    ...model.filter((m) => m.parent).map((m) => n('C', [S('OO'), L(m.id), L(m.parent)])),
    ...keys.map((k, i) => n('C', [S('OP'), L(9000 + i), L(Number(k.split(':')[0])), S(k.split(':')[1])])),
    ...curves.map((c) => n('C', [S('OP'), L(c.id), L(9000 + keys.indexOf(`${c.node}:${c.kind}`)), S(`d|${c.axis}`)])),
  ]);
  const out: Buffer[] = [header]; let pos = header.length;
  // positions are known once everything is serialised: do it with a recursive function that takes the absolute start
  const ser = (node: N, at: number): Buffer => {
    const raw = fbxNode(node.name, node.props, []);
    const propLen = raw.length - 13 - node.name.length;
    let off = at + raw.length; const kids: Buffer[] = [];
    for (const k of node.kids) { const b = ser(k, off); kids.push(b); off += b.length; }
    if (node.kids.length) { kids.push(Buffer.alloc(13)); off += 13; }
    const b = Buffer.concat([raw, ...kids]);
    b.writeUInt32LE(off, 0); b.writeUInt32LE(node.props.length, 4); b.writeUInt32LE(propLen, 8);
    return b;
  };
  for (const top of [objects, conns]) { const b = ser(top, pos); out.push(b); pos += b.length; }
  out.push(Buffer.alloc(13));
  return Buffer.concat(out);
}

test('a GLB: deltas from the rest pose, Hips in model heights, loops closed, travel removed, footsteps', () => {
  const f = path.join(tmp, 'person-clips.glb'); makeGlb(f);
  const clips = importFile(f, { rename: { Wave: 'wave' }, keepTravel: false });
  assert.deepEqual(Object.keys(clips).sort(), ['walk', 'wave'], 'library names are mapped (Walk_Loop -> walk)');
  const file = { class: 'mixamo', version: 1, clips };
  assert.deepEqual(A.validate('mixamo', file), [], 'the engine accepts what the tool wrote');
  const walk = clips.walk;
  assert.equal(walk.loop, true); assert.equal(walk.seconds, 1);
  for (const bone of Object.keys(walk.tracks)) assert.ok(MIXAMO_BONES.has(bone), `${bone} is a Mixamo bone (the prefix is gone)`);
  const q = walk.tracks.LeftUpLeg.q;
  assert.equal(q[0][0], 0); assert.ok(q[q.length - 1][0] < 1, 'a loop does not repeat its first key at the end');
  assert.ok(q.length >= 4 && q.length <= 12, `simplified to ${q.length} keys from 30 frames`);
  // a quarter of the way the thigh is at its peak: 30 degrees about x
  const sample = A.sampleClip(A.compile(walk), 0.25).get('LeftUpLeg');
  const angle = 2 * Math.acos(Math.abs(sample.q[3])) / D;
  assert.ok(Math.abs(angle - 30) < 1.5, `peak ${angle.toFixed(1)} degrees`);
  const hips = walk.tracks.Hips.pos;
  assert.ok(hips.every((k: number[]) => Math.abs(k[3]) < 0.02), 'no travel along z in a loop');
  assert.ok(Math.max(...hips.map((k: number[]) => k[2])) - Math.min(...hips.map((k: number[]) => k[2])) < 0.03 && Math.max(...hips.map((k: number[]) => k[2])) > 0.01, 'the bob stays, in heights of 2 units (0.04 -> 0.02)');
  assert.ok(walk.events.some((e: any) => e.name === 'footstep' && e.foot === 'L') && walk.events.some((e: any) => e.foot === 'R'), 'footsteps on a walk');
  assert.ok(Math.abs(walk.events.find((e: any) => e.foot === 'R').t - walk.events.find((e: any) => e.foot === 'L').t) > 0.3, 'the feet land half a stride apart');
  const once = clips.wave;
  assert.equal(once.loop, false); assert.equal(once.ease, 'smooth');
  assert.equal(once.tracks.LeftUpLeg.q[once.tracks.LeftUpLeg.q.length - 1][0], 1, 'a one-shot ends at 1');
  assert.ok(!once.events, 'no footsteps on a wave');
});

test('a GLB: travel is kept on request', () => {
  const f = path.join(tmp, 'person-clips.glb');
  const clips = importFile(f, { keepTravel: true, only: ['Walk_Loop'] });
  const z = clips.walk.tracks.Hips.pos.map((k: number[]) => k[3]);
  assert.ok(Math.max(...z) - Math.min(...z) > 0.4, 'the Hips travel 1.4 units of a height of 2');
});

test('an FBX from Mixamo: PreRotation, Euler curves in ticks, named after the file', () => {
  const f = path.join(tmp, 'Walking.fbx');
  const ticks = [0, 0.2, 0.5, 0.7, 1]; // on frames of 30 fps
  fs.writeFileSync(f, writeFbx(
    [{ id: 1, name: 'mixamorig:Hips', pre: [0, 0, 0], lcl: [0, 0, 0], pos: [0, 100, 0], parent: 0 }, { id: 2, name: 'mixamorig:LeftUpLeg', pre: [0, 0, 0], lcl: [0, 0, 0], pos: [10, -5, 0], parent: 1 }, { id: 3, name: 'mixamorig:Head', pre: [0, 0, 0], lcl: [0, 0, 0], pos: [0, 60, 0], parent: 1 }],
    [{ id: 101, node: 2, kind: 'Lcl Rotation', axis: 'X', times: ticks, vals: [0, 30, 0, -30, 0] }, { id: 102, node: 2, kind: 'Lcl Rotation', axis: 'Y', times: [0, 1], vals: [0, 0] }, { id: 103, node: 1, kind: 'Lcl Translation', axis: 'Y', times: ticks, vals: [100, 104, 100, 104, 100] }]));
  const clips = importFile(f, { height: 170 });
  assert.deepEqual(Object.keys(clips), ['walk'], 'Walking.fbx is the walk');
  assert.deepEqual(A.validate('mixamo', { class: 'mixamo', version: 1, clips }), []);
  const c = clips.walk;
  assert.equal(c.loop, true, 'walk loops'); assert.equal(c.seconds, 1);
    const w = A.sampleClip(A.compile(c), 0.2).get('LeftUpLeg').q[3];
  assert.ok(Math.abs(2 * Math.acos(Math.abs(w)) / D - 30) < 1.5, 'the 30 degree swing of the thigh');
  const bob = c.tracks.Hips.pos.map((k: number[]) => k[2]);
  assert.ok(Math.abs(Math.max(...bob) - 4 / 170) < 0.004, `the Hips rise 4 cm of 170: ${Math.max(...bob)}`);
  assert.throws(() => { const g = path.join(tmp, 'ascii.fbx'); fs.writeFileSync(g, '; FBX 7.4.0 project file'); importFile(g, {}); }, /binary/i);
});

test('names, merging and our own clips', () => {
  assert.equal(nameOf('Jog_Fwd_Loop'), 'run'); assert.equal(nameOf('Sitting_Exit'), 'stand_up'); assert.equal(nameOf('Some New Clip'), 'some_new_clip');
  const f = path.join(tmp, 'person-clips.glb'), target = path.join(tmp, 'mixamo.json');
  fs.writeFileSync(target, JSON.stringify({ class: 'mixamo', version: 1, clips: { walk: { loop: true, seconds: 1, own: true, tracks: { Hips: { rot: [[0, 0, 0, 0]] } } }, cheer: { loop: false, seconds: 1, own: true, tracks: { Hips: { rot: [[0, 0, 0, 0]] } } } } }));
  const out = fs.readFileSync(path.join(ROOT, 'tools/mixamo-clips.mjs'), 'utf8');
  assert.ok(/own/.test(out));
  // run the command the way a person does
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools/mixamo-clips.mjs'), f, '--into', target, '--rename', 'Wave=wave'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(data.clips.walk.own, true, 'our own walk is not replaced by the library one'); assert.ok(data.clips.cheer, 'our other clips stay'); assert.ok(data.clips.wave && data.clips.wave.source === 'person-clips.glb');
  assert.match(r.stdout, /kept our own walk/);
});
