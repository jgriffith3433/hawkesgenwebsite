// The Overseer's reactions while a world is built (docs/story.md, "Reactions while you build"): a character that responds.
// Unlike lines.js (a first time, said once per device) these come every time and are never the same twice in a row.
//
//   build  the Overseer finished a request: what it noticed about the thing, said calmly (never "done", never a task list)
//   fail   the request did not come down: what the world did, never what a system did, and an offer to ask again
//   idle   the player has been quiet for a while: an invitation, never a nudge
//   think  while it works: the work pill's headline changes (work.js asks H.reactions.think())
//
// Each kind is a shuffled deck: every line is used once before any is used again, and the first of a new deck is never
// the last of the old one. H.reactions.say(kind) asks; the line is spoken through the Overseer's speech desk when the way
// is clear (H.lines.blocked) and dropped if it waits too long. Events: game.on('reaction') { kind, text }.
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.reactions) return;

  const POOLS = {
    build: [
      'There. It came down the light just as you asked.',
      'I like where you put it. It looks like it was always there.',
      'A new one, and a good one. Look at the edges.',
      'It is yours now. Walk around it.',
      'I noticed the size you chose. Brave.',
      'Hold still. It has settled. Good.',
      'That is a strange thing to want, and I am very pleased.',
      'It fits the island better than I expected.',
      'Here. I made it slowly, so you could watch.',
      'Look at it from the water. It is better from the water.',
      'You asked, and the sky answered. I enjoy that.',
      'It is a little crooked, on purpose. I thought you would like that.',
      'Something new is standing where nothing was. That never gets old.',
      'Go on. Touch it. It is real.',
    ],
    fail: [
      'It did not want to come down. Ask again.',
      'The light lost it halfway. Ask once more, a little differently.',
      'Not that one, not yet. Tell me another way.',
      'It slipped away from me. Nothing you built is lost.',
      'I could not hold it long enough. Try again, I am here.',
      'That one wandered off before it arrived. It happens to the best ideas.',
      'The sky was crowded just then. Ask me again.',
      'I did not quite catch the shape of it. Say it smaller, or stranger.',
      'It would not settle. Everything you made is still where you left it.',
      'We will try that again. I am in no hurry.',
      'The sea took that one back. Ask, and I will send it down again.',
      'Something got between us and it. Thank you for trying.',
    ],
    idle: [
      'Take your time. The sky is not going anywhere.',
      'I am watching the sea. You do not have to do anything.',
      'Whenever you like. Ask, and I will send it down.',
      'It is quiet here. I like it. You may too.',
      'Is there something you almost wanted to build?',
      'Look up for a moment. The planet turns on its own.',
      'I have been thinking about what you made. It is good.',
      'You could sail somewhere. Or build the thing that sails.',
      'The light is patient. So am I.',
      'Nothing is waiting for you. That is the best part.',
      'Pip is probably fishing. You could join.',
      'If you are stuck, tell me something small. I will do the rest.',
    ],
    think: [
      'Looking at the island',
      'Thinking it over',
      'Finding the shape of it',
      'Gathering light',
      'Choosing where it goes',
      'Asking the sea',
      'Almost there',
      'Turning it over',
      'Imagining it',
      'Sorting out the edges',
      'Taking my time',
    ],
  };
  const STALE = 25; // a reaction that could not be said within this long is dropped
  const SETTLE = 4; // seconds after a world starts before anything counts

  const R = {
    IDLE_AFTER: 75, // seconds of quiet before an idle line
    IDLE_GAP: 120, // and at least this long between idle lines (both are settings of the object: tests and playtests shorten them)
    rand: () => Math.random(),
    clock: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000,
  };
  const decks = {}; // kind -> remaining shuffled lines
  const last = {}; // kind -> the last line given
  const history = []; // { kind, text } of what was said

  function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(R.rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
    return b;
  }
  /** The next line of a kind: a deck is used up before it is shuffled again, and never starts with the line just given. */
  function pick(kind) {
    const pool = POOLS[kind];
    if (!pool) return null;
    if (!decks[kind] || !decks[kind].length) {
      let d = shuffle(pool);
      if (d.length > 1 && d[0] === last[kind]) d.push(d.shift());
      decks[kind] = d;
    }
    const text = decks[kind].shift();
    last[kind] = text;
    return text;
  }

  let worldAt = 0;
  let armed = false;
  let quietSince = 0;
  let lastIdle = -1e9;
  let waiting = null; // { kind, at }

  const touch = () => { quietSince = R.clock(); };
  const blocked = () => (H.lines && H.lines.blocked ? H.lines.blocked() : null);

  function deliver(kind) {
    const text = pick(kind);
    if (!text) return false;
    const o = H.overseer;
    if (o && o.speak) o.speak(text, null, 6, { priority: 'normal' });
    else if (H.chat) H.chat.line({ kind: 'overseer', text });
    history.push({ kind, text });
    if (history.length > 60) history.shift();
    if (H.game) try { H.game.emit('reaction', { kind, text }); } catch (err) { if (H.report) H.report(err, 'reactions'); }
    touch();
    return true;
  }
  /** Asks for a reaction of this kind; said when the way is clear. A build or a fail replaces an idle wait. */
  function say(kind) {
    if (!POOLS[kind] || kind === 'think') return false;
    if (waiting && waiting.kind !== 'idle' && kind === 'idle') return false;
    waiting = { kind, at: R.clock() };
    pump();
    return true;
  }
  function pump() {
    if (!waiting) return;
    const t = R.clock();
    if (t - waiting.at > STALE) { waiting = null; return; }
    if (blocked() || (H.work && H.work.active)) return;
    const k = waiting.kind;
    waiting = null;
    if (k === 'idle') lastIdle = t;
    deliver(k);
  }

  H.hooks.frame.push(() => {
    if (!armed) return;
    const t = R.clock();
    if (t - worldAt < SETTLE) return;
    pump();
    if (!waiting && t - quietSince >= R.IDLE_AFTER && t - lastIdle >= R.IDLE_GAP && !(H.work && H.work.active)) say('idle');
  });
  H.hooks.world.push({
    enter() { worldAt = R.clock(); quietSince = worldAt; lastIdle = worldAt; armed = true; waiting = null; },
    leave() { armed = false; },
  });
  H.hooks.game.push((game) => {
    // What the player does keeps the idle line away: building, asking, driving, breaking, catching.
    for (const e of ['spawned', 'landed', 'workStart', 'catch', 'wrecked', 'enter', 'mirror', 'quest']) game.on(e, touch);
    game.on('workEnd', (d) => {
      touch();
      if (!armed || R.clock() - worldAt < SETTLE) return;
      if (d && d.ok === false) say('fail');
      else if (d && (d.ops > 0 || d.beats > 0)) say('build');
    });
  });

  H.reactions = Object.assign(R, {
    POOLS, STALE, SETTLE,
    pick, say, pump,
    /** The work pill's headline while the Overseer thinks (work.js). */
    think: () => pick('think'),
    history: () => history.slice(),
    reset() { for (const k of Object.keys(decks)) delete decks[k]; for (const k of Object.keys(last)) delete last[k]; history.length = 0; waiting = null; },
    get waiting() { return waiting ? waiting.kind : null; },
  });
})();
