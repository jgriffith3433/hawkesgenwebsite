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
// Options: { to: 'veil'|'intro'|'mirror'|'sheet'|'drive'|'fish' (stop after; default 'fish'), signup: false (never sign up;
//   always so on live), fish: 'strict' (a fishing failure fails the run; otherwise it is a warning), watch: seconds of the
//   intro to watch before skipping (default 8), at: 'sandbox' (start on /play/sandbox instead of clicking Play) }.
import { installPlaytest } from './hawkes-playtest.js';

const KEY = 'hg_playtest_run';
const STAGES = ['landing', 'veil', 'intro', 'mirror', 'sheet', 'drive', 'fish', 'chapter'];
const SCENARIOS = [
  { id: 'smoke', title: 'Landing, Play click, the veil, the intro skipped', seconds: 50, tags: ['smoke'], description: 'options: none' },
  {
    id: 'sandbox-first-minutes', title: 'Play /play/sandbox as a new player: veil, intro, mirror, sign-up, drive to the dock, fish', seconds: 210, tags: ['full'],
    starts: ['sandbox'],
    description: 'options: to (veil, intro, mirror, sheet, drive, fish), signup (false: never sign up; always off on live), fish ("strict": a fishing failure fails the run), watch (seconds of intro to watch), at ("sandbox")',
  },
  {
    id: 'sandbox-chapter-one', title: 'Chapter One "What Are You?": the eight quests to the launch pad, the lit bay and the two closing lines', seconds: 420, tags: ['full'],
    starts: ['sandbox'],
    description: 'the first-minutes path, then quests 6 (walk up to Dolores) and 8 (Rolo\'s rocket) with real input; quests 4, 5 and 7 are named setup shortcuts (the quest line advanced); options as sandbox-first-minutes, plus rocket ("shortcut": skip the climb)',
  },
];

const onSandbox = () => /^\/play\/sandbox\/?$/.test(location.pathname);
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
  if (ctx.options.at === 'sandbox') { t.event('start-at', 'sandbox: skipped the Play click (named shortcut)'); writeRun({ ...ctx.saved(), landed: true }); location.href = '/play/sandbox'; await t.wait(30000); return; }
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

const RUN = {
  landing: stageLanding, veil: stageVeil, intro: stageIntro, mirror: stageMirror, sheet: stageSheet, drive: stageDrive, fish: stageFish, chapter: stageChapter,
};
const ENDS = { smoke: 'intro', 'sandbox-first-minutes': 'fish', 'sandbox-chapter-one': 'chapter' };

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
    isReady: () => (onSandbox() ? Boolean(W() && W().player) || document.readyState === 'complete' : document.readyState === 'complete'),
    async start(id, options, t) {
      const events = [];
      // Everything the run says is kept, so the page that follows can carry the whole report.
      const ev = t.event.bind(t);
      const sc = t.scene.bind(t);
      t.event = (type, detail) => { events.push(['e', type, detail]); ev(type, detail); };
      t.scene = (name) => { events.push(['s', name]); sc(name); };
      const ctx = {
        options,
        saved: () => ({ id, options: { ...options, resumed: undefined }, events }),
      };
      const prior = options.resumed;
      if (prior) { // the landing page's part of the run, replayed
        for (const [k, a, b] of prior.events) { if (k === 's') sc(a); else ev(a, b); events.push([k, a, b]); }
        ev('page-changed', 'landing page > /play/sandbox');
      }
      const to = STAGES.indexOf(options.to && STAGES.includes(options.to) ? options.to : ENDS[id]);
      const from = prior || onSandbox() ? 1 : 0;
      t.event('plan', `${id}: ${STAGES[from]} to ${STAGES[to]}${isLive() ? ' (live: no sign-up)' : ''}`);
      let named = '';
      try {
        for (let i = from; i <= to; i++) {
          named = STAGES[i];
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
  if (saved0 && onSandbox()) {
    const start = api.start.bind(api);
    const go = () => (Boolean(W() && W().player) || document.readyState === 'complete' ? (resumed = start(saved0.id, { ...saved0.options, resumed: saved0 })) : setTimeout(go, 250));
    api.start = (id, o) => (resumed && id === saved0.id ? resumed : start(id, o));
    writeRun(null);
    go();
  }
  return api;
}
install();
