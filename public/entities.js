// /entities: the entity codex. Every type the scene engine (engine/engine.js) builds, spawned live in a real
// HawkesEngine, with the spec as it is written in scene.json. Keep this in step with engine.js buildNode and the
// shape defaults (boxOpts, sphereOpts...), with KINDS in src/gameai.ts, and with play/API.md: only what the engine does.
/* global HawkesEngine, BABYLON */

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
    spec: { type: 'model', name: 'Boombox', transform: { position: [0, 1.1, 0], scale: [110, 110, 110] }, shape: { asset: SAMPLE_GLB } },
    fields: [['shape.asset', 'an asset name in the game (tree.glb) or an https URL', ''], ['transform.scale', 'models come in at their own size', '[1, 1, 1]']],
    beam: true,
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
    fields: [['tag', 'scripts find it by tag', '']],
  },
  {
    group: 'Logic', type: 'trigger',
    what: 'An invisible zone: checkpoints, goals, danger. Amber in the editor; nothing collides with it.',
    spec: { type: 'trigger', name: 'Goal', tag: 'goal', transform: { position: [0, 1, 0], scale: [3, 2, 3] }, physics: 'trigger' },
    fields: [['transform.scale', 'the zone\'s size', '[1, 1, 1]'], ['tag', 'what scripts look for', '']],
  },
];

const COMPONENTS = [
  { name: 'id, name, tag', tag: 'identity', text: 'The id is the key in scene.json. <code>name</code> is a label for people; <code>tag</code> groups things for scripts (<code>player</code>, <code>coin</code>).' },
  { name: 'transform', tag: 'where', text: '<code>position</code> [x, y, z] in meters, <code>rotation</code> [x, y, z] in degrees, <code>scale</code> a number or [x, y, z]. +y is up, +z is forward.' },
  { name: 'shape', tag: 'size', text: 'The numbers for its type: <code>size</code>, <code>radius</code>, <code>height</code>, <code>width</code>, <code>depth</code>, <code>asset</code>. Pick a type above to see its fields.' },
  { name: 'material', tag: 'look', text: '<code>color</code>, <code>emissive</code> (glows without light), <code>opacity</code>, <code>texture</code> with <code>tile</code> [u, v], and <code>maps.normal</code> for surface detail.' },
  { name: 'physics', tag: 'body', text: 'How it collides: <code>static</code>, <code>dynamic</code>, <code>kinematic</code>, <code>trigger</code> or none. See the bodies below.' },
  { name: 'parent', tag: 'hierarchy', text: 'Another entity\'s id. A child moves with its parent, and deleting the parent deletes its children.' },
  { name: 'data', tag: 'yours', text: 'Any fields your game wants: hit points, a door\'s key, a level number. The engine keeps them and leaves them alone.' },
];

const PHYSICS = [
  { name: 'static', text: 'Solid and never moves by itself. Floors, walls, platforms. The default for shapes and models.' },
  { name: 'dynamic', text: 'Falls with gravity, gets pushed out of solid things, has velocity. Players, enemies, crates.' },
  { name: 'kinematic', text: 'Solid, but moves only when a script moves it. Moving platforms, doors, elevators.' },
  { name: 'trigger', text: 'Not solid, but scripts hear when something enters. Coins, checkpoints, danger zones.' },
  { name: 'none', text: 'Decoration: no collisions at all. The default for sprites.' },
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
  { name: 'game.sprite(name, opts)', text: 'A 2D image that faces the camera. <code>frames: { cols, rows }</code> plays a sprite sheet; <code>flip</code> mirrors it.' },
  { name: 'game.burst(position, opts)', text: 'Sparks thrown out from a point: pickups, hits, explosions.' },
  { name: 'game.ui.text / bar / button', text: 'Screen text, bars from 0 to 1 (health, time) and buttons, drawn over the world.' },
  { name: 'game.camera.*', text: 'follow, firstPerson, orbit, topDown, fixed and shake: how the player sees the world.' },
];

// ------------------------------------------------------------------ the live engine

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
let engine = null;
let current = TYPES[0];
let spawned = 0;

function scene(t, spec) {
  const graph = HawkesEngine.defaultScene();
  Object.assign(graph.config, { background: '#0d0f18', ambient: 0.55, fog: null, shadows: false }, t.config || {});
  const add = (id, e) => { graph.entities[id] = { id, ...e }; };
  if (!t.noFloor) add('floor', { type: 'plane', name: 'Floor', shape: { width: 14, depth: 14 }, material: { color: '#39415e' }, physics: 'static' });
  if (t.props) {
    // Something for a light to fall on, or for a mirror to reflect (built before it: a mirror sees what exists).
    add('prop_a', { type: 'box', name: 'Prop', transform: { position: [-2.2, 0.5, 1.8] }, shape: { size: 1 }, material: { color: '#a855f7' }, physics: 'static' });
    add('prop_b', { type: 'sphere', name: 'Prop', transform: { position: [2.2, 0.6, 1.6] }, shape: { radius: 0.6 }, material: { color: '#34d399' }, physics: 'static' });
    add('prop_c', { type: 'cylinder', name: 'Prop', transform: { position: [0, 0.4, 3] }, shape: { radius: 0.4, height: 0.8 }, material: { color: '#fbbf24' }, physics: 'static' });
  }
  const id = `${t.type}_${++spawned}`;
  add(id, clone(spec));
  return { graph, id };
}

function spawn(spec) {
  const t = current;
  const { graph, id } = scene(t, spec);
  engine.loadScene(graph);
  const cam = engine.camera;
  if (cam) {
    cam.radius = t.type === 'plane' ? 17 : 8;
    cam.beta = Math.PI / 3.2;
    cam.setTarget(new BABYLON.Vector3(0, t.type === 'plane' ? 0 : 1, 0));
    cam.useAutoRotationBehavior = true;
    if (cam.autoRotationBehavior) { cam.autoRotationBehavior.idleRotationSpeed = 0.25; cam.autoRotationBehavior.idleRotationWaitTime = 2500; }
  }
  engine.select(id);
  $('inspId').textContent = id;
  return id;
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
  $('beam').hidden = !t.beam;
  msg('Ctrl+Enter applies');
  if (engine) spawn(t.spec);
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
  if (!engine) return msg('The engine is not running', 'bad');
  spawn(spec);
  msg('Applied', 'ok');
}

// The effect the editor plays while Gen makes a model: a beam into the sky, the job's log, then the model arrives.
function arrival() {
  if (!engine) return;
  const t = current;
  const { graph } = scene(t, t.spec);
  for (const id of Object.keys(graph.entities)) if (graph.entities[id].type === 'model') delete graph.entities[id];
  engine.loadScene(graph);
  const cam = engine.camera;
  if (cam) { cam.radius = 13; cam.setTarget(new BABYLON.Vector3(0, 2, 0)); }
  const beam = engine.startDownload([0, 0.9, 0], { label: 'model', size: 1.6 });
  const steps = ['model starting...', 'Drawing it', 'Drawing it: 60%', 'Building the 3D model', 'Texturing', 'Complete.'];
  $('beam').disabled = true;
  steps.forEach((s, i) => setTimeout(() => {
    beam.addLog(s);
    beam.setProgress((i + 1) / steps.length);
    if (i === steps.length - 1) setTimeout(() => {
      beam.complete(clone(t.spec));
      $('beam').disabled = false;
    }, 600);
  }, 450 + i * 700));
}

function start() {
  try {
    if (!window.BABYLON || !window.HawkesEngine) throw new Error('Babylon.js did not load');
    engine = new HawkesEngine($('canvas'));
    engine.assetResolver = () => null;
    engine.onSelect = (id) => { if (id) $('inspId').textContent = id; };
  } catch (e) {
    engine = null;
    $('viewport').insertAdjacentHTML('beforeend', `<div class="vp-fail">The live view needs WebGL, and it didn't start here (${e.message}). The reference still works.</div>`);
  }
}

// ------------------------------------------------------------------ the page

function renderPage() {
  const B = window.HawkesEngine?.BUDGET ?? { maxEntities: 500, maxLights: 8, maxPhysicsBodies: 200 };
  $('budget').innerHTML = [[TYPES.length, 'entity types'], [B.maxEntities, 'entities a scene'], [B.maxLights, 'extra lights'], [B.maxPhysicsBodies, 'physics bodies']]
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
  $('scriptOnly').innerHTML = SCRIPT_ONLY.map((s) => `<div class="ref"><h3>${s.name}</h3><p>${s.text}</p></div>`).join('');

  $('apply').onclick = apply;
  $('reset').onclick = () => show(current);
  $('respawn').onclick = apply;
  $('beam').onclick = arrival;
  $('spec').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); apply(); }
  });
}

renderPage();
start();
show(TYPES.find((t) => t.type === location.hash.slice(1)) ?? TYPES[0]);
