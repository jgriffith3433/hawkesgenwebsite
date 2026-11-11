// The `island-alive` scenario: the island greets the player. Phase 1 walks up to each of the five islanders (Bobbin, Ember,
// Rolo, Dolores, Channel) until each has barked: a bark event with its recorded voice clip, the islander turned to the player,
// the caption over its head (`bark-clip`, `bark-turned`, `bark-caption`). Phase 2 is the island-alive walk: beach > path >
// pier and back, for `minutes` (default 2), logging every sound event (a footstep, a site sound, a voiced line, a music or
// ambience cue), every bark and every islander moving on screen, and failing on any 10 s window with none (`longest-quiet`,
// metric `longestQuietS`). Then no bark may have been repeated within 5 minutes (`no-repeat-5min`), and at the phone size
// (390x844, touch) every caption must be inside the screen, above the islander's head, clear of the touch controls.
// Real input all the way (keys, or the touch stick and drags with `?touch=1`); the only named shortcut is the account gate
// (Google-only sign-up cannot finish a throwaway account). Safe on live: no sign-up, nothing written. Options: touch, minutes,
// at ("sandbox"), name, what.
export const ISLAND_ALIVE = {
  id: 'island-alive',
  title: 'Island alive: each islander turns and barks in a recorded voice within 6 m; no 10 s of quiet on a beach-path-pier walk',
  seconds: 840,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then a walk up to Bobbin, Ember, Rolo, Dolores and Channel (bark with a voice clip, turned toward the player, caption over the head); then the island-alive walk beach > path > pier and back (default 2 min, option minutes) logging sound events, barks and moving islanders on screen; fails on any 10 s window with none; no bark repeated within 5 minutes; with touch (390x844) every caption inside the screen, above the head and clear of the touch controls. Options: touch, minutes, at',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const CAST = ['bobbin', 'ember', 'rolo', 'dolores', 'channel'];
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/** A world point in screen pixels (canvas rect), or null when it is behind the camera. */
function project(x, y, z) {
  const cam = W().scene.activeCamera, v = cam.getViewMatrix().m, pr = cam.getProjectionMatrix().m;
  const vx = x * v[0] + y * v[4] + z * v[8] + v[12], vy = x * v[1] + y * v[5] + z * v[9] + v[13], vz = x * v[2] + y * v[6] + z * v[10] + v[14], vw = x * v[3] + y * v[7] + z * v[11] + v[15];
  const cx = vx * pr[0] + vy * pr[4] + vz * pr[8] + vw * pr[12], cy = vx * pr[1] + vy * pr[5] + vz * pr[9] + vw * pr[13], cw = vx * pr[3] + vy * pr[7] + vz * pr[11] + vw * pr[15];
  if (!(cw > 0.05)) return null;
  const c = document.querySelector('canvas'), r = c.getBoundingClientRect();
  return { x: r.left + ((cx / cw) * 0.5 + 0.5) * r.width, y: r.top + (1 - ((cy / cw) * 0.5 + 0.5)) * r.height };
}
const onScreen = (p) => p && p.x >= 0 && p.x <= innerWidth && p.y >= 0 && p.y <= innerHeight;
const inRect = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

function liftGate(t) {
  if (window.HawkesGuest && typeof window.HawkesGuest.playtestContinue === 'function') {
    window.HawkesGuest.playtestContinue();
    t.event('setup-shortcut', 'account sheet closed so the walk can run (a playtest cannot Google-sign-up)');
  } else if (window.HawkesGuest) {
    window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account gate lifted so the walk can run');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) mx.click();
}

export async function runIslandAlive(t, helpers) {
  const { setKeys, lookAt, camYaw, releaseAll, stickHold, dragLook, options } = helpers;
  await t.until(() => W() && W().player && G() && CAST.every((id) => W().byId.get(id)) && window.__islanders && window.__islanders.barks, 90000, 'the island and the five islanders');
  liftGate(t);
  await t.wait(600);
  const touch = Boolean((options && options.touch) || HP().touchUi);
  const minutes = Math.max(0.5, Number(options && options.minutes) || 2);
  const p = () => W().player;
  const ent = (id) => W().byId.get(id);

  // ---- what is logged: every sound event, bark and moving islander on screen, each with its time
  const events = []; // { at (ms), kind, what }
  const mark = (kind, what) => events.push({ at: performance.now(), kind, what });
  const g = G();
  g.on('voiced', (d) => mark('sound', `voice ${d && d.kind}`));
  const audioLog = window.__islandAudioLog || [];
  let audioSeen = audioLog.length;
  const SS = HP().soundscape, lib = HP().lib;
  if (SS && SS.step && !SS.step.__alive) { const o = SS.step; SS.step = function (...a) { mark('sound', `step ${a[0]}`); return o.apply(this, a); }; SS.step.__alive = true; }
  if (lib && lib.siteSound && !lib.siteSound.__alive) { const o = lib.siteSound; lib.siteSound = function (...a) { mark('sound', `site ${a[0]}`); return o.apply(this, a); }; lib.siteSound.__alive = true; }
  const barkProblems = [];
  const captions = [];
  const barksSeen = [];
  g.on('bark', (d) => {
    mark('bark', `${d.id}:${d.ctx}`);
    barksSeen.push(d);
    t.event('bark', `${d.who} (${d.ctx}) at ${d.dist} m, clip ${d.clip ? d.clip.split('/').pop() : 'NONE'}, turned ${d.turned}: "${d.text}"`);
    measureCaption(d);
  });

  // ---- the caption: inside the screen, above the islander's head, clear of the touch controls
  function measureCaption(d) {
    try {
      const e = ent(d.id), b = e && e._bubble;
      if (!b) { barkProblems.push(`${d.id}: no caption over the head`); return; }
      b.computeWorldMatrix(true);
      const box = b.getBoundingInfo().boundingBox.vectorsWorld, pts = box.map((v) => project(v.x, v.y, v.z));
      if (pts.some((q) => !q)) { barkProblems.push(`${d.id}: caption is behind the camera`); return; }
      const r = { left: Math.min(...pts.map((q) => q.x)), right: Math.max(...pts.map((q) => q.x)), top: Math.min(...pts.map((q) => q.y)), bottom: Math.max(...pts.map((q) => q.y)) };
      const a = e.node.getAbsolutePosition(), head = project(a.x, a.y + (e.half ? e.half[1] : 0.6), a.z);
      const inside = r.left >= -2 && r.top >= -2 && r.right <= innerWidth + 2 && r.bottom <= innerHeight + 2;
      const above = head ? r.bottom <= head.y + 8 : false;
      const hit = [...document.querySelectorAll('#touch .pad, #touch .a, #touch .b, #touch button, #veh-touch button, .hp-use button, #tl-hide')].filter((el) => {
        const q = el.getBoundingClientRect();
        return q.width > 0 && q.height > 0 && inRect(r, q);
      }).map((el) => el.className || el.id || el.tagName);
      captions.push({ id: d.id, inside, above, hit, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
      t.event('bark-caption', `${d.id}: ${inside ? 'inside the screen' : 'OUTSIDE the screen'}, ${above ? 'above the head' : 'NOT above the head'}, ${hit.length ? 'over ' + hit.join(',') : 'clear of the controls'} (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} in ${innerWidth}x${innerHeight})`);
      if (!inside) barkProblems.push(`${d.id}: caption outside the screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)} of ${innerWidth}x${innerHeight})`);
      if (!above) barkProblems.push(`${d.id}: caption not above the islander's head`);
      if (hit.length && touch) barkProblems.push(`${d.id}: caption over the touch controls (${hit.join(', ')})`);
    } catch (err) { barkProblems.push(`${d.id}: caption could not be measured (${err.message})`); }
  }

  // ---- moving: keys, or the touch stick; turning: the mouse, or a thumb drag
  let stick = null;
  const move = (ax, ay) => {
    if (touch) { if (!stick) stick = stickHold(); stick.set(ax, ay); }
    else setKeys({ w: ay > 0.38, s: ay < -0.38, d: ax > 0.38, a: ax < -0.38 });
  };
  const halt = () => { if (stick) { stick.release(); stick = null; } setKeys({}); };
  async function face(yawWant) {
    if (!touch) { try { await lookAt(t, yawWant); } catch { /* keep going */ } return; }
    let sign = 1, last = null;
    for (let i = 0; i < 24 && Math.abs(wrap(yawWant - camYaw())) > 0.35; i++) {
      const err = wrap(yawWant - camYaw());
      if (last !== null && Math.abs(err) > Math.abs(last) + 0.02) sign = -sign;
      last = err;
      await dragLook(t, Math.sign(err) * sign * Math.min(260, Math.abs(err) * 200));
    }
  }
  let sampleAt = 0;
  const lastPos = {};
  async function tick() {
    // sample every ~0.5 s: new audio-log lines and islanders that moved while on screen
    const now = performance.now();
    if (now - sampleAt < 500) return;
    sampleAt = now;
    while (audioSeen < audioLog.length) { const e = audioLog[audioSeen++]; mark('sound', `audio ${e.what} ${e.name}`); }
    for (const id of CAST) {
      const e = ent(id);
      if (!e || !e.alive) continue;
      const a = e.node.getAbsolutePosition(), prev = lastPos[id];
      lastPos[id] = { x: e.x, z: e.z };
      if (prev && Math.hypot(e.x - prev.x, e.z - prev.z) > 0.06 && onScreen(project(a.x, a.y + (e.half ? e.half[1] : 0.6) * 0.5, a.z))) mark('moving', id);
    }
  }
  /** Walks to (tx, tz) (or an islander, live), looking at it once it is near; stops at `near` metres or when `until()` is true. */
  async function go(target, near, timeoutMs, what, until) {
    const t0 = performance.now();
    for (;;) {
      const to = typeof target === 'function' ? target() : target;
      const dx = to.x - p().x, dz = to.z - p().z, d = Math.hypot(dx, dz);
      if (d <= near || (until && until())) break;
      if (performance.now() - t0 > timeoutMs) { halt(); throw new Error(`timed out walking to ${what} (${Math.round(d)} m away)`); }
      if (d < 8 && typeof target === 'function') {
        const diff = Math.abs(wrap(Math.atan2(dx, dz) - camYaw()));
        if (diff > 0.8) { halt(); await face(Math.atan2(dx, dz)); }
      }
      const yaw = camYaw(), s = Math.sin(yaw), c = Math.cos(yaw);
      move((dx * c - dz * s) / d, (dx * s + dz * c) / d);
      await tick();
      await t.wait(80);
    }
    halt();
  }

  t.scene('Island alive: start');
  t.progress(0.03);

  // ---- phase 1: each of the five barks (with a voice clip, turned toward the player)
  const barked = (id) => barksSeen.some((d) => d.id === id);
  for (const id of ['ember', 'rolo', 'dolores', 'channel', 'bobbin']) {
    t.event('approach', `walking up to ${id}`);
    await go(() => ent(id), 3.2, 90000, id, () => barked(id));
    await t.until(() => barked(id), 8000, `${id} to bark within 6 m`).catch(() => t.problem('error', `${id} did not bark when the player came within 6 m`));
    if (barked(id)) t.scene(`Bark: ${id}`);
    await t.wait(1500);
    t.progress(0.03 + 0.04 * (CAST.indexOf(id) + 1));
  }
  for (const id of CAST) {
    const d = barksSeen.find((x) => x.id === id);
    if (!d) continue;
    if (!d.clip) t.problem('error', `${id}'s bark has no recorded voice clip: "${d.text}"`);
    if (!d.turned) t.problem('error', `${id} did not turn toward the player for the bark`);
    if (d.dist > 6.2) t.problem('error', `${id} barked at ${d.dist} m, beyond 6 m`);
    t.event('islander-barked', `${id}: clip ${d.clip ? 'yes' : 'NO'}, turned ${d.turned ? 'yes' : 'NO'}, ${d.dist} m`);
  }
  t.progress(0.3);

  // ---- phase 2: the island-alive walk, beach > path > pier and back
  const ROUTE = [['the path', { x: 30, z: 3 }], ['the beach', { x: 56, z: -8 }], ['the pier', { x: 78, z: -0.5 }], ['the beach', { x: 56, z: -8 }]];
  const walkStart = performance.now(), walkEnd = walkStart + minutes * 60000;
  mark('walk-start', '');
  t.event('alive-walk', `${minutes} min: beach, path, pier and back`);
  let leg = 0;
  while (performance.now() < walkEnd) {
    const [name, to] = ROUTE[leg % ROUTE.length];
    leg++;
    await go(to, 2.2, 60000, name, () => performance.now() >= walkEnd).catch((e) => { t.problem('warning', e.message); });
    t.scene(`Alive walk: ${name}`);
    t.progress(Math.min(0.9, 0.3 + 0.6 * ((performance.now() - walkStart) / (walkEnd - walkStart))));
  }
  halt(); releaseAll();
  const endAt = performance.now();

  // ---- the longest quiet stretch in the walk (no sound event, bark or moving islander on screen)
  const act = events.filter((e) => e.kind !== 'walk-start' && e.at >= walkStart && e.at <= endAt).map((e) => e.at).sort((a, b) => a - b);
  let longest = 0, from = walkStart;
  for (const a of [...act, endAt]) { longest = Math.max(longest, a - from); from = a; }
  const count = (k) => events.filter((e) => e.kind === k && e.at >= walkStart).length;
  t.event('alive-log', `${act.length} events in ${Math.round((endAt - walkStart) / 1000)} s: ${count('sound')} sounds, ${count('bark')} barks, ${count('moving')} islanders seen moving`);
  t.metric && t.metric('longestQuietS', Math.round(longest / 100) / 10);
  t.event('longest-quiet', `${(longest / 1000).toFixed(1)} s`);
  if (longest >= 10000) t.problem('error', `a ${(longest / 1000).toFixed(1)} s stretch with no sound event, bark or moving islander on screen (the limit is under 10 s)`);

  // ---- no bark repeated within 5 minutes
  const seen = {};
  let repeats = 0;
  for (const d of window.__islanders.barks) {
    const k = `${d.id}|${d.text}`;
    if (seen[k] !== undefined && d.at - seen[k] < 5 * 60 * 1000) { repeats++; t.problem('error', `${d.who} repeated "${d.text}" after ${Math.round((d.at - seen[k]) / 1000)} s`); }
    seen[k] = d.at;
  }
  t.event('no-repeat-5min', `${window.__islanders.barks.length} barks, ${repeats} repeated within 5 minutes`);

  // ---- captions
  for (const m of [...new Set(barkProblems)]) t.problem('error', m);
  t.event('captions-ok', `${captions.filter((c) => c.inside && c.above && !(touch && c.hit.length)).length} of ${captions.length} captions inside the screen, above the head${touch ? ' and clear of the touch controls' : ''}`);
  t.progress(1);
}
