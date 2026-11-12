// The `island-impact` scenario: what everything sounds like when it hits (modules/juice/juice-impact.js, the Hawkes Gen
// impact library in public/play/audio/impact/). Objects of wood, metal, stone, glass are dropped light and heavy onto a stone pad,
// onto the beach (sand) and into the sea (water); the 4x4 rams the crate stack (real input: keys, or the stick with
// touch: true); a fuel barrel is blown at 20 m (the near blast) and another at 80 m (the far rolling boom, late by
// distance / 343 m/s through a low-pass); the rod is cast, struck and reeled for a real catch (taps and holds on the fish
// button with touch). Everything is read from window.__impact.log: material, set, variant, delay, latency. Named shortcuts:
// the account gate, the objects dropped (game.box), the player stood at a distance from a barrel, the barrels set off with
// the engine's own blowUp, the player at the pier end with the rod. No sign-up, safe on live (the hooks refuse there).
export const ISLAND_IMPACT = {
  id: 'island-impact',
  title: 'Impacts: wood, metal, stone, glass, sand and water each have 4+ variants with no repeat in a row; a barrel blast at 80 m arrives 200+ ms late as the far boom; casting, reeling and landing a fish each have a sound; on the phone impacts play within 50 ms and the library is under 3 MB',
  seconds: 480,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, the account gate lifted (named), then objects of each material dropped light and heavy (named: game.box), the 4x4 rammed into the crate stack with real input, a barrel blown at 20 m and at 80 m (named: blowUp, the player stood at the distance), the rod cast, struck and reeled for a catch (real input, taps and holds on the fish button with touch). Events: library-loaded (bytes), impact-variants (per material), no-repeats, impact-latency (max ms), blast-near, blast-far (delay and version), fishing-sounds. Options: touch (true: ?touch=1 at 390x844), at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const I = () => window.__impact;
const local = (g, x, y, z) => { const l = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z]; return Array.isArray(l) ? l : [l.x, l.y, l.z]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MATERIALS = ['wood', 'metal', 'stone', 'glass', 'sand', 'water'];

export async function runIslandImpact(t, helpers) {
  const { releaseAll, stickHold, setKeys, press, pointer, canvas, dragLook, HOOKS, $, options } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && HP().impact && I() && G().mayhem && G().water && W().byId.get('jeep') && W().byId.get('barrel_1'), 90000, 'the island with the impact library (window.__impact)');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the drops and the drive need a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  const g = G(), w = W();

  // ---- the library: loaded (the first tap decodes it) and small
  const tap = canvas ? canvas() : null;
  if (tap && pointer) { pointer('pointerdown', tap); pointer('pointerup', window); }
  await t.until(() => I().ready(), 40000, 'the impact library to load and decode (public/play/audio/impact/index.json)');
  await t.wait(2600); // (the far tails stream in after the near sets)
  const bytes = I().bytes();
  t.metric('impactKB', Math.round(bytes / 1024));
  t.event('library-loaded', `${Math.round(bytes / 1024)} KB of impact audio fetched (3 MB at most), phase ${I().phase()}, sets ${JSON.stringify(I().sets())}`);
  if (bytes > 3 * 1024 * 1024) t.problem('error', `the impact library is ${Math.round(bytes / 1024)} KB (3 MB at most)`);
  I().reset();

  // ---- drops (named): each material, light and heavy, onto a stone pad; sand on the beach; things into the sea
  const stand = (x, z, tx, tz) => {
    const p = w.player;
    const y = (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(x, z) : 3) + 1.1;
    p.controls = false; p.position = local(g, x, y, z); p.velocity = [0, 0, 0];
    try { g.camera.yaw = Math.atan2(tx - x, tz - z); g.camera.pitch = -0.2; } catch { /* default view */ }
  };
  const gy = (x, z) => (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(x, z) : 3);
  const made = [];
  const drop = (name, material, heavy, x, z, h) => {
    const s = heavy ? 0.7 : 0.25;
    const e = g.box({ name, size: [s, s, s], position: local(g, x, gy(x, z) + h, z), physics: 'dynamic', mass: heavy ? 40 : 0.6, color: '#8a93a8', data: { material } });
    made.push(e); return e;
  };
  stand(56, -6, 62, -6);
  const padY = gy(62, -6);
  made.push(g.box({ name: 'imp-pad', size: [10, 0.4, 10], position: local(g, 62, padY + 0.1, -6), physics: 'static', color: '#6b7280', data: { material: 'stone' } }));
  t.event('setup-shortcut', 'a stone pad laid on the beach and objects of each material dropped on it (game.box, local only): the engine\'s own physics and impact events do the rest');
  await t.wait(800);
  for (const m of ['wood', 'metal', 'stone', 'glass']) {
    for (const heavy of [false, true]) {
      for (let i = 0; i < 5; i++) {
        drop(`imp-${m}-${heavy ? 'h' : 'l'}${i}`, m, heavy, 60 + (i % 3) * 1.6, -7 + Math.floor(i / 3) * 2, heavy ? 6 : 1.4);
        await t.wait(heavy ? 700 : 520);
      }
    }
    t.scene(`Impacts: ${m} dropped on stone`);
  }
  // sand: things dropped on the beach (no pad), light and heavy
  for (const heavy of [false, true]) for (let i = 0; i < 5; i++) { drop(`imp-sand-${heavy ? 'h' : 'l'}${i}`, 'wood', heavy, 53 + i * 1.3, -2, heavy ? 6 : 1.6); await t.wait(heavy ? 700 : 520); }
  t.scene('Impacts: things landing in beach sand');
  // water: from over the sea
  let sx = null;
  for (let x = 62; x < 200 && sx === null; x += 2) { const s = HP().water.surfaceAt(x, -12); if (s !== null && s !== undefined && gy(x, -12) < s - 1) sx = x; }
  if (sx === null) { t.problem('warning', 'no open sea found off the beach for the water drops'); sx = 100; }
  stand(sx - 6, -12, sx, -12);
  await t.wait(1500);
  for (const heavy of [false, true]) for (let i = 0; i < 5; i++) {
    const s = heavy ? 1.4 : 0.3;
    const sy = HP().water.surfaceAt(sx + i, -12) ?? 0;
    const e = g.box({ name: `imp-sea-${heavy ? 'h' : 'l'}${i}`, size: [s, s, s], position: local(g, sx + i, sy + (heavy ? 5 : 1.5), -12), physics: 'dynamic', mass: heavy ? 60 : 0.6, color: '#8a93a8', data: { material: 'wood' } });
    made.push(e); await t.wait(heavy ? 900 : 600);
  }
  t.scene('Impacts: things splashing into the sea');
  await t.wait(800);

  // ---- the 4x4 rams the crate stack: real input
  stand(14, -1, 20, -1);
  await HOOKS.enterVehicle(t, 'jeep');
  const jeep = () => w.byId.get('jeep');
  const j0 = jeep();
  j0.position = local(g, 8, gy(8, -1) + 1.2, -1); j0.rotation = [0, 90, 0]; j0.velocity = [0, 0, 0];
  t.event('setup-shortcut', 'the 4x4 stood on the road facing the crate stack (the walk and drive there are other scenarios\')');
  await t.wait(1200);
  let pad = null;
  const pedal = (a, f) => { if (touch) { if (!pad) pad = stickHold(); pad.set(a, f); } else setKeys({ w: f > 0, s: f < 0, d: a > 0, a: a < 0 }); };
  const stop = () => { if (pad) { pad.release(); pad = null; } releaseAll(); };
  const n0 = I().log.length;
  const rammed = () => I().log.slice(n0).filter((e) => e.kind === 'impact' && (/jeep|crate|sign|fence/.test(`${e.body} ${e.other}`))).length;
  const target = w.byId.get('crate_stack_1') || w.byId.get('fence_line_1');
  const tl = performance.now();
  let slow = 0, back = 0, last = performance.now();
  try {
    while (rammed() < 4 && performance.now() - tl < 40000) {
      const j = jeep(), v = j.vehicle;
      const tp = target.home ? target.home.position : [target.x, target.y, target.z];
      const dx = tp[0] - j.x, dz = tp[2] - j.z;
      const err = Math.atan2(dx * v.right.x + dz * v.right.z, dx * v.fwd.x + dz * v.fwd.z);
      const dt = (performance.now() - last) / 1000; last = performance.now();
      if (j.speed < 1.2) slow += dt; else slow = 0;
      if (back > 0) { back -= dt; pedal(err > 0 ? -1 : 1, -1); } else if (slow > 2) { slow = 0; back = 1.3; } else pedal(clamp(err * 2.2, -1, 1), Math.abs(err) > 1.4 ? 0 : 1);
      await t.wait(80);
    }
  } finally { stop(); }
  t.scene('Impacts: the 4x4 rams the crates');
  t.event('ram-impacts', `${rammed()} impacts logged while the 4x4 rammed the stack: ${I().log.slice(n0).filter((e) => e.kind === 'impact').slice(0, 6).map((e) => `${e.material}/${e.weight} #${e.variant}`).join(', ')}`);
  if (rammed() < 2) t.problem('warning', 'the 4x4 made fewer than 2 logged impacts on the crate stack');
  if (HP().vehicles && HP().vehicles.exit) HP().vehicles.exit(false);
  await t.wait(600);

  // ---- blasts: a barrel at 20 m and another at 80 m (named: the player stood at the distance, blowUp)
  const blast = async (id, dist) => {
    const b = w.byId.get(id);
    const bx = b.x, bz = b.z;
    let spot = null;
    for (const [dx, dz] of [[-1, 0], [0, 1], [0, -1], [-0.7, 0.7], [-0.7, -0.7]]) {
      const x = bx + dx * dist, z = bz + dz * dist;
      const s = HP().water.surfaceAt(x, z);
      if (gy(x, z) > 0.4 && (s === null || s === undefined || gy(x, z) > s + 0.3)) { spot = [x, z]; break; }
    }
    if (!spot) { spot = [bx - dist, bz]; t.problem('warning', `no dry land ${dist} m from ${id}: stood there anyway`); }
    stand(spot[0], spot[1], bx, bz);
    await t.wait(1800);
    const n = I().log.length;
    g.mayhem.blowUp(b);
    t.event('setup-shortcut', `the player stood ${dist} m from ${id} and the barrel set off with the engine's own blowUp (the rocket's hit; the aim is another scenario's)`);
    await t.until(() => I().log.slice(n).some((e) => e.kind === 'explosion'), 6000, `the blast sound of ${id}`).catch((e) => t.problem('error', e.message));
    await t.wait(2200);
    t.scene(`Impacts: the blast at ${dist} m`);
    return I().log.slice(n).filter((e) => e.kind === 'explosion' || e.kind === 'debris');
  };
  const near = await blast('barrel_1', 20);
  const bn = near.find((e) => e.kind === 'explosion');
  t.event('blast-near', bn ? `at ${bn.dist} m: ${bn.set} #${bn.variant}, ${bn.delayMs} ms after the flash (distance / 343), ${near.some((e) => e.kind === 'debris') ? 'debris patter followed' : 'no debris patter'}` : 'no blast sound logged');
  if (!bn || bn.weight !== 'near') t.problem('error', `the blast at 20 m did not play the near version (${bn ? bn.set : 'nothing'})`);
  const farBlast = await blast('barrel_2', 80);
  const bf = farBlast.find((e) => e.kind === 'explosion');
  t.event('blast-far', bf ? `at ${bf.dist} m: ${bf.set} #${bf.variant}, ${bf.delayMs} ms after the flash (distance / 343), low-passed at ${bf.lowpass} Hz` : 'no blast sound logged');
  if (!bf) t.problem('error', 'the blast at 80 m logged no sound');
  else {
    t.metric('farBlastDelayMs', bf.delayMs);
    if (bf.weight !== 'far') t.problem('error', `the blast at ${bf.dist} m played the ${bf.weight} version (far expected past 60 m)`);
    if (bf.delayMs < 200) t.problem('error', `the blast at ${bf.dist} m sounded ${bf.delayMs} ms after the flash (200 ms or more expected)`);
  }

  // ---- fishing: cast, plop, strike and reel are real input (the fish button with touch); the catch lands with its flap
  const F = HP().water && HP().water.fish;
  const p = w.player;
  p.position = local(g, 85.2, 2.4, -0.4); p.velocity = [0, 0, 0];
  try { g.camera.yaw = Math.PI / 2; g.camera.pitch = -0.12; } catch { /* default view */ }
  if (g.mayhem && g.mayhem.giveTool) g.mayhem.giveTool('rod');
  try { F.assist(true); } catch { /* a first catch is easy anyway */ }
  t.event('setup-shortcut', 'the player stood at the pier end with the rod in hand, fishing assist on; cast, strike and reel are real input');
  await t.until(() => F.phase() === 'ready', 10000, 'the rod ready').catch((e) => t.problem('warning', e.message));
  if (touch && dragLook) { await dragLook(t, -60); await t.wait(200); }
  p.controls = true;
  const hold = () => (touch ? press($('.water-use')) : (pointer('pointerdown', canvas()), () => pointer('pointerup', window)));
  const f0 = I().log.length;
  const phase = () => F.phase();
  { const up = hold(); await t.wait(1100); up(); }
  await t.until(() => phase() === 'waiting' || phase() === 'bite', 8000, 'the bobber to land').catch((e) => t.problem('error', e.message));
  t.scene('Impacts: the cast and the plop');
  await t.until(() => phase() === 'bite', 28000, 'a bite').catch((e) => t.problem('warning', e.message));
  if (phase() === 'bite') {
    { const u = hold(); await t.wait(90); u(); }
    await t.wait(300);
    const reel = hold();
    await t.until(() => phase() === 'leap' || phase() === 'show' || F.events().some((e) => e.name === 'holdup'), 18000, 'the fish to be reeled in').catch((e) => t.problem('error', e.message));
    reel();
    await t.wait(1200);
  } else {
    HOOKS.catchFish(t, 'trout');
    await t.wait(800);
  }
  const fl = I().log.slice(f0).filter((e) => e.kind === 'fish');
  const seen = new Set(fl.map((e) => e.weight));
  t.event('fishing-sounds', `fishing sounds logged: ${[...seen].join(', ') || 'none'} (${fl.map((e) => `${e.weight} #${e.variant}`).join(', ')})`);
  for (const [k, what] of [['cast', 'casting'], ['plop', 'the bobber landing'], ['strike', 'the strike'], ['reel', 'reeling'], ['flap', 'landing the fish']]) if (!seen.has(k)) t.problem('error', `${what} played no sound of its own (${k})`);
  t.scene('Impacts: the fish lands');

  // ---- the whole log: variants per material, no repeats in a row, latency
  await t.wait(500);
  const S = I().stats(), log = I().log.filter((e) => e.kind === 'impact');
  const perMat = {};
  for (const m of MATERIALS) perMat[m] = (S.variants[m] || []).length;
  t.event('impact-variants', MATERIALS.map((m) => `${m} ${perMat[m]}`).join(', ') + ` variants across ${S.played} impacts (${S.limited} rate-limited)`);
  for (const m of MATERIALS) if (perMat[m] < 4) t.problem('error', `${m} logged ${perMat[m]} different variants (4 or more expected)`);
  let rep = 0;
  const lastBySet = {};
  for (const e of log) { if (lastBySet[e.set] === e.file) rep++; lastBySet[e.set] = e.file; }
  t.metric('impactRepeats', rep); t.metric('impactsPlayed', S.played);
  t.event('no-repeats', `${rep} impacts repeated the variant played just before in the same set, over ${log.length} impacts`);
  if (rep || S.repeats > 0 && log.some((e, i) => i && log[i - 1].file === e.file)) t.problem('error', `${rep} impacts played the same variant twice in a row`);
  t.metric('impactMaxLatencyMs', Math.round(S.maxLatencyMs * 10) / 10);
  t.event('impact-latency', `the slowest impact started ${Math.round(S.maxLatencyMs * 10) / 10} ms after its collision event${touch ? ' (phone controls)' : ''}`);
  if (S.maxLatencyMs > 50) t.problem('error', `an impact started ${Math.round(S.maxLatencyMs)} ms after the collision (50 ms at most)`);
  if (touch && bytes > 3 * 1024 * 1024) t.problem('error', 'impact audio over 3 MB on the phone');
  for (const e of made) { try { e.destroy && e.destroy(); } catch { /* gone */ } }
}
