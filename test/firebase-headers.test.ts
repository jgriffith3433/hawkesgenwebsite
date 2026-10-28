// Firebase Hosting's cache headers (firebase.json): every page, including / and the pages served through rewrites,
// is revalidated on each visit, so a deploy never leaves a visitor on an old page that loads new engine code. Header
// rules match the address asked for, not the file served, so "**/*.html" alone misses "/" and "/app".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const firebase = JSON.parse(fs.readFileSync(new URL('../firebase.json', import.meta.url), 'utf8'));
const hosting = Array.isArray(firebase.hosting) ? firebase.hosting[0] : firebase.hosting;
const noCache = hosting.headers.filter((h: any) => h.headers.some((x: any) => x.key === 'Cache-Control' && x.value === 'no-cache'));
const matches = (path: string) => noCache.some((h: any) => (h.regex ? new RegExp(h.regex).test(path) : h.source === '**/*.html' && path.endsWith('.html')));

test('the home page and every page behind a rewrite is never cached without revalidating', () => {
  const pages = ['/', ...hosting.rewrites.filter((r: any) => r.destination?.endsWith('.html')).map((r: any) => r.source.replace('/**', '/x/y'))];
  assert.deepEqual(pages.filter((p: string) => !matches(p)), []);
});

test('the API, the engine and the pinned libraries keep their own caching', () => {
  for (const p of ['/v1/health', '/play/runtime.js', '/vendor/babylonjs@7/babylon.js', '/s/abc']) assert.equal(matches(p), false, p);
});
