// The daily wish (docs/story.md, "The daily wish"): each day (UTC) the Overseer makes one small wish of the player, the same
// for everyone that day. It sits in the HUD under the level pill and is spoken once when the player arrives. Doing it gives
// Progress points (and now and then a gift for the wardrobe) and a short line from the Overseer; days in a row make a streak.
// Never required, never pushy: it is not a quest, nothing waits on it, and a missed day resets the streak quietly (no message).
//
// The rules and the 40 wishes are wish-core.js. This file watches the game, keeps the record (H.memory.wish: in the account
// when signed in, on the device and in the kept island otherwise), draws the HUD and says the Overseer's words.
//
//   H.wish.state      { day, wish, n, done, streak, best }       game.on('wish', { state: 'offer' | 'progress' | 'done' | 'day' })
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.wish) return;
  const C = H.wishCore;
  const SETTLE = 3; // seconds after a world starts before anything counts
  const SAMPLE = 0.5; // seconds between looks at the player
  const MAX_STEP = 80; // meters in one sample: more than that is the planet's frame moving, not the player
  const STILL_R = 1.2; // meters of drift that still counts as standing still
  const HUT_R = 14; // meters from the hut: you and your friend
  const clock = { now: () => Date.now() };

  let rec = C.blank(), day = null, wish = null;
  let loaded = false, armed = false, worldAt = 0, lastSample = 0, lastPos = null, seated = false, inSpace = false, swimming = false;
  let still = null; // { at: [x, z], since: ms }
  let el = null, quiet = false, G = null;
  const emit = (d) => { try { if (G) G.emit('wish', d); } catch (err) { H.report(err, 'wish'); } };

  // ------------------------------------------------------------------ the record and the day
  const keep = () => { if (H.memory && H.memory.wish) H.memory.wish.set(rec); };
  function today() { return C.dayKey(clock.now()); }
  /** What the world has: a wish that needs a hut, a course or a running clock the world lacks is swapped for a plain one (no gaps). */
  function has(need, w) {
    const world = H.world;
    if (need === 'hut') return Boolean(world && world.byId && world.byId.get('hut'));
    if (need === 'clock') { const c = H.sky && H.sky.clock && H.sky.clock(false); return Boolean(c && c.run); }
    if (need === 'race') { const cs = H.race && H.race._internal && H.race._internal.courses(); return Boolean(cs && cs.length && (!w || !w.course || cs.some((c) => c.def && c.def.id === w.course))); }
    return true;
  }
  function load() {
    if (loaded || !H.memory || !H.memory.wish) return;
    if (!H.memory.get().visits) return; // the memory has not begun yet (it reads the account first)
    rec = C.merge(rec, H.memory.wish.get());
    loaded = true;
    newDay(false);
  }
  /** Today's record and wish (a new day starts the progress again; the streak is only looked at, never changed, until a wish is done). */
  function newDay(say) {
    day = today();
    wish = C.offer(C.wishFor(day), has);
    rec = C.forDay(rec, day);
    swimS = 0; meterAcc = 0;
    draw();
    if (say) emit({ state: 'day', day, id: wish.id });
  }

  // ------------------------------------------------------------------ events move the wish on
  let swimS = 0, meterAcc = 0;
  function feed(ev) {
    if (!loaded || !armed || !wish || C.isDone(rec, day)) return;
    if (clock.now() - worldAt < SETTLE * 1000) return;
    const r = C.advance(wish, rec, ev);
    if (!r.changed) return;
    rec = r.rec;
    if (r.done) return finish();
    emit({ state: 'progress', id: wish.id, n: rec.n, of: wish.n });
    keep();
    draw();
  }
  function finish() {
    const before = rec.last;
    rec = C.complete(rec, day);
    const streak = rec.st;
    const pts = C.pointsFor(wish, streak);
    let gift = null;
    if (wish.gift && H.memory && H.memory.wardrobe) {
      const g = wish.gift;
      if (H.memory.wardrobe.add(g[0] === 'acc' ? { acc: [g[1]] } : { col: [g[1]] })) gift = g;
    }
    keep();
    if (H.progress && H.progress.award) H.progress.award('a wish', pts, 'wish');
    const text = C.doneLine(day, streak, gift);
    moments.push(text);
    emit({ state: 'done', id: wish.id, pts, streak, gift: gift ? gift.slice(0, 2).join(':') : null, from: before });
    draw();
  }

  // ------------------------------------------------------------------ the Overseer's words (when it is free to speak)
  const moments = [];
  function say(text) {
    const o = H.overseer;
    if (o && o.speak) o.speak(text, null, 6, { priority: 'low' });
    else if (H.chat && H.chat.line) H.chat.line({ kind: 'overseer', text });
    emit({ state: 'line', text });
  }
  function speakNow() {
    if (!G || quiet || (H.speech && H.speech.busy) || (H.mirror && H.mirror.isOpen)) return;
    if (H.progress && H.progress.waiting) return; // a level's moment first
    if (moments.length) { say(moments.shift()); return; }
    if (!rec.said && wish && !C.isDone(rec, day) && clock.now() - worldAt >= SETTLE * 1000) {
      rec.said = 1; keep();
      say(wish.say);
      emit({ state: 'offer', id: wish.id, day, text: wish.say });
    }
  }

  // ------------------------------------------------------------------ the HUD (a small pill under the level pill)
  const CSS = `
.wh-hud{position:fixed;left:12px;top:116px;z-index:6;display:flex;flex-direction:column;gap:2px;min-width:132px;max-width:220px;padding:5px 10px 6px;border-radius:12px;background:rgba(8,12,22,.55);border:1.5px solid rgba(255,255,255,.14);color:#eaf7ff;font:600 12px/1.25 system-ui,sans-serif;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,.8)}
.wh-hud[hidden]{display:none}
.wh-hud .wh-k{font-weight:500;color:#cfe8f7;font-size:11px;letter-spacing:.02em}
.wh-hud .wh-n{color:#ffe28a}
.wh-hud .wh-s{font-weight:500;color:#bcd2e0;font-size:11px}
.wh-hud.wh-done .wh-t{opacity:.6;text-decoration:line-through}
@media (max-width:700px){.wh-hud{min-width:112px;font-size:11.5px;top:108px}}
`;
  function make() {
    if (el || typeof document === 'undefined') return;
    if (!document.getElementById('wh-style')) { const s = document.createElement('style'); s.id = 'wh-style'; s.textContent = CSS; document.head.appendChild(s); }
    el = document.createElement('div');
    el.className = 'wh-hud';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<div class="wh-k">The Overseer’s wish for today</div><div class="wh-t" data-t></div><div class="wh-n" data-n></div><div class="wh-s" data-s></div>';
    el.hidden = true;
    document.body.appendChild(el);
  }
  const shown = () => loaded && armed && !quiet && H.mode !== 'build' && wish;
  function draw() {
    make();
    if (!el || !wish) return;
    const done = C.isDone(rec, day), streak = C.streakShown(rec, day);
    el.querySelector('[data-t]').textContent = wish.hud;
    el.querySelector('[data-n]').textContent = done ? 'Done' : C.progressText(wish, rec);
    el.querySelector('[data-s]').textContent = streak >= 1 ? `${streak} ${streak === 1 ? 'day' : 'days'} in a row` : '';
    el.classList.toggle('wh-done', done);
    el.setAttribute('aria-label', `Today’s wish: ${wish.hud}${done ? ', done' : ''}${streak ? `, ${streak} days in a row` : ''}`);
    el.hidden = !shown();
  }

  /** What the HUD says now ('' when it is not shown): the wish, its progress or "Done", the streak. */
  function hudText() {
    if (!shown()) return '';
    const done = C.isDone(rec, day), streak = C.streakShown(rec, day);
    return [wish.hud, done ? 'Done' : C.progressText(wish, rec), streak >= 1 ? `${streak} ${streak === 1 ? 'day' : 'days'} in a row` : ''].filter(Boolean).join(' · ');
  }

  // ------------------------------------------------------------------ watching the player
  const xz = (p) => {
    const v = p && (p.position || (p.root && p.root.position));
    if (!v) return null;
    return Array.isArray(v) ? [v[0], v[2]] : [v.x, v.z];
  };
  function sample() {
    const g = H.game;
    if (!g || g.mode !== 'play' || !loaded) { lastPos = null; still = null; return; }
    if (!rec.said && !rec.n && day) { const w = C.offer(C.wishFor(day), has); if (w !== wish) { wish = w; draw(); } } // the world's own things may come after the first frame
    if (today() !== day) newDay(true); // midnight UTC passed while playing: a new wish, quietly (nothing is said)
    const p = H.world && H.world.player;
    if (!p || !p.alive) { lastPos = null; still = null; return; }
    const t = clock.now();
    const driving = Boolean(p._vehRider || p.controller === 'drive');
    if (seated && !driving) feed({ type: 'unseat' });
    seated = driving;
    const at = xz(p);
    if (driving && at && lastPos) {
      const d = Math.hypot(at[0] - lastPos[0], at[1] - lastPos[1]);
      if (d > 0.05 && d < MAX_STEP) { meterAcc += d; if (meterAcc >= 1) { const whole = Math.floor(meterAcc); meterAcc -= whole; feed({ type: 'meters', n: whole }); } }
    }
    lastPos = at;
    // standing still: on foot, not swimming, inside a small circle
    if (!driving && !swimming && at && !(H.photo && H.photo.on) && !(H.share && H.share.photo && H.share.photo.on)) {
      if (!still) still = { at, since: t };
      else {
        const d = Math.hypot(at[0] - still.at[0], at[1] - still.at[1]);
        if (d >= MAX_STEP) still = { at, since: t }; // the planet's frame moved
        else if (d > STILL_R) { still = { at, since: t }; feed({ type: 'moved' }); }
        else feed({ type: 'still', s: (t - still.since) / 1000 });
      }
    } else { if (still) feed({ type: 'moved' }); still = null; }
    if (swimming) { swimS += SAMPLE; feed({ type: 'swim', s: swimS }); }
    const up = Boolean(H.sky && H.sky.space > 0.5);
    if (up && !inSpace) feed({ type: 'space' });
    inSpace = up;
    if (wish && wish.kind === 'hut-friend' && at) hutFriend(p);
  }
  function hutFriend(p) {
    const hut = H.world.byId && H.world.byId.get('hut');
    const h = xz(hut), me = xz(p);
    if (!h || !me || Math.hypot(me[0] - h[0], me[1] - h[1]) > HUT_R) return;
    for (const e of H.world.entities || []) {
      if (!e.remotePlayer || e === p || e.alive === false) continue;
      const o = xz(e);
      if (o && Math.hypot(o[0] - h[0], o[1] - h[1]) <= HUT_R) { feed({ type: 'hut-friend' }); return; }
    }
  }
  H.hooks.frame.push(() => {
    const t = clock.now();
    if (!loaded) { load(); return; }
    if (t - lastSample < SAMPLE * 1000) return;
    lastSample = t;
    sample();
    speakNow();
    if (el) { const hide = !shown(); if (el.hidden !== hide) el.hidden = hide; }
  });
  H.hooks.world.push({
    enter() { armed = true; worldAt = clock.now(); lastPos = null; still = null; seated = false; inSpace = false; swimming = false; if (!loaded) load(); },
    leave() { armed = false; if (loaded) keep(); if (el) el.hidden = true; },
  });
  H.hooks.game.push((game) => {
    G = game;
    game.on('catch', (d) => { if (d && d.mine !== false) feed({ type: 'catch', species: d.fish && (d.fish.id || d.fish.name) ? String(d.fish.id || d.fish.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 32) : 'fish' }); });
    game.on('explosion', () => feed({ type: 'boom', seated }));
    game.on('docked', () => feed({ type: 'dock' }));
    game.on('docked-pad', () => feed({ type: 'dock' }));
    game.on('spawned', () => feed({ type: 'build' }));
    game.on('asked', () => feed({ type: 'ask' }));
    game.on('helped', () => feed({ type: 'help' }));
    game.on('race', (d) => { if (d && d.state === 'finish') feed({ type: 'race', course: d.course, ms: d.ms }); });
    game.on('quest', (d) => { if (d && d.state === 'done') feed({ type: 'quest' }); });
    game.on('lore-found', () => feed({ type: 'lore' }));
    game.on('met', () => feed({ type: 'met' }));
    game.on('swim', (d) => { swimming = Boolean(d && d.swimming); });
    game.on('photo', (d) => feed({ type: 'photo', space: d && d.space, hour: d && d.hour }));
    // The beginning is the Overseer's: the HUD and its words wait for the intro and the mirror to finish.
    game.on('intro', (d) => { quiet = Boolean(d && d.state === 'start'); draw(); });
    game.on('mirror', (d) => { if (d && d.state && d.state !== 'done' && d.state !== 'skip') { quiet = true; } else if (d) quiet = false; draw(); });
  });

  H.wish = {
    clock, feed,
    get state() { return { day, wish: wish ? wish.id : null, hud: wish ? wish.hud : null, n: rec.n, of: wish ? wish.n : 0, done: C.isDone(rec, day), streak: C.streakShown(rec, day), best: rec.best, loaded }; },
    /** Tests: the record as it is. */
    record: () => JSON.parse(JSON.stringify(rec)),
    /** The wish is shown or not, and the line it shows. */
    get hud() { return hudText(); },
    get waiting() { return moments.length; },
    /** Tests: forget this visit's state (the saved record stays in H.memory). */
    reset() { rec = C.blank(); day = null; wish = null; loaded = false; moments.length = 0; still = null; lastPos = null; swimming = false; },
  };
})();
