// A small headless engine for the vehicles tests: Babylon's NullEngine and just enough of a browser (a pretend DOM)
// to run the real engine files (public/play/*.js) and the vehicles module in Node. No GPU, no browser.
// (The foundation's own harness, test/engine/harness.ts, replaces this once it lands; the scenarios stay the same.)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PLAY = path.join(ROOT, 'public', 'play');

/** Any element: every property you set is kept, every method you call does nothing and returns another element. */
function fakeElement(tag = 'div'): any {
  const kept: Record<string | symbol, any> = {
    tagName: String(tag).toUpperCase(), style: {}, dataset: {}, children: [], childNodes: [], hidden: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    querySelector: () => fakeElement(), querySelectorAll: () => [], getAttribute: () => null,
    appendChild(c: any) { kept.children.push(c); return c; },
    getContext: () => ctx2d(),
  };
  return new Proxy(kept, {
    get(t, k) { if (k in t) return t[k]; if (typeof k === 'symbol') return undefined; return (..._a: any[]) => fakeElement(); },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function ctx2d(): any {
  const kept: Record<string, any> = { measureText: (s: string) => ({ width: String(s).length * 8 }), canvas: null };
  return new Proxy(kept, {
    get(t, k) { if (k in t) return t[k as string]; return () => ({ addColorStop() {} }); },
    set(t, k, v) { t[k as string] = v; return true; },
  });
}

let loaded: any = null;

/** Loads Babylon, the engine core and the given modules' scripts once; returns { H, B, run(files), tick, keys }. */
export function engine(modules: string[] = ['vehicles']) {
  if (loaded) return loaded;
  const g: any = globalThis;
  const listeners: Record<string, Function[]> = {};
  const on = (type: string, fn: Function) => { (listeners[type] ||= []).push(fn); };
  const stage = fakeElement('canvas');
  const ui = fakeElement('div');
  g.window = g;
  g.self = g;
  g.addEventListener = on;
  g.removeEventListener = () => {};
  g.document = {
    getElementById: (id: string) => (id === 'stage' ? stage : id === 'ui' ? ui : null),
    createElement: (t: string) => fakeElement(t),
    createElementNS: (_n: string, t: string) => fakeElement(t),
    addEventListener: () => {}, removeEventListener: () => {},
    body: fakeElement('body'), head: fakeElement('head'), documentElement: fakeElement('html'),
    querySelector: () => null, querySelectorAll: () => [], hidden: false, pointerLockElement: null, exitPointerLock() {},
  };
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  if (!g.navigator || !('userAgentData' in g.navigator)) try { Object.defineProperty(g, 'navigator', { value: { userAgent: 'node', userAgentData: { mobile: false }, maxTouchPoints: 0 }, configurable: true }); } catch {}
  g.location = { search: '', href: 'http://localhost/', protocol: 'http:', host: 'localhost' };
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
  g.HTMLElement = function () {};
  g.HTMLCanvasElement = function () {};
  const require = createRequire(import.meta.url);
  const B = require('babylonjs');
  g.BABYLON = B;
  g.HawkesEngineFactory = () => new B.NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
  const files = [...JSON.parse(fs.readFileSync(path.join(PLAY, 'engine.json'), 'utf8')).core.map((f: string) => path.join(PLAY, f))];
  for (const m of modules) {
    const dir = path.join(PLAY, 'modules', m);
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'module.json'), 'utf8'));
    for (const s of man.scripts || []) files.push(path.join(dir, s));
  }
  for (const f of files) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
  const H = g.HawkesPlay;
  H.hooks.quietErrors = true;
  const errors: string[] = [];
  const realReport = H.report;
  H.report = (err: any, file?: string) => { errors.push(`${file || ''}: ${err && err.stack || err}`); try { realReport(err, file); } catch {} };
  const fire = (type: string, e: any) => { for (const fn of listeners[type] || []) fn(e); };
  const keys = {
    down(k: string) { fire('keydown', { key: k === 'space' ? ' ' : k, target: {}, preventDefault() {} }); },
    up(k: string) { fire('keyup', { key: k === 'space' ? ' ' : k, target: {}, preventDefault() {} }); },
    tap(k: string) { keys.down(k); H.tick(1 / 60); keys.up(k); },
  };
  /** Runs a world: scene.json entities (an object by id) and optional config and scripts. */
  function run(entities: Record<string, any>, o: { config?: any; scripts?: Record<string, string>; mode?: string } = {}) {
    const ents: Record<string, any> = {};
    for (const [id, e] of Object.entries(entities)) ents[id] = { id, ...e };
    const scene = { config: { look: false, sky: false, shadows: false, ...(o.config || {}) }, entities: ents };
    H.run({ title: 'test', files: { 'scene.json': JSON.stringify(scene), ...(o.scripts || {}) }, assets: {} }, { mode: o.mode || 'play', loop: false });
    return H.world;
  }
  loaded = { H, B, run, keys, errors, tick: (s: number) => H.tick(s) };
  return loaded;
}
