// /profile: who you are here. Read only: your look (the mirror's result), your worlds, your credits and your plan.
// Credits and plans are only read (/v1/users/me, /v1/billing/subscription); buying stays on /credits.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Number(v || 0).toLocaleString('en-US');
const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const HEX = /^#[0-9a-f]{6}$/i;
const hex = (c, d) => (typeof c === 'string' && HEX.test(c) ? c : d);

async function api(path) {
  const r = await fetch(path);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error || `Request failed (${r.status})`), { status: r.status });
  return b;
}
const orNull = (p) => p.catch(() => null);

function avatarHtml(a, name) {
  if (!a) return `<span class="letter">${esc((name || '?')[0].toUpperCase())}</span>`;
  return `<span class="fig" style="background:${hex(a.body, '#4a9eff')}"><i style="background:${hex(a.head, '#f2c9a0')}"></i></span>`;
}
const empty = (title, text, href, label) => `<div class="pf-empty"><h3>${esc(title)}</h3><p>${esc(text)}</p><a class="btn btn-primary btn-sm" href="${href}">${esc(label)}</a></div>`;

async function start() {
  const me = (await orNull(api('/v1/users/me?soft=1')))?.user;
  if (!me) { $('gate').hidden = false; $('pfMain').dataset.state = 'signed-out'; window.hgProfileReady = true; return; }
  const [av, games, sub, friends] = await Promise.all([orNull(api('/v1/users/me/avatar')), orNull(api('/v1/games')), orNull(api('/v1/billing/subscription')), orNull(api('/v1/friends'))]);
  $('page').hidden = false;

  const avatar = av?.avatar || null;
  const name = avatar?.name || me.name || 'You';
  $('avatar').innerHTML = avatarHtml(avatar, name);
  $('name').textContent = name;
  $('sub').textContent = [avatar?.what ? `a ${avatar.what}` : '', me.email].filter(Boolean).join(' · ');
  const plan = sub?.plan;
  const free = !plan || plan.id === 'free';
  $('chips').innerHTML = `<span class="plan-chip${free ? ' free' : ''}">${esc(plan?.name || 'Free')}</span>` +
    (avatar ? '<a class="btn btn-ghost btn-sm" href="/play/sandbox">Change my look</a>' : '');
  if (!avatar) {
    $('chips').insertAdjacentHTML('beforeend', '<span class="muted" style="font-size:13px">You have not met the mirror yet. Play, and it will ask who you are.</span><a class="btn btn-primary btn-sm" href="/play/sandbox">Meet the mirror</a>');
  }

  const list = games?.games || [];
  const planLine = free ? 'Free plan' : `${plan.name}${sub.cancelAtPeriodEnd ? `, ends ${day(sub.periodEnd)}` : sub.periodEnd ? `, renews ${day(sub.periodEnd)}` : ''}`;
  $('stats').innerHTML = `
    <div class="pf-stat"><b>${n(me.credits)}</b><span class="k">credits</span><a class="act btn btn-secondary btn-sm" href="/credits">${Number(me.credits) > 0 ? 'Top up' : 'Get credits'}</a></div>
    <div class="pf-stat"><b>${esc(plan?.name || 'Free')}</b><span class="k">${esc(planLine)}</span><a class="act btn btn-secondary btn-sm" href="${free ? '/home#pricing' : '/credits'}">${free ? 'See plans' : 'Manage plan'}</a></div>
    <div class="pf-stat"><b>${n(list.length)}</b><span class="k">${list.length === 1 ? 'world' : 'worlds'}</span></div>`;

  $('worlds').innerHTML = list.length
    ? `<div class="game-grid">${list.map((g) => `<a class="game-card" href="/app/g/${esc(g.id)}"><div class="cover">${g.cover ? `<img src="${esc(g.cover)}" alt="" loading="lazy">` : esc((g.title || '?')[0].toUpperCase())}</div><div class="body"><div class="title">${esc(g.title)}</div><div class="meta"><span>${esc(g.role || 'player')}</span><span>${n(g.plays)} plays</span></div></div></a>`).join('')}</div>`
    : empty('No worlds yet', 'Start one and talk to the Overseer: tell it what you want and watch it appear.', '/app', 'Start a world');

  const fl = friends?.friends || [];
  $('friends').innerHTML = fl.length
    ? fl.slice(0, 12).map((f) => `<div class="pf-friend"><span class="dot"></span>${esc(f.name || 'Someone')}</div>`).join('')
    : empty('No friends yet', 'Invite someone to a world and they are added as your friend.', '/app', 'Open your worlds');

  $('pfMain').dataset.state = 'ready';
  window.hgProfileReady = true;
}
start().catch((e) => { $('gate').hidden = false; $('pfMain').dataset.state = 'error'; console.warn(e); window.hgProfileReady = true; });
