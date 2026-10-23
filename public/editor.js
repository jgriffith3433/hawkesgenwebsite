// The editor (/app/g/<id>): your game, full screen, and you build inside it (play/build.js, in the sandboxed frame).
// This page holds what needs your account: saving world edits (POST /scene), the live feed of files, assets, chat and
// people (SSE /live), the assistant (which gets told what you're looking at), and the Advanced drawer (code, assets,
// settings, docs). The game frame and this page talk with postMessage; the game never sees the cookie.
/* global CodeMirror marked */
const API = '/v1';
const gameId = /\/app\/g\/(g_[0-9a-f]+)/.exec(location.pathname)?.[1];
if (!gameId) location.replace('/app');
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let game = null;
let files = {};
let assets = {};
let members = [];
let releases = [];
let me = null;
let connId = null; // this page's live feed (SSE)
let roomConn = null; // the game frame's realtime connection (so the server doesn't echo our own edits back)
let editor = null;
let openPath = null;
let baseRev = null;
let saving = false;
let dirty = false;
let saveTimer = null;
let sse = null;
let chatHistory = [];
let pendingGens = [];
let errors = [];
let mention = null;
let stageReady = false;
let aiCredits = 8;
let voiceEnabled = (() => { try { return localStorage.getItem('hg_voice') === '1'; } catch { return false; } })();

// ===================================================================== start
(async () => {
  try {
    me = (await get('/v1/users/me')).user;
    const data = await get(`${API}/games/${gameId}`);
    $('profileAvatar').textContent = (me.name || me.email || '?')[0].toUpperCase();
    // Coming from the site: the light fades into the game.
    setTimeout(() => $('enter')?.remove(), 1200);
    game = data.game;
    aiCredits = data.aiCredits || 8;
    // Local testing switch (server's PORTAL_DEV_OPEN_PLAY): the frame shares this page's origin.
    if (data.devOpenPlay) {
      stageReady = false;
      const fresh = stage.cloneNode(false);
      fresh.removeAttribute('sandbox');
      stage.replaceWith(fresh);
      stage = fresh;
    }
    files = Object.fromEntries(data.files.map((f) => [f.path, f]));
    assets = Object.fromEntries(data.assets.map((a) => [a.name, a]));
    members = data.game.members || [];
    releases = data.releases || [];
    $('gameTitle').value = game.title;
    document.title = `${game.title} · Hawkes Gen`;
    $('chatCost').textContent = `${aiCredits} credits`;
    render();
    connect();
    loadDocs();
    loadSettings();
    loadChat();
    initVoice();
    loadStage();
    const paths = Object.keys(files).sort();
    const first = paths.find((p) => p.startsWith('scripts/')) || paths.find((p) => p.endsWith('.js')) || paths[0];
    if (first) openFile(first);
    await bootSequence();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Failed to load game');
    location.replace('/app');
  }
})();

// ===================================================================== api helpers
async function get(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
async function post(url, body, headers = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (connId) h['X-Conn'] = connId;
  const res = await fetch(url, { method: 'POST', headers: h, credentials: 'include', body: JSON.stringify(body ?? {}) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(out.error || res.statusText); e.status = res.status; e.body = out; throw e; }
  return out;
}
async function del(url) {
  const h = {};
  if (connId) h['X-Conn'] = connId;
  const res = await fetch(url, { method: 'DELETE', headers: h, credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ===================================================================== the game frame
let stage = $('stage');
// Same test the game uses for its on-screen sticks: the chat moves out of their way.
const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean' ? navigator.userAgentData.mobile || coarseOnly : coarseOnly) document.body.classList.add('touch');
const toStage = (m) => { try { stage.contentWindow.postMessage(m, '*'); } catch {} };
async function loadStage() {
  const bundle = await get(`${API}/games/${gameId}/bundle`);
  const send = () => toStage({ type: 'bundle', bundle, mode: 'build' });
  if (stageReady) send(); else stageBundle = send;
  toStage({ type: 'advanced', on: $('advTools').checked });
}
let stageBundle = null;
const contextWaits = new Map();
window.addEventListener('message', async (e) => {
  if (e.source !== stage.contentWindow) return;
  const m = e.data || {};
  if (m.source !== 'hawkes-play') return;
  switch (m.type) {
    case 'ready':
      stageReady = true;
      if (stageBundle) { stageBundle(); stageBundle = null; }
      toStage({ type: 'advanced', on: $('advTools').checked });
      return;
    case 'started': {
      clearErrors();
      const place = new URLSearchParams(location.search).get('place');
      if (place && assets[place]) {
        history.replaceState(null, '', location.pathname);
        const a = assets[place];
        const kind = a.kind === 'mesh' || /\.glb$/.test(place) ? 'mesh' : (a.mime || '').startsWith('image/') ? 'image' : (a.mime || '').startsWith('audio/') ? 'audio' : (a.mime || '').startsWith('video/') ? 'video' : a.kind;
        setTimeout(() => toStage({ type: 'place', asset: { name: place, kind, title: null } }), 600);
      }
      return;
    }
    case 'error': addError(m.message, m.file, m.line); return;
    case 'log': return;
    case 'ops': {
      // A world edit from the game: save it; the server shares it with everyone else.
      setSaveState('Saving…');
      try {
        const r = await post(`${API}/games/${gameId}/scene`, { ops: m.ops, fx: m.fx }, roomConn ? { 'X-Room-Conn': roomConn } : {});
        toStage({ type: 'ack', seq: m.seq, errors: r.errors, created: r.created });
        setSaveState('Saved');
        setTimeout(() => setSaveState(''), 1200);
      } catch (err) {
        toStage({ type: 'ack', seq: m.seq, errors: [err.message] });
        setSaveState('Not saved');
      }
      return;
    }
    case 'resync': {
      const b = await get(`${API}/games/${gameId}/bundle`).catch(() => null);
      if (b) toStage({ type: 'files', files: { 'scene.json': b.files['scene.json'] ?? null } });
      return;
    }
    case 'context': { const w = contextWaits.get(m.id); if (w) { contextWaits.delete(m.id); w(m.context); } return; }
    case 'ask': await sendChat(m.text, m.mention, m.context); return;
    case 'focus-chat': setMention(m.mention); openAssistant(); $('chatInput').focus(); return;
    case 'generate': try { await post(`${API}/games/${gameId}/generate`, { kind: m.kind, prompt: m.prompt, name: m.name }); } catch (err) { addSystem(err.message); } return;
    case 'open-code': openDrawer('code'); openFile('scene.json'); if (m.entity) revealEntity(m.entity); return;
    case 'net': if (m.conn) roomConn = m.conn; return;
    case 'mode': return;
    case 'menu': openMenu(); return;
    case 'card': $('ai').classList.toggle('dim', Boolean(m.open)); return;
    case 'library': toggleLibrary(); return;
  }
});
/** What the player can see right now, for the assistant (asked from the game, quickly). */
function worldContext() {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2);
    contextWaits.set(id, resolve);
    toStage({ type: 'context?', id });
    setTimeout(() => { if (contextWaits.delete(id)) resolve(null); }, 500);
  });
}
const sendFiles = (changed) => toStage({ type: 'files', files: changed });
async function sendAssets() {
  const b = await get(`${API}/games/${gameId}/bundle`).catch(() => null);
  if (b) toStage({ type: 'assets', assets: b.assets });
}

// ===================================================================== realtime (SSE): files, assets, chat, people
function connect() {
  if (sse) sse.close();
  sse = new EventSource(`${API}/games/${gameId}/live`, { withCredentials: true });
  sse.addEventListener('hello', (e) => { const d = JSON.parse(e.data); connId = d.conn; updatePresence(d.presence || []); });
  sse.addEventListener('file', (e) => {
    const d = JSON.parse(e.data);
    files[d.path] = d;
    // World edits (ops) already reached the game over its own connection; anything else is new code or a new world.
    if (!(d.path === 'scene.json' && d.ops)) sendFiles({ [d.path]: d.content });
    if (d.path === openPath) {
      if (d.conn && d.conn === connId) { /* our own save */ }
      else if (dirty) $('conflict').hidden = false;
      else { baseRev = d.rev; const pos = editor.getCursor(); editor.setValue(d.content); editor.setCursor(pos); editor.clearHistory(); }
    }
    render();
  });
  sse.addEventListener('file-deleted', (e) => { const d = JSON.parse(e.data); delete files[d.path]; sendFiles({ [d.path]: null }); if (d.path === openPath) closeFile(); render(); });
  sse.addEventListener('file-renamed', (e) => { const d = JSON.parse(e.data); delete files[d.from]; if (d.file) files[d.to] = d.file; sendFiles({ [d.from]: null, [d.to]: d.file ? d.file.content : null }); if (openPath === d.from) openPath = d.to; render(); });
  for (const ev of ['asset', 'asset-removed', 'asset-renamed']) sse.addEventListener(ev, (e) => {
    const d = JSON.parse(e.data);
    if (ev === 'asset') assets[d.name] = d;
    if (ev === 'asset-removed') delete assets[d.name];
    if (ev === 'asset-renamed') { assets[d.to] = { ...assets[d.from], name: d.to }; delete assets[d.from]; }
    render();
    sendAssets();
  });
  sse.addEventListener('presence', (e) => updatePresence(JSON.parse(e.data)));
  sse.addEventListener('chat', (e) => {
    const msg = JSON.parse(e.data);
    const i = chatHistory.findIndex((x) => x.id === msg.id);
    if (i >= 0) chatHistory[i] = msg; else chatHistory.push(msg);
    renderChat(i < 0 ? msg : null);
    if (i < 0 && msg.role === 'ai' && msg.text) speak(msg.text);
  });
  sse.addEventListener('thinking', (e) => { const d = JSON.parse(e.data); $('thinkingIndicator').hidden = !d.on; if (d.on) $('thinkingIndicator').textContent = `${d.by && d.by !== me?.name ? `${d.by}'s request: ` : ''}working…`; });
  sse.addEventListener('gen', (e) => onGen(JSON.parse(e.data)));
  sse.addEventListener('game', (e) => { const d = JSON.parse(e.data); game = { ...game, ...d }; members = d.members || members; if (document.activeElement !== $('gameTitle')) $('gameTitle').value = game.title; loadSettings(); });
  sse.addEventListener('release', (e) => { const d = JSON.parse(e.data); releases = d.releases || releases; renderReleases(); });
  sse.addEventListener('removed', (e) => { const d = JSON.parse(e.data); if (d.user === me?.id) { alert('You were removed from this game.'); location.replace('/app'); } });
  sse.addEventListener('deleted', () => { alert('This game was deleted.'); location.replace('/app'); });
  sse.addEventListener('reload', () => location.reload());
  sse.onerror = () => { sse.close(); setTimeout(connect, 3000); };
}
function updatePresence(list) {
  const el = $('presence');
  el.innerHTML = '';
  for (const p of list.filter((x) => x.user !== me?.id).slice(0, 5)) {
    const av = document.createElement('span');
    av.className = 'av';
    av.style.background = p.color || '#4a9eff';
    av.textContent = (p.name || '?')[0].toUpperCase();
    av.title = p.name;
    el.appendChild(av);
  }
}

// ===================================================================== the assistant
async function loadChat() {
  try { chatHistory = (await get(`${API}/games/${gameId}/chat`)).messages || []; renderChat(); } catch {}
  try { pendingGens = ((await get(`${API}/games/${gameId}/generate`)).gens || []).filter((g) => g && g.state === 'running'); renderGens(); for (const g of pendingGens) toStage({ type: 'gen', row: g }); } catch {}
}
function renderChat(fresh) {
  const log = $('chatLog');
  log.innerHTML = '';
  // Game chat: only the last few lines, fading out as they go up (studio.css), nothing to scroll.
  for (const msg of chatHistory.slice(-6)) {
    const div = document.createElement('div');
    div.className = `msg ${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'ai'}${msg === fresh ? ' new' : ''}`;
    if (msg.role !== 'system') div.innerHTML = `<span class="who">${esc(msg.role === 'ai' ? 'Assistant' : msg.name || 'Someone')}</span>`;
    div.appendChild(document.createTextNode(String(msg.text).length > 280 ? `${String(msg.text).slice(0, 280)}…` : msg.text));
    const d = msg.data || {};
    const did = [];
    if (d.world && d.world.length) did.push(`${d.world.length} change${d.world.length === 1 ? '' : 's'} to the world`);
    if (d.changed && d.changed.length) did.push(`edited ${d.changed.join(', ')}`);
    if (did.length) { const c = document.createElement('span'); c.className = 'changed'; c.textContent = did.join(' · '); div.appendChild(c); }
    for (const [i, sg] of (d.assets || []).entries()) {
      const sugg = document.createElement('span');
      sugg.className = 'sugg';
      sugg.innerHTML = `<span>${esc(sg.kind)}: ${esc(String(sg.prompt).slice(0, 40))}</span>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = sg.task ? 'Making…' : `Make it · ${sg.credits || ''}`;
      btn.disabled = Boolean(sg.task);
      btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Making…'; try { await post(`${API}/games/${gameId}/generate`, { kind: sg.kind, prompt: sg.prompt, name: sg.name, messageId: msg.id, suggestion: i }); } catch (err) { btn.disabled = false; addSystem(err.message); } };
      sugg.appendChild(btn);
      div.appendChild(sugg);
    }
    log.appendChild(div);
  }
  if (fresh) {
    // A new line shows a little more history for a moment.
    $('ai').classList.add('recent');
    clearTimeout(renderChat.t);
    renderChat.t = setTimeout(() => $('ai').classList.remove('recent'), 6000);
  }
}
function addSystem(text) { chatHistory.push({ id: `local_${Date.now()}`, role: 'system', text }); renderChat(); openAssistant(); }
function setMention(m) {
  mention = m && m.id ? m : null;
  $('mention').hidden = !mention;
  if (mention) $('mentionName').textContent = `@${mention.name || mention.id}`;
}
$('mentionX').onclick = () => setMention(null);
$('chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(); };
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); backToGame(); }
  if (e.key === 'Backspace' && !$('chatInput').value && mention) setMention(null);
});
/** Done typing: back into the game (Enter sends, Esc just goes back). */
function backToGame() { $('chatInput').blur(); $('ai').classList.remove('sheet'); stage.focus(); }

async function sendChat(text, about, ctx) {
  const input = $('chatInput');
  const message = (text ?? input.value).trim();
  if (!message) return;
  const target = about ?? mention;
  if (text === undefined) { input.value = ''; backToGame(); }
  const context = ctx ?? (await worldContext());
  const errText = errors.slice(-5).map((e) => `${e.file || 'script'}:${e.line ?? '?'}: ${e.text}`).join('\n');
  try {
    await post(`${API}/games/${gameId}/ai`, { message: target ? `@${target.name || target.id} ${message}` : message, mention: target || undefined, context: context || undefined, file: openPath, errors: errText || undefined });
    setMention(null);
  } catch (err) {
    addSystem(err.status === 402 ? `${err.message} Get more credits at /app#credits.` : err.message);
    if (text === undefined) input.value = message;
  }
}
function openAssistant() { $('ai').classList.add('sheet'); }
$('aiFab').onclick = () => { openAssistant(); $('chatInput').focus(); };

// ===================================================================== generation (Hawkes Gen making assets)
function onGen(row) {
  const i = pendingGens.findIndex((p) => p.task_id === row.task_id);
  if (i >= 0) pendingGens[i] = row; else pendingGens.push(row);
  if (row.state === 'done' || row.state === 'failed') setTimeout(() => { pendingGens = pendingGens.filter((p) => p.task_id !== row.task_id); renderGens(); }, 8000);
  renderGens();
  toStage({ type: 'gen', row });
  if (row.state === 'failed') addSystem(`Making ${row.name || row.kind} failed. Your credits for it were given back.`);
}
function renderGens() {
  const list = $('gensList');
  list.innerHTML = '';
  for (const g of pendingGens) {
    const div = document.createElement('div');
    div.className = `gen-row${g.state === 'failed' ? ' failed' : ''}`;
    div.textContent = g.state === 'done' ? `Made ${g.asset_name || g.name}` : g.state === 'failed' ? `Failed: ${g.name || g.kind}` : `Making ${g.name || g.kind}…`;
    list.appendChild(div);
  }
}

// ===================================================================== errors
function addError(text, file, line) {
  if (errors.some((e) => e.text === text && e.file === file && e.line === line)) return;
  errors.push({ text, file, line });
  if (errors.length > 20) errors.shift();
  renderErrors();
}
function clearErrors() { errors = []; renderErrors(); }
function renderErrors() {
  $('errorsContainer').hidden = !errors.length;
  $('errorCount').textContent = errors.length;
  const list = $('errorList');
  list.innerHTML = '';
  for (const err of errors.slice(-10)) {
    const div = document.createElement('div');
    div.className = 'err';
    if (err.file && files[err.file]) {
      div.innerHTML = `<span class="ln">${esc(err.file)}${err.line ? `:${err.line}` : ''}</span> ${esc(err.text)}`;
      div.querySelector('.ln').onclick = () => { openDrawer('code'); openFile(err.file); if (err.line) editor.setCursor(err.line - 1, 0); };
    } else div.textContent = `${err.file ? `${err.file}: ` : ''}${err.text}`;
    list.appendChild(div);
  }
}
$('errorPill').onclick = () => { $('errorPanel').hidden = !$('errorPanel').hidden; };
$('askFix').onclick = () => { $('errorPanel').hidden = true; sendChat('Fix the errors the game is showing.'); };

// ===================================================================== the Advanced drawer
function openDrawer(tab) {
  closeLibrary();
  $('drawer').classList.add('open');
  $('advancedBtn').classList.add('on');
  if (tab) selectTab(tab);
  if (editor) setTimeout(() => editor.refresh(), 230);
}
function closeDrawer() { $('drawer').classList.remove('open'); $('advancedBtn').classList.remove('on'); }
function selectTab(tab) {
  for (const b of document.querySelectorAll('.st-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  for (const p of document.querySelectorAll('.st-pane')) p.hidden = p.dataset.pane !== tab;
  if (tab === 'code' && editor) setTimeout(() => editor.refresh(), 0);
}
$('advancedBtn').onclick = () => ($('drawer').classList.contains('open') ? closeDrawer() : openDrawer());
$('drawerClose').onclick = closeDrawer;
for (const b of document.querySelectorAll('.st-tabs button')) b.onclick = () => selectTab(b.dataset.tab);
$('advTools').checked = (() => { try { return localStorage.getItem('hg_adv') === '1'; } catch { return false; } })();
$('advTools').onchange = () => { try { localStorage.setItem('hg_adv', $('advTools').checked ? '1' : '0'); } catch {} toStage({ type: 'advanced', on: $('advTools').checked }); };

function render() {
  const fl = $('filesList');
  fl.innerHTML = '';
  for (const p of Object.keys(files).sort()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `st-item${p === openPath ? ' on' : ''}`;
    const ext = p.split('.').pop();
    b.innerHTML = `<span class="k">${ext === 'js' ? 'JS' : ext === 'json' ? '{ }' : ext.toUpperCase()}</span><span class="nm">${esc(p)}</span>`;
    b.onclick = () => openFile(p);
    fl.appendChild(b);
  }
  const al = $('assetsList');
  al.innerHTML = Object.keys(assets).length ? '' : '<p class="muted small">None yet. Ask the assistant for a model, a texture or a sound, or double-click a waiting model in the world.</p>';
  for (const name of Object.keys(assets).sort()) {
    const a = assets[name];
    const row = document.createElement('div');
    row.className = 'st-item';
    const k = a.mime?.startsWith('image/') ? 'IMG' : a.mime?.startsWith('audio/') ? 'SND' : a.mime === 'model/gltf-binary' || /\.glb$/.test(name) ? '3D' : 'FILE';
    row.innerHTML = `<span class="k">${k}</span><span class="nm">${esc(name)}</span><button class="x" type="button" title="Remove">×</button>`;
    row.querySelector('.x').onclick = async () => { if (!confirm(`Remove ${name} from this game?`)) return; try { await del(`${API}/games/${gameId}/assets/${encodeURIComponent(name)}`); } catch (err) { alert(err.message); } };
    al.appendChild(row);
  }
}
function setSaveState(t) { $('saveState').textContent = t; }

// ------------------------------------------------------------------ code
function ensureEditor() {
  if (editor) return;
  editor = CodeMirror($('editor'), { lineNumbers: true, tabSize: 2, indentWithTabs: false, lineWrapping: false });
  editor.on('change', (_, ch) => { if (ch.origin === 'setValue') return; dirty = true; scheduleSave(); });
}
function openFile(path) {
  ensureEditor();
  const f = files[path];
  if (!f) return;
  if (dirty && openPath) saveFile();
  openPath = path; baseRev = f.rev; dirty = false;
  const mode = path.endsWith('.js') ? 'javascript' : path.endsWith('.json') ? { name: 'javascript', json: true } : path.endsWith('.md') ? 'markdown' : path.endsWith('.css') ? 'css' : 'text/plain';
  editor.setOption('mode', mode);
  editor.setValue(f.content);
  editor.clearHistory();
  $('openFile').textContent = path;
  $('renameFileBtn').hidden = false;
  $('deleteFileBtn').hidden = false;
  $('conflict').hidden = true;
  render();
}
function closeFile() { openPath = null; if (editor) editor.setValue(''); $('openFile').textContent = ''; $('renameFileBtn').hidden = true; $('deleteFileBtn').hidden = true; }
function revealEntity(id) {
  const lines = editor.getValue().split('\n');
  const i = lines.findIndex((l) => l.includes(`"${id}": {`));
  if (i < 0) return;
  editor.scrollIntoView({ line: i, ch: 0 }, 120);
  editor.setCursor(i, 0);
  editor.addLineClass(i, 'background', 'hl-line');
  setTimeout(() => editor.removeLineClass(i, 'background', 'hl-line'), 2500);
}
function scheduleSave() { setSaveState('Unsaved'); clearTimeout(saveTimer); saveTimer = setTimeout(saveFile, 900); }
async function saveFile() {
  if (!openPath || !dirty || saving) return;
  saving = true;
  setSaveState('Saving…');
  const path = openPath;
  const content = editor.getValue();
  try {
    const res = await post(`${API}/games/${gameId}/files`, { path, content, baseRev });
    files[path] = { path, content, rev: res.rev, updated: res.updated, updated_by: me?.id };
    if (path === openPath) { baseRev = res.rev; dirty = editor.getValue() !== content; }
    setSaveState('Saved');
    setTimeout(() => setSaveState(''), 1200);
  } catch (err) {
    if (err.status === 409) $('conflict').hidden = false;
    setSaveState('Not saved');
  } finally { saving = false; }
}
$('conflictKeep').onclick = async () => { baseRev = files[openPath]?.rev; dirty = true; $('conflict').hidden = true; await saveFile(); };
$('conflictTake').onclick = () => { const f = files[openPath]; baseRev = f.rev; dirty = false; editor.setValue(f.content); editor.clearHistory(); $('conflict').hidden = true; setSaveState(''); };
$('newFileBtn').onclick = async () => {
  const name = prompt('New file (a script: scripts/name.js, or a behavior: behaviors/name.js):', 'scripts/new.js');
  if (!name) return;
  const path = name.trim();
  if (files[path]) return openFile(path);
  try {
    const content = path.startsWith('behaviors/') ? `// A behavior: give it to anything in the world with { "use": "${path.replace(/^behaviors\//, '').replace(/\.js$/, '')}" }.\ngame.behavior('${path.replace(/^behaviors\//, '').replace(/\.js$/, '')}', {\n  update(thing, dt, options, memory, game) {\n    thing.turn(45 * dt);\n  },\n});\n` : '';
    const res = await post(`${API}/games/${gameId}/files`, { path, content });
    files[path] = { path, content, rev: res.rev, updated: res.updated, updated_by: me?.id };
    render();
    openFile(path);
  } catch (err) { alert(err.message); }
};
$('renameFileBtn').onclick = async () => {
  if (!openPath) return;
  const to = prompt('Rename to:', openPath);
  if (!to || to === openPath) return;
  try { await post(`${API}/games/${gameId}/files/rename`, { from: openPath, to }); } catch (err) { alert(err.message); }
};
$('deleteFileBtn').onclick = async () => {
  if (!openPath || !confirm(`Delete ${openPath}?`)) return;
  try { await del(`${API}/games/${gameId}/files?path=${encodeURIComponent(openPath)}`); } catch (err) { alert(err.message); }
};

// ------------------------------------------------------------------ assets
$('newAssetBtn').onclick = () => { $('assetModal').hidden = false; };
$('addAssetConfirmBtn').onclick = async () => {
  const asset = $('assetId').value.trim();
  if (!asset) return alert('Enter an asset ID');
  try { await post(`${API}/games/${gameId}/assets`, { asset, name: $('assetName').value.trim() || undefined }); $('assetModal').hidden = true; $('assetId').value = ''; $('assetName').value = ''; } catch (err) { alert(err.message); }
};

// ------------------------------------------------------------------ docs
async function loadDocs() {
  try {
    const [world, api] = await Promise.all([fetch('/play/WORLD.md').then((r) => r.text()), fetch('/play/API.md').then((r) => r.text())]);
    $('docsContent').innerHTML = marked.parse(`${world}\n\n${api}`);
  } catch {}
}

// ------------------------------------------------------------------ settings, people, releases
function loadSettings() {
  $('descInput').value = game.description || '';
  for (const b of document.querySelectorAll('[data-vis]')) {
    b.classList.toggle('on', b.dataset.vis === game.visibility);
    b.onclick = () => { for (const x of document.querySelectorAll('[data-vis]')) x.classList.remove('on'); b.classList.add('on'); };
  }
  $('coverInput').value = game.cover || '';
  const ml = $('membersList');
  ml.innerHTML = '';
  for (const m of members) {
    const div = document.createElement('div');
    div.className = 'member';
    div.innerHTML = `<span class="nm">${esc(m.name || 'Someone')}</span><span class="label">${esc(m.role)}</span>`;
    if (m.role !== 'owner' && game.role === 'owner') {
      const btn = document.createElement('button');
      btn.className = 'st-btn small';
      btn.textContent = 'Remove';
      btn.onclick = async () => { if (!confirm(`Remove ${m.name}?`)) return; try { await del(`${API}/games/${gameId}/members/${m.id}`); members = members.filter((x) => x.id !== m.id); loadSettings(); } catch (err) { alert(err.message); } };
      div.appendChild(btn);
    }
    ml.appendChild(div);
  }
  $('deleteGameBtn').hidden = game.role !== 'owner';
  renderReleases();
}
function renderReleases() {
  const list = $('releasesList');
  list.innerHTML = releases.length ? '' : '<p class="muted small">Not published yet.</p>';
  for (const r of releases) {
    const div = document.createElement('div');
    div.className = 'release';
    div.innerHTML = `<span class="v">v${r.version}</span>${r.version === game.liveVersion ? '<span class="live">LIVE</span>' : ''}<span class="grow muted small">${esc(r.notes || '')}</span>`;
    if (r.version !== game.liveVersion && game.role === 'owner') {
      const btn = document.createElement('button');
      btn.className = 'st-btn small';
      btn.textContent = 'Make live';
      btn.onclick = async () => { try { await post(`${API}/games/${gameId}/live-version`, { version: r.version }); game.liveVersion = r.version; renderReleases(); } catch (err) { alert(err.message); } };
      div.appendChild(btn);
    }
    list.appendChild(div);
  }
}
$('saveSettingsBtn').onclick = async () => {
  try {
    const vis = document.querySelector('[data-vis].on')?.dataset.vis || 'public';
    const body = { title: $('gameTitle').value, description: $('descInput').value, cover: $('coverInput').value || null };
    if (game.role === 'owner') body.visibility = vis;
    game = { ...game, ...(await post(`${API}/games/${gameId}`, body)) };
    setSaveState('Saved');
  } catch (err) { alert(err.message); }
};
$('leaveBtn').onclick = async () => {
  if (game.role === 'owner') { location.href = '/app'; return; }
  if (!confirm('Leave this game? You can come back with a new invite.')) return;
  try { await del(`${API}/games/${gameId}/members/${me.id}`); location.href = '/app'; } catch (err) { alert(err.message); }
};
$('deleteGameBtn').onclick = async () => {
  if (!confirm(`Delete "${game.title}" for everyone? This cannot be undone.`)) return;
  try { await del(`${API}/games/${gameId}`); location.href = '/app'; } catch (err) { alert(err.message); }
};
// ------------------------------------------------------------------ the menu (a game's pause menu)
function openMenu() {
  closeLibrary(); closeDrawer();
  $('menu').hidden = false;
  $('menuSheet').hidden = true;
  $('menuName').textContent = me.name || 'You';
  $('menuSub').textContent = `${me.plan && me.plan !== 'free' ? me.plan : 'Free'} · ${Number(me.credits || 0).toLocaleString()} credits`;
  $('menuGame').textContent = game.title;
  get('/v1/users/me').then((r) => { me = r.user; $('menuSub').textContent = `${me.plan && me.plan !== 'free' ? me.plan : 'Free'} · ${Number(me.credits || 0).toLocaleString()} credits`; }).catch(() => {});
  get('/v1/friends').then((r) => {
    const friends = r.friends || [];
    $('profileFriends').innerHTML = friends.length ? `<div class="head">Friends</div>${friends.slice(0, 8).map((f) => `<span class="friend"><i></i>${esc(f.name || 'Someone')}</span>`).join('')}` : '';
  }).catch(() => {});
  setTimeout(() => $('menu').querySelector('.st-menu-item.primary').focus(), 30);
}
function closeMenu() { $('menu').hidden = true; stage.focus(); }
function sheet(html) { const el = $('menuSheet'); el.innerHTML = html; el.hidden = false; return el; }
$('menuBtn').onclick = openMenu;
$('menu').onclick = (e) => { if (e.target === $('menu')) closeMenu(); };
$('menu').querySelector('.st-menu-list').onclick = async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'resume') closeMenu();
  if (act === 'library') { closeMenu(); openLibrary(); }
  if (act === 'advanced') { closeMenu(); openDrawer('code'); }
  if (act === 'codex') window.open('/entities', '_blank');
  if (act === 'exit') location.href = '/app';
  if (act === 'logout') { await post('/v1/users/logout', {}).catch(() => {}); location.href = '/'; }
  if (act === 'invite') {
    const el = sheet('<h3>Build together</h3><p>Anyone with this link joins this game and builds with you. You\'ll see each other in the world.</p><input class="form-input" id="inviteLink" readonly><div class="row"><button class="st-menu-item primary" id="copyInvite" type="button">Copy the link</button></div><button class="st-menu-item" data-back type="button">Back</button>');
    el.querySelector('[data-back]').onclick = () => { el.hidden = true; };
    try {
      const d = await post(`${API}/games/${gameId}/invites`);
      el.querySelector('#inviteLink').value = location.origin + d.path;
      el.querySelector('#copyInvite').onclick = () => { navigator.clipboard?.writeText(location.origin + d.path).catch(() => {}); el.querySelector('#copyInvite').textContent = 'Copied: send it to a friend'; };
    } catch (err) { el.querySelector('p').textContent = err.message; }
  }
  if (act === 'publish') {
    const el = sheet(`<h3>Publish</h3><p>Publishing freezes this version for players. Keep building; publish again when you want them to have the new one.</p><input class="form-input" id="releaseNotes" placeholder="What changed? (optional)"><button class="st-menu-item primary" id="publishBtn" type="button">Publish ${esc(game.title)}</button><a class="st-menu-item" id="openPlay" target="_blank" ${game.liveVersion ? `href="/play/${esc(game.slug)}"` : 'hidden'}>Open the published game</a><button class="st-menu-item" data-back type="button">Back</button>`);
    el.querySelector('[data-back]').onclick = () => { el.hidden = true; };
    el.querySelector('#publishBtn').onclick = async () => {
      const btn = el.querySelector('#publishBtn');
      btn.disabled = true;
      try {
        const res = await post(`${API}/games/${gameId}/publish`, { notes: el.querySelector('#releaseNotes').value.trim() });
        releases = res.releases || releases;
        game.liveVersion = res.version;
        btn.textContent = `Published version ${res.version}`;
        const a = el.querySelector('#openPlay'); a.hidden = false; a.href = res.url;
        renderReleases();
      } catch (err) { btn.disabled = false; btn.textContent = err.message; }
    };
  }
};

// ------------------------------------------------------------------ your library: anything you've made, into the world
let libKind = '';
let libItems = [];
function openLibrary() { closeDrawer(); $('library').classList.add('open'); $('libraryBtn').classList.add('on'); loadLibrary(); }
function closeLibrary() { $('library').classList.remove('open'); $('libraryBtn').classList.remove('on'); }
function toggleLibrary() { $('library').classList.contains('open') ? closeLibrary() : openLibrary(); }
$('libraryBtn').onclick = toggleLibrary;
$('libraryClose').onclick = closeLibrary;
$('openLibrary2').onclick = openLibrary;
for (const b of $('libTabs').querySelectorAll('button')) b.onclick = () => { libKind = b.dataset.k; for (const x of $('libTabs').querySelectorAll('button')) x.classList.toggle('on', x === b); loadLibrary(); };
const GEN_KIND = { model: 'mesh', image: 'image', audio: 'audio', video: 'video' };
async function loadLibrary() {
  const grid = $('libGrid');
  grid.innerHTML = '<div class="st-lib-empty">Loading your library…</div>';
  const qs = new URLSearchParams({ limit: '60' });
  if (libKind) qs.set('kind', GEN_KIND[libKind]);
  try {
    libItems = ((await get(`/v1/assets?${qs}`)).items || []).filter((a) => ['mesh', 'image', 'audio', 'video'].includes(a.kind));
  } catch {
    grid.innerHTML = '<div class="st-lib-empty">Your library isn\'t reachable right now. Try again in a moment.</div>';
    return;
  }
  if (!libItems.length) { grid.innerHTML = '<div class="st-lib-empty">Nothing here yet. Ask the assistant to make something, or open the Asset studio.</div>'; return; }
  grid.innerHTML = '';
  for (const a of libItems) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'st-lib-item';
    const url = `/v1/assets/${encodeURIComponent(a.id)}/file`;
    const label = { mesh: '3D', image: 'PIC', audio: 'SND', video: 'VID' }[a.kind];
    b.innerHTML = `${a.kind === 'image' ? `<img src="${url}" alt="" loading="lazy">` : a.kind === 'video' ? `<video src="${url}" muted loop playsinline preload="metadata"></video>` : `<span>${a.kind === 'mesh' ? '◆' : '♪'}</span>`}<span class="kind">${label}</span><span class="t">${esc(a.title || a.recipe?.params?.prompt || a.tool || a.id)}</span>`;
    const v = b.querySelector('video');
    if (v) { b.onmouseenter = () => v.play().catch(() => {}); b.onmouseleave = () => v.pause(); }
    b.onclick = () => placeFromLibrary(a, b);
    grid.appendChild(b);
  }
}
/** Puts a library asset into the game (if it isn't yet) and a thing that uses it where you're looking. */
async function placeFromLibrary(a, el) {
  el.classList.add('busy');
  try {
    let name = Object.values(assets).find((x) => x.asset === a.id)?.name;
    if (!name) {
      const want = String(a.title || a.recipe?.params?.prompt || a.kind).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || a.kind;
      const row = await post(`${API}/games/${gameId}/assets`, { asset: a.id, name: want });
      name = row.name;
      assets[name] = row;
      await sendAssets();
    }
    toStage({ type: 'place', asset: { name, kind: a.kind, title: a.title || null } });
    closeLibrary();
    stage.focus();
  } catch (err) {
    addSystem(err.message);
  } finally { el.classList.remove('busy'); }
}

// ------------------------------------------------------------------ modals and keys
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => { $(b.dataset.close).hidden = true; };
for (const m of document.querySelectorAll('.modal-backdrop')) m.onclick = (e) => { if (e.target === m) m.hidden = true; };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    for (const m of document.querySelectorAll('.modal-backdrop')) m.hidden = true;
    if (!$('menu').hidden) closeMenu();
    else if ($('library').classList.contains('open')) closeLibrary();
    else if ($('drawer').classList.contains('open') && !e.target.closest?.('.CodeMirror')) closeDrawer();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); $('drawer').classList.contains('open') ? closeDrawer() : openDrawer('code'); }
});
setInterval(() => { if (connId && openPath) post(`${API}/games/${gameId}/presence`, { file: openPath }).catch(() => {}); }, 15000);

// ------------------------------------------------------------------ the first visit
async function bootSequence() {
  const overlay = $('bootOverlay');
  if (!overlay) return;
  const key = `hg_boot_${gameId}`;
  let seen = false;
  try { seen = Boolean(localStorage.getItem(key)); } catch {}
  if (seen) { overlay.remove(); return; }
  const lines = $('bootLines');
  const line = async (text, cls) => {
    const el = document.createElement('div');
    el.className = `boot-line${cls ? ` ${cls}` : ''}`;
    lines.appendChild(el);
    for (let i = 0; i <= text.length; i++) { el.textContent = text.slice(0, i); await wait(14); }
  };
  await wait(200);
  $('bootLogo').classList.add('visible');
  $('bootSub').classList.add('visible');
  await wait(500);
  await line('Starting the engine…');
  await line(`Loading ${game.title}`, 'accent');
  await line(`${Object.keys(files).length} files · ${Object.keys(assets).length} assets · ${members.length} ${members.length === 1 ? 'builder' : 'builders'}`);
  await line('You are in the world. Click to look around.', 'bright');
  await line('Hold click to grab things. Double-click to change them. Enter talks to me. Esc twice for the menu.', 'intro');
  await wait(1600);
  overlay.classList.add('fade-out');
  await wait(800);
  overlay.remove();
  try { localStorage.setItem(key, '1'); } catch {}
}

// ------------------------------------------------------------------ reading replies aloud
function initVoice() {
  const t = $('voiceToggle');
  t.checked = voiceEnabled;
  t.onchange = () => { voiceEnabled = t.checked; try { localStorage.setItem('hg_voice', voiceEnabled ? '1' : '0'); } catch {} if (!voiceEnabled && window.speechSynthesis) speechSynthesis.cancel(); };
}
function speak(text) {
  if (!voiceEnabled || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 400));
  u.rate = 1;
  const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith('en'));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
