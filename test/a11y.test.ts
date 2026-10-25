// Cheap accessibility checks over the pages' HTML (J's audit): every input has a label, every image has alt text,
// every button a name, dialogs are named, the landing text meets 4.5:1, and the sky, loading screen and sheet honor
// reduced motion. Add an unlabeled input or an image without alt and this fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PAGES = ['index.html', 'gallery.html', 'games.html', 'community.html', 'connect.html', 'reset.html', 'authorize.html', 'share.html'];

const attr = (tag: string, name: string) => new RegExp(`\\s${name}(?:=("[^"]*"|'[^']*'|[^\\s>]+))?(?=[\\s/>])`, 'i').exec(tag);
const stripScripts = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

/** Inputs, selects and textareas in the markup that no label, aria-label or title names. */
export function unlabeled(html: string): string[] {
  const h = stripScripts(html);
  const forIds = new Set([...h.matchAll(/<label\b[^>]*\sfor="([^"]+)"/gi)].map((m) => m[1]));
  const bad: string[] = [];
  for (const m of h.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = m[0];
    const type = /\stype="?([a-z]+)/i.exec(tag)?.[1]?.toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    const id = /\sid="([^"]+)"/i.exec(tag)?.[1];
    const inLabel = new RegExp(`<label\\b[^>]*>(?:(?!</label>)[\\s\\S])*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(h);
    if (attr(tag, 'aria-label') || attr(tag, 'aria-labelledby') || attr(tag, 'title') || (id && forIds.has(id)) || inLabel) continue;
    bad.push(tag.slice(0, 100));
  }
  return bad;
}
/** <img> without an alt attribute (alt="" is fine: decorative). */
export function noAlt(html: string): string[] {
  return [...stripScripts(html).matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => !attr(t, 'alt')).map((t) => t.slice(0, 100));
}
/** Buttons with no text and no aria-label. */
export function nameless(html: string): string[] {
  return [...stripScripts(html).matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
    .filter((m) => !attr(m[1], 'aria-label') && !attr(m[1], 'title') && !m[2].replace(/<[^>]*>/g, '').trim())
    .map((m) => m[0].slice(0, 100));
}

test('every page: inputs are labeled, images have alt, buttons have names', () => {
  for (const f of PAGES) {
    const html = read(`public/${f}`);
    assert.deepEqual(unlabeled(html), [], `${f}: inputs without a label`);
    assert.deepEqual(noAlt(html), [], `${f}: images without alt`);
    assert.deepEqual(nameless(html), [], `${f}: buttons without a name`);
  }
});

test('the checks themselves catch what they should', () => {
  assert.equal(unlabeled('<input type="text">').length, 1);
  assert.equal(unlabeled('<label for="a">A</label><input id="a">').length, 0);
  assert.equal(unlabeled('<label>A <input></label>').length, 0);
  assert.equal(unlabeled('<input aria-label="x">').length, 0);
  assert.equal(noAlt('<img src="a.png">').length, 1);
  assert.equal(noAlt('<img src="a.png" alt="">').length, 0);
  assert.equal(nameless('<button></button>').length, 1);
});

test('the landing: dialog is named and modal, the form errors are announced, the sky is labelled', () => {
  const h = read('public/index.html');
  assert.match(h, /role="dialog" aria-modal="true" aria-labelledby="authTitle"/);
  assert.match(h, /id="authError" role="alert"/);
  assert.match(h, /class="skip-link"/);
  assert.match(h, /data-sky aria-label=/);
  assert.match(h, /<canvas aria-hidden="true">/);
});

test('the sign-up sheet: named dialog, labelled fields, a Tab loop, no Escape when forced, 44 px targets', () => {
  const g = read('public/play/guest.js');
  assert.match(g, /role="dialog" aria-modal="true" aria-labelledby="gsTitle"/);
  for (const id of ['gsEmail', 'gsPw']) assert.match(g, new RegExp(`<label for="${id}"`));
  assert.match(g, /e\.key !== 'Tab'/);
  assert.match(g, /e\.key === 'Escape' && !forced/);
  assert.match(g, /:focus-visible/);
  assert.doesNotMatch(g, /min-height:(?:3\d|40)px/);
});

// --- contrast
const lum = (hex: string) => {
  const c = hex.replace('#', '').match(/../g)!.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('contrast: the light page and the sheet meet 4.5:1, the hero over its brightest sky', () => {
  const css = read('public/public.css');
  const tok = (n: string) => new RegExp(`body\\.landing \\{[^}]*--${n}: (#[0-9a-f]{6})`, 'i').exec(css)![1];
  for (const t of ['fg', 'fg-2', 'fg-3', 'accent']) for (const bg of ['#ffffff', '#f5f6f9']) assert.ok(ratio(tok(t), bg) >= 4.5, `--${t} on ${bg}: ${ratio(tok(t), bg).toFixed(2)}`);
  assert.ok(ratio(tok('fg-3'), '#ebedf2') >= 4.5);
  const sky = read('public/overseer-sky.js');
  const brightest = /addColorStop\(1, '(#[0-9a-f]{6})'\)/i.exec(sky)![1];
  for (const c of ['#cfe0f3', '#aebfd6', '#a9bdd6', '#b4c8e2', '#bfe9ff', '#8fd8ff']) assert.ok(ratio(c, brightest) >= 4.5, `${c} on ${brightest}: ${ratio(c, brightest).toFixed(2)}`);
  for (const c of ['#a5acc2', '#8088a3', '#c7cbe0', '#fca5a5', '#93c5fd']) assert.ok(ratio(c, '#0f1420') >= 4.5, `sheet ${c}: ${ratio(c, '#0f1420').toFixed(2)}`);
});

test('reduced motion is honored: sky, loading screen, entering a game, the page, the camera shake', () => {
  assert.match(read('public/overseer-sky.js'), /prefers-reduced-motion: reduce/);
  assert.match(read('public/overseer-sky.css'), /prefers-reduced-motion: reduce/);
  assert.match(read('public/public.css'), /prefers-reduced-motion: reduce[\s\S]*animation-duration/);
  assert.match(read('public/enter.js'), /prefers-reduced-motion: reduce/);
  const play = read('public/play/play.html');
  assert.match(play, /prefers-reduced-motion: reduce/);
  assert.match(read('public/play/modules/juice/juice-core.js'), /prefers-reduced-motion: reduce/);
  assert.match(read('public/play/modules/overseer/chat.js'), /data-s=captions|data-s="captions"/);
});
