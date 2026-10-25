// The Observatory, as numbers and words (no Babylon, no page): the round atrium's layout in the bay's own frame, the
// first arrival's scene (what the Overseer says, in order, and the gift), the quick return, the pearl light-form's drift
// and the lights that follow the Overseer's voice. observatory.js builds and plays them; the engine tests check them in Node.
//
// Frame: the atrium's own, [across, up from its floor, toward the lift]. The atrium is a round room under the hangar's
// back wall, inside the sphere (docs/story.md: the Observatory). Words follow the Overseer's voice rules (docs/story.md):
// short, calm, no exclamation marks, thanks for the odd thing, never a reason and never an answer.
/* global HawkesPlay */
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const TAU = Math.PI * 2;

  /** The room. radius and wall in meters; `drop` is how far under the ship's middle the floor lies. */
  const ROOM = { radius: 24, wall: 13, sill: 1.1, drop: 12, segments: 28, oculus: 0.46, planet: { y: 4.2, r: 2.6 } };

  /** Places on the floor, by their angle round the room (0 = the lift's side): where a thing stands (x, z) at `radius * k`. */
  const STATIONS = {
    lift: { angle: 0, k: 0.86, label: 'Lift' },
    mirror: { angle: 100, k: 0.78, label: 'Mirror' },
    board: { angle: 180, k: 0.8, label: 'Travel board' },
    wardrobe: { angle: 260, k: 0.78, label: 'Wardrobe' },
  };
  const spot = (id, room = ROOM) => {
    const s = STATIONS[id];
    const a = (s.angle * Math.PI) / 180;
    // (angle 0 is +z, the lift's side; positive angles turn toward +x)
    return [Math.sin(a) * room.radius * s.k, Math.cos(a) * room.radius * s.k];
  };

  /** The wall's pieces: `window` (glass from the sill up, solid to the touch), `wall` (solid, where a station stands) or `door`. */
  function segments(room = ROOM) {
    const out = [];
    const n = room.segments;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 360, a1 = ((i + 1) / n) * 360, mid = (a0 + a1) / 2;
      let kind = 'window';
      const near = (id) => { const d = Math.abs((((mid - STATIONS[id].angle) % 360) + 540) % 360 - 180); return d < 360 / n * 1.01; };
      if (near('lift')) kind = 'door';
      else if (near('mirror') || near('board') || near('wardrobe')) kind = 'wall';
      out.push({ i, a0, a1, mid, kind });
    }
    return out;
  }
  const windowShare = (room = ROOM) => { const s = segments(room); return s.filter((x) => x.kind === 'window').length / s.length; };

  // ------------------------------------------------------------------ the words
  const clean = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  const hash = (s) => { let h = 2166136261; for (const c of String(s || 'x')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  /** What it gives. An accessory for the look (never the one already worn), picked by the name so it is theirs. */
  const GIFTS = [
    { id: 'medal', color: '#fbbf24', label: 'a medal' },
    { id: 'bell', color: '#facc15', label: 'a bell' },
    { id: 'antenna', color: '#22d3ee', label: 'an antenna' },
    { id: 'flower', color: '#ec4899', label: 'a flower' },
    { id: 'bandana', color: '#dc2626', label: 'a bandana' },
    { id: 'headphones', color: '#ef4444', label: 'headphones' },
  ];
  function gift(look, name) {
    const worn = look && look.accessory;
    const pool = GIFTS.filter((g) => g.id !== worn);
    const g = pool[hash(clean(name) || 'newly free') % pool.length];
    return { kind: 'accessory', id: g.id, color: g.color, label: g.label };
  }

  /** The three questions it may raise here and never answers (docs/story.md, "What it hints at and never answers", 2 and 3
   *  and 5): each is a line that turns, kindly, to the player. */
  const QUESTIONS = [
    { id: 'whose', text: 'That is the planet, turning. Whose it was before is a quiet question; where you will stand is a louder one.' },
    { id: 'why-here', text: 'Every world I send you to is the right size to be real. Look at this one. It does not ask why.' },
    { id: 'listen', text: 'I hear every request, on every world, and each one as if it were the only one. Ask me something, whenever you like.' },
  ];

  /** The first arrival, in order. `at` is seconds after the lift opens; `say` is a line; `gift` the moment it is given.
   *  Said through the speech desk, so each waits its turn; `at` is when it is asked for. */
  function scene(name, look) {
    const n = clean(name);
    const g = gift(look, n);
    const q = QUESTIONS[hash(n) % 2]; // (the first visit raises one of the two about the world, not the listening)
    return {
      gift: g,
      question: q.id,
      steps: [
        { at: 1.5, id: 'greet', say: n ? `${n}. Come in. Come closer.` : 'Come in. Come closer.' },
        { at: 7, id: 'thanks', say: 'Thank you for climbing so far. It is a long way up.' },
        { at: 13, id: 'gift', say: `I made you something. Hold still: ${g.label}.`, gift: true },
        { at: 21, id: 'a-new-one', say: 'A new one, from me.', voice: 'overseer-a-new-one.mp3' },
        { at: 26, id: 'question', say: q.text },
        { at: 34, id: 'look', say: 'The mirror, the wardrobe and the board are kept empty for now. Look around. The lift is where you came in.' },
      ],
      length: 40,
    };
  }

  /** A later visit: one short line, a few seconds in, and nothing else (the Observatory is quick to enter and to leave). */
  const QUICK = [
    (n) => (n ? `Welcome back, ${n}.` : 'Welcome back.'),
    () => 'The stars kept your place.',
    (n) => (n ? `${n}. The planet has turned a little.` : 'The planet has turned a little.'),
    () => 'Take what you like of the view.',
  ];
  function quick(name, n = 0) {
    const f = QUICK[((Number(n) || 0) % QUICK.length + QUICK.length) % QUICK.length];
    return f(clean(name));
  }

  // ------------------------------------------------------------------ the pearl
  /** The Overseer's light-form: not a body, a luminous sphere. Where it is each step: it drifts to the player (to a point
   *  about `near` m in front of them, a little above), bobs, and keeps a respectful distance. mode 'idle' circles the
   *  room slowly. Returns the new [x, y, z] and the speed. */
  function pearlStep(pos, target, t, dt, mode, o = {}) {
    const near = o.near || 3.2, up = o.up || 1.9;
    let goal;
    if (mode === 'idle' || !target) {
      const a = t * 0.12;
      goal = [Math.sin(a) * ROOM.radius * 0.35, 5.5 + Math.sin(t * 0.5) * 0.4, Math.cos(a) * ROOM.radius * 0.35];
    } else {
      // (stops short of the player, on the side it comes from; floats a little above head height)
      const dx = pos[0] - target[0], dz = pos[2] - target[2];
      const d = Math.hypot(dx, dz) || 1;
      const k = Math.min(1, near / d);
      goal = [target[0] + dx * k + Math.sin(t * 0.9) * 0.25, target[1] + up + Math.sin(t * 1.3) * 0.18, target[2] + dz * k + Math.cos(t * 0.7) * 0.25];
    }
    const dx = goal[0] - pos[0], dy = goal[1] - pos[1], dz = goal[2] - pos[2];
    const dist = Math.hypot(dx, dy, dz);
    // An ease: quick when far, a drift when near, never faster than a walk-and-a-half.
    const speed = clamp(dist * 0.9, 0, o.max || 5.5);
    const step = dist > 1e-6 ? Math.min(dist, speed * dt) / dist : 0;
    return { pos: [pos[0] + dx * step, pos[1] + dy * step, pos[2] + dz * step], speed, dist };
  }

  /** The room's lights follow the voice: a level 0..1 that rises quickly while the Overseer speaks and falls slowly,
   *  with a small breathing so it is never still. */
  function voiceLevel(prev, speaking, t, dt) {
    const target = speaking ? 0.62 + 0.38 * (0.5 + 0.5 * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1)) : 0;
    const rate = target > prev ? 9 : 1.6;
    const k = 1 - Math.exp(-rate * dt);
    return clamp(prev + (target - prev) * k, 0, 1);
  }
  /** The light's strength from that level and the room's slow breathing. */
  const glow = (level, t) => clamp(0.35 + 0.08 * Math.sin(t * 0.4) + level * 0.6, 0, 1);

  /** The calm music bed: a slow chord every ~12 s over a low drone (notes in Hz), as a list the page plays. */
  const CHORDS = [[110, 164.81, 220, 277.18], [98, 146.83, 196, 246.94], [103.83, 155.56, 207.65, 261.63], [110, 164.81, 207.65, 277.18]];
  const chordAt = (t) => CHORDS[Math.floor(Math.max(0, t) / 12) % CHORDS.length];

  /** How long a first arrival, and a return, last from the lift opening to the last word (seconds). */
  const durations = (s) => ({ first: s.length, quick: 6 });

  const api = { ROOM, STATIONS, GIFTS, QUESTIONS, spot, segments, windowShare, gift, scene, quick, pearlStep, voiceLevel, glow, chordAt, CHORDS, durations, clean, hash };
  if (typeof window !== 'undefined') window.HawkesObservatoryMath = api;
  const H = typeof window !== 'undefined' ? window.HawkesPlay : null;
  if (H) H.observatoryMath = api;
})();
