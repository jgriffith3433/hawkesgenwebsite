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
const STAGES = ['landing', 'veil', 'intro', 'mirror', 'sheet', 'drive', 'fish', 'race'];
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

const RUN = {
  landing: stageLanding, veil: stageVeil, intro: stageIntro, mirror: stageMirror, sheet: stageSheet, drive: stageDrive, fish: stageFish, race: stageRace,
};
// (island-race skips the tour's own stages: it signs in, then races.)
const PLANS = { 'island-race': ['landing', 'veil', 'intro', 'mirror', 'sheet', 'race'] };
const ENDS = { smoke: 'intro', 'sandbox-first-minutes': 'fish', 'island-race': 'race' };

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
      const list = PLANS[id] || STAGES;
      const to = list.indexOf(options.to && list.includes(options.to) ? options.to : ENDS[id]);
      const from = prior || onSandbox() ? 1 : 0;
      t.event('plan', `${id}: ${list[from]} to ${list[to]}${isLive() ? ' (live: no sign-up)' : ''}`);
      let named = '';
      try {
        for (let i = from; i <= to; i++) {
          named = list[i];
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
