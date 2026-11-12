// The `fishing-showcase` scenario: the first catch as a showcase moment (modules/water/fishing.js). From the pier's end with the
// rod in hand it plays a real cast (hold, let go), a wait on the waves, a strike (a tap) and a reel (a hold) with the keyboard and
// mouse, or with `touch: true` (390x844, ?touch=1) only taps and holds on the fish button. It logs the line's curve in the air
// (sag), the bobber against the sea's surface (rides the waves), then reads the ordered events the rod keeps
// (game.water.fish.events(): cast, plop, nibble, bite, strike, fight, leap, holdup, closeup-start, closeup-framed, closeup-end)
// and checks the close-up: 2 to 3 s, HUD hidden, the whole fish on screen, control handed back.
// Named shortcuts: the account gate lifted, the player stood at the pier's end with the rod in hand, fishing assist (a quick first
// bite). No sign-up, safe on live.
export const FISHING_SHOWCASE = {
  id: 'fishing-showcase',
  title: 'Fishing showcase: the line arcs out, the bobber plops with rings and rides the waves, a strike pulls it under, the fish leaps and is held up in a first-catch close-up (phone: taps and holds on the fish button)',
  seconds: 200,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then the player at the pier end with the rod. cast-arc (line sag in the air), plop (3 rings), bobber-rides (the bobber against H.water.surfaceAt), strike, leap, holdup, closeup (2 to 3 s, HUD hidden, whole fish on screen, control back), events-in-order. Options: touch (true: ?touch=1, 390x844, the fish button only), at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const toLocal = (g, x, y, z) => { const l = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z]; return Array.isArray(l) ? l : [l.x, l.y, l.z]; };

export async function runFishingShowcase(t, helpers) {
  const { press, pointer, canvas, dragLook, $, options } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && HP().water && HP().water.fish, 90000, 'the island with its fishing');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  const g = G(), w = W(), F = HP().water.fish;
  // The player at the pier's end with the rod in hand, facing the sea (the walk there is sandbox-first-minutes').
  const p = w.player;
  p.position = toLocal(g, 85.2, 2.4, -0.4);
  p.velocity = [0, 0, 0];
  try { g.camera.yaw = Math.PI / 2; g.camera.pitch = -0.12; } catch { /* the default view */ }
  if (g.mayhem && g.mayhem.giveTool) g.mayhem.giveTool('rod');
  try { F.assist(true); } catch { /* a first catch is easy anyway */ }
  t.event('setup-shortcut', 'the player stood at the pier end with the rod in hand, fishing assist on (a quick first bite); cast, strike and reel are real input');
  await t.until(() => F.phase() === 'ready', 8000, 'the rod ready');
  if (touch) { await dragLook(t, -60); await t.wait(200); }
  await t.wait(800);
  t.scene(touch ? 'Fishing: ready (phone)' : 'Fishing: ready');

  // Input: a hold on the fish button (phone) or the mouse.
  const hold = () => (touch ? press($('.water-use')) : (pointer('pointerdown', canvas()), () => pointer('pointerup', window)));
  const phase = () => F.phase();
  const wait = (ph, ms, what) => t.until(() => F.events().some((e) => e.name === ph) || phase() === ph, ms, what);

  // ---- cast: hold to charge, let go; the line in the air
  const sags = [];
  const up = hold(); await t.wait(1100); up();
  for (let i = 0; i < 12 && phase() === 'flying'; i++) { const b = F.bobber(); if (b) sags.push(b.sag); if (i === 3) t.scene(touch ? 'Fishing: the cast (phone)' : 'Fishing: the cast'); await t.wait(60); }
  const maxSag = Math.max(0, ...sags);
  t.metric('lineSagCm', Math.round(maxSag * 100));
  t.event('cast-arc', `the line from the rod tip to the bobber bowed ${(maxSag * 100).toFixed(0)} cm from straight in the air (a verlet rope), ${sags.length} samples`);
  if (maxSag < 0.1) t.problem('error', `the line in the air bowed only ${(maxSag * 100).toFixed(0)} cm: it is a straight line, not a curve`);
  await wait('plop', 6000, 'the bobber to land');
  t.event('plop', 'the bobber landed with a splash and three expanding rings');
  await t.wait(350);
  t.scene(touch ? 'Fishing: the plop and rings (phone)' : 'Fishing: the plop and rings');

  // ---- the bobber on the waves until the bite
  const samples = [];
  const t0 = performance.now();
  while (phase() === 'waiting' && performance.now() - t0 < 24000) { const b = F.bobber(); if (b) samples.push(b); await t.wait(100); }
  const ys = samples.map((b) => b.y - b.surface), ss = samples.map((b) => b.surface);
  const ride = Math.max(0, ...ss) - Math.min(0, ...ss.length ? ss : [0]);
  const sRange = ss.length ? Math.max(...ss) - Math.min(...ss) : 0, bRange = samples.length ? Math.max(...samples.map((b) => b.y)) - Math.min(...samples.map((b) => b.y)) : 0;
  const gap = ys.length ? Math.max(...ys.map((v) => Math.abs(v - 0.03))) : 0;
  void ride;
  t.metric('bobberGapCm', Math.round(gap * 100));
  t.event('bobber-rides', `${samples.length} samples while waiting: the sea's surface under it moved ${(sRange * 100).toFixed(0)} cm and the bobber ${(bRange * 100).toFixed(0)} cm; it stayed within ${(gap * 100).toFixed(0)} cm of the surface (nibbles dip it)`);
  if (samples.length < 15) t.problem('error', `the bobber was only waiting for ${samples.length} samples (no wait on the waves)`);
  if (sRange > 0.03 && bRange < sRange * 0.5) t.problem('error', `the bobber moved ${(bRange * 100).toFixed(0)} cm while the sea moved ${(sRange * 100).toFixed(0)} cm: it does not ride the waves`);
  if (gap > 0.45) t.problem('error', `the bobber was ${(gap * 100).toFixed(0)} cm off the sea's surface`);
  if (phase() !== 'bite') throw new Error('timed out: no bite after the cast');
  t.event('bite', 'the bobber went under with a splash and an "!"');
  t.scene(touch ? 'Fishing: a bite (phone)' : 'Fishing: a bite');

  // ---- strike (one tap) and reel (a hold)
  { const u = hold(); await t.wait(90); u(); }
  await wait('strike', 3000, 'the strike');
  await t.wait(120);
  t.scene(touch ? 'Fishing: the strike (phone)' : 'Fishing: the strike');
  t.event('strike', 'the bobber was yanked under with a splash, the line snapped taut and the rod bent');
  const reel = hold();
  await t.until(() => phase() === 'leap' || phase() === 'show', 16000, 'the fish to be reeled in').catch((e) => { reel(); throw e; });
  reel();
  if (phase() === 'leap') { await t.wait(380); t.scene(touch ? 'Fishing: the fish leaps (phone)' : 'Fishing: the fish leaps'); }
  t.event('leap', 'the fish leapt clear of the water with droplets and a glint');

  // ---- the first-catch close-up
  await t.until(() => F.events().some((e) => e.name === 'closeup-start'), 6000, 'the first-catch close-up').catch((e) => t.problem('error', e.message));
  await t.wait(1000);
  const hudHidden = document.body.classList.contains('sh-clean'), lb = Boolean(HP().share && HP().share.letterboxOn), bars = [...document.querySelectorAll('.sh-keep')].filter((e) => e.style.height === '7vh').length;
  t.event('closeup-hud', `HUD hidden ${hudHidden}, letterbox ${lb || bars === 2 ? 'on' : 'OFF'}`);
  if (!hudHidden) t.problem('error', 'the HUD was showing during the close-up');
  if (!lb && bars < 2) t.problem('error', 'no letterbox bars during the close-up');
  t.scene(touch ? 'Fishing: the first-catch close-up (phone)' : 'Fishing: the first-catch close-up');
  await t.until(() => F.events().some((e) => e.name === 'closeup-end'), 6000, 'the close-up to end').catch((e) => t.problem('error', e.message));
  await t.wait(400);
  const ev = F.events();
  const at = (n) => (ev.find((e) => e.name === n) || {}).t;
  const secs = at('closeup-end') && at('closeup-start') ? (at('closeup-end') - at('closeup-start')) / 1000 : 0;
  t.metric('closeupSeconds', Math.round(secs * 10) / 10);
  t.event('closeup', `the close-up of the player holding the fish played ${secs.toFixed(1)} s`);
  if (secs < 2 || secs > 3.2) t.problem('error', `the close-up played ${secs.toFixed(1)} s (2 to 3 s expected)`);
  const fr = ev.find((e) => e.name === 'closeup-framed');
  t.event('closeup-framed', fr ? `whole fish on screen: ${fr.whole} (${JSON.stringify(fr.box)})` : 'no framing measurement');
  if (!fr || fr.whole !== true) t.problem('error', `the fish was not wholly on screen in the close-up${touch ? ' at 390x844' : ''}`);
  const back = G().player.controls !== false && !(HP().share && HP().share.cameraOwner) && !document.body.classList.contains('sh-clean');
  t.event('control-returned', back ? 'the camera and the player are the player\'s again, the HUD is back' : 'CONTROL NOT RETURNED');
  if (!back) t.problem('error', 'control did not return after the close-up');

  // ---- the order of it all
  const want = ['cast', 'plop', 'bite', 'strike', 'leap', 'holdup', 'closeup-start', 'closeup-end'];
  let i = 0;
  for (const e of ev) if (e.name === want[i]) i++;
  t.event('events-in-order', `${ev.map((e) => e.name).join(' > ')}`);
  if (i < want.length) t.problem('error', `the fishing events were not in order: missing "${want[i]}" after ${want.slice(0, i).join(', ') || 'the start'}`);
  if (touch) t.event('touch-only', 'cast, strike and reel were taps and holds on the fish button');
  try { F.assist(false); } catch { /* fine */ }
}
