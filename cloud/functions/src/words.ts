// Words as labels for assets: "Spotted cows" -> ["spotted cow", "spotted", "cow"]. Lowercase, singular, a few per asset.
// The engine (public/play/assets.js) finds assets for a word by these (H.assets.for('cow')), so a game can hold seven
// cows from the community library and use them all. The same rules run there (keep the two in step).

const IRREGULAR: Record<string, string> = { mice: 'mouse', geese: 'goose', people: 'person', children: 'child', men: 'man', women: 'woman', teeth: 'tooth', feet: 'foot', wolves: 'wolf', knives: 'knife', leaves: 'leaf', shelves: 'shelf', loaves: 'loaf', halves: 'half', calves: 'calf', dice: 'die', oxen: 'ox', cacti: 'cactus', fungi: 'fungus' };
const SAME = new Set(['sheep', 'fish', 'deer', 'moose', 'series', 'species', 'grass', 'glass', 'gas', 'bus', 'chess', 'moss', 'dress', 'cross', 'boss', 'mass', 'news', 'lens', 'physics', 'mayhem']);
const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'for', 'in', 'on', 'to', 'low', 'high', 'lod', 'lod1', 'v1', 'v2', 'v3', 'copy', 'new', 'my', 'model', 'glb']);

/** One word in its singular ("cows" -> "cow", "ponies" -> "pony", "boxes" -> "box", "sheep" -> "sheep"). */
export function singular(w: string) {
  const s = String(w || '').toLowerCase();
  if (s.length < 4 || SAME.has(s)) return s;
  if (IRREGULAR[s]) return IRREGULAR[s];
  if (/ies$/.test(s)) return s.slice(0, -3) + 'y';
  if (/(ss|x|ch|sh|zz)es$/.test(s)) return s.slice(0, -2);
  if (/oes$/.test(s)) return s.slice(0, -2);
  if (/[^su]s$/.test(s)) return s.slice(0, -1);
  return s;
}

/** Labels from names, titles, categories and tags: each phrase (singular) and its words, without filler words. */
export function wordsOf(...texts: unknown[]): string[] {
  const out: string[] = [];
  const add = (w: string) => { if (w && w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w) && !out.includes(w)) out.push(w); };
  for (const t of texts.flat(3)) {
    if (t === null || t === undefined) continue;
    const phrase = String(t).toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[-_]\d+$/, '').replace(/_low$/, '').replace(/[^a-z0-9 _-]+/g, ' ').replace(/[_-]+/g, ' ').trim();
    if (!phrase) continue;
    const parts = phrase.split(/\s+/).filter((p) => p && !STOP.has(p)).map(singular);
    if (parts.length > 1 && parts.length <= 4) add(parts.join(' '));
    for (const p of parts) add(p);
  }
  return out.slice(0, 16);
}

/** The head word of a title ("Spotted brown cow" -> "cow"): what a thing is, for config.assets. */
export function headWord(...texts: unknown[]) {
  for (const t of texts) {
    const parts = String(t ?? '').toLowerCase().replace(/\.[a-z0-9]{2,4}$/, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((p) => p && !STOP.has(p) && !/^\d+$/.test(p));
    if (parts.length) return singular(parts[parts.length - 1]);
  }
  return null;
}
