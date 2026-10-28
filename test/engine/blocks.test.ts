// Blocks (modules/blocks): a world of blocks grown from a seed (bedrock, stone, ores, dirt, grass, caves, trees), drawn in
// chunks with colliders you stand on; the pickaxe mines what you look at (harder blocks take longer) into the bag, R
// places the picked block; crafting; scripts change blocks; the edits a save keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const g = globalThis as any;
const C = g.HawkesBlocksCore;
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const buttons = new Map<string, any>();
function key(type: 'keydown' | 'keyup', k: string) {
  let b = buttons.get(k);
  if (!b) { b = new g.HTMLElement('button'); H.bindTouchKey(b, k); buttons.set(k, b); }
  b.dispatch(type === 'keydown' ? 'pointerdown' : 'pointerup', { preventDefault() {}, stopPropagation() {} });
}
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };

test('the world from a seed: bedrock, stone with ores, dirt, grass on top, caves, trees; the same seed, the same world', () => {
  const c = C.config({ world: 'caves', size: [40, 32, 40], seed: 7 });
  const a = C.generate(c), b = C.generate(C.config({ world: 'caves', size: [40, 32, 40], seed: 7 }));
  assert.deepEqual(a, b, 'deterministic');
  const count: Record<string, number> = {};
  for (const v of a) { const n = C.TYPES[v][0]; count[n] = (count[n] || 0) + 1; }
  assert.equal(count.bedrock, 40 * 40, 'a floor of bedrock');
  for (const k of ['stone', 'dirt', 'grass', 'coal', 'iron', 'wood', 'leaves']) assert.ok(count[k] > 0, `has ${k}`);
  const top = C.height(c, 20, 20);
  assert.match(C.TYPES[C.get(c, a, 20, top, 20)][0], /grass|snow/, 'grass on top');
  // Caves: air under the ground.
  let caves = 0;
  for (let z = 0; z < 40; z++) for (let x = 0; x < 40; x++) for (let y = 2; y < C.height(c, x, z) - 3; y++) if (!C.get(c, a, x, y, z)) caves++;
  assert.ok(caves > 50, `caves (${caves} blocks of air underground)`);
  assert.equal(C.config({ size: [500, 2, 3] }).size.join(), '128,8,8', 'sizes are clamped');
  // Aiming along the grid.
  const hit = C.ray(c, a, [20.5, 31.5, 20.5], [0, -1, 0], 40);
  assert.ok(hit && hit.type && hit.y >= top && hit.n[1] === 1, 'from above: the top face of the first block down');
});

test('a block world in the game: chunks you stand on, the player lifted out of the ground', () => {
  world(H, sceneOf({ start }, { blocks: { world: 'flat', size: [32, 24, 32] } }));
  H.tick(0.3);
  assert.ok(H.blocks.active);
  const p = H.world.player;
  const ground = 8 * 1; // flat: grass at y = 8 (24 / 3), its top at 9 blocks above the bottom
  steps(1.5);
  assert.ok(Math.abs(p.bottom - (ground + 1)) < 0.25, `standing on the grass (${p.bottom.toFixed(2)})`);
  assert.equal(H.blocks.get(16, 8, 16), 'grass');
  assert.equal(H.game.blocks.top(16, 16), 8);
  const chunks = [...H.world.entities].filter((e: any) => e.isBlocks);
  assert.equal(chunks.length, 2 * 2 * 2, 'chunks of 16');
});

test('the pickaxe: hold to mine what you look at into the bag; R places the picked block; harder blocks take longer', () => {
  world(H, sceneOf({ start }, { blocks: { world: 'flat', size: [32, 24, 32] }, player: { tool: 'pickaxe' } }));
  H.tick(0.3);
  steps(1);
  H.world.camera.pitch = 1.45; // (looking down at your feet's block)
  H.tick(0.05);
  const mined: string[] = [];
  H.game.on('mine', (d: any) => mined.push(d.type));
  const under = H.blocks.aim();
  assert.ok(under && under.type === C.ID.grass, 'the crosshair is on the grass');
  key('keydown', 'g');
  steps(0.3);
  assert.equal(mined.length, 0, 'not yet: grass takes half a second');
  steps(0.4);
  key('keyup', 'g');
  assert.deepEqual(mined, ['grass']);
  assert.equal(H.blocks.bag.dirt, 1, 'grass drops dirt');
  steps(0.6); // (falls into the hole)
  // Stone takes longer than dirt.
  H.blocks.set(under.x, under.y - 1, under.z, 'stone');
  H.tick(0.05);
  key('keydown', 'g');
  steps(0.8);
  assert.ok(!mined.includes('stone'), 'stone is not out after 0.8 s');
  steps(0.6);
  key('keyup', 'g');
  assert.ok(mined.includes('stone'));
  assert.equal(H.blocks.bag.cobble, 1, 'stone drops cobble');
  // Place: the dirt goes back on the face looked at; the bag is one less.
  H.world.camera.pitch = 0.6;
  H.tick(0.05);
  const before = H.blocks.bag.dirt;
  H.blocks.select('dirt');
  key('keydown', 'r'); H.tick(0.05); key('keyup', 'r');
  steps(0.1);
  assert.equal(H.blocks.bag.dirt ?? 0, before - 1, 'placed one');
});

test('crafting, scripts, and the edits a save keeps', () => {
  world(H, sceneOf({ start }, { blocks: { world: 'flat', size: [32, 24, 32] } }));
  H.tick(0.3);
  H.blocks.give('wood', 2);
  assert.ok(H.blocks.craft('planks'));
  assert.equal(H.blocks.bag.planks, 4);
  assert.equal(H.blocks.bag.wood, 1);
  assert.equal(H.blocks.craft('lamp'), false, 'not without coal and glass');
  const n = H.blocks.fill([2, 9, 2], [4, 10, 4], 'brick');
  assert.equal(n, 18);
  assert.equal(H.blocks.get(3, 10, 3), 'brick');
  H.blocks.mine(10, 8, 10);
  const edits = H.blocks.edits();
  assert.equal(edits.length, 19);
  assert.ok(edits.some((e: number[]) => e[0] === 10 && e[1] === 8 && e[2] === 10 && e[3] === 0));
  // The same world saved with those edits comes back as it was.
  world(H, sceneOf({ start }, { blocks: { world: 'flat', size: [32, 24, 32], edits } }));
  H.tick(0.3);
  assert.equal(H.blocks.get(3, 10, 3), 'brick');
  assert.equal(H.blocks.get(10, 8, 10), 'air');
});

test('the block mine kit: a block world round where it is placed, and the pickaxe', () => {
  world(H, sceneOf({ start }));
  H.tick(0.2);
  const cfg = H.kits.config('mine', {}, [10, 2, -4]);
  assert.deepEqual(cfg.blocks.at, [10, -12, -4], 'its bottom middle a little under the spot');
  assert.equal(cfg.player.tool, 'pickaxe');
  assert.ok(H.kits.build('mine', [0, 0, 0], 0).length, 'a lamp to mark it');
  assert.ok(H.kits.list().some((k: any) => k.id === 'mine'));
});
