// Studio's quality rules 1 to 4 on the guest sandbox (/play/sandbox), in the real engine: no backwards words, no two faces
// in one plane, nothing drawn inside out, nothing sunk into or floating over the ground. The audit is public/play/world-audit.js,
// the same one Studio's playtest asks a live page for (public/playtest/world-quality.js); here it runs on the built world.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { load, world as run, sceneOf } from './harness.ts';
import { templateBundle } from '../../src/templates.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
require(path.join(ROOT, 'public', 'play', 'modules', 'finish', 'finish-math.js'));
const H = await load();
const g = globalThis as any;
const auditFile = path.join(ROOT, 'public', 'play', 'world-audit.js');
vm.runInThisContext(fs.readFileSync(auditFile, 'utf8'), { filename: auditFile });
const Audit = g.HawkesWorldAudit;

const bundle = templateBundle('sandbox')!;
const scene = JSON.parse(bundle.files['scene.json']);
const show = (ps: any[]) => ps.map((p) => `rule ${p.rule} ${p.kind} ${p.id}: ${p.detail}`).join('\n');

test('world audit: the sandbox island has nothing floating, sunk, backwards, fighting or inside out', () => {
  run(H, { ...scene, config: { ...scene.config, look: false, shadows: false } }, { mode: 'play' });
  H.tick(0.2);
  // (Rule 5, missing assets, needs the server's files: here the bundle has none, so the live playtest checks it.)
  const { problems, counts } = (({ problems, counts }) => ({ problems: problems.filter((p: any) => p.rule !== 5), counts }))(Audit.audit(H));
  if (process.env.AUDIT_PRINT) console.log(JSON.stringify(counts), '\n' + show(problems));
  assert.ok(counts.groundChecked > 20, `checked ${counts.groundChecked} things on the ground`);
  assert.ok(counts.textChecked >= 2, `checked ${counts.textChecked} signs`);
  assert.equal(show(problems), '');
});

test('world audit: it sees each kind of mistake (a floating crate, a sunk one, a buried one, two boxes in one plane, mirrored words, a box drawn inside out)', () => {
  run(H, { ...scene, config: { ...scene.config, look: false, shadows: false } }, { mode: 'play' });
  H.tick(0.1);
  const at = (x: number, z: number) => H.terrain.heightAt(x, z);
  const [x, z] = [6, -6];
  const g0 = at(x, z);
  const box = (id: string, p: number[], size: number[]) => ({ id, type: 'box', name: id, physics: 'static', transform: { position: p }, shape: { size } });
  const bad: Record<string, any> = {
    t_float: box('t_float', [x, g0 + 1.5, z], [1, 1, 1]),
    t_sunk: box('t_sunk', [x + 3, at(x + 3, z) - 0.3, z], [1, 1, 1]),
    t_buried: box('t_buried', [x + 6, at(x + 6, z) - 2, z], [1, 1, 1]),
    t_wide: box('t_wide', [x, at(x, z - 4) + 0.5, z - 4], [2, 1, 2]),
    t_inner: box('t_inner', [x, at(x, z - 4) + 0.5, z - 4], [1, 1, 1]),
    t_words: { id: 't_words', type: 'text', name: 't_words', transform: { position: [x + 3, at(x + 3, z - 4) + 1.2, z - 4], scale: [-1, 1, 1] }, shape: { text: 'READ ME', size: 0.3, billboard: false } },
    t_mirror_box: box('t_mirror_box', [x + 6, at(x + 6, z - 4) + 0.5, z - 4], [1, 1, 1]),
    t_shelf: box('t_shelf', [x + 9, at(x + 9, z) + 0.5, z], [1, 1, 1]),
    t_on_shelf: box('t_on_shelf', [x + 9, at(x + 9, z) + 1.25, z], [0.5, 0.5, 0.5]),
  };
  bad.t_mirror_box.transform.scale = [-1, 1, 1]; // mirrored, but the engine turns its faces round: not inside out
  run(H, { ...scene, entities: { ...scene.entities, ...bad }, config: { ...scene.config, look: false, shadows: false } }, { mode: 'play' });
  H.tick(0.1);
  const B = g.BABYLON;
  const hollow = B.MeshBuilder.CreateBox('hollow', { size: 1, sideOrientation: B.Mesh.BACKSIDE }, H.world.scene);
  hollow.position.set(x - 4, at(x - 4, z) + 0.5, z);
  hollow.material = new B.StandardMaterial('hollow', H.world.scene);
  const { problems } = Audit.audit(H);
  const found = (kind: string, id: string) => problems.some((p: any) => p.kind === kind && p.id === id);
  const why = show(problems);
  assert.ok(found('floating', 't_float'), why);
  assert.ok(found('sunk', 't_sunk'), why);
  assert.ok(found('buried', 't_buried'), why);
  assert.ok(found('zfight', 't_wide') || found('zfight', 't_inner'), why);
  assert.ok(found('backwards', 't_words'), why);
  assert.ok(found('inside-out', 'hollow'), why);
  assert.ok(found('waiting', 'barrel_5'), why); // a fuel barrel whose model the game doesn't have (no files offline)
  for (const ok of ['t_mirror_box', 't_shelf', 't_on_shelf']) assert.ok(!problems.some((p: any) => p.id === ok), `${ok} is fine:\n${why}`);
});
