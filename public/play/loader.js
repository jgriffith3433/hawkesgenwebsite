// The engine's loader. The server serves it as /play/modules.js, right after `window.HawkesModules = <manifest>`
// (src/engine.ts): every page that runs the engine includes only that one script and then calls
//   HawkesModules.load('play', { bundle })  Babylon, Havok, the core scripts and the modules this game uses, in order.
//                                            bundle: the game (or a promise of it, fetched meanwhile); without one,
//                                            every module loads now
//   HawkesModules.load('editor')            everything, and the editor's in-world tools
//   HawkesModules.ensure(name or kind)      a module now (a promise): a spawn wheel offering a car before Vehicles came
// Both loads return a promise that resolves once the scripts ran and the engine is ready (physics included).
//
// Loading speed: the big files (Babylon, Havok's wasm) start downloading the moment this script runs, side by side.
// Modules marked "lazy" in their module.json load only when the game uses them (its scene's kinds and config, the
// tools it hands out, the words its scripts use: needs(bundle)); the rest come a moment after the world is playable,
// and things of their kinds that were waiting (stand-ins) are rebuilt then. docs/engine-modules.md ("Loading").
/* global HawkesModules */
(function () {
  'use strict';
  const M = window.HawkesModules;
  const done = new Map();
  const doc = typeof document !== 'undefined' ? document : null;
  function script(src) {
    if (done.has(src)) return done.get(src);
    prog.total++; tick();
    const p = new Promise((resolve, reject) => {
      const s = doc.createElement('script');
      s.src = src;
      s.async = false; // scripts added this way still run in the order they were added
      s.onload = () => { prog.done++; tick(); resolve(); };
      s.onerror = () => reject(new Error(`Could not load ${src.replace(/\?.*$/, '')}`));
      doc.head.appendChild(s);
    });
    done.set(src, p);
    return p;
  }
  const all = (list) => Promise.all(list.map(script));
  // Real progress for the loading screen (play.html): scripts and the game's own fetch, counted as they start and finish.
  const prog = M.progress = { done: 0, total: 0 };
  const tick = () => { try { if (typeof M.onprogress === 'function') M.onprogress(prog.done, prog.total); } catch { /* a screen never breaks loading */ } };

  // The big downloads start now, in parallel with the page's own work (the guest page, the bundle's fetch).
  function preload(href, as, cors) {
    if (!doc || !doc.head || !href || done.has(`preload:${href}`)) return;
    done.set(`preload:${href}`, true);
    try { const l = doc.createElement('link'); l.rel = 'preload'; l.as = as; l.href = href; if (cors) l.crossOrigin = 'anonymous'; doc.head.appendChild(l); } catch { /* old browsers: they load it when asked */ }
  }
  if (!window.BABYLON) for (const u of M.babylon || []) preload(u, 'script');
  if (M.havok && typeof window.HavokPhysics !== 'function') { preload(M.havok, 'script'); preload(M.havok.replace(/[^/]*$/, 'HavokPhysics.wasm'), 'fetch', true); }

  // ------------------------------------------------------------------ which modules a game needs
  const mods = () => (M.modules || []).filter((m) => m.lazy);
  const words = (s) => String(s || '');
  /** The lazy modules a game uses: from its scene (kinds, config keys, tool pickups), game.json, its scripts' words. */
  M.needs = function (bundle) {
    const lazy = mods();
    if (!lazy.length) return [];
    if (!bundle || !bundle.files) return lazy.map((m) => m.name);
    const files = bundle.files;
    let scene = {}, game = {};
    try { scene = JSON.parse(files['scene.json'] || '{}') || {}; } catch { scene = {}; }
    try { game = JSON.parse(files['game.json'] || '{}') || {}; } catch { game = {}; }
    const kinds = new Set(), keys = new Set(), tools = new Set();
    for (const e of Object.values(scene.entities || {})) {
      if (!e || typeof e !== 'object') continue;
      kinds.add(String(e.type || ''));
      if (e.shape && e.shape.tool) tools.add(String(e.shape.tool));
      if (e.shape && e.shape.kind) kinds.add(String(e.shape.kind));
    }
    const cfg = { ...(scene.config || {}), ...game };
    for (const k of Object.keys(cfg)) keys.add(k);
    const p = cfg.player && typeof cfg.player === 'object' ? cfg.player : {};
    for (const t of [].concat(p.tools || [], p.tool || [])) tools.add(String(t));
    const code = Object.entries(files).filter(([n]) => /\.js$/i.test(n)).map(([, v]) => words(v)).join('\n');
    const said = (w) => new RegExp(`(['"\`.])${String(w).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\b`).test(code);
    const out = new Set();
    for (const m of lazy) {
      const hit = (m.kinds || []).some((k) => kinds.has(k) || said(k)) || (m.config || []).some((k) => keys.has(k) || said(k)) || (m.tools || []).some((t) => tools.has(t) || said(t)) || (m.words || []).some(said);
      if (hit) out.add(m.name);
    }
    // A needed module's own needs come along.
    for (let more = true; more;) { more = false; for (const m of lazy) if (out.has(m.name)) for (const n of m.needs || []) if (!out.has(n) && lazy.some((x) => x.name === n)) { out.add(n); more = true; } }
    return lazy.map((m) => m.name).filter((n) => out.has(n));
  };

  // ------------------------------------------------------------------ late modules join the running world
  const loaded = new Set();
  /** Loads modules (by name) and, when a world is running, lets them join it: its scene and game hooks, the world's
   *  enter, and things of their kinds that were stand-ins are rebuilt. */
  function bring(names) {
    const H = window.HawkesPlay;
    const list = names.filter((n) => !loaded.has(n));
    if (!list.length) return Promise.resolve();
    for (const n of list) loaded.add(n);
    const hk = H && H.hooks;
    const before = hk ? { scene: hk.scene.length, game: hk.game.length, world: hk.world.length } : null;
    const urls = [];
    for (const n of list) { const m = (M.modules || []).find((x) => x.name === n); if (m) urls.push(...(m.scripts || [])); }
    return all(urls).then(() => {
      const w = H && H.world;
      if (!w || !w.started || !before) return;
      const report = (err) => { try { H.report(err); } catch { /* */ } };
      for (const f of hk.scene.slice(before.scene)) try { f(w.scene, w); } catch (err) { report(err); }
      for (const f of hk.game.slice(before.game)) try { f(H.game, w); } catch (err) { report(err); }
      for (const f of hk.world.slice(before.world)) try { if (f.enter) f.enter(w); } catch (err) { report(err); }
      const kinds = new Set(list.flatMap((n) => ((M.modules || []).find((x) => x.name === n) || {}).kinds || []));
      const ops = [];
      for (const spec of Object.values((w.graph && w.graph.entities) || {})) if (spec && kinds.has(spec.type)) ops.push({ op: 'replace', entity: spec });
      if (ops.length && H.applyOps) H.applyOps(ops);
    });
  }
  /** A module now, by its name or a kind (or tool) it brings. */
  M.ensure = function (what) {
    const w = String(what || '');
    const m = (M.modules || []).find((x) => x.name === w || (x.kinds || []).includes(w) || (x.tools || []).includes(w));
    return m && m.lazy ? bring([m.name]) : Promise.resolve();
  };
  /** The lazy modules not loaded yet, a moment after the world is playable (so nothing is missing for long). */
  function later() {
    const rest = mods().map((m) => m.name).filter((n) => !loaded.has(n));
    if (!rest.length) return;
    let tries = 0;
    // Once the world is drawing (some frames in, not while the first frames are still being made), when the page is idle.
    const go = () => {
      const H = window.HawkesPlay;
      const w = H && H.world;
      const frames = w && w.scene && w.scene.getEngine ? w.scene.getEngine().frameId : 0;
      if ((!w || !w.started || frames < 30) && tries++ < 240) return void setTimeout(go, 250);
      const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1));
      setTimeout(() => idle(() => bring(rest).catch((err) => console.warn('Hawkes Play: a module did not load', err)), { timeout: 3000 }), 500);
    };
    go();
  }

  M.load = function (which = 'play', o = {}) {
    if (which === 'editor') return M.load('play').then(() => all(M.editor)).then(() => window.HawkesPlay && window.HawkesPlay.ready);
    const babylon = window.BABYLON ? [] : M.babylon;
    const havok = typeof window.HavokPhysics === 'function' || !M.havok ? [] : [M.havok];
    const eager = M.eager || M.scripts;
    const base = all([...babylon, ...havok, ...eager]);
    if ('bundle' in o && o.bundle !== undefined) { prog.total++; tick(); Promise.resolve(o.bundle).then(() => { prog.done++; tick(); }, () => {}); }
    const want = 'bundle' in o && o.bundle !== undefined ? Promise.resolve(o.bundle).then((b) => M.needs(b), () => mods().map((m) => m.name)) : Promise.resolve(mods().map((m) => m.name));
    return want.then((names) => Promise.all([base, bring(names)])).then(() => { later(); return window.HawkesPlay && window.HawkesPlay.ready; });
  };
})();
