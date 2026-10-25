// /avatars: the avatar showcase. Every body a player can be (HawkesPlay.presence.core.WHATS: the mirror's "What are you?"),
// built live by the game's own presence code (presence.js makeRig through P.showcase, presence-bodies.js, living/species.js)
// and moved by the same animate(), in the real runtime like /entities. No account, no network but the engine's own files.
//
// Screenshot mode, for a playtest or a review:  /avatars?body=shoe&pose=idle&bg=night
//   body  an id from WHATS, or "all" (a contact sheet)       pose  idle walk run jump fall swim drive, an emote (wave dance ...), gag or react (a thing's)
//   bg    day night studio grass                              face  visor eyes smile none (the person's)
//   expr  neutral happy surprised sad angry sleepy mischief    hair  short long ponytail curly spiky bun (the person's)
//   hat, shape, c1 c2 c3 (hex without #: body, accent, detail)   t  seconds into the motion to freeze at (default 1.2)
//   turn=1 turntable   live=1 keep moving instead of freezing   ui=1 keep the controls
//   pose may also be any clip of the model's animation set (public/play/anim/<class>.json, docs/animations.md): walk, idle... rendered from the data at t seconds into the clip, exactly
//   standin=mixamo  the person is a stand-in on the Mixamo skeleton (rigid boxes), until the real models are re-rigged: the mixamo class's clips play on it
//   standin=1  four types (person, dog, fish, toaster) get tiny stand-in Gen models, real GLBs made in the page and loaded by Babylon's loader
//   compare=1  the body twice, the procedural one on the left and the Gen model (the registry's row for the type) on the right, both dressed
//   (a model's triangles are held to the model budget, docs/characters.md "Gen models": 8,000 for the near level on a phone)
// The page sets document.body.dataset.ready ('true', or 'error') and window.avatarsReady when the picture is final.
/* global HawkesPlay, HawkesModules, BABYLON */
import { POSES, overlay } from '/avatars-poses.js';
import { STANDINS, STANDIN_FOR, MIXAMO_STANDIN, toGlb } from '/avatars-standins.js';

await HawkesModules.load('play').catch(() => {});
// the animation sets (one file per rig class) before any body is built, so a frame asked for by name is drawn from the data
if (window.HawkesPlay && HawkesPlay.presence && HawkesPlay.presence.anim) await Promise.all(Object.keys(HawkesPlay.presence.anim.CLASSES).map((c) => HawkesPlay.presence.anim.load(c)));

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const shot = q.has('body') && q.get('ui') !== '1';
if (shot) document.body.classList.add('shot');
if (q.get('body') === 'all') document.body.classList.add('sheet');

const P = window.HawkesPlay && HawkesPlay.presence;
const C = P && P.core;
const WHATS = C ? C.WHATS : [];
const BGS = {
  day: { sky: '#9fd3f0', floor: '#8fbf7a', ambient: 0.75, sun: 0.9 },
  night: { sky: '#0b1020', floor: '#1d2540', ambient: 0.28, sun: 0.35 },
  studio: { sky: '#cfd3dc', floor: '#e6e8ee', ambient: 0.85, sun: 0.7 },
  grass: { sky: '#bfe3ff', floor: '#5fa34a', ambient: 0.7, sun: 0.9 },
};
const EMOTES = C ? C.EMOTES.map((e) => e.name) : [];
const THING_POSES = ['gag', 'react', 'boot']; // the things' own: the idle gag and the signature reaction, each looped (presence-things.js)
const BUDGET = { tris: 2500, draws: 6, mats: 3 }; // docs/characters.md "Budget": the hard limit per character

const standin = q.get('standin') === '1';
const puppet = q.get('standin') === 'mixamo';
if (puppet && P && P.models) { // (the person on the Mixamo skeleton, as boxes)
  const url = URL.createObjectURL(new Blob([toGlb(MIXAMO_STANDIN)], { type: 'model/gltf-binary' }));
  P.models.register('person', { ...MIXAMO_STANDIN.row, url, lods: null, low: null, clips: {}, rig: 'mixamo', yaw: 0 });
}
if (standin && P && P.models) { // (stand-in models through the real loader: GLB bytes made here, loaded from object URLs)
  for (const [what, key] of Object.entries(STANDIN_FOR)) {
    const url = URL.createObjectURL(new Blob([toGlb(STANDINS[key])], { type: 'model/gltf-binary' }));
    P.models.register(what, { ...STANDINS[key].row, url });
  }
}
const state = {
  compare: q.get('compare') === '1',
  id: WHATS.find((w) => w.id === q.get('body'))?.id || WHATS.find((w) => w.id === location.hash.slice(1))?.id || (WHATS[0] && WHATS[0].id),
  pose: /^[a-z0-9_]{1,24}$/.test(q.get('pose') || '') ? q.get('pose') : 'idle', // (a pose of the page, an emote, or a clip of the model's set)
  bg: BGS[q.get('bg')] ? q.get('bg') : shot ? 'night' : 'studio',
  turn: shot ? q.get('turn') === '1' : q.get('turn') !== '0',
  face: C && C.LOOK.faces.includes(q.get('face')) ? q.get('face') : 'eyes',
  expr: C && C.EXPRESSIONS[q.get('expr')] ? q.get('expr') : null,
  hair: C && C.LOOK.hairs.includes(q.get('hair')) ? q.get('hair') : 'short',
  hat: C && C.LOOK.hats.includes(q.get('hat')) ? q.get('hat') : 'none',
  shape: C && C.LOOK.shapes.includes(q.get('shape')) ? q.get('shape') : 'normal',
  colors: null, // [body, accent, detail] picked; null = the body's own
  freeze: shot && q.get('live') !== '1',
};
const hex = (v) => (/^[0-9a-f]{6}$/i.test(v || '') ? `#${v.toLowerCase()}` : null);
if (hex(q.get('c1')) || hex(q.get('c2')) || hex(q.get('c3'))) state.colors = [hex(q.get('c1')), hex(q.get('c2')), hex(q.get('c3'))];
const what = () => C.WHAT.get(state.id);
const colorsNow = () => { const w = what(); return state.colors ? state.colors.map((c, i) => c || w.colors[i]) : w.colors; };

// ------------------------------------------------------------------ the world: a floor and a camera, nothing else
function files() {
  const bg = BGS[state.bg];
  const scene = {
    config: { background: bg.sky, ambient: bg.ambient, sun: bg.sun, shadows: false, player: false, look: false, presence: false },
    entities: { floor: { id: 'floor', type: 'plane', name: 'Floor', shape: { width: 400, depth: 400 }, material: { color: bg.floor }, physics: 'static' } },
  };
  return { 'scene.json': JSON.stringify(scene), 'scripts/view.js': 'game.camera.orbit([0, 1, 0], { distance: 5 });\n' };
}

let W = null, scene = null, cam = null, engine = null;
let running = false;
function start() {
  try {
    if (!window.BABYLON || !window.HawkesPlay || !P || !P.showcase) throw new Error('the engine did not load');
    HawkesPlay.hooks.autoLock = false;
    HawkesPlay.hooks.codex = true; // modules: no on-screen controls of their own on this page
    HawkesPlay.run({ title: 'Avatar showcase', files: files(), assets: {} }, { mode: 'build' });
    W = HawkesPlay.world;
    scene = W.scene;
    engine = scene.getEngine();
    cam = scene.activeCamera;
    cam.minZ = 0.05; cam.lowerRadiusLimit = 1; cam.upperRadiusLimit = 14; cam.fov = 0.8;
    cam.alpha = -Math.PI / 2 + 0.5; cam.beta = 1.35;
    running = true;
  } catch (e) {
    running = false;
    $('error').hidden = false;
    $('error').textContent = `The live view needs WebGL, and it didn't start here (${e.message}). The list still works.`;
    document.body.dataset.ready = 'error';
    window.avatarsReady = 'error';
  }
}

// ------------------------------------------------------------------ one body on a stand-in entity
const stand = (x = 0) => { const node = new BABYLON.TransformNode('av-stand', scene); node.position.set(x, 0.9, 0); return { node, x, y: 0.9, z: 0, alive: true, ox: x }; };
function lookFor(id, colors) {
  const w = C.WHAT.get(id);
  const c = colors || w.colors;
  return C.cleanLook({ what: id, body: c[0], accent: c[1], head: c[2], face: state.face, hat: state.hat, shape: state.shape, hair: state.hair });
}
let cur = null; // { e, rig, t, stats }
function build() {
  if (!running) return;
  if (cur) { P.showcase.dispose(cur.rig); cur.e.node.dispose(); if (cur.cmp) { P.showcase.dispose(cur.cmp.rig); cur.cmp.e.node.dispose(); } cur = null; }
  // compare: the procedural body (left) and the Gen model (right) side by side, the same look and hat; else the type as the game shows it
  const cmp = state.compare && P.models && P.models.enabled(state.id);
  const e = stand(cmp ? 0.9 : 0);
  const look = lookFor(state.id, colorsNow());
  const rig = P.showcase.make(e, look, look.body);
  cur = { e, rig, t: 0, hx: 0, jumpT: 0, cmp: null };
  if (cmp) {
    const e2 = stand(-0.9);
    cur.cmp = { e: e2, rig: P.showcase.make(e2, look, look.body, { model: false }) };
  }
  frameCamera();
  settle(state.freeze ? Math.max(0, Number(q.get('t') ?? 1.2) || 0) : 0.4);
  readStats();
  refreshUi();
  // a model arrives a moment after the body: the numbers and the picture are final once it has
  if (P.models && rig.pm) P.models.ready(rig).then(() => { if (cur && cur.rig === rig) { cur.t = 0; settle(state.freeze ? Math.max(0, Number(q.get('t') ?? 1.2) || 0) : 0.4); readStats(); refreshUi(); cur.ready = true; document.body.dataset.modelState = rig.pm.state; } });
}
/** Advance the motion without drawing, so a screenshot of "walk" is in mid-stride, not at the first frame. */
function settle(seconds) { for (let i = 0; i < Math.round(seconds * 60); i++) step(1 / 60); }

/** Camera distance that fits the body's height and, on a tall phone screen, its width too. */
function frameCamera() {
  const w = what();
  const sz = C.LOOK.sizes[state.shape] || C.LOOK.sizes.normal;
  const h = w.h * sz[1], wide = (Math.max(w.h * 0.7, 0.8) * sz[0]) * (cur && cur.cmp ? 2.3 : 1);
  const aspect = Math.max(0.3, engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()));
  const t = Math.tan(cam.fov / 2);
  cam.radius = Math.max(2, Math.max((h * 0.78) / t, (wide * 0.75) / (t * aspect)) + 0.6);
  cam.target.set(0, h * 0.5, 0);
}

const extras = []; // more of the same body for hawkesAvatars.crowd(): { rig, e }
const perf = { ms: 0, steps: 0 }; // what animating all of them costs (CPU), for crowd()
function step(dt) {
  if (!cur) return;
  const speed = state.pose === 'walk' ? 2.6 : state.pose === 'run' ? 6.5 : 0;
  const em = EMOTES.includes(state.pose) ? C.emote(state.pose) : null;
  const t0 = performance.now();
  for (const { rig, e } of [cur, cur.cmp, ...extras].filter(Boolean)) {
    e.x += speed * dt; // (the stand-in moves, its node does not: animate() reads the speed from x)
    if (em && !rig.emote) rig.emote = { def: em, t0: rig.time || 0, seconds: em.loop ? undefined : em.seconds };
    if (!em && rig.emote) rig.emote = null;
    // The person has every pose of its own (presence-person.js, played here on a loop); a Gen model has them too (presence-models.js);
    // the other bodies get the approximations.
    const model = rig.pm && rig.pm.on;
    rig.forcePose = (rig.person || model) && POSES.includes(state.pose) ? state.pose : rig.thing && THING_POSES.includes(state.pose) ? state.pose : null;
    rig.forceClip = P.anim && P.anim.has(rig, state.pose) ? { name: state.pose, t: cur.t + dt } : null; // (a clip of the model's set: that moment, from the data)
    rig.exprName = state.expr;
    if (rig.person && state.expr) rig.person.rest = state.expr;
    P.showcase.animate(rig, dt);
    if (!rig.person && !model) rig.pose.scaling.set(1, 1, 1);
    if (!rig.person && !model && POSES.includes(state.pose)) overlay(rig, state.pose, cur.t);
  }
  perf.ms += performance.now() - t0; perf.steps++;
  cur.t += dt;
}

/** Ten (or n) of the body in a row, all animating, for a few seconds: what the animation costs on this device (docs/animations.md). */
async function crowd(n = 10, seconds = 2) {
  if (!cur || !running) return null;
  for (const c of extras) { P.showcase.dispose(c.rig); c.e.node.dispose(); }
  extras.length = 0;
  for (let i = 1; i < n; i++) {
    const e = stand(((i % 5) - 2) * 1.5 + (i >= 5 ? 0.7 : 0)); e.z = -Math.floor(i / 5) * 1.6 - 1.2; e.node.position.z = e.z;
    extras.push({ e, rig: P.showcase.make(e, lookFor(state.id, colorsNow()), lookFor(state.id, colorsNow()).body) });
  }
  await Promise.all(extras.map((c) => (P.models && c.rig.pm ? P.models.ready(c.rig) : Promise.resolve())));
  state.freeze = false; state.turn = false;
  perf.ms = 0; perf.steps = 0;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const frames = Math.max(1, perf.steps);
  const rigs = [cur, ...extras];
  const meshes = rigs.flatMap((c) => c.rig.root.getChildMeshes(false).filter((m) => m.isEnabled() && m.getTotalIndices && m.getTotalIndices() > 0));
  return { n: rigs.length, seconds: (performance.now() - t0) / 1000, frames, animateMs: perf.ms / frames, fps: engine.getFps(), draws: meshes.length, triangles: Math.round(meshes.reduce((a, m) => a + m.getTotalIndices() / 3, 0)), tier: window.HawkesPlay && HawkesPlay.device ? HawkesPlay.device.tier : null, animated: rigs.filter((c) => c.rig.pm && c.rig.pm.anim && c.rig.pm.anim.player).length };
}
/** The numbers of a few nodes of the model (a bone's rotation) and of its whole body, to tell one moment of a clip from another. */
function probe(names = []) {
  const rig = cur && cur.rig, pm = rig && rig.pm;
  if (!pm || !pm.on) return null;
  const find = (name) => { const todo = [...pm.cur.roots]; while (todo.length) { const x = todo.shift(); if (x.name === name) return x; todo.push(...x.getChildren(undefined, true)); } return null; };
  const bones = {};
  for (const n of names) { const x = find(n); if (x && x.rotationQuaternion) bones[n] = [x.rotationQuaternion.x, x.rotationQuaternion.y, x.rotationQuaternion.z, x.rotationQuaternion.w].map((v) => Math.round(v * 1e5) / 1e5); }
  const mv = pm.mover;
  // where they are in the world (metres) and where the head and face anchors are: a hat sits on the head anchor, glasses on the face one
  const at = (x) => { x.computeWorldMatrix(true); const v = x.getAbsolutePosition(); return [v.x, v.y, v.z].map((n) => Math.round(n * 1e3) / 1e3); };
  const pos = {};
  for (const n of names) { const x = find(n); if (x) pos[n] = at(x); }
  const anchors = {};
  for (const [k, a] of Object.entries(pm.anchors || {})) anchors[k] = at(a.node);
  return { bones, pos, anchors, mover: { y: mv.position.y, rx: mv.rotation.x, rz: mv.rotation.z, sy: mv.scaling.y }, t: cur.t, pose: state.pose };
}

// ------------------------------------------------------------------ what a body costs, against docs/characters.md
function readStats() {
  const meshes = cur.rig.root.getChildMeshes(false).filter((m) => m.isEnabled() && m.getTotalIndices && m.getTotalIndices() > 0);
  const tris = Math.round(meshes.reduce((n, m) => n + m.getTotalIndices() / 3, 0));
  const mats = new Set(meshes.map((m) => m.material && m.material.name)).size;
  // A Gen model is held to the model budget (its near level, the phone tier's), not to the toy's 2,500 triangles.
  const ms = P.models && cur.rig.pm && cur.rig.pm.on ? P.models.stats(cur.rig) : null;
  const triBudget = ms ? P.models.TRIS.phone : BUDGET.tris;
  cur.stats = { tris, draws: meshes.length, mats, model: Boolean(ms), triBudget, over: tris > triBudget };
  const set = (id, n, max, label) => { const el = $(id); el.querySelector('b').textContent = `${n.toLocaleString()} / ${max.toLocaleString()}${n > max ? ' over' : ''}`; el.classList.toggle('over', n > max); el.classList.toggle('ok', n <= max); if (label) el.firstChild.textContent = label; };
  set('hudTris', ms ? ms.nearTris : tris, triBudget, ms ? 'model triangles ' : 'triangles '); set('hudDraws', meshes.length, BUDGET.draws); set('hudMats', mats, BUDGET.mats);
  if (ms) cur.stats.nearTris = ms.nearTris;
  $('hudModel').textContent = ms ? `Gen model (${ms.level})` : cur.rig.pm ? `model ${cur.rig.pm.state}` : state.compare ? 'no model for this type yet' : 'procedural';
}

// ------------------------------------------------------------------ the page
const button = (label, on, onClick, title = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = on ? 'on' : ''; if (title) b.title = title; b.onclick = onClick; return b; };
function refreshUi() {
  const w = what();
  $('name').textContent = w.label;
  $('say').textContent = w.line;
  $('hudBody').textContent = w.id;
  for (const c of document.querySelectorAll('.av-card')) c.classList.toggle('on', c.dataset.id === w.id);
  const clips = cur && P.anim && P.anim.info(cur.rig) ? P.anim.info(cur.rig).clips : [];
  $('poses').replaceChildren(...[...new Set([...POSES, ...(cur && cur.rig.thing ? THING_POSES : []), ...clips])].map((p) => button(p, state.pose === p, () => { state.pose = p; state.freeze = false; cur.t = 0; refreshUi(); })));
  $('emotes').replaceChildren(...EMOTES.map((p) => button(p, state.pose === p, () => { state.pose = p; state.freeze = false; if (cur) cur.rig.emote = null; refreshUi(); })));
  const person = w.body === 'person';
  $('faces').replaceChildren(...C.LOOK.faces.map((f) => { const b = button(f, state.face === f, () => { state.face = f; build(); }); b.disabled = !person; return b; }));
  const EXPRS = Object.keys(C.EXPRESSIONS);
  $('exprs').replaceChildren(...EXPRS.map((x) => { const b = button(x, (state.expr || 'neutral') === x, () => { state.expr = x; refreshUi(); }); b.disabled = !person; return b; }));
  $('hairs').replaceChildren(...C.LOOK.hairs.map((x) => { const b = button(x, state.hair === x, () => { state.hair = x; build(); }); b.disabled = !person; return b; }));
  $('faceNote').textContent = person ? 'The person\'s face: eyes that follow and blink, brows and a mouth. Every other body has one fixed face today: docs/characters.md gives all of them the same system.' : 'This body\'s face is fixed today (only the person\'s can change). That is the gap the art direction closes.';
  $('camera').replaceChildren(
    button(state.turn ? 'Turntable on' : 'Turntable off', state.turn, () => { state.turn = !state.turn; refreshUi(); }),
    button('Front', false, () => { state.turn = false; cam.alpha = -Math.PI / 2; refreshUi(); }),
    button('Side', false, () => { state.turn = false; cam.alpha = 0; refreshUi(); }),
    button('Back', false, () => { state.turn = false; cam.alpha = Math.PI / 2; refreshUi(); }),
    button(state.compare ? 'Model vs procedural' : 'Compare with model', state.compare, () => { state.compare = !state.compare; build(); }, 'The body as it is today next to the Gen model of this type, when the registry has one'));
  const c = colorsNow();
  ['c1', 'c2', 'c3'].forEach((id, i) => { $(id).value = c[i]; });
  $('hat').value = state.hat; $('shape').value = state.shape; $('bg').value = state.bg;
  $('shotUrl').textContent = `/avatars?body=${w.id}&pose=${state.pose}&bg=${state.bg}${state.compare ? '&compare=1' : ''}${standin ? '&standin=1' : puppet ? '&standin=mixamo' : ''}${state.colors ? `&c1=${c[0].slice(1)}&c2=${c[1].slice(1)}&c3=${c[2].slice(1)}` : ''}`;
}
function pick(id, replace = true) {
  if (!C.WHAT.has(id)) return;
  state.id = id; state.colors = null; state.face = 'eyes'; state.expr = null;
  if (replace) history.replaceState(null, '', `#${id}`);
  build();
}
function renderGrid() {
  const groups = [['people', 'People and machines'], ['animals', 'Animals'], ['things', 'Things']];
  $('count').textContent = `${WHATS.length}`;
  $('grid').replaceChildren();
  const cards = new Map();
  for (const [g, title] of groups) {
    const h = document.createElement('h3'); h.textContent = title; h.style.cssText = 'grid-column:1/-1;margin:10px 0 0;font:500 11px/1 var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--fg-3)';
    $('grid').append(h);
    for (const w of WHATS.filter((x) => x.group === g)) {
      const card = document.createElement('button');
      card.type = 'button'; card.className = 'av-card'; card.dataset.id = w.id; card.setAttribute('aria-label', w.label);
      card.innerHTML = `<span class="pic">${w.icon}</span><span>${w.id}</span><span class="av-swatches">${w.colors.map((c) => `<i style="background:${c}"></i>`).join('')}</span>`;
      card.onclick = () => { pick(w.id); document.getElementById('viewport').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
      $('grid').append(card);
      cards.set(w.id, card);
    }
  }
  return cards;
}
/** Pictures for the grid: each body rendered once, small, from a second camera aimed at a spot out of the stage's way. */
async function thumbnails(cards) {
  if (!running || shot && q.get('body') !== 'all') return;
  const tcam = new BABYLON.FreeCamera('av-thumb', new BABYLON.Vector3(0, 0, 0), scene);
  tcam.minZ = 0.05; tcam.fov = 0.7;
  for (const w of WHATS) {
    try {
      const e = stand(300);
      const look = C.cleanLook({ what: w.id, body: w.colors[0], accent: w.colors[1], head: w.colors[2], face: 'eyes' });
      const rig = P.showcase.make(e, look, look.body);
      P.showcase.animate(rig, 1 / 60);
      const d = (w.h * 0.62) / Math.tan(tcam.fov / 2) + 0.7;
      tcam.position.set(300 + d * 0.45, w.h * 0.62, -d * 0.9);
      tcam.setTarget(new BABYLON.Vector3(300, w.h * 0.46, 0));
      await new Promise((r) => requestAnimationFrame(() => r()));
      const url = await BABYLON.Tools.CreateScreenshotUsingRenderTargetAsync(engine, tcam, 220, 'image/png', 1, true);
      const img = new Image(); img.alt = w.label; img.src = url;
      const pic = cards.get(w.id).querySelector('.pic'); pic.replaceChildren(img);
      P.showcase.dispose(rig); e.node.dispose();
    } catch { break; } // (no picture: the card keeps its emoji)
  }
  tcam.dispose();
}

function wire() {
  $('hat').replaceChildren(...C.LOOK.hats.map((h) => Object.assign(document.createElement('option'), { value: h, textContent: h === 'none' ? 'no hat' : h })));
  $('shape').replaceChildren(...C.LOOK.shapes.map((h) => Object.assign(document.createElement('option'), { value: h, textContent: h })));
  $('bg').replaceChildren(...Object.keys(BGS).map((h) => Object.assign(document.createElement('option'), { value: h, textContent: `${h} backdrop` })));
  $('hat').onchange = (e) => { state.hat = e.target.value; build(); };
  $('shape').onchange = (e) => { state.shape = e.target.value; build(); };
  $('bg').onchange = (e) => { state.bg = e.target.value; applyBg(); refreshUi(); };
  for (const id of ['c1', 'c2', 'c3']) $(id).oninput = () => { state.colors = ['c1', 'c2', 'c3'].map((k) => $(k).value); build(); };
  $('colorReset').onclick = () => { state.colors = null; build(); };
  $('colorRandom').onclick = () => { const r = C.randomLook(); state.colors = [r.body, r.accent, r.head]; build(); };
}
function applyBg() {
  if (!running) return;
  const bg = BGS[state.bg];
  scene.clearColor = BABYLON.Color4.FromColor3(BABYLON.Color3.FromHexString(bg.sky), 1);
  const floor = [...W.entities].find((e) => e.name === 'Floor');
  if (floor && floor.node.material) floor.node.material.diffuseColor = BABYLON.Color3.FromHexString(bg.floor);
  if (W.hemi) W.hemi.intensity = bg.ambient + 0.2;
  if (W.sun) W.sun.intensity = bg.sun;
}

// ------------------------------------------------------------------ go
let frames = 0;
function loop() {
  if (!running) return;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000 || 1 / 60);
    if (!state.freeze) step(dt);
    if (state.turn) cam.alpha += 0.7 * dt;
    frames++;
    // (final once the body has been drawn for a few frames and any Gen model it waits for has loaded or failed)
    if (frames >= 4 && !document.body.dataset.ready && !(cur && cur.rig.pm && cur.rig.pm.state === 'loading')) document.body.dataset.ready = 'true', window.avatarsReady = true;
    if (frames % 30 === 0 && cur && !state.freeze) readStats();
  });
  window.addEventListener('resize', () => { if (cur) frameCamera(); });
}

if (!WHATS.length) {
  $('error').hidden = false; $('error').textContent = 'The engine did not load.';
  document.body.dataset.ready = 'error';
} else {
  wire();
  const cards = renderGrid();
  start();
  applyBg();
  build();
  loop();
  if (running) {
    // A window for tests and playtests: the same things the buttons do.
    window.hawkesAvatars = { models: P.models ? C.WHATS.filter((w) => P.models.enabled(w.id)).map((w) => w.id) : [], bodies: WHATS.map((w) => w.id), poses: [...POSES, ...THING_POSES, ...EMOTES], anim: () => (cur && P.anim ? P.anim.info(cur.rig) : null), probe, crowd, setPose: (p, t) => { state.pose = p; state.freeze = true; cur.t = 0; if (cur.rig.emote) cur.rig.emote = null; settle(Number(t) || 0); refreshUi(); }, get state() { return { id: state.id, pose: state.pose, bg: state.bg, ...cur.stats }; }, select: (id) => pick(id, false), pose: (p) => { state.pose = p; state.freeze = false; refreshUi(); } };
    thumbnails(cards);
  } else if (!document.body.dataset.ready) document.body.dataset.ready = 'error';
}
