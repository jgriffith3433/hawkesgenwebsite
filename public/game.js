// /games/<id>: one store page for every Hawkes game, from GET /v1/catalogue. The title and share tags are set here from the
// catalogue entry (the page is one static template).
import { esc, isOut, hostOf, coverFor, coverCard, attachPreviews, lazyClip } from '/store-ui.js';

const id = decodeURIComponent(location.pathname.replace(/\/+$/, '').split('/').pop() || '').toLowerCase();
const $ = (i) => document.getElementById(i);
const abs = (u) => new URL(u, location.origin).href;
const meta = (sel, v) => { const m = document.querySelector(sel); if (m) m.setAttribute('content', v); };
const BADGES = { web: 'Plays in your browser', phone: 'Phone', desktop: 'Desktop' };

fetch('/v1/catalogue').then((r) => (r.ok ? r.json() : Promise.reject(new Error('catalogue')))).then(({ games }) => {
  const g = games.find((x) => x.slug === id || x.id === id);
  if (!g) return notFound(games);
  show(g, games);
}).catch(() => notFound([]));

function notFound(games) {
  $('gp').dataset.state = 'missing';
  $('name').textContent = 'We could not find that game';
  $('hook').innerHTML = 'Try <a href="/games">all Hawkes games</a>.';
  $('more').innerHTML = '';
  games.forEach((g, i) => $('more').append(coverCard(g, i)));
}

function show(g, games) {
  const cover = coverFor(g);
  document.title = `${g.name} · Hawkes Games`;
  const url = abs(g.page || `/games/${g.slug}`);
  meta('meta[name="description"]', g.hook);
  for (const [sel, v] of [['meta[property="og:title"]', document.title], ['meta[name="twitter:title"]', document.title], ['meta[property="og:description"]', g.hook], ['meta[property="og:url"]', url], ['meta[property="og:image"]', cover ? abs(cover) : abs('/brand/og.png')], ['meta[name="twitter:image"]', cover ? abs(cover) : abs('/brand/og.png')]]) meta(sel, v);
  $('name').textContent = g.name;
  $('hook').textContent = g.hook;
  $('genres').innerHTML = g.genres.map((c) => `<li>${esc(c)}</li>`).join('');
  $('platforms').innerHTML = g.platforms.map((p) => `<li data-platform="${esc(p)}">${esc(BADGES[p] || p)}</li>`).join('');

  const hero = $('hero');
  if (g.preview) { hero.classList.add('has-clip'); lazyClip(hero, g.preview); }
  else if (cover) hero.innerHTML = `<img src="${esc(cover)}" alt="${esc(g.name)}" width="1280" height="720">`;
  else { hero.classList.add('cv-plain'); hero.innerHTML = `<span class="cv-name">${esc(g.name)}</span>`; }

  // Play: the games on this site fade in; the others say where they open.
  const box = $('playBox');
  if (g.playsHere) {
    box.innerHTML = `<a class="btn btn-play btn-lg" id="play" href="${esc(g.url)}">Play now</a><p class="muted">Free, in your browser. No download.</p>`;
  } else {
    box.innerHTML = `<a class="btn btn-play btn-lg" id="play" href="${esc(g.url)}" target="_blank" rel="noopener">Play now</a><p class="muted">Opens ${esc(hostOf(g.url))}</p>`;
  }

  const shots = g.screenshots || [];
  $('shots').innerHTML = shots.map((s, i) => `<button type="button" class="shot" data-i="${i}" aria-label="Screenshot ${i + 1} of ${shots.length}"><img src="${esc(s)}" alt="${esc(g.name)} screenshot ${i + 1}" loading="lazy" width="320" height="180"></button>`).join('');
  $('shots').hidden = !shots.length;
  $('features').innerHTML = g.features.map((f) => `<li>${esc(f)}</li>`).join('');
  $('blurb').textContent = g.blurb || '';
  $('kb').innerHTML = g.controls.keyboard.map((c) => `<li>${esc(c)}</li>`).join('');
  $('touch').innerHTML = g.controls.touch.map((c) => `<li>${esc(c)}</li>`).join('');

  const others = games.filter((x) => x.id !== g.id);
  $('more').innerHTML = '';
  others.forEach((x, i) => $('more').append(coverCard(x, i)));
  attachPreviews($('more'));
  lightbox(shots, g.name);
  $('gp').dataset.state = 'ready';
}

// Full-size screenshots: click or tap to open, arrows, swipe, Escape.
function lightbox(shots, name) {
  const lb = $('lb'), img = $('lbImg');
  let at = 0;
  const go = (n) => { at = (n + shots.length) % shots.length; img.src = shots[at]; img.alt = `${name} screenshot ${at + 1}`; };
  const open = (n) => { go(n); lb.hidden = false; lb.querySelector('.lb-x').focus(); };
  const close = () => { lb.hidden = true; };
  $('shots').addEventListener('click', (e) => { const b = e.target.closest('.shot'); if (b) open(Number(b.dataset.i)); });
  lb.querySelector('.lb-x').onclick = close;
  lb.querySelector('.lb-prev').onclick = () => go(at - 1);
  lb.querySelector('.lb-next').onclick = () => go(at + 1);
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => { if (lb.hidden) return; if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') go(at - 1); else if (e.key === 'ArrowRight') go(at + 1); });
  let x0 = null;
  lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  lb.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1)); });
}
