// The sandbox's sound is asked for late (src/overseer-games/sandbox.js): a request log over a stand-in page shows that
// before the world is playable nothing is fetched, then the intro's voice, and only after the intro starts the music
// and the loops; each fades in only once it has loaded. (The files themselves are Gen's; a smaller encode is its change.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'src', 'overseer-games', 'sandbox.js'), 'utf8');

function page() {
  const requests: string[] = []; // every url the page asked the network for, in order
  const handlers: Record<string, Function[]> = {};
  const starts: Function[] = [];
  const timers: { at: number; fn: Function }[] = [];
  let now = 0;
  class FakeAudio {
    listeners: Record<string, Function[]> = {}; _src = ''; _preload = 'auto'; volume = 1; loop = false; paused = true; crossOrigin = ''; readyState = 0;
    constructor(url?: string) { if (url) this.src = url; }
    set src(v: string) { this._src = v; if (this._preload !== 'none') requests.push(v); }
    get src() { return this._src; }
    set preload(v: string) { const was = this._preload; this._preload = v; if (this._src && was === 'none' && v !== 'none') requests.push(this._src); }
    get preload() { return this._preload; }
    load() { if (this._src && this._preload === 'none') requests.push(this._src); }
    addEventListener(t: string, f: Function) { (this.listeners[t] ||= []).push(f); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
    // Enough buffered to start (sandbox.js listens for canplay / loadeddata; canplaythrough is too late for long loops).
    loaded() { this.readyState = 4; for (const t of ['canplay', 'loadeddata', 'canplaythrough']) for (const f of this.listeners[t] || []) f(); }
  }
  const audios: FakeAudio[] = [];
  const Audio = function (url?: string) { const a = new FakeAudio(url); audios.push(a); return a; } as any;
  const fetched: string[] = [];
  const names = new Set(['meadow.mp3', 'ocean-waves.mp3', 'forest.mp3', 'overseer-intro.mp3']);
  const game: any = new Proxy({
    mode: 'play', player: { x: 0, y: 0, z: 0, position: [0, 0, 0] },
    hasAsset: (n: string) => names.has(n), asset: (n: string) => `/v1/community/${n}/file`,
    on: (t: string, f: Function) => { (handlers[t] ||= []).push(f); },
    onStart: (f: Function) => { starts.push(f); },
    after: (s: number, f: Function) => { timers.push({ at: now + s * 1000, fn: f }); },
    every: () => {}, input: { onKey() {} }, all: () => [], terrain: { heightAt: () => -10 }, planet: { height: () => 0 },
  } as any, { get: (t, k) => (k in t ? t[k] : () => ({})) });
  const H = { audio: { media: () => {}, context: { state: 'running' } }, overseer: { introWanted: () => true } };
  const win: any = { HawkesPlay: H, addEventListener() {}, removeEventListener() {} };
  const ctx: any = {
    window: win, game, Audio, performance: { now: () => now }, console: { log() {} },
    fetch: (u: string) => { requests.push(u); fetched.push(u); return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)) }); },
    document: { getElementById: () => null, createElement: () => ({ style: {}, appendChild() {}, classList: { add() {} } }), body: { appendChild() {} }, head: { appendChild() {} } },
    setTimeout, Promise, Math,
  };
  vm.runInNewContext(src, ctx, { filename: 'sandbox.js' });
  return {
    requests, audios, win,
    start: () => starts.forEach((f) => f()),
    emit: (t: string, d: any) => (handlers[t] || []).forEach((f) => f(d)),
    advance: (s: number) => { now += s * 1000; for (const t of timers.splice(0).sort((a, b) => a.at - b.at)) (t.at <= now ? t.fn() : timers.push(t)); },
  };
}
const has = (list: string[], name: string) => list.some((u) => u.includes(name));

test('sandbox sound: nothing is requested before the world is playable', () => {
  const p = page();
  assert.deepEqual(p.requests, [], 'the script loading asks for no file');
  assert.equal(p.audios.length, 3, 'the three loops exist, waiting');
});

test('sandbox sound: the intro voice first, the music and loops only after the intro starts, each faded in once loaded', async () => {
  const p = page();
  p.start(); // the world is playable
  assert.deepEqual(p.requests.filter((u) => !has([u], 'overseer-intro')), [], 'only the intro voice, and no music yet');
  assert.ok(has(p.requests, 'overseer-intro'), 'the intro voice is asked for first');
  await new Promise((r) => setTimeout(r, 5));
  p.advance(2);
  assert.ok(!has(p.requests, 'meadow'), 'a tap alone asks for no music: ' + JSON.stringify(p.requests));
  p.emit('intro', { state: 'start' });
  await new Promise((r) => setTimeout(r, 20)); // (the voice is in)
  assert.ok(has(p.requests, 'overseer-intro') && p.requests.indexOf(p.requests.find((u) => has([u], 'overseer-intro'))!) === 0, 'the voice is still first in the log');
  for (const n of ['meadow', 'ocean-waves', 'forest']) assert.ok(has(p.requests, n), `${n} is asked for after the intro starts`);
  // Until a file has loaded it is silent and not playing; once loaded it plays and fades in (here: still at 0 at once).
  assert.ok(p.audios.every((a) => a.paused && a.volume === 0), 'silent until loaded');
  p.audios[0].loaded();
  assert.equal(p.audios[0].paused, false, 'the music plays once it has loaded');
  assert.equal(p.audios[1].paused, true, 'the sea waits for its own file');
  assert.ok(p.win.__islandAudioLog.some((e: any) => e.what === 'ready' && e.name === 'meadow.mp3'), 'the log says when each was ready');
});

test('sandbox sound: the gateway gesture starts the music, the sea and the birds at once; a skipped intro still does', async () => {
  const p = page();
  p.start();
  p.emit('gateway', { state: 'passed' });
  await new Promise((r) => setTimeout(r, 20));
  for (const n of ['meadow', 'ocean-waves', 'forest']) assert.ok(has(p.requests, n), `${n} is asked for with the gesture`);
  const q = page();
  q.start();
  q.emit('intro', { state: 'end' });
  for (const n of ['meadow', 'ocean-waves', 'forest']) assert.ok(has(q.requests, n), `${n} starts after a skipped intro`);
});
