// The `site-layout` scenario: the landing page (not the game) at 390x844, 768x1024 and 1440x900. Loaded by portal.js.
//
// For each size: load /, wait for the sky, screenshot the hero, type a wish with real key events and submit it, wait for
// the card, then scroll down through the page (steps, pricing, API) with a screenshot at each stage. The runner's browser
// has one window size, so each size is a same-origin iframe of exactly that size, shown scaled to fit the window under a
// small caption: its media queries, scroll and layout are the real ones for that width. `frames: false` plays the page in
// the browser's own window instead (the size the runner gave it).
//
// Checks it makes itself (a failing one is a problem, and any horizontal scroll ends the run as an error): see "The
// landing page checklist" in AGENTS.md. Screenshots and the review judge the rest (contrast, overlaps, how it looks).
export const SITE_LAYOUT = {
  id: 'site-layout', title: 'The landing page at 390x844, 768x1024 and 1440x900: the sky, a wish and its card, then the island, games and pricing sections, with a screenshot at each stage and a check for horizontal scroll', seconds: 150, tags: ['full'],
  description: 'no sign-up, no game. For each size: the hero (scene "Site WxH: hero"), a wish typed with real key events and sent (the card: "Site WxH: wish card"), then scrolling to #island ("island"), #games ("games") and #pricing, a scene each. The checklist (AGENTS.md "The landing page checklist") is measured: headline readable, the Overseer not covered, the wish box usable, the header legible, no horizontal scroll (any, at any size, ends the run as an error). options: sizes (default ["390x844","768x1024","1440x900"]), wish (text), pages (false: skip Games, Library and Profile), frames (false: play in the browser\'s own window instead of an iframe per size)',
};

const SIZES = ['390x844', '768x1024', '1440x900'];
const SECTIONS = [['island', '#island'], ['games', '#games'], ['pricing', '#pricing']];

export async function runSiteLayout(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : SIZES).map(String);
  const wish = String(options.wish || 'a lighthouse made of glass').slice(0, 48);
  const framed = options.frames !== false;
  const failed = [];
  t.event('plan', `site-layout: ${sizes.join(', ')}${framed ? ' (an iframe of each size)' : ' (the browser\'s own window)'}`);
  t.progress(0.02);
  for (let i = 0; i < sizes.length; i++) {
    const [w, h] = sizes[i].split('x').map(Number);
    if (!(w > 0 && h > 0)) throw new Error(`bad size "${sizes[i]}" (want 390x844)`);
    const horizontal = await oneSize(t, { w, h, label: sizes[i], wish, framed });
    if (horizontal.length) failed.push(`${sizes[i]}: ${horizontal.join('; ')}`);
    t.progress(0.05 + 0.95 * ((i + 1) / sizes.length));
  }
  if (options.pages !== false) {
    for (let i = 0; i < sizes.length; i++) {
      const [w, h] = sizes[i].split('x').map(Number);
      const bad = await pagesAtSize(t, { w, h, label: sizes[i], framed });
      if (bad.length) failed.push(`${sizes[i]} pages: ${bad.join('; ')}`);
    }
  }
  document.getElementById('pt-site-stage')?.remove();
  if (failed.length) {
    t.event('layout-failed', failed.join(' | '));
    throw new Error(`layout: ${failed.join(' | ')}`);
  }
  t.event('no-horizontal-scroll', `none at ${sizes.join(', ')}`);
  if (options.pages !== false) t.event('pages-ok', `Games, Library and Profile answer 200 and fit at ${sizes.join(', ')}`);
  t.event('layout-ok', `header whole, card on the first screen, the Overseer clear of the text at ${sizes.join(', ')}`);
  t.finish('done');
}

const PAGES = [['/games', 'Games'], ['/community', 'Library'], ['/profile', 'Profile']];

/** The other pages every visitor meets: each answers 200 and, at this size, nothing scrolls sideways, the header's buttons are whole and apart, and nothing fixed sits over the content. */
async function pagesAtSize(t, { w, h, label, framed }) {
  const bad = [];
  let stage = null, frame = null;
  if (framed) {
    document.getElementById('pt-site-stage')?.remove();
    stage = document.createElement('div');
    stage.id = 'pt-site-stage';
    stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c;overflow:hidden';
    frame = document.createElement('iframe');
    const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
    frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;background:#fff;transform:scale(${scale});transform-origin:0 0`;
    stage.append(frame);
    document.body.appendChild(stage);
  }
  for (const [path, name] of PAGES) {
    const status = await fetch(path, { cache: 'no-store' }).then((r) => r.status, () => 0);
    if (status !== 200) { bad.push(`${name} (${path}) answered ${status}`); t.problem('bug', `${label}: ${path} answered ${status}`); continue; }
    t.event('page-status', `${path} 200 at ${label}`);
    if (!frame) continue;
    await new Promise((res, rej) => { frame.onload = res; frame.onerror = () => rej(new Error(`${path} did not load`)); frame.src = path; });
    const win = frame.contentWindow, doc = win.document;
    await t.until(() => doc.readyState === 'complete', 20000, `${name} at ${label}`);
    if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, t.wait(3000)]);
    await t.wait(1800); // its data arrives
    t.scene(`Page ${label}: ${name}`);
    const sw = overflowX(win, doc);
    if (sw) bad.push(`${name}: ${sw}`);
    const vw = doc.documentElement.clientWidth;
    const head = doc.querySelector('.hg-navbar, header.bar');
    if (!head) bad.push(`${name}: no header`);
    else {
      const shown = [...head.querySelectorAll('a,button')].filter((e) => e.getBoundingClientRect().width > 0);
      for (const e of shown) {
        const q = e.getBoundingClientRect(), nm = (e.textContent || '').trim().slice(0, 20);
        if (q.right > vw + 1 || q.left < -1) bad.push(`${name}: header "${nm}" cut off (${Math.round(q.left)}..${Math.round(q.right)} of ${vw})`);
        if (e.scrollWidth > e.clientWidth + 1) bad.push(`${name}: header "${nm}" clipped`);
      }
      for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
        if (hits(shown[a].getBoundingClientRect(), shown[b].getBoundingClientRect())) bad.push(`${name}: header "${(shown[a].textContent || '').trim().slice(0, 16)}" and "${(shown[b].textContent || '').trim().slice(0, 16)}" overlap`);
      }
    }
    // a fixed button (the engine's Controls pill) over the page's own text
    for (const e of doc.body.querySelectorAll('button, a, div')) {
      if (e.closest('header') || getComputedStyle(e).position !== 'fixed') continue;
      const r = e.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || getComputedStyle(e).display === 'none' || getComputedStyle(e).visibility === 'hidden') continue;
      if (e.classList.contains('ct-btn')) bad.push(`${name}: the Controls pill is on the page`);
    }
    if (!sw) t.event('page-fits', `${name} at ${label}: no sideways scroll, header whole`);
  }
  stage?.remove();
  return bad;
}

/** Returns what scrolled sideways (empty when nothing did). Every other finding is a problem on the report. */
async function oneSize(t, { w, h, label, wish, framed }) {
  let win = window, stage = null, frame = null;
  if (framed) {
    document.getElementById('pt-site-stage')?.remove();
    stage = document.createElement('div');
    stage.id = 'pt-site-stage';
    stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#14151c;overflow:hidden';
    const cap = document.createElement('div');
    cap.style.cssText = 'position:absolute;left:0;right:0;top:0;height:22px;font:12px/22px ui-monospace,monospace;color:#9aa3b2;text-align:center';
    frame = document.createElement('iframe');
    frame.title = `The landing page at ${label}`;
    frame.setAttribute('scrolling', 'yes');
    const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
    cap.textContent = `${label}${scale < 0.995 ? ` (shown at ${Math.round(scale * 100)}%)` : ''}`;
    frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:${24}px;width:${w}px;height:${h}px;border:0;background:#fff;transform:scale(${scale});transform-origin:0 0`;
    stage.append(cap, frame);
    document.body.appendChild(stage);
    await new Promise((res, rej) => { frame.onload = res; frame.onerror = () => rej(new Error('the page did not load in the frame')); frame.src = '/'; });
    win = frame.contentWindow;
  }
  const doc = win.document;
  const $ = (s) => doc.querySelector(s);
  const size = () => ({ w: win.innerWidth, h: win.innerHeight });
  const tag = (s) => `Site ${label}: ${s}`;

  // ---- the sky
  await t.until(() => $('[data-sky] canvas') && $('[data-sky] canvas').width > 0 && doc.readyState === 'complete', 30000, `the sky at ${label}`);
  if (doc.fonts && doc.fonts.ready) await Promise.race([doc.fonts.ready, t.wait(4000)]);
  let frames = 0; const tick = () => { frames++; if (frames < 40) win.requestAnimationFrame(tick); }; win.requestAnimationFrame(tick);
  await t.until(() => frames >= 30, 15000, 'the sky to draw frames').catch(() => t.problem('warning', `the sky drew few frames at ${label} (reduced motion or a hidden window?)`));
  await t.wait(1500); // the Overseer's first line
  // a `fatal` finding (a clipped button, text running out of its box, a card off the first screen, text over the Overseer) also ends the run
  const hard = [];
  const problem = (sev, msg, fatal) => { t.problem(sev, `${label}: ${msg}`); if (fatal) hard.push(msg); };
  if (framed && (win.innerWidth !== w || win.innerHeight !== h)) problem('warning', `the frame is ${win.innerWidth}x${win.innerHeight}, not ${label}`);
  t.scene(tag('hero'));
  t.event('hero-shown', `${label}, ${size().w}x${size().h}`);
  checkHero(win, doc, problem, t);
  const sideways = [];
  const sideways0 = overflowX(win, doc); if (sideways0) sideways.push(`hero ${sideways0}`);

  // ---- a wish: real key events into the box, then the button
  const input = $('[data-sky-wish] input'), button = $('[data-sky-wish] button');
  if (!input || !button) throw new Error(`the wish box is missing at ${label}`);
  input.focus();
  let typed = '';
  for (const ch of wish) { // one key at a time, as a person types
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
    typed += ch; input.value = typed;
    input.dispatchEvent(new win.InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true }));
    await t.wait(25);
  }
  t.event('wish-typed', `"${wish}" at ${label}`);
  await t.wait(500);
  button.click();
  await t.until(() => $('.sky-thing.still'), 12000, `the wish card to assemble at ${label}`);
  await t.wait(700);
  const card = $('.sky-thing.still');
  const cr = card.getBoundingClientRect(), s = size();
  const head = doc.querySelector('.hg-navbar'), headBottom = head ? head.getBoundingClientRect().bottom : 0;
  const visible = cr.width > 20 && cr.height > 20 && cr.left >= -1 && cr.right <= s.w + 1 && cr.top >= headBottom - 1 && cr.bottom <= s.h + 1;
  if (visible) t.event('wish-card', `"${(card.textContent || '').trim().slice(0, 40)}" at ${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)}`);
  else problem('bug', `the wish card is not fully inside the first screen (${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)} in ${s.w}x${s.h}, the header ends at ${Math.round(headBottom)})`, true);
  const reply = $('[data-sky-reply]');
  if (!reply || reply.hidden) problem('bug', 'no reply line after the wish');
  t.scene(tag('wish card'));
  checkHero(win, doc, problem, t, true);
  const sideways1 = overflowX(win, doc); if (sideways1) sideways.push(`after the wish ${sideways1}`);

  // ---- down the page
  for (const [name, sel] of SECTIONS) {
    const el = $(sel);
    if (!el) { problem('bug', `the ${name} section (${sel}) is missing`); continue; }
    await scrollTo(t, win, doc, el);
    await t.wait(900); // the beam-in reveals
    t.scene(tag(name));
    t.event('section-shown', `${name} at ${label}`);
    const sw = overflowX(win, doc); if (sw) sideways.push(`${name} ${sw}`);
    checkHeader(win, doc, problem, name);
  }
  await scrollTo(t, win, doc, null);
  const end = overflowX(win, doc); if (end) sideways.push(`top again ${end}`);
  if (stage) stage.remove();
  return sideways.concat(hard);
}

/** Scrolls in steps (so the page's scroll-triggered reveals fire as they do for a person) until `el` is under the header. */
async function scrollTo(t, win, doc, el) {
  const head = doc.querySelector('.hg-navbar');
  const offset = (head ? head.getBoundingClientRect().height : 0) + 8;
  const targetOf = () => (el ? Math.max(0, Math.round(el.getBoundingClientRect().top + win.scrollY - offset)) : 0);
  for (let i = 0; i < 60; i++) {
    const to = targetOf(), at = win.scrollY, d = to - at;
    if (Math.abs(d) < 3) break;
    win.scrollTo(0, at + Math.sign(d) * Math.min(Math.abs(d), Math.round(win.innerHeight * 0.6)));
    await t.wait(160);
  }
}

/** Wider than the window: any amount. Returns a short text, or '' when the page fits. */
function overflowX(win, doc) {
  const de = doc.documentElement, vw = de.clientWidth;
  const wide = Math.max(de.scrollWidth, doc.body.scrollWidth);
  if (wide <= vw + 1 && win.scrollX === 0) return '';
  let who = '';
  for (const e of doc.body.querySelectorAll('*')) {
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.right > vw + 1 && getComputedStyle(e).position !== 'fixed') { who = ` (first: ${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''} ends at ${Math.round(r.right)})`; break; }
  }
  return `${wide}px wide in ${vw}px${who}`;
}

const inside = (r, w, h) => r.left >= -1 && r.right <= w + 1 && r.top >= -1 && r.bottom <= h + 1;
const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** The hero's checklist items that can be measured: the headline, the Overseer, the wish box, the header. */
function checkHero(win, doc, problem, t, afterWish = false) {
  const $ = (s) => doc.querySelector(s);
  const vw = doc.documentElement.clientWidth, vh = win.innerHeight;
  const h1 = $('.sky h1');
  if (h1) {
    const r = h1.getBoundingClientRect(), fs = parseFloat(getComputedStyle(h1).fontSize);
    if (fs < 28) problem('bug', `the headline is ${fs}px (under 28)`);
    if (!inside(r, vw, vh + 400) || r.width < 40) problem('bug', `the headline is clipped (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
    const mid = doc.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), Math.min(Math.max(r.top + 10, 0), vh - 1));
    if (!afterWish && mid && !h1.contains(mid) && !mid.contains(h1)) problem('bug', `something covers the headline (${mid.tagName.toLowerCase()}.${String(mid.className).split(' ')[0]})`);
  } else problem('bug', 'no headline in the hero');
  // The Overseer, by geometry: the pearl and its two rings (1.7 radii to each side, the pearl's radius up and down) against
  // the rectangles of the text itself (a line's own box, not the block that is as wide as its max-width), the wish box,
  // the card and the buttons. The numbers go on the report either way.
  const sky = $('[data-sky]');
  const o = (sky && sky.dataset.overseer || '').split(',').map(Number);
  if (o.length === 3 && o[2] > 0) {
    const skyTop = sky.getBoundingClientRect().top, cy = skyTop + o[1];
    const ov = { left: o[0] - o[2] * 1.7, right: o[0] + o[2] * 1.7, top: cy - o[2], bottom: cy + o[2] };
    let nearest = Infinity, nearestWhat = '';
    for (const [what, sel, textOnly] of [['headline', '.sky h1', true], ['intro text', '.sky .lede', true], ['wish box', '[data-sky-wish]'], ['reply', '[data-sky-reply]:not([hidden])', true], ['wish card', '.sky-thing'], ['buttons', '.sky .actions .btn'], ['small print', '.sky .fine', true]]) {
      for (const e of doc.querySelectorAll(sel)) {
        const rects = textOnly ? lineRects(doc, e) : [e.getBoundingClientRect()];
        for (const r of rects) {
          if (r.width < 1 || r.height < 1) continue;
          if (hits(r, ov)) problem('bug', `the ${what} covers the Overseer (text ${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)}; pearl and rings ${Math.round(ov.left)},${Math.round(ov.top)}..${Math.round(ov.right)},${Math.round(ov.bottom)})`, true);
          const gap = Math.max(ov.left - r.right, r.left - ov.right, ov.top - r.bottom, r.top - ov.bottom);
          if (gap < nearest) { nearest = gap; nearestWhat = what; }
        }
      }
    }
    if (!afterWish) t.event('overseer-clear', `${doc.documentElement.clientWidth}px wide: the nearest text (${nearestWhat}) is ${Math.round(nearest)}px from the Overseer's pearl and rings`);
    const head = $('.hg-navbar'); if (head && hits(head.getBoundingClientRect(), { ...ov, top: ov.top + o[2] * 0.4 }) && win.scrollY < 4) problem('warning', 'the header overlaps the Overseer');
  } else problem('warning', 'the sky did not say where the Overseer is (data-overseer)');
  // The wish box: on screen, tall enough to tap, not under anything, a button as well.
  const input = $('[data-sky-wish] input'), button = $('[data-sky-wish] button');
  if (input && button) {
    for (const [what, e] of [['box', input], ['button', button]]) {
      const r = e.getBoundingClientRect();
      if (r.height < 40) problem('bug', `the wish ${what} is ${Math.round(r.height)}px tall (under 40)`);
      if (!inside(r, vw, vh + 600)) problem('bug', `the wish ${what} is partly off screen`);
      const top = doc.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), Math.min(Math.max(r.top + r.height / 2, 0), vh - 1));
      if (r.top >= 0 && r.bottom <= vh && top && top !== e && !e.contains(top)) problem('bug', `something covers the wish ${what} (${top.tagName.toLowerCase()})`);
    }
    if (input.getBoundingClientRect().width < Math.min(200, vw * 0.5)) problem('bug', 'the wish box is narrow');
  }
  for (const sel of ['.sky h1', '.sky .lede', '.sky .actions .btn', '[data-sky-wish] button', '.sky-thing span']) {
    for (const e of doc.querySelectorAll(sel)) {
      if (e.clientWidth > 0 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2)) problem('bug', `text runs out of its box in ${sel} ("${(e.textContent || '').trim().slice(0, 24)}": ${e.scrollWidth}x${e.scrollHeight} in ${e.clientWidth}x${e.clientHeight})`, true);
    }
  }
  checkHeader(win, doc, problem, afterWish ? 'after the wish' : 'hero');
}

/** The rectangles of an element's text, one per line (the block's own box can be much wider than the words). */
function lineRects(doc, e) {
  const rg = doc.createRange(); rg.selectNodeContents(e);
  return [...rg.getClientRects()];
}

/** The header: there, tall enough, its links and buttons not cut off, and a text colour that differs from what is behind it. */
function checkHeader(win, doc, problem, where) {
  const head = doc.querySelector('.hg-navbar');
  if (!head) { problem('bug', 'no header'); return; }
  const r = head.getBoundingClientRect(), vw = doc.documentElement.clientWidth;
  if (r.height < 40 || r.top > 1 || r.top < -r.height + 8) problem('bug', `the header is not at the top of the window while at ${where} (top ${Math.round(r.top)}, ${Math.round(r.height)} tall)`);
  // What is shown (the links fold into the Menu on a phone): each whole inside the window and its own box, tall enough to
  // tap, none over another.
  const shown = [...head.querySelectorAll('a,button')].filter((e) => e.getBoundingClientRect().width > 0);
  for (const e of shown) {
    const q = e.getBoundingClientRect(), name = (e.textContent || '').trim().slice(0, 20);
    if (q.right > vw + 1 || q.left < -1) problem('bug', `the header's "${name}" is cut off at ${where} (${Math.round(q.left)}..${Math.round(q.right)} of ${vw})`, true);
    if (e.scrollWidth > e.clientWidth + 1) problem('bug', `the header's "${name}" is clipped at ${where} (text ${e.scrollWidth}px in a ${e.clientWidth}px button)`, true);
    if (q.height < 40 || q.width < 40) problem('bug', `the header's "${name}" is ${Math.round(q.width)}x${Math.round(q.height)} at ${where}: too small to tap`, true);
    const mid = doc.elementFromPoint(Math.min(Math.max(q.left + q.width / 2, 0), vw - 1), Math.min(Math.max(q.top + q.height / 2, 0), win.innerHeight - 1));
    if (mid && mid !== e && !e.contains(mid) && !mid.contains(e)) problem('bug', `something covers the header's "${name}" at ${where} (${mid.tagName.toLowerCase()})`, true);
  }
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
    if (hits(shown[i].getBoundingClientRect(), shown[j].getBoundingClientRect())) problem('bug', `the header's "${(shown[i].textContent || '').trim().slice(0, 16)}" and "${(shown[j].textContent || '').trim().slice(0, 16)}" overlap at ${where}`, true);
  }
  for (const label of ['Sign in', 'Create account']) {
    if (!shown.some((e) => (e.textContent || '').trim() === label) && !head.querySelector('.hg-nav-actions [hidden]')) problem('bug', `the header has no "${label}" at ${where}`, true);
  }
  const mark = head.querySelector('.hg-brand');
  if (mark) {
    const c = rgb(getComputedStyle(mark).color), b = backdrop(head);
    if (b) { const ratio = contrast(c, b); if (ratio < 3) problem('bug', `the header's brand reads at ${ratio.toFixed(1)}:1 against its background (${where})`); }
  }
}

function rgb(s) { const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?/.exec(s || ''); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; }
/** The header's own background when it is opaque (null when the sky or page shows through: the screenshot is judged). */
function backdrop(el) {
  const c = rgb(getComputedStyle(el).backgroundColor);
  return c && c[3] >= 0.9 ? c : null;
}
function lum(c) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
