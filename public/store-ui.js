// Shared by /games and /games/<id>: cover cards and the muted in-place previews.
// A preview loads only near the viewport and plays one at a time: on a desktop while the pointer is over its card, on a
// phone when the card sits in the middle band of the screen. Nothing here uses a timer.
export const esc = (t) => { const d = document.createElement('div'); d.textContent = t ?? ''; return d.innerHTML; };
export const isOut = (u) => /^https?:/.test(u || '');
const HUES = [205, 160, 285, 30, 340, 190, 50, 250, 10];
/** A game without captured media yet still gets a card: its name on a world of its own colour, never an emoji or a letter. */
export const coverFor = (g) => g.cover || (g.id === 'sickofit' ? '/play/sickofit/cover.svg' : '');
export const hostOf = (u) => { try { return new URL(u).host; } catch { return ''; } };

export function coverCard(g, i, { href, live } = {}) {
  const a = document.createElement('a');
  a.className = 'cv-card';
  a.href = href || g.page || g.url;
  a.style.setProperty('--hue', HUES[i % HUES.length]);
  const img = coverFor(g);
  const chips = (g.genres || []).slice(0, 3).map((c) => `<li>${esc(c)}</li>`).join('');
  a.innerHTML = `<div class="cv-media${img ? '' : ' cv-plain'}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" width="640" height="360">` : `<span class="cv-name">${esc(g.name)}</span>`}${live ? `<span class="live-now"><i></i>${esc(live)}</span>` : ''}</div>
    <div class="cv-body"><h3>${esc(g.name)}</h3><p>${esc(g.hook || '')}</p><ul class="chips">${chips}</ul></div>`;
  if (g.preview) a.dataset.preview = JSON.stringify(g.preview);
  return a;
}

let playing = null;
function stop(card) {
  const v = card.querySelector('video');
  if (v) { v.pause(); card.classList.remove('is-playing'); }
  if (playing === card) playing = null;
}
function start(card) {
  if (playing && playing !== card) stop(playing);
  const media = card.querySelector('.cv-media');
  let v = card.querySelector('video');
  if (!v) {
    const p = JSON.parse(card.dataset.preview);
    v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto'; v.poster = p.poster || '';
    v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('aria-hidden', 'true');
    v.innerHTML = `<source src="${esc(p.webm)}" type="video/webm"><source src="${esc(p.mp4)}" type="video/mp4">`;
    media.prepend(v);
  }
  playing = card;
  card.classList.add('is-playing');
  v.play().catch(() => {});
}
export const playingCount = () => document.querySelectorAll('video').length && [...document.querySelectorAll('video')].filter((v) => !v.paused).length;

export function attachPreviews(root = document) {
  if (navigator.connection && navigator.connection.saveData) return; // posters only
  const cards = [...root.querySelectorAll('[data-preview]')];
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (fine) {
    for (const c of cards) {
      c.addEventListener('pointerenter', () => start(c));
      c.addEventListener('pointerleave', () => stop(c));
      c.addEventListener('focus', () => start(c));
      c.addEventListener('blur', () => stop(c));
    }
    return;
  }
  // Phone: the card whose centre is in the middle band plays; leaving the band stops it. The band is the middle 20% of the
  // screen, so at most one card is in it on a one-column layout.
  const io = new IntersectionObserver((es) => { for (const e of es) (e.isIntersecting ? start : stop)(e.target); }, { rootMargin: '-40% 0px -40% 0px', threshold: 0 });
  for (const c of cards) io.observe(c);
}

/** For the hero clip on a store page: loads when near the viewport and plays muted, looping. */
export function lazyClip(box, p) {
  const v = document.createElement('video');
  v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'none'; v.poster = p.poster || '';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  v.innerHTML = `<source src="${esc(p.webm)}" type="video/webm"><source src="${esc(p.mp4)}" type="video/mp4">`;
  box.prepend(v);
  const save = navigator.connection && navigator.connection.saveData;
  if (save) return;
  new IntersectionObserver((es, io) => { for (const e of es) if (e.isIntersecting) { v.preload = 'auto'; v.play().catch(() => {}); } else v.pause(); }, { rootMargin: '200px' }).observe(box);
}
