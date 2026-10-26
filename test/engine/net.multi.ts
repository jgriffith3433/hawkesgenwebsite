// Playing together over a bad network: two to four engines in worker threads, the real room relay between them, and
// links with latency, jitter and loss (test/engine/netsim.ts). What remote players see is a replay of the authority's
// data: smooth (interpolated), corrected without snapping, handed over when the host leaves, and only what's relevant.
// (Run on its own after the other tests, by npm test: it keeps every core busy.)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from './netsim.ts';

const sceneOf = (entities: Record<string, any>, config: Record<string, any> = {}) => ({ config: { look: false, shadows: false, ...config }, entities: Object.fromEntries(Object.entries(entities).map(([id, e]) => [id, { id, ...e }])) });
const ground = { type: 'box', name: 'Ground', physics: 'static', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const sims: Sim[] = [];
after(async () => { for (const s of sims) await s.stop(); });

async function pair(link: { latency: number; jitter: number; loss: number }, scene: any) {
  const sim = new Sim();
  sims.push(sim);
  const a = await sim.add('host');
  const b = await sim.add('guest', link);
  await a.world(scene); await b.world(scene);
  await a.run(`Net.connect({ play: 'x', room: 'test', name: 'Ann' })`);
  await sim.step(300);
  await b.run(`Net.connect({ play: 'x', room: 'test', name: 'Bob' })`);
  await sim.step(1500);
  return { sim, a, b };
}

test('remote things move smoothly at 150 ms with jitter and loss (interpolated, not snapped)', async () => {
  const scene = sceneOf({ ground, ball: { type: 'sphere', name: 'Ball', physics: 'dynamic', shape: { radius: 0.5 }, body: { friction: 0, damping: [0, 0] }, transform: { position: [0, 6, 0] } } });
  const { sim, a, b } = await pair({ latency: 150, jitter: 40, loss: 0.02 }, scene);
  assert.equal(await b.run(`return H.sync.online && !H.sync.isHost`), true);
  // The host throws it along x at 4 m/s with no gravity: a straight line at constant speed.
  await a.run(`const e = game.entity('ball'); e.gravity = 0; e.position = [0, 6, 0]; e.velocity = [4, 0, 0];`);
  await sim.step(1500);
  const xs: number[] = [];
  await b.run(`H.sync.resetStats()`);
  await sim.step(3000, async () => { xs.push(await b.run(`return game.entity('ball').x`)); });
  const st = await b.run(`return H.sync.stats()`);
  // Speed seen each frame: the host's speed, never backwards, no jumps.
  const speed = (xs[xs.length - 1] - xs[0]) / ((xs.length - 1) / 60);
  const v = xs.slice(1).map((x, i) => (x - xs[i]) * 60);
  const off = v.map((s) => Math.abs(s - speed));
  off.sort((p, q) => p - q);
  const p95 = off[Math.floor(off.length * 0.95)];
  assert.ok(speed > 2, `it moves on the guest's screen (${speed.toFixed(2)} m/s)`);
  assert.ok(Math.min(...v) > 0, `it never goes backwards (min speed ${Math.min(...v).toFixed(2)})`);
  assert.ok(p95 < speed * 0.25, `the speed seen is steady: 95% of frames within ${p95.toFixed(2)} m/s of ${speed.toFixed(2)}`);
  assert.ok(st.interpolated > st.extrapolated * 4, `mostly interpolated (${st.interpolated} interpolated, ${st.extrapolated} extrapolated)`);
  // And it's where the host had it, about one send plus the network behind.
  const [ax, bx] = [await a.run(`return game.entity('ball').x`), await b.run(`return game.entity('ball').x`)];
  const behind = (ax - bx) / speed;
  if (process.env.NET_DEBUG) console.log({ st, p95, behind, speed, ax, bx });
  assert.ok(behind > 0.15 && behind < 0.5, `shown ${(behind * 1000).toFixed(0)} ms behind the host`);
});

test("a jump of the shared clock (a resync, the build room's clock) never leaves the others a second behind", async () => {
  const scene = sceneOf({ ground, ball: { type: 'sphere', name: 'Ball', physics: 'dynamic', shape: { radius: 0.5 }, body: { friction: 0, damping: [0, 0] }, transform: { position: [0, 6, 0] } } });
  const { sim, a, b } = await pair({ latency: 80, jitter: 20, loss: 0 }, scene);
  await a.run(`const e = game.entity('ball'); e.gravity = 0; e.position = [0, 6, 0]; e.velocity = [4, 0, 0];`);
  await sim.step(1500);
  // The guest's idea of the shared clock moves by 0.7 s at once (what a resync or a new room's clock does).
  await b.run(`H.setClockOffset(H.lib.clockOffset + 700)`);
  await sim.step(500);
  const behinds: number[] = [];
  await sim.step(5000, async () => { behinds.push(((await a.run(`return game.entity('ball').x`)) - (await b.run(`return game.entity('ball').x`))) / 4); });
  const worst = Math.max(...behinds);
  if (process.env.NET_DEBUG) console.log({ behinds: behinds.map((x) => Math.round(x * 1000)) });
  assert.ok(worst < 0.4, `after the jump the ball is shown at most ${Math.round(worst * 1000)} ms behind (want under 400: the old estimate drifted to ~500 and stayed)`);
});

test('your own car answers at once at 150 ms; bumping into it never takes it from you; others see it smoothly', async () => {
  const scene = sceneOf({ ground, start: { type: 'spawn', transform: { position: [0, 0, -4] } }, car: { type: 'car', transform: { position: [0, 0.6, 0] } }, crate: { type: 'box', name: 'Crate', physics: 'dynamic', body: { mass: 40 }, shape: { size: [1.5, 1.5, 1.5] }, transform: { position: [0, 0.75, 14] } } });
  const { sim, a, b } = await pair({ latency: 150, jitter: 30, loss: 0.01 }, scene);
  await b.run(`game.player.position = [0, 1, -3]; game.vehicles.enter(game.entity('car'))`);
  await sim.step(1200);
  assert.equal(await b.run(`return game.vehicles.current === game.entity('car')`), true, 'B is driving');
  assert.equal(await a.run(`return H.sync.holder(game.entity('car'))`), await b.run(`return H.sync.me`), 'the car is held by its driver');
  // Throttle: B's car moves within a few frames of the key going down (it's simulated where it's driven).
  const z0 = await b.run(`H.input.held.add('w'); return game.entity('car').z`);
  let frames = 0;
  while (frames < 30) { await sim.step(1000 / 60); frames++; if (await b.run(`return game.entity('car').z`) > z0 + 0.01) break; }
  assert.ok(frames <= 4, `it moved ${frames} frames after the key`);
  await b.run(`H.sync.resetStats()`);
  // The host's heavy crate sits in the car's path: the crash pushes it, and the host can't take the car (B holds it).
  const zs: number[] = [], seen: number[] = [];
  await sim.step(3000, async () => { zs.push(await b.run(`return game.entity('car').z`)); seen.push(await a.run(`return game.entity('car').z`)); });
  await b.run(`H.input.held.delete('w')`);
  const st = await b.run(`return H.sync.stats()`);
  if (process.env.NET_DEBUG) console.log({ frames, st, z: [zs[0], zs[zs.length - 1]], seen: [seen[0], seen[seen.length - 1]] });
  assert.equal(st.corrections, 0, 'the driver is never corrected');
  assert.equal(await a.run(`return Net.ownerOf('car')`), await b.run(`return H.sync.me`), 'still B\'s');
  const back = zs.slice(1).filter((z, i) => z < zs[i] - 0.02).length;
  assert.equal(back, 0, 'no rubber-banding: the car never jumps back on the driver\'s screen');
  // The host sees it move every frame, without jumps.
  const steps = seen.slice(1).map((z, i) => Math.abs(z - seen[i]));
  assert.ok(Math.max(...steps) < 0.6, `smooth on the host's screen (largest step ${Math.max(...steps).toFixed(2)} m)`);
  assert.ok(seen[seen.length - 1] > seen[0] + 5, 'and it got somewhere');
  const moved = await a.run(`const c = game.entity('crate'); return Math.hypot(c.x, c.z - 14)`);
  assert.ok(moved > 1, `the crate was hit (it moved ${moved.toFixed(1)} m)`);
});

test('when authority moves to someone else, the difference is blended out, never snapped', async () => {
  const scene = sceneOf({ ground, puck: { type: 'box', name: 'Puck', physics: 'dynamic', shape: { size: [1, 0.4, 1] }, body: { friction: 0 }, transform: { position: [0, 0.2, 0] } } });
  const { sim, a, b } = await pair({ latency: 120, jitter: 30, loss: 0 }, scene);
  // B takes it and slides it +x; then the host takes it over and slides it back (-x).
  await b.run(`const p = game.entity('puck'); H.sync.claim(p); p.gravity = 0; p.velocity = [3, 0, 0];`);
  await sim.step(1500);
  await b.run(`H.sync.resetStats()`);
  await a.run(`const p = game.entity('puck'); H.sync.claim(p); p.gravity = 0; p.velocity = [-3, 0, 0];`);
  const xs: number[] = [];
  await sim.step(2000, async () => { xs.push(await b.run(`return game.entity('puck').x`)); });
  const st = await b.run(`return H.sync.stats()`);
  if (process.env.NET_DEBUG) console.log({ st, xs: xs.filter((_, i) => i % 6 === 0).map((x) => x.toFixed(2)).join(' ') });
  assert.equal(await b.run(`return game.entity('puck').remote`), true, 'B follows the host now');
  assert.ok(st.corrections >= 1, `B was corrected (${st.corrections}, by ${st.maxCorrection.toFixed(2)} m)`);
  const jump = Math.max(...xs.slice(1).map((x, i) => Math.abs(x - xs[i])));
  assert.ok(jump < 0.25, `blended: the largest step on B's screen is ${jump.toFixed(3)} m (3 m/s is 0.05 a frame)`);
  const [ax, bx] = [await a.run(`return game.entity('puck').x`), await b.run(`return game.entity('puck').x`)];
  assert.ok(Math.abs(ax - bx) < 1.5 && bx < xs[0], `and it ends where the host has it, a little behind (${ax.toFixed(2)} vs ${bx.toFixed(2)})`);
});

test('the host leaves mid-explosion: the next player takes over and everything keeps flying, herds keep going', async () => {
  const crates: Record<string, any> = {};
  for (let i = 0; i < 6; i++) crates[`crate${i}`] = { type: 'box', name: 'Crate', physics: 'dynamic', shape: { size: [1, 1, 1] }, transform: { position: [(i % 3) - 1, 0.5 + Math.floor(i / 3), 0] } };
  const scene = sceneOf({ ground, ...crates, start: { type: 'spawn', transform: { position: [0, 0, -16] } }, cows: { type: 'herd', name: 'Cows', shape: { species: 'cow', count: 8, radius: 6 }, transform: { position: [30, 0, 0] } } });
  const sim = new Sim(11);
  sims.push(sim);
  const a = await sim.add('host', { latency: 30, jitter: 10, loss: 0 });
  const b = await sim.add('second', { latency: 90, jitter: 30, loss: 0.01 });
  const c = await sim.add('third', { latency: 140, jitter: 40, loss: 0.01 });
  for (const p of [a, b, c]) await p.world(scene);
  await a.run(`Net.connect({ play: 'x', room: 'test', name: 'Ann' })`);
  await sim.step(200);
  await b.run(`Net.connect({ play: 'x', room: 'test', name: 'Bob' })`);
  await sim.step(200);
  await c.run(`Net.connect({ play: 'x', room: 'test', name: 'Cy' })`);
  // A synced counter the host owns (a score, a water level): the new host carries on from it.
  for (const p of [a, b, c]) await p.run(`g.__n = 0; H.sync.state('test:count', { rate: 10, get: () => ({ n: g.__n }), set: (s) => { g.__n = s.n; } });`);
  await sim.step(2500);
  await a.run(`g.__n = 41`);
  await sim.step(500);
  // Boom, then the host's tab closes 150 ms later, while the crates are in the air.
  await a.run(`H.sync.explode([0, 0, -1.2], { radius: 5, force: 16 })`);
  await sim.step(150);
  const W0 = `return [0,1,2,3,4,5].map((i) => { const e = game.entity('crate' + i); return [e.x, e.y, e.z].map((n) => +n.toFixed(2)).join(',') + (e.remote ? 'R' : '') + ' ' + (e._trk ? e._trk.size : '-'); }).join(' | ')`;
  if (process.env.NET_DEBUG) console.log('A', await a.run(W0), '\nB', await b.run(W0), '\nC', await c.run(W0));
  await sim.drop(a);
  const watch = `return [0,1,2,3,4,5].map((i) => { const e = game.entity('crate' + i); return [e.x, e.y, e.z]; })`;
  let prevC: number[][] | null = null, biggest = 0, still = 0;
  await sim.step(1500, async () => {
    const pc = await c.run(watch);
    if (prevC) {
      let moved = 0;
      for (let i = 0; i < 6; i++) { const d = Math.hypot(pc[i][0] - prevC[i][0], pc[i][1] - prevC[i][1], pc[i][2] - prevC[i][2]); biggest = Math.max(biggest, d); moved = Math.max(moved, d); }
      const flying = pc.some((p: number[], i: number) => p[1] > (i < 3 ? 0.6 : 1.6) || (prevC && Math.abs(p[1] - prevC[i][1]) > 1e-3));
      if (moved < 1e-4 && flying) still++;
    }
    prevC = pc;
  });
  const stB = await b.run(`return H.sync.stats()`), stC = await c.run(`return H.sync.stats()`);
  if (process.env.NET_DEBUG) console.log({ biggest, still, takeoversB: stB.takeovers, corrC: stC.corrections }, '\nB', await b.run(W0), '\nC', await c.run(W0), await c.run(`return [H.sync.host, H.sync.me, Net.ownerOf('crate0')]`));
  assert.equal(await b.run(`return H.sync.isHost`), true, 'the second player is the host now');
  assert.ok(stB.takeovers >= 1, 'it took the flying things over from the newest data');
  assert.ok(biggest < 1.2, `on the third player's screen nothing jumps (largest step ${biggest.toFixed(2)} m)`);
  assert.ok(still < 20, `and nothing stalls (${still} frames without movement)`);
  // They come down and settle the same for both who are left.
  await sim.step(4000);
  const pb = await b.run(watch), pc = await c.run(watch);
  for (let i = 0; i < 6; i++) assert.ok(Math.hypot(pb[i][0] - pc[i][0], pb[i][1] - pc[i][1], pb[i][2] - pc[i][2]) < 0.3, `crate ${i} rests in the same place for both`);
  assert.ok(pb.some((p: number[]) => Math.hypot(p[0], p[2]) > 2), 'the blast threw them');
  // The counter carried on, and the herd is the new host's to run (brains and all).
  await b.run(`g.__n++`);
  await sim.step(800);
  assert.equal(await c.run(`return g.__n`), 42, 'the new host carried the synced state on');
  const herd = await b.run(`const h = game.entity('cows'); return h.members.map((m) => [m.remote, m.x, m.z])`);
  assert.ok(herd.every((m: any[]) => m[0] === false), 'the new host simulates the herd');
  await sim.step(3000);
  const herd2 = await b.run(`const h = game.entity('cows'); return h.members.map((m) => [m.x, m.z])`);
  const seenC = await c.run(`const h = game.entity('cows'); return h.members.map((m) => [m.remote, m.x, m.z])`);
  assert.ok(seenC.every((m: any[]) => m[0] === true), 'the third player follows the new host\'s herd');
  const drift = herd2.map((m: number[], i: number) => Math.hypot(m[0] - seenC[i][1], m[1] - seenC[i][2]));
  assert.ok(Math.max(...drift) < 1.5, `and sees them where the new host has them (${Math.max(...drift).toFixed(2)} m at most)`);
});

test('bandwidth: 100 creatures, vehicles and 4 players stay well inside the room\'s limits', async () => {
  const ents: Record<string, any> = { ground, start: { type: 'spawn', transform: { position: [0, 0, -10] } } };
  ents.cows = { type: 'herd', name: 'Cows', shape: { species: 'cow', count: 100, radius: 25 }, transform: { position: [0, 0, 30] } };
  ents.car = { type: 'car', transform: { position: [-6, 0.6, -6] } };
  ents.truck = { type: 'truck', transform: { position: [6, 1, -6] } };
  ents.bike = { type: 'motorbike', transform: { position: [12, 0.8, -6] } };
  for (let i = 0; i < 10; i++) ents[`crate${i}`] = { type: 'box', physics: 'dynamic', shape: { size: [1, 1, 1] }, transform: { position: [-20 + i * 2, 0.5, 5] } };
  const scene = sceneOf(ents);
  const sim = new Sim(5);
  sims.push(sim);
  const ps = [await sim.add('host', { latency: 40, jitter: 10, loss: 0 }), await sim.add('p2', { latency: 80, jitter: 25, loss: 0.01 }), await sim.add('p3', { latency: 120, jitter: 30, loss: 0.01 }), await sim.add('p4', { latency: 150, jitter: 40, loss: 0.02 })];
  for (const p of ps) await p.world(scene);
  for (const [i, p] of ps.entries()) { await p.run(`Net.connect({ play: 'x', room: 'test', name: 'P${i}' })`); await sim.step(100); }
  await sim.step(2000);
  // Everyone does something: p2 drives the car around, p3 walks, p4 throws crates; the host stampedes the herd.
  await ps[1].run(`game.player.position = [-6, 1, -9]; game.vehicles.enter(game.entity('car'))`);
  await sim.step(800);
  await ps[1].run(`H.input.held.add('w'); H.input.held.add('a')`);
  await ps[2].run(`H.input.held.add('w')`);
  for (const c of sim.room.conns.values()) c.stats = { inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0, skipped: 0 };
  for (let s = 0; s < 10; s++) {
    await ps[0].run(`H.living && H.living.startle && H.living.startle([0, 0, 30], { radius: 60, strength: 1 })`);
    await ps[3].run(`const c = game.entity('crate${s}'); H.sync.claim(c); c.velocity = [0, 7, 5]`);
    await sim.step(1000);
  }
  const rows = [...sim.room.conns.values()].map((c) => ({ who: c.name, upKBs: +(c.stats.inBytes / 10240).toFixed(1), upMsgs: c.stats.inMsgs / 10, downKBs: +(c.stats.outBytes / 10240).toFixed(1), downMsgs: c.stats.outMsgs / 10, skipped: c.stats.skipped }));
  const moving = await ps[0].run(`return game.entity('cows').members.filter((m) => Math.hypot(m.vx, m.vz) > 0.3).length`);
  if (process.env.NET_DEBUG || process.env.NET_BANDWIDTH) console.table(rows), console.log({ cowsMoving: moving });
  for (const r of rows) {
    assert.ok(r.upMsgs < 40, `${r.who} sends ${r.upMsgs} messages a second (limit ${90})`);
    assert.ok(r.downKBs * 1024 < 96 * 1024, `${r.who} gets ${r.downKBs} KB/s`);
  }
  const herdSeen = await ps[3].run(`const ms = game.entity('cows').members; return ms.filter((m) => m.remote && m.living.trk && m.living.trk.size > 2).length`);
  assert.ok(herdSeen >= 95, `the far player follows the herd (${herdSeen} of 100 with snapshots)`);
});

test('the host rewinds the world for everyone', async () => {
  const scene = sceneOf({ ground, ball: { type: 'sphere', name: 'Ball', physics: 'dynamic', shape: { radius: 0.5 }, transform: { position: [0, 0.5, 0] } } });
  const { sim, a, b } = await pair({ latency: 100, jitter: 20, loss: 0 }, scene);
  await sim.step(1000);
  await a.run(`game.entity('ball').velocity = [6, 0, 0]`);
  await sim.step(2500);
  const far = await b.run(`return game.entity('ball').x`);
  assert.ok(far > 3, `it rolled (${far.toFixed(2)})`);
  await a.run(`game.rewind(10)`);
  await sim.step(1200);
  const back = await b.run(`return game.entity('ball').x`);
  assert.ok(Math.abs(back) < 0.6, `the guest sees it back where it started (${back.toFixed(2)})`);
});
