// The admin page: overview, accounts (with ledger, jobs and actions), jobs, purchases. Everything comes from
// /v1/admin/*, which answers only admins: a Google sign-in on PORTAL_ADMIN_EMAILS (cloud accounts.ts adminFrom); roles
// are not set here.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const n = (v) => Number(v || 0).toLocaleString('en-US');
const usd = (cents) => `$${(Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const day = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `Error ${r.status}`), { status: r.status });
  return data;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}

// ---------------------------------------------------------------- sign-in
async function start() {
  const me = await api('/v1/users/me?soft=1').catch(() => null);
  if (me?.user?.role !== 'admin') {
    $('gate').hidden = false;
    if (me?.user) {
      $('gError').textContent = `${me.user.email} is not an admin.`;
      $('gError').hidden = false;
    }
    return;
  }
  $('whoEmail').textContent = me.user.email;
  $('who').hidden = false;
  $('admin').hidden = false;
  show(location.hash.slice(1) || 'overview');
}

// Signing in is Google only: the gate's one button (google-gate.js adds the referral, not that an admin needs it).
$('gateForm').addEventListener('submit', (e) => e.preventDefault());
$('signOut').addEventListener('click', async () => { await api('/v1/users/logout', {}).catch(() => {}); location.href = '/home'; });

// ---------------------------------------------------------------- tabs
function show(tab) {
  if (!['overview', 'accounts', 'jobs', 'purchases', 'reports'].includes(tab)) tab = 'overview';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
  history.replaceState(null, '', `#${tab}`);
  ({ overview, accounts, jobs, purchases, reports })[tab]();
}
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));

async function overview() {
  const o = await api('/v1/admin/overview');
  const j = o.jobs24h || {};
  const stat = (label, value, sub = '') => `<div class="stat"><div class="label">${label}</div><div class="v">${value}</div><div class="s">${sub}</div></div>`;
  $('stats').innerHTML = [
    stat('Revenue, 30 days', usd(o.revenue.cents30d), `${n(o.revenue.purchases30d)} purchases · ${usd(o.revenue.centsAll)} all time`),
    stat('Accounts', n(o.accounts.total), `${n(o.accounts.new7d)} new this week · ${n(o.accounts.disabled)} disabled`),
    stat('Active this week', n(o.accounts.active7d), 'signed in in the last 7 days'),
    stat('Credits held', n(o.credits.outstanding), `${usd(o.credits.outstanding)} owed in work`),
    stat('Credits spent, 30 days', n(o.credits.spent30d), `${n(o.credits.granted30d)} given free`),
    stat('Jobs, 24 hours', n(Object.values(j).reduce((a, b) => a + b, 0)), `${n(j.done)} done · ${n(j.failed)} failed · ${n((j.queued || 0) + (j.running || 0))} going`),
  ].join('');
}

// ---------------------------------------------------------------- accounts
let selected = null;
async function accounts() {
  const q = $('search').value.trim();
  const r = await api(`/v1/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  $('accounts').querySelector('tbody').innerHTML = r.items.map((u) => `
    <tr class="click${u.id === selected ? ' sel' : ''}" data-id="${esc(u.id)}">
      <td><div>${esc(u.email)}${u.role === 'admin' ? ' <span class="tool-tag acc">admin</span>' : ''}${u.disabled ? ' <span class="tool-tag neg">disabled</span>' : ''}</div><div class="sub">${esc(u.name || '')}${u.source ? ` · from ${esc(u.source)}` : ''}</div></td>
      <td>${planTag(u.plan, u.sub_status)}</td>
      <td class="num">${n(u.credits)}</td><td class="num">${n(u.bought)}</td><td class="num">${n(u.spent)}</td><td class="num">${n(u.jobs)}</td><td class="num">${n(u.games)}</td>
      <td>${day(u.created)}</td><td>${day(u.last_login)}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="muted">No accounts match.</td></tr>';
  $('accountsMore').textContent = r.total > r.items.length ? `Showing ${r.items.length} of ${n(r.total)}. Search to narrow it down.` : `${n(r.total)} accounts`;
  $('accounts').querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => detail(tr.dataset.id)));
  if (selected) detail(selected);
}
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); accounts(); });

/** A plan as a tag: free, or the plan with its subscription state when that isn't simply active. */
function planTag(plan, status) {
  if (!plan || plan === 'free') return '<span class="tool-tag">free</span>';
  const ok = ['active', 'trialing'].includes(status);
  return `<span class="tool-tag ${ok ? 'pos' : 'warn'}">${esc(plan)}${status && status !== 'active' ? ` · ${esc(status)}` : ''}</span>`;
}
const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  return s < 90 ? 'just now' : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
const table = (head, body, empty) => (body.length ? `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body.join('')}</tbody></table>` : `<div class="muted" style="font-size:13px">${empty}</div>`);

async function detail(id) {
  selected = id;
  document.querySelectorAll('#accounts tr.click').forEach((tr) => tr.classList.toggle('sel', tr.dataset.id === id));
  const d = await api(`/v1/admin/users/${id}`);
  const u = d.user, st = d.stats || {};
  const el = $('detail');
  el.hidden = false;
  const initial = esc((u.name || u.email || '?').trim().charAt(0).toUpperCase());
  const plural = (k, word) => `${n(k)} ${word}${k === 1 ? '' : 's'}`;
  const tags = [
    u.role === 'admin' ? '<span class="tool-tag acc">admin</span>' : '<span class="tool-tag">customer</span>',
    planTag(u.plan, u.sub_status),
    u.disabled ? '<span class="tool-tag neg">disabled</span>' : '',
    u.google ? '<span class="tool-tag">Google sign-in</span>' : '',
    st.sessions ? `<span class="tool-tag pos">signed in on ${plural(st.sessions, 'device')}</span>` : '',
  ].join('');
  const look = u.look && u.look.what ? ` · plays as ${esc(u.look.name ? `${u.look.name}, a ${u.look.what}` : `a ${u.look.what}`)}` : '';
  el.innerHTML = `
    <div class="head">
      <div class="avatar" aria-hidden="true">${initial}</div>
      <div style="min-width:0"><h3>${esc(u.email)}</h3><div class="sub">${esc(u.name || 'No name')}${look}</div><div class="tags">${tags}</div></div>
      <button type="button" class="close" id="dClose" aria-label="Close">×</button>
    </div>
    <div class="mini">
      <div><b>${usd(st.paidCents)}</b><span>paid · ${plural(st.purchases, 'purchase')}</span></div>
      <div><b>${n(u.credits)}</b><span>credits now</span></div>
      <div><b>${n(st.spent30d)}</b><span>spent, 30 days</span></div>
      <div><b>${n(st.jobs)}</b><span>jobs · ${n(st.failed)} failed</span></div>
      <div><b>${n(d.games.length)}</b><span>games owned</span></div>
      <div><b>${n(st.invited)}</b><span>invited · ${n(st.invitedBought)} bought</span></div>
    </div>
    <section>
      <span class="label">Account</span>
      <dl class="kv">
        <dt>Account id</dt><dd class="mono">${esc(u.id)}</dd>
        <dt>Joined</dt><dd>${when(u.created)}</dd>
        <dt>Last signed in</dt><dd>${when(u.last_login)} <span class="sub">(${ago(u.last_login)})</span></dd>
        <dt>Last job</dt><dd>${when(st.lastJob)} <span class="sub">(${ago(st.lastJob)})</span></dd>
        <dt>Came from</dt><dd>${esc(u.source || 'direct')}${u.referrer ? ` · invited by <a href="#" data-open="${esc(u.referrer.id)}">${esc(u.referrer.email)}</a>${u.referral_paid ? ' (reward paid)' : ''}` : ''}</dd>
        <dt>Social</dt><dd>${plural(st.friends, 'friend')} · in ${n(st.memberOf)} others' games · ${n(st.shared)} shared to the library · ${plural(st.shareLinks, 'share link')}</dd>
      </dl>
    </section>
    <section>
      <span class="label">Billing</span>
      <dl class="kv">
        <dt>Plan</dt><dd>${planTag(u.plan, u.sub_status)}${u.period_end ? ` <span class="sub">${u.cancel_at_period_end ? 'ends' : 'renews'} ${day(u.period_end)}</span>` : ''}</dd>
        <dt>Credits</dt><dd>${n(st.bought)} bought · ${n(st.granted)} given free · ${n(st.spent)} spent in all</dd>
        <dt>Last purchase</dt><dd>${when(st.lastPurchase)}</dd>
        <dt>Stripe</dt><dd class="mono">${esc(u.stripe_customer_id || '—')}</dd>
      </dl>
    </section>
    <section>
      <span class="label">Games</span>
      ${table('<th>Game</th><th class="num">Plays</th><th>Updated</th>', d.games.map((g) => `<tr><td><a href="/play/${esc(g.slug)}" target="_blank" rel="noopener">${esc(g.title)}</a>${g.hidden ? ' <span class="tool-tag neg">closed</span>' : ''}${g.visibility !== 'public' ? ` <span class="tool-tag">${esc(g.visibility)}</span>` : ''}</td><td class="num">${n(g.plays)}</td><td>${day(g.updated)}</td></tr>`), 'No games yet.')}
    </section>
    <section>
      <span class="label">What they use</span>
      ${table('<th>Tool</th><th class="num">Jobs</th><th class="num">Credits</th>', d.tools.map((t) => `<tr><td class="mono">${esc(t.tool)}</td><td class="num">${n(t.n)}</td><td class="num">${n(t.credits)}</td></tr>`), 'No jobs yet.')}
    </section>
    <section>
      <span class="label">Connections and keys</span>
      ${table('<th>Editor (MCP)</th><th>Daily cap</th><th>Last used</th>', d.connections.map((c) => `<tr><td>${esc(c.name)}${c.revoked ? ' <span class="tool-tag neg">revoked</span>' : ''}</td><td>${c.daily_cap == null ? 'none' : n(c.daily_cap)}</td><td>${ago(c.last_used)}</td></tr>`), 'No editor connected.')}
      <div style="height:8px"></div>
      ${table('<th>API key</th><th>Made</th><th>Last used</th>', d.keys.map((k) => `<tr><td class="mono">${esc(k.prefix)}…${k.disabled ? ' <span class="tool-tag neg">off</span>' : ''}</td><td>${day(k.created)}</td><td>${ago(k.last_used)}</td></tr>`), 'No API keys.')}
    </section>
    <form id="giftForm" class="form-grid" style="padding:16px 0;border-top:1px solid var(--border);margin-top:16px">
      <div class="label">Gift credits</div>
      <input id="gCredits" class="form-input" type="number" min="1" step="1" placeholder="Credits, e.g. 500" required style="max-width:200px">
      <textarea id="gMessage" class="form-input" rows="2" maxlength="500" placeholder="A message for them (optional, goes in the email)"></textarea>
      <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Gift and email them</button>
    </form>
    <form id="creditForm" class="form-grid" style="padding:16px 0;border-top:1px solid var(--border)">
      <div class="label">Adjust credits</div>
      <div class="form-row-2"><input id="cDelta" class="form-input" type="number" step="1" placeholder="+100 or -50" required><input id="cNote" class="form-input" placeholder="Why (they see this)" required></div>
      <button class="btn btn-secondary btn-sm" type="submit" style="justify-self:start">Apply</button>
    </form>
    <div class="actions" style="padding:16px 0;border-top:1px solid var(--border)">
      <button class="btn btn-sm ${u.disabled ? 'btn-secondary' : 'danger'}" id="aDisable">${u.disabled ? 'Enable' : 'Disable'}</button>
    </div>
    <div class="label" style="margin:12px 0 8px">Ledger</div>
    <table class="data-table"><tbody>${d.ledger.map((e) => `<tr><td style="font-size:12px">${when(e.created)}</td><td>${esc(e.detail || e.kind)}</td><td class="num ${e.delta > 0 ? 'pos' : 'neg'}">${e.delta > 0 ? '+' : ''}${n(e.delta)}</td><td class="num muted">${n(e.balance_after)}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>'}</tbody></table>
    <div class="label" style="margin:20px 0 8px">Jobs</div>
    <table class="data-table"><tbody>${d.jobs.map((j) => `<tr><td style="font-size:12px">${when(j.created)}</td><td class="mono" style="font-size:12px">${esc(j.tool)}</td><td><span class="job-status-badge ${esc(j.status)}">${esc(j.status)}</span></td><td class="num">${n(j.credits)}</td></tr>`).join('') || '<tr><td class="muted">No jobs yet.</td></tr>'}</tbody></table>`;

  $('dClose').addEventListener('click', () => { selected = null; el.hidden = true; document.querySelectorAll('#accounts tr.sel').forEach((tr) => tr.classList.remove('sel')); });
  el.querySelectorAll('[data-open]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); detail(a.dataset.open); }));

  $('giftForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const credits = Number($('gCredits').value);
    if (!confirm(`Gift ${n(credits)} credits to ${u.email} and email them?`)) return;
    try {
      const r = await api(`/v1/admin/users/${id}/gift`, { credits, message: $('gMessage').value });
      toast(`Gifted. Balance is now ${n(r.credits)} credits${r.emailed ? '. Email sent.' : ' (email is off here)'}`);
      accounts();
      detail(id);
    } catch (x) { toast(x.message); }
  });
  $('creditForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/v1/admin/users/${id}/credits`, { delta: Number($('cDelta').value), note: $('cNote').value });
      toast(`Balance is now ${n(r.credits)} credits`);
      accounts();
    } catch (x) { toast(x.message); }
  });
  $('aDisable').addEventListener('click', async () => {
    if (!u.disabled && !confirm(`Disable ${u.email}? They are signed out and their API key stops working until you enable them.`)) return;
    try { await api(`/v1/admin/users/${id}/${u.disabled ? 'enable' : 'disable'}`, {}); accounts(); } catch (x) { toast(x.message); }
  });
}

// ---------------------------------------------------------------- jobs, purchases
async function jobs() {
  const r = await api('/v1/admin/jobs?limit=200');
  $('jobs').querySelector('tbody').innerHTML = r.jobs.map((j) => `<tr><td>${when(j.created)}</td><td>${esc(j.email)}</td><td class="mono" style="font-size:12px">${esc(j.tool)}</td><td class="num">${n(j.credits)}</td><td><span class="job-status-badge ${esc(j.status)}">${esc(j.status)}</span></td><td class="mono muted" style="font-size:12px">${esc(j.id)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No jobs yet.</td></tr>';
}

async function purchases() {
  const r = await api('/v1/admin/purchases?limit=200');
  $('purchases').querySelector('tbody').innerHTML = r.purchases.map((p) => `<tr><td>${when(p.created)}</td><td>${esc(p.email)}</td><td>${esc((p.detail || '').replace(/^Purchased /, ''))}</td><td class="num">${n(p.delta)}</td><td class="num">${usd(p.cents)}</td><td class="mono muted" style="font-size:12px">${esc(p.stripe_session_id)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No purchases yet.</td></tr>';
}

start();

// ---------------------------------------------------------------- reports
const REASON = { broken: 'Broken', scary: 'Scary or rude', scam: 'Scam', other: 'Other' };
async function reports() {
  const { games } = await api('/v1/admin/reports');
  const body = document.querySelector('#reports tbody');
  body.innerHTML = games.length ? games.map((g) => `
    <tr data-id="${esc(g.id)}">
      <td><a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.title)}</a><div class="muted" style="font-size:12px">${esc(g.slug)} · ${n(g.plays)} plays</div></td>
      <td>${esc(g.owner.name || '')}<div class="muted" style="font-size:12px">${esc(g.owner.email)}</div></td>
      <td>${n(g.reports)}<div class="muted" style="font-size:12px">${Object.entries(g.byReason).map(([k, v]) => `${esc(REASON[k] || k)} ${v}`).join(' · ')}</div></td>
      <td>${g.recent.slice(0, 3).map((r) => `<div style="font-size:12px"><b>${esc(REASON[r.reason] || r.reason)}</b> · ${esc(r.by)} · ${when(r.created)}${r.note ? `<br>${esc(r.note)}` : ''}</div>`).join('') || '—'}</td>
      <td>${g.hidden ? `<b>Closed</b><div class="muted" style="font-size:12px">${esc(g.hiddenReason || '')} (${esc(g.hiddenBy || '')}, ${when(g.hiddenAt)})</div>` : 'Open'}</td>
      <td>${g.hidden ? '<button class="btn btn-secondary btn-sm" data-a="unhide">Unhide</button>' : '<button class="btn btn-secondary btn-sm" data-a="hide">Hide</button>'}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="muted">No reports yet.</td></tr>';
  for (const b of body.querySelectorAll('button')) {
    b.onclick = async () => {
      const row = b.closest('tr');
      let reason = null;
      if (b.dataset.a === 'hide') {
        reason = prompt('Why is it closed? The owner will see this on their Games page.', 'It was reported and an admin closed it.');
        if (reason === null) return;
      }
      try {
        await api(`/v1/admin/games/${row.dataset.id}/${b.dataset.a}`, { reason });
        toast(b.dataset.a === 'hide' ? 'Closed' : 'Opened again');
        reports();
      } catch (x) { toast(x.message); }
    };
  }
}
