// H.assets (and game.assets): a game's assets by id, with words as labels. A game can hold seven cows (from the
// community library, made by Gen, uploaded); each has an id (a_...), a name (cow.glb, cow-2.glb), a type (model, image,
// sound, video), a title and words ("cow", "spotted cow"). config.assets in scene.json is the world's own choice and
// order per word: { "cow": { "ids": ["a_1", "a_2"], "mix": true } } (the first is the default; mix spreads them).
//
//   H.assets.get(ref) / url(ref) / has(ref)   ref: an id or a name
//   H.assets.for('cow', { kind: 'model' })     ids in order: config.assets.cow, then assets labelled cow (plurals and
//                                              other words for it too), then names (cow.glb, cow-2.glb)
//   H.assets.pick('cow', { seed, kind })       the one for this thing: the same every time for the same seed (an
//                                              entity's id), spread over the variants when the word mixes
//
// Modules never build file names: they ask for a word. docs/engine-modules.md ("Assets by id").
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const L = H.lib;

  // ------------------------------------------------------------------ words (the same rules as src/words.ts)
  const IRREGULAR = { mice: 'mouse', geese: 'goose', people: 'person', children: 'child', men: 'man', women: 'woman', teeth: 'tooth', feet: 'foot', wolves: 'wolf', knives: 'knife', leaves: 'leaf', shelves: 'shelf', loaves: 'loaf', halves: 'half', calves: 'calf', dice: 'die', oxen: 'ox', cacti: 'cactus', fungi: 'fungus' };
  const SAME = new Set(['sheep', 'fish', 'deer', 'moose', 'series', 'species', 'grass', 'glass', 'gas', 'bus', 'chess', 'moss', 'dress', 'cross', 'boss', 'mass', 'news', 'lens', 'physics', 'mayhem']);
  function singular(w) {
    const s = String(w || '').toLowerCase();
    if (s.length < 4 || SAME.has(s)) return s;
    if (IRREGULAR[s]) return IRREGULAR[s];
    if (/ies$/.test(s)) return s.slice(0, -3) + 'y';
    if (/(ss|x|ch|sh|zz)es$/.test(s)) return s.slice(0, -2);
    if (/oes$/.test(s)) return s.slice(0, -2);
    if (/[^su]s$/.test(s)) return s.slice(0, -1);
    return s;
  }
  const norm = (w) => String(w || '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').trim().split(/\s+/).map(singular).join(' ');
  // Other words for the same thing: modules add theirs (Living things: puppy -> dog, t-rex -> dinosaur).
  const synonyms = new Map();
  /** Says that `word` also means `means` ("puppy" -> "dog"): H.assets.for('puppy') finds the dogs. */
  function synonym(word, means) { const a = norm(word), b = norm(means); if (a && b && a !== b) { if (!synonyms.has(a)) synonyms.set(a, new Set()); synonyms.get(a).add(b); } }
  function wordsFor(word) {
    const w = norm(word);
    const out = [w];
    for (const s of synonyms.get(w) || []) if (!out.includes(s)) out.push(s);
    return out;
  }

  // ------------------------------------------------------------------ the game's assets
  const TYPES = { model: 'model', mesh: 'model', glb: 'model', image: 'image', texture: 'image', sprite: 'image', sky: 'image', picture: 'image', sound: 'sound', sfx: 'sound', audio: 'sound', voice: 'sound', music: 'sound', ambience: 'sound', video: 'video', show: 'video', clip: 'video' };
  const EXT = { model: ['glb'], image: ['png', 'jpg', 'webp'], sound: ['mp3', 'ogg', 'wav', 'm4a'], video: ['mp4', 'webm'] };
  const typeOfMime = (m) => { const s = String(m || ''); return /gltf|glb/.test(s) ? 'model' : s.startsWith('image/') ? 'image' : s.startsWith('audio/') ? 'sound' : s.startsWith('video/') ? 'video' : null; };
  const typeOfName = (n) => { const x = (/\.([a-z0-9]+)$/i.exec(n) || [])[1]; if (!x) return null; for (const [t, xs] of Object.entries(EXT)) if (xs.includes(x.toLowerCase())) return t; return null; };
  let cache = null, cacheOf = null;
  /** Every asset of the game: [{ id, name, url, mime, type, title, words }] (low-detail copies left out). */
  function list() {
    const assets = (H.bundle && H.bundle.assets) || {};
    if (cacheOf === assets && cache) return cache;
    cache = Object.entries(assets).filter(([n]) => !/_low\.glb$/i.test(n)).map(([name, a]) => {
      const words = Array.isArray(a.words) && a.words.length ? a.words.map(norm) : [norm(name.replace(/-\d+(\.[a-z0-9]+)$/i, '$1'))];
      return { id: a.id || null, name, url: a.url, mime: a.mime || null, type: a.type || typeOfMime(a.mime) || typeOfName(name), kind: a.kind || null, title: a.title || null, words };
    });
    cacheOf = assets;
    return cache;
  }
  /** One asset by id or name (or null): { id, name, url, mime, type, title, words }. */
  function get(ref) {
    if (ref === undefined || ref === null || ref === '') return null;
    const r = String(ref).replace(/^asset:/, '');
    return list().find((a) => a.id === r || a.name === r) || (L.assetEntry(r) ? { ...L.assetEntry(r), words: [] } : null);
  }
  const keyOf = (a) => a.id || a.name;
  const config = () => { try { const c = L.effectiveConfig(); return (c && c.assets && typeof c.assets === 'object') ? c.assets : {}; } catch { return {}; } };
  const typeWanted = (o) => (o && o.kind ? TYPES[String(o.kind).toLowerCase()] || String(o.kind).toLowerCase() : null);
  /** The world's own entry for a word (config.assets), by the word or another word for it. */
  function chosen(word) {
    const c = config();
    for (const w of wordsFor(word)) for (const [k, v] of Object.entries(c)) if (norm(k) === w && v) return Array.isArray(v) ? { ids: v } : typeof v === 'string' ? { ids: [v] } : v;
    return null;
  }
  /** The assets for a word, in order (their ids, or names for assets without one): the world's choice
   *  (config.assets[word].ids), then every asset labelled with the word (or a plural, or another word for it), then
   *  names ("cow.glb", "cow-2.glb"). o.kind: model, image (texture, sprite, sky), sound (sfx, music, voice), video. */
  function forWord(word, o = {}) {
    if (!word) return [];
    const want = typeWanted(o);
    const ok = (a) => a && (!want || a.type === want);
    const out = [];
    const add = (a) => { if (ok(a) && !out.includes(keyOf(a))) out.push(keyOf(a)); };
    const c = chosen(word);
    for (const ref of (c && Array.isArray(c.ids) ? c.ids : [])) add(get(ref));
    if (c && c.only) return out;
    const ws = wordsFor(word);
    const all = list();
    // Labelled: the asset's own words first (an exact word), oldest first by name (cow.glb before cow-2.glb).
    for (const w of ws) for (const a of all) if (a.words.includes(w)) add(a);
    // By name: word.ext, word-2.ext... (games from before ids).
    const raw = String(word).toLowerCase().trim();
    for (const w of [raw, ...ws]) for (const x of (want ? EXT[want] || [] : Object.values(EXT).flat())) {
      add(get(`${w}.${x}`));
      for (let i = 2; i < 10; i++) { const a = get(`${w}-${i}.${x}`); if (!a) break; add(a); }
    }
    return out;
  }
  function hash(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  /** Which asset a thing of this word uses (an id, or a name; null when the game has none): the world's default, or,
   *  when the word mixes (config.assets[word].mix), one of the variants picked by o.seed (an entity's id: the same
   *  thing gets the same one every time). */
  function pick(word, o = {}) {
    const ids = forWord(word, o);
    if (!ids.length) return null;
    const c = chosen(word);
    const mix = o.mix ?? (c ? Boolean(c.mix) : false);
    if (!mix || ids.length === 1) return ids[0];
    const pool = c && Array.isArray(c.ids) && c.ids.length > 1 ? ids.slice(0, c.ids.length) : ids;
    return pool[hash(o.seed ?? Math.random()) % pool.length];
  }
  /** Words and what they use: { cow: { ids: [...], mix, from: 'config' | 'words' } } (the editor's Library shows it). */
  function words() {
    const out = {};
    for (const [w, v] of Object.entries(config())) { const c = chosen(w); out[norm(w)] = { ids: forWord(w), chosen: c && Array.isArray(c.ids) ? c.ids.map((r) => idOfRef(r)) : [], mix: Boolean(v && v.mix), from: 'config' }; }
    for (const a of list()) for (const w of a.words.slice(0, 3)) if (!out[w]) out[w] = { ids: forWord(w), chosen: [], mix: false, from: 'words' };
    return out;
  }

  const idOfRef = (ref) => { const a = get(ref); return a ? keyOf(a) : String(ref); };
  const api = {
    get, has: (ref) => Boolean(get(ref)), url: (ref) => { const a = get(ref); return a ? a.url : null; },
    for: forWord, pick, list, words, synonym, singular, norm,
    /** The id of a thing (an id stays itself; a name becomes its asset's id when it has one). */
    idOf: (ref) => { const a = get(ref); return a ? keyOf(a) : null; },
  };
  H.assets = api;
  H.hooks.game.push((g) => { g.assets = api; });

  // config.assets changed ("use only the spotted cow", "mix in the brown ones"): the things that picked by word
  // (e._assetPick, set by the module that picked) are rebuilt, so the herd shows the new choice at once.
  let leaving = false;
  function rebuildPicked() {
    const w = H.world;
    if (!w || !w.started || leaving) return;
    cache = null;
    const ops = [];
    for (const e of w.entities) if (e._assetPick && e.sceneId && w.graph.entities[e.sceneId]) ops.push({ op: 'replace', entity: w.graph.entities[e.sceneId] });
    if (ops.length) H.applyOps(ops, { fx: 'arrive' });
  }
  H.features.register('assets', {
    codex: {
      title: 'Assets by word', group: 'World features',
      what: 'Which of the game\'s assets a word uses, in order: the first is the default; mix spreads the variants over many things (a herd of cows, a forest). Modules find assets by word themselves; this is the world\'s own choice.',
      value: { cow: { ids: ['a_1', 'a_2'], mix: true } },
      fields: [['<word>.ids', 'asset ids (a_...) or names, in order', ''], ['<word>.mix', 'true: spread them over many things', 'false'], ['<word>.only', 'true: never other assets with the word', 'false']],
    },
    apply() { rebuildPicked(); },
    change() { rebuildPicked(); },
    dispose() { rebuildPicked(); },
  });
  H.hooks.world.push({ enter() { leaving = false; }, leave() { leaving = true; cache = null; } });
})();
