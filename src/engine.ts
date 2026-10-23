// The game engine's manifest (public/play): which scripts a game loads and in what order, the kinds of things scenes
// may hold, and the assistant's docs (WORLD.md, API.md), each assembled from one section per module.
//   - core: public/play/engine.json (Babylon, Havok, the core scripts, the core kinds)
//   - modules: public/play/modules/<name>/module.json, one folder per module, found by looking (nobody edits a shared
//     list to add one): { "title", "order": 50, "scripts": ["x.js"], "editor": [], "kinds": ["car"] }
//   - docs: public/play/docs/{world,api}/NN-name.md and public/play/modules/<name>/docs/{world,api}/NN-name.md, sorted by
//     file name (the NN puts a section where it belongs)
// Everything is read fresh (with a short cache), so a module added or a doc changed shows without a restart.
// docs/engine-modules.md is the guide for writing a module.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.ts';

export const PLAY_DIR = path.join(ROOT, 'public', 'play');
const MODULES_DIR = path.join(PLAY_DIR, 'modules');

export type EngineModule = { name: string; title: string; order: number; scripts: string[]; editor: string[]; kinds: string[]; dir: string };
export type Manifest = {
  /** One cache-busting version for every engine file: a hash of their contents. */
  version: string;
  babylon: string[];
  havok: string;
  /** Script URLs in load order (core, then modules by order and name), each with ?v=version. */
  scripts: string[];
  /** The editor's in-world tools (loaded only in the editor's sandbox), with ?v=version. */
  editor: string[];
  kinds: string[];
  modules: { name: string; title: string; kinds: string[] }[];
};

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const SAFE = /^[a-z0-9][a-z0-9_-]*$/;
const SAFE_FILE = /^[a-z0-9][a-z0-9_.\/-]*\.js$/i;

/** The modules in public/play/modules (bad or half-written ones are skipped, never fatal). */
export function engineModules(): EngineModule[] {
  if (!fs.existsSync(MODULES_DIR)) return [];
  const out: EngineModule[] = [];
  for (const name of fs.readdirSync(MODULES_DIR).sort()) {
    if (!SAFE.test(name)) continue;
    const dir = path.join(MODULES_DIR, name);
    const file = path.join(dir, 'module.json');
    if (!fs.existsSync(file)) continue;
    try {
      const m = readJson(file);
      const scripts = list(m.scripts).filter((s) => SAFE_FILE.test(s) && !s.includes('..') && fs.existsSync(path.join(dir, s)));
      const editor = list(m.editor).filter((s) => SAFE_FILE.test(s) && !s.includes('..') && fs.existsSync(path.join(dir, s)));
      out.push({ name, title: String(m.title || name), order: Number(m.order) || 50, scripts, editor, kinds: list(m.kinds), dir });
    } catch { /* a broken module.json: left out */ }
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

let cache: { at: number; m: Manifest } | null = null;
/** The manifest, cached for two seconds. */
export function manifest(): Manifest {
  if (cache && Date.now() - cache.at < 2000) return cache.m;
  const core = readJson(path.join(PLAY_DIR, 'engine.json'));
  const mods = engineModules();
  const files = [
    ...list(core.core).map((f) => ({ url: `/play/${f}`, file: path.join(PLAY_DIR, f), editor: false })),
    ...mods.flatMap((m) => m.scripts.map((f) => ({ url: `/play/modules/${m.name}/${f}`, file: path.join(m.dir, f), editor: false }))),
    ...list(core.editor).map((f) => ({ url: `/play/${f}`, file: path.join(PLAY_DIR, f), editor: true })),
    ...mods.flatMap((m) => m.editor.map((f) => ({ url: `/play/modules/${m.name}/${f}`, file: path.join(m.dir, f), editor: true }))),
  ];
  const h = crypto.createHash('sha1');
  for (const f of files) { h.update(f.url); try { h.update(fs.readFileSync(f.file)); } catch {} }
  const version = h.digest('hex').slice(0, 10);
  const kinds = [...new Set([...list(core.kinds), ...mods.flatMap((m) => m.kinds)])];
  const m: Manifest = {
    version,
    babylon: list(core.babylon),
    havok: String(core.havok || ''),
    scripts: files.filter((f) => !f.editor).map((f) => `${f.url}?v=${version}`),
    editor: files.filter((f) => f.editor).map((f) => `${f.url}?v=${version}`),
    kinds,
    modules: mods.map((x) => ({ name: x.name, title: x.title, kinds: x.kinds })),
  };
  cache = { at: Date.now(), m };
  return m;
}

/** Every kind of thing a scene may hold: the core's and every module's. */
export const engineKinds = () => manifest().kinds;

/** WORLD.md or API.md: every section, core and modules, sorted by file name (NN-name.md). Read fresh each time. */
export function engineDoc(which: 'world' | 'api'): string {
  const sections: { key: string; file: string }[] = [];
  const add = (dir: string, owner: string) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (/\.md$/i.test(f)) sections.push({ key: `${f}\u0000${owner}`, file: path.join(dir, f) });
  };
  add(path.join(PLAY_DIR, 'docs', which), '');
  for (const m of engineModules()) add(path.join(m.dir, 'docs', which), m.name);
  sections.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return sections.map((s) => fs.readFileSync(s.file, 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n') + '\n';
}

/** /play/modules.js: the manifest and the loader (public/play/loader.js) in one small script, never cached long. */
export function loaderScript(): string {
  return `window.HawkesModules = ${JSON.stringify(manifest())};\n${fs.readFileSync(path.join(PLAY_DIR, 'loader.js'), 'utf8')}`;
}
