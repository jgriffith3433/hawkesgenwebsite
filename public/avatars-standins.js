// Stand-in models for the Gen model support (docs/characters.md "Gen models"): four tiny models made of boxes, one for each
// way a model can be built (a skinned biped with clips; a quadruped of rigid parts with no clips; a fish of one mesh and a fin;
// a thing with legs of rigid parts), so the loader, the anchors, the clips and the procedural fallbacks can be tried without
// the GPU and before the real models exist. Two ways to get one from the same description:
//   toGlb(spec)                   real GLB bytes (a skinned mesh with a skeleton and animations for the biped): what /avatars?standin=1
//                                 loads through Babylon's own glTF loader, and what test/fixtures/models/*.glb are made from
//                                 (node tools/standin-glbs.mjs)
//   toContainer(B, scene, spec)   the same model as a Babylon AssetContainer (rigid, in the loader's own handedness), for tests in
//                                 Node, where Babylon has no glTF loader
// A node: { name, t: [x, y, z], box?: [w, h, d] (a box mesh centered on the node), color?, kids? }.
// A clip: { name, tracks: [{ node, axis, keys: [[seconds, radians], ...] }] } (a rotation about an axis, looped).
// Authored as a glTF is: y up, the front toward +z.
/* eslint-disable */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

export const STANDINS = {
  biped: {
    form: 'biped', title: 'Stand-in biped (skinned, clips)',
    nodes: [{ name: 'Hips', t: [0, 0.9, 0], kids: [
      { name: 'Spine', t: [0, 0.1, 0], kids: [{ name: 'Head', t: [0, 0.55, 0] }] },
      { name: 'LegL', t: [0.12, -0.05, 0] }, { name: 'LegR', t: [-0.12, -0.05, 0] },
    ] }],
    skin: [ // (boxes bound to a joint: one skinned mesh in the GLB)
      { joint: 'Hips', box: [0.34, 0.2, 0.2], at: [0, 0, 0], color: '#2563eb' },
      { joint: 'Spine', box: [0.4, 0.55, 0.22], at: [0, 0.3, 0], color: '#f59e0b' },
      { joint: 'Head', box: [0.28, 0.28, 0.28], at: [0, 0.17, 0], color: '#f2c9a0' },
      { joint: 'Head', box: [0.06, 0.05, 0.04], at: [0, 0.2, 0.15], color: '#7a3b1d' },
      { joint: 'LegL', box: [0.14, 0.85, 0.14], at: [0, -0.425, 0], color: '#1f2937' },
      { joint: 'LegR', box: [0.14, 0.85, 0.14], at: [0, -0.425, 0], color: '#1f2937' },
    ],
    clips: [
      { name: 'Idle', tracks: [{ node: 'Spine', axis: 'x', keys: [[0, 0], [1, 0.03], [2, 0]] }] },
      { name: 'Walk', tracks: [{ node: 'LegL', axis: 'x', keys: [[0, 0.5], [0.5, -0.5], [1, 0.5]] }, { node: 'LegR', axis: 'x', keys: [[0, -0.5], [0.5, 0.5], [1, -0.5]] }] },
      { name: 'Jump', tracks: [{ node: 'LegL', axis: 'x', keys: [[0, 0], [0.4, -0.8], [0.8, 0]] }, { node: 'LegR', axis: 'x', keys: [[0, 0], [0.4, -0.8], [0.8, 0]] }] },
    ],
    row: {
      form: 'biped', h: 1.8,
      anchors: { head: { node: 'Head', at: [0, 0.31, 0] }, face: { node: 'Head', at: [0, 0.2, 0.14] }, neck: { node: 'Head', at: [0, -0.02, 0] }, back: { node: 'Spine', at: [0, 0.3, -0.11] }, rump: { node: 'Hips', at: [0, -0.05, -0.1] } },
      clips: { idle: 'Idle', walk: 'Walk', jump: 'Jump' },
    },
  },
  quadruped: {
    form: 'quadruped', title: 'Stand-in quadruped (rigid parts, no clips)',
    nodes: [{ name: 'Body', t: [0, 0.55, 0], box: [0.36, 0.3, 0.8], color: '#c98f4f', kids: [
      { name: 'Head', t: [0, 0.18, 0.5], box: [0.26, 0.26, 0.3], color: '#c98f4f' },
      { name: 'Tail', t: [0, 0.1, -0.45], box: [0.06, 0.06, 0.3], color: '#3a2a1c' },
      { name: 'LegFL', t: [0.13, -0.15, 0.3], box: [0.1, 0.4, 0.1], color: '#3a2a1c' }, { name: 'LegFR', t: [-0.13, -0.15, 0.3], box: [0.1, 0.4, 0.1], color: '#3a2a1c' },
      { name: 'LegBL', t: [0.13, -0.15, -0.3], box: [0.1, 0.4, 0.1], color: '#3a2a1c' }, { name: 'LegBR', t: [-0.13, -0.15, -0.3], box: [0.1, 0.4, 0.1], color: '#3a2a1c' },
    ] }],
    clips: [],
    row: {
      form: 'quadruped', h: 0.95,
      anchors: { head: { node: 'Head', at: [0, 0.13, 0] }, face: { node: 'Head', at: [0, 0.03, 0.15] }, neck: { node: 'Head', at: [0, -0.1, -0.12] }, back: { node: 'Body', at: [0, 0.15, 0] }, rump: { node: 'Body', at: [0, 0.1, -0.4] } },
      parts: [{ node: 'LegFL', role: 'leg' }, { node: 'LegBR', role: 'leg' }, { node: 'LegFR', role: 'leg', ph: Math.PI }, { node: 'LegBL', role: 'leg', ph: Math.PI }, { node: 'Tail', role: 'tail', axis: 'y' }],
    },
  },
  swimmer: {
    form: 'swimmer', title: 'Stand-in fish (one mesh and a fin, anchors from its box)',
    nodes: [
      { name: 'Fish', t: [0, 0.3, 0], box: [0.2, 0.4, 0.8], color: '#f08a2c' },
      { name: 'TailFin', t: [0, 0.3, -0.5], box: [0.04, 0.34, 0.2], color: '#ffffff' },
    ],
    clips: [],
    row: { form: 'swimmer', h: 0.6, parts: [{ node: 'TailFin', role: 'fin', axis: 'y' }] },
  },
  thing: {
    form: 'thing', title: 'Stand-in toaster (rigid parts, legs)',
    nodes: [{ name: 'Toaster', t: [0, 0.65, 0], box: [0.6, 0.5, 0.4], color: '#b8bfcc', kids: [
      { name: 'Slot', t: [0, 0.26, 0], box: [0.4, 0.04, 0.12], color: '#2b2f3a' },
      { name: 'LegL', t: [0.15, -0.25, 0], box: [0.1, 0.4, 0.1], color: '#2b2f3a' }, { name: 'LegR', t: [-0.15, -0.25, 0], box: [0.1, 0.4, 0.1], color: '#2b2f3a' },
    ] }],
    clips: [],
    row: { form: 'thing', h: 1.15, parts: [{ node: 'LegL', role: 'leg' }, { node: 'LegR', role: 'leg', ph: Math.PI }] },
  },
};
/**
 * A stand-in on the standard Mixamo skeleton (docs/animations.md): rigid boxes on bones named as Mixamo names them, in a T-pose
 * (x is the character's left), 1.8 m tall. The Mixamo re-rig of the real models comes from Gen's mesh.rig; until a model has it, this
 * puppet is what /avatars?standin=mixamo and the tests move with the class's clips. `prefix` is `mixamorig:` (as Mixamo exports),
 * `mixamorig7:` or '' (a rig whose names were cleaned): all the same bones.
 */
export function mixamoPuppet(prefix = 'mixamorig:') {
  const b = (name, t, box, color, kids) => ({ name: prefix + name, t, ...(box ? { box, color } : {}), ...(kids ? { kids } : {}) });
  const arm = (s, x) => b(`${s}Shoulder`, [0.05 * x, 0.12, 0], [0.1, 0.1, 0.12], '#2563eb', [
    b(`${s}Arm`, [0.1 * x, 0, 0], [0.26, 0.1, 0.1], '#2563eb', [
      b(`${s}ForeArm`, [0.26 * x, 0, 0], [0.26, 0.08, 0.08], '#f2c9a0', [
        b(`${s}Hand`, [0.26 * x, 0, 0], [0.1, 0.05, 0.1], '#f2c9a0')])])]);
  const leg = (s, x) => b(`${s}UpLeg`, [0.1 * x, -0.05, 0], [0.14, 0.42, 0.14], '#1f2937', [
    b(`${s}Leg`, [0, -0.42, 0], [0.12, 0.42, 0.12], '#1f2937', [
      b(`${s}Foot`, [0, -0.42, 0], [0.12, 0.06, 0.12], '#7a3b1d', [
        b(`${s}ToeBase`, [0, -0.04, 0.1], [0.12, 0.05, 0.1], '#7a3b1d')])])]);
  return {
    form: 'biped', title: 'Stand-in biped on the Mixamo skeleton (rigid boxes, no clips)',
    nodes: [b('Hips', [0, 0.95, 0], [0.32, 0.18, 0.2], '#1f2937', [
      b('Spine', [0, 0.1, 0], [0.3, 0.12, 0.18], '#f59e0b', [
        b('Spine1', [0, 0.12, 0], [0.34, 0.12, 0.2], '#f59e0b', [
          b('Spine2', [0, 0.12, 0], [0.38, 0.14, 0.22], '#f59e0b', [
            b('Neck', [0, 0.18, 0], [0.08, 0.1, 0.08], '#f2c9a0', [
              b('Head', [0, 0.1, 0], [0.24, 0.26, 0.24], '#f2c9a0', [b('HeadTop_End', [0, 0.2, 0], [0.04, 0.04, 0.04], '#f2c9a0')])]),
            arm('Left', 1), arm('Right', -1)])])]),
      leg('Left', 1), leg('Right', -1)])],
    clips: [],
    row: {
      form: 'biped', h: 1.8,
      anchors: { head: { node: prefix + 'Head', at: [0, 0.13, 0] }, face: { node: prefix + 'Head', at: [0, 0.02, 0.12] }, neck: { node: prefix + 'Head', at: [0, -0.13, 0] }, back: { node: prefix + 'Spine2', at: [0, 0.05, -0.12] }, rump: { node: prefix + 'Hips', at: [0, -0.05, -0.12] } },
    },
  };
}
export const MIXAMO_STANDIN = mixamoPuppet('mixamorig:'); // (not in STANDINS: those four have GLB fixtures)

/** Which registry row each stand-in fills in the showcase and the tests (a real type each): the body to compare it with. */
export const STANDIN_FOR = { person: 'biped', dog: 'quadruped', fish: 'swimmer', toaster: 'thing' };

// ------------------------------------------------------------------ the same model as a Babylon container (Node)
export function toContainer(B, scene, spec) {
  const c = new B.AssetContainer(scene);
  // (Babylon's glTF loader hangs a model under __root__ turned half way round with z mirrored (scaling z -1): a glTF's front, +z, stays +z
  // once loaded and only x is mirrored: measured with the real loader on the Gen models, 2026-10-25.)
  const root = new B.TransformNode('__root__', scene);
  root.rotationQuaternion = B.Quaternion.RotationAxis(B.Vector3.Up(), Math.PI);
  root.scaling.z = -1;
  c.transformNodes.push(root);
  const byName = new Map(), mats = new Map();
  const mat = (col) => {
    if (!mats.has(col)) { const m = new B.StandardMaterial(`standin-${col}`, scene); m.diffuseColor = new B.Color3(...hex(col)); mats.set(col, m); c.materials.push(m); }
    return mats.get(col);
  };
  const addBox = (name, size, at, color, parent) => {
    const m = B.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene);
    m.parent = parent; m.position.set(at[0], at[1], at[2]); m.material = mat(color || '#cccccc');
    c.meshes.push(m);
    return m;
  };
  const make = (n, parent) => {
    const t = new B.TransformNode(n.name, scene);
    t.parent = parent; t.position.set(n.t[0], n.t[1], n.t[2]); t.rotationQuaternion = B.Quaternion.Identity();
    c.transformNodes.push(t); byName.set(n.name, t);
    if (n.box) addBox(`${n.name}-mesh`, n.box, [0, 0, 0], n.color, t);
    for (const k of n.kids || []) make(k, t);
  };
  for (const n of spec.nodes) make(n, root);
  for (const p of spec.skin || []) addBox(`${p.joint}-skin`, p.box, p.at, p.color, byName.get(p.joint));
  for (const clip of spec.clips || []) {
    const g = new B.AnimationGroup(clip.name, scene);
    for (const tr of clip.tracks) {
      const a = new B.Animation(`${clip.name}-${tr.node}`, 'rotationQuaternion', 30, B.Animation.ANIMATIONTYPE_QUATERNION, B.Animation.ANIMATIONLOOPMODE_CYCLE);
      const axis = tr.axis === 'y' ? B.Vector3.Up() : tr.axis === 'z' ? B.Vector3.Forward() : B.Vector3.Right();
      a.setKeys(tr.keys.map(([s, r]) => ({ frame: Math.round(s * 30), value: B.Quaternion.RotationAxis(axis, r) })));
      g.addTargetedAnimation(a, byName.get(tr.node));
    }
    c.animationGroups.push(g);
  }
  c.removeAllFromScene();
  return c;
}

// ------------------------------------------------------------------ the same model as GLB bytes
const QUAT = { x: (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)], y: (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)], z: (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)] };
function boxGeometry(size, at) {
  const [w, h, d] = size.map((v) => v / 2), pos = [], nor = [], idx = [];
  const faces = [ // normal, then the four corners (counter-clockwise seen from outside)
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]], [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]], [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
  ];
  for (const [n, cs] of faces) {
    const base = pos.length / 3;
    for (const c of cs) { pos.push(c[0] * w + at[0], c[1] * h + at[1], c[2] * d + at[2]); nor.push(n[0], n[1], n[2]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, nor, idx };
}
export function toGlb(spec) {
  const json = { asset: { version: '2.0', generator: 'hawkesgen stand-in' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = []; let size = 0;
  const view = (data, target) => { // data: a typed array
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    json.bufferViews.push({ buffer: 0, byteOffset: size, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes, new Uint8Array(pad)); size += bytes.length + pad;
    return json.bufferViews.length - 1;
  };
  const accessor = (data, componentType, type, count, extra = {}) => { json.accessors.push({ bufferView: view(data, extra.target), componentType, count, type, ...extra.rest }); return json.accessors.length - 1; };
  const matIndex = new Map();
  const material = (col) => {
    if (!matIndex.has(col)) { json.materials.push({ name: col, pbrMetallicRoughness: { baseColorFactor: [...hex(col), 1], metallicFactor: 0, roughnessFactor: 0.8 } }); matIndex.set(col, json.materials.length - 1); }
    return matIndex.get(col);
  };
  const geometryMesh = (name, geos) => { // geos: [{ size, at, color, joint? }] -> one mesh, a primitive per color
    const prims = [];
    for (const col of [...new Set(geos.map((g) => g.color))]) {
      const pos = [], nor = [], idx = [], joints = [];
      for (const g of geos.filter((x) => x.color === col)) {
        const b = boxGeometry(g.size, g.at), base = pos.length / 3;
        pos.push(...b.pos); nor.push(...b.nor); idx.push(...b.idx.map((i) => i + base));
        for (let i = 0; i < b.pos.length / 3; i++) joints.push(g.joint || 0, 0, 0, 0);
      }
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pos[i + k]); hi[k] = Math.max(hi[k], pos[i + k]); }
      const attributes = {
        POSITION: accessor(new Float32Array(pos), 5126, 'VEC3', pos.length / 3, { target: 34962, rest: { min: lo, max: hi } }),
        NORMAL: accessor(new Float32Array(nor), 5126, 'VEC3', nor.length / 3, { target: 34962 }),
      };
      if (geos[0].joint !== undefined) {
        attributes.JOINTS_0 = accessor(new Uint8Array(joints), 5121, 'VEC4', joints.length / 4, { target: 34962 });
        const w = []; for (let i = 0; i < joints.length / 4; i++) w.push(1, 0, 0, 0);
        attributes.WEIGHTS_0 = accessor(new Float32Array(w), 5126, 'VEC4', w.length / 4, { target: 34962 });
      }
      prims.push({ attributes, indices: accessor(new Uint16Array(idx), 5123, 'SCALAR', idx.length, { target: 34963 }), material: material(col) });
    }
    json.meshes.push({ name, primitives: prims });
    return json.meshes.length - 1;
  };
  const index = new Map(), world = new Map();
  const add = (n, parentPos) => {
    const node = { name: n.name, translation: n.t };
    const i = json.nodes.push(node) - 1; index.set(n.name, i);
    const wp = [parentPos[0] + n.t[0], parentPos[1] + n.t[1], parentPos[2] + n.t[2]]; world.set(n.name, wp);
    if (n.box) node.mesh = geometryMesh(`${n.name}-mesh`, [{ size: n.box, at: [0, 0, 0], color: n.color || '#cccccc' }]);
    const kids = (n.kids || []).map((k) => add(k, wp));
    if (kids.length) node.children = kids;
    return i;
  };
  const tops = spec.nodes.map((n) => add(n, [0, 0, 0]));
  json.scenes[0].nodes.push(...tops);
  if (spec.skin && spec.skin.length) {
    const joints = [...index.keys()].filter((k) => !json.nodes[index.get(k)].mesh); // every joint of the skeleton
    const order = joints.map((k) => index.get(k));
    const ibm = new Float32Array(joints.length * 16);
    joints.forEach((k, j) => { ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -world.get(k)[0], -world.get(k)[1], -world.get(k)[2], 1], j * 16); });
    json.skins = [{ joints: order, inverseBindMatrices: accessor(ibm, 5126, 'MAT4', joints.length), skeleton: tops[0] }];
    const geos = spec.skin.map((p) => { const at = world.get(p.joint); return { size: p.box, at: [at[0] + p.at[0], at[1] + p.at[1], at[2] + p.at[2]], color: p.color, joint: joints.indexOf(p.joint) }; });
    const body = json.nodes.push({ name: 'Body', mesh: geometryMesh('Body', geos), skin: 0 }) - 1;
    json.scenes[0].nodes.push(body);
  }
  if (spec.clips && spec.clips.length) {
    json.animations = spec.clips.map((clip) => {
      const samplers = [], channels = [];
      for (const tr of clip.tracks) {
        const times = new Float32Array(tr.keys.map((k) => k[0])), quats = new Float32Array(tr.keys.flatMap((k) => QUAT[tr.axis || 'x'](k[1])));
        const input = accessor(times, 5126, 'SCALAR', times.length, { rest: { min: [times[0]], max: [times[times.length - 1]] } });
        const output = accessor(quats, 5126, 'VEC4', tr.keys.length);
        samplers.push({ input, output, interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: index.get(tr.node), path: 'rotation' } });
      }
      return { name: clip.name, samplers, channels };
    });
  }
  json.buffers.push({ byteLength: size });
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.length % 4)) % 4;
  const total = 12 + 8 + text.length + jsonPad + 8 + size;
  const out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, text.length + jsonPad, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + text.length + jsonPad);
  const b0 = 20 + text.length + jsonPad;
  dv.setUint32(b0, size, true); dv.setUint32(b0 + 4, 0x004e4942, true);
  let o = b0 + 8;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/** The registry rows the stand-ins fill (type -> a row naming `url`), and the spec of each by that url. */
export function standinRows(prefix = 'standin:') {
  const rows = {};
  for (const [what, key] of Object.entries(STANDIN_FOR)) rows[what] = { ...STANDINS[key].row, url: `${prefix}${key}`, yaw: 0 }; // (a stand-in is drawn facing +z like every file, which the loader keeps at +z: no turn, as for the Gen-made models)
  return rows;
}
export const specOf = (url, prefix = 'standin:') => STANDINS[String(url).slice(prefix.length)];
