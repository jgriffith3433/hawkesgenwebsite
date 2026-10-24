// Presence, the plain logic (no Babylon, no page): looks, emotes, which name tags show and how big, speech bubbles,
// the chat's limits. presence.js draws it and presence-ui.js is the player's side; the engine tests check this part
// directly (H.presence.core).
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const P = (H.presence = H.presence || {});

  // ------------------------------------------------------------------ looks (keep in step with src/presence.ts AVATAR)
  const LOOK = {
    maxBytes: 1024,
    shapes: ['normal', 'tall', 'short', 'wide', 'tiny', 'big'],
    hats: ['none', 'cap', 'beanie', 'tophat', 'crown', 'cowboy', 'party', 'halo', 'horns', 'bunny', 'helmet', 'chef'],
    extras: ['glasses', 'shades', 'scarf', 'backpack', 'cape', 'bowtie', 'wings', 'tail'],
    faces: ['visor', 'eyes', 'smile', 'none'],
    maxExtras: 3,
    // Body shapes: [width, height, depth] of the body, times normal.
    sizes: { normal: [1, 1, 1], tall: [0.92, 1.18, 0.92], short: [1.08, 0.82, 1.05], wide: [1.32, 0.98, 1.2], tiny: [0.72, 0.7, 0.72], big: [1.25, 1.22, 1.2] },
    palette: ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316', '#22d3ee', '#ec4899', '#f5f5f4', '#1f2937', '#84cc16', '#8b5cf6'],
    skins: ['#f2c9a0', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac', '#9ad0ff', '#b4f8c8'],
  };
  const HEX = /^#[0-9a-f]{6}$/i;
  /** A look anyone sent, made safe: anything unknown becomes the default (never throws: it's for drawing). */
  function cleanLook(v) {
    const a = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const color = (c, d) => (typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : d);
    const one = (x, list, d) => (list.includes(x) ? x : d);
    const extras = Array.isArray(a.extras) ? [...new Set(a.extras.filter((x) => LOOK.extras.includes(x)))].slice(0, LOOK.maxExtras) : [];
    return {
      body: color(a.body, '#4a9eff'), head: color(a.head, '#f2c9a0'), accent: color(a.accent, '#ffffff'),
      shape: one(a.shape, LOOK.shapes, 'normal'), hat: one(a.hat, LOOK.hats, 'none'), face: one(a.face, LOOK.faces, 'visor'),
      extras, model: typeof a.model === 'string' && /^a_[0-9a-f]{6,40}$/.test(a.model) ? a.model : null,
    };
  }
  /** A random fun look (guests get one): the same seed gives the same look. */
  function randomLook(seed) {
    let s = (Number(seed) >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
    const r = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const pick = (list) => list[Math.floor(r() * list.length)];
    const extras = [];
    const n = r() < 0.5 ? 1 : r() < 0.6 ? 0 : 2;
    while (extras.length < n) { const x = pick(LOOK.extras); if (!extras.includes(x)) extras.push(x); }
    let accent = pick(LOOK.palette);
    const body = pick(LOOK.palette);
    if (accent === body) accent = '#ffffff';
    return cleanLook({ body, head: pick(LOOK.skins), accent, shape: pick(['normal', 'normal', 'tall', 'short', 'wide', 'tiny', 'big']), hat: pick(LOOK.hats.filter((h) => h !== 'halo' && h !== 'crown')), face: pick(['visor', 'eyes', 'smile']), extras });
  }
  const seedOf = (str) => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ------------------------------------------------------------------ emotes
  // loop: keeps going until you move (sit, sleep); seconds otherwise. clip: the animation a model avatar plays.
  const EMOTES = [
    { name: 'wave', icon: '👋', label: 'Wave', seconds: 2.6 },
    { name: 'dance', icon: '💃', label: 'Dance', seconds: 6 },
    { name: 'cheer', icon: '🙌', label: 'Cheer', seconds: 2.6 },
    { name: 'laugh', icon: '😂', label: 'Laugh', seconds: 2.6 },
    { name: 'point', icon: '👉', label: 'Point', seconds: 2.4 },
    { name: 'sit', icon: '🪑', label: 'Sit', loop: true },
    { name: 'sleep', icon: '😴', label: 'Sleep', loop: true },
    { name: 'clap', icon: '👏', label: 'Clap', seconds: 2.6 },
    { name: 'thumbsup', icon: '👍', label: 'Thumbs up', seconds: 2.2 },
    { name: 'heart', icon: '❤️', label: 'Heart', seconds: 2.6 },
  ];
  const ALIASES = { hi: 'wave', hello: 'wave', bye: 'wave', yay: 'cheer', lol: 'laugh', haha: 'laugh', love: 'heart', like: 'thumbsup', thumbs: 'thumbsup', 'thumbs up': 'thumbsup', applaud: 'clap', nap: 'sleep', zzz: 'sleep', party: 'dance', boogie: 'dance' };
  const emote = (name) => { const n = String(name || '').toLowerCase().trim(); const k = ALIASES[n] || n.replace(/[\s_-]+/g, ''); return EMOTES.find((e) => e.name === k) || null; };

  // ------------------------------------------------------------------ name tags: which show, how big, how clear
  const TAGS = {
    max: 10, maxPhone: 6,        // how many at once (nearest first)
    distance: 70,                // players' tags fade out by here (meters)
    npcDistance: 28,             // NPCs, pets and AI friends: closer
    near: 4, far: 40,            // full size at `near`, smallest at `far`
    minScale: 0.55, maxScale: 1.15,
    colors: { me: '#ffffff', player: '#ffffff', friend: '#7dd3fc', ai: '#c4b5fd', npc: '#fde68a', pet: '#fbcfe8', thing: '#ffffff' },
  };
  /**
   * Which tags show this frame. cands: [{ id, kind, distance, onScreen, priority? }]; o: { max, distance, npcDistance,
   * size }. Returns [{ id, scale, opacity }], nearest first, at most max. Players and friends come before NPCs when
   * there are too many; tags fade over the last 30% of their distance.
   */
  function layoutTags(cands, o = {}) {
    const max = Math.max(0, Number(o.max ?? TAGS.max));
    const size = Number(o.size) || 1;
    const out = [];
    for (const c of cands) {
      if (!c || !c.onScreen || !(c.distance >= 0)) continue;
      const people = c.kind === 'player' || c.kind === 'friend' || c.kind === 'me';
      const range = Number(c.range) || (people ? Number(o.distance ?? TAGS.distance) : Number(o.npcDistance ?? TAGS.npcDistance));
      if (c.distance > range) continue;
      const fadeFrom = range * 0.7;
      const opacity = c.distance <= fadeFrom ? 1 : Math.max(0, 1 - (c.distance - fadeFrom) / (range - fadeFrom));
      if (opacity <= 0.02) continue;
      const t = Math.min(1, Math.max(0, (c.distance - TAGS.near) / (TAGS.far - TAGS.near)));
      const scale = (TAGS.maxScale + (TAGS.minScale - TAGS.maxScale) * t) * size;
      // Friends first, then players, then everyone else; nearest first within each.
      const rank = (c.priority ?? 0) + (c.kind === 'friend' ? 0 : people ? 1 : c.kind === 'ai' ? 2 : 3) * 10000;
      out.push({ id: c.id, kind: c.kind, scale, opacity, distance: c.distance, rank: rank + c.distance });
    }
    out.sort((a, b) => a.rank - b.rank);
    const shown = out.slice(0, max);
    shown.sort((a, b) => a.distance - b.distance);
    return shown;
  }

  // ------------------------------------------------------------------ speech bubbles
  const BUBBLES = { stack: 3, maxChars: 140, lineChars: 28 };
  /** Seconds a line stays up: longer lines stay longer (3 to 9). */
  const bubbleSeconds = (text) => Math.min(9, Math.max(3, 2.2 + String(text).length / 14));
  /** Lines of at most `width` characters, broken at spaces (long words are cut). */
  function wrap(text, width = BUBBLES.lineChars) {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let line = '';
    for (let w of words) {
      while (w.length > width) { if (line) { lines.push(line); line = ''; } lines.push(w.slice(0, width)); w = w.slice(width); }
      if (!line) line = w; else if (line.length + 1 + w.length <= width) line += ` ${w}`; else { lines.push(line); line = w; }
    }
    if (line) lines.push(line);
    return lines;
  }
  /** Everyone's bubbles: say(id, text, now) stacks a line over them, live(id, now) is what still shows (oldest first). */
  function bubbles() {
    const by = new Map();
    return {
      say(id, text, now, seconds) {
        const t = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, BUBBLES.maxChars);
        if (!t) return null;
        const list = (by.get(id) || []).filter((b) => b.until > now);
        const b = { text: t, lines: wrap(t), at: now, until: now + (Number(seconds) || bubbleSeconds(t)) * 1000 };
        list.push(b);
        while (list.length > BUBBLES.stack) list.shift();
        by.set(id, list);
        return b;
      },
      live(id, now) { const list = (by.get(id) || []).filter((b) => b.until > now); if (list.length) by.set(id, list); else by.delete(id); return list; },
      speaking(id, now) { return (by.get(id) || []).some((b) => b.until > now); },
      ids() { return [...by.keys()]; },
      clear(id) { if (id === undefined) by.clear(); else by.delete(id); },
    };
  }

  // ------------------------------------------------------------------ chat: what can be said, how often
  const CHAT = { maxChars: 160, burst: 5, window: 10000, gap: 600 };
  /** A line as it will be said (trimmed, one line, not too long) or '' if there's nothing to say. */
  const cleanLine = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT.maxChars);
  /** A limiter: ok(now) says whether one more line may go now (CHAT.burst per CHAT.window, CHAT.gap apart). */
  function limiter(o = CHAT) {
    const times = [];
    return {
      ok(now) {
        while (times.length && now - times[0] > o.window) times.shift();
        if (times.length >= o.burst || (times.length && now - times[times.length - 1] < o.gap)) return false;
        times.push(now);
        return true;
      },
    };
  }

  P.core = { LOOK, cleanLook, randomLook, seedOf, EMOTES, emote, TAGS, layoutTags, BUBBLES, bubbleSeconds, wrap, bubbles, CHAT, cleanLine, limiter };
})();
