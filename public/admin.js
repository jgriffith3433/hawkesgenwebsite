// The admin page: overview, accounts (with ledger, jobs and actions), jobs, purchases. Everything comes from
// /v1/admin/*, which answers only admins.
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

$('gateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('gError').hidden = true;
  try {
    await api('/v1/users/login', { email: $('gEmail').value.trim(), password: $('gPassword').value });
    location.reload();
  } catch (x) {
    $('gError').textContent = x.message;
    $('gError').hidden = false;
  }
});
$('signOut').addEventListener('click', async () => { await api('/v1/users/logout', {}).catch(() => {}); location.href = '/'; });

// ---------------------------------------------------------------- tabs
function show(tab) {
  if (!['overview', 'accounts', 'jobs', 'purchases'].includes(tab)) tab = 'overview';
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== tab; });
  history.replaceState(null, '', `#${tab}`);
  ({ overview, accounts, jobs, purchases })[tab]();
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
    <tr class="click" data-id="${esc(u.id)}">
      <td><div>${esc(u.email)}${u.role === 'admin' ? ' <span class="tool-tag">admin</span>' : ''}${u.disabled ? ' <span class="tool-tag neg">disabled</span>' : ''}</div><div class="muted" style="font-size:12px">${esc(u.name || '')}</div></td>
      <td class="num">${n(u.credits)}</td><td class="num">${n(u.bought)}</td><td class="num">${n(u.spent)}</td><td class="num">${n(u.jobs)}</td>
      <td>${day(u.created)}</td><td>${day(u.last_login)}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">No accounts match.</td></tr>';
  $('accountsMore').textContent = r.total > r.items.length ? `Showing ${r.items.length} of ${n(r.total)}. Search to narrow it down.` : `${n(r.total)} accounts`;
  $('accounts').querySelectorAll('tr.click').forEach((tr) => tr.addEventListener('click', () => detail(tr.dataset.id)));
  if (selected) detail(selected);
}
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); accounts(); });

async function detail(id) {
  selected = id;
  const d = await api(`/v1/admin/users/${id}`);
  const u = d.user;
  const el = $('detail');
  el.hidden = false;
  el.innerHTML = `
    <div class="label">${u.role === 'admin' ? 'Admin' : 'Customer'}${u.disabled ? ' · disabled' : ''}</div>
    <h3 style="margin-top:8px">${esc(u.email)}</h3>
    <dl class="kv">
      <dt>Name</dt><dd>${esc(u.name || '—')}</dd>
      <dt>Credits</dt><dd>${n(u.credits)}</dd>
      <dt>Account</dt><dd>${esc(u.id)}</dd>
      <dt>Joined</dt><dd>${when(u.created)}</dd>
      <dt>Last in</dt><dd>${when(u.last_login)}</dd>
      <dt>API key</dt><dd>${d.key ? `${esc(d.key.prefix)}… · used ${when(d.key.last_used)}` : 'none'}</dd>
      <dt>Stripe</dt><dd>${esc(u.stripe_customer_id || '—')}</dd>
    </dl>
    <form id="giftForm" class="form-grid" style="padding:16px 0;border-top:1px solid var(--rule)">
      <div class="label">Gift credits</div>
      <input id="gCredits" class="form-input" type="number" min="1" step="1" placeholder="Credits, e.g. 500" required style="max-width:200px">
      <textarea id="gMessage" class="form-input" rows="2" maxlength="500" placeholder="A message for them (optional, goes in the email)"></textarea>
      <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Gift and email them</button>
    </form>
    <form id="creditForm" class="form-grid" style="padding:16px 0;border-top:1px solid var(--rule)">
      <div class="label">Adjust credits</div>
      <div class="form-row-2"><input id="cDelta" class="form-input" type="number" step="1" placeholder="+100 or -50" required><input id="cNote" class="form-input" placeholder="Why (they see this)" required></div>
      <button class="btn btn-secondary btn-sm" type="submit" style="justify-self:start">Apply</button>
    </form>
    <div style="display:flex;flex-wrap:wrap;gap:8px;padding:16px 0;border-top:1px solid var(--rule)">
      <button class="btn btn-secondary btn-sm" id="aLink">Password link</button>
      <button class="btn btn-secondary btn-sm" id="aRole">${u.role === 'admin' ? 'Make customer' : 'Make admin'}</button>
      <button class="btn btn-sm ${u.disabled ? 'btn-secondary' : 'danger'}" id="aDisable">${u.disabled ? 'Enable' : 'Disable'}</button>
    </div>
    <div id="linkOut" hidden style="margin-bottom:16px"></div>
    <div class="label" style="margin:12px 0 8px">Ledger</div>
    <table class="data-table"><tbody>${d.ledger.map((e) => `<tr><td style="font-size:12px">${when(e.created)}</td><td>${esc(e.detail || e.kind)}</td><td class="num ${e.delta > 0 ? 'pos' : 'neg'}">${e.delta > 0 ? '+' : ''}${n(e.delta)}</td><td class="num muted">${n(e.balance_after)}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>'}</tbody></table>
    <div class="label" style="margin:20px 0 8px">Jobs</div>
    <table class="data-table"><tbody>${d.jobs.map((j) => `<tr><td style="font-size:12px">${when(j.created)}</td><td class="mono" style="font-size:12px">${esc(j.tool)}</td><td>${esc(j.status)}</td><td class="num">${n(j.credits)}</td></tr>`).join('') || '<tr><td class="muted">No jobs yet.</td></tr>'}</tbody></table>`;

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
  $('aLink').addEventListener('click', async () => {
    try {
      const r = await api(`/v1/admin/users/${id}/password-link`, {});
      const out = $('linkOut');
      out.hidden = false;
      out.innerHTML = `<div class="label" style="margin-bottom:6px">One use, ${r.expiresInHours} hours. Send it to them yourself.</div><input class="form-input mono" readonly value="${esc(r.url)}" style="font-size:12px">`;
      out.querySelector('input').select();
    } catch (x) { toast(x.message); }
  });
  $('aRole').addEventListener('click', async () => {
    try { await api(`/v1/admin/users/${id}/role`, { role: u.role === 'admin' ? 'customer' : 'admin' }); accounts(); } catch (x) { toast(x.message); }
  });
  $('aDisable').addEventListener('click', async () => {
    if (!u.disabled && !confirm(`Disable ${u.email}? They are signed out and their API key stops working until you enable them.`)) return;
    try { await api(`/v1/admin/users/${id}/${u.disabled ? 'enable' : 'disable'}`, {}); accounts(); } catch (x) { toast(x.message); }
  });
}

// ---------------------------------------------------------------- jobs, purchases
async function jobs() {
  const r = await api('/v1/admin/jobs?limit=200');
  $('jobs').querySelector('tbody').innerHTML = r.jobs.map((j) => `<tr><td>${when(j.created)}</td><td>${esc(j.email)}</td><td class="mono" style="font-size:12px">${esc(j.tool)}</td><td class="num">${n(j.credits)}</td><td><span class="job-status-badge job-status-${esc(j.status)}">${esc(j.status)}</span></td><td class="mono muted" style="font-size:12px">${esc(j.id)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No jobs yet.</td></tr>';
}

async function purchases() {
  const r = await api('/v1/admin/purchases?limit=200');
  $('purchases').querySelector('tbody').innerHTML = r.purchases.map((p) => `<tr><td>${when(p.created)}</td><td>${esc(p.email)}</td><td>${esc((p.detail || '').replace(/^Purchased /, ''))}</td><td class="num">${n(p.delta)}</td><td class="num">${usd(p.cents)}</td><td class="mono muted" style="font-size:12px">${esc(p.stripe_session_id)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No purchases yet.</td></tr>';
}

start();
