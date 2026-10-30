// A game page carries a full Content-Security-Policy beside its sandbox (src/server.ts playCsp): a game's script cannot
// reach a site we have not named. The browser enforces it; here the header is read and its rules are applied the way a
// browser reads them (just enough of CSP source matching for the directives we set). Also: the links a game may offer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-csp-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.PORTAL_DEV_OPEN_PLAY = '0';
process.env.PUBLIC_URL = 'https://hawkesgen.ai';

const { handle } = await import('../src/server.ts');
const { safeHref } = await import(pathToFileURL(path.join(ROOT, 'public', 'editor-bridge.js')).href);
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => portal.close());

function parse(csp: string) {
  const d: Record<string, string[]> = {};
  for (const part of csp.split(';')) { const [name, ...src] = part.trim().split(/\s+/); if (name) d[name] = src; }
  return d;
}
/** Would `directive` let a page at the portal's address load `url`? (hosts, schemes, 'self'; not paths) */
function allows(d: Record<string, string[]>, directive: string, url: string, self = 'https://hawkesgen.ai') {
  const list = d[directive] ?? d['default-src'] ?? [];
  const u = new URL(url);
  return list.some((s) => {
    if (s === "'self'") return u.origin === self || (u.protocol === 'wss:' && u.host === new URL(self).host);
    if (/^'/.test(s)) return false;
    if (/:$/.test(s)) return u.protocol === s;
    return u.origin === s;
  });
}

const pages = ['/play/_draft', '/play/my-game', '/play/t/some-template', '/play/my-game/v/2'];

test('every sandboxed play page carries the sandbox and a full policy; the guest sandbox and our featured games stay open', async () => {
  for (const route of pages) {
    const r = await fetch(base + route);
    assert.equal(r.status, 200, route);
    const csp = String(r.headers.get('content-security-policy'));
    const d = parse(csp);
    assert.match(csp, /^sandbox allow-scripts allow-pointer-lock allow-popups;/);
    // Popups stay sandboxed and a game cannot navigate the tab.
    assert.doesNotMatch(csp, /allow-popups-to-escape-sandbox|allow-top-navigation/);
    assert.deepEqual(d['default-src'], ["'none'"]);
    for (const k of ['script-src', 'connect-src', 'img-src', 'media-src', 'font-src', 'style-src', 'worker-src', 'frame-src', 'form-action', 'base-uri']) assert.ok(d[k], `${k} is set`);
    assert.deepEqual(d['frame-src'], ["'none'"]);
    assert.deepEqual(d['form-action'], ["'none'"]);
    assert.deepEqual(d['base-uri'], ["'none'"]);
    // The inline scripts of play.html carry the page's nonce, so the policy needs no 'unsafe-inline' for scripts.
    const nonce = /'nonce-([^']+)'/.exec(d['script-src'].join(' '))?.[1];
    assert.ok(nonce, 'a nonce');
    assert.ok(!d['script-src'].includes("'unsafe-inline'"));
    const html = await r.text();
    assert.ok(!/<script>/.test(html), 'no inline script without the nonce');
    assert.ok(html.includes(`<script nonce="${nonce}">`));
  }
  assert.equal((await fetch(`${base}/play/sandbox`)).headers.get('content-security-policy'), null);
  assert.equal((await fetch(`${base}/play/t/fps-arena`)).headers.get('content-security-policy'), null);
});

test('the nonce is new for every page load', async () => {
  const a = String((await fetch(`${base}/play/x-game`)).headers.get('content-security-policy'));
  const b = String((await fetch(`${base}/play/x-game`)).headers.get('content-security-policy'));
  assert.notEqual(/nonce-([^']+)/.exec(a)?.[1], /nonce-([^']+)/.exec(b)?.[1]);
});

test("a game script's fetch to an outside site is refused; what the engine needs is allowed", async () => {
  const d = parse(String((await fetch(`${base}/play/my-game`)).headers.get('content-security-policy')));
  for (const url of ['https://example.com/', 'https://evil.example/steal?c=1', 'wss://example.com/', 'http://hawkesgen.ai/', 'https://gen.hawkesgen.ai.evil.example/']) {
    assert.equal(allows(d, 'connect-src', url), false, url);
    assert.equal(allows(d, 'img-src', url), false, `img ${url}`);
    assert.equal(allows(d, 'script-src', url), false, `script ${url}`);
  }
  // Its own site (assets, the room), Babylon and Havok from the CDN, Gen's analytics.
  assert.ok(allows(d, 'connect-src', 'https://hawkesgen.ai/v1/play-template/x'));
  assert.ok(allows(d, 'connect-src', 'wss://hawkesgen.ai/v1/ws'));
  // Babylon, the loaders, Havok and its wasm are our own (/vendor): no CDN is on the list.
  assert.ok(allows(d, 'connect-src', 'https://hawkesgen.ai/vendor/havok@1.3.10/HavokPhysics.wasm'));
  assert.ok(allows(d, 'script-src', 'https://hawkesgen.ai/vendor/babylonjs@7.54.3/babylon.js'));
  for (const cdn of ['https://cdn.jsdelivr.net/npm/babylonjs@7.54.3/babylon.js', 'https://cdnjs.cloudflare.com/x.js', 'https://unpkg.com/x.js']) assert.equal(allows(d, 'script-src', cdn), false, cdn);
  assert.ok(allows(d, 'script-src', 'https://gen.hawkesgen.ai/sdk/analytics@1.js'));
  assert.ok(allows(d, 'img-src', 'blob:https://hawkesgen.ai/abc'));
  assert.ok(d['script-src'].includes("'unsafe-eval'") && d['script-src'].includes("'wasm-unsafe-eval'"));
  assert.deepEqual(d['worker-src'], ['blob:', "'self'"]);
});

test('every external host the game page and engine name is on the policy list', () => {
  // A host added to the engine must be added to PLAY_HOSTS (server.ts); this finds the ones that were not.
  const listed = new Set(['https://gen.hawkesgen.ai', 'https://models.babylonjs.com', 'https://hawkesgames.com']); // the last: the badge, a link to this site
  const files = ['public/play/play.html', 'public/play/engine.json', 'public/play/kinds.js', 'public/play/loader.js', 'public/play/runtime.js', 'public/play/net.js', 'public/play/modules/monitor/monitor.js'];
  for (const f of files) {
    for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/https:\/\/([a-z0-9.-]+)/g)) {
      const origin = `https://${m[1]}`;
      if (/w3\.org$/.test(m[1])) continue;
      assert.ok(listed.has(origin), `${f} names ${origin}: add it to PLAY_HOSTS in src/server.ts (and here) or stop using it`);
    }
  }
});

test('a link from a game or its chat is a link only when it is ours', () => {
  const ok = ['/app#credits', '/app/g/g_1', 'https://hawkesgen.ai/app', 'https://www.hawkesgen.ai/'];
  for (const h of ok) assert.ok(safeHref(h), h);
  assert.ok(safeHref('https://beta.example.net/app', ['https://beta.example.net']), 'this page\'s own origin');
  for (const h of ['https://example.com/', 'http://hawkesgen.ai/', 'javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', '//example.com/x', '/\\example.com/x', '/\t/example.com', 'https://hawkesgen.ai.evil.example/', 'https://evil.example/https://hawkesgen.ai/', '', null, undefined, 'app/x', 'mailto:a@b.c']) {
    assert.equal(safeHref(h), null, String(h));
  }
});
