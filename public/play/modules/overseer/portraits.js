// Painted cast portraits beside captions (Hades-like): one look for dialogue, journal, loading and the store.
// Data: /play/art/cast.json. H.portraits resolves who → color + image; chat.js and finale.js draw them.
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.portraits) return;

  const FALLBACK_COLORS = {
    overseer: '#9fd0ff', pip: '#f472b6', bobbin: '#facc15', ember: '#fb923c',
    rolo: '#22d3ee', dolores: '#4ade80', channel: '#7dd3fc',
  };
  const FALLBACK_ALIAS = {
    'the overseer': 'overseer', 'admiral bobbin': 'bobbin', 'mrs ember': 'ember',
  };
  let data = null;
  let loading = null;

  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch('/play/art/cast.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { data = j || { colors: FALLBACK_COLORS, aliases: FALLBACK_ALIAS, portraits: {}, keyArt: {} }; return data; })
      .catch(() => { data = { colors: FALLBACK_COLORS, aliases: FALLBACK_ALIAS, portraits: {}, keyArt: {} }; return data; });
    return loading;
  }
  load();

  function keyOf(who) {
    const raw = String(who || '').trim().toLowerCase();
    if (!raw) return '';
    const alias = (data && data.aliases) || FALLBACK_ALIAS;
    if (alias[raw]) return alias[raw];
    if (FALLBACK_COLORS[raw] || (data && data.portraits && data.portraits[raw])) return raw;
    // "Admiral Bobbin" / first word when it matches a cast id
    const first = raw.split(/\s+/)[0];
    if (FALLBACK_COLORS[first] || (data && data.portraits && data.portraits[first])) return first;
    return raw;
  }

  function color(who) {
    const id = keyOf(who);
    const colors = (data && data.colors) || FALLBACK_COLORS;
    return colors[id] || FALLBACK_COLORS[id] || null;
  }

  /** Portrait URL for a speaker. mood: 'neutral' | 'emotion' | a named emotion key. */
  function url(who, mood) {
    const id = keyOf(who);
    const row = data && data.portraits && data.portraits[id];
    if (!row) return null;
    if (mood === 'emotion' || (mood && mood !== 'neutral' && row[mood])) {
      return row.emotion || row[mood] || row.neutral || null;
    }
    return row.neutral || row.emotion || null;
  }

  function keyArt(kind) {
    const k = (data && data.keyArt) || {};
    if (kind === 'tall' || kind === '2x3') return k.tall || null;
    if (kind === 'square' || kind === '1x1') return k.square || null;
    return k.wide || k.loading || null;
  }

  /** Attach a painted portrait to a caption element (chat line or finale band). 72 px on a phone. */
  function attach(el, who, { mood, color: col } = {}) {
    if (!el || !who) return null;
    const id = keyOf(who);
    if (!id || id === 'you' || id === 'sys') return null;
    const src = url(who, mood || 'neutral');
    const c = col || color(who);
    let img = el.querySelector && el.querySelector('.hc-port');
    if (!src) {
      if (img) img.remove();
      return null;
    }
    if (!img) {
      img = document.createElement('img');
      img.className = 'hc-port';
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'lazy';
      img.draggable = false;
      img.onerror = () => { img.remove(); };
      el.insertBefore(img, el.firstChild);
    }
    if (img.getAttribute('src') !== src) img.src = src;
    img.dataset.cast = id;
    if (c) {
      img.style.boxShadow = `0 0 0 2px ${c}`;
      el.style.setProperty('--hc-cast', c);
    }
    return img;
  }

  H.portraits = { load, keyOf, color, url, keyArt, attach, ready: () => Boolean(data) };
  window.__castArt = H.portraits;
})();
