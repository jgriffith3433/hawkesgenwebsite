// Public gallery: browse and play games people made.
const API = '/v1';
let games = [];
let sort = 'popular';

// ===================================================================== load
(async () => {
  loadGames();
  setupAuth();
})();

async function loadGames() {
  try {
    const data = await get(`${API}/gallery?sort=${sort}`);
    games = data.games || [];
    render();
  } catch (err) {
    console.error(err);
  }
}

function render() {
  const grid = document.getElementById('gameGrid');
  const empty = document.getElementById('empty');

  if (!games.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  grid.innerHTML = '';

  for (const g of games) {
    const card = document.createElement('a');
    card.className = 'game-card';
    card.href = '#';
    card.onclick = (e) => {
      e.preventDefault();
      playGame(g);
    };

    const cover = document.createElement('div');
    cover.className = 'cover';
    if (g.cover) {
      const img = document.createElement('img');
      img.src = g.cover;
      img.alt = g.title;
      cover.appendChild(img);
    } else {
      cover.textContent = g.title[0].toUpperCase();
    }
    card.appendChild(cover);

    const body = document.createElement('div');
    body.className = 'body';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = g.title;
    body.appendChild(title);

    if (g.description) {
      const desc = document.createElement('div');
      desc.className = 'muted';
      desc.style.fontSize = '13px';
      desc.style.lineHeight = '1.4';
      desc.textContent = g.description.slice(0, 100) + (g.description.length > 100 ? '...' : '');
      body.appendChild(desc);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `
      <span>by ${escapeHtml(g.ownerName)}</span>
      <span>▸ ${g.plays || 0}</span>
    `;
    body.appendChild(meta);

    card.appendChild(body);
    grid.appendChild(card);
  }
}

function playGame(g) {
  document.getElementById('playTitle').textContent = g.title;
  document.getElementById('playAuthor').textContent = `by ${g.ownerName}`;
  document.getElementById('playAuthor').href = '#'; // Could link to profile later
  document.getElementById('playFrame').src = `/play/${g.slug}`;
  document.getElementById('playModal').hidden = false;
}

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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
