// The `cast-faces` scenario (docs/characters.md "Alive"; modules/presence/presence-alive.js): Pip and the five islanders talk with
// their mouths, blink, turn their heads to the player within 6 m, gesture with their arms and head (feet planted) and have idle life.
// Real input walks to each one (keys, or the touch stick and thumb drags with `touch: true`); the close-up is 30 s per character
// (`closeup`), in which a bark (or a line, for Pip) is played through the engine's own path and `window.__castFaces` is read.
// The state it reads: jaw against the sound, blink gaps, the head's yaw, gesture names and how far the feet moved.
export const CAST_FACES = {
  id: 'cast-faces',
  title: 'Cast faces: mouths follow the voice, blinks every 2 to 6 s, heads follow the player within 6 m, gestures with planted feet',
  seconds: 560,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror (account gate lifted: a named setup-shortcut), then a real walk up to Pip and each islander. Per character, a close-up of `closeup` seconds (30): jaw-follows-voice (the mouth opens while the clip plays and is shut in silence: jaw-while-audio, jaw-silent), blink-gaps (no gap over 6 s), head-follows (look-at on within 6 m, the head turns as the player moves, lets go past 7 m), bark-gesture (a gesture with the bark; feet-planted: they moved under 15 cm), idle-life. After all: gesture-share (1 in 2 barks or more) and, with touch: true (390x844, ?touch=1), face-animation-limited (the 3 nearest only) and close-up-fps (30 needed). Options: touch, closeup (seconds), only (a list of ids)',
};
const HP = () => window.HawkesPlay;
const G = () => HP() && HP().game;
const W = () => HP() && HP().world;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ORDER = ['pip', 'bobbin', 'ember', 'rolo', 'dolores', 'channel'];

export async function runCastFaces(t, helpers) {
  const { setKeys, lookAt, camYaw, releaseAll, stickHold, dragLook, touchEv, options } = helpers;
  const touch = Boolean(options && options.touch) || Boolean(HP() && HP().touchUi);
  const closeup = Math.max(8, Number(options && options.closeup) || 30);
  await t.until(() => W() && W().player && G() && window.__islanders && window.__castFaces, 60000, 'the island and the cast faces');
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue(); else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the cast needs a free player (no Google sign-up in a playtest)');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }
  const canvas = document.querySelector('canvas#c, canvas');
  if (touch) { const x = innerWidth / 2, y = innerHeight * 0.3; touchEv('pointerdown', canvas, x, y, 9300); await t.wait(80); touchEv('pointerup', canvas, x, y, 9300); }
  const ids = (options && options.only) || ORDER;
  const ent = (id) => { const e = G().find(id); return e && e.alive ? e : null; };
  const dist = (e) => Math.hypot(e.x - W().player.x, e.z - W().player.z);
  const bearing = (e) => Math.atan2(e.x - W().player.x, e.z - W().player.z);

  // ---- moving: keys, or the touch stick; turning: the mouse, or a thumb drag
  let stick = null;
  const move = (ax, ay) => {
    if (touch) { if (!stick) stick = stickHold(); stick.set(ax, ay); } else setKeys({ w: ay > 0.38, s: ay < -0.38, d: ax > 0.38, a: ax < -0.38 });
  };
  const halt = () => { if (stick) { stick.release(); stick = null; } setKeys({}); releaseAll(); };
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
  async function walkTo(id, want) {
    const t0 = performance.now();
    while (true) {
      const e = ent(id);
      if (!e) throw new Error(`timed out waiting for ${id}`);
      const d = dist(e);
      if (d <= want) break;
      if (performance.now() - t0 > 90000) throw new Error(`timed out walking to ${id}`);
      await face(bearing(e));
      move(0, 1);
      await t.wait(touch ? 500 : 250);
      if (touch) { /* the stick is held between ticks */ }
    }
    halt();
    await face(bearing(ent(id)));
  }
  const frames = async (ms) => new Promise((res) => { let n = 0, worst = 0, last = performance.now(); const t0 = last; const f = (now) => { n++; worst = Math.max(worst, now - last); last = now; if (now - t0 < ms) requestAnimationFrame(f); else res({ fps: Math.round((n / (now - t0)) * 10000) / 10, worst: Math.round(worst) }); }; requestAnimationFrame(f); });

  const barkAt = []; // { id, gesture }
  G().on('bark', (d) => barkAt.push(d));
  const results = {};
  let progress = 0;
  for (const id of ids) {
    if (!ent(id)) { t.event('cast-missing', `${id} is not on the island`); continue; }
    await walkTo(id, 4.6);
    const e = ent(id);
    const s0 = window.__castFaces.state(id);
    if (!s0) { t.problem('error', `${id} has no face state (presence-alive did not pick it up)`); continue; }
    t.scene(`Cast faces: ${id} close-up`);
    const r = (results[id] = { barks: 0, gestures: 0, drift: 0 });
    const feet0 = { x: e.x, z: e.z };
    // ---- the voice: a bark in the islander's own recorded voice (Pip: a line through his own say), through the engine's path
    const frameP = frames(4000); // the close-up's frame rate, over the first seconds of the voice
    const before = window.__castFaces.state(id);
    const trig = performance.now();
    const barkedBefore = barkAt.length;
    if (id === 'pip') { try { e.say('What a day for it!', 3.5); } catch { /* none */ } t.event('setup-shortcut', 'Pip speaks through his own say (he barks nowhere else)'); }
    else if (!window.__islanders.bark(id)) { window.__islanders.say(id); t.event('setup-shortcut', `${id}'s ordinary bark was on its cooldown: a line through the engine's say`); }
    const entry = id === 'pip' ? { gesture: (window.__castFaces.state(id).gesture || {}).name || null, clip: null } : barkAt.slice(barkedBefore).find((b) => b.id === id) || { gesture: null };
    await t.wait(400);
    const peak = { open: 0, playing: 0 };
    const end = performance.now() + 6500;
    while (performance.now() < end) { const s = window.__castFaces.state(id); if (s) { peak.open = Math.max(peak.open, s.jaw); if (s.playing) peak.playing++; } await t.wait(60); }
    const fr = await frameP;
    const after = window.__castFaces.state(id);
    const playedF = after.playingFrames - before.playingFrames, openF = after.openWhilePlaying - before.openWhilePlaying;
    const silentF = after.silentFrames - before.silentFrames, openSilent = after.openInSilence - before.openInSilence;
    if (playedF > 8) {
      t.event('jaw-while-audio', `${id}: the jaw was open (over 8%) in ${openF} of ${playedF} frames while the clip played; ${after.syllables - before.syllables} syllables, widest ${Math.round(after.maxOpen * 100)}%`);
      if (openF / playedF < 0.25) t.problem('error', `${id}'s mouth did not follow its voice (open in ${openF} of ${playedF} frames while audio played)`);
      t.event('jaw-silent', `${id}: open in ${openSilent} of ${silentF} silent frames`);
      if (silentF > 30 && openSilent / silentF > 0.05) t.problem('error', `${id}'s mouth stayed open in silence (${openSilent} of ${silentF} frames)`);
    } else {
      t.event('jaw-while-audio', `${id}: no clip was heard (audio was not running?): the mouth flapped to the words instead, widest ${Math.round(peak.open * 100)}%`);
      if (peak.open < 0.15) t.problem('error', `${id}'s mouth never opened while it spoke`);
    }
    // ---- the gesture, and the feet
    await t.wait(500);
    const s1 = window.__castFaces.state(id), gs = s1.gestures.filter((g) => g.at >= before.now - 0.5);
    const gname = entry.gesture || (gs[0] && gs[0].name) || (s1.gesture && s1.gesture.name) || null;
    r.barks = 1; r.gestures = gname ? 1 : 0;
    const drift = Math.max(Math.hypot(e.x - feet0.x, e.z - feet0.z), s1.gesture ? s1.gesture.drift : 0, ...gs.map((g) => g.drift));
    r.drift = drift;
    t.event('bark-gesture', `${id}: ${gname || 'no gesture'}; the feet moved ${Math.round(drift * 100)} cm`);
    if (gname && drift > 0.15) t.problem('error', `${id}'s feet moved ${Math.round(drift * 100)} cm during the ${gname} gesture (planted: under 15 cm)`);
    if (touch) { t.metric && t.metric(`closeupFps-${id}`, fr.fps); t.event('close-up-fps', `${id}: ${fr.fps} fps (worst frame ${fr.worst} ms)`); if (fr.fps < 30) t.problem('error', `the bark close-up of ${id} ran at ${fr.fps} fps on a phone (30 needed)`); }
    if (touch) {
      const act = window.__castFaces.active(), all = window.__castFaces.all();
      t.event('face-animation-limited', `${act.length} of ${all.length} characters animate faces (${act.join(', ')}); the limit is ${window.__castFaces.limit()}`);
      if (act.length > 3) t.problem('error', `${act.length} characters run face animation on a phone (3 nearest only)`);
      if (!act.includes(id)) t.problem('error', `the speaking character ${id} is not among the active faces`);
      // the speaker is framed: in the picture, within 6 m
      const cam = W().scene && W().scene.activeCamera, a = e.node && e.node.getAbsolutePosition ? e.node.getAbsolutePosition() : null;
      if (cam && a) { try { const v = HP().world.scene.getTransformMatrix(); void v; const B = window.BABYLON; const sp = B.Vector3.Project(new B.Vector3(a.x, a.y + 0.6, a.z), B.Matrix.Identity(), W().scene.getTransformMatrix(), cam.viewport.toGlobal(W().scene.getEngine().getRenderWidth(), W().scene.getEngine().getRenderHeight())); const px = sp.x / W().scene.getEngine().getRenderWidth() * innerWidth, py = sp.y / W().scene.getEngine().getRenderHeight() * innerHeight; const inside = px > 0 && px < innerWidth && py > 0 && py < innerHeight && dist(e) <= 6; t.event('speaker-framed', `${id}: at ${Math.round(px)},${Math.round(py)} of ${innerWidth}x${innerHeight}, ${Math.round(dist(e) * 10) / 10} m away: ${inside ? 'framed' : 'NOT framed'}`); if (!inside) t.problem('error', `the speaking character ${id} was not framed within 6 m on the phone`); } catch { /* projection unavailable */ } }
    }
    // ---- the blinks over the rest of the close-up (30 s), the head following the player as they step aside
    const t0 = performance.now(), yaws = [], lookOn = [];
    const startBlinks = window.__castFaces.state(id).blinks, startNow = window.__castFaces.state(id).now;
    let sideStep = 0;
    while (performance.now() - t0 < closeup * 1000) {
      const s = window.__castFaces.state(id);
      yaws.push(s.look.yaw); lookOn.push(s.look.on && s.look.w > 0.4);
      // after 8 s, a slow step to one side (real input) so the head has something to follow, then back
      const el = performance.now() - t0;
      if (el > 8000 && el < 10500) { move(touch ? 1 : 1, 0); sideStep++; } else if (el >= 10500 && el < 13000) { move(-1, 0); } else if (stick || sideStep) { halt(); sideStep = 0; await face(bearing(e)); }
      await t.wait(200);
    }
    halt();
    const sEnd = window.__castFaces.state(id);
    const marks = sEnd.blinkAt.filter((x) => x >= startNow);
    const span = sEnd.now - startNow, gaps = [];
    const pts = [startNow, ...marks, sEnd.now];
    for (let i = 1; i < pts.length; i++) gaps.push(pts[i] - pts[i - 1]);
    const maxGap = Math.round(Math.max(...gaps) * 10) / 10;
    t.event('blink-gaps', `${id}: ${sEnd.blinks - startBlinks} blinks in ${Math.round(span)} s, longest gap ${maxGap} s`);
    t.metric && t.metric(`maxBlinkGap-${id}`, maxGap);
    if (maxGap > 6.4 || sEnd.blinks - startBlinks < Math.floor(span / 6)) t.problem('error', `${id}: longest time without a blink was ${maxGap} s in a ${Math.round(span)} s close-up (6 s at most)`);
    const turned = Math.max(...yaws) - Math.min(...yaws);
    t.event('head-follows', `${id}: look-at on in ${lookOn.filter(Boolean).length} of ${lookOn.length} samples inside ${Math.round(dist(e) * 10) / 10} m; the head's yaw ranged ${Math.round(turned * 100) / 100} rad as the player moved`);
    if (!lookOn.some(Boolean)) t.problem('error', `${id}'s head did not turn to the player within 6 m`);
    t.event('idle-life', `${id}: ${sEnd.glances} glances, gestures ${sEnd.gestureCount}, idle shift always on`);
    progress += 1 / ids.length; t.progress(Math.min(0.9, progress * 0.85));
  }
  // ---- walking away: past 7 m the head lets go
  if (ids.length) {
    const id = ids[ids.length - 1], e = ent(id);
    if (e) {
      const t0 = performance.now();
      await face(bearing(e) + Math.PI);
      move(0, 1);
      while (dist(e) < 8 && performance.now() - t0 < 20000) await t.wait(250);
      halt();
      await t.wait(1500);
      const s = window.__castFaces.state(id);
      t.event('head-lets-go', `${id}: ${Math.round(dist(e) * 10) / 10} m away, look-at ${s.look.on ? 'still on' : 'off'}, weight ${s.look.w}`);
      if (s.look.on) t.problem('error', `${id} still watched the player at ${Math.round(dist(e) * 10) / 10} m`);
    }
  }
  const barks = Object.values(results).reduce((n, r) => n + r.barks, 0), gests = Object.values(results).reduce((n, r) => n + r.gestures, 0);
  t.metric && t.metric('gestureShare', barks ? Math.round((gests / barks) * 100) / 100 : 0);
  t.event('gesture-share', `${gests} of ${barks} barks came with a gesture`);
  if (barks && gests / barks < 0.5) t.problem('error', `only ${gests} of ${barks} barks came with a gesture (1 in 2 needed)`);
  t.progress(1);
}
