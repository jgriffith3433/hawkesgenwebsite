// The `sickofit-page` scenario: the Sick of It page before the game starts, at 390x844 and 1440x900 (an iframe each).
// Loaded by portal.js. Safe on live (read only). Events: premise-shown, controls-shown, no-overlap, tap-to-play-works.
export const SICKOFIT_PAGE = {
  id: 'sickofit-page', title: 'Sick of It page: premise and controls guide before the game; nothing over the canvas or Tap to play at 390px; Tap to play starts it', seconds: 90, tags: ['full'],
  description: '/play/sickofit in a frame at 390x844 (touch) and 1440x900: the premise line and move/rewind guide (premise-shown, controls-shown), the strip clear of Tap to play (no-overlap), then a tap on Tap to play (tap-to-play-works). options: sizes',
};
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
    await t.wait(2500);
    const vis = (s) => { const e = d.querySelector(s); return e && win.getComputedStyle(e).display !== 'none' && rect(e).height > 0 ? e : null; };
    const prem = vis('#pre .premise');
    if (prem && prem.textContent.trim().length > 20) t.event('premise-shown', `${label}: "${prem.textContent.trim()}"`); else bad.push(`${label}: no premise`);
    const ctl = vis(w < 500 && d.body.classList.contains('touch') ? '#pre .touch' : '#pre .kbd') || vis('#pre .keys');
    if (ctl && /move/i.test(ctl.textContent) && /rewind/i.test(ctl.textContent)) t.event('controls-shown', `${label}: ${ctl.textContent.trim()}`); else bad.push(`${label}: no move/rewind guide`);
    t.scene(`Sick of It ${label}: before play`);
    const pre = rect(d.getElementById('pre'));
    const others = [...d.querySelectorAll('button, a, [id*=play i], [class*=play i], [class*=tap i]')].filter((e) => !e.closest('#pre') && !e.closest('#hg') && !e.closest('#about') && rect(e).width > 0);
    const over = others.filter((e) => hit(pre, rect(e)));
    if (pre.left >= 0 && pre.right <= w && !over.length) t.event('no-overlap', `${label}: strip ${Math.round(pre.height)}px tall clear of ${others.length} controls`); else bad.push(`${label}: panel overlaps ${over.map((e) => e.tagName + '#' + e.id).join(',') || 'the edge'}`);
    const tap = others.find((e) => /tap to play|play/i.test(e.textContent || '')) || d.querySelector('[id*=sound i], [class*=sound i]');
    if (tap) { tap.click(); } else d.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter' }));
    await t.wait(4000);
    if (win.unityInstance || d.getElementById('pre').classList.contains('gone')) t.event('tap-to-play-works', `${label}: tapped, the page moved on`); else bad.push(`${label}: Tap to play did nothing`);
    t.scene(`Sick of It ${label}: after tap`);
  }
  document.getElementById('pt-so-stage')?.remove();
  if (bad.length) { t.event('sickofit-failed', bad.join(' | ')); throw new Error(`sickofit: ${bad.join(' | ')}`); }
  t.finish('done');
}
