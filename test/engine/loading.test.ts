// Loading speed and memory (#8): textures by level of detail (public/play/textures.js: the planner's order under
// pressure, which level is picked first and later, one copy held), models' copies (kinds.js modelLevels), the budgets per device
// (scale.js), draw distance, and the manifest's lazy modules (src/engine.ts, public/play/loader.js needs()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { load, sceneOf } from './harness.ts';

const H = await load();
const T = H.textures;
const MB = 1048576;

// ------------------------------------------------------------------ the planner
const lv = (...sizes: number[]) => sizes.map((s) => ({ size: s, bytes: T.gpuBytes(s, s) }));
const L4 = lv(128, 256, 512, 1024);

test('the planner: everything starts smallest; with room, each gets what it needs', () => {
  const items = [{ key: 'a', levels: L4, want: 3, prio: 10 }, { key: 'b', levels: L4, want: 1, prio: 50 }, { key: 'c', levels: L4, want: 0, prio: 99 }];
  const at = T.plan(items, 512 * MB);
  assert.deepEqual([...at], [['a', 3], ['b', 1], ['c', 0]], 'what each needs, no more');
});

test('the planner under pressure: the most needed are sharp first, nobody goes past the budget', () => {
  const items = Array.from({ length: 6 }, (_, i) => ({ key: `t${i}`, levels: L4, want: 3, prio: 100 - i * 10 }));
  // Room for the six at 128, plus about one 1024 (5.6 MB) and change.
  const budget = 6 * L4[0].bytes + 6 * MB;
  const at = T.plan(items, budget);
  const used = items.reduce((s, it) => s + it.levels[at.get(it.key)].bytes, 0);
  assert.ok(used <= budget, `${used} <= ${budget}`);
  const got = items.map((it) => at.get(it.key));
  for (let i = 1; i < got.length; i++) assert.ok(got[i] <= got[i - 1], `more needed, never less sharp: ${got}`);
  assert.ok(got[0] >= 2 && got[5] < got[0], `the most visible sharp, the least visible small: ${got}`);
  // Round by round: the second most needed isn't left at the smallest while the first takes everything.
  assert.ok(got[1] >= 1, `${got}`);
});

test('over budget: the least needed go down first, only as far as needed', () => {
  const items = [{ key: 'near', levels: L4, cur: 3, prio: 900 }, { key: 'mid', levels: L4, cur: 3, prio: 90 }, { key: 'far', levels: L4, cur: 3, prio: 1 }];
  const over = L4[3].bytes - L4[2].bytes + 1000; // a little more than one step down of a 1024
  const out = T.shed(items, over);
  assert.equal(out[0].key, 'far', 'the least visible first');
  assert.equal(out[0].to, 1, 'two steps: one was not quite enough');
  assert.ok(!out.some((x: any) => x.key === 'near'), 'the nearest keeps its detail');
});

// ------------------------------------------------------------------ levels of an asset
// As the bundle carries them (src/games.ts assetMap: Gen's LOD summary with each level's link, src/lods.ts levelUrls).
const lod = (level: number, w?: number, h?: number) => ({ level, url: `/v${level}`, bytes: 1000, ...(w ? { w, h } : {}) });
const entry = {
  url: '/play-asset/g/live/grass.png', mime: 'image/png', type: 'image', id: 'a_1',
  lods: { kind: 'image', size: [2048, 1024], bytes: 1_400_000, levels: [lod(128, 128, 64), lod(256, 256, 128), lod(512), lod(1024), lod(2048)] },
};

test('an asset\'s levels: Gen\'s levels smallest first; the full-size WebP stands for the original', () => {
  const levels = T.levelsOf(entry);
  assert.deepEqual(levels.map((l: any) => l.size), [128, 256, 512, 1024, 2048]);
  assert.deepEqual(levels.map((l: any) => l.url), ['/v128', '/v256', '/v512', '/v1024', '/v2048'], 'never the 1 MB PNG');
  assert.deepEqual([levels[2].w, levels[2].h], [512, 256], 'the aspect from the original');
  assert.equal(levels[4].bytes, T.gpuBytes(2048, 1024));
  // Without a full-size level, the original is the top level.
  const partial = T.levelsOf({ ...entry, lods: { ...entry.lods, levels: [lod(128), lod(256)] } });
  assert.deepEqual(partial.map((l: any) => l.url), ['/v128', '/v256', entry.url]);
  // No levels: just the original.
  assert.deepEqual(T.levelsOf({ url: '/x.png' }).map((l: any) => l.url), ['/x.png']);
});

test('which level: the smallest that covers the pixels on screen, never past the device\'s largest', () => {
  const levels = T.levelsOf(entry);
  assert.equal(levels[T.levelFor(levels, 90)].size, 128);
  assert.equal(levels[T.levelFor(levels, 300)].size, 512);
  assert.equal(levels[T.levelFor(levels, 5000)].size, 2048);
  assert.equal(levels[T.levelFor(levels, 5000, 1024)].size, 1024, 'a phone: 1024 at most');
  assert.equal(T.startUrl({ url: '/x.png' }), '/x.png');
});

test('the first level: from the expected size and the budget\'s share, so most textures load once', () => {
  const levels = T.levelsOf(entry);
  const at = (o: any) => levels[T.firstLevel(levels, o)].size;
  assert.equal(at({ px: 256, maxSize: 1024, share: 64 * MB / 4 }), 256, 'a phone: 256 px to start, not 128 and then 256');
  assert.equal(at({ px: 512, maxSize: 8192, share: 512 * MB / 18 }), 512, 'a desktop: 512');
  assert.equal(at({ px: 4000, maxSize: 1024, share: 64 * MB / 3 }), 1024, 'a sky on a phone: as wide as the screen, at most 1024');
  assert.equal(at({ px: 4000, maxSize: 8192, share: 2 * MB }), 512, 'a small share of the budget: smaller, so it never goes over');
  assert.equal(at({ px: 10, maxSize: 8192, share: 0 }), 128);
  assert.equal(at({ px: 400, maxSize: 8192, share: 0, under: true }), 256, 'a guess: the level under it');
  // In the engine: nothing to go by, the smallest; a sky as wide as the screen; a thing by its size and distance.
  assert.equal(T.startUrl(entry), '/v128');
  assert.equal(T.startUrl(entry, { sky: true }), '/v2048');
  assert.equal(T.startUrl(entry, { px: 300 }), '/v512');
  const near = T.startUrl(entry, { at: [0, 1.6, 4], size: 4 });
  const far = T.startUrl(entry, { at: [0, 1.6, 400], size: 1 });
  assert.ok(['/v1024', '/v2048'].includes(near), `a big thing in front of you: sharp at once (${near})`);
  assert.equal(far, '/v128', 'a small thing far off: the smallest');
});

test('a model\'s copies: the low far away, near the most detailed whose textures fit the device', () => {
  const m = { url: '/chair.glb', lods: { kind: 'mesh', tris: 12000, tex: 4096, bytes: 9e6, levels: [
    { level: 1400, tris: 1400, tex: 512, role: 'low', url: '/low' }, { level: 4800, tris: 4800, tex: 1024, role: 'mid', url: '/mid' }, { level: 12000, tris: 12000, tex: 2048, role: 'high', url: '/high' },
  ] } };
  const was = H.budget.maxTexture;
  try {
    H.budget.maxTexture = 8192;
    assert.deepEqual(H.kinds.modelLevels(m), { near: '/high', low: '/low' }, 'desktop: every triangle, with its textures at 2048 instead of 4096');
    H.budget.maxTexture = 1024;
    assert.deepEqual(H.kinds.modelLevels(m), { near: '/mid', low: '/low' }, 'a phone: the mid (1024 px textures)');
    assert.deepEqual(H.kinds.modelLevels({ url: '/x.glb', lods: { kind: 'mesh', tris: 300, tex: 256, levels: [{ level: 300, tris: 300, tex: 128, url: '/small' }] } }), { near: '/small', low: null });
    assert.equal(H.kinds.modelLevels({ url: '/x.glb' }), null, 'no levels: the old way (a _low.glb beside it)');
  } finally { H.budget.maxTexture = was; }
});

// ------------------------------------------------------------------ in the engine
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const tex = (n: string) => ({ url: `${PNG}#${n}`, mime: 'image/png', type: 'image', id: `a_${n}`, lods: { kind: 'image', size: [2048, 2048], bytes: 4e6, levels: [128, 256, 512].map((s) => ({ level: s, url: `${PNG}#${n}-${s}`, w: s, h: s, bytes: 1000 })) } });

test('a textured thing starts at its first level, is sharpened when near (one copy held), and comes down to budget', async () => {
  const scene = sceneOf({
    near: { type: 'box', shape: { size: [4, 4, 4] }, material: { texture: 'a_n' }, transform: { position: [0, 2, 6] } },
    far: { type: 'box', shape: { size: [1, 1, 1] }, material: { texture: 'a_f' }, transform: { position: [0, 2, 300] } },
  }, { player: false });
  H.run({ title: 'lods', files: { 'scene.json': JSON.stringify(scene) }, assets: { 'n.png': tex('n'), 'f.png': tex('f') } }, { mode: 'play', loop: false });
  const w = H.world;
  const cam = w.scene.activeCamera;
  cam.position.set(0, 2, 0);
  if (cam.setTarget) cam.setTarget(new (globalThis as any).BABYLON.Vector3(0, 2, 6));
  const t = (id: string) => H.game.entity(id).node.material.diffuseTexture;
  assert.match(t('near').url, /#n-(256|512)$/, 'big and near: sharper at once, not 128 first');
  assert.match(t('far').url, /#f-128$/, 'small and far: the smallest');
  const before = t('near').getInternalTexture();
  w.scene.render();
  T.update();
  await new Promise((r) => setTimeout(r, 50));
  T.update();
  assert.ok(t('near')._lod, 'managed');
  assert.ok(t('near')._lod.need > 512, `the near box covers many pixels (${t('near')._lod.need})`);
  assert.match(t('near').url, /#n$/, 'near and big on screen: the full image (no full-size level here)');
  assert.ok(T.stats().upgrades >= 1);
  // One copy: the level it had is gone from the GPU once the sharper one took its place.
  assert.notEqual(t('near').getInternalTexture(), before);
  assert.equal(before._references, 0, 'the old level was disposed');
  // A budget with no room left: the near one comes back down (the page never runs out of memory).
  T.reserve('test', (H.budget.textureMB - 8.5) * MB);
  T.update();
  await new Promise((r) => setTimeout(r, 50));
  assert.match(t('near').url, /#n-(128|256|512)$/, `down to budget: ${t('near').url}`);
  T.reserve('test', 0);
});

test('budgets per device: phones strict (iOS strictest), desktop roomy and never capped to a phone\'s', () => {
  const phone = H.budgetsFor({ tier: 'phone', ios: true });
  const android = H.budgetsFor({ tier: 'phone', ios: false, memoryGB: 6 });
  const tablet = H.budgetsFor({ tier: 'tablet', ios: true });
  const desktop = H.budgetsFor({ tier: 'desktop', memoryGB: 16 });
  assert.equal(phone.textureMB, 64);
  assert.ok(android.textureMB > phone.textureMB);
  assert.ok(phone.textureMB < tablet.textureMB && tablet.textureMB < desktop.textureMB);
  assert.equal(phone.maxTexture, 1024);
  assert.equal(phone.pixelRatio, 2, 'a 3x phone screen is drawn at 2x');
  assert.equal(desktop.pixelRatio, 0, 'desktop: the device\'s own, never capped');
  for (const k of ['entities', 'bodies', 'shadows', 'drawDistance', 'shadowDistance', 'loads', 'lights', 'catchUp']) assert.ok(desktop[k] > phone[k], k);
  assert.equal(H.budgetsFor({ tier: 'desktop', memoryGB: 4 }).textureMB, 256);
  assert.equal(H.device.tier, 'desktop', 'the test page is a desktop');
});

test('draw distance: small things far away are not drawn; big ones and anything near are; never past the fog', () => {
  const scene = sceneOf({
    pebble: { type: 'box', shape: { size: [0.3, 0.3, 0.3] }, transform: { position: [0, 0, 10] } },
    hill: { type: 'box', shape: { size: [60, 30, 60] }, transform: { position: [0, 0, 400] } },
  }, { fog: { color: '#ffffff', start: 50, end: 200 } });
  H.run({ title: 'cull', files: { 'scene.json': JSON.stringify(scene) }, assets: {} }, { mode: 'play', loop: false });
  H.tick(1);
  const at = (id: string) => H.game.entity(id).node._cullAt;
  assert.ok(at('pebble') >= 40 && at('pebble') < 200, `a pebble: ${at('pebble')}`);
  assert.ok(at('hill') > 200 && at('hill') < 320, `a hill: past the fog's end by its size only (${at('hill')})`);
  assert.equal(H.game.entity('pebble').node.getLODLevels().at(-1).mesh, null, 'Babylon draws nothing past it');
});

// ------------------------------------------------------------------ loading only what a game uses
test('the manifest: lazy modules are left out of what a page loads first; everything is still listed', async () => {
  const { manifest } = await import('../../src/engine.ts');
  const m = manifest();
  const lazy = m.modules.filter((x: any) => x.lazy).map((x: any) => x.name).sort();
  assert.deepEqual(lazy, ['events', 'homes', 'share', 'vehicles']);
  for (const x of m.modules.filter((y: any) => y.lazy)) {
    assert.ok(x.scripts.length && x.scripts.every((s: string) => m.scripts.includes(s)), `${x.name}: listed with the rest`);
    assert.ok(x.scripts.every((s: string) => !m.eager.includes(s)), `${x.name}: not loaded first`);
  }
  assert.ok(m.eager.some((s: string) => s.includes('/play/textures.js')), 'the core is');
  assert.ok(m.eager.some((s: string) => s.includes('/modules/living/')), 'eager modules are');
});

/** loader.js's needs(), run on its own (no page): the manifest and the loader in a small sandbox. */
async function loaderNeeds() {
  const { loaderScript } = await import('../../src/engine.ts');
  const win: any = { requestIdleCallback: undefined };
  win.window = win;
  vm.runInNewContext(loaderScript(), win);
  return (bundle: any) => [...win.HawkesModules.needs(bundle)] as string[]; // (an array from this realm)
}
const bundleOf = (scene: any, files: Record<string, string> = {}) => ({ files: { 'scene.json': JSON.stringify(scene), ...files } });

test('which lazy modules a game needs: its kinds, config, tools and the words its scripts use', async () => {
  const needs = await loaderNeeds();
  const { SANDBOX } = await import('../../src/templates.ts');
  assert.deepEqual(needs(bundleOf({ config: SANDBOX.config, entities: SANDBOX.entities() })), ['vehicles'], 'the island: a 4x4 and a boat');
  assert.deepEqual(needs(bundleOf({ config: {}, entities: { a: { type: 'box' } } })), [], 'boxes need none');
  assert.deepEqual(needs(bundleOf({ config: {}, entities: { tv: { type: 'tv' } } })), ['homes']);
  assert.deepEqual(needs(bundleOf({ config: { events: [] }, entities: {} })), ['vehicles', 'events'], 'events bring what they use');
  assert.deepEqual(needs(bundleOf({ config: { player: { tools: ['phone'] } }, entities: {} })), ['homes'], 'a tool');
  assert.deepEqual(needs(bundleOf({ config: {}, entities: { p: { type: 'tool-pickup', shape: { tool: 'remote' } } } })), ['homes'], 'a tool to pick up');
  assert.deepEqual(needs(bundleOf({ config: {}, entities: {} }, { 'main.js': "game.car({ x: 3 });\ngame.share.photo();" })), ['vehicles', 'share'], 'scripts');
  assert.deepEqual(needs(bundleOf({ config: {}, entities: {} }, { 'main.js': '// a scary story' })), [], 'a word inside another word is not one');
  assert.deepEqual(needs(null), ['vehicles', 'homes', 'events', 'share'], 'no bundle: all of them');
});
