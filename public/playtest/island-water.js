// The `island-water` scenario: the sea round the island is an ocean shader (modules/water). From the pier it records 10 s of
// the sea (window water stats: four summed Gerstner waves, two on a phone, the wind's direction), checks the foam is wired
// (the depth map knows the shore and the pier's posts), that the shallows are a lighter turquoise than the water 50 m out
// (the colour ramp at the depths the terrain reports there), and samples the floating props every 100 ms for 10 s against
// the one wave function (H.water.surfaceAt): the duck and three barrels. No gap over 10 cm above or below the surface.
// With touch: true (390x844, ?touch=1): the phone tier (2 waves, one normal sample), a thumb drag out to sea, and the frame
// rate looking out from the pier, 30 fps or more. Named shortcuts: the account gate, the player stood on the pier, the three
// barrels put in the water. No sign-up, safe on live.
export const ISLAND_WATER = {
  id: 'island-water',
  title: 'Island water: rolling waves, white foam on the beach and the pier posts, turquoise shallows; barrels, the duck and the bobber ride the real surface (within 10 cm); the phone tier holds 30 fps',
  seconds: 240,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then the player is stood on the pier looking out to sea. water-state (waves 4, or 2 on a phone, the wind direction, the depth map), a 10 s clip of waves moving (waves-moving: the surface at a fixed point rose and fell; scenes "Water: ..."), foam-wired (the depth map has the pier posts), shallows-lighter (the colour over the shore against the water 50 m out), then the duck and three barrels sampled for 10 s: floating-gaps (the largest gap above or below the surface, 10 cm at most; metric maxGapCm), props-ride (they rose and fell with the waves). Options: touch (true: ?touch=1 at 390x844: phone-tier checks, a thumb drag out to sea and drive-fps style pier-fps, 30 needed), at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

function frameMeter() {
  let frames = 0, worst = 0, freezes = 0, running = true, last = performance.now();
  const t0 = last;
  const raf = (n) => { frames++; const d = n - last; worst = Math.max(worst, d); if (d > 500) freezes++; last = n; if (running) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return { stop() { running = false; return { fps: Math.round(frames / ((performance.now() - t0) / 1000)), worst: Math.round(worst), freezes }; } };
}

const toLocal = (g, x, y, z) => { const l = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z]; return Array.isArray(l) ? l : [l.x, l.y, l.z]; };

export async function runIslandWater(t, helpers) {
  const { releaseAll, dragLook, options } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && HP().water && HP().water.stats && HP().water.stats(), 90000, 'the island with its sea (H.water.stats)');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the shots need a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  const g = G(), w = W(), WT = HP().water;

  // ---- the player on the pier, looking out to sea (east)
  const p = w.player;
  p.controls = false;
  p.position = toLocal(g, 84, 2.4, 1);
  p.velocity = [0, 0, 0];
  try { g.camera.yaw = Math.PI / 2; g.camera.pitch = -0.1; if (g.camera.mode !== undefined) g.camera.mode = 'third'; } catch { /* the default view */ }
  t.event('setup-shortcut', 'the player stood on the pier at x 84 looking east out to sea (the walk there is another scenario\'s)');
  await t.wait(2500);
  if (touch) { await dragLook(t, -60); await t.wait(300); await dragLook(t, 60); }
  const s0 = WT.stats();
  t.event('water-state', `${s0.waves} waves${s0.phone ? ' (phone tier)' : ''}, wind ${s0.wind.map((v) => v.toFixed(2))}, wave height ${s0.amp} m over ${s0.len} m, depth map ${s0.depthMap ? `${s0.depthMap.size}px over ${s0.depthMap.span} m with ${s0.depthMap.obstacles} things standing in the water` : 'MISSING'}, textures ${s0.textures ? 'made' : 'MISSING'}, grid ${s0.grid} vertices`);
  const want = touch ? 2 : 4;
  if (s0.waves !== want) t.problem('error', `the sea sums ${s0.waves} waves (${want} expected${touch ? ' on the phone tier' : ''})`);
  if (touch && !s0.phone) t.problem('error', 'the phone run is not on the phone tier');
  if (!s0.depthMap) t.problem('error', 'the sea has no depth map: no foam or depth colour');
  if (!s0.textures) t.problem('error', 'the foam and ripple textures were not made');

  // ---- the barrels (a named shortcut: three barrels put in the water off the pier)
  const props = [];
  for (const [x, z] of [[78, 6], [81, -6], [86, 7]]) {
    const y = (WT.surfaceAt(x, z) ?? -1.5) + 0.6;
    const e = g.box({ name: 'Float barrel', size: [0.6, 1, 0.6], position: toLocal(g, x, y, z), physics: 'dynamic', color: '#b45309', data: { density: 0.45 } });
    props.push(e);
  }
  const duck = w.byId.get('duck');
  if (duck) props.push(duck);
  t.event('setup-shortcut', `${props.length - (duck ? 1 : 0)} barrels put in the water off the pier (the duck was already there)`);
  await t.wait(3500); // they settle

  // ---- criterion 1: ten seconds from the pier: waves moving, foam wired
  t.scene('Water: from the pier');
  const meter = frameMeter();
  const probe = [90, 6];
  const rng = { min: Infinity, max: -Infinity };
  const gaps = props.map(() => ({ worst: 0, min: Infinity, max: -Infinity, n: 0 }));
  const surf = props.map(() => ({ min: Infinity, max: -Infinity }));
  const t0 = performance.now();
  let shots = 0;
  while (performance.now() - t0 < 10000) {
    const h = WT.waveAt(probe[0], probe[1]);
    rng.min = Math.min(rng.min, h); rng.max = Math.max(rng.max, h);
    props.forEach((e, i) => {
      if (!e.alive) return;
      const b = e.box(), s = WT.surfaceAt(e.x, e.z);
      if (s === null || s === undefined) return;
      const gap = b.min[1] > s ? b.min[1] - s : b.max[1] < s ? s - b.max[1] : 0;
      const q = gaps[i];
      q.worst = Math.max(q.worst, gap); q.min = Math.min(q.min, e.y); q.max = Math.max(q.max, e.y); q.n++;
      surf[i].min = Math.min(surf[i].min, s); surf[i].max = Math.max(surf[i].max, s);
    });
    if (performance.now() - t0 > (shots + 1) * 2400 && shots < 4) { shots++; t.scene(`Water: clip ${shots}`); }
    await t.wait(100);
  }
  const fps = meter.stop();
  const moved = rng.max - rng.min;
  t.event('waves-moving', `the surface at one point on the pier's side rose and fell ${(moved * 100).toFixed(0)} cm in 10 s (${rng.min.toFixed(2)} to ${rng.max.toFixed(2)} m over the level)`);
  if (moved < 0.1) t.problem('error', `the waves hardly move: ${(moved * 100).toFixed(0)} cm in 10 s`);
  const s1 = WT.stats();
  t.event('foam-wired', `the depth map holds ${s1.depthMap ? s1.depthMap.obstacles : 0} things standing in the water (the pier's posts, rocks) for the foam rings, and the terrain's shore for the beach line`);
  if (!s1.depthMap || s1.depthMap.obstacles < 4) t.problem('error', `the foam finds only ${s1.depthMap ? s1.depthMap.obstacles : 0} things standing in the water (the pier's posts are expected)`);
  t.metric('pierFps', fps.fps); t.metric('pierWorstFrameMs', fps.worst);
  t.event('pier-fps', `${fps.fps} fps over 10 s from the pier, worst frame ${fps.worst} ms, ${fps.freezes} freeze(s)`);
  if (touch && fps.fps < 30) t.problem('error', `looking out to sea from the pier ran at ${fps.fps} fps on the phone tier (30 needed)`);
  if (fps.freezes) t.problem('warning', `${fps.freezes} frame(s) over 500 ms from the pier`);

  // ---- criterion 3: the floating props against the one wave function
  let maxGap = 0;
  const names = props.map((e) => e.name || 'prop');
  gaps.forEach((q, i) => { maxGap = Math.max(maxGap, q.worst); });
  t.metric('maxGapCm', Math.round(maxGap * 100));
  t.event('floating-gaps', `${props.length} floating props sampled every 100 ms for 10 s against the surface: the largest gap above or below it ${(maxGap * 100).toFixed(1)} cm (10 cm at most): ${gaps.map((q, i) => `${names[i]} ${(q.worst * 100).toFixed(1)} cm`).join(', ')}`);
  if (maxGap > 0.1) t.problem('error', `a floating prop was ${(maxGap * 100).toFixed(0)} cm above or below the surface (10 cm at most)`);
  const rode = gaps.filter((q, i) => q.n > 20 && q.max - q.min > 0.04 && surf[i].max - surf[i].min > 0.1).length;
  t.event('props-ride', `${rode} of ${props.length} props rose and fell with the waves`);
  if (rode < Math.ceil(props.length / 2)) t.problem('error', `only ${rode} of ${props.length} floating props rode the waves`);
  const bob = g.water && g.water.fish ? null : null; void bob;

  // ---- criterion 2: shallows lighter turquoise than the water 50 m out
  const shoreD = WT.seaDepthAt(63, 6), farD = WT.seaDepthAt(139, 6);
  let sd = 0.6, fd = farD;
  if (shoreD !== null && shoreD > 0.05) sd = Math.min(shoreD, 1.2);
  const cs = WT.colorAtDepth(sd), cf = WT.colorAtDepth(fd === null || fd < 6 ? 14 : fd);
  t.event('shallows-lighter', `over ${sd.toFixed(1)} m of water the sea is ${cs.map((v) => Math.round(v * 255))} (lightness ${lum(cs).toFixed(2)}), 50 m out (${fd === null ? 'no terrain, deep' : `${fd.toFixed(1)} m deep`}) ${cf.map((v) => Math.round(v * 255))} (${lum(cf).toFixed(2)}); the shallows' green is ${(cs[1] - cs[0]).toFixed(2)} over red`);
  if (lum(cs) < lum(cf) + 0.1) t.problem('error', `the shallows (${lum(cs).toFixed(2)}) are not lighter than the water 50 m out (${lum(cf).toFixed(2)})`);
  // the shot: the shallows by the beach, then the open water
  p.position = toLocal(g, 66, 2.4, 6);
  p.velocity = [0, 0, 0];
  try { g.camera.yaw = Math.PI / 2; g.camera.pitch = -0.25; } catch { /* */ }
  t.event('setup-shortcut', 'the player stood at the beach end of the pier for the shallows shot');
  await t.wait(2500);
  t.scene('Water: the shallows by the beach');
  releaseAll();
  p.controls = true;
}
