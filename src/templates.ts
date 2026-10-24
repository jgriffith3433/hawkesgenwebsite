// Starter games: what a new game begins as. Each is a few files written against the Hawkes Play API
// (public/play/API.md). Keep them short and playable: they are the first thing a new customer sees run.
// featured: an Overseer game, shown first on /games and /app and playable by anyone at /play/t/<id>.
// assets: things from the community library the template uses, by the name its scripts call them (`game.sound('coin.mp3')`)
// -> the community id (a_...), which scene.json uses. /play/t/<id> loads them through the public community route
// (games.ts templateAssets); a game made from the template gets them as its own assets (createGame), so nothing is copied.
export type Template = { id: string; name: string; blurb: string; featured?: { emoji: string }; assets?: Record<string, string>; files: (title: string) => Record<string, string> };

import { OVERSEER_GAMES } from './overseer-games/index.ts';

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

type Things = Record<string, any>;

/** The guest sandbox (/play/sandbox): an island in the sea, made only from the engine's modules (terrain, water,
 *  vehicles, mayhem, living). Laid out around the start (facing +x, east): a friend, barrels and crates, the 4x4,
 *  herds on the hills, and the dock on the east beach with a rod and a boat. The island (size 150, height 10, seed 3)
 *  is flat at y 4 within ~12 m of the middle; the east shore is at x ~40. */
export const SANDBOX = {
  config: {
    background: '#8fd0f5', ambient: 0.8, sun: 0.95, gravity: -24, fog: { color: '#a9dcf5', start: 70, end: 240 },
    terrain: { shape: 'island', size: 150, height: 10, seed: 3, scatter: { trees: 60, rocks: 25, bushes: 50, seed: 3 } },
    water: { level: 0, waves: 0.25 },
    player: { view: 'third', tools: ['rocket-launcher', 'spawn-gun', 'gravity-gun'], tool: 'rocket-launcher' },
    mayhem: { slowmo: true },
    spawn: { play: true, max: 200 },
  },
  entities(): Things {
    const out: Things = {
      start: thing('start', 'spawn', 'Player start', [-6, 4.2, 0], { data: { role: 'player' }, transform: { position: [-6, 4.2, 0], rotation: [0, 90, 0] } }),
      pip: { id: 'pip', type: 'friend', name: 'Pip', shape: { personality: 'a cheerful island guide who loves explosions and fishing', species: 'person', color: '#f59e0b', lines: ['Hi! Welcome to the island!', 'The 4x4 is right there: walk up and press E.', 'Those red barrels go BOOM. Try the rocket launcher!', 'The dock is east, down by the beach. There is a rod at the end of it, and a boat.'] }, physics: 'dynamic', transform: { position: [-1, 4.6, 1.8], rotation: [0, -90, 0] } },
      jeep: { id: 'jeep', type: 'truck', name: '4x4', material: { color: '#3f7d3a' }, transform: { position: [3, 5.4, 6], rotation: [0, 90, 0] } },
      sheep: { id: 'sheep', type: 'herd', name: 'Sheep', shape: { species: 'sheep', count: 10, radius: 6 }, transform: { position: [16, 5, 13] } },
      cows: { id: 'cows', type: 'herd', name: 'Cows', shape: { species: 'cow', count: 6, radius: 5 }, transform: { position: [12, 5, -17] } },
      dock: thing('dock', 'box', 'Dock', [46, 0.75, 0], { shape: { size: [14, 0.3, 2.6] }, material: { color: '#8a6440' } }),
      dock_sign: thing('dock_sign', 'text', 'Dock sign', [39, 2.6, -2], { shape: { text: 'Fishing dock', size: 0.35 }, transform: { position: [39, 2.6, -2], rotation: [0, 90, 0] } }),
      rod: { id: 'rod', type: 'tool-pickup', name: 'Fishing rod', shape: { tool: 'rod', respawn: 5 }, transform: { position: [51, 0.95, 0] } },
      boat: { id: 'boat', type: 'boat', name: 'Boat', material: { color: '#e5e7eb' }, transform: { position: [47, 0.3, 3.6], rotation: [0, 90, 0] } },
    };
    // Barrels close enough to chain, and crates to smash, on the flat ground ahead and to the right.
    [[6, -6], [7.1, -6.2], [6.5, -7.2], [7.6, -5.1], [5.6, -5]].forEach(([x, z], i) => { out[`barrel_${i + 1}`] = { id: `barrel_${i + 1}`, type: 'barrel', name: 'Barrel', transform: { position: [x, 4.7, z] } }; });
    [[9.5, -9, 4.6], [10.7, -9, 4.6], [10.1, -9, 5.7]].forEach(([x, z, y], i) => { out[`crate_${i + 1}`] = { id: `crate_${i + 1}`, type: 'crate', name: 'Crate', transform: { position: [x, y, z] } }; });
    return out;
  },
};

export const TEMPLATES: Template[] = [
  ...OVERSEER_GAMES,
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
  // A new game: a whole planet, round and empty (J: "an empty world... a literal world"), and the Overseer's intro every
  // time it opens. 50 km across the middle: fly up (faster the higher you are) and you see the ball you stood on.
  {
    id: 'planet',
    name: 'A new planet',
    blurb: 'An empty round planet, all yours: walk all the way round it, fly up until you see the whole ball, and build anything anywhere.',
    files: (title) => ({
      'README.md': readme(title, 'An empty planet, 50 km across the middle. Walk with WASD, double-tap space (or F) to fly: the higher you go the faster you fly, up to space and the whole planet below. Hold Q for the spawn wheel, hold click to grab things, double-click anything to change it, Enter to ask the assistant.'),
      'scene.json': sceneJson(
        { background: '#8fc4ea', ambient: 0.7, sun: 0.95, gravity: -24, planet: { sphere: true, radius: 50000, biome: 'earth' }, overseer: { intro: 'always' }, fog: { color: '#a9d2ee', start: 300, end: 1600 } },
        { start: thing('start', 'spawn', 'Player start', [0, 0.05, 0], { data: { role: 'player' }, transform: { position: [0, 0.05, 0], rotation: [0, -18, 0] } }) },
      ),
      'scripts/main.js': `// Game rules go here. The world itself is scene.json (build it by walking around in it).
// It's a round planet: up is away from its middle wherever you are (game.player is you).
`,
    }),
  },
  {
    id: 'sandbox',
    name: 'Island sandbox',
    blurb: 'An island to mess about on: drive the 4x4, blow up barrels, fish off the dock, take the boat out, and meet Pip.',
    files: (title) => ({
      'README.md': readme(title, 'An island made from the engine\'s modules: terrain, the sea, a 4x4 and a boat (E to get in), exploding barrels and crates, herds of sheep and cows, Pip (an AI friend: T to talk), and a fishing rod at the end of the dock. You carry a rocket launcher, a spawn gun and a gravity gun (Q switches).'),
      'scene.json': sceneJson(SANDBOX.config, SANDBOX.entities()),
      'scripts/main.js': `// Game rules go here. The world itself is scene.json (build it by walking around in it).
game.onStart(() => {
  game.ui.message('Welcome to the island', 2);
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
