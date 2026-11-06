// The `community-library` scenario: /community at 390x844 and 1440x900. Loaded by portal.js. No sign-up, no game, safe on live.
//   1. cards-shown      cards with a thumbnail (or the designed glyph tile) and a creator name ("by ...") and a uses count
//   2. loading-state    the skeleton cards that are in the grid before the first answer (a page opened in a frame, watched from the first frame)
//   3. empty-state      a search for nonsense (typed with key events, sent with Enter): the designed empty card, not a blank grid
//   4. no-horizontal-scroll at 390 (and the cards, featured row and tools inside the window)
//   5. no-timer-fetch   the page makes no request on its own: after it settles, 4 s of idleness adds none, and typing alone sends none
export const COMMUNITY_LIBRARY = {
  id: 'community-library', title: 'The community library: cards with thumbnails, creator names and uses; the loading skeleton; the empty state; the featured row; no sideways scroll at 390px; no request without a person asking', seconds: 120, tags: ['full'],
  description: 'no sign-up, no game. For 390x844 and 1440x900 (an iframe each): the skeleton while loading (loading-state), the cards (cards-shown, scene "Library WxH: cards"), the featured row (featured-shown), a nonsense search typed with key events and sent with Enter (empty-state), no horizontal scroll, and four idle seconds with no new request (no-timer-fetch). options: sizes (default ["390x844","1440x900"])',
};

export async function runCommunityLibrary(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : ['390x844', '1440x900']).map(String);
  t.event('plan', `community-library: ${sizes.join(', ')}`);
  const failed = [];
  for (let i = 0; i < sizes.length; i++) {
    const [w, h] = sizes[i].split('x').map(Number);
    if (!(w > 0 && h > 0)) throw new Error(`bad size "${sizes[i]}"`);
    failed.push(...await oneSize(t, w, h, sizes[i]));
    t.progress((i + 1) / sizes.length);
  }
  document.getElementById('pt-lib-stage')?.remove();
  if (failed.length) { t.event('library-failed', failed.join(' | ')); throw new Error(`library: ${failed.join(' | ')}`); }
  t.finish('done');
}

async function oneSize(t, w, h, label) {
  document.getElementById('pt-lib-stage')?.remove();
  const stage = document.createElement('div');
  stage.id = 'pt-lib-stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c;overflow:hidden';
  const frame = document.createElement('iframe');
  frame.title = `The community library at ${label}`;
  const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
  frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;background:#fff;transform:scale(${scale});transform-origin:0 0`;
  stage.appendChild(frame);
  document.body.appendChild(stage);
  const bad = [];
  // Watch the grid from the first frame so the skeleton is seen when it is there.
  let sawSkeleton = false, requests = 0;
  const watch = () => {
    try {
      const win = frame.contentWindow, doc = win && win.document;
      if (doc && doc.querySelector('#grid .card.skel')) sawSkeleton = true;
      if (win && win.performance && !win.__ptPatched && win.fetch) {
        win.__ptPatched = true;
        const f = win.fetch.bind(win);
        win.fetch = (...a) => { requests++; return f(...a); };
      }
    } catch { /* not ready */ }
  };
  const iv = setInterval(watch, 10); // the playtest's own observer (not the page's)
  frame.src = '/community';
  await t.until(() => { try { return frame.contentWindow.hgCommunityReady === true; } catch { return false; } }, 30000, `the library at ${label}`);
  clearInterval(iv);
  const win = frame.contentWindow, doc = win.document;
  const $ = (s) => doc.querySelector(s);
  if (sawSkeleton) t.event('loading-state', `skeleton cards were shown while loading at ${label}`);
  else t.problem('warning', `${label}: the skeleton was not caught (the answer came before the first look)`);
  await t.wait(800);

  const grid = $('#grid');
  const cards = [...doc.querySelectorAll('#grid .card:not(.skel)')];
  if (grid.dataset.state === 'ready' && cards.length) {
    const withBy = cards.filter((c) => /^\s*by\s+\S/.test((c.querySelector('.by .nm') || {}).textContent || '')).length;
    const withThumb = cards.filter((c) => c.querySelector('.thumb img, .thumb .glyph')).length;
    const withUses = cards.filter((c) => c.querySelector('.stat .u')).length;
    t.event('cards-shown', `${cards.length} cards at ${label}: ${withThumb} thumbnails or tiles, ${withBy} creator names, ${withUses} uses counts`);
    if (withBy < cards.length) t.problem('bug', `${label}: ${cards.length - withBy} cards show no creator name`, true);
    if (withThumb < cards.length) t.problem('bug', `${label}: ${cards.length - withThumb} cards show no thumbnail`, true);
  } else if (grid.dataset.state === 'empty') t.event('library-empty', `the library shows its empty state at ${label}`);
  else bad.push(`${label}: the grid ended "${grid.dataset.state}" with ${cards.length} cards`);
  if (!$('#featured').hidden) t.event('featured-shown', `${doc.querySelectorAll('#featRow .card').length} featured cards at ${label}`);
  t.scene(`Library ${label}: cards`);
  const side = sideways(win, doc); if (side) bad.push(`${label}: ${side}`);

  // Idle: nothing may ask the server by itself.
  const before = requests;
  await t.wait(4000);
  if (requests === before) t.event('no-timer-fetch', `no request in 4 s of idleness at ${label}`);
  else bad.push(`${label}: ${requests - before} requests with nobody asking`);

  // Typing alone sends nothing; Enter sends one search and the empty state shows.
  const input = $('#q');
  input.focus();
  let typed = '';
  const mark = requests;
  for (const ch of 'zzqxv nothing') {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    typed += ch; input.value = typed;
    input.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    await t.wait(60);
  }
  await t.wait(800);
  if (requests !== mark) bad.push(`${label}: typing alone sent ${requests - mark} requests`);
  input.form.requestSubmit();
  await t.until(() => $('#grid').dataset.state === 'empty', 15000, 'the empty state');
  const e = $('#grid .empty');
  if (e && e.querySelector('h3') && e.querySelector('p')) t.event('empty-state', `"${e.querySelector('h3').textContent}" at ${label}`);
  else bad.push(`${label}: the empty state has no heading and text`);
  await t.wait(400);
  t.scene(`Library ${label}: empty`);
  const side2 = sideways(win, doc); if (side2) bad.push(`${label}: empty state ${side2}`);
  t.event('no-horizontal-scroll', `none at ${label}`);
  stage.remove();
  return bad;
}

function sideways(win, doc) {
  const de = doc.documentElement, vw = de.clientWidth;
  const wide = Math.max(de.scrollWidth, doc.body.scrollWidth);
  return wide > vw + 1 ? `${wide}px wide in ${vw}px` : '';
}
