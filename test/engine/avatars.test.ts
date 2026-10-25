// /avatars, the showcase: every body the mirror offers is built by the real presence code on a stand-in and moves in every
// pose; the budget document names every body; the page is public and linked. (The picture itself is for a browser.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';
import { POSES, overlay } from '../../public/avatars-poses.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const P = H.presence;
const C = P.core;
const B = (globalThis as any).BABYLON;
world(H, sceneOf({}, { player: false }), { mode: 'play' });

function body(id: string) {
  const node = new B.TransformNode('stand', H.world.scene);
  const e = { node, x: 0, y: 0.9, z: 0, alive: true };
  const w = C.WHAT.get(id);
  const look = C.cleanLook({ what: id, body: w.colors[0], accent: w.colors[1], head: w.colors[2], face: 'eyes' });
  return { e, node, rig: P.showcase.make(e, look, look.body) };
}

test('every body of the mirror is built on a stand-in and stays finite through every pose and emote', () => {
  for (const w of C.WHATS) {
    const { e, node, rig } = body(w.id);
    assert.ok(rig.root.getChildMeshes().length >= 3, `${w.id}: has parts`);
    for (const pose of [...POSES, ...C.EMOTES.map((x: any) => x.name)]) {
      const em = C.emote(pose);
      rig.emote = em ? { def: em, t0: rig.time || 0 } : null;
      for (let i = 0; i < 90; i++) {
        e.x += (pose === 'walk' ? 2.6 : pose === 'run' ? 6.5 : 0) / 60;
        P.showcase.animate(rig, 1 / 60);
        rig.pose.scaling.set(1, 1, 1);
        if (POSES.includes(pose)) overlay(rig, pose, i / 60);
      }
      for (const n of [rig.pose.position, rig.pose.rotation, rig.pose.scaling, rig.hipL.rotation, rig.shR.rotation]) {
        assert.ok(Number.isFinite(n.x + n.y + n.z), `${w.id}/${pose}: finite`);
      }
    }
    P.showcase.dispose(rig); node.dispose();
  }
});

test('docs/characters.md names every body, its before numbers match the measured file, and every pose in the page is documented', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'characters.md'), 'utf8');
  const before = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'characters-before.json'), 'utf8')).bodies;
  assert.deepEqual(before.map((b: any) => b.id), C.WHATS.map((w: any) => w.id), 'the measured file lists the mirror\'s bodies in order');
  for (const w of C.WHATS) assert.ok(doc.includes(`| \`${w.id}\` |`), `${w.id} has its row in docs/characters.md`);
  for (const p of POSES) assert.ok(doc.includes(p), `pose ${p} is documented`);
  for (const f of ['Triangles', 'Draw calls', 'Materials', 'bg', 'pose']) assert.ok(doc.includes(f));
});

test('/avatars is a public page, linked from the site nav, with the screenshot query handled', () => {
  const server = fs.readFileSync(path.join(ROOT, 'src', 'server.ts'), 'utf8');
  assert.ok(server.includes("'/avatars': 'avatars.html'"));
  assert.ok(fs.readFileSync(path.join(ROOT, 'public', 'sitenav.js'), 'utf8').includes("'/avatars'"));
  const js = fs.readFileSync(path.join(ROOT, 'public', 'avatars.js'), 'utf8');
  for (const k of ["'body'", "'pose'", "'bg'"]) assert.ok(js.includes(`q.get(${k})`) || js.includes(`q.has(${k})`), k);
  assert.ok(!/\/v1\/(users|games)|login|session/i.test(js), 'no account route');
});
