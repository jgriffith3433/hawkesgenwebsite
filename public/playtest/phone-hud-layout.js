// The `phone-hud-layout` scenario: the sandbox HUD on a phone (390x844 portrait and 844x390 short landscape).
// Loaded by portal.js. Each size is a same-origin iframe of exactly that width and height (like site-layout), so media
// queries and the touch layout are the real ones. Checks: the top-right ☰ is ≥48 px and opens the game menu; Save /
// Build / Invite intents still work when clicked; the open mirror sheet leaves the quest button and the move stick
// free; no HUD control under 44 px or cut off by the edge.
export const PHONE_HUD_LAYOUT = {
  id: 'phone-hud-layout',
  title: 'Phone HUD: one ≥48 px menu opens the game menu; the mirror is a bottom sheet (portrait) or narrow side sheet (landscape) that leaves the quest and the stick free',
  seconds: 420,
  tags: ['full'],
  description: 'for each of 390x844 and 844x390 (an iframe of that size with /play/sandbox?touch=1): veil, skip the intro, the mirror opens; sheet open and closed screenshots; the quest button and the move stick stay clear of the sheet and usable; the ☰ is ≥48 px and one tap opens the game menu; Save / Build / Invite intents still work. options: sizes (default ["390x844","844x390"]), frames (false: the browser\'s own window once)',
};

const SIZES = ['390x844', '844x390'];
const MIN = 44;
const MENU_MIN = 48;

export async function runPhoneHudLayout(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : SIZES).map(String);
  const framed = options.frames !== false;
  t.event('plan', `phone-hud-layout: ${sizes.join(', ')}${framed ? ' (iframe each)' : ' (browser window)'}`);
  t.progress(0.02);
  const failed = [];
  for (let i = 0; i < sizes.length; i++) {
    const [w, h] = sizes[i].split('x').map(Number);
    if (!(w > 0 && h > 0)) throw new Error(`bad size "${sizes[i]}"`);
    const bad = await oneSize(t, { w, h, label: sizes[i], framed });
    if (bad.length) failed.push(`${sizes[i]}: ${bad.join('; ')}`);
    t.progress(0.05 + 0.9 * ((i + 1) / sizes.length));
  }
  document.getElementById('pt-phone-hud')?.remove();
  if (failed.length) {
    t.event('phone-hud-failed', failed.join(' | '));
    throw new Error(`phone-hud: ${failed.join(' | ')}`);
  }
  t.event('phone-hud-ok', `menu, sheet clearance and 44 px taps at ${sizes.join(', ')}`);
  t.finish('done');
}

async function oneSize(t, { w, h, label, framed }) {
  const bad = [];
  let stage = null, frame = null, win = window, doc = document;
  if (framed) {
    document.getElementById('pt-phone-hud')?.remove();
    stage = document.createElement('div');
    stage.id = 'pt-phone-hud';
    stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0a0e18;overflow:hidden';
    frame = document.createElement('iframe');
    const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
    frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;background:#000;transform:scale(${scale});transform-origin:0 0`;
    frame.setAttribute('allow', 'autoplay; fullscreen');
    stage.append(frame);
    document.body.appendChild(stage);
    await new Promise((res, rej) => {
      frame.onload = res;
      frame.onerror = () => rej(new Error(`${label}: sandbox did not load`));
      frame.src = '/play/sandbox?touch=1';
    });
    win = frame.contentWindow;
    doc = win.document;
    try { frame.focus(); win.focus(); } catch { /* fine */ }
    // Native share leaves no toast to measure: force the copy-toast path for Invite.
    try { Object.defineProperty(win.navigator, 'share', { configurable: true, value: undefined }); } catch {
      try { win.navigator.share = undefined; } catch { /* fine */ }
    }
  }
  const $ = (sel, root = doc) => root.querySelector(sel);
  const $$ = (sel, root = doc) => [...root.querySelectorAll(sel)];
  const wait = (ms) => t.wait(ms);
  const until = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (fn()) return true; } catch { /* not yet */ }
      await wait(200);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  try {
    await until(() => {
      const H = win.HawkesPlay;
      return H && H.world && H.world.player && H.world.player.alive;
    }, 120000, `${label}: the island to load`);
    t.event('world-ready', label);

    const gate = await until(() =>
      $('.hp-title [data-prompt], .hp-title [data-play], .hp-title [data-continue], .hp-enter button')
      || (win.HawkesPlay && win.HawkesPlay.game && win.HawkesPlay.game.overseer && (win.HawkesPlay.game.overseer.titlePlaying || win.HawkesPlay.game.overseer.introPlaying)),
    20000, `${label}: title, veil or intro`).then(() =>
      $('.hp-title [data-prompt], .hp-title [data-play], .hp-title [data-continue], .hp-enter button'),
    () => null);
    if (gate && gate.closest && gate.closest('.hp-title')) {
      const prompt = $('.hp-title [data-prompt]');
      if (prompt && !prompt.hidden) tap(prompt, win);
      await until(() => $('.hp-title [data-play], .hp-title [data-continue]'), 8000, `${label}: title Play`);
      const play = $('.hp-title [data-continue], .hp-title [data-play]');
      if (play) tap(play, win);
      await until(() => !$('.hp-title'), 10000, `${label}: title to leave`);
      t.event('veil-passed', label);
    } else if (gate) {
      tap(gate, win);
      await until(() => !$('.hp-enter'), 10000, `${label}: veil to leave`);
      t.event('veil-passed', label);
    }

    // Skip the intro with a real pointer into the game (keys alone often miss an unfocused iframe).
    const introing = await until(() => {
      const g = win.HawkesPlay && win.HawkesPlay.game && win.HawkesPlay.game.overseer;
      return (g && g.introPlaying) || $('.mr .mr-q');
    }, 45000, `${label}: intro or mirror`).then(() => true, () => false);
    if (!$('.mr') && introing) {
      await wait(600);
      tapCanvas(win, doc);
      win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      win.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      t.event('intro-skipped', label);
    }

    const mirrorOk = await until(() => $('.mr .mr-q'), 60000, `${label}: the mirror to open`).then(() => true, () => false);
    if (!mirrorOk) {
      // Short landscape sometimes finishes the intro without auto-opening: open the questions anywhere.
      try {
        const g = win.HawkesPlay && win.HawkesPlay.game;
        if (g && g.mirror && g.mirror.dress) g.mirror.dress();
      } catch { /* fine */ }
      await until(() => $('.mr .mr-q'), 15000, `${label}: mirror via dress()`);
      t.event('mirror-forced', label);
    }
    await wait(600);
    const HL = win.HawkesPlay && win.HawkesPlay.hudLayout;
    if (HL && HL.refresh) HL.refresh();
    await wait(100);

    // Compact must come from the real viewport / resize — never forced.
    if (!HL || !HL.compact(w, h)) bad.push(`${label}: compact(${w},${h}) should be true`);
    if (!doc.body.classList.contains('hl-compact')) bad.push(`${label}: body.hl-compact not set after refresh (got ${win.innerWidth}x${win.innerHeight})`);

    const sheetKind = HL && HL.sheet ? HL.sheet(w, h) : null;
    t.event('sheet-mode', `${label}: ${sheetKind || 'none'}`);
    if (sheetKind !== (h < 500 ? 'side' : 'bottom')) bad.push(`${label}: expected ${h < 500 ? 'side' : 'bottom'} sheet, got ${sheetKind}`);

    // Stick must be free while the intro mirror is open (quest chrome often waits for the tour).
    t.scene(`Phone ${label}: mirror open`);
    const openClear = clearance(doc, win, label, { needQuest: false, needStick: true });
    for (const b of openClear.bad) bad.push(b);
    if (!openClear.bad.length) t.event('sheet-clear', `${label}: stick free of the mirror`);
    const zoneClear = questZoneFree(doc, win, label);
    for (const b of zoneClear) bad.push(b);
    if (!zoneClear.length) t.event('quest-zone-free', `${label}: top-left quest zone clear of the sheet`);
    t.event('hud-measured-open', `${label}: stick=${openClear.stick ? 'yes' : 'no'}`);

    for (const s of undersized(doc, MIN)) bad.push(`${label} open: ${s}`);
    if (!undersized(doc, MIN).length) t.event('taps-ok-open', `${label}: no control under ${MIN} px`);

    // --- actions menu while the mirror is still open (avoids the post-mirror account-gate race) ---
    const acts = $('.gs-acts');
    if (!acts) { bad.push(`${label}: no .gs-acts`); return bad; }
    if (!doc.body.classList.contains('hl-compact')) bad.push(`${label}: hl-compact missing with mirror open`);

    const more = acts.querySelector('.more, [data-menu]');
    if (!more) { bad.push(`${label}: no menu button`); return bad; }
    if (!visible(more)) bad.push(`${label}: menu button not visible`);
    const mr = more.getBoundingClientRect();
    if (mr.width < MENU_MIN - 0.5 || mr.height < MENU_MIN - 0.5) bad.push(`${label}: menu ${Math.round(mr.width)}x${Math.round(mr.height)} under ${MENU_MIN} px`);
    else t.event('menu-button', `${label}: ${Math.round(mr.width)}x${Math.round(mr.height)}`);

    // Only one top-right control when folded (Journal is hidden on compact).
    const jr = $('.jr-btn');
    if (jr && visible(jr)) bad.push(`${label}: Journal still showing beside the menu on compact`);

    const intentsClosed = $$('[data-intent]', acts).filter((b) => visible(b));
    if (intentsClosed.length) bad.push(`${label}: ${intentsClosed.length} intents still showing with the menu closed`);
    else t.event('menu-folded', `${label}: intents hidden behind the menu`);

    // ☰ opens the game menu (modules/gamemenu), not the old actions fold.
    tap(more, win);
    await wait(350);
    const GM = win.HawkesPlay && win.HawkesPlay.gameMenu;
    const menuOpen = GM && GM.isOpen && GM.isOpen();
    const panel = $('.gm-panel');
    if (!menuOpen || !panel) {
      bad.push(`${label}: tapping the menu did not open the game menu`);
    } else {
      const items = $$('.gm-btn', panel).map((b) => b.textContent.trim());
      if (!items.some((l) => /Invite a friend/.test(l))) bad.push(`${label}: game menu missing Invite a friend`);
      else t.event('menu-open', `${label}: game menu (${items.length} items)`);
      t.scene(`Phone ${label}: game menu open`);
      if (GM.close) GM.close();
      await wait(250);
    }

    for (const intent of ['save', 'build', 'invite']) {
      dismissOverlays(doc, win);
      if (GM && GM.isOpen && GM.isOpen() && GM.close) { GM.close(); await wait(200); }
      const btn = acts.querySelector(`[data-intent="${intent}"]`);
      if (!btn) { bad.push(`${label}: ${intent} intent missing from .gs-acts`); continue; }
      // Intents stay in the DOM on compact (hidden); click them directly to check Save/Build/Invite still work.
      const tapAt = Date.now();
      tap(btn, win);
      if (intent === 'save' || intent === 'build') {
        // As a guest the account sheet opens at once, before any network call (finding f_a02d45284afc).
        const shown = await until(() => $('.gs-veil .gs-sheet'), 1500, `${label}: the account sheet after ${intent}`).then(() => true, () => false);
        const ms = Date.now() - tapAt;
        if (!shown || ms > 1000) bad.push(`${label}: ${intent} as a guest opened the account sheet in ${shown ? ms : '>1500'} ms (should be under 1000)`);
        else t.event('guest-sheet-fast', `${label}: ${intent} → account sheet in ${ms} ms`);
      }
      await wait(700);
      if (intent === 'invite') {
        const linkToast = $('[data-invite="link"], .gs-toast[data-invite]');
        const anyInviteToast = $$('.gs-toast', doc).find((el) => /link|invite|copied/i.test(el.textContent || '') || el.dataset.invite);
        if (!linkToast && !anyInviteToast) {
          bad.push(`${label}: invite did not show a link toast (share/copy outcome missing)`);
        } else {
          t.event('action-tapped', `${label}: invite → toast`);
          for (const s of overlayTaps(doc, MIN)) bad.push(`${label} invite: ${s}`);
        }
        dismissOverlays(doc, win);
      } else {
        const sheet = $('.gs-veil .gs-sheet, .gs-sheet');
        const fullToast = $('[data-games-full], .gs-toast[data-games-full]');
        const saved = acts.querySelector('[data-intent="save"]');
        const savedFlash = saved && /Saved/i.test(saved.textContent || '');
        if (sheet) {
          t.event('action-tapped', `${label}: ${intent} → sheet`);
          for (const s of overlayTaps(doc, MIN)) bad.push(`${label} ${intent}: ${s}`);
          dismissOverlays(doc, win);
        } else if (fullToast) {
          t.event('action-tapped', `${label}: ${intent} → games-full toast`);
          for (const s of overlayTaps(doc, MIN)) bad.push(`${label} ${intent}: ${s}`);
          dismissOverlays(doc, win);
        } else if (intent === 'save' && savedFlash) {
          t.event('action-tapped', `${label}: save → saved`);
        } else if (intent === 'build' && /\/app\/g\//.test(String(win.location && win.location.href))) {
          t.event('action-tapped', `${label}: build → editor`);
          bad.push(`${label}: build navigated away from the sandbox (signed-in island); expected sheet or toast in this scenario`);
        } else {
          bad.push(`${label}: ${intent} did not open the account sheet (or a signed-in save/toast)`);
        }
      }
      await wait(200);
    }
    t.event('actions-tapped', `${label}: save, build, invite`);

    // --- Save, signed in (named setup shortcut: Google sign-in cannot be scripted), with the network cut and then with no live room ---
    try { await saveSignedIn(t, { win, doc, label, bad, $, until, wait }); } catch (e) { bad.push(`${label}: save checks: ${e && e.message ? e.message : e}`); }

    // Close the mirror and re-check clearance with quest chrome if the tour is up.
    dismissOverlays(doc, win);
    const x = $('.mr .mr-x');
    if (x) tap(x, win);
    else win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => !$('.mr'), 10000, `${label}: the mirror to close`).catch(() => {});
    await wait(400);
    // Closing may open a forced account sheet (tour gate): put it away when it is not forced, else leave via playtest helper.
    dismissOverlays(doc, win);
    t.scene(`Phone ${label}: mirror closed`);
    t.event('mirror-closed', label);

    // Re-open the mirror after actions (quest chrome may be up).
    try {
      const g = win.HawkesPlay && win.HawkesPlay.game;
      if (g && g.mirror && g.mirror.dress) g.mirror.dress();
    } catch { /* fine */ }
    const reopened = await until(() => $('.mr .mr-q'), 8000, `${label}: mirror reopen`).then(() => true, () => false);
    if (reopened) {
      await wait(400);
      if (HL && HL.refresh) HL.refresh();
      t.scene(`Phone ${label}: mirror open again`);
      const again = clearance(doc, win, label, { needQuest: Boolean($('.qs-btn, .tour-stuck, .tour-track, .qs-track')), needStick: true });
      for (const b of again.bad) bad.push(b);
      if (!again.bad.length) t.event('sheet-clear-again', `${label}: stick${again.quest ? ' and quest' : ''} free`);
      for (const b of questZoneFree(doc, win, label)) bad.push(b);
      const xx = $('.mr .mr-x');
      if (xx) tap(xx, win);
      await until(() => !$('.mr'), 8000, `${label}: mirror close again`).catch(() => {});
      dismissOverlays(doc, win);
    } else t.event('mirror-reopen-skipped', label);

    for (const s of undersized(doc, MIN)) bad.push(`${label} closed: ${s}`);
    if (!undersized(doc, MIN).length) t.event('taps-ok-closed', `${label}: no control under ${MIN} px`);

  } catch (e) {
    bad.push(String(e && e.message ? e.message : e));
    t.problem('error', `${label}: ${e && e.message ? e.message : e}`);
  }
  return bad;
}

function tap(el, win) {
  if (!el) return;
  try {
    el.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1 }));
    el.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1 }));
  } catch {
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); } catch { /* fine */ }
  }
  try { el.click(); } catch { /* fine */ }
}

function tapCanvas(win, doc) {
  const canvas = doc.querySelector('canvas');
  const target = canvas || doc.body;
  try {
    const r = target.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height * 0.4, 120);
    target.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y }));
    target.dispatchEvent(new win.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y }));
  } catch {
    try { win.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 1 })); } catch { /* fine */ }
  }
}

/** Close account sheets / toasts that would block the next tap. Forced sheets use playtestContinue when present. */
function dismissOverlays(doc, win) {
  try {
    if (win.HawkesGuest && typeof win.HawkesGuest.playtestContinue === 'function') win.HawkesGuest.playtestContinue();
    else if (win.HawkesGuest && typeof win.HawkesGuest._dismissSheet === 'function') win.HawkesGuest._dismissSheet();
  } catch { /* fine */ }
  for (const v of doc.querySelectorAll('.gs-veil')) {
    const back = v.querySelector('[data-back]');
    if (back) { try { back.click(); } catch { /* fine */ } }
    else try { v.remove(); } catch { /* fine */ }
  }
  for (const t of doc.querySelectorAll('.gs-toast[data-games-full], .gs-toast[data-invite]')) {
    const x = t.querySelector('[data-x]');
    if (x) try { x.click(); } catch { /* fine */ }
    else try { t.remove(); } catch { /* fine */ }
  }
}

function visible(el) {
  if (!el || !el.getClientRects || !el.getClientRects().length) return false;
  try {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
  } catch { return false; }
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

function hits(a, b) {
  return a && b && a.right > b.left + 2 && a.left < b.right - 2 && a.bottom > b.top + 2 && a.top < b.bottom - 2;
}

function clearance(doc, win, label, { needQuest, needStick }) {
  const bad = [];
  const panel = doc.querySelector('.mr');
  const pr = panel ? panel.getBoundingClientRect() : null;
  const quest = doc.querySelector('.qs-btn, .tour-stuck, .tour-track, .qs-track');
  const stick = doc.querySelector('#touch .pad');
  if (needQuest) {
    if (!quest || !visible(quest)) bad.push(`${label}: quest button not visible with the sheet open`);
    else if (pr && hits(quest.getBoundingClientRect(), pr)) bad.push(`${label}: quest runs under the mirror sheet`);
  }
  if (needStick) {
    if (!stick || !visible(stick)) bad.push(`${label}: move stick not visible with the sheet open`);
    else if (pr && hits(stick.getBoundingClientRect(), pr)) bad.push(`${label}: stick runs under the mirror sheet`);
  }
  for (const [name, el, want] of [['quest', quest, needQuest], ['stick', stick, needStick]]) {
    if (!want || !el || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const mx = Math.min(Math.max(r.left + r.width / 2, 0), win.innerWidth - 1);
    const my = Math.min(Math.max(r.top + r.height / 2, 0), win.innerHeight - 1);
    const top = doc.elementFromPoint(mx, my);
    if (top && panel && (top === panel || panel.contains(top))) bad.push(`${label}: ${name} covered by the sheet at its centre`);
  }
  return { bad, quest: quest && visible(quest), stick: stick && visible(stick) };
}

/** The top-left band reserved for quest chrome must stay clear of the sheet (even before the tour shows a button). */
function questZoneFree(doc, win, label) {
  const bad = [];
  const panel = doc.querySelector('.mr');
  if (!panel) return bad;
  const pr = panel.getBoundingClientRect();
  const tl = doc.getElementById('tl-tl');
  let zone;
  if (tl) zone = tl.getBoundingClientRect();
  else zone = { left: 0, top: 0, right: Math.min(220, win.innerWidth * 0.5), bottom: Math.min(120, win.innerHeight * 0.25), width: 220, height: 120 };
  if (hits(zone, pr)) bad.push(`${label}: mirror sheet overlaps the top-left quest zone`);
  return bad;
}

function undersized(doc, min) {
  const out = [];
  const sels = [
    '.gs-acts .more', '.gs-acts.open [data-intent]', '.qs-btn', '.tour-stuck',
    '#tl-hide', '#touch .a', '#touch .b', '#touch .pad',
    '.mr-x', '.mr-btn', '.mr-btn.go', '.mr-sw', '.mr-chip', '.mr-card',
  ];
  for (const sel of sels) {
    for (const el of doc.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < min - 0.5 || r.height < min - 0.5) out.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
      const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        out.push(`${sel} cut off (${Math.round(r.left)}..${Math.round(r.right)})`);
      }
    }
  }
  return out;
}

/** Account sheet / toast CTAs must stay ≥44 px and inside the viewport (finding f_1f4102467ade). */
function overlayTaps(doc, min) {
  const out = [];
  const sels = [
    '.gs-sheet .go', '.gs-sheet .google', '.gs-sheet .back', '.gs-sheet [data-back]',
    '.gs-toast button', '.gs-toast a.primary', '.gs-toast [data-x]',
  ];
  const vw = doc.documentElement.clientWidth, vh = doc.documentElement.clientHeight;
  for (const sel of sels) {
    for (const el of doc.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < min - 0.5 || r.height < min - 0.5) out.push(`${sel} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (r.left < -1 || r.top < -1 || r.right > vw + 1 || r.bottom > vh + 1) {
        out.push(`${sel} cut off (${Math.round(r.left)}..${Math.round(r.right)} in ${vw}x${vh})`);
      }
    }
  }
  return out;
}

/** Signed in (a named `setup-shortcut`: the page is told who it is, as /v1/users/me would), Save by touch:
 *  1. network cut (requests hang until the page's own AbortController gives up): within 16 s one plain error with Try again,
 *     no "Keeping your island…" left, no raw error text, every request aborted at 15 s;
 *  2. the server answers but has no live room: "Saved. Friends can't join right now.", one line, no error text;
 *  3. an island already kept, the network cut: Save says it did not work, with Try again (a blink would be a lie). */
async function saveSignedIn(t, { win, doc, label, bad, $, until, wait }) {
  const G = win.HawkesGuest;
  dismissOverlays(doc, win);
  if (!G || typeof G.playtestSignedIn !== 'function' || !G.playtestSignedIn({ name: 'Playtest' })) { t.event('save-signed-in-skipped', `${label}: no playtest sign-in here`); return; }
  t.event('setup-shortcut', `${label}: acting as signed in (HawkesGuest.playtestSignedIn)`);
  const realFetch = win.fetch.bind(win);
  const api = (u) => /\/v1\//.test(String(u && u.url ? u.url : u));
  const log = [];
  let mode = 'cut';
  win.fetch = (u, init = {}) => {
    const url = String(u && u.url ? u.url : u);
    if (!api(url) || /\/v1\/(analytics|health)/.test(url)) return realFetch(u, init);
    const method = (init.method || 'GET').toUpperCase();
    if (mode === 'cut') {
      const at = Date.now();
      return new Promise((_res, rej) => {
        const sig = init.signal;
        const abort = () => { log.push({ method, url, ms: Date.now() - at, aborted: true }); rej(new DOMException('aborted', 'AbortError')); };
        if (sig) { if (sig.aborted) abort(); else sig.addEventListener('abort', abort, { once: true }); } // (no signal: it hangs for good)
      });
    }
    const json = (body, status = 200) => Promise.resolve(new win.Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
    if (/\/v1\/users\/me/.test(url) && method === 'GET') return json({ user: { id: 'usr_playtest', credits: 0, name: 'Playtest' } });
    if (method === 'POST' && /\/v1\/games$/.test(url)) return json({ id: 'g_playtest' });
    if (method === 'POST' && /\/scene$/.test(url)) return json({ rev: 1 });
    if (method === 'POST') return json({ ok: true });
    if (/\/bundle$/.test(url)) return json({ error: 'no live room' }, 503);
    return json({});
  };
  const sheetOf = () => $('.gs-veil [data-save-failed], [data-save-failed]');
  const text = () => (doc.body.innerText || '');
  const rawError = /TypeError|AbortError|Failed to fetch|NetworkError|undefined|\[object|status \d|HTTP \d/i;
  try {
    const save = () => doc.querySelector('.gs-acts [data-intent="save"]');
    // 1. network cut
    mode = 'cut';
    const t0 = Date.now();
    tap(save(), win);
    await wait(600);
    const busyShown = Boolean($('[data-save-busy]'));
    t.event('keeping-toast', `${label}: "Keeping your island…" ${busyShown ? 'shown' : 'not shown'} while waiting`);
    t.scene(`Phone ${label}: saving, network cut`);
    await until(() => sheetOf(), 16000, `${label}: the save error with the network cut`).catch((e) => { bad.push(`${label}: ${e.message}`); });
    const took = Date.now() - t0;
    const sh = sheetOf();
    if (sh) {
      const retry = sh.querySelector('[data-retry]');
      if (!retry || !/try again/i.test(retry.textContent)) bad.push(`${label}: save error has no Try again`);
      if (rawError.test(sh.textContent)) bad.push(`${label}: raw error text in the save error: "${sh.textContent.trim().slice(0, 120)}"`);
      if (took > 16000) bad.push(`${label}: save error came after ${took} ms (over 16 s)`);
      t.event('save-error-shown', `${label}: plain error with Try again after ${took} ms`);
      t.scene(`Phone ${label}: save failed, Try again`);
      for (const s of overlayTaps(doc, MIN)) bad.push(`${label} save error: ${s}`);
    }
    if ($('[data-save-busy]') || /Keeping your island/.test(text())) bad.push(`${label}: "Keeping your island…" still on screen after the error`);
    else t.event('no-keeping-toast', `${label}: no "Keeping your island…" toast left`);
    const gamesReq = log.find((r) => r.method === 'POST' && /\/v1\/games$/.test(r.url));
    if (!gamesReq) bad.push(`${label}: POST /v1/games was not aborted by the page`);
    else if (gamesReq.ms < 14000 || gamesReq.ms > 16500) bad.push(`${label}: POST /v1/games aborted after ${gamesReq.ms} ms (expected the 15 s timeout)`);
    else t.event('request-aborted', `${label}: ${log.length} request(s) aborted; POST /v1/games at ${gamesReq.ms} ms`);
    dismissOverlays(doc, win);

    // 2. a server that answers, with no live room
    mode = 'ok';
    tap(save(), win);
    const gotNote = await until(() => [...doc.querySelectorAll('.gs-toast')].some((n) => /Saved/.test(n.textContent)), 8000, `${label}: Saved after a save with no live room`).then(() => true, () => false);
    if (!gotNote) bad.push(`${label}: no "Saved" line after a save with no live room`);
    else {
      const lines = [...doc.querySelectorAll('.gs-toast')].filter((n) => /Saved/.test(n.textContent)).map((n) => n.textContent.trim());
      if (lines.length !== 1 || lines[0] !== "Saved. Friends can't join right now.") bad.push(`${label}: expected the one line "Saved. Friends can't join right now.", got ${JSON.stringify(lines)}`);
      else t.event('saved-no-live-room', `${label}: ${lines[0]}`);
      if (rawError.test(text()) || /no live room/i.test(text())) bad.push(`${label}: raw error text on screen with no live room`);
      t.scene(`Phone ${label}: saved, no live room`);
    }
    await wait(3600);

    // 3. kept island, network cut
    mode = 'cut';
    const t1 = Date.now();
    tap(save(), win);
    await until(() => sheetOf(), 16000, `${label}: the save error on a kept island`).then(() => t.event('save-error-kept', `${label}: ${Date.now() - t1} ms`), (e) => { bad.push(`${label}: ${e.message}`); });
    dismissOverlays(doc, win);
  } finally {
    win.fetch = realFetch;
    try { win.localStorage.removeItem('hg_sandbox_island'); win.localStorage.removeItem('hg_sandbox_return'); } catch { /* fine */ }
  }
}
