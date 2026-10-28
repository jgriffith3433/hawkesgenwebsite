// Items and money (modules/items): pick things up, money, a shop that sells and buys (and runs out), using a potion,
// a door that needs a key, a crafting bench, and the rules' give / has using the same bag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };
const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };

test('pick up coins, buy at a shop (until it runs out), sell back, use a potion', () => {
  world(H, sceneOf({ floor, start,
    coin: { type: 'cylinder', name: 'Coin', shape: { radius: 0.4, height: 0.1 }, physics: 'none', transform: { position: [0, 1, 4] }, behaviors: [{ use: 'item', item: 'coins', count: 25 }] },
    shop: { type: 'box', name: 'Stall', shape: { size: [2, 1, 1] }, transform: { position: [8, 0.5, 0] }, behaviors: [{ use: 'shop', name: 'Potions', sells: [{ item: 'speed potion', price: 20, stock: 1 }, 'health potion:10'], buys: 'gem:30' }] },
  }, { items: { start: { coins: 5, gem: 1 } } }));
  H.tick(0.3);
  assert.equal(H.items.money, 5);
  H.world.player.position = [0, 1, 4];
  steps(0.3);
  assert.equal(H.items.money, 30, 'picked up 25');
  assert.equal(H.game.entity('coin'), null, 'the coin is gone');
  const shop = H.game.entity('shop');
  const bought: string[] = [];
  H.game.on('buy', (d: any) => bought.push(d.item));
  H.items.buy(shop, 'speed potion');
  assert.equal(H.items.count('speed potion'), 1);
  assert.equal(H.items.money, 10);
  H.items.buy(shop, 'speed potion');
  assert.equal(H.items.count('speed potion'), 1, 'sold out');
  H.items.sell(shop, 'gem');
  assert.equal(H.items.money, 40, 'sold the gem');
  assert.deepEqual(bought, ['speed potion']);
  const p = H.world.player, speed = p.speed;
  assert.ok(H.items.use('speed potion'));
  assert.ok(Math.abs(p.speed - speed * 1.7) < 1e-6, 'faster');
  assert.equal(H.items.count('speed potion'), 0, 'used up');
  steps(15.5);
  assert.ok(Math.abs(p.speed - speed) < 1e-6, 'and back');
});

test('a door that needs a key; a crafting bench; the rules see the same bag', () => {
  world(H, sceneOf({ floor, start,
    door: { type: 'box', name: 'Door', shape: { size: [2, 3, 0.3] }, transform: { position: [0, 1.5, 6] }, behaviors: [{ use: 'locked', needs: 'key' }] },
  }, { items: { recipes: [{ make: 'planks', count: 4, from: { wood: 1 } }] }, events: { rules: [{ id: 'reward', when: { on: 'unlock' }, do: [{ give: 'gem', count: 2 }] }] } }));
  H.tick(0.3);
  const door = H.game.entity('door'), y = door.y;
  H.items.unlock(door);
  steps(1);
  assert.equal(door.y, y, 'stays shut without a key');
  H.items.give('key');
  H.items.unlock(door);
  steps(2.5);
  assert.ok(door.y > y + 2, 'slides open');
  assert.equal(H.items.count('key'), 0, 'the key is used');
  steps(0.3);
  assert.equal(H.items.count('gem'), 2, "the rule's give went in the bag");
  assert.ok(H.game.events.has('gem', 2), 'and the rules see it');
  H.items.give('wood', 2);
  H.items.craft('planks');
  assert.equal(H.items.count('planks'), 4);
  assert.equal(H.items.count('wood'), 1);
});

test('the market kit: a shop, coins, a locked vault, a bench', () => {
  world(H, sceneOf({ floor }));
  H.tick(0.2);
  const specs = H.kits.build('market', [0, 0, 0], 0);
  for (const s of specs) { assert.ok(H.kinds.has(s.type), s.type); for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), b.use); }
  const uses = specs.flatMap((s: any) => (s.behaviors || []).map((b: any) => b.use));
  for (const u of ['shop', 'item', 'locked', 'bench']) assert.ok(uses.includes(u), u);
});
