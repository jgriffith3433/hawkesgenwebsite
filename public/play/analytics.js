// Player analytics from inside the game (H.track): what players do, for the funnel and for "which players stick around
// and why" (Gen's player analytics, product hawkesgen; Hawkes Studio shows it).
// - Where it goes: the page's own SDK when it has one (the guest sandbox, /play/sandbox), else the page around the game
//   (the editor relays { type: 'analytics' } to its SDK). Published games' sandboxed pages have neither, so nothing goes.
// - What: `game_ready` (with ms), the first time each kind of fun happens in a session (`feature`, name below, with `ms`
//   since the game was ready), `first_fun` once (the first of them, with `ms`), and `progress` at 1, 3, 5, 10, 20 and
//   30 minutes of play (step = minutes, label 'minutes_played'), `engage` (seconds spent on each activity: play,
//   build, drive, fly, boat, photo; only while the player is active, sent each minute and when the page hides), the
//   script errors the runtime caught (on a game's own page; in the editor's frame the editor reports them), and in the
//   frame the player's input (`activity`, so the editor counts time spent in the game as active). Context on every event: `tier` (phone, tablet, desktop),
//   `input` (touch, mouse, gamepad: what they used last) and `mode` (play or build).
// It watches what the modules already do (game events, H.vehicles.current, the sky's altitude, rewind, photo mode,
// sharing) instead of each module sending its own, so a module never needs an analytics line. Nothing on the codex.
(() => {
  const H = window.HawkesPlay;
  if (!H || typeof document === 'undefined') return;
  const FEATURES = ['explode', 'drive', 'fly', 'boat', 'space', 'dock', 'fish_cast', 'fish_catch', 'spawn', 'spawn_many', 'emote', 'rewind', 'photo', 'share', 'quest_start', 'quest_done', 'intro_watched', 'intro_skipped'];
  const MINUTES = [1, 3, 5, 10, 20, 30];
  const ctx = {};
  let readyAt = 0, played = 0, nextMinute = 0, firstFun = false;
  const seen = new Set();

  const own = () => Boolean(window.hawkesAnalytics && window.hawkesAnalytics.track);
  const framed = () => { try { return window.parent !== window; } catch { return true; } };
  function send(name, props) {
    if (H.hooks.codex) return;
    const a = window.hawkesAnalytics;
    if (a && a.track) { try { a.track(name, props || {}); } catch { /* never break the game */ } return; }
    if (framed()) { try { window.parent.postMessage({ source: 'hawkes-play', type: 'analytics', name, props: props || {}, ctx: { ...ctx } }, '*'); } catch { /* no parent */ } return; }
    // A game's own page whose SDK is still loading (play.html adds it): its early-calls queue, played back when it runs.
    (window.hawkesAnalyticsQ = window.hawkesAnalyticsQ || []).push(['setContext', { ...ctx }], ['track', name, props || {}]);
  }
  function context(patch) {
    let changed = false;
    for (const [k, v] of Object.entries(patch)) if (ctx[k] !== v) { ctx[k] = v; changed = true; }
    if (!changed) return;
    const a = window.hawkesAnalytics;
    if (a && a.setContext) { try { a.setContext(patch); } catch { /* fine */ } }
  }
  /** The first time this session that a player did `what` (a name from FEATURES, or a module's own). */
  function feature(what, extra) {
    if (seen.has(what)) return;
    seen.add(what);
    const ms = readyAt ? Math.round(performance.now() - readyAt) : null;
    send('feature', { name: what, ms, ...(extra || {}) });
    if (!firstFun && !/^intro_/.test(what)) { firstFun = true; send('first_fun', { what, ms }); }
  }
  H.track = send;
  H.track.feature = feature;
  H.track.FEATURES = FEATURES;

  // Input: what they used last (a phone with a gamepad is a gamepad player). Any input is activity: the page around
  // the game can't see it, so it's told (at most every 2 s) to keep its active time going.
  let lastInput = performance.now(), lastTold = 0;
  const active = () => {
    lastInput = performance.now();
    if (own() || !framed() || lastInput - lastTold < 2000) return;
    lastTold = lastInput;
    try { window.parent.postMessage({ source: 'hawkes-play', type: 'analytics-activity' }, '*'); } catch { /* no parent */ }
  };
  const input = (k) => { context({ input: k }); active(); };
  window.addEventListener('touchstart', () => input('touch'), { passive: true, capture: true });
  window.addEventListener('mousedown', () => input('mouse'), { passive: true, capture: true });
  window.addEventListener('keydown', () => { if (ctx.input !== 'touch') input('mouse'); else active(); }, { passive: true, capture: true });
  window.addEventListener('wheel', active, { passive: true, capture: true });
  let moved = 0;
  window.addEventListener('pointermove', () => { const t = performance.now(); if (t - moved > 2000) { moved = t; active(); } }, { passive: true, capture: true });
  window.addEventListener('gamepadconnected', () => input('gamepad'));
  H.track.active = active; // gamepad play (polled by the controllers) can say so too

  // The game's script errors the runtime caught (runtime.js report): in the editor's frame the editor reports them (the
  // runtime tells it), so only on a page of its own; the page's SDK has the uncaught ones. Each once, 25 a page at most.
  const errSeen = new Set();
  function gameError(message, stack, source, extra) {
    if (framed() || H.hooks.codex) return;
    message = String(message || 'Error').slice(0, 1000);
    const key = message + '|' + String(stack || '').split(/\r?\n/).slice(0, 2).join('|');
    if (errSeen.has(key) || errSeen.size >= 25) return;
    errSeen.add(key);
    send('error', Object.assign({ message, stack: stack ? String(stack).slice(0, 4000) : undefined, source }, extra || {}));
  }
  H.track.error = gameError;

  // Time on each activity: counted while the game runs, the tab shows and the player was active in the last minute.
  const spent = {};
  let sinceSent = 0;
  function sendTime() {
    for (const [name, sec] of Object.entries(spent)) if (sec >= 1) send('engage', { name, seconds: Math.round(sec) });
    for (const k of Object.keys(spent)) delete spent[k];
    sinceSent = 0;
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') sendTime(); });
  window.addEventListener('pagehide', sendTime);

  // The game's own events (every new game: a reload makes a new one).
  H.hooks.game.push((game) => {
    game.on('explosion', () => feature('explode'));
    game.on('cast', (d) => { if (!d || !d.entity || d.entity === (H.world && H.world.player)) feature('fish_cast'); });
    game.on('catch', (d) => { if (!d || d.mine !== false) feature('fish_catch', d && d.fish ? { fish: String(d.fish.name || d.fish).slice(0, 40) } : undefined); });
    game.on('spawn', (d) => feature(d && d.count > 1 ? 'spawn_many' : 'spawn'));
    game.on('emote', () => feature('emote'));
    game.on('docked-pad', () => feature('dock'));
    game.on('quest', (d) => { if (d && d.state === 'start') feature('quest_start'); if (d && d.state === 'done') feature('quest_done'); });
    game.on('intro', (d) => { if (d && d.state === 'end') feature(d.skipped ? 'intro_skipped' : 'intro_watched'); });
  });

  // A new world: ready (once a page), and the mode it runs in.
  H.hooks.world.push({
    enter() {
      context({ tier: H.device ? H.device.tier : null, mode: H.mode || 'play' });
      if (readyAt) return;
      readyAt = performance.now();
      send('game_ready', { ms: Math.round(readyAt) });
    },
  });

  // Once a second: playing time (visible, running), the vehicle they're in, space, rewind, photo mode, sharing.
  let last = performance.now();
  const kindOf = (v) => String((v && (v.kind || (v.spec && v.spec.type))) || '');
  const AIR = /airplane|helicopter|rocket|spaceship|plane|jet|glider/, WATER = /boat|submarine|ship|canoe|jet.?ski/;
  H.hooks.frame.push(() => {
    const t = performance.now();
    if (t - last < 1000) return;
    const dt = Math.min(5, (t - last) / 1000);
    last = t;
    if (!H.world || H.hooks.codex) return;
    const going = document.visibilityState === 'visible' && readyAt;
    if (going) {
      played += dt;
      if (nextMinute < MINUTES.length && played >= MINUTES[nextMinute] * 60) { send('progress', { step: MINUTES[nextMinute], label: 'minutes_played' }); nextMinute++; }
    }
    const counting = going && t - lastInput < 60_000;
    const spend = (what) => { if (counting) spent[what] = (spent[what] || 0) + dt; };
    spend(H.mode === 'build' ? 'build' : 'play');
    if (counting && (sinceSent += dt) >= 60) sendTime();
    try {
      const v = H.vehicles && H.vehicles.current;
      if (v) { const k = kindOf(v); const how = AIR.test(k) ? 'fly' : WATER.test(k) ? 'boat' : 'drive'; feature(how, { vehicle: k.slice(0, 24) }); spend(how); }
      const sky = H.world._sky;
      if (sky && sky.space > 0.9) feature('space');
      if (H.rewind && H.rewind.rewinding) feature('rewind');
      const S = H.share;
      if (S && S.photo && S.photo.on) { feature('photo'); spend('photo'); }
      if (S && S.share && !S.share._tracked) {
        const orig = S.share;
        S.share = function (...a) { feature('share'); return orig.apply(this, a); };
        S.share._tracked = true;
      }
    } catch { /* a module mid-load */ }
  });
})();
