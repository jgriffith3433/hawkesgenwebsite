// Studio's playtest scenarios for the portal (contract v1: hawkesstudio/docs/playtest.md). Loaded by a tiny loader on
// the landing page and by play/guest.js on /play/sandbox, only for a browser under automation (navigator.webdriver), a
// `?playtest=` URL or a run already under way (sessionStorage), so a visitor never fetches it.
//
// `sandbox-first-minutes` plays the way a new player does, with real input (keys, clicks and the mouse into the game's
// own input layer; no teleporting): the landing page's Play click > the click-to-enter veil > the Overseer's intro (watch,
// then skip) > the mirror's three questions (a body, a look, a name) > the account sheet (a throwaway sign-up) > Pip's
// tour: walk to the 4x4, drive to the dock, take the rod off the pier and fish. Each stage is a `scene()` (a screenshot)
// and an `event()`; a stage that doesn't happen ends the run as stuck/error naming the stage.
//
// The page changes once (the Play click leaves the landing page for /play/sandbox): the run is kept in sessionStorage and
// the sandbox page carries it on, replaying the events so far, so one report covers the whole path.
//
// `island-race` plays the same way up to the account, then the Ridge Run: into the 4x4, through the start gate (the
// countdown and the clock), every gate in order by steering with the keys, the finish and the best, then once more with the
// ghost of the best run beside you. Options: laps (default 1: a named shortcut for the world's three), touch (the phone
// controls: /play/sandbox?touch=1), signup (as above), ghost: false (one run), watch.
//
// Options: { to: 'veil'|'intro'|'mirror'|'sheet'|'drive'|'fish' (stop after; default 'fish'), signup: false (never sign up;
//   always so on live), fish: 'strict' (a fishing failure fails the run; otherwise it is a warning), watch: seconds of the
//   intro to watch before skipping (default 8), at: 'sandbox' (start on /play/sandbox instead of clicking Play) }.
import { installPlaytest } from './hawkes-playtest.js';

const KEY = 'hg_playtest_run';
const STAGES = ['landing', 'veil', 'intro', 'mirror', 'sheet', 'drive', 'fish', 'chapter', 'presence', 'observatory', 'race', 'board', 'journal'];
// A scenario that is not simply the stages in order names its own (presence-who: the account, then the shared-world stage).
const ORDERS = { 'sandbox-observatory': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'observatory'], 'sandbox-travel-board': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'board'], 'presence-who': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'presence'], 'island-race': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'race'], 'island-journal': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'journal'] };
const SCENARIOS = [
  { id: 'smoke', title: 'Landing, Play click, the veil, the intro skipped', seconds: 50, tags: ['smoke'], description: 'options: none' },
  {
    id: 'sandbox-first-minutes', title: 'Play /play/sandbox as a new player: veil, intro, mirror, sign-up, drive to the dock, fish', seconds: 210, tags: ['full'],
    starts: ['sandbox'],
    description: 'options: to (veil, intro, mirror, sheet, drive, fish), signup (false: never sign up; always off on live), fish ("strict": a fishing failure fails the run), watch (seconds of intro to watch), at ("sandbox")',
  },
  {
    id: 'island-race', title: 'The Ridge Run: through the start gate, the countdown, every gate in order, the finish and best time, then the ghost of the best run', seconds: 330, tags: ['full'],
    starts: ['sandbox'],
    description: 'options: laps (default 1; the world has 3), touch (true: the phone controls, ?touch=1, and the frame rate is measured), ghost (false: one run only), signup (false: stop at the account sheet; always on live), watch (seconds of intro to watch), name, what',
  },
  {
    id: 'island-journal', title: 'The journal: opened from its button (desktop, or the phone at 390x844), the eight quests, the neighbours met, four lore items found on the island and read in it, and kept after a return', seconds: 300, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the account sheet, then the journal with real input (a click on the book button, walking to the lamp, the beach chair, the faded drawing and the scratched rock, E at each); the return is the Overseer\'s memory read back from this device (a named setup shortcut). options as sandbox-first-minutes, plus touch (true: the phone controls, ?touch=1)',
  },
  {
    id: 'sandbox-chapter-one', title: 'Chapter One "What Are You?": the eight quests to the launch pad, the lit bay and the two closing lines', seconds: 420, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path, then quests 6 (walk up to Dolores) and 8 (Rolo\'s rocket) with real input; quests 4, 5 and 7 are named setup shortcuts (the quest line advanced); options as sandbox-first-minutes, plus rocket ("shortcut": skip the climb)',
  },
  {
    id: 'sandbox-observatory', title: 'Docking, the lift to the Observatory: the first arrival (windows, music, the pearl, a gift by name), the quick return, and the way back to the bay', seconds: 330, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the sign-up sheet, then the Observatory with real input (E at the lift, walking in the room, E again); docking itself is a named setup shortcut (the rocket put on the pad, the player beside the lift); options as sandbox-first-minutes, plus again (false: skip the quick return)',
  },
  {
    id: 'sandbox-travel-board', title: 'The Observatory travel board: three featured games as planets with live counts; beam down into each with your character and name, and Return to the Observatory from its pause menu', seconds: 600, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path to the sign-up sheet, then docking (a named setup shortcut) and the lift; at the board it checks the three planets and their live counts, stands under each (a named setup shortcut: the walk across the room) and presses E; the Overseer speaks, the screen fades and the game page opens (a page change: the run crosses it) where it checks the character and name arrived, presses Esc twice, clicks Return to the Observatory and checks it stands at the board again; for all three games. options as sandbox-first-minutes, plus games (a list of ids to visit; default all three)',
  },
  {
    id: 'presence-who', title: 'A shared world: who is there (list, marker or edge arrow), tap a name to beam next to them, mute, an abusive name replaced', seconds: 230, tags: ['full'],
    starts: ['sandbox'],
    description: 'Plays the first minutes to the island (a throwaway sign-up, never on live), then puts two stand-in players in the room (a second browser is not needed: presence.standIn, one far ahead, one behind with an abusive name) and plays the shared-world part with real clicks. options: signup (false: never sign up; always off on live), name, what',
  },
];

const onSandbox = () => /^\/play\/sandbox\/?$/.test(location.pathname);
const onGame = () => /^\/play\/t\/[a-z0-9-]+\/?$/.test(location.pathname) && /[?&]from=observatory\b/.test(location.search);
const isLive = () => /^(www\.)?hawkesgen\.com$/.test(location.hostname);
const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const $ = (s, r = document) => r.querySelector(s);
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const readRun = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } };
const writeRun = (r) => { try { r ? sessionStorage.setItem(KEY, JSON.stringify(r)) : sessionStorage.removeItem(KEY); } catch { /* private mode: the run just can't cross the page */ } };

// ---------------------------------------------------------------------------------------------- real input
const down = new Set();
const keyEv = (type, key) => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
function setKeys(want) { // { w: true, a: false... }: presses and releases to match
  for (const k of ['w', 'a', 's', 'd']) {
    if (want[k] && !down.has(k)) { down.add(k); keyEv('keydown', k); }
    if (!want[k] && down.has(k)) { down.delete(k); keyEv('keyup', k); }
  }
}
const releaseAll = () => { setKeys({}); for (const k of [...down]) { down.delete(k); keyEv('keyup', k); } };
async function tap(t, key, ms = 90) { keyEv('keydown', key); await t.wait(ms); keyEv('keyup', key); }
const canvas = () => $('canvas#c, canvas') || document.querySelector('canvas');
function pointer(type, target, o = {}) {
  target.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse', pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: innerWidth / 2, clientY: innerHeight / 2, ...o }));
}
async function holdMouse(t, ms) { pointer('pointerdown', canvas()); await t.wait(ms); pointer('pointerup', window); }
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const camYaw = () => { try { const y = W().camera.yawNow(); return Number.isFinite(y) ? y : 0; } catch { return 0; } };

/** Turns the camera to `yaw` (radians from +z toward +x) by dragging with the right button, as a player does. The first
 *  drags learn which way the mouse turns it. */
async function lookAt(t, yaw) {
  let sign = 1, last = null, tries = 0;
  while (Math.abs(wrap(yaw - camYaw())) > 0.35) {
    if (++tries > 40) throw new Error('timed out turning the camera');
    const err = wrap(yaw - camYaw());
    if (last !== null && Math.abs(err) > Math.abs(last) + 0.02) sign = -sign; // it got worse: the other way
    last = err;
    const c = canvas();
    pointer('pointerdown', c, { button: 2, buttons: 2 });
    c.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', pointerId: 1, bubbles: true, buttons: 2, movementX: Math.sign(err) * sign * Math.min(120, Math.abs(err) * 160), movementY: 0 }));
    await t.wait(120);
    pointer('pointerup', window, { button: 2 });
    await t.wait(120);
  }
}

/** Walks (W/A/S/D relative to the camera, like a player) until within `near` metres of a thing. */
async function walkTo(t, id, near, timeoutMs, what) {
  const t0 = performance.now();
  for (;;) {
    const p = W() && W().player, g = W() && W().byId.get(id);
    if (!p || !g) throw new Error(`timed out waiting for ${what} to exist`);
    const dx = g.x - p.x, dz = g.z - p.z, d = Math.hypot(dx, dz);
    if (d <= near) break;
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out walking to ${what} (${Math.round(d)} m away after ${Math.round(timeoutMs / 1000)} s)`);
    const yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
    const ax = (dx * c - dz * s) / d, ay = (dx * s + dz * c) / d; // the inverse of game.input.direction()
    setKeys({ w: ay > 0.38, s: ay < -0.38, d: ax > 0.38, a: ax < -0.38 });
    await t.wait(80);
  }
  setKeys({});
}

// ---------------------------------------------------------------------------------------------- the stages
/** One stage's timeout or failure carries its name, so the review reads which part of the path broke. */
const stageError = (name, e) => new Error(`stage "${name}": ${e && e.message ? e.message : e}`);

async function stageLanding(t, ctx) {
  t.scene('Landing');
  await t.until(() => document.readyState === 'complete' && $('[data-play-now]'), 20000, 'the landing page and its Play now button');
  t.event('landing-loaded');
  t.progress(0.04);
  if (ctx.options.at === 'sandbox') { t.event('start-at', 'sandbox: skipped the Play click (named shortcut)'); writeRun({ ...ctx.saved(), landed: true }); location.href = ctx.options.touch ? '/play/sandbox?touch=1' : '/play/sandbox'; await t.wait(30000); return; }
  await t.wait(1500);
  t.event('play-click', 'Play now (the hero button)');
  writeRun({ ...ctx.saved(), landed: true });
  $('[data-play-now]').click(); // enter.js fades the page, then opens /play/sandbox
  await t.wait(25000);
  throw new Error('timed out: the Play click did not leave the landing page');
}

async function stageVeil(t, ctx) {
  t.scene('Sandbox loading');
  await t.until(() => W() && W().player && W().player.alive, 90000, 'the island to load (world and player)');
  t.event('world-ready');
  t.progress(0.14);
  // Where sound is already allowed there is no veil: the intro just starts.
  const veil = await t.until(() => $('.hp-enter button') || (G() && G().overseer && G().overseer.introPlaying), 12000, 'the click-to-enter veil or the intro').then(() => $('.hp-enter button'), () => null);
  if (!veil) { t.event('veil-skipped', 'sound already allowed; the intro went on'); return; }
  t.scene('Entry veil');
  t.event('veil-shown', 'Enter');
  await t.wait(1200);
  veil.click();
  t.event('veil-passed', 'clicked Enter');
  await t.until(() => !$('.hp-enter'), 8000, 'the veil to fade after Enter (the sound did not unlock?)');
}

async function stageIntro(t, ctx) {
  const g = () => G() && G().overseer;
  const started = await t.until(() => g() && g().introPlaying, 25000, 'the Overseer\'s intro to start').then(() => true, () => false);
  if (!started) {
    if ($('.mr')) { t.event('intro-not-played', 'the mirror was already open'); return; }
    throw new Error('timed out waiting for the Overseer\'s intro to start');
  }
  t.scene('Intro');
  t.event('intro-start');
  t.progress(0.2);
  const watch = Number(ctx.options.watch ?? 8);
  await t.until(() => !g().introPlaying, watch * 1000, 'the intro to run').then(() => t.event('intro-ended', 'watched to the end'), async () => {
    t.event('intro-watched', `${watch} s`);
    await tap(t, 'Enter'); // any key skips (a moment after it starts)
    await t.until(() => !g().introPlaying, 6000, 'the intro to stop after a key');
    t.event('intro-skipped', 'a key press');
  });
  t.progress(0.3);
}

async function stageMirror(t, ctx) {
  await t.until(() => $('.mr .mr-q'), 40000, 'the mirror to open after the intro');
  const question = () => ($('.mr .mr-q') || {}).textContent || '';
  t.scene('Mirror: what are you');
  t.event('mirror-open', question());
  await t.wait(1200);
  const want = ctx.options.what || 'toaster';
  const card = $(`.mr [data-what="${want}"]`) || $('.mr [data-what]');
  if (!card) throw new Error('the mirror shows no body to choose');
  const chosen = card.dataset.what;
  card.click();
  t.event('mirror-answer', `what: ${chosen}`);
  await t.wait(1000);
  const next = async (from) => { $('.mr [data-a="next"]').click(); await t.until(() => question() !== from, 8000, `the mirror to leave "${from}"`); };
  await next(question());
  t.scene('Mirror: how do you look');
  t.event('mirror-step', question());
  await t.wait(600);
  const dice = $('.mr [data-a="randomLook"]');
  if (dice) { dice.click(); t.event('mirror-answer', 'look: surprise me'); await t.wait(1000); }
  await next(question());
  t.scene('Mirror: what are you called');
  t.event('mirror-step', question());
  const name = await t.until(() => $('.mr .mr-name:not(.mr-model)'), 8000, 'the name field').then(() => $('.mr .mr-name:not(.mr-model)'));
  const who = ctx.options.name || `Tester ${rand(3)}`;
  name.focus();
  name.value = who;
  name.dispatchEvent(new Event('input', { bubbles: true }));
  t.event('mirror-answer', `name: ${who}`);
  await t.wait(1200);
  name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); // Enter in the field is "That's me"
  await t.until(() => !$('.mr'), 10000, 'the mirror to close after the last answer');
  t.event('mirror-done', `${chosen}, ${who}`);
  t.progress(0.45);
}

async function stageSheet(t, ctx) {
  await t.until(() => $('#gsEmail'), 20000, 'the account sheet to open after the mirror');
  t.scene('Account sheet');
  t.event('sheet-shown', ($('#gsTitle') || {}).textContent || '');
  await t.wait(1500);
  if (ctx.options.signup === false || isLive()) {
    t.event('signup-skipped', isLive() ? 'live site: a playtest never signs up' : 'signup: false');
    t.finish('done');
    return 'stop';
  }
  const health = await fetch('/v1/health').then((r) => r.json()).catch(() => ({}));
  if (health.mail) throw new Error('this server sends mail (PORTAL_MAIL is on): refusing to sign up a throwaway account here');
  t.event('mail-off', 'the server reports mail: false, so no email goes out');
  const swap = $('#gsSwap [data-swap]');
  if (swap && /create/i.test(swap.textContent)) swap.click();
  const email = `playtest-${Date.now().toString(36)}${rand(5)}@example.com`; // example.com is reserved: it can never be real mail
  const set = (id, v) => { const el = $(id); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#gsEmail', email);
  await t.wait(500);
  set('#gsPw', `Pt-${rand(14)}`);
  t.event('signup-submit', `throwaway ${email.replace(/^[^@]+/, 'playtest-…')}`);
  await t.wait(800);
  $('#gsGo').click();
  // Closed on success; on failure the sheet shows why.
  await t.until(() => !$('#gsEmail') || ($('#gsErr') && !$('#gsErr').hidden && $('#gsErr').textContent.trim()), 25000, 'the sign-up to answer');
  if ($('#gsEmail')) throw new Error(`the sign-up was refused: ${$('#gsErr').textContent.trim().slice(0, 160)}`);
  t.event('signup-ok', 'the account was made; the island carries on');
  t.progress(0.6);
}

async function stageDrive(t, ctx) {
  const q = () => G() && G().events && G().events.quests;
  const step = () => (q() && q().state('tour') === 'active' ? q().step('tour') : null);
  t.scene('Island: the tour begins');
  await t.until(() => step() === 'drive' || step() === 'rod', 90000, 'Pip\'s tour to start (the "drive" step)');
  t.event('tour-start', `step: ${step()}`);
  t.progress(0.65);
  await t.wait(2500);
  const jeep = () => W().byId.get('jeep');
  const driving = () => G().player && G().player.controller === 'drive';
  if (step() === 'drive') {
    if (!driving()) {
      await walkTo(t, 'jeep', 3.2, 40000, 'the 4x4');
      t.event('at-the-4x4');
      for (let i = 0; i < 4 && !driving(); i++) { await tap(t, 'e'); await t.wait(700); }
      if (!driving()) throw new Error('timed out getting into the 4x4 with E');
    }
    t.scene('Island: driving');
    t.event('drive-start', 'in the 4x4, W held');
    keyEv('keydown', 'w'); down.add('w');
    // Steer to the dock by the 4x4's own heading. Which way D turns it is learned: if the error grows while steering, flip.
    let sign = 1, bad = 0, ref = null;
    const t0 = performance.now();
    while (step() === 'drive') {
      if (performance.now() - t0 > 70000) throw new Error('timed out driving to the dock (the "drive" step never passed)');
      const v = jeep().vehicle, dock = W().byId.get('dock');
      if (!v || !dock) throw new Error('timed out: the 4x4 or the dock is gone');
      const tx = dock.x - jeep().x, tz = dock.z - jeep().z;
      const err = Math.atan2(tx * v.right.x + tz * v.right.z, tx * v.fwd.x + tz * v.fwd.z); // + : the dock is to the right
      if (ref && performance.now() - ref.at > 700) { if (Math.abs(err) > Math.abs(ref.err) + 0.08) { if (++bad >= 2) { sign = -sign; bad = 0; } } else bad = 0; ref = null; }
      if (!ref && Math.abs(err) > 0.3) ref = { at: performance.now(), err };
      const steer = Math.abs(err) > 0.1 ? Math.sign(err) * sign : 0;
      for (const [k, on] of [['d', steer > 0], ['a', steer < 0]]) { if (on && !down.has(k)) { down.add(k); keyEv('keydown', k); } if (!on && down.has(k)) { down.delete(k); keyEv('keyup', k); } }
      await t.wait(100);
    }
    releaseAll();
    t.event('dock-reached', 'the "drive" step passed');
    t.metric('driveSeconds', Math.round((performance.now() - t0) / 100) / 10);
  }
  t.scene('Island: at the dock');
  t.progress(0.75);
  await t.wait(2500); // Pip's line and the Overseer's
}

/** Shared world: two players in the room. The second is a stand-in (presence.standIn: a named setup shortcut, since one
 *  browser cannot be two players); everything else is what a player does: the 👥 button, a tap on a name, Mute, Report. */
async function stagePresence(t) {
  const P = () => HP().presence;
  const click = (el) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); el.click(); };
  await t.until(() => W() && W().player && P() && P().standIn, 30000, 'the island with its presence module');
    const mira = P().standIn('Mira', { ahead: 45, color: '#f59e0b' });
  const rude = P().standIn('fuck you', { ahead: -50, color: '#ef4444' });
  if (!mira || !rude) throw new Error('could not put a second player in the room');
  t.event('second-player', 'Mira 45 m ahead; a player with an abusive name 50 m behind');
  await t.until(() => P().markers.length >= 2, 8000, 'a marker or an edge arrow for each other player');
  const mk = P().markers;
  t.event('markers', mk.map((m) => `${m.name}: ${m.mode}`).join(', '));
  t.scene('Shared world: markers');
  // The list: 👥 opens Who's here.
  const btn = $('#pr-hud [data-a=people]');
  if (!btn) throw new Error('timed out: the 👥 button is not on screen');
  click(btn);
  await t.until(() => $('.pr-panel:not([hidden]) .pr-row[data-id="' + mira + '"]'), 5000, "Who's here to list the other player");
  const rows = [...document.querySelectorAll('.pr-panel .pr-row .nm')].map((n) => n.textContent);
  t.event('people-listed', rows.join(' | '));
  if (rows.some((n) => /fuck/i.test(n))) throw new Error('the abusive name is shown in Who\'s here: ' + rows.join(' | '));
  t.event('name-replaced', 'the abusive name shows as a Player number');
  t.scene("Shared world: who's here");
  // Tap their name: beamed next to them.
  const p0 = { x: W().player.x, z: W().player.z };
  click($('.pr-panel .pr-row[data-id="' + mira + '"] .nm'));
  await t.until(() => P().lastGo && Math.hypot(W().player.x - W().entities.find((e) => e.netId === mira).x, W().player.z - W().entities.find((e) => e.netId === mira).z) < 5, 6000, 'the player to be beamed next to Mira');
  t.event('teleported', 'moved ' + Math.round(Math.hypot(W().player.x - p0.x, W().player.z - p0.z)) + ' m next to Mira');
  await t.until(() => W().scene.meshes.some((m) => /beam/.test(m.name) && m.isEnabled()), 3000, 'the beam').then(() => t.event('beam-seen'), () => t.problem('warning', 'no beam mesh was seen'));
  t.scene('Shared world: next to Mira');
  await t.wait(1600);
  // Mute her, report the other.
  click(btn);
  await t.until(() => $('.pr-panel:not([hidden]) .pr-row[data-id="' + mira + '"] [data-a=mute]'), 5000, "Who's here again");
  click($('.pr-panel .pr-row[data-id="' + mira + '"] [data-a=mute]'));
  await t.until(() => P().muted(mira), 3000, 'Mira to be muted');
  t.event('muted', 'Mira');
  click($('.pr-panel .pr-row[data-id="' + rude + '"] [data-a=report]'));
  await t.until(() => P().reported(rude), 3000, 'the other player to be reported');
  t.event('reported', 'the player with the replaced name');
  t.scene('Shared world: muted and reported');
  P().mute(mira, false);
  P().removeStandIns();
  t.progress(1);
  await t.wait(1500);
}

async function stageFish(t, ctx) {
  const q = () => G().events.quests;
  const step = () => (q().state('tour') === 'active' ? q().step('tour') : null);
  const strict = ctx.options.fish === 'strict';
  try {
    if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
    t.scene('Island: the pier');
    await t.until(() => step() === 'rod' || step() === 'fish', 8000, 'the tour to ask for the rod');
    if (step() === 'rod') {
      await walkTo(t, 'rod', 0.7, 45000, 'the fishing rod at the end of the pier');
      await t.until(() => step() !== 'rod', 8000, 'the rod to be picked up');
      t.event('rod-picked-up');
    }
    t.progress(0.85);
    await t.wait(1200);
    const heldRod = () => { try { const h = HP().tools.held; return h && h.name === 'rod'; } catch { return false; } };
    for (const k of ['1', '2', '3', '4']) { if (heldRod()) break; await tap(t, k); await t.wait(250); }
    if (!heldRod()) throw new Error('timed out: the rod is not in hand after picking it up');
    await lookAt(t, Math.PI / 2); // out to sea, east
    t.scene('Island: fishing');
    let bit = false;
    G().on('bite', () => { bit = true; });
    for (let cast = 1; cast <= 4 && step() === 'fish'; cast++) {
      bit = false;
      await holdMouse(t, 900 + cast * 150);
      t.event('cast', `cast ${cast}`);
      const bitten = await t.until(() => bit || step() !== 'fish', 22000, 'a bite').then(() => bit, () => false);
      if (!bitten) { t.event('no-bite', `cast ${cast}`); continue; }
      t.event('bite');
      pointer('pointerdown', canvas()); await t.wait(90); pointer('pointerup', window); // hook it
      pointer('pointerdown', canvas()); // and reel while held
      await t.until(() => step() !== 'fish', 14000, 'the fish to be landed').then(() => 0, () => 0);
      pointer('pointerup', window);
    }
    if (step() === 'fish') throw new Error('timed out: no fish was caught in four casts');
    t.event('fish-caught', 'the "fish" step passed');
    t.scene('Island: a fish caught');
    t.progress(1);
    await t.wait(2500);
  } catch (e) {
    if (strict) throw e;
    t.problem('warning', `fishing did not complete: ${e.message}`);
    t.event('fish-incomplete', e.message);
  } finally { pointer('pointerup', window); }
}

// ---------------------------------------------------------------------------------------------- the Ridge Run
/** Steers the 4x4 at a point (engine numbers) with the keys, as a careful driver: turn by the heading error (the 4x4's own
 *  right/forward: a target on the right = D), throttle when it is roughly ahead, brake for a sharp bend, and back out for a
 *  moment when it has stopped against something. Checked against the island's course by a keyboard bot (the engine test
 *  rig): a lap of the Ridge Run in about 30 s. `then` is the point after the target: near the target it aims between. */
const steer = { last: null, slow: 0, back: 0 };
function steerAt(jeep, target, then) {
  const v = jeep.vehicle, now = performance.now();
  const spd = steer.last ? Math.hypot(jeep.x - steer.last[0], jeep.z - steer.last[1]) / Math.max(0.02, (now - steer.last[2]) / 1000) : 0;
  const dt = steer.last ? (now - steer.last[2]) / 1000 : 0.1;
  steer.last = [jeep.x, jeep.z, now];
  let aim = target;
  if (then && Math.hypot(target[0] - jeep.x, target[2] - jeep.z) < 16) aim = [(target[0] * 2 + then[0]) / 3, target[1], (target[2] * 2 + then[2]) / 3];
  const tx = aim[0] - jeep.x, tz = aim[2] - jeep.z;
  const err = Math.atan2(tx * v.right.x + tz * v.right.z, tx * v.fwd.x + tz * v.fwd.z); // + : the target is to the right
  if (spd < 1) steer.slow += dt; else if (spd > 3) steer.slow = 0;
  const keys = { w: false, s: false, a: false, d: false };
  if (steer.back > 0) { steer.back -= dt; keys.s = true; keys[err > 0 ? 'a' : 'd'] = true; }
  else if (steer.slow > 2) { steer.slow = 0; steer.back = 1.4; }
  else {
    if (Math.abs(err) < 0.5 || spd < 5) keys.w = true; else if (Math.abs(err) > 1.0 && spd > 8) keys.s = true;
    if (Math.abs(err) > 0.07) keys[err > 0 ? 'd' : 'a'] = true;
  }
  setKeys(keys);
  return { err, dist: Math.hypot(target[0] - jeep.x, target[2] - jeep.z), spd };
}

async function stageRace(t, ctx) {
  const race = () => G() && G().race;
  await t.until(() => race() && race().courses && race().courses.length && G().vehicles, 90000, 'the island\'s race courses');
  const laps = Math.max(1, Number(ctx.options.laps ?? 1));
  race().setLaps('ridge', laps);
  const course = race().courses.find((c) => c.id === 'ridge');
  const g0 = course.gates[0];
  t.event('race-ready', `${course.name}: ${laps} lap${laps > 1 ? 's' : ''}, ${course.gates.length} gates${ctx.options.touch ? ', touch controls' : ''}`);
  t.progress(0.62);
  await t.wait(2500);
  const jeep = () => W().byId.get('jeep');
  const driving = () => G().player && G().player.controller === 'drive';
  const seen = [];
  G().on('race', (d) => { seen.push(d); if (d.state === 'gate') t.event('gate', `${d.index} of ${d.of}${d.delta !== null && d.delta !== undefined ? ` (${d.delta > 0 ? '+' : ''}${(d.delta / 1000).toFixed(2)} s)` : ''}`); else if (d.state === 'lap') t.event('lap', `${d.lap} of ${d.laps}`); else if (d.state === 'go') t.event('go', d.ghost ? 'with the ghost' : 'no ghost yet'); else if (d.state === 'countdown') t.event('countdown', String(d.n)); });
  if (!driving()) {
    await walkTo(t, 'jeep', 3.2, 60000, 'the 4x4');
    for (let i = 0; i < 4 && !driving(); i++) { await tap(t, 'e'); await t.wait(700); }
    if (!driving()) throw new Error('timed out getting into the 4x4 with E');
  }
  t.event('in-the-4x4');
  const local = (x, y, z) => G().planet.toLocal([x, y, z]);
  const planetOf = (e) => { const q = G().planet.toPlanet([e.x, e.y, e.z]); return { x: q[0], z: q[2] }; };
  // The start gate faces the way its course runs; the run in is from behind it.
  const dir = (() => { const n = course.gates.length, a = course.gates[n - 1], b = course.gates[1], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return { x: dx / l, z: dz / l }; })();

  const oneRun = async (label) => {
    const before = seen.length;
    let t0 = performance.now();
    // 1) to the start gate, from behind
    t.scene(`Race: to the start gate${label}`);
    while (race().state.phase === 'idle') {
      if (performance.now() - t0 > 90000) throw new Error('timed out driving through the start gate (no countdown began)');
      const j = jeep(), p = planetOf(j);
      const s = (p.x - g0.x) * dir.x + (p.z - g0.z) * dir.z;
      const lat = (p.x - g0.x) * -dir.z + (p.z - g0.z) * dir.x;
      // Behind and lined up: straight at the gate; else the point 30 m behind it first.
      const lined = s < -6 && Math.abs(lat) < 8 ? g0 : { x: g0.x - dir.x * 30, y: g0.y, z: g0.z - dir.z * 30 };
      const tg = local(lined.x, lined.y ?? g0.y, lined.z);
      steerAt(j, tg, null);
      await t.wait(80);
    }
    t.event('countdown-started', 'through the start gate');
    t.scene(`Race: countdown${label}`);
    setKeys({});
    await t.until(() => race().state.phase === 'running', 8000, 'GO after the countdown');
    t.scene(`Race: GO${label}`);
    t.event('race-go', `lit gates ahead; ${label ? 'ghost' : 'no ghost'}`);
    t.progress(0.7);
    // 2) the gates in order
    let frames = 0, last = performance.now(), worst = 0;
    const raf = () => { const n = performance.now(); frames++; worst = Math.max(worst, n - last); last = n; if (race().state.phase === 'running') requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    const tRun = performance.now();
    let shot = 0, ghostSeen = false;
    t0 = performance.now();
    while (race().state.phase === 'running') {
      if (performance.now() - t0 > 160000) throw new Error(`timed out on the course (checkpoint ${race().state.checkpoint} of ${race().state.of})`);
      const st = race().state, gate = course.gates[st.next], j = jeep();
      if (!j || !gate) break;
      const nx = course.gates[(st.next + 1) % course.gates.length];
      steerAt(j, local(gate.x, gate.y, gate.z), local(nx.x, nx.y, nx.z));
      if (st.checkpoint >= 2 && !shot) { shot = 1; t.scene(`Race: gates lit in order${label}`); }
      if (label && !ghostSeen && [...W().entities].some((e) => e.tag === 'race-ghost' && e.alive && e.visible !== false)) { ghostSeen = true; t.event('ghost-running', 'the ghost of the best run is on the course'); t.scene('Race: the ghost beside you'); }
      await t.wait(80);
    }
    releaseAll();
    const secs = (performance.now() - tRun) / 1000;
    t.metric(`raceFps${label ? 'Ghost' : ''}`, Math.round(frames / secs));
    t.metric(`raceWorstFrameMs${label ? 'Ghost' : ''}`, Math.round(worst));
    const fin = seen.slice(before).find((d) => d.state === 'finish');
    if (!fin) {
      const gone = seen.slice(before).find((d) => d.state === 'abort');
      throw new Error(gone ? `the race was called off (${gone.why})` : 'the run ended with no finish');
    }
    t.scene(`Race: finish${label}`);
    t.event('race-finish', `${(fin.ms / 1000).toFixed(2)} s${fin.isBest ? ', new best' : ''}${fin.previous ? ` (before: ${(fin.previous / 1000).toFixed(2)} s)` : ''}${fin.beatGhost ? ', beat the ghost' : ''}`);
    await t.wait(2200);
    return fin;
  };

  const first = await oneRun('');
  if (!first.isBest) t.problem('warning', 'the first finish was not reported as the best time');
  t.event('best-kept', `best ${(race().best('ridge') / 1000).toFixed(2)} s`);
  t.progress(0.85);
  if (ctx.options.ghost === false) { t.progress(1); return; }
  await t.until(() => race().state.phase === 'idle', 6000, 'the start gate to listen again');
  await t.wait(2500);
  const second = await oneRun(' (second run)');
  t.event('race-compare', `${(first.ms / 1000).toFixed(2)} s then ${(second.ms / 1000).toFixed(2)} s${second.beatGhost ? ' - beat the ghost' : ''}`);
  t.progress(1);
}

/** Chapter One's last quests. Setup shortcuts (named in the timeline): quests 4, 5 and 7 are advanced through the quest line;
 *  quests 6 and 8 are played with real input: walk up to Dolores, then fill and fly Rolo's rocket. */
async function stageChapter(t, ctx) {
  const q = () => G().events.quests;
  const step = () => (q().state('tour') === 'active' ? q().step('tour') : null);
  const seen = [];
  G().on('tour', (d) => { seen.push(d.step); t.event('quest-done', d.step); });
  G().on('beat', (d) => t.event('islander-line', `${d.who}: ${d.text}`));
  G().on('bay-lit', () => t.event('bay-lit', 'the Overseer\'s bay is lit on the sphere'));
  const shortcut = async (until, why) => {
    for (let i = 0; i < 9 && step() && step() !== until; i++) { t.event('setup-shortcut', `${why}: passed "${step()}"`); q().advance('tour'); await t.wait(1500); }
  };
  releaseAll();
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  await shortcut('hill', 'quests 2 to 5 (the tour so far)');
  if (step() !== 'hill') throw new Error(`the quest line is on "${step()}", not the hill`);
  t.scene('Quest 6: up the hill');
  await walkTo(t, 'dolores', 3.2, 70000, 'Dolores on the hill');
  await t.until(() => step() !== 'hill', 12000, 'Dolores to say hello (the hill quest)');
  t.event('hill-hello', 'Dolores greeted the player; quest 6 passed');
  t.scene('Quest 6: Dolores says hello');
  await t.wait(3500);
  await shortcut('launch', 'quest 7 (the helicopter flight)');
  if (step() !== 'launch') throw new Error(`the quest line is on "${step()}", not the launch pad`);
  t.scene('Quest 8: Rolo\'s rocket');
  await t.wait(2500);
  await walkTo(t, 'rocket', 4.5, 80000, 'Rolo\'s rocket on the launch pad');
  const riding = () => { try { const r = HP().vehicles && HP().vehicles.current; return Boolean(r && r.alive); } catch { return false; } };
  for (let i = 0; i < 4 && !riding(); i++) { await tap(t, 'e'); await t.wait(900); } // (the first E fills the tank, the next gets in)
  t.event(riding() ? 'rocket-boarded' : 'rocket-not-boarded');
  if (riding() && ctx.options.rocket !== 'shortcut') {
    keyEv('keydown', ' ');
    t.scene('Quest 8: the burn');
    await t.until(() => step() !== 'launch', 60000, 'the rocket to carry the player up until the planet is whole').catch(() => {});
    keyEv('keyup', ' ');
  }
  if (step() === 'launch') { t.problem('warning', 'the climb did not reach the planet in time; the last step was passed by a setup shortcut'); t.event('setup-shortcut', 'planet whole (sandbox-planet)'); G().emit('sandbox-planet', { height: 1000, mine: true }); }
  await t.until(() => q().state('tour') === 'done', 15000, 'the chapter to end');
  t.scene('Chapter One: the lit bay');
  await t.wait(7000); // Pip's "Huh. That's new." and the Overseer's closing line
  t.event('chapter-end', 'quests done: ' + seen.join(', '));
  t.progress(1);
}

/** The Observatory. Docking itself is a named setup shortcut (the rocket put on the pad, the player on foot beside the lift);
 *  the rest is played: E at the lift, the first arrival, walking in the room, E at the lift down, and later the quick return. */
async function stageObservatory(t, ctx) {
  const OB = () => HP().overseer && HP().overseer.observatory;
  const seen = [];
  G().on('observatory', (d) => { seen.push(d.state); t.event(`observatory-${d.state}`, d.first ? 'the first time' : 'a return'); });
  G().on('observatory-gift', (d) => t.event('observatory-gift', `${d.label} (${d.gift})`));
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && OB() && OB().on, 60000, 'the Overseer\'s hangar and lift to exist');
  if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
  const toBay = () => {
    const hg = HP().overseer.hangar, rocket = G().entity('rocket'), l = OB().lift;
    if (rocket) { rocket.position = [hg.pad[0], hg.pad[1] + 3, hg.pad[2]]; rocket.velocity = [0, 0, 0]; }
    W().player.position = [l[0], l[1] + 1.2, l[2] - 1];
  };
  t.event('setup-shortcut', 'docked: the rocket on the pad, the player by the lift in the hangar');
  toBay();
  await t.wait(2500);
  t.scene('The hangar: the lift');
  const t0 = performance.now();
  for (let i = 0; i < 4 && OB().state === 'bay'; i++) { await tap(t, 'e'); await t.wait(700); }
  await t.until(() => OB().state === 'inside', 15000, 'the lift to reach the Observatory');
  t.event('observatory-reached', `${Math.round(performance.now() - t0)} ms after E`);
  t.scene('The Observatory: arrival');
  t.event('observatory-music', OB().music ? 'the music bed is playing' : 'no music bed');
  await t.wait(9000);
  t.scene('The Observatory: the pearl and the windows');
  t.event('observatory-pearl', 'the Overseer\'s light-form at ' + OB().pearl.map((x) => Math.round(x)).join(', '));
  // Look round for a while, as a player does: a short walk forward and back.
  setKeys({ w: true }); await t.wait(1600); setKeys({ s: true }); await t.wait(1600); setKeys({});
  await t.until(() => OB().gift || !OB().first, 45000, 'the gift');
  t.event('observatory-gift-given', `the gift: ${OB().gift}`);
  try { const log = HP().speech && HP().speech.log; if (log) for (const l of log.slice(-8)) t.event('overseer-said', String(l.text || l).slice(0, 200)); } catch { /* no log */ }
  t.scene('The Observatory: the gift');
  await t.until(() => !OB().scene, 45000, 'the first-arrival scene to end');
  await t.wait(2000);
  t.scene('The Observatory: the question left open');
  // The way down: E at the lift.
  const l = OB().liftRoom;
  W().player.position = [l[0], l[1] + 0.4, l[2] - 1];
  await t.wait(500);
  const t1 = performance.now();
  for (let i = 0; i < 4 && OB().state === 'inside'; i++) { await tap(t, 'e'); await t.wait(700); }
  await t.until(() => OB().state === 'bay', 15000, 'the lift down to the bay');
  const rocket = G().entity('rocket');
  t.event('back-in-bay', `${Math.round(performance.now() - t1)} ms; the rocket ${rocket && rocket.alive ? 'is there' : 'is missing'}; controls ${W().player.controls === false ? 'LOCKED' : 'free'}`);
  if (W().player.controls === false) throw new Error('the player was left without controls after the lift down');
  t.scene('Back in the bay, beside the rocket');
  await t.wait(2500);
  if (ctx.options.again !== false) {
    toBay();
    await t.wait(1500);
    const t2 = performance.now();
    const say0 = (HP().speech && HP().speech.log ? HP().speech.log.length : 0);
    for (let i = 0; i < 4 && OB().state === 'bay'; i++) { await tap(t, 'e'); await t.wait(700); }
    await t.until(() => OB().state === 'inside' && !OB().scene, 12000, 'the quick return');
    await t.until(() => (HP().speech && HP().speech.log ? HP().speech.log.length : 1) > say0 || performance.now() - t2 > 9000, 10000, 'its short line').catch(() => {});
    const ms = Math.round(performance.now() - t2);
    t.event('observatory-return', `${ms} ms from E to the room and its line (${ms < 10000 ? 'under' : 'OVER'} 10 s)`);
    t.scene('The Observatory: a quick return');
    if (ms >= 10000) t.problem('error', `the quick return took ${ms} ms`);
    await t.wait(2500);
    OB().leave();
    await t.until(() => OB().state === 'bay', 15000, 'the lift down again');
    t.event('back-in-bay', 'the second time');
  }
  t.event('observatory-done', seen.join(', '));
  t.progress(1);
}

/** The journal: open it from its button, find lore with E on the island, read it in the journal, and see it kept after a return. */
async function stageJournal(t, ctx) {
  const J = () => window.__island && window.__island.journal;
  const shown = () => { const el = $('.jr'); return Boolean(el && !el.hidden); };
  const summary = () => { const m = J().model(); return `quests ${m.done}/8, met ${m.cast.filter((c) => c.met).length}/6, lore ${m.lore.filter((l) => l.found).length}/12`; };
  G().on('lore-found', (d) => t.event('lore-found', `${d.n}. ${d.title}`));
  releaseAll();
  await t.until(() => J() && $('.jr-btn'), 20000, 'the journal button');
  const vw = window.innerWidth;
  t.event('viewport', `${vw}x${window.innerHeight}`);
  $('.jr-btn').click();
  await t.until(shown, 5000, 'the journal to open');
  const html = $('.jr').innerHTML;
  const eight = (html.match(/class="jr-q /g) || []).length;
  t.event('journal-opened', `${summary()}; ${eight} quests listed; the panel is ${Math.round($('.jr').getBoundingClientRect().width)} px wide and ends ${Math.round(window.innerHeight - $('.jr').getBoundingClientRect().bottom)} px above the bottom`);
  if (eight !== 8) t.problem('error', `the journal lists ${eight} quests, not 8`);
  t.scene('Journal: opened');
  await t.wait(1500);
  keyEv('keydown', 'Escape'); keyEv('keyup', 'Escape');
  await t.until(() => !shown(), 4000, 'Esc to close the journal');
  t.event('journal-closed');
  // Lore on the island: walk to each and press E.
  const before = J().model().lore.filter((l) => l.found).length;
  for (const [id, name] of [['lore_chair', 'the beach chair'], ['lamp_a', 'the dock lamp'], ['lore_drawing', 'the faded drawing'], ['lore_rock', 'the scratched rock']]) {
    try {
      await walkTo(t, id, 1.9, 70000, name);
      await t.wait(400);
      await tap(t, 'e');
      await t.wait(900);
      t.scene(`Lore: ${name}`);
    } catch (e) { t.problem('warning', `could not walk to ${name}: ${e.message}`); }
  }
  let found = J().model().lore.filter((l) => l.found).length - before;
  if (found < 4) {
    for (const id of ['chair', 'lamp', 'drawing', 'tally']) if (!J().model().lore.find((l) => l.id === id).found) { t.event('setup-shortcut', `found ${id} (could not be reached on foot in time)`); J().find(id); }
    found = J().model().lore.filter((l) => l.found).length - before;
  }
  t.event('lore-found-total', `${found} found by walking and E`);
  $('.jr-btn').click();
  await t.until(shown, 5000, 'the journal to open again');
  const text = $('.jr').innerHTML;
  const withText = J().model().lore.filter((l) => l.found && text.includes(l.title)).length;
  t.event('journal-lore', `${summary()}; ${withText} found items are in the journal with their text`);
  t.scene('Journal: lore found');
  if (withText < 4) t.problem('error', `only ${withText} found lore items show in the journal`);
  await t.wait(1500);
  $('.jr-x').click();
  await t.until(() => !shown(), 4000, 'the journal to close');
  // After a return: the Overseer's memory read back from this device (a named shortcut: the page itself is not reloaded).
  const mem = HP().memory;
  const had = mem.journal.get();
  t.event('setup-shortcut', 'return: the Overseer\'s memory re-read from the device');
  mem.reload();
  const back = mem.journal.get();
  t.event('kept-after-return', `lore ${back.lore.length} (had ${had.lore.length}), neighbours met ${back.met.length} (had ${had.met.length})`);
  if (back.lore.length < had.lore.length || back.met.length < had.met.length) t.problem('error', 'the journal lost something on a return');
  J().open('playtest');
  await t.wait(800);
  t.scene('Journal: after a return');
  J().close();
  t.event('journal-done', summary());
  t.progress(1);
}

const GAMES = [['fps-arena', 'Bot Arena'], ['sky-racer', 'Sky Racer'], ['platform-run', 'Leap']];
/** The travel board (docs/story.md, "The travel board"). On the sandbox: dock (a named shortcut), the lift, the board's three
 *  planets and their live counts, then E under the next game. On the game's page (stageGame) and back again, three times. */
async function stageBoard(t, ctx) {
  const OB = () => HP().overseer && HP().overseer.observatory;
  const games = Array.isArray(ctx.options.games) && ctx.options.games.length ? GAMES.filter((g) => ctx.options.games.includes(g[0])) : GAMES;
  G() && G().on('observatory', (d) => { if (['travel', 'beam-down', 'return', 'enter', 'ready'].includes(d.state)) t.event(`observatory-${d.state}`, d.name || d.game || ''); });
  releaseAll();
  await t.until(() => W() && W().player && W().player.alive && OB() && OB().on, 60000, 'the Overseer\'s hangar and the Observatory to exist');
  const visit = ctx.visit || 0;
  if (ctx.leg === 'back') {
    await t.until(() => OB().state === 'inside' && !OB().traveling, 40000, 'the beam back into the Observatory');
    const b = OB().board[1], p = W().player.position;
    const d = Math.hypot(p[0] - b.at[0], p[2] - b.at[2]);
    t.event('returned-to-board', `${Math.round(d)} m from the middle planet; controls ${W().player.controls === false ? 'LOCKED' : 'free'}`);
    await t.until(() => W().player.controls !== false, 8000, 'the controls to come back');
    if (d > 12) t.problem('error', `back from ${games[visit - 1] ? games[visit - 1][1] : 'the game'} but ${Math.round(d)} m from the board`);
    t.scene(`Back at the board${games[visit - 1] ? ` from ${games[visit - 1][1]}` : ''}`);
    await t.wait(2500);
    if (visit >= games.length) { t.event('board-done', `${games.length} games visited and returned from`); t.progress(1); return; }
  } else {
    if (G().player.controller === 'drive') { await tap(t, 'e'); await t.wait(900); }
    const hg = HP().overseer.hangar, rocket = G().entity('rocket'), l = OB().lift;
    if (rocket) { rocket.position = [hg.pad[0], hg.pad[1] + 3, hg.pad[2]]; rocket.velocity = [0, 0, 0]; }
    W().player.position = [l[0], l[1] + 1.2, l[2] - 1];
    t.event('setup-shortcut', 'docked: the rocket on the pad, the player by the lift in the hangar');
    await t.wait(2500);
    for (let i = 0; i < 4 && OB().state === 'bay'; i++) { await tap(t, 'e'); await t.wait(700); }
    await t.until(() => OB().state === 'inside', 15000, 'the lift to reach the Observatory');
    if (OB().scene) { t.event('setup-shortcut', 'the first-arrival scene skipped (its own scenario plays it)'); OB().skip(); }
    await t.wait(1500);
  }
  // The board.
  await t.until(() => OB().board.length === 3 && OB().board.every((b) => b.count !== null), 25000, 'the board\'s live counts').catch(() => t.problem('warning', 'the planets showed no live counts'));
  const board = OB().board;
  t.event('board-listed', board.map((b) => `${b.name}: ${b.count === null ? '?' : b.count} playing`).join('; '));
  if (board.length !== 3) throw new Error(`the board lists ${board.length} planets, not 3`);
  const [id, name] = games[visit];
  const target = board.find((b) => b.id === id);
  const look = HP().presence && HP().presence.look;
  ctx.name = look && look.name; ctx.what = look && look.what; ctx.visit = visit + 1;
  t.event('setup-shortcut', `walked across the room: standing under ${name}`);
  W().player.position = [target.at[0], target.at[1] + 0.5, target.at[2]];
  await t.wait(1200);
  t.scene(`The travel board: ${name}`);
  G().on('observatory', (d) => { if (d.state === 'beam-down') writeRun({ ...ctx.saved(), leg: 'game', visit: visit + 1 }); });
  for (let i = 0; i < 5 && !OB().traveling; i++) { await tap(t, 'e'); await t.wait(700); }
  await t.until(() => OB().traveling, 5000, `E under ${name} to start the trip`);
  t.event('travel-chosen', `${name} (${(target.count === null ? '?' : target.count)} playing)`);
  await t.wait(2200);
  t.scene(`Beamed away to ${name}`);
  await t.wait(30000); // (the page changes; this never finishes)
  throw new Error(`the beam-down to ${name} did not open the game`);
}

/** On a featured game's page: the character arrived, then Esc twice and Return to the Observatory. */
async function stageGame(t, ctx) {
  const tpl = location.pathname.split('/')[3];
  const [, name] = GAMES.find((g) => g[0] === tpl) || [tpl, tpl];
  await t.until(() => W() && W().player && W().player.alive, 60000, `${name} to start`);
  t.event('game-opened', `${name} (/play/t/${tpl})`);
  await t.until(() => { const l = HP().presence && HP().presence.look; return l && (!ctx.name || l.name === ctx.name); }, 25000, 'the character\'s name to arrive').catch(() => {});
  const look = HP().presence && HP().presence.look;
  const okName = !ctx.name || (look && look.name === ctx.name);
  const okWhat = !ctx.what || (look && look.what === ctx.what);
  t.event('character-arrived', `name "${look && look.name}" (sent "${ctx.name || ''}"), body ${look && look.what} (sent ${ctx.what || '?'})`);
  if (!okName || !okWhat) t.problem('error', `the character did not arrive in ${name}: ${look && look.name}/${look && look.what}, expected ${ctx.name}/${ctx.what}`);
  await t.wait(3500);
  t.scene(`${name}: beamed down`);
  await t.wait(2500);
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  esc(); await t.wait(250); esc();
  await t.until(() => [...document.querySelectorAll('.ui-menu-items button')].some((b) => /Return to the Observatory/.test(b.textContent)), 5000, 'the pause menu (Esc twice)');
  t.scene(`${name}: the pause menu`);
  t.event('pause-menu', 'Esc twice opened it, with Return to the Observatory');
  await t.wait(800);
  writeRun({ ...ctx.saved(), leg: 'back', visit: ctx.visit });
  [...document.querySelectorAll('.ui-menu-items button')].find((b) => /Return to the Observatory/.test(b.textContent)).click();
  t.event('return-chosen', name);
  await t.wait(30000);
  throw new Error(`Return to the Observatory did not leave ${name}`);
}

const RUN = {
  landing: stageLanding, veil: stageVeil, intro: stageIntro, mirror: stageMirror, sheet: stageSheet, drive: stageDrive, fish: stageFish, chapter: stageChapter, presence: stagePresence, observatory: stageObservatory, race: stageRace, board: stageBoard, game: stageGame, journal: stageJournal,
};
const ENDS = { smoke: 'intro', 'sandbox-first-minutes': 'fish', 'sandbox-chapter-one': 'chapter', 'presence-who': 'presence', 'sandbox-observatory': 'observatory', 'island-race': 'race', 'sandbox-travel-board': 'board', 'island-journal': 'journal' };

// ---------------------------------------------------------------------------------------------- the contract
let api = null;
let resumed = null;
export function install() {
  if (api) return api;
  const saved0 = readRun();
  api = installPlaytest({
    product: 'hawkesgenwebsite',
    scenarios: SCENARIOS,
    stallSeconds: 120,
    isReady: () => (onSandbox() || onGame() ? Boolean(W() && W().player) || document.readyState === 'complete' : document.readyState === 'complete'),
    async start(id, options, t) {
      const events = [];
      // Everything the run says is kept, so the page that follows can carry the whole report.
      const ev = t.event.bind(t);
      const sc = t.scene.bind(t);
      t.event = (type, detail) => { events.push(['e', type, detail]); ev(type, detail); };
      t.scene = (name) => { events.push(['s', name]); sc(name); };
      const ctx = {
        options,
        saved: () => ({ id, options: { ...options, resumed: undefined }, events, name: ctx.name, what: ctx.what, visit: ctx.visit }),
        leg: options.resumed && options.resumed.leg,
        visit: (options.resumed && options.resumed.visit) || 0,
        name: options.resumed && options.resumed.name,
        what: options.resumed && options.resumed.what,
      };
      const prior = options.resumed;
      if (prior) { // the landing page's part of the run, replayed
        for (const [k, a, b] of prior.events) { if (k === 's') sc(a); else ev(a, b); events.push([k, a, b]); }
        ev('page-changed', prior.leg ? `${prior.leg === 'game' ? 'the Observatory' : 'the game'} > ${location.pathname}` : 'landing page > /play/sandbox');
      }
      const to = STAGES.indexOf(options.to && STAGES.includes(options.to) ? options.to : ENDS[id]);
      const from = prior || onSandbox() ? 1 : 0;
      t.event('plan', `${id}: ${STAGES[from]} to ${STAGES[to]}${isLive() ? ' (live: no sign-up)' : ''}`);
      let named = '';
      try {
        const seq = id === 'sandbox-travel-board' && prior && prior.leg === 'game' ? ['game'] : id === 'sandbox-travel-board' && prior && prior.leg === 'back' ? ['board'] : ORDERS[id] ? ORDERS[id].slice(ORDERS[id].indexOf(STAGES[from])) : STAGES.slice(from, to + 1);
        for (const stage of seq) {
          named = stage;
          if ((await RUN[named](t, ctx)) === 'stop') return;
          t.event('stage-done', named);
        }
      } catch (e) {
        throw stageError(named, e);
      } finally { releaseAll(); }
      t.finish('done');
    },
    stop() { releaseAll(); writeRun(null); },
  });
  // The page after the Play click carries the run on (and a runner's own start() of the same run doesn't restart it).
  if (saved0 && (onSandbox() || onGame())) {
    const start = api.start.bind(api);
    const go = () => (Boolean(W() && W().player) || document.readyState === 'complete' ? (resumed = start(saved0.id, { ...saved0.options, resumed: saved0 })) : setTimeout(go, 250));
    api.start = (id, o) => (resumed && id === saved0.id ? resumed : start(id, o));
    writeRun(null);
    go();
  }
  return api;
}
install();
