// The `sickofit-page` scenario: the Sick of It page before the game starts, at 390x844 and 1440x900 (an iframe each).
// Loaded by portal.js. Safe on live (read only). Events: premise-shown, controls-shown, guide-on-top, no-overlap, tap-reachable, tap-to-play-works, game-running, stayed-on-page, guide-gone, canvas-visible, no-landing-in-frame, frame-on-top, setup-shortcut, hud-reached, hud-clear.
export const SICKOFIT_PAGE = {
  id: 'sickofit-page', title: 'Sick of It page: premise and controls guide before the game; nothing over the canvas or Tap to play at 390px; Tap to play starts it', seconds: 420, tags: ['full'],
  description: '/play/sickofit in a frame at 390x844 (touch) and 1440x900: the premise line and move/rewind guide (premise-shown, controls-shown), the strip clear of Tap to play (no-overlap), the loader, strip and prompt clear of each other (no-overlap, guide-on-top, tap-reachable), then a tap on Tap to play (tap-to-play-works), the game running with the page still on /play/sickofit, and then the first level (played by the build itself through its menu, a named setup-shortcut), where no page text may sit over the HUD of the game (hud-reached, hud-clear). options: sizes, hud (false: stop at the main menu)',
};
const SHOT_MS = 2500;
const rect = (e) => e.getBoundingClientRect();
const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
export async function runSickofitPage(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : ['390x844', '1440x900']).map(String);
  const bad = [];
  // A wait of minutes with nothing logged reads as a softlock to the contract (stallSeconds 120), which ends the run as stuck and
  // lets the runner photograph whatever page is behind the frame. Progress ticks keep a long wait what it is: a wait.
  const beat = setInterval(() => t.progress(0.5), 10000);
  let stageGuard = null; const stageLost = [];
  // The host page is the landing page the run started on. A picture of it is what a "the game navigated away" report is made of,
  // so nothing of it may show behind the frame, and a host that was reloaded mid-run (its sky was fresh in the pictures) is named.
  const hostMark = (window.__ptSoHost = {});
  const hideHost = () => { for (const el of document.body.children) if (el.id !== 'pt-so-stage' && !el.dataset.ptSoHid) { el.dataset.ptSoHid = el.style.visibility || '-'; el.style.visibility = 'hidden'; } };
  for (const label of sizes) {
    const [w, h] = label.split('x').map(Number);
    document.getElementById('pt-so-stage')?.remove();
    const stage = document.createElement('div');
    stage.id = 'pt-so-stage';
    stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c';
    const frame = document.createElement('iframe');
    const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
    frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;transform:scale(${scale});transform-origin:0 0`;
    stage.appendChild(frame); document.body.appendChild(stage);
    hideHost();
    // Whatever replaces or reloads the host page, the game's frame stays the top layer of what is photographed: if the stage is
    // taken out of the page, it goes back in (a re-added frame reloads its page, which the warning names).
    stageGuard?.disconnect();
    stageGuard = new MutationObserver(() => { if (!stage.isConnected && document.body) { stageLost.push(label); document.body.appendChild(stage); hideHost(); } });
    stageGuard.observe(document.body, { childList: true });
    frame.src = '/play/sickofit' + (w < 500 ? '?touch=1' : '');
    await t.until(() => { try { return frame.contentDocument.getElementById('pre'); } catch { return false; } }, 30000, `the page at ${label}`);
    const d = frame.contentDocument, win = frame.contentWindow;
    // The Tap to play prompt comes from the build host's hawkes-sound.js, after build.json: wait for it (a page where it
    // never loads is a failure too: nothing to tap).
    await t.until(() => d.getElementById('hawkes-tap') && rect(d.getElementById('hawkes-tap')).height > 0, 30000, `Tap to play at ${label}`);
    await t.wait(1500);
    const vis = (s) => { const e = d.querySelector(s); return e && win.getComputedStyle(e).display !== 'none' && rect(e).height > 0 ? e : null; };
    const prem = vis('#pre .premise');
    if (prem && prem.textContent.trim().length > 20) t.event('premise-shown', `${label}: "${prem.textContent.trim()}"`); else bad.push(`${label}: no premise`);
    const ctl = vis('#pre .touch') || vis('#pre .kbd');
    if (ctl && /move/i.test(ctl.textContent) && /rewind/i.test(ctl.textContent)) t.event('controls-shown', `${label}: ${ctl.textContent.trim()}`); else bad.push(`${label}: no move/rewind guide`);
    // The premise and guide must be what the player sees: on top of the prompt's opaque layer, not hidden under it.
    // elementFromPoint skips pointer-events:none, which the strip has (so it never takes a tap): let it be hit for the
    // probe only, so "shown" and "on top" are the same question asked of the same layers.
    const strip0 = d.getElementById('pre'), pe = strip0.style.pointerEvents;
    strip0.style.pointerEvents = 'auto';
    const topAt = (e) => { const r = rect(e); const hitEl = d.elementFromPoint(Math.round((r.left + r.right) / 2), Math.round((r.top + r.bottom) / 2)); return hitEl && hitEl.closest('#pre'); };
    const onTop = prem && ctl && topAt(prem) && topAt(ctl);
    const fs = (e) => parseFloat(win.getComputedStyle(e).fontSize);
    strip0.style.pointerEvents = pe;
    if (onTop) t.event('guide-on-top', `${label}: premise and guide are drawn above the prompt (${fs(prem)}px / ${fs(ctl)}px text)`); else bad.push(`${label}: premise or guide hidden under another layer`);
    if (w < 500 && (fs(prem) < 14 || fs(ctl) < 14)) bad.push(`${label}: text under 14px (${fs(prem)} / ${fs(ctl)})`);
    t.scene(`Sick of It ${label}: before play`);
    // The runner's screenshot for a scene is taken a moment after the event, not at it: hold still until it has been taken,
    // or the picture shows what comes next (the tap's loading bar at 390; at 1440 the page behind this frame) and the
    // premise, the guide and the prompt never appear in it.
    await t.wait(SHOT_MS);
    // Every visible piece of the page against every other: the strip, the prompt's logo, button and caption, and what the
    // loader still draws (its bar and, only if the prompt failed, its title), the canvas being a full-screen backdrop that
    // only the prompt and this strip sit on. Nothing may overlap, and everything stays inside the window.
    const pieces = [
      ...['#pre .premise', '#pre .kbd', '#pre .touch'].map((s) => [s, vis(s)]),
      ...['#hawkes-tap h1', '#hawkes-tap button', '#hawkes-tap p', '#loading h1', '#loading #bar'].map((s) => [s, vis(s)]),
    ].filter(([, e]) => e);
    const clash = [];
    for (let i = 0; i < pieces.length; i++) {
      const [n, e] = pieces[i], r = rect(e);
      if (r.left < -1 || r.right > w + 1 || r.top < -1 || r.bottom > h + 1) clash.push(`${n} outside the window`);
      for (let j = i + 1; j < pieces.length; j++) if (hit(r, rect(pieces[j][1]))) clash.push(`${n} over ${pieces[j][0]}`);
    }
    const names = pieces.map(([n]) => n);
    if (!names.includes('#hawkes-tap button')) clash.push('no Tap to play button');
    if (!clash.length) t.event('no-overlap', `${label}: ${pieces.length} pieces (${names.join(', ')}) clear of each other and inside ${w}x${h}`); else bad.push(`${label}: ${clash.join('; ')}`);
    const tapBtn = d.querySelector('#hawkes-tap button') || d.getElementById('hawkes-tap');
    const tr = rect(tapBtn);
    const topEl = d.elementFromPoint(Math.round((tr.left + tr.right) / 2), Math.round((tr.top + tr.bottom) / 2));
    if (topEl && topEl.closest('#hawkes-tap')) t.event('tap-reachable', `${label}: Tap to play is the top layer at its centre, ${Math.round(tr.width)}x${Math.round(tr.height)}px`); else bad.push(`${label}: something is over Tap to play (${topEl && (topEl.tagName + '#' + topEl.id)})`);
    // The site chip must not be reachable before the game runs: a stray tap on it would leave for the landing page.
    const chip = d.querySelector('#hg a'), cr = chip && rect(chip);
    const chipHit = chip && d.elementFromPoint(Math.round(cr.left + cr.width / 2), Math.round(cr.top + cr.height / 2));
    if (!chipHit || !chipHit.closest('#hg a')) t.event('chip-out-of-reach', `${label}: the "Hawkes Games" link cannot be hit before the game runs`); else bad.push(`${label}: the Hawkes Games link is tappable before the game starts`);
    tapBtn.click();
    await t.wait(1000);
    if (!d.getElementById('hawkes-tap') || d.getElementById('hawkes-tap').classList.contains('gone') || win.unityInstance) t.event('tap-to-play-works', `${label}: tapped, the prompt left${win.unityInstance ? ' and the game is running' : ''}`); else bad.push(`${label}: Tap to play did nothing`);
    // The picture is taken once Unity reports running: the build is 33 MB, so a slow connection gets 150 s. A game that is not
    // running by then is an error, not a loader screenshot passed off as the game. Where the page is, is watched the whole wait.
    const onPage = () => { try { return /^\/play\/sickofit\/?(index\.html)?$/.test(win.location.pathname); } catch { return false; } };
    let left = '';
    let running = false;
    try { await t.until(() => { if (!onPage()) { left = left || (() => { try { return win.location.pathname; } catch { return '(another page)'; } })(); return true; } return !!win.unityInstance; }, 150000, `the game running at ${label}`); running = !!win.unityInstance; } catch { /* reported below */ }
    if (running) t.event('game-running', `${label}: the Unity instance is up`); else if (!left) bad.push(`${label}: the game was not running 150 s after the tap`);
    await t.wait(5000);
    if (!left && onPage()) t.event('stayed-on-page', `${label}: still ${win.location.pathname} 5 s after the tap${running ? ' and the game running' : ''}`); else bad.push(`${label}: the page left /play/sickofit (now ${left || win.location.pathname})`);
    const strip = d.getElementById('pre');
    if (strip && win.getComputedStyle(strip).display === 'none') t.event('guide-gone', `${label}: the premise and controls strip is display:none once the game starts`); else bad.push(`${label}: the premise/controls strip is still in the page after the game started`);
    // What the picture will show must be the game: the Unity canvas on screen, the frame still the top layer of the host page,
    // and no landing page (its hero) anywhere in the frame. Checked at the moment of the scene, so a screenshot of the landing
    // page cannot pass for the game, nor a game that was swapped for the landing page.
    const cv = d.getElementById('unity-canvas'), cvr = cv && rect(cv);
    const stageEl = document.getElementById('pt-so-stage'), fr = rect(frame);
    const frameTop = document.elementFromPoint(Math.round(fr.left + fr.width / 2), Math.round(fr.top + fr.height / 2));
    const hero = [...d.querySelectorAll('h1')].find((e) => /free will/i.test(e.textContent)) || d.querySelector('[data-play-now], .hg-nav-links');
    if (cv && cvr.width > 200 && cvr.height > 200 && win.getComputedStyle(cv).visibility !== 'hidden') t.event('canvas-visible', `${label}: the Unity canvas is ${Math.round(cvr.width)}x${Math.round(cvr.height)}px in the frame`); else bad.push(`${label}: the Unity canvas is not visible`);
    if (!hero) t.event('no-landing-in-frame', `${label}: no landing page hero in the game's frame`); else bad.push(`${label}: the frame holds the Hawkes landing page, not the game`);
    if (running && win.getComputedStyle(d.getElementById('loading')).display === 'none') t.event('loader-gone', `${label}: the loader is gone, the game is what is on screen`); else if (running) bad.push(`${label}: the loader still covers the game`);
    if (stageEl && frameTop === frame) t.event('frame-on-top', `${label}: the game's frame is the top layer of the page being shot`); else bad.push(`${label}: the game's frame is not on top of the page`);
    if (window.__ptSoHost === hostMark) t.event('host-stable', `${label}: the host page was not reloaded or replaced during the run`); else bad.push(`${label}: the host page was reloaded during the run`);
    t.scene(`Sick of It ${label}: after tap`);
    await t.wait(SHOT_MS * 2); // the frame stays up until the picture of the running game is taken
    if (running && options.hud !== false) await hudStage(t, label, w, h, frame, d, win, bad);
  }
  // The frame is left up when the run ends (the next run's page load clears it): the runner's last picture is taken after
  // finish(), and with the frame gone it was the landing page behind it that got photographed, not the game.
  await t.wait(SHOT_MS); // the last picture is taken after the last scene event: finish only once it has been
  if (stageLost.length) t.problem('warning', `the page under test lost its frame at ${stageLost.join(', ')}; it was put back`);
  stageGuard?.disconnect();
  clearInterval(beat);
  if (bad.length) { t.event('sickofit-failed', bad.join(' | ')); throw new Error(`sickofit: ${bad.join(' | ')}`); }
  t.finish('done');
}

// Criterion: once the game starts no page text overlaps the game's HUD (weapon label, rewind controls). The main menu has no HUD,
// so the game is taken into its first level: the build's own playtest bot (window.hawkesPlaytest inside the frame, the Unity
// package) plays `smoke` through the menu with the game's input, a named setup-shortcut. When the scene is a level, every piece
// of the page that could hold text is asked whether it is on screen, and a grid of points across the window is asked what is on
// top: only the canvas (and the game's container) may answer.
async function hudStage(t, label, w, h, frame, d, win, bad) {
  const api = () => { try { return win.hawkesPlaytest; } catch { return null; } };
  try { await t.until(() => api() && typeof api().start === 'function', 20000, `the build's playtest hook at ${label}`); } catch {
    t.problem('warning', `${label}: the Unity build has no window.hawkesPlaytest, so the first level (and its HUD) was not reached`);
    return;
  }
  t.event('setup-shortcut', `${label}: the build's own smoke bot takes the game from its menu into the first level (window.hawkesPlaytest.start('smoke') in the frame); the page checks below are ours`);
  api().start('smoke', { seed: 1 });
  const seen = [];
  const sceneOf = () => { try { const st = api().state(); return String((st && st.scene) || ''); } catch { return ''; } };
  const isLevel = (sc) => /level|floor/i.test(sc) && !/menu|load|video|intro/i.test(sc);
  let level = '';
  try {
    await t.until(() => {
      const sc = sceneOf();
      if (sc && sc !== seen[seen.length - 1]) { seen.push(sc); t.event('game-scene', `${label}: ${sc}`); }
      if (isLevel(sc)) { level = sc; return true; }
      return false;
    }, 150000, `the first level at ${label}`);
  } catch { /* reported below */ }
  if (!level) { bad.push(`${label}: the game never reached a level (scenes: ${seen.join(' > ') || 'none'}), so the HUD was not checked`); return; }
  await t.wait(4000); // the HUD builds itself; the site chips (their 4 s fade) have gone quiet by now
  t.event('hud-reached', `${label}: ${level}`);
  const over = [];
  const isOurs = (e) => !e || e === d.documentElement || e === d.body || e.id === 'unity-container' || e.id === 'unity-canvas';
  // 1) no element of the page other than the game shows (display, visibility, opacity, and a box) with text in it
  for (const e of d.body.querySelectorAll('#pre, #hawkes-tap, #loading, #about, #hg, #unity-warning > div, #hawkes-sound-prompt')) {
    const cs = win.getComputedStyle(e), r = rect(e);
    if (cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01 && r.width > 0 && r.height > 0 && (e.textContent || '').trim()) over.push(`#${e.id || e.className || e.tagName} shows "${e.textContent.trim().slice(0, 40)}"`);
  }
  // 2) what is on top across the window (elements that take no taps are let through for the probe, as in guide-on-top)
  const pe = new Map();
  for (const e of d.body.querySelectorAll('*')) if (!isOurs(e) && win.getComputedStyle(e).pointerEvents === 'none') { pe.set(e, e.style.pointerEvents); e.style.pointerEvents = 'auto'; }
  const tops = new Set();
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const e = d.elementFromPoint(Math.round(w * i / 12), Math.round(h * j / 12));
    if (!isOurs(e) && !(e.closest && e.closest('#unity-warning:empty'))) tops.add(`${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}`);
  }
  for (const [e, v] of pe) e.style.pointerEvents = v;
  if (tops.size) over.push(`on top of the canvas: ${[...tops].join(', ')}`);
  if (!over.length) t.event('hud-clear', `${label}: in ${level} nothing of the page is over the game (no strip, prompt, loader, dialog or chip; only the canvas answers at 121 points)`); else bad.push(`${label}: page elements over the in-level HUD (${over.join('; ')})`);
  t.scene(`Sick of It ${label}: in the level (HUD)`);
  await t.wait(SHOT_MS * 2);
  try { api().stop(); } catch { /* the run ends with the page */ }
}
