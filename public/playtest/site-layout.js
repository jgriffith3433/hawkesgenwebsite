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
  id: 'site-layout', title: 'The landing page at 390x844, 768x1024 and 1440x900: the sky, a wish and its card, then the steps, pricing and API sections, with a screenshot at each stage and a check for horizontal scroll', seconds: 150, tags: ['full'],
  description: 'no sign-up, no game. For each size: the hero (scene "Site WxH: hero"), a wish typed with real key events and sent (the card: "Site WxH: wish card"), then scrolling to #how-it-works ("steps"), #pricing and #api, a scene each. The checklist (AGENTS.md "The landing page checklist") is measured: headline readable, the Overseer not covered, the wish box usable, the header legible, no horizontal scroll (any, at any size, ends the run as an error). options: sizes (default ["390x844","768x1024","1440x900"]), wish (text), frames (false: play in the browser\'s own window instead of an iframe per size)',
};

const SIZES = ['390x844', '768x1024', '1440x900'];
const SECTIONS = [['steps', '#how-it-works'], ['pricing', '#pricing'], ['api', '#api']];

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
  document.getElementById('pt-site-stage')?.remove();
  if (failed.length) {
    t.event('horizontal-scroll', failed.join(' | '));
    throw new Error(`horizontal scroll: ${failed.join(' | ')}`);
  }
  t.event('no-horizontal-scroll', `none at ${sizes.join(', ')}`);
  t.finish('done');
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
  const problem = (sev, msg) => t.problem(sev, `${label}: ${msg}`);
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
  const visible = cr.width > 20 && cr.height > 20 && cr.left >= -1 && cr.right <= s.w + 1 && cr.bottom > 0 && cr.top < s.h;
  if (visible) t.event('wish-card', `"${(card.textContent || '').trim().slice(0, 40)}" at ${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)}`);
  else problem('bug', `the wish card is not fully on screen (${Math.round(cr.left)},${Math.round(cr.top)} ${Math.round(cr.width)}x${Math.round(cr.height)} in ${s.w}x${s.h})`);
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
  return sideways;
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
  // The Overseer: nothing of the text, the wish box or the card on top of the pearl.
  const sky = $('[data-sky]');
  const o = (sky && sky.dataset.overseer || '').split(',').map(Number);
  if (o.length === 3 && o[2] > 0) {
    const skyTop = sky.getBoundingClientRect().top, ov = { left: o[0] - o[2], right: o[0] + o[2], top: skyTop + o[1] - o[2], bottom: skyTop + o[1] + o[2] };
    for (const [what, sel] of [['headline', '.sky h1'], ['intro text', '.sky .lede'], ['wish box', '[data-sky-wish]'], ['reply', '[data-sky-reply]:not([hidden])'], ['wish card', '.sky-thing'], ['buttons', '.sky .actions']]) {
      const e = $(sel); if (!e) continue;
      if (hits(e.getBoundingClientRect(), ov)) problem('bug', `the ${what} covers the Overseer`);
    }
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
  checkHeader(win, doc, problem, afterWish ? 'after the wish' : 'hero');
}

/** The header: there, tall enough, its links and buttons not cut off, and a text colour that differs from what is behind it. */
function checkHeader(win, doc, problem, where) {
  const head = doc.querySelector('.hg-navbar');
  if (!head) { problem('bug', 'no header'); return; }
  const r = head.getBoundingClientRect(), vw = doc.documentElement.clientWidth;
  if (r.height < 40 || r.top > 1 || r.top < -r.height + 8) problem('bug', `the header is not at the top of the window while at ${where} (top ${Math.round(r.top)}, ${Math.round(r.height)} tall)`);
  for (const e of head.querySelectorAll('a,button')) {
    const q = e.getBoundingClientRect();
    if (q.width > 0 && (q.right > vw + 1 || q.left < -1)) { problem('bug', `the header's "${(e.textContent || '').trim().slice(0, 20)}" is cut off at ${where}`); break; }
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
