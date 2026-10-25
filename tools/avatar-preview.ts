// A software preview of the person (no browser, no GPU): the real presence code builds and moves it on the test engine, and this draws the
// triangles orthographically with a z-buffer, vertex colors and one flat light, to a PNG. A way to look at a shape, a hair or a pose
// where no browser can run; the real picture (rim light, shadows) is /avatars?body=person. Used for docs/characters-person-*.png.
//   node --disable-warning=ExperimentalWarning tools/avatar-preview.ts <repoRoot> <out.png> <front|side|three> <pose> <hair> [seconds] [face] [expression]
import fs from 'node:fs'; import zlib from 'node:zlib';
const [root, out, view = 'front', pose = 'idle', hair = 'short', tS = '1.2', faceArg = 'eyes', expr = ''] = process.argv.slice(2);
const { load, world, sceneOf } = await import(root + '/test/engine/harness.ts');
const H = await load(); const P = H.presence; const C = P.core; const B = (globalThis as any).BABYLON;
world(H, sceneOf({}, { player: false }), { mode: 'play' });
const node = new B.TransformNode('s', H.world.scene); const e: any = { node, x: 0, y: 0.9, z: 0, alive: true };
const look = C.cleanLook({ what: 'person', face: faceArg, hair, body: '#4a9eff', head: '#f2c9a0', accent: '#f4a3b5', ...(C.LOOK.hairs ? {} : {}) });
const rig = P.showcase.make(e, look, look.body);
rig.forcePose = ['jump', 'fall', 'swim', 'drive'].includes(pose) ? pose : null;
const speed = pose === 'walk' ? 2.6 : pose === 'run' ? 6.5 : 0;
if (rig.person && expr) rig.person.rest = expr;
if (!rig.person) { /* old build */ }
const em = C.emote(pose); if (em) rig.emote = { def: em, t0: 0 };
rig.lookTarget = [0, 1.3, 5];
for (let i = 0; i < Math.round(Number(tS) * 60); i++) { e.x += speed / 60; P.showcase.animate(rig, 1 / 60); }
node.computeWorldMatrix(true);
const W = 360, Hh = 520, scale = 235; // pixels per meter
let minY = 1e9;
for (const m of rig.root.getChildMeshes(false)) { if (!m.isEnabled() || !m.getTotalIndices()) continue; m.computeWorldMatrix(true); const wm = m.getWorldMatrix().m, pos = m.getVerticesData('position'); for (let i = 0; i < pos.length; i += 3) minY = Math.min(minY, pos[i] * wm[1] + pos[i + 1] * wm[5] + pos[i + 2] * wm[9] + wm[13]); }
const lowered = Math.max(0, minY + 0.9); // a jump or a fall in the air: draw it at the bottom of the frame
const views = view === 'three' ? ['front', 'three', 'side'] : [view];
const img = Buffer.alloc(W * views.length * Hh * 3, 235);
const zb = new Float32Array(W * views.length * Hh).fill(-1e9);
const mats = (m: any) => m.material && m.material.diffuseColor ? [m.material.diffuseColor.r, m.material.diffuseColor.g, m.material.diffuseColor.b] : [0.7, 0.7, 0.7];
views.forEach((v, vi) => {
  const yaw = v === 'front' ? 0 : v === 'side' ? Math.PI / 2 : 0.6; // camera orbits: rotate the world by -yaw
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (const m of rig.root.getChildMeshes(false)) {
    if (!m.isEnabled() || !m.getTotalIndices()) continue;
    m.computeWorldMatrix(true);
    const wm = m.getWorldMatrix().m;
    const pos = m.getVerticesData('position'), nor = m.getVerticesData('normal'), col = m.getVerticesData('color'), idx = m.getIndices();
    const nv = pos.length / 3, P2: number[][] = [], N2: number[][] = [], C2: number[][] = [];
    const flatc = mats(m);
    for (let i = 0; i < nv; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      let wx = x * wm[0] + y * wm[4] + z * wm[8] + wm[12], wy = x * wm[1] + y * wm[5] + z * wm[9] + wm[13], wz = x * wm[2] + y * wm[6] + z * wm[10] + wm[14];
      const nx = nor ? nor[i * 3] : 0, ny = nor ? nor[i * 3 + 1] : 1, nz = nor ? nor[i * 3 + 2] : 0;
      let wnx = nx * wm[0] + ny * wm[4] + nz * wm[8], wny = nx * wm[1] + ny * wm[5] + nz * wm[9], wnz = nx * wm[2] + ny * wm[6] + nz * wm[10];
      const l = Math.hypot(wnx, wny, wnz) || 1; wnx /= l; wny /= l; wnz /= l;
      // rotate about y by -yaw so the camera looks from +z
      const rx = wx * cy - wz * sy, rz = wx * sy + wz * cy, rnx = wnx * cy - wnz * sy, rnz = wnx * sy + wnz * cy;
      P2.push([rx, wy, rz]); N2.push([rnx, wny, rnz]); C2.push(col ? [col[i * 4], col[i * 4 + 1], col[i * 4 + 2]] : flatc);
    }
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const pts = [P2[a], P2[b], P2[c]].map((p) => [W / 2 + p[0] * scale + vi * W, Hh - 50 - (p[1] + 0.9 - lowered) * scale, p[2]]);
      // back-face cull: the camera looks down -z; Babylon front faces: cross . normal < 0
      const ux = P2[b][0] - P2[a][0], uy = P2[b][1] - P2[a][1], uz = P2[b][2] - P2[a][2], vx = P2[c][0] - P2[a][0], vy = P2[c][1] - P2[a][1], vz = P2[c][2] - P2[a][2];
      const cz = ux * vy - uy * vx; // z of the cross
      const gn = [uy * vz - uz * vy, uz * vx - ux * vz, cz];
      const nn = N2[a]; const facing = gn[0] * nn[0] + gn[1] * nn[1] + gn[2] * nn[2];
      const outward = facing < 0 ? -1 : 1; // by the winding rule, a front face has cross.n < 0
      if (facing >= 0) continue; // inside-out triangle (seen from behind): skip like culling
      if (gn[2] * -1 < 0 && false) continue;
      // Is the triangle facing the camera (+z)? the true normal is -gn (by the rule)
      if (-gn[2] <= 0) continue;
      const minx = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), maxx = Math.min(W * views.length - 1, Math.ceil(Math.max(...pts.map((p) => p[0]))));
      const miny = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), maxy = Math.min(Hh - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))));
      const [p0, p1, p2] = pts; const den = (p1[1] - p2[1]) * (p0[0] - p2[0]) + (p2[0] - p1[0]) * (p0[1] - p2[1]);
      if (Math.abs(den) < 1e-9) continue;
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const l0 = ((p1[1] - p2[1]) * (x + 0.5 - p2[0]) + (p2[0] - p1[0]) * (y + 0.5 - p2[1])) / den, l1 = ((p2[1] - p0[1]) * (x + 0.5 - p2[0]) + (p0[0] - p2[0]) * (y + 0.5 - p2[1])) / den, l2 = 1 - l0 - l1;
        if (l0 < -0.001 || l1 < -0.001 || l2 < -0.001) continue;
        const z = l0 * p0[2] + l1 * p1[2] + l2 * p2[2];
        const pi = y * W * views.length + x;
        if (z <= zb[pi]) continue;
        zb[pi] = z;
        const nx = l0 * N2[a][0] + l1 * N2[b][0] + l2 * N2[c][0], ny = l0 * N2[a][1] + l1 * N2[b][1] + l2 * N2[c][1], nz = l0 * N2[a][2] + l1 * N2[b][2] + l2 * N2[c][2];
        const nl = Math.hypot(nx, ny, nz) || 1;
        const lit = 0.6 + 0.4 * Math.max(0, (nx * -0.3 + ny * 0.5 + nz * 0.8) / nl);
        const cc = [0, 1, 2].map((k) => l0 * C2[a][k] + l1 * C2[b][k] + l2 * C2[c][k]);
        for (let k = 0; k < 3; k++) img[pi * 3 + k] = Math.round(Math.min(1, cc[k] * lit) * 255);
      }
    }
  }
});
// png
const w = W * views.length; const raw = Buffer.alloc((w * 3 + 1) * Hh);
for (let y = 0; y < Hh; y++) { raw[y * (w * 3 + 1)] = 0; img.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(Hh, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
process.exit(0);
