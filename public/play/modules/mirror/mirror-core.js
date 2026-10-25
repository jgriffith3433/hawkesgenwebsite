// The mirror, the plain logic (no Babylon, no page): its questions and their order, a mirror's settings made safe,
// what the Overseer says at each step, names to suggest. mirror.js runs it (the room in front of the mirror, the
// questions on screen) and the engine tests check this part directly (H.mirror.core).
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const M = (H.mirror = H.mirror || {});

  // ------------------------------------------------------------------ the questions
  // what: what you are (presence-core.js WHATS); look: how you look (colors, size, hat, face, extras); name: what you
  // are called; view: how you see the world (first or third person, for this game).
  const STEPS = [
    { id: 'what', title: 'What are you?', say: 'First question. What are you?', voice: 'overseer-mirror-what.mp3' },
    { id: 'look', title: 'How do you look?', say: 'Now. How do you look?', voice: 'overseer-mirror-look.mp3' },
    { id: 'name', title: 'What are you called?', say: 'And what are you called?', voice: 'overseer-mirror-name.mp3' },
    { id: 'view', title: 'How do you see the world?', say: 'How will you see the world? Through your own eyes, or over your shoulder?', voice: 'overseer-mirror-view.mp3' },
  ];
  const STEP_IDS = STEPS.map((s) => s.id);
  const DEFAULT_STEPS = ['what', 'look', 'name'];
  const OPEN = { say: 'Before you go anywhere: look. That is you. For now.', voice: 'overseer-mirror-open.mp3' };
  const DONE = { voice: 'overseer-mirror-done.mp3' };
  const GROUPS = [['people', 'People & robots'], ['animals', 'Animals'], ['things', 'Things']];
  const STARTS = ['first', 'always'];

  /**
   * A mirror's settings (scene.json `shape.character`), made safe: `false` (or { off: true }) is a plain mirror; else
   * { steps (which questions, in this order), whats (who you can be: ids or groups; [] for everyone), start (false,
   * "first": opens by itself the first time a player arrives, "always": every time), voice (the Overseer narrates),
   * reach (meters: how close E works) }.
   */
  function cleanConfig(v) {
    if (v === false || (v && v.off === true)) return { off: true, steps: [], whats: [], start: false, voice: false, reach: 0 };
    const a = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const steps = Array.isArray(a.steps) ? [...new Set(a.steps.filter((s) => STEP_IDS.includes(s)))] : DEFAULT_STEPS.slice();
    const known = new Set(whatsList().map((w) => w.id));
    const groups = new Set(GROUPS.map((g) => g[0]));
    const whats = Array.isArray(a.whats) ? [...new Set(a.whats.filter((x) => known.has(x) || groups.has(x)))] : [];
    const start = a.start === true ? 'first' : STARTS.includes(a.start) ? a.start : false;
    const reach = Number(a.reach);
    return { off: false, steps: steps.length ? steps : DEFAULT_STEPS.slice(), whats, start, voice: a.voice !== false, reach: reach > 0 ? Math.min(20, reach) : 3 };
  }

  const whatsList = () => ((H.presence && H.presence.core && H.presence.core.WHATS) || []);
  /** Who you can be at this mirror: every WHATS row its settings allow (ids, or whole groups), in the catalog's order. */
  function allowed(cfg) {
    const all = whatsList();
    if (!cfg || !cfg.whats || !cfg.whats.length) return all;
    const pick = new Set(cfg.whats);
    const list = all.filter((w) => pick.has(w.id) || pick.has(w.group));
    return list.length ? list : all;
  }

  // ------------------------------------------------------------------ names: something funny to start from
  const TITLES = ['Sir', 'Lady', 'Captain', 'Professor', 'Little', 'Big', 'Duke', 'Agent', 'Doctor', 'Mister', 'Madame', 'Lord', 'Baron', 'Chief', 'Sergeant', 'Auntie', 'Uncle', 'Grand'];
  const NOUNS = {
    person: ['Dave', 'Pat', 'Morgan', 'Sam', 'Robin', 'Alex'], robot: ['Bleep', 'Unit 7', 'Sprocket', 'Bolts', 'Gizmo'], tvbot: ['Static', 'Channel Nine', 'Remote', 'Rerun'],
    rollbot: ['Rolly', 'Bearing', 'Spin', 'Marble'], dog: ['Biscuit', 'Waffles', 'Barkley', 'Noodle'], cat: ['Whiskers', 'Mittens', 'Purrington', 'Socks'],
    fox: ['Rusty', 'Sly', 'Ember', 'Tod'], pig: ['Truffles', 'Oinkers', 'Bacon-Not', 'Porkington'], bear: ['Grizz', 'Honeypaws', 'Bruno', 'Fuzzy'],
    rabbit: ['Hopscotch', 'Thumper', 'Clover', 'Carrots'], penguin: ['Waddles', 'Tux', 'Pebble', 'Flipper'], chicken: ['Nugget', 'Clucky', 'Henrietta', 'Drumstick'],
    cow: ['Moolinda', 'Daisy', 'Milkshake', 'Bessie'], sheep: ['Woolly', 'Fluff', 'Baarbara', 'Shaun'], horse: ['Hayseed', 'Gallop', 'Trotsky', 'Neighsayer'],
    dinosaur: ['Rex', 'Chompers', 'Stompy', 'Tiny'], fish: ['Bubbles', 'Finn', 'Gills', 'Splash'], shoe: ['Laces', 'Sole', 'Sneakerton', 'Kicks', 'Tongue'],
    toaster: ['Crumbs', 'Toastworth', 'Burnt Ends', 'Pop'], cactus: ['Prickles', 'Spike', 'Needles', 'Huggy'], cone: ['Pylon', 'Detour', 'Orange', 'Stripes'],
    teapot: ['Earl Grey', 'Steamy', 'Spout', 'Chamomile'], banana: ['Peely', 'Bunch', 'Split', 'Slippy'], mushroom: ['Shroom', 'Spore', 'Morel', 'Button'],
    potato: ['Spud', 'Tater', 'Mash', 'Chip'], duck: ['Squeaky', 'Quackers', 'Bath Time', 'Ducky'],
  };
  const PLAIN = ['Wobbles', 'Pickles', 'Zigzag', 'Muffin', 'Noodle', 'Biscuit', 'Sprocket', 'Pebble', 'Gravy', 'Jellybean'];
  /** A name to suggest for `what` (rnd: a 0-1 random function, Math.random by default). */
  function suggestName(what, rnd = Math.random) {
    const pick = (list) => list[Math.floor(rnd() * list.length) % list.length];
    const nouns = NOUNS[what] || PLAIN;
    const w = (whatsList().find((x) => x.id === what) || { label: 'Thing' }).label.replace(/^(a|an) /i, '');
    const r = rnd();
    const name = r < 0.45 ? `${pick(TITLES)} ${pick(nouns)}` : r < 0.75 ? `${pick(nouns)} the ${cap(w)}` : r < 0.9 ? `${pick(nouns)} ${pick(PLAIN)}` : pick(nouns);
    return name.slice(0, (H.presence && H.presence.core && H.presence.core.NAME_MAX) || 24);
  }
  const cap = (s) => String(s).replace(/\b\w/g, (c) => c.toUpperCase());

  /** What the Overseer says when you're done ({name} the {what}). */
  function doneLine(look) {
    const w = whatsList().find((x) => x.id === (look && look.what)) || null;
    const thing = w ? w.label.replace(/^(a|an) /i, '').toLowerCase() : 'one of a kind';
    const name = look && look.name;
    return name ? `${name} the ${thing}. I will remember that. Go on, then.` : `A ${thing} with no name. Mysterious. Go on, then.`;
  }

  // ------------------------------------------------------------------ "How do you look?": surprise me and the preview carousel
  // Every part of a look the look step changes (not what you are, your name or a 3D model).
  const LOOK_PARTS = ['body', 'accent', 'head', 'shape', 'hat', 'extras', 'face', 'hair', 'hairColor', 'bottom', 'shoes', 'eyeColor', 'accessory', 'accessoryColor'];
  const PREVIEWS = 8;
  /** A random look for `what` as the parts setLook takes (a person's skin stays a skin tone, a thing's detail color its accent). seed: same seed, same look. */
  function surprise(what, seed) {
    const C = H.presence.core;
    const r = C.randomLook(seed);
    const w = C.WHAT.get(what) || C.WHAT.get('person');
    const part = {};
    for (const k of LOOK_PARTS) part[k] = r[k];
    if (w.body !== 'person') part.head = r.accent;
    return part;
  }
  /** The carousel: `n` different surprises (each with a different accessory while there are accessories to show). */
  function previews(what, seed, n = PREVIEWS) {
    const base = (Number(seed) >>> 0) || ((Math.random() * 2 ** 32) >>> 0);
    const out = [];
    const seen = new Set();
    for (let i = 0; out.length < n && i < n * 6; i++) {
      const p = surprise(what, base + i * 7919);
      if (seen.has(p.accessory) && seen.size < H.presence.core.LOOK.accessories.length - 1) continue;
      seen.add(p.accessory);
      out.push(p);
    }
    return out;
  }

  M.core = { LOOK_PARTS, PREVIEWS, surprise, previews, STEPS, STEP_IDS, DEFAULT_STEPS, OPEN, DONE, GROUPS, STARTS, cleanConfig, allowed, suggestName, doneLine, NOUNS };
})();
