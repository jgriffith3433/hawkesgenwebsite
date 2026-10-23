// Public gallery: browse and play games people made.
const API = '/v1';
let games = [];
let sort = 'live';

// ===================================================================== load
let me = null;
(async () => {
  me = await get(`${API}/users/me`).then((r) => r.user).catch(() => null);
  setupAuth();
  loadGames();
})();

async function loadGames() {
  try {
    const data = await get(`${API}/gallery?sort=${sort}`);
    games = data.games || [];
    renderFeatured(data.featured || []);
    render();
  } catch (err) {
    console.error(err);
  }
}

function card({ title, sub, by, plays, cover, emoji, play, remix, playing = 0, building = 0, visitors }) {
  const el = document.createElement('div');
  el.className = 'game-card';
  el.innerHTML = `
    <div class="cover">${cover ? `<img src="${escapeHtml(cover)}" alt="">` : escapeHtml(emoji || (title[0] || '?').toUpperCase())}${playing || building ? `<span class="live-now"><i></i>${playing ? `${playing} playing` : ''}${playing && building ? ' · ' : ''}${building ? `${building} building` : ''}</span>` : ''}${visitors === 'build' ? '<span class="open-build">Open to builders</span>' : ''}</div>
    <div class="body">
      <div class="title">${escapeHtml(title)}</div>
      ${sub ? `<div class="muted" style="font-size:13px;line-height:1.4">${escapeHtml(sub.slice(0, 110))}${sub.length > 110 ? '…' : ''}</div>` : ''}
      ${by || plays !== undefined ? `<div class="meta">${by ? `<span>by ${escapeHtml(by)}</span>` : ''}${plays !== undefined ? `<span>▸ ${plays} plays</span>` : ''}</div>` : ''}
      <div class="actions"><button type="button" class="btn btn-primary btn-sm" data-a="play">Play</button><button type="button" class="btn btn-secondary btn-sm" data-a="remix" title="Make your own copy to change">Remix</button></div>
    </div>`;
  el.querySelector('[data-a="play"]').onclick = play;
  el.querySelector('.cover').onclick = play;
  el.querySelector('[data-a="remix"]').onclick = remix;
  return el;
}

function renderFeatured(list) {
  const grid = document.getElementById('featuredGrid');
  grid.innerHTML = '';
  document.getElementById('featuredHead').hidden = !list.length;
  for (const t of list) grid.appendChild(card({ title: t.name, sub: t.blurb, by: 'the Overseer', emoji: t.emoji, playing: t.playing, building: t.building, play: () => enterGame(t.url), remix: () => remixIt({ template: t.id, title: t.name }) }));
  for (const c of grid.querySelectorAll('.game-card')) c.classList.add('overseer-card');
}

function render() {
  const grid = document.getElementById('gameGrid');
  const empty = document.getElementById('empty');
  grid.innerHTML = '';
  empty.hidden = Boolean(games.length);
  for (const g of games) grid.appendChild(card({ title: g.title, sub: g.description, by: g.by, plays: g.plays || 0, cover: g.cover, playing: g.playing, building: g.building, visitors: g.visitors, play: () => enterGame(g.url), remix: () => remixIt({ slug: g.slug }) }));
}

/** A copy of a game, yours to change: then straight into it. */
async function remixIt(what) {
  if (!me) { pendingRemix = what; openAuth('signup'); return; }
  try {
    const g = what.template
      ? await post(`${API}/games`, { title: `${what.title} remix`, template: what.template })
      : await post(`${API}/remix`, { slug: what.slug });
    enterGame(`/app/g/${g.id}`, { label: 'REMIXING' });
  } catch (err) { alert(err.message); }
}
let pendingRemix = null;

// ===================================================================== sort
document.querySelectorAll('[data-sort]').forEach(btn => {
  btn.onclick = () => {
    sort = btn.dataset.sort;
    document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    loadGames();
  };
});

// ===================================================================== auth
function setupAuth() {
  document.querySelectorAll('[data-open-auth]').forEach(btn => {
    btn.onclick = (e) => {
      // Signed in already: the link just goes to your games.
      if (me) return;
      e.preventDefault();
      const mode = btn.dataset.openAuth || 'signup';
      openAuth(mode);
    };
  });

  document.getElementById('tabSignup').onclick = () => openAuth('signup');
  document.getElementById('tabLogin').onclick = () => openAuth('login');

  document.getElementById('authForm').onsubmit = async (e) => {
    e.preventDefault();

    const mode = document.getElementById('tabSignup').classList.contains('on') ? 'signup' : 'login';
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const name = document.getElementById('name').value;

    const errorEl = document.getElementById('authError');
    errorEl.hidden = true;

    try {
      const body = mode === 'signup' ? { email, password, name } : { email, password };
      const res = await fetch(`${API}/users/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Authentication failed');
      }

      if (pendingRemix) { me = (await get(`${API}/users/me`)).user; document.getElementById('authModal').hidden = true; return remixIt(pendingRemix); }
      location.href = '/app';
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    }
  };
}

function openAuth(mode) {
  const modal = document.getElementById('authModal');
  const nameWrap = document.getElementById('nameWrap');
  const submitBtn = document.getElementById('authSubmit');

  document.getElementById('tabSignup').classList.toggle('on', mode === 'signup');
  document.getElementById('tabLogin').classList.toggle('on', mode === 'login');

  nameWrap.hidden = mode !== 'signup';
  submitBtn.textContent = mode === 'signup' ? 'Create account' : 'Sign in';

  modal.hidden = false;
}

// Modal close
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

// ===================================================================== utils
async function get(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || res.statusText);
  return out;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}
