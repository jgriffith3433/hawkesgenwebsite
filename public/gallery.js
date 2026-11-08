// Public gallery: browse and play games people made.
const API = '/v1';
let games = [];
let sort = 'live';

// ===================================================================== load
let me = null;
(async () => {
  me = await get(`${API}/users/me?soft=1`).then((r) => r.user).catch(() => null);
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

function card({ title, sub, by, plays, cover, emoji, play, spectate, remix, report, playing = 0, building = 0, visitors }) {
  const el = document.createElement('div');
  el.className = 'game-card';
  el.innerHTML = `
    <div class="cover">${cover ? `<img src="${escapeHtml(cover)}" alt="">` : escapeHtml(emoji || (title[0] || '?').toUpperCase())}${playing || building ? `<span class="live-now"><i></i>${playing ? `${playing} playing` : ''}${playing && building ? ' · ' : ''}${building ? `${building} building` : ''}</span>` : ''}${visitors === 'build' ? '<span class="open-build">Open to builders</span>' : ''}</div>
    <div class="body">
      <div class="title">${escapeHtml(title)}</div>
      ${sub ? `<div class="muted" style="font-size:13px;line-height:1.4">${escapeHtml(sub.slice(0, 110))}${sub.length > 110 ? '…' : ''}</div>` : ''}
      ${by || plays !== undefined ? `<div class="meta">${by ? `<span>by ${escapeHtml(by)}</span>` : ''}${plays !== undefined ? `<span>▸ ${plays} plays</span>` : ''}</div>` : ''}
      <div class="actions"><button type="button" class="btn btn-primary btn-sm" data-a="play">${playing ? `Join (${playing} playing)` : 'Play'}</button>${spectate ? '<button type="button" class="btn btn-secondary btn-sm" data-a="spectate" title="Float over the world as a camera, no character">Spectate</button>' : ''}<button type="button" class="btn btn-secondary btn-sm" data-a="remix" title="Make your own copy to change">Remix</button>${report ? '<button type="button" class="btn btn-ghost btn-sm" data-a="report" title="Tell us this world is broken, scary, rude or a scam">Report</button>' : ''}</div>
    </div>`;
  if (report) el.querySelector('[data-a="report"]').onclick = report;
  el.querySelector('[data-a="play"]').onclick = play;
  el.querySelector('.cover').onclick = play;
  if (spectate) el.querySelector('[data-a="spectate"]').onclick = spectate;
  el.querySelector('[data-a="remix"]').onclick = remix;
  return el;
}

const HUES = [205, 160, 285, 30, 340];

/** A featured game as a planet: its cover (or its emoji on a world of its own colour) cropped round, with an atmosphere. */
function renderFeatured(list) {
  const grid = document.getElementById('featuredGrid');
  grid.innerHTML = '';
  grid.hidden = !list.length;
  list.forEach((t, i) => {
    const el = document.createElement('div');
    el.className = 'planet-wrap';
    el.style.setProperty('--i', i);
    el.style.setProperty('--hue', HUES[i % HUES.length]);
    const live = (t.playing ? `${t.playing} playing` : '') + (t.playing && t.building ? ' · ' : '') + (t.building ? `${t.building} building` : '');
    el.innerHTML = `
      <div class="orbit"><button type="button" class="planet" data-a="play" aria-label="Play ${escapeHtml(t.name)}">${t.cover ? `<img src="${escapeHtml(t.cover)}" alt="">` : `<span class="glyph">${escapeHtml(t.emoji || (t.name[0] || '?').toUpperCase())}</span>`}<i class="rim"></i></button></div>
      <div class="planet-name">${escapeHtml(t.name)}</div>
      <div class="planet-live">${live ? `<span class="live-now"><i></i>${live}</span>` : '<span class="planet-by">by the Overseer</span>'}</div>
      <div class="planet-blurb">${escapeHtml((t.blurb || '').slice(0, 90))}${(t.blurb || '').length > 90 ? '…' : ''}</div>
      <div class="actions"><button type="button" class="btn btn-play btn-sm" data-a="play">Play</button>${t.remix === false ? '' : '<button type="button" class="btn btn-ghostlight btn-sm" data-a="remix" title="Make your own copy to change">Remix</button>'}</div>`;
    for (const b of el.querySelectorAll('[data-a="play"]')) b.onclick = () => enterGame(t.url);
    const rb = el.querySelector('[data-a="remix"]');
    if (rb) rb.onclick = () => remixIt({ template: t.id, title: t.name });
    grid.appendChild(el);
  });
  const playing = list.reduce((n, t) => n + (t.playing || 0), 0) + games.reduce((n, g) => n + (g.playing || 0), 0);
  document.getElementById('liveCount').textContent = playing ? `${playing} ${playing === 1 ? 'person is' : 'people are'} playing right now.` : '';
}

function render() {
  const grid = document.getElementById('gameGrid');
  const empty = document.getElementById('empty');
  grid.innerHTML = '';
  empty.hidden = Boolean(games.length);
  for (const g of games) grid.appendChild(card({ title: g.title, sub: g.description, by: g.by, plays: g.plays || 0, cover: g.cover, playing: g.playing, building: g.building, visitors: g.visitors, play: () => enterGame(g.url), spectate: g.visitors === 'play' || g.visitors === 'build' ? () => enterGame(`${g.url}?spectate=1`, { label: 'WATCHING' }) : null, remix: () => remixIt({ slug: g.slug }), report: () => reportWorld(g) }));
}

const REASONS = [['broken', 'Broken'], ['scary', 'Scary or rude'], ['scam', 'Scam'], ['other', 'Other']];

/** Report a world: pick why (and say more if you like). Signed in or not; an admin looks and can close it. */
function reportWorld(g) {
  const d = document.createElement('dialog');
  d.className = 'report-dialog';
  d.style.cssText = 'border:1px solid #d6dbe6;border-radius:12px;padding:20px;max-width:380px;width:calc(100% - 32px);font:14px/1.45 Inter,system-ui,sans-serif;color:#121826';
  d.innerHTML = `<form method="dialog"><h3 style="margin:0 0 4px;font-size:18px">Report ${escapeHtml(g.title)}</h3><p class="muted" style="margin:0 0 12px">What is wrong with this world?</p>${REASONS.map(([v, l], i) => `<label style="display:block;padding:4px 0"><input type="radio" name="reason" value="${v}"${i === 0 ? ' checked' : ''}> ${l}</label>`).join('')}<textarea name="note" maxlength="500" rows="3" placeholder="Anything else we should know? (optional)" style="width:100%;box-sizing:border-box;margin:10px 0;font:inherit"></textarea><p class="muted" data-say style="margin:0 0 10px" role="status"></p><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-ghost btn-sm" data-a="cancel">Cancel</button><button type="submit" class="btn btn-primary btn-sm" data-a="send">Send report</button></div></form>`;
  document.body.appendChild(d);
  const say = d.querySelector('[data-say]');
  d.querySelector('[data-a="cancel"]').onclick = () => d.close();
  d.addEventListener('close', () => d.remove());
  d.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await fetch(`/v1/play/${encodeURIComponent(g.slug)}/report`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ reason: f.get('reason'), note: f.get('note') }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send that');
      say.textContent = 'Thank you. We will look at it.';
      d.querySelector('[data-a="send"]').hidden = true;
      d.querySelector('[data-a="cancel"]').textContent = 'Close';
    } catch (err) { say.textContent = err.message; }
  };
  d.showModal();
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

// The live counts, fresh every 30 s (not while the tab is hidden).
setInterval(() => { if (!document.hidden) loadGames(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadGames(); });

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
}

// Google only (no email and password). A remix asked for while signed out: back here after Google, to pick it again.
function openAuth(mode) {
  const google = document.getElementById('google');
  google.href = `/auth/google?next=${encodeURIComponent(pendingRemix ? location.pathname + location.search : '/app')}`;
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
