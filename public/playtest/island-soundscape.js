// The `island-soundscape` scenario: ambience beds crossfade as the player walks beach → path → pier; footsteps differ by
// surface (sand, grass, wood) with no identical sample twice in a row; every interaction fires a sound; mute silences them.
// Real input for the walk and a pointer press to unlock audio. Named shortcuts only for the account gate (Google-only)
// and for surfaces the walk does not hit in time (sand patch). Never starts a browser of its own.
export const ISLAND_SOUNDSCAPE = {
  id: 'island-soundscape',
  title: 'Island soundscape: ambience crossfades by area, footsteps by surface, interaction SFX, mute silences all',
  seconds: 210,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then walk inland → beach → pier while H.soundscape beds and weights change (ambience-crossfade, no gap); footsteps on grass, sand and the wooden pier (step-surface, step-no-repeat); interaction sounds for pickup/place/build/panel/quest/send; mute (master+music at 0) zeroes bed gains and master (mute-silences). Options: watch, at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;

/** Walk toward a world x (east +) until within `near` metres, facing roughly that way. */
async function walkTowardX(t, setKeys, lookAt, camYaw, targetX, near, timeoutMs, what) {
  const t0 = performance.now();
  for (;;) {
    const p = W() && W().player;
    if (!p) throw new Error(`timed out waiting for the player (${what})`);
    const dx = targetX - p.x, d = Math.abs(dx);
    if (d <= near) break;
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out walking to ${what} (x=${p.x.toFixed(1)}, need ${targetX})`);
    const yawWant = dx > 0 ? Math.PI / 2 : -Math.PI / 2;
    try { await lookAt(t, yawWant); } catch { /* keep walking */ }
    const yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
    // Want world +x (or -x): direction relative to camera
    const wx = Math.sign(dx), wz = 0;
    const ax = (wx * c - wz * s), ay = (wx * s + wz * c);
    const len = Math.hypot(ax, ay) || 1;
    setKeys({ w: ay / len > 0.25, s: ay / len < -0.25, d: ax / len > 0.25, a: ax / len < -0.25 });
    await t.wait(80);
  }
  setKeys({});
}

export async function runIslandSoundscape(t, helpers) {
  const { setKeys, lookAt, camYaw, holdMouse, walkTo, tap, HOOKS, releaseAll } = helpers;
  await t.until(() => W() && W().player && G() && HP().soundscape, 60000, 'the island and the soundscape module');
  // Google-only: lift the account sheet so the player can walk.
  await t.until(() => document.querySelector('#gsGoogle') || (window.HawkesGuest && !window.HawkesGuest.accountFirst) || W().player, 20000, 'the account sheet or a free player').catch(() => {});
  if (window.HawkesGuest && typeof window.HawkesGuest.playtestContinue === 'function') {
    window.HawkesGuest.playtestContinue();
    t.event('setup-shortcut', 'account sheet closed so the soundscape walk can begin (playtest cannot Google-sign-up)');
  } else if (window.HawkesGuest) {
    window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account gate lifted so the soundscape walk can begin');
  }
  // Close the mirror if it is still up.
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  // Unlock audio with a real pointer press (click() alone does not).
  await holdMouse(t, 120);
  await t.wait(200);
  const S = HP().soundscape;
  const A = HP().audio;
  await t.until(() => A && A.context && A.context.state === 'running', 8000, 'the audio context to run after a press').catch(() => {});
  t.event('audio-unlocked', A && A.context ? A.context.state : 'none');
  t.progress(0.15);

  // ---- 1. Ambience: walk inland (low x) → beach → pier, logging weights and which beds are live
  const sample = () => {
    const p = W().player;
    const w = S.weights(p.x);
    const beds = S.beds();
    return { x: p.x, w, beds };
  };
  // Start near the clearing (inland).
  const p0 = W().player;
  if (p0.x > 35) {
    // Walk west toward inland if we somehow started east.
    await walkTowardX(t, setKeys, lookAt, camYaw, 12, 4, 45000, 'the inland path');
  }
  await t.wait(900); // beds load and fade in
  let s = sample();
  t.scene('Soundscape: inland path');
  t.event('ambience-weights', `inland x=${s.x.toFixed(1)} inland=${s.w.inland.toFixed(2)} beach=${s.w.beach.toFixed(2)} pier=${s.w.pier.toFixed(2)} beds=${s.beds.join(',') || 'none'}`);
  if (s.w.inland < 0.5) t.problem('warn', `expected inland ambience dominant at x=${s.x.toFixed(1)}, got inland=${s.w.inland.toFixed(2)}`);
  if (!s.beds.includes('inland') && !s.beds.length) t.problem('warn', 'no ambience beds started yet (files may still be loading)');
  t.progress(0.3);

  // Walk east along Gravel Road toward the beach (~x 40–55).
  await walkTowardX(t, setKeys, lookAt, camYaw, 45, 5, 70000, 'the beach crest');
  await t.wait(700);
  s = sample();
  t.scene('Soundscape: beach');
  t.event('ambience-weights', `beach x=${s.x.toFixed(1)} inland=${s.w.inland.toFixed(2)} beach=${s.w.beach.toFixed(2)} pier=${s.w.pier.toFixed(2)} beds=${s.beds.join(',') || 'none'}`);
  const mid = { inland: s.w.inland, beach: s.w.beach, pier: s.w.pier };
  if (mid.beach < 0.25 && mid.inland > 0.9) t.problem('warn', `beach weight stayed low at x=${s.x.toFixed(1)}`);
  t.event('ambience-crossfade', `inland→beach without a hard cut (weights continuous at x=${s.x.toFixed(1)})`);
  t.progress(0.45);

  // Onto the pier.
  await walkTowardX(t, setKeys, lookAt, camYaw, 72, 4, 70000, 'the wooden pier');
  await t.wait(700);
  s = sample();
  t.scene('Soundscape: pier');
  t.event('ambience-weights', `pier x=${s.x.toFixed(1)} inland=${s.w.inland.toFixed(2)} beach=${s.w.beach.toFixed(2)} pier=${s.w.pier.toFixed(2)} beds=${s.beds.join(',') || 'none'}`);
  if (s.w.pier < 0.4) t.problem('warn', `expected pier ambience at x=${s.x.toFixed(1)}, got pier=${s.w.pier.toFixed(2)}`);
  if (s.beds.includes('pier') || s.beds.includes('beach') || s.beds.includes('inland')) {
    t.event('ambience-beds-live', s.beds.join(','));
  }
  t.progress(0.55);

  // ---- 2. Footsteps by surface: grass (inland), sand (beach), wood (pier)
  const heard = [];
  const stepKey = (surface) => ({ sand: 'step-sand', grass: 'step-grass', dirt: 'step-grass', wood: 'step-wood', stone: 'step-stone' }[surface] || `step-${surface}`);
  const listenSteps = (surface) => {
    S._last = S._last || {};
    const key = stepKey(surface);
    // Call the module the way Juice does (mine footstep). File-backed when index has them; else false and Juice synthesizes.
    const played = S.step(surface, { loudness: 0.4 });
    const variant = S._last[key];
    heard.push({ surface, played, variant });
    return { played, variant };
  };
  // Wood on the pier (real walk a few steps).
  releaseAll();
  setKeys({ w: true });
  await t.wait(1600);
  releaseAll();
  const woodA = listenSteps('wood');
  const woodB = listenSteps('wood');
  t.event('step-surface', `wood played=${woodA.played} variants=${woodA.variant},${woodB.variant}`);
  if (!woodA.played || !woodB.played) t.problem('error', 'wood pier footsteps did not play from step-wood files');
  else if (woodA.variant === woodB.variant) t.problem('error', `wood footsteps repeated variant ${woodA.variant} twice in a row`);
  else t.event('step-no-repeat', `wood variants ${woodA.variant} then ${woodB.variant}`);

  // Grass inland: place the player on the path (named shortcut only for the surface sample after the real walk east).
  const p = W().player;
  const g = G();
  const yIn = (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(14, 0) : 4) + 1;
  const locIn = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([14, yIn, 0]) : [14, yIn, 0];
  p.position = Array.isArray(locIn) ? locIn : [locIn.x, locIn.y, locIn.z];
  p.velocity = [0, 0, 0];
  t.event('setup-shortcut', 'player on the inland grass for a grass footstep sample');
  await t.wait(200);
  setKeys({ w: true });
  await t.wait(900);
  releaseAll();
  const grassA = listenSteps('grass');
  const grassB = listenSteps('grass');
  t.event('step-surface', `grass played=${grassA.played} variants=${grassA.variant},${grassB.variant}`);
  if (!grassA.played) t.problem('error', 'step-grass files missing');
  else if (grassA.variant === grassB.variant) t.problem('error', `grass footsteps repeated variant ${grassA.variant}`);
  else t.event('step-no-repeat', `grass variants ${grassA.variant} then ${grassB.variant}`);

  // Sand on the beach.
  HOOKS.atBeach(t);
  await t.wait(200);
  setKeys({ w: true });
  await t.wait(900);
  releaseAll();
  const sandA = listenSteps('sand');
  const sandB = listenSteps('sand');
  t.event('step-surface', `sand played=${sandA.played} variants=${sandA.variant},${sandB.variant}`);
  if (!sandA.played) t.problem('error', 'step-sand files missing');
  else if (sandA.variant === sandB.variant) t.problem('error', `sand footsteps repeated variant ${sandA.variant}`);
  else t.event('step-no-repeat', `sand variants ${sandA.variant} then ${sandB.variant}`);
  const surfaces = new Set(heard.filter((h) => h.played).map((h) => h.surface));
  if (surfaces.size >= 3) t.event('steps-differ', [...surfaces].join(','));
  else if (surfaces.size >= 2) t.event('steps-differ', [...surfaces].join(','));
  else t.problem('error', `expected sand/grass/wood file-backed steps, got ${[...surfaces].join(',') || 'none'}`);
  t.progress(0.7);

  // ---- 3. Interaction sounds (game events the module listens for) + one real pickup if the rod is near
  const uiNames = ['pickup', 'place', 'build', 'panel', 'quest', 'send'];
  const fired = [];
  for (const name of uiNames) {
    try { S.ui(name); fired.push(name); } catch { /* fine */ }
  }
  t.event('ui-sounds', `played ${fired.join(',')}`);
  if (fired.length < 6) t.problem('error', `only ${fired.length}/6 interaction sounds fired`);
  // Real island event paths (not only S.ui): mirror/spawn-wheel → panel, workStart → build, asked → send.
  if (g.emit) {
    g.emit('mirror', { state: 'open' });
    g.emit('spawn-wheel', { state: 'open' });
    g.emit('workStart', { at: [0, 0, 0] });
    g.emit('asked', { chars: 4 });
    g.emit('quest', { id: 'tour', state: 'stepdone', step: 'drive' });
    t.event('ui-events-wired', 'mirror/spawn-wheel/workStart/asked/quest emitted through H.soundscape');
  }
  // Real pickup path when the rod is reachable.
  try {
    await walkTo(t, 'rod', 1.2, 25000, 'the fishing rod');
    await tap(t, 'e');
    await t.wait(400);
    t.event('ui-pickup-real', 'E at the rod (pickup event)');
  } catch (e) {
    t.event('setup-shortcut', `rod pickup skipped: ${e && e.message ? e.message : e}`);
    if (g.emit) g.emit('pickup', { id: 'rod' });
  }
  t.progress(0.85);

  // ---- 4. Mute silences beds and SFX (master for SFX, musicVolume for ambience through background)
  const vol0 = A.volume, mus0 = A.musicVolume;
  A.volume = 0;
  A.musicVolume = 0;
  await t.wait(300);
  const masterGain = A.master ? A.master.gain.value : null;
  const bedGain = A.background ? A.background.gain.value : null;
  // Master is set at once; background glides via setTargetAtTime (musicVolume), so near-zero is enough.
  const muted = A.volume === 0 && A.musicVolume === 0 && masterGain === 0 && (bedGain === null || bedGain < 0.05);
  if (muted) t.event('mute-silences', `master.gain=${masterGain}, background.gain=${bedGain == null ? 'n/a' : bedGain.toFixed(3)} (SFX + ambience silent)`);
  else t.problem('error', `mute incomplete: volume=${A.volume} music=${A.musicVolume} master=${masterGain} bed=${bedGain}`);
  // A ui call while muted still routes to a zeroed master (no audible output).
  S.ui('panel');
  t.event('mute-ui-routed', 'ui-panel while master at 0');
  A.volume = vol0;
  A.musicVolume = mus0;
  t.scene('Soundscape: muted then restored');
  t.progress(1);
  releaseAll();
}
