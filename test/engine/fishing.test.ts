// Fishing as a hobby (public/play/modules/water/fishing.js): the species tables (rarities, weights, sizes, habits), the
// odds by hour and depth, the catch log with its silhouettes, a first catch's moment and the Overseer's line, and the
// log kept in the Overseer's memory (memory.js; the account's copy is src/presence.ts cleanMemory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world as run, sceneOf } from './harness.ts';
import { cleanMemory } from '../../src/presence.ts';

const H = await load();
const g = globalThis as any;
const errors: string[] = [];
H.report = (e: any, where?: string) => { errors.push(String(where || '') + ': ' + String((e && e.message) || e)); };
const floor = { type: 'box', name: 'Ground', shape: { size: [40, 1, 40] }, transform: { position: [0, -0.5, 0] } };
const board = { type: 'box', name: 'Catch board', shape: { size: [1.9, 1, 0.1] }, transform: { position: [3, 1, 3] }, data: { catchBoard: true } };
function world() { errors.length = 0; run(H, sceneOf({ floor, board }, { water: { level: -0.5, waves: 0.1 } }), { mode: 'play' }); return H.game; }
const fresh = (game: any) => { H.memory.reset(); game.water.fish.clear(); };

test('fishing: at least 12 species over four rarities, with weights, sizes and habits', () => {
  const game = world();
  const all = game.water.fish.list();
  const real = all.filter((s: any) => s.rarity !== 'junk');
  assert.ok(real.length >= 12, `${real.length} species`);
  for (const r of ['common', 'uncommon', 'rare', 'legendary']) assert.ok(real.filter((s: any) => s.rarity === r).length >= 3, `${r}: at least three`);
  const R = game.water.fish.rarities;
  assert.ok(R.common.weight > R.uncommon.weight && R.uncommon.weight > R.rare.weight && R.rare.weight > R.legendary.weight, 'rarer is rarer');
  for (const s of real) {
    assert.ok(s.kg[0] > 0 && s.kg[1] > s.kg[0] && s.cm[1] > s.cm[0], `${s.id} sizes`);
    assert.ok(Array.isArray(s.hours) && ['shallow', 'mid', 'deep'].includes(s.depth), `${s.id} has hours and a depth`);
  }
  for (const id of ['tuna', 'swordfish', 'snapper', 'salmon']) assert.ok(game.water.fish.get(id), id);
  const sea = game.water.bodies().find((b: any) => b.kind === 'ocean');
  assert.ok(game.water.fish.in(sea).filter((s: any) => s.rarity !== 'junk').length >= 12, 'the sea alone has 12');
});

test('fishing: time of day and depth change the odds, and never rule a fish out', () => {
  const game = world();
  const sea = game.water.bodies().find((b: any) => b.kind === 'ocean');
  const p = (o: any) => Object.fromEntries(game.water.fish.odds(sea, o).map((x: any) => [x.id, x.p]));
  const sum = (o: any) => Object.values(p(o)).reduce((a: any, b: any) => a + b, 0);
  near(sum({ hour: 12, depth: 8 }), 1);
  const noon = p({ hour: 12, depth: 2 }), night = p({ hour: 2, depth: 2 });
  assert.ok(night.anglerfish > noon.anglerfish, 'the anglerfish is a night fish');
  assert.ok(noon.snapper > night.snapper, 'the snapper is a day fish');
  const shallow = p({ hour: 12, depth: 1 }), deep = p({ hour: 12, depth: 9 });
  assert.ok(deep.tuna > shallow.tuna, 'tuna are deep');
  assert.ok(shallow.pufferfish > deep.pufferfish, 'pufferfish are shallow');
  for (const v of [noon, night, shallow, deep]) for (const id of Object.keys(v)) assert.ok(v[id] > 0, `${id} can always bite`);
  const wrap = p({ hour: 23, depth: 9 }); // a window across midnight (the moray: 20 to 4)
  assert.ok(wrap.moray > p({ hour: 12, depth: 9 }).moray);
});

test('fishing: rolled catches stay in their size range and favor the hour', () => {
  const game = world();
  const sea = game.water.bodies().find((b: any) => b.kind === 'ocean');
  const seen: Record<string, number> = {};
  for (let i = 0; i < 400; i++) {
    const f = game.water.fish.roll(sea, { hour: 2, depth: 9, junk: false });
    const sp = game.water.fish.get(f.id);
    assert.ok(f.weight >= sp.kg[0] - 0.01 && f.weight <= sp.kg[1] + 0.01 && f.length >= sp.cm[0] && f.length <= sp.cm[1], f.id);
    seen[f.id] = (seen[f.id] || 0) + 1;
  }
  assert.ok((seen.anglerfish || 0) + (seen.moray || 0) > (seen.snapper || 0) + (seen.pufferfish || 0), 'at night in deep water: the night fish');
});

test('fishing: the catch log shows silhouettes for what is not caught, and the best of what is', () => {
  const game = world();
  fresh(game);
  game.water.fish.log(true);
  let log = g.document.body.children.find((c: any) => c.className === 'water-log');
  assert.ok(log, 'the log is open');
  assert.match(log.innerHTML, /0 of \d+ species/);
  assert.ok(!/Tuna|Bluefin/.test(log.innerHTML), 'unknown species are not named');
  assert.match(log.innerHTML, /\?\?\?/);
  assert.match(log.innerHTML, /class="sil"/);
  game.water.fish.log(false);
  game.water.fish.give('tuna', { weight: 100 });
  game.water.fish.give('tuna', { weight: 60 });
  game.water.fish.give('tuna', { weight: 140 });
  const j = game.water.fish.journal();
  assert.equal(j.fish.tuna.count, 3);
  assert.equal(j.fish.tuna.best, 140);
  game.water.fish.log(true);
  log = g.document.body.children.find((c: any) => c.className === 'water-log');
  assert.match(log.innerHTML, /1 of \d+ species/);
  assert.match(log.innerHTML, /Bluefin tuna/);
  assert.match(log.innerHTML, /best 140 kg/);
  assert.match(log.innerHTML, /Rare/);
  game.water.fish.log(false);
  assert.deepEqual(errors, []);
});

test('fishing: a first catch of a species has its moment, an Overseer line and a species event; the second does not', () => {
  const game = world();
  fresh(game);
  H.lines.reset();
  const spoken: string[] = [];
  game.on('overseer-line', (d: any) => spoken.push(d.id));
  const ev: any[] = [];
  game.on('species', (d: any) => ev.push(d.fish.id));
  const caught: any[] = [];
  game.on('catch', (d: any) => caught.push(d.fish.first));
  game.water.fish.give('trout', { weight: 2 });
  assert.deepEqual(ev, ['trout']);
  assert.ok(g.document.body.children.some((c: any) => c.className === 'water-new'), 'the celebration is on screen');
  game.water.fish.give('trout', { weight: 3 });
  assert.deepEqual(ev, ['trout'], 'not twice');
  assert.deepEqual(caught, [true, false]);
  game.water.fish.give('pike', { weight: 5 });
  assert.deepEqual(ev, ['trout', 'pike']);
  assert.ok(H.lines.waiting.includes('species-pike') || spoken.includes('species-pike'), 'the Overseer notes the new species');
  game.water.fish.give('old-boot');
  assert.deepEqual(ev, ['trout', 'pike'], 'junk is not a species');
});

test('fishing: catches are kept in the record, survive a reload, and merge by species', () => {
  const game = world();
  fresh(game);
  game.water.fish.give('snapper', { weight: 4 });
  game.water.fish.give('snapper', { weight: 7.5 });
  game.water.fish.give('swordfish', { weight: 200 });
  const rec = H.memory.get();
  assert.deepEqual(rec.fish.snapper.slice(0, 2), [2, 750]);
  assert.equal(rec.fish.swordfish[0], 1);
  // The page is reloaded: the record is read back from where it is kept (this device, or the account's copy).
  H.memory.reload();
  const j = game.water.fish.journal();
  assert.equal(j.fish.snapper.count, 2);
  assert.equal(j.fish.snapper.best, 7.5);
  assert.equal(j.fish.swordfish.rarity, 'legendary');
  // The device's log and the account's: each species keeps the larger.
  const merged = H.memory.core.merge({ visits: 2, lastAt: 5, fish: { snapper: [2, 750, 60], tuna: [1, 100, 150] }, fishPts: 40 }, { visits: 1, lastAt: 9, fish: { snapper: [1, 900, 70] }, fishPts: 90 });
  assert.deepEqual(merged.fish, { snapper: [2, 900, 70], tuna: [1, 100, 150] });
  assert.equal(merged.fishPts, 90);
});

test('fishing: the account keeps the same log (cleanMemory), checked like the device does', () => {
  const rec = { visits: 3, fish: { tuna: [4, 12000, 210], 'bad id!': [1, 1, 1], oops: 5, '<x>': [1, 1, 1], trout: [0, 1, 1] }, fishPts: 123 };
  const server = cleanMemory(rec);
  assert.deepEqual(server.fish, { tuna: [4, 12000, 210] });
  assert.equal(server.fishPts, 123);
  assert.deepEqual(H.memory.core.clean(rec).fish, server.fish, 'the page and the server agree');
  const many: Record<string, number[]> = {};
  for (let i = 0; i < 80; i++) many[`fish-${i}`] = [999, 99999, 999];
  assert.ok(JSON.stringify(cleanMemory({ fish: many })).length < 4096, 'a full log fits');
  assert.equal(Object.keys(cleanMemory({ fish: many }).fish).length, 48);
});

test('fishing: the board by the hut shows your best and offers the log', () => {
  const game = world();
  fresh(game);
  game.water.fish.give('tuna', { weight: 120 });
  game.water.fish.board();
  const e = [...H.world.entities].find((x: any) => x.name === 'Catch board');
  assert.ok(e && e.node.getChildMeshes().length > 0, 'the board has its words');
  assert.deepEqual(errors, []);
});

function near(a: number, b: number) { assert.ok(Math.abs(a - b) < 1e-6, `${a} vs ${b}`); }
