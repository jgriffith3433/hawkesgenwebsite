// What a game may ask the editor (public/editor-bridge.js, docs/engine-modules.md "What a game may ask the editor"):
// a game script posts to the editor exactly as runtime.js does (window.parent.postMessage with source 'hawkes-play'),
// the editor's door lets it through, and spending is never started by the frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { createBridge, ALLOWED } = await import(path.join(ROOT, 'public', 'editor-bridge.js'));

/** The editor's side, with the requests it would make recorded. `fetch` is what reaches the server. */
function editor() {
  const requests: string[] = [];
  const chat = { value: '', focused: 0 };
  const cards: any[] = [];
  const warnings: string[] = [];
  let t = 1000;
  const bridge = createBridge({
    now: () => t,
    warn: (w: string) => warnings.push(w),
    run: (m: any) => {
      switch (m.type) {
        case 'ask': chat.value = String(m.text); chat.focused++; return;
        case 'generate': cards.push(m); return;
        case 'ops': requests.push('/scene'); return;
        case 'spawn-community': requests.push('/community'); return;
      }
    },
  });
  return { bridge, requests, chat, cards, warnings, tick: (ms: number) => { t += ms; } };
}

/** The game's script: runs inside the page, so it can reach the parent window and post as the engine does. */
function scriptPosts(ed: ReturnType<typeof editor>, n: number, make: (i: number) => any) {
  const parent = { postMessage: (m: any) => { if (m && m.source === 'hawkes-play') ed.bridge.handle(m); } };
  const script = new Function('parent', 'n', 'make', 'for (let i = 0; i < n; i++) parent.postMessage({ source: "hawkes-play", ...make(i) }, "*");');
  script(parent, n, make);
}

test('50 generate messages from a script show one card and make nothing', () => {
  const ed = editor();
  scriptPosts(ed, 50, (i) => ({ type: 'generate', kind: 'model', prompt: `castle ${i}`, name: `c${i}` }));
  assert.equal(ed.cards.length, 1, 'one card');
  assert.equal(ed.cards[0].prompt, 'castle 0');
  assert.deepEqual(ed.requests, [], 'no request to /generate');
  assert.equal(ed.bridge.cardOpen, true);
  // The person answers; the next request gets its own card.
  ed.bridge.closeCard();
  scriptPosts(ed, 3, (i) => ({ type: 'generate', kind: 'sfx', prompt: `boom ${i}` }));
  assert.equal(ed.cards.length, 2);
});

test('50 ask messages only fill the chat box: no request to /ai', () => {
  const ed = editor();
  scriptPosts(ed, 50, (i) => ({ type: 'ask', text: `make me ${i} dragons` }));
  assert.deepEqual(ed.requests, [], 'nothing sent');
  assert.equal(ed.chat.value, 'make me 49 dragons');
  assert.ok(ed.chat.focused > 0);
});

test('ops are limited to 30 a second and spawns to 2, the excess dropped with one warning each', () => {
  const ed = editor();
  scriptPosts(ed, 100, () => ({ type: 'ops', ops: [] }));
  scriptPosts(ed, 10, () => ({ type: 'spawn-community', id: 'a_1' }));
  assert.equal(ed.requests.filter((r) => r === '/scene').length, 30);
  assert.equal(ed.requests.filter((r) => r === '/community').length, 2);
  assert.equal(ed.warnings.length, 2, 'one warning per kind');
  ed.tick(1100);
  scriptPosts(ed, 100, () => ({ type: 'ops', ops: [] }));
  assert.equal(ed.requests.filter((r) => r === '/scene').length, 60, 'a new second, a new 30');
  assert.equal(ed.warnings.length, 2, 'and still no second warning');
});

test('unknown types are ignored', () => {
  const ed = editor();
  scriptPosts(ed, 1, () => ({ type: 'pay', credits: 1000 }));
  scriptPosts(ed, 1, () => ({ type: 'constructor' }));
  assert.deepEqual(ed.requests, []);
  assert.deepEqual([...ALLOWED].filter((t) => /pay|buy|delete|purchase|credits/.test(t)), []);
});

test('the engine\'s own messages to the editor are all on the list', async () => {
  const fs = await import('node:fs');
  const used = new Set<string>();
  for (const f of ['runtime.js', 'build.js', 'guest.js', 'analytics.js']) {
    const p = path.join(ROOT, 'public', 'play', f);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:toParent|post)\(\{ type: '([a-z-]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.has('generate') && used.has('ops'));
  for (const t of used) assert.ok(ALLOWED.has(t), `${t} is allowed`);
});
