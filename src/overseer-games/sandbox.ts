// The guest sandbox (/play/sandbox, the landing page's "Play now"): the first thing many people play, so it
// has to be fun in the first minutes. It is a new game's world (the round planet, 50 km across, the Overseer's intro
// every time) that happens to have an island in its ocean, Pip, a few things going on, and a quest line that walks a
// new player through the best toys: the 4x4 to the dock, a fish off the pier, the fuel barrels, something beamed down
// from the spawn wheel, and the helicopter up until the island is a speck in the sea on a planet.
//
// Everything that shows is the community library's (by id, like the Overseer's games: the trees, rocks, the hut, the
// pier's planks, the vehicles' bodies, the barrels and crates, the fish, the music and sounds), on the engine's
// modules (terrain, water, vehicles, mayhem, living, events). Laid out on the island's real ground: heights come from
// the same terrain code the engine runs (terrain-core.js), so things stand on it.
// The script (sandbox.js) is the guide: Pip's lines, a reward for each step, the Overseer's words, music and the sea.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
type Things = Record<string, any>;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** The community things the island uses (name -> id): its scripts and the engine find them by these names' words. */
const A = {
  truck: 'a_5b069a758ac32489', speedboat: 'a_de2b49db6c07ddbf', heli: 'a_684d31e9de4bbe07', rocket: 'a_11e8d3df79091171', launchpad: 'a_f8c34d23977960e7',
  oak: 'a_3360deb351df9daa', pine: 'a_384334cd70168ed9', bush: 'a_04e385dd742d5a28', rocks: 'a_19aebee77f37565e', boulder: 'a_dc56946e844c7904',
  flowers: 'a_a7ed659b5ed36b2f', cottage: 'a_e2926729398f5648', bench: 'a_c26613ea7b560e31', fence: 'a_bed4735621add18b', mailbox: 'a_6f2332b9073bd95c',
  lamp: 'a_38cb16892853ae7e', lantern: 'a_58a1cad3c13eb660', barrel: 'a_31e531682f8104f7', crate: 'a_843a91d54da816bf', duck: 'a_84460c8d4b2e652d',
  explosion: 'a_36c3b4b30fbf86a5', planks: 'a_060f6c6ea7f15e43', oldWood: 'a_1f7765105ca832ed', plate: 'a_d6cd6dd006c8c540',
};
export const SANDBOX_ASSETS: Record<string, string> = {
  '4x4-truck.glb': A.truck, 'speedboat.glb': A.speedboat, 'helicopter.glb': A.heli, 'rocket.glb': A.rocket, 'launch-pad.glb': A.launchpad,
  'oak-tree.glb': A.oak, 'pine-tree.glb': A.pine, 'bush.glb': A.bush, 'rock.glb': A.rocks, 'boulder.glb': A.boulder,
  'flower-patch.glb': A.flowers, 'cottage.glb': A.cottage, 'bench.glb': A.bench, 'fence.glb': A.fence, 'mailbox.glb': A.mailbox,
  'street-lamp.glb': A.lamp, 'lantern.glb': A.lantern, 'oil-barrel.glb': A.barrel, 'wooden-crate.glb': A.crate, 'rubber-duck.glb': A.duck,
  'wood-planks.png': A.planks, 'old-wood.png': A.oldWood, 'diamond-plate.png': A.plate,
  // Fish you can catch in the sea (water's fishing finds a model by the fish's id).
  'tuna.glb': 'a_3dfc2c1c930c9d3c', 'snapper.glb': 'a_2dca8b8f15912700', 'salmon.glb': 'a_76d71b002bac2b77', 'swordfish.glb': 'a_96630d7a5f927828', 'tin-can.glb': 'a_6e4f9f1eed67e96b',
  // The Overseer's voice (the community library's "overseer" voice shelf): the intro (modules/overseer/intro.js plays
  // "overseer-intro" when a game has it) and the guide's moments.
  'overseer-intro.mp3': 'a_f5c151efa39d35c9', 'overseer-found-your-way.mp3': 'a_bacd20f46737e756', 'overseer-the-sea-gives.mp3': 'a_e86b71afc8a4d1c7',
  'overseer-destruction.mp3': 'a_96af75c7b29f0446', 'overseer-ask.mp3': 'a_e8eb1d1e6dc695fb', 'overseer-your-world.mp3': 'a_996ee77e57857b6a',
  // ...and the mirror's (modules/mirror plays "overseer-mirror-<step>" with each question, by name).
  'overseer-mirror-open.mp3': 'a_045f8213473256ee', 'overseer-mirror-what.mp3': 'a_c0e328781a118af8', 'overseer-mirror-look.mp3': 'a_994bf59af90bf68b',
  'overseer-mirror-name.mp3': 'a_76a84299626f8402', 'overseer-mirror-view.mp3': 'a_92afa99ab3bb1365', 'overseer-mirror-done.mp3': 'a_7a79bc1e721339aa',
  // The helicopter coming back after a wreck (sandbox.js). (The mirror's remarks and the ship's "Welcome aboard" come
  // from the Overseer's own lines, overseer.js VOICES, in every game.)
  'overseer-a-new-one.mp3': 'a_2e4236a4f60b4f15',
  // Sound: the island (ambience), gentle music, and a sound for each moment. The music and the two loops (2.5 MB) are not
  // fetched until the intro starts (sandbox.js; test/sandbox-audio.test.ts): only the intro voice before that.
  'ocean-waves.mp3': 'a_d998f214d5f7be98', 'forest.mp3': 'a_f69c9b828dba9342', 'meadow.mp3': 'a_58c72e4ca54f1b54', 'ocean-drift.mp3': 'a_dce85c4cf4bb730b',
  'level-up.mp3': 'a_39a9c6daee1e4450', 'power-up.mp3': 'a_67e1ecc6f6db5125', 'confirm.mp3': 'a_d9173a67938251db', 'teleport.mp3': 'a_da988c2a3ef17441',
  'explosion.mp3': 'a_36c3b4b30fbf86a5', 'splash.mp3': 'a_5717103de477ec99', 'wood-break.mp3': 'a_dc0dfae4b6bc1da9', 'bird-chirp.mp3': 'a_671a42a3b6f17705', 'victory.mp3': 'a_59258c64f6975010',
};

// ------------------------------------------------------------------ the ground, as the engine makes it
const PLANET = { sphere: true, radius: 50000, biome: 'earth', seabed: -20 };
// A path of dirt from the start down to the dock (it keeps the trees off it and shows the way), the hut's yard, the
// helipad and the barrels' beach cleared.
const path_ = (from: number[], to: number[], step = 4) => { const out: number[] = []; const n = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / step); for (let i = 0; i <= n; i++) out.push(r2(from[0] + ((to[0] - from[0]) * i) / n), r2(from[1] + ((to[1] - from[1]) * i) / n)); return out; };
const HELIPAD = [30, 30];
const TERRAIN = {
  shape: 'island', size: 260, height: 12, seed: 3, detail: 2,
  scatter: { trees: 26, rocks: 8, bushes: 6, seed: 3 },
  add: [{ type: 'flat', at: HELIPAD, radius: 9, height: 6 }],
  edits: [
    ['paint', 2.4, 1, ...path_([2, 0], [24, -2]), ...path_([24, -2], [44, 2]), ...path_([44, 2], [60, 0])],
    ['paint', 2.2, 1, ...path_([14, -1], [28, 22])],
    ['paint', 6, 1, -20, 14],
    ['paint', 7, 1, ...HELIPAD],
  ],
};
let core: any = null;
/** Ground height at x, z on the island (the planet's own numbers: the engine's terrain, curved with the planet). */
function groundAt(x: number, z: number): number {
  if (!core) {
    const ctx: any = { console };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'public', 'play', 'modules', 'terrain', 'terrain-core.js'), 'utf8'), ctx, { filename: 'terrain-core.js' });
    const T = ctx.HawkesTerrainCore;
    core = { T, f: T.generate(TERRAIN, { round: { radius: PLANET.radius, floor: PLANET.seabed } }) };
  }
  return core.T.heightAt(core.f, x, z) ?? 0;
}

/** A thing (scene.json, WORLD.md), static unless it says otherwise. */
function thing(id: string, type: string, name: string, position: number[], more: Record<string, any> = {}) {
  return { id, type, name, physics: ['light', 'spawn', 'text', 'zone', 'waypoint'].includes(type) ? undefined : 'static', ...more, transform: { position: position.map(r2), ...(more.transform ?? {}) } };
}
/** A model from the library, `size` meters tall, standing on the ground at x, z (its position is its middle). One that
 *  stays put collides as its box (not its every triangle: cheaper to step, the same to walk into). */
function model(id: string, name: string, asset: string, x: number, z: number, size: number, more: Record<string, any> = {}, lift = 0) {
  const still = !more.physics || more.physics === 'static';
  return thing(id, 'model', name, [x, groundAt(x, z) + lift + size / 2, z], { ...(still ? { body: { shape: 'box' } } : {}), ...more, shape: { asset, size, ...(more.shape ?? {}) } });
}
const yaw = (deg: number) => ({ rotation: [0, deg, 0] });

// ------------------------------------------------------------------ the quest line: Pip shows the island
const QUEST = {
  id: 'tour', title: 'The island', giver: 'Pip', auto: false,
  text: "Hi, I'm Pip! The Overseer just beamed you onto the best island on the whole planet. Want the tour? It's mostly things that go fast and things that go boom.",
  lines: { accept: "Follow the arrow! I'll wait right here.", progress: 'Keep going, the arrow knows the way!', done: 'You saw everything. Now the planet is yours.', decline: 'Explore first, then come back to me!' },
  steps: [
    // (Walking there counts as much as driving: the 4x4 is just faster. Every step has a place for the arrow and the
    // screen-edge pointer: `marker`, or the goal's own place.)
    { id: 'drive', text: 'Head down the path to the dock (the 4x4 is faster!)', goal: { reach: 'Dock', near: 9 }, done: [{ emit: 'tour', data: { step: 'drive' } }] },
    { id: 'rod', text: 'Walk to the end of the pier and grab the fishing rod', marker: 'rod', goal: { event: 'pickup' } },
    { id: 'fish', text: 'Cast the rod into the sea and catch a fish', goal: { catch: 'any' }, done: [{ emit: 'tour', data: { step: 'fish' } }] },
    { id: 'boom', text: 'Blow up the fuel barrels on the beach with the rocket launcher', marker: 'barrel_1', goal: { event: 'explosion' }, done: [{ emit: 'tour', data: { step: 'boom' } }] },
    { id: 'spawn', text: 'Spawn something (hold Q, or the ➕ button): the Overseer beams it down', goal: { event: 'spawned' }, done: [{ emit: 'tour', data: { step: 'spawn' } }] },
    { id: 'ask', text: 'Tell the Overseer what you want: type it in the chat (try "a castle on the hill")', goal: { event: 'asked' }, done: [{ emit: 'tour', data: { step: 'ask' } }] },
    { id: 'fly', text: 'Take the helicopter up high and look down at the planet', marker: 'heli', goal: { event: 'sandbox-high' }, done: [{ emit: 'tour', data: { step: 'fly' } }] },
  ],
  reward: { score: 100, text: 'The whole planet is yours' },
};

/** The guest sandbox's world. The island (an `island` terrain 260 m across, in a planet-wide ocean 20 m deep) is flat
 *  at y 4 within ~14 m of the start; the path runs east to the dock (the beach at x ~62, the pier out to x 82). */
export const SANDBOX = {
  config: {
    background: '#74b9ea', ambient: 0.78, sun: 1, gravity: -24, time: 'afternoon', motes: '#fff3d6',
    fog: { color: '#a9d4f2', start: 260, end: 2200 },
    planet: PLANET,
    // (The start faces east, down the path to the dock: the Overseer hangs ahead of it, about 15 degrees wide.)
    overseer: { intro: 'always', position: [9700, 4200, -3000] },
    terrain: TERRAIN,
    water: { level: -1.5, waves: 0.15, color: '#1b86b8', fish: 'salt' },
    // Tools come with the tour: none at first (the rocket launcher at the barrels, the rest when it's done).
    player: { view: 'third', tools: [] },
    mayhem: { slowmo: true },
    spawn: { play: true, max: 200 },
    assets: { tree: { ids: [A.oak, A.pine], mix: true }, rock: { ids: [A.rocks, A.boulder], mix: true }, bush: { ids: [A.bush], only: true }, barrel: { ids: [A.barrel], only: true }, crate: { ids: [A.crate], only: true },
      // The blast's sound is the explosion alone: the Overseer's "Destruction is..." voice is labelled "explosion" too, and a word's mix would play it with every blast.
      explosion: { ids: [A.explosion], only: true } },
    quests: [QUEST],
  },
  entities(): Things {
    const out: Things = {};
    const add = (e: any) => { out[e.id] = e; };
    add(thing('start', 'spawn', 'Player start', [-6, groundAt(-6, 0) + 0.2, 0], { data: { role: 'player' }, transform: yaw(90) }));
    // The mirror (modules/mirror): after the Overseer's intro it opens by itself and asks "What are you?", "How do you
    // look?", "What are you called?"; then Pip comes over (sandbox.js). E at it, any time after. It stands on the
    // Overseer's side of the start, facing back: the intro looks past you at the ship from the other side (the mirror
    // is out of that shot until its end, where it's in front of you), and it's where the mirror stands you anyway, so
    // the camera glides from the intro's last shot to the reflection without moving you.
    const ship = [-2600 - -6, 8200 - 0]; // the Overseer's default place (overseer.js), from the start
    const sl = Math.hypot(ship[0], ship[1]);
    const mx = -6 + (ship[0] / sl) * 2.3, mz = (ship[1] / sl) * 2.3;
    add(thing('mirror', 'mirror', 'The mirror', [r2(mx), r2(groundAt(mx, mz) + 1.28), r2(mz)], { shape: { width: 1.5, height: 2.4, character: { steps: ['what', 'look', 'name'], start: 'always', voice: true } }, transform: yaw(Math.round(Math.atan2(-ship[0], -ship[1]) * 180 / Math.PI)) }));
    add({ id: 'pip', type: 'friend', name: 'Pip', shape: { personality: 'a cheerful island guide who loves explosions and fishing', species: 'person', color: '#f59e0b', follow: false, stays: true, lines: ['What a day for it!', 'The 4x4 is right there: walk up and press E.', 'Those fuel barrels on the beach go BOOM.', 'The pier is east, down the path. The rod is at the end of it.', 'There is a helicopter on the hill. From up there you can see the whole planet!'] }, physics: 'dynamic', transform: { position: [-1, r2(groundAt(-1, 2.2) + 0.6), 2.2], rotation: [0, -110, 0] } });
    // The islanders (islanders.js talks for them): friends that stay at their posts, in the mirror's own bodies, text in the chat only.
    const islander = (id: string, name: string, personality: string, what: string, body: string, accent: string, head: string, x: number, z: number, face: number, lift = 0) => add({
      id, type: 'friend', name, physics: 'dynamic', transform: { position: [x, r2(groundAt(x, z) + 1 + lift), z], rotation: [0, face, 0] },
      shape: { personality, species: 'person', follow: false, stays: true, talk: false, look: { what, name, body, accent, head } },
    });
    islander('bobbin', 'Admiral Bobbin', 'a very small, very proud rubber duck, harbourmaster of a harbour with one boat', 'duck', '#facc15', '#f97316', '#111827', 66, -1, 180, 1.2);
    islander('ember', 'Mrs Ember', 'a dry, motherly toaster who runs the post and the weather', 'toaster', '#b8bfcc', '#d9a35f', '#2b2f3a', -10.5, 15, 110);
    islander('rolo', 'Rolo', 'a mild, kind roll-bot who fixes things and will not ask for help', 'rollbot', '#f4c430', '#22d3ee', '#3a3f4b', -34, -27, 200);
    islander('dolores', 'Dolores', 'a blunt, deadpan cactus on the hill who asks for nothing', 'cactus', '#3f9a4a', '#f472b6', '#c2703d', 36, 24, 230);
    islander('channel', 'Channel', 'a fast-talking TV robot, the island\'s one reporter', 'tvbot', '#3a3f4b', '#7dd3fc', '#e5e7eb', 55, -12, 90);
    // The 4x4, ready on the path.
    add({ id: 'jeep', type: 'truck', name: '4x4', shape: { model: A.truck }, material: { color: '#3f7d3a' }, transform: { position: [4, r2(groundAt(4, 6.5) + 1.4), 6.5], rotation: [0, 90, 0] } });
    // Pip's hut and yard, up the slope behind the start.
    // (20 m from the start: its light copy shows there, the full one comes within 12 m, so the first view doesn't download it.)
    add(model('hut', "Pip's hut", A.cottage, -20, 14, 6.5, { transform: yaw(125), shape: { lod: { distance: 12 } } }, -0.2));
    // (Small things show their light copy until you're close: lod.distance.)
    // (And cast no shadow: little things, a phone's shadow map has better things to draw.)
    const near = { lod: { distance: 7 } };
    add(model('bench', 'Bench', A.bench, -13, 9, 0.9, { transform: yaw(130), shape: near, shadow: false }));
    add(model('mailbox', 'Mailbox', A.mailbox, -12.5, 17, 1.3, { transform: yaw(100), shape: near, shadow: false }));
    [[-27, 6], [-14, 22]].forEach(([x, z], i) => add(model(`flowers_${i}`, 'Flowers', A.flowers, x, z, 0.7, { physics: 'none', shape: near, shadow: false })));
    [[-28, 10, 70], [-27.3, 13.6, 82]].forEach(([x, z, r], i) => add(model(`fence_${i}`, 'Fence', A.fence, x, z, 1.1, { transform: yaw(r), shape: near, shadow: false })));
    // The dock: a zone at the foot of the pier (the quest's "Dock"), the pier of planks on posts, lamps, the boat and the rod.
    // The pier runs x 57 to 89: its landward end is buried in the beach (the sand passes its top at x ~59.7), so you walk up onto it.
    const pierY = 0.95;
    add(thing('dock', 'zone', 'Dock', [60, groundAt(60, 0) + 1, 0], { shape: { radius: 8, height: 4 } }));
    add(thing('pier', 'box', 'Pier', [73, pierY, 0], { shape: { size: [32, 0.3, 3.2] }, material: { color: '#efe2d0', texture: A.planks, tile: [10.7, 1] }, data: { surface: 'wood' } }));
    [64, 68, 72, 76, 80, 84, 88].forEach((x) => [-1.5, 1.5].forEach((z, j) => add(thing(`post_${x}_${j}`, 'cylinder', 'Pier post', [x, pierY - 1.9, z], { shape: { radius: 0.16, height: 3.6 }, material: { color: '#8a6a4a', texture: A.oldWood, tile: [1, 2] }, instanced: true }))));
    add(model('lamp_a', 'Street lamp', A.lamp, 61, -2.4, 3.4, { transform: yaw(90) }));
    add(model('lamp_b', 'Street lamp', A.lamp, 61, 2.4, 3.4, { transform: yaw(90) }));
    add(thing('lantern', 'model', 'Lantern', [87.6, pierY + 0.45, 1.3], { shape: { asset: A.lantern, size: 0.6 }, body: { shape: 'box' }, shadow: false }));
    add(thing('sign_board', 'box', 'Sign', [58.5, groundAt(58.5, -3.6) + 1.5, -3.6], { shape: { size: [1.9, 0.75, 0.08] }, material: { color: '#d8b48a', texture: A.planks, tile: [1, 1] }, transform: yaw(-90) }));
    add(thing('sign_post', 'cylinder', 'Sign post', [58.5, groundAt(58.5, -3.6) + 0.6, -3.66], { shape: { radius: 0.07, height: 1.25 }, material: { color: '#6b4a2f', texture: A.oldWood } }));
    add(thing('sign_text', 'text', 'Sign words', [58.44, groundAt(58.5, -3.6) + 1.5, -3.6], { shape: { text: "PIP'S PIER\nfishing · boats", size: 0.2, billboard: false, color: '#3a2614' }, transform: yaw(90) }));
    // The catch board at Pip's pier: it lists your best catches (water's fishing.js), and E there opens the catch log.
    add(thing('catch_board', 'box', 'Catch board', [58.5, groundAt(58.5, 3.6) + 1.5, 3.6], { shape: { size: [1.9, 1.05, 0.08] }, material: { color: '#6b4a2f', texture: A.oldWood, tile: [1, 1] }, transform: yaw(-90), data: { catchBoard: true } }));
    add(thing('catch_board_post', 'cylinder', 'Board post', [58.5, groundAt(58.5, 3.6) + 0.5, 3.66], { shape: { radius: 0.07, height: 1.1 }, material: { color: '#6b4a2f', texture: A.oldWood } }));
    add({ id: 'rod', type: 'tool-pickup', name: 'Fishing rod', shape: { tool: 'rod', respawn: 5 }, transform: { position: [86.5, pierY + 0.2, -0.4] } });
    add({ id: 'boat', type: 'boat', name: 'Speedboat', shape: { model: A.speedboat }, material: { color: '#e5e7eb' }, transform: { position: [73, -1.2, 4.4], rotation: [0, 90, 0] } });
    add(thing('duck', 'model', 'Rubber duck', [77, -1.35, -4], { shape: { asset: A.duck, size: 0.45 }, physics: 'dynamic', data: { density: 0.3 } }));
    // The fuel dump on the beach north of the dock: oil barrels close enough to chain, and crates to smash.
    [[50, -18], [51.2, -18.4], [50.5, -19.5], [51.7, -17.2], [49.6, -16.9]].forEach(([x, z], i) => add(model(`barrel_${i + 1}`, 'Fuel barrel', A.barrel, x, z, 1.15, { physics: 'dynamic', body: { shape: { type: 'cylinder', radius: 0.4, height: 1.15 } }, behaviors: [{ use: 'explosive', radius: 6, force: 22, damage: 60 }], data: { barrel: true } }, 0.05)));
    [[46.5, -21.5, 0], [47.6, -21.6, 20], [47.1, -21.4, 10]].forEach(([x, z, r], i) => add(model(`crate_${i + 1}`, 'Crate', A.crate, x, z, 1, { physics: 'dynamic', body: { shape: { type: 'box', size: [1, 1, 1] } }, transform: yaw(r), behaviors: [{ use: 'breakable', strength: 10, pieces: 8 }] }, i === 2 ? 1.02 : 0.02)));
    // The helipad on the hill, with the helicopter on it.
    const padY = groundAt(HELIPAD[0], HELIPAD[1]);
    add(thing('helipad', 'cylinder', 'Helipad', [HELIPAD[0], padY + 0.08, HELIPAD[1]], { shape: { radius: 5, height: 0.16 }, material: { color: '#9aa3ad', texture: A.plate, tile: [3, 3] }, data: { surface: 'metal' } }));
    add(thing('helipad_h', 'text', 'Helipad mark', [HELIPAD[0], padY + 0.17, HELIPAD[1]], { shape: { text: 'H', size: 2.2, billboard: false, color: '#f4c430' }, transform: { rotation: [90, 90, 0] } }));
    add({ id: 'heli', type: 'helicopter', name: 'Helicopter', shape: { model: A.heli, modelLength: 10 }, material: { color: '#2b5fd9' }, transform: { position: [HELIPAD[0], r2(padY + 1.55), HELIPAD[1]], rotation: [0, 200, 0] } });
    // The rocket on its pad across the island (a toy for later: it reaches the Overseer).
    const rx = -38, rz = -30, ry = groundAt(rx, rz);
    add(thing('launch_pad', 'model', 'Launch pad', [rx, ry + 0.9, rz], { shape: { asset: A.launchpad, size: 1.8 }, body: { shape: 'box' } }));
    add({ id: 'rocket', type: 'rocket', name: 'Rocket', shape: { model: A.rocket }, transform: { position: [rx, r2(ry + 1.8 + 4.75), rz], rotation: [0, 0, 0] } });
    // Animals on the meadows.
    add({ id: 'sheep', type: 'herd', name: 'Sheep', shape: { species: 'sheep', count: 8, radius: 6 }, transform: { position: [8, r2(groundAt(8, 30) + 1), 30] } });
    add({ id: 'cows', type: 'herd', name: 'Cows', shape: { species: 'cow', count: 5, radius: 5 }, transform: { position: [-14, r2(groundAt(-14, -26) + 1), -26] } });
    return out;
  },
};

/** The guide (Pip, the rewards, the Overseer's words, music and the sea): src/overseer-games/sandbox.js; the islanders' lines: islanders.js. */
export const sandboxScript = () => ['sandbox.js', 'islanders.js'].map((f) => fs.readFileSync(path.join(HERE, f), 'utf8').replace(/\r\n/g, '\n')).join('\n');
