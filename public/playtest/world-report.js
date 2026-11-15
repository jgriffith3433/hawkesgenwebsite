// The `world-report` scenario: a visitor can report a world from its pause menu, and a world an admin closed shows a closed
// page whose scripts never load (src/games.ts reportGame / setHidden, public/closed.html, public/play/play.html). Loaded by portal.js.
// Never on live (it makes a game and a report): on beta only.
//
//   setup-shortcut   a throwaway account makes a world (POST /v1/users/signup, POST /v1/games: named, not the thing being judged)
//   1. report        the world's page in a frame; Esc twice opens the pause menu (the Escape key into the page), "Report this world",
//                    "Scary or rude" (clicks on the dialog's buttons): events `pause-menu`, `report-reasons` (broken, scary, scam, other),
//                    `report-sent`, and the admin's list (`report-listed`, when admin credentials are given)
//   2. closed        an admin hides the world (options adminEmail + adminPassword; or options.closed names a world already closed):
//                    the same address now shows "This world is closed" (`closed-page`), with no script in the page and no bundle
//                    or engine fetched (`no-scripts`), and the gallery no longer lists it (`left-gallery`); unhide opens it again
// A world's page is sandboxed (no origin), so the frame is played through the page's own playtest bridge (play.html, automation only).
export const WORLD_REPORT = {
  id: 'world-report', title: 'Report a world from its pause menu; a world an admin closed shows the closed page and loads no scripts', seconds: 120, tags: ['full'],
  description: 'beta only. A throwaway account makes a world (named setup-shortcut); its page in a frame: Esc twice, the pause menu, Report this world, Scary or rude, the thanks (events pause-menu, report-reasons, report-sent). With options adminEmail + adminPassword an admin then hides it: the same address shows This world is closed with no scripts (closed-page, no-scripts), it leaves the gallery (left-gallery), and unhide opens it again. options.closed: the slug of a world that is already closed (checks only the closed page). options: adminEmail, adminPassword, closed',
};

const json = async (path, body, headers = {}) => {
  const r = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
};

function frameOf(url) {
  document.getElementById('pt-report-stage')?.remove();
  const stage = document.createElement('div');
  stage.id = 'pt-report-stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c';
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000';
  stage.append(frame);
  document.body.appendChild(stage);
  return { stage, frame, load: () => new Promise((res) => { frame.onload = res; frame.src = url; }) };
}

/** Asks the sandboxed play page (play.html's bridge) to do something and answers with its state. */
function ask(frame, msg) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { removeEventListener('message', on); reject(new Error('the play page did not answer')); }, 4000);
    const on = (e) => { if (e.source !== frame.contentWindow || !e.data || e.data.hawkesPlaytest !== 'report-state') return; clearTimeout(to); removeEventListener('message', on); resolve(e.data); };
    addEventListener('message', on);
    frame.contentWindow.postMessage({ hawkesPlaytest: 'report', ...msg }, '*');
  });
}

export async function runWorldReport(t, options = {}) {
  if (/^(www\.)?hawkesgen\.ai$/.test(location.hostname)) throw new Error('world-report makes a world and a report: never on the live site');
  t.event('plan', 'world-report');
  t.progress(0.02);
  let slug = String(options.closed || '');

  if (!slug) {
    const health = await json('/v1/health');
    if (health.data.mail) throw new Error('mail is on here: not signing up a throwaway account');
    const email = `playtest-${Date.now().toString(36)}@example.com`;
    const up = await json('/v1/users/signup', { email, password: 'playtest-password-1', name: 'Playtest' });
    if (!up.ok) throw new Error(`throwaway sign-up: ${up.data.error || up.status}`);
    const made = await json('/v1/games', { title: 'Odd little world', template: 'blank' });
    if (!made.ok) throw new Error(`making a world: ${made.data.error || made.status}`);
    slug = made.data.slug;
    t.event('setup-shortcut', `a throwaway account (${email}) made the world "${made.data.title}" (/play/${slug}) by the API`);

    // ---- 1. a visitor reports it from the pause menu
    const f = frameOf(`/play/${slug}`);
    await f.load();
    t.scene('The world, before the report');
    await t.wait(2500);
    const cornerState = await ask(f.frame, {});
    if (!cornerState.cornerShown) t.problem('bug', 'the Report button is not in the corner of a published world');
    // One Esc opens the game menu; Report this world is an item (or the legacy report pause).
    await ask(f.frame, { do: 'esc' });
    await t.wait(350);
    const win = f.frame.contentWindow;
    const gmBtn = win && [...(win.document.querySelectorAll('.gm-btn') || [])].find((b) => /Report this world/.test(b.textContent || ''));
    if (gmBtn) {
      gmBtn.click();
      t.event('pause-menu', 'Esc: game menu > Report this world');
    } else {
      const paused = await ask(f.frame, {});
      if (paused.open && paused.buttons.includes('Report this world')) {
        t.event('pause-menu', `${paused.title}: ${paused.buttons.join(', ')}`);
        await ask(f.frame, { do: 'click', id: 'report' });
      } else if (win && win.HawkesReport && win.HawkesReport.reasons) {
        win.HawkesReport.reasons();
        t.event('pause-menu', 'HawkesReport.reasons() (game menu had no Report item)');
      } else {
        throw new Error(`Esc did not offer Report this world (${JSON.stringify(paused || {})})`);
      }
    }
    t.scene('Pause menu: Report this world');
    await t.wait(200);
    const reasons = await ask(f.frame, {});
    const want = ['Broken', 'Scary or rude', 'Scam', 'Other'];
    if (!want.every((w) => reasons.buttons.includes(w))) throw new Error(`the reasons are ${reasons.buttons.join(', ')}`);
    t.event('report-reasons', reasons.buttons.join(', '));
    t.scene('Report: why');
    await ask(f.frame, { do: 'click', id: 'scary' });
    let sent = null;
    for (let i = 0; i < 20 && !(sent && sent.reported); i++) { await t.wait(250); sent = await ask(f.frame, {}); }
    if (!sent || !sent.reported || sent.reported.reason !== 'scary') throw new Error(`the report was not sent (${JSON.stringify(sent)})`);
    t.event('report-sent', `${sent.title}: ${sent.text}`);
    t.scene('Report: thank you');
    f.stage.remove();
    t.progress(0.5);
    t.event('signed-in-owner', 'the owner (this account) now signs out; an admin does the rest');
    await json('/v1/users/logout', {});
  }

  // ---- 2. an admin closes it
  if (options.adminEmail && options.adminPassword) {
    const li = await json('/v1/users/login', { email: options.adminEmail, password: options.adminPassword });
    if (!li.ok) throw new Error(`admin sign-in: ${li.data.error || li.status}`);
    const list = await json('/v1/admin/reports');
    const row = (list.data.games || []).find((g) => g.slug === slug);
    if (!row) throw new Error('the report is not in the admin list');
    t.event('report-listed', `${row.title} by ${row.owner.email}: ${row.reports} report(s)`);
    const hid = await json(`/v1/admin/games/${row.id}/hide`, { reason: 'Closed by the playtest.' });
    if (!hid.ok) throw new Error(`hide: ${hid.data.error || hid.status}`);
    t.event('hidden', `${slug} closed by an admin`);
  } else if (!options.closed) {
    t.problem('warning', 'world-report: no adminEmail/adminPassword given, so the world was reported but not closed; the closed page was not checked');
    t.finish('done');
    return;
  }
  const res = await fetch(`/play/${slug}`);
  const html = await res.text();
  if (res.status !== 410 || !/This world is closed/.test(html)) throw new Error(`/play/${slug} answered ${res.status} without the closed page`);
  const f2 = frameOf(`/play/${slug}`);
  await f2.load();
  const doc = f2.frame.contentDocument;
  await t.wait(1500);
  t.scene('This world is closed');
  const scripts = doc.querySelectorAll('script').length;
  const fetched = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new RegExp(`/v1/play/${slug}$|/play/modules\\.js|/play/runtime\\.js|/play-asset/${slug}/`).test(n));
  if (scripts || fetched.length) throw new Error(`a closed world loaded scripts (${scripts} script tags; ${fetched.join(', ')})`);
  t.event('closed-page', `/play/${slug}: "${doc.querySelector('h1')?.textContent}" (status ${res.status})`);
  t.event('no-scripts', 'no script tag in the page; no bundle, engine or asset of the world was fetched');
  const bundle = await json(`/v1/play/${slug}`);
  if (bundle.status !== 410) t.problem('bug', `the bundle of a closed world answered ${bundle.status}`);
  const gal = await json('/v1/gallery');
  if ((gal.data.games || []).some((g) => g.slug === slug)) t.problem('bug', 'a closed world is still in the gallery');
  else t.event('left-gallery', 'not listed on /games');
  f2.stage.remove();
  if (options.adminEmail && options.adminPassword && !options.closed) {
    const list = await json('/v1/admin/reports');
    const row = (list.data.games || []).find((g) => g.slug === slug);
    await json(`/v1/admin/games/${row.id}/unhide`, {});
    const back = await fetch(`/play/${slug}`);
    if (back.status !== 200) t.problem('bug', `unhide: the page answers ${back.status}`);
    else t.event('unhidden', 'the world plays again');
  }
  t.progress(1);
  t.finish('done');
}
