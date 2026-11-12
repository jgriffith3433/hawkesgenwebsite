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
/** Where the Overseer hangs for this island (config + mirror placement must agree). */
const OVERSEER_AT = [9700, 4200, -3000] as const;

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
// The Ridge Run's gates (the race, below): the scatter keeps its trees off them (painted ground gets none).
const RIDGE: number[][] = [[46, 6], [52, 22], [34, 46], [0, 50], [-30, 42], [-52, 14], [-56, -14], [-40, -44], [-10, -52], [18, -46], [28, -26], [32, -6]];
// Pip's hut stands on a level yard (its slope left it half buried uphill and floating downhill: quality rule 4).
const HUT = [-20, 14];
// Island PBR material set (public/play/materials/island): Gen albedos + maps. Until manifest.ready, splat still blends
// by height/slope/road with distinct stand-in colours; footsteps keep grass/dirt/rock/sand names (wet sand → sand).
const ISLAND_MATS = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'play', 'materials', 'island', 'manifest.json'), 'utf8')); }
  catch { return { ready: false, bytes: {} }; }
})();
const MAT_BASE = '/play/materials/island';
const matFile = (id: string) => `${MAT_BASE}/${id}.webp`;
const TERRAIN = {
  shape: 'island', size: 260, height: 12, seed: 3, detail: 2,
  // Softer tile + distance detail + macro so the meadow does not repeat from the air (Uncharted-style).
  tile: 6,
  macro: { tile: 56 },
  splat: { triplanar: true, detailNear: 8, detailFar: 36, force: true, bytes: ISLAND_MATS.bytes || {} },
  // Distinct colours while Gen textures are pending; replaced by real maps when manifest.ready.
  colors: { grass: '#4f8a3a', dirt: '#7a6a55', rock: '#6e6a66', snow: '#8b6f4e', sand: '#d2b87a' },
  ...(ISLAND_MATS.ready ? {
    textures: {
      grass: matFile('grass-albedo'), dirt: matFile('road-albedo'), rock: matFile('rock-albedo'),
      snow: matFile('wet-sand-albedo'), sand: matFile('sand-albedo'),
    },
    maps: {
      grass: { normal: matFile('grass-normal') }, dirt: { normal: matFile('road-normal') },
      rock: { normal: matFile('rock-normal') }, snow: { normal: matFile('wet-sand-normal') },
      sand: { normal: matFile('sand-normal') },
    },
  } : {}),
  scatter: { trees: 26, rocks: 8, bushes: 6, seed: 3 },
  add: [{ type: 'flat', at: HELIPAD, radius: 9, height: 6 }, { type: 'flat', at: HUT, radius: 5.5, height: 5.75 }],
  edits: [
    ['paint', 2.4, 1, ...path_([2, 0], [24, -2]), ...path_([24, -2], [44, 2]), ...path_([44, 2], [60, 0])],
    ['paint', 2.2, 1, ...path_([14, -1], [28, 22])],
    ['paint', 6, 1, -20, 14],
    ['paint', 7, 1, ...HELIPAD],
    ['paint', 5, 1, ...RIDGE.flat()],
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
/** A small prop that breaks into pieces under a 4x4 (strength m/s) or a blast, topples in a weaker blast and is rebuilt out
 *  of view after `rebuild` seconds (modules/mayhem: mayhem-props.js). Quest things never get this. */
const smash = (material: string, color: string, o: { strength?: number; pieces?: number; blast?: number; with?: string[] } = {}) => ({
  behaviors: [{ use: 'breakable', strength: o.strength ?? 4, pieces: o.pieces ?? 6, blast: o.blast ?? 14 }],
  data: { color, prop: { material, rebuild: 120, ...(o.with ? { with: o.with } : {}) } },
});

// ------------------------------------------------------------------ the quest line: Pip shows the island
const QUEST = {
  // quiet: Pip, the arrow and the tracker tell it; no quest banner or step toast on top (quality rule 6).
  id: 'tour', title: 'The island', giver: 'Pip', auto: false, quiet: true,
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
    // Chapter One's quests 6 to 8 (docs/story.md section 5): Dolores on the hill, the helicopter, Rolo's rocket.
    { id: 'hill', text: 'Walk up the hill and say hello to Dolores', marker: 'dolores', goal: { event: 'sandbox-hill' }, done: [{ emit: 'tour', data: { step: 'hill' } }] },
    { id: 'fly', text: 'Take the helicopter up high and look down at the planet', marker: 'heli', goal: { event: 'sandbox-high' }, done: [{ emit: 'tour', data: { step: 'fly' } }] },
    { id: 'launch', text: "Fill Rolo's rocket, fire it and go up until the planet is whole", marker: 'rocket', goal: { event: 'sandbox-planet' }, done: [{ emit: 'tour', data: { step: 'launch' } }] },
  ],
  reward: { score: 100, text: 'The whole planet is yours' },
};

// ------------------------------------------------------------------ the races (modules/race, config.race)
// Two loops of lit gates that start by the dock. The first gate of each is the start and the finish line; the gates
// face the way you drive (from the one before to the one after). Heights come from the island's own ground (land) or
// the sea's level (water), so the pillars stand on it. Pip's `par` is the time to beat until you have your own.
// (Lengths: Ridge Run ~330 m a lap in the 4x4 (top 32 m/s, bends and hills: ~21 s a lap); Harbour Run ~600 m a lap in the
// speedboat (top 26 m/s: ~33 s a lap).)
const HARBOUR: number[][] = [[108, 0], [95, 46], [58, 80], [8, 92], [-42, 80], [-79, 46], [-92, 0], [-79, -46], [-42, -80], [8, -92], [58, -80], [95, -46]];
const SEA_LEVEL = -1.5;
export const RACES = {
  courses: [
    { id: 'ridge', name: 'Ridge Run', vehicle: 'wheeled', laps: 3, width: 14, color: '#34d399', par: 80000, rival: 'Pip', gates: RIDGE.map(([x, z]) => [x, z, r2(groundAt(x, z))]) },
    { id: 'harbour', name: 'Harbour Run', vehicle: 'boat', laps: 2, width: 24, color: '#38bdf8', par: 72000, rival: 'Pip', gates: HARBOUR.map(([x, z]) => [x, z, SEA_LEVEL]) },
  ],
  // (Sounds: the library's own where the island has them; the module beeps by itself otherwise.)
  sounds: { go: 'power-up.mp3', finish: 'level-up.mp3', best: 'victory.mp3' },
};

/** The guest sandbox's world. The island (an `island` terrain 260 m across, in a planet-wide ocean 20 m deep) is flat
 *  at y 4 within ~14 m of the start; the path runs east to the dock (the beach at x ~62, the pier out to x 82). */
export const SANDBOX = {
  config: {
    // Clock runs for islander routines (living.js); light stays fixed so the island keeps its afternoon look.
    background: '#74b9ea', ambient: 0.78, sun: 1, gravity: -24, time: { hour: 15.5, day: 120, light: false }, motes: '#fff3d6',
    // The light stack (modules/lighting): a low golden sun, cascaded soft shadows, sky reflections, ACES, bloom and the grade of the hour.
    lighting: { hour: 16.9 },
    // The painted sky (modules/overseer/skypaint.js): four panoramas crossfaded by the clock, loaded after the first frame.
    skyPaint: true,
    // The island moves on its own (modules/wind): gusts across the meadow, grass pushed aside, petals; gulls over the beach that scatter,
    // butterflies in the clearing by day, fireflies there at night, a fish that jumps off the pier.
    wind: true,
    wildlife: { gulls: [68, -2], clearing: [-4, 0, 12], pier: [80, 0] },
    fog: { color: '#a9d4f2', start: 260, end: 2200 },
    planet: PLANET,
    // (The start faces east, down the path to the dock: the Overseer hangs ahead of it, about 15 degrees wide.)
    overseer: { intro: 'always', position: [...OVERSEER_AT], cascade: ['pip', 'hut', 'jeep', 'boat', 'heli', 'rocket'] },
    terrain: TERRAIN,
    water: { level: -1.5, waves: 0.3, color: '#1b86b8', fish: 'salt' },
    // Tools come with the tour: none at first (the rocket launcher at the barrels, the rest when it's done).
    player: { view: 'third', tools: [] },
    mayhem: { slowmo: true },
    // "Share this moment" (modules/share/moments.js): the last 8 seconds of a big blast, a first catch, a long jump or a dock.
    share: { clip: 8 },
    spawn: { play: true, max: 200 },
    assets: { tree: { ids: [A.oak, A.pine], mix: true }, rock: { ids: [A.rocks, A.boulder], mix: true }, bush: { ids: [A.bush], only: true }, barrel: { ids: [A.barrel], only: true }, crate: { ids: [A.crate], only: true },
      // The blast's sound is the explosion alone: the Overseer's "Destruction is..." voice is labelled "explosion" too, and a word's mix would play it with every blast.
      explosion: { ids: [A.explosion], only: true } },
    quests: [QUEST],
    race: RACES,
  },
  entities(): Things {
    const out: Things = {};
    const add = (e: any) => { out[e.id] = e; };
    add(thing('start', 'spawn', 'Player start', [-6, groundAt(-6, 0) + 0.2, 0], { data: { role: 'player' }, transform: yaw(90) }));
    // The mirror (modules/mirror): after the Overseer's intro it opens by itself and asks "What are you?", "How do you
    // look?", "What are you called?"; then Pip comes over (sandbox.js). E at it, any time after. It stands on the
    // Overseer's side of the start, facing back. On landscape the look-up crops it out; on portrait intro.js hides it
    // for the sky look so its grey frame cannot fill the shot, then shows it again when the camera settles on it.
    const ship = [OVERSEER_AT[0] - -6, OVERSEER_AT[2] - 0]; // same place as config.overseer.position, from the start
    const sl = Math.hypot(ship[0], ship[1]) || 1;
    const mx = -6 + (ship[0] / sl) * 2.3, mz = (ship[1] / sl) * 2.3;
    add(thing('mirror', 'mirror', 'The mirror', [r2(mx), r2(groundAt(mx, mz) + 1.28), r2(mz)], { shape: { width: 1.5, height: 2.4, character: { steps: ['what', 'look', 'name'], start: 'always', voice: true } }, transform: yaw(Math.round(Math.atan2(-ship[0], -ship[1]) * 180 / Math.PI)) }));
    add({ id: 'pip', type: 'friend', name: 'Pip', shape: { personality: 'a cheerful island guide who loves explosions and fishing', species: 'person', color: '#f59e0b', follow: false, stays: true, lines: ['What a day for it!', 'The 4x4 is right there: walk up and press E.', 'Those fuel barrels on the beach go BOOM.', 'The pier is east, down the path. The rod is at the end of it.', 'There is a helicopter on the hill. From up there you can see the whole planet!'] }, physics: 'dynamic', transform: { position: [-1, r2(groundAt(-1, 2.2) + 0.6), 2.2], rotation: [0, -110, 0] } });
    // The islanders (islanders.js talks for them): friends that stay on the island, in the mirror's own bodies, with a
    // clock-driven routine of named spots (living.js think; shape.stays still blocks random wander). Offsets stagger
    // their walks so they do not meet on the same path.
    const islander = (id: string, name: string, personality: string, what: string, body: string, accent: string, head: string, x: number, z: number, face: number, routine: { spots: { id: string; at: number[]; do: string; face?: number }[]; offset?: number }, lift = 0) => add({
      id, type: 'friend', name, physics: 'dynamic', transform: { position: [x, r2(groundAt(x, z) + 1 + lift), z], rotation: [0, face, 0] },
      shape: { personality, species: 'person', follow: false, stays: true, talk: false, look: { what, name, body, accent, head }, routine: { notice: 6, leave: 7.5, ...routine } },
    });
    islander('bobbin', 'Admiral Bobbin', 'a very small, very proud rubber duck, harbourmaster of a harbour with one boat', 'duck', '#facc15', '#f97316', '#111827', 66, -1, 180, {
      offset: 0,
      spots: [
        { id: 'pier-end', at: [84, -0.5], do: 'fish', face: 90 },
        { id: 'harbour-desk', at: [63, 4.8], do: 'sit', face: 0 },
        { id: 'dock', at: [58, -1.2], do: 'wave', face: 180 },
      ],
    }, 1.2);
    islander('ember', 'Mrs Ember', 'a dry, motherly toaster who runs the post and the weather', 'toaster', '#b8bfcc', '#d9a35f', '#2b2f3a', -10.5, 15, 110, {
      offset: 4,
      spots: [
        { id: 'mailbox', at: [-11, 16], do: 'idle', face: 100 },
        { id: 'garden', at: [-14, 21.5], do: 'tend', face: 40 },
        { id: 'bench', at: [-12.5, 9.5], do: 'sit', face: 130 },
      ],
    });
    islander('rolo', 'Rolo', 'a mild, kind roll-bot who fixes things and will not ask for help', 'rollbot', '#f4c430', '#22d3ee', '#3a3f4b', -34, -27, 200, {
      offset: 8,
      spots: [
        { id: 'rocket', at: [-36, -28], do: 'tend', face: 200 },
        { id: 'slip', at: [-37.5, -22.5], do: 'sit', face: 20 },
        { id: 'pad-side', at: [-30.5, -26], do: 'wave', face: 90 },
      ],
    });
    islander('dolores', 'Dolores', 'a blunt, deadpan cactus on the hill who asks for nothing', 'cactus', '#3f9a4a', '#f472b6', '#c2703d', 36, 24, 230, {
      offset: 12,
      spots: [
        { id: 'hill', at: [36, 24], do: 'sit', face: 230 },
        { id: 'tally-rock', at: [39.5, 27.5], do: 'idle', face: 30 },
        { id: 'pad-edge', at: [24.5, 28], do: 'wave', face: 200 },
      ],
    });
    islander('channel', 'Channel', 'a fast-talking TV robot, the island\'s one reporter', 'tvbot', '#3a3f4b', '#7dd3fc', '#e5e7eb', 55, -12, 90, {
      offset: 16,
      spots: [
        { id: 'beach', at: [55, -12], do: 'wave', face: 90 },
        { id: 'chair', at: [52.5, -5.5], do: 'sit', face: 270 },
        { id: 'barrels', at: [48, -16], do: 'idle', face: 200 },
      ],
    });
    // The 4x4, ready on the path.
    add({ id: 'jeep', type: 'truck', name: '4x4', shape: { model: A.truck }, material: { color: '#3f7d3a' }, transform: { position: [4, r2(groundAt(4, 6.5) + 1.4), 6.5], rotation: [0, 90, 0] } });
    // Pip's hut and yard, up the slope behind the start.
    // (20 m from the start: its light copy shows there, the full one comes within 12 m, so the first view doesn't download it.)
    add(model('hut', "Pip's hut", A.cottage, HUT[0], HUT[1], 6.5, { transform: yaw(125), shape: { lod: { distance: 12 } } }, -0.05));
    // (Small things show their light copy until you're close: lod.distance.)
    // (And cast no shadow: little things, a phone's shadow map has better things to draw.)
    const near = { lod: { distance: 7 } };
    add(model('bench', 'Bench', A.bench, -13, 9, 0.9, { transform: yaw(130), shape: near, shadow: false }));
    add(model('mailbox', 'Mailbox', A.mailbox, -12.5, 17, 1.3, { transform: yaw(100), shape: near, shadow: false }));
    [[-27, 6], [-14, 22]].forEach(([x, z], i) => add(model(`flowers_${i}`, 'Flowers', A.flowers, x, z, 0.7, { physics: 'none', shape: near, shadow: false })));
    [[-28, 10, 70], [-27.3, 13.6, 82]].forEach(([x, z, r], i) => add(model(`fence_${i}`, 'Fence', A.fence, x, z, 1.1, { transform: yaw(r), shape: near, shadow: false, ...smash('wood', '#b08a5a') })));
    // A fence line along the road's north side (x 28 to 40): drive the 4x4 into it and it bursts into planks.
    [28, 31.2, 34.4, 37.6].forEach((x, i) => add(model(`fence_line_${i}`, 'Fence', A.fence, x, 5.5, 1.1, { transform: yaw(0), shape: near, shadow: false, ...smash('wood', '#b08a5a') })));
    // Signposts by the road, and a stack of crates beside it.
    const signpost = (id: string, x: number, z: number, words: string, face: number) => {
      const gy = groundAt(x, z);
      add(thing(`${id}_post`, 'cylinder', 'Signpost', [x, gy + 0.75, z], { shape: { radius: 0.07, height: 1.5 }, material: { color: '#6b4a2f', texture: A.oldWood }, ...smash('wood', '#6b4a2f', { strength: 4, pieces: 5, with: [`${id}_board`, `${id}_text`] }) }));
      add(thing(`${id}_board`, 'box', 'Sign', [x, gy + 1.45, z], { shape: { size: [1.3, 0.55, 0.08] }, material: { color: '#d8b48a', texture: A.planks, tile: [1, 1] }, transform: yaw(face) }));
      const o = 0.06, a = (face * Math.PI) / 180;
      add(thing(`${id}_text`, 'text', 'Sign words', [x + Math.sin(a) * o, gy + 1.45, z + Math.cos(a) * o], { shape: { text: words, size: 0.15, billboard: false, color: '#3a2614', background: false, zOffset: -2 }, transform: yaw(face + 180) }));
    };
    signpost('sign_road_a', 22, -5.2, 'DOCK →', 0);
    signpost('sign_road_b', 42, 5.2, 'BEACH ↓', 0);
    [[36.2, -7.5, 0, 0.02], [37.3, -7.5, 8, 0.02], [36.7, -7.5, 4, 1.04]].forEach(([x, z, r, lift], i) => add(model(`crate_stack_${i + 1}`, 'Crate', A.crate, x, z, 1, { physics: 'dynamic', body: { shape: { type: 'box', size: [1, 1, 1] } }, transform: yaw(r), ...smash('crate', '#a8896a', { strength: 4, pieces: 8, blast: 12 }) }, lift)));
    // The dock: a zone at the foot of the pier (the quest's "Dock"), the pier of planks on posts, lamps, the boat and the rod.
    // The pier runs x 57 to 89: its landward end is buried in the beach (the sand passes its top at x ~59.7), so you walk up onto it.
    const pierY = 0.95;
    add(thing('dock', 'zone', 'Dock', [60, groundAt(60, 0) + 1, 0], { shape: { radius: 8, height: 4 } }));
    // Pier deck gets a zOffset so its underside never flickers against the post tops (quality rule 2).
    // Pier wood: Gen weathered planks when the island PBR set is ready, else the community plank texture.
    add(thing('pier', 'box', 'Pier', [73, pierY, 0], {
      shape: { size: [32, 0.3, 3.2] },
      material: ISLAND_MATS.ready
        ? { color: '#efe2d0', texture: matFile('wood-albedo'), bump: matFile('wood-normal'), tile: [10.7, 1], zOffset: -1 }
        : { color: '#efe2d0', texture: A.planks, tile: [10.7, 1], zOffset: -1 },
      data: { surface: 'wood' },
    }));
    // Each post from under the deck down into the sand or the seabed under it (none floats over the seabed: quality rule 4).
    // Tops sit 2 cm under the deck's underside so the faces are not coplanar.
    [64, 68, 72, 76, 80, 84, 88].forEach((x) => [-1.5, 1.5].forEach((z, j) => {
      const top = pierY - 0.17, bottom = Math.min(top - 0.5, groundAt(x, z) - 0.4), h = r2(top - bottom);
      add(thing(`post_${x}_${j}`, 'cylinder', 'Pier post', [x, (top + bottom) / 2, z], { shape: { radius: 0.16, height: h }, material: { color: '#8a6a4a', texture: A.oldWood, tile: [1, Math.max(1, Math.round(h / 1.8))] }, instanced: true }));
    }));
    add(model('lamp_a', 'Street lamp', A.lamp, 61, -2.4, 3.4, { transform: yaw(90) }));
    add(model('lamp_b', 'Street lamp', A.lamp, 61, 2.4, 3.4, { transform: yaw(90) }));
    add(thing('lantern', 'model', 'Lantern', [87.6, pierY + 0.45, 1.3], { shape: { asset: A.lantern, size: 0.6 }, body: { shape: 'box' }, shadow: false }));
    add(thing('sign_board', 'box', 'Sign', [58.5, groundAt(58.5, -3.6) + 1.5, -3.6], { shape: { size: [1.9, 0.75, 0.08] }, material: { color: '#d8b48a', texture: A.planks, tile: [1, 1] }, transform: yaw(-90) }));
    add(thing('sign_post', 'cylinder', 'Sign post', [58.62, groundAt(58.62, -3.6) + 0.75, -3.6], { shape: { radius: 0.07, height: 1.5 }, material: { color: '#6b4a2f', texture: A.oldWood }, ...smash('wood', '#6b4a2f', { strength: 4, pieces: 5, with: ['sign_board', 'sign_text'] }) }));
    add(thing('sign_text', 'text', 'Sign words', [58.44, groundAt(58.5, -3.6) + 1.5, -3.6], { shape: { text: "PIP'S PIER\nfishing · boats", size: 0.2, billboard: false, color: '#3a2614', background: false, zOffset: -2 }, transform: yaw(90) }));
    // The catch board at Pip's pier: it lists your best catches (water's fishing.js), and E there opens the catch log.
    add(thing('catch_board', 'box', 'Catch board', [58.5, groundAt(58.5, 3.6) + 1.5, 3.6], { shape: { size: [1.9, 1.05, 0.08] }, material: { color: '#6b4a2f', texture: A.oldWood, tile: [1, 1] }, transform: yaw(-90), data: { catchBoard: true } }));
    // Chapter One's small things to notice (sandbox.js: E near them): the pier's hand-cut planks and the harbour desk's logbook.
    add(thing('harbour_desk', 'box', "Harbour desk", [62.5, groundAt(62.5, 5.6) + 0.37, 5.6], { shape: { size: [1.3, 0.9, 0.75] }, material: { color: '#8a6a4a', texture: A.oldWood, tile: [1, 1] }, transform: yaw(90) }));
    add(thing('logbook', 'box', 'Logbook', [62.5, groundAt(62.5, 5.6) + 0.855, 5.6], { shape: { size: [0.4, 0.07, 0.3] }, material: { color: '#3b2a1c' }, transform: yaw(90), shadow: false }));
    // The lore to find (journal.js: E near each; docs/story.md section 7): small objects, a few lines each, in the voice of whoever left them.
    add(thing('lore_rock', 'box', 'Scratched rock', [40.5, groundAt(40.5, 28) + 0.2, 28], { shape: { size: [0.9, 1, 0.7] }, material: { color: '#8b8f96' }, transform: yaw(30), shadow: false }));
    add(thing('lore_slip', 'box', 'Repair slip', [-38, groundAt(-38, -22) + 0.04, -22], { shape: { size: [0.3, 0.02, 0.42] }, material: { color: '#f1ead7', zOffset: -2 }, transform: yaw(20), shadow: false }));
        // A low lounger on the sand, its back on the sea side (it faces the land), the back resting on the seat.
    add(thing('lore_chair', 'box', 'Beach chair', [53, groundAt(53, -5) + 0.02, -5], { shape: { size: [0.7, 0.12, 0.7] }, material: { color: '#e8c15a' }, shadow: false }));
    add(thing('lore_chair_back', 'box', 'Beach chair back', [53.3, groundAt(53, -5) + 0.48, -5], { shape: { size: [0.1, 0.8, 0.7] }, material: { color: '#e8c15a' }, shadow: false }));
    add(thing('lore_drawing', 'box', 'Faded drawing', [48.4, groundAt(48.4, -15.4) + 0.4, -15.4], { shape: { size: [0.06, 0.8, 0.6] }, material: { color: '#d8c9a3' }, transform: yaw(-20), shadow: false }));
    add(thing('catch_board_post', 'cylinder', 'Board post', [58.62, groundAt(58.62, 3.6) + 0.75, 3.6], { shape: { radius: 0.07, height: 1.5 }, material: { color: '#6b4a2f', texture: A.oldWood } }));
    // The race board: the best times of the Ridge Run and Harbour Run on this device (modules/race: E reads it, the sign shows the top).
    add(thing('race_board', 'box', 'Race board', [58.5, groundAt(58.5, 7.6) + 1.5, 7.6], { shape: { size: [1.9, 1.05, 0.08] }, material: { color: '#6b4a2f', texture: A.oldWood, tile: [1, 1] }, transform: yaw(-90), data: { raceBoard: 'ridge' } }));
    add(thing('race_board_post', 'cylinder', 'Board post', [58.62, groundAt(58.62, 7.6) + 0.75, 7.6], { shape: { radius: 0.07, height: 1.5 }, material: { color: '#6b4a2f', texture: A.oldWood } }));
    add({ id: 'rod', type: 'tool-pickup', name: 'Fishing rod', shape: { tool: 'rod', respawn: 5 }, transform: { position: [86.5, pierY + 0.2, -0.4] } });
    add({ id: 'boat', type: 'boat', name: 'Speedboat', shape: { model: A.speedboat }, material: { color: '#e5e7eb' }, transform: { position: [73, -1.2, 4.4], rotation: [0, 90, 0] } });
    add(thing('duck', 'model', 'Rubber duck', [77, -1.35, -4], { shape: { asset: A.duck, size: 0.45 }, physics: 'dynamic', data: { density: 0.3 } }));
    // The fuel dump on the beach north of the dock: oil barrels close enough to chain, and crates to smash.
    [[50, -18], [51.2, -18.4], [50.5, -19.5], [51.7, -17.2], [49.6, -16.9]].forEach(([x, z], i) => add(model(`barrel_${i + 1}`, 'Fuel barrel', A.barrel, x, z, 1.15, { physics: 'dynamic', body: { shape: { type: 'cylinder', radius: 0.4, height: 1.15 } }, behaviors: [{ use: 'explosive', radius: 6, force: 22, damage: 60 }], data: { barrel: true } }, 0.05)));
    [[46.5, -21.5, 0], [47.6, -21.6, 20], [47.1, -21.4, 10]].forEach(([x, z, r], i) => add(model(`crate_${i + 1}`, 'Crate', A.crate, x, z, 1, { physics: 'dynamic', body: { shape: { type: 'box', size: [1, 1, 1] } }, transform: yaw(r), behaviors: [{ use: 'breakable', strength: 10, pieces: 8 }] }, i === 2 ? 1.02 : 0.02)));
    // The pier's loose things: wooden barrels and lobster pots on the deck (they break under a 4x4, topple in a blast and go into
    // the sea: a splash, then wood floats), and one fuel barrel to blow them with. The planks' top is at pierY + 0.15.
    const deck = pierY + 0.15;
    [[66.5, 1.0], [69.5, -1.0], [80.5, 1.0]].forEach(([x, z], i) => add(thing(`lobster_pot_${i + 1}`, 'box', 'Lobster pot', [x, deck + 0.26, z], { shape: { size: [0.7, 0.5, 0.5] }, material: { color: '#8a6a4a', texture: A.oldWood, tile: [1, 1] }, physics: 'dynamic', transform: yaw(i * 40), ...smash('pot', '#8a6a4a', { strength: 4, pieces: 6, blast: 10 }) })));
    [[74.5, -1.0], [77.5, 1.1]].forEach(([x, z], i) => add(thing(`pier_cask_${i + 1}`, 'cylinder', 'Wooden barrel', [x, deck + 0.46, z], { shape: { radius: 0.34, height: 0.92 }, material: { color: '#7a5a3a', texture: A.oldWood, tile: [1, 1] }, physics: 'dynamic', ...smash('wood', '#7a5a3a', { strength: 4, pieces: 6, blast: 12 }) })));
    add(model('barrel_pier', 'Fuel barrel', A.barrel, 72, 0.6, 1.15, { physics: 'dynamic', body: { shape: { type: 'cylinder', radius: 0.4, height: 1.15 } }, behaviors: [{ use: 'explosive', radius: 6, force: 22, damage: 60 }], data: { barrel: true } }, pierY + 0.2));
    // The helipad on the hill, with the helicopter on it.
    const padY = groundAt(HELIPAD[0], HELIPAD[1]);
    add(thing('helipad', 'cylinder', 'Helipad', [HELIPAD[0], padY + 0.08, HELIPAD[1]], { shape: { radius: 5, height: 0.16 }, material: { color: '#9aa3ad', texture: A.plate, tile: [3, 3], zOffset: -1 }, data: { surface: 'metal' } }));
    add(thing('helipad_h', 'text', 'Helipad mark', [HELIPAD[0], padY + 0.22, HELIPAD[1]], { shape: { text: 'H', size: 2.2, billboard: false, color: '#f4c430', background: false, zOffset: -3 }, transform: { rotation: [90, 90, 0] } }));
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

/** The guide (Pip, the rewards, the Overseer's words, music and the sea): src/overseer-games/sandbox.js; the islanders' lines: islanders.js; the journal and its lore: journal.js; the end of Chapter One in the hangar: finale.js. */
export const sandboxScript = () => ['sandbox.js', 'islanders.js', 'memories.js', 'journal.js', 'finale.js'].map((f) => fs.readFileSync(path.join(HERE, f), 'utf8').replace(/\r\n/g, '\n')).join('\n');
