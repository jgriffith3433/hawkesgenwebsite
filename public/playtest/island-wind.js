// The `island-wind` scenario: the island moves on its own (modules/wind). A 10 s clip of the clearing with trees and grass
// swaying and a gust crossing it (window.__wind: gusts, here, grass, the gust heard); at least 6 gulls circling the beach
// (window.__wildlife) and the 4x4 driven into them (real keys, steered by the vehicle's heading) with the scatter logged
// within a second; no fireflies at noon and fireflies in the clearing at night (the clock set through H.lighting.setHour);
// butterflies by day; the fish at the pier. With touch: true (390x844, ?touch=1) the phone tier: 30 percent grass, 6 gulls,
// no petals, and a 60 s meadow drive with the stick holding 30 fps. Named shortcuts: the account gate, the camera stood in
// place for a shot, the clock for noon and night. No sign-up, safe on live.
export const ISLAND_WIND = {
  id: 'island-wind',
  title: 'Island wind and wildlife: trees and grass sway with gusts crossing the meadow, 6+ gulls scatter when the 4x4 drives in, fireflies only at night; the phone tier draws 30 percent grass and holds 30 fps',
  seconds: 330,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then window.__wind and window.__wildlife are read: a 10 s clip of the clearing (sway-and-gust: the gust crossing, how hard it blew and that the grass was drawn), the gulls circling (gulls-circling), the 4x4 driven into them (gull-scatter within 1 s, scatter-count) and the flock settling again (gulls-settled), noon with no fireflies and butterflies (no-fireflies-at-noon), night with fireflies (fireflies-at-night) and the clearing at both (scenes "Wind: ..."). Options: touch (true: ?touch=1 at 390x844: phone-tier checks (grass 30 percent, 6 gulls, no petals) then a 60 s meadow drive with the stick: drive-fps, 30 needed), seconds (the drive, 60), at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const wind = () => window.__wind || null;
const wild = () => window.__wildlife || null;

function frameMeter() {
  let frames = 0, worst = 0, freezes = 0, running = true, last = performance.now();
  const t0 = last;
  const raf = (n) => { frames++; const d = n - last; worst = Math.max(worst, d); if (d > 500) freezes++; last = n; if (running) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return { stop() { running = false; return { fps: Math.round(frames / ((performance.now() - t0) / 1000)), worst: Math.round(worst), freezes }; } };
}

/** The player stood at (x, z) looking at (tx, tz) in the third-person view: a fixed shot. */
function stand(t, x, z, tx, tz, what) {
  const g = G(), p = W() && W().player;
  if (!g || !p) throw new Error(`${what}: the island is not ready`);
  const y = (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(x, z) : 4) + 1.1;
  const local = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z];
  p.controls = false;
  p.position = Array.isArray(local) ? local : [local.x, local.y, local.z];
  p.velocity = [0, 0, 0];
  try { if (g.camera) { g.camera.yaw = Math.atan2(tx - x, tz - z); g.camera.pitch = -0.12; if (g.camera.mode !== undefined) g.camera.mode = 'third'; } } catch { /* the default view */ }
  t.event('setup-shortcut', `the camera for "${what}": the player stood at ${Math.round(x)}, ${Math.round(z)} looking at ${Math.round(tx)}, ${Math.round(tz)}`);
}

export async function runIslandWind(t, helpers) {
  const { releaseAll, stickHold, tapButton, $, HOOKS, options, setKeys } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && HP().wind && wind() && wild() && HP().lighting, 90000, 'the island with its wind and wildlife (window.__wind, window.__wildlife)');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the shots need a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  await t.wait(2500); // (the grass grows in over the first seconds)
  const L = HP().lighting;
  const w0 = wind(), k0 = wild();
  t.event('wind-state', `tier ${w0.tier}, grass ${w0.grass} clumps and ${w0.flowers} flowers at density ${w0.grassDensity}, reach ${w0.grassReach} m, petals up to ${w0.petalsMax}, ${w0.palms} palms, shader ${w0.plugin ? 'on' : 'MISSING'}`);
  t.event('wildlife-state', `${k0.gulls} gulls, ${k0.butterfliesMax} butterflies, ${k0.firefliesMax} fireflies, tier ${k0.tier}`);
  if (!w0.plugin) t.problem('error', 'the wind shader plugin is not registered (this browser has no material plugins)');
  if (!w0.grass) t.problem('error', 'no grass is drawn round the player');

  // ---- the phone tier
  if (touch) {
    if (w0.tier !== 'phone') t.problem('error', `the phone's tier is ${w0.tier} (phone expected)`);
    if (w0.grassDensity !== 0.3) t.problem('error', `the phone draws grass at density ${w0.grassDensity} (0.3 expected)`);
    if (k0.gulls !== 6) t.problem('error', `the phone draws ${k0.gulls} gulls (6 expected)`);
    if (w0.petalsMax !== 0) t.problem('error', `the phone has ${w0.petalsMax} petals (none expected)`);
    t.event('phone-tier', `grass density ${w0.grassDensity} (${w0.grass} clumps), ${k0.gulls} gulls, ${w0.petalsMax} petals`);
  }

  const jeep = W().byId.get('jeep');
  if (!touch) {
    // ---- criterion 1: ten seconds of the clearing with a gust crossing it
    L.setHour(12); t.event('setup-shortcut', 'the clock held at noon for the clearing shots');
    stand(t, jeep.x - 6, jeep.z - 2, jeep.x + 10, jeep.z + 6, 'the clearing');
    await t.wait(1500);
    t.scene('Wind: the clearing');
    const g0 = wind().gusts;
    let maxHere = 0, peaked = false, heard = 0, live = 0, samples = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 10000 || (maxHere < 0.35 && performance.now() - t0 < 24000)) {
      const w = wind();
      samples++; maxHere = Math.max(maxHere, w.here); heard = Math.max(heard, w.heard || 0); if (w.live) live++;
      if (!peaked && w.here > 0.4) { peaked = true; t.scene('Wind: a gust crossing the clearing'); }
      await t.wait(150);
    }
    const w1 = wind();
    t.event('sway-and-gust', `over ${Math.round((performance.now() - t0) / 100) / 10} s: ${w1.gusts - g0} gust(s) started, the strongest at the player ${maxHere.toFixed(2)} (${w1.dir.map((v) => v.toFixed(2))} the way it blows), ${w1.grass} grass clumps and ${w1.flowers} flowers drawn, ${w1.pushers} pushing, petals ${w1.petals}`);
    t.event('gust-heard', heard > 0.05 ? `the gust sound rose to ${heard.toFixed(2)} as the gust passed` : 'no gust sound was measured (the audio is not running in this browser)');
    t.metric('gustMaxAtPlayer', Math.round(maxHere * 100) / 100); t.metric('grassClumps', w1.grass);
    if (maxHere < 0.35) t.problem('error', `no gust crossed the clearing in ${Math.round((performance.now() - t0) / 1000)} s`);
    if (!w1.dir || !(w1.gusts > g0)) t.problem('error', 'no gust started in the clip');

    // ---- butterflies by day, none of the fireflies
    const k1 = wild();
    t.event('no-fireflies-at-noon', `at ${k1.hour} h: ${k1.fireflies} fireflies, ${k1.butterflies} butterflies`);
    if (k1.fireflies !== 0) t.problem('error', `${k1.fireflies} fireflies are drawn at noon (none expected)`);
    if (!k1.butterflies) t.problem('error', 'no butterflies fly in the clearing by day');
    t.scene('Wildlife: butterflies in the clearing');

    // ---- criterion 2: the gulls, and the 4x4 driven into them
    stand(t, 50, -8, 72, -6, 'the beach');
    L.release(); L.setHour(12);
    await t.wait(2200);
    t.scene('Wildlife: gulls over the beach');
    const k2 = wild();
    const need = Math.min(6, k2.gulls);
    t.event('gulls-circling', `${k2.gullsCircling} of ${k2.gulls} gulls circling the beach (${need}+ needed); lowest ${k2.minGullClearance} m over what is under them`);
    if (k2.gullsCircling < need) t.problem('error', `only ${k2.gullsCircling} gulls circle the beach (${need} needed)`);
    if (k2.minGullClearance < 3) t.problem('error', `a gull flew ${k2.minGullClearance} m over the ground (3 m or more expected)`);
    // the 4x4: the engine's own enter (a named shortcut: the drive to the dock is another scenario's), then W held and the heading steered to the beach
    W().player.controls = true;
    await HOOKS.enterVehicle(t, 'jeep');
    const sc0 = wild().scatterCount;
    const tx = 66, tz = -2;
    let sign = 1, bad = 0, ref = null;
    const down = new Set();
    const key = (k, on) => { if (on && !down.has(k)) { down.add(k); setKeys({ ...Object.fromEntries([...down].map((x) => [x, true])) }); } if (!on && down.has(k)) { down.delete(k); setKeys({ ...Object.fromEntries([...down].map((x) => [x, true])) }); } };
    const t1 = performance.now();
    try {
      key('w', true);
      while (wild().scatterCount === sc0) {
        if (performance.now() - t1 > 60000) throw new Error('timed out driving into the gulls (no scatter)');
        const v = jeep.vehicle;
        const dx = tx - jeep.x, dz = tz - jeep.z;
        const err = Math.atan2(dx * v.right.x + dz * v.right.z, dx * v.fwd.x + dz * v.fwd.z);
        if (ref && performance.now() - ref.at > 700) { if (Math.abs(err) > Math.abs(ref.err) + 0.08) { if (++bad >= 2) { sign = -sign; bad = 0; } } else bad = 0; ref = null; }
        if (!ref && Math.abs(err) > 0.3) ref = { at: performance.now(), err };
        const steer = Math.abs(err) > 0.1 ? Math.sign(err) * sign : 0;
        key('d', steer > 0); key('a', steer < 0);
        if (Math.hypot(dx, dz) < 4) { key('w', false); await t.wait(400); key('w', true); }
        await t.wait(80);
      }
    } finally { releaseAll(); }
    const sc = wild().last;
    t.scene('Wildlife: the gulls scatter');
    t.event('gull-scatter', `${sc.count} gulls scattered by the ${sc.cause} (${sc.dist} m away), ${sc.ms} ms after it came within range`);
    t.metric('scatterMs', sc.ms); t.metric('scatterCount', sc.count);
    if (sc.count < need) t.problem('error', `only ${sc.count} gulls scattered (${need} needed)`);
    if (sc.cause !== 'vehicle') t.problem('warning', `the scatter was by "${sc.cause}", not the 4x4`);
    if (sc.ms > 1000) t.problem('error', `the gulls took ${sc.ms} ms to scatter (1000 ms or less needed)`);
    await t.wait(1200);
    t.scene('Wildlife: the flock flying off');
    await t.until(() => wild().gullsCircling >= need, 40000, 'the gulls to settle back into their circles').then(() => t.event('gulls-settled', `${wild().gullsCircling} gulls back in their circles`), (e) => t.problem('warning', e.message));

    // ---- the fish
    const fj = wild().fishJumps;
    await t.until(() => wild().fishJumps > fj, 30000, 'the fish to jump off the pier').then(() => t.event('fish-jump', `a fish jumped at ${JSON.stringify(wild().lastFish)}`), (e) => t.problem('warning', e.message));

    // ---- criterion 3: fireflies at night
    L.setHour(23);
    stand(t, jeep.x - 6, jeep.z - 2, jeep.x + 10, jeep.z + 6, 'the clearing at night');
    await t.wait(2500);
    t.scene('Wildlife: fireflies in the clearing at night');
    const k3 = wild();
    t.event('fireflies-at-night', `at ${k3.hour} h: ${k3.fireflies} of ${k3.firefliesMax} fireflies, ${k3.butterflies} butterflies`);
    if (!k3.fireflies) t.problem('error', 'no fireflies are drawn in the clearing at night');
    if (k3.butterflies) t.problem('error', `${k3.butterflies} butterflies fly at night`);
    t.event('nothing-in-geometry', `${k3.insideGeometry} flyer frames inside a model; lowest butterfly or firefly ${k3.minFlyClearance} m over the ground`);
    if (k3.insideGeometry > 0) t.problem('error', `flyers were inside geometry on ${k3.insideGeometry} frames`);
    if (k3.minFlyClearance < 0.3) t.problem('error', `a butterfly or firefly came ${k3.minFlyClearance} m from the ground (grounded: 0.3 m or more)`);
    L.release();
  } else {
    // ---- criterion 4: a 60 s meadow drive on a phone
    L.setHour(12); await t.wait(1200);
    t.scene('Wind: phone, the meadow');
    if (!HP().touchUi) throw new Error('the phone controls are not on (open /play/sandbox?touch=1)');
    await t.until(() => $('#touch .pad') && $('#touch .b'), 15000, 'the stick and the buttons');
    L.release();
    releaseAll();
    const P = () => W().player;
    let s = null; const t0 = performance.now();
    try {
      s = stickHold();
      for (;;) {
        const dx = jeep.x - P().x, dz = jeep.z - P().z, d = Math.hypot(dx, dz);
        if (d <= 3.2) break;
        if (performance.now() - t0 > 60000) throw new Error('timed out walking to the 4x4 with the stick');
        const yaw = helpers.camYaw(), sn = Math.sin(yaw), c = Math.cos(yaw);
        s.set((dx * c - dz * sn) / d, (dx * sn + dz * c) / d);
        await t.wait(80);
      }
    } finally { if (s) s.release(); }
    for (let i = 0; i < 4 && !(G().player && G().player.controller === 'drive'); i++) { await tapButton(t, $('#touch .b')); await t.wait(700); }
    if (!(G().player && G().player.controller === 'drive')) throw new Error('timed out getting into the 4x4 with B');
    await t.wait(1000);
    t.scene('Wind: phone, in the 4x4 on the meadow');
    const seconds = Math.max(10, Number(options && options.seconds) || 60);
    const meter = frameMeter();
    const st = stickHold(), a0 = { x: jeep.x, z: jeep.z };
    const t1 = performance.now();
    let n = 0, minGrass = 1e9, maxHere = 0;
    while (performance.now() - t1 < seconds * 1000) {
      st.set(n % 3 === 1 ? (n % 6 === 1 ? -0.8 : 0.8) : 0, 1);
      await t.wait(n % 3 === 1 ? 900 : 2600);
      n++;
      const w = wind(); if (w) { minGrass = Math.min(minGrass, w.grass); maxHere = Math.max(maxHere, w.here); }
      if (n === 4) t.scene('Wind: phone, driving through the grass');
    }
    st.release();
    const d = meter.stop();
    const w1 = wind();
    t.metric('driveFps', d.fps); t.metric('driveWorstFrameMs', d.worst); t.metric('driveFreezes', d.freezes); t.metric('grassClumps', w1 ? w1.grass : 0);
    t.event('drive-fps', `${d.fps} fps over ${seconds} s of driving with touch on the meadow (worst frame ${d.worst} ms, ${d.freezes} freezes over 500 ms, ${Math.round(Math.hypot(jeep.x - a0.x, jeep.z - a0.z))} m from the start); grass ${w1 ? w1.grass : '?'} clumps (fewest ${minGrass}), a gust ${maxHere.toFixed(2)} at most, tier ${w1 && w1.tier}`);
    if (d.fps < 30) t.problem('error', `the phone tier held ${d.fps} fps on the meadow drive (30 needed)`);
    if (w1 && w1.tier !== 'phone') t.problem('error', `window.__wind.tier is ${w1.tier} on the phone`);
  }
  const hits = (window.__hgConsole || []).filter(([, , text]) => /WebGL|GL_|GL ERROR|INVALID_|shader/i.test(String(text)));
  t.metric('webglLines', hits.length);
  t.event('no-webgl-lines', hits.length ? `${hits.length} line(s): ${hits.slice(0, 5).map((h) => h[2]).join(' | ')}` : 'no WebGL or shader lines in the console since load');
  if (hits.length) t.problem('error', `${hits.length} WebGL or shader line(s) in the console (the wind shader?): ${hits[0][2]}`);
  releaseAll();
  t.progress(1);
}
