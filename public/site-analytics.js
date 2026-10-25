// The site's own analytics, on every page after the Hawkes Analytics SDK's script tag (Gen's SDK, product hawkesgen;
// hawkesgen/docs/analytics.md; Hawkes Studio shows it). What every page shares:
// - who: the signed-in account's id (identify; nothing else about them) and their plan, on every event;
// - the funnel's money moments, read from the account's own ledger once each: `signup` (email or Google, with where
//   it came from), `purchase` (a pack, wherever it was bought: this site, an editor's MCP chat), `plan_paid` (a
//   plan's month) — and `frustration` job_failed / job_refused when a generation failed and was given back;
// - what got in the way on any page: `frustration` out_of_credits (402), server_error (5xx), too_many_requests (429)
//   and request_failed (no answer), with the route (ids taken out).
// Pages call window.hgAnalytics for their own moments: track, frustration, engage, ask (the feedback card), refresh
// (after signing in or out). Nothing here ever throws into the page.
(() => {
  if (window.hgAnalytics) return;
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  const sdk = () => window.hawkesAnalytics || null;
  const queue = [];
  const call = (m, args) => { try { const a = sdk(); if (a && typeof a[m] === 'function') return a[m](...args); } catch { /* never break the page */ } return undefined; };
  const run = (m, ...args) => { if (sdk()) return call(m, args); queue.push([m, args]); return undefined; };
  // The SDK loads deferred from Gen; what came before it waits here (and is dropped after 30 s if it never loads).
  let tries = 0;
  const wait = setInterval(() => {
    if (!sdk() && ++tries < 120) return;
    clearInterval(wait);
    for (const [m, args] of queue.splice(0)) call(m, args);
  }, 250);

  // The same trouble on the same route counts once in 30 s (a retry loop is one frustration).
  const lastSaid = new Map();
  const api = {
    track: (name, props) => run('track', name, props || {}),
    frustration: (kind, props) => {
      const k = `${kind}|${(props && props.route) || ''}`;
      const t = Date.now();
      if (t - (lastSaid.get(k) || 0) < 30_000) return;
      lastSaid.set(k, t);
      run('track', 'frustration', { kind, ...(props || {}) });
    },
    engage: (name, seconds, props) => { if (seconds > 0) run('track', 'engage', { name, seconds: Math.round(seconds), ...(props || {}) }); },
    // The feedback card, at most once in `everyDays` (14) per question in this browser, answered or not.
    ask: (o) => {
      const a = sdk();
      if (!a || typeof a.ask !== 'function' || !o || !o.id) return Promise.resolve(null);
      const key = `hg_ask_${o.id}`;
      if (Date.now() - (Number(store.get(key)) || 0) < (o.everyDays || 14) * 864e5) return Promise.resolve(null);
      store.set(key, String(Date.now()));
      return a.ask(o).catch(() => null);
    },
    activity: () => run('activity'),
    refresh: () => account(),
  };
  window.hgAnalytics = api;

  const routeOf = (u) => {
    try { return new URL(u, location.href).pathname.replace(/\/(g_|j_|a_|t_)?[0-9a-f]{8,}/gi, '/:id').replace(/\/[\w-]{24,}/g, '/:token').replace(/\/(usr|ubeta)_\w+/g, '/:user').slice(0, 80); } catch { return '?'; }
  };
  if (realFetch) {
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const p = realFetch(input, init);
      let same = false;
      try { same = Boolean(url) && new URL(url, location.href).origin === location.origin && !/\/v1\/analytics\//.test(url); } catch { /* odd url */ }
      if (!same) return p;
      return p.then((r) => {
        const route = routeOf(url);
        if (r.status === 402) api.frustration('out_of_credits', { route });
        else if (r.status === 429) api.frustration('too_many_requests', { route });
        else if (r.status >= 500) api.frustration('server_error', { route, status: r.status });
        return r;
      }, (e) => {
        if (!(e && e.name === 'AbortError')) api.frustration('request_failed', { route: routeOf(url) });
        throw e;
      });
    };
  }

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
  };
  async function getJson(path) {
    if (!realFetch) return null;
    try { const r = await realFetch(path, { headers: { Accept: 'application/json' }, credentials: 'same-origin' }); return r.ok ? await r.json() : null; } catch { return null; }
  }

  let busy = null;
  function account() {
    if (!busy) busy = check().finally(() => { busy = null; });
    return busy;
  }
  async function check() {
    const me = ((await getJson('/v1/users/me?soft=1')) || {}).user || null;
    run('identify', me ? me.id : null);
    run('setContext', { account: me ? 'user' : 'guest', plan: me ? me.plan || 'free' : null });
    if (!me) return;
    if (Date.now() - (me.created || 0) < 30 * 60_000 && !store.get(`hg_signup_${me.id}`)) {
      store.set(`hg_signup_${me.id}`, '1');
      api.track('signup', { source: me.source || 'direct' });
    }
    // The ledger since this browser last looked. The first look counts only what just happened (back from Stripe),
    // so an old purchase isn't told again from a new browser.
    const key = `hg_ledger_${me.id}`;
    const back = /[?&](billing|checkout|plan)=success\b/.test(location.search) || location.pathname === '/thanks';
    const seen = Number(store.get(key)) || Date.now() - (back ? 3600_000 : 0);
    const all = ((await getJson('/v1/billing/ledger?limit=100')) || {}).entries || [];
    const entries = all.filter((e) => Number(e.created) > seen);
    if (!entries.length) { if (!store.get(key)) store.set(key, String(Date.now())); return; }
    store.set(key, String(Math.max(...entries.map((e) => Number(e.created)))));
    for (const e of entries.slice().reverse()) {
      const detail = String(e.detail || '').slice(0, 120);
      if (e.kind === 'stripe_purchase') api.track('purchase', { credits: e.delta, pack: detail, first: all.filter((x) => x.kind === 'stripe_purchase').length === 1 });
      else if (e.kind === 'subscription_credits') api.track('plan_paid', { credits: e.delta, plan: me.plan || null });
      else if (e.kind === 'job_refund' && /^Failed/.test(detail)) api.frustration('job_failed', { detail, route: 'job' });
      else if (e.kind === 'job_refund' && /^Not started/.test(detail)) api.frustration('job_refused', { detail, route: 'job' });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', account); else account();
})();
