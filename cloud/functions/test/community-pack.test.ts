// The community starter pack (community/starter.mjs) and what may be remade (community/restore.json), read from the repo:
//   node --test --disable-warning=ExperimentalWarning test/community-pack.test.ts
// Gen lost the whole pack with the old AWS box (2026-11); /v1/community/health counts the pack against the library and the
// scheduled sync remakes what is missing only on a lane J ordered it for, within its budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pack = await import(new URL('../../../community/starter.mjs', import.meta.url).href);
const KINDS = ['model', 'texture', 'image', 'sprite', 'sky', 'music', 'ambience', 'sfx', 'voice', 'video'];

test('every pack thing has its own item and Gen key, in a known kind', () => {
  const items = pack.packItems();
  assert.ok(items.length >= 300, `${items.length} things`);
  assert.equal(new Set(items.map((it: any) => it.item)).size, items.length, 'items are unique');
  assert.equal(new Set(items.map((it: any) => pack.keyOf(it))).size, items.length, 'keys are unique');
  for (const it of items) {
    assert.ok(KINDS.includes(it.kind), it.item);
    assert.equal(pack.labelsOf(it).item, it.item.slice(it.kind.length + 1), 'the label the sync matches is the item');
    assert.ok(pack.paramsFor(it.kind, it.what)?.steps?.length, `${it.item} has a recipe`);
  }
});

test('restore.json: a lane is only remade on an order with J’s yes, kinds and a capped budget', () => {
  const r = JSON.parse(fs.readFileSync(new URL('../../../community/restore.json', import.meta.url), 'utf8'));
  for (const lane of ['live', 'beta']) {
    const o = r[lane];
    if (o === null || o === undefined) continue;
    assert.ok(typeof o.approved === 'string' && o.approved.trim().length > 10, `${lane}: quote J's yes and when`);
    assert.ok(Array.isArray(o.kinds) && o.kinds.length && o.kinds.every((k: string) => KINDS.includes(k)), `${lane}: kinds`);
    assert.ok(Number(o.budgetUsd) > 0 && Number(o.budgetUsd) <= 200, `${lane}: budget in dollars, at most 200`);
    for (const item of o.first ?? []) assert.ok(pack.packItems().some((it: any) => it.item === item), `${lane}: first names a pack thing (${item})`);
  }
});

test('a remake try Gen turned away (too many at once, Claude busy) is not one of the two tries', async () => {
  const { wasTurnedAway } = await import('../src/community.ts');
  assert.ok(wasTurnedAway("That's a lot at once: wait 1 second, then try again."));
  assert.ok(wasTurnedAway('Claude is throttled (429)'));
  assert.ok(wasTurnedAway('step 1 (image.generate) failed: modal /run: 404 modal-http: workspace ac-test is disabled'));
  assert.ok(wasTurnedAway("No GPU is available right now, so this couldn't start. Nothing was charged. Please try again later."));
  assert.ok(!wasTurnedAway('step 3/5 image.viewsheet: the views are not the same object'));
  assert.ok(!wasTurnedAway(''));
});

test("a 3D try stopped at RunPod's old 300 s limit (Gen's limit, not the model) is free too", async () => {
  const { stoppedAtGenLimit } = await import('../src/community.ts');
  assert.ok(stoppedAtGenLimit("step 4 (mesh.views3d) failed: runpod: ran past this service's 300 s limit"));
  assert.ok(!stoppedAtGenLimit("runpod: ran past this service's 1800 s limit"));
  assert.ok(stoppedAtGenLimit('step 4 (mesh.views3d) failed: runpod: HTTP Error 413: Request Entity Too Large'));
  assert.ok(!stoppedAtGenLimit('step 3/5 image.viewsheet: the views are not the same object'));
});

test('stepCost sums a tool\'s finished jobs in GPU seconds', async () => {
  const { stepCost } = await import('../src/community.ts');
  const r = stepCost([
    { status: 'done', started: 1000, finished: 11000, gpu_seconds: 8 },
    { status: 'done', started: 1000, finished: 31000, gpu_seconds: 20 },
    { status: 'done', started: 1000, finished: 21000, gpu_seconds: 12 },
    { status: 'failed', started: 1000, finished: 2000, gpu_seconds: 1 },
    { status: 'running', started: 1000, finished: null, gpu_seconds: 3 },
  ]);
  assert.deepEqual(r, { done: 3, failed: 1, gpuSecondsMedian: 12, gpuSecondsTotal: 40, wallSecondsMedian: 20 });
});

test('a lane copies only from a hawkesgames.com https origin', async () => {
  const { copySource } = await import('../src/community.ts');
  assert.equal(copySource('https://beta.hawkesgames.com'), 'https://beta.hawkesgames.com');
  assert.equal(copySource('https://beta.hawkesgames.com/anything?x=1'), 'https://beta.hawkesgames.com');
  assert.equal(copySource('http://beta.hawkesgames.com'), null);
  assert.equal(copySource('https://evilhawkesgames.com'), null);
  assert.equal(copySource('https://hawkesgames.com.evil.example'), null);
  assert.equal(copySource('https://user:pw@beta.hawkesgames.com'), null);
  assert.equal(copySource(undefined), null);
});

test('a copied model keeps the recipe\'s own output names, so the sync lists it like a made one', async () => {
  const { copySteps, sourceKey, starterRow } = await import('../src/community.ts');
  const s = copySteps('model', 'blob:aa', 'blob:bb');
  assert.deepEqual(s.steps.map((x: any) => [x.tool, x.save]), [['file.import', 'model'], ['file.import', 'cutout']]);
  assert.deepEqual(copySteps('music', 'blob:cc', null).steps.map((x: any) => x.save), ['music']);
  assert.equal(sourceKey('model', ' Wooden Crate '), 'model/wooden crate');
  const labels = { pack: 'starter', kind: 'model', name: 'Wooden crate', item: 'wooden-crate', tag: 'props', rev: 'v4' };
  const row = starterRow([
    { id: 'a_1', title: 'model', mime: 'model/gltf-binary', bytes: 900, labels },
    { id: 'a_2', title: 'cutout', mime: 'image/png', bytes: 50, labels },
  ]);
  assert.equal(row?.main.id, 'a_1');
  assert.equal(row?.thumb?.id, 'a_2');
});

test('a starter thing gets no second try while its first is still queued or running in Gen', async () => {
  const { tryDue } = await import('../src/community.ts');
  const now = 10 * 3600_000;
  const base = { tries: 1, allowed: 2, lastFailed: false, lastOpen: false, queuedAt: now - 3 * 3600_000 };
  assert.equal(tryDue({ ...base, tries: 0, queuedAt: 0 }, now), true);
  assert.equal(tryDue(base, now), true, 'over 2 hours and no open job: try again');
  assert.equal(tryDue({ ...base, lastOpen: true }, now), false, 'still running in Gen after 3 hours: wait');
  assert.equal(tryDue({ ...base, queuedAt: now - 3600_000 }, now), false, 'under 2 hours: wait');
  assert.equal(tryDue({ ...base, lastOpen: true, lastFailed: true }, now), true, 'failed: the next try needn\'t wait');
  assert.equal(tryDue({ ...base, tries: 2, lastFailed: true }, now), false, 'no tries left');
  assert.equal(tryDue({ ...base, lastFailed: true, queuedAt: now - 10 * 60_000, waitAfterFail: 30 * 60_000 }, now), false, 'turned away for no GPU: back off');
  assert.equal(tryDue({ ...base, lastFailed: true, queuedAt: now - 31 * 60_000, waitAfterFail: 30 * 60_000 }, now), true, 'backed off long enough');
});

test('a try with no GPU is told apart, and backs off up to 4 hours', async () => {
  const { hadNoGpu, noGpuWait } = await import('../src/community.ts');
  assert.ok(hadNoGpu("step 3 (image.viewsheet) failed: the front view (image.edit) failed: No GPU is available right now, so this couldn't start. Nothing was charged."));
  assert.ok(!hadNoGpu("That's a lot at once: wait 1 second, then try again."));
  assert.equal(noGpuWait(0), 0);
  assert.equal(noGpuWait(1), 30 * 60_000);
  assert.equal(noGpuWait(2), 60 * 60_000);
  assert.equal(noGpuWait(10), 4 * 3600_000);
});
