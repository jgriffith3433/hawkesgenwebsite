// The pinned third-party libraries (tools/vendor.mjs, src/vendor.ts): served from this site, precompressed, cached for
// good; and no page the browser loads names a CDN for a script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-vendor-'));
process.env.HAWKESGEN_URL = 'http://127.0.0.1:9';
process.env.HAWKESGEN_KEY = 'hg_test';
process.env.PUBLIC_URL = 'https://hawkesgen.ai';

const { handle } = await import('../src/server.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const port = (portal.address() as any).port;
test.after(() => portal.close());

/** A raw request: the body as sent (node's fetch would decode it). */
const raw = (p: string, acceptEncoding?: string, method = 'GET') => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((ok, fail) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: acceptEncoding ? { 'Accept-Encoding': acceptEncoding } : {} }, (res) => {
    const parts: Buffer[] = [];
    res.on('data', (c) => parts.push(c));
    res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(parts) }));
  });
  req.on('error', fail).end();
});
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'vendor.json'), 'utf8'));

test('every vendored file matches its recorded sha256 and has a .br and a .gz', () => {
  for (const [name, pkg] of Object.entries<any>(lock.packages)) {
    for (const [file, f] of Object.entries<any>(pkg.files)) {
      const p = path.join(ROOT, 'public', 'vendor', `${name}@${pkg.version}`, file);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), f.sha256, p);
      assert.ok(fs.existsSync(`${p}.br`) && fs.existsSync(`${p}.gz`), `${p} compressed copies`);
    }
  }
});

test('brotli when the browser accepts it, else gzip, else plain; immutable; Vary', async () => {
  const p = '/vendor/babylonjs-loaders@7.54.3/babylonjs.loaders.min.js';
  const plain = fs.readFileSync(path.join(ROOT, 'public', p));
  const br = await raw(p, 'gzip, deflate, br');
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers['vary'], 'Accept-Encoding');
  assert.match(String(br.headers['cache-control']), /max-age=31536000, immutable/);
  assert.equal(br.headers['access-control-allow-origin'], '*');
  assert.equal(br.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.deepEqual(zlib.brotliDecompressSync(br.body), plain);
  assert.ok(br.body.length < plain.length / 2);
  const gz = await raw(p, 'gzip');
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.deepEqual(zlib.gunzipSync(gz.body), plain);
  const none = await raw(p, 'br;q=0, gzip;q=0');
  assert.equal(none.headers['content-encoding'], undefined);
  assert.equal(none.headers['vary'], 'Accept-Encoding');
  assert.deepEqual(none.body, plain);
  const head = await raw(p, 'br', 'HEAD');
  assert.equal(head.headers['content-encoding'], 'br');
  assert.equal(head.body.length, 0);
});

test("Havok's wasm is application/wasm", async () => {
  const r = await raw('/vendor/havok@1.3.10/HavokPhysics.wasm', 'br');
  assert.equal(r.headers['content-type'], 'application/wasm');
  assert.equal(r.headers['content-encoding'], 'br');
  assert.deepEqual(zlib.brotliDecompressSync(r.body).subarray(0, 4), Buffer.from([0, 0x61, 0x73, 0x6d]));
});

test('the compressed copies are not served by name, and nothing leaves the folder', async () => {
  assert.equal((await raw('/vendor/havok@1.3.10/HavokPhysics.wasm.br')).status, 404);
  assert.equal((await raw('/vendor/havok@1.3.10/nope.js')).status, 404);
  assert.equal((await raw('/vendor/..%2f..%2fpackage.json')).status, 404);
});

test('no page loads a script or stylesheet from jsdelivr, cdnjs or unpkg', () => {
  const files = ['public/play/engine.json', 'public/play/play.html', 'public/editor.html', 'public/games.html', 'public/community.html', 'public/home.html', 'public/index.html', 'public/play/modules/monitor/monitor.js', 'public/play/loader.js'];
  for (const f of files) assert.ok(!/jsdelivr|cdnjs|unpkg/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} names a CDN`);
  const core = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'play', 'engine.json'), 'utf8'));
  for (const u of [...core.babylon, core.havok]) assert.ok(fs.existsSync(path.join(ROOT, 'public', u)), u);
});
