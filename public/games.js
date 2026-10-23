// /app: the game builder's home. Sign in, your games, start a new one, accept an invite (/app/join/<code>).
// Plans and credits are shown only when the user scrolls down or needs them.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };

async function api(path, o = {}) {
  const r = await fetch(path, { method: o.method ?? (o.body ? 'POST' : 'GET'), headers: o.body ? { 'Content-Type': 'application/json' } : {}, body: o.body ? JSON.stringify(o.body) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error || `Request failed (${r.status})`), { status: r.status });
  return b;
}
function track(name, props) { try { window.hawkesAnalytics?.track?.(name, props); } catch {} }

const inviteCode = (/^\/app\/join\/([\w-]+)$/.exec(location.pathname) || [])[1] || null;
let me = null;

// ------------------------------------------------------------------ signing in
function bindAuth() {
  let mode = 'signup';
  const set = (m) => {
    mode = m;
    $('tabSignup').classList.toggle('on', m === 'signup');
    $('tabLogin').classList.toggle('on', m === 'login');
    $('nameWrap').hidden = m !== 'signup';
    $('authSubmit').textContent = m === 'signup' ? 'Create account' : 'Sign in';
    $('password').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
  };
  $('tabSignup').onclick = () => set('signup');
  $('tabLogin').onclick = () => set('login');
  $('google').href = `/auth/google?next=${encodeURIComponent(location.pathname)}`;
  $('authForm').onsubmit = async (e) => {
    e.preventDefault();
    $('authError').hidden = true;
    try {
      const body = { email: $('email').value.trim(), password: $('password').value };
      if (mode === 'signup') body.name = $('name').value.trim();
      await api(mode === 'signup' ? '/v1/users/signup' : '/v1/users/login', { body });
      track(mode === 'signup' ? 'signup' : 'login', { via: 'builder' });
      await load();
    } catch (err) {
      $('authError').textContent = err.message;
      $('authError').hidden = false;
    }
  };
}

// ------------------------------------------------------------------ the page
async function load() {
  try {
    me = (await api('/v1/users/me')).user;
  } catch {
    $('auth').hidden = false;
    $('home').hidden = true;
    $('who').hidden = true;
    if (inviteCode) {
      try {
        const i = await api(`/v1/invites/${inviteCode}`);
        $('authKicker').textContent = 'You are invited';
        $('authTitle').textContent = `Build ${i.game.title} with ${i.from}.`;
        $('authLede').textContent = 'Make a free account (or sign in) to join the game.';
      } catch (e) {
        $('authLede').textContent = e.message;
      }
    }
    return;
  }
  $('auth').hidden = true;
  $('home').hidden = false;
  $('who').hidden = false;
  $('studioLink').hidden = false;
  $('credits').textContent = Number(me.credits).toLocaleString('en-US');
  $('profileAvatar').textContent = (me.name || me.email || '?')[0].toUpperCase();

  // Handle invite first
  if (inviteCode) {
    await loadInvite();
  }

  // Load games — if none, auto-create and jump in
  const r = await api('/v1/games');
  if (!r.games.length && !inviteCode) {
    try {
      const g = await api('/v1/games', { body: { title: 'My Game', template: 'blank' } });
      track('game_create', { template: 'blank', auto: true });
      enterGame(`/app/g/${g.id}`);
      return;
    } catch (err) {
      $('newError').textContent = err.message;
      $('newError').hidden = false;
    }
  }

  renderGames(r);
  renderOverseerGames();
  notices();
  remixFromLink();
  loadFriends().catch(() => {});

  // Plans load in background, shown only if user scrolls or clicks
  loadPlans().catch(() => {});
}

/** Came from a game's Remix button (?remix=<slug>, or ?template=<id> for an Overseer game): make the copy and go in. */
async function remixFromLink() {
  const q = new URLSearchParams(location.search);
  const slug = q.get('remix'), tpl = q.get('template');
  if (!slug && !tpl) return;
  history.replaceState(null, '', location.pathname);
  try {
    const g = tpl
      ? await api('/v1/games', { body: { title: `${OVERSEER_GAMES.find((o) => o.template === tpl)?.title || 'My'} remix`, template: tpl } })
      : await api('/v1/remix', { body: { slug } });
    track('game_remix', { from: tpl ? 'overseer' : 'player' });
    enterGame(`/app/g/${g.id}`, { label: 'REMIXING' });
  } catch (e) { alert(e.message); }
}

function notices() {
  const q = new URLSearchParams(location.search);
  const say = (html) => { const d = document.createElement('div'); d.className = 'notice'; d.innerHTML = `<div>${html}</div><button class="btn btn-ghost btn-sm">Dismiss</button>`; d.querySelector('button').onclick = () => d.remove(); $('notices').appendChild(d); };
  if (q.get('plan') === 'success') { say('<b>Welcome aboard.</b> Your plan is active; this month\'s credits arrive as soon as Stripe confirms the payment (usually seconds).'); $('plansSection').hidden = false; }
  if (q.get('billing') === 'success') { say('<b>Thanks.</b> Your credits are on their way.'); $('plansSection').hidden = false; }
  if (q.get('plan') || q.get('billing')) history.replaceState(null, '', location.pathname);
}

async function loadInvite() {
  if (!inviteCode) return;
  try {
    const i = await api(`/v1/invites/${inviteCode}`);
    $('joinText').innerHTML = `<b>${esc(i.from)}</b> invited you to build <b>${esc(i.game.title)}</b>.`;
    $('joinBox').hidden = false;
    $('joinBtn').onclick = async () => {
      try {
        const g = await api(`/v1/invites/${inviteCode}/accept`, { body: {} });
        track('game_join', {});
        enterGame(`/app/g/${g.id}`);
      } catch (e) {
        $('joinText').textContent = e.message;
      }
    };
  } catch (e) {
    $('joinText').textContent = e.message;
    $('joinBtn').hidden = true;
    $('joinBox').hidden = false;
  }
}

function renderGames(r) {
  const grid = $('gameGrid');
  if (!r.games.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No games yet. Click <b>+ New game</b> to start.</div>';
  } else {
    grid.innerHTML = r.games.map((g) => `
      <div class="game-card" data-id="${g.id}">
        <a href="/app/g/${g.id}" class="cover">${esc(g.title.slice(0, 1).toUpperCase())}</a>
        <div class="body">
          <a href="/app/g/${g.id}" class="title" style="text-decoration:none;color:#fff">${esc(g.title)}</a>
          <div class="meta"><span>${g.playing || g.building ? `● ${g.playing} playing${g.building ? ` · ${g.building} building` : ''}` : 'live'}</span><span>${esc(g.role)}</span><span>${g.members.length} ${g.members.length === 1 ? 'person' : 'people'}</span><span>${ago(g.updated)}</span></div>
          <div class="actions">
            <a class="btn btn-ghost btn-sm" href="/app/g/${g.id}">Open</a>
            <button class="btn btn-ghost btn-sm" data-share="${g.id}" title="Get invite link">Share</button>
            ${g.role === 'owner' ? `<button class="btn btn-ghost btn-sm" style="color:var(--bad)" data-delete="${g.id}" data-title="${esc(g.title)}">Delete</button>` : ''}
          </div>
        </div>
      </div>`).join('');

    for (const btn of grid.querySelectorAll('[data-share]')) {
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const data = await api(`/v1/games/${btn.dataset.share}/invites`, { body: {} });
          const link = location.origin + data.path;
          if (navigator.share) {
            navigator.share({ title: 'Build a game with me', url: link }).catch(() => {});
          } else if (navigator.clipboard) {
            await navigator.clipboard.writeText(link);
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Share'; }, 2000);
          } else {
            prompt('Share this link:', link);
          }
          track('game_share', {});
        } catch (err) { alert(err.message); }
      };
    }

    for (const btn of grid.querySelectorAll('[data-delete]')) {
      btn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const title = btn.dataset.title;
        if (!confirm(`Delete "${title}" permanently?`)) return;
        if (!confirm('Are you sure? This cannot be undone.')) return;
        try {
          await api(`/v1/games/${btn.dataset.delete}`, { method: 'DELETE' });
          track('game_delete', {});
          const fresh = await api('/v1/games');
          renderGames(fresh);
        } catch (err) { alert(err.message); }
      };
    }
  }
}

// ------------------------------------------------------------------ overseer showcase
const OVERSEER_GAMES = [
  {
    id: 'fps-arena', title: 'Bot Arena', emoji: '🎯',
    desc: 'First-person shooter against AI bots. Shows: model generation, physics, skybox, FPS controls.',
    template: 'fps-arena',
  },
  {
    id: 'sky-racer', title: 'Sky Racer', emoji: '🛩️',
    desc: 'Fly through rings in a neon sky. Shows: flight controls, procedural terrain, dynamic skybox, speed trails.',
    template: 'sky-racer',
  },
  {
    id: 'platform-run', title: 'Leap', emoji: '🏃',
    desc: 'First-person platformer with moving platforms. Shows: physics, painting textures, the mirror, level design.',
    template: 'platform-run',
  },
];

function renderOverseerGames() {
  const el = $('overseerGames');
  el.innerHTML = OVERSEER_GAMES.map(g => `
    <div class="game-card overseer-card" data-template="${g.template}">
      <div class="cover" style="background:linear-gradient(135deg, var(--surface-2), var(--surface-3));font-size:48px">${g.emoji}</div>
      <div class="body">
        <div class="title">${esc(g.title)}</div>
        <div class="meta" style="font-family:var(--sans);font-size:12.5px;color:var(--fg-2)">${esc(g.desc)}</div>
        <div class="actions">
          <button class="btn btn-primary btn-sm" data-play-overseer="${g.template}">Play</button>
          <button class="btn btn-secondary btn-sm" data-fork-overseer="${g.template}" title="Make your own copy to change">Remix</button>
        </div>
      </div>
    </div>`).join('');

  for (const btn of el.querySelectorAll('[data-play-overseer]')) {
    btn.onclick = (e) => {
      e.stopPropagation();
      track('overseer_play', { template: btn.dataset.playOverseer });
      enterGame(`/play/t/${btn.dataset.playOverseer}`);
    };
  }

  for (const btn of el.querySelectorAll('[data-fork-overseer]')) {
    btn.onclick = async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      try {
        const tmpl = btn.dataset.forkOverseer;
        const name = OVERSEER_GAMES.find(o => o.template === tmpl)?.title || 'Forked Game';
        const g = await api('/v1/games', { body: { title: `${name} remix`, template: tmpl } });
        track('overseer_fork', { template: tmpl });
        enterGame(`/app/g/${g.id}`);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    };
  }
}

// Quick create: blank game, go straight in
$('quickCreate').onclick = async () => {
  $('quickCreate').disabled = true;
  $('newError').hidden = true;
  try {
    const g = await api('/v1/games', { body: { title: 'Untitled Game', template: 'blank' } });
    track('game_create', { template: 'blank' });
    enterGame(`/app/g/${g.id}`);
  } catch (err) {
    $('newError').textContent = err.message + (err.status === 402 ? ' You need more credits.' : '');
    $('newError').hidden = false;
    if (err.status === 402) $('plansSection').hidden = false;
    $('quickCreate').disabled = false;
  }
};

// ------------------------------------------------------------------ friends
async function loadFriends() {
  try {
    const r = await api('/v1/friends');
    renderFriends(r.friends || []);
  } catch {}
}

function renderFriends(list) {
  const el = $('friendsList');
  if (!list.length) {
    el.innerHTML = '<div class="friends-empty">No friends yet. Invite someone to a game to add them.</div>';
    return;
  }
  const colors = ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316'];
  el.innerHTML = list.map((f) => {
    const hash = (f.id || '').split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
    const color = colors[Math.abs(hash) % colors.length];
    const initial = (f.name || 'A')[0].toUpperCase();
    return `<div class="friend-row">
      <div class="friend-avatar" style="background:${color}">${initial}</div>
      <span class="friend-name">${esc(f.name || 'Someone')}</span>
      <span class="friend-since">${ago(f.created)}</span>
      <button class="btn btn-ghost btn-sm" data-unfriend="${f.id}" data-name="${esc(f.name || 'this friend')}">Remove</button>
    </div>`;
  }).join('');

  for (const btn of el.querySelectorAll('[data-unfriend]')) {
    btn.onclick = async () => {
      if (!confirm(`Remove ${btn.dataset.name} from your friends?`)) return;
      try {
        await api(`/v1/friends/${btn.dataset.unfriend}`, { method: 'DELETE' });
        await loadFriends();
      } catch (err) { alert(err.message); }
    };
  }
}

// ------------------------------------------------------------------ plans and credits
async function loadPlans() {
  const [sub, packs] = await Promise.all([api('/v1/billing/subscription'), api('/v1/billing/packs')]);
  const plans = await api('/v1/plans');
  $('aiCost').textContent = plans.aiCredits;
  const cur = sub.plan;
  $('planChip').textContent = cur.name;
  $('planChip').classList.toggle('free', cur.id === 'free');
  $('planNote').textContent = cur.id === 'free' ? 'Free plan' : `${cur.name}${sub.cancelAtPeriodEnd ? ` · ends ${new Date(sub.periodEnd).toLocaleDateString()}` : sub.periodEnd ? ` · renews ${new Date(sub.periodEnd).toLocaleDateString()}` : ''}${sub.status === 'past_due' ? ' · payment failed, please update your card' : ''}`;
  $('planCards').innerHTML = sub.plans.map((p) => `
    <div class="plan${p.id === cur.id ? ' current' : ''}">
      <span class="label">${esc(p.name)}${p.id === cur.id ? ' · your plan' : ''}</span>
      <div class="price">$${p.priceUsd}<small>${p.priceUsd ? ' / month' : ''}</small></div>
      <ul>
        <li>${p.monthlyCredits ? `<b>${p.monthlyCredits.toLocaleString('en-US')} credits</b> every month` : 'Starter credits to try the AI'}</li>
        <li>Up to ${p.games} games</li>
        <li>Up to ${p.members} people per game</li>
        <li>Live games anyone can play with a link, while you build</li>
      </ul>
      ${p.id === cur.id || p.id === 'free' ? '' : `<button class="btn ${p.priceCents > cur.priceCents ? 'btn-primary' : 'btn-secondary'}" data-plan="${p.id}">${cur.id === 'free' ? `Get ${esc(p.name)}` : p.priceCents > cur.priceCents ? `Upgrade to ${esc(p.name)}` : `Switch to ${esc(p.name)}`}</button>`}
    </div>`).join('');
  for (const b of $('planCards').querySelectorAll('[data-plan]')) b.onclick = () => choose(b.dataset.plan, b);
  const acts = [];
  if (cur.id !== 'free') acts.push(`<button class="btn btn-secondary btn-sm" id="manage">Cards and invoices</button>`);
  if (cur.id !== 'free' && !sub.cancelAtPeriodEnd) acts.push(`<button class="btn btn-ghost btn-sm" id="cancel">Cancel plan</button>`);
  if (sub.cancelAtPeriodEnd) acts.push(`<button class="btn btn-secondary btn-sm" id="resume">Keep my plan</button>`);
  $('planActions').innerHTML = acts.join('');
  if ($('manage')) $('manage').onclick = async () => { try { location.href = (await api('/v1/billing/portal', { body: {} })).url; } catch (e) { billError(e); } };
  if ($('cancel')) $('cancel').onclick = async () => { if (!confirm('Cancel your plan? It stays on until the end of the month you paid for, and your credits stay yours.')) return; try { await api('/v1/billing/cancel', { body: { cancel: true } }); await loadPlans(); } catch (e) { billError(e); } };
  if ($('resume')) $('resume').onclick = async () => { try { await api('/v1/billing/cancel', { body: { cancel: false } }); await loadPlans(); } catch (e) { billError(e); } };
  $('packs').innerHTML = packs.packs.map((p) => `<button class="btn btn-secondary" data-pack="${p.id}">$${p.priceUsd} · ${p.credits.toLocaleString('en-US')} credits</button>`).join('');
  for (const b of $('packs').querySelectorAll('[data-pack]')) b.onclick = async () => {
    try {
      const r = await api('/v1/billing/checkout', { body: { packId: b.dataset.pack, successUrl: `${location.origin}/app?billing=success`, cancelUrl: `${location.origin}/app#plans` } });
      track('checkout_start', { pack: b.dataset.pack });
      location.href = r.url;
    } catch (e) { billError(e); }
  };
}

async function choose(plan, btn) {
  btn.disabled = true;
  try {
    const r = await api('/v1/billing/plan', { body: { plan, successUrl: `${location.origin}/app?plan=success`, cancelUrl: `${location.origin}/app#plans` } });
    track('plan_start', { plan });
    if (r.url) location.href = r.url;
    else { await loadPlans(); me = (await api('/v1/users/me')).user; $('credits').textContent = Number(me.credits).toLocaleString('en-US'); }
  } catch (e) {
    billError(e);
    btn.disabled = false;
  }
}

function billError(e) { $('billError').textContent = e.message; $('billError').hidden = false; }

$('logout').onclick = async () => { await api('/v1/users/logout', { body: {} }).catch(() => {}); location.href = '/'; };

// Profile dropdown
$('profileBtn').onclick = () => {
  const dd = $('profileDropdown');
  dd.hidden = !dd.hidden;
  if (!dd.hidden) renderProfileDropdown();
};
document.addEventListener('click', (e) => {
  const dd = $('profileDropdown');
  if (!dd.hidden && !dd.contains(e.target) && !$('profileBtn').contains(e.target)) dd.hidden = true;
});

function renderProfileDropdown() {
  if (me) {
    $('profileAvatar').textContent = (me.name || me.email || '?')[0].toUpperCase();
    $('profileInfo').innerHTML = `
      <div class="name">${esc(me.name || 'You')}</div>
      <div class="email">${esc(me.email || '')}</div>
      <div class="plan">${Number(me.credits || 0).toLocaleString()} credits</div>
    `;
  }
  api('/v1/friends').then(r => {
    const list = r.friends || [];
    const el = $('profileFriendsMini');
    const colors = ['#4a9eff', '#a855f7', '#34d399', '#fbbf24', '#ef4444', '#f97316'];
    if (!list.length) {
      el.innerHTML = '<div class="profile-friends-head" style="font:500 11px var(--sans);text-transform:uppercase;letter-spacing:.06em;color:var(--fg-3);padding:8px 16px">Friends</div><div style="font:12px var(--sans);color:var(--fg-3);padding:0 16px 8px">No friends yet</div>';
    } else {
      el.innerHTML = `<div style="font:500 11px var(--sans);text-transform:uppercase;letter-spacing:.06em;color:var(--fg-3);padding:8px 16px">Friends (${list.length})</div>` +
        list.slice(0, 5).map(f => {
          const hash = (f.id || '').split('').reduce((a, c) => ((a << 5) - a) + c.charCodeAt(0), 0);
          return `<div style="display:flex;align-items:center;gap:8px;padding:4px 16px;font:13px var(--sans);color:var(--fg-2)"><span style="width:8px;height:8px;border-radius:50%;background:${colors[Math.abs(hash) % colors.length]}"></span>${esc(f.name || 'Someone')}</div>`;
        }).join('') + (list.length > 5 ? `<div style="font:12px var(--sans);color:var(--fg-3);padding:4px 16px">and ${list.length - 5} more</div>` : '');
    }
  }).catch(() => {});
}

bindAuth();
load();
