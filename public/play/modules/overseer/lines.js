// The Overseer's first-time lines (docs/story.md, "First-time moments"): the first thing built, the first fish, the first
// fall, the first dock, the first time above the air, the first vehicle blown up, the first friend to join. Coming back
// ('return') is not once per device: memory.js picks a greeting from what is true, each visit. Each is said once per device (localStorage "hg_overseer_lines"; the editor's page keeps it for the
// sandboxed stage, and gives it back in the bundle), as a line in the game's one chat (H.overseer.speak: the words, and
// a voice where an existing clip says the very same words).
//
//   H.lines.say(id)        asks for a line (events do it themselves); false when it was already said
//   H.lines.seen(id)       whether it was said on this device
//   H.lines.reset()        forgets them all (tests, the codex)
//   H.lines.IDS, H.lines.LINES
//
// A line never plays over anything else of the Overseer's: it waits (in order of importance, and drops out if it is
// still waiting a minute later; it comes again, not having been said) while the intro plays or is about to, the mirror
// is open or about to open, a tour moment (game.on('tour'), the spawn wheel) is on, or another Overseer line is
// still being read. It is said when the way is clear, and marked said only then.
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.lines) return;
  const KEY = 'hg_overseer_lines';
  const LAST = 'hg_overseer_lastvisit';
  const AWAY = 7 * 24 * 3600 * 1000; // coming back after this long
  const STALE = 60; // seconds a line waits before it gives up (not said: it comes again)
  const SETTLE = 3; // seconds after a world starts before anything counts (what is placed while loading is not "built")

  // Order is importance: when several wait, the first listed is said first.
  // `text` may be a list (two options, one picked); `voice` only where the clip says the very same words.
  const LINES = {
    return: { priority: 8, stale: 300, text: ['You came back. The sea kept your place.', 'Hello again. It rained while you were gone.'] },
    dock: { priority: 7, text: ['You came all this way. The door was open.', 'Welcome in. Stay as long as you like.'] },
    space: { priority: 6, text: ['There. That is the whole planet. Take a moment.', 'It gets quiet up here. I like it. You may too.'] },
    death: { priority: 5, text: ['Down you go again. The light is patient.', 'That was a fall worth watching. Come back.'] },
    boom: { priority: 4, text: ['Destruction is a kind of freedom too.'], voice: 'overseer-destruction.mp3' },
    friend: { priority: 4, text: ['Someone is here with you. Good.', 'You have company. I sent them down gently.'] },
    build: { priority: 3, text: ['A new one, from me.'], voice: 'overseer-a-new-one.mp3' },
    fish: { priority: 3, text: ['The sea gives. It gives slowly. That is the best way.', 'A fish. You waited well.'] },
  };
  const IDS = Object.keys(LINES);

  // ------------------------------------------------------------------ what has been said
  let said = {}; // id -> when (ms)
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* a sandboxed page: the editor keeps it (below) */ } },
  };
  function load() {
    let m = {};
    try { m = JSON.parse(store.get(KEY) || '{}') || {}; } catch { m = {}; }
    // The editor's page holds it for the sandboxed stage (and the account, when it has one): H.bundle.overseerLines.
    const b = H.bundle && H.bundle.overseerLines;
    if (b && typeof b === 'object') for (const k of Object.keys(b)) if (!m[k]) m[k] = b[k];
    said = m;
  }
  function save() {
    store.set(KEY, JSON.stringify(said));
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ source: 'hawkes-play', type: 'overseer-lines', lines: said }, '*'); } catch { /* fine */ }
    if (H.bundle) H.bundle.overseerLines = { ...said };
  }
  load();

  // ------------------------------------------------------------------ time, and what is in the way
  const lines = {
    clock: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
    now: () => Date.now(),
    rand: () => Math.random(),
  };
  let busyUntil = 0; // an Overseer line (ours or anyone's) is still being read until then
  let holdUntil = 0; // a tour moment, the mirror's end
  let introState = null; // null (not seen this world), 'start', 'end'
  let worldAt = 0;
  let armed = false;
  const queue = []; // { id, at }
  let ours = false;

  const G = () => H.game;
  const OV = () => H.overseer;
  /** How long a line takes to read (and to say): about 2.4 s and a bit for each word. */
  const readFor = (text) => 2.4 + String(text).split(/\s+/).length * 0.4;

  function blocked() {
    const t = lines.clock();
    const ov = OV();
    if (!armed || t - worldAt < SETTLE) return 'settling';
    if (ov && ov.introPlaying) return 'intro';
    if (introState === null && ov && ov.introWanted && ov.introWanted()) return 'intro';
    const g = G();
    if (g && g.mirror && g.mirror.pending) return 'mirror';
    if (t < holdUntil) return 'moment';
    if (t < busyUntil || (H.speech && H.speech.busy)) return 'speaking';
    return null;
  }

  // Anything the Overseer says through the chat holds the next line back (the intro, the mirror, the tour, the assistant).
  function watchChat() {
    const c = H.chat;
    if (!c || c.__lines) return;
    const line = c.line;
    c.__lines = true;
    c.line = function (m) {
      if (!ours && m && (m.kind === 'overseer' || m.overseer)) busyUntil = Math.max(busyUntil, lines.clock() + readFor(m.text || ''));
      return line.apply(this, arguments);
    };
  }

  // ------------------------------------------------------------------ saying
  function deliver(id) {
    const def = LINES[id];
    const o = OV();
    if (!def || !o) return false;
    const list = def.text;
    let text = list[Math.min(list.length - 1, Math.floor(lines.rand() * list.length))];
    // A return is greeted from what the Overseer remembers (memory.js): different each time, only what is true.
    if (id === 'return' && H.memory) {
      const g = H.memory.greeting();
      if (!g) return false;
      text = g.text;
    }
    said[id] = lines.now();
    save();
    ours = true;
    try {
      if (o.speak) o.speak(text, def.voice || null, 8, { priority: 'normal' });
      else if (H.chat) H.chat.line({ kind: 'overseer', text });
    } finally { ours = false; }
    busyUntil = lines.clock() + readFor(text);
    try { if (G()) G().emit('overseer-line', { id, text, voice: def.voice || null }); } catch (err) { H.report(err, 'lines'); }
    return true;
  }

  /** Asks for a line. Said now if the way is clear, else it waits its turn; false when it was said before. */
  function ask(id) {
    if (!LINES[id] || said[id] && id !== 'return') return false;
    if (queue.some((q) => q.id === id)) return false;
    queue.push({ id, at: lines.clock() });
    pump();
    return true;
  }

  function pump() {
    const t = lines.clock();
    for (let i = queue.length - 1; i >= 0; i--) if (t - queue[i].at > (LINES[queue[i].id].stale || STALE) || (said[queue[i].id] && queue[i].id !== 'return')) queue.splice(i, 1);
    if (!queue.length || blocked()) return;
    queue.sort((a, b) => LINES[b.id].priority - LINES[a.id].priority || a.at - b.at);
    deliver(queue.shift().id);
  }

  // ------------------------------------------------------------------ the events
  let lastPump = 0;
  let peers = null;
  H.hooks.frame.push(() => {
    const t = lines.clock();
    if (t - lastPump < 0.25) return;
    lastPump = t;
    if (!armed) return;
    // Above the air.
    if (!said.space && H.sky && H.sky.space > 0.5 && t - worldAt >= SETTLE) ask('space');
    // A friend joining: someone new in the room (those already there when we arrived don't count).
    try {
      const n = window.HawkesNet && window.HawkesNet.peers ? window.HawkesNet.peers().size : 0;
      if (peers === null) peers = n; else { if (n > peers && !said.friend) ask('friend'); peers = n; }
    } catch { /* no net */ }
    pump();
  });

  H.hooks.world.push({
    enter() { worldAt = lines.clock(); lastPump = -1e9; armed = true; introState = null; peers = null; busyUntil = 0; holdUntil = 0; for (let i = queue.length - 1; i >= 0; i--) if (queue[i].id !== 'return') queue.splice(i, 1); },
    leave() { armed = false; },
    // Down, or fallen out of the world: back to the start.
    respawn() { if (armed) ask('death'); },
  });

  H.hooks.game.push((game) => {
    watchChat();
    const settled = () => lines.clock() - worldAt >= SETTLE;
    const hold = (s) => { holdUntil = Math.max(holdUntil, lines.clock() + s); };
    game.on('intro', (d) => { if (d) introState = d.state === 'start' ? 'start' : 'end'; if (d && d.state === 'end') hold(2); });
    game.on('mirror', (d) => { if (d && (d.state === 'done' || d.state === 'skip')) hold(8); else if (d && d.state) hold(2); });
    // The tour's moments (Pip and the Overseer answer a finished step), the spawn wheel's own line, and the tour's start.
    game.on('tour', () => hold(10));
    game.on('spawn-wheel', () => hold(6));
    game.on('quest', (d) => { if (d && d.id === 'tour' && (d.state === 'start' || d.state === 'done')) hold(8); });
    game.on('catch', (d) => { if (d && d.mine !== false && settled()) ask('fish'); });
    game.on('wrecked', () => { if (settled()) ask('boom'); });
    game.on('docked', (d) => { if (d && settled()) ask('dock'); });
    game.on('docked-pad', () => { if (settled()) ask('dock'); });
    // The first thing built or sent: what the player spawns, or the Overseer lands for them (not what loads with the world).
    game.on('spawned', () => { if (settled()) ask('build'); });
    game.on('landed', () => { if (settled()) ask('build'); });
  });

  // Coming back: memory.js counts the visit when a world starts and asks for 'return' when this is a new one. Without
  // it (a page that does not load the module) it has been a week since this device was last here.
  function visit() {
    if (H.memory) return;
    const last = Number(store.get(LAST)) || 0;
    const t = lines.now();
    store.set(LAST, String(t));
    if (last && t - last >= AWAY) ask('return');
  }
  if (!(H.hooks.codex)) visit();

  H.lines = Object.assign(lines, {
    IDS, LINES, STALE, SETTLE, AWAY,
    say: ask,
    seen: (id) => Boolean(said[id]),
    blocked,
    pump,
    reload: load,
    visit,
    reset() { said = {}; queue.length = 0; store.set(KEY, '{}'); },
  });
  Object.defineProperty(H.lines, 'waiting', { get: () => queue.map((q) => q.id) });
})();
