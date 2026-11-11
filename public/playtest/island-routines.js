// The `island-routines` scenario: Bobbin, Ember, Rolo, Dolores and Channel each walk between named spots on the game
// clock, idle with an activity at each, pause and face the player within ~4 m, then resume. Fixed camera over the beach
// for a two-minute clip; real walk to Channel for the face check. Named shortcuts only for the account gate (Google-only)
// and for placing the camera / sampling inland islanders the beach view cannot see.
export const ISLAND_ROUTINES = {
  id: 'island-routines',
  title: 'Islander routines: clock-driven walks between spots, idle activities, face the player, no clipping',
  seconds: 210,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then a fixed camera over the beach for ~2 minutes while each islander walks between at least two spots and idles (routine-walk, routine-arrive, routine-idle); real walk up to Channel (islander-faced, islander-resumed); samples check no islander through a prop or another (no-clip). Options: watch, at ("sandbox"), name, what',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const L = () => HP() && HP().living;
const CAST = ['bobbin', 'ember', 'rolo', 'dolores', 'channel'];

function liftGate(t) {
  if (window.HawkesGuest && typeof window.HawkesGuest.playtestContinue === 'function') {
    window.HawkesGuest.playtestContinue();
    t.event('setup-shortcut', 'account sheet closed so islander routines can run (playtest cannot Google-sign-up)');
  } else if (window.HawkesGuest) {
    window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account gate lifted so islander routines can run');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) mx.click();
}

/** Fixed camera over the beach looking inland: Bobbin on the pier and Channel on the sand are in frame. */
function beachCamera(t) {
  const g = G(), p = W() && W().player;
  if (!g || !p) throw new Error('beach camera: island not ready');
  const x = 58, z = -8;
  const y = (g.terrain && g.terrain.heightAt ? g.terrain.heightAt(x, z) : 1) + 1.1;
  const local = g.planet && g.planet.round && g.planet.toLocal ? g.planet.toLocal([x, y, z]) : [x, y, z];
  const at = Array.isArray(local) ? local : [local.x, local.y, local.z];
  p.controls = false;
  p.position = at;
  p.velocity = [0, 0, 0];
  try {
    if (g.camera) {
      g.camera.yaw = Math.PI * 0.15;
      g.camera.pitch = -0.35;
      if (g.camera.mode !== undefined) g.camera.mode = 'third';
    }
  } catch { /* keep the default view */ }
  t.event('setup-shortcut', 'fixed camera over the beach (player held still facing the pier and Channel)');
}

function sampleCast() {
  const out = {};
  for (const id of CAST) {
    const e = W().byId.get(id);
    if (!e || !e.alive) { out[id] = null; continue; }
    const st = L().status(e);
    out[id] = {
      x: e.x, z: e.z, y: e.y,
      act: st && st.act, state: st && st.state,
      spot: st && st.routine && st.routine.spot,
      want: st && st.routine && st.routine.want,
      facing: st && st.routine && st.routine.facing,
      visited: st && st.routine ? st.routine.visited.slice() : [],
    };
  }
  return out;
}

/** Rough AABBs of solid props the cast must not sit inside while walking. */
const BLOCKS = [
  { id: 'hut', x: -20, z: 14, r: 3.2 },
  { id: 'pier-deck', x: 73, z: 0, halfX: 16, halfZ: 1.2 }, // walk ON the pier is fine; through its thickness is not checked as xz
  { id: 'heli', x: 30, z: 30, r: 3.5 },
  { id: 'rocket', x: -38, z: -30, r: 2.2 },
];

function clipProblems(s) {
  const bad = [];
  for (const id of CAST) {
    const a = s[id];
    if (!a) continue;
    for (const b of BLOCKS) {
      if (b.r != null) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < b.r * 0.55 && a.act === 'goto') bad.push(`${id} walking through ${b.id} (${d.toFixed(1)} m)`);
      }
    }
  }
  for (let i = 0; i < CAST.length; i++) {
    for (let j = i + 1; j < CAST.length; j++) {
      const a = s[CAST[i]], b = s[CAST[j]];
      if (!a || !b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < 0.85) bad.push(`${CAST[i]} overlapping ${CAST[j]} (${d.toFixed(2)} m)`);
    }
  }
  return bad;
}

async function walkToward(t, setKeys, lookAt, camYaw, tx, tz, near, timeoutMs, what) {
  const t0 = performance.now();
  for (;;) {
    const p = W() && W().player;
    if (!p) throw new Error(`timed out waiting for the player (${what})`);
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d <= near) break;
    if (performance.now() - t0 > timeoutMs) throw new Error(`timed out walking to ${what} (at ${p.x.toFixed(1)},${p.z.toFixed(1)}; need ${tx},${tz})`);
    const yawWant = Math.atan2(dx, dz);
    try { await lookAt(t, yawWant); } catch { /* keep walking */ }
    const yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
    const ax = dx * c - dz * s, ay = dx * s + dz * c;
    const len = Math.hypot(ax, ay) || 1;
    setKeys({ w: ay / len > 0.2, s: ay / len < -0.2, d: ax / len > 0.2, a: ax / len < -0.2 });
    await t.wait(80);
  }
  setKeys({});
}

export async function runIslandRoutines(t, helpers) {
  const { setKeys, lookAt, camYaw, releaseAll } = helpers;
  await t.until(() => W() && W().player && G() && L() && CAST.every((id) => W().byId.get(id)), 90000, 'the island and the five islanders');
  liftGate(t);
  await t.wait(500);
  // Ensure the game clock is running (sandbox already uses day: 120). Set day through the sky's live clock, not the
  // events.clock getter copy (mutating that object does nothing).
  try {
    const sky = HP().sky && HP().sky.clock && HP().sky.clock(true);
    if (sky) { sky.run = true; sky.day = 90; t.event('setup-shortcut', 'sky clock day length 90 s so each spot is ~30 s in the clip'); }
  } catch { /* keep the world's own day */ }

  const log = [];
  const onRoutine = (d) => { if (d && CAST.includes(d.id)) log.push({ t: performance.now(), ...d }); };
  G().on('routine', onRoutine);

  beachCamera(t);
  t.scene('Routines: beach camera');
  t.progress(0.1);

  const visited = Object.fromEntries(CAST.map((id) => [id, new Set()]));
  const walked = Object.fromEntries(CAST.map((id) => [id, false]));
  const acts = Object.fromEntries(CAST.map((id) => [id, new Set()]));
  let clips = [];
  const watchMs = 125000;
  const t0 = performance.now();
  while (performance.now() - t0 < watchMs) {
    const s = sampleCast();
    for (const id of CAST) {
      const row = s[id];
      if (!row) continue;
      for (const sp of row.visited || []) visited[id].add(sp);
      if (row.spot) visited[id].add(row.spot);
      if (row.act === 'goto' || row.state === 'walk') walked[id] = true;
      if (row.act && row.act !== 'goto') acts[id].add(row.act);
    }
    clips = clips.concat(clipProblems(s));
    const hour = L().hour();
    if ((performance.now() - t0) % 20000 < 400) {
      t.event('routine-sample', `t=${((performance.now() - t0) / 1000).toFixed(0)}s hour=${hour == null ? '?' : hour.toFixed(2)} ` + CAST.map((id) => {
        const r = s[id];
        return r ? `${id}:${r.spot || r.want || '?'}@${r.x.toFixed(0)},${r.z.toFixed(0)}/${r.act}` : `${id}:missing`;
      }).join(' '));
    }
    await t.wait(400);
  }
  t.scene('Routines: after two minutes');
  t.progress(0.55);

  for (const id of CAST) {
    const spots = [...visited[id]];
    const activities = [...acts[id]];
    const kinds = log.filter((e) => e.id === id).map((e) => e.kind);
    const arrived = log.filter((e) => e.id === id && e.kind === 'arrive').map((e) => e.to || e.spot);
    t.event('routine-walk', `${id}: walked=${walked[id]} spots=${spots.join(',') || 'none'} arrive=${arrived.join(',') || 'none'} events=${kinds.join(',') || 'none'}`);
    t.event('routine-idle', `${id}: activities=${activities.join(',') || 'none'}`);
    if (spots.length < 2) t.problem('error', `${id} did not visit two spots in the clip (spots: ${spots.join(',') || 'none'}; walked=${walked[id]})`);
    if (!activities.length) t.problem('error', `${id} never idled with an activity at a spot`);
    if (!arrived.length && !kinds.includes('arrive')) t.problem('error', `${id} never fired an arrive event`);
  }
  const uniqueClips = [...new Set(clips)];
  if (uniqueClips.length) {
    for (const c of uniqueClips.slice(0, 8)) t.problem('error', `no-clip: ${c}`);
  } else t.event('no-clip', 'no islander overlapped another or walked into a prop AABB in the samples');

  // Real walk to Channel: face and resume.
  const ch = W().byId.get('channel');
  const p = W().player;
  p.controls = true;
  releaseAll();
  t.event('approach-channel', `walking to Channel at ${ch.x.toFixed(1)}, ${ch.z.toFixed(1)}`);
  await walkToward(t, setKeys, lookAt, camYaw, ch.x, ch.z, 3.2, 45000, 'Channel');
  await t.until(() => {
    const st = L().status(W().byId.get('channel'));
    return st && st.routine && st.routine.facing;
  }, 8000, 'Channel to face the player');
  t.event('islander-faced', 'Channel paused and faced the player within ~4 m');
  t.scene('Routines: Channel faces you');
  // Walk away so they resume.
  await walkToward(t, setKeys, lookAt, camYaw, 62, -2, 2, 20000, 'the dock away from Channel');
  await t.until(() => {
    const st = L().status(W().byId.get('channel'));
    return st && st.routine && !st.routine.facing;
  }, 8000, 'Channel to resume their routine');
  t.event('islander-resumed', 'Channel carried on after the player left');
  t.scene('Routines: Channel resumed');
  t.progress(1);
  releaseAll();
}
