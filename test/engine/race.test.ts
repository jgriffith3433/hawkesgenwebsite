// Races (modules/race): the pure parts, then the island's two courses in the real engine: a countdown at the start gate,
// gates lit in order, laps, a finish with the best, a ghost of the best run on the next try, and the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { load, world as run } from './harness.ts';
import { templateBundle } from '../../src/templates.ts';
import { RACES } from '../../src/overseer-games/sandbox.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const g = globalThis as any;
// A device's storage (the engine page has none): the race keeps its ghost and board here.
const disk = new Map<string, string>();
g.localStorage = { getItem: (k: string) => disk.get(k) ?? null, setItem: (k: string, v: string) => void disk.set(k, String(v)), removeItem: (k: string) => void disk.delete(k) };
const H = await load();
const errors: string[] = [];
H.report = (e: any, where?: string) => { errors.push(String(where || '') + ': ' + String((e && e.message) || e)); };

const ctx: any = { window: {}, console };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'play', 'modules', 'race', 'race-core.js'), 'utf8'), ctx, { filename: 'race-core.js' });
const C = ctx.window.HawkesRaceCore;

test('race core: times read as a clock, a difference as a signed gap', () => {
  assert.equal(C.fmt(5320), '5.32');
  assert.equal(C.fmt(62310), '1:02.31');
  assert.equal(C.fmt(0), '0.00');
  assert.equal(C.fmtDelta(410), '+0.41');
  assert.equal(C.fmtDelta(-300), '-0.30');
});

test('race core: a gate counts only the right way, inside its width, once', () => {
  const [a] = C.gates([[0, 0], [0, 50], [50, 50], [50, 0]], 7); // faces +x/+z: from (50,0) to (0,50)
  const across = (from: number[], to: number[]) => C.crossed({ x: from[0], z: from[1] }, { x: to[0], z: to[1] }, a);
  const d = [a.dx, a.dz];
  assert.notEqual(across([-d[0] * 2, -d[1] * 2], [d[0] * 2, d[1] * 2]), null, 'through it, forward');
  assert.equal(across([d[0] * 2, d[1] * 2], [-d[0] * 2, -d[1] * 2]), null, 'backwards does not count');
  assert.equal(across([d[0] * 2, d[1] * 2], [d[0] * 4, d[1] * 4]), null, 'already past');
  const side = [a.lx * 12 - d[0], a.lz * 12 - d[1]];
  assert.equal(across(side, [side[0] + d[0] * 2, side[1] + d[1] * 2]), null, 'beside it');
});

test('race core: a ghost is a few numbers and plays back by time; a board keeps the best ten', () => {
  const flat: number[] = [];
  for (let i = 0; i < 20; i++) flat.push(i * 4, 3, 0); // 4 m every 200 ms, along +x
  const gh = C.cleanGhost(C.packGhost(flat, 4000));
  assert.ok(gh && gh.ms === 4000);
  const s = C.ghostAt(gh, 1000);
  assert.ok(Math.abs(s.x - 20) < 0.01 && Math.abs(s.y - 3) < 0.01, 'at 1 s it is 20 m along');
  assert.ok(Math.abs(s.yaw - 90) < 0.5, 'facing +x');
  assert.equal(C.ghostAt(gh, 99999).done, true);
  assert.equal(C.cleanGhost({ ms: 5, p: [1, 2] }), null, 'junk is no ghost');
  let runs: any[] = [];
  for (let i = 0; i < 14; i++) runs = C.addRun(runs, { ms: 60000 + ((i * 37) % 11) * 1000, name: `P${i}`, at: i });
  assert.equal(runs.length, 10);
  assert.ok(runs.every((r, i) => i === 0 || runs[i - 1].ms <= r.ms), 'sorted, fastest first');
  const rows = C.board(runs, { name: 'Pip', ms: 59000 });
  assert.equal(rows[0].name, 'Pip', "the rival's time is the one to beat");
  assert.equal(rows.length, 10);
});

test('race core: a course is checked (an id, three gates, laps within reason)', () => {
  assert.equal(C.course({ id: 'x', gates: [[0, 0], [1, 1]] }), null);
  const c = C.course({ id: 'Big Loop!', laps: 99, color: 'red', gates: [[0, 0], [10, 0], [10, 10]] });
  assert.equal(c.id, 'big-loop-');
  assert.equal(c.laps, 9);
  assert.equal(c.color, '#34d399');
});

test('race memory: the best times are kept per course, cleaned and merged (the lower wins)', () => {
  const M = H.memory.core;
  const r = M.clean({ race: { ridge: 61234, 'Bad Id': 5, harbour: -3, x: 'no' } });
  assert.deepEqual(r.race, { ridge: 61234 });
  const m = M.merge({ visits: 2, lastAt: 5, race: { ridge: 70000, harbour: 90000 } }, { visits: 3, lastAt: 9, race: { ridge: 65000 } });
  assert.deepEqual(m.race, { ridge: 65000, harbour: 90000 });
});

// ------------------------------------------------------------------ the island
const bundle = templateBundle('sandbox')!;
const scene = JSON.parse(bundle.files['scene.json']);
function start(laps?: number) {
  errors.length = 0;
  disk.clear();
  for (const k of ['__islandEarly', '__islandNudged', '__islandRescue', '__islandPlayed', '__islandAsked', '__islandJourney', '__islandRace']) delete g.window[k];
  const config = { ...scene.config, look: false, shadows: false };
  if (laps) config.race = { ...config.race, courses: config.race.courses.map((c: any) => ({ ...c, laps })) };
  run(H, { ...scene, config }, { mode: 'play', scripts: { 'scripts/main.js': bundle.files['scripts/main.js'] } });
  return H.game;
}
const planetOf = (e: any) => { const q = H.game.planet.toPlanet([e.x, e.y, e.z]); return { x: q[0], y: q[1], z: q[2] }; };
/** Puts the vehicle at a point of the world file's numbers (it falls onto the ground from there). */
const put = (e: any, x: number, y: number, z: number, yaw?: number) => {
  e.position = H.game.planet.toLocal([x, y, z]);
  e.velocity = [0, 0, 0];
  if (yaw !== undefined) e.rotation = [0, yaw, 0];
};
const course = (id: string) => (RACES.courses as any[]).find((c) => c.id === id)!;

/** Drives the vehicle along waypoints at `speed` m/s (set each step: a stand-in for a good driver). */
function drive(e: any, points: number[][], speed: number, after?: (ms: number) => void) {
  const dt = 1 / 30;
  let t = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(1, Math.round(len / (speed * dt)));
    for (let k = 1, guard = 0; k <= n; k++) {
      // (The countdown holds the vehicle at the line: a driver waits for GO.)
      if (e.physics === 'static' && e.vehicle && guard++ < 400) { H.tick(dt); t += dt; k--; continue; }
      const f = k / n;
      put(e, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f);
      H.tick(dt);
      t += dt;
      if (after) after(t * 1000);
    }
  }
}
/** The course's gates as a path of the lifted vehicle: the start, every gate, laps times, the start again; with a lead-in. */
function path_(c: any, lift: number, laps = c.laps, leadIn = 14) {
  const n = c.gates.length;
  const D = C.gates(c.gates.map((p: number[]) => [p[0], p[1]]), c.width / 2)[0];
  const pts: number[][] = [[c.gates[0][0] - D.dx * leadIn, c.gates[0][2] + lift, c.gates[0][1] - D.dz * leadIn]];
  for (let lap = 0; lap < laps; lap++) for (let k = 0; k < n; k++) { const q = c.gates[(k + (lap === 0 ? 0 : 0)) % n]; pts.push([q[0], q[2] + lift, q[1]]); }
  const q = c.gates[0];
  pts.push([q[0] + D.dx * 12, q[2] + lift, q[1] + D.dz * 12]);
  return pts;
}

test('race: the island has two courses, the gates stand on the ground or the sea, and the board is by the pier', () => {
  const game = start();
  H.tick(3);
  assert.deepEqual([...errors], []);
  assert.ok(game.race, 'game.race is there once the world has config.race');
  assert.deepEqual(game.race.courses.map((c: any) => c.id), ['ridge', 'harbour']);
  for (const c of RACES.courses as any[]) {
    for (const [x, z, y] of c.gates) {
      const ground = game.terrain.heightAt(x, z);
      if (c.vehicle === 'boat') assert.ok(ground < -1.5, `harbour gate (${x}, ${z}) is over water, ground ${ground}`);
      else assert.ok(ground > 0.3 && Math.abs(ground - y) < 0.2, `ridge gate (${x}, ${z}) is on dry land, ground ${ground}`);
    }
  }
  assert.ok(H.world.byId.get('race_board'), 'the race board');
  // Only the start gates are lit when nobody is racing: 2 gates x (2 posts + a banner).
  const lit = [...H.world.entities].filter((e) => e.tag === 'race-gate' && e.visible !== false);
  assert.equal(lit.length, 6);
  // (Made by the module, not in scene.json: a kept island never saves them as its own.)
  assert.ok([...H.world.entities].filter((e: any) => e.tag === 'race-gate').every((e: any) => !e.sceneId));
  // Pip can be beaten: the par fits what the 4x4 and the boat can do (the lap in seconds at their top speed).
  assert.ok(course('ridge').par > 3 * 330 / 32 * 1000 && course('harbour').par > 2 * 600 / 26 * 1000, 'a par nobody could ever beat is no challenge');
});

test('race: through the start gate in the 4x4 = a countdown, GO, the gates in order, laps, a finish with the best', () => {
  const game = start();
  H.tick(3);
  const events: any[] = [];
  game.on('race', (d: any) => events.push(d));
  const jeep = H.world.byId.get('jeep');
  const c = course('ridge');
  const D = C.gates(c.gates.map((p: number[]) => [p[0], p[1]]), c.width / 2)[0];
  put(jeep, c.gates[0][0] - D.dx * 14, c.gates[0][2] + 1.4, c.gates[0][1] - D.dz * 14);
  H.tick(1);
  assert.ok(game.vehicles.enter(jeep), 'in the 4x4');
  H.tick(0.3);
  assert.equal(game.race.state.phase, 'idle', 'nothing yet');
  // Drive at the start gate: the countdown.
  const seen: string[] = [];
  const lights: string[] = [];
  let phase = '';
  drive(jeep, path_(c, 1.4), 18, () => {
    const s = game.race.state;
    if (s.phase !== phase) { phase = s.phase; seen.push(phase); }
    if (s.phase === 'running') {
      // The gates lit in order: the next one is bright, the ones after it dim, nothing else.
      const gates = [...H.world.entities].filter((e) => e.tag === 'race-gate' && e.visible !== false && e.data.race === 'ridge');
      const idx = [...new Set(gates.map((e: any) => e.data.gate))].sort((a: any, b: any) => a - b);
      lights.push(`${s.next}:${idx.join(',')}`);
    }
  });
  H.tick(0.5);
  assert.deepEqual(seen.slice(0, 3), ['idle', 'countdown', 'running'], seen.join('>'));
  const states = events.map((e) => e.state);
  assert.equal(states[0], 'countdown');
  assert.deepEqual(events.filter((e) => e.state === 'countdown').map((e) => e.n), [3, 2, 1], 'three, two, one');
  assert.equal(states.filter((s: string) => s === 'go').length, 1);
  const n = c.gates.length;
  assert.equal(states.filter((s: string) => s === 'gate').length, c.laps * (n - 1), 'every gate but the line, each lap');
  assert.equal(states.filter((s: string) => s === 'lap').length, c.laps - 1);
  assert.equal(states[states.length - 1], 'finish');
  const gates = events.filter((e) => e.state === 'gate');
  assert.deepEqual(gates.slice(0, n - 1).map((e) => e.index), Array.from({ length: n - 1 }, (_, i) => i + 1), 'in order');
  assert.ok(gates.every((e, i) => i === 0 || e.ms >= gates[i - 1].ms), 'the clock only runs forward');
  // Lit in order: while the next is gate k, the lit ones are k, k+1, k+2 (mod n) and no others.
  assert.ok(lights.some((l) => l.startsWith('1:') && /^1:1,2,3$/.test(l)), `lit ahead: ${[...new Set(lights)].slice(0, 4).join(' | ')}`);
  const fin = events[events.length - 1];
  assert.equal(fin.course, 'ridge');
  assert.ok(fin.isBest && !fin.previous, 'a first time is a best');
  assert.ok(fin.ms > 30000 && fin.ms < 120000, `a lap time in seconds (${fin.ms})`);
  assert.equal(game.race.best('ridge'), fin.ms);
  assert.equal(game.race.state.phase, 'idle');
  assert.ok(game.race.ghost('ridge'), 'the run is kept as a ghost');
  assert.deepEqual(game.race.board('ridge').map((r: any) => r.name).slice(0, 2).sort(), ['Pip', 'You'].sort());
  // The result card shows the time and the best.
  assert.match(game.ui.el('race-card').innerHTML, /finish/);
  assert.match(game.ui.el('race-card').innerHTML, new RegExp(C.fmt(fin.ms).replace('.', '\\.')));
  assert.deepEqual([...errors], []);
});

test('race: the next try has a ghost of the best run beside you, and a faster one beats it', () => {
  const game = start(1); // (a one-lap Ridge Run keeps the test short)
  H.tick(3);
  const events: any[] = [];
  game.on('race', (d: any) => events.push(d));
  const jeep = H.world.byId.get('jeep');
  const c = { ...course('ridge'), laps: 1 };
  const D = C.gates(c.gates.map((p: number[]) => [p[0], p[1]]), c.width / 2)[0];
  const toLine = () => { put(jeep, c.gates[0][0] - D.dx * 14, c.gates[0][2] + 1.4, c.gates[0][1] - D.dz * 14); H.tick(5); };
  const lap = (speed: number, watch?: () => void) => { toLine(); drive(jeep, path_(c, 1.4, 1), speed, watch); H.tick(0.3); };
  toLine();
  game.vehicles.enter(jeep);
  H.tick(0.3);
  lap(13);
  assert.equal(events.filter((e) => e.state === 'finish').length, 1, 'a first run');
  assert.equal((events.find((e) => e.state === 'go') || {}).ghost, false, 'no ghost the first time');
  // Second run: the ghost is made at GO and moves with the clock.
  let sawGhost = false, ghostMoved = false, last: number[] | null = null;
  lap(17, () => {
    const gh = [...H.world.entities].find((e: any) => e.tag === 'race-ghost' && e.alive);
    if (gh && gh.visible !== false) {
      sawGhost = true;
      if (last && Math.hypot(gh.x - last[0], gh.z - last[1]) > 0.05) ghostMoved = true;
      last = [gh.x, gh.z];
    }
  });
  const fins = events.filter((e) => e.state === 'finish');
  assert.equal(fins.length, 2);
  assert.ok(sawGhost && ghostMoved, 'a ghost ran beside the player');
  assert.ok(fins[1].ms < fins[0].ms, `faster (${fins[1].ms} < ${fins[0].ms})`);
  assert.ok(fins[1].isBest && fins[1].beatGhost && fins[1].previous === fins[0].ms, 'a new best that beat the ghost');
  assert.equal([...H.world.entities].filter((e: any) => e.tag === 'race-ghost' && e.alive).length, 0, 'the ghost is gone at the finish');
  assert.equal(game.race.best('ridge'), fins[1].ms);
  // A slower third run is not a best, and the best stays.
  lap(12);
  const third = events.filter((e) => e.state === 'finish')[2];
  assert.ok(third && !third.isBest && game.race.best('ridge') === fins[1].ms, 'the best stays');
  assert.equal(game.race.board('ridge').filter((r: any) => !r.rival).length, 3, 'all three runs are on the board');
  assert.deepEqual([...errors], []);
});

test('race: the speedboat has its own course; on foot, or in the wrong vehicle, nothing starts; leaving calls it off', () => {
  const game = start(1); // (one lap of the Harbour Run)
  H.tick(3);
  const events: any[] = [];
  game.on('race', (d: any) => events.push(d));
  const c = course('harbour');
  const D = C.gates(c.gates.map((p: number[]) => [p[0], p[1]]), c.width / 2)[0];
  // On foot through the 4x4's gate: nothing.
  const ridge = course('ridge');
  const RD = C.gates(ridge.gates.map((p: number[]) => [p[0], p[1]]), ridge.width / 2)[0];
  const me = game.player;
  put(me, ridge.gates[0][0] - RD.dx * 6, ridge.gates[0][2] + 1.2, ridge.gates[0][1] - RD.dz * 6);
  H.tick(0.4);
  drive(me, [[ridge.gates[0][0] - RD.dx * 6, ridge.gates[0][2] + 1.2, ridge.gates[0][1] - RD.dz * 6], [ridge.gates[0][0] + RD.dx * 6, ridge.gates[0][2] + 1.2, ridge.gates[0][1] + RD.dz * 6]], 6);
  H.tick(0.3);
  assert.equal(game.race.state.phase, 'idle', 'walking through is not racing');
  // The 4x4 through the boat's gate: nothing (it would not be over water anyway).
  const boat = H.world.byId.get('boat');
  put(boat, c.gates[0][0] - D.dx * 14, -0.9, c.gates[0][1] - D.dz * 14);
  H.tick(1.5);
  assert.ok(game.vehicles.enter(boat), 'in the speedboat');
  H.tick(0.3);
  // The harbour is 100 m from the start: the engine's frame moves under it (round world) and the gates must follow.
  const rebases = H.planet.frame.rebases;
  drive(boat, path_({ ...c, laps: 1 }, 0.4, 1, 14).map((p) => [p[0], -0.9, p[2]]), 20, () => {});
  H.tick(0.3);
  const fin = events.find((e) => e.state === 'finish');
  assert.ok(events.some((e) => e.state === 'countdown' && e.course === 'harbour'), 'the boat started the Harbour Run');
  assert.ok(fin && fin.course === 'harbour', `the boat took every gate (${events.map((e) => e.state).join(',')})`);
  assert.ok(H.planet.frame.rebases > rebases, 'the engine\'s frame moved along the way, and the gates stayed where they were on the planet');
  assert.deepEqual([...errors], []);
});

test('race: the countdown holds the vehicle; getting out for longer than six seconds calls it off', () => {
  const game = start();
  H.tick(3);
  const events: any[] = [];
  game.on('race', (d: any) => events.push(d));
  const jeep = H.world.byId.get('jeep');
  const c = course('ridge');
  const D = C.gates(c.gates.map((p: number[]) => [p[0], p[1]]), c.width / 2)[0];
  const at = (m: number) => put(jeep, c.gates[0][0] + D.dx * m, c.gates[0][2] + 1.4, c.gates[0][1] + D.dz * m);
  at(-14);
  H.tick(1);
  game.vehicles.enter(jeep);
  H.tick(0.3);
  at(-1.5); H.tick(0.1); at(1); H.tick(0.2);
  assert.equal(game.race.state.phase, 'countdown');
  assert.equal(jeep.physics, 'static', 'held at the line');
  H.tick(3.2);
  assert.equal(game.race.state.phase, 'running');
  assert.equal(jeep.physics, 'dynamic', 'let go at GO');
  game.vehicles.exit();
  H.tick(7);
  assert.equal(game.race.state.phase, 'idle');
  assert.ok(events.some((e) => e.state === 'abort' && e.why === 'left'));
  assert.deepEqual([...errors], []);
});

test('race: the sandbox script has Pip challenge once, and the Overseer remark calmly after a finish', () => {
  const src = bundle.files['scripts/main.js'];
  assert.match(src, /game\.on\('race'/);
  assert.match(src, /Race me!/);
  // The Overseer never says "lose", "failed", a time or a number, never an exclamation mark, in its race lines.
  const lines = [...src.matchAll(/remark\(([`'])([^`']+)\1/g)].map((m) => m[2]);
  assert.ok(lines.length >= 4, lines.join(' | '));
  for (const l of lines) assert.ok(!/[!]|lose|lost|fail|slow|bad|timer|\$\{nd/i.test(l), l);
});
