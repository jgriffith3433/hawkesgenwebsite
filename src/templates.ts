// Starter games: what a new game begins as. Each is a few files written against the Hawkes Play API
// (public/play/API.md). Keep them short and playable: they are the first thing a new customer sees run.
// featured: an Overseer game, shown first on /games and /app and playable by anyone at /play/t/<id>.
export type Template = { id: string; name: string; blurb: string; featured?: { emoji: string }; files: (title: string) => Record<string, string> };

const readme = (title: string, how: string) => `# ${title}

${how}

Scripts are in \`scripts/\`. The Docs tab has the whole scripting API. Ask the assistant for changes ("make the
player faster", "add a double jump", "make enemies chase me"), or generate art, models and sound in the Assets panel
and use them by name, like \`game.model('tree.glb')\` or \`game.sound('coin.mp3')\`.
`;

/** One thing in a starter world (scene.json format, public/play/WORLD.md). */
function thing(id: string, type: string, name: string, position: number[], more: Record<string, any> = {}) {
  return { id, type, name, physics: type === 'light' || type === 'spawn' || type === 'text' ? undefined : 'static', ...more, transform: { position, ...(more.transform ?? {}) } };
}

function sceneJson(config: object, entities: Record<string, object>): string {
  return JSON.stringify({ version: 1, modules: { core: '1.0.0' }, config, entities, nextId: Object.keys(entities).length + 1 }, null, 2);
}

// ------------------------------------------------------------------ pieces the Overseer worlds are laid out with
type Things = Record<string, any>;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Four walls around a square arena, each with a glowing strip along the top. */
function wallsWithTrim(half: number, color: string, trim: string): Things {
  const out: Things = {};
  const sides: [string, number[], number[]][] = [['n', [0, 2, half], [half * 2 + 1, 4, 1]], ['s', [0, 2, -half], [half * 2 + 1, 4, 1]], ['e', [half, 2, 0], [1, 4, half * 2 + 1]], ['w', [-half, 2, 0], [1, 4, half * 2 + 1]]];
  for (const [k, pos, size] of sides) {
    out[`wall_${k}`] = thing(`wall_${k}`, 'box', 'Wall', pos, { shape: { size }, material: { color } });
    out[`trim_${k}`] = thing(`trim_${k}`, 'box', 'Wall light', [pos[0], 4.05, pos[2]], { shape: { size: [size[0] + 0.02, 0.1, size[2] + 0.02] }, material: { color: trim, emissive: trim }, physics: 'none' });
  }
  return out;
}

/** Cover to fight around: low barriers, pillars with lit rings, and crates you can knock over. */
function cover(): Things {
  const out: Things = {};
  const barriers = [[-8, -8, 0], [8, -8, 0], [-10, 6, 90], [10, 6, 90], [0, -2, 0], [-18, 12, 45], [18, -12, 45]];
  barriers.forEach(([x, z, r], i) => { out[`barrier_${i}`] = thing(`barrier_${i}`, 'box', 'Barrier', [x, 0.7, z], { shape: { size: [4, 1.4, 0.6] }, material: { color: '#39425c' }, transform: { position: [x, 0.7, z], rotation: [0, r, 0] } }); });
  const pillars = [[-14, -14], [14, -14], [-14, 14], [14, 14]];
  pillars.forEach(([x, z], i) => {
    out[`pillar_${i}`] = thing(`pillar_${i}`, 'cylinder', 'Pillar', [x, 2.5, z], { shape: { radius: 1.1, height: 5 }, material: { color: '#2a3146' } });
    out[`pillar_ring_${i}`] = thing(`pillar_ring_${i}`, 'torus', 'Pillar light', [x, 3.6, z], { shape: { radius: 1.18, thickness: 0.1 }, material: { color: '#22d3ee', emissive: '#22d3ee' }, physics: 'none' });
  });
  const crates = [[4, -12], [5, -11], [-5, 10], [-4.2, 11], [12, 0], [-12, -2]];
  crates.forEach(([x, z], i) => { out[`crate_${i}`] = thing(`crate_${i}`, 'box', 'Crate', [x, 0.6, z], { shape: { size: [1.2, 1.2, 1.2] }, material: { color: '#6b5236' }, physics: 'dynamic', body: { mass: 2 } }); });
  return out;
}

/** A glowing pad that sends a new bot (a copy of the thing called "bot") every few seconds. */
function spawnPad(id: string, name: string, pos: number[]) {
  return thing(id, 'cylinder', name, pos, { shape: { radius: 1.3, height: 0.16 }, material: { color: '#ff3b5c', emissive: '#5a0a1a' }, behaviors: [{ use: 'spawner', of: 'bot', every: 7, max: 2, spread: 0.6 }, { use: 'glow', color: '#ff3b5c', speed: 1.2 }] });
}

/** Sky Racer's course: gates along a winding path, each pointing at the next, islands around it, and the finish. */
function raceCourse(): Things {
  const out: Things = {};
  const n = 16;
  const at = (i: number) => [r1(Math.sin(i * 0.55) * 26), r1(18 + Math.sin(i * 0.9) * 9 + i * 0.6), r1(18 + i * 26)];
  const colors = ['#22d3ee', '#a855f7', '#ff4ad8', '#f4c430'];
  for (let i = 0; i < n; i++) {
    const p = at(i), q = at(i + 1);
    const yaw = Math.round((Math.atan2(q[0] - p[0], q[2] - p[2]) * 180) / Math.PI);
    const c = colors[i % colors.length];
    out[`gate_${i + 1}`] = thing(`gate_${i + 1}`, 'torus', `Gate ${i + 1}`, p, { shape: { radius: 4.2, thickness: 0.35 }, material: { color: c, emissive: c }, physics: 'none', transform: { position: p, rotation: [90, yaw, 0] }, behaviors: [{ use: 'gate', points: 100, next: i + 1 < n ? `gate_${i + 2}` : 'finish' }] });
  }
  const f = at(n);
  out.finish = thing('finish', 'waypoint', 'Finish', [f[0], f[1] - 1.5, f[2]], { shape: { radius: 5 }, data: { role: 'finish', message: 'Race complete!' } });
  for (let i = 0; i < 14; i++) {
    const side = i % 2 ? 1 : -1;
    const p = [r1(side * (40 + (i * 13) % 25)), r1(4 + (i * 7) % 18), r1(i * 30)];
    const rr = 4 + (i % 4) * 2;
    out[`island_${i}`] = thing(`island_${i}`, 'cylinder', 'Floating island', p, { shape: { radius: rr, height: 1.6 }, material: { color: '#3f2a6e', emissive: '#1a0c3a' }, behaviors: [{ use: 'bob', height: 0.6, speed: 0.25 + (i % 3) * 0.1 }] });
    out[`island_rock_${i}`] = thing(`island_rock_${i}`, 'cone', 'Island rock', [p[0], p[1] - rr * 0.9, p[2]], { shape: { radius: rr * 0.9, height: rr * 1.6 }, material: { color: '#2a1b4d' }, transform: { position: [p[0], p[1] - rr * 0.9, p[2]], rotation: [180, 0, 0] }, behaviors: [{ use: 'bob', height: 0.6, speed: 0.25 + (i % 3) * 0.1 }] });
    out[`island_crystal_${i}`] = thing(`island_crystal_${i}`, 'cone', 'Crystal', [p[0], p[1] + 2, p[2]], { shape: { radius: 0.6, height: 3 }, material: { color: '#ff7ad8', emissive: '#ff4ad8' }, physics: 'none', behaviors: [{ use: 'bob', height: 0.8, speed: 0.4 }, { use: 'spin', speed: 30 }] });
  }
  return out;
}

/** Leap's climb: steps, moving platforms, spikes, coins, a launch pad, checkpoints on a route, and the summit. */
function climb(): Things {
  const out: Things = {};
  const steps: { p: number[]; size?: number[]; move?: any; color?: string }[] = [
    { p: [0, 1, -6] }, { p: [4, 2.2, -2] }, { p: [8, 3.4, 2], size: [3, 0.5, 3] }, { p: [6, 4.6, 7], move: { use: 'patrol', axis: 'x', range: 4, speed: 0.7 } },
    { p: [0, 5.8, 10] }, { p: [-5, 7, 8], size: [3, 0.5, 3] }, { p: [-9, 8.2, 3], move: { use: 'patrol', axis: 'z', range: 3.5, speed: 0.8 } },
    { p: [-8, 9.4, -3] }, { p: [-3, 10.6, -6], size: [4, 0.5, 4] }, { p: [2, 11.8, -9], move: { use: 'patrol', axis: 'y', range: 1.6, speed: 0.6 } },
    { p: [6, 13, -6] }, { p: [8, 14.2, -1], size: [3, 0.5, 3] },
  ];
  steps.forEach((s, i) => {
    out[`step_${i}`] = thing(`step_${i}`, 'box', s.move ? 'Moving platform' : 'Step', s.p, { shape: { size: s.size ?? [2.6, 0.5, 2.6] }, material: { color: s.move ? '#4a9eff' : '#e8dcc0', emissive: s.move ? '#0a2a5a' : undefined }, physics: s.move ? 'kinematic' : 'static', behaviors: s.move ? [s.move] : [] });
    if (i % 2 === 1) out[`coin_${i}`] = thing(`coin_${i}`, 'cylinder', 'Coin', [s.p[0], s.p[1] + 1.1, s.p[2]], { shape: { radius: 0.32, height: 0.08 }, material: { color: '#f4c430', emissive: '#6a4a00' }, transform: { position: [s.p[0], s.p[1] + 1.1, s.p[2]], rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible' }, { use: 'spin', speed: 140, axis: 'z' }] });
  });
  // Spikes on two of the wide steps: jump over them.
  for (const [i, dx] of [[2, 0.8], [8, -1]] as const) { const p = steps[i].p; out[`spike_${i}`] = thing(`spike_${i}`, 'cone', 'Spikes', [p[0] + dx, p[1] + 0.55, p[2]], { shape: { radius: 0.35, height: 0.6 }, material: { color: '#c0c6d4', emissive: '#3a0a0a' }, behaviors: [{ use: 'hurts', damage: 34 }] }); }
  const cp = (id: string, i: number, next: string) => { const p = steps[i].p; return thing(id, 'waypoint', 'Checkpoint', [p[0], p[1] + 0.26, p[2]], { shape: { radius: 1.2 }, data: { role: 'checkpoint', next } }); };
  out.check_1 = cp('check_1', 5, 'check_2');
  out.check_2 = cp('check_2', 8, 'summit');
  out.summit_floor = thing('summit_floor', 'cylinder', 'Summit', [12, 15.4, 4], { shape: { radius: 3.2, height: 0.6 }, material: { color: '#f4e6c0', emissive: '#3a2a00' } });
  out.summit = thing('summit', 'waypoint', 'Summit', [12, 15.72, 4], { shape: { radius: 2.4 }, data: { role: 'finish', message: 'You reached the summit!' } });
  out.pad = thing('pad', 'cylinder', 'Launch pad', [10, 14.5, 0.2], { shape: { radius: 0.8, height: 0.15 }, material: { color: '#22d3ee', emissive: '#063a44' }, behaviors: [{ use: 'launch', power: 14 }] });
  out.tree_1 = thing('tree_1', 'cylinder', 'Tree', [-14, 1.5, -12], { shape: { radius: 0.35, height: 3 }, material: { color: '#6a4a2a' } });
  out.tree_1_top = thing('tree_1_top', 'cone', 'Tree top', [-14, 4.2, -12], { shape: { radius: 1.8, height: 3.4 }, material: { color: '#2f7a3a' } });
  out.tree_2 = thing('tree_2', 'cylinder', 'Tree', [15, 1.5, -15], { shape: { radius: 0.35, height: 3 }, material: { color: '#6a4a2a' } });
  out.tree_2_top = thing('tree_2_top', 'cone', 'Tree top', [15, 4.2, -15], { shape: { radius: 1.8, height: 3.4 }, material: { color: '#2f7a3a' } });
  out.sign = thing('sign', 'text', 'Sign', [0, 2.4, -11], { shape: { text: 'Reach the summit\nSpace twice: double jump', size: 0.3 } });
  return out;
}

export const TEMPLATES: Template[] = [
  {
    id: 'fps-arena',
    name: 'Bot Arena',
    featured: { emoji: '🎯' },
    blurb: 'A first-person arena against thinking bots. Grab the shotgun, ride the launch pad to the rocket launcher, clear 25.',
    files: (title) => ({
      'README.md': readme(title, 'Bot Arena is built from parts anyone can use: bots are things with the "enemy" behavior, the corner pads have "spawner", the health, ammo and weapons are "pickup", and you carry a rifle from the world\'s player settings. The only script keeps score.'),
      'scene.json': sceneJson(
        { background: '#141c2e', ambient: 0.75, sun: 0.6, gravity: -24, fog: { color: '#0f1522', start: 30, end: 95 }, motes: '#8fc8ff', player: { view: 'first', weapon: 'rifle', speed: 7, jump: 1.4 } },
        {
          floor: thing('floor', 'box', 'Arena floor', [0, -0.25, 0], { shape: { size: [56, 0.5, 56] }, material: { color: '#1b2232' } }),
          ...wallsWithTrim(28, '#2a3146', '#22d3ee'),
          start: thing('start', 'spawn', 'Player start', [0, 0.1, -20], { data: { role: 'player' } }),
          ...cover(),
          tower: thing('tower', 'box', 'Sniper tower', [0, 4, 18], { shape: { size: [6, 0.6, 6] }, material: { color: '#2a3146' } }),
          tower_trim: thing('tower_trim', 'box', 'Tower light', [0, 4.32, 18], { shape: { size: [6.05, 0.06, 6.05] }, material: { color: '#a855f7', emissive: '#a855f7' }, physics: 'none' }),
          pad: thing('pad', 'cylinder', 'Launch pad', [0, 0.08, 12], { shape: { radius: 1, height: 0.16 }, material: { color: '#22d3ee', emissive: '#0b5a6a' }, behaviors: [{ use: 'launch', power: 19 }] }),
          launcher: thing('launcher', 'box', 'Rocket launcher', [0, 5, 18], { shape: { size: [0.9, 0.3, 0.3] }, material: { color: '#ff4ad8', emissive: '#7a1a66' }, physics: 'none', behaviors: [{ use: 'pickup', gives: 'weapon', weapon: 'launcher', respawn: 30 }] }),
          shotgun: thing('shotgun', 'box', 'Shotgun', [-18, 1.2, -6], { shape: { size: [0.8, 0.25, 0.25] }, material: { color: '#ff8a3d', emissive: '#7a3a10' }, physics: 'none', behaviors: [{ use: 'pickup', gives: 'weapon', weapon: 'shotgun', respawn: 20 }] }),
          shotgun_stand: thing('shotgun_stand', 'cylinder', 'Pedestal', [-18, 0.45, -6], { shape: { radius: 0.5, height: 0.9 }, material: { color: '#2a3146', emissive: '#3a1a08' } }),
          health_a: thing('health_a', 'box', 'Health pack', [16, 0.6, -14], { shape: { size: [0.6, 0.6, 0.6] }, material: { color: '#34d399', emissive: '#0f5a3a' }, physics: 'none', behaviors: [{ use: 'pickup', gives: 'health', amount: 40, respawn: 18 }] }),
          health_b: thing('health_b', 'box', 'Health pack', [-16, 0.6, 14], { shape: { size: [0.6, 0.6, 0.6] }, material: { color: '#34d399', emissive: '#0f5a3a' }, physics: 'none', behaviors: [{ use: 'pickup', gives: 'health', amount: 40, respawn: 18 }] }),
          ammo_a: thing('ammo_a', 'box', 'Ammo', [18, 0.5, 8], { shape: { size: [0.7, 0.4, 0.5] }, material: { color: '#f4c430', emissive: '#5a4200' }, physics: 'none', behaviors: [{ use: 'pickup', gives: 'ammo', amount: 40, respawn: 12 }] }),
          ammo_b: thing('ammo_b', 'box', 'Ammo', [-8, 0.5, -18], { shape: { size: [0.7, 0.4, 0.5] }, material: { color: '#f4c430', emissive: '#5a4200' }, physics: 'none', behaviors: [{ use: 'pickup', gives: 'ammo', amount: 40, respawn: 12 }] }),
          bot: thing('bot', 'capsule', 'Bot', [0, 1, 6], { shape: { radius: 0.45, height: 1.9 }, material: { color: '#3a1d24', emissive: '#30060a' }, physics: 'dynamic', tag: 'bot', behaviors: [{ use: 'enemy', hp: 60, speed: 3.6, range: 13, damage: 7, rate: 1.4 }] }),
          gate_a: spawnPad('gate_a', 'Bot gate', [22, 0.08, 22]),
          gate_b: spawnPad('gate_b', 'Bot gate', [-22, 0.08, 22]),
          gate_c: spawnPad('gate_c', 'Bot gate', [22, 0.08, -2]),
          lamp_a: thing('lamp_a', 'light', 'Blue light', [-14, 6, -10], { light: { type: 'point', color: '#4a9eff', intensity: 0.9, range: 26 } }),
          lamp_b: thing('lamp_b', 'light', 'Red light', [14, 6, 14], { light: { type: 'point', color: '#ff4060', intensity: 0.8, range: 24 } }),
          lamp_c: thing('lamp_c', 'light', 'Violet light', [0, 7, 18], { light: { type: 'point', color: '#a855f7', intensity: 0.8, range: 20 } }),
          sign: thing('sign', 'text', 'Sign', [0, 3.2, -26.5], { shape: { text: 'BOT ARENA\nClear 25 bots', size: 0.6, billboard: false } }),
        },
      ),
      'scripts/arena.js': `// Bot Arena's rules. Everything else is the world: bots ("enemy"), the pads that send more ("spawner"),
// pickups, the launch pad, and the rifle in the player settings.
game.state.kills = 0;
const goal = 25;

game.on('kill', () => {
  game.state.kills++;
  if (game.state.kills % 5 === 0 && game.state.kills < goal) game.ui.message(\`Wave \${game.state.kills / 5 + 1}\`, 1.4);
  if (game.state.kills >= goal) game.over(\`Arena cleared: \${goal} bots\`);
});

game.onUpdate(() => {
  game.ui.text('kills', \`BOTS \${game.state.kills} / \${goal}\`, { x: 'center', y: 'top', size: 22 });
});
`,
    }),
  },
  {
    id: 'sky-racer',
    name: 'Sky Racer',
    featured: { emoji: '🛩️' },
    blurb: 'Fly through the glowing gates past floating islands. Steer with the mouse, boost with space, beat your time.',
    files: (title) => ({
      'README.md': readme(title, 'Sky Racer: the player flies (player settings: mode "flight"), the gates are rings with the "gate" behavior, each pointing at the next, and the finish is a waypoint. The script keeps time.'),
      'scene.json': sceneJson(
        { background: '#160f36', ambient: 0.6, sun: 0.5, fog: { color: '#2a1a5a', start: 60, end: 260 }, motes: '#ffb0f0', player: { mode: 'flight', view: 'third', speed: 22, distance: 7 } },
        {
          start_pad: thing('start_pad', 'cylinder', 'Start pad', [0, 18, -12], { shape: { radius: 4, height: 0.6 }, material: { color: '#2a1d5a', emissive: '#221050' } }),
          start: thing('start', 'spawn', 'Start', [0, 18.4, -12], { data: { role: 'player' } }),
          ...raceCourse(),
          sun_light: thing('sun_light', 'light', 'Pink sun', [0, 80, 300], { light: { type: 'point', color: '#ff7ad8', intensity: 1.2, range: 600 } }),
        },
      ),
      'scripts/race.js': `// Sky Racer's rules: a clock, the score from the gates, and the finish.
game.state.time = 0;
game.state.score = 0;
game.on('gate', () => game.ui.message('+100', 0.6));
game.onUpdate((dt) => {
  if (!game.state.done) game.state.time += dt;
  game.ui.text('time', \`\${game.state.time.toFixed(1)} s\`, { x: 'right', size: 26 });
  game.ui.text('score', \`\${game.state.score || 0}\`, { x: 'center', size: 30 });
});
game.on('finish', () => { game.state.done = true; });
`,
    }),
  },
  {
    id: 'platform-run',
    name: 'Leap',
    featured: { emoji: '🏃' },
    blurb: 'A third-person climb: moving platforms, spikes, coins, checkpoints, a launch pad and a summit to reach.',
    files: (title) => ({
      'README.md': readme(title, 'Leap is made of parts: you play in third person with a double jump (player settings), platforms move with "patrol", spikes "hurt", coins are "collectible", checkpoints and the summit are waypoints joined by their route.'),
      'scene.json': sceneJson(
        { background: '#7cc4f0', ambient: 0.8, sun: 1, gravity: -24, fog: { color: '#a9d8f5', start: 50, end: 160 }, motes: '#ffffff', player: { view: 'third', jump: 2.2, doubleJump: true, speed: 7, distance: 6 } },
        {
          ground: thing('ground', 'box', 'Meadow', [0, -0.5, 0], { shape: { size: [44, 1, 44] }, material: { color: '#5fae55' } }),
          start: thing('start', 'spawn', 'Start', [0, 0.1, -14], { data: { role: 'player' } }),
          ...climb(),
        },
      ),
      'scripts/leap.js': `// Leap's rules: a clock and the coins; the summit waypoint ends the run.
game.state.time = 0;
game.on('finish', () => { game.state.done = true; });
game.onUpdate((dt) => {
  if (!game.state.done) game.state.time += dt;
  game.ui.text('time', \`\${game.state.time.toFixed(1)} s\`, { x: 'right', size: 24 });
  game.ui.text('coins', \`★ \${game.state.score || 0}\`, { x: 'left', size: 24 });
});
`,
    }),
  },
  {
    id: 'collector',
    name: 'Coin collector',
    blurb: 'Run and jump around a little island collecting coins before time runs out.',
    files: (title) => ({
      'README.md': readme(title, 'Collect every coin before the clock runs out. WASD or the arrows to run, space to jump.'),
      'game.json': JSON.stringify({ background: '#9fd3f0', gravity: -24, fog: { color: '#9fd3f0', start: 40, end: 110 } }, null, 2) + '\n',
      'scripts/world.js': `// The island: a ground, a few platforms to climb, and water all around.
game.box({ size: [36, 1, 36], y: -0.5, color: '#6a9f4b', name: 'ground' });
game.plane({ size: 400, y: -2, color: '#3f7fb5', physics: 'none', shadow: false });

const steps = [
  [6, 1, 4], [9, 2, 7], [6, 3.2, 10], [0, 4.2, 11], [-6, 3.2, 9], [-9, 2, 5],
];
for (const [x, y, z] of steps) game.box({ x, y, z, size: [3, 0.5, 3], color: '#b7a07a', tag: 'platform' });

for (let i = 0; i < 14; i++) {
  game.box({ x: game.random(-16, 16), z: game.random(-16, -4), y: 0.75, size: [1, 1.5, 1], color: '#8a6a4a', rotation: game.random(0, 90) });
}
`,
      'scripts/player.js': `// The player, the coins, the clock.
const player = game.capsule({ y: 1.5, color: '#e07a2f', physics: 'dynamic', name: 'player' });
game.camera.follow(player, { distance: 13, height: 9 });

const coinSpots = [[6, 2, 4], [9, 3, 7], [6, 4.2, 10], [0, 5.2, 11], [-6, 4.2, 9], [-9, 3, 5], [12, 1, -8], [-12, 1, -10], [0, 1, -14], [14, 1, 12]];
for (const [x, y, z] of coinSpots) {
  const coin = game.cylinder({ x, y, z, radius: 0.45, height: 0.12, rotation: [90, 0, 0], color: '#f4c430', emissive: '#6b4f00', physics: 'trigger', tag: 'coin', shadow: false });
  coin.on('hit', (other) => {
    if (other !== player || !coin.alive) return;
    coin.destroy();
    game.burst(coin.position, { color: '#f4c430' });
    game.state.coins++;
    if (game.all('coin').length === 0) game.over(\`All coins in \${(60 - game.state.left).toFixed(1)} seconds!\`);
  });
}

game.state.coins = 0;
game.state.left = 60;

game.onUpdate((dt) => {
  player.walk(game.input.direction(), 7);
  if (game.input.pressed('space')) player.jump(10);
  for (const c of game.all('coin')) c.turn(150 * dt);

  game.state.left = Math.max(0, game.state.left - dt);
  game.ui.text('coins', \`Coins \${game.state.coins} / \${coinSpots.length}\`);
  game.ui.bar('time', game.state.left / 60, { label: 'Time', x: 'right' });
  if (game.state.left <= 0) game.over('Out of time');
  if (player.y < -6) game.restart();
});

game.ui.message('${title.replace(/'/g, "\\'")}', 2);
`,
    }),
  },
  {
    id: 'runner',
    name: 'Endless runner',
    blurb: 'Dodge left and right down an endless road; it keeps getting faster.',
    files: (title) => ({
      'README.md': readme(title, 'Dodge the blocks. A and D (or the arrows) to change lanes, space to jump.'),
      'game.json': JSON.stringify({ background: '#f2c48a', gravity: -30, fog: { color: '#f2c48a', start: 30, end: 90 } }, null, 2) + '\n',
      'scripts/main.js': `// The road moves, not the player: blocks come at you and you switch lanes.
const lanes = [-3, 0, 3];
let lane = 1;

game.box({ size: [10, 1, 400], y: -0.5, z: 150, color: '#4b4840' });
for (let z = 0; z < 300; z += 6) {
  game.box({ x: -1.5, z, y: 0.01, size: [0.15, 0.02, 2], color: '#e8e3d6', physics: 'none', shadow: false });
  game.box({ x: 1.5, z, y: 0.01, size: [0.15, 0.02, 2], color: '#e8e3d6', physics: 'none', shadow: false });
}

const player = game.box({ y: 0.6, size: [1, 1.2, 1], color: '#c8421d', physics: 'dynamic', name: 'player' });
game.camera.follow(player, { distance: 8, height: 4.5, smooth: 0.05 });

game.state.speed = 12;
game.state.score = 0;

game.every(0.7, () => {
  const x = game.pick(lanes);
  const tall = Math.random() < 0.3;
  const b = game.box({ x, y: tall ? 1.5 : 0.5, z: 70, size: [2, tall ? 3 : 1, 1], color: tall ? '#2f4f8f' : '#2f6b4a', physics: 'trigger', tag: 'block' });
  b.on('hit', (other) => {
    if (other !== player) return;
    game.camera.shake(0.5, 0.4);
    game.burst(player.position, { color: '#c8421d', count: 40 });
    const best = Math.max(game.load('best', 0), Math.floor(game.state.score));
    game.save('best', best);
    game.over(\`Score \${Math.floor(game.state.score)}  ·  Best \${best}\`);
  });
});

game.onUpdate((dt) => {
  if (game.input.pressed('a') || game.input.pressed('arrowleft')) lane = Math.max(0, lane - 1);
  if (game.input.pressed('d') || game.input.pressed('arrowright')) lane = Math.min(2, lane + 1);
  const ax = game.input.axis().x;
  if (Math.abs(ax) > 0.6 && !game.state.stickHeld) { lane = game.clamp(lane + Math.sign(ax), 0, 2); game.state.stickHeld = true; }
  if (Math.abs(ax) < 0.3) game.state.stickHeld = false;
  if (game.input.pressed('space') || game.input.pressed('w') || game.input.pressed('arrowup')) player.jump(10);

  player.x = game.lerp(player.x, lanes[lane], Math.min(1, dt * 14));
  player.z = 0;

  game.state.speed += dt * 0.35;
  game.state.score += dt * game.state.speed;
  for (const b of game.all('block')) {
    b.z -= game.state.speed * dt;
    if (b.z < -10) b.destroy();
  }
  game.ui.text('score', \`\${Math.floor(game.state.score)}\`, { x: 'center', size: 34 });
});

game.ui.message('${title.replace(/'/g, "\\'")}', 1.5);
`,
    }),
  },
  {
    id: 'arena',
    name: 'Arena survival',
    blurb: 'Top-down: enemies chase you, you shoot back. How long can you last?',
    files: (title) => ({
      'README.md': readme(title, 'Survive. WASD to move, click (or tap) to shoot toward the pointer, or hold space to shoot ahead.'),
      'game.json': JSON.stringify({ background: '#1d1f24', ambient: 0.5, sun: 0.8, gravity: -24 }, null, 2) + '\n',
      'scripts/arena.js': `// A walled arena.
game.box({ size: [40, 1, 40], y: -0.5, color: '#3a3d45' });
for (const [x, z, w, d] of [[0, 20, 41, 1], [0, -20, 41, 1], [20, 0, 1, 41], [-20, 0, 1, 41]]) {
  game.box({ x, z, y: 1, size: [w, 2, d], color: '#5a5e6a' });
}
for (let i = 0; i < 6; i++) game.box({ x: game.random(-14, 14), z: game.random(-14, 14), y: 1, size: [2, 2, 2], color: '#4d515c' });
game.light({ type: 'point', position: [0, 6, 0], color: '#ffb36b', intensity: 0.8, range: 30 });
`,
      'scripts/play.js': `// You, the enemies, the shooting.
const player = game.capsule({ y: 1, color: '#5ec8e5', emissive: '#0b3a46', physics: 'dynamic', name: 'player' });
game.camera.topDown(player, { height: 26 });
game.state.hp = 1;
game.state.kills = 0;
let cooldown = 0;

function shoot(dir) {
  if (cooldown > 0) return;
  cooldown = 0.18;
  const len = Math.hypot(dir.x, dir.z) || 1;
  const b = game.sphere({ x: player.x + dir.x / len, y: 1, z: player.z + dir.z / len, radius: 0.18, color: '#ffe08a', emissive: '#ffb000', physics: 'trigger', tag: 'bullet', shadow: false });
  b.data.vx = (dir.x / len) * 22;
  b.data.vz = (dir.z / len) * 22;
  game.after(1.2, () => b.destroy());
  b.on('hit', (other) => {
    if (other.tag === 'enemy') {
      game.burst(other.position, { color: '#e0503a', count: 25 });
      other.destroy();
      game.state.kills++;
    }
    if (other.physics === 'static' || other.tag === 'enemy') b.destroy();
  });
}

game.every(1.2, () => {
  const side = game.randomInt(0, 3);
  const p = [[game.random(-18, 18), 18], [game.random(-18, 18), -18], [18, game.random(-18, 18)], [-18, game.random(-18, 18)]][side];
  const e = game.box({ x: p[0], z: p[1], y: 0.6, size: 1.2, color: '#e0503a', physics: 'dynamic', tag: 'enemy' });
  e.data.speed = game.random(2.5, 4.5) + game.state.kills * 0.03;
});

game.onUpdate((dt) => {
  cooldown -= dt;
  player.walk(game.input.direction(), 8);
  for (const e of game.all('enemy')) {
    e.walk({ x: player.x - e.x, z: player.z - e.z }, e.data.speed);
    if (e.touching(player)) game.state.hp -= dt * 0.6;
  }
  for (const b of game.all('bullet')) b.move(b.data.vx * dt, 0, b.data.vz * dt);

  if (game.input.mouse.down) {
    const m = game.input.mouse;
    shoot({ x: (m.x - innerWidth / 2), z: -(m.y - innerHeight / 2) });
  } else if (game.input.key('space')) {
    shoot(player.forward);
  }

  game.ui.bar('hp', game.state.hp, { label: 'Health', color: '#5ec8e5' });
  game.ui.text('kills', \`Defeated \${game.state.kills}\`, { x: 'right' });
  if (game.state.hp <= 0) game.over(\`You lasted \${game.time.toFixed(0)} seconds and defeated \${game.state.kills}\`);
});

game.ui.message('${title.replace(/'/g, "\\'")}', 1.5);
`,
    }),
  },
  {
    id: 'blank',
    name: 'Playground',
    blurb: 'A little world to start from: grab the crates, throw the ball, collect the coins, then make it yours.',
    files: (title) => ({
      'README.md': readme(title, 'A playground to build from. Walk with WASD, jump with space (twice to fly), hold click to grab things, double-click anything to change it, Enter to ask the assistant.'),
      'scene.json': sceneJson(
        { background: '#9fd3f0', ambient: 0.75, sun: 0.9, gravity: -24, fog: { color: '#9fd3f0', start: 60, end: 160 } },
        {
          ground: thing('ground', 'plane', 'Ground', [0, 0, 0], { shape: { width: 60, depth: 60 }, material: { color: '#7aa35a' } }),
          start: thing('start', 'spawn', 'Player start', [0, 0.1, 8], { data: { role: 'player' }, transform: { position: [0, 0.1, 8], rotation: [0, 180, 0] } }),
          welcome: thing('welcome', 'text', 'Welcome sign', [0, 2.2, 2], { shape: { text: 'Hold click: grab and throw\nDouble-click: change anything\nEnter: ask the assistant', size: 0.16 } }),
          crate_1: thing('crate_1', 'box', 'Crate', [-3, 0.5, 0], { shape: { size: [1, 1, 1] }, material: { color: '#b07a45' }, physics: 'dynamic' }),
          crate_2: thing('crate_2', 'box', 'Crate', [-2.8, 1.5, 0.1], { shape: { size: [1, 1, 1] }, material: { color: '#b07a45' }, physics: 'dynamic' }),
          crate_3: thing('crate_3', 'box', 'Crate', [-1.7, 0.5, -0.2], { shape: { size: [1, 1, 1] }, material: { color: '#9c6a3c' }, physics: 'dynamic' }),
          ball: thing('ball', 'sphere', 'Bouncy ball', [2.5, 0.5, 1], { shape: { radius: 0.5 }, material: { color: '#e04f5f' }, physics: 'dynamic', body: { bounce: 0.75 } }),
          step_1: thing('step_1', 'box', 'Step', [6, 0.5, -4], { shape: { size: [3, 1, 3] }, material: { color: '#cfc6b4' } }),
          step_2: thing('step_2', 'box', 'Step', [8.5, 1.5, -7], { shape: { size: [3, 1, 3] }, material: { color: '#cfc6b4' } }),
          lift: thing('lift', 'box', 'Moving platform', [5, 3, -10], { shape: { size: [3, 0.4, 3] }, material: { color: '#4a9eff' }, physics: 'kinematic', behaviors: [{ use: 'patrol', axis: 'x', range: 4, speed: 0.6 }] }),
          tower: thing('tower', 'box', 'Lookout', [-1, 3, -12], { shape: { size: [4, 0.5, 4] }, material: { color: '#cfc6b4' } }),
          pillar: thing('pillar', 'cylinder', 'Pillar', [-1, 1.4, -12], { shape: { radius: 0.4, height: 2.8 }, material: { color: '#8a93a8' } }),
          pad: thing('pad', 'cylinder', 'Launch pad', [-6, 0.08, -6], { shape: { radius: 0.9, height: 0.15 }, material: { color: '#22d3ee', emissive: '#063a44' }, behaviors: [{ use: 'launch', power: 16 }] }),
          coin_1: thing('coin_1', 'cylinder', 'Coin', [-1, 4, -12], { shape: { radius: 0.35, height: 0.08 }, material: { color: '#f4c430', emissive: '#5a4200' }, transform: { position: [-1, 4, -12], rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible' }, { use: 'spin', speed: 120, axis: 'z' }] }),
          coin_2: thing('coin_2', 'cylinder', 'Coin', [8.5, 2.7, -7], { shape: { radius: 0.35, height: 0.08 }, material: { color: '#f4c430', emissive: '#5a4200' }, transform: { position: [8.5, 2.7, -7], rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible' }, { use: 'spin', speed: 120, axis: 'z' }] }),
          coin_3: thing('coin_3', 'cylinder', 'Coin', [-6, 5, -6], { shape: { radius: 0.35, height: 0.08 }, material: { color: '#f4c430', emissive: '#5a4200' }, transform: { position: [-6, 5, -6], rotation: [90, 0, 0] }, behaviors: [{ use: 'collectible' }, { use: 'spin', speed: 120, axis: 'z' }] }),
          gem: thing('gem', 'cone', 'Floating gem', [4, 1.6, 4], { shape: { radius: 0.3, height: 0.7 }, material: { color: '#a855f7', emissive: '#3b1466' }, physics: 'none', behaviors: [{ use: 'bob', height: 0.3 }, { use: 'spin', speed: 60 }] }),
          lookout_checkpoint: thing('lookout_checkpoint', 'waypoint', 'Checkpoint', [-2, 3.27, -12.5], { shape: { radius: 1.4 }, data: { role: 'checkpoint' } }),
          lamp: thing('lamp', 'light', 'Warm lamp', [0, 4, -2], { light: { type: 'point', color: '#ffd9a0', intensity: 0.8, range: 18 } }),
        },
      ),
      'scripts/main.js': `// Game rules go here. The world itself is scene.json (build it by walking around in it).
// You already have a first-person player; game.player is you.
game.onStart(() => {
  game.ui.message(game.title, 1.5);
});
`,
    }),
  },
];

/** The Overseer games, for /games and /app. */
export const featured = () => TEMPLATES.filter((t) => t.featured).map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, emoji: t.featured!.emoji, url: `/play/t/${t.id}` }));

/** A template as the runtime plays it (no account: /play/t/<id>). */
export function templateBundle(id: string) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  return { id: `t:${t.id}`, slug: `t/${t.id}`, title: t.name, description: t.blurb, by: 'Hawkes Gen', version: null, template: t.id, files: t.files(t.name), assets: {} };
}
