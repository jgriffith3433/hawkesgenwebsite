// Progress (docs/story.md, "Progress"): the player earns points for doing things, a small HUD shows them with a level bar,
// and each level gives something (an accessory or a color for the wardrobe, a tool for the belt) with a short moment with
// the Overseer. Not money: credits stay the paid currency and never touch this. Nothing here is for sale.
//
// The rules and the data are progress-core.js (EARN: what earns; UNLOCKS: one line per unlock). This file listens to the
// game's events, keeps the record (H.memory.progress: in the account when signed in, on this device otherwise, and in the
// guest's kept island with the rest of the Overseer's memory), draws the HUD, gives what a level gave, and says the moment.
//
//   H.progress.state       { pts, level, bar, name }      H.progress.has('tool:grenade')   whether it is theirs
//   H.progress.earn(id, n) earns by the table (id: 'fish', 'quest', 'first-dock'...; n a measured amount for `per` ones)
//   H.progress.did(kind)   an activity done: its repeating points and, the first time, its first-time points
//   game.on('progress', ({ state: 'earn' | 'level' | 'unlock', ... }))
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.progress) return;
  const C = H.progressCore;
  const SETTLE = 3; // seconds after a world starts before anything counts (what loads with the world is not "done")
  const SAMPLE = 0.5; // seconds between looks at the player (distance, the air)
  const MAX_STEP = 80; // meters in one sample: more than that is the planet's frame moving, not the player
  const clock = { now: () => Date.now() };

  let pr = C.blank();
  let loaded = false, armed = false, worldAt = 0, lastSample = 0, lastPos = null, seated = false, inSpace = false;
  const lastAt = {}; // id -> ms (the `gap` of the repeating ones)
  const moments = []; // level-ups waiting for the Overseer to be free
  let el = null, bar = null, popTimer = 0, quiet = false;
  let G = null;
  const emit = (d) => { try { if (G) G.emit('progress', d); } catch (err) { H.report(err, 'progress'); } };

  // ------------------------------------------------------------------ the record
  function load() {
    if (loaded || !H.memory || !H.memory.progress) return;
    const m = H.memory.get();
    if (!m.visits) return; // the memory has not begun yet (it reads the account first)
    pr = C.merge(pr, H.memory.progress.get());
    loaded = true;
    grantAll(false);
    draw();
  }
  const keep = () => { if (H.memory && H.memory.progress) H.memory.progress.set(pr); };
  const level = () => C.levelAt(pr.p);

  // ------------------------------------------------------------------ what a level gave
  const mine = () => C.unlockedBy(level());
  const has = (key) => mine().some((u) => u.key === key);
  /** Puts what the level gave where it belongs: the wardrobe's own list, the tool belt. Quiet (no line); safe to repeat. */
  function grantAll() {
    const acc = [], col = [];
    for (const u of mine()) {
      if (u.kind === 'acc') acc.push(u.id);
      else if (u.kind === 'col') col.push(u.id);
    }
    if (H.memory && H.memory.wardrobe && (acc.length || col.length)) H.memory.wardrobe.add({ acc, col });
    beltAll();
  }
  /** The tool belt: every tool a level gave, back on it each visit (mayhem keeps the belt for one world). */
  function beltAll() {
    const X = H.mayhem;
    if (!X || !X.addToBelt) return;
    let added = false;
    for (const u of mine()) if (u.kind === 'tool' && X.addToBelt(u.id)) added = true;
    const p = H.world && H.world.player; // (not game.player: reading that makes one in a world with none)
    if (added && p && p.alive && !p.tool && X.belt.length) p.tool = X.belt[0];
  }

  // ------------------------------------------------------------------ earning
  const counts = () => armed && loaded && clock.now() - worldAt >= SETTLE * 1000;
  function add(id, label, pts) {
    if (!pts) return 0;
    const before = level();
    pr.p = Math.min(1e7, pr.p + pts);
    const after = level();
    emit({ state: 'earn', id, label, pts, total: pr.p, level: after });
    pop(`+${pts} ${pts === 1 ? C.POINTS.one : C.POINTS.many} · ${label}`);
    if (after > before) levelUp(before, after);
    keep();
    draw();
    return pts;
  }
  /** Earns by the table. Returns the points given (0 when it did not count: not yet, done before, too soon). */
  function earn(id, n = 1) {
    const spec = C.EARN[id];
    if (!spec || !counts()) return 0;
    if (spec.once) {
      if (pr.f.includes(id)) return 0;
      pr.f.push(id);
    }
    const t = clock.now();
    if (spec.gap && lastAt[id] && t - lastAt[id] < spec.gap * 1000) return 0;
    if (spec.gap) lastAt[id] = t;
    if (spec.per) {
      const from = pr.d, to = pr.d + Math.max(0, n);
      pr.d = Math.min(1e9, to);
      const steps = Math.floor(to / spec.per) - Math.floor(from / spec.per);
      return steps > 0 ? add(id, spec.label, steps * spec.pts) : (keep(), 0);
    }
    return add(id, spec.label, spec.pts * (spec.once ? 1 : Math.max(1, Math.floor(n))));
  }
  /** An activity done: its repeating points, and the first time its first-time points on top. */
  function did(kind) {
    let got = earn(kind);
    const first = C.FIRST_OF[kind];
    if (first) got += earn(first);
    return got;
  }

  // ------------------------------------------------------------------ the moment
  function levelUp(from, to) {
    const ups = C.UNLOCKS.filter((u) => u.level > from && u.level <= to);
    grantAll();
    emit({ state: 'level', level: to, from, unlocks: ups.map((u) => u.key) });
    for (const u of ups) emit({ state: 'unlock', key: u.key, kind: u.kind, id: u.id, label: u.label, level: u.level });
    moments.push({ level: to, text: C.levelLine(to, ups), ups });
    pop(`Level ${to}${ups.length ? ` · ${ups.map((u) => u.label).join(', ')}` : ''}`, 5);
  }
  /** Says the waiting moments when the Overseer is free (never over the intro, the mirror or another of its lines). */
  function sayMoments() {
    if (!moments.length || !G) return;
    if (quiet || (H.speech && H.speech.busy) || (H.mirror && H.mirror.isOpen)) return;
    const m = moments.shift();
    pr.s = Math.max(pr.s, m.level);
    keep();
    const o = H.overseer;
    if (o && o.speak) o.speak(m.text, null, 7, { priority: 'normal' });
    else if (H.chat && H.chat.line) H.chat.line({ kind: 'overseer', text: m.text });
    emit({ state: 'moment', level: m.level, text: m.text });
  }

  // ------------------------------------------------------------------ the HUD (a small pill, top left; the touch layout places it)
  const CSS = `
.pg-hud{position:fixed;left:12px;top:56px;z-index:6;display:flex;flex-direction:column;gap:3px;min-width:132px;max-width:220px;padding:5px 10px 6px;border-radius:12px;background:rgba(8,12,22,.62);border:1.5px solid rgba(255,255,255,.18);color:#eaf7ff;font:600 12.5px/1.2 system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.8)}
.pg-hud[hidden]{display:none}
.pg-hud .pg-row{display:flex;justify-content:space-between;gap:8px}.pg-hud b{color:#ffe28a}
.pg-hud .pg-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.16);overflow:hidden}.pg-hud .pg-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8fd8ff,#ffe28a);transition:width .5s}
.pg-hud .pg-pop{min-height:14px;color:#cfe8f7;font-weight:500;opacity:0;transition:opacity .3s}.pg-hud .pg-pop.on{opacity:1}
.pg-hud.pg-lv{border-color:#ffe28a;box-shadow:0 0 14px #ffe28a66}
@media (max-width:700px){.pg-hud{min-width:112px;font-size:12px;top:52px}}
`;
  function make() {
    if (el || typeof document === 'undefined') return;
    if (!document.getElementById('pg-style')) { const s = document.createElement('style'); s.id = 'pg-style'; s.textContent = CSS; document.head.appendChild(s); }
    el = document.createElement('div');
    el.className = 'pg-hud';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="pg-row"><span>Level <b data-l>1</b></span><span data-n></span></div><div class="pg-bar"><i></i></div><div class="pg-pop" data-pop></div>';
    el.hidden = true;
    document.body.appendChild(el);
    bar = el.querySelector('.pg-bar i');
  }
  function draw() {
    make();
    if (!el) return;
    const b = C.bar(pr.p);
    el.querySelector('[data-l]').textContent = String(b.level);
    el.querySelector('[data-n]').textContent = b.max ? `${b.pts} ${C.POINTS.many}` : `${b.into} / ${b.span}`;
    bar.style.width = `${Math.round(b.frac * 100)}%`;
    el.setAttribute('aria-label', `Level ${b.level}, ${b.pts} ${C.POINTS.many}`);
    el.hidden = !(loaded && armed && !quiet && H.mode !== 'build');
  }
  function pop(text, seconds = 2.2) {
    make();
    if (!el) return;
    const p = el.querySelector('[data-pop]');
    p.textContent = text; p.classList.add('on');
    if (seconds > 4) { el.classList.add('pg-lv'); setTimeout(() => el && el.classList.remove('pg-lv'), seconds * 1000); }
    clearTimeout(popTimer);
    popTimer = setTimeout(() => p.classList.remove('on'), seconds * 1000);
  }

  // ------------------------------------------------------------------ watching the player
  const xz = (p) => {
    const v = p && (p.position || (p.root && p.root.position));
    if (!v) return null;
    return Array.isArray(v) ? [v[0], v[2]] : [v.x, v.z];
  };
  function sample(t) {
    const g = H.game;
    if (!g || g.mode !== 'play' || !loaded) { lastPos = null; return; }
    const p = H.world && H.world.player;
    if (!p || !p.alive) { lastPos = null; return; }
    const driving = Boolean(p && (p._vehRider || p.controller === 'drive'));
    if (driving && !seated) did('drive');
    seated = driving;
    const at = xz(p);
    if (driving && at && lastPos) {
      const d = Math.hypot(at[0] - lastPos[0], at[1] - lastPos[1]);
      if (d > 0.05 && d < MAX_STEP) earn('distance', d);
    }
    lastPos = at;
    const up = Boolean(H.sky && H.sky.space > 0.5);
    if (up && !inSpace) did('space');
    inSpace = up;
  }
  H.hooks.frame.push(() => {
    const t = clock.now();
    if (!loaded) { load(); return; }
    if (t - lastSample < SAMPLE * 1000) return;
    lastSample = t;
    sample(t);
    sayMoments();
    if (loaded && armed && counts()) beltAll();
    if (el) { const hide = !(armed && !quiet && H.mode !== 'build'); if (el.hidden !== hide) el.hidden = hide; }
  });
  H.hooks.world.push({
    enter() { armed = true; worldAt = clock.now(); lastPos = null; seated = false; inSpace = false; if (!loaded) load(); },
    leave() { armed = false; if (loaded) keep(); if (el) el.hidden = true; },
  });
  H.hooks.game.push((game) => {
    G = game;
    game.on('catch', (d) => { if (d && d.mine !== false) did('fish'); });
    game.on('wrecked', () => did('boom'));
    game.on('explosion', () => did('boom'));
    game.on('docked', () => did('dock'));
    game.on('docked-pad', () => did('dock'));
    game.on('spawned', () => did('build'));
    game.on('landed', () => did('build'));
    game.on('asked', () => did('ask'));
    game.on('helped', () => did('help'));
    game.on('race', (d) => { if (d && d.state === 'finish') did('race'); });
    game.on('quest', (d) => { if (d && d.state === 'done') earn('quest'); });
    game.on('lore-found', () => earn('lore'));
    game.on('met', () => earn('met'));
    // The beginning is the Overseer's: the HUD and the moments wait for the intro and the mirror to finish.
    game.on('intro', (d) => { quiet = Boolean(d && d.state === 'start'); draw(); });
    game.on('mirror', (d) => { if (d && d.state && d.state !== 'done' && d.state !== 'skip') { quiet = true; } else if (d) quiet = false; draw(); });
  });

  H.progress = {
    earn, did, has, clock, grantAll,
    get state() { return { pts: pr.p, level: level(), bar: C.bar(pr.p), name: C.POINTS, firsts: [...pr.f], meters: pr.d, loaded }; },
    get unlocked() { return mine().map((u) => u.key); },
    get waiting() { return moments.length; },
    /** Tests: the record as it is. */
    record: () => JSON.parse(JSON.stringify(pr)),
    /** Tests: forget this visit's state (the saved record stays in H.memory). */
    reset() { pr = C.blank(); loaded = false; moments.length = 0; for (const k of Object.keys(lastAt)) delete lastAt[k]; },
  };
})();
