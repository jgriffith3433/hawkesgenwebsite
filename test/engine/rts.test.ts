// Real-time strategy (modules/rts): units you choose and send, that fight other sides by themselves; buildings that train
// units for resources; workers that gather and bring them home; an AI side that gathers, trains and attacks; waves; the
// end when a side has no buildings left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };
const unit = (team: string, at: number[], o: any = {}) => ({ type: 'capsule', name: `${team} unit`, shape: { radius: 0.35, height: 1.7 }, physics: 'dynamic', transform: { position: at }, behaviors: [{ use: 'unit', team, ...o }] });
const base = (team: string, at: number[], o: any = {}) => ({ type: 'box', name: `${team} base`, shape: { size: [4, 3, 4] }, physics: 'static', transform: { position: at }, behaviors: [{ use: 'building', team, ...o }] });
const rts = (o: any = {}) => ({ rts: { team: 'blue', resources: 300, ...o }, player: { view: 'rts' } });

test('choose units and send them: they go, side by side', () => {
  world(H, sceneOf({ floor, a: unit('blue', [0, 1, 0]), b: unit('blue', [2, 1, 0]), c: unit('red', [60, 1, 60], { damage: 0 }) }, rts()));
  H.tick(0.3);
  const a = H.game.entity('a'), b = H.game.entity('b');
  H.rts.select([a, b]);
  assert.equal(H.rts.selected.length, 2);
  H.rts.select([H.game.entity('c')], true);
  assert.equal(H.rts.selected.length, 2, "the other side's can't be chosen");
  H.rts.command('move', { to: [0, 0, 20] });
  steps(7);
  assert.ok(a.z > 17 && b.z > 17, `they went (${a.z.toFixed(1)}, ${b.z.toFixed(1)})`);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1, 'not on top of each other');
});

test('units fight the other side by themselves; a building that falls ends it', () => {
  world(H, sceneOf({ floor,
    me: base('blue', [-30, 1.5, 0], { makes: '' }), them: base('red', [30, 1.5, 0], { makes: '', hp: 60 }),
    s1: unit('blue', [-2, 1, 0], { range: 8, damage: 20, rate: 0.5, hp: 200 }), e1: unit('red', [4, 1, 0], { range: 8, damage: 5, hp: 50 }),
  }, rts()));
  H.tick(0.3);
  const e1 = H.game.entity('e1');
  steps(4);
  assert.ok(!e1.alive || e1.dead, 'the red unit was beaten');
  // Then attack the red base: when it falls, it's won.
  H.rts.select([H.game.entity('s1')]);
  H.rts.command('attack', { target: H.game.entity('them') });
  let won = false;
  H.game.on('rts', (d: any) => { if (d.won) won = true; });
  steps(10);
  assert.ok(won, 'victory');
});

test('a building trains units for resources; workers gather and bring them home', () => {
  world(H, sceneOf({ floor,
    hq: base('blue', [0, 1.5, 0], { makes: 'worker,soldier' }),
    rock: { type: 'sphere', name: 'Crystal', shape: { radius: 1 }, physics: 'static', transform: { position: [14, 1, 0] }, behaviors: [{ use: 'resource', amount: 200 }] },
  }, rts({ resources: 120 })));
  H.tick(0.3);
  const hq = H.game.entity('hq');
  assert.equal(H.rts.resource(), 120);
  assert.ok(H.rts.train(hq, 'worker'));
  assert.equal(H.rts.resource(), 70, 'paid');
  assert.equal(H.rts.train(hq, 'soldier'), false, 'not enough left');
  steps(5.5);
  const workers = H.rts.units('blue');
  assert.equal(workers.length, 1, 'a worker came out');
  H.rts.order(workers, { type: 'gather' });
  steps(16);
  assert.ok(H.rts.resource() > 70, `gathered (${H.rts.resource()})`);
  assert.ok(H.game.entity('rock').data.amount < 200, 'the crystal is less');
});

test('an AI side gathers, trains and attacks; waves come and go for your base', () => {
  world(H, sceneOf({ floor,
    me: base('blue', [-40, 1.5, 0], { makes: '', hp: 5000 }),
    them: base('red', [40, 1.5, 0], { makes: 'worker,soldier', hp: 5000 }),
    rock: { type: 'sphere', name: 'Crystal', shape: { radius: 1 }, physics: 'static', transform: { position: [40, 1, 12] }, behaviors: [{ use: 'resource', amount: 2000 }] },
  }, rts({ teams: { red: { ai: true, resources: 400, wave: 2, waves: { every: 3, count: 3, unit: 'soldier' } } } })));
  H.tick(0.3);
  let waves = 0;
  H.game.on('wave', () => { waves++; });
  steps(12);
  const red = H.rts.units('red');
  assert.ok(waves >= 2, `waves came (${waves})`);
  assert.ok(red.some((u: any) => u.data.role === 'worker'), 'it trained a worker');
  assert.ok(red.some((u: any) => u.x < 30), 'and they are on their way to my base');
});

test('the strategy kits lay out two sides, crystals and units, and set the game up', () => {
  for (const id of ['rts', 'space-rts']) {
    world(H, sceneOf({ floor }));
    H.tick(0.2);
    const specs = H.kits.build(id, [0, 0, 0], 0);
    for (const s of specs) { assert.ok(H.kinds.has(s.type), `${id}: ${s.type}`); for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), `${id}: ${b.use}`); }
    const cfg = H.kits.config(id);
    assert.equal(cfg.player.view, 'rts');
    const things: Record<string, any> = { floor };
    specs.forEach((s: any, i: number) => { things[`k${i}`] = s; });
    world(H, sceneOf(things, cfg));
    H.tick(0.3);
    assert.equal(H.rts.buildings('blue').length, 1, `${id}: a blue base`);
    assert.equal(H.rts.buildings('red').length, 1);
    assert.ok(H.rts.resources().length >= 4);
    steps(8);
    assert.ok(H.rts.resource('red') !== 250 && H.rts.resource('red') !== 300 || H.rts.units('red').length > 2, `${id}: the red side is playing`);
  }
});
