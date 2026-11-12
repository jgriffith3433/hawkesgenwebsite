// The `island-hours` scenario: the island sounds different every hour, and a rain shower rolls in and clears
// (modules/soundscape/weather.js, window.__weather, docs/world-bible.md "The hours and the weather").
//  1. The clock set to dawn, noon, dusk and night (H.lighting.setHour, named): each logs its own ambience bed
//     (`bed-change`) and the bed crosses over in 30 s or more (`crossfade`, metric `crossfadeS`).
//  2. A forced shower: falling rain, rings on the sea, splashes (`rain-falls`), a wet sheen, and thunder after every
//     lightning flash (`thunder-after-flash`).
//  3. Standing on the pier and then inside the hangar during rain logs two different rain sounds (`rain-surface`).
//  4. touch: true (390x844, ?touch=1): a 60 s shower held at 30 fps, at most 2 beds at once, and the new audio under
//     2.5 MB (`phone-shower`, metrics `showerFps`, `newAudioKB`).
// Named shortcuts: the account gate, the clock, the forced shower, the player stood on the pier, the dock. No sign-up.
export const ISLAND_HOURS = {
  id: 'island-hours',
  title: 'Island hours and weather: a different ambience bed at dawn, noon, dusk and night (30 s crossfades); a rain shower with thunder, rain that sounds like pier boards or the hangar roof; a phone holds 30 fps under 2.5 MB of new audio',
  seconds: 420,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then the clock at dawn, noon, dusk and night (bed-change, crossfade >= 30 s), a forced shower (rain-falls: particles, rings on the sea; thunder-after-flash), the pier then the hangar in the rain (rain-surface: two different rain sounds; rain-beds), and the shower clearing (rain-clears). Option touch (true: ?touch=1 at 390x844: one hour check, then a 60 s shower walked with the stick: phone-shower: 30 fps, at most 2 beds at once, new audio under 2.5 MB), hours (false: skip the four hours), at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const wx = () => window.__weather || null;
const FADE = 30;

function frameMeter() {
  let frames = 0, worst = 0, freezes = 0, running = true, last = performance.now();
  const t0 = last;
  const raf = (n) => { frames++; const d = n - last; worst = Math.max(worst, d); if (d > 500) freezes++; last = n; if (running) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return { stop() { running = false; return { fps: Math.round(frames / ((performance.now() - t0) / 1000)), worst: Math.round(worst), freezes }; } };
}
function stand(t, x, z, tx, tz, what) {
  const g = G(), p = W() && W().player;
  if (!g || !p) throw new Error(`${what}: the island is not ready`);
  const y = (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(x, z) : 4) + 1.1;
  const local = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z];
  p.controls = false;
  p.position = Array.isArray(local) ? local : [local.x, local.y, local.z];
  p.velocity = [0, 0, 0];
  try { if (g.camera) { g.camera.yaw = Math.atan2(tx - x, tz - z); g.camera.pitch = -0.12; if (g.camera.mode !== undefined) g.camera.mode = 'third'; } } catch { /* the default view */ }
  t.event('setup-shortcut', `the player stood ${what} at ${Math.round(x)}, ${Math.round(z)}`);
}
/** Bytes the browser fetched for this change's new audio (tod-*, rain-*, thunder-*). */
function newAudioBytes() {
  let total = 0;
  for (const e of performance.getEntriesByType('resource')) if (/\/audio\/sfx\/(tod-|rain-|thunder-)/.test(e.name)) total += e.encodedBodySize || e.transferSize || 0;
  return total;
}

export async function runIslandHours(t, helpers) {
  const { releaseAll, stickHold, holdMouse, options, HOOKS } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && HP().weather && wx() && HP().lighting, 90000, 'the island with its weather (window.__weather)');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the run needs a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  await holdMouse(t, 120); // a real press unlocks the audio
  await t.until(() => HP().audio && HP().audio.context && HP().audio.context.state === 'running', 8000, 'the audio to run').catch(() => {});
  const L = HP().lighting;
  const logHas = (ev, from) => wx().log.filter((e) => e.ev === ev && e.t >= from);
  t.progress(0.1);

  // ---- 1. four hours, four beds
  const hours = [['dawn', 6], ['noon', 12], ['dusk', 18.5], ['night', 23.5]];
  const want = { dawn: 'tod-dawn', noon: 'tod-day', dusk: 'tod-dusk', night: 'tod-night' };
  const seen = new Set();
  if (!(options && options.hours === false)) {
    stand(t, 20, 0, 60, 0, 'on the path between the clearing and the beach');
    for (const [name, h] of touch ? [hours[1]] : hours) {
      const t0 = performance.now();
      L.setHour(h); t.event('setup-shortcut', `the clock set to ${name} (${h} h)`);
      await t.until(() => wx().bed === (name === 'noon' ? 'day' : name), 6000, `the ${name} bed`);
      const change = logHas('bed-change', t0 - 50).pop();
      t.event('bed-change', `${name} (${h} h): bed ${wx().bed} (${want[name]}), from ${change ? change.from : '?'}, fading over ${wx().fadeSeconds} s`);
      let at90 = null;
      const bedName = want[name];
      while (performance.now() - t0 < (FADE + 3) * 1000) {
        const b = wx().beds.find((x) => x.name === bedName);
        // 90% of this bed's own target (TOD_GAIN × hour weight × duck), not a hardcoded 0.7.
        if (b && at90 === null && b.target > 0.05 && b.w >= 0.9 * b.target) at90 = (performance.now() - t0) / 1000;
        await t.wait(500);
      }
      const b = wx().beds.find((x) => x.name === bedName);
      seen.add(bedName);
      t.scene(`Hours: ${name}`);
      if (!b || b.missing) t.problem('error', `the ${name} bed file (${bedName}.mp3) did not load`);
      else {
        t.event('crossfade', `${name}: ${bedName} reached ${(b.w).toFixed(2)} of target ${(b.target || 0).toFixed(2)} after ${at90 === null ? '>' + (FADE + 3) : at90.toFixed(1)} s (never faster than ${FADE} s)`);
        t.metric(`crossfade_${name}_s`, at90 === null ? FADE + 3 : Math.round(at90 * 10) / 10);
        if (at90 !== null && at90 < FADE * 0.85) t.problem('error', `the ${name} bed faded in over ${at90.toFixed(1)} s (${FADE} s or more expected)`);
      }
      t.progress(0.1 + 0.25 * (seen.size / 4));
    }
    if (!touch && seen.size < 4) t.problem('error', `only ${seen.size} different hour beds were logged`);
  }

  // ---- 2. the shower
  L.setHour(14); t.event('setup-shortcut', 'the clock held at 14 h for the shower');
  stand(t, 80, 0, 100, -4, 'at the end of the pier, facing the sea');
  await t.wait(800);
  const meter = touch ? frameMeter() : null;
  const r0 = performance.now();
  wx().force({ seconds: touch ? 66 : 100, lightning: true });
  t.event('setup-shortcut', `a ${touch ? 66 : 100} s shower forced (window.__weather.force)`);
  await t.until(() => wx().level > 0.8, 14000, 'the rain to roll in');
  t.event('rain-rolls-in', `level ${wx().level}, ${wx().particles} drops, hour ${wx().hour}`);
  await t.wait(2500);
  t.scene('Rain: the pier in the shower');
  let rings = 0, drops = 0, splashes = 0, wet = 0, maxBeds = 0;
  const sample = async (ms) => {
    const t1 = performance.now();
    while (performance.now() - t1 < ms) {
      const w = wx();
      rings = Math.max(rings, w.ringsLive); drops = Math.max(drops, w.particles); splashes = Math.max(splashes, w.splashes); wet = Math.max(wet, w.wet); maxBeds = Math.max(maxBeds, w.activeBeds);
      await t.wait(200);
    }
  };
  await sample(3500);
  t.event('rain-falls', `${drops} drops falling, ${splashes} splashes, ${rings} rings on the sea at once, wet sheen ${wet}`);
  if (drops < 20) t.problem('error', `only ${drops} raindrops fall round the camera`);
  if (rings < 1) t.problem('error', 'no rings appeared on the sea in the rain');

  // ---- thunder after each flash
  const f0 = wx().flashes, th0 = wx().thunders;
  if (wx().flashes === f0) { wx().strike(); t.event('setup-shortcut', 'a lightning flash called (window.__weather.strike) so the run need not wait for chance'); }
  await t.until(() => wx().flashes > f0, 3000, 'a lightning flash').catch(() => {});
  t.scene('Rain: a lightning flash');
  await t.until(() => wx().thunders >= wx().flashes - 0 && wx().pendingThunder === 0, 12000, 'thunder after the flash').catch(() => {});
  const fl = wx().log.filter((e) => e.ev === 'lightning'), tn = wx().log.filter((e) => e.ev === 'thunder');
  t.event('thunder-after-flash', `${fl.length} flash(es), ${tn.length} thunder clap(s); the last flash at ${fl.length ? fl[fl.length - 1].t : '?'} ms, thunder at ${tn.length ? tn[tn.length - 1].t : '?'} ms (${fl.length ? fl[fl.length - 1].thunderIn : '?'} s later by distance)`);
  if (!fl.length || tn.length < fl.length - (wx().pendingThunder || 0)) t.problem('error', `thunder did not follow each flash (${fl.length} flashes, ${tn.length} claps)`);
  else if (tn.length && fl.length && tn[tn.length - 1].t <= fl[fl.length - 1].t) t.problem('error', 'thunder was not later than its lightning');

  // ---- 3. what is over you: the pier, then the hangar
  const rainBeds = () => wx().beds.filter((b) => /^rain-/.test(b.name) && b.w > 0.15).map((b) => b.name);
  await t.wait(5000); // the surface mix settles
  const pierSurface = wx().surface, pierBeds = rainBeds();
  t.event('rain-surface', `on the pier: ${pierSurface}; rain sounds playing: ${pierBeds.join(', ') || 'none (audio not running?)'}`);
  t.scene('Rain: on the pier boards');
  if (!touch) {
    await HOOKS.dock(t);
    await t.wait(7000);
    const hangarSurface = wx().surface, hangarBeds = rainBeds();
    t.event('rain-surface', `in the hangar: ${hangarSurface}; rain sounds playing: ${hangarBeds.join(', ') || 'none (audio not running?)'}`);
    t.scene('Rain: inside the hangar');
    if (pierSurface === hangarSurface) t.problem('error', `the pier and the hangar both sound like ${pierSurface}`);
    if (pierBeds.length && hangarBeds.length && pierBeds[0] === hangarBeds[0]) t.problem('error', `the same rain bed (${pierBeds[0]}) plays on the pier and in the hangar`);
    t.event('two-rain-sounds', `${pierBeds[0] || pierSurface} on the pier, ${hangarBeds[0] || hangarSurface} in the hangar`);
  }

  // ---- 4. the phone's minute
  if (touch) {
    stand(t, 70, 0, 100, -4, 'on the pier road');
    const stick = stickHold();
    const tEnd = r0 + 60000;
    let n = 0;
    while (performance.now() < tEnd) {
      stick.set(n % 2 ? 0.6 : -0.6, 0.8);
      await sample(2500);
      n++;
    }
    stick.release();
    const d = meter.stop();
    const kb = Math.round(newAudioBytes() / 1024);
    t.metric('showerFps', d.fps); t.metric('showerWorstFrameMs', d.worst); t.metric('newAudioKB', kb); t.metric('maxBeds', maxBeds);
    t.event('phone-shower', `${d.fps} fps over a 60 s shower (worst frame ${d.worst} ms, ${d.freezes} freezes), at most ${maxBeds} beds at once, ${kb} KB of new audio fetched, ${drops} drops`);
    if (!wx().phone) t.problem('error', 'the phone tier is not on (open /play/sandbox?touch=1)');
    if (d.fps < 30) t.problem('error', `the shower held ${d.fps} fps (30 needed)`);
    if (maxBeds > 2) t.problem('error', `${maxBeds} ambience beds played at once on the phone (2 at most)`);
    if (kb > 2560) t.problem('error', `the new audio is ${kb} KB (under 2560 KB expected)`);
  } else {
    t.metric('newAudioKB', Math.round(newAudioBytes() / 1024));
  }

  // ---- the shower clears
  wx().clear();
  await t.until(() => wx().level < 0.05, 16000, 'the rain to clear');
  t.event('rain-clears', `level ${wx().level}, wet ${wx().wet}, ${wx().particles} drops`);
  t.scene('Rain: cleared');
  L.release();
  releaseAll();
  t.progress(1);
}
