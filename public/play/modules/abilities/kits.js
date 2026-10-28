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
    list: () => KITS.map(({ id, name, icon, about, settings }) => ({ id, name, icon, about, settings: { ...settings } })),
    build,
    /** The spawn wheel's items (🎲 Play kits). */
    items: () => KITS.map((k) => ({ id: `kit:${k.id}`, type: 'kits', cat: 'play', catName: 'Play kits', name: k.name, icon: k.icon, words: [k.name, k.id, ...k.about.toLowerCase().split(/\W+/).filter((w) => w.length > 3)], source: 'kit', kit: k.id })),
  };
})();
