// The `server-limits` scenario: what the portal does under load, seen from a browser. Loaded by portal.js. No game is played.
//   1. signins-not-blocking   twenty sign-ins at once while the server answers /v1/health: it keeps answering (password hashing runs off
//                             the event loop; the unit test test/hardening.test.ts holds the 50 ms bound on the loop itself)
//   2. one-play-counted       a game's page reloaded ten times counts one play
//   3. ws-cap-refused         past the per-address cap (12) new game connections are refused while the ones already open keep playing
// The sign-in and play parts need a throwaway account, so they never run on live or where the server sends mail; the connection part
// opens and closes sockets only, and runs anywhere. Options: { signins: 20, sockets: 14 }.
export const SERVER_LIMITS = {
  id: 'server-limits', title: 'Server limits: twenty sign-ins at once, ten reloads count one play, connections past the per-address cap refused while players in rooms keep playing',
  description: 'no game, no browser input beyond the page. Signs up a throwaway account (beta only), fires 20 sign-ins at once while pinging /v1/health (signins-not-blocking), reloads a new game ten times (one-play-counted), then opens 14 game sockets from this address (ws-cap-refused: the first 12 open and stay open, the rest are refused). Options: signins, sockets',
  seconds: 90, tags: ['full'],
};

const isLive = () => /^(www\.)?hawkesgen\.ai$/.test(location.hostname);
const json = async (url, init = {}) => {
  const r = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  let body = null; try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

export async function runServerLimits(t, options = {}) {
  const signins = Math.max(2, Math.min(20, Number(options.signins) || 20));
  const sockets = Math.max(2, Math.min(40, Number(options.sockets) || 14));
  await t.until(() => document.readyState === 'complete', 20000, 'the page to load');
  t.scene('Server limits: start');
  const health = (await json('/v1/health')).body || {};
  t.progress(0.05);

  if (isLive() || health.mail) {
    t.event('accounts-skipped', isLive() ? 'live site: a playtest never signs up' : 'this server sends mail: no throwaway accounts');
  } else {
    const email = `playtest-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@example.com`; // example.com can never be real mail
    const password = `pt-${Math.random().toString(36).slice(2)}-limits`;
    const up = await json('/v1/users/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (up.status !== 200) throw new Error(`the throwaway sign-up was refused (${up.status}): ${up.body && up.body.error}`);
    t.event('signup-ok', 'a throwaway account');
    t.progress(0.15);

    // 1. Twenty sign-ins at once, and /v1/health asked every 25 ms meanwhile: the slowest answer is how long the server was held.
    let worst = 0, stop = false;
    const pinger = (async () => { while (!stop) { const a = performance.now(); await fetch('/v1/health', { cache: 'no-store' }).catch(() => {}); worst = Math.max(worst, performance.now() - a); await new Promise((r) => setTimeout(r, 25)); } })();
    const results = await Promise.all(Array.from({ length: signins }, () => json('/v1/users/login', { method: 'POST', body: JSON.stringify({ email, password }) })));
    stop = true; await pinger;
    const ok = results.filter((r) => r.status === 200).length, limited = results.filter((r) => r.status === 429).length;
    t.metric('healthWorstMs', Math.round(worst));
    t.event('signins-not-blocking', `${signins} sign-ins at once (${ok} in, ${limited} told to slow down); /v1/health's slowest answer meanwhile ${Math.round(worst)} ms`);
    if (ok + limited !== signins) t.problem('error', `a sign-in failed in a way that is neither success nor the limit: ${results.map((r) => r.status).join(',')}`);
    // A sign-in the limiter turned away never reached the password hash, so it proves nothing about the loop: most must get in.
    if (ok < Math.ceil(signins * 0.8)) t.problem('error', `only ${ok} of ${signins} sign-ins reached the password check (${limited} were refused by the sign-in limit), so the burst did not test the event loop`);
    if (worst > 400) t.problem('warning', `/v1/health took ${Math.round(worst)} ms while ${signins} sign-ins ran (browser to server included)`);
    t.progress(0.4);

    // 2. A game, its page reloaded ten times as a guest.
    const g = await json('/v1/games', { method: 'POST', body: JSON.stringify({ title: 'Plays counted once', template: 'blank' }) });
    if (g.status !== 200 || !g.body.slug) throw new Error(`the game was not made (${g.status})`);
    const plays = async () => ((await json('/v1/games')).body.games || []).find((x) => x.slug === g.body.slug)?.plays;
    const before = await plays();
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`/v1/play/${g.body.slug}`, { credentials: 'omit', cache: 'no-store' });
      if (!r.ok) throw new Error(`reload ${i + 1} answered ${r.status}`);
    }
    const after = await plays();
    t.metric('playsCounted', after - before);
    t.event('one-play-counted', `10 reloads of /play/${g.body.slug}: plays ${before} to ${after}`);
    if (after - before !== 1) t.problem('error', `ten reloads counted ${after - before} plays, not 1`);
    t.progress(0.6);
  }

  // 3. Sockets from this address, one past the other. The room code is made up; nobody else is in it.
  const room = `pt${Math.random().toString(36).slice(2, 8)}`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const opened = [], refused = [];
  for (let i = 0; i < sockets; i++) {
    await new Promise((resolve) => {
      const ws = new WebSocket(`${proto}://${location.host}/v1/ws?play=t/sandbox&room=${room}&name=PT${i}&v=2`);
      const to = setTimeout(() => { refused.push(i); resolve(); }, 6000);
      ws.onopen = () => { clearTimeout(to); opened.push(ws); resolve(); };
      ws.onerror = () => { clearTimeout(to); refused.push(i); resolve(); };
    });
  }
  await new Promise((r) => setTimeout(r, 1200));
  const stillOpen = opened.filter((w) => w.readyState === 1).length;
  t.metric('socketsOpen', stillOpen);
  t.event('ws-cap-refused', `${sockets} tried from this address: ${opened.length} opened, ${refused.length} refused; ${stillOpen} of the opened are still open`);
  if (!refused.length) t.problem('error', `no connection was refused out of ${sockets}: the per-address cap is not holding`);
  if (stillOpen !== opened.length) t.problem('error', `${opened.length - stillOpen} connections already open were dropped`);
  for (const w of opened) try { w.close(); } catch {}
  t.scene('Server limits: done');
  t.progress(1);
  t.finish('done');
}
