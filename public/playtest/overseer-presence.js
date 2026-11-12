// The Overseer's sky presence: a soft face of light in the clouds that watches and reacts (modules/overseer/presence.js).
// After veil / intro / mirror (account gate lifted), looks toward OVERSEER_AT for ~2 minutes (visibility %), walks a circle
// (gaze follows), then triggers delight (blast), interest (catch), idle (30 s quiet), rocket (enter the rocket) and awe
// (first workEnd), each logging a reaction kind. With touch: true at 390x844: upper-third placement and costMs under 2.
export const OVERSEER_PRESENCE = {
  id: 'overseer-presence',
  title: 'The Overseer in the sky: a soft face of light that watches, follows the gaze, and reacts with voice',
  seconds: 360,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror, then window.__overseerPresence: ~2 min looking at the sky (presence-visible ≥80%), a walk in a circle (gaze-follows), a barrel blast (delight), a catch (interest), 30 s idle (idle blink), boarding the rocket (rocket), a first build (awe); each logs reaction-kind. Options: touch (true: ?touch=1 at 390x844: upper-third and costMs < 2), at ("sandbox")',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const P = () => window.__overseerPresence || null;

function lookAtOverseer() {
  const g = G(), p = W() && W().player;
  if (!g || !p || !g.camera) return;
  const cfg = (HP().lib && HP().lib.effectiveConfig && HP().lib.effectiveConfig()) || {};
  const pos = (cfg.overseer && cfg.overseer.position) || [9700, 4200, -3000];
  try {
    g.camera.yaw = Math.atan2(pos[0] - p.x, pos[2] - p.z);
    g.camera.pitch = 0.28;
    if (g.camera.mode !== undefined) g.camera.mode = 'third';
  } catch { /* fine */ }
}

function liftGate(t) {
  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue();
    else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted so the sky shots can run (no Google sign-up in a playtest)');
  }
}

export async function runOverseerPresence(t, helpers) {
  const { releaseAll, HOOKS, options, setKeys, walkTo, stickHold } = helpers;
  const touch = Boolean(options && options.touch);
  await t.until(() => W() && W().player && G() && HP().skyPresence && P(), 90000, 'the island with window.__overseerPresence');
  liftGate(t);
  releaseAll && releaseAll();
  lookAtOverseer();
  t.scene(touch ? 'Sky presence: phone quiet' : 'Sky presence: quiet');
  await t.wait(1500);

  // 1) Visible in ≥80% of default-camera frames over ~2 minutes (freelook: do not force the sky look each sample).
  // Aim once toward OVERSEER_AT, then leave the camera alone while the player stands / walks slowly.
  lookAtOverseer();
  const secs = touch ? 45 : 120;
  let seen = 0, samples = 0, upper = 0;
  const tEnd = performance.now() + secs * 1000;
  t.event('presence-watch', `sampling default-camera visibility for ${secs} s (aimed once at OVERSEER_AT, then freelook)`);
  while (performance.now() < tEnd) {
    // Mild wander with the default third-person camera — no re-aim every tick.
    if (!touch && setKeys && samples % 20 === 0) {
      setKeys({ a: samples % 40 < 20, d: samples % 40 >= 20 });
      await t.wait(120);
      setKeys({});
    }
    const s = P();
    samples++;
    if (s && s.visible) seen++;
    if (s && s.upperThird) upper++;
    if (samples % 30 === 0) t.progress(0.05 + 0.35 * (1 - (tEnd - performance.now()) / (secs * 1000)));
    await t.wait(200);
  }
  const pct = samples ? Math.round((seen / samples) * 1000) / 10 : 0;
  t.metric('presenceVisiblePct', pct);
  t.event('presence-visible', `${seen}/${samples} frames (${pct}%)`);
  if (pct < 80) t.problem('error', `the sky presence was visible in only ${pct}% of frames (need 80)`);
  else t.event('presence-visible-ok', `${pct}% ≥ 80`);

  // Phone: upper third + cost.
  if (touch) {
    const upPct = samples ? Math.round((upper / samples) * 1000) / 10 : 0;
    t.metric('presenceUpperThirdPct', upPct);
    t.event('presence-upper-third', `${upPct}% of samples in the upper third`);
    if (upPct < 50) t.problem('error', `on phone portrait the presence was in the upper third only ${upPct}% of the time`);
    const costs = [];
    for (let i = 0; i < 40; i++) { costs.push((P() && P().costMs) || 0); await t.wait(50); }
    const avg = costs.reduce((a, b) => a + b, 0) / costs.length;
    t.metric('presenceCostMs', Math.round(avg * 100) / 100);
    t.event('presence-cost', `avg ${avg.toFixed(2)} ms a frame (phone tier)`);
    if (avg > 2) t.problem('error', `sky presence cost ${avg.toFixed(2)} ms a frame (budget 2)`);
    else t.event('presence-cost-ok', `${avg.toFixed(2)} ms < 2`);
  }

  // 2) Walk a circle: gaze turns to follow (real keys / stick; stand-in settle if a step stalls).
  t.scene('Sky presence: gaze follows');
  const gazes = [];
  const cx = W().player.x, cz = W().player.z;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = cx + Math.cos(a) * 14, z = cz + Math.sin(a) * 14;
    const yaw = Math.atan2(x - W().player.x, z - W().player.z);
    try { if (G().camera) G().camera.yaw = yaw; } catch { /* fine */ }
    if (touch && stickHold) {
      const until = performance.now() + 2200;
      while (performance.now() < until) {
        const dx = x - W().player.x, dz = z - W().player.z;
        try { if (G().camera) G().camera.yaw = Math.atan2(dx, dz); } catch { /* fine */ }
        stickHold(0, 1);
        await t.wait(80);
      }
      stickHold(0, 0);
    } else if (setKeys) {
      setKeys({ w: true });
      await t.wait(1600);
      setKeys({});
    }
    // Settle on the ring if the walk did not reach it (named shortcut only then).
    if (Math.hypot(W().player.x - x, W().player.z - z) > 6) {
      const y = W().player.y;
      W().player.position = [x, y, z];
      W().player.velocity = [0, 0, 0];
      t.event('setup-shortcut', `stood at circle step ${i}`);
    }
    lookAtOverseer();
    await t.wait(400);
    const g = P() && P().gaze;
    if (g) gazes.push({ x: g.x, y: g.y });
  }
  const spanX = gazes.length ? Math.max(...gazes.map((g) => g.x)) - Math.min(...gazes.map((g) => g.x)) : 0;
  t.metric('gazeSpanX', Math.round(spanX * 1000) / 1000);
  t.event('gaze-follows', `gaze.x span ${spanX.toFixed(3)} over a circle (${gazes.length} samples)`);
  if (spanX < 0.08) t.problem('error', `the sky presence gaze did not turn with the walk (span ${spanX.toFixed(3)})`);
  else t.event('gaze-follows-ok', `span ${spanX.toFixed(3)}`);

  // 3) Reactions: delight, interest, idle, rocket, awe.
  const heard = [];
  const onSky = (d) => { if (d && d.kind) heard.push(d.kind); };
  const onReact = (d) => { if (d && d.kind) heard.push(d.kind); };
  G().on('sky-presence', onSky);
  G().on('reaction', onReact);

  const waitKind = async (kind, ms, how) => {
    const before = heard.filter((k) => k === kind).length;
    const at0 = (P() && P().lastReaction && P().lastReaction.at) || 0;
    await how();
    await t.until(() => {
      const n = heard.filter((k) => k === kind).length;
      const lr = P() && P().lastReaction;
      return n > before || (lr && lr.kind === kind && lr.at > at0);
    }, ms, `${kind} reaction`);
    const last = P() && P().lastReaction;
    t.event('reaction-kind', `${kind}${last && last.kind === kind ? ` (presence lastReaction)` : ''}`);
    t.scene(`Sky presence: ${kind}`);
    await t.wait(1800);
  };

  await waitKind('delight', 8000, () => {
    t.event('setup-shortcut', 'barrel blast via mayhem.explode');
    HOOKS.explode(t, { ahead: 8, radius: 8 });
  });

  await waitKind('interest', 8000, () => {
    t.event('setup-shortcut', 'a catch via water.fish.give');
    HOOKS.catchFish(t, 'trout');
  });

  // Idle: clear speech and wait for presence IDLE_AFTER (30 s).
  t.event('setup-shortcut', 'waiting 30 s quiet for the idle blink');
  const idleAt0 = (P() && P().lastReaction && P().lastReaction.at) || 0;
  try { if (HP().speech && HP().speech.clear) HP().speech.clear(); } catch { /* fine */ }
  await t.until(() => {
    const lr = P() && P().lastReaction;
    return lr && lr.kind === 'idle' && lr.at > idleAt0;
  }, 45000, 'idle sky reaction after 30 s');
  t.event('reaction-kind', 'idle');
  t.scene('Sky presence: idle');
  heard.push('idle');

  await waitKind('rocket', 12000, async () => {
    t.event('setup-shortcut', 'player put in the rocket');
    await HOOKS.enterVehicle(t, 'rocket');
  });
  // Get out so the world is free.
  try {
    if (G().player && G().player.controller === 'drive') {
      const key = helpers.tap || (async () => {});
      if (helpers.tap) await helpers.tap(t, 'e');
      else if (HP().vehicles && HP().vehicles.exit) HP().vehicles.exit();
      await t.wait(800);
    }
  } catch { /* fine */ }

  await waitKind('awe', 8000, () => {
    t.event('setup-shortcut', 'first workEnd (awe)');
    if (HP().work && HP().work.begin) HP().work.begin({ text: 'a soft new thing' });
    if (HP().work && HP().work.handle) {
      HP().work.handle({ k: 'op' });
      HP().work.handle({ k: 'end', ok: true });
    } else {
      G().emit('workEnd', { ok: true, ops: 2, beats: 1 });
    }
  });

  // Night squint: set the lighting hour so the face can react even when the island clock does not drive the light.
  t.event('setup-shortcut', 'hour set to night for the squint');
  try {
    if (HP().lighting && HP().lighting.setHour) HP().lighting.setHour(22);
    else if (HP().sky && HP().sky.clock) { const c = HP().sky.clock(true); if (c) c.hour = 22; }
  } catch { /* fine */ }
  await t.until(() => (P() && P().lastReaction && P().lastReaction.kind === 'night') || (P() && P().react && P().react.squint > 0.4), 12000, 'night squint').catch(() => {});
  if (P() && P().lastReaction && P().lastReaction.kind === 'night') {
    t.event('reaction-kind', 'night');
    heard.push('night');
  } else if (P() && P().react && P().react.squint > 0.4) {
    t.event('reaction-kind', 'night (squint visible)');
    heard.push('night');
  }
  t.scene('Sky presence: night');

  const kinds = [...new Set(heard.filter((k) => ['delight', 'interest', 'idle', 'awe', 'rocket', 'night'].includes(k)))];
  t.event('reaction-kinds', kinds.join(', '));
  t.metric('presenceReactionKinds', kinds.length);
  if (kinds.length < 5) t.problem('error', `only ${kinds.length} reaction kinds logged (${kinds.join(', ') || 'none'}); need 5+`);
  else t.event('reaction-kinds-ok', `${kinds.length} kinds`);

  releaseAll && releaseAll();
  t.progress(1);
}
