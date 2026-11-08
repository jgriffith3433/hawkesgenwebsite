// The `sickofit-page` scenario: the Sick of It page before the game starts, at 390x844 and 1440x900 (an iframe each).
// Loaded by portal.js. Safe on live (read only). Events: premise-shown, controls-shown, guide-on-top, no-overlap, tap-reachable, tap-to-play-works.
export const SICKOFIT_PAGE = {
  id: 'sickofit-page', title: 'Sick of It page: premise and controls guide before the game; nothing over the canvas or Tap to play at 390px; Tap to play starts it', seconds: 90, tags: ['full'],
  description: '/play/sickofit in a frame at 390x844 (touch) and 1440x900: the premise line and move/rewind guide (premise-shown, controls-shown), the strip clear of Tap to play (no-overlap), the loader, strip and prompt clear of each other (no-overlap, guide-on-top, tap-reachable), then a tap on Tap to play (tap-to-play-works). options: sizes',
};
const SHOT_MS = 2500;
const rect = (e) => e.getBoundingClientRect();
const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
export async function runSickofitPage(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : ['390x844', '1440x900']).map(String);
  const bad = [];
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
    // The picture is taken once Unity reports running (a slow build is a warning, not a pass).
    try { await t.until(() => win.unityInstance, 60000, `the game running at ${label}`); t.event('game-running', `${label}: the Unity instance is up`); } catch { t.problem('warning', `${label}: the game was not running after 60 s`); }
    await t.wait(5000);
    if (/^\/play\/sickofit\/?(index\.html)?$/.test(win.location.pathname)) t.event('stayed-on-page', `${label}: still ${win.location.pathname} 5 s after the tap`); else bad.push(`${label}: the page left /play/sickofit (now ${win.location.pathname})`);
    const strip = d.getElementById('pre');
    if (strip && win.getComputedStyle(strip).display === 'none') t.event('guide-gone', `${label}: the premise and controls strip is display:none once the game starts`); else bad.push(`${label}: the premise/controls strip is still in the page after the game started`);
    t.scene(`Sick of It ${label}: after tap`);
    await t.wait(SHOT_MS); // the frame stays up until the picture of the running game is taken
  }
  document.getElementById('pt-so-stage')?.remove();
  if (bad.length) { t.event('sickofit-failed', bad.join(' | ')); throw new Error(`sickofit: ${bad.join(' | ')}`); }
  t.finish('done');
}
