// Kits (H.kits): ready-made bits of play, dropped in from the spawn wheel (🎲 Play kits) or by the Overseer, made only of
// things and their abilities (abilities.js), so they need no script and work at once: playing, building, on the island,
// online. Each is a few settings and a function that lays its things out round a spot, facing the player.
//   H.kits.list()                         [{ id, name, icon, about, settings }]
//   H.kits.build(id, at, yaw, settings)   the things' specs (no ids), placed and turned
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const r2 = (n) => Math.round(n * 100) / 100;
  const box = (name, size, at, color, extra = {}) => ({ type: 'box', name, shape: { size }, material: { color }, physics: 'static', transform: { position: at }, ...extra });
  const glowing = (color) => ({ use: 'glow', color });
  const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
  const colorOf = (t) => ({ red: '#ef4444', blue: '#3b82f6' })[t] || '#e5e7eb';
  /** A point round you (`dy` meters up) in the world file's numbers (a round planet keeps its own), rounded. */
  function sceneAt(at, dy = 0) {
    const p = at ? [at[0], at[1] + dy, at[2]] : [0, dy, 0];
    const f = H.planet && H.planet.frame;
    const q = at && f && f.on && f.toScene ? f.toScene({ position: p, rotation: 0 }).position : p;
    return q.map((v) => Math.round(v));
  }
  const PARTY = ['#f43f5e', '#f59e0b', '#22c55e', '#06b6d4', '#a855f7', '#ec4899'];

  const KITS = [
    {
      id: 'obby', name: 'Obstacle course', icon: '🧗', about: 'Platforms to jump across, a moving one, a spinning bar, checkpoints and a finish.',
      settings: { length: 10 },
      things(o) {
        const out = [], n = Math.max(4, Math.min(30, o.length | 0));
        out.push(box('Start pad', [4, 0.4, 4], [0, 0.2, 0], '#22c55e', { behaviors: [{ use: 'checkpoint' }] }));
        let z = 0, y = 0.2;
        for (let i = 0; i < n; i++) {
          z += 3.2 + (i % 3) * 0.5; y += i % 4 === 3 ? 0 : 0.7;
          const x = Math.sin(i * 1.3) * 2.2;
          const kind = i % 5;
          if (kind === 2) out.push(box('Moving platform', [2.2, 0.35, 2.2], [x, y, z], '#38bdf8', { physics: 'kinematic', behaviors: [{ use: 'patrol', axis: 'x', range: 2.5, speed: 1.1 }] }));
          else if (kind === 4) {
            out.push(box('Platform', [3, 0.35, 3], [x, y, z], '#f59e0b'));
            out.push(box('Spinning bar', [5, 0.3, 0.3], [x, y + 0.6, z], '#ef4444', { physics: 'kinematic', behaviors: [{ use: 'spin', speed: 120 }, { use: 'hurts', damage: 10 }] }));
          } else out.push(box(i === Math.floor(n / 2) ? 'Checkpoint' : 'Platform', [2.4, 0.35, 2.4], [x, y, z], i === Math.floor(n / 2) ? '#22c55e' : '#a3a3a3', i === Math.floor(n / 2) ? { behaviors: [{ use: 'checkpoint' }] } : {}));
        }
        out.push(box('Finish', [4, 0.4, 4], [0, y + 0.7, z + 4], '#facc15', { behaviors: [{ use: 'goal' }, glowing('#facc15')] }));
        out.push({ type: 'box', name: 'Fall reset', shape: { size: [Math.max(14, n * 1.2), 0.2, z + 12] }, material: { color: '#1e3a8a' }, physics: 'none', ghost: true, transform: { position: [0, -6, z / 2] }, behaviors: [{ use: 'hurts', damage: 1000 }] });
        return out;
      },
    },
    {
      id: 'coins', name: 'Coin rush', icon: '🪙', about: 'Coins in a ring around you: run, grab, beat your friends (they come back).',
      settings: { coins: 20, radius: 14 },
      things(o) {
        const out = [], n = Math.max(3, Math.min(80, o.coins | 0)), R = Math.max(4, Math.min(60, o.radius));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2, r = R * (0.45 + 0.55 * ((i * 7) % 5) / 4);
          out.push({ type: 'cylinder', name: 'Coin', shape: { radius: 0.45, height: 0.1 }, material: { color: '#f4c430', emissive: '#7a5a00' }, physics: 'none', transform: { position: [r2(Math.cos(a) * r), 1, r2(Math.sin(a) * r)], rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible', points: 1, respawn: 20 }, { use: 'spin', speed: 160, axis: 'z' }, { use: 'bob', height: 0.25, speed: 1.2 }] });
        }
        return out;
      },
    },
    {
      id: 'hill', name: 'King of the hill', icon: '👑', about: 'A golden hill with ramps: stand on top to score; the top three show for everyone.',
      settings: { size: 8 },
      things(o) {
        const s = Math.max(4, Math.min(30, o.size));
        return [
          { type: 'cylinder', name: 'The hill', shape: { radius: s / 2, height: 1.6 }, material: { color: '#eab308' }, physics: 'static', transform: { position: [0, 0.8, 0] }, behaviors: [{ use: 'hill', points: 1 }, glowing('#facc15')] },
          ...[0, 90, 180, 270].map((deg) => { const a = deg * Math.PI / 180; return box('Ramp', [2.4, 0.3, 4], [r2(Math.sin(a) * (s / 2 + 1.6)), 0.75, r2(Math.cos(a) * (s / 2 + 1.6))], '#a16207', { transform: { position: [r2(Math.sin(a) * (s / 2 + 1.6)), 0.75, r2(Math.cos(a) * (s / 2 + 1.6))], rotation: [-20, deg, 0] } }); }),
        ];
      },
    },
    {
      id: 'puzzle', name: 'Lever and gate', icon: '🚪', about: 'A gate that opens with a lever, a pressure plate that raises a hidden bridge: wire your own with signals.',
      settings: { signal: 'gate' },
      things(o) {
        const g = String(o.signal || 'gate');
        return [
          box('Gate', [4, 3.2, 0.4], [0, 1.6, 6], '#57534e', { behaviors: [{ use: 'opens', signal: g, height: 3.4, speed: 2.5 }] }),
          box('Wall', [4, 3.2, 0.4], [-4, 1.6, 6], '#78716c'), box('Wall', [4, 3.2, 0.4], [4, 1.6, 6], '#78716c'),
          { ...box('Lever', [0.25, 1.1, 0.25], [2.5, 0.55, 3], '#dc2626'), behaviors: [{ use: 'lever', signal: g }] },
          box('Pressure plate', [1.6, 0.12, 1.6], [-2.5, 0.06, 3], '#64748b', { behaviors: [{ use: 'plate', signal: `${g}-bridge` }] }),
          box('Hidden bridge', [2.2, 0.3, 8], [0, 0.15, 12], '#a78bfa', { behaviors: [{ use: 'shows', signal: `${g}-bridge` }, glowing('#a78bfa')] }),
        ];
      },
    },
    {
      id: 'teleporters', name: 'Teleporter pair', icon: '🌀', about: 'Two pads: step on one, come out of the other.',
      settings: { apart: 30 },
      things(o) {
        const d = Math.max(4, Math.min(400, o.apart));
        return [
          { type: 'cylinder', name: 'Teleporter A', shape: { radius: 1.2, height: 0.2 }, material: { color: '#8b5cf6' }, physics: 'static', transform: { position: [0, 0.1, 0] }, behaviors: [{ use: 'teleport', to: 'Teleporter B' }, glowing('#8b5cf6'), { use: 'spin', speed: 40 }] },
          { type: 'cylinder', name: 'Teleporter B', shape: { radius: 1.2, height: 0.2 }, material: { color: '#06b6d4' }, physics: 'static', transform: { position: [0, 0.1, d] }, behaviors: [{ use: 'teleport', to: 'Teleporter A' }, glowing('#06b6d4'), { use: 'spin', speed: -40 }] },
        ];
      },
    },
    {
      id: 'cannon', name: 'Human cannon', icon: '💥', about: 'A cannon that fires you at a floating ring of coins.',
      settings: { power: 34 },
      things(o) {
        return [
          { type: 'cylinder', name: 'Cannon', shape: { radius: 0.7, height: 2.4 }, material: { color: '#1f2937' }, physics: 'static', transform: { position: [0, 1, 0], rotation: [-50, 0, 0] }, behaviors: [{ use: 'cannon', power: o.power, angle: 40 }] },
          { type: 'torus', name: 'Target ring', shape: { radius: 2.5, thickness: 0.4 }, material: { color: '#f43f5e' }, physics: 'none', transform: { position: [0, 14, 34], rotation: [90, 0, 0] }, behaviors: [glowing('#f43f5e')] },
          { type: 'cylinder', name: 'Coin', shape: { radius: 0.45, height: 0.1 }, material: { color: '#f4c430', emissive: '#7a5a00' }, physics: 'none', transform: { position: [0, 14, 34], rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible', points: 5, respawn: 15 }, { use: 'spin', speed: 200, axis: 'z' }] },
        ];
      },
    },
    {
      id: 'moon', name: 'Low-gravity bubble', icon: '🌙', about: 'A bubble where you jump like on the moon.',
      settings: { size: 16, gravity: 0.17 },
      things(o) {
        const s = Math.max(4, Math.min(80, o.size));
        return [{ type: 'sphere', name: 'Moon bubble', shape: { radius: s / 2 }, material: { color: '#93c5fd', opacity: 0.18 }, physics: 'none', ghost: true, transform: { position: [0, s / 2 - 0.5, 0] }, behaviors: [{ use: 'gravity', factor: o.gravity }] }];
      },
    },
    {
      id: 'party', name: 'Dance floor', icon: '🪩', about: 'A glowing dance floor, a spinning disco ball and speed pads to slide across it.',
      settings: { size: 5 },
      things(o) {
        const n = Math.max(3, Math.min(9, o.size | 0)), out = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(box('Dance tile', [1.9, 0.12, 1.9], [r2((i - (n - 1) / 2) * 2), 0.06, r2((j - (n - 1) / 2) * 2)], PARTY[(i + j * 2) % PARTY.length], { behaviors: [glowing(PARTY[(i * 3 + j) % PARTY.length])] }));
        out.push({ type: 'sphere', name: 'Disco ball', shape: { radius: 0.7 }, material: { color: '#e5e7eb', emissive: '#555555' }, physics: 'none', transform: { position: [0, 6, 0] }, behaviors: [{ use: 'spin', speed: 60 }, { use: 'bob', height: 0.2, speed: 0.6 }] });
        out.push(box('Speed pad', [2, 0.1, 2], [r2(-(n + 1)), 0.05, 0], '#34d399', { transform: { position: [r2(-(n + 1)), 0.05, 0], rotation: [0, 90, 0] }, behaviors: [{ use: 'boost', power: 18 }] }));
        return out;
      },
    },
    {
      id: 'rides', name: 'Silly rides', icon: '🛋', about: 'A couch you can drive, a flying carpet and a crate you can pick up and throw.',
      settings: {},
      things() {
        return [
          { type: 'sofa', name: 'Turbo couch', physics: 'dynamic', transform: { position: [-3, 0.5, 0] }, behaviors: [{ use: 'drivable', speed: 16, turn: 110 }] },
          box('Flying carpet', [1.6, 0.08, 2.6], [1, 0.6, 0], '#b91c1c', { physics: 'kinematic', behaviors: [{ use: 'flyable', speed: 14, lift: 6, height: 0.2 }] }),
          box('Crate', [0.9, 0.9, 0.9], [4, 0.45, 0], '#a16207', { physics: 'dynamic', behaviors: [{ use: 'holdable', throw: 16 }] }),
        ];
      },
    },
    {
      id: 'football', name: 'Football match', icon: '⚽', about: 'A pitch, two goals, a ball, red against blue: AI players join each side; first to five.',
      settings: { length: 40, bots: 2 },
      config: () => ({ match: { teams: ['red', 'blue'], time: 300, score: 5, objective: 'Kick the ball into the other team’s goal' } }),
      things(o) {
        const L = Math.max(20, Math.min(120, o.length)), Wd = L * 0.6, out = [];
        out.push(box('Pitch', [Wd, 0.1, L], [0, 0.05, L / 2], '#15803d'));
        out.push(box('Halfway line', [Wd, 0.11, 0.2], [0, 0.06, L / 2], '#f8fafc'));
        for (const [z, team, scorer] of [[0, 'red', 'blue'], [L, 'blue', 'red']]) {
          out.push({ type: 'spawn', name: `${team} start`, data: { role: team }, transform: { position: [0, 0.2, z === 0 ? 6 : L - 6] } });
          out.push(box(`${cap(scorer)} scores here`, [7, 2.4, 1.6], [0, 1.2, z === 0 ? -0.8 : L + 0.8], colorOf(team), { material: { color: colorOf(team), opacity: 0.35 }, physics: 'none', behaviors: [{ use: 'score-zone', team: scorer, points: 1 }] }));
          for (const x of [-3.7, 3.7]) out.push(box('Goal post', [0.3, 2.6, 0.3], [x, 1.3, z], '#f8fafc'));
          out.push(box('Crossbar', [7.7, 0.3, 0.3], [0, 2.6, z], '#f8fafc'));
        }
        for (const x of [-Wd / 2 - 0.5, Wd / 2 + 0.5]) out.push(box('Barrier', [1, 1.2, L + 4], [x, 0.6, L / 2], '#e2e8f0'));
        out.push({ type: 'sphere', name: 'Ball', shape: { radius: 0.4 }, material: { color: '#f8fafc' }, physics: 'dynamic', transform: { position: [0, 1, L / 2] }, behaviors: [{ use: 'ball', kick: 20 }] });
        for (let i = 0; i < Math.max(0, Math.min(5, o.bots | 0)); i++) for (const [team, z] of [['red', L / 2 - 6], ['blue', L / 2 + 6]]) out.push({ type: 'capsule', name: `${cap(team)} player ${i + 1}`, shape: { radius: 0.35, height: 1.7 }, material: { color: colorOf(team) }, physics: 'kinematic', transform: { position: [(i - 0.5) * 6, 0.95, z] }, behaviors: [{ use: 'teammate', team, speed: 5 }] });
        return out;
      },
    },
    {
      id: 'basketball', name: 'Basketball court', icon: '🏀', about: 'A court, two hoops (2 points each) and a ball you pick up and throw.',
      settings: {},
      config: () => ({ match: { teams: ['red', 'blue'], time: 240, objective: 'E picks the ball up, click throws it at the hoop' } }),
      things() {
        const out = [box('Court', [15, 0.1, 28], [0, 0.05, 14], '#c2410c')];
        for (const [z, scorer, team] of [[1, 'blue', 'red'], [27, 'red', 'blue']]) {
          out.push(box('Backboard', [1.8, 1.1, 0.1], [0, 3.6, z === 1 ? 0.6 : 27.4], '#f8fafc'));
          out.push({ type: 'torus', name: 'Hoop', shape: { radius: 0.45, thickness: 0.05 }, material: { color: '#f97316' }, physics: 'none', transform: { position: [0, 3.05, z === 1 ? 1.2 : 26.8] } });
          out.push({ type: 'cylinder', name: `${cap(scorer)} scores here`, shape: { radius: 0.38, height: 0.25 }, material: { color: colorOf(team), opacity: 0.25 }, physics: 'none', transform: { position: [0, 2.9, z === 1 ? 1.2 : 26.8] }, behaviors: [{ use: 'score-zone', team: scorer, points: 2 }] });
          out.push({ type: 'spawn', name: `${team} start`, data: { role: team }, transform: { position: [0, 0.2, z === 1 ? 5 : 23] } });
        }
        out.push({ type: 'sphere', name: 'Basketball', shape: { radius: 0.24 }, material: { color: '#ea580c' }, physics: 'dynamic', transform: { position: [0, 1, 14] }, behaviors: [{ use: 'ball', kick: 10, lift: 6 }, { use: 'holdable', throw: 11 }, { use: 'bouncy', bounce: 0.75 }] });
        return out;
      },
    },
    {
      id: 'tennis', name: 'Tennis court', icon: '🎾', about: 'A court and a net: hit the bouncy ball (E or click) over; it landing past your end is their point.',
      settings: {},
      config: () => ({ match: { teams: ['red', 'blue'], time: 300, score: 7, objective: 'Hit the ball over the net: E or click' } }),
      things() {
        return [
          box('Court', [11, 0.1, 24], [0, 0.05, 12], '#1d4ed8'),
          box('Net', [11, 1, 0.08], [0, 0.5, 12], '#f8fafc'),
          box('Red out', [14, 0.12, 4], [0, 0.07, -2], '#ef4444', { material: { color: '#ef4444', opacity: 0.25 }, physics: 'none', behaviors: [{ use: 'score-zone', team: 'blue' }] }),
          box('Blue out', [14, 0.12, 4], [0, 0.07, 26], '#3b82f6', { material: { color: '#3b82f6', opacity: 0.25 }, physics: 'none', behaviors: [{ use: 'score-zone', team: 'red' }] }),
          { type: 'spawn', name: 'red start', data: { role: 'red' }, transform: { position: [0, 0.2, 3] } },
          { type: 'spawn', name: 'blue start', data: { role: 'blue' }, transform: { position: [0, 0.2, 21] } },
          { type: 'sphere', name: 'Tennis ball', shape: { radius: 0.18 }, material: { color: '#d9f99d' }, physics: 'dynamic', transform: { position: [0, 1.5, 6] }, behaviors: [{ use: 'ball', kick: 15, lift: 6 }, { use: 'bouncy', bounce: 0.85 }] },
        ];
      },
    },
    {
      id: 'ctf', name: 'Capture the flag', icon: '🚩', about: 'Two bases, two flags: carry theirs home while yours is safe.',
      settings: { apart: 60 },
      config: () => ({ match: { teams: ['red', 'blue'], time: 600, score: 3, objective: 'Bring their flag to your base' } }),
      things(o) {
        const d = Math.max(20, Math.min(300, o.apart)), out = [];
        for (const [z, team] of [[0, 'red'], [d, 'blue']]) {
          out.push(box(`${cap(team)} base`, [8, 0.3, 8], [0, 0.15, z], colorOf(team), { behaviors: [{ use: 'score-zone', team, takes: 'flag' }, glowing(colorOf(team))] }));
          out.push(box(`${cap(team)} flag`, [0.25, 2.2, 0.25], [0, 1.4, z], colorOf(team), { physics: 'dynamic', behaviors: [{ use: 'flag', team }] }));
          out.push({ type: 'spawn', name: `${team} start`, data: { role: team }, transform: { position: [5, 0.2, z] } });
        }
        return out;
      },
    },
    {
      id: 'deathmatch', name: 'Team deathmatch', icon: '🔫', about: 'An arena with cover; red against blue with blasters; a kill is a point, first to ten.',
      settings: { size: 40 },
      config: () => ({ match: { teams: ['red', 'blue'], time: 300, score: 10, kills: true, objective: 'Tag the other team' }, player: { weapon: 'blaster' } }),
      things(o) {
        const s = Math.max(20, Math.min(120, o.size)), out = [];
        for (const [x, z, w, d] of [[0, -s / 2, s, 1], [0, s / 2, s, 1], [-s / 2, 0, 1, s], [s / 2, 0, 1, s]]) out.push(box('Arena wall', [w, 3, d], [x, 1.5, z + s / 2], '#334155'));
        for (let i = 0; i < 10; i++) { const a = i * 2.4, r = s * 0.28, at = [r2(Math.cos(a) * r), 0.8, r2(s / 2 + Math.sin(a) * r)]; out.push(box('Cover', [2.4, 1.6, 0.6], at, '#64748b', { transform: { position: at, rotation: [0, i * 37, 0] } })); }
        out.push({ type: 'spawn', name: 'red start', data: { role: 'red' }, transform: { position: [0, 0.2, 3] } });
        out.push({ type: 'spawn', name: 'blue start', data: { role: 'blue' }, transform: { position: [0, 0.2, s - 3] } });
        return out;
      },
    },
    {
      id: 'tag', name: 'Tag', icon: '🏃', about: 'Someone is IT: touch someone to pass it on. Not being it scores.',
      settings: {},
      config: () => ({ match: { mode: 'tag', teams: false, time: 180, objective: 'Don’t be IT when the clock runs out' } }),
      things() { return [box('Tag zone', [24, 0.08, 24], [0, 0.04, 10], '#f43f5e', { material: { color: '#f43f5e', opacity: 0.25 }, physics: 'none' }), ...[0, 1, 2, 3].map((i) => box('Obstacle', [2, 1.4, 2], [i % 2 ? 5 : -5, 0.7, 4 + i * 4], '#a3a3a3'))]; },
    },
    {
      id: 'hide', name: 'Hide and seek', icon: '🙈', about: 'Seekers count in the dark while hiders hide; found hiders join the seekers.',
      settings: {},
      config: () => ({ match: { mode: 'hide', time: 240, start: 20, objective: 'Seekers: find everyone. Hiders: stay hidden' } }),
      things() { return [0, 1, 2, 3, 4, 5].map((i) => { const at = [r2(Math.cos(i) * 10), 1.2, r2(10 + Math.sin(i) * 10)]; return box('Hiding wall', [3, 2.4, 0.4], at, '#78716c', { transform: { position: at, rotation: [0, i * 50, 0] } }); }); },
    },
    {
      id: 'survival', name: 'Survival waves', icon: '🧟', about: 'A walled yard with towers; zombies come in waves every minute; three lives each, hold out.',
      settings: {},
      config: () => ({ match: { teams: false, time: 0, lives: 3, kills: true, objective: 'Survive the waves' }, player: { weapon: 'rifle' }, events: { rules: [{ id: 'waves', when: { every: 60 }, do: [{ 'zombie-night': { seconds: 45, count: 8, waves: 3, title: 'Here they come', sub: 'Hold the yard' } }] }, { id: 'first-wave', when: { after: 10 }, do: [{ 'zombie-night': { seconds: 45, count: 6, waves: 2, title: 'Here they come', sub: 'Hold the yard' } }] }] } }),
      things() {
        const out = [];
        for (const [x, z, w, d] of [[0, 0, 30, 1], [0, 30, 30, 1], [-15, 15, 1, 30], [15, 15, 1, 30]]) out.push(box('Yard wall', [w, 2, d], [x, 1, z], '#57534e'));
        for (const [x, z] of [[-12, 3], [12, 3], [-12, 27], [12, 27]]) { out.push(box('Tower', [3, 4, 3], [x, 2, z], '#78716c')); out.push(box('Tower top', [3.6, 0.3, 3.6], [x, 4.15, z], '#a8a29e')); }
        out.push(box('Supply crate', [1, 1, 1], [0, 0.5, 15], '#a16207', { physics: 'dynamic', behaviors: [{ use: 'holdable' }] }));
        return out;
      },
    },
    {
      id: 'rts', name: 'Base battle', icon: '🏰', about: 'Command a base: workers gather crystal, train soldiers and tanks; a red base trains and attacks in waves.',
      settings: { waves: 60 },
      config: (o) => ({ rts: { team: 'blue', resources: 250, teams: { red: { ai: true, resources: 250, wave: 4, grow: 2, waves: { every: Number(o.waves) || 60, first: 90, count: 3, grow: 2, unit: 'soldier' } } } }, player: { view: 'rts' } }),
      things() {
        const out = [];
        const base = (team, z) => box(`${cap(team)} base`, [6, 4, 6], [0, 2, z], colorOf(team), { behaviors: [{ use: 'building', team, makes: team === 'blue' ? 'worker,soldier,ranged,tank' : 'worker,soldier,ranged', hp: 1500 }] });
        const crystal = (x, z) => ({ type: 'cone', name: 'Crystal', shape: { radius: 1, height: 2.6 }, material: { color: '#67e8f9', emissive: '#0e7490' }, physics: 'static', transform: { position: [x, 1.3, z] }, behaviors: [{ use: 'resource', amount: 800 }] });
        const unit = (team, role, x, z) => ({ type: 'capsule', name: `${cap(team)} ${role}`, shape: { radius: 0.32, height: 1.6 }, material: { color: colorOf(team) }, physics: 'dynamic', transform: { position: [x, 0.9, z] }, behaviors: [{ use: 'unit', team, role, ...(role === 'worker' ? { hp: 60, damage: 3, range: 1.6, gather: 10, speed: 4.5 } : { hp: 120, damage: 10, range: 1.8, speed: 4 }) }] });
        out.push(base('blue', 8), base('red', 80));
        for (const [x, z] of [[-10, 14], [10, 14], [-10, 74], [10, 74]]) out.push(crystal(x, z));
        out.push(unit('blue', 'worker', -3, 13), unit('blue', 'worker', 3, 13), unit('blue', 'soldier', -2, 16), unit('blue', 'soldier', 2, 16));
        out.push(unit('red', 'worker', -3, 75), unit('red', 'worker', 3, 75));
        return out;
      },
    },
    {
      id: 'space-rts', name: 'Space battle', icon: '🚀', about: 'Command a space station: mining ships gather from asteroids, fighters and frigates fight; waves come from the red station.',
      settings: { waves: 45 },
      config: (o) => ({ rts: { team: 'blue', resources: 300, teams: { red: { ai: true, resources: 300, wave: 4, grow: 2, waves: { every: Number(o.waves) || 45, first: 60, count: 3, grow: 2, unit: 'fighter', title: 'Wave' } } } }, player: { view: 'rts' } }),
      things() {
        const out = [];
        const station = (team, z) => ({ type: 'cylinder', name: `${cap(team)} station`, shape: { radius: 4, height: 2 }, material: { color: colorOf(team), emissive: team === 'blue' ? '#1e3a8a' : '#7f1d1d' }, physics: 'static', transform: { position: [0, 8, z] }, behaviors: [{ use: 'building', team, makes: team === 'blue' ? 'mining-ship,fighter' : 'mining-ship,fighter,frigate', hp: 2000 }, { use: 'spin', speed: 8 }] });
        const rock = (x, z, r) => ({ type: 'sphere', name: 'Asteroid', shape: { radius: r }, material: { color: '#78716c' }, physics: 'static', transform: { position: [x, 6, z] }, behaviors: [{ use: 'resource', amount: 900 }] });
        const ship = (team, role, x, z) => ({ type: role === 'fighter' ? 'cone' : 'sphere', name: `${cap(team)} ${role}`, shape: role === 'fighter' ? { radius: 0.6, height: 1.7 } : { radius: 0.5 }, material: { color: colorOf(team) }, physics: 'kinematic', transform: { position: [x, role === 'fighter' ? 9 : 7, z], rotation: role === 'fighter' ? [90, 0, 0] : [0, 0, 0] }, behaviors: [{ use: 'unit', team, role, ...(role === 'fighter' ? { hp: 90, speed: 9, damage: 8, range: 12, rate: 0.6, sight: 22, fly: 0.01 } : { hp: 70, speed: 6, damage: 0, range: 0, gather: 12, fly: 0.01 }) }] });
        out.push(station('blue', 6), station('red', 90));
        for (const [x, z, r] of [[-12, 16, 2.2], [13, 18, 1.8], [-13, 80, 2], [12, 82, 2.4], [0, 48, 3]]) out.push(rock(x, z, r));
        out.push(ship('blue', 'mining-ship', -4, 14), ship('blue', 'mining-ship', 4, 14), ship('blue', 'fighter', -3, 20), ship('blue', 'fighter', 3, 20));
        out.push(ship('red', 'mining-ship', -4, 82), ship('red', 'mining-ship', 4, 82));
        return out;
      },
    },
    {
      id: 'planets', name: 'Planet hop', icon: '🪐', about: 'Three more planets in the sky (lava, ice, a small moon), a warp gate and a spaceship to fly to them.',
      settings: {},
      config: () => ({ planets: { travel: 'space', list: [
        { id: 'ember', name: 'Ember', about: 'lava and low gravity', biome: 'lava', gravity: 0.6, time: { hour: 21 } },
        { id: 'frost', name: 'Frost', about: 'snow and ice', biome: 'ice', gravity: 0.9 },
        { id: 'moon', name: 'The Moon', about: 'tiny, you nearly float', biome: 'ice', gravity: 0.17 },
      ] } }),
      things() {
        return [
          { type: 'torus', name: 'Warp gate', shape: { radius: 2, thickness: 0.35 }, material: { color: '#a78bfa', emissive: '#4c1d95' }, physics: 'none', transform: { position: [0, 2.2, 6], rotation: [90, 0, 0] }, behaviors: [{ use: 'spin', speed: 30 }, glowing('#a78bfa')] },
          { type: 'box', name: 'Warp field', shape: { size: [3, 3.6, 0.4] }, material: { color: '#c4b5fd', opacity: 0.25 }, physics: 'none', ghost: true, transform: { position: [0, 2.2, 6] }, behaviors: [{ use: 'warp-gate' }] },
          { type: 'spaceship', name: 'Spaceship', transform: { position: [8, 1.5, 4] } },
        ];
      },
    },
    {
      id: 'mine', name: 'Block mine', icon: '⛏', about: 'A world of blocks grows round you: caves, ores, trees. You hold a pickaxe: mine, build, craft.',
      settings: { world: 'caves', size: 48 },
      // (The blocks' bottom middle a little under where the kit goes: the ground grows to about 0.42 of the height.)
      config: (o, at) => ({ blocks: { world: o.world, size: [o.size, 32, o.size], seed: Math.floor(Math.random() * 100000), at: sceneAt(at, -14) }, player: { tool: 'pickaxe' } }),
      things() { return [{ type: 'box', name: 'Miner lamp', shape: { size: [0.3, 0.3, 0.3] }, material: { color: '#ffd66a' }, physics: 'none', transform: { position: [1.5, 2.2, 1.5] }, behaviors: [glowing('#ffd66a')] }]; },
    },
  ];

  /** The specs, laid out round `at` and turned to `yaw` (radians; the player's facing: forward is +z in a kit). */
  function build(id, at, yaw = 0, settings = {}) {
    const kit = KITS.find((k) => k.id === id);
    if (!kit) return [];
    const o = { ...kit.settings, ...settings };
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return kit.things(o).map((spec) => {
      const t = spec.transform || {};
      const p = t.position || [0, 0, 0];
      const x = p[0] * c + p[2] * s, z = -p[0] * s + p[2] * c;
      const rot = (t.rotation || [0, 0, 0]).slice();
      rot[1] = r2((rot[1] || 0) + yaw * 180 / Math.PI);
      return { ...spec, transform: { ...t, position: [r2(at[0] + x), r2(at[1] + p[1]), r2(at[2] + z)], rotation: rot } };
    });
  }
  H.kits = {
    list: () => KITS.map(({ id, name, icon, about, settings, config }) => ({ id, name, icon, about, settings: { ...settings }, config: config ? config({ ...settings }) : null })),
    build,
    /** The world settings a kit needs (a match's rules, a weapon), or null. */
    /** A kit's world settings; `at` (a point round you) for the kits whose settings say where (the block mine). */
    config: (id, settings = {}, at = null) => { const k = KITS.find((x) => x.id === id); return k && k.config ? k.config({ ...k.settings, ...settings }, at) : null; },
    /** The spawn wheel's items (🎲 Play kits). */
    items: () => KITS.map((k) => ({ id: `kit:${k.id}`, type: 'kits', cat: 'play', catName: 'Play kits', name: k.name, icon: k.icon, words: [k.name, k.id, ...k.about.toLowerCase().split(/\W+/).filter((w) => w.length > 3)], source: 'kit', kit: k.id })),
  };
})();
