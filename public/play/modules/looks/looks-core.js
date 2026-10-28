// Looks, the rules (no DOM, no Babylon; tests run them): a thing has a function (its kind: a truck drives, a chair seats)
// and a look (the model it wears). Changing the look keeps the function. looks.js is the chooser.
//   field(spec, kindDef)  where a thing's look lives: 'model' (shape.model: vehicles, creatures, furniture: the kinds that
//                         wear one), 'asset' (shape.asset: a model thing), or null (a plain shape: it becomes a model thing)
//   current(spec, f)      the look it wears now (an asset id or name), or null (its built-in body)
//   ops(spec, f, ref, o)  the world ops that put look `ref` on it (null: back to its built-in body), keeping what it does
//   words(spec)           what to search the library with first ("Blue truck" type truck -> "truck")
/* global HawkesPlay */
(function () {
  'use strict';
  const root = typeof window !== 'undefined' ? window : globalThis;
  const H = root.HawkesPlay || (root.HawkesPlay = {});
  const L = (H.looksCore = {});
  const PLAIN = new Set(['box', 'sphere', 'cylinder', 'cone', 'capsule', 'torus', 'plane']);

  L.field = (spec, def) => {
    if (!spec) return null;
    if (spec.type === 'model') return 'asset';
    const fields = (def && ((def.codex && def.codex.fields) || def.fields)) || [];
    if (fields.some((f) => f && f[0] === 'shape.model') || (spec.shape && typeof spec.shape.model === 'string')) return 'model';
    return PLAIN.has(spec.type) ? null : 'model';
  };
  L.current = (spec, f) => {
    const sh = (spec && spec.shape) || {};
    const v = f === 'asset' ? sh.asset : f === 'model' ? sh.model : null;
    return typeof v === 'string' && v ? v : null;
  };
  /** Can it go back to a built-in body (a kind that has one), or is a model all it is? */
  L.hasBuiltIn = (f) => f === 'model';

  /** The ops for look `ref` (an asset name or id; null: the built-in body). A plain shape becomes a model thing of its
   *  size, where it is, moving as it did: o.size (meters, its largest side) and o.keep (the spec's other fields). */
  L.ops = (spec, f, ref, o = {}) => {
    if (!spec || !spec.id) return [];
    if (f === 'model') return [{ op: 'update', id: spec.id, patch: { shape: { model: ref || null } } }];
    if (f === 'asset') return ref ? [{ op: 'update', id: spec.id, patch: { shape: { asset: ref } } }] : [];
    if (!ref) return [];
    const size = Math.max(0.3, Number(o.size) || 1);
    const { shape, material, ...rest } = spec;
    return [{ op: 'replace', entity: { ...rest, type: 'model', shape: { asset: ref, size: Math.round(size * 100) / 100 } } }];
  };

  /** What to search the library with first: the kind's word (a vehicle's type, a creature's species), then its name. */
  L.words = (spec) => {
    if (!spec) return '';
    const sh = spec.shape || {};
    const kind = sh.vehicle || sh.species || (PLAIN.has(spec.type) || spec.type === 'model' ? '' : spec.type);
    const name = String(spec.name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !COLORS.has(w));
    return [kind, ...name].filter(Boolean).filter((w, i, a) => a.indexOf(w) === i).slice(0, 3).join(' ');
  };
  const COLORS = new Set(['red', 'blue', 'green', 'yellow', 'black', 'white', 'pink', 'purple', 'orange', 'grey', 'gray', 'brown', 'gold', 'silver', 'big', 'small', 'tiny', 'huge', 'new', 'old', 'my', 'the']);

  if (typeof module !== 'undefined') module.exports = L;
})();
