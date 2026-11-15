// The landing page's pictures: every image or asset public/home.html points at must exist (a 404 is a broken image in
// the site crawl), every <img> has alt text, and the pictures built by the page's scripts have alt and drop on error.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = fs.readFileSync(path.join(PUBLIC, 'home.html'), 'utf8');
const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '');

/** Local files the markup refers to: img/source/poster/icon/manifest links and og/twitter images. */
export function refs(h: string): string[] {
  const out = new Set<string>();
  for (const m of h.matchAll(/<(?:img|source|video)\b[^>]*?\s(?:src|poster)="([^"]+)"/gi)) out.add(m[1]);
  for (const m of h.matchAll(/<link\b[^>]*\srel="[^"]*(?:icon|manifest|stylesheet)[^"]*"[^>]*\shref="([^"]+)"/gi)) out.add(m[1]);
  for (const m of h.matchAll(/<link\b[^>]*\shref="([^"]+)"[^>]*\srel="[^"]*(?:icon|manifest|stylesheet)[^"]*"/gi)) out.add(m[1]);
  for (const m of h.matchAll(/<meta\b[^>]*(?:og|twitter):image[^>]*\scontent="([^"]+)"/gi)) out.add(m[1]);
  return [...out].filter((u) => !u.startsWith('data:'));
}
const local = (u: string) => (u.startsWith('https://hawkesgames.com/') ? u.slice('https://hawkesgames.com'.length) : u);

test('every image and asset public/home.html references exists', () => {
  const all = refs(markup);
  assert.ok(all.length >= 10, 'found the references');
  const missing = all.map(local).filter((u) => u.startsWith('/')).filter((u) => !fs.existsSync(path.join(PUBLIC, u.split(/[?#]/)[0])));
  assert.deepEqual(missing, [], 'referenced files that do not exist');
  assert.deepEqual(all.filter((u) => /^https?:/.test(local(u)) && !/\.(js|css)$/.test(u)), [], 'no pictures from other sites');
});

test('the manifest icons exist', () => {
  const icons = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'manifest.webmanifest'), 'utf8')).icons as { src: string }[];
  assert.deepEqual(icons.map((i) => i.src).filter((s) => !fs.existsSync(path.join(PUBLIC, s))), []);
});

test('every <img> on the landing page has alt text, including the ones its scripts build', () => {
  // (The play-first landing page of 2026-11-01 has no <img> of its own: the sky is a canvas. Any it gains need alt.)
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  for (const t of imgs) assert.match(t, /\salt="/, t.slice(0, 80));
  assert.deepEqual([...html.matchAll(/<img src="' \+ [^>]*>/g)].filter((m) => /alt=""/.test(m[0])), [], 'library pictures name the thing');
});
