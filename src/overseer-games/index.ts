// The Overseer's featured games (src/templates.ts OVERSEER_GAMES): Bot Arena, Sky Racer and Leap. Each is a world
// (scene.json, laid out here), one script (the .js file next to this, its rules, screens and sounds) and things from the
// community library by id (`assets`: art, music, sound effects), so they look and sound like real games with no account:
// /play/t/<id> loads the library's files (games.ts templateAssets), and a game made from one keeps them as its own.
// Every script still plays without its assets (a library row that's gone just goes quiet or falls back to a shape).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Template } from '../templates.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const script = (file: string) => fs.readFileSync(path.join(HERE, file), 'utf8').replace(/\r\n/g, '\n');

type Things = Record<string, any>;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** One thing in a world (scene.json, public/play/WORLD.md). Static unless it says otherwise. */
function thing(id: string, type: string, name: string, position: number[], more: Record<string, any> = {}) {
  return { id, type, name, physics: ['light', 'spawn', 'text', 'waypoint'].includes(type) ? undefined : 'static', ...more, transform: { position, ...(more.transform ?? {}) } };
}
/** A model from the game's assets (by id), `size` meters tall, standing on `ground` (its position is its middle). */
function model(id: string, name: string, asset: string, at: [number, number, number], size: number, more: Record<string, any> = {}) {
  const pos = [at[0], r1(at[1] + size / 2), at[2]];
  return thing(id, 'model', name, pos, { ...more, shape: { asset, size, ...(more.shape ?? {}) }, transform: { position: pos, ...(more.transform ?? {}) } });
}
function sceneJson(config: object, entities: Things): string {
  return JSON.stringify({ version: 1, modules: { core: '1.0.0' }, config, entities, nextId: Object.keys(entities).length + 1 }, null, 2);
}
const readme = (title: string, how: string) => `# ${title}

${how}

Featured by the Overseer. The art, music and sounds are from the community library (Create > Community): swap any of
them there, or ask the assistant ("make the bots bigger", "add a second lap", "a night version").
`;

// ================================================================== Bot Arena
/** Bot Arena's things from the community library (name -> id). */
const ARENA = {
  robot: 'a_c29db6391cdba86d', crate: 'a_49330bf738535902', barrel: 'a_31e531682f8104f7', core: 'a_974fb1e6842d6b52',
  launcher: 'a_768bd39befcc3c49', dish: 'a_5d355da68a0af4aa', hut: 'a_a6338e38864234f2',
  rocks: 'a_19aebee77f37565e', heart: 'a_5845d887f0d2d30b',
  floor: 'a_d6cd6dd006c8c540', panels: 'a_09daada876d221b0', hex: 'a_d4d9114fe2a5700d', grid: 'a_cef0c0765d377c74',
};
const ARENA_ASSETS: Record<string, string> = {
  'robot.glb': ARENA.robot, 'scifi-crate.glb': ARENA.crate, 'barrel.glb': ARENA.barrel, 'energy-core.glb': ARENA.core,
  'rocket-launcher.glb': ARENA.launcher, 'satellite-dish.glb': ARENA.dish, 'scifi-hut.glb': ARENA.hut,
  'rock.glb': ARENA.rocks, 'heart.png': ARENA.heart,
  'diamond-plate.png': ARENA.floor, 'scifi-panels.png': ARENA.panels, 'hex-pattern.png': ARENA.hex, 'neon-grid.png': ARENA.grid,
  'battle-drive.mp3': 'a_da223e0cc0467d84', 'victory.mp3': 'a_59258c64f6975010', 'game-over.mp3': 'a_65269b057ec298d3',
  'gunshot.mp3': 'a_16f9aad63e535a0e', 'laser-shot.mp3': 'a_a4291ea46060322e', 'reload.mp3': 'a_0abd54d373c7ef5a',
  'explosion.mp3': 'a_36c3b4b30fbf86a5', 'metal-hit.mp3': 'a_aff02339f53ffe26', 'teleport.mp3': 'a_da988c2a3ef17441',
  'heal.mp3': 'a_891a3022cd597f02', 'power-up.mp3': 'a_67e1ecc6f6db5125', 'punch.mp3': 'a_e45bf4ade1e3e10e',
  'level-up.mp3': 'a_39a9c6daee1e4450', 'confirm.mp3': 'a_d9173a67938251db', 'alarm.mp3': 'a_cded24895078f216',
};

function arena(): Things {
  const out: Things = {};
  const half = 28;
  out.floor = thing('floor', 'box', 'Arena floor', [0, -0.2, 0], { shape: { size: [half * 2, 0.5, half * 2] }, material: { color: '#858ea4', texture: ARENA.floor, tile: [12, 12] }, data: { surface: 'metal', keepWithTerrain: true } });
  out.center = thing('center', 'cylinder', 'Arena mark', [0, 0.07, 0], { shape: { radius: 7, height: 0.02 }, material: { color: '#6ff2ff', texture: ARENA.grid, tile: [4, 4], emissive: '#0b3f4a' }, physics: 'none' });
  // Walls of hull panels with a lit strip along the top.
  const sides: [string, number[], number[]][] = [['n', [0, 2, half], [half * 2 + 1, 4, 1]], ['s', [0, 2, -half], [half * 2 + 1, 4, 1]], ['e', [half, 2, 0], [1, 4, half * 2 + 1]], ['w', [-half, 2, 0], [1, 4, half * 2 + 1]]];
  for (const [k, pos, size] of sides) {
    out[`wall_${k}`] = thing(`wall_${k}`, 'box', 'Wall', pos, { shape: { size }, material: { color: '#8d97ad', texture: ARENA.panels, tile: [12, 1] } });
    out[`trim_${k}`] = thing(`trim_${k}`, 'box', 'Wall light', [pos[0], 4.05, pos[2]], { shape: { size: [size[0] + 0.02, 0.1, size[2] + 0.02] }, material: { color: '#22d3ee', emissive: '#22d3ee' }, physics: 'none' });
  }
  // Cover: hull-panel barricades with a lit strip, and sci-fi crates where it matters (each crate is ~24k triangles: a
  // few, big, keep phones fast), pillars with lit rings, and barrels that go up when shot.
  const rows = [[-8, -8, 0], [8, -8, 0], [-10, 6, 90], [10, 6, 90], [0, -2, 0], [-18, 12, 45], [18, -12, 45]];
  rows.forEach(([x, z, r], i) => {
    out[`barrier_${i}`] = thing(`barrier_${i}`, 'box', 'Barricade', [x, 0.75, z], { shape: { size: [4, 1.5, 0.7] }, material: { color: '#9aa4bc', texture: ARENA.panels, tile: [2, 1] }, transform: { position: [x, 0.75, z], rotation: [0, r, 0] }, data: { material: 'metal' } });
    out[`barrier_strip_${i}`] = thing(`barrier_strip_${i}`, 'box', 'Barricade light', [x, 1.53, z], { shape: { size: [4.02, 0.06, 0.72] }, material: { color: '#22d3ee', emissive: '#22d3ee' }, physics: 'none', transform: { position: [x, 1.53, z], rotation: [0, r, 0] } });
  });
  [[-5.4, -9.4, 10], [12.3, -9.2, -15], [-11.6, 9, 30], [1.6, 0.2, 5], [-20.4, 14.6, 40], [20.6, -14.4, 55]].forEach(([x, z, yaw], i) => { out[`crate_${i}`] = model(`crate_${i}`, 'Sci-fi crate', ARENA.crate, [x, 0.05, z], 1.8, { transform: { rotation: [0, yaw, 0] }, shape: { lod: { distance: 14 } } }); });
  [[-14, -14], [14, -14], [-14, 14], [14, 14]].forEach(([x, z], i) => {
    out[`pillar_${i}`] = thing(`pillar_${i}`, 'cylinder', 'Pillar', [x, 2.5, z], { shape: { radius: 1.1, height: 5 }, material: { color: '#9aa4bc', texture: ARENA.panels, tile: [3, 2] } });
    out[`pillar_ring_${i}`] = thing(`pillar_ring_${i}`, 'torus', 'Pillar light', [x, 3.6, z], { shape: { radius: 1.18, thickness: 0.1 }, material: { color: '#22d3ee', emissive: '#22d3ee' }, physics: 'none' });
  });
  [[6, 3], [6.9, 3.6], [6.3, 4.3], [-9.5, -13], [-8.6, -13.6], [16, 15], [16.8, 14.2], [-20, 2], [-19.2, 1.4]].forEach(([x, z], i) => { out[`barrel_${i + 1}`] = { id: `barrel_${i + 1}`, type: 'barrel', name: 'Barrel', shape: { power: 5 }, transform: { position: [x, 0.65, z] } }; });
  // The tower: a deck on four legs, the launch pad up to it, the rocket launcher on top.
  out.tower = thing('tower', 'box', 'Sniper tower', [0, 4, 18], { shape: { size: [6, 0.6, 6] }, material: { color: '#c7b8ff', texture: ARENA.hex, tile: [2, 2] } });
  [[-2.6, 15.4], [2.6, 15.4], [-2.6, 20.6], [2.6, 20.6]].forEach(([x, z], i) => { out[`tower_leg_${i}`] = thing(`tower_leg_${i}`, 'cylinder', 'Tower leg', [x, 1.85, z], { shape: { radius: 0.22, height: 3.7 }, material: { color: '#3a4256' } }); });
  out.tower_trim = thing('tower_trim', 'box', 'Tower light', [0, 4.32, 18], { shape: { size: [6.05, 0.06, 6.05] }, material: { color: '#a855f7', emissive: '#a855f7' }, physics: 'none' });
  out.pad = thing('pad', 'cylinder', 'Launch pad', [0, 0.1, 12], { shape: { radius: 1.2, height: 0.16 }, material: { color: '#22d3ee', texture: ARENA.grid, emissive: '#0b5a6a' }, behaviors: [{ use: 'launch', power: 16, to: [0, 4.3, 17.2] }, { use: 'glow', color: '#22d3ee', speed: 2 }] });
  out.launcher = model('launcher', 'Rocket launcher', ARENA.launcher, [0, 4.6, 18], 1.3, { physics: 'none', shadow: false, transform: { rotation: [0, 0, 75] }, behaviors: [{ use: 'pickup', gives: 'weapon', weapon: 'launcher', respawn: 30 }] });
  // The shotgun in a crate on a pedestal; health and power cores around the edge.
  out.shotgun_stand = thing('shotgun_stand', 'cylinder', 'Pedestal', [-18, 0.45, -6], { shape: { radius: 0.55, height: 0.9 }, material: { color: '#3a4256', emissive: '#3a1a08' } });
  out.shotgun = model('shotgun', 'Shotgun crate', ARENA.crate, [-18, 1.05, -6], 0.75, { physics: 'none', shadow: false, material: { emissive: '#ff8a3d' }, behaviors: [{ use: 'pickup', gives: 'weapon', weapon: 'shotgun', respawn: 20 }] });
  out.shotgun_sign = thing('shotgun_sign', 'text', 'Shotgun sign', [-18, 2.4, -6], { shape: { text: 'SHOTGUN', size: 0.28 } });
  for (const [id, x, z] of [['health_a', 16, -14], ['health_b', -16, 14], ['health_c', 24, 6]] as const) out[id] = thing(id, 'sprite', 'Health', [x, 1, z], { shape: { image: ARENA.heart, size: 0.9 }, behaviors: [{ use: 'pickup', gives: 'health', amount: 40, respawn: 18 }] });
  for (const [id, x, z] of [['ammo_a', 18, 8], ['ammo_b', -8, -18]] as const) out[id] = model(id, 'Power core', ARENA.core, [x, 0.25, z], 0.9, { physics: 'none', shadow: false, behaviors: [{ use: 'pickup', gives: 'ammo', amount: 40, respawn: 12 }] });
  // The bot every gate copies: a robot with the "enemy" behavior.
  out.bot = model('bot', 'Bot', ARENA.robot, [0, 0.05, 6], 1.9, { physics: 'dynamic', tag: 'bot', behaviors: [{ use: 'enemy', hp: 60, speed: 3.6, range: 13, damage: 5, rate: 1.4 }] });
  // Three gates the Overseer beams bots through, each with a hut behind it.
  for (const [id, x, z, hx, hz, yaw] of [['gate_a', 22, 22, 24.5, 24.5, 225], ['gate_b', -22, 22, -24.5, 24.5, 135], ['gate_c', 22, -2, 25, -2, 270]] as const) {
    out[id] = thing(id, 'cylinder', 'Bot gate', [x, 0.12, z], { shape: { radius: 1.4, height: 0.16 }, material: { color: '#ff3b5c', texture: ARENA.grid, emissive: '#5a0a1a' }, behaviors: [{ use: 'spawner', of: 'bot', every: 7, max: 2, spread: 0.6 }, { use: 'glow', color: '#ff3b5c', speed: 1.2 }] });
    out[`${id}_hut`] = model(`${id}_hut`, 'Bot hut', ARENA.hut, [hx, 0.05, hz], 3.2, { shadow: false, transform: { rotation: [0, yaw, 0] } });
  }
  // Dishes beyond the walls.
  [[-36, 34, 30], [38, 30, -40]].forEach(([x, z, yaw], i) => { out[`dish_${i}`] = model(`dish_${i}`, 'Satellite dish', ARENA.dish, [x, -0.5, z], 9, { shadow: false, transform: { rotation: [0, yaw, 0] } }); });
  out.lamp_a = thing('lamp_a', 'light', 'Blue light', [-14, 6, -10], { light: { type: 'point', color: '#4a9eff', intensity: 0.9, range: 26 } });
  out.lamp_b = thing('lamp_b', 'light', 'Red light', [14, 6, 14], { light: { type: 'point', color: '#ff4060', intensity: 0.8, range: 24 } });
  out.lamp_c = thing('lamp_c', 'light', 'Violet light', [0, 7, 18], { light: { type: 'point', color: '#a855f7', intensity: 0.8, range: 20 } });
  out.start = thing('start', 'spawn', 'Player start', [0, 0.15, -20], { data: { role: 'player' } });
  out.sign = thing('sign', 'text', 'Sign', [0, 3.2, -26.5], { shape: { text: 'BOT ARENA\nClear 25 bots', size: 0.6, billboard: false } });
  return out;
}

const botArena: Template = {
  id: 'fps-arena',
  name: 'Bot Arena',
  featured: { emoji: '🎯' },
  blurb: 'A first-person arena on a far planet at dusk: robots beamed in by the Overseer, a shotgun, a rocket launcher on the tower, barrels that blow. Clear 25, three lives.',
  assets: ARENA_ASSETS,
  files: (title) => ({
    'README.md': readme(title, 'Bot Arena is built from parts anyone can use: the robots are a model with the "enemy" behavior, the red gates have "spawner", the hearts, power cores and weapons are "pickup", the barrels are Mayhem\'s, and you carry a rifle from the world\'s player settings. scripts/arena.js keeps score, lives and the sounds.'),
    'scene.json': sceneJson({
      background: '#2a2140', ambient: 0.85, sun: 0.9, gravity: -24, time: 18.4,
      fog: { color: '#5a4a6e', start: 70, end: 260 }, motes: '#ffd2a8',
      terrain: { shape: 'mountains', height: 70, size: 600, detail: 6, seed: 7, road: false, colors: { grass: '#6e5a4a', dirt: '#5e4a40', rock: '#4a4050', sand: '#8a7460' }, scatter: { trees: 0, bushes: 0, rocks: 70, seed: 7 }, add: [{ type: 'flat', at: [0, 0], radius: 52, height: -0.6 }] },
      planet: { biome: 'desert' },
      player: { view: 'first', weapon: 'rifle', speed: 7, jump: 1.4 },
      juice: { boom: 1.3 },
      rewind: false,
      assets: { rock: { ids: [ARENA.rocks], only: true }, barrel: { ids: [ARENA.barrel], only: true } },
    }, arena()),
    'scripts/arena.js': script('bot-arena.js'),
  }),
};

// ================================================================== Sky Racer
const RACE = {
  ship: 'a_ce4fadc38685c1cb', balloon: 'a_f26730620de17bfe', tower: 'a_35f0b66a09575340', pine: 'a_384334cd70168ed9',
  rocks: 'a_19aebee77f37565e', crystal: 'a_47c3c0afc06ec8dc', glider: 'a_2613ff0eed96a504', hex: 'a_d4d9114fe2a5700d',
};
const RACE_ASSETS: Record<string, string> = {
  'spaceship.glb': RACE.ship, 'hot-air-balloon.glb': RACE.balloon, 'watchtower.glb': RACE.tower, 'pine-tree.glb': RACE.pine,
  'rock.glb': RACE.rocks, 'crystal-cluster.glb': RACE.crystal, 'glider.glb': RACE.glider, 'hex-pattern.png': RACE.hex,
  'synthwave.mp3': 'a_982d70c7ce041735', 'victory.mp3': 'a_59258c64f6975010', 'game-over.mp3': 'a_65269b057ec298d3',
  'gate.mp3': 'a_67e1ecc6f6db5125', 'boost.mp3': 'a_a26a1fe8d5831503', 'tick.mp3': 'a_145f48c4a6cf800f', 'go.mp3': 'a_d9173a67938251db',
  'level-up.mp3': 'a_39a9c6daee1e4450', 'alarm.mp3': 'a_cded24895078f216', 'error.mp3': 'a_8ad8bf4a2a9ef85c',
};
/** The course down the valley: gates weaving left and right, up and down, each pointing at the next; then the finish. */
const GATES = 24;
const gateAt = (i: number) => [r1(Math.sin(i * 0.5) * 24 + Math.sin(i * 1.3) * 6), r1(14 + Math.sin(i * 0.8) * 7 + Math.sin(i * 0.31) * 4), r1(24 + i * 30)];
function raceCourse(): Things {
  const out: Things = {};
  const colors = ['#22d3ee', '#a855f7', '#ff4ad8', '#f4c430'];
  for (let i = 0; i < GATES; i++) {
    const p = gateAt(i), q = gateAt(i + 1);
    const yaw = Math.round((Math.atan2(q[0] - p[0], q[2] - p[2]) * 180) / Math.PI);
    const c = colors[i % colors.length];
    out[`gate_${i + 1}`] = thing(`gate_${i + 1}`, 'torus', `Gate ${i + 1}`, p, { shape: { radius: 4.4, thickness: 0.4 }, material: { color: c, emissive: c }, physics: 'none', transform: { position: p, rotation: [90, yaw, 0] }, behaviors: [{ use: 'gate', points: 100, next: i + 1 < GATES ? `gate_${i + 2}` : 'finish' }] });
  }
  const f = gateAt(GATES);
  out.finish = thing('finish', 'waypoint', 'Finish', [f[0], f[1] - 1.5, f[2]], { shape: { radius: 6 }, data: { role: 'finish', message: 'Race complete!' } });
  out.finish_ring = thing('finish_ring', 'torus', 'Finish ring', f, { shape: { radius: 7, thickness: 0.6 }, material: { color: '#ffffff', emissive: '#ffe08a' }, physics: 'none', transform: { position: f, rotation: [90, 0, 0] }, behaviors: [{ use: 'glow', color: '#ffe08a', speed: 2 }] });
  // Hot air balloons drifting over the valley, watchtowers and crystals on its floor, a glider circling.
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 60 + i * 105, x = side * (34 + (i * 11) % 20), y = 22 + (i * 7) % 16;
    out[`balloon_${i}`] = model(`balloon_${i}`, 'Hot air balloon', RACE.balloon, [x, y, z], 9, { physics: 'none', behaviors: [{ use: 'bob', height: 1.2, speed: 0.2 + (i % 3) * 0.07 }, { use: 'spin', speed: 4 * side }] });
  }
  for (let i = 0; i < 3; i++) {
    const g = gateAt(4 + i * 8), side = i % 2 ? 1 : -1;
    out[`tower_${i}`] = model(`tower_${i}`, 'Watchtower', RACE.tower, [r1(g[0] + side * 14), 0, g[2]], 11, { transform: { rotation: [0, i * 40, 0] } });
    out[`crystal_${i}`] = model(`crystal_${i}`, 'Crystal cluster', RACE.crystal, [r1(g[0] - side * 12), 0, g[2] + 14], 4, { physics: 'none', material: { emissive: '#3b6cff' } });
  }
  out.glider = model('glider', 'Glider', RACE.glider, [30, 40, 200], 3, { physics: 'none', behaviors: [{ use: 'patrol', points: [[30, 40, 200], [-30, 44, 320], [30, 42, 440], [-30, 40, 560]], speed: 8 }] });
  return out;
}

const skyRacer: Template = {
  id: 'sky-racer',
  name: 'Sky Racer',
  featured: { emoji: '🛩️' },
  blurb: 'Race a starship down a sunset valley through 24 glowing gates. Each gate buys time; boost with space, beat your best.',
  assets: RACE_ASSETS,
  files: (title) => ({
    'README.md': readme(title, 'Sky Racer: the player flies (player settings: mode "flight"), the gates are rings with the "gate" behavior, each pointing at the next, and the finish is a waypoint. The valley is terrain, its trees and rocks the community\'s. scripts/race.js keeps the clock (every gate adds time), the countdown, your ship and the sounds.'),
    'scene.json': sceneJson({
      background: '#ff9a6a', ambient: 0.9, sun: 1, time: 18.9,
      fog: { color: '#e8907a', start: 120, end: 520 }, motes: '#ffd9b0',
      terrain: { shape: 'valley', height: 80, size: 1100, center: [0, 330], detail: 6, seed: 4, colors: { grass: '#5d7f3e', dirt: '#7a5b3e', rock: '#6a5560' }, scatter: { trees: 160, rocks: 40, bushes: 0, seed: 4 } },
      planet: { biome: 'forest' },
      player: { mode: 'flight', view: 'third', speed: 24, distance: 7 },
      rewind: false,
      assets: { tree: { ids: [RACE.pine], only: true }, rock: { ids: [RACE.rocks], only: true } },
    }, {
      start_pad: thing('start_pad', 'cylinder', 'Start pad', [0, 13.6, -12], { shape: { radius: 4, height: 0.6 }, material: { color: '#d8ccff', texture: RACE.hex, tile: [2, 2], emissive: '#221050' } }),
      start_ring: thing('start_ring', 'torus', 'Start ring', [0, 13.95, -12], { shape: { radius: 4.05, thickness: 0.12 }, material: { color: '#22d3ee', emissive: '#22d3ee' }, physics: 'none' }),
      start: thing('start', 'spawn', 'Start', [0, 14.2, -12], { data: { role: 'player' } }),
      ...raceCourse(),
    }),
    'scripts/race.js': script('sky-racer.js'),
  }),
};

// ================================================================== Leap
const LEAP = {
  planks: 'a_060f6c6ea7f15e43', plate: 'a_d6cd6dd006c8c540', stone: 'a_c2f9d6efb08c842c', coin: 'a_bdd747c0513b38a9', gem: 'a_0f13da54b1166f65',
  cottage: 'a_e2926729398f5648', well: 'a_d2eaa7374e99d9a4', fence: 'a_bed4735621add18b',
  lamp: 'a_38cb16892853ae7e', tower: 'a_35f0b66a09575340', rocket: 'a_11e8d3df79091171', mushroom: 'a_6ec70af4a0070343', flowers: 'a_a7ed659b5ed36b2f',
  oak: 'a_3360deb351df9daa', bush: 'a_04e385dd742d5a28', rocks: 'a_19aebee77f37565e',
};
const LEAP_ASSETS: Record<string, string> = {
  'wood-planks.png': LEAP.planks, 'diamond-plate.png': LEAP.plate, 'stone-bricks.png': LEAP.stone, 'coin.png': LEAP.coin, 'gem.png': LEAP.gem,
  'cottage.glb': LEAP.cottage, 'well.glb': LEAP.well, 'fence.glb': LEAP.fence,
  'street-lamp.glb': LEAP.lamp, 'watchtower.glb': LEAP.tower, 'rocket.glb': LEAP.rocket, 'mushroom.glb': LEAP.mushroom, 'flower-patch.glb': LEAP.flowers,
  'oak-tree.glb': LEAP.oak, 'bush.glb': LEAP.bush, 'rock.glb': LEAP.rocks,
  'arcade.mp3': 'a_3299fe2e5324b5da', 'victory.mp3': 'a_59258c64f6975010', 'game-over.mp3': 'a_65269b057ec298d3',
  'jump.mp3': 'a_c9e890dbc91425e9', 'land.mp3': 'a_c28258cd648961ca', 'coin.mp3': 'a_6c17a4321aa3df80', 'gem.mp3': 'a_2ed3f82f71937a24',
  'checkpoint.mp3': 'a_67e1ecc6f6db5125', 'punch.mp3': 'a_e45bf4ade1e3e10e', 'launch.mp3': 'a_a26a1fe8d5831503', 'level-up.mp3': 'a_39a9c6daee1e4450',
  'alarm.mp3': 'a_cded24895078f216', 'error.mp3': 'a_8ad8bf4a2a9ef85c', 'confirm.mp3': 'a_d9173a67938251db',
};
/** Leap's climb: wooden steps, moving metal platforms, spikes, coins and gems, checkpoints, a launch pad and the summit
 *  with the Overseer's rocket. Starts by a cottage at the foot. */
function climb(): Things {
  const out: Things = {};
  const steps: { p: number[]; size?: number[]; move?: any }[] = [
    { p: [0, 1, -6] }, { p: [4, 2.2, -2] }, { p: [8, 3.4, 2], size: [3, 0.5, 3] }, { p: [6, 4.6, 7], move: { use: 'patrol', axis: 'x', range: 4, speed: 0.7 } },
    { p: [0, 5.8, 10] }, { p: [-5, 7, 8], size: [3, 0.5, 3] }, { p: [-9, 8.2, 3], move: { use: 'patrol', axis: 'z', range: 3.5, speed: 0.8 } },
    { p: [-8, 9.4, -3] }, { p: [-3, 10.6, -6], size: [4, 0.5, 4] }, { p: [2, 11.8, -9], move: { use: 'patrol', axis: 'y', range: 1.6, speed: 0.6 } },
    { p: [6, 13, -6] }, { p: [8, 14.2, -1], size: [3, 0.5, 3] },
  ];
  steps.forEach((s, i) => {
    const size = s.size ?? [2.6, 0.5, 2.6];
    out[`step_${i}`] = thing(`step_${i}`, 'box', s.move ? 'Moving platform' : 'Step', s.p, s.move
      ? { shape: { size }, material: { color: '#9cc8ff', texture: LEAP.plate, tile: [1, 1], emissive: '#0a2a5a' }, physics: 'kinematic', behaviors: [s.move], data: { surface: 'metal' } }
      : { shape: { size }, material: { color: '#f0dcc0', texture: LEAP.planks, tile: [1, 1] }, data: { surface: 'wood' } });
    if (i % 2 === 1) out[`coin_${i}`] = thing(`coin_${i}`, 'sprite', 'Coin', [s.p[0], s.p[1] + 1.1, s.p[2]], { physics: 'static', shape: { image: LEAP.coin, size: 0.7 }, behaviors: [{ use: 'collectible', sound: 'coin.mp3' }, { use: 'bob', height: 0.15, speed: 2 }] });
  });
  // Gems where it's harder: worth five.
  for (const [id, x, y, z] of [['gem_1', -9, 10.2, 3], ['gem_2', 2, 14.4, -9], ['gem_3', 10, 17.5, 0.2]] as const) out[id] = thing(id, 'sprite', 'Gem', [x, y, z], { physics: 'static', shape: { image: LEAP.gem, size: 0.8 }, behaviors: [{ use: 'collectible', points: 5, sound: 'gem.mp3' }, { use: 'bob', height: 0.2, speed: 1.6 }] });
  // Spikes on two of the wide steps: jump over them.
  for (const [i, dx] of [[2, 0.8], [8, -1]] as const) { const p = steps[i].p; out[`spike_${i}`] = thing(`spike_${i}`, 'cone', 'Spikes', [p[0] + dx, p[1] + 0.55, p[2]], { shape: { radius: 0.35, height: 0.6 }, material: { color: '#d0d6e4', emissive: '#4a0a0a' }, behaviors: [{ use: 'hurts', damage: 34 }], data: { material: 'metal' } }); }
  const cp = (id: string, i: number, next: string) => { const p = steps[i].p; return thing(id, 'waypoint', 'Checkpoint', [p[0], p[1] + 0.26, p[2]], { shape: { radius: 1.2 }, data: { role: 'checkpoint', next } }); };
  out.check_1 = cp('check_1', 5, 'check_2');
  out.check_2 = cp('check_2', 8, 'summit');
  out.summit_floor = thing('summit_floor', 'cylinder', 'Summit', [12, 15.4, 4], { shape: { radius: 3.4, height: 0.6 }, material: { color: '#fff4dc', texture: LEAP.stone, tile: [3, 1] }, data: { surface: 'stone' } });
  out.summit = thing('summit', 'waypoint', 'Summit', [12, 15.72, 4], { shape: { radius: 2.4 }, data: { role: 'finish', message: 'You reached the summit!' } });
  out.rocket = model('rocket', 'The Overseer\'s rocket', LEAP.rocket, [13.8, 15.7, 5.6], 5, { physics: 'none' });
  out.pad = thing('pad', 'cylinder', 'Launch pad', [10, 14.5, 0.2], { shape: { radius: 0.8, height: 0.15 }, material: { color: '#22d3ee', emissive: '#063a44' }, behaviors: [{ use: 'launch', power: 14 }, { use: 'glow', color: '#22d3ee', speed: 2 }] });
  // The village at the foot of the climb.
  out.cottage = model('cottage', 'Cottage', LEAP.cottage, [-12, 0, -16], 6, { transform: { rotation: [0, 30, 0] } });
  out.well = model('well', 'Well', LEAP.well, [-5, 0, -15], 2.4);
  out.lamp_post = model('lamp_post', 'Street lamp', LEAP.lamp, [3, 0, -11], 3.6);
  [[-8, -20], [-4, -20], [0, -20], [4, -20], [8, -20]].forEach(([x, z], i) => { out[`fence_${i}`] = model(`fence_${i}`, 'Fence', LEAP.fence, [x, 0, z], 1.2); });
  out.tower = model('tower', 'Watchtower', LEAP.tower, [18, 0, -14], 9, { transform: { rotation: [0, -30, 0] } });
  [[-6, -8], [9, -9], [-14, 6], [14, 12], [-2, 16]].forEach(([x, z], i) => { out[`flowers_${i}`] = model(`flowers_${i}`, 'Flowers', LEAP.flowers, [x, 0, z], 0.8, { physics: 'none' }); });
  [[-10, -6], [12, 6], [-15, 12]].forEach(([x, z], i) => { out[`mushroom_${i}`] = model(`mushroom_${i}`, 'Mushroom', LEAP.mushroom, [x, 0, z], 1.6 + i * 0.5); });
  out.start = thing('start', 'spawn', 'Start', [0, 0.2, -14], { data: { role: 'player' } });
  out.sign = thing('sign', 'text', 'Sign', [0, 2.4, -9.5], { shape: { text: 'Reach the summit before sunset\nJump twice: double jump', size: 0.22 } });
  return out;
}

const leap: Template = {
  id: 'platform-run',
  name: 'Leap',
  featured: { emoji: '🏃' },
  blurb: 'A third-person climb from a village to the Overseer\'s rocket before the sun sets: moving platforms, spikes, coins, gems and checkpoints.',
  assets: LEAP_ASSETS,
  files: (title) => ({
    'README.md': readme(title, 'Leap is made of parts: you play in third person with a double jump (player settings), platforms move with "patrol", spikes "hurt", coins and gems are "collectible" (with their sounds), checkpoints and the summit are waypoints joined by their route. The day runs (config.time): reach the top before sunset. scripts/leap.js keeps the clock, coins and the sounds.'),
    'scene.json': sceneJson({
      background: '#3d9ef0', ambient: 0.85, sun: 1, gravity: -24, time: { hour: 15, minutes: 8 },
      fog: { color: '#9ccff2', start: 90, end: 300 }, motes: '#fff6d8',
      terrain: { shape: 'hills', height: 12, size: 260, detail: 2, seed: 9, scatter: { trees: 50, rocks: 20, bushes: 40, seed: 9 }, add: [{ type: 'flat', at: [0, -2], radius: 30, height: 0 }] },
      planet: { biome: 'earth' },
      player: { view: 'third', jump: 2.2, doubleJump: true, speed: 7, distance: 6 },
      rewind: false,
      assets: { tree: { ids: [LEAP.oak], only: true }, rock: { ids: [LEAP.rocks], only: true }, bush: { ids: [LEAP.bush], only: true } },
    }, climb()),
    'scripts/leap.js': script('leap.js'),
  }),
};

export const OVERSEER_GAMES: Template[] = [botArena, skyRacer, leap];
