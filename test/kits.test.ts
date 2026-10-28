// Shared kits (src/kits.ts): a builder shares a kit (things and the world settings it needs), anyone lists and fetches it,
// uses order the list, the sharer takes it back; bad kits are refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-kits-'));
const K = await import('../src/kits.ts');
const ann: any = { id: 'usr_aaaaaaaaaaaaaaaa', role: 'customer' };
const bob: any = { id: 'usr_bbbbbbbbbbbbbbbb', role: 'customer' };
const things = [{ type: 'box', name: 'Pad', shape: { size: [2, 0.2, 2] }, transform: { position: [0, 0.1, 0] }, behaviors: [{ use: 'teleport', to: 'Pad B' }], id: 'drop_me' }];

test('share, list, fetch, use, take back', () => {
  const k = K.share(ann, { title: 'Teleport pair', icon: '🌀', things, config: { match: { teams: false } } }) as any;
  assert.match(k.id, /^k_[0-9a-f]+$/);
  assert.equal(k.things[0].id, undefined, 'ids are dropped');
  const k2 = K.share(bob, { title: 'Bob arena', things: [{ type: 'cylinder' }] }) as any;
  K.used(k2.id); K.used(k2.id);
  const l = K.list() as any;
  assert.deepEqual(l.kits.map((x: any) => x.title), ['Bob arena', 'Teleport pair'], 'most used first');
  assert.equal(l.kits[0].things, undefined, 'the list is light');
  assert.equal((K.list({ full: true }) as any).kits[1].things.length, 1);
  assert.equal((K.list({ q: 'teleport' }) as any).kits.length, 1);
  assert.deepEqual((K.get(k.id) as any).config, { match: { teams: false } });
  assert.throws(() => K.unshare(bob, k.id), /Not one of yours/);
  K.unshare(ann, k.id);
  assert.throws(() => K.get(k.id), /no longer shared/);
  assert.equal((K.mine(ann) as any).kits.length, 0);
});

test('bad kits are refused', () => {
  assert.throws(() => K.share(ann, { title: '', things }), /name/);
  assert.throws(() => K.share(ann, { title: 'x', things: [] }), /needs things/);
  assert.throws(() => K.share(ann, { title: 'x', things: [{ name: 'no type' }] }), /type/);
  assert.throws(() => K.share(ann, { title: 'x', things: Array.from({ length: 121 }, () => ({ type: 'box' })) }), /at most/);
  assert.throws(() => K.share(ann, { title: 'x', things: [{ type: 'box', big: 'x'.repeat(70_000) }] }), /too big/);
});
