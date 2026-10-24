// The codex (/entities) shows every kind and world feature from the registry. These keep each one's page real: a group, a
// sentence, a spec that builds, and fields to read, so a module's new kind arrives in the codex with something to show.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './harness.ts';

const H = await load();

test('every kind has a codex page: a group, what it is, a spec of its own type', () => {
  const missing: string[] = [];
  for (const k of H.kinds.list()) {
    if (k.alias || (k.codex && k.codex.hidden)) continue;
    const c = k.codex;
    if (!c) { missing.push(`${k.name}: no codex`); continue; }
    if (!c.group) missing.push(`${k.name}: no group`);
    if (!c.what || c.what.length < 12) missing.push(`${k.name}: no sentence saying what it is`);
    if (!c.spec) missing.push(`${k.name}: no spec to show live`);
    else if (c.spec.type !== k.name) missing.push(`${k.name}: its spec is a "${c.spec.type}"`);
  }
  assert.deepEqual(missing, []);
});

test('every world feature with a codex page has an example value and its fields', () => {
  const missing: string[] = [];
  for (const f of H.features.list()) {
    if (!f.codex) continue;
    if (f.codex.value === undefined) missing.push(`${f.name}: no example value`);
    if (!f.codex.what) missing.push(`${f.name}: no sentence saying what it is`);
  }
  assert.deepEqual(missing, []);
});
