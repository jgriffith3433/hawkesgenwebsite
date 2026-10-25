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
    hairs: ['short', 'long', 'ponytail', 'curly', 'spiky', 'bun'],
    maxExtras: 3,
    // Body shapes: [width, height, depth] of the body, times normal.
    sizes: { normal: [1, 1, 1], tall: [0.92, 1.18, 0.92], short: [1.08, 0.82, 1.05], wide: [1.32, 0.98, 1.2], tiny: [0.72, 0.7, 0.72], big: [1.25, 1.22, 1.2] },
    palette: ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316', '#22d3ee', '#ec4899', '#f5f5f4', '#1f2937', '#84cc16', '#8b5cf6'],
    hairColors: ['#2b1d14', '#4a3322', '#8a5a2b', '#d9a441', '#c2410c', '#1f2937', '#e5e7eb', '#a855f7'],
    skins: ['#f2c9a0', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#ffdbac', '#9ad0ff', '#b4f8c8'],
  };

  // What you are (the mirror's first question: modules/mirror). Each: its word, an icon, a group, the body it's drawn
  // with (`body`: 'person', a Living species, or a thing in presence-bodies.js), its height in meters, its own colors
  // [body, accent, detail] and what the Overseer says when you pick it. Keep the ids in step with src/presence.ts.
  const WHATS = [
    { id: 'person', label: 'A person', icon: '🧍', group: 'people', body: 'person', h: 1.8, colors: ['#4a9eff', '#ffffff', '#f2c9a0'], line: 'A person. Classic. Nobody will suspect a thing.' },
    { id: 'robot', label: 'A robot', icon: '🤖', group: 'people', body: 'robot', h: 1.8, colors: ['#aab4c3', '#3ee6ff', '#c9d2df'], line: 'A robot. Beep. I will assume that means hello.' },
    { id: 'tvbot', label: 'A TV robot', icon: '📺', group: 'people', body: 'tvbot', h: 1.75, colors: ['#3a3f4b', '#7dd3fc', '#e5e7eb'], line: 'A television with legs. Finally, something worth watching.' },
    { id: 'rollbot', label: 'A roll-bot', icon: '🔵', group: 'people', body: 'rollbot', h: 1.35, colors: ['#f4c430', '#22d3ee', '#3a3f4b'], line: 'A ball with ambitions. Roll with it.' },
    { id: 'dog', label: 'A dog', icon: '🐶', group: 'animals', body: 'dog', h: 0.95, colors: ['#c98f4f', '#3a2a1c', '#c98f4f'], line: 'Who is a good dog? You are. Obviously.' },
    { id: 'cat', label: 'A cat', icon: '🐱', group: 'animals', body: 'cat', h: 0.8, colors: ['#5d5d66', '#f2f2f2', '#5d5d66'], line: 'A cat. You were going to ignore me anyway.' },
    { id: 'fox', label: 'A fox', icon: '🦊', group: 'animals', body: 'wolf', h: 1, colors: ['#e2742b', '#f7f1e6', '#e2742b'], line: 'A fox. Clever. Suspiciously clever.' },
    { id: 'pig', label: 'A pig', icon: '🐷', group: 'animals', body: 'pig', h: 0.95, colors: ['#f2a7b0', '#c96f7c', '#f2a7b0'], line: 'A pig. Clean, clever, and deeply misunderstood.' },
    { id: 'bear', label: 'A bear', icon: '🐻', group: 'animals', body: 'bear', h: 1.4, colors: ['#5a3a24', '#2a1a12', '#5a3a24'], line: 'A bear. Please do not eat Pip.' },
    { id: 'rabbit', label: 'A bunny', icon: '🐰', group: 'animals', body: 'rabbit', h: 0.8, colors: ['#c8b6a0', '#ffffff', '#c8b6a0'], line: 'A bunny. Hop responsibly.' },
    { id: 'penguin', label: 'A penguin', icon: '🐧', group: 'animals', body: 'penguin', h: 1.1, colors: ['#1e2430', '#f4f4f4', '#1e2430'], line: 'A penguin. Dressed for a party that has not started yet.' },
    { id: 'chicken', label: 'A chicken', icon: '🐔', group: 'animals', body: 'chicken', h: 0.9, colors: ['#f6f1e6', '#d62f2f', '#f6f1e6'], line: 'A chicken. Brave of you, all things considered.' },
    { id: 'cow', label: 'A cow', icon: '🐮', group: 'animals', body: 'cow', h: 1.5, colors: ['#f2efe8', '#2a2522', '#f2efe8'], line: 'A cow. Moo is a complete sentence.' },
    { id: 'sheep', label: 'A sheep', icon: '🐑', group: 'animals', body: 'sheep', h: 1.1, colors: ['#efe9da', '#3b332d', '#3b332d'], line: 'A sheep. Fluffy, and following no one.' },
    { id: 'horse', label: 'A horse', icon: '🐴', group: 'animals', body: 'horse', h: 1.8, colors: ['#8a5a36', '#2a1d14', '#8a5a36'], line: 'A horse. Neigh-ver change.' },
    { id: 'dinosaur', label: 'A dinosaur', icon: '🦖', group: 'animals', body: 'dinosaur', h: 1.9, colors: ['#4d7a3a', '#e9d8a6', '#4d7a3a'], line: 'A dinosaur. Extinction was only ever a rumor.' },
    { id: 'fish', label: 'A fish', icon: '🐟', group: 'animals', body: 'fish', h: 0.9, colors: ['#f08a2c', '#ffffff', '#f08a2c'], line: 'A fish. On land. Bold. Very bold.' },
    { id: 'shoe', label: 'A shoe', icon: '👟', group: 'things', body: 'shoe', h: 0.95, colors: ['#ef4444', '#f5f5f5', '#1f2937'], line: 'A shoe. Bold. The universe has never seen a shoe with ambition.' },
    { id: 'toaster', label: 'A toaster', icon: '🍞', group: 'things', body: 'toaster', h: 1.15, colors: ['#b8bfcc', '#d9a35f', '#2b2f3a'], line: 'A toaster. Warm, reliable, and never allowed near the bath.' },
    { id: 'cactus', label: 'A cactus', icon: '🌵', group: 'things', body: 'cactus', h: 1.7, colors: ['#3f9a4a', '#f472b6', '#c2703d'], line: 'A cactus. Hugs are off the table, then.' },
    { id: 'cone', label: 'A traffic cone', icon: '🚧', group: 'things', body: 'cone', h: 1.4, colors: ['#f97316', '#f5f5f5', '#1f2937'], line: 'A traffic cone. You will direct traffic. Or stand there. Either way.' },
    { id: 'teapot', label: 'A teapot', icon: '🫖', group: 'things', body: 'teapot', h: 1.05, colors: ['#e9e4d8', '#4a9eff', '#b07a45'], line: 'A teapot. Short and stout, I am told.' },
    { id: 'banana', label: 'A banana', icon: '🍌', group: 'things', body: 'banana', h: 1.6, colors: ['#f4d03f', '#5b4636', '#8a6d1f'], line: 'A banana. Please, nobody slip.' },
    { id: 'mushroom', label: 'A mushroom', icon: '🍄', group: 'things', body: 'mushroom', h: 1.35, colors: ['#e04f5f', '#ffffff', '#f2e6d0'], line: 'A mushroom. A fun guy, I hear.' },
    { id: 'potato', label: 'A potato', icon: '🥔', group: 'things', body: 'potato', h: 1, colors: ['#b98a52', '#7a5a34', '#f2e6d0'], line: 'A potato. Humble. Versatile. Mashed, eventually.' },
    { id: 'duck', label: 'A rubber duck', icon: '🦆', group: 'things', body: 'duck', h: 0.95, colors: ['#facc15', '#f97316', '#111827'], line: 'A rubber duck. Squeak with purpose.' },
  ];
  const WHAT = new Map(WHATS.map((w) => [w.id, w]));
  LOOK.whats = WHATS.map((w) => w.id);
  const NAME_MAX = 24;
  /** A character's name as it will show: one line, no markup or control characters, at most NAME_MAX ('' if none). */
  const cleanName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '');
  const HEX = /^#[0-9a-f]{6}$/i;
  /** A look anyone sent, made safe: anything unknown becomes the default (never throws: it's for drawing). */
  function cleanLook(v) {
    const a = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const color = (c, d) => (typeof c === 'string' && HEX.test(c) ? c.toLowerCase() : d);
    const one = (x, list, d) => (list.includes(x) ? x : d);
    const extras = Array.isArray(a.extras) ? [...new Set(a.extras.filter((x) => LOOK.extras.includes(x)))].slice(0, LOOK.maxExtras) : [];
    return {
      body: color(a.body, '#4a9eff'), head: color(a.head, '#f2c9a0'), accent: color(a.accent, '#ffffff'),
      shape: one(a.shape, LOOK.shapes, 'normal'), hat: one(a.hat, LOOK.hats, 'none'), face: one(a.face, LOOK.faces, 'eyes'),
      extras, model: typeof a.model === 'string' && /^a_[0-9a-f]{6,40}$/.test(a.model) ? a.model : null,
      what: WHAT.has(a.what) ? a.what : 'person', name: cleanName(a.name) || null,
      // The person's hair and outfit (body is the top): the clothes' bottom and shoes, the hair's style and color.
      hair: one(a.hair, LOOK.hairs, 'short'), hairColor: color(a.hairColor, '#4a3322'), bottom: color(a.bottom, '#3b4a6b'), shoes: color(a.shoes, '#f2f2ee'),
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
    const look = { body, head: pick(LOOK.skins), accent, shape: pick(['normal', 'normal', 'tall', 'short', 'wide', 'tiny', 'big']), hat: pick(LOOK.hats.filter((h) => h !== 'halo' && h !== 'crown')), face: pick(['eyes', 'smile', 'eyes']), extras };
    // (picked last, so the same seed still gives the same body, hat and face as before)
    const bottom = pick(LOOK.palette);
    return cleanLook({ ...look, hair: pick(LOOK.hairs), hairColor: pick(LOOK.hairColors), bottom: bottom === body ? '#3b4a6b' : bottom, shoes: pick(['#f2f2ee', '#1f2937', '#ef4444', '#fbbf24']) });
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

  // ------------------------------------------------------------------ the palette (docs/characters.md 1): every tone from one pick
  const hsl = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, sat = 0;
    if (d > 1e-6) {
      sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, sat, l];
  };
  const hexOf = (h, sat, l) => {
    h = ((h % 360) + 360) % 360; sat = Math.max(0, Math.min(1, sat)); l = Math.max(0, Math.min(1, l));
    const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  };
  /** Turn `hex`'s hue toward `target` degrees by `deg` (the short way round). */
  const turn = (h, target, deg) => { let d = ((target - h + 540) % 360) - 180; return h + Math.max(-deg, Math.min(deg, d)); };
  const mixHex = (a, b, k) => { const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16); const m = (s) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k); return '#' + [16, 8, 0].map((s) => m(s).toString(16).padStart(2, '0')).join(''); };
  const EYE = '#fbfbf6', INK = '#14161d';
  /** The tones of one color: base (the pick), shade (18% darker, 8 degrees toward blue: undersides, legs), light (10% lighter,
   *  6 degrees toward yellow: the top), rim (the light's color, 70% over base, for the fresnel edge). */
  function tones(hex) {
    const [h, s, l] = hsl(hex);
    const shade = hexOf(turn(h, 220, 8), s, l - 0.18), light = hexOf(turn(h, 55, 6), s, l + 0.10);
    return { base: hex, shade, light, rim: mixHex(hex, '#fff6e0', 0.7) };
  }
  /** Every color a body uses, from its look: the doc's `base shade light rim eye ink cheek` for the body color, and the same
   *  tones for the person's `top`, `bottom`, `shoes`, `skin` and `hair`. Parts take their color from here, never a literal. */
  function palette(look) {
    const l = cleanLook(look);
    const t = tones(l.body);
    const [ah, as, al] = hsl(l.accent === '#ffffff' ? '#f4a3b5' : l.accent);
    return { ...t, accent: l.accent, eye: EYE, ink: INK, cheek: mixHex(hexOf(ah, as, al), '#ff9fb2', 0.45), top: t, bottom: tones(l.bottom), shoes: tones(l.shoes), skin: tones(l.head), hair: tones(l.hairColor) };
  }

  // ------------------------------------------------------------------ expressions: five numbers (docs/characters.md 1)
  // open and smile (-1..1) and width of the mouth, raise and tilt of the brows (tilt > 0: inner ends down, angry; < 0: sad), lid: how
  // closed the eyes rest (0..1).
  const EXPRESSIONS = {
    neutral: { open: 0, smile: 0.15, width: 1, raise: 0, tilt: 0, lid: 0 },
    happy: { open: 0.25, smile: 1, width: 1.25, raise: 0.35, tilt: 0, lid: 0.12 },
    surprised: { open: 0.9, smile: 0, width: 0.55, raise: 1, tilt: 0, lid: 0 },
    sad: { open: 0, smile: -0.8, width: 0.85, raise: 0.25, tilt: -1, lid: 0.2 },
    angry: { open: 0.1, smile: -0.5, width: 1, raise: -0.6, tilt: 1, lid: 0.25 },
    sleepy: { open: 0, smile: 0.1, width: 0.8, raise: -0.25, tilt: 0, lid: 0.55 },
    mischief: { open: 0.1, smile: 0.75, width: 1.1, raise: 0.25, tilt: 0.55, lid: 0.18 },
  };
  /** The expression an emote or a pose shows ('' when it leaves the face alone). */
  const EMOTE_FACE = { wave: 'happy', dance: 'happy', cheer: 'happy', laugh: 'happy', point: 'mischief', sit: 'neutral', sleep: 'sleepy', clap: 'happy', thumbsup: 'mischief', heart: 'happy' };
  const POSE_FACE = { jump: 'surprised', fall: 'surprised', swim: 'happy', drive: 'neutral', run: 'neutral' };

  P.core = { palette, tones, hsl, hexOf, mixHex, EXPRESSIONS, EMOTE_FACE, POSE_FACE, LOOK, WHATS, WHAT, cleanName, NAME_MAX, cleanLook, randomLook, seedOf, EMOTES, emote, TAGS, layoutTags, BUBBLES, bubbleSeconds, wrap, bubbles, CHAT, cleanLine, limiter };
})();
