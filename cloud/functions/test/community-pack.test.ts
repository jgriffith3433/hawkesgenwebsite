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
  assert.ok(wasTurnedAway("No GPU is available right now, so this couldn't start. Nothing was charged. Please try again later."));
  assert.ok(!wasTurnedAway('step 3/5 image.viewsheet: the views are not the same object'));
  assert.ok(!wasTurnedAway(''));
});

test("a 3D try stopped at RunPod's old 300 s limit (Gen's limit, not the model) is free too", async () => {
  const { stoppedAtGenLimit } = await import('../src/community.ts');
  assert.ok(stoppedAtGenLimit("step 4 (mesh.views3d) failed: runpod: ran past this service's 300 s limit"));
  assert.ok(!stoppedAtGenLimit("runpod: ran past this service's 1800 s limit"));
  assert.ok(!stoppedAtGenLimit('step 3/5 image.viewsheet: the views are not the same object'));
});
