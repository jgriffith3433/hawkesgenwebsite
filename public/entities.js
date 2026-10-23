// /entities: the entity codex. Every kind of thing the game engine (play/runtime.js) builds, spawned live in the real
// runtime, with the spec as it is written in scene.json. Keep this in step with runtime.js fromSpec, the behaviors in
// play/behaviors.js, KINDS in src/gameai.ts and play/WORLD.md: only what the engine does.
/* global HawkesPlay, BABYLON */

const SAMPLE_GLB = 'https://models.babylonjs.com/boombox.glb';

const TYPES = [
  {
    group: 'Shapes', type: 'box',
    what: 'A box. Floors, walls, crates, platforms: most levels start as boxes.',
    spec: { type: 'box', name: 'Crate', transform: { position: [0, 0.6, 0], rotation: [0, 25, 0] }, shape: { size: [1.2, 1.2, 1.2] }, material: { color: '#c8843f' }, physics: 'static' },
    fields: [['shape.size', 'a number, or [w, h, d] in meters', '1']],
  },
  {
    group: 'Shapes', type: 'sphere',
    what: 'A ball. Dynamic spheres fall and bounce; this one drops onto the floor.',
    spec: { type: 'sphere', name: 'Ball', transform: { position: [0, 4, 0] }, shape: { radius: 0.6, segments: 32 }, material: { color: '#e04f5f' }, physics: 'dynamic' },
    fields: [['shape.radius', 'meters', '0.5'], ['shape.segments', 'smoothness', '16']],
  },
  {
    group: 'Shapes', type: 'cylinder',
    what: 'A cylinder. Pillars, coins (thin and flat), barrels, towers.',
    spec: { type: 'cylinder', name: 'Pillar', transform: { position: [0, 1, 0] }, shape: { radius: 0.5, height: 2, segments: 24 }, material: { color: '#9aa4b8' }, physics: 'static' },
    fields: [['shape.radius', 'meters', '0.5'], ['shape.height', 'meters', '1'], ['shape.segments', 'smoothness', '16']],
  },
  {
    group: 'Shapes', type: 'cone',
    what: 'A cone. Spikes, tree tops, roofs on round towers, traffic cones.',
    spec: { type: 'cone', name: 'Spike', transform: { position: [0, 0.75, 0] }, shape: { radius: 0.6, height: 1.5 }, material: { color: '#f97316' }, physics: 'static', behaviors: [{ use: 'hurts', damage: 20 }] },
    fields: [['shape.radius', 'meters at the base', '0.5'], ['shape.height', 'meters', '1']],
  },
  {
    group: 'Shapes', type: 'torus',
    what: 'A ring. Hoops to fly through, wheels, halos.',
    spec: { type: 'torus', name: 'Hoop', transform: { position: [0, 1.4, 0], rotation: [90, 0, 0] }, shape: { radius: 1, thickness: 0.2 }, material: { color: '#22d3ee', emissive: '#063a44' }, physics: 'trigger', behaviors: [{ use: 'spin', speed: 45, axis: 'z' }] },
    fields: [['shape.radius', 'meters to the middle of the ring', '1'], ['shape.thickness', 'meters', '0.3']],
  },
  {
    group: 'Shapes', type: 'capsule',
    what: 'A pill. The usual body for players and enemies: round ends slide over edges.',
    spec: { type: 'capsule', name: 'Player', tag: 'player', transform: { position: [0, 1, 0] }, shape: { radius: 0.4, height: 1.8 }, material: { color: '#4a9eff', emissive: '#0a1830' }, physics: 'dynamic' },
    fields: [['shape.radius', 'meters', '0.5'], ['shape.height', 'meters, end to end', '2']],
  },
  {
    group: 'Shapes', type: 'plane',
    what: 'Flat ground. Give it a tiling texture from Gen and repeat it with material.tile.',
    spec: { type: 'plane', name: 'Ground', transform: { position: [0, 0, 0] }, shape: { width: 12, depth: 12, subdivisions: 1 }, material: { color: '#3a7d44' }, physics: 'static' },
    fields: [['shape.width', 'meters along x', '10'], ['shape.depth', 'meters along z', '10'], ['shape.subdivisions', 'grid cells per side', '1']],
    noFloor: true,
  },
  {
    group: 'World', type: 'text',
    what: 'A floating sign. Instructions, names, scores, jokes.',
    spec: { type: 'text', name: 'Sign', transform: { position: [0, 1.5, 0] }, shape: { text: 'Welcome!\nGrab anything.', size: 0.35 } },
    fields: [['shape.text', 'the words (\\n for a new line)', ''], ['shape.size', 'letter height in meters', '0.5'], ['shape.billboard', 'false keeps it flat', 'true']],
  },
  {
    group: 'World', type: 'light',
    what: 'A light: point (a bulb), spot (a cone) or directional (sunlight). Every scene already has a sky light and a sun.',
    spec: { type: 'light', name: 'Lamp', transform: { position: [0, 2.2, 0] }, light: { type: 'point', color: '#ffaa55', intensity: 1.6, range: 9 } },
    fields: [['light.type', 'point, spot or directional', 'point'], ['light.color', '#rrggbb', '#ffffff'], ['light.intensity', 'brightness', '1'], ['light.range', 'meters (point, spot)', ''], ['light.direction', '[x, y, z] (spot, directional)', '[0, -1, 0]'], ['light.angle', 'cone width in degrees (spot)', '60']],
    config: { ambient: 0.08, sun: 0.1 },
    props: true,
  },
  {
    group: 'World', type: 'model',
    what: 'A 3D model: a .glb file. Ask for one and Hawkes Gen draws it, builds the mesh and adds it to your assets; until the file arrives you see a wireframe.',
    uses: 'The model shown is a Babylon.js sample, so the page works without an account. In your game, shape.asset is the name of an asset in it.',
    spec: { type: 'model', name: 'Boombox', transform: { position: [0, 0.8, 0] }, shape: { asset: SAMPLE_GLB, size: 1.6 } },
    fields: [['shape.asset', 'an asset name in the game (tree.glb) or an https URL', ''], ['shape.size', 'its height in meters', 'its own size']],
  },
  {
    group: 'World', type: 'sprite',
    what: 'A picture: an image from your library, facing you (or flat, like a poster). Shows as a wireframe until its picture exists.',
    spec: { type: 'sprite', name: 'Poster', transform: { position: [0, 1.2, 0] }, shape: { image: 'poster.png', size: 1.6, billboard: false } },
    fields: [['shape.image', 'an image asset in the game', ''], ['shape.size', 'height in meters', '1'], ['shape.frames', '{ cols, rows } for a sprite sheet', '']],
  },
  {
    group: 'World', type: 'video',
    what: 'A screen playing a video from your library, muted until someone clicks it. Shows as a wireframe until its video exists.',
    spec: { type: 'video', name: 'Screen', transform: { position: [0, 1.5, 0] }, shape: { asset: 'trailer.mp4', width: 3.2 } },
    fields: [['shape.asset', 'a video asset in the game', ''], ['shape.width', 'meters', '3.2'], ['shape.height', 'meters', '16:9 of the width']],
  },
  {
    group: 'World', type: 'mirror',
    what: 'A framed mirror with a live reflection: a doorway look for portals between games.',
    uses: 'It reflects what was in the scene when it was built.',
    spec: { type: 'mirror', name: 'Mirror', transform: { position: [0, 1.6, 0] }, shape: { width: 2, height: 3 } },
    fields: [['shape.width', 'meters', '2'], ['shape.height', 'meters', '3']],
    props: true,
  },
  {
    group: 'Logic', type: 'spawn',
    what: 'Where players start. A green box in the editor, invisible when the game plays.',
    spec: { type: 'spawn', name: 'Start', tag: 'player-start', transform: { position: [0, 0.5, 0] } },
    fields: [['data.role', 'who starts here', 'player']],
  },
  {
    group: 'Logic', type: 'trigger',
    what: 'An invisible zone: checkpoints, goals, danger. Amber in the editor; you walk through it, and it notices.',
    spec: { type: 'trigger', name: 'Goal', transform: { position: [0, 1, 0] }, shape: { size: [3, 2, 3] }, physics: 'trigger', behaviors: [{ use: 'goal', message: 'You made it!' }] },
    fields: [['shape.size', 'the zone, [w, h, d]', '1'], ['behaviors', 'what happens inside: goal, checkpoint, hurts...', '']],
  },
];

const COMPONENTS = [
  { name: 'id, name, tag', tag: 'identity', text: 'The id is the key in scene.json. <code>name</code> is a label for people; <code>tag</code> groups things for scripts (<code>player</code>, <code>coin</code>).' },
  { name: 'transform', tag: 'where', text: '<code>position</code> [x, y, z] in meters, <code>rotation</code> [x, y, z] in degrees, <code>scale</code> a number or [x, y, z]. +y is up, +z is forward.' },
  { name: 'shape', tag: 'size', text: 'The numbers for its type: <code>size</code>, <code>radius</code>, <code>height</code>, <code>width</code>, <code>depth</code>, <code>asset</code>. Pick a type above to see its fields.' },
  { name: 'material', tag: 'look', text: '<code>color</code>, <code>emissive</code> (glows without light), <code>opacity</code>, <code>texture</code> with <code>tile</code> [u, v], and <code>maps.normal</code> for surface detail.' },
  { name: 'physics, body', tag: 'how it moves', text: '<code>static</code>, <code>dynamic</code>, <code>kinematic</code>, <code>trigger</code> or <code>none</code> (below), and <code>body</code>: <code>bounce</code>, <code>friction</code>, <code>mass</code>, <code>grab: false</code>.' },
  { name: 'behaviors', tag: 'what it does', text: 'A list of <code>{ "use": name, ...options }</code>: spins, floats, follows you, can be collected, hurts... (below).' },
  { name: 'parent', tag: 'hierarchy', text: 'Another entity\'s id. A child moves with its parent, and deleting the parent deletes its children.' },
  { name: 'data', tag: 'yours', text: 'Any fields your game wants: hit points, a door\'s key, a level number. The engine keeps them and leaves them alone.' },
];

const PHYSICS = [
  { name: 'static', text: 'Stays put. Solid: you stand on it and bump into it. Floors, walls, platforms. In the editor you can still pick it up and move it.' },
  { name: 'dynamic', text: 'Falls, bounces, gets pushed, and players can pick it up and throw it. Crates, balls, loose things. Caught and put back if it falls out of the world.' },
  { name: 'kinematic', text: 'Solid, and moves by itself (a behavior or a script). Players standing on it ride along. Moving platforms, lifts, doors.' },
  { name: 'trigger', text: 'You go through it, and it notices. Coins, goals, checkpoints, danger zones.' },
  { name: 'none', text: 'Decoration: nothing bumps into it. Signs, lights, pictures.' },
];

// From src/gameai.ts KINDS (titles, credits and the tools behind them).
const KINDS = [
  ['model', '3D model (.glb)', 'Draws it, then builds a textured mesh from the drawing', 'a <code>model</code> entity', '~55'],
  ['sprite', 'Transparent image (.png)', 'Paints it, then cuts out the background', '<code>game.sprite()</code> in scripts', '~7'],
  ['texture', 'Tiling texture (.png)', 'Paints a seamless square', '<code>material.texture</code> with <code>tile</code>', '~5'],
  ['image', 'Image (.png)', 'Paints a picture', '<code>material.texture</code>, a sign, a screen', '~5'],
  ['sky', 'Sky panorama (.jpg)', 'Paints a 360° view', '<code>game.sky(\'sky.jpg\')</code> around the world', '~10'],
  ['sfx', 'Sound effect (.mp3)', 'Records a sound from a description', '<code>game.sound()</code>', '~8'],
  ['music', 'Music loop (.mp3)', 'Composes 10 to 180 seconds', '<code>game.music()</code>', '~20'],
  ['voice', 'Voice line (.mp3)', 'Speaks the exact line you write', '<code>game.sound()</code>', '~10'],
];

const SCRIPT_ONLY = [
  { name: 'game.player', text: 'You: a first-person body every game gets (walk, jump, fly while building). <code>controls = false</code> for games that move it themselves.' },
  { name: 'game.raycast / game.aim', text: 'What a line from a point (or the crosshair) hits first: for shooting, picking up, looking at.' },
  { name: 'game.net', text: 'Playing together: <code>send</code> and <code>on</code> messages, <code>isHost</code>, <code>players</code>.' },
  { name: 'game.sprite(name, opts)', text: 'A 2D image that faces the camera. <code>frames: { cols, rows }</code> plays a sprite sheet; <code>flip</code> mirrors it.' },
  { name: 'game.burst(position, opts)', text: 'Sparks thrown out from a point: pickups, hits, explosions.' },
  { name: 'game.ui.text / bar / button', text: 'Screen text, bars from 0 to 1 (health, time) and buttons, drawn over the world.' },
  { name: 'game.camera.*', text: 'follow, firstPerson, orbit, topDown, fixed and shake: how the player sees the world.' },
];

// ------------------------------------------------------------------ the live engine (the real runtime)

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
let running = false;
let current = TYPES[0];

/** A tiny world: a floor, maybe some props, and the thing; a script orbits the camera around it. */
function world(t, spec) {
  const entities = {};
  const add = (id, e) => { entities[id] = { id, ...e }; };
  if (!t.noFloor) add('floor', { type: 'plane', name: 'Floor', shape: { width: 14, depth: 14 }, material: { color: '#39415e' }, physics: 'static' });
  if (t.props) {
    add('prop_a', { type: 'box', name: 'Prop', transform: { position: [-2.2, 0.5, 1.8] }, shape: { size: 1 }, material: { color: '#a855f7' } });
    add('prop_b', { type: 'sphere', name: 'Prop', transform: { position: [2.2, 0.6, 1.6] }, shape: { radius: 0.6 }, material: { color: '#34d399' } });
    add('prop_c', { type: 'cylinder', name: 'Prop', transform: { position: [0, 0.4, 3] }, shape: { radius: 0.4, height: 0.8 }, material: { color: '#fbbf24' } });
  }
  add('thing', clone(spec));
  const config = { background: '#0d0f18', ambient: t.config ? 0.15 : 0.7, sun: t.config ? 0.15 : 0.8, shadows: false, player: false };
  const cam = `game.camera.orbit([0, ${t.type === 'plane' ? 0 : 1}, 0], { distance: ${t.type === 'plane' ? 17 : 8} });\nconst c = game.camera.babylon; c.beta = 1.05; c.useAutoRotationBehavior = true;\n`;
  return { 'scene.json': JSON.stringify({ config, entities }), 'scripts/view.js': cam };
}

function spawn(spec) {
  if (!running) return;
  HawkesPlay.reload(world(current, spec));
  $('inspId').textContent = 'thing';
}

function show(t) {
  current = t;
  for (const b of document.querySelectorAll('.types button')) b.classList.toggle('on', b.dataset.type === t.type);
  $('hudType').textContent = t.type;
  const phys = t.spec.physics;
  $('hudPhys').hidden = !phys;
  if (phys) $('hudPhys').querySelector('b').textContent = phys;
  $('inspName').textContent = t.type;
  $('inspWhat').textContent = t.what;
  $('inspUses').textContent = t.uses || '';
  $('inspUses').hidden = !t.uses;
  $('spec').value = pretty(t.spec);
  $('fields').innerHTML = t.fields.map(([k, v, d]) => `<tr><td>${k}</td><td>${v}${d ? ` <span class="def">· default ${d}</span>` : ''}</td></tr>`).join('');
  msg('Ctrl+Enter applies');
  spawn(t.spec);
}

// JSON with short arrays on one line, the way scene.json reads best.
const pretty = (o) => JSON.stringify(o, null, 2).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`);

function msg(text, cls = '') {
  const m = $('specMsg');
  m.textContent = text;
  m.className = `msg ${cls}`;
}

function apply() {
  let spec;
  try { spec = JSON.parse($('spec').value); } catch (e) { return msg(e.message, 'bad'); }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return msg('A spec is one JSON object', 'bad');
  if (spec.type && spec.type !== current.type) {
    const t = TYPES.find((x) => x.type === spec.type);
    if (!t) return msg(`No type "${spec.type}"`, 'bad');
    current = t;
    for (const b of document.querySelectorAll('.types button')) b.classList.toggle('on', b.dataset.type === t.type);
    $('hudType').textContent = t.type;
  }
  if (!running) return msg('The engine is not running', 'bad');
  spawn(spec);
  msg('Applied', 'ok');
}

function start() {
  try {
    if (!window.BABYLON || !window.HawkesPlay) throw new Error('Babylon.js did not load');
    HawkesPlay.hooks.autoLock = false;
    HawkesPlay.run({ title: 'Entity codex', files: world(current, current.spec), assets: {} }, { mode: 'build' });
    document.title = 'Entity codex · Hawkes Gen';
    running = true;
  } catch (e) {
    running = false;
    $('viewport').insertAdjacentHTML('beforeend', `<div class="vp-fail">The live view needs WebGL, and it didn't start here (${e.message}). The reference still works.</div>`);
  }
}

// ------------------------------------------------------------------ the page

function renderPage() {
  const behaviors = (window.HawkesPlay && HawkesPlay.behaviorMenu) || [];
  $('budget').innerHTML = [[TYPES.length, 'kinds of things'], [behaviors.length, 'behaviors'], [500, 'things a world'], [32, 'players a room']]
    .map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
  $('typeCount').textContent = TYPES.length;

  let html = '';
  let group = '';
  for (const t of TYPES) {
    if (t.group !== group) { group = t.group; html += `<h4>${group}</h4>`; }
    html += `<button type="button" data-type="${t.type}"><span class="glyph ${t.type}"></span>${t.type}</button>`;
  }
  $('types').innerHTML = html;
  $('types').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]');
    if (b) { show(TYPES.find((t) => t.type === b.dataset.type)); history.replaceState(null, '', `#${b.dataset.type}`); }
  });

  $('components').innerHTML = COMPONENTS.map((c) => `<div class="ref"><span class="tagline">${c.tag}</span><h3>${c.name}</h3><p>${c.text}</p></div>`).join('');
  $('physics').innerHTML = PHYSICS.map((p) => `<div class="ref"><h3>'${p.name}'</h3><p>${p.text}</p></div>`).join('');
  $('kinds').innerHTML = KINDS.map(([k, title, how, use, cr]) => `<tr><td>${k}</td><td>${title}<br><span style="color:var(--fg-3);font-size:12.5px">${how}</span></td><td>${use}</td><td class="n">${cr}</td></tr>`).join('');
  $('behaviors').innerHTML = behaviors.map(([k, title]) => { const d = HawkesPlay.behaviorDef(k); const o = { ...(d && d.defaults || {}) }; return `<div class="ref"><span class="tagline">${k}</span><h3>${title}</h3><p>${d && d.says ? d.says(o).replace(/</g, '&lt;') : ''}</p></div>`; }).join('');
  $('scriptOnly').innerHTML = SCRIPT_ONLY.map((s) => `<div class="ref"><h3>${s.name}</h3><p>${s.text}</p></div>`).join('');

  $('apply').onclick = apply;
  $('reset').onclick = () => show(current);
  $('respawn').onclick = apply;
  $('spec').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
  });
}

const first = TYPES.find((t) => t.type === location.hash.slice(1)) ?? TYPES[0];
current = first;
renderPage();
start();
show(first);
