// The spawn wheel (public/play/modules/spawn): the three layers (type -> category -> asset) built from the kind registry,
// Living things' species, the tools, the game's own assets and the community library; search; where things land
// (in front, on the ground, boats on the water, ×10 spread out); spawning while building (scene ops, one edit) and
// while playing (only when the game allows it, not saved). The real engine in Node (harness.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const S = H.spawn;
const floor = { type: 'box', name: 'Ground', shape: { size: [120, 1, 120] }, transform: { position: [0, -0.5, 0] }, physics: 'static' };
const spawnPt = { type: 'spawn', transform: { position: [0, 0, 0] } };
function play(config: Record<string, any> = {}, mode: 'play' | 'build' = 'play', entities: Record<string, any> = {}) {
  world(H, sceneOf({ floor, spawnPt, ...entities }, config), { mode });
  H.tick(0.2);
  return H.game;
}
const ids = (list: any[]) => list.map((x) => x.id);

test('layer 1: the types, from what the engine has', () => {
  play({}, 'build');
  const types = ids(S.types());
  for (const t of ['vehicles', 'living', 'things', 'nature', 'buildings', 'tools', 'world', 'effects']) assert.ok(types.includes(t), `${t} in ${types}`);
  assert.ok(!types.includes('game'), 'no "This game" while it has no assets of its own');
  assert.ok(!types.includes('recent'), 'no Recent before anything was spawned');
});

test('layers 2 and 3: categories and things from the kind registry, species and tools', () => {
  play({}, 'build');
  assert.deepEqual(ids(S.categories('vehicles')).sort(), ['air', 'road', 'water']);
  const road = S.items('vehicles', 'road');
  const fourByFour = road.find((i: any) => i.name === '4x4');
  assert.ok(fourByFour, `a 4x4 on the road: ${road.map((i: any) => i.name)}`);
  assert.equal(fourByFour.make(0).type, 'truck', 'the 4x4 is the vehicles module\'s truck, from its hotbar');
  assert.ok(S.items('vehicles', 'air').some((i: any) => i.kind === 'helicopter'), 'kinds without a hotbar entry come from their codex');
  const farm = S.items('living', 'farm');
  assert.ok(farm.some((i: any) => i.id === 'species:cow'), 'cows are farm animals (Living things\' species)');
  assert.deepEqual(farm.find((i: any) => i.id === 'species:cow').make(0), { type: 'creature', name: 'Cow', shape: { species: 'cow' } });
  assert.ok(S.items('living', 'wild').some((i: any) => i.id === 'species:elephant'), 'and the animals Living things draws from others');
  assert.ok(ids(S.items('tools', 'mayhem')).includes('tool:rocket-launcher'));
  assert.equal(S.items('tools', 'mayhem').find((i: any) => i.id === 'tool:rocket-launcher').make().type, 'tool-pickup');
  assert.ok(ids(S.categories('things')).includes('furniture'), 'homes\' furniture');
  assert.ok(ids(S.categories('world')).includes('disasters') && ids(S.categories('world')).includes('terrain'));
  // Every thing has a name, an icon and something to do.
  for (const it of S.all()) assert.ok(it.name && it.icon && (it.make || it.world || it.effect || it.asset), `${it.id} is complete`);
  // A kind a new module registers shows up by its codex group.
  H.kinds.register('jetpack-test', { build: (_: any, o: any) => H.lib.shape('jetpack-test', () => new (globalThis as any).BABYLON.MeshBuilder.CreateBox('j', { size: 1 }, H.world.scene), o), maker: true, codex: { group: 'Vehicles', what: 'test' } });
  assert.ok(S.items('vehicles', 'vehicles').some((i: any) => i.kind === 'jetpack-test'), 'a module\'s new kind is in the wheel with no edit here');
});

test('building-only things: terrain and the whole world are offered only while building', () => {
  play({ spawn: true }, 'play');
  assert.ok(!ids(S.categories('world')).includes('terrain'), 'no terrain changes while playing');
  assert.ok(ids(S.categories('world')).includes('disasters'), 'disasters happen while playing too');
});

test('the game\'s own assets are a type of their own, by what they are', () => {
  play({}, 'build');
  H.setAssets({
    'statue.glb': { url: 'data:model/gltf-binary;base64,', mime: 'model/gltf-binary', id: 'a_51', type: 'model', title: 'Hero statue', words: ['statue', 'hero statue'] },
    'poster.png': { url: 'data:image/png;base64,', mime: 'image/png', id: 'a_52', type: 'image', title: 'Poster', words: ['poster'] },
  });
  assert.ok(ids(S.types()).includes('game'));
  assert.deepEqual(ids(S.categories('game')).sort(), ['models', 'pictures']);
  const statue = S.items('game', 'models')[0];
  assert.equal(statue.name, 'Hero statue');
  const spec = S.specOfAsset(statue.asset.name, statue.asset.kind, statue.asset.title, 0);
  assert.equal(spec.type, 'model');
  assert.equal(spec.shape.asset, 'statue.glb');
  assert.equal(S.search('statue')[0].id, 'asset:a_51', 'found by its words');
  H.setAssets({});
});

test('the community library: shelves join the categories, things load by id, and search finds them', async () => {
  play({}, 'build');
  const was = { inEditor: S.inEditor, fetchJson: S.fetchJson };
  const asked: string[] = [];
  S.library.shelves = null; S.library.items.clear(); S.library.failed = 0;
  S.inEditor = () => true;
  S.fetchJson = async (url: string) => {
    asked.push(url);
    if (url.includes('/categories')) return { kinds: [{ kind: 'model', count: 7, categories: [{ category: 'rocks', count: 3 }, { category: 'props', count: 4 }] }, { kind: 'texture', count: 2, categories: [{ category: 'stone', count: 2 }] }, { kind: 'sky', count: 1, categories: [{ category: 'day', count: 1 }] }] };
    const u = new URL(url, 'http://x');
    const kind = u.searchParams.get('kind'), cat = u.searchParams.get('category'), q = u.searchParams.get('q');
    const rows = [
      { id: 'a_aa01', kind: 'model', title: 'Mossy rock', category: 'rocks', tags: ['rock', 'moss'], thumb: '/v1/community/a_aa09/file' },
      { id: 'a_aa02', kind: 'texture', title: 'Cobblestone', category: 'stone', tags: ['stone', 'cobble'], thumb: '/v1/community/a_aa02/file' },
      { id: 'a_aa03', kind: 'model', title: 'Toy robot', category: 'props', tags: ['robot', 'toy'], thumb: null },
    ];
    return { items: rows.filter((r) => (!kind || r.kind === kind) && (!cat || r.category === cat) && (!q || JSON.stringify(r).includes(q))) };
  };
  try {
    await S.loadShelves();
    const nature = S.categories('nature');
    const rocks = nature.find((c: any) => c.id === 'rocks');
    assert.ok(rocks && rocks.count >= 6, 'the library\'s rocks join the stand-in rocks');
    assert.ok(ids(S.categories('buildings')).includes('walls-stone'), 'textures are textured walls');
    assert.ok(ids(S.categories('world')).includes('skies'));
    const items = await S.load('nature', 'rocks');
    const mossy = items.find((i: any) => i.id === 'lib:a_aa01');
    assert.ok(mossy, 'a library thing, by its asset id');
    assert.equal(mossy.thumb, '/v1/community/a_aa09/file', 'with its thumbnail');
    assert.ok(items.some((i: any) => i.id === 'nature:rock'), 'next to the free stand-in');
    const found = await S.searchAll('cobble');
    assert.equal(found[0].id, 'lib:a_aa02', 'search asks the library too');
    assert.ok(asked.some((u) => u.includes('q=cobble')));
    // Using one: the editor puts it in the game (a variant of its word), then it's spawned as a textured wall.
    const was2 = S.useLibrary;
    S.useLibrary = async (lib: any) => { H.setAssets({ 'cobblestone.png': { url: 'data:image/png;base64,', mime: 'image/png', id: lib.id, type: 'image', words: ['cobblestone'] } }); return { ok: true, asset: { name: 'cobblestone.png' }, word: 'cobblestone' }; };
    try {
      const r = await S.spawn(found[0]);
      assert.ok(r.ok, r.error);
      const wall = H.world.graph.entities[r.ids[0]];
      assert.equal(wall.type, 'box');
      assert.equal(wall.material.texture, 'cobblestone.png');
      assert.deepEqual(wall.shape.size, [4, 3, 0.3], 'a wall, not a floor tile');
    } finally { S.useLibrary = was2; H.setAssets({}); }
    // Playing: library things are left out (they come in through the editor while building).
    H.setMode('play');
    assert.ok(!S.items('nature', 'rocks').some((i: any) => i.source === 'library'));
  } finally { S.inEditor = was.inEditor; S.fetchJson = was.fetchJson; S.library.shelves = null; S.library.items.clear(); }
});

test('search: by name and other words, best first; every word has to match', () => {
  play({}, 'build');
  assert.equal(S.search('cow')[0].id, 'species:cow');
  assert.equal(S.search('cows')[0].id, 'species:cow', 'plurals');
  assert.equal(S.search('4x4')[0].kind, 'truck');
  assert.equal(S.search('rocket')[0].id, 'tool:rocket-launcher');
  assert.ok(S.search('farm').some((i: any) => i.id === 'species:pig'), 'by category name');
  assert.ok(S.search('tornado').some((i: any) => i.id === 'disaster:tornado'));
  assert.deepEqual(S.search('xyzzy'), []);
  assert.deepEqual(S.search('cow xyzzy'), [], 'all the words');
  assert.equal(H.game.spawnWheel.search('helicopter')[0].type, 'vehicles', 'game.spawnWheel.search for scripts');
});

test('placement: in front, on the ground, ×10 spread out; boats on the water, cars on the bottom', () => {
  play({ water: { level: 2 } }, 'build');
  const box = { type: 'box', shape: { size: 1 } };
  const one = S.place(box, { from: [0, 0, 0], dir: [0, 1] });
  assert.equal(one.points.length, 1);
  const [x, y, z] = one.points[0];
  assert.ok(Math.abs(x) < 0.01 && z > 2.5 && z < 6, `in front (${x}, ${z})`);
  assert.ok(Math.abs(y - 0.55) < 0.1, `a box sinks to the floor under the water (${y})`);
  const ground = S.place({ type: 'box', shape: { size: 1 } }, { from: [0, 0, 0], dir: [1, 0] });
  assert.ok(ground.points[0][0] > 2.5, 'turning: it goes where you look');
  const ten = S.place(box, { from: [0, 0, 0], dir: [0, 1], count: 10 });
  assert.equal(ten.points.length, 10);
  for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) {
    const d = Math.hypot(ten.points[i][0] - ten.points[j][0], ten.points[i][2] - ten.points[j][2]);
    assert.ok(d >= 1.5, `×10 don't overlap (${d})`);
  }
  assert.ok(ten.points.every((p: number[]) => p[2] > 1), 'all of them in front');
  const boat = S.place({ type: 'boat' }, { from: [0, 0, 0], dir: [0, 1], floats: true });
  const car = S.place({ type: 'truck' }, { from: [0, 0, 0], dir: [0, 1] });
  assert.ok(boat.onWater && car.onWater, 'there is water there');
  assert.ok(boat.points[0][1] > 2, `the boat floats on the surface (${boat.points[0][1]})`);
  assert.ok(car.points[0][1] < 2, `the 4x4 sits on the bottom (${car.points[0][1]})`);
  assert.ok(Math.abs(boat.away - 0) < 1 && Math.abs(boat.toward - 180) < 1, 'vehicles face away from you, things face you');
});

test('placement on terrain: things land on the hill', () => {
  play({ terrain: { shape: 'hills', height: 14, seed: 3, size: 128, scatter: false, home: false } }, 'build');
  const p = S.place({ type: 'box', shape: { size: 1 } }, { from: [10, 0, 10], dir: [0, 1] });
  const [x, y, z] = p.points[0];
  const h = H.terrain.heightAt(x, z);
  assert.ok(Math.abs(y - (h + 0.55)) < 0.2, `on the terrain (${y} vs ${h})`);
});

test('building: a 4x4 and ×10 cows are scene ops (one edit each), saved with the world', async () => {
  play({}, 'build');
  const edits: any[] = [];
  (globalThis as any).HawkesBuild = { edit(ops: any[], o: any) { edits.push({ ops, o }); H.applyOps(ops, { local: true }); } };
  try {
    const truck = S.search('4x4')[0];
    S.ghost.show(truck, 1);
    H.tick(0.05);
    assert.equal(S.ghost.item, truck, 'a ghost shows where it lands first');
    S.ghost.hide();
    const r = await S.spawn(truck);
    assert.ok(r.ok, r.error);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].ops[0].op, 'create');
    assert.equal(edits[0].o.fx, 'materialize');
    const spec = H.world.graph.entities[r.ids[0]];
    assert.equal(spec.type, 'truck', 'in scene.json: saved');
    const e = H.game.entity(r.ids[0]);
    assert.ok(e && e.alive, 'and in the world');
    const cows = await S.spawn(S.search('cow')[0], { count: 10 });
    assert.equal(cows.count, 10);
    assert.equal(edits.length, 2, '×10 is one edit (one undo)');
    assert.equal(edits[1].ops.length, 10);
    assert.ok(cows.ids.every((id: string) => H.world.graph.entities[id].type === 'creature'));
    H.tick(0.5);
    // Recents: the last first.
    assert.deepEqual(S.recent.list().slice(0, 2).map((i: any) => i.id), ['species:cow', truck.id]);
    assert.ok(ids(S.types()).includes('recent'));
    // Favorites.
    assert.equal(S.toggleFavorite(truck), true);
    assert.ok(S.favorites.has(truck) && ids(S.types())[0] === 'favorites');
    S.toggleFavorite(truck);
    // The world: a mountain here is a config edit (terrain.add), building only.
    const m = await S.spawn(S.find('terrain:mountain'));
    assert.ok(m.ok);
    const t = H.world.graph.config.terrain;
    assert.equal(t.add[t.add.length - 1].type, 'mountain');
    // The Overseer beams things in when the story module is there.
    const beams: any[] = [];
    H.overseer = { beam: (at: number[], o: any) => beams.push({ at, o }) };
    await S.spawn(S.search('pig')[0], { count: 2 });
    assert.equal(beams.length, 2, 'one beam per thing');
    delete H.overseer;
  } finally { delete (globalThis as any).HawkesBuild; S.recent.clear(); }
});

test('playing: only when the game allows it, and not saved', async () => {
  play({}, 'play');
  assert.equal(S.allowed(), false, 'by default the wheel is for building');
  assert.ok(!(await S.spawn(S.search('cow')[0])).ok);
  play({ spawn: true }, 'play');
  assert.equal(S.allowed(), true);
  const before = Object.keys(H.world.graph.entities).length;
  const r = await H.game.spawnWheel.spawn('cow', 3);
  assert.ok(r.ok, r.error);
  H.tick(0.3);
  const cows = [...H.world.entities].filter((e: any) => e.kind === 'creature' && e.temporary);
  assert.equal(cows.length, 3, 'three runtime cows');
  assert.equal(Object.keys(H.world.graph.entities).length, before, 'nothing saved in scene.json');
  play({ spawn: { play: true, max: 5 } }, 'play');
  const many = await S.spawn(S.search('barrel')[0], { count: 10 });
  assert.equal(many.count, 5, 'config.spawn.max caps ×N');
  assert.ok(!(await S.spawn(S.find('terrain:mountain') || { id: 'x', name: 'x', build: true })).ok, 'world changes are for building');
});
