// /app: the game builder's home. Sign in, your games (and the ones friends invited you to), start a new one from a
// template, accept an invite (/app/join/<code>), and the plan and credits that pay for the AI work.
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
let template = 'collector';

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
  await Promise.all([loadGames(), loadPlans(), loadInvite()]);
  notices();
}

function notices() {
  const q = new URLSearchParams(location.search);
  const say = (html) => { const d = document.createElement('div'); d.className = 'notice'; d.innerHTML = `<div>${html}</div><button class="btn btn-ghost btn-sm">Dismiss</button>`; d.querySelector('button').onclick = () => d.remove(); $('notices').appendChild(d); };
  if (q.get('plan') === 'success') say('<b>Welcome aboard.</b> Your plan is active; this month\'s credits arrive as soon as Stripe confirms the payment (usually seconds).');
  if (q.get('billing') === 'success') say('<b>Thanks.</b> Your credits are on their way.');
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
        location.href = `/app/g/${g.id}`;
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

async function loadGames() {
  const r = await api('/v1/games');
  $('gameCount').textContent = `${r.owned} of ${r.limit} games on your plan`;
  const grid = $('gameGrid');
  if (!r.games.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">No games yet. Pick a starting point below; you can change everything about it.</div>';
  } else {
    grid.innerHTML = r.games.map((g) => `
      <a class="game-card" href="/app/g/${g.id}">
        <div class="cover">${esc(g.title.slice(0, 1).toUpperCase())}</div>
        <div class="body">
          <div class="title">${esc(g.title)}</div>
          <div class="meta"><span>${g.liveVersion ? `v${g.liveVersion} live` : 'not published'}</span><span>${g.members.length} ${g.members.length === 1 ? 'person' : 'people'}</span><span>${ago(g.updated)}</span></div>
          <div class="meta">${g.role === 'owner' ? 'yours' : `with ${esc(g.members.find((m) => m.role === 'owner')?.name ?? '')}`}${g.plays ? ` · ${g.plays} plays` : ''}</div>
        </div>
      </a>`).join('');
  }
  $('templates').innerHTML = r.templates.map((t) => `<button type="button" class="template${t.id === template ? ' on' : ''}" data-id="${t.id}"><b>${esc(t.name)}</b><span>${esc(t.blurb)}</span></button>`).join('');
  for (const b of $('templates').querySelectorAll('.template')) b.onclick = () => { template = b.dataset.id; for (const x of $('templates').children) x.classList.toggle('on', x === b); };
}

$('newForm').onsubmit = async (e) => {
  e.preventDefault();
  $('newError').hidden = true;
  try {
    const g = await api('/v1/games', { body: { title: $('newTitle').value, template } });
    track('game_create', { template });
    location.href = `/app/g/${g.id}`;
  } catch (err) {
    $('newError').innerHTML = esc(err.message) + (err.status === 402 ? ' <a href="#plans">See plans</a>' : '');
    $('newError').hidden = false;
  }
};

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
        <li>Publish and share games with a link</li>
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

bindAuth();
load();
