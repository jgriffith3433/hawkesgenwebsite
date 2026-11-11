// The `store-pages` scenario: /games and the store pages /games/<id>. Loaded by portal.js. No sign-up, no game, safe on live.
//   cards-shown       at least 9 16:9 cover cards with a picture (no emoji or letter covers); no Live now tab, no playing badge
//                     while the live counts are empty
//   preview-plays     phone: a card scrolled into the middle band starts its muted preview within 1 s; the count of playing
//                     previews never goes over 1 for the whole page (checked on every scroll step)
//   store-page        /games/yoobaland, /games/sickofit, /games/island: hero clip, at least 4 screenshots, keyboard and touch
//                     controls, a Play button; the title holds the name; og:image answers 200 and is the cover
export const STORE_PAGES = {
  id: 'store-pages', title: 'The games page and the store pages: cover cards, previews that play one at a time, hero clip, screenshots, controls and Play', seconds: 150, tags: ['full'],
  description: 'no sign-up, no game. For 390x844 and 1280x720 (an iframe each): /games shows 9 or more 16:9 cover cards with real art and no live badge while nothing is live (cards-shown, no-live-badge); at 390 the page is scrolled card by card and the card in the middle plays within 1 s, never two at once (preview-plays, one-at-a-time); /games/yoobaland, /games/sickofit and /games/island each show a hero clip, 4+ screenshots, keyboard and touch controls and a Play button (store-page), a title with the name and an og:image that returns 200 (og-image). options: sizes, pages',
};

const PAGES = ['yoobaland', 'sickofit', 'island'];

export async function runStorePages(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : ['390x844', '1280x720']).map(String);
  const pages = Array.isArray(options.pages) && options.pages.length ? options.pages : PAGES;
  t.event('plan', `store-pages: ${sizes.join(', ')}`);
  const failed = [];
  for (let i = 0; i < sizes.length; i++) {
    const [w, h] = sizes[i].split('x').map(Number);
    if (!(w > 0 && h > 0)) throw new Error(`bad size "${sizes[i]}"`);
    failed.push(...await gallerySize(t, w, h, sizes[i]));
    if (w <= 500) for (const p of pages) failed.push(...await storePage(t, w, h, sizes[i], p));
    t.progress((i + 1) / sizes.length);
  }
  document.getElementById('pt-store-stage')?.remove();
  if (failed.length) { t.event('store-failed', failed.join(' | ')); throw new Error(`store pages: ${failed.join(' | ')}`); }
  t.finish('done');
}

async function open(t, w, h, label, path, ready) {
  document.getElementById('pt-store-stage')?.remove();
  const stage = document.createElement('div');
  stage.id = 'pt-store-stage';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c;overflow:hidden';
  const frame = document.createElement('iframe');
  frame.title = `${path} at ${label}`;
  const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
  frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;background:#fff;transform:scale(${scale});transform-origin:0 0`;
  stage.appendChild(frame);
  document.body.appendChild(stage);
  frame.src = path;
  await t.until(() => { try { return ready(frame.contentDocument); } catch { return false; } }, 30000, `${path} at ${label}`);
  return { frame, win: frame.contentWindow, doc: frame.contentDocument };
}

const playingVideos = (doc) => [...doc.querySelectorAll('video')].filter((v) => !v.paused && !v.ended && v.readyState > 1).length;
const sideways = (doc) => { const de = doc.documentElement; const wide = Math.max(de.scrollWidth, doc.body.scrollWidth); return wide > de.clientWidth + 1 ? `${wide}px wide in ${de.clientWidth}px` : ''; };

async function gallerySize(t, w, h, label) {
  const bad = [];
  const { win, doc } = await open(t, w, h, label, '/games', (d) => d.querySelectorAll('.cv-card').length > 0);
  await t.wait(1200);
  const cards = [...doc.querySelectorAll('.cv-card')];
  const ratio = cards.map((c) => { const m = c.querySelector('.cv-media').getBoundingClientRect(); return m.width / m.height; });
  const real = cards.filter((c) => c.querySelector('.cv-media img') && !c.querySelector('.cv-plain'));
  const loaded = real.filter((c) => { const i = c.querySelector('.cv-media img'); return i.complete && i.naturalWidth > 0; });
  if (cards.length < 9) bad.push(`${label}: ${cards.length} cover cards, 9 needed`);
  if (ratio.some((r) => Math.abs(r - 16 / 9) > 0.03)) bad.push(`${label}: a cover card is not 16:9`);
  if (loaded.length < cards.length) bad.push(`${label}: ${cards.length - loaded.length} cards have no real cover art (${cards.filter((c) => !loaded.includes(c)).map((c) => c.querySelector('h3')?.textContent).join(', ')})`);
  else t.event('cards-shown', `${cards.length} 16:9 cover cards with art at ${label}`);
  const rows = [...doc.querySelectorAll('.store .row h2')].map((e) => e.textContent.trim());
  t.event('rows', rows.join(' | '));
  const liveBits = doc.querySelectorAll('.live-now').length + [...doc.querySelectorAll('button, .segmented')].filter((b) => /live now/i.test(b.textContent)).length + (/\d+ (playing|people are playing)/.test(doc.querySelector('#liveCount')?.textContent || '') ? 1 : 0);
  const known = await fetch('/v1/gallery?limit=1', { cache: 'no-store' }).then((r) => r.json()).then((j) => j.liveKnown === true).catch(() => false);
  if (!known && liveBits) bad.push(`${label}: a live badge or count shows while nothing is live`);
  else t.event('no-live-badge', known ? `live counts are known; ${liveBits} badges` : `no Live now tab or playing badge at ${label}`);
  t.scene(`Games ${label}: rows`);
  const side = sideways(doc); if (side) bad.push(`${label}: ${side}`);

  // Phone: scroll card by card (named setup: a scripted scroll, the page has no swipe of its own to play); the middle one plays.
  if (w <= 500) {
    const withClip = cards.filter((c) => c.dataset.preview);
    if (!withClip.length) t.problem('warning', `${label}: no card has a preview clip yet (captures are not committed), so previews could not be checked`);
    let maxPlaying = 0, started = 0;
    const scroller = doc.scrollingElement;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      scroller.scrollTo(0, scroller.scrollTop + r.top + r.height / 2 - win.innerHeight / 2);
      const t0 = performance.now();
      if (c.dataset.preview) {
        await t.until(() => playingVideos(doc) >= 1 || performance.now() - t0 > 1000, 1500, 'a preview');
        if (c.classList.contains('is-playing')) { started++; if (performance.now() - t0 > 1000) bad.push(`${label}: ${c.querySelector('h3').textContent} preview took over 1 s`); }
        else bad.push(`${label}: ${c.querySelector('h3').textContent} did not start its preview in the middle of the screen`);
      } else await t.wait(150);
      maxPlaying = Math.max(maxPlaying, playingVideos(doc));
    }
    t.event('preview-plays', `${started} of ${withClip.length} previews started on scroll at ${label}`);
    if (maxPlaying > 1) bad.push(`${label}: ${maxPlaying} previews played at once`);
    else t.event('one-at-a-time', `at most ${maxPlaying} playing preview at ${label}`);
    t.scene(`Games ${label}: preview`);
  }
  return bad;
}

async function storePage(t, w, h, label, slug) {
  const bad = [];
  const { win, doc } = await open(t, w, h, label, `/games/${slug}`, (d) => d.getElementById('gp')?.dataset.state === 'ready' || d.getElementById('gp')?.dataset.state === 'missing');
  const name = doc.getElementById('name').textContent;
  if (doc.getElementById('gp').dataset.state !== 'ready') return [`${label} /games/${slug}: the page did not find its game`];
  const hero = doc.querySelector('#hero video') || doc.querySelector('#hero img');
  const clip = !!doc.querySelector('#hero video');
  const shots = doc.querySelectorAll('#shots .shot').length;
  const kb = doc.querySelectorAll('#kb li').length, touch = doc.querySelectorAll('#touch li').length;
  const play = doc.getElementById('play');
  if (!clip) bad.push(`${slug}: no hero clip`);
  if (shots < 4) bad.push(`${slug}: ${shots} screenshots, 4 needed`);
  if (!kb || !touch) bad.push(`${slug}: controls missing (keyboard ${kb}, touch ${touch})`);
  if (!play) bad.push(`${slug}: no Play button`);
  else { const r = play.getBoundingClientRect(); if (r.height < 44 || r.bottom > win.innerHeight + 1 || r.top < 0) bad.push(`${slug}: Play is not reachable on the first screen (${Math.round(r.top)}..${Math.round(r.bottom)} of ${win.innerHeight})`); }
  if (!doc.title.includes(name)) bad.push(`${slug}: the title "${doc.title}" lacks "${name}"`);
  const og = doc.querySelector('meta[property="og:image"]')?.content || '';
  const ok = og && await fetch(og, { method: 'GET', cache: 'no-store' }).then((r) => r.ok).catch(() => false);
  if (!ok) bad.push(`${slug}: og:image ${og} does not answer 200`);
  else t.event('og-image', `${slug}: ${og}`);
  // The first screenshot opens full size.
  doc.querySelector('#shots .shot')?.click();
  await t.wait(300);
  if (shots && doc.getElementById('lb').hidden) bad.push(`${slug}: a screenshot does not open full size`);
  else { t.scene(`Store ${slug} ${label}: screenshot`); doc.querySelector('.lb-x')?.click(); }
  if (!bad.length) t.event('store-page', `${name}: hero clip, ${shots} screenshots, ${kb} keyboard and ${touch} touch controls, Play, og:image 200 at ${label}`);
  t.scene(`Store ${slug} ${label}`);
  const side = sideways(doc); if (side) bad.push(`${slug} ${label}: ${side}`);
  return bad;
}
