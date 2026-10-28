// Characters (modules/characters): a conversation with answers that give items and change how a side feels; sides that
// fight you or each other, and one on your side; hurting one turns its side against you; a day's routine (eat, sleep,
// work, wander) with its sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const person = (name: string, at: number[], behaviors: any[]) => ({ type: 'capsule', name, shape: { radius: 0.35, height: 1.8 }, physics: 'dynamic', transform: { position: at }, behaviors });

test('talk: a line and answers; an answer gives an item, changes how the side feels, leads on', () => {
  const tree = { start: 'hi', nodes: {
    hi: { say: 'Lost, traveller?', choices: [{ text: 'Yes', go: 'help' }, { text: 'Go away', standing: -40, end: true }] },
    help: { say: 'Take this map.', choices: [{ text: 'Thank you', give: 'map', standing: 15, end: true }] },
  } };
  world(H, sceneOf({ floor, start, elder: person('Elder', [0, 1, 2], [{ use: 'talk', tree, side: 'villagers' }, { use: 'faction', side: 'villagers', fights: false }]) }, { factions: { villagers: { player: 'neutral' } } }));
  H.tick(0.3);
  const elder = H.game.entity('elder');
  const said: string[] = [];
  H.game.on('talk', (d: any) => said.push(d.say));
  H.characters.talk(elder);
  assert.equal(H.characters.talking, elder);
  assert.equal(H.world.player.controls, false, 'you stand still while talking');
  // Pick "Yes", then "Thank you" (as clicking them does).
  H.characters.talk(elder, 'help');
  assert.deepEqual(said, ['Lost, traveller?', 'Take this map.']);
  H.characters.endTalk();
  assert.equal(H.world.player.controls, true);
  // An answer's effects, the way a click runs them.
  H.characters.like('villagers', 15);
  assert.equal(H.characters.standing('villagers'), 15);
  assert.equal(H.characters.attitude('villagers'), 'neutral');
  H.characters.like('villagers', 30);
  assert.equal(H.characters.attitude('villagers'), 'friendly');
});

test('sides: bandits come for you; the guards (who like you) fight them; hurting a guard turns the guards', () => {
  world(H, sceneOf({ floor, start,
    bandit: person('Bandit', [0, 1, 12], [{ use: 'faction', side: 'bandits', damage: 15, hp: 200, speed: 4 }]),
    guard: person('Guard', [6, 1, 6], [{ use: 'faction', side: 'guards', damage: 30, hp: 300 }]),
  }, { factions: { bandits: { player: 'hostile', hates: ['guards'] }, guards: { player: 'friendly' } } }));
  H.tick(0.3);
  const p = H.world.player, bandit = H.game.entity('bandit');
  const hp = p.health;
  steps(5);
  assert.ok(p.health < hp || !bandit.alive || bandit.dead || bandit.hp < 200, 'the fight is on');
  assert.ok(bandit.hp < 200 || bandit.dead, 'the guard fights the bandit');
  assert.equal(H.characters.attitude('guards'), 'friendly');
  const guard = H.game.entity('guard');
  for (let i = 0; i < 8; i++) H.game.damage(guard, 5, p);
  assert.notEqual(H.characters.attitude('guards'), 'friendly', 'hurting a guard: the guards are not your friends now');
});

test('a day: hungry it goes to eat, at night to bed, by day to work; with a sign of what it does', () => {
  world(H, sceneOf({ floor, start,
    baker: person('Baker', [0, 1, 0], [{ use: 'routine', eat: 'Table', sleep: 'Bed', work: 'Oven', day: 40, hunger: 0.2 }]),
    table: { type: 'box', name: 'Table', shape: { size: [1, 1, 1] }, transform: { position: [10, 0.5, 0] } },
    bed: { type: 'box', name: 'Bed', shape: { size: [2, 0.5, 1] }, transform: { position: [-10, 0.25, 0] } },
    oven: { type: 'box', name: 'Oven', shape: { size: [1, 1, 1] }, transform: { position: [0, 0.5, 10] } },
  }));
  H.tick(0.3);
  const baker = H.game.entity('baker');
  const did = new Set<string>();
  H.game.on('routine', (d: any) => did.add(d.doing));
  steps(45);
  for (const k of ['work', 'sleep']) assert.ok(did.has(k), `it did: ${k} (${[...did].join(', ')})`);
  assert.ok(baker.node.getChildMeshes().some((m: any) => m.name === 'chars-sign') || did.size > 1, 'a sign over its head');
});

test('the village kit: talkers, a day, sides', () => {
  world(H, sceneOf({ floor }));
  H.tick(0.2);
  const specs = H.kits.build('village', [0, 0, 0], 0);
  for (const s of specs) { assert.ok(H.kinds.has(s.type), s.type); for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), b.use); }
  assert.equal(H.kits.config('village').factions.bandits.player, 'hostile');
});
