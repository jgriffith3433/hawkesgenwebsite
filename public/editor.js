// The immersive game editor: full-screen game preview, AI HUD overlay, slide-out panels.
/* global CodeMirror marked */
const API = '/v1';
const gameId = /\/app\/g\/(g_[0-9a-f]+)/.exec(location.pathname)?.[1];
if (!gameId) location.replace('/app');

let game = null;
let files = {};
let assets = {};
let members = [];
let releases = [];
let me = null;
let connId = null;
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

let panelOpen = null; // 'files' | 'settings' | 'docs' | null
let codeOpen = false;

// ===================================================================== init
(async () => {
  try {
    me = await get('/v1/users/me');
    const data = await get(`${API}/games/${gameId}`);
    game = data.game;
    files = Object.fromEntries(data.files.map(f => [f.path, f]));
    assets = Object.fromEntries(data.assets.map(a => [a.name, a]));
    members = data.game.members || [];
    releases = data.releases || [];

    document.getElementById('gameTitle').value = game.title;
    render();
    connect();
    loadDocs();
    loadSettings();
    loadChat();
    updatePreview();

    const paths = Object.keys(files).sort();
    if (paths.length) {
      const first = paths.find(p => p.endsWith('.js')) || paths[0];
      openFile(first, false);
    }
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
  const res = await fetch(url, { method: 'POST', headers: h, credentials: 'include', body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function del(url) {
  const h = {};
  if (connId) h['X-Conn'] = connId;
  const res = await fetch(url, { method: 'DELETE', headers: h, credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ===================================================================== panels
function togglePanel(name) {
  const panels = { files: 'filesPanel', settings: 'settingsPanel', docs: 'docsPanel' };
  const toggles = { files: 'panelToggle', settings: 'settingsToggle', docs: 'docsToggle' };
  if (panelOpen === name) {
    document.getElementById(panels[name]).classList.remove('open');
    document.getElementById(toggles[name]).classList.remove('active');
    panelOpen = null;
  } else {
    for (const [k, id] of Object.entries(panels)) {
      document.getElementById(id).classList.toggle('open', k === name);
      document.getElementById(toggles[k]).classList.toggle('active', k === name);
    }
    panelOpen = name;
  }
}

function toggleCode() {
  codeOpen = !codeOpen;
  document.getElementById('codePanel').classList.toggle('open', codeOpen);
  document.getElementById('codeToggle').classList.toggle('active', codeOpen);
  if (codeOpen && editor) editor.refresh();
}

document.getElementById('panelToggle').onclick = () => togglePanel('files');
document.getElementById('settingsToggle').onclick = () => togglePanel('settings');
document.getElementById('docsToggle').onclick = () => togglePanel('docs');
document.getElementById('codeToggle').onclick = toggleCode;
document.getElementById('refreshBtn').onclick = updatePreview;

// ===================================================================== render
function render() {
  const filesList = document.getElementById('filesList');
  filesList.innerHTML = '';
  for (const p of Object.keys(files).sort()) {
    const div = document.createElement('button');
    div.className = 'ed-item' + (p === openPath ? ' on' : '');
    const ext = p.split('.').pop();
    const icon = ext === 'js' ? 'JS' : ext === 'json' ? '{}' : ext === 'md' ? 'MD' : ext;
    div.innerHTML = `<span style="font:9px var(--mono);color:var(--fg-3);width:20px;text-align:center">${icon}</span><span class="nm">${esc(p)}</span>`;
    div.onclick = () => openFile(p, true);
    filesList.appendChild(div);
  }

  const assetsList = document.getElementById('assetsList');
  assetsList.innerHTML = '';
  for (const name of Object.keys(assets).sort()) {
    const a = assets[name];
    const div = document.createElement('div');
    div.className = 'ed-item';
    const kind = a.mime?.startsWith('image/') ? 'IMG' : a.mime?.startsWith('audio/') ? 'SFX' : a.kind === 'mesh' ? '3D' : 'FILE';
    div.innerHTML = `<span style="font:9px var(--mono);color:var(--fg-3);width:20px;text-align:center">${kind}</span><span class="nm">${esc(name)}</span><button class="x" title="Remove">&times;</button>`;
    div.querySelector('.x').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove ${name}?`)) return;
      try {
        await del(`${API}/games/${gameId}/assets/${encodeURIComponent(name)}`);
        delete assets[name];
        render();
      } catch (err) { alert(err.message); }
    };
    assetsList.appendChild(div);
  }

  setSaveState(dirty ? 'Unsaved' : saving ? 'Saving...' : '');
}

function setSaveState(text) {
  document.getElementById('saveState').textContent = text;
}

function avatarColor(userId) {
  const colors = ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316'];
  const hash = (userId || '').split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  return colors[Math.abs(hash) % colors.length];
}

// ===================================================================== code editor
function openFile(path, showPanel = true) {
  if (!editor) {
    editor = CodeMirror(document.getElementById('editor'), {
      lineNumbers: true,
      theme: 'default',
      tabSize: 2,
      indentWithTabs: false,
      lineWrapping: false,
    });
    editor.on('change', () => {
      if (!dirty) dirty = true;
      scheduleSave();
    });
  }

  const f = files[path];
  if (!f) return;

  openPath = path;
  baseRev = f.rev;
  dirty = false;

  const mode = path.endsWith('.js') ? 'javascript' : path.endsWith('.json') ? { name: 'javascript', json: true } : path.endsWith('.md') ? 'markdown' : path.endsWith('.css') ? 'css' : 'text/plain';
  editor.setOption('mode', mode);
  editor.setValue(f.content);
  editor.clearHistory();

  document.getElementById('openFile').textContent = path;
  document.getElementById('renameFileBtn').hidden = false;
  document.getElementById('deleteFileBtn').hidden = false;
  document.getElementById('conflict').hidden = true;

  if (showPanel && !codeOpen) toggleCode();
  render();
  reportPresence();
}

function scheduleSave() {
  setSaveState('Unsaved');
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveFile, 1000);
}

async function saveFile() {
  if (!openPath || !dirty || saving) return;
  saving = true;
  setSaveState('Saving...');
  try {
    const content = editor.getValue();
    const res = await post(`${API}/games/${gameId}/files`, { path: openPath, content, baseRev });
    files[openPath] = { path: openPath, content, rev: res.rev, updated: res.updated, updated_by: me?.id };
    baseRev = res.rev;
    dirty = false;
    saving = false;
    setSaveState('');
    if (openPath.endsWith('.js') || openPath === 'game.json') updatePreview();
  } catch (err) {
    saving = false;
    setSaveState('Save failed');
    console.error(err);
  }
}

async function reportPresence() {
  if (!connId || !openPath) return;
  try {
    await post(`${API}/games/${gameId}/presence`, { file: openPath, line: editor?.getCursor().line || 0 });
  } catch {}
}

// ===================================================================== realtime (SSE)
function connect() {
  if (sse) sse.close();
  sse = new EventSource(`${API}/games/${gameId}/live`, { withCredentials: true });

  sse.addEventListener('hello', (e) => {
    const data = JSON.parse(e.data);
    connId = data.conn;
    updatePresenceUI(data.presence || []);
  });

  sse.addEventListener('file', (e) => {
    const data = JSON.parse(e.data);
    files[data.path] = data;
    if (data.path === openPath && data.updated_by !== me?.id) {
      if (dirty) {
        document.getElementById('conflict').hidden = false;
      } else {
        baseRev = data.rev;
        editor.setValue(data.content);
        editor.clearHistory();
      }
    }
    render();
    if (data.path?.endsWith('.js') || data.path === 'game.json') updatePreview();
  });

  sse.addEventListener('file-deleted', (e) => {
    const data = JSON.parse(e.data);
    delete files[data.path];
    if (data.path === openPath) {
      openPath = null;
      if (editor) editor.setValue('');
      document.getElementById('openFile').textContent = '';
    }
    render();
  });

  sse.addEventListener('asset', (e) => {
    const data = JSON.parse(e.data);
    assets[data.name] = data;
    render();
  });

  sse.addEventListener('asset-removed', (e) => {
    const data = JSON.parse(e.data);
    delete assets[data.name];
    render();
  });

  sse.addEventListener('presence', (e) => {
    updatePresenceUI(JSON.parse(e.data));
  });

  sse.addEventListener('chat', (e) => {
    chatHistory.push(JSON.parse(e.data));
    renderChat();
  });

  sse.addEventListener('thinking', (e) => {
    const data = JSON.parse(e.data);
    const el = document.getElementById('thinkingIndicator');
    el.hidden = !data.on;
    if (data.on) el.textContent = `${data.by || 'AI'} is thinking...`;
  });

  sse.addEventListener('gen-update', (e) => {
    updateGen(JSON.parse(e.data));
  });

  sse.addEventListener('reload', () => location.reload());

  sse.onerror = () => setTimeout(connect, 3000);
}

function updatePresenceUI(list) {
  const presenceEl = document.getElementById('presence');
  presenceEl.innerHTML = '';
  const others = list.filter(p => p.user !== me?.id);
  for (const p of others.slice(0, 5)) {
    const av = document.createElement('div');
    av.className = 'avatar';
    av.style.background = p.color || avatarColor(p.user);
    av.textContent = (p.name || 'A')[0].toUpperCase();
    av.title = p.name + (p.file ? ` — ${p.file}` : '');
    presenceEl.appendChild(av);
  }
}

// Conflict resolution
document.getElementById('conflictKeep').onclick = async () => {
  dirty = true;
  await saveFile();
  document.getElementById('conflict').hidden = true;
};

document.getElementById('conflictTake').onclick = () => {
  const f = files[openPath];
  baseRev = f.rev;
  dirty = false;
  editor.setValue(f.content);
  editor.clearHistory();
  document.getElementById('conflict').hidden = true;
  setSaveState('');
};

// ===================================================================== file operations
document.getElementById('newFileBtn').onclick = () => {
  const name = prompt('File name (e.g., scripts/helper.js):');
  if (!name) return;
  const path = name.trim();
  if (files[path]) return alert('File already exists');
  post(`${API}/games/${gameId}/files`, { path, content: '', baseRev: 0 }).then(res => {
    files[path] = { path, content: '', rev: res.rev, updated: res.updated, updated_by: me?.id };
    render();
    openFile(path, true);
  }).catch(err => alert(err.message));
};

document.getElementById('renameFileBtn').onclick = () => {
  if (!openPath) return;
  const to = prompt('Rename to:', openPath);
  if (!to || to === openPath) return;
  post(`${API}/games/${gameId}/files/rename`, { from: openPath, to }).then(() => {
    files[to] = { ...files[openPath], path: to };
    delete files[openPath];
    openPath = to;
    render();
    document.getElementById('openFile').textContent = to;
  }).catch(err => alert(err.message));
};

document.getElementById('deleteFileBtn').onclick = () => {
  if (!openPath) return;
  if (!confirm(`Delete ${openPath}?`)) return;
  del(`${API}/games/${gameId}/files?path=${encodeURIComponent(openPath)}`).then(() => {
    delete files[openPath];
    openPath = null;
    if (editor) editor.setValue('');
    document.getElementById('openFile').textContent = '';
    document.getElementById('renameFileBtn').hidden = true;
    document.getElementById('deleteFileBtn').hidden = true;
    render();
  }).catch(err => alert(err.message));
};

// ===================================================================== assets
document.getElementById('newAssetBtn').onclick = () => {
  document.getElementById('assetModal').hidden = false;
};

document.getElementById('addAssetConfirmBtn').onclick = async () => {
  const assetId = document.getElementById('assetId').value.trim();
  const name = document.getElementById('assetName').value.trim();
  if (!assetId) return alert('Enter an asset ID');
  try {
    const res = await post(`${API}/games/${gameId}/assets`, { asset: assetId, name });
    assets[res.name] = res;
    render();
    document.getElementById('assetModal').hidden = true;
    document.getElementById('assetId').value = '';
    document.getElementById('assetName').value = '';
  } catch (err) { alert(err.message); }
};

// ===================================================================== preview
function updatePreview() {
  document.getElementById('preview').src = `/play/_draft?gameId=${gameId}&t=${Date.now()}`;
}

window.addEventListener('message', (e) => {
  if (e.data?.source !== 'hawkes-play') return;
  if (e.data.type === 'error') addError(e.data.message, e.data.file, e.data.line);
});

// ===================================================================== errors (red pill)
function addError(text, file, line) {
  errors.push({ text, file, line, time: Date.now() });
  if (errors.length > 20) errors.shift();
  renderErrors();
}

function renderErrors() {
  const container = document.getElementById('errorsContainer');
  const count = document.getElementById('errorCount');
  const list = document.getElementById('errorList');

  if (!errors.length) { container.hidden = true; return; }

  container.hidden = false;
  count.textContent = errors.length;
  list.innerHTML = '';
  for (const err of errors.slice(-10)) {
    const div = document.createElement('div');
    div.className = 'err';
    if (err.file && err.line != null) {
      div.innerHTML = `<span class="ln">${esc(err.file)}:${err.line}</span>: ${esc(err.text)}`;
      div.querySelector('.ln').onclick = () => { if (files[err.file]) openFile(err.file, true); };
      div.querySelector('.ln').style.cursor = 'pointer';
    } else {
      div.textContent = err.text;
    }
    list.appendChild(div);
  }
}

document.getElementById('errorPill').onclick = () => {
  document.getElementById('errorPanel').hidden = !document.getElementById('errorPanel').hidden;
};

// ===================================================================== chat (HUD overlay)
async function loadChat() {
  try {
    const data = await get(`${API}/games/${gameId}/chat`);
    chatHistory = data.messages || [];
    renderChat();
  } catch {}
}

function renderChat() {
  const log = document.getElementById('chatLog');
  log.innerHTML = '';

  const recent = chatHistory.slice(-20);
  for (const msg of recent) {
    const div = document.createElement('div');
    div.className = `msg ${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'ai'}`;

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = msg.role === 'ai' ? 'AI' : msg.role === 'system' ? 'System' : (msg.name || 'You');
    div.appendChild(who);

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = msg.text;
    div.appendChild(text);

    if (msg.data?.changed?.length) {
      const changed = document.createElement('div');
      changed.className = 'changed';
      changed.textContent = `Changed: ${msg.data.changed.join(', ')}`;
      div.appendChild(changed);
    }

    if (msg.data?.assets?.length) {
      for (let i = 0; i < msg.data.assets.length; i++) {
        const s = msg.data.assets[i];
        const sugg = document.createElement('div');
        sugg.className = 'sugg';
        if (s.task) {
          sugg.innerHTML = `<span class="grow">${esc(s.kind)}: ${esc(s.prompt.slice(0, 60))}</span><span style="color:var(--ok);font-size:11px">Generating...</span>`;
        } else {
          sugg.innerHTML = `<span class="grow">${esc(s.kind)}: ${esc(s.prompt.slice(0, 60))}</span><span style="color:var(--fg-3);font-size:11px">${s.credits || ''}</span>`;
          const btn = document.createElement('button');
          btn.className = 'btn btn-primary btn-sm';
          btn.textContent = 'Generate';
          btn.style.cssText = 'padding:3px 8px;font-size:11px';
          btn.onclick = () => generateSuggestion(msg.id, i, s);
          sugg.appendChild(btn);
        }
        div.appendChild(sugg);
      }
    }

    log.appendChild(div);
  }

  log.scrollTop = log.scrollHeight;
}

async function generateSuggestion(messageId, index, s) {
  try {
    await post(`${API}/games/${gameId}/generate`, { kind: s.kind, prompt: s.prompt, name: s.name, messageId, suggestion: index });
  } catch (err) { alert(err.message); }
}

document.getElementById('sendChatBtn').onclick = sendChat;
document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendChat();
  }
});

async function sendChat() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.disabled = true;
  document.getElementById('sendChatBtn').disabled = true;

  const errText = errors.slice(-5).map(e => `${e.file || 'script'}:${e.line ?? '?'}: ${e.text}`).join('\n');

  try {
    await post(`${API}/games/${gameId}/ai`, { message: text, file: openPath, errors: errText || undefined });
  } catch (err) {
    alert(err.message);
  } finally {
    input.disabled = false;
    document.getElementById('sendChatBtn').disabled = false;
    input.focus();
  }
}

// ===================================================================== gens
function renderGens() {
  const list = document.getElementById('gensList');
  list.innerHTML = '';
  for (const g of pendingGens) {
    const div = document.createElement('div');
    div.className = 'gen-row' + (g.state === 'failed' ? ' failed' : '');
    div.textContent = g.state === 'done' ? `Done: ${g.asset_name || g.name}` : g.state === 'failed' ? `Failed: ${g.kind}` : `${g.detail || g.kind}...`;
    list.appendChild(div);
  }
}

function updateGen(data) {
  const idx = pendingGens.findIndex(p => p.task_id === data.task_id);
  if (idx >= 0) pendingGens[idx] = data;
  else pendingGens.push(data);
  renderGens();
  if (data.state === 'done' && data.asset_name) {
    assets[data.asset_name] = { name: data.asset_name, asset: data.asset, kind: data.kind };
    render();
  }
}

// ===================================================================== docs
async function loadDocs() {
  try {
    const res = await fetch('/play/API.md');
    const md = await res.text();
    document.getElementById('docsContent').innerHTML = marked.parse(md);
  } catch {}
}

// ===================================================================== settings
function loadSettings() {
  document.getElementById('descInput').value = game.description || '';
  document.querySelectorAll('[data-vis]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.vis === game.visibility);
    btn.onclick = () => {
      document.querySelectorAll('[data-vis]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
    };
  });
  document.getElementById('coverInput').value = game.cover || '';

  const membersList = document.getElementById('membersList');
  membersList.innerHTML = '';
  for (const m of members) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)';
    div.innerHTML = `<span style="flex:1;color:#fff">${esc(m.name || 'Someone')}</span><span class="label">${m.role}</span>`;
    if (m.id !== game.owner_id && game.role === 'owner') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = 'Remove';
      btn.onclick = async () => {
        if (!confirm(`Remove ${m.name}?`)) return;
        try {
          await del(`${API}/games/${gameId}/members/${m.id}`);
          members = members.filter(x => x.id !== m.id);
          loadSettings();
        } catch (err) { alert(err.message); }
      };
      div.appendChild(btn);
    }
    membersList.appendChild(div);
  }

  document.getElementById('deleteGameBtn').hidden = game.owner_id !== me?.id;
  renderReleases();
}

function renderReleases() {
  const list = document.getElementById('releasesList');
  list.innerHTML = '';
  for (const r of releases) {
    const div = document.createElement('div');
    div.className = 'release';
    div.innerHTML = `
      <span class="v">v${r.version}</span>
      ${r.version === game.live_version ? '<span class="live">LIVE</span>' : ''}
      <span class="grow muted" style="font-size:12px">${esc(r.notes || 'No notes')}</span>
    `;
    if (r.version !== game.live_version && game.role === 'owner') {
      const btn = document.createElement('button');
      btn.className = 'btn btn-ghost btn-sm';
      btn.textContent = 'Set live';
      btn.onclick = async () => {
        try {
          await post(`${API}/games/${gameId}/live-version`, { version: r.version });
          game.live_version = r.version;
          renderReleases();
        } catch (err) { alert(err.message); }
      };
      div.appendChild(btn);
    }
    list.appendChild(div);
  }
}

document.getElementById('saveSettingsBtn').onclick = async () => {
  try {
    const vis = document.querySelector('[data-vis].on')?.dataset.vis || 'public';
    await post(`${API}/games/${gameId}`, {
      description: document.getElementById('descInput').value,
      visibility: vis,
      cover: document.getElementById('coverInput').value || null,
    });
    game.description = document.getElementById('descInput').value;
    game.visibility = vis;
    game.cover = document.getElementById('coverInput').value || null;
  } catch (err) { alert(err.message); }
};

document.getElementById('publishBtn').onclick = async () => {
  const notes = document.getElementById('releaseNotes').value.trim();
  try {
    const res = await post(`${API}/games/${gameId}/publish`, { notes });
    if (res.version) releases.unshift(res);
    document.getElementById('releaseNotes').value = '';
    renderReleases();
  } catch (err) { alert(err.message); }
};

document.getElementById('leaveBtn').onclick = () => {
  if (confirm('Leave this game?')) location.href = '/app';
};

document.getElementById('deleteGameBtn').onclick = async () => {
  if (!confirm(`Delete "${game.title}" permanently?`)) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  try {
    await del(`${API}/games/${gameId}`);
    location.href = '/app';
  } catch (err) { alert(err.message); }
};

// ===================================================================== top bar
document.getElementById('gameTitle').onchange = async (e) => {
  try {
    await post(`${API}/games/${gameId}`, { title: e.target.value });
    game.title = e.target.value;
  } catch (err) {
    alert(err.message);
    e.target.value = game.title;
  }
};

document.getElementById('playBtn').onclick = () => {
  window.open(`/play/${game.slug}`, '_blank');
};

document.getElementById('inviteBtn').onclick = async () => {
  try {
    const data = await post(`${API}/games/${gameId}/invites`);
    document.getElementById('inviteLink').value = location.origin + data.path;
    document.getElementById('inviteModal').hidden = false;
  } catch (err) { alert(err.message); }
};

document.getElementById('copyInviteBtn').onclick = () => {
  const link = document.getElementById('inviteLink');
  link.select();
  navigator.clipboard?.writeText(link.value).catch(() => document.execCommand('copy'));
  document.getElementById('copyInviteBtn').textContent = 'Copied!';
  setTimeout(() => document.getElementById('copyInviteBtn').textContent = 'Copy', 2000);
};

document.getElementById('menuBtn').onclick = () => {
  document.getElementById('menuModal').hidden = false;
};

// Modal close
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.onclick = () => document.getElementById(btn.dataset.close).hidden = true;
});
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.onclick = (e) => { if (e.target === backdrop) backdrop.hidden = true; };
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (panelOpen) togglePanel(panelOpen);
    if (codeOpen) toggleCode();
    document.querySelectorAll('.modal-backdrop').forEach(m => m.hidden = true);
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); togglePanel('files'); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); toggleCode(); }
});

setInterval(reportPresence, 10000);

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
