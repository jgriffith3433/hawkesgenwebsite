// /community: the community library (src/community.ts). Shelves from GET /v1/community/categories, things from
// GET /v1/community (search, kind, category, sort, a page at a time), one opened in a panel: a model live in Babylon, a
// picture big, a sound with a player. The URL keeps what's shown (?kind=&category=&q=&sort=&open=), so a shelf or a
// thing can be linked.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE = 48;
const KIND = {
  model: ['3D models', 'model', '.glb'], texture: ['Textures', 'texture', '.png'], sky: ['Skies', 'sky', '.png'], sprite: ['Sprites & icons', 'sprite', '.png'],
  image: ['Images', 'image', '.png'], music: ['Music', 'music', '.mp3'], ambience: ['Ambience', 'ambience loop', '.mp3'], sfx: ['Sound effects', 'sound effect', '.mp3'],
  voice: ['Voice', 'voice line', '.mp3'], video: ['Video', 'video', '.mp4'],
};
const AUDIO = new Set(['music', 'ambience', 'sfx', 'voice']);
const HOW = {
  model: 'Put it in your world as a model; the low-detail copy comes with it for far away.',
  texture: 'A seamless tile: use it as a material on floors, walls and terrain.',
  sky: 'A 360° panorama: set it as your game\'s sky.',
  sprite: 'A transparent picture: icons, pickups and effects.',
  music: 'Background music for a level or a menu.',
  ambience: 'A loop that sets the place: play it under everything else.',
  sfx: 'A short sound for an action or an event.',
};

const url = new URL(location.href);
const state = { kind: url.searchParams.get('kind') ?? '', category: url.searchParams.get('category') ?? '', q: url.searchParams.get('q') ?? '', sort: url.searchParams.get('sort') ?? 'liked', offset: 0 };
let shelves = { kinds: [], total: 0 };
let shown = [];

function keepUrl(open) {
  const u = new URL(location.href);
  for (const k of ['kind', 'category', 'q', 'sort']) (state[k] && !(k === 'sort' && state[k] === 'liked')) ? u.searchParams.set(k, state[k]) : u.searchParams.delete(k);
  open ? u.searchParams.set('open', open) : u.searchParams.delete('open');
  history.replaceState(null, '', u);
}

async function api(path) {
  const r = await fetch(path, { credentials: 'same-origin' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function renderStats() {
  const n = (k) => shelves.kinds.find((x) => x.kind === k)?.count ?? 0;
  const sounds = n('music') + n('ambience') + n('sfx') + n('voice');
  $('stats').innerHTML = [[shelves.total, 'things'], [n('model'), '3D models'], [n('texture') + n('sky') + n('sprite') + n('image'), 'textures & art'], [sounds, 'sounds & music']]
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
}

function renderShelves() {
  const btn = (kind, category, label, count, cls) => `<button type="button" class="${cls}${state.kind === kind && state.category === category ? ' on' : ''}${cls === 'cat' && state.kind === kind ? ' show' : ''}" data-kind="${esc(kind)}" data-category="${esc(category)}">${esc(label)}<span class="n">${count}</span></button>`;
  $('shelves').innerHTML = btn('', '', 'Everything', shelves.total, 'kind') + shelves.kinds.map((k) =>
    btn(k.kind, '', KIND[k.kind]?.[0] ?? k.kind, k.count, 'kind') + k.categories.map((c) => btn(k.kind, c.category, shelfName(c.category), c.count, 'cat')).join('')).join('');
}
/** A category as people read it: "scifi" is Sci-fi, "ui" is UI. */
const SHELF = { scifi: 'Sci-fi', ui: 'UI' };
const shelfName = (c) => SHELF[c] ?? c.split('-').map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

function thumbOf(it) {
  if (it.thumb) return `<img src="${esc(it.thumb)}" alt="" loading="lazy">`;
  return `<span class="glyph">${esc(KIND[it.kind]?.[1] ?? it.kind)}</span>`;
}

function card(it) {
  const tile = ['texture', 'sky'].includes(it.kind);
  const sub = [KIND[it.kind]?.[1] ?? it.kind, it.category && shelfName(it.category)].filter(Boolean).join(' · ');
  return `<button type="button" class="card" data-id="${esc(it.id)}">
    <div class="thumb${tile ? ' tile' : ''}">${thumbOf(it)}${AUDIO.has(it.kind) ? `<span class="play" data-play="${esc(it.id)}" role="button" aria-label="Play ${esc(it.title)}">▶</span>` : ''}</div>
    <div class="meta"><span class="title">${esc(it.title)}</span><span class="sub">${esc(sub)}${it.by && it.by !== 'Hawkes' ? ` · by ${esc(it.by)}` : ''}</span></div>
  </button>`;
}

function where(total) {
  const k = state.kind ? KIND[state.kind]?.[0] ?? state.kind : 'Everything';
  return `${k}${state.category ? ` › ${state.category}` : ''}${state.q ? ` › "${state.q}"` : ''} · ${total} ${total === 1 ? 'thing' : 'things'}`;
}

async function load(append = false) {
  if (!append) { state.offset = 0; shown = []; }
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(state.offset), sort: state.sort });
  if (state.kind) { qs.set('kind', state.kind); qs.set('exact', '1'); }
  if (state.category) qs.set('category', state.category);
  if (state.q) qs.set('q', state.q);
  let r;
  try {
    r = await api(`/v1/community?${qs}`);
  } catch (e) {
    $('grid').innerHTML = `<div class="empty"><h3>The library didn't load</h3><p>${esc(e.message)}. Try again in a moment.</p></div>`;
    return;
  }
  shown = shown.concat(r.items);
  state.offset += r.items.length;
  $('where').textContent = where(r.total);
  if (!shown.length) {
    $('grid').innerHTML = shelves.total
      ? `<div class="empty"><h3>Nothing matches</h3><p>Try other words, or another shelf.</p></div>`
      : `<div class="empty"><h3>The library is being stocked</h3><p>Hawkes is making the starter pack: five of each kind of thing in every category. They show up here as they're finished. You can share your own from the editor (Create &gt; Yours, ⇪).</p></div>`;
  } else {
    $('grid').innerHTML = shown.map(card).join('');
  }
  $('more').hidden = state.offset >= r.total;
  keepUrl();
}

// ------------------------------------------------------------------ the panel

let viewer = null;
let player = null;
function stopViewer() {
  if (viewer) { viewer.engine.stopRenderLoop(); viewer.scene.dispose(); viewer.engine.dispose(); viewer = null; }
}

async function showModel(it) {
  const B = window.BABYLON;
  if (!B?.SceneLoader) { $('pView').innerHTML = it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : ''; return; }
  $('pView').innerHTML = '<canvas id="pCanvas" aria-label="3D preview"></canvas><span class="hint">drag to turn · scroll to zoom</span>';
  const canvas = $('pCanvas');
  const engine = new B.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
  const scene = new B.Scene(engine);
  scene.clearColor = new B.Color4(0.043, 0.051, 0.078, 1);
  const cam = new B.ArcRotateCamera('cam', -Math.PI / 2.4, Math.PI / 2.6, 4, B.Vector3.Zero(), scene);
  cam.attachControl(canvas, true);
  cam.wheelPrecision = 60;
  cam.lowerRadiusLimit = 0.5;
  new B.HemisphericLight('sky', new B.Vector3(0.3, 1, 0.2), scene).intensity = 1.1;
  const sun = new B.DirectionalLight('sun', new B.Vector3(-0.5, -1, -0.6), scene);
  sun.intensity = 1.4;
  viewer = { engine, scene };
  engine.resize();
  engine.runRenderLoop(() => scene.render());
  addEventListener('resize', () => viewer?.engine.resize());
  try {
    // The preview needs no more than the model's mid level (Gen's levels of detail), when it has one.
    const levels = it.lods && it.lods.kind === 'mesh' ? it.lods.levels : [];
    const src = (levels.find((l) => l.role === 'mid') || levels.find((l) => l.role === 'high') || {}).url || it.file;
    const r = await B.SceneLoader.ImportMeshAsync('', src, '', scene, null, '.glb');
    const meshes = r.meshes.filter((m) => m.getTotalVertices?.() > 0);
    let min = new B.Vector3(Infinity, Infinity, Infinity), max = new B.Vector3(-Infinity, -Infinity, -Infinity);
    for (const m of meshes) { m.computeWorldMatrix(true); const b = m.getBoundingInfo().boundingBox; min = B.Vector3.Minimize(min, b.minimumWorld); max = B.Vector3.Maximize(max, b.maximumWorld); }
    const size = max.subtract(min);
    cam.target = min.add(size.scale(0.5));
    cam.radius = Math.max(size.x, size.y, size.z) * 2.6 || 4;
    cam.useAutoRotationBehavior = true;
    cam.autoRotationBehavior.idleRotationSpeed = 0.35;
  } catch (e) {
    $('pView').innerHTML = `${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : ''}<span class="hint">the 3D preview didn't load (${esc(e.message ?? e)})</span>`;
    stopViewer();
  }
}

function open(it) {
  stopViewer();
  const k = KIND[it.kind] ?? [it.kind, it.kind, ''];
  $('pTitle').textContent = it.title;
  $('pKv').innerHTML = `<b>${esc(k[1])}</b>${it.category ? ` · <a href="?kind=${encodeURIComponent(it.kind)}&category=${encodeURIComponent(it.category)}">${esc(shelfName(it.category))}</a>` : ''} · by ${esc(it.by)}<br>used in ${it.uses} ${it.uses === 1 ? 'game' : 'games'}${it.likes ? ` · ${it.likes} ${it.likes === 1 ? 'builder' : 'builders'} picked it` : ''}${it.low ? ' · comes with a low-detail copy' : ''}`;
  $('pTags').innerHTML = it.tags.map((t) => `<a href="?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('');
  $('pHow').innerHTML = `${esc(HOW[it.kind] ?? '')} Open your game and pick it under <code>Create › Community</code>, or tell the assistant "${esc(it.title.toLowerCase())}".`;
  const name = `${it.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'asset'}${k[2]}`;
  $('pFile').href = it.file;
  $('pFile').setAttribute('download', name);
  // Shown first: the 3D view sizes its canvas from the open panel.
  $('sheet').hidden = false;
  if (it.kind === 'model') void showModel(it);
  else if (AUDIO.has(it.kind)) $('pView').innerHTML = `<div style="width:100%;padding:24px;display:grid;gap:16px;place-items:center">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" style="max-height:220px">` : `<span class="glyph" style="font:600 14px var(--mono);color:#9aa3b8;letter-spacing:.12em;text-transform:uppercase">${esc(k[1])}</span>`}<audio controls autoplay src="${esc(it.file)}"${it.kind === 'ambience' || it.kind === 'music' ? ' loop' : ''}></audio></div>`;
  else $('pView').innerHTML = `<img src="${esc(it.file)}" alt="${esc(it.title)}">`;
  keepUrl(it.id);
  $('pClose').focus();
}
function close() {
  stopViewer();
  $('pView').innerHTML = '';
  $('sheet').hidden = true;
  keepUrl();
}

// ------------------------------------------------------------------ events

$('shelves').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  state.kind = b.dataset.kind;
  state.category = b.dataset.category;
  renderShelves();
  void load();
});
let typing;
$('q').addEventListener('input', () => { clearTimeout(typing); typing = setTimeout(() => { state.q = $('q').value.trim(); void load(); }, 250); });
$('sort').addEventListener('change', () => { state.sort = $('sort').value; void load(); });
$('more').addEventListener('click', () => void load(true));
$('grid').addEventListener('click', (e) => {
  const play = e.target.closest('[data-play]');
  if (play) {
    e.stopPropagation();
    const it = shown.find((x) => x.id === play.dataset.play);
    if (player && player.dataset.id === it.id && !player.paused) { player.pause(); play.textContent = '▶'; return; }
    player?.pause();
    document.querySelectorAll('[data-play]').forEach((p) => { p.textContent = '▶'; });
    player = new Audio(it.file);
    player.dataset.id = it.id;
    player.play().catch(() => {});
    play.textContent = '❚❚';
    player.onended = () => { play.textContent = '▶'; };
    return;
  }
  const c = e.target.closest('.card');
  if (c) { player?.pause(); open(shown.find((x) => x.id === c.dataset.id)); }
});
$('sheet').addEventListener('click', (e) => { if (e.target === $('sheet')) close(); });
$('pClose').addEventListener('click', close);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('sheet').hidden) close(); });

$('q').value = state.q;
$('sort').value = state.sort;
try {
  shelves = await api('/v1/community/categories');
} catch { /* the grid says so */ }
renderStats();
renderShelves();
await load();
const want = url.searchParams.get('open');
if (want) {
  const it = shown.find((x) => x.id === want) ?? (await api(`/v1/community?limit=120`).catch(() => ({ items: [] }))).items.find((x) => x.id === want);
  if (it) open(it);
}
