// Faces that are alive: the cast (Pip and the five islanders, any `friend`) talks with its mouth, blinks, looks at you, gestures and
// has small idle life (docs/characters.md "Alive"; J, 2026-11-12: "islanders talk, blink, look at you and gesture like they're
// alive"; the reference is Tears of the Kingdom's villagers turning their heads and gesturing as they talk).
//
//   mouth    an AnalyserNode on each speaking voice clip (runtime.js speakRecorded -> e._voiceAnalyser) gives the loudness; it is
//            smoothed (fast to open on a syllable, slower to close) and gated, so the mouth opens on syllables and shuts in
//            silence. The toy bodies have no bones: their mouth is the face mesh's `open` (the jaw), so it is that number that moves.
//            A model that does bring a jaw bone or a mouth/jaw morph target gets those driven too (found once, by name).
//   blinks   the face system's own (presence-core.js blinkStep: 2.5 to 6 s, some in pairs); counted here for the playtest.
//   look-at  within 6 m the head turns to the player (clamped to a natural range, layered over walking and idle: set after the
//            body's animation so it wins) and the eyes follow (rig.lookTarget); farther, it glances about now and then.
//   gestures the free clip set's arm poses (point, wave, shrug, laugh, salute, explain, nod) chosen by the bark's context, laid over
//            the arms and head ONLY: the hips, legs and pose root are never touched, so the feet stay where they are.
//   idle     breathing in the arms, a slow shift of weight in the shoulders, a glance about when nobody is near.
//   phones   the look-at, gestures and idle run for the 3 nearest characters only (the one speaking always counts).
// Pure rules (no Babylon) are in P.aliveCore and tested by test/engine/alive.test.ts; the runtime half is P.alive.
(function () {
  const H = window.HawkesPlay;
  const P = (H.presence = H.presence || {});
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const TAU = Math.PI * 2;

  // ================================================================== pure rules
  const RANGE = 6, RANGE_OUT = 6.6; // metres: the look-at begins inside RANGE and lets go past RANGE_OUT
  const YAW_MAX = 1.05, PITCH_UP = 0.4, PITCH_DOWN = 0.3; // radians: how far a head turns (60 degrees), looks up and down
  const MOUTH_MAX = 0.45; // presence-core talkOpen's ceiling: the face's `open` number for a wide mouth

  /** Loudness 0..1 of a block of unsigned bytes from an AnalyserNode's time domain (128 is silence). */
  function rms(bytes) {
    if (!bytes || !bytes.length) return 0;
    let s = 0;
    for (let i = 0; i < bytes.length; i++) { const v = (bytes[i] - 128) / 128; s += v * v; }
    return Math.sqrt(s / bytes.length);
  }
  /** The jaw: m = { open }. Opens fast (35 ms) and closes slower (90 ms) so it follows syllables; under the gate it closes. Returns open 0..1. */
  function mouthStep(m, level, dt) {
    const gate = 0.018, want = level < gate ? 0 : Math.pow(clamp((level - gate) / 0.2, 0, 1), 0.8);
    const tc = want > m.open ? 0.035 : 0.09;
    m.open += (want - m.open) * (1 - Math.exp(-dt / tc));
    if (m.open < 0.01 && want === 0) m.open = 0;
    return m.open;
  }
  /** When no voice file plays (the babble, a muted voice): a quick uneven flap while the words last, shut when they are done. */
  const babbleOpen = (t) => clamp((0.22 + 0.2 * Math.sin(t * 17) * Math.sin(t * 5.3 + 1)) / MOUTH_MAX, 0, 1);

  /** Does the head follow the player now? Hysteresis: in under RANGE, out past RANGE_OUT. */
  const lookIn = (was, dist) => (was ? dist < RANGE_OUT : dist < RANGE);
  /** The head's turn toward a point in the neck's parent space ({x,y,z}: x right, y up, z ahead): { yaw, pitch } clamped to a natural range. */
  function headAim(v) {
    const hz = Math.hypot(v.x, v.z);
    let yaw = Math.atan2(v.x, Math.abs(v.z) < 1e-3 ? 1e-3 : v.z);
    // someone behind: turn as far as a neck can, toward their side, never spin
    yaw = clamp(yaw, -YAW_MAX, YAW_MAX);
    const pitch = clamp(Math.atan2(v.y, Math.max(hz, 0.05)), -PITCH_DOWN, PITCH_UP);
    return { yaw, pitch };
  }
  /** One step of a smoothed head: L = { yaw, pitch, w }; the aim, or null to let go (w eases to 0). */
  function lookStep(L, aim, dt) {
    const k = Math.min(1, dt * 7);
    if (aim) { L.yaw += (aim.yaw - L.yaw) * k; L.pitch += (aim.pitch - L.pitch) * k; L.w += (1 - L.w) * Math.min(1, dt * 5); }
    else { L.w += (0 - L.w) * Math.min(1, dt * 3); }
    return L;
  }

  // ---- gestures: arm and head poses from the free clip set's named moves. Each gives joint rotations at time k of dur (radians,
  // [x, y, z]; shR is the right arm, raised by a negative z); a joint it does not name is left to the body. Only shL, shR and neck.
  const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const GESTURES = {
    point: (k) => ({ shR: [-1.5 + Math.sin(k * 5) * 0.05, 0.1, -0.1], neck: [0.04, 0, 0] }),
    wave: (k) => ({ shR: [0, 0, -2.5 + Math.sin(k * 10) * 0.35], neck: [0, 0, 0.08] }),
    shrug: (k) => ({ shL: [-0.15, 0, 0.9 + Math.sin(k * 4) * 0.03], shR: [-0.15, 0, -0.9 - Math.sin(k * 4) * 0.03], neck: [-0.05, 0, Math.sin(k * 2.2) * 0.14] }),
    laugh: (k) => ({ shL: [-0.7, 0, 0.3 + Math.sin(k * 26) * 0.05], shR: [-0.7, 0, -0.3 - Math.sin(k * 26) * 0.05], neck: [-0.22 + Math.sin(k * 24) * 0.04, 0, 0] }),
    salute: (k) => ({ shR: [-0.9, -0.5, -2.05 + Math.sin(k * 3) * 0.02], neck: [-0.05, 0, 0] }),
    explain: (k) => ({ shL: [-0.85 + Math.sin(k * 4.2) * 0.2, 0, 0.55], shR: [-0.85 - Math.sin(k * 4.2) * 0.2, 0, -0.55], neck: [0, Math.sin(k * 1.7) * 0.08, 0] }),
    nod: (k) => ({ neck: [Math.max(0, Math.sin(k * 7)) * 0.22, 0, 0] }),
  };
  const GESTURE_NAMES = Object.keys(GESTURES);
  /** The gesture's weight over its length: eased in over 0.25 s, held, eased out over 0.35 s. */
  const envelope = (k, dur) => (k < 0 || k > dur ? 0 : Math.min(ease(k / 0.25), ease((dur - k) / 0.35)));
  /** Gestures by what the bark was about; a character's own habits (the harbourmaster salutes, the reporter explains) come first. */
  const BY_CTX = { first: ['wave'], rod: ['point'], drive: ['point', 'shrug'], boom: ['shrug', 'laugh'], fish: ['laugh', 'nod'], any: ['shrug', 'explain', 'point', 'nod'] };
  const HABIT = { bobbin: 'salute', ember: 'shrug', rolo: 'shrug', dolores: 'nod', channel: 'explain', pip: 'point' };
  /** The gesture for a bark: `ctx` is the bark's context, `who` the character, `n` how many it has made (the ordinary ones go round). */
  function gestureFor(who, ctx, n) {
    const pool = BY_CTX[ctx] || BY_CTX.any;
    if (ctx === 'first') return pool[0];
    const h = HABIT[who];
    // every other ordinary line carries the character's own habit; the rest go round the pool
    if (h && (n % 2 === 0)) return h;
    return pool[n % pool.length];
  }
  /** What words suggest when no bark named a context (Pip's lines, anyone else's say). */
  function gestureForText(text, n) {
    const t = String(text || '');
    if (/\?\s*$/.test(t)) return 'shrug';
    if (/\b(hello|hi|welcome|hey)\b/i.test(t)) return 'wave';
    if (/\b(there|that way|over|east|west|north|south|walk up|press)\b/i.test(t)) return 'point';
    if (/!\s*$/.test(t)) return n % 2 ? 'laugh' : 'explain';
    return ['explain', 'nod', 'shrug', 'point'][n % 4];
  }
  /** How long a gesture lasts for words of this length (seconds). */
  const gestureSeconds = (text) => clamp(1.2 + String(text || '').length / 30, 1.4, 4.5);

  /** Idle life when not talking: a breath in the arms, a slow shift of weight in the shoulders, a drift of the head. t seconds, seed 0..1. */
  function idlePose(t, seed) {
    const ph = seed * TAU, shift = Math.sin(t * 0.21 + ph) * 0.5 + Math.sin(t * 0.083 + ph * 2) * 0.5; // -1..1, a few seconds each way
    const br = Math.sin(t * 1.9 + ph);
    return { shL: [br * 0.02, 0, shift * 0.05 + br * 0.015], shR: [-br * 0.02, 0, shift * 0.05 - br * 0.015], neck: [br * 0.012, 0, shift * 0.03] };
  }
  /** The nearest `n` of the list [{ id, dist }], by distance; ids that must stay (the one speaking) always count. */
  function pickActive(list, n, always) {
    const sorted = list.slice().sort((a, b) => a.dist - b.dist);
    const out = new Set(sorted.slice(0, n).map((x) => x.id));
    for (const x of list) if (always && always.has(x.id)) out.add(x.id);
    return out;
  }
  P.aliveCore = { RANGE, RANGE_OUT, YAW_MAX, MOUTH_MAX, rms, mouthStep, babbleOpen, lookIn, headAim, lookStep, GESTURES, GESTURE_NAMES, envelope, BY_CTX, HABIT, gestureFor, gestureForText, gestureSeconds, idlePose, pickActive };

  // ================================================================== the runtime half
  const Core = P.aliveCore;
  const B = window.BABYLON;
  const casts = new Map(); // rig -> state
  const byId = new Map(); // character id -> state (the latest)
  const phone = () => Boolean(H.touchUi);
  const NEAR_PHONE = 3;
  let rankAt = -1, activeIds = new Set(), ranks = new Map();
  const idOf = (e) => String((e && (e.sceneId || e.id || e.name)) || '').toLowerCase();
  /** Is this rig one of the cast? Friends of the world: Pip and the islanders (and any friend a game places). */
  const isCast = (rig) => Boolean(rig && rig.e && rig.e.alive && !rig.e.isPlayer && !rig.e.remotePlayer && rig.e.living && rig.e.living.friend);
  function stateOf(rig) {
    let a = casts.get(rig);
    if (a) return a;
    const id = idOf(rig.e);
    a = {
      id, rig, seed: (Array.from(id).reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 997, 7) % 997) / 997,
      active: false, rank: -1, dist: 99,
      mouth: { open: 0 }, mouthOpen: 0, voiced: false, playing: false, talkUntil: -1, level: 0,
      look: { yaw: 0, pitch: 0, w: 0 }, lookOn: false, ownedLook: false,
      g: null, gn: 0, gestures: [], lastGestureAt: -9,
      glance: { until: -1, next: 2 + Math.random() * 3, yaw: 0, n: 0 },
      blinks: 0, blinkAt: [], inBlink: false,
      stats: { playingFrames: 0, openWhilePlaying: 0, silentFrames: 0, openInSilence: 0, maxOpen: 0, syllables: 0, wasOpen: false },
      jaw: null, jawBones: undefined, samples: [], buf: null, drift: 0,
    };
    casts.set(rig, a); byId.set(id, a);
    return a;
  }

  // ---- finding a model's own jaw bone or mouth morph (once); the toys have none (their jaw is the face mesh's `open`)
  function findJaw(rig) {
    const out = { nodes: [], morphs: [] };
    try {
      const root = rig.root;
      const all = root && root.getDescendants ? root.getDescendants(false) : [];
      for (const n of all) {
        if (/jaw/i.test(n.name || '') && n.rotation) out.nodes.push(n);
        const mm = n.morphTargetManager;
        if (mm) for (let i = 0; i < mm.numTargets; i++) { const t = mm.getTarget(i); if (/(jaw|mouth).*open|viseme_aa|mouthopen/i.test(t.name || '')) out.morphs.push(t); }
        const sk = n.skeleton;
        if (sk && sk.bones) for (const b of sk.bones) { const tn = b.getTransformNode && b.getTransformNode(); if (/jaw/i.test(b.name || '') && tn && tn.rotation && !out.nodes.includes(tn)) out.nodes.push(tn); }
      }
    } catch { /* no jaw */ }
    return out;
  }
  function driveJaw(rig, a, open) {
    if (a.jawBones === undefined) a.jawBones = findJaw(rig);
    const j = a.jawBones;
    for (const n of j.nodes) n.rotation.x = open * 0.35; // a simple jaw: swings down about 20 degrees
    for (const t of j.morphs) t.influence = open;
  }

  // ---- the voice
  function readLevel(a, e) {
    const el = e._voiceClip, an = e._voiceAnalyser;
    const playing = Boolean(el && !el.paused && !el.ended && el.currentTime > 0 && an);
    a.playing = playing;
    if (!playing) return null;
    if (!a.buf || a.buf.length !== an.fftSize) a.buf = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(a.buf);
    return Core.rms(a.buf);
  }
  function ranking(t) {
    if (t - rankAt < 0.25 && t >= rankAt) return;
    rankAt = t;
    const p = H.world && H.world.player;
    const list = [];
    for (const [rig, a] of casts) {
      if (!isCast(rig)) { casts.delete(rig); if (byId.get(a.id) === a) byId.delete(a.id); continue; }
      a.dist = p ? Math.hypot(rig.e.x - p.x, rig.e.z - p.z) : 99;
      list.push({ id: a.id, dist: a.dist });
    }
    const speaking = new Set();
    for (const [, a] of casts) if (a.playing || a.talkUntil > t) speaking.add(a.id);
    activeIds = Core.pickActive(list, phone() ? NEAR_PHONE : 99, speaking);
    ranks = new Map(list.sort((x, y) => x.dist - y.dist).map((x, i) => [x.id, i]));
  }

  /** Before the body's animation: the voice and the mouth, the eyes' target. */
  function before(rig, dt) {
    if (!isCast(rig)) return;
    const a = stateOf(rig), e = rig.e, t = rig.time || 0;
    ranking(t);
    a.active = activeIds.has(a.id); a.rank = ranks.has(a.id) ? ranks.get(a.id) : -1;
    const lv = readLevel(a, e);
    a.voiced = lv !== null;
    let open;
    if (lv !== null) { a.level = lv; open = Core.mouthStep(a.mouth, lv, dt); }
    else if (a.talkUntil > t) { a.level = 0; open = Core.mouthStep(a.mouth, Core.babbleOpen(t) > 0.5 ? 0.5 : 0.05, dt); }
    else { a.level = 0; open = Core.mouthStep(a.mouth, 0, dt); }
    a.mouthOpen = open;
    // what the face draws (presence-person.js face / presence-things.js stepFace read rig.alive.mouth)
    rig.alive = a;
    a.mouthDraw = a.voiced || a.talkUntil > t || a.mouth.open > 0.01 ? open * Core.MOUTH_MAX : null;
    driveJaw(rig, a, open);
    // the stats the playtest reads: the mouth against the sound
    const S = a.stats;
    if (a.playing) { S.playingFrames++; if (open > 0.08) S.openWhilePlaying++; if (open > S.maxOpen) S.maxOpen = open; const o = open > 0.15; if (o && !S.wasOpen) S.syllables++; S.wasOpen = o; }
    else { S.wasOpen = false; if (a.talkUntil <= t) { S.silentFrames++; if (open > 0.05) S.openInSilence++; } }
    if (a.samples.length < 400 && (a.playing || open > 0.01)) a.samples.push([Math.round(t * 100) / 100, Math.round(open * 100) / 100, a.playing ? 1 : 0]);
    // the eyes follow the player within 6 m (the face system reads rig.lookTarget as an explicit point)
    const p = H.world && H.world.player;
    if (a.active && p) {
      a.lookOn = Core.lookIn(a.lookOn, a.dist);
      if (a.lookOn && !(rig.lookTarget && !a.ownedLook)) { rig.lookTarget = [p.x, p.y + 0.7, p.z]; a.ownedLook = true; }
    } else a.lookOn = false;
    if (!a.lookOn && a.ownedLook) { rig.lookTarget = null; a.ownedLook = false; }
  }

  /** The face system saw a lid value this frame: count the blinks (and when) for the playtest. */
  function blinkSeen(rig, lid) {
    const a = casts.get(rig);
    if (!a) return;
    const on = lid > 0.05;
    if (on && !a.inBlink) { a.blinks++; a.blinkAt.push(Math.round((rig.time || 0) * 100) / 100); if (a.blinkAt.length > 40) a.blinkAt.shift(); }
    a.inBlink = on;
  }

  const blendJoint = (j, r, w) => {
    if (!j || !r) return;
    j.rotation.x = lerp(j.rotation.x, r[0], w); j.rotation.y = lerp(j.rotation.y, r[1], w); j.rotation.z = lerp(j.rotation.z, r[2], w);
  };
  const addJoint = (j, r, w) => { if (j && r) { j.rotation.x += r[0] * w; j.rotation.y += r[1] * w; j.rotation.z += r[2] * w; } };
  const tmpM = B ? new B.Matrix() : null, tmpV = B ? new B.Vector3() : null;

  /** After the body's animation (the walk, the idle, the emote): the head, the arms. Sets only shL, shR and neck. */
  function after(rig, dt) {
    const a = casts.get(rig);
    if (!a || !a.active) return;
    const e = rig.e, t = rig.time || 0, p = H.world && H.world.player;
    const walking = (rig.speed || 0) > 0.5;
    // ---- look-at: the head turns to the player, set over what the animation did
    let aim = null;
    if (a.lookOn && p && rig.neck && rig.neck.parent && rig.neck.parent.getWorldMatrix && B) {
      try {
        rig.neck.parent.getWorldMatrix().invertToRef(tmpM);
        B.Vector3.TransformCoordinatesToRef(new B.Vector3(p.x, p.y + 0.7, p.z), tmpM, tmpV);
        aim = Core.headAim({ x: tmpV.x - rig.neck.position.x, y: tmpV.y - rig.neck.position.y, z: tmpV.z - rig.neck.position.z });
      } catch { aim = null; }
    }
    Core.lookStep(a.look, aim, dt);
    if (rig.neck && a.look.w > 0.001) { rig.neck.rotation.y = lerp(rig.neck.rotation.y, a.look.yaw, a.look.w); rig.neck.rotation.x = lerp(rig.neck.rotation.x, -a.look.pitch, a.look.w); }
    // ---- idle life: a glance about when nobody is near, breathing and a shift of weight always (not while walking)
    if (!walking) {
      const G = a.glance;
      if (!a.lookOn && t > G.next && G.until < t) { G.until = t + 1.2 + Math.random() * 0.8; G.yaw = (Math.random() * 2 - 1) * 0.6; G.next = G.until + 2 + Math.random() * 3; G.n++; }
      if (rig.neck && !a.lookOn && G.until > t) rig.neck.rotation.y += G.yaw * Math.min(1, (G.until - t) * 4) * Math.min(1, (t - (G.until - 1.2)) * 6) * (1 - a.look.w);
      if (!a.g) { const id = Core.idlePose(t, a.seed); addJoint(rig.shL, id.shL, 1); addJoint(rig.shR, id.shR, 1); addJoint(rig.neck, id.neck, 1); }
    }
    // ---- gestures: arms and head only; the feet stay where they are
    const g = a.g;
    if (g) {
      const k = t - g.t0, w = Core.envelope(k, g.dur);
      if (k > g.dur) { a.gestures.push({ name: g.name, ctx: g.ctx, seconds: Math.round(g.dur * 10) / 10, drift: Math.round(g.drift * 100) / 100, planted: g.drift < 0.15, at: Math.round(g.t0 * 10) / 10 }); if (a.gestures.length > 40) a.gestures.shift(); a.g = null; }
      else {
        g.drift = Math.max(g.drift, Math.hypot(e.x - g.x0, e.z - g.z0));
        const r = Core.GESTURES[g.name](k, g.dur);
        const gw = walking ? w * 0.6 : w;
        blendJoint(rig.shL, r.shL, gw); blendJoint(rig.shR, r.shR, gw);
        if (r.neck && rig.neck) { rig.neck.rotation.x = lerp(rig.neck.rotation.x, rig.neck.rotation.x + r.neck[0], gw); rig.neck.rotation.z = lerp(rig.neck.rotation.z, rig.neck.rotation.z + r.neck[2], gw); rig.neck.rotation.y += r.neck[1] * gw; }
        a.gw = w;
      }
    }
  }

  /** Makes a gesture: by name, or by a bark's context (the character's habits and the pool decide). Returns the name. */
  function gesture(who, ctxOrName, seconds) {
    const e = typeof who === 'string' ? (H.game && H.game.find && H.game.find(who)) : who;
    const rig = e && P.rigOf ? P.rigOf(e) : null;
    const a = rig && casts.get(rig);
    if (!a) return null;
    const name = Core.GESTURES[ctxOrName] ? ctxOrName : Core.gestureFor(a.id, ctxOrName, a.gn);
    a.gn++;
    a.g = { name, ctx: Core.GESTURES[ctxOrName] ? 'named' : ctxOrName, t0: rig.time || 0, dur: clamp(seconds || 2, 1, 6), x0: e.x, z0: e.z, drift: 0 };
    a.lastGestureAt = rig.time || 0;
    return name;
  }
  /** Someone's line was said (runtime.js showBubble): the mouth flaps while it lasts if no clip plays, and a gesture fits the words
   *  unless a bark named one in the last second. */
  function spoke(e, text, seconds) {
    const rig = P.rigOf ? P.rigOf(e) : null, a = rig && casts.get(rig);
    if (!a) return;
    const t = rig.time || 0;
    a.talkUntil = t + clamp(seconds || 2, 0.6, 8);
    if (t - a.lastGestureAt < 1) return;
    gesture(e, Core.gestureForText(text, a.gn), Core.gestureSeconds(text));
  }
  /** The analyser for a voice element (runtime.js media() asks): a small FFT, read for loudness only, never heard. */
  function analyserFor(ctx, src) {
    try { const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0; src.connect(an); return an; } catch { return null; }
  }

  // ---- what the playtest reads
  function snapshot(a) {
    const S = a.stats, rig = a.rig;
    const gaps = []; for (let i = 1; i < a.blinkAt.length; i++) gaps.push(Math.round((a.blinkAt[i] - a.blinkAt[i - 1]) * 10) / 10);
    return {
      id: a.id, active: a.active, rank: a.rank, dist: Math.round(a.dist * 10) / 10, speaking: a.playing || a.talkUntil > (rig.time || 0), voiced: a.voiced, playing: a.playing, level: Math.round(a.level * 1000) / 1000,
      jaw: Math.round(a.mouthOpen * 1000) / 1000, jawNodes: a.jawBones ? a.jawBones.nodes.length + a.jawBones.morphs.length : 0, syllables: S.syllables, maxOpen: Math.round(S.maxOpen * 100) / 100,
      playingFrames: S.playingFrames, openWhilePlaying: S.openWhilePlaying, silentFrames: S.silentFrames, openInSilence: S.openInSilence,
      blinks: a.blinks, blinkAt: a.blinkAt.slice(-12), blinkGaps: gaps.slice(-12), lastBlinkAt: a.blinkAt.length ? a.blinkAt[a.blinkAt.length - 1] : null, now: Math.round((rig.time || 0) * 100) / 100,
      look: { on: a.lookOn, w: Math.round(a.look.w * 100) / 100, yaw: Math.round(a.look.yaw * 100) / 100, pitch: Math.round(a.look.pitch * 100) / 100, eyes: Boolean(a.ownedLook) },
      gesture: a.g ? { name: a.g.name, ctx: a.g.ctx, w: Math.round((a.gw || 0) * 100) / 100, drift: Math.round(a.g.drift * 100) / 100 } : null,
      gestures: a.gestures.slice(), gestureCount: a.gestures.length + (a.g ? 1 : 0), glances: a.glance.n, samples: a.samples.slice(-60),
    };
  }
  window.__castFaces = {
    ids: () => [...byId.keys()],
    state: (id) => { const a = byId.get(String(id).toLowerCase()); return a ? snapshot(a) : null; },
    all: () => [...byId.values()].map(snapshot),
    active: () => [...byId.values()].filter((a) => a.active).map((a) => a.id),
    limit: () => (phone() ? NEAR_PHONE : 99),
  };
  P.alive = { before, after, blinkSeen, gesture, spoke, analyserFor, isCast, RANGE: Core.RANGE, state: window.__castFaces.state };
})();
