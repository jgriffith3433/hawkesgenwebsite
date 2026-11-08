// /community: the community library (src/community.ts). Shelves from GET /v1/community/categories, things from
// GET /v1/community (search, kind, category, sort, a page at a time), one opened in a panel: a model live in Babylon, a
// picture big, a sound with a player. The URL keeps what's shown (?kind=&category=&q=&sort=&open=), so a shelf or a
// thing can be linked. In the Overseer's voice where it speaks (headings, empty states); every label says what a thing is.
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

/** What each shelf says about itself: the Overseer's voice, then what is actually on it. */
const SHELF_VOICE = {
  '': ['Everything in the archive.', 'All of it, on one shelf. Pick a kind on the left, or ask for a word above.'],
  model: ['Things to stand in a world.', '3D models (.glb). Each comes with a low-detail copy for when it is far away.'],
  texture: ['Surfaces for the ground and walls.', 'Seamless tiles (.png), to use as materials on floors, walls and terrain.'],
  sky: ['Skies to hang over a planet.', '360° panoramas (.png), to set as your game\'s sky.'],
  sprite: ['Small things that glow in a hand.', 'Transparent pictures (.png): icons, pickups and effects.'],
  image: ['Pictures.', 'Images (.png) shared by builders.'],
  music: ['Music for a level or a menu.', 'Songs (.mp3). Press play to hear one.'],
  ambience: ['The sound of a place.', 'Loops (.mp3) that sit under everything else.'],
  sfx: ['A sound for every action.', 'Short sound effects (.mp3) for actions and events.'],
  voice: ['Voices.', 'Voice lines (.mp3).'],
  video: ['Moving pictures.', 'Video clips (.mp4).'],
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
    .filter(([v]) => v > 0)
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
}

function renderShelves() {
  // A kind or shelf with nothing behind it is not shown, and a link to one falls back to everything.
  const kindRow = shelves.kinds.find((k) => k.kind === state.kind);
  if (state.kind && !kindRow) { state.kind = ''; state.category = ''; }
  else if (state.category && !kindRow?.categories.some((c) => c.category === state.category)) state.category = '';
  const btn = (kind, category, label, count, cls) => `<button type="button" class="${cls}${state.kind === kind && state.category === category ? ' on' : ''}${cls === 'cat' && state.kind === kind ? ' show' : ''}" data-kind="${esc(kind)}" data-category="${esc(category)}">${esc(label)}<span class="n">${count}</span></button>`;
  $('shelves').innerHTML = btn('', '', 'Everything', shelves.total, 'kind') + shelves.kinds.filter((k) => k.count > 0).map((k) =>
    btn(k.kind, '', KIND[k.kind]?.[0] ?? k.kind, k.count, 'kind') + k.categories.filter((c) => c.count > 0).map((c) => btn(k.kind, c.category, shelfName(c.category), c.count, 'cat')).join('')).join('');
}
/** A category as people read it: "scifi" is Sci-fi, "ui" is UI. */
const SHELF = { scifi: 'Sci-fi', ui: 'UI' };
const shelfName = (c) => SHELF[c] ?? c.split('-').map((w, i) => (i ? w : w[0].toUpperCase() + w.slice(1))).join(' ');

const ICON = { model: '\u{1F9CA}', texture: '\u{1F9F1}', sky: '\u{1F305}', sprite: '\u2728', image: '\u{1F5BC}', music: '\u{1F3B5}', ambience: '\u{1F32C}', sfx: '\u{1F4A5}', voice: '\u{1F5E3}', video: '\u{1F3AC}' };
function thumbOf(it) {
  if (it.thumb) return `<img src="${esc(it.thumb)}" alt="" loading="lazy">`;
  return `<span class="glyph"><i aria-hidden="true">${ICON[it.kind] ?? '\u25C7'}</i>${esc(KIND[it.kind]?.[1] ?? it.kind)}</span>`;
}
const usesText = (n) => `${n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n} ${n === 1 ? 'use' : 'uses'}`;
/** Loading: the shape of the cards that are coming, never a blank page. */
const skeletons = (n) => Array.from({ length: n }, () => '<div class="card skel" aria-hidden="true"><div class="sk-thumb"></div><div class="meta"><span class="sk-bar" style="width:70%"></span><span class="sk-bar" style="width:45%"></span><span class="sk-bar" style="width:55%"></span></div></div>').join('');
function setGrid(stateName, html) { const g = $('grid'); g.dataset.state = stateName; g.setAttribute('aria-busy', stateName === 'loading' ? 'true' : 'false'); g.innerHTML = html; }

function card(it) {
  const tile = ['texture', 'sky'].includes(it.kind);
  const sub = [KIND[it.kind]?.[1] ?? it.kind, it.category && shelfName(it.category)].filter(Boolean).join(' · ');
  const by = it.by || 'Hawkes';
  return `<button type="button" class="card" data-id="${esc(it.id)}">
    <div class="thumb${tile ? ' tile' : ''}">${thumbOf(it)}<span class="badge">${esc(KIND[it.kind]?.[1] ?? it.kind)}</span>${AUDIO.has(it.kind) ? `<span class="play" data-play="${esc(it.id)}" role="button" aria-label="Play ${esc(it.title)}">▶</span>` : ''}</div>
    <div class="meta"><span class="title">${esc(it.title)}</span><span class="sub">${esc(sub)}</span>
      <span class="by"><span class="av" aria-hidden="true">${esc([...by][0].toUpperCase())}</span><span class="nm">by <b>${esc(by)}</b></span></span>
      <span class="stat"><span class="u">${esc(usesText(it.uses ?? 0))}</span>${it.likes ? `<span>${it.likes} ${it.likes === 1 ? 'pick' : 'picks'}</span>` : ''}</span></div>
  </button>`;
}

function renderShelfHead() {
  const [h, p] = SHELF_VOICE[state.kind] ?? [KIND[state.kind]?.[0] ?? state.kind, ''];
  const cat = state.category ? ` On the ${shelfName(state.category)} shelf.` : '';
  $('shelfHead').innerHTML = `<h2>${esc(state.category ? shelfName(state.category) : h)}</h2><p>${esc(p + cat)}</p>`;
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
  if (!append) setGrid('loading', skeletons(8));
  else $('more').disabled = true;
  let r;
  try {
    r = await api(`/v1/community?${qs}`);
  } catch (e) {
    $('more').disabled = false;
    if (append) return;
    setGrid('error', `<div class="empty"><span class="ico" aria-hidden="true">\u{1F4E1}</span><h3>The archive didn't open</h3><p>The library didn't load (${esc(e.message)}). Nothing is lost: try again.</p><button type="button" class="btn btn-secondary" id="retry">Try again</button></div>`);
    $('retry').addEventListener('click', () => void load());
    return;
  }
  $('more').disabled = false;
  shown = shown.concat(r.items);
  state.offset += r.items.length;
  renderShelfHead();
  $('where').textContent = where(r.total);
  if (!shown.length) {
    setGrid('empty', shelves.total
      ? `<div class="empty"><span class="ico" aria-hidden="true">\u{1F52D}</span><h3>The Overseer finds nothing for that.</h3><p>Nothing in the library matches${state.q ? ` "${esc(state.q)}"` : ''}. Try other words, or another shelf.</p><button type="button" class="btn btn-secondary" id="clear">Show everything</button></div>`
      : `<div class="empty"><span class="ico" aria-hidden="true">\u{1F4DA}</span><h3>The shelves are still being filled.</h3><p>The library is empty for now. Hawkes is making the starter pack: five of each kind of thing in every category. They show up here as they're finished. You can share your own from the editor (Create &gt; Yours, ⇪).</p></div>`);
    $('clear')?.addEventListener('click', () => { state.kind = ''; state.category = ''; state.q = ''; $('q').value = ''; renderShelves(); void load(); });
  } else {
    setGrid('ready', shown.map(card).join(''));
  }
  renderFeatured();
  $('more').hidden = state.offset >= r.total;
  keepUrl();
}

// The featured row: the most picked things, fetched once when the page opens (no refresh loop), shown on the unfiltered view.
let featured = [];
function renderFeatured() {
  const on = featured.length > 0 && !state.q && !state.category && !state.kind;
  $('featured').hidden = !on;
  if (on) $('featRow').innerHTML = featured.map(card).join('');
}
const itemById = (id) => shown.find((x) => x.id === id) ?? featured.find((x) => x.id === id);

// ------------------------------------------------------------------ the panel

let viewer = null;
let player = null;
function stopViewer() {
  if (viewer) { viewer.engine.stopRenderLoop(); viewer.scene.dispose(); viewer.engine.dispose(); viewer = null; }
}

async function showModel(it) {
  const B = window.BABYLON;
  if (!B?.SceneLoader) { $('pView').innerHTML = it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : ''; return; }
  $('pView').innerHTML = '<canvas id="pCanvas" aria-label="3D preview"></canvas><span class="hint">drag to turn · scroll or pinch to zoom</span>';
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

/** A sound: a big play button, a bar of the sound's length, the time, a seek slider. */
let panelAudio = null;
const fmt = (t) => (Number.isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '0:00');
function stopSound() { if (panelAudio) { panelAudio.pause(); panelAudio.src = ''; panelAudio = null; } }
function showSound(it, k) {
  const loop = it.kind === 'ambience' || it.kind === 'music';
  const bars = Array.from({ length: 48 }, (_, i) => `<i style="height:${14 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)) * 54)}px"></i>`).join('');
  $('pView').innerHTML = `<div class="snd">${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : `<span class="kindname">${esc(k[1])}</span>`}
    <div class="wave" aria-hidden="true">${bars}</div>
    <div class="bar"><button type="button" class="pp" id="pPlay" aria-label="Play">▶</button><span id="pTime">0:00 / 0:00</span><span>${loop ? 'loops' : ''}</span>
      <div class="seek"><input type="range" id="pSeek" min="0" max="1000" value="0" aria-label="Position in ${esc(it.title)}"></div></div></div>`;
  const a = new Audio(it.file);
  a.loop = loop;
  panelAudio = a;
  const bs = [...$('pView').querySelectorAll('.wave i')];
  const btn = $('pPlay'), seek = $('pSeek');
  const paint = () => {
    const d = a.duration || 0, f = d ? a.currentTime / d : 0;
    $('pTime').textContent = `${fmt(a.currentTime)} / ${fmt(d)}`;
    seek.value = String(Math.round(f * 1000));
    bs.forEach((b, i) => b.classList.toggle('done', i / bs.length < f));
  };
  a.addEventListener('timeupdate', paint);
  a.addEventListener('loadedmetadata', paint);
  a.addEventListener('play', () => { btn.textContent = '❚❚'; btn.setAttribute('aria-label', 'Pause'); });
  a.addEventListener('pause', () => { btn.textContent = '▶'; btn.setAttribute('aria-label', 'Play'); });
  btn.addEventListener('click', () => { if (a.paused) a.play().catch(() => {}); else a.pause(); });
  seek.addEventListener('input', () => { if (a.duration) a.currentTime = (Number(seek.value) / 1000) * a.duration; });
  a.play().catch(() => {});
}

// "Use in a game": the signed-in builder's games, one tap. Signed out, the button goes to /app to start.
let myGames = null;
async function loadGames() {
  if (myGames) return myGames;
  try { myGames = (await api('/v1/games')).games ?? []; } catch { myGames = []; }
  return myGames;
}
async function setupUse(it) {
  const note = $('pUseNote'), sel = $('pGame'), use = $('pUse');
  note.className = 'note';
  note.textContent = 'Free to use. It goes into your game\'s own assets.';
  use.textContent = 'Use in a game';
  use.setAttribute('href', '/app');
  use.onclick = null;
  sel.hidden = true; $('pGameLabel').hidden = true;
  const games = await loadGames();
  if (it !== current) return;
  if (!games.length) { note.textContent = 'Free to use. Start a game and this goes in with one tap: sign in or make a free account first.'; return; }
  sel.innerHTML = games.map((g) => `<option value="${esc(g.id)}">${esc(g.title || 'Untitled game')}</option>`).join('');
  sel.hidden = false; $('pGameLabel').hidden = false;
  use.removeAttribute('href');
  use.setAttribute('role', 'button');
  use.setAttribute('tabindex', '0');
  use.onclick = async (e) => {
    e.preventDefault();
    use.setAttribute('aria-disabled', 'true');
    try {
      const r = await fetch(`/v1/games/${encodeURIComponent(sel.value)}/community`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(b.error || `HTTP ${r.status}`);
      note.className = 'note ok';
      note.innerHTML = `Added to the game. <a href="/app/g/${encodeURIComponent(sel.value)}">Open it</a> and it is already in the world's assets.`;
      use.textContent = 'Added ✓';
    } catch (err) {
      note.className = 'note err';
      note.textContent = `That did not go in: ${err.message}`;
    }
    use.removeAttribute('aria-disabled');
  };
  use.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') use.click(); };
}

let current = null;
function open(it) {
  current = it;
  stopSound();
  stopViewer();
  const k = KIND[it.kind] ?? [it.kind, it.kind, ''];
  $('pLabel').textContent = k[0];
  $('pTitle').textContent = it.title;
  $('pKv').innerHTML = `<b>${esc(k[1])}</b>${it.category ? ` · <a href="?kind=${encodeURIComponent(it.kind)}&category=${encodeURIComponent(it.category)}">${esc(shelfName(it.category))}</a>` : ''} · by ${esc(it.by)}<br>used in ${it.uses} ${it.uses === 1 ? 'game' : 'games'}${it.likes ? ` · ${it.likes} ${it.likes === 1 ? 'builder' : 'builders'} picked it` : ''}${it.low ? ' · comes with a low-detail copy' : ''}`;
  $('pTags').innerHTML = it.tags.map((t) => `<a href="?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('');
  $('pHow').innerHTML = `${esc(HOW[it.kind] ?? '')} Open your game and pick it under <code>Create › Community</code>, or tell the assistant "${esc(it.title.toLowerCase())}".`;
  const name = `${it.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'asset'}${k[2]}`;
  void setupUse(it);
  const gone = !it.file;
  $('pFile').hidden = gone;
  if (!gone) { $('pFile').href = it.file; $('pFile').setAttribute('download', name); }
  // Shown first: the 3D view sizes its canvas from the open panel.
  $('sheet').hidden = false;
  if (gone) $('pView').innerHTML = `<div class="snd"><span class="kindname">${esc(k[1])}</span><p>The Overseer can't find this one's file right now. It will be back when it is kept again.</p></div>`;
  else if (it.kind === 'model') void showModel(it);
  else if (AUDIO.has(it.kind)) showSound(it, k);
  else $('pView').innerHTML = `<img src="${esc(it.file)}" alt="${esc(it.title)}">`;
  keepUrl(it.id);
  $('pClose').focus();
}
function close() {
  current = null;
  stopSound();
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
// Search runs when the person asks (Enter or the button): nothing fires on a timer.
$('search').addEventListener('submit', (e) => { e.preventDefault(); state.q = $('q').value.trim(); void load(); });
$('sort').addEventListener('change', () => { state.sort = $('sort').value; void load(); });
$('more').addEventListener('click', () => void load(true));
for (const root of [$('grid'), $('featRow')]) root.addEventListener('click', (e) => {
  const play = e.target.closest('[data-play]');
  if (play) {
    e.stopPropagation();
    const it = itemById(play.dataset.play);
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
  if (c) { player?.pause(); open(itemById(c.dataset.id)); }
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
// Featured and the first page ask together, once, when the page opens.
const featuredAsk = api('/v1/community?limit=6&sort=liked').then((r) => { featured = r.items.filter((x) => x.uses || x.likes || x.thumb).slice(0, 6); }).catch(() => {});
await Promise.all([load(), featuredAsk]);
renderFeatured();
window.hgCommunityReady = true;
const want = url.searchParams.get('open');
if (want) {
  const it = shown.find((x) => x.id === want) ?? (await api(`/v1/community?limit=120`).catch(() => ({ items: [] }))).items.find((x) => x.id === want);
  if (it) open(it);
}

// A picture that fails to load (the file is not there, or Gen would not give it) becomes a quiet tile, never a broken-image icon.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || img.dataset.failed) return;
  img.dataset.failed = '1';
  const tile = document.createElement('span');
  tile.className = 'glyph';
  const kind = img.closest('.card')?.querySelector('.badge')?.textContent ?? '';
  tile.innerHTML = `<i aria-hidden="true">\u25C7</i>${esc(kind || img.alt || 'File missing')}`;
  img.replaceWith(tile);
}, true);
