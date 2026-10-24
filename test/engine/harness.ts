// The engine in Node, for tests: Babylon's NullEngine (no GPU, no browser), Havok's wasm, and the very files a game
// page loads (the manifest from src/engine.ts, in order), over a small stand-in for the page (document, canvas, input).
// load() gives back window.HawkesPlay; world(scene) runs a scene.json; H.tick(seconds) steps it.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------------------ a page, just enough of one
class Style { [k: string]: any; setProperty(k: string, v: string) { this[k] = v; } removeProperty(k: string) { delete this[k]; } }
class ClassList { s = new Set<string>(); add(...c: string[]) { c.forEach((x) => this.s.add(x)); } remove(...c: string[]) { c.forEach((x) => this.s.delete(x)); } toggle(c: string, on?: boolean) { const v = on ?? !this.s.has(c); if (v) this.s.add(c); else this.s.delete(c); return v; } contains(c: string) { return this.s.has(c); } }
const ctx2d = new Proxy({}, {
  get(_, k) {
    if (k === 'measureText') return (t: string) => ({ width: String(t).length * 30 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    if (k === 'getImageData') return (x: number, y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)) });
    if (k === 'canvas') return { width: 64, height: 64 };
    return () => {};
  },
  set() { return true; },
});
class El {
  tagName: string; children: El[] = []; style = new Style(); classList = new ClassList(); dataset: Record<string, string> = {};
  attributes: Record<string, string> = {}; parentNode: El | null = null; hidden = false; textContent = ''; value = ''; id = '';
  width = 300; height = 150; listeners: Record<string, Function[]> = {};
  private _html = '';
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get innerHTML() { return this._html; } set innerHTML(v: string) { this._html = v; this.children = []; }
  get firstChild() { return this.children[0] ?? null; }
  get isConnected() { return true; }
  get className() { return [...this.classList.s].join(' '); } set className(v: string) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  appendChild(c: El) { this.children.push(c); c.parentNode = this; if (c.tagName === 'SCRIPT' && (c as any).onload) setTimeout(() => (c as any).onload(), 0); return c; }
  insertAdjacentHTML() {} prepend() {} append() {}
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); }
  addEventListener(t: string, f: Function) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t: string, f: Function) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); }
  dispatch(t: string, e: any) { for (const f of this.listeners[t] || []) f(e); }
  setAttribute(k: string, v: string) { this.attributes[k] = v; } getAttribute(k: string) { return this.attributes[k] ?? null; } removeAttribute(k: string) { delete this.attributes[k]; }
  querySelector() { return new El('div'); } querySelectorAll() { return [] as El[]; } closest() { return null; } contains() { return false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
  getContext() { return ctx2d; }
  setPointerCapture() {} releasePointerCapture() {} focus() {} blur() {} requestPointerLock() {}
  get clientWidth() { return 800; } get clientHeight() { return 600; }
  get offsetWidth() { return 300; } get offsetHeight() { return 200; }
  toDataURL() { return 'data:,'; }
}

function installPage(anyId = false) {
  const g = globalThis as any;
  const byId: Record<string, El> = {};
  for (const id of ['stage', 'ui', 'error', 'loading']) { byId[id] = new El(id === 'stage' ? 'canvas' : 'div'); byId[id].id = id; }
  const body = new El('body'), head = new El('head');
  const document = {
    body, head, documentElement: new El('html'), hidden: false, pointerLockElement: null, currentScript: null, title: '',
    getElementById: (id: string) => byId[id] || (anyId ? (byId[id] = Object.assign(new El('div'), { id })) : null),
    createElement: (tag: string) => new El(tag),
    createElementNS: (_: string, tag: string) => new El(tag),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}, exitPointerLock() {},
  };
  g.window = g;
  g.document = document;
  g.self = g;
  try { Object.defineProperty(g, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0, vibrate() {} }, configurable: true }); } catch {}
  g.location = { search: '?touch=0', protocol: 'http:', host: 'localhost', pathname: '/play/_test', origin: 'http://localhost', href: 'http://localhost/play/_test' };
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.addEventListener = () => {}; g.removeEventListener = () => {};
  g.devicePixelRatio = 1; g.innerWidth = 800; g.innerHeight = 600;
  g.HTMLElement = El; g.HTMLCanvasElement = El; g.Image = class { onload: any; set src(_: string) {} };
  g.requestAnimationFrame = (f: Function) => setTimeout(() => f(performance.now()), 16);
  g.cancelAnimationFrame = (t: any) => clearTimeout(t);
  g.parent = g;
  g.postMessage = () => {};
  g.Worker = undefined;
  return byId;
}

export type Engine = any;
let loaded: Engine | null = null;

/** Loads the engine once (Havok, Babylon, the page, every engine script and module) and returns HawkesPlay. */
/** o.anyId: every element id exists (for the editor's build.js, whose HUD is made from HTML this page can't parse). */
export async function load(o: { extra?: string[]; anyId?: boolean } = {}): Promise<Engine> {
  if (loaded) return loaded;
  // Havok first, before there is a "window" (it would think it's in a browser and fetch its wasm).
  const havokFactory = require('@babylonjs/havok');
  const wasmBinary = fs.readFileSync(path.join(ROOT, 'node_modules', '@babylonjs', 'havok', 'lib', 'umd', 'HavokPhysics.wasm'));
  const hk = await havokFactory({ wasmBinary });
  const g = globalThis as any;
  g.BABYLON = require('babylonjs');
  installPage(Boolean(o.anyId));
  g.HavokPhysics = () => Promise.resolve(hk);
  g.HawkesEngineFactory = () => new g.BABYLON.NullEngine({ renderWidth: 800, renderHeight: 600, textureSize: 64, deterministicLockstep: false, lockstepMaxSteps: 1 });
  g.BABYLON.Logger.LogLevels = 0;
  const { manifest } = await import('../../src/engine.ts');
  const files = manifest().scripts.map((u: string) => path.join(ROOT, 'public', u.replace(/\?.*$/, '')));
  for (const f of [...files, ...(o.extra ?? [])]) vm.runInThisContext(fs.readFileSync(f, 'utf8'), { filename: f });
  await g.HawkesPlay.ready;
  loaded = g.HawkesPlay;
  return loaded;
}

/** Runs a world: a scene.json object (and optional scripts) as a game, in play mode (or build), without a render loop. */
export function world(H: Engine, scene: any, o: { scripts?: Record<string, string>; mode?: 'play' | 'build'; game?: any } = {}) {
  const files: Record<string, string> = { 'scene.json': JSON.stringify(scene), ...(o.scripts ?? {}) };
  if (o.game) files['game.json'] = JSON.stringify(o.game);
  H.run({ title: 'test', files, assets: {} }, { mode: o.mode ?? 'play', loop: false });
  return H.world;
}

export const sceneOf = (entities: Record<string, any>, config: Record<string, any> = {}) => ({ config: { look: false, shadows: false, ...config }, entities: Object.fromEntries(Object.entries(entities).map(([id, e]) => [id, { id, ...e }])) });
