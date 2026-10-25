// The Overseer's memory (docs/story.md, "Returning"): it notes, it never watches. It keeps a small record of what happened
// in the game, and only in the game: the character's name and body, how many visits, the last thing done, a few counts
// (fish, things broken, things built, docks, flights, time at the wheel) and when it was last here. A return visit
// begins with a greeting picked from what is TRUE of that record (H.memory.greeting): never twice in a row, never a fact
// it does not hold (a player with nothing on record gets a plain warm greeting), never a word about anything outside
// the game.
//
// Kept in the account when signed in (GET/POST /v1/users/me/overseer: src/presence.ts), and on this device otherwise
// (localStorage "hg_overseer_memory"; the editor's page holds it for the sandboxed stage, as for the first-time lines);
// signing in merges the two (the newer record wins) and the guest sandbox's kept island carries on from it.
//
//   H.memory.get()            the record (a copy)
//   H.memory.greeting()       { id, text } for this visit, and remembers that it was said; null when this is not a return
//   H.memory.facts()          what the greeting may use: { visit, name, what, deed, gapMs, ... }
//   H.memory.begin()          reads the record, counts the visit, and asks H.lines to say 'return' (once, on entering a world)
//   H.memory.fishLog      the catch log (get(), set(fish, points)): kept with the rest, in the account when signed in
//   H.memory.core             the pure parts: VARIANTS, facts(), pick(), merge(), clean()
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.memory) return;
  const KEY = 'hg_overseer_memory';
  const GAP = 30 * 1000; // a page back within this long is the same visit (a reload), not a new one
  const SETTLE = 3; // seconds after a world starts before a deed counts (what loads with the world is not "done")
  const SAVE_EVERY = 20 * 1000;
  const DEEDS = ['fish', 'boom', 'build', 'dock', 'high', 'space', 'drive', 'ask', 'fall'];
  const COUNTS = ['fish', 'boom', 'build', 'dock', 'high', 'space', 'ask', 'fall'];
  const RECENT = 8;

  // ------------------------------------------------------------------ the record
  const blank = () => ({ v: 1, visits: 0, firstAt: 0, lastAt: 0, name: null, what: null, last: null, n: Object.fromEntries(COUNTS.map((k) => [k, 0])), driveS: 0, playS: 0, fish: {}, fishPts: 0, greet: { last: null, recent: [] } });
  const num = (x, max) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0; };
  // The catch log (water's fishing.js): species id -> [times caught, heaviest in grams/10 (kg x 100), longest in cm].
  const FISH_MAX = 48;
  function cleanFish(f) {
    const out = {};
    if (!f || typeof f !== 'object' || Array.isArray(f)) return out;
    for (const id of Object.keys(f)) {
      if (Object.keys(out).length >= FISH_MAX) break;
      const e = f[id];
      if (!/^[a-z0-9-]{1,32}$/.test(id) || !Array.isArray(e)) continue;
      const n = num(e[0], 100000);
      if (n) out[id] = [n, num(e[1], 1e7), num(e[2], 2000)];
    }
    return out;
  }
  /** Two catch logs of one player: each species keeps the larger count, heaviest and longest. */
  function mergeFish(a, b) {
    const out = cleanFish(a);
    const o = cleanFish(b);
    for (const id of Object.keys(o)) out[id] = out[id] ? [Math.max(out[id][0], o[id][0]), Math.max(out[id][1], o[id][1]), Math.max(out[id][2], o[id][2])] : o[id];
    return cleanFish(out);
  }
  /** Any record, cleaned: unknown keys dropped, every value checked. Keep in step with src/presence.ts cleanMemory. */
  function clean(v) {
    const out = blank();
    if (!v || typeof v !== 'object') return out;
    out.visits = num(v.visits, 100000);
    out.firstAt = num(v.firstAt, 4e12); out.lastAt = num(v.lastAt, 4e12);
    out.name = typeof v.name === 'string' ? v.name.replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24) || null : null;
    out.what = typeof v.what === 'string' && /^[a-z]{2,16}$/.test(v.what) ? v.what : null;
    if (v.last && typeof v.last === 'object' && DEEDS.includes(v.last.id)) out.last = { id: v.last.id, at: num(v.last.at, 4e12), visit: num(v.last.visit, 100000) };
    for (const k of COUNTS) out.n[k] = num(v.n && v.n[k], 100000);
    out.driveS = num(v.driveS, 1e8); out.playS = num(v.playS, 1e8);
    out.fish = cleanFish(v.fish); out.fishPts = num(v.fishPts, 1e9);
    const g = v.greet || {};
    out.greet.last = typeof g.last === 'string' && /^[a-z0-9-]{1,32}$/.test(g.last) ? g.last : null;
    out.greet.recent = Array.isArray(g.recent) ? g.recent.filter((x) => typeof x === 'string' && /^[a-z0-9-]{1,32}$/.test(x)).slice(-RECENT) : [];
    return out;
  }
  /** Two records of the same player (this device's and the account's): the one most recently seen wins whole. */
  function merge(a, b) {
    const fish = mergeFish(a && a.fish, b && b.fish), pts = Math.max(num(a && a.fishPts, 1e9), num(b && b.fishPts, 1e9));
    const whole = (r) => { const c = clean(r); c.fish = fish; c.fishPts = pts; return c; };
    if (!a || !a.visits) return b && b.visits ? whole(b) : whole(a);
    if (!b || !b.visits) return whole(a);
    return whole(b.lastAt > a.lastAt ? b : a);
  }

  // ------------------------------------------------------------------ words
  const BODY = { robot: 'a robot', tvbot: 'a television', rollbot: 'a roll-bot', dog: 'a dog', cat: 'a cat', fox: 'a fox', pig: 'a pig', bear: 'a bear', rabbit: 'a rabbit', penguin: 'a penguin', chicken: 'a chicken', cow: 'a cow', sheep: 'a sheep', horse: 'a horse', dinosaur: 'a dinosaur', fish: 'a fish', shoe: 'a shoe', toaster: 'a toaster', cactus: 'a cactus', cone: 'a traffic cone', teapot: 'a teapot', banana: 'a banana', mushroom: 'a mushroom', potato: 'a potato', duck: 'a rubber duck' };
  const ORD = { 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth', 10: 'tenth' };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function since(ms) {
    const min = ms / 60000, h = min / 60, d = h / 24;
    if (min < 2) return 'a moment';
    if (h < 1) return 'a little while';
    if (h < 2) return 'an hour';
    if (h < 24) return `${Math.floor(h)} hours`;
    if (d < 2) return 'a day';
    if (d < 7) return `${Math.floor(d)} days`;
    if (d < 14) return 'a week';
    if (d < 60) return `${Math.floor(d / 7)} weeks`;
    return 'a long while';
  }

  // ------------------------------------------------------------------ what is true: the facts a greeting may use
  /** Facts from the record as it stood when this visit began (`prior`), and the clock. Nothing here is guessed. */
  function facts(prior, now) {
    const p = prior || blank();
    const visit = (p.visits || 0) + 1;
    const seenBefore = p.visits > 0;
    // The last thing done counts only if it was in the visit before this one.
    const deed = seenBefore && p.last && p.last.visit === p.visits ? p.last.id : null;
    const gapMs = seenBefore && p.lastAt ? Math.max(0, now - p.lastAt) : 0;
    const n = p.n || {};
    const doneBefore = (k) => (n[k] || 0) > 0;
    return {
      visit, seenBefore, deed, gapMs, since: seenBefore ? since(gapMs) : null,
      name: p.name || null,
      what: p.what && BODY[p.what] ? BODY[p.what] : null,
      ord: ORD[visit] || null,
      // Remarkable: only said when the numbers are there (and only of what this record has seen).
      neverDocked: visit >= 3 && !doneBefore('dock') && !(H.lines && H.lines.seen && H.lines.seen('dock')),
      alwaysDrives: (p.driveS || 0) >= 240 && (p.driveS || 0) >= 0.6 * (p.playS || 1),
      breaksThings: (n.boom || 0) >= 10,
    };
  }

  // ------------------------------------------------------------------ the greetings
  // Calm, short, no exclamation marks, in the Overseer's voice (docs/story.md). {n} is the name, only in variants that
  // need one; every variant says what it needs (`need`) and is only a candidate when that is true. `tier` sets how
  // specific it is (4 the last thing done, 3 something remarkable, 2 the body or the count, 1 time, 0 plain).
  const V = (id, tier, need, say) => ({ id, tier, need, say });
  const named = (c) => Boolean(c.name);
  const deedPool = [];
  const D = (deed, a, b, c0) => {
    deedPool.push(V(`${deed}-a`, 4, (c) => c.deed === deed && named(c), (c) => a.replace('{n}', c.name)));
    deedPool.push(V(`${deed}-b`, 4, (c) => c.deed === deed && named(c), (c) => b.replace('{n}', c.name)));
    deedPool.push(V(`${deed}-c`, 4, (c) => c.deed === deed && !named(c), () => c0));
  };
  D('fish', '{n}. You caught a fish last time. The sea kept your place.', 'Welcome back, {n}. A fish, when you were last here. You waited well.', 'You are back. Last time the sea gave you a fish. It has more.');
  D('boom', '{n}. Last time something went up with a very large sound. I remember it fondly.', 'Welcome back, {n}. You broke something beautiful last time. There is more to break.', 'Back again. Last time you made a very large noise. The air has settled.');
  D('build', '{n}. Last time you made something and I sent it down. I liked its landing.', 'Hello again, {n}. You made something last time. I liked it.', 'Back again. Last time you made something new. There is room for another.');
  D('dock', '{n}. Last time you came all the way to the hangar. The door is still open.', 'Welcome back, {n}. You docked last time. The bay remembers the landing.', 'You are back. You found the hangar last time. It is still lit.');
  D('high', '{n}. Last time you went high enough to see your whole island. Welcome back down.', 'Hello again, {n}. You flew up, last time. The view was yours.', 'You are back. Last time you went up and looked down. Good.');
  D('space', '{n}. Last time you went above the air and saw the planet whole. Welcome back.', 'Welcome back, {n}. You were up in the quiet, last time. It is quiet here too.', 'You are back. Last time you reached the quiet above the air.');
  D('drive', '{n}. You were driving last time. The road is where you left it.', 'Welcome back, {n}. You took the wheel last time. The road remembers.', 'Back again. Last time you took the wheel. The road is waiting.');
  D('ask', '{n}. Last time you asked me for something. Thank you for asking.', 'Welcome back, {n}. You asked, last time. I like being asked.', 'Hello again. You asked me for something last time. Thank you for asking.');
  D('fall', '{n}. You took the long way down last time. The light is patient.', 'Welcome back, {n}. You fell last time, and came back. That is a fine habit.', 'Back again. Last time you fell and rose again. Mind the edge. Or don\'t.');

  const VARIANTS = [
    ...deedPool,
    // Something remarkable (needs enough visits or counts on record).
    V('undocked-a', 3, (c) => c.neverDocked && named(c), (c) => `${c.name}. There is a bay on my hull you have not seen. It stays lit.`),
    V('undocked-b', 3, (c) => c.neverDocked, (c) => `Your ${c.ord || 'latest'} visit, and the hangar has not seen you. Its door stays open.`),
    V('drives-a', 3, (c) => c.alwaysDrives && named(c), (c) => `${c.name}, you drive everywhere. The roads are pleased.`),
    V('drives-b', 3, (c) => c.alwaysDrives, () => 'You do like the wheel. The roads are pleased about it.'),
    V('breaks-a', 3, (c) => c.breaksThings && named(c), (c) => `${c.name}. You have broken a great many things. I keep sending more.`),
    V('breaks-b', 3, (c) => c.breaksThings, () => 'So many things broken, and still you come back. I admire it.'),
    // The body, the name, the count.
    V('body-a', 2, (c) => c.what && named(c), (c) => `Welcome back, ${c.name}. You came as ${c.what}, last time. I still smile at that.`),
    V('body-b', 2, (c) => c.what, (c) => `You came as ${c.what} last time. I am still pleased about that.`),
    V('body-c', 2, (c) => c.what && named(c), (c) => `${c.name}, ${c.what}. I have not forgotten.`),
    V('count-a', 2, (c) => c.ord && named(c), (c) => `This is your ${c.ord} visit, ${c.name}. The door was open.`),
    V('count-b', 2, (c) => c.ord, (c) => `Your ${c.ord} time here. The door was open.`),
    V('name-a', 2, (c) => named(c), (c) => `Hello again, ${c.name}. The sea kept your place.`),
    V('name-b', 2, (c) => named(c), (c) => `${c.name}. You came back. I am glad.`),
    V('name-c', 2, (c) => named(c), (c) => `Welcome back, ${c.name}. The sky is as it was.`),
    // Time.
    V('soon-a', 1, (c) => c.seenBefore && c.gapMs < 3600e3 && named(c), (c) => `Back so soon, ${c.name}. The light had not gone cold.`),
    V('soon-b', 1, (c) => c.seenBefore && c.gapMs < 3600e3, () => 'You were only just here. The light had not gone cold.'),
    V('time-a', 1, (c) => c.seenBefore && c.gapMs >= 20 * 3600e3 && named(c), (c) => `It has been ${c.since}, ${c.name}. The sea kept your place.`),
    V('time-b', 1, (c) => c.seenBefore && c.gapMs >= 20 * 3600e3, (c) => `It has been ${c.since}. The sea kept your place.`),
    V('long-a', 1, (c) => c.seenBefore && c.gapMs >= 14 * 24 * 3600e3 && named(c), (c) => `${cap(c.since)}, ${c.name}. I am glad you found the way back.`),
    V('long-b', 1, (c) => c.seenBefore && c.gapMs >= 14 * 24 * 3600e3, (c) => `${cap(c.since)}. I am glad you found the way back.`),
    // Plain and warm: true of anyone who came back, and nothing more.
    V('plain-a', 0, (c) => c.seenBefore, () => 'Hello again. The sea kept your place.'),
    V('plain-b', 0, (c) => c.seenBefore, () => 'You came back. I looked down first.'),
    V('plain-c', 0, (c) => c.seenBefore, () => 'There you are. Take your time.'),
    V('plain-d', 0, (c) => c.seenBefore, () => 'Hello. The door was open, and you found it.'),
    V('plain-e', 0, (c) => c.seenBefore, () => 'Good to see you again. The light is ready when you are.'),
    V('plain-f', 0, (c) => c.seenBefore, () => 'Welcome back. The sky is as it was.'),
    // Nothing on record at all: a welcome that claims nothing.
    V('new-a', 0, (c) => !c.seenBefore, () => 'Hello. I am glad you came.'),
    V('new-b', 0, (c) => !c.seenBefore, () => 'Welcome. Take your time.'),
    V('new-c', 0, (c) => !c.seenBefore, () => 'There you are. The light is ready when you are.'),
  ];
  const WEIGHT = { 4: 12, 3: 5, 2: 3, 1: 2, 0: 1 };

  /** The greeting for these facts: a candidate whose needs are true, never the last one said, rarely a recent one. */
  function pick(c, greet, rand) {
    const last = greet && greet.last;
    const recent = (greet && greet.recent) || [];
    // Straight after the visit before, the last thing done is the greeting (a second visit says what they did).
    const open = (v) => !(c.deed && c.visit < 3) || v.tier === 4;
    let pool = VARIANTS.filter((v) => v.need(c) && open(v));
    if (!pool.length) pool = VARIANTS.filter((v) => v.need(c));
    let fresh = pool.filter((v) => v.id !== last && !recent.includes(v.id));
    if (!fresh.length) fresh = pool.filter((v) => v.id !== last);
    if (!fresh.length) fresh = pool;
    const total = fresh.reduce((s, v) => s + WEIGHT[v.tier], 0);
    let r = rand() * total;
    let chosen = fresh[fresh.length - 1];
    for (const v of fresh) { r -= WEIGHT[v.tier]; if (r < 0) { chosen = v; break; } }
    return { id: chosen.id, text: chosen.say(c) };
  }

  // ------------------------------------------------------------------ where it is kept
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* a sandboxed page: the editor keeps it (below) */ } },
  };
  const memory = {
    now: () => Date.now(),
    rand: () => Math.random(),
    api: (route, body) => (H.presence && H.presence._api ? H.presence._api(route, body) : Promise.reject(new Error('no account'))),
  };
  let m = blank(); // the record, as it is now
  let prior = null; // as it stood when this visit began
  let ctx = null; // the facts for this visit's greeting
  let begun = false;
  let signedIn = false;
  let armed = false;
  let worldAt = 0;
  let lastSave = 0;
  let remoteTimer = null;

  function readLocal() {
    let r = null;
    try { r = JSON.parse(store.get(KEY) || 'null'); } catch { r = null; }
    const b = H.bundle && H.bundle.overseerMemory; // the editor's page holds it for the sandboxed stage
    return merge(clean(r), clean(b));
  }
  function save(remote = true) {
    lastSave = memory.now();
    store.set(KEY, JSON.stringify(m));
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ source: 'hawkes-play', type: 'overseer-memory', memory: m }, '*'); } catch { /* fine */ }
    if (H.bundle) H.bundle.overseerMemory = JSON.parse(JSON.stringify(m));
    if (remote && signedIn && !remoteTimer) {
      remoteTimer = setTimeout(() => { remoteTimer = null; memory.api('/v1/users/me/overseer', { overseer: m }).catch(() => { /* the device still has it */ }); }, 1500);
    }
  }
  function look() {
    const l = H.presence && H.presence.look;
    if (!l) return;
    const c = clean({ name: l.name, what: l.what });
    if (c.name) m.name = c.name;
    if (c.what) m.what = c.what;
  }

  // ------------------------------------------------------------------ a visit
  /** Reads the record (this device's and the account's), counts this visit, and asks for the greeting. Once. */
  async function begin(o) {
    if (begun && !(o && o.force)) return;
    begun = true;
    const local = readLocal();
    let remote = null;
    try { const j = await memory.api('/v1/users/me/overseer'); signedIn = true; remote = j && j.overseer ? clean(j.overseer) : null; } catch { signedIn = false; }
    m = merge(local, remote);
    const now = memory.now();
    const returning = m.visits > 0 && now - m.lastAt >= GAP;
    if (returning) {
      prior = JSON.parse(JSON.stringify(m));
      ctx = facts(prior, now);
      m.visits += 1;
    } else if (!m.visits) {
      prior = null; ctx = null;
      m.visits = 1; m.firstAt = now;
    } // else: the same visit, a page that came back at once (no new greeting)
    m.lastAt = now;
    look();
    save();
    if (returning && H.lines && H.lines.say) H.lines.say('return');
  }

  /** The greeting for this visit (and it is remembered as said): null when this is not a return. */
  function greeting() {
    if (!ctx) return null;
    const g = pick(ctx, m.greet, memory.rand);
    m.greet.last = g.id;
    m.greet.recent = [...m.greet.recent.filter((x) => x !== g.id), g.id].slice(-RECENT);
    ctx = null;
    save();
    return g;
  }

  // ------------------------------------------------------------------ what is noted
  function note(id, bump = true) {
    if (!begun || !armed || memory.now() - worldAt < SETTLE * 1000) return;
    if (bump && m.n[id] !== undefined) m.n[id] = Math.min(100000, m.n[id] + 1);
    m.last = { id, at: memory.now(), visit: m.visits };
    look();
    save();
  }
  let lastBoom = 0;
  let sampled = 0;
  let lastSpace = 0;
  let seated = false;
  H.hooks.frame.push(() => {
    const t = memory.now();
    if (!armed || t - sampled < 500) return;
    const dt = Math.min(2000, t - sampled);
    sampled = t;
    const g = H.game;
    if (g && g.mode === 'play' && begun) {
      m.playS += dt / 1000;
      const p = g.player;
      const driving = Boolean(p && (p._vehRider || p.controller === 'drive'));
      if (driving) m.driveS += dt / 1000;
      if (driving && !seated) note('drive', false); // getting in is the deed
      seated = driving;
      if (H.sky && H.sky.space > 0.5 && t - lastSpace > 60000) { lastSpace = t; note('space'); }
    }
    if (t - lastSave > SAVE_EVERY && begun) { m.lastAt = t; save(); }
  });
  H.hooks.world.push({
    enter() { armed = true; worldAt = memory.now(); sampled = worldAt; begin().catch((e) => H.report && H.report(e, 'memory')); },
    leave() { if (armed && begun) { m.lastAt = memory.now(); save(); } armed = false; },
    respawn() { note('fall'); },
  });
  H.hooks.game.push((game) => {
    game.on('catch', (d) => { if (d && d.mine !== false) note('fish'); });
    game.on('wrecked', () => { lastBoom = memory.now(); note('boom'); });
    game.on('explosion', () => { const t = memory.now(); if (t - lastBoom > 4000) { lastBoom = t; note('boom'); } });
    game.on('docked', () => note('dock'));
    game.on('docked-pad', () => note('dock'));
    game.on('spawned', () => note('build'));
    game.on('landed', () => note('build'));
    game.on('sandbox-high', (d) => { if (d && d.mine !== false) note('high'); });
    game.on('asked', () => note('ask'));
    game.on('mirror', (d) => { if (d && (d.state === 'done' || d.state === 'skip') && begun) { look(); save(); } });
  });
  try {
    window.addEventListener('pagehide', () => { if (begun) { m.lastAt = memory.now(); save(false); } });
    window.addEventListener('visibilitychange', () => { if (begun && document.visibilityState === 'hidden') { m.lastAt = memory.now(); save(); } });
  } catch { /* no window events here */ }

  H.memory = Object.assign(memory, {
    KEY, GAP, SETTLE, DEEDS,
    core: { VARIANTS, facts, pick, merge, clean, since, blank, cleanFish },
    begin, greeting,
    get: () => JSON.parse(JSON.stringify(m)),
    facts: () => ctx,
    /** Signed in just now: merge this device's record with the account's and keep both. */
    async sync() {
      try {
        const j = await memory.api('/v1/users/me/overseer');
        signedIn = true;
        m = merge(m, j && j.overseer ? clean(j.overseer) : null);
        save();
      } catch { /* not signed in */ }
    },
    /** The catch log (fishing.js): { fish: { id: [count, kg x 100, cm] }, points }; setFish keeps it in the record. */
    fishLog: {
      get: () => ({ fish: JSON.parse(JSON.stringify(m.fish)), points: m.fishPts }),
      set(fish, points) { m.fish = cleanFish(fish); m.fishPts = num(points, 1e9); save(); },
    },
    reload() { m = readLocal(); prior = null; ctx = null; begun = false; return m; },
    reset() { m = blank(); prior = null; ctx = null; begun = false; signedIn = false; store.set(KEY, ''); if (H.bundle) delete H.bundle.overseerMemory; },
  });
})();
