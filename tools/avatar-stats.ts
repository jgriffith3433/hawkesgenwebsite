// What every body costs today, measured on the real engine (test harness: Babylon's NullEngine, the very presence code):
// triangles, draw calls (one per mesh, nothing merged or instanced yet), materials, height. docs/characters-before.json is
// this tool's output, "the before" docs/characters.md measures its budget against.
//   node --disable-warning=ExperimentalWarning tools/avatar-stats.ts          prints the table
//   node --disable-warning=ExperimentalWarning tools/avatar-stats.ts --write  also writes docs/characters-before.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from '../test/engine/harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const H = await load();
world(H, sceneOf({ floor: { type: 'plane', shape: { width: 10, depth: 10 }, physics: 'static' } }, { player: false }), { mode: 'play' });
const B = (globalThis as any).BABYLON;
const P = H.presence;

export function measure(whatId: string) {
  const node = new B.TransformNode('stand-in', H.world.scene);
  const e = { node, x: 0, y: 0.9, z: 0, alive: true };
  const what = P.core.WHAT.get(whatId);
  const look = P.core.cleanLook({ what: whatId, body: what.colors[0], accent: what.colors[1], head: what.colors[2], face: 'eyes' });
  const rig = P.showcase.make(e, look, look.body);
  const meshes = rig.root.getChildMeshes(false).filter((m: any) => m.getTotalIndices && m.getTotalIndices() > 0);
  const mats = new Set(meshes.map((m: any) => m.material && m.material.name));
  const tris = meshes.reduce((n: number, m: any) => n + m.getTotalIndices() / 3, 0);
  const verts = meshes.reduce((n: number, m: any) => n + m.getTotalVertices(), 0);
  node.computeWorldMatrix(true);
  for (const m of meshes) { m.refreshBoundingInfo(); m.computeWorldMatrix(true); }
  const bb = rig.root.getHierarchyBoundingVectors(true);
  const out = { id: whatId, group: what.group, body: what.body, targetHeight: what.h, height: +(bb.max.y - bb.min.y).toFixed(2), tris: Math.round(tris), verts, drawCalls: meshes.length, materials: mats.size, joints: ['hipL', 'hipR', 'shL', 'shR'].filter((j) => rig[j]).length, legged: Boolean(rig.legged || rig.lv || what.body === 'person') };
  P.showcase.dispose(rig); node.dispose();
  return out;
}

const rows = P.core.WHATS.map((w: any) => measure(w.id));
const total = (k: string) => rows.reduce((n: number, r: any) => n + r[k], 0);
console.log('id'.padEnd(10), 'tris'.padStart(6), 'draws'.padStart(6), 'mats'.padStart(5), 'height'.padStart(7));
for (const r of rows) console.log(r.id.padEnd(10), String(r.tris).padStart(6), String(r.drawCalls).padStart(6), String(r.materials).padStart(5), String(r.height).padStart(7));
console.log(`${rows.length} bodies · median ${[...rows].sort((a: any, b: any) => a.tris - b.tris)[Math.floor(rows.length / 2)].tris} tris · max ${Math.max(...rows.map((r: any) => r.tris))} tris · max ${Math.max(...rows.map((r: any) => r.drawCalls))} draw calls · total ${total('tris')} tris`);
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(ROOT, 'docs', 'characters-before.json'), JSON.stringify({ measured: 'tools/avatar-stats.ts', note: 'Before the art pass: every body as it is, face "eyes", no hat, its own colors. drawCalls = meshes (nothing merged).', bodies: rows }, null, 1) + '\n');
}
process.exit(0);
