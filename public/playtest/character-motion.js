// The `character-motion` scenario: jumping onto slopes and speeding up from a walk to a run, traced frame by frame. Loaded
// by portal.js, run on /play/sandbox after the intro (options.touch: the phone controls, for the phone-size run).
//
// Away from the island (local only: nothing is saved or sent but the player's own position), it puts down a floor and, one
// at a time, a ramp of 10, 20, 30 and 40 degrees. On each, the player walks at 6 m/s and jumps three ways: up the slope,
// down it, and from the floor onto it. Then, on the flat, a walk at 1.5 m/s speeds up to a 9 m/s run and slows back down.
// Every frame it records the trace (docs/animations.md "Landing" and "Strides"): what the body shows (airborne, landing,
// the clip role), whether physics has it on the ground, its speed, and each planted foot's speed.
//
//   slope-<deg>-<way>   a landing: airborne-near-ground (physics in the air with ground under the feet within 10 cm) and
//                       shown-airborne-on-ground (the body still drawn in the air while physics has it grounded); either
//                       for over 0.3 s in a row is a problem, and so is still being drawn airborne 0.5 s after the landing
//   foot-<part>         walk, speed-up, run, slow-down: the mean speed of a foot in its stance (down this frame and the
//                       last) against the body's speed; over max(0.12 m/s, 15% of it) is a problem (the foot slides)
//   trace               the first frames of each part in the event log, and the full trace as metrics (worst values)
//
// Uses one named shortcut, as the engine tests do: the player's controls are off while the scenario drives it with the
// game's own walk() and jump(), and the test ground is made with game.box(). Never on the live site.
export const CHARACTER_MOTION = {
  id: 'character-motion', title: 'Character motion: jumps onto 10, 20, 30 and 40 degree slopes land and walk on; a walk speeding up to a run and back keeps the planted foot still',
  description: 'no sign-up. The sandbox after the intro, then a test floor and ramps high over the player (game.box, local only). Logs slope-<deg>-<up|down|onto> (airborne-near-ground and shown-airborne-on-ground streaks; over 0.3 s is a problem), foot-walk, foot-speedup, foot-run, foot-slowdown (planted-foot speed against body speed; over max(0.12 m/s, 15%) is a problem) and trace lines. Run it at desktop size and phone size (touch: true). Options: angles ([10,20,30,40]), ways (["up","down","onto"]), touch. Refuses on the live site.',
  seconds: 240, tags: ['full'], starts: ['sandbox'],
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const PR = () => HP() && HP().presence;
const live = () => /^(www\.)?(hawkesgames\.com|hawkesgen\.ai)$/.test(location.hostname);
const RAD = Math.PI / 180;
const STREAK = 0.3;

export async function runCharacterMotion(t, ctx) {
  if (live()) throw new Error('character-motion moves the player off the island and drives it: never on the live site (run it on beta)');
  await t.until(() => G() && W() && W().player && W().player.alive && PR() && PR().motion, 60000, 'the island, the player and the presence module');
  await t.wait(1500);
  const opts = (ctx && ctx.options) || {};
  const angles = Array.isArray(opts.angles) && opts.angles.length ? opts.angles.map(Number).filter((a) => a > 0 && a < 60) : [10, 20, 30, 40];
  const ways = Array.isArray(opts.ways) && opts.ways.length ? opts.ways.filter((w) => ['up', 'down', 'onto'].includes(w)) : ['up', 'down', 'onto'];
  const g = G(), p = g.player, scene = W().scene;
  t.event('motion-plan', `${angles.join(', ')} degrees, ${ways.join(' / ')}; then walk to run and back. ${innerWidth}x${innerHeight}${opts.touch ? ', touch controls' : ''}`);
  const first = PR().motion();
  t.event('motion-body', first ? `${first.what}${first.feet ? ', procedural person (feet traced)' : ', clip model (feet not traced)'}` : 'no body yet');
  // the test ground: high straight over the player, so "up" there is the player's up. (The sandbox is a round world: 400 m
  // away the ground's up leans by the planet's curve, and a flat floor put there lets the player fall past it.)
  const O = [Math.round(p.x), Math.round(p.y) + 80, Math.round(p.z)];
  const made = [];
  const box = (size, pos, rot) => { const e = g.box({ size, position: pos, rotation: rot || [0, 0, 0], physics: 'static', color: '#8a93a8' }); made.push(e); return e; };
  box([90, 1, 90], [O[0], O[1] - 0.5, O[2]]);
  const controls0 = p.controls;
  p.controls = false;
  let drive = null; // per frame: (dt, time) => void, set by each part
  const offUpdate = g.onUpdate(() => { if (drive) drive(W().dt || 1 / 60); });
  // the drawn pose: after each render, so the feet are where they were drawn
  let onDrawn = null;
  const obs = scene.onAfterRenderObservable.add(() => { if (onDrawn) onDrawn(); });
  // (the body faces where it goes: the player's yaw follows the camera's, so both turn; the camera then looks along the way)
  const face = (dir) => { const yaw = Math.atan2(dir.x, dir.z); try { W().camera.yaw = yaw; } catch {} if (p.node) p.node.rotation.y = yaw; };
  let worstAir = 0, worstShown = 0, worstLate = 0, worstSlip = 0;
  const bad = [];
  try {
    // ---- landings on slopes
    let n = 0;
    for (const deg of angles) {
      const r = deg * RAD, len = 30;
      const ramp = box([8, 0.4, len], [O[0], O[1] + Math.sin(r) * len / 2 - 0.2 * Math.cos(r), O[2] + Math.cos(r) * len / 2], [-deg, 0, 0]);
      const under = (z) => { const lz = z - O[2]; return O[1] + (lz > 0 && lz < len * Math.cos(r) ? Math.tan(r) * lz : 0); };
      for (const way of ways) {
       for (let attempt = 0; attempt < 2; attempt++) {
        const start = way === 'onto' ? [O[0], O[1] + 0.1, O[2] - 3] : [O[0], O[1] + Math.tan(r) * 12 + 0.5, O[2] + 12];
        const dir = { x: 0, z: way === 'down' ? -1 : 1 };
        drive = null;
        p.position = [start[0], start[1] + 0.95, start[2]]; p.velocity = [0, 0, 0]; face(dir);
        await t.wait(700);
        const tr = { lost: false, air: 0, shown: 0, worstAir: 0, worstShown: 0, jumped: false, landedAt: -1, shownAfter: 0, frames: [], time: 0 };
        drive = (dt) => {
          tr.time += dt;
          if (p.bottom < Math.min(O[1], under(p.z)) - 3) tr.lost = true; // fell past the test ground
          p.walk(dir, 6); face(dir);
          if (!tr.jumped && tr.time > 0.1) tr.jumped = p.jump(8.5);
          const m = PR().motion();
          const near = p.bottom - under(p.z) < 0.1;
          // physics in the air with the ground right under the feet
          if (tr.time > 0.25 && near && !p.grounded && p.vy <= 0.5 + Math.tan(r) * 6.5) { tr.air += dt; tr.worstAir = Math.max(tr.worstAir, tr.air); } else tr.air = 0;
          // the body drawn in the air while physics has it on the ground
          if (m && m.airborne && p.grounded) { tr.shown += dt; tr.worstShown = Math.max(tr.worstShown, tr.shown); } else tr.shown = 0;
          if (tr.jumped && tr.time > 0.3 && p.grounded && tr.landedAt < 0) tr.landedAt = tr.time;
          if (tr.landedAt >= 0 && tr.time > tr.landedAt + 0.5 && m && m.airborne && p.grounded) tr.shownAfter += dt;
          if (tr.frames.length < 240) tr.frames.push([+tr.time.toFixed(2), m ? (m.airborne ? 'air' : m.landing ? 'land' : m.role || 'ground') : '?', p.grounded ? 1 : 0, +Math.hypot(p.vx || 0, p.vz || 0).toFixed(1), +(p.bottom - under(p.z)).toFixed(2)]);
        };
        await t.wait(1100);
        if (n === 0 || deg === angles[angles.length - 1]) t.scene(`Slope ${deg}°: ${way}, just landed`);
        await t.wait(1400);
        drive = null;
        const name = `slope-${deg}-${way}`;
        // the test ground was not there under the player (fell past it): put it back and play the case again, once
        if (tr.lost && attempt === 0) { t.event('ground-lost', `${name}: the player fell ${(O[1] - p.bottom).toFixed(1)} m below the test floor; playing it again`); continue; }
        const landed = tr.landedAt >= 0 ? `landed at ${tr.landedAt.toFixed(2)} s` : 'never landed';
        const line = `${landed}; airborne near the ground ${tr.worstAir.toFixed(2)} s, drawn airborne on the ground ${tr.worstShown.toFixed(2)} s`;
        worstAir = Math.max(worstAir, tr.worstAir); worstShown = Math.max(worstShown, tr.worstShown); worstLate = Math.max(worstLate, tr.shownAfter);
        if (!tr.jumped) { t.problem('warning', `${name}: the jump did not start (on the ground at the press: ${p.grounded})`); bad.push(name); }
        if (tr.landedAt < 0 || tr.worstAir > STREAK || tr.worstShown > STREAK || tr.shownAfter > 0) { t.problem('bug', `${name}: ${line}${tr.shownAfter > 0 ? `, still drawn airborne ${tr.shownAfter.toFixed(2)} s after landing` : ''}`); bad.push(name); }
        else t.event(name, line);
        // what the frames around the landing looked like: [s, shown, grounded, speed, height over the ground]
        const at = tr.landedAt >= 0 ? tr.frames.findIndex((f) => f[0] >= tr.landedAt) : -1;
        t.event('trace', `${name}: ${JSON.stringify(tr.frames.slice(Math.max(0, at - 4), Math.max(0, at - 4) + 12))}`);
        t.progress(0.05 + 0.55 * (++n / (angles.length * ways.length)));
        break;
       }
      }
      ramp.destroy(); made.splice(made.indexOf(ramp), 1);
    }

    // ---- walk to run and back: the planted foot
    const dir = { x: 1, z: 0 };
    drive = null;
    p.position = [O[0] - 34, O[1] + 0.95, O[2] - 25]; // (about 53 m of walk, speed-up, run and slow-down: still on the test floor) p.velocity = [0, 0, 0]; face(dir);
    await t.wait(800);
    const plan = [['walk', 2, () => 1.5], ['speedup', 3, (u) => 1.5 + 7.5 * u], ['run', 2, () => 9], ['slowdown', 3, (u) => 9 - 7.5 * u]];
    const parts = plan.map(([name]) => ({ name, slip: 0, speed: 0, n: 0, frames: [] }));
    let k = 0, kt = 0, prev = null, traced = false;
    drive = (dt) => {
      kt += dt;
      while (k < plan.length && kt >= plan[k][1]) { kt -= plan[k][1]; k++; prev = null; }
      if (k >= plan.length) { p.walk({ x: 0, z: 0 }, 0); return; }
      p.walk(dir, plan[k][2](kt / plan[k][1])); face(dir);
    };
    let last = performance.now();
    onDrawn = () => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      if (k >= plan.length || dt <= 0 || dt > 0.1) { prev = null; return; }
      const m = PR().motion();
      if (!m || !m.feet) return;
      traced = true;
      const sp = Math.hypot(p.vx || 0, p.vz || 0);
      const part = parts[k];
      if (prev && kt > 0.3) {
        for (let i = 0; i < 2; i++) {
          if (m.feet[i].down && prev.feet[i].down) { part.slip += Math.hypot(m.feet[i].x - prev.feet[i].x, m.feet[i].z - prev.feet[i].z) / dt; part.speed += sp; part.n++; }
        }
      }
      if (part.frames.length < 30) part.frames.push([+kt.toFixed(2), +sp.toFixed(1), m.feet.map((f) => (f.down ? 'D' : 'u')).join(''), m.role || '-']);
      prev = m;
    };
    await t.wait(2500);
    t.scene('Walk to run: walking');
    await t.wait(2600);
    t.scene('Walk to run: speeding up');
    await t.wait(5000);
    t.scene('Walk to run: slowing down');
    await t.wait(1400);
    onDrawn = null; drive = null;
    if (!traced) t.event('foot-skipped', `the body (${first ? first.what : '?'}) is a clip model: its feet are not traced here (the engine tests cover the clip gaits)`);
    for (const part of parts) {
      if (!part.n) continue;
      const slip = part.slip / part.n, speed = part.speed / part.n, limit = Math.max(0.12, speed * 0.15);
      worstSlip = Math.max(worstSlip, speed > 0 ? slip / speed : 0);
      const line = `planted foot ${slip.toFixed(2)} m/s at a body speed of ${speed.toFixed(1)} m/s (${Math.round((100 * slip) / Math.max(0.01, speed))}%; limit ${limit.toFixed(2)})`;
      if (slip > limit) { t.problem('bug', `foot-${part.name}: the planted foot slides: ${line}`); bad.push(`foot-${part.name}`); }
      else t.event(`foot-${part.name}`, line);
      t.event('trace', `foot-${part.name}: ${JSON.stringify(part.frames.slice(0, 12))}`);
    }
    t.progress(0.95);
  } finally {
    drive = null; onDrawn = null;
    try { offUpdate(); } catch {}
    try { scene.onAfterRenderObservable.remove(obs); } catch {}
    for (const e of made) try { e.destroy(); } catch {}
    p.controls = controls0;
    try { HP().respawn(); } catch {}
  }
  t.metric('worstAirborneNearGround', +worstAir.toFixed(2));
  t.metric('worstDrawnAirborneOnGround', +worstShown.toFixed(2));
  t.metric('drawnAirborneAfterLanding', +worstLate.toFixed(2));
  t.metric('worstPlantedFootSlipPct', Math.round(worstSlip * 100));
  t.event('motion-done', bad.length ? `${bad.length} problem(s): ${bad.join(', ')}` : 'every landing went back to walking, and the planted foot held');
  t.progress(1);
}
