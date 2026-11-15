// The `hud-overlap` scenario: every visible HUD control measured at each step (mirror open, mirror closed, chat open,
// chat closed) at 1280x720, 390x844 and 844x390. Each size is a same-origin iframe of exactly that size (as in
// phone-hud-layout), so media queries and the touch layout are real. No polling of the layout: a measure waits for the
// transition's own `transitionend` (one fallback timeout for a layout where nothing moves).
// Events (named for what they check): hud-no-overlap, hud-in-viewport, hud-tap-targets, each pass or fail per step and
// size; a failure names the two controls (or the one) in a problem.
const SIZES = ['1280x720', '390x844', '844x390'];
const MIN = 44;
const CONTROLS = [
  '.gs-acts .more', '.gs-acts [data-intent]', '.jr-btn', '.qs-btn', '.tour-stuck', '.tour-track', '.qs-track',
  '.hc-chat button', '.hc-chat input', '#tl-hide', '#touch .a', '#touch .b', '#touch .pad',
  '.mr', '.mr-x', '.mr-btn', '.mr-chip', '.mr-card', '.mr-sw',
].join(',');

export async function runHudOverlap(t, options = {}) {
  const sizes = (Array.isArray(options.sizes) && options.sizes.length ? options.sizes : SIZES).map(String);
  t.event('plan', `hud-overlap: ${sizes.join(', ')} (an iframe each)`);
  const failed = [];
  for (let i = 0; i < sizes.length; i++) {
    const [w, h] = sizes[i].split('x').map(Number);
    if (!(w > 0 && h > 0)) throw new Error(`bad size "${sizes[i]}"`);
    failed.push(...await oneSize(t, w, h, sizes[i]));
    t.progress(0.05 + 0.9 * ((i + 1) / sizes.length));
  }
  document.getElementById('pt-hud-overlap')?.remove();
  if (failed.length) { t.event('hud-overlap-failed', failed.length + ' problems'); throw new Error(`hud-overlap: ${failed.slice(0, 6).join(' | ')}`); }
  t.event('hud-overlap-ok', `no overlap, nothing off screen, taps ${MIN}px at ${sizes.join(', ')}`);
  t.finish('done');
}

async function oneSize(t, w, h, label) {
  const bad = [];
  document.getElementById('pt-hud-overlap')?.remove();
  const stage = document.createElement('div');
  stage.id = 'pt-hud-overlap';
  stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0a0e18;overflow:hidden';
  const frame = document.createElement('iframe');
  const scale = Math.min(1, innerWidth / w, (innerHeight - 24) / h);
  frame.style.cssText = `position:absolute;left:${Math.round((innerWidth - w * scale) / 2)}px;top:24px;width:${w}px;height:${h}px;border:0;background:#000;transform:scale(${scale});transform-origin:0 0`;
  frame.setAttribute('allow', 'autoplay; fullscreen');
  stage.append(frame);
  document.body.appendChild(stage);
  const touch = w < 760 || h < 500;
  await new Promise((res, rej) => { frame.onload = res; frame.onerror = () => rej(new Error(`${label}: sandbox did not load`)); frame.src = '/play/sandbox' + (touch ? '?touch=1' : ''); });
  const win = frame.contentWindow, doc = win.document;
  try { frame.focus(); win.focus(); } catch { /* fine */ }
  const $ = (s) => doc.querySelector(s);
  const until = async (fn, ms, what) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch { /* not yet */ } await t.wait(200); }
    throw new Error(`${label}: timed out waiting for ${what}`);
  };
  const press = (key) => win.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true }));
  const settle = () => new Promise((res) => {
    let done = false;
    const end = () => { if (done) return; done = true; doc.removeEventListener('transitionend', onEnd, true); res(); };
    const onEnd = () => win.requestAnimationFrame(() => win.requestAnimationFrame(end));
    doc.addEventListener('transitionend', onEnd, true);
    setTimeout(end, 700);
  });
  const shown = (el) => {
    if (!el || !el.getClientRects().length) return false;
    const cs = win.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && !el.closest('[hidden], .hp-enter');
  };
  const name = (el) => {
    const txt = (el.getAttribute('aria-label') || el.textContent || el.placeholder || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return `${el.tagName.toLowerCase()}${cls}${txt ? ` "${txt}"` : ''}`;
  };
  const measure = async (step) => {
    await settle();
    t.scene(`HUD ${step} at ${label}`);
    const tag = `${step} ${label}`;
    const list = [...doc.querySelectorAll(CONTROLS)].filter(shown).map((el) => ({ el, r: el.getBoundingClientRect(), n: name(el) })).filter((c) => c.r.width > 1 && c.r.height > 1);
    const overlap = [], off = [], small = [];
    for (const c of list) {
      if (c.r.left < -1 || c.r.top < -1 || c.r.right > w + 1 || c.r.bottom > h + 1) off.push(c.n);
      // the panel and the touch pad are containers, not taps
      if (!c.el.matches('.mr, #touch .pad, .tour-track, .qs-track') && (c.r.width < MIN - 0.5 || c.r.height < MIN - 0.5)) small.push(`${c.n} ${Math.round(c.r.width)}x${Math.round(c.r.height)}`);
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ow = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oh = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ow > 1 && oh > 1) overlap.push(`${a.n} overlaps ${b.n}`);
    }
    const verdict = (ev, list2, msg) => {
      if (list2.length) for (const o of list2) { bad.push(`${ev} ${tag}: ${o}`); t.problem('error', `${ev} failed at ${tag}: ${o}${msg}`); }
      else t.event(ev, tag);
    };
    t.event('hud-measured', `${tag}: ${list.length} controls`);
    const box = (s) => { const el = $(s); if (!el || !shown(el)) return 'none'; const r = el.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; };
    t.event('hud-boxes', `hud-overlap/${step.replace(/ /g, '-')}/${label}: quest banner ${box('.qs-btn')}; top-right actions ${box('.gs-acts')}; open panel ${box('.mr, [data-hud-panel]')}; chat ${box('.hc-chat')}`);
    verdict('hud-no-overlap', overlap, '');
    verdict('hud-in-viewport', off, ' is outside the screen');
    verdict('hud-tap-targets', small, ` is under ${MIN}px`);
  };
  try {
    await until(() => win.HawkesPlay && win.HawkesPlay.world && win.HawkesPlay.world.player && win.HawkesPlay.world.player.alive, 120000, 'the island to load');
    if ($('.hp-title')) {
      const prompt = $('.hp-title [data-prompt]');
      if (prompt && !prompt.hidden) prompt.click();
      await until(() => $('.hp-title [data-play], .hp-title [data-continue]'), 8000, 'title Play');
      const play = $('.hp-title [data-continue], .hp-title [data-play]');
      if (play) play.click();
      await until(() => !$('.hp-title'), 10000, 'the title to leave');
    } else {
      const veil = $('.hp-enter button');
      if (veil) { veil.click(); await until(() => !$('.hp-enter'), 10000, 'the veil to leave'); }
    }
    if (!$('.mr .mr-q')) {
      await t.wait(800);
      press('Escape'); press(' ');
      t.event('intro-skipped', label);
    }
    await until(() => $('.mr .mr-q'), 60000, 'the mirror to open');
    await measure('mirror open');
    const x = $('.mr .mr-x');
    if (x) x.click(); else press('Escape');
    await until(() => !$('.mr'), 10000, 'the mirror to close');
    await measure('mirror closed');
    const chat = win.HawkesPlay.chat;
    if (chat && chat.open && chat.open()) {
      await until(() => $('.hc-chat form.on, .hc-chat .on, .hc-chat input'), 5000, 'the chat input to open');
      await measure('chat open');
      const input = $('.hc-chat input');
      (input || win).dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await measure('chat closed');
    } else t.problem('warn', `${label}: the Overseer chat could not be opened: its steps were not measured`);
  } finally { /* the frame is removed by the caller on the next size */ }
  return bad;
}
