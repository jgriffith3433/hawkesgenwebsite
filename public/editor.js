// The editor (/app/g/<id>): your game, full screen, and you build inside it (play/build.js, in the sandboxed frame).
// This page holds what needs your account: saving world edits (POST /scene), the live feed of files, assets, chat and
// people (SSE /live), the assistant (which gets told what you're looking at), and the Advanced drawer (code, assets,
// settings, docs). The game frame and this page talk with postMessage; the game never sees the cookie.
/* global CodeMirror marked */
import { createBridge, safeHref } from '/editor-bridge.js';
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
// The Overseer's captions and volumes (the game's speech desk, modules/overseer/speech.js, applies them; the frame has no storage).
const speechSettings = (() => { try { const m = JSON.parse(localStorage.getItem('hg_overseer_speech') || '{}') || {}; const v = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(1, Number(x))) : 1); return { captions: m.captions !== false, voice: v(m.voice), music: v(m.music) }; } catch { return { captions: true, voice: 1, music: 1 }; } })();

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
    // Changed since the last save (or never saved): the Save button says so.
    unsaved = game.updated > ((releases[0] && releases[0].created) || 0) + 1000;
    renderSave();
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
// A game, not a page: no pinch or double-tap zoom, no ctrl+wheel zoom, no selecting the screen's text.
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) e.preventDefault(); });
document.addEventListener('dblclick', (e) => { if (!e.target.closest('input, textarea, .CodeMirror')) e.preventDefault(); });
// Same test the game uses for its on-screen sticks: the chat moves out of their way.
const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean' ? navigator.userAgentData.mobile || coarseOnly : coarseOnly) document.body.classList.add('touch');
const toStage = (m) => { try { stage.contentWindow.postMessage(m, '*'); } catch {} };
// A dialog on this page (sign-in, sharing, a confirm, the library...) frees the mouse the game may have captured.
{
  const MODAL = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open], .modal';
  const shown = (el) => !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  let was = false, pending = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const open = [...document.querySelectorAll(MODAL)].some(shown);
      if (open && !was) toStage({ type: 'release-mouse' });
      was = open;
    });
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style', 'aria-modal'] });
}
async function loadStage() {
  const bundle = await get(`${API}/games/${gameId}/bundle`);
  // Whether this player has seen the Overseer's intro (the stage is sandboxed: it has no storage of its own).
  try { if (localStorage.getItem('hg_overseer_intro')) bundle.overseen = true; } catch {}
  // And which of the Overseer's first-time lines it has said (public/play/modules/overseer/lines.js).
  try { bundle.overseerLines = JSON.parse(localStorage.getItem('hg_overseer_lines') || '{}'); } catch {}
  // And what the Overseer remembers of the player when there is no account side to ask (memory.js).
  try { bundle.overseerMemory = JSON.parse(localStorage.getItem('hg_overseer_memory') || 'null') || undefined; } catch {}
  const send = () => toStage({ type: 'bundle', bundle, mode: 'build' });
  if (stageReady) send(); else stageBundle = send;
  toStage({ type: 'advanced', on: $('advTools').checked });
}
let stageBundle = null;
const contextWaits = new Map();
// Player analytics (Gen's SDK on this page): the game's events come through the frame (play/analytics.js), and the
// builder's own moments are sent from here, each kind once a session (feature name, ms since the page opened).
const ANALYTICS_SEEN = new Set();
function analytics() { return window.hawkesAnalytics || null; }
function builderDid(name, extra) {
  if (ANALYTICS_SEEN.has(name)) return;
  ANALYTICS_SEEN.add(name);
  try { analytics()?.track('feature', { name, ms: Math.round(performance.now()), ...(extra || {}) }); } catch {}
}
try { analytics()?.setContext({ entry: 'editor', account: 'user' }); } catch {}
window.addEventListener('load', () => { try { analytics()?.setContext({ entry: 'editor', account: 'user' }); } catch {} });
// What got in the way, and the feedback card at a natural pause (site-analytics.js; the card in the game's look).
const hga = () => window.hgAnalytics || null;
function frustrated(kind, props) { try { hga()?.frustration(kind, props); } catch {} }
const ASK_THEME = { background: '#14161b', color: '#f1f2f4', accent: '#f2b33d', font: 'Inter, system-ui, sans-serif', radius: '12px' };
function askLater(o, ms = 2500) { setTimeout(() => { try { hga()?.ask({ theme: ASK_THEME, ...o }); } catch {} }, ms); }
// The assistant: when each request of mine went, to time its answer (and say when it's slow or fails).
let askedAt = 0;

// A link from the game or its chat is a link only when it is ours (editor-bridge.js safeHref); otherwise the line is plain text.
const linkOf = (href) => safeHref(href, [location.origin]);

// The share window: the game is sandboxed (no cookies), so this page opens /share/new and carries the photo or clip
// between the two. The game asks ('share-open', in the tap, so the click still counts) and sends the media ('share-media').
const shareWins = new Map(); // id -> { win, payload, ready }
const SHARE_MAX = 64 * 1024 * 1024;
function shareOpen(id) {
  id = String(id || '').slice(0, 40);
  if (!id) return;
  for (const [k, v] of shareWins) if (!v.win || v.win.closed) shareWins.delete(k);
  let win = null;
  if (shareWins.size < 4) { try { win = window.open('/share/new', `hg-share-${id}`, 'popup,width=640,height=820'); } catch { win = null; } }
  if (win) shareWins.set(id, { win, payload: null, ready: false });
  toStage({ type: 'share-opened', id, ok: Boolean(win) });
}
function shareMedia(m) {
  const w = shareWins.get(String(m.id || '').slice(0, 40));
  const p = m.payload;
  if (!w || !p || p.source !== 'hawkes-share' || p.type !== 'media' || !(p.blob instanceof Blob) || p.blob.size > SHARE_MAX) return;
  w.payload = p;
  if (w.ready) sendShare(w);
}
function sendShare(w) { try { w.win.postMessage(w.payload, location.origin); } catch {} }
window.addEventListener('message', (e) => {
  for (const [id, w] of shareWins) {
    if (e.source !== w.win) continue;
    const m = e.data || {};
    if (e.origin !== location.origin || m.source !== 'hawkes-share') return;
    if (m.type === 'ready') { w.ready = true; if (w.payload) sendShare(w); }
    if (m.type === 'shared' && m.url) toStage({ type: 'share-done', id, url: String(m.url).slice(0, 300) });
    return;
  }
});

window.addEventListener('message', (e) => {
  if (e.source !== stage.contentWindow) return;
  const m = e.data || {};
  if (m.source !== 'hawkes-play') return;
  return bridge.handle(m);
});
// Allowlist, rate limits and the one-card rule live in editor-bridge.js: a game script is only asking.
const bridge = createBridge({ run: fromGame });
async function fromGame(m) {
  switch (m.type) {
    case 'analytics': {
      const a = analytics();
      if (!a || !/^[a-z][a-z0-9_]{1,39}$/.test(String(m.name))) return;
      try { if (m.ctx) a.setContext(m.ctx); a.track(m.name, m.props || {}); } catch {}
      return;
    }
    // Input inside the game: the SDK here can't see it, but it is time spent here.
    case 'analytics-activity': try { analytics()?.activity?.(); } catch {} return;
    case 'overseer-lines':
      try { if (m.lines && typeof m.lines === 'object') localStorage.setItem('hg_overseer_lines', JSON.stringify(m.lines)); } catch {}
      return;
    case 'overseer-memory':
      try { if (m.memory && typeof m.memory === 'object') localStorage.setItem('hg_overseer_memory', JSON.stringify(m.memory)); } catch {}
      return;
    case 'overseer-seen':
      try { localStorage.setItem('hg_overseer_intro', String(Date.now())); } catch {}
      return;
    case 'ready':
      stageReady = true;
      if (stageBundle) { stageBundle(); stageBundle = null; }
      toStage({ type: 'advanced', on: $('advTools').checked });
      toStage({ type: 'speech-settings', ...speechSettings });
      return;
    case 'started': {
      clearErrors();
      applyRole();
      if (tourPlay) startTourPlay();
      const place = new URLSearchParams(location.search).get('place');
      if (place && assets[place]) {
        history.replaceState(null, '', location.pathname);
        const a = assets[place];
        const kind = a.kind === 'mesh' || /\.glb$/.test(place) ? 'mesh' : (a.mime || '').startsWith('image/') ? 'image' : (a.mime || '').startsWith('audio/') ? 'audio' : (a.mime || '').startsWith('video/') ? 'video' : a.kind;
        setTimeout(() => toStage({ type: 'place', asset: { name: place, kind, title: null } }), 600);
      }
      return;
    }
    case 'error':
      addError(m.message, m.file, m.line);
      // A game script's error (the runtime catches them): each kind once a page, like the SDK's own.
      try { analytics()?.error({ message: String(m.message || 'Error').slice(0, 1000), stack: m.file ? `at ${m.file}:${m.line ?? '?'}` : '' }, 'script', { file: m.file || undefined, line: m.line || undefined }); } catch {}
      return;
    case 'log': return;
    // Everything said in the game (modules/overseer/chat.js: the Overseer, Pip and friends, players) is a line here:
    // the game draws no chat or captions of its own in the editor.
    case 'chat-line': {
      const text = String(m.text || '').trim().slice(0, 400);
      if (!text) return;
      if (m.kind === 'overseer') { const last = chatHistory.at(-1); if (!(last && last.local && last.text === text && Date.now() - last.at < 5000)) addOverseer(text, m.action && linkOf(m.action.href) ? { action: { label: String(m.action.label || 'Open'), href: linkOf(m.action.href) } } : {}); return; }
      if (m.kind === 'sys') { addSystem(text); return; }
      const msg = { id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role: 'other', kind: m.kind, name: m.kind === 'me' ? (me && me.name) || 'You' : String(m.who || 'Someone').slice(0, 40), text, local: true, at: Date.now() };
      chatHistory.push(msg);
      renderChat(msg);
      return;
    }
    case 'chat-status': return;
    // (Older game pages: the Overseer's words alone.)
    case 'overseer-say': {
      const text = String(m.text || '').trim().slice(0, 400);
      const last = chatHistory.at(-1);
      if (!text || (last && last.local && last.text === text && Date.now() - last.at < 5000)) return;
      addOverseer(text);
      return;
    }
    case 'ops': {
      // A world edit from the game: it goes live for everyone (the game is always live); Save marks a point in history.
      try {
        const r = await post(`${API}/games/${gameId}/scene`, { ops: m.ops, fx: m.fx }, roomConn ? { 'X-Room-Conn': roomConn } : {});
        builderDid('build_edit');
        if ((m.ops || []).some((o) => o && (o.op === 'create' || o.op === 'replace'))) tourDone('create');
        else if ((m.ops || []).some((o) => o && o.op === 'update')) tourDone('move');
        toStage({ type: 'ack', seq: m.seq, errors: r.errors, created: r.created });
        markUnsaved();
      } catch (err) {
        toStage({ type: 'ack', seq: m.seq, errors: [err.message] });
        setSaveState(err.status === 403 ? '' : 'Not sent');
        if (err.status !== 403) frustrated('edit_not_saved', { status: err.status || 0 });
        if (err.status === 403) addSystem(err.message);
      }
      return;
    }
    case 'save': builderDid('save'); return saveNow();
    case 'resync': {
      const b = await get(`${API}/games/${gameId}/bundle`).catch(() => null);
      if (b) toStage({ type: 'files', files: { 'scene.json': b.files['scene.json'] ?? null } });
      return;
    }
    case 'context': { const w = contextWaits.get(m.id); if (w) { contextWaits.delete(m.id); w(m.context); } return; }
    // A game's 'ask' only fills the chat box: the person reads it and presses Enter (sendChat, which spends, is theirs).
    case 'ask': {
      const text = String(m.text ?? '').trim().slice(0, 4000);
      if (!text) return;
      const about = m.mention && m.mention.id ? { id: String(m.mention.id).slice(0, 80), name: String(m.mention.name || m.mention.id).slice(0, 80) } : null;
      setMention(about);
      $('chatInput').value = text;
      $('chatInput').focus();
      return;
    }
    case 'focus-chat': setMention(m.mention && m.mention.id ? { id: String(m.mention.id).slice(0, 80), name: String(m.mention.name || m.mention.id).slice(0, 80) } : null); $('chatInput').focus(); return;
    // A game's 'generate' is a request: the person sees what it is and what it costs, and decides.
    case 'generate': return showGenCard(m);
    case 'open-code': openDrawer('code'); openFile('scene.json'); if (m.entity) revealEntity(m.entity); return;
    case 'net': if (m.conn) roomConn = m.conn; return;
    case 'mode': setPlaying(m.mode === 'play'); return;
    case 'menu': openMenu(); return;
    case 'card': return;
    case 'share-open': return shareOpen(m.id);
    case 'share-media': return shareMedia(m);
    case 'selected':
      // What you opened is what you're talking about: it shows in the assistant's line as @name.
      if (m.entity && m.entity.id) setMention({ id: m.entity.id, name: m.entity.name || m.entity.id, fromCard: true });
      else if (mention && mention.fromCard && !$('chatInput').value.trim()) setMention(null);
      return;
    case 'library': toggleLibrary(); return;
    // The spawn wheel (play/modules/spawn): a community thing put in the game (variant or replace), then spawned there.
    case 'spawn-community': {
      builderDid('library_use');
      try {
        const r = await post(`${API}/games/${gameId}/community`, { id: m.id, mode: m.mode === 'replace' ? 'replace' : 'variant', word: m.word || undefined });
        assets[r.asset.name] = r.asset;
        await sendAssets();
        toStage({ type: 'spawn-community', req: m.req, ok: true, asset: { name: r.asset.name }, word: r.word });
      } catch (err) { toStage({ type: 'spawn-community', req: m.req, ok: false, error: err.message }); }
      return;
    }
    case 'basics': basics = m.list || []; if (libKind === 'basics' && $('library').classList.contains('open')) loadLibrary(); return;
    case 'words': if (libKind === 'game' && $('library').classList.contains('open')) renderWords(m.words || {}, m.assets || []); return;
  }
}
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
// The stream comes back on its own, quietly: the server says `bye` before it restarts, the browser keeps the last event
// id (`?last=` carries it across our own reconnects, so what was missed comes once and nothing twice), and a failed try
// waits longer each time (1 s up to 30 s) without a word in the console.
let sseLast = '', sseTries = 0, sseTimer = null;
const sseLater = () => { clearTimeout(sseTimer); sseTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** sseTries++)); };
addEventListener('pagehide', () => { clearTimeout(sseTimer); if (sse) sse.close(); });
function connect() {
  if (sse) sse.close();
  sse = new EventSource(`${API}/games/${gameId}/live${sseLast ? `?last=${encodeURIComponent(sseLast)}` : ''}`, { withCredentials: true });
  sse.addEventListener('open', () => { sseTries = 0; });
  sse.addEventListener('bye', () => { sse.close(); sseTries = 0; sseLater(); });
  for (const ev of ['file', 'file-deleted', 'file-renamed', 'asset', 'asset-removed', 'asset-renamed', 'chat', 'gen', 'game', 'release', 'role', 'removed', 'deleted']) sse.addEventListener(ev, (e) => { if (e.lastEventId) sseLast = e.lastEventId; });
  sse.addEventListener('hello', (e) => { const d = JSON.parse(e.data); connId = d.conn; updatePresence(d.presence || []); $('thinkingIndicator').hidden = true; });
  sse.addEventListener('file', (e) => {
    markUnsaved();
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
    if (i < 0 && msg.role === 'ai' && msg.data && msg.data.error) { $('thinkingIndicator').hidden = true; toStage({ type: 'toast', text: 'The assistant hit a problem (see chat)' }); }
    // An answer to my request: how long it took, and whether it worked.
    if (i < 0 && msg.role === 'ai' && askedAt) {
      const ms = Date.now() - askedAt;
      askedAt = 0;
      const ok = !(msg.data && msg.data.error);
      hga()?.track('assistant_reply', { ok, ms, suggestions: (msg.data && msg.data.suggestions && msg.data.suggestions.length) || 0 });
      if (!ok) frustrated('assistant_failed', { error: String(msg.data.error).slice(0, 120) });
      else if (ms > 90_000) frustrated('assistant_slow', { seconds: Math.round(ms / 1000) });
      if (ok) askLater({ id: 'editor-assistant', question: 'Did the Overseer get that right?', context: 'assistant reply', comment: true }, 4000);
    }
  });
  // The Overseer at work (src/overseer-lines.ts): where, the beats, its words, things arriving, the end: into the game.
  sse.addEventListener('overseer', (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } toStage({ ...d, type: 'overseer-work' }); });
  sse.addEventListener('thinking', (e) => { const d = JSON.parse(e.data); $('thinkingIndicator').hidden = !d.on; if (d.on) $('thinkingIndicator').textContent = `${d.by && d.by !== me?.name ? `${d.by}'s request: ` : ''}working…`; });
  sse.addEventListener('gen', (e) => onGen(JSON.parse(e.data)));
  sse.addEventListener('game', (e) => { const d = JSON.parse(e.data); game = { ...game, ...d }; members = d.members || members; if (document.activeElement !== $('gameTitle')) $('gameTitle').value = game.title; loadSettings(); });
  sse.addEventListener('release', (e) => { const d = JSON.parse(e.data); releases = d.releases || releases; renderReleases(); markSaved(); });
  sse.addEventListener('role', (e) => { const d = JSON.parse(e.data); if (me && d.user === me.id) { game.role = d.role; applyRole(); addSystem(`The owner made you ${d.role === 'editor' ? 'an editor' : `a ${d.role}`}.`); } });
  sse.addEventListener('removed', (e) => { const d = JSON.parse(e.data); if (d.user === me?.id) { alert('You were removed from this game.'); location.replace('/app'); } });
  sse.addEventListener('deleted', () => { alert('This game was deleted.'); location.replace('/app'); });
  sse.addEventListener('reload', () => location.reload());
  sse.onerror = () => { sse.close(); sseLater(); };
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
    div.className = `msg ${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : msg.role === 'other' ? `other ${msg.kind || ''}` : 'ai'}${msg === fresh ? ' new' : ''}`;
    if (msg.role !== 'system') div.innerHTML = msg.role === 'ai' ? '<span class="who"><i class="ov-orb" aria-hidden="true"></i>Overseer</span>' : `<span class="who">${esc(msg.name || 'Someone')}</span>`;
    div.appendChild(document.createTextNode(String(msg.text).length > 280 ? `${String(msg.text).slice(0, 280)}…` : msg.text));
    const d = msg.data || {};
    const did = [];
    if (d.world && d.world.length) did.push(`${d.world.length} change${d.world.length === 1 ? '' : 's'} to the world`);
    if (d.changed && d.changed.length) did.push(`edited ${d.changed.join(', ')}`);
    if (did.length) { const c = document.createElement('span'); c.className = 'changed'; c.textContent = did.join(' · '); div.appendChild(c); }
    // A line with something to do (out of credits: get more), a link that opens beside the game.
    if (msg.action && linkOf(msg.action.href)) {
      const a = document.createElement('span');
      a.className = 'sugg';
      const link = document.createElement('a');
      link.className = 'sugg-link';
      link.href = linkOf(msg.action.href); link.target = '_blank'; link.rel = 'noopener';
      link.textContent = msg.action.label;
      if (msg.action.onclick) link.onclick = msg.action.onclick;
      a.appendChild(link);
      div.appendChild(a);
    }
    // It didn't work out: one click asks again, the same way (only the last failed one, so old ones don't pile up).
    if (d.error && d.retry && msg === chatHistory.filter((x) => x.data && x.data.error).at(-1) && msg === chatHistory.at(-1)) {
      const again = document.createElement('span');
      again.className = 'sugg';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Try again';
      btn.onclick = () => { btn.disabled = true; btn.textContent = 'Asking…'; const said = String(d.retry); const tag = d.mention ? `@${d.mention.name || d.mention.id} ` : ''; sendChat(tag && said.startsWith(tag) ? said.slice(tag.length) : said, d.mention || null); };
      again.appendChild(btn);
      div.appendChild(again);
    }
    for (const [i, sg] of (d.assets || []).entries()) {
      const sugg = document.createElement('span');
      sugg.className = 'sugg';
      const picks = sg.used || sg.task ? [] : (sg.community || []);
      sugg.innerHTML = `<span>${esc(sg.kind)}: ${esc(String(sg.prompt).slice(0, 40))}${sg.used ? ` · using ${esc(sg.used.title)} from the community` : picks.length ? ' · from the community, or' : ''}</span>`;
      // Community things that fit first (one click, free), then making our own.
      if (picks.length) {
        const row = document.createElement('span');
        row.className = 'sugg-picks';
        for (const c of picks) {
          const p = document.createElement('button');
          p.type = 'button';
          p.className = 'sugg-pick';
          p.title = `${c.title} · by ${c.by}`;
          p.innerHTML = c.thumb ? `<img src="${c.thumb}" alt="">` : `<span>${GLYPH[c.kind] || '◆'}</span>`;
          p.onclick = () => { for (const x of row.querySelectorAll('button')) x.disabled = true; useCommunity(c, null, { name: sg.name, messageId: msg.id, suggestion: i, ifUnused: true }); };
          row.appendChild(p);
        }
        sugg.appendChild(row);
      }
      if (!sg.used) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = sg.task ? 'Making…' : `${picks.length ? 'Make our own' : 'Make it'} · ${sg.credits || ''}`;
        btn.disabled = Boolean(sg.task);
        btn.onclick = async () => { btn.disabled = true; btn.textContent = 'Making…'; try { await post(`${API}/games/${gameId}/generate`, { kind: sg.kind, prompt: sg.prompt, name: sg.name, messageId: msg.id, suggestion: i }); } catch (err) { btn.disabled = false; btn.textContent = `${picks.length ? 'Make our own' : 'Make it'} · ${sg.credits || ''}`; if (err.status === 402) noCredits(err.message); else addSystem(err.message); } };
        sugg.appendChild(btn);
      }
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
function addSystem(text) { chatHistory.push({ id: `local_${Date.now()}`, role: 'system', text }); renderChat(); }
/** A line from the Overseer that isn't the assistant's answer (what it says in the game, its welcome, credits): shown in
 *  the chat with the assistant's (the Overseer is the assistant), kept on this page only, never read aloud again. */
function addOverseer(text, o = {}) {
  const msg = { id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, role: 'ai', text, local: true, at: Date.now(), action: o.action || null };
  chatHistory.push(msg);
  renderChat(msg);
  return msg;
}
/** Out of credits (402 from the assistant or a generation): the Overseer says so, with a way to get more (a new tab: the
 *  game keeps running), and the balance is read again when they come back. */
let creditsAskedAt = 0;
function noCredits(message) {
  hga()?.track('credits_out', { where: 'editor' });
  const fresh = Date.now() - creditsAskedAt > 20_000;
  creditsAskedAt = Date.now();
  if (!fresh) return;
  addOverseer(`The light has gone quiet for now. Take more when you wish, and ask me again: the island will be as you left it.`, {
    action: { label: 'Get credits', href: '/credits' },
  });
  const back = () => { if (document.visibilityState !== 'visible') return; document.removeEventListener('visibilitychange', back); get('/v1/users/me').then((r) => { const before = Number(me && me.credits) || 0; me = r.user; if ((Number(me.credits) || 0) > before) addOverseer(`You have ${Number(me.credits).toLocaleString()} credits now. Ask me again.`); }).catch(() => {}); };
  document.addEventListener('visibilitychange', back);
}

// ------------------------------------------------------------------ the island's tour, carried on here (?tour=1)
// From the sandbox's mirror and account sheet (public/play/guest.js): the island is their game now. It plays (not the
// building view), Pip's tour goes on in the game, and the Overseer greets them here in the chat: what it can do, and
// that it costs their credits (or that they have none yet).
const tourPlay = new URLSearchParams(location.search).get('tour') === '1';
if (tourPlay) { history.replaceState(null, '', location.pathname); document.body.classList.add('tour-play'); }
let tourStarted = false;
function startTourPlay() {
  if (tourStarted) return;
  tourStarted = true;
  toStage({ type: 'mode', mode: 'play' });
  hga()?.track('sandbox_tour_editor', {});
  setTimeout(() => {
    const name = (me && me.name) || '';
    const n = Number(me && me.credits) || 0;
    if (n > 0) addOverseer(`${name ? `Welcome, ${name}. ` : 'Welcome. '}This island is yours now, and I am here: talk to me in this chat. Ask for anything ("a castle on the hill") and I will beam it down. What I make uses your credits: you have ${n.toLocaleString()}.`);
    else addOverseer(`${name ? `Welcome, ${name}. ` : 'Welcome. '}This island is yours now, and I am here: talk to me in this chat. What I make uses credits, and you have none right now.`, { action: { label: 'Get credits', href: '/credits' } });
  }, 3500);
}
function setMention(m) {
  mention = m && m.id ? m : null;
  $('mention').hidden = !mention;
  if (mention) $('mentionName').textContent = `@${mention.name || mention.id}`;
  $('chatInput').placeholder = mention ? `Tell the Overseer what ${mention.name || 'it'} should do…` : 'Press Enter to talk to the Overseer';
}
$('mentionX').onclick = () => setMention(null);
$('chatForm').onsubmit = (e) => { e.preventDefault(); sendChat(); };
$('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); backToGame(); }
  if (e.key === 'Backspace' && !$('chatInput').value && mention) setMention(null);
});
/** Done typing: back into the game (Enter sends, Esc just goes back). */
function backToGame() { $('chatInput').blur(); stage.focus(); }

async function sendChat(text, about, ctx) {
  builderDid('assistant');
  tourDone('ask');
  const input = $('chatInput');
  const message = (text ?? input.value).trim();
  if (!message) return;
  const target = about ?? mention;
  if (text === undefined) { input.value = ''; backToGame(); }
  // The Overseer starts working in the game at once (work.js: beams on what they look at, the work pill), before the
  // server answers; its events (`overseer` below) carry the show on.
  toStage({ type: 'overseer-work', k: 'begin', text: message.slice(0, 200) });
  const context = ctx ?? (await worldContext());
  const errText = errors.slice(-5).map((e) => `${e.file || 'script'}:${e.line ?? '?'}: ${e.text}`).join('\n');
  try {
    await post(`${API}/games/${gameId}/ai`, { message: target ? `@${target.name || target.id} ${message}` : message, mention: target || undefined, context: context || undefined, file: openPath, errors: errText || undefined });
    setMention(null);
    askedAt = Date.now();
    hga()?.track('assistant_ask', { chars: message.length, mention: Boolean(target), errors: errors.length });
    // The game hears it too (game.on('asked'): the island's tour has a step for it).
    toStage({ type: 'event', name: 'asked', data: { chars: message.length, text: String(message).slice(0, 200) } });
  } catch (err) {
    // 402 (no credits) is told by site-analytics.js from the answer itself.
    if (err.status === 429) frustrated('assistant_busy');
    else if (err.status !== 402) frustrated('assistant_unreachable', { status: err.status || 0 });
    toStage({ type: 'overseer-work', k: 'end', ok: false, why: err.status === 402 ? 'Out of credits.' : err.status === 429 ? 'Still working on the last one.' : "I couldn't hear you." });
    if (err.status === 402) { noCredits(err.message); if (text === undefined) input.value = message; return; }
    addSystem(err.status === 429 ? "I'm still working on the last request. Ask again when it's done."
      : err.status >= 500 || !err.status ? "I couldn't hear you just now. Nothing was charged; try again in a moment." : err.message);
    if (text === undefined) input.value = message;
  }
}

// ===================================================================== generation (Hawkes Gen making assets)
/** The card for a generation a game asked for (the beam, a waiting model): what, kind, price, balance, and the person's
 *  Make it / Not now. One at a time (editor-bridge.js drops the others), and nothing is made until Make it. */
let assetKinds = null;
async function showGenCard(m) {
  const card = $('genCard');
  const kind = String(m.kind || '');
  const prompt = String(m.prompt || '').trim().slice(0, 1500);
  const name = String(m.name || '').trim().slice(0, 80);
  const close = (made) => { card.hidden = true; bridge.closeCard(); toStage({ type: 'generate-closed', name, made }); };
  if (!prompt) { close(false); return; }
  try { assetKinds ||= await get(`${API}/asset-kinds`); } catch {}
  const k = assetKinds && assetKinds[kind];
  if (!k) { close(false); addSystem('That is not something I can make.'); return; }
  try { me = (await get('/v1/users/me')).user; } catch {}
  const balance = Number(me && me.credits) || 0;
  $('genCardWhat').textContent = prompt;
  $('genCardKind').textContent = k.title;
  $('genCardPrice').textContent = `${k.credits} credits`;
  $('genCardBalance').textContent = `You have ${balance.toLocaleString()}`;
  card.hidden = false;
  toStage({ type: 'release-mouse' });
  $('genCardNo').onclick = () => close(false);
  $('genCardYes').onclick = async () => {
    $('genCardYes').disabled = true;
    try { await post(`${API}/games/${gameId}/generate`, { kind, prompt, name: name || undefined }); close(true); }
    catch (err) { close(false); if (err.status === 402) noCredits(err.message); else addSystem(err.message); }
    finally { $('genCardYes').disabled = false; }
  };
  $('genCardYes').focus();
}
function onGen(row) {
  const i = pendingGens.findIndex((p) => p.task_id === row.task_id);
  if (i >= 0) pendingGens[i] = row; else pendingGens.push(row);
  if (row.state === 'done' || row.state === 'failed') setTimeout(() => { pendingGens = pendingGens.filter((p) => p.task_id !== row.task_id); renderGens(); }, 8000);
  renderGens();
  toStage({ type: 'gen', row });
  if (row.state === 'failed') {
    addSystem(`Making ${row.name || row.kind} failed. Your credits for it were given back.`);
    frustrated('generation_failed', { kind: row.kind || null });
  }
  if (row.state === 'done' && i >= 0) {
    hga()?.track('asset_made', { kind: row.kind || null });
    askLater({ id: 'editor-first-asset', question: `How did ${String(row.asset_name || row.name || 'that').slice(0, 40)} turn out?`, context: `made ${row.kind || 'asset'}`, kind: 'stars', comment: true }, 3000);
  }
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
// The errors pill and its list only with ?dev=1 on the editor's address (J, 2026-10-24); the errors are still kept and
// reported.
const DEV_ERRORS = new URLSearchParams(location.search).get('dev') === '1';
function renderErrors() {
  $('errorsContainer').hidden = !errors.length || !DEV_ERRORS;
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
  list.innerHTML = releases.length ? '' : '<p class="muted small">No saves yet. Press Save (bottom right, or Ctrl+S) to keep a point you can come back to.</p>';
  for (const r of releases) list.appendChild(saveRow(r));
}
const ago = (t) => { const s = Math.max(1, Math.round((Date.now() - t) / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
/** One save in the history: when, who, what, play it, and (the owner) bring it back. */
function saveRow(r) {
  const div = document.createElement('div');
  div.className = 'release';
  div.innerHTML = `<span class="v">${r.version}</span><span class="grow small"><b>${esc(r.notes || 'Saved')}</b><br><span class="muted">${esc(r.by || '')} · ${ago(r.created)}</span></span><a class="st-btn small" target="_blank" href="/play/${esc(game.slug)}/v/${r.version}">Play</a>`;
  if (game.role === 'owner') {
    const btn = document.createElement('button');
    btn.className = 'st-btn small';
    btn.textContent = 'Bring back';
    btn.onclick = async () => {
      if (!confirm(`Bring back save ${r.version}? The game goes back to how it was then, live for everyone. What's there now is saved first, so you can undo this from the history.`)) return;
      btn.disabled = true;
      try { await post(`${API}/games/${gameId}/releases/${r.version}/restore`); location.reload(); } catch (err) { btn.disabled = false; alert(err.message); }
    };
    div.appendChild(btn);
  }
  return div;
}

// ------------------------------------------------------------------ save: a point in the game's history
let unsaved = false;
function markUnsaved() { if (!unsaved) { unsaved = true; renderSave(); } }
function markSaved() { unsaved = false; renderSave(); }
function renderSave() {
  $('saveBtn').classList.toggle('unsaved', unsaved);
  $('saveLbl').textContent = unsaved || !releases.length ? 'Save' : 'Saved';
}
async function saveNow() {
  if (!['owner', 'editor', 'builder'].includes(game.role)) return addSystem("You're playing this one: the owner can let you build from People.");
  const b = $('saveBtn');
  if (b.classList.contains('busy')) return;
  b.classList.add('busy');
  $('saveLbl').textContent = 'Saving…';
  try {
    const r = await post(`${API}/games/${gameId}/save`, {});
    releases = r.releases || releases;
    renderReleases();
    markSaved();
    $('saveLbl').textContent = `Saved · ${r.version}`;
    toStage({ type: 'toast', text: `Saved (save ${r.version}). The menu's Saves brings any save back.` });
  } catch (err) { addSystem(err.message); renderSave(); } finally { b.classList.remove('busy'); }
}
$('saveBtn').onclick = saveNow;
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !(document.activeElement && document.activeElement.closest('.cm-editor'))) { e.preventDefault(); if (!playing) saveNow(); } });

/** What your role lets you see: players play; builders build the world; editors and the owner also have the code. */
function applyRole() {
  const r = game.role;
  document.body.classList.toggle('role-player', r === 'player');
  document.body.classList.toggle('role-builder', r === 'builder');
  if (r === 'player') toStage({ type: 'mode', mode: 'play' });
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
// ------------------------------------------------------------------ the building tour (?welcome=build)
// A world saved from the guest sandbox opens here with a short tour of building: look around, drop something in from
// the Overseer, move it, ask the assistant, then Tab back to playing (their island, without the Overseer's beginning
// again). Each step moves on by itself when it's done; once finished (or skipped) it doesn't come back.
const TOUR_KEY = 'hg_build_tour';
const TOUR = [
  { id: 'look', text: '<b>You are building now.</b> Fly around: WASD to move, double-tap Space to fly, and you go where you look.', next: 'Got it' },
  { id: 'create', text: '<b>Bring something in.</b> Hold <kbd>Q</kbd> (or the ➕) and pick anything: the Overseer drops it in.' },
  { id: 'move', text: '<b>Move it.</b> Hold click on it, drag it somewhere, let go. Double-click anything to change it.' },
  { id: 'ask', text: '<b>Ask for anything.</b> Type an idea in the box below, like <i>a volcano behind the hut</i>, and the Overseer builds it.', next: 'Maybe later' },
  { id: 'play', text: '<b>Now play it.</b> Press <kbd>Tab</kbd> to go back to your island. Tab again brings you back here.' },
];
let tourAt = -1;
function tourStart() {
  try { if (localStorage.getItem(TOUR_KEY)) return; } catch { /* fine */ }
  tourAt = 0;
  tourShow();
  builderDid('build_tour_start');
}
function tourShow() {
  let el = document.getElementById('buildTour');
  const st = TOUR[tourAt];
  if (!st) { if (el) el.remove(); return; }
  if (!el) {
    if (!document.getElementById('buildTourCss')) {
      const css = document.createElement('style');
      css.id = 'buildTourCss';
      css.textContent = '#buildTour{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:60;width:min(460px,calc(100vw - 24px));background:rgba(12,16,28,.94);color:#eef2ff;border:1px solid rgba(255,216,74,.55);border-radius:14px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.45)}#buildTour .n{font:700 11px system-ui;letter-spacing:.08em;text-transform:uppercase;color:#ffd84a;margin-bottom:4px}#buildTour kbd{font:700 12px ui-monospace,monospace;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:5px;padding:1px 6px}#buildTour .row{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}#buildTour button{font:700 13px system-ui;border-radius:9px;padding:7px 12px;cursor:pointer;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:#fff}#buildTour button.go{background:#ffd84a;color:#16130a;border-color:#ffd84a}';
      document.head.appendChild(css);
    }
    el = document.createElement('div');
    el.id = 'buildTour';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<div class="n">Building · ${tourAt + 1} of ${TOUR.length}</div><div>${st.text}</div><div class="row"><button type="button" data-skip>Skip the tour</button>${st.next ? `<button type="button" class="go" data-next>${st.next}</button>` : ''}</div>`;
  el.querySelector('[data-skip]').onclick = () => tourEnd(true);
  const nx = el.querySelector('[data-next]');
  if (nx) nx.onclick = () => tourDone(st.id);
}
/** A step happened: the tour moves on if it was the one shown (or a later one: they skipped ahead). */
function tourDone(id) {
  if (tourAt < 0) return;
  const i = TOUR.findIndex((s) => s.id === id);
  if (i < tourAt) return;
  builderDid(`build_tour_${id}`);
  tourAt = i + 1;
  if (tourAt >= TOUR.length) tourEnd(false); else tourShow();
}
function tourEnd(skipped) {
  tourAt = -1;
  const el = document.getElementById('buildTour');
  if (el) el.remove();
  try { localStorage.setItem(TOUR_KEY, String(Date.now())); } catch { /* fine */ }
  builderDid(skipped ? 'build_tour_skipped' : 'build_tour_done');
}
if (new URLSearchParams(location.search).get('welcome') === 'build') {
  history.replaceState(null, '', location.pathname);
  setTimeout(tourStart, 2500);
}

// ------------------------------------------------------------------ playing: the building UI steps away
let playing = false;
function setPlaying(on) {
  playing = on;
  if (on) tourDone('play');
  document.body.classList.toggle('playing', on);
  const item = $('menu').querySelector('[data-act="mode"]');
  if (item) item.textContent = on ? 'Back to building' : 'Play the game';
  if (on) {
    closeLibrary(); closeDrawer();
    $('chatInput').blur();
    document.body.classList.add('intro');
    clearTimeout(setPlaying.t);
    setPlaying.t = setTimeout(() => document.body.classList.remove('intro'), 2600);
  } else document.body.classList.remove('intro');
}

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
  // Who you are (the mirror's questions, in the game): what you are, how you look, your name.
  if (act === 'look') { closeMenu(); toStage({ type: 'presence', open: 'customize' }); }
  if (act === 'journal') { closeMenu(); toStage({ type: 'journal' }); }
  if (act === 'mode') { closeMenu(); toStage({ type: 'mode', mode: playing ? 'build' : 'play' }); }
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
  if (act === 'saves') {
    const el = sheet(`<h3>Saves</h3><p>Your game is always live: everyone plays it as it is right now. A save is a point you can come back to. ${game.role === 'owner' ? 'Bring one back if something went wrong.' : 'The owner can bring one back.'}</p><div class="st-saves" id="savesList"></div><button class="st-menu-item primary" id="saveFromMenu" type="button">Save now</button><button class="st-menu-item" data-back type="button">Back</button>`);
    el.querySelector('[data-back]').onclick = () => { el.hidden = true; };
    const fill = () => { const l = el.querySelector('#savesList'); l.innerHTML = releases.length ? '' : '<p class="muted small">No saves yet.</p>'; for (const r of releases) l.appendChild(saveRow(r)); };
    fill();
    el.querySelector('#saveFromMenu').onclick = async () => { await saveNow(); fill(); };
  }
  if (act === 'people') {
    const owner = game.role === 'owner';
    const el = sheet(`<h3>People and permissions</h3><p>${owner ? 'Choose what each person can do. Builders change the world (and ask the assistant); editors also change code and settings; players only play.' : 'The owner decides what each person can do.'}</p><div class="st-people" id="peopleList"></div>
      <div class="st-visitors"><b>Visitors</b><span class="muted small">People who open your live game without an invite.</span><div class="seg"><button type="button" data-v="play">Play only</button><button type="button" data-v="build">Can help build</button></div></div>
      <button class="st-menu-item" id="peopleInvite" type="button">Invite someone to build</button><button class="st-menu-item" data-back type="button">Back</button>`);
    el.querySelector('[data-back]').onclick = () => { el.hidden = true; };
    el.querySelector('#peopleInvite').onclick = () => $('menu').querySelector('[data-act="invite"]').click();
    const ROLE_NAMES = { owner: 'Owner', editor: 'Editor', builder: 'Builder', player: 'Player' };
    const fill = () => {
      const l = el.querySelector('#peopleList');
      l.innerHTML = '';
      for (const m of members) {
        const row = document.createElement('div');
        row.className = 'member';
        row.innerHTML = `<span class="nm">${esc(m.name || 'Someone')}${me && m.id === me.id ? ' (you)' : ''}</span>`;
        if (owner && m.role !== 'owner') {
          const sel = document.createElement('select');
          for (const r of ['player', 'builder', 'editor']) sel.add(new Option(ROLE_NAMES[r], r, false, m.role === r));
          sel.onchange = async () => { try { const g = await post(`${API}/games/${gameId}/members/${m.id}`, { role: sel.value }); members = g.members || members; fill(); } catch (err) { alert(err.message); fill(); } };
          row.appendChild(sel);
          const x = document.createElement('button');
          x.className = 'st-btn small'; x.type = 'button'; x.textContent = 'Remove';
          x.onclick = async () => { if (!confirm(`Remove ${m.name}?`)) return; try { await del(`${API}/games/${gameId}/members/${m.id}`); members = members.filter((y) => y.id !== m.id); fill(); } catch (err) { alert(err.message); } };
          row.appendChild(x);
        } else row.insertAdjacentHTML('beforeend', `<span class="label">${ROLE_NAMES[m.role] || m.role}</span>`);
        l.appendChild(row);
      }
      for (const b of el.querySelectorAll('.st-visitors [data-v]')) {
        b.classList.toggle('on', (game.visitors || 'play') === b.dataset.v);
        b.disabled = !owner;
        b.onclick = async () => { try { game = { ...game, ...(await post(`${API}/games/${gameId}`, { visitors: b.dataset.v })) }; fill(); } catch (err) { alert(err.message); } };
      }
    };
    fill();
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
let libKind = 'basics';
let basics = [];
let libItems = [];
function openLibrary() { closeDrawer(); $('library').classList.add('open'); $('libraryBtn').classList.add('on'); loadLibrary(); }
function closeLibrary() { $('library').classList.remove('open'); $('libraryBtn').classList.remove('on'); }
function toggleLibrary() { $('library').classList.contains('open') ? closeLibrary() : openLibrary(); }
$('libraryBtn').onclick = toggleLibrary;
$('libraryClose').onclick = closeLibrary;
$('openLibrary2').onclick = openLibrary;
for (const b of $('libTabs').querySelectorAll('button')) b.onclick = () => { libKind = b.dataset.k; for (const x of $('libTabs').querySelectorAll('button')) x.classList.toggle('on', x === b); loadLibrary(); };
const GEN_KIND = { model: 'mesh', image: 'image', audio: 'audio', video: 'video' };
// Community things by what they become in the world: a model, a picture, a sound, a texture on what you point at, the sky.
const PLACE_AS = { model: 'mesh', image: 'image', sprite: 'image', texture: 'image', sky: 'image', music: 'audio', ambience: 'audio', sfx: 'audio', voice: 'audio', video: 'video' };
const GLYPH = { model: '◆', music: '♫', ambience: '≈', sfx: '♪', voice: '❝', video: '▶' };
const KIND_LABEL = { model: '3D', texture: 'TEX', sky: 'SKY', sprite: 'PIC', image: 'PIC', music: 'MUSIC', ambience: 'AMB', sfx: 'SFX', voice: 'VOICE', video: 'VID' };
function communityTile(c, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'st-lib-item community';
  b.title = `${c.title}${c.tags && c.tags.length ? ` · ${c.tags.join(' ')}` : ''} · by ${c.by}`;
  b.innerHTML = `${c.thumb ? `<img src="${c.thumb}" alt="" loading="lazy">` : `<span>${GLYPH[c.kind] || '◆'}</span>`}<span class="kind">${KIND_LABEL[c.kind] || c.kind}</span>${c.likes ? `<span class="likes" title="${c.likes} other ${c.likes === 1 ? 'builder' : 'builders'} used it">♥ ${c.likes}</span>` : ''}<span class="t">${esc(c.title)}<small>${esc(c.by)}</small></span>`;
  if (['music', 'ambience', 'sfx', 'voice'].includes(c.kind)) {
    // Hover to hear it.
    let au = null;
    b.onmouseenter = () => { au = au || new Audio(c.file); au.currentTime = 0; au.volume = 0.6; au.play().catch(() => {}); };
    b.onmouseleave = () => { if (au) au.pause(); };
  }
  b.onclick = () => onClick(c, b);
  return b;
}
/** Puts a community thing in the game (under `name`, when the assistant already uses one) and where you're looking. */
async function useCommunity(c, el, o = {}) {
  if (el) el.classList.add('busy');
  try {
    const r = await post(`${API}/games/${gameId}/community`, { id: c.id, name: o.name, messageId: o.messageId, suggestion: o.suggestion });
    assets[r.asset.name] = r.asset;
    await sendAssets();
    const as = c.kind === 'texture' ? 'texture' : c.kind === 'sky' ? 'sky' : null;
    // ifUnused: the assistant may already have a stand-in that uses this name; then that one turns into it.
    toStage({ type: 'place', asset: { name: r.asset.name, kind: PLACE_AS[c.kind] || 'image', as, title: c.title, ifUnused: Boolean(o.ifUnused) } });
    closeLibrary();
    stage.focus();
  } catch (err) { addSystem(err.message); } finally { if (el) el.classList.remove('busy'); }
}
let communityTags = null;
let communitySort = 'liked';
for (const b of $('libSort').querySelectorAll('button')) b.onclick = () => { communitySort = b.dataset.s; for (const x of $('libSort').querySelectorAll('button')) x.classList.toggle('on', x === b); loadLibrary(); };
let searchTimer = 0;
$('libSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadLibrary, 250); };
async function loadCommunity(grid) {
  if (!communityTags) {
    communityTags = [];
    get('/v1/community/tags').then((r) => {
      communityTags = r.tags || [];
      $('libChips').innerHTML = '';
      for (const t of communityTags.slice(0, 18)) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = t.tag;
        chip.onclick = () => { $('libSearch').value = t.tag; loadLibrary(); };
        $('libChips').appendChild(chip);
      }
    }).catch(() => {});
  }
  grid.innerHTML = '<div class="st-lib-empty">Searching the community…</div>';
  let items = [];
  try { items = (await get(`/v1/community?${new URLSearchParams({ q: $('libSearch').value.trim(), limit: '80', sort: communitySort })}`)).items || []; } catch { grid.innerHTML = '<div class="st-lib-empty">The community library isn\'t reachable right now. Try again in a moment.</div>'; return; }
  grid.innerHTML = '';
  if (!items.length) {
    grid.innerHTML = `<div class="st-lib-empty">${$('libSearch').value.trim() ? 'Nothing shared matches that yet. Ask the assistant to make one, and share it for everyone.' : 'Nothing shared yet.'}</div>`;
    return;
  }
  for (const c of items) grid.appendChild(communityTile(c, (x, el) => useCommunity(x, el)));
}
/** Shares one of your things with the community: a title and a few search words. */
function shareSheet(a, tile) {
  const old = $('libGrid').querySelector('.st-share');
  if (old) old.remove();
  const f = document.createElement('form');
  f.className = 'st-share';
  const kind = a.kind === 'mesh' ? 'model' : a.kind === 'audio' ? 'sfx' : a.kind;
  f.innerHTML = `<b>Share with the community</b><span class="muted small">Everyone building games can find and use it. It stays yours.</span>
    <input name="title" maxlength="80" placeholder="Name" value="${esc(a.title || '')}">
    <input name="tags" maxlength="200" placeholder="Search words: ball bouncy toy">
    ${a.kind === 'image' ? '<select name="kind"><option value="image">Picture</option><option value="sprite">Sprite</option><option value="texture">Tiling texture</option><option value="sky">Sky</option></select>' : a.kind === 'audio' ? '<select name="kind"><option value="sfx">Sound effect</option><option value="music">Music</option><option value="ambience">Ambience</option><option value="voice">Voice</option></select>' : ''}
    <span class="row"><button type="submit" class="st-btn primary small">Share</button><button type="button" class="st-btn small" data-x>Cancel</button></span>`;
  f.querySelector('[data-x]').onclick = () => f.remove();
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const r = await post('/v1/community', { asset: a.id, title: f.title.value.trim(), tags: f.tags.value, kind: f.kind ? f.kind.value : kind });
      f.innerHTML = `<b>Shared: ${esc(r.title)}</b><span class="muted small">Find it in Community${r.tags.length ? ` under ${esc(r.tags.slice(0, 4).join(', '))}` : ''}.</span>`;
      if (tile) tile.classList.add('shared');
      communityTags = null;
      setTimeout(() => f.remove(), 3000);
    } catch (err) { btn.disabled = false; btn.textContent = err.message; }
  };
  $('libGrid').prepend(f);
  f.title.focus();
}
async function loadLibrary() {
  const grid = $('libGrid');
  $('libSearchRow').hidden = libKind !== 'community';
  $('libNote').textContent = libKind === 'basics' ? "Click one to put it where you're looking. Then double-click it to change it, or tell the assistant what it should do."
    : libKind === 'community' ? 'Things other builders shared, and the Hawkes starter pack. Free to use in your game. Textures go on what you point at.'
    : libKind === 'game' ? 'Each word and the assets it uses (a herd of cows, the trees). The first is the default; Mix spreads them all.'
    : 'Everything you make with Hawkes Gen is yours, here and in the Asset studio. ⇪ shares one with the community.';
  if (libKind === 'community') return loadCommunity(grid);
  if (libKind === 'game') { grid.innerHTML = '<div class="st-lib-empty">Loading…</div>'; toStage({ type: 'words?' }); return; }
  if (libKind === 'basics') {
    if (!basics.length) { toStage({ type: 'basics?' }); grid.innerHTML = '<div class="st-lib-empty">Loading…</div>'; return; }
    grid.innerHTML = '';
    for (const b of basics) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'st-lib-item basic';
      el.innerHTML = `<span class="glyph">${esc(b.icon)}</span><span class="t">${esc(b.label)}</span>`;
      el.onclick = () => { toStage({ type: 'placeBasic', k: b.k }); stage.focus(); };
      grid.appendChild(el);
    }
    return;
  }
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
    // (A library tile shows a small level of the picture: Gen makes them with every image.)
    const small = a.lods && a.lods.levels && ([...a.lods.levels].reverse().find((l) => l.level <= 256) || a.lods.levels[0]);
    b.innerHTML = `${a.kind === 'image' ? `<img src="${small ? `${url}?lod=${small.level}&v=${encodeURIComponent(small.sha || '')}` : url}" alt="" loading="lazy">` : a.kind === 'video' ? `<video src="${url}" muted loop playsinline preload="metadata"></video>` : `<span>${a.kind === 'mesh' ? '◆' : '♪'}</span>`}<span class="kind">${label}</span><span class="t">${esc(a.title || a.recipe?.params?.prompt || a.tool || a.id)}</span>`;
    const v = b.querySelector('video');
    if (v) { b.onmouseenter = () => v.play().catch(() => {}); b.onmouseleave = () => v.pause(); }
    b.onclick = () => placeFromLibrary(a, b);
    if (a.kind !== 'video') {
      const sh = document.createElement('span');
      sh.className = 'share';
      sh.title = 'Share with the community';
      sh.textContent = '⇪';
      sh.onclick = (e) => { e.stopPropagation(); shareSheet(a, b); };
      b.appendChild(sh);
    }
    grid.appendChild(b);
  }
}
/** "In this game": every word the game's assets answer to, and the ones it uses: use only this one, add as a
 *  variant, remove, mix them (config.assets, changed through the game: undoable, live for everyone). */
function renderWords(words, list) {
  const grid = $('libGrid');
  const byId = new Map(list.map((a) => [a.id || a.name, a]));
  const entries = Object.entries(words).filter(([, w]) => w.ids.length).sort((a, b) => (b[1].from === 'config') - (a[1].from === 'config') || b[1].ids.length - a[1].ids.length || a[0].localeCompare(b[0]));
  grid.innerHTML = entries.length ? '' : '<div class="st-lib-empty">No assets in this game yet. Use something from Community or Yours, or ask the assistant.</div>';
  const set = (word, value) => toStage({ type: 'assetsConfig', word, value });
  for (const [word, w] of entries.slice(0, 60)) {
    const chosen = w.chosen || [];
    const row = document.createElement('div');
    row.className = 'st-words';
    row.innerHTML = `<div class="st-words-head"><b>${esc(word)}</b><span class="muted small">${w.ids.length} ${w.ids.length === 1 ? 'asset' : 'assets'}${chosen.length ? '' : ' · by label'}</span>${w.ids.length > 1 ? `<label class="small"><input type="checkbox" ${w.mix ? 'checked' : ''}> Mix</label>` : ''}</div><div class="st-words-row"></div>`;
    const mix = row.querySelector('input');
    if (mix) mix.onchange = () => set(word, { ids: chosen.length ? chosen : w.ids, mix: mix.checked });
    const strip = row.querySelector('.st-words-row');
    w.ids.forEach((id, i) => {
      const a = byId.get(id) || { id, name: id, type: null };
      const t = document.createElement('div');
      t.className = 'st-lib-item st-word-item';
      const inUse = chosen.includes(id);
      const thumb = a.type === 'image' ? `<img src="${esc(a.url)}" alt="" loading="lazy">` : a.type === 'video' ? `<video src="${esc(a.url)}" muted loop playsinline preload="metadata"></video>` : `<span>${a.type === 'sound' ? '♪' : '◆'}</span>`;
      t.innerHTML = `${thumb}<span class="kind">${i === 0 ? 'DEFAULT' : inUse ? 'IN USE' : ''}</span><span class="t">${esc(a.title || a.name)}<small>${esc(a.id || '')}</small></span><span class="st-word-acts"><button type="button" data-a="only">Use only this</button>${inUse ? '<button type="button" data-a="remove">Remove</button>' : '<button type="button" data-a="variant">Add as a variant</button>'}</span>`;
      t.querySelector('[data-a=only]').onclick = () => set(word, { ids: [id], mix: false });
      const v = t.querySelector('[data-a=variant]');
      if (v) v.onclick = () => set(word, { ids: [...(chosen.length ? chosen : [w.ids[0]]).filter((x) => x !== id), id], mix: true });
      const r = t.querySelector('[data-a=remove]');
      if (r) r.onclick = () => { const left = chosen.filter((x) => x !== id); set(word, left.length ? { ids: left, mix: w.mix && left.length > 1 } : null); };
      strip.appendChild(t);
    });
    grid.appendChild(row);
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
  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on this page (not in a text field or the code): the world's undo, in the game.
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y') && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') && !e.target.isContentEditable && !e.target.closest?.('.cm-editor, .CodeMirror')) {
    e.preventDefault();
    toStage({ type: k === 'y' || e.shiftKey ? 'redo' : 'undo' });
  }
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
  // A click or a key skips it.
  let skip = false;
  const skipIt = () => { skip = true; };
  overlay.addEventListener('pointerdown', skipIt);
  document.addEventListener('keydown', skipIt, { once: true });
  const line = async (text, cls) => {
    if (skip) return;
    const el = document.createElement('div');
    el.className = `boot-line${cls ? ` ${cls}` : ''}`;
    lines.appendChild(el);
    for (let i = 0; i <= text.length && !skip; i++) { el.textContent = text.slice(0, i); await wait(14); }
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
  if (!skip) await wait(1600);
  overlay.classList.add('fade-out');
  await wait(800);
  overlay.remove();
  try { localStorage.setItem(key, '1'); } catch {}
}

// ------------------------------------------------------------------ the Overseer's captions, voice and music
// The assistant speaks as the Overseer: its replies are always captions (the chat). They are also spoken only where the
// Overseer has a clip with those very words (the game's speech desk decides); never the browser's own voice.
function initVoice() {
  const save = () => { try { localStorage.setItem('hg_overseer_speech', JSON.stringify(speechSettings)); } catch {} toStage({ type: 'speech-settings', ...speechSettings }); };
  $('speechCaptions').checked = speechSettings.captions;
  $('speechVoice').value = Math.round(speechSettings.voice * 100);
  $('speechMusic').value = Math.round(speechSettings.music * 100);
  $('speechCaptions').onchange = () => { speechSettings.captions = $('speechCaptions').checked; save(); };
  $('speechVoice').oninput = () => { speechSettings.voice = Number($('speechVoice').value) / 100; save(); };
  $('speechMusic').oninput = () => { speechSettings.music = Number($('speechMusic').value) / 100; save(); };
  $('speechReplay').onclick = () => toStage({ type: 'speech-replay' });
}
function speak(text) { toStage({ type: 'assistant-reply', text: String(text || '').slice(0, 400) }); }
