// Starter games: what a new game begins as. Each is a few files written against the Hawkes Play API
// (public/play/API.md). Keep them short and playable: they are the first thing a new customer sees run.
export type Template = { id: string; name: string; blurb: string; files: (title: string) => Record<string, string> };

const readme = (title: string, how: string) => `# ${title}

${how}

Scripts are in \`scripts/\`. The Docs tab has the whole scripting API. Ask the assistant for changes ("make the
player faster", "add a double jump", "make enemies chase me"), or generate art, models and sound in the Assets panel
and use them by name, like \`game.model('tree.glb')\` or \`game.sound('coin.mp3')\`.
`;

export const TEMPLATES: Template[] = [
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
