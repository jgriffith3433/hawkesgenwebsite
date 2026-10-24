// /entities: the entity codex. Every kind of thing the game engine builds, read from its kind registry
// (HawkesPlay.kinds: play/kinds.js and every module's own kinds), spawned live in the real runtime, with the spec as it
// is written in scene.json. A kind's page here is its `codex` (H.kinds.register); a module's kind shows up by itself.
/* global HawkesPlay, HawkesModules */

await HawkesModules.load('play').catch(() => {});

const GROUPS = ['Shapes', 'World', 'Logic', 'More'];
const rank = (t) => (t.group === 'World features' ? 1000 : GROUPS.includes(t.group) ? GROUPS.indexOf(t.group) : 50);
/** The kinds, from the registry: codex: { group, what, spec, fields, uses, noFloor, props, config }. */
const TYPES = (window.HawkesPlay ? HawkesPlay.kinds.list() : []).filter((k) => !k.alias && !(k.codex && k.codex.hidden)).map((k) => {
  const c = k.codex || {};
  return {
    type: k.name, group: c.group || 'More', what: c.what || `A ${k.name}.`, uses: c.uses,
    spec: c.spec || { type: k.name, name: k.name, transform: { position: [0, 1, 0] } },
    fields: c.fields || [], noFloor: c.noFloor, props: c.props, config: c.config,
  };
})
  // World features (H.features with a codex): a config key, shown live with its example value.
  .concat((window.HawkesPlay ? HawkesPlay.features.list() : []).filter((f) => f.codex).map((f) => ({
    type: f.name, feature: f.name, group: 'World features', what: f.codex.what || `config.${f.name}`, uses: `config.${f.name} in scene.json (a world setting): { "op": "config", "patch": { "${f.name}": ... } }`,
    spec: f.codex.value, fields: f.codex.fields || [], noFloor: true, props: true, config: false,
  })))
  .sort((a, b) => rank(a) - rank(b));
const COMPONENTS = [
  { name: 'id, name, tag', tag: 'identity', text: 'The id is the key in scene.json. <code>name</code> is a label for people; <code>tag</code> groups things for scripts (<code>player</code>, <code>coin</code>).' },
  { name: 'transform', tag: 'where', text: '<code>position</code> [x, y, z] in meters, <code>rotation</code> [x, y, z] in degrees, <code>scale</code> a number or [x, y, z]. +y is up, +z is forward.' },
  { name: 'shape', tag: 'size', text: 'The numbers for its type: <code>size</code>, <code>radius</code>, <code>height</code>, <code>width</code>, <code>depth</code>, <code>asset</code>. Pick a type above to see its fields.' },
  { name: 'material', tag: 'look', text: '<code>color</code>, <code>emissive</code> (glows without light), <code>opacity</code>, <code>texture</code> (an image asset) with <code>tile</code> [u, v] (how many times it repeats).' },
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

// What Gen makes for a game: titles and credits come live from src/gameai.ts KINDS (/v1/asset-kinds); these say how
// each is made and where it goes.
const KIND_USES = {
  model: ['Draws it, then builds a textured mesh from the drawing', 'a <code>model</code> entity'],
  sprite: ['Paints it, then cuts out the background', '<code>game.sprite()</code> in scripts'],
  texture: ['Paints a seamless square', '<code>material.texture</code> with <code>tile</code>'],
  image: ['Paints a picture', '<code>material.texture</code>, a sign, a screen'],
  sky: ['Paints a 360° view', '<code>game.sky(\'sky.jpg\')</code> around the world'],
  sfx: ['Records a sound from a description', '<code>game.sound()</code>'],
  music: ['Composes 10 to 180 seconds', '<code>game.music()</code>'],
  voice: ['Speaks the exact line you write', '<code>game.sound()</code>'],
};
let KINDS = [];
async function loadKinds() {
  try {
    const r = await fetch('/v1/asset-kinds');
    const k = await r.json();
    KINDS = Object.entries(k).map(([name, v]) => [name, v.title, (KIND_USES[name] || [''])[0], (KIND_USES[name] || ['', ''])[1], v.credits]);
  } catch { KINDS = []; }
  loadKinds();
}

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
  if (!t.feature) add('thing', clone(spec));
  const config = { background: t.feature ? '#9fd3f0' : '#0d0f18', ambient: t.config ? 0.15 : 0.7, sun: t.config ? 0.15 : 0.8, shadows: false, player: false };
  if (t.feature) config[t.feature] = clone(spec);
  const far = t.feature ? 60 : t.type === 'plane' ? 17 : 8;
  const cam = `game.camera.orbit([0, ${t.type === 'plane' ? 0 : t.feature ? 4 : 1}, 0], { distance: ${far} });\nconst c = game.camera.babylon; c.beta = 1.05; c.useAutoRotationBehavior = true;\n`;
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
  $('hudType').textContent = t.feature ? `config.${t.type}` : t.type;
  const phys = t.spec && t.spec.physics;
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
  if (current.feature) { if (!running) return msg('The engine is not running', 'bad'); spawn(spec); return msg('Applied', 'ok'); }
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
