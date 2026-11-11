// Public gallery: browse and play games people made.
const API = '/v1';

import { coverCard, attachPreviews } from '/store-ui.js';
// ===================================================================== load
let me = null;
(async () => {
  me = await get(`${API}/users/me?soft=1`).then((r) => r.user).catch(() => null);
  setupAuth();
})();
const rows = { original: [], overseer: [] };
let players = [];

// One load per page view: no timers. Live counts, when the server knows them, arrive with it.
(async () => {
  const [cat, gal] = await Promise.all([get(`${API}/catalogue`).catch(() => ({ games: [] })), get(`${API}/gallery?sort=popular`).catch(() => ({ games: [], featured: [] }))]);
  for (const g of cat.games || []) rows[g.row === 'overseer' ? 'overseer' : 'original'].push(g);
  players = gal.games || [];
  const known = gal.liveKnown === true;
  const liveOf = (p, b) => (known && (p || b) ? [p && `${p} playing`, b && `${b} building`].filter(Boolean).join(' · ') : '');
  const fed = new Map((gal.featured || []).map((f) => [f.id, f]));
  for (const key of ['original', 'overseer']) {
    const box = document.querySelector(`[data-row="${key}"]`);
    rows[key].forEach((g, i) => { const f = fed.get(g.id); box.append(coverCard(g, i, { live: f ? liveOf(f.playing, f.building) : '' })); });
  }
  const pbox = document.querySelector('[data-row="players"]');
  players.forEach((g, i) => {
    const el = coverCard({ id: g.slug, name: g.title, hook: g.description || (g.by ? `by ${g.by}` : ''), genres: g.by ? [`by ${g.by}`] : [], cover: g.cover }, i + 3, { href: g.url, live: liveOf(g.playing, g.building) });
    pbox.append(el);
  });
  document.getElementById('empty').hidden = players.length > 0;
  const total = known ? [...fed.values(), ...players].reduce((n, g) => n + (g.playing || 0), 0) : 0;
  document.getElementById('liveCount').textContent = total ? `${total} ${total === 1 ? 'person is' : 'people are'} playing right now.` : '';
  attachPreviews(document);
})();

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
}

// Google only (no email and password).
function openAuth(mode) {
  const google = document.getElementById('google');
  google.href = '/auth/google?next=/app';
  document.getElementById('authTitle').textContent = mode === 'login' ? 'Sign in' : 'Build games with friends and AI.';
  document.getElementById('authModal').hidden = false;
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
