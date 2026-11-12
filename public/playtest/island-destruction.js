// The `island-destruction` scenario: the island's small props react (modules/mayhem: mayhem-props.js; docs/story.md "The island
// answers"). The 4x4 is driven (keys, or the stick with touch: true) through two signposts, a fence line and a crate stack: each
// must break into 4 or more pieces with dust (`__props` log: break, pieces, material; at most 12 on a phone). A fuel barrel is
// blown beside the pier: the loose casks and pots near it topple (and the ones within reach break), what falls into the sea
// splashes (log: splash, with rings: water ripples), and the player walking off the pier splashes too. The rod and the lore
// objects are asked to break and must not. Then the island is left alone out of view and every broken or toppled prop must be
// back at home within 2 minutes plus the out-of-view wait. Named shortcuts: the account gate, the 4x4 put in (hook), the 4x4
// stood on the road, the blast set off (the engine's own blowUp), the player put on the beach. Never on live-only data; no sign-up.
export const ISLAND_DESTRUCTION = {
  id: 'island-destruction',
  title: 'Island destruction: the 4x4 smashes signposts, a fence line and a crate stack into 4+ pieces with dust; a barrel blast topples the pier\'s props; things falling in the sea splash with rings; broken props are rebuilt within 2 minutes; the rod and lore never break; the phone tier holds 30 fps with 12 pieces at most',
  seconds: 480,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, the account gate lifted (named), the 4x4 put in and stood on the road (named), then real driving: signposts, a fence and a crate stack break (props-break: pieces, material, dust; metric piecesMin / piecesMax), fence-drive-fps. A barrel is blown beside the pier (named): props-topple, props-break near it, props-splash (size, rings), player-splash from walking off the pier, keep-safe (rod and lore refuse to break). Then props-restored for each within 2 minutes (metric restoreSeconds). Options: touch (true: ?touch=1, the stick, 30 fps, 12 pieces at most), at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const P = () => window.__props;
const local = (g, x, y, z) => { const l = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z]; return Array.isArray(l) ? l : [l.x, l.y, l.z]; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function frameMeter() {
  let frames = 0, worst = 0, running = true, last = performance.now();
  const t0 = last;
  const raf = (n) => { frames++; worst = Math.max(worst, n - last); last = n; if (running) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return { stop() { running = false; return { fps: Math.round(frames / ((performance.now() - t0) / 1000)), worst: Math.round(worst) }; } };
}

export async function runIslandDestruction(t, helpers) {
  const { releaseAll, stickHold, setKeys, lookAt, HOOKS, options } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && G().mayhem && G().mayhem.props && G().vehicles && W().byId.get('jeep') && W().byId.get('fence_line_0'), 90000, 'the island with its breakable props (mayhem-props.js)');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the drive needs a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  const g = G(), w = W();
  await t.wait(2500);
  const jeep = () => w.byId.get('jeep');
  const driving = () => g.player && g.player.controller === 'drive';

  // ---- the 4x4: put in (named), stood on the road west of the first signpost, facing east
  await HOOKS.enterVehicle(t, 'jeep');
  if (!driving()) throw new Error('the 4x4 was not entered (hooks.enterVehicle)');
  const j0 = jeep();
  j0.position = local(g, 8, (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(8, -1) : 4) + 1.2, -1);
  j0.rotation = [0, 90, 0];
  j0.velocity = [0, 0, 0];
  t.event('setup-shortcut', 'the 4x4 stood on the road at x 8 facing east, so the first signpost is ahead (the walk to it is another scenario\'s)');
  await t.wait(1500);

  let pad = null;
  const pedal = (a, f) => { if (touch) { if (!pad) pad = stickHold(); pad.set(a, f); } else setKeys({ w: f > 0, s: f < 0, d: a > 0, a: a < 0 }); };
  const stop = () => { if (pad) { pad.release(); pad = null; } releaseAll(); };
  const heard = new Set();
  const brokeIds = () => P().log.filter((l) => l.type === 'break').map((l) => l.id);
  const hit = (id) => P().log.find((l) => l.type === 'break' && l.id === id);

  // Drive at a thing until it breaks (or time is up): aim, full throttle, back out when stuck.
  async function ram(id, ms) {
    const e = w.byId.get(id);
    const tl = performance.now();
    let slow = 0, back = 0, last = performance.now();
    while (!hit(id) && performance.now() - tl < ms) {
      const j = jeep(), v = j.vehicle;
      const dx = e.home.position[0] - j.x, dz = e.home.position[2] - j.z;
      const err = Math.atan2(dx * v.right.x + dz * v.right.z, dx * v.fwd.x + dz * v.fwd.z);
      const dt = (performance.now() - last) / 1000; last = performance.now();
      if (j.speed < 1.2) slow += dt; else slow = 0;
      if (back > 0) { back -= dt; pedal(err > 0 ? -1 : 1, -1); }
      else if (slow > 2) { slow = 0; back = 1.3; }
      else pedal(clamp(err * 2.2, -1, 1), Math.abs(err) > 1.4 ? 0 : 1);
      await t.wait(80);
    }
    return hit(id);
  }
  const report = (label, id) => {
    const l = hit(id);
    if (!l) { t.problem('error', `driving at ${label} (${id}) never broke it`); return null; }
    t.event('props-break', `${label}: ${l.pieces} pieces of ${l.material} (dust and splinters), the 4x4 at ${Math.round(jeep().speed)} m/s`);
    if (l.pieces < 4) t.problem('error', `${label} broke into only ${l.pieces} pieces (4 or more expected)`);
    if (touch && l.pieces > 12) t.problem('error', `${label} broke into ${l.pieces} pieces on the phone tier (12 at most)`);
    return l;
  };

  const meter = frameMeter();
  const counts = [];
  await ram('sign_road_a_post', 25000); t.scene('4x4: a signpost bursts'); counts.push(report('the road signpost', 'sign_road_a_post'));
  await ram('fence_line_1', 30000); await t.wait(300); t.scene('4x4: through the fence line'); counts.push(report('the fence', 'fence_line_1'));
  const fenceFps = meter.stop();
  await ram('fence_line_2', 8000);
  const crate = ['crate_stack_1', 'crate_stack_2', 'crate_stack_3'];
  await ram('crate_stack_1', 30000); await t.wait(500); t.scene('4x4: the crate stack scatters');
  counts.push(report('the crate stack', 'crate_stack_1'));
  await ram('sign_road_b_post', 25000); t.scene('4x4: the second signpost'); counts.push(report('the second signpost', 'sign_road_b_post'));
  stop();
  void crate;
  const sizes = counts.filter(Boolean).map((c) => c.pieces);
  t.metric('piecesMin', Math.min(...sizes)); t.metric('piecesMax', Math.max(...sizes));
  t.metric('fenceDriveFps', fenceFps.fps); t.metric('fenceWorstFrameMs', fenceFps.worst);
  t.event('fence-drive-fps', `${fenceFps.fps} fps through the signpost and the fence line (worst frame ${fenceFps.worst} ms)${touch ? ', phone controls' : ''}`);
  if (touch && fenceFps.fps < 30) t.problem('error', `driving through the fence line held ${fenceFps.fps} fps on the phone tier (30 needed)`);
  const live = g.mayhem.debris.length;
  if (touch && live > 12 * 4) t.problem('warning', `${live} debris pieces alive after four breaks on the phone tier`);

  // ---- the barrel beside the pier (named): the player on the pier's landward end, the blast set off
  const pl = w.player;
  if (HP().vehicles && HP().vehicles.exit) HP().vehicles.exit(false);
  await t.wait(600);
  pl.position = local(g, 62, 3.4, 0.2);
  pl.velocity = [0, 0, 0];
  try { g.camera.yaw = Math.PI / 2; g.camera.pitch = -0.2; } catch { /* the default view */ }
  t.event('setup-shortcut', 'the player stood at the foot of the pier looking along it (leaving the 4x4)');
  await t.wait(2500);
  const potsBefore = ['lobster_pot_1', 'lobster_pot_2', 'pier_cask_1', 'pier_cask_2', 'lobster_pot_3'].map((id) => w.byId.get(id)).filter(Boolean);
  const at0 = P().log.length;
  const b = w.byId.get('barrel_pier');
  g.mayhem.blowUp(b);
  t.event('setup-shortcut', 'the fuel barrel on the pier set off with the engine\'s own blowUp (the rocket\'s hit; the aim is another scenario\'s)');
  await t.wait(500); t.scene('Pier: the blast');
  await t.wait(2500); t.scene('Pier: props tumbling off into the sea');
  await t.wait(2500);
  const after = P().log.slice(at0);
  const toppled = after.filter((l) => l.type === 'topple'), broke = after.filter((l) => l.type === 'break');
  const splashes = after.filter((l) => l.type === 'splash');
  t.event('props-topple', `${toppled.length} props knocked over (${toppled.map((l) => `${l.id} at ${l.dist} m`).join(', ')}) and ${broke.length} broken by the blast`);
  if (toppled.length < 1) t.problem('error', 'the barrel blast knocked over no unbroken props near it');
  t.event('props-splash', `${splashes.length} splashes after the blast: ${splashes.slice(0, 5).map((l) => `${l.id} size ${l.size}`).join(', ')}; ripple rings come with every splash (water ripple)`);
  if (splashes.length < 1) t.problem('error', 'nothing that fell into the sea splashed after the blast');
  const rings = HP().water && HP().water.ripples ? HP().water.ripples() : null;
  if (rings !== null && rings !== undefined) t.event('ripple-rings', `${typeof rings === 'number' ? rings : rings.length} ripple rings on the water`);

  // ---- the player into the sea: real input, walking off the pier's side
  pl.position = local(g, 70, 3.3, 1.1);
  pl.velocity = [0, 0, 0];
  t.event('setup-shortcut', 'the player stood at the pier\'s south edge');
  await t.wait(800);
  await lookAt(t, 0); // +z: the sea
  const n0 = P().log.filter((l) => l.type === 'splash' && l.player).length;
  if (touch) { const s = stickHold(); s.set(0, 1); await t.wait(2200); s.release(); } else { setKeys({ w: true }); await t.wait(2200); releaseAll(); }
  await t.wait(1200); t.scene('The player in the sea: a splash');
  const n1 = P().log.filter((l) => l.type === 'splash' && l.player).length;
  t.event('player-splash', `${n1 - n0} splash for the player stepping off the pier`);
  if (n1 - n0 < 1) t.problem('error', 'the player falling into the sea made no splash');

  // ---- the rod and the lore never break
  const keep = ['rod', 'lore_rock', 'lore_slip', 'lore_chair', 'lore_drawing'].map((id) => w.byId.get(id)).filter(Boolean);
  for (const e of keep) g.mayhem.shatter(e, { force: 8 });
  g.mayhem.explode([e0(keep, 'x'), keep[0] ? keep[0].y : 1, e0(keep, 'z')], { radius: 3, force: 6, damage: 0, effects: false });
  await t.wait(800);
  const broken = keep.filter((e) => e._shattered || e.dead || e.visible === false);
  t.event('keep-safe', `${keep.length} quest things (${keep.map((e) => e.sceneId).join(', ')}) asked to break: ${broken.length} did`);
  if (broken.length) t.problem('error', `quest things broke: ${broken.map((e) => e.sceneId).join(', ')}`);

  // ---- the island rebuilds itself, out of view
  pl.position = local(g, 57, 3.2, -14);
  pl.velocity = [0, 0, 0];
  try { g.camera.yaw = Math.PI; g.camera.pitch = 0; } catch { /* the default view */ }
  t.event('setup-shortcut', 'the player stood on the beach looking north, away from the road and the pier, so the rebuilding is out of view');
  const gone = () => [...new Set([...P().log.filter((l) => l.type === 'break' && w.byId.get(l.id) && !w.byId.get(l.id).temporary).map((l) => l.id), ...P().log.filter((l) => l.type === 'topple').map((l) => l.id)])];
  const need = gone();
  const t0 = performance.now();
  await t.until(() => { const r = new Set(P().log.filter((l) => l.type === 'restore').map((l) => l.id)); return need.every((id) => r.has(id)); }, 230000, `${need.length} broken props to be rebuilt`).catch((e) => t.problem('error', e.message));
  const secs = Math.round((performance.now() - t0) / 1000);
  const back = need.filter((id) => { const e = w.byId.get(id); return e && !e._shattered && e.visible !== false && !e.ghost; });
  t.metric('restoreSeconds', secs);
  t.event('props-restored', `${back.length} of ${need.length} props back at home ${secs} s after the last blast (the first broke minutes earlier; 120 s each, rebuilt out of view)`);
  if (back.length < need.length) t.problem('error', `only ${back.length} of ${need.length} broken props were rebuilt`);
  t.scene('The island whole again');
  t.event('log', JSON.stringify(P().counts));
}

function e0(list, k) { return list.length ? list[0][k] : 0; }
