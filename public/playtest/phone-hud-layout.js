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

    const veilBtn = await until(() => $('.hp-enter button') || (win.HawkesPlay && win.HawkesPlay.game && win.HawkesPlay.game.overseer && win.HawkesPlay.game.overseer.introPlaying), 20000, `${label}: veil or intro`)
      .then(() => $('.hp-enter button'), () => null);
    if (veilBtn) {
      tap(veilBtn, win);
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
      tap(btn, win);
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
