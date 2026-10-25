// The mirror (public/play/modules/mirror) and what you can be (presence's WHATS, presence-bodies.js), in the real engine
// in Node (test/engine/harness.ts): its settings, names, every body built and sized, the questions in front of a mirror
// (the player stood facing it, the look changing as they choose, the Overseer's end), opening by itself after
// arriving, E near it, and the sandbox's mirror before Pip. The page's clicks aren't here (the harness has no DOM to
// click): the steps are driven through the same functions the buttons call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, world, sceneOf } from './harness.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const H = await load();
const M = H.mirror;
const MC = M.core;
const P = H.presence;
const C = P.core;
const floor = { type: 'box', shape: { size: [80, 1, 80] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 6] } };
const mirror = (character: any = { start: false }) => ({ type: 'mirror', name: 'Mirror', shape: { width: 1.5, height: 2.4, character }, transform: { position: [0, 1.2, 0] } });
const tick = (s: number) => { for (let i = 0; i < Math.round(s * 60); i++) H.tick(1 / 60); };

test('settings: the questions, who you can be, when it opens; a plain mirror; names; the server knows every what', () => {
  assert.deepEqual(MC.cleanConfig(undefined), { off: false, steps: ['what', 'look', 'name'], whats: [], start: false, voice: true, reach: 3 });
  assert.equal(MC.cleanConfig(false).off, true);
  const c = MC.cleanConfig({ steps: ['name', 'nope', 'what', 'name', 'view'], whats: ['animals', 'shoe', 'unicorn'], start: 'always', voice: false, reach: 99 });
  assert.deepEqual(c.steps, ['name', 'what', 'view'], 'known questions, once each, in the given order');
  assert.deepEqual(c.whats, ['animals', 'shoe']);
  assert.equal(c.start, 'always'); assert.equal(c.voice, false); assert.equal(c.reach, 20);
  assert.equal(MC.cleanConfig({ start: true }).start, 'first');
  assert.deepEqual(MC.cleanConfig({ steps: [] }).steps, ['what', 'look', 'name'], 'never no questions');
  const allowed = MC.allowed(c).map((w: any) => w.id);
  assert.ok(allowed.includes('dog') && allowed.includes('shoe') && !allowed.includes('robot') && !allowed.includes('toaster'));
  assert.equal(MC.allowed(MC.cleanConfig({})).length, C.WHATS.length, 'nothing set: anything');

  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const w of C.WHATS) for (let i = 0; i < 5; i++) { const n = MC.suggestName(w.id, rnd); assert.ok(n && n.length <= C.NAME_MAX, `${w.id}: ${n}`); }
  assert.equal(MC.doneLine({ what: 'shoe', name: 'Sir Laces' }), 'Sir Laces the shoe. I will remember that. Go on, then.');

  // Every what has a body, its colors and a line; the server's list (src/presence.ts) is the same.
  for (const w of C.WHATS) {
    assert.ok(w.icon && w.label && w.line && w.colors.length === 3 && w.h > 0.3, w.id);
    assert.ok(w.body === 'person' || P.bodies.THINGS[w.body] || H.living.species.get(w.body), `${w.id}: a body`);
  }
  const server = fs.readFileSync(path.join(ROOT, 'src', 'presence.ts'), 'utf8');
  const list = JSON.parse(/whats: (\[[^\]]+\])/.exec(server)![1].replace(/'/g, '"'));
  assert.deepEqual(list, C.WHATS.map((w: any) => w.id), 'the server accepts exactly the client\'s whats');
  // Looks: a what and a name are kept, anything else is cleaned away.
  const l = C.cleanLook({ what: 'toaster', name: '  Crumbs   <b>McToast</b>\n' + 'x'.repeat(40) });
  assert.equal(l.what, 'toaster');
  assert.ok(l.name.length <= C.NAME_MAX && !/[<>\n]/.test(l.name));
  assert.equal(C.cleanLook({ what: 'unicorn' }).what, 'person');
});

test('every what is built, sized to its height with its feet on the ground, wears hats and glasses, and walks', () => {
  world(H, sceneOf({ floor, start }), { mode: 'play' });
  tick(0.3);
  const p = H.world.player;
  p.view = 'third';
  for (const w of C.WHATS) {
    P.setLook({ what: w.id, body: w.colors[0], accent: w.colors[1], head: w.colors[2], hat: 'tophat', extras: ['glasses', 'cape'], shape: 'normal' });
    tick(0.1);
    const rig = P._internal.rigs.get(p);
    assert.ok(rig, `${w.id}: a rig`);
    assert.equal(rig.what, w.id === 'person' ? 'person' : w.id, `${w.id}: drawn as itself`);
    if (w.body !== 'person') {
      // Its height (the body alone) is the catalog's; its feet are where the capsule's are.
      const bb = rig.body.getHierarchyBoundingVectors(true);
      const feet = p.node.getAbsolutePosition().y - 0.9;
      assert.ok(Math.abs((bb.max.y - bb.min.y) - w.h) < 0.06, `${w.id}: ${(bb.max.y - bb.min.y).toFixed(2)} m tall, want ${w.h}`);
      assert.ok(Math.abs(bb.min.y - feet) < 0.06, `${w.id}: feet on the ground (${bb.min.y.toFixed(2)} vs ${feet.toFixed(2)})`);
      assert.ok(rig.neck && rig.faceZ != null, `${w.id}: a place for hats and glasses`);
      assert.ok(rig.meshes.some((m: any) => /top|brim/.test(m.name)) && rig.meshes.some((m: any) => /lens/.test(m.name)), `${w.id}: wears the hat and the glasses`);
    }
    // Walking moves it (legs, a waddle, or a roll) and nothing throws.
    p.velocity = [3, 0, 0];
    tick(0.2);
  }
  P.setLook({ what: 'person', extras: [], hat: 'none' });
  tick(0.1);
});

test('in front of the mirror: stood facing it, three questions, the look changes as you choose, then the Overseer and an event', async () => {
  world(H, sceneOf({ floor, start, mirror: mirror() }), { mode: 'play' });
  tick(0.3);
  const g = H.game, p = H.world.player;
  const events: any[] = [];
  g.on('mirror', (d: any) => events.push(d));
  const said: string[] = [];
  const say0 = g.overseer.say;
  g.overseer.say = (t: string, s: number) => { said.push(t); return say0(t, s); };
  assert.equal(g.mirror.isOpen, false);
  assert.ok(g.mirror.open('Mirror'));
  const s = M.session;
  assert.ok(s && g.mirror.isOpen && g.mirror.step === 'what');
  // The entrance: they start a few steps back and walk up to the glass, lit by a warm key and a cool rim light.
  assert.ok(p.z > 3.5, 'starts back');
  assert.equal(M._internal.fx().entering, true);
  assert.equal(M._internal.fx().lights, 2);
  assert.ok(H.world.scene.lights.some((l: any) => l.name === 'mirror-key') && H.world.scene.lights.some((l: any) => l.name === 'mirror-rim'));
  await new Promise((r) => setTimeout(r, 1100));
  H.world.scene.render(); // (the effects run on the scene's render)
  assert.equal(M._internal.fx().entering, false);
  assert.equal(M._internal.fx().arrived, true);
  assert.ok(events.some((e) => e.state === 'arrive'), 'arrived');
  // Stood 2.3 m in front of the glass (the mirror faces +z), looking at it, not walking off; and you see yourself.
  assert.ok(Math.abs(p.x - 0) < 0.05 && Math.abs(p.z - 2.3) < 0.05, `stood at ${p.x.toFixed(2)}, ${p.z.toFixed(2)}`);
  assert.equal(p.controls, false);
  assert.equal(p._mirrorShow, true);
  tick(0.1);
  assert.equal(P._internal.rigs.get(p).root.isEnabled(), true, 'your body shows, even in first person');
  assert.ok(said.includes('First question. What are you?'));
  // What are you? A shoe: its colors come with it, and the Overseer has a word.
  M._internal.pickWhat('shoe');
  H.world.scene.render();
  assert.equal(M._internal.fx().popping, true, 'a transformation pop');
  assert.ok(events.some((e) => e.state === 'pick' && e.what === 'shoe' && e.pop), 'the pick says it popped');
  assert.equal(P.look.what, 'shoe');
  assert.equal(P.look.body, C.WHAT.get('shoe').colors[0]);
  await new Promise((r) => setTimeout(r, 450));
  // One line at a time: the remark waits for the question before it to finish (no voice here: time to read it).
  assert.ok(!said.some((t) => /shoe with ambition/.test(t)), 'not over the question');
  assert.equal(M._internal.lines().length, 1, 'waiting its turn');
  await new Promise((r) => setTimeout(r, 3000));
  assert.ok(said.some((t) => /shoe with ambition/.test(t)), 'the Overseer on being a shoe');
  assert.ok(said.indexOf('First question. What are you?') < said.findIndex((t) => /shoe with ambition/.test(t)), 'after the question, in order');
  // A newer question replaces a remark still waiting (they moved on).
  M._internal.pickWhat('toaster');
  await new Promise((r) => setTimeout(r, 450));
  M._internal.pickWhat('shoe');
  M.go(1);
  assert.equal(g.mirror.step, 'look');
  P.setLook({ hat: 'crown', shape: 'tiny' });
  M.go(2);
  assert.equal(g.mirror.step, 'name');
  P.setLook({ name: 'Sir Laces' });
  M.go(3);
  assert.equal(g.mirror.isOpen, false, 'past the last question: done');
  assert.equal(p.controls, true);
  assert.equal(p._mirrorShow, false);
  await new Promise((r) => setTimeout(r, 3200)); // (after what was being said when they finished)
  assert.ok(said.includes('Sir Laces the shoe. I will remember that. Go on, then.'));
  assert.equal(said.filter((t) => /^And what are you called/.test(t)).length <= 1, true, 'questions they skipped past are dropped, not said late');
  const done = events.find((e) => e.state === 'done');
  assert.ok(done && done.what === 'shoe' && done.name === 'Sir Laces' && done.changed);
  assert.deepEqual(events.filter((e) => e.state === 'step').map((e) => e.step), ['what', 'look', 'name']);
  g.overseer.say = say0;
  // The name shows over your head (the tag's name is the character's).
  assert.equal(P._internal.people(true).find((x: any) => x.key === 'me').name, 'Sir Laces');
});

test('a mirror that asks how you see the world sets first or third person; Esc (skip) keeps what you chose', () => {
  world(H, sceneOf({ floor, start, mirror: mirror({ steps: ['view'], voice: false }) }), { mode: 'play' });
  tick(0.3);
  const g = H.game, p = H.world.player;
  p.view = 'first';
  const events: any[] = [];
  g.on('mirror', (d: any) => events.push(d));
  g.mirror.open();
  assert.equal(g.mirror.step, 'view');
  M.session.view = 'third';
  M.go(1);
  assert.equal(p.view, 'third', 'the view they chose');
  g.mirror.open();
  g.mirror.close();
  assert.equal(events.at(-1).state, 'skip');
  assert.equal(p.view, 'third', 'skipping keeps it');
});

test('opens by itself when the player arrives (start), only once with "first"; E near it; a plain mirror never asks', () => {
  M._internal.forget(); // (earlier tests here were in front of a mirror of this same game)
  world(H, sceneOf({ floor, start, mirror: mirror({ start: 'first' }) }), { mode: 'play' });
  assert.ok(H.game.mirror.pending, 'about to open: a greeting waits');
  return new Promise<void>((done) => setTimeout(() => {
    try {
      assert.ok(H.game.mirror.isOpen, 'opened by itself (no intro here: a moment after arriving)');
      H.game.mirror.close();
      // Again on the same page: "first" doesn't open it again.
      world(H, sceneOf({ floor, start, mirror: mirror({ start: 'first' }) }), { mode: 'play' });
      assert.equal(H.game.mirror.pending, false);
      // E near it.
      tick(0.2);
      const p = H.world.player;
      p.position = [0, 0.95, 2];
      const offer = H.use.offers ? H.use.offers(p) : null;
      const near = M._internal.nearestMirror(p, true);
      assert.ok(near, 'a mirror within reach');
      if (offer) assert.ok(offer.some((o: any) => /Change who you are/.test(o.label)));
      // A plain mirror: never.
      world(H, sceneOf({ floor, start, mirror: mirror(false) }), { mode: 'play' });
      assert.equal(H.game.mirror.pending, false);
      assert.equal(H.game.mirror.open(), false);
      assert.equal(M._internal.nearestMirror(H.world.player, false), null);
      // Building: never by itself.
      world(H, sceneOf({ floor, start, mirror: mirror({ start: 'always' }) }), { mode: 'build' });
      assert.equal(H.game.mirror.pending, false);
      done();
    } catch (e) { done(); throw e; }
  }, 1500));
});

test('the sandbox has its mirror by the start, opening every time, and Pip waits for it', async () => {
  const { SANDBOX } = await import('../../src/overseer-games/sandbox.ts');
  const things = SANDBOX.entities();
  const m = things.mirror;
  assert.equal(m.type, 'mirror');
  assert.deepEqual(m.shape.character.steps, ['what', 'look', 'name']);
  assert.equal(m.shape.character.start, 'always');
  const st = things.start.transform.position;
  assert.ok(Math.hypot(m.transform.position[0] - st[0], m.transform.position[2] - st[2]) < 6, 'beside the start');
  const guide = fs.readFileSync(path.join(ROOT, 'src', 'overseer-games', 'sandbox.js'), 'utf8');
  assert.match(guide, /game\.on\('mirror'/, 'Pip begins when the mirror is done');
  assert.match(guide, /mirror\.pending/, 'and not while it is open');
});

test("building: the mirror's card opens its settings; each choice saves shape.character (questions, who, when, the Overseer, plain)", () => {
  const card = H.kinds.get('mirror').editor.card;
  assert.ok(card && /Character mirror/.test(card.label) && typeof card.open === 'function', 'a 🪞 button on its card');
  assert.ok(H.kinds.get('mirror').editor.hotbar.some((h: any) => h.label === 'Mirror'), 'and on the build bar');
  const saved: any[] = [];
  const ctx = { entity: null, spec: { shape: { character: { steps: ['what', 'look', 'name'] } } }, update: (patch: any, label: string) => saved.push({ patch, label }), close() {} };
  card.open(ctx);
  const body = (globalThis as any).document.body;
  const el = body.children[body.children.length - 1];
  const press = (dataset: Record<string, string>) => el.onclick({ target: { closest: () => ({ dataset }) } });
  const last = () => saved[saved.length - 1].patch.shape.character;
  press({ start: 'always' });
  assert.equal(last().start, 'always');
  press({ step: 'view' });
  assert.deepEqual(last().steps, ['what', 'look', 'name', 'view'], 'a question added at the end');
  press({ up: '3' });
  assert.deepEqual(last().steps, ['what', 'look', 'view', 'name'], 'and moved earlier');
  press({ step: 'look' });
  assert.deepEqual(last().steps, ['what', 'view', 'name'], 'one left out');
  press({ who: 'animals' });
  assert.deepEqual(last().whats, ['animals']);
  press({ pick: 'shoe' });
  assert.ok(last().whats.includes('shoe') && last().whats.includes('dog'), 'one by one, from the animals');
  press({ voice: '0' });
  assert.equal(last().voice, false);
  press({ off: '1' });
  assert.equal(last(), false, 'just a mirror');
  press({ off: '0' });
  assert.deepEqual(last().steps, ['what', 'look', 'name'], 'asking again starts from the usual questions');
  press({ a: 'close' });
});

test('every line the Overseer says at the mirror and the ship has its voice (overseer.js VOICES), played from the community library', () => {
  const V = H.overseer.VOICES;
  const need = [MC.OPEN.voice, MC.DONE.voice, ...MC.STEPS.map((s: any) => s.voice), ...C.WHATS.map((w: any) => `overseer-is-${w.id}.mp3`), 'overseer-welcome-aboard.mp3', 'overseer-intro.mp3'];
  for (const n of need) assert.match(V[n] || '', /^a_[0-9a-f]{16}$/, `${n} has a voice`);
  assert.equal(H.overseer.voiceUrl('overseer-is-shoe.mp3'), `/v1/community/${V['overseer-is-shoe.mp3']}/file`);
  assert.equal(H.overseer.voiceUrl('nothing-like-this.mp3'), null);
  const mirror = fs.readFileSync(path.join(ROOT, 'public', 'play', 'modules', 'mirror', 'mirror.js'), 'utf8');
  assert.match(mirror, /overseer-is-\$\{id\}\.mp3/, 'the remark on what you picked is spoken');
});

test('the look step: Surprise me is one click, Preview all is a short carousel, both only touch how you look', () => {
  world(H, sceneOf({ floor, start }), { mode: 'play' });
  tick(0.3);
  const C = H.presence.core, K = M.core;
  assert.deepEqual(K.surprise('dog', 5), K.surprise('dog', 5), 'a seed gives the same surprise');
  const s = K.surprise('person', 11);
  assert.ok(!('what' in s) && !('name' in s) && !('model' in s), 'not who you are or what you are called');
  assert.deepEqual(Object.keys(s).sort(), [...K.LOOK_PARTS].sort());
  assert.ok(K.surprise('dog', 11).head === K.surprise('dog', 11).accent, 'a dog keeps one detail color, not a skin tone');
  const list = K.previews('person', 99);
  assert.equal(list.length, K.PREVIEWS, 'a short carousel');
  assert.ok(new Set(list.map((p: any) => p.accessory)).size >= 6, 'each one dressed differently');
  H.presence.setLook({ what: 'cat', name: 'Socks' });
  H.presence.setLook(K.surprise('cat', 4));
  const lk = H.presence.look;
  assert.equal(lk.what, 'cat'); assert.equal(lk.name, 'Socks');
  assert.equal(lk.accessory, C.cleanLook(K.surprise('cat', 4)).accessory, 'and it is on the reflection at once');
});
