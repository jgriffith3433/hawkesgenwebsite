// The collaborative game editor: CodeMirror on the left, live preview on the right, AI help below.
/* global CodeMirror marked */
const API = '/v1';
const gameId = /\/app\/g\/(g_[0-9a-f]+)/.exec(location.pathname)?.[1];
if (!gameId) location.replace('/app');

let game = null;
let files = {};
let assets = {};
let members = [];
let me = null;
let connId = null;
let editor = null;
let openPath = null;
let baseRev = null;
let saving = false;
let dirty = false;
let saveTimer = null;
let remoteEditing = new Set();
let sse = null;
let activeTab = 'chat';
let chatHistory = [];
let pendingGens = [];

// ===================================================================== init
(async () => {
  try {
    me = await get('/v1/users/me');
    const data = await get(`${API}/games/${gameId}`);
    game = data.game;
    files = Object.fromEntries(data.files.map(f => [f.path, f]));
    assets = Object.fromEntries(data.assets.map(a => [a.name, a]));
    members = data.members;
    chatHistory = data.chat || [];
    connId = data.connId;

    document.getElementById('gameTitle').value = game.title;
    render();
    connect();
    loadDocs();
    loadSettings();
    renderChat();
    updatePreview();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Failed to load game');
    location.replace('/app');
  }
})();

// ===================================================================== api
async function get(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function del(url) {
  const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

// ===================================================================== render
function render() {
  // Files list
  const filesList = document.getElementById('filesList');
  filesList.innerHTML = '';
  const paths = Object.keys(files).sort();
  for (const p of paths) {
    const f = files[p];
    const div = document.createElement('button');
    div.className = 'ed-item' + (p === openPath ? ' on' : '');
    const icon = p.endsWith('.js') ? '📜' : p.endsWith('.json') ? '{}' : p.endsWith('.md') ? '📝' : '📄';
    div.innerHTML = `<span>${icon}</span><span class="nm">${p}</span><span class="who"></span>`;
    div.onclick = () => openFile(p);

    // Show who's editing
    const whoEl = div.querySelector('.who');
    const editors = Array.from(remoteEditing).filter(u => u.file === p);
    if (editors.length) {
      whoEl.innerHTML = editors.map(u => `<span class="dot" style="background:${avatarColor(u.userId)}" title="${u.userName}"></span>`).join('');
    }

    filesList.appendChild(div);
  }

  // Assets list
  const assetsList = document.getElementById('assetsList');
  assetsList.innerHTML = '';
  const assetNames = Object.keys(assets).sort();
  for (const name of assetNames) {
    const a = assets[name];
    const div = document.createElement('div');
    div.className = 'ed-item';
    const kind = a.mime?.startsWith('image/') ? '🖼' : a.mime?.startsWith('audio/') ? '🔊' : a.kind === 'mesh' ? '📦' : '📎';
    div.innerHTML = `<span>${kind}</span><span class="nm">${name}</span><button class="x" title="Remove">×</button>`;
    div.querySelector('.x').onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove ${name}?`)) return;
      try {
        await post(`${API}/games/${gameId}/assets/${encodeURIComponent(name)}/remove`);
        delete assets[name];
        render();
      } catch (err) { alert(err.message); }
    };
    assetsList.appendChild(div);
  }

  // Presence
  const presenceEl = document.getElementById('presence');
  presenceEl.innerHTML = '';
  const others = members.filter(m => m.id !== me.id);
  for (const m of others.slice(0, 5)) {
    const av = document.createElement('div');
    av.className = 'avatar';
    av.style.background = avatarColor(m.id);
    av.textContent = (m.name || 'A')[0].toUpperCase();
    av.title = m.name;
    presenceEl.appendChild(av);
  }

  // Save state
  setSaveState(dirty ? 'Unsaved' : saving ? 'Saving...' : '');
}

function setSaveState(text) {
  document.getElementById('saveState').textContent = text;
}

function avatarColor(userId) {
  const colors = ['#e07a5f', '#3d5a80', '#81b29a', '#f2cc8f', '#6a4c93', '#f4a261'];
  const hash = userId.split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
  return colors[Math.abs(hash) % colors.length];
}

// ===================================================================== editor
function openFile(path) {
  if (!editor) {
    editor = CodeMirror(document.getElementById('editor'), {
      lineNumbers: true,
      theme: 'neo',
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
    const res = await post(`${API}/games/${gameId}/files`, { path: openPath, content, baseRev, connId });
    files[openPath] = { path: openPath, content, rev: res.rev, updated: res.updated, updated_by: me.id };
    baseRev = res.rev;
    dirty = false;
    saving = false;
    setSaveState('');

    // Refresh preview if we just saved a script or game.json
    if (openPath.endsWith('.js') || openPath === 'game.json') {
      updatePreview();
    }
  } catch (err) {
    saving = false;
    setSaveState('Save failed');
    console.error(err);
    alert(err.message || 'Failed to save');
  }
}

async function reportPresence() {
  if (!connId || !openPath) return;
  try {
    await post(`${API}/games/${gameId}/presence`, { connId, file: openPath, line: editor.getCursor().line });
  } catch {}
}

// ===================================================================== realtime
function connect() {
  if (sse) sse.close();
  sse = new EventSource(`${API}/games/${gameId}/live?connId=${connId}`);

  sse.addEventListener('file', (e) => {
    const data = JSON.parse(e.data);
    files[data.path] = data;

    // If it's the open file and someone else edited it
    if (data.path === openPath && data.updated_by !== me.id) {
      if (dirty) {
        // Conflict: we have unsaved changes
        document.getElementById('conflict').hidden = false;
      } else {
        // Take their changes
        baseRev = data.rev;
        editor.setValue(data.content);
        editor.clearHistory();
      }
    }
    render();
  });

  sse.addEventListener('file-deleted', (e) => {
    const data = JSON.parse(e.data);
    delete files[data.path];
    if (data.path === openPath) {
      openPath = null;
      editor.setValue('');
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
    const data = JSON.parse(e.data);
    remoteEditing = new Set(data.users.filter(u => u.userId !== me.id).map(u => ({ ...u, userName: members.find(m => m.id === u.userId)?.name || 'Someone' })));
    render();
  });

  sse.addEventListener('chat', (e) => {
    const data = JSON.parse(e.data);
    chatHistory.push(data);
    renderChat();
    if (activeTab !== 'chat') {
      document.getElementById('chatUnread').hidden = false;
    }
  });

  sse.addEventListener('gen-update', (e) => {
    const data = JSON.parse(e.data);
    updateGen(data);
  });

  sse.addEventListener('member-join', (e) => {
    const data = JSON.parse(e.data);
    members.push(data);
    render();
  });

  sse.addEventListener('member-leave', (e) => {
    const data = JSON.parse(e.data);
    members = members.filter(m => m.id !== data.userId);
    render();
  });

  sse.onerror = () => {
    console.log('SSE disconnected, reconnecting...');
    setTimeout(connect, 2000);
  };
}

// Conflict resolution
document.getElementById('conflictKeep').onclick = async () => {
  // Force save our version
  dirty = true;
  await saveFile();
  document.getElementById('conflict').hidden = true;
};

document.getElementById('conflictTake').onclick = () => {
  // Take their version
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

  post(`${API}/games/${gameId}/files`, { path, content: '', baseRev: 0, connId }).then(res => {
    files[path] = { path, content: '', rev: res.rev, updated: res.updated, updated_by: me.id };
    render();
    openFile(path);
  }).catch(err => alert(err.message));
};

document.getElementById('renameFileBtn').onclick = () => {
  if (!openPath) return;
  const to = prompt('Rename to:', openPath);
  if (!to || to === openPath) return;

  post(`${API}/games/${gameId}/files/rename`, { from: openPath, to, connId }).then(() => {
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

  del(`${API}/games/${gameId}/files/${encodeURIComponent(openPath)}?connId=${connId}`).then(() => {
    delete files[openPath];
    openPath = null;
    editor.setValue('');
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
  } catch (err) {
    alert(err.message);
  }
};

// ===================================================================== preview
function updatePreview() {
  document.getElementById('preview').src = `/play/_draft?gameId=${gameId}&t=${Date.now()}`;
}

document.getElementById('refreshPreviewBtn').onclick = updatePreview;

window.addEventListener('message', (e) => {
  if (e.data?.source !== 'hawkes-play') return;

  if (e.data.type === 'error') {
    addConsoleMessage(e.data.message, e.data.file, e.data.line, 'err');
  } else if (e.data.type === 'log') {
    addConsoleMessage(e.data.message, null, null, '');
  }
});

function addConsoleMessage(text, file, line, cls) {
  const con = document.getElementById('consolePane');
  const div = document.createElement('div');
  div.className = cls;
  if (file && line) {
    div.innerHTML = `<span class="ln" data-file="${file}" data-line="${line}">${file}:${line}</span>: ${text}`;
    div.querySelector('.ln').onclick = () => {
      if (files[file]) openFile(file);
    };
  } else {
    div.textContent = text;
  }
  con.appendChild(div);
  con.scrollTop = con.scrollHeight;

  const count = document.getElementById('consoleCount');
  const n = (parseInt(count.textContent) || 0) + 1;
  count.textContent = n;
  count.hidden = false;
}

// ===================================================================== chat
function renderChat() {
  const log = document.getElementById('chatLog');
  log.innerHTML = '';

  for (const msg of chatHistory) {
    const div = document.createElement('div');
    div.className = `msg ${msg.role === 'user' ? 'user' : msg.role === 'system' ? 'system' : 'ai'}`;

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = msg.role === 'user' ? (members.find(m => m.id === msg.user_id)?.name || 'You') : msg.role === 'system' ? 'System' : 'AI';
    div.appendChild(who);

    const text = document.createElement('div');
    text.className = 'text';
    text.textContent = msg.text;
    div.appendChild(text);

    // Asset suggestions
    if (msg.data?.suggestions) {
      for (let i = 0; i < msg.data.suggestions.length; i++) {
        const s = msg.data.suggestions[i];
        if (s.taskId) {
          const sugg = document.createElement('div');
          sugg.className = 'sugg';
          sugg.innerHTML = `<span class="grow">${s.kind}: ${s.prompt.slice(0, 80)}</span><span class="thinking">Generating...</span>`;
          div.appendChild(sugg);
        }
      }
    }

    log.appendChild(div);
  }

  log.scrollTop = log.scrollHeight;
}

document.getElementById('sendChatBtn').onclick = async () => {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.disabled = true;

  try {
    const res = await post(`${API}/games/${gameId}/chat`, { message: text, file: openPath });
    chatHistory.push({ role: 'user', text, user_id: me.id });
    chatHistory.push(res.reply);
    renderChat();

    if (res.reply.data?.suggestions) {
      for (const s of res.reply.data.suggestions) {
        if (s.taskId) {
          pendingGens.push(s);
          renderGens();
        }
      }
    }
  } catch (err) {
    alert(err.message);
  } finally {
    input.disabled = false;
    input.focus();
  }
};

document.getElementById('chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    document.getElementById('sendChatBtn').click();
  }
});

async function loadAICost() {
  try {
    const data = await get(`${API}/plans`);
    document.getElementById('chatCost').textContent = `${data.aiCredits} credits per message`;
  } catch {}
}
loadAICost();

// ===================================================================== gens
function renderGens() {
  const list = document.getElementById('gensList');
  list.innerHTML = '';

  for (const g of pendingGens) {
    const div = document.createElement('div');
    div.className = 'gen-row' + (g.status === 'failed' ? ' failed' : '');
    div.textContent = g.status === 'completed' ? `✓ ${g.name}` : g.status === 'failed' ? `✗ ${g.kind} failed` : `⏳ ${g.kind}...`;
    list.appendChild(div);
  }
}

function updateGen(data) {
  const g = pendingGens.find(p => p.taskId === data.taskId);
  if (!g) return;

  Object.assign(g, data);
  renderGens();

  if (data.status === 'completed' && data.name) {
    // Asset was added
    assets[data.name] = { name: data.name, asset: data.asset, kind: data.kind };
    render();
  }
}

// ===================================================================== tabs
document.querySelectorAll('.ed-tab').forEach(tab => {
  tab.onclick = () => {
    const t = tab.dataset.tab;
    document.querySelectorAll('.ed-tab').forEach(x => x.classList.remove('on'));
    tab.classList.add('on');
    document.querySelectorAll('.ed-pane').forEach(p => p.hidden = true);
    document.getElementById(t + 'Pane').hidden = false;
    activeTab = t;

    if (t === 'chat') {
      document.getElementById('chatUnread').hidden = true;
    } else if (t === 'console') {
      document.getElementById('consoleCount').hidden = true;
    }
  };
});

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
  document.getElementById('descInput').value = game.description;
  document.querySelectorAll('[data-vis]').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.vis === game.visibility);
    btn.onclick = () => {
      document.querySelectorAll('[data-vis]').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
    };
  });
  document.getElementById('coverInput').value = game.cover || '';

  // Members
  const membersList = document.getElementById('membersList');
  membersList.innerHTML = '';
  for (const m of members) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--rule);';
    div.innerHTML = `<span style="flex:1">${m.name}</span><span class="label">${m.role}</span>`;
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

  // Show delete button if owner
  document.getElementById('deleteGameBtn').hidden = game.owner_id !== me.id;

  // Load releases
  loadReleases();
}

async function loadReleases() {
  try {
    const data = await get(`${API}/games/${gameId}/releases`);
    const list = document.getElementById('releasesList');
    list.innerHTML = '';

    for (const r of data.releases) {
      const div = document.createElement('div');
      div.className = 'release';
      div.innerHTML = `
        <span class="v">v${r.version}</span>
        ${r.version === game.live_version ? '<span class="live">LIVE</span>' : ''}
        <span class="grow muted" style="font-size:12px">${r.notes || 'No notes'}</span>
      `;
      if (r.version !== game.live_version && game.role === 'owner') {
        const btn = document.createElement('button');
        btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = 'Set live';
        btn.onclick = async () => {
          try {
            await post(`${API}/games/${gameId}/live`, { version: r.version });
            game.live_version = r.version;
            loadReleases();
          } catch (err) { alert(err.message); }
        };
        div.appendChild(btn);
      }
      list.appendChild(div);
    }
  } catch {}
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
    alert('Saved');
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('publishBtn').onclick = async () => {
  const notes = document.getElementById('releaseNotes').value.trim();
  try {
    await post(`${API}/games/${gameId}/publish`, { notes });
    document.getElementById('releaseNotes').value = '';
    loadReleases();
    alert('Published!');
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('leaveBtn').onclick = () => {
  if (confirm('Leave this game?')) {
    location.href = '/app';
  }
};

document.getElementById('deleteGameBtn').onclick = async () => {
  if (!confirm(`Delete "${game.title}" permanently?`)) return;
  if (!confirm('Are you sure? This cannot be undone.')) return;
  try {
    await del(`${API}/games/${gameId}`);
    location.href = '/app';
  } catch (err) {
    alert(err.message);
  }
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
    const data = await post(`${API}/games/${gameId}/invite`);
    document.getElementById('inviteLink').value = location.origin + data.url;
    document.getElementById('inviteModal').hidden = false;
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('copyInviteBtn').onclick = () => {
  document.getElementById('inviteLink').select();
  document.execCommand('copy');
  document.getElementById('copyInviteBtn').textContent = 'Copied!';
  setTimeout(() => {
    document.getElementById('copyInviteBtn').textContent = 'Copy';
  }, 2000);
};

document.getElementById('menuBtn').onclick = () => {
  document.getElementById('menuModal').hidden = false;
};

// Modal close buttons
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.onclick = () => {
    document.getElementById(btn.dataset.close).hidden = true;
  };
});

document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  };
});

// Report presence periodically
setInterval(reportPresence, 10000);

// Open first file by default
if (Object.keys(files).length > 0) {
  const first = Object.keys(files).sort()[0];
  openFile(first);
}
