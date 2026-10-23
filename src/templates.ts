// Starter games: what a new game begins as. Each is a few files written against the Hawkes Play API
// (public/play/API.md). Keep them short and playable: they are the first thing a new customer sees run.
export type Template = { id: string; name: string; blurb: string; files: (title: string) => Record<string, string> };

const readme = (title: string, how: string) => `# ${title}

${how}

Scripts are in \`scripts/\`. The Docs tab has the whole scripting API. Ask the assistant for changes ("make the
player faster", "add a double jump", "make enemies chase me"), or generate art, models and sound in the Assets panel
and use them by name, like \`game.model('tree.glb')\` or \`game.sound('coin.mp3')\`.
`;

function sceneJson(config: object, entities: Record<string, object>): string {
  return JSON.stringify({ version: 1, modules: { core: '1.0.0' }, config, entities, nextId: Object.keys(entities).length + 1 }, null, 2);
}

export const TEMPLATES: Template[] = [
  {
    id: 'fps-arena',
    name: 'Bot Arena',
    blurb: 'First-person shooter against AI bots. Walk up to anything and inspect its code.',
    files: (title) => ({
      'README.md': readme(title, 'A first-person arena. WASD to move, mouse to look, click to shoot. Walk up to any object and click it to see its code.'),
      'game.json': JSON.stringify({ background: '#1a1c22', ambient: 0.4, sun: 0.6, gravity: -24 }, null, 2) + '\n',
      'scene.json': sceneJson(
        { background: '#1a1c22', ambient: 0.4, sun: 0.6, sunDirection: [-1, -2, -1], shadows: true, gravity: -24, physics: 'simple' },
        {
          ground: { id: 'ground', type: 'plane', name: 'Arena Floor', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { width: 50, depth: 50 }, material: { color: '#2a2d35' }, physics: 'static', components: {}, behaviors: [], data: {} },
          wall_n: { id: 'wall_n', type: 'box', name: 'North Wall', transform: { position: [0, 2, 25], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { size: [51, 4, 1] }, material: { color: '#4a4e58' }, physics: 'static', components: {}, behaviors: [], data: {} },
          wall_s: { id: 'wall_s', type: 'box', name: 'South Wall', transform: { position: [0, 2, -25], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { size: [51, 4, 1] }, material: { color: '#4a4e58' }, physics: 'static', components: {}, behaviors: [], data: {} },
          wall_e: { id: 'wall_e', type: 'box', name: 'East Wall', transform: { position: [25, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { size: [1, 4, 51] }, material: { color: '#4a4e58' }, physics: 'static', components: {}, behaviors: [], data: {} },
          wall_w: { id: 'wall_w', type: 'box', name: 'West Wall', transform: { position: [-25, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { size: [1, 4, 51] }, material: { color: '#4a4e58' }, physics: 'static', components: {}, behaviors: [], data: {} },
          pillar_1: { id: 'pillar_1', type: 'cylinder', name: 'Pillar', transform: { position: [8, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { radius: 1.2, height: 4 }, material: { color: '#5a5e6a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          pillar_2: { id: 'pillar_2', type: 'cylinder', name: 'Pillar', transform: { position: [-8, 2, -8], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { radius: 1.2, height: 4 }, material: { color: '#5a5e6a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          pillar_3: { id: 'pillar_3', type: 'cylinder', name: 'Pillar', transform: { position: [-10, 2, 10], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { radius: 1, height: 4 }, material: { color: '#5a5e6a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          pillar_4: { id: 'pillar_4', type: 'cylinder', name: 'Pillar', transform: { position: [12, 2, -6], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { radius: 1, height: 4 }, material: { color: '#5a5e6a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          crate_1: { id: 'crate_1', type: 'box', name: 'Crate', transform: { position: [4, 0.75, -4], rotation: [0, 15, 0], scale: [1, 1, 1] }, shape: { size: [1.5, 1.5, 1.5] }, material: { color: '#7a6a4a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          crate_2: { id: 'crate_2', type: 'box', name: 'Crate', transform: { position: [-5, 0.75, 3], rotation: [0, -30, 0], scale: [1, 1, 1] }, shape: { size: [1.5, 1.5, 1.5] }, material: { color: '#7a6a4a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          arena_light: { id: 'arena_light', type: 'light', name: 'Arena Light', transform: { position: [0, 8, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: '#ffb36b', intensity: 1.2, range: 40 }, components: {}, behaviors: [], data: {} },
          blue_light: { id: 'blue_light', type: 'light', name: 'Blue Accent', transform: { position: [-15, 4, -15], rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: '#4a9eff', intensity: 0.6, range: 20 }, components: {}, behaviors: [], data: {} },
          spawn_1: { id: 'spawn_1', type: 'spawn', name: 'Player Spawn', transform: { position: [0, 1, -18], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: {}, behaviors: [], data: { role: 'player' } },
          mirror: { id: 'mirror', type: 'mirror', name: 'The Mirror', transform: { position: [0, 2, 24.4], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { width: 2.5, height: 3.5 }, components: {}, behaviors: [], data: {} },
        },
      ),
      'scripts/arena.js': `// Walled arena with FPS controls
game.camera.firstPerson(game.spawn('player'), { height: 1.7 });

game.state.hp = 100;
game.state.kills = 0;
game.state.ammo = 30;

function spawnBot() {
  const spots = [[18, 1, 18], [-18, 1, -18], [18, 1, -18], [-18, 1, 18]];
  const [x, y, z] = game.pick(spots);
  const bot = game.capsule({ x, y, z, color: '#e04040', emissive: '#400808', physics: 'dynamic', tag: 'bot', name: 'Bot' });
  bot.data.hp = 3;
  bot.data.speed = game.random(3, 5) + game.state.kills * 0.1;
  return bot;
}

for (let i = 0; i < 3; i++) spawnBot();

game.every(4, () => { if (game.all('bot').length < 6) spawnBot(); });

game.onUpdate((dt) => {
  const p = game.player;
  if (game.input.mouse.down && game.state.ammo > 0) {
    game.state.ammo--;
    const hit = game.raycast(p.position, p.forward, 50);
    if (hit?.entity?.tag === 'bot') {
      hit.entity.data.hp--;
      game.burst(hit.point, { color: '#e04040', count: 10 });
      if (hit.entity.data.hp <= 0) {
        game.burst(hit.entity.position, { color: '#e04040', count: 30 });
        hit.entity.destroy();
        game.state.kills++;
        game.state.ammo = Math.min(30, game.state.ammo + 5);
      }
    }
  }

  for (const bot of game.all('bot')) {
    bot.walk({ x: p.x - bot.x, z: p.z - bot.z }, bot.data.speed);
    if (bot.touching(p)) game.state.hp -= 15 * dt;
  }

  game.ui.bar('hp', game.state.hp / 100, { label: 'Health', color: '#5ec8e5' });
  game.ui.text('ammo', \`Ammo \${game.state.ammo}\`, { x: 'right' });
  game.ui.text('kills', \`Kills \${game.state.kills}\`, { x: 'center' });
  if (game.state.hp <= 0) game.over(\`Defeated \${game.state.kills} bots\`);
});
`,
    }),
  },
  {
    id: 'sky-racer',
    name: 'Sky Racer',
    blurb: 'Fly through rings in a neon sky. Shows flight controls and dynamic skybox.',
    files: (title) => ({
      'README.md': readme(title, 'Fly through the rings. WASD to steer, space to boost. Miss 3 rings and it\'s over.'),
      'game.json': JSON.stringify({ background: '#0a0820', ambient: 0.3, sun: 0.4, gravity: 0 }, null, 2) + '\n',
      'scene.json': sceneJson(
        { background: '#0a0820', ambient: 0.3, sun: 0.4, sunDirection: [0, -1, -0.5], shadows: false, gravity: 0, physics: 'none', fog: { color: '#0a0820', start: 80, end: 200 } },
        {
          ring_1: { id: 'ring_1', type: 'cylinder', name: 'Ring', transform: { position: [0, 10, 30], rotation: [90, 0, 0], scale: [1, 1, 1] }, shape: { radius: 4, height: 0.5 }, material: { color: '#00ff88', emissive: '#004422', opacity: 0.6 }, components: {}, behaviors: [], data: { ring: true } },
          ring_2: { id: 'ring_2', type: 'cylinder', name: 'Ring', transform: { position: [15, 15, 80], rotation: [90, 0, 20], scale: [1, 1, 1] }, shape: { radius: 4, height: 0.5 }, material: { color: '#ff4488', emissive: '#440022', opacity: 0.6 }, components: {}, behaviors: [], data: { ring: true } },
          ring_3: { id: 'ring_3', type: 'cylinder', name: 'Ring', transform: { position: [-10, 8, 140], rotation: [90, 0, -15], scale: [1, 1, 1] }, shape: { radius: 4, height: 0.5 }, material: { color: '#44aaff', emissive: '#002244', opacity: 0.6 }, components: {}, behaviors: [], data: { ring: true } },
          platform_1: { id: 'platform_1', type: 'box', name: 'Floating Platform', transform: { position: [20, 0, 60], rotation: [0, 45, 0], scale: [1, 1, 1] }, shape: { size: [8, 0.4, 8] }, material: { color: '#2a1a3a', emissive: '#0a0520' }, components: {}, behaviors: [], data: {} },
          platform_2: { id: 'platform_2', type: 'box', name: 'Floating Platform', transform: { position: [-15, 5, 110], rotation: [0, -20, 0], scale: [1, 1, 1] }, shape: { size: [6, 0.4, 12] }, material: { color: '#1a2a3a', emissive: '#050a20' }, components: {}, behaviors: [], data: {} },
          neon_1: { id: 'neon_1', type: 'light', name: 'Neon Green', transform: { position: [0, 10, 30], rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: '#00ff88', intensity: 0.8, range: 15 }, components: {}, behaviors: [], data: {} },
          neon_2: { id: 'neon_2', type: 'light', name: 'Neon Pink', transform: { position: [15, 15, 80], rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: '#ff4488', intensity: 0.8, range: 15 }, components: {}, behaviors: [], data: {} },
          spawn: { id: 'spawn', type: 'spawn', name: 'Start', transform: { position: [0, 10, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: {}, behaviors: [], data: { role: 'player' } },
        },
      ),
      'scripts/flight.js': `// Neon sky racer
game.camera.firstPerson(game.spawn('player'), { height: 0 });

game.state.speed = 20;
game.state.score = 0;
game.state.missed = 0;
game.state.boost = 0;

const ringColors = ['#00ff88', '#ff4488', '#44aaff', '#ffaa22', '#aa44ff'];

function spawnRing(z) {
  const x = game.random(-25, 25);
  const y = game.random(3, 25);
  const color = game.pick(ringColors);
  const ring = game.cylinder({ x, y, z, radius: 4, height: 0.5, rotation: [90, 0, game.random(-30, 30)], color, emissive: color, opacity: 0.6, physics: 'trigger', tag: 'ring', shadow: false });
  game.light({ type: 'point', x, y, z, color, intensity: 0.5, range: 12, tag: 'ring-light' });
  ring.on('hit', (other) => {
    if (other !== game.player) return;
    ring.destroy();
    game.burst(ring.position, { color, count: 30 });
    game.state.score += 100;
    game.state.boost = Math.min(1, game.state.boost + 0.2);
  });
}

for (let z = 30; z < 500; z += game.random(30, 60)) spawnRing(z);

game.onUpdate((dt) => {
  const p = game.player;
  const input = game.input;
  const pitch = input.axis().y * 15 * dt;
  const roll = input.axis().x * 12 * dt;
  p.move(0, pitch, game.state.speed * dt);
  p.rotate(0, 0, -roll * 0.5);

  if (input.key('space') && game.state.boost > 0) {
    game.state.speed = 35;
    game.state.boost -= dt * 0.4;
  } else {
    game.state.speed = game.lerp(game.state.speed, 20, dt * 2);
  }

  game.ui.text('score', \`\${game.state.score}\`, { x: 'center', size: 36 });
  game.ui.bar('boost', game.state.boost, { label: 'Boost', color: '#ffaa22' });
  game.ui.text('speed', \`\${Math.floor(game.state.speed)} m/s\`, { x: 'right' });
  if (game.state.missed >= 3) game.over(\`Score \${game.state.score}\`);
});
`,
    }),
  },
  {
    id: 'platform-run',
    name: 'Leap',
    blurb: 'First-person platformer with a mirror. Shows physics, painting, level design.',
    files: (title) => ({
      'README.md': readme(title, 'Jump across platforms to reach the top. The mirror lets you change how you look. WASD to move, space to jump, mouse to look.'),
      'game.json': JSON.stringify({ background: '#87CEEB', ambient: 0.5, sun: 1, gravity: -24 }, null, 2) + '\n',
      'scene.json': sceneJson(
        { background: '#87CEEB', ambient: 0.5, sun: 1.0, sunDirection: [-0.5, -1.5, -1], shadows: true, gravity: -24, physics: 'simple' },
        {
          ground: { id: 'ground', type: 'plane', name: 'Ground', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { width: 30, depth: 30 }, material: { color: '#6a9f4b' }, physics: 'static', components: {}, behaviors: [], data: {} },
          plat_1: { id: 'plat_1', type: 'box', name: 'Step 1', transform: { position: [4, 1.5, 4], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { size: [3, 0.4, 3] }, material: { color: '#b7a07a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          plat_2: { id: 'plat_2', type: 'box', name: 'Step 2', transform: { position: [8, 3, 8], rotation: [0, 15, 0], scale: [1, 1, 1] }, shape: { size: [3, 0.4, 3] }, material: { color: '#b7a07a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          plat_3: { id: 'plat_3', type: 'box', name: 'Step 3', transform: { position: [5, 5, 12], rotation: [0, -10, 0], scale: [1, 1, 1] }, shape: { size: [3, 0.4, 3] }, material: { color: '#c8b898' }, physics: 'static', components: {}, behaviors: [], data: {} },
          plat_4: { id: 'plat_4', type: 'box', name: 'Moving Platform', transform: { position: [0, 7, 14], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { size: [4, 0.4, 2] }, material: { color: '#4a8aaa' }, physics: 'static', components: {}, behaviors: [{ type: 'oscillate', axis: 'x', range: 6, speed: 1.5 }], data: {} },
          plat_5: { id: 'plat_5', type: 'box', name: 'Step 5', transform: { position: [-5, 9, 10], rotation: [0, 20, 0], scale: [1, 1, 1] }, shape: { size: [3, 0.4, 3] }, material: { color: '#c8b898' }, physics: 'static', components: {}, behaviors: [], data: {} },
          summit: { id: 'summit', type: 'box', name: 'Summit', transform: { position: [-3, 12, 6], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { size: [5, 0.5, 5] }, material: { color: '#e8d8a8', emissive: '#302800' }, physics: 'static', components: {}, behaviors: [], data: { finish: true } },
          mirror: { id: 'mirror', type: 'mirror', name: 'The Mirror', transform: { position: [0, 2, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { width: 2, height: 3 }, components: {}, behaviors: [], data: {} },
          tree_1: { id: 'tree_1', type: 'cylinder', name: 'Tree Trunk', transform: { position: [-8, 1.5, -3], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { radius: 0.3, height: 3 }, material: { color: '#6a4a2a' }, physics: 'static', components: {}, behaviors: [], data: {} },
          tree_top_1: { id: 'tree_top_1', type: 'sphere', name: 'Tree Canopy', transform: { position: [-8, 4, -3], rotation: [0, 0, 0], scale: [2, 1.5, 2] }, shape: { radius: 1.2 }, material: { color: '#2a6a2a' }, components: {}, behaviors: [], data: {} },
          spawn: { id: 'spawn', type: 'spawn', name: 'Player Start', transform: { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, components: {}, behaviors: [], data: { role: 'player' } },
          sun: { id: 'sun', type: 'light', name: 'Warm Light', transform: { position: [10, 15, -5], rotation: [0, 0, 0], scale: [1, 1, 1] }, light: { type: 'point', color: '#ffe4b0', intensity: 0.6, range: 35 }, components: {}, behaviors: [], data: {} },
        },
      ),
      'scripts/platformer.js': `// FPS platformer
game.camera.firstPerson(game.spawn('player'), { height: 1.7 });
game.state.reached = false;

game.onUpdate((dt) => {
  const p = game.player;
  p.walk(game.input.direction(), 7);
  if (game.input.pressed('space')) p.jump(10);

  // Moving platform
  for (const m of game.all('Moving Platform')) {
    m.x = m.data.originX + Math.sin(game.time * 1.5) * 6;
    if (p.standing === m) p.x += Math.cos(game.time * 1.5) * 1.5 * 6 * dt;
  }

  // Finish
  if (!game.state.reached) {
    const summit = game.find('Summit');
    if (summit && p.y > summit.y - 0.5 && Math.abs(p.x - summit.x) < 3 && Math.abs(p.z - summit.z) < 3) {
      game.state.reached = true;
      game.burst(summit.position, { color: '#f4c430', count: 50 });
      game.ui.message('You made it!', 3);
    }
  }

  game.ui.text('height', \`Height \${Math.max(0, p.y).toFixed(1)} m\`, { x: 'right' });
  if (p.y < -10) game.restart();
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
    name: 'Blank',
    blurb: 'A ground, a light and a player you can move. Build anything from here.',
    files: (title) => ({
      'README.md': readme(title, 'A starting point: a ground and a player. WASD to move, space to jump.'),
      'game.json': JSON.stringify({ background: '#9fd3f0' }, null, 2) + '\n',
      'scene.json': sceneJson(
        { background: '#9fd3f0', ambient: 0.3, sun: 0.8, sunDirection: [-1, -2, -1], shadows: true, gravity: -9.81, physics: 'simple' },
        {
          ground: { id: 'ground', type: 'plane', name: 'Ground', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, shape: { width: 30, depth: 30 }, material: { color: '#7aa35a' }, physics: 'static', components: {}, behaviors: [], data: {} },
        },
      ),
      'scripts/main.js': `game.box({ size: [30, 1, 30], y: -0.5, color: '#7aa35a' });

const player = game.capsule({ y: 1, color: '#e07a2f', physics: 'dynamic', name: 'player' });
game.camera.follow(player);

game.onUpdate(() => {
  player.walk(game.input.direction(), 6);
  if (game.input.pressed('space')) player.jump(8);
  if (player.y < -10) game.restart();
});
`,
    }),
  },
];
