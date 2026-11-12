// The `overseer-sound` scenario: the Overseer's sound identity (docs/world-bible.md "The Overseer's sound").
//   1. every intro line logs a voice treatment and a motif play at its start (`treatment-logged`, `motif-on-line`)
//   2. wonder, amused and ominous each play at least once (`motif-wonder`, `motif-amused`, `motif-ominous`)
//   3. walking from 60 m to 5 m from the beam raises the hum by at least 6 dB (`hum-rise`)
//   4. [phone] motif starts within 200 ms of a line and the caption stays fully visible (`motif-latency`, `caption-visible`)
// Real input for the walk; named shortcuts for the account gate, the sustained beam pad, and forcing the three moods.
// Options: touch (true: ?touch=1, taps as touch pointers), watch.
export const OVERSEER_SOUND = {
  id: 'overseer-sound',
  title: 'Overseer sound identity: treated voice, three motif moods, beam hum rises 6 dB from 60 m to 5 m',
  seconds: 300,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil and intro (treatment + motif on each line), then wonder/amused/ominous motifs each once, a walk from 60 m to 5 m toward a sustained beam (hum +6 dB), and on phone motif latency under 200 ms with a readable caption. Options: touch, watch',
};

const HP = () => window.HawkesPlay;
const W = () => HP() && HP().world;
const G = () => HP() && HP().game;
const OS = () => window.__overseerSound;

export async function runOverseerSound(t, helpers) {
  const { setKeys, lookAt, camYaw, releaseAll, options, touchEv } = helpers;
  const touch = Boolean(options && options.touch) || Boolean(HP() && HP().touchUi);
  const canvas = () => document.querySelector('canvas#c, canvas');

  await t.until(() => W() && W().player && G() && HP().overseerSound && window.__overseerSound, 60000, 'the island and Overseer sound');

  // Unlock audio with a real press (criteria about sound need this).
  if (touch) {
    const c = canvas(), id = 9201, x = innerWidth * 0.5, y = innerHeight * 0.35;
    if (touchEv) { touchEv('pointerdown', c, x, y, id); await t.wait(80); touchEv('pointerup', c, x, y, id); }
    else { c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch' })); await t.wait(80); c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch' })); }
  } else {
    const c = canvas();
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
    await t.wait(60);
    c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: innerWidth / 2, clientY: innerHeight / 2 }));
  }
  await t.wait(200);

  const speechStarts = [];
  const soundEv = [];
  G().on('overseer-speech', (d) => { if (d && d.state === 'start') speechStarts.push({ at: performance.now(), ...d }); });
  G().on('overseer-sound', (d) => soundEv.push({ at: performance.now(), ...d }));

  // ---- Intro: watch the real intro (this scenario's order is landing → veil → ovsound, so the intro is still ahead).
  const ov = () => G().overseer;
  t.scene('Sound: intro');
  const introOn = await t.until(() => ov() && ov().introPlaying, 25000, 'the Overseer\'s intro to start').then(() => true, () => false);
  if (introOn) {
    // Sample captions while lines play (phone criterion).
    let sawCap = false;
    const until = performance.now() + 20000;
    while (ov().introPlaying && performance.now() < until) {
      const capLive = document.querySelector('.ov-cap.on, .ov-cap.plate.on, .ov-cap.bar.on');
      if (capLive) {
        const r = capLive.getBoundingClientRect();
        if (r.width > 40 && r.height > 12 && r.bottom > 0 && r.top < innerHeight) {
          sawCap = true;
          t.event('caption-visible', `${Math.round(r.width)}x${Math.round(r.height)} during intro`);
          break;
        }
      }
      await t.wait(200);
    }
    await t.until(() => !ov().introPlaying, 20000, 'the intro to finish').catch(() => {});
    t.event('intro-watched', `${speechStarts.filter((s) => s.owner === 'intro').length} intro speech starts`);
    if (touch && !sawCap) t.problem('error', 'no Overseer caption fully visible during the intro on phone');
  } else {
    t.event('setup-shortcut', 'intro already seen on this device: replaying four intro lines through the speech desk');
    const lines = (HP().overseer && HP().overseer.INTRO_LINES) || [
      'You found your way. Good.',
      'I have given you the power of free will.',
      'Do with it what you will.',
      'Ask, and I will send it down.',
    ];
    for (const line of lines) {
      HP().speech.say({ text: line, priority: 'important', owner: 'intro', mood: 'wonder', seconds: 2.2 });
      await t.wait(1500); // > motif dedupe window so each line gets its own play
    }
    await t.wait(800);
  }

  // Every intro speech start must have a treatment log and a non-reused motif.
  const introStarts = speechStarts.filter((s) => s.owner === 'intro' || /free will|found your way|send it down|Do with it/i.test(s.text || ''));
  const treatments = (OS().treatment || []).filter((r) => r.line);
  const motifs = (OS().motifs || []).filter((m) => m.ok && !m.reused);
  if (introStarts.length < 4) t.problem('error', `expected 4 intro lines, got ${introStarts.length}`);
  if (treatments.length < introStarts.length) t.problem('error', `treatment logged for ${treatments.length} of ${introStarts.length} intro lines`);
  else t.event('treatment-logged', `${treatments.length} treatment logs on intro lines (${treatments[0] && treatments[0].kind})`);
  if (motifs.length < introStarts.length) t.problem('error', `motif play for ${motifs.length} of ${introStarts.length} intro lines (reused excluded)`);
  else t.event('motif-on-line', `${motifs.length} motif plays, first mood ${motifs[0].mood} in ${motifs[0].ms} ms`);

  if (window.HawkesGuest) {
    if (typeof window.HawkesGuest.playtestContinue === 'function') window.HawkesGuest.playtestContinue();
    else window.HawkesGuest.accountFirst = false;
    t.event('setup-shortcut', 'account sheet lifted: the walk needs a free player');
  }
  const mx = document.querySelector('.mr .mr-x');
  if (mx) { mx.click(); await t.wait(400); }

  // ---- Three moods in a short tour of the desk.
  t.event('setup-shortcut', 'three mood lines forced through the speech desk (wonder gift, amused reaction, ominous warning)');
  const before = motifs.length;
  HP().overseerSound.armMood('wonder');
  HP().speech.say({ text: 'Ask, and I will send it down.', priority: 'important', mood: 'wonder', seconds: 2 });
  await t.wait(900);
  HP().overseerSound.armMood('amused');
  G().emit('reaction', { kind: 'build', text: 'That is a strange thing to want, and I am very pleased.', mood: 'amused' });
  HP().speech.say({ text: 'That is a strange thing to want, and I am very pleased.', priority: 'important', owner: 'reaction', mood: 'amused', seconds: 2 });
  await t.wait(900);
  HP().overseerSound.armMood('ominous');
  HP().speech.say({ text: 'Destruction is a kind of freedom too.', priority: 'important', mood: 'ominous', seconds: 2 });
  await t.wait(1200);

  const moods = new Set((OS().motifs || []).slice(before).filter((m) => m.ok).map((m) => m.mood));
  for (const m of ['wonder', 'amused', 'ominous']) {
    if (!moods.has(m) && !(OS().motifs || []).some((x) => x.ok && x.mood === m)) t.problem('error', `motif mood ${m} never played`);
    else t.event(`motif-${m}`, 'played');
  }

  // Phone latency: last motif after the last speech start.
  const lastSpeech = speechStarts[speechStarts.length - 1];
  const lastMotif = (OS().motifs || []).filter((m) => m.ok).slice(-1)[0];
  if (lastSpeech && lastMotif && lastMotif.ms != null) {
    t.metric && t.metric('motifLatencyMs', lastMotif.ms);
    if (lastMotif.ms > 200) t.problem(touch ? 'error' : 'warning', `motif started ${lastMotif.ms} ms after the line (want ≤ 200 on phone)`);
    else t.event('motif-latency', `${lastMotif.ms} ms`);
  } else if (lastMotif) t.event('motif-latency', `${lastMotif.ms} ms (speech clock unavailable)`);

  // ---- Beam hum walk: 60 m → 5 m.
  releaseAll();
  const p = W().player;
  const yaw = (camYaw && camYaw()) || (p.node && p.node.rotation && p.node.rotation.y) || 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const beamAt = [p.x + fx * 60, p.bottom !== undefined ? p.bottom : p.y, p.z + fz * 60];
  t.event('setup-shortcut', 'a sustained beam pad 60 m ahead; player walks toward it');
  if (G().overseer && G().overseer.beam) G().overseer.beam(beamAt, { radius: 2.2, seconds: 90, sound: true });
  if (HP().overseerSound && HP().overseerSound.beamHum) HP().overseerSound.beamHum.attach(beamAt, 90);

  // Put the player ~60 m from the pad (behind it along the same line).
  const start = [beamAt[0] - fx * 60, p.y, beamAt[2] - fz * 60];
  try {
    p.x = start[0]; p.z = start[2];
    if (p.node) { p.node.position.x = start[0]; p.node.position.z = start[2]; }
    if (p.body && p.body.setLinearVelocity) p.body.setLinearVelocity(new window.BABYLON.Vector3(0, 0, 0));
  } catch { /* fine */ }
  await t.wait(400);
  const distTo = () => {
    const q = W().player;
    return Math.hypot(q.x - beamAt[0], (q.bottom !== undefined ? q.bottom : q.y) - beamAt[1], q.z - beamAt[2]);
  };
  await t.until(() => (OS().hum || []).length > 0 || distTo() < 58, 4000, 'hum samples to begin').catch(() => {});
  const hum0 = (OS().hum || []).slice();
  const d0 = distTo();
  t.event('hum-at-60', `dist ${d0.toFixed(1)} m, samples ${hum0.length}`);
  t.scene('Sound: 60 m from the beam');

  // Walk toward the beam with real keys (face it, hold W).
  const walkUntil = async (targetDist, label, limitMs = 90000) => {
    const t1 = performance.now();
    for (;;) {
      const d = distTo();
      if (d <= targetDist) break;
      if (performance.now() - t1 > limitMs) throw new Error(`timed out walking to ${label} (still ${d.toFixed(1)} m)`);
      const heading = Math.atan2(beamAt[0] - W().player.x, beamAt[2] - W().player.z);
      try {
        if (lookAt) await lookAt(t, heading);
        if (W().player.node) W().player.node.rotation.y = heading;
        if (W().camera) W().camera.yaw = heading;
      } catch { /* keep */ }
      setKeys({ w: true, a: false, s: false, d: false });
      await t.wait(80);
    }
    setKeys({}); releaseAll();
  };
  await walkUntil(5.5, '5 m from the beam');
  await t.wait(600);
  const hum1 = OS().hum || [];
  t.scene('Sound: 5 m from the beam');

  const near60 = hum1.filter((h) => h.dist >= 50 && h.dist <= 65);
  const near5 = hum1.filter((h) => h.dist >= 4 && h.dist <= 12);
  const sample = (arr, pick) => arr.length ? arr.reduce((a, b) => (pick(a, b) ? a : b)) : null;
  const far = sample(near60.length ? near60 : hum1.filter((h) => h.dist > 40), (a, b) => a.dist >= b.dist);
  const near = sample(near5.length ? near5 : hum1.filter((h) => h.dist < 15), (a, b) => a.dist <= b.dist);
  if (!far || !near) {
    t.problem('error', `not enough hum samples to compare (got ${hum1.length}: ${hum1.map((h) => h.dist + 'm/' + h.db + 'dB').join(', ')})`);
  } else {
    const rise = near.db - far.db;
    t.metric && t.metric('humRiseDb', Math.round(rise * 10) / 10);
    t.event('hum-rise', `${far.dist} m @ ${far.db} dB → ${near.dist} m @ ${near.db} dB (Δ ${rise.toFixed(1)} dB)`);
    if (rise < 6) t.problem('error', `beam hum rose only ${rise.toFixed(1)} dB from ${far.dist} m to ${near.dist} m (want ≥ 6)`);
    else t.event('hum-6db', `+${rise.toFixed(1)} dB`);
  }

  t.progress(1);
}
