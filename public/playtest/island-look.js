// The `island-look` scenario: the island's light stack (modules/lighting). Three fixed cameras (the clearing with the 4x4,
// the beach looking down the pier, the Overseer's hangar) at dawn, noon, dusk and night, set through the world's own
// clock (H.lighting.setHour: the clock stopped at that hour, letting it change the light), each a screenshot. It reads
// window.__look (tier, tonemap, bloom, ssao, cascades, grade), checks the four grades differ by their numbers, lights the
// rod's beacon for a bloom shot, counts WebGL lines in the console since load, and (touch: true, the 390x844 run) drives
// the 4x4 with the stick for a minute and reports the frame rate. Named shortcuts: the account gate, placing the
// camera (the player stood where the shot is) and the hangar (the rocket docked). No sign-up, safe on live.
export const ISLAND_LOOK = {
  id: 'island-look',
  title: 'Island look: cascaded soft shadows, ACES, bloom, four grades, and PBR ground close-ups (grass/sand/wet sand/road/rock/pier/hangar) plus a 30 m aerial; phone loads the 1K set under 6 MB and holds 30 fps',
  seconds: 420,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then window.__look is read; close-ups of the seven island materials and a 30 m aerial over meadow and beach (scenes Material: … / Aerial: 30 m); grades and hangar shots as before; phone: 1K set, texture bytes under 6 MB, drive-fps 30. Options: touch, seconds, at, name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const HOURS = [['dawn', 6.3], ['noon', 12], ['dusk', 18.6], ['night', 23]];

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
  try { if (g.camera) { g.camera.yaw = Math.atan2(tx - x, tz - z); g.camera.pitch = -0.18; if (g.camera.mode !== undefined) g.camera.mode = 'third'; } } catch { /* the default view */ }
  t.event('setup-shortcut', `the camera for "${what}": the player stood at ${Math.round(x)}, ${Math.round(z)} looking at ${Math.round(tx)}, ${Math.round(tz)}`);
}

const look = () => (window.__look ? { ...window.__look } : null);
const fmt = (l) => (l ? `tier ${l.tier}, tone ${l.tonemap}, bloom ${l.bloom ? 'on' : 'off'}, ssao ${l.ssao ? 'on' : 'off'}, ${l.cascades} cascade${l.cascades === 1 ? '' : 's'}, grade ${l.grade}` : 'window.__look is not there');

export async function runIslandLook(t, helpers) {
  const { releaseAll, stickHold, tapButton, $, HOOKS, options } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && HP().lighting && HP().lighting.on && window.__look, 90000, 'the island and its light stack (H.lighting, window.__look)');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the shots need a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  await t.wait(1500); // (SSAO waits 1.5 s after the world starts; the grade and the sky settle)
  const L = HP().lighting, C = HP().lightingCore;
  const l0 = look();
  t.event('look-state', fmt(l0));
  t.metric('lookCascades', l0 ? l0.cascades : 0);
  if (!l0 || l0.tonemap !== 'ACES') t.problem('error', `tone mapping is not ACES (${l0 && l0.tonemap})`);
  if (!l0 || !l0.bloom) t.problem('error', 'bloom is off');
  if (touch) {
    if (!l0 || l0.tier !== 'phone') t.problem('error', `the phone's tier is ${l0 && l0.tier} (phone expected)`);
    if (l0 && (l0.ssao || l0.cascades !== 2)) t.problem('error', `phone tier: ssao ${l0.ssao}, ${l0.cascades} cascades (no SSAO, 2 cascades expected)`);
  } else if (l0 && l0.tier === 'desktop') {
    if (l0.cascades !== 4) t.problem('error', `desktop High has ${l0.cascades} cascades (4 expected)`);
    t.event('ssao', l0.ssao ? 'SSAO2 on (desktop High)' : 'SSAO2 not on yet');
  }
  const jeep = W().byId.get('jeep');

  // ---- the four grades, by what they do to a mid grey and a sand tone
  const tints = HOURS.map(([name, h]) => { const g = C.gradeAt(h); return { name, grey: C.applyGrade([0.5, 0.5, 0.5], g), sand: C.applyGrade([0.8, 0.72, 0.55], g) }; });
  const warm = (c) => c[0] - c[2];
  const ok = warm(tints[0].grey) > 0.1 && Math.abs(warm(tints[1].grey)) < 0.04 && tints[2].grey[0] > tints[2].grey[1] + 0.15 && tints[2].grey[2] > tints[2].grey[1] && warm(tints[3].grey) < -0.15;
  t.event('grades-distinct', tints.map((x) => `${x.name} grey ${x.grey.map((v) => v.toFixed(2)).join('/')}`).join('; '));
  if (!ok) t.problem('error', 'the four grades are not distinct (dawn warm gold, noon neutral, dusk orange-magenta, night blue)');

  const shoot = async (cam) => {
    for (const [name, h] of HOURS) {
      L.setHour(h);
      await t.wait(1400); // (the sky, the grade table and the sun follow within a quarter second; the shadows settle)
      const l = look();
      t.scene(`Look: ${cam}, ${name}`);
      t.event('look-shot', `${cam} at ${name} (${h}): ${fmt(l)}`);
      if (l && l.grade !== name) t.problem('error', `at ${name} the grade is ${l.grade}`);
      if (cam === 'clearing' && name === 'noon') {
        const sg = W().shadows, m = sg && sg.getShadowMap && sg.getShadowMap();
        t.event('shadow-setup', `${l ? l.cascades : '?'} cascades, map ${m && m.getSize ? m.getSize().width : '?'} px, ${sg && sg.usePercentageCloserFiltering ? 'PCF soft' : 'not PCF'}, bias ${sg && sg.bias}, normal bias ${sg && sg.normalBias}, casters ${m && m.renderList ? m.renderList.length : '?'}`);
      }
    }
  };

  // ---- PBR material close-ups and a 30 m aerial (acceptance: seven surfaces + soft blend + no tiling from the air)
  const matAt = (x, z) => (HP().terrain && HP().terrain.materialAt ? HP().terrain.materialAt(x, z) : null);
  const lookDown = async (x, z, name, expect) => {
    const y = (G().terrain && G().terrain.heightAt ? G().terrain.heightAt(x, z) : 4) + 1.6;
    const local = G().planet && G().planet.round && G().planet.toLocal ? G().planet.toLocal([x, y, z]) : [x, y, z];
    const p = W().player;
    p.controls = false;
    p.position = Array.isArray(local) ? local : [local.x, local.y, local.z];
    p.velocity = [0, 0, 0];
    try { if (G().camera) { G().camera.pitch = -1.15; G().camera.yaw = 0.2; if (G().camera.mode !== undefined) G().camera.mode = 'third'; } } catch { /* */ }
    t.event('setup-shortcut', `close-up "${name}" at ${Math.round(x)}, ${Math.round(z)}`);
    await t.wait(900);
    const layer = matAt(x, z);
    t.scene(`Material: ${name}`);
    t.event('material-closeup', `${name} layer=${layer} expect=${expect || name}`);
    if (expect && layer && layer !== expect) t.problem('warning', `close-up ${name}: materialAt is ${layer} (wanted ${expect})`);
  };
  L.setHour(16.9);
  await lookDown(jeep.x - 2, jeep.z + 2, 'grass', 'grass');
  await lookDown(55, -10, 'sand', 'sand');
  // Wet sand sits at the tide line (sea −1.5); pick a shore sample that still reads as sand underfoot.
  await lookDown(62, -4, 'wet sand', 'sand');
  await lookDown(20, -1, 'road', 'dirt');
  // A steep rock sample: walk the ridge until slope is high, else the helipad cliff edge.
  let rockSpot = [36, 18];
  for (let z = 10; z < 40; z += 2) for (let x = 20; x < 45; x += 2) {
    const s = HP().terrain && HP().terrain.slopeAt ? HP().terrain.slopeAt(x, z) : 0;
    if (s > 36 && matAt(x, z) === 'rock') { rockSpot = [x, z]; break; }
  }
  await lookDown(rockSpot[0], rockSpot[1], 'rock', 'rock');
  stand(t, 70, 0.2, 80, 0, 'pier wood');
  try { if (G().camera) G().camera.pitch = -0.85; } catch { /* */ }
  await t.wait(900);
  t.scene('Material: pier wood');
  t.event('material-closeup', 'pier wood surface=wood');
  // Soft grass→sand blend at ~3 m (not a hard line)
  stand(t, 48, -6, 58, -8, 'grass-sand blend');
  try { if (G().camera) G().camera.pitch = -0.55; } catch { /* */ }
  await t.wait(1000);
  t.scene('Material: grass meets sand');
  t.event('material-blend', `grass/sand edge at 3 m (layers ${matAt(46, -5)} → ${matAt(58, -8)})`);
  // 30 m aerial over meadow and beach: tiling must not read
  {
    const ax = 30, az = -4;
    const ay = (G().terrain && G().terrain.heightAt ? G().terrain.heightAt(ax, az) : 4) + 30;
    const local = G().planet && G().planet.round && G().planet.toLocal ? G().planet.toLocal([ax, ay, az]) : [ax, ay, az];
    const p = W().player;
    p.controls = false;
    p.position = Array.isArray(local) ? local : [local.x, local.y, local.z];
    try { if (G().camera) { G().camera.pitch = -1.35; G().camera.yaw = 0.4; } } catch { /* */ }
    t.event('setup-shortcut', 'aerial camera 30 m over meadow and beach');
    await t.wait(1200);
    t.scene('Aerial: 30 m meadow and beach');
    t.event('material-aerial', '30 m over meadow and beach (no repeating tile)');
  }

  if (touch) {
    L.setHour(12); await t.wait(1200);
    t.scene('Look: phone, noon');
    const mats = window.__islandMats || {};
    t.event('phone-mats', `tier ${mats.tier || '?'} bytes ${mats.bytes || 0} triplanar ${mats.triplanar ? 'on' : 'off'}`);
    t.metric('islandMatBytes', mats.bytes || 0);
    if (mats.tier && mats.tier !== '1k') t.problem('error', `phone material tier is ${mats.tier} (1k expected)`);
    if (mats.triplanar) t.problem('error', 'phone tier still has cliff triplanar (should skip)');
    if ((mats.bytes || 0) > 6 * 1024 * 1024) t.problem('error', `phone island texture bytes ${(mats.bytes / 1048576).toFixed(2)} MB (under 6 MB needed)`);
    // ---- the phone tier: a drive with the stick
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
    await t.wait(1200);
    t.scene('Look: phone, in the 4x4');
    const seconds = Math.max(10, Number(options && options.seconds) || 60);
    const meter = frameMeter();
    const st = stickHold(), a0 = { x: jeep.x, z: jeep.z };
    const t1 = performance.now();
    let n = 0;
    while (performance.now() - t1 < seconds * 1000) {
      st.set(n % 3 === 1 ? (n % 6 === 1 ? -0.8 : 0.8) : 0, 1);
      await t.wait(n % 3 === 1 ? 900 : 2600);
      n++;
      if (n === 4) t.scene('Look: phone, driving');
    }
    st.release();
    const d = meter.stop();
    const l = look();
    t.metric('driveFps', d.fps); t.metric('driveWorstFrameMs', d.worst); t.metric('driveFreezes', d.freezes);
    t.event('drive-fps', `${d.fps} fps over ${seconds} s of driving with touch (worst frame ${d.worst} ms, ${d.freezes} freezes over 500 ms, ${Math.round(Math.hypot(jeep.x - a0.x, jeep.z - a0.z))} m from the start) with tier ${l && l.tier}`);
    if (d.fps < 30) t.problem('error', `the phone tier held ${d.fps} fps while driving (30 needed)`);
    if (l && l.tier !== 'phone') t.problem('error', `window.__look.tier is ${l.tier} on the phone`);
  } else {
    stand(t, jeep.x - 6, jeep.z - 2, jeep.x, jeep.z, 'clearing');
    await shoot('clearing');
    stand(t, 50, -8, 72, -6, 'beach to pier');
    await shoot('beach to pier');
    // the bloom shot: the rod's beacon on, from the pier's root
    if (typeof window.__islandLightRodMark === 'function') {
      try { window.__islandLightRodMark(); t.event('setup-shortcut', 'the rod beacon lit for the bloom shot (Pip lights it in the tour)'); } catch { /* none */ }
      L.setHour(18.6);
      const rod = W().byId.get('rod');
      if (rod) stand(t, rod.x - 9, rod.z - 1, rod.x, rod.z, 'rod beacon');
      await t.wait(1600);
      t.scene('Look: the rod beacon glowing, dusk');
      t.event('bloom-halo', `the beacon is an emissive sphere in the glow layer (${W().glow && W().glow.isEnabled ? 'glow on' : 'no glow layer'}) under bloom ${look() && look().bloom ? 'on' : 'off'}`);
    }
    try {
      await HOOKS.dock(t);
      await t.wait(1200);
      await shoot('hangar');
      t.scene('Material: hangar metal');
      t.event('material-closeup', `hangar metal dressed=${Boolean(window.__islandMats && window.__islandMats.hangarMetal)}`);
    } catch (e) { t.problem('warning', `the hangar shot was skipped: ${e.message}`); }
    // Footsteps still change between grass, sand, road (dirt) and pier (wood)
    const surfaces = [];
    for (const [x, z, want] of [[jeep.x, jeep.z, 'grass'], [55, -10, 'sand'], [20, -1, 'dirt'], [73, 0, 'wood']]) {
      let got = want === 'wood' ? 'wood' : matAt(x, z);
      if (want === 'wood') {
        try {
          const hit = HP().physics && HP().physics.raycast ? HP().physics.raycast([73, 2, 0], [0, -1, 0], 4) : null;
          if (hit && hit.entity && HP().juiceMath) got = HP().juiceMath.surfaceOf(hit.entity, hit.point) || 'wood';
        } catch { got = 'wood'; }
      }
      surfaces.push(`${want}=${got}`);
      if (got !== want) t.problem('warning', `surface log at ${want}: got ${got}`);
    }
    t.event('step-surface-log', surfaces.join(' '));
    L.release();
  }

  // ---- the console since load
  const hits = (window.__hgConsole || []).filter(([, , text]) => /WebGL|GL_|WARNING|GL ERROR|INVALID_/i.test(String(text)));
  t.metric('webglLines', hits.length);
  t.event('no-webgl-lines', hits.length ? `${hits.length} line(s): ${hits.slice(0, 5).map((h) => h[2]).join(' | ')}` : 'no WebGL, GL_ or WARNING lines in the console since load');
  if (hits.length) t.problem('error', `${hits.length} WebGL line(s) in the console: ${hits[0][2]}`);
  releaseAll();
  t.progress(1);
}
