// /credits: the balance, top-ups (packs, through Stripe Checkout), plans and the recent ledger, on a page of its own (J,
// 2026-10-27: the game's "Get credits" and the out-of-credit emails come here). The same billing routes as /app.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (v) => Number(v || 0).toLocaleString('en-US');
const day = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

async function api(path, o = {}) {
  const r = await fetch(path, { method: o.body ? 'POST' : 'GET', headers: o.body ? { 'Content-Type': 'application/json' } : {}, body: o.body ? JSON.stringify(o.body) : undefined });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.error || `Request failed (${r.status})`), { status: r.status });
  return b;
}
function track(name, props) { try { window.hawkesAnalytics?.track?.(name, props); } catch {} }
function billError(e) { $('billError').textContent = e.message; $('billError').hidden = false; }
const here = (q = '') => `${location.origin}/credits${q}`;

async function start() {
  const me = await api('/v1/users/me?soft=1').catch(() => null);
  if (!me?.user) { $('gate').hidden = false; return; }
  $('page').hidden = false;
  notices();
  await Promise.all([load(me.user), ledger()]);
}

function notices() {
  const q = new URLSearchParams(location.search);
  const say = (html) => { const d = document.createElement('div'); d.className = 'cr-note'; d.innerHTML = html; $('notices').appendChild(d); };
  if (q.get('billing') === 'success') say('<b>Thanks.</b> Your credits are on their way (usually seconds). You can go back to your game.');
  if (q.get('plan') === 'success') say('<b>Welcome aboard.</b> Your plan is active; this month\'s credits arrive as soon as Stripe confirms the payment.');
  if (q.get('billing') || q.get('plan')) history.replaceState(null, '', '/credits');
}

async function load(user) {
  const [sub, packs, plans] = await Promise.all([api('/v1/billing/subscription'), api('/v1/billing/packs'), api('/v1/plans').catch(() => null)]);
  if (plans) $('aiCost').textContent = plans.aiCredits;
  $('balance').textContent = n(user.credits);
  const cur = sub.plan;
  $('planNote').textContent = cur.id === 'free' ? 'Free plan' : `${cur.name}${sub.cancelAtPeriodEnd ? `, ends ${day(sub.periodEnd)}` : sub.periodEnd ? `, renews ${day(sub.periodEnd)}` : ''}${sub.status === 'past_due' ? ' (payment failed: update your card)' : ''}`;

  // Top up: a card per pack; a first pack comes with more until the account has bought once.
  const first = user.bought ? 0 : Number(packs.firstPurchaseBonus) || 0;
  $('firstBonus').hidden = !first;
  if (first) $('firstBonus').innerHTML = `Your first top-up comes with <b>${first}% more credits</b>, on top of any pack bonus.`;
  $('packs').innerHTML = packs.packs.map((p) => {
    const total = Math.round(p.credits * (1 + first / 100));
    return `<div class="cr-pack${p.id === 'creator_25' ? ' best' : ''}">
      <span class="label">${esc(p.name)}${p.id === 'creator_25' ? ' · most popular' : ''}</span>
      <div class="price">$${esc(String(p.priceUsd))}</div>
      <div class="n">${n(total)} credits</div>
      <div class="bonus">${[p.bonusPercent ? `+${p.bonusPercent}% pack bonus` : '', first ? `+${first}% first top-up` : ''].filter(Boolean).join(' · ')}</div>
      <button class="btn ${p.id === 'creator_25' ? 'btn-primary' : 'btn-secondary'}" data-pack="${esc(p.id)}">Buy</button>
    </div>`;
  }).join('');
  for (const b of $('packs').querySelectorAll('[data-pack]')) b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await api('/v1/billing/checkout', { body: { packId: b.dataset.pack, successUrl: here('?billing=success'), cancelUrl: here() } });
      track('checkout_start', { pack: b.dataset.pack, first: !user.bought, where: 'credits' });
      location.href = r.url;
    } catch (e) { billError(e); b.disabled = false; }
  };

  // Plans.
  $('planCards').innerHTML = sub.plans.map((p) => `
    <div class="plan${p.id === cur.id ? ' current' : ''}">
      <span class="label">${esc(p.name)}${p.id === cur.id ? ' · your plan' : ''}</span>
      <div class="price">$${p.priceUsd}<small>${p.priceUsd ? ' / month' : ''}</small></div>
      <ul>
        <li>${p.monthlyCredits ? `<b>${n(p.monthlyCredits)} credits</b> every month` : 'Starter credits to try the AI'}</li>
        <li>Up to ${p.games} games</li>
        <li>Up to ${p.members} people per game</li>
      </ul>
      ${p.id === cur.id || p.id === 'free' ? '' : `<button class="btn ${p.priceCents > cur.priceCents ? 'btn-primary' : 'btn-secondary'}" data-plan="${esc(p.id)}">${cur.id === 'free' ? `Get ${esc(p.name)}` : p.priceCents > cur.priceCents ? `Upgrade to ${esc(p.name)}` : `Switch to ${esc(p.name)}`}</button>`}
    </div>`).join('');
  for (const b of $('planCards').querySelectorAll('[data-plan]')) b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await api('/v1/billing/plan', { body: { plan: b.dataset.plan, successUrl: here('?plan=success'), cancelUrl: here() } });
      track('plan_start', { plan: b.dataset.plan, where: 'credits' });
      if (r.url) location.href = r.url; else location.reload();
    } catch (e) { billError(e); b.disabled = false; }
  };
  const acts = [];
  if (cur.id !== 'free') acts.push('<button class="btn btn-secondary btn-sm" id="manage">Cards and invoices</button>');
  if (cur.id !== 'free' && !sub.cancelAtPeriodEnd) acts.push('<button class="btn btn-ghost btn-sm" id="cancel">Cancel plan</button>');
  if (sub.cancelAtPeriodEnd) acts.push('<button class="btn btn-secondary btn-sm" id="resume">Keep my plan</button>');
  $('planActions').innerHTML = acts.join('');
  if ($('manage')) $('manage').onclick = async () => { try { location.href = (await api('/v1/billing/portal', { body: {} })).url; } catch (e) { billError(e); } };
  if ($('cancel')) $('cancel').onclick = async () => { if (!confirm('Cancel your plan? It stays on until the end of the month you paid for, and your credits stay yours.')) return; try { await api('/v1/billing/cancel', { body: { cancel: true } }); location.reload(); } catch (e) { billError(e); } };
  if ($('resume')) $('resume').onclick = async () => { try { await api('/v1/billing/cancel', { body: { cancel: false } }); location.reload(); } catch (e) { billError(e); } };
}

async function ledger() {
  const r = await api('/v1/billing/ledger?limit=15').catch(() => ({ entries: [] }));
  $('ledger').innerHTML = r.entries.map((e) => `<tr><td style="color:var(--fg-3);white-space:nowrap">${day(e.created)}</td><td>${esc(e.detail || e.kind)}</td><td class="num ${e.delta > 0 ? 'pos' : ''}">${e.delta > 0 ? '+' : ''}${n(e.delta)}</td></tr>`).join('') || '<tr><td class="muted">Nothing yet.</td></tr>';
}

start();
