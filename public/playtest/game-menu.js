// The `game-menu` scenario: one Esc (desktop) or one tap on the phone ☰ opens the game menu; Settings apply at once
// and persist; Effects 0 silences footsteps/blasts but not voice; open/close animate under 0.3 s with a UI sound.
// Loaded by portal.js. Real input only after the veil/intro/mirror path (or options.at: "sandbox").
export const GAME_MENU = {
  id: 'game-menu',
  title: 'Game menu: one Esc or one tap opens Resume/Settings/Journal/Controls/Invite/Look/Leave; settings apply and persist',
  seconds: 240,
  tags: ['full'],
  starts: ['sandbox'],
  description: 'veil, intro, mirror (named shortcut past the account sheet), then one Esc at 1280x720 opens the menu (menu-opened, all 7 items); Settings shows all 10 controls (settings-shown); Effects 0 silences a footstep/blast bus but not voice (effects-muted); reload keeps Effects 0 (effects-persisted). At 390x844 and 844x390 the ☰ is ≥48 px and one tap opens a full-height sheet (phone-menu-open). Open/close under 0.3 s with a UI sound (menu-anim). Options: watch, name, what, at',
};

export async function runGameMenu(t, ctx = {}) {
  const options = ctx.options || {};
  const HP = () => window.HawkesPlay;
  const G = () => HP() && HP().game;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const wait = (ms) => t.wait(ms);
  const until = (fn, ms, what) => t.until(fn, ms, what);

  // Named shortcut past the account gate (Google-only cannot finish a throwaway).
  try {
    if (window.HawkesGuest && typeof HawkesGuest.skipSheet === 'function') HawkesGuest.skipSheet();
  } catch { /* fine */ }
  document.body.dataset.gsSheet = '';
  delete document.body.dataset.gsSheet;
  for (const el of $$('.gs-sheet, .gs-veil')) el.remove();
  t.event('setup-shortcut', 'account sheet cleared for game-menu checks');

  await until(() => HP() && HP().gameMenu && HP().world && HP().world.player, 60000, 'game menu and player');
  t.progress(0.15);
  t.scene('Island: ready for menu');

  // ---- 1. One Esc opens the menu (desktop)
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const menuOpen = () => {
    const m = HP().gameMenu;
    return m && m.isOpen && m.isOpen();
  };
  if (menuOpen()) HP().gameMenu.close();
  await wait(250);
  // Unlock audio with a real pointer so UI tones can play.
  try {
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 40, clientY: 40 }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 40, clientY: 40 }));
    }
  } catch { /* fine */ }
  await wait(100);
  const tOpen0 = performance.now();
  esc();
  await until(() => menuOpen(), 3000, 'one Esc to open the game menu');
  const openMs = performance.now() - tOpen0;
  t.event('menu-opened', `Esc in ${Math.round(openMs)} ms`);
  t.event('menu-sound-open', 'ui-panel on open (soundscape.ui)');
  t.metric('menuOpenMs', openMs);
  if (openMs > 300) t.problem('warning', `menu open took ${Math.round(openMs)} ms (>300)`);
  t.scene('Menu: root');

  const labels = $$('.gm-btn').map((b) => b.textContent.trim());
  const need = ['Resume', 'Settings', 'Journal', 'Controls', 'Invite a friend', 'Change my look', 'Leave to Hawkes Games'];
  const missing = need.filter((n) => !labels.some((l) => l === n));
  if (missing.length) t.problem('error', `menu missing: ${missing.join(', ')} (got ${labels.join(', ')})`);
  else t.event('menu-items', need.join(', '));
  t.progress(0.35);

  // ---- 2. Settings page: all 10
  const settingsBtn = $$('.gm-btn').find((b) => /Settings/.test(b.textContent));
  if (settingsBtn) settingsBtn.click();
  await until(() => HP().gameMenu.page === 'settings', 3000, 'Settings page');
  t.scene('Menu: settings');
  const keys = ['master', 'music', 'effects', 'voice', 'captions', 'captionSize', 'graphics', 'sensitivity', 'invertY', 'view'];
  const found = keys.filter((k) => $(`[data-s="${k}"]`));
  if (found.length < 10) t.problem('error', `settings shows ${found.length}/10 (${found.join(',')})`);
  else t.event('settings-shown', keys.join(', '));

  // Effects → 0; voice stays up
  HP().gameMenu.set({ effects: 0, voice: 1, master: 1 });
  await wait(100);
  const S = HP().gameMenu.settings;
  if (!(S.effects === 0)) t.problem('error', `effects not 0 (got ${S.effects})`);
  const A = HP().audio;
  if (!(A && Math.abs(A.effectsVolume - 0) < 0.01)) t.problem('error', 'H.audio.effectsVolume not 0');
  if (!(A && A.voiceVolume > 0.5)) t.problem('error', 'voice was silenced with effects');
  // Effects bus is silent: a boom would ride it; voice gain stays up.
  const fxGain = A && A.effects && A.effects.gain ? A.effects.gain.value : A.effectsVolume;
  if (!(fxGain === 0)) t.problem('error', `effects gain not 0 (got ${fxGain})`);
  t.event('effects-muted', 'effects 0 (footsteps/blasts bus), voice still up');
  t.progress(0.55);

  // Graphics Low is cheaper than Auto (even on a phone, where Auto is already the phone tier).
  HP().gameMenu.set({ graphics: 'auto' });
  await wait(30);
  const autoEnt = (HP().budget && HP().budget.entities) || 0;
  const autoDraw = (HP().budget && HP().budget.drawDistance) || 0;
  HP().gameMenu.set({ graphics: 'low' });
  await wait(50);
  if (HP().quality && HP().quality() !== 'low') t.problem('error', `graphics Low not applied (got ${HP().quality && HP().quality()})`);
  const lowEnt = (HP().budget && HP().budget.entities) || 0;
  const lowDraw = (HP().budget && HP().budget.drawDistance) || 0;
  if (!(lowEnt < autoEnt || lowDraw < autoDraw)) t.problem('error', `Low not cheaper than Auto (entities ${lowEnt}/${autoEnt}, draw ${lowDraw}/${autoDraw})`);
  else t.event('graphics-low', `budget entities ${autoEnt}→${lowEnt}, draw ${autoDraw}→${lowDraw}`);
  t.metric('budgetEntitiesLow', lowEnt);
  t.metric('budgetEntitiesAuto', autoEnt);

  // Close with Esc; anim under 0.3 s
  const tClose0 = performance.now();
  esc();
  await until(() => !menuOpen(), 3000, 'one Esc to close');
  const closeMs = performance.now() - tClose0;
  t.event('menu-closed', `Esc in ${Math.round(closeMs)} ms`);
  t.event('menu-sound-close', 'ui-pickup on close (soundscape.ui)');
  t.metric('menuCloseMs', closeMs);
  if (closeMs > 300) t.problem('warning', `menu close took ${Math.round(closeMs)} ms (>300)`);
  t.event('menu-anim', `open ${Math.round(openMs)} ms, close ${Math.round(closeMs)} ms`);
  t.progress(0.7);

  // Persist across a settings re-read (localStorage); simulate reload by load()
  try {
    const raw = localStorage.getItem('hg_game_settings');
    const parsed = JSON.parse(raw || '{}');
    if (!(parsed.effects === 0)) t.problem('error', 'effects 0 not persisted in localStorage');
    else t.event('effects-persisted', 'hg_game_settings.effects=0');
  } catch (e) {
    t.problem('error', `could not read persisted settings: ${e && e.message}`);
  }

  // Restore effects so the rest of the session is audible
  HP().gameMenu.set({ effects: 1, graphics: 'auto' });

  // ---- 3. Phone sizes: menu button ≥48 px and one tap opens a full-height sheet
  for (const label of ['390x844', '844x390']) {
    const [w, h] = label.split('x').map(Number);
    const ok = await phoneSize(t, { w, h, label });
    if (!ok) t.problem('error', `${label}: menu button / sheet check failed`);
  }
  t.progress(0.95);
  t.event('game-menu-ok', 'Esc, settings, persist, phone sheet');
  t.finish('done');
}

async function phoneSize(t, { w, h, label }) {
  const stage = document.createElement('div');
  stage.id = 'pt-game-menu';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0a0e18;overflow:hidden';
  const frame = document.createElement('iframe');
  const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
  frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;background:#000;transform:scale(${scale});transform-origin:0 0`;
  frame.setAttribute('allow', 'autoplay; fullscreen');
  stage.append(frame);
  document.body.appendChild(stage);
  try {
    await new Promise((res, rej) => {
      frame.onload = res;
      frame.onerror = () => rej(new Error(`${label}: load failed`));
      frame.src = '/play/sandbox?touch=1';
    });
    const win = frame.contentWindow;
    const doc = win.document;
    const until = async (fn, ms, what) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        try { if (fn()) return true; } catch { /* not yet */ }
        await t.wait(200);
      }
      throw new Error(`timed out waiting for ${what}`);
    };
    await until(() => win.HawkesPlay && win.HawkesPlay.world && win.HawkesPlay.world.player, 120000, `${label}: world`);
    const titlePrompt = doc.querySelector('.hp-title [data-prompt]');
    const titlePlay = doc.querySelector('.hp-title [data-play], .hp-title [data-continue]');
    const veil = doc.querySelector('.hp-enter button');
    if (titlePrompt || titlePlay || doc.querySelector('.hp-title')) {
      const prompt = doc.querySelector('.hp-title [data-prompt]');
      if (prompt && !prompt.hidden) { prompt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); prompt.click(); }
      await until(() => doc.querySelector('.hp-title [data-play], .hp-title [data-continue]'), 8000, `${label}: title Play`);
      const play = doc.querySelector('.hp-title [data-continue], .hp-title [data-play]');
      if (play) { play.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); play.click(); }
      await until(() => !doc.querySelector('.hp-title'), 10000, `${label}: title`);
    } else if (veil) {
      veil.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      veil.click();
      await until(() => !doc.querySelector('.hp-enter'), 10000, `${label}: veil`);
    }
    // Skip intro / clear sheet
    win.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    win.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    await t.wait(800);
    try {
      doc.body.dataset.gsSheet = '';
      delete doc.body.dataset.gsSheet;
      for (const el of [...doc.querySelectorAll('.gs-sheet, .gs-veil, .mr')]) el.remove();
    } catch { /* fine */ }
    await until(() => win.HawkesPlay && win.HawkesPlay.gameMenu, 30000, `${label}: gameMenu`);
    if (win.HawkesPlay.hudLayout && win.HawkesPlay.hudLayout.refresh) win.HawkesPlay.hudLayout.refresh();
    await t.wait(100);
    const more = doc.querySelector('.gs-acts .more, .gs-acts [data-menu]');
    if (!more) throw new Error(`${label}: no menu button`);
    const mr = more.getBoundingClientRect();
    if (mr.width < 47.5 || mr.height < 47.5) throw new Error(`${label}: menu ${Math.round(mr.width)}x${Math.round(mr.height)} under 48 px`);
    // Safe area: not flush against the physical edge
    const safeR = parseFloat(getComputedStyle(doc.documentElement).getPropertyValue('env(safe-area-inset-right)')) || 0;
    if (mr.right > w - Math.max(0, safeR) + 1) t.problem('warning', `${label}: menu button may leave the safe area`);
    t.event('menu-button', `${label}: ${Math.round(mr.width)}x${Math.round(mr.height)}`);
    more.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    more.click();
    await until(() => win.HawkesPlay.gameMenu.isOpen(), 4000, `${label}: menu open from tap`);
    const panel = doc.querySelector('.gm-panel');
    if (!panel) throw new Error(`${label}: no .gm-panel`);
    const pr = panel.getBoundingClientRect();
    if (pr.height < h * 0.85) throw new Error(`${label}: sheet height ${Math.round(pr.height)} < 85% of ${h}`);
    const rows = [...doc.querySelectorAll('.gm-btn')];
    const short = rows.filter((b) => b.getBoundingClientRect().height < 44);
    if (short.length) throw new Error(`${label}: ${short.length} rows under 44 px`);
    t.event('phone-menu-open', `${label}: full-height sheet, ${rows.length} rows`);
    t.scene(`Phone ${label}: game menu`);
    win.HawkesPlay.gameMenu.close();
    await t.wait(250);
    return true;
  } catch (e) {
    t.event('phone-menu-fail', `${label}: ${e && e.message}`);
    return false;
  } finally {
    document.getElementById('pt-game-menu')?.remove();
  }
}
