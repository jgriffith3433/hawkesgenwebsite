// Before a deploy (firebase.json functions "predeploy"): the `api` function ships only cloud/functions, so what the games
// area reads from the rest of the repo is copied into cloud/functions/assets/ here (gitignored, made fresh each time):
//   assets/engine/manifest.json   the engine's manifest, as src/engine.ts builds it (core + modules, one version hash)
//   assets/engine/world.md, api.md  /play/WORLD.md and /play/API.md, assembled from every section (src/engine.ts engineDoc)
//   assets/engine/loader.js       public/play/loader.js (/play/modules.js is the manifest plus this)
//   assets/pages/play.html, closed.html   the play page and the closed-world page
//   assets/src/templates.ts, assets/src/overseer-games/*   the starter games as they are in src/ (pure: read at runtime)
//   assets/public/play/modules/terrain/terrain-core.js   what overseer-games/sandbox.ts runs to lay the island on its ground
//   assets/community/starter.mjs, restore.json   the starter pack (what /v1/community/health counts) and what may be remade
// Run it by hand before trying the function locally: node cloud/functions/tools/prebuild.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FUNCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(FUNCS, '..', '..');
const OUT = path.join(FUNCS, 'assets');
const PLAY = path.join(ROOT, 'public', 'play');
const MODULES = path.join(PLAY, 'modules');

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const SAFE = /^[a-z0-9][a-z0-9_-]*$/;
const SAFE_FILE = /^[a-z0-9][a-z0-9_.\/-]*\.js$/i;
const put = (rel, data) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const copy = (from, rel) => put(rel, fs.readFileSync(from));

// ------------------------------------------------------------------ the engine (the same rules as src/engine.ts)
function engineModules() {
  if (!fs.existsSync(MODULES)) return [];
  const out = [];
  for (const name of fs.readdirSync(MODULES).sort()) {
    if (!SAFE.test(name)) continue;
    const dir = path.join(MODULES, name);
    const file = path.join(dir, 'module.json');
    if (!fs.existsSync(file)) continue;
    try {
      const m = readJson(file);
      const scripts = list(m.scripts).filter((s) => SAFE_FILE.test(s) && !s.includes('..') && fs.existsSync(path.join(dir, s)));
      const editor = list(m.editor).filter((s) => SAFE_FILE.test(s) && !s.includes('..') && fs.existsSync(path.join(dir, s)));
      out.push({ name, title: String(m.title || name), order: Number(m.order) || 50, scripts, editor, kinds: list(m.kinds), dir, lazy: m.lazy === true, optional: m.optional === true, config: list(m.config), tools: list(m.tools), words: list(m.words), needs: list(m.needs) });
    } catch { /* a broken module.json: left out */ }
  }
  return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

function manifest() {
  const core = readJson(path.join(PLAY, 'engine.json'));
  const mods = engineModules();
  const files = [
    ...list(core.core).map((f) => ({ url: `/play/${f}`, file: path.join(PLAY, f), editor: false, lazy: null, optional: false })),
    ...mods.flatMap((m) => m.scripts.map((f) => ({ url: `/play/modules/${m.name}/${f}`, file: path.join(m.dir, f), editor: false, lazy: m.lazy ? m.name : null, optional: m.optional }))),
    ...list(core.editor).map((f) => ({ url: `/play/${f}`, file: path.join(PLAY, f), editor: true, lazy: null, optional: false })),
    ...mods.flatMap((m) => m.editor.map((f) => ({ url: `/play/modules/${m.name}/${f}`, file: path.join(m.dir, f), editor: true, lazy: null, optional: false }))),
  ];
  const h = crypto.createHash('sha1');
  for (const f of files) { h.update(f.url); try { h.update(fs.readFileSync(f.file)); } catch {} }
  try { h.update(fs.readFileSync(path.join(PLAY, 'guest.js'))); } catch {}
  const version = h.digest('hex').slice(0, 10);
  return {
    version,
    babylon: list(core.babylon),
    havok: String(core.havok || ''),
    scripts: files.filter((f) => !f.editor).map((f) => `${f.url}?v=${version}`),
    eager: files.filter((f) => !f.editor && !f.lazy).map((f) => `${f.url}?v=${version}`),
    optional: files.filter((f) => !f.editor && !f.lazy && f.optional).map((f) => `${f.url}?v=${version}`),
    editor: files.filter((f) => f.editor).map((f) => `${f.url}?v=${version}`),
    kinds: [...new Set([...list(core.kinds), ...mods.flatMap((m) => m.kinds)])],
    modules: mods.map((x) => ({ name: x.name, title: x.title, kinds: x.kinds, lazy: x.lazy, optional: x.optional, config: x.config, tools: x.tools, words: x.words, needs: x.needs, scripts: x.scripts.map((f) => `/play/modules/${x.name}/${f}?v=${version}`) })),
  };
}

function engineDoc(which) {
  const sections = [];
  const add = (dir, owner) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (/\.md$/i.test(f)) sections.push({ key: `${f}\u0000${owner}`, file: path.join(dir, f) });
  };
  add(path.join(PLAY, 'docs', which), '');
  for (const m of engineModules()) add(path.join(m.dir, 'docs', which), m.name);
  sections.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return sections.map((s) => fs.readFileSync(s.file, 'utf8').replace(/\r\n/g, '\n').trim()).join('\n\n') + '\n';
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
put('.gitignore', '*\n');
const m = manifest();
put('engine/manifest.json', JSON.stringify(m));
put('engine/world.md', engineDoc('world'));
put('engine/api.md', engineDoc('api'));
copy(path.join(PLAY, 'loader.js'), 'engine/loader.js');
copy(path.join(PLAY, 'play.html'), 'pages/play.html');
copy(path.join(ROOT, 'public', 'closed.html'), 'pages/closed.html');

// ------------------------------------------------------------------ the starter games (pure, as they are in src/)
copy(path.join(ROOT, 'src', 'templates.ts'), 'src/templates.ts');
for (const f of fs.readdirSync(path.join(ROOT, 'src', 'overseer-games'))) copy(path.join(ROOT, 'src', 'overseer-games', f), path.join('src', 'overseer-games', f));
copy(path.join(MODULES, 'terrain', 'terrain-core.js'), 'public/play/modules/terrain/terrain-core.js');

// ------------------------------------------------------------------ the community starter pack (pure) and its restore order
copy(path.join(ROOT, 'community', 'starter.mjs'), 'community/starter.mjs');
copy(path.join(ROOT, 'community', 'restore.json'), 'community/restore.json');

console.log(`[prebuild] cloud/functions/assets: engine ${m.version} (${m.kinds.length} kinds, ${m.modules.length} modules), play pages, starter games`);
