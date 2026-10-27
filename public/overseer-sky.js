// The landing page's sky: what every Hawkes Gen world looks like from the ground (docs/story.md). The Overseer, a pearl
// sphere with seams and two turning rings of light, hangs over a curved planet; whatever appears is beamed down from it.
// The wish box sends a real beam (and a card that assembles where it lands); it is a preview of the beam, not a build.
// Plain canvas 2D, no dependencies. Draws only while the hero is on screen; with reduced motion it draws one still frame.
(function () {
  'use strict';
  const hero = document.querySelector('[data-sky]');
  const cv = hero && hero.querySelector('canvas');
  if (!hero || !cv || !cv.getContext) return;
  const ctx = cv.getContext('2d');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const GLOW = [143, 216, 255];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const TAU = Math.PI * 2;

  let W = 0, H = 0, dpr = 1, vis = true, raf = 0, t0 = performance.now(), last = t0;
  let px = 0, py = 0, tpx = 0, tpy = 0; // pointer parallax, -1..1
  let beams = []; // { x, y, born, life, soft }
  let stars = [];
  const O = { x: 0, y: 0, r: 0 };
  const P = { cx: 0, cy: 0, R: 0 };

  function surfaceY(x) { const dx = x - P.cx; return P.cy - Math.sqrt(Math.max(0, P.R * P.R - dx * dx)); }

  function resize() {
    const rect = hero.getBoundingClientRect();
    W = Math.max(320, Math.round(rect.width)); H = Math.max(420, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, W < 700 ? 1.5 : 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const narrow = W < 820;
    O.r = narrow ? Math.min(W * 0.15, 64) : Math.min(W * 0.13, H * 0.22);
    O.x = narrow ? W * 0.5 : W * 0.76; // wide: right of the headline, whose longest line ends before the rings (1.7 r each side) begin
    O.y = narrow ? 68 + O.r * 1.1 : H * 0.34;
    // phone: the text starts below the Overseer and the line it speaks (the hero is as tall as the text needs)
    hero.dataset.overseer = [O.x, O.y, O.r].map(Math.round).join(','); // where the Overseer is (x, y, radius in px): the layout playtest checks nothing covers it
    hero.style.setProperty('--sky-top', narrow ? Math.round(O.y + O.r * 1.9 + 52) + 'px' : '120px');
    P.R = W * 1.9; P.cx = W * (narrow ? 0.5 : 0.56); P.cy = H * (narrow ? 0.9 : 0.86) + P.R;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const n = Math.round(Math.min(260, (W * H) / 5200));
    stars = Array.from({ length: n }, () => ({ x: rnd() * W, y: rnd() * H * 0.82, z: 0.3 + rnd() * 0.7, ph: rnd() * TAU, s: 0.4 + rnd() * 1.1 }));
    placeCards();
    if (reduce) frame(performance.now());
  }

  // ---- drawing
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#03050c'); g.addColorStop(0.45, '#0a1328'); g.addColorStop(0.72, '#0f2447'); g.addColorStop(1, '#1c4575');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  function drawStars(t) {
    for (const s of stars) {
      const tw = reduce ? 0.8 : 0.55 + 0.45 * Math.sin(t * 0.0012 * s.s + s.ph);
      const fade = 1 - Math.max(0, (s.y / (H * 0.82) - 0.45)) * 1.6;
      if (fade <= 0) continue;
      ctx.fillStyle = `rgba(235,244,255,${(0.75 * tw * fade).toFixed(3)})`;
      ctx.fillRect(s.x + px * 8 * s.z, s.y + py * 5 * s.z, s.s * (s.z > 0.8 ? 1.6 : 1), s.s * (s.z > 0.8 ? 1.6 : 1));
    }
  }
  function drawPlanet() {
    // the air: a glow hugging the rim, thickest right at the horizon
    const rim = ctx.createRadialGradient(P.cx, P.cy, P.R * 0.985, P.cx, P.cy, P.R * 1.06);
    rim.addColorStop(0, rgba(GLOW, 0.55)); rim.addColorStop(0.25, rgba(GLOW, 0.16)); rim.addColorStop(1, rgba(GLOW, 0));
    ctx.fillStyle = rim; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(P.cx - P.R * 0.2, P.cy - P.R * 1.05, P.R * 0.05, P.cx, P.cy, P.R);
    g.addColorStop(0, '#2c4f6e'); g.addColorStop(0.55, '#10243b'); g.addColorStop(1, '#060d18');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.cx, P.cy, P.R, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(GLOW, 0.8); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(P.cx, P.cy, P.R, 0, TAU); ctx.stroke();
    // lights of things that were beamed in before you came: tiny, fixed, a little alive
    ctx.fillStyle = 'rgba(255,236,190,0.55)';
    for (let i = 0; i < 26; i++) {
      const x = (i * 0.0381 + 0.03 + ((i * 7) % 5) * 0.011) * W * 1.1 + W * 0.02;
      const y = surfaceY(x) + 8 + ((i * 13) % 9) * 5;
      if (y > H) continue;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(last * 0.001 + i * 1.7);
      ctx.fillRect(x, y, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;
  }
  function ringHalf(cx, cy, rx, ry, tilt, front, off) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(tilt);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, front ? 0 : Math.PI, front ? Math.PI : TAU); ctx.lineDashOffset = off; ctx.stroke(); ctx.restore();
  }
  function drawOverseer(t) {
    const x = O.x + px * 14, y = O.y + py * 9, r = O.r;
    // halo
    const h = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 3.2);
    h.addColorStop(0, rgba(GLOW, 0.42)); h.addColorStop(0.35, rgba(GLOW, 0.13)); h.addColorStop(1, rgba(GLOW, 0));
    ctx.fillStyle = h; ctx.fillRect(x - r * 3.3, y - r * 3.3, r * 6.6, r * 6.6);
    const spin = reduce ? 0.6 : t * 0.00007;
    ctx.globalCompositeOperation = 'lighter'; ctx.setLineDash([r * 0.1, r * 0.06]); ctx.lineCap = 'butt';
    const rings = [[1.42, 0.2, -0.22, 0.014, 0.26], [1.68, 0.36, 0.38, 0.009, -0.17]];
    const setRing = (k) => { const [rx, ry, , lw] = rings[k]; ctx.lineWidth = Math.max(1, r * lw); ctx.strokeStyle = 'rgba(205,240,255,0.85)'; return [r * rx, r * ry]; };
    for (let k = 0; k < 2; k++) { const [rx, ry] = setRing(k); ringHalf(x, y, rx, ry, rings[k][2], false, t * rings[k][4] * (reduce ? 0 : 0.05) * -1); }
    ctx.globalCompositeOperation = 'source-over'; ctx.setLineDash([]);
    // the pearl
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
    const hull = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.08, x, y, r * 1.08);
    hull.addColorStop(0, '#ffffff'); hull.addColorStop(0.45, '#e9eef5'); hull.addColorStop(0.8, '#9db0c8'); hull.addColorStop(1, '#4b6182');
    ctx.fillStyle = hull; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    // seams: parallels and turning meridians, glowing
    ctx.strokeStyle = rgba(GLOW, 0.8); ctx.lineWidth = Math.max(0.8, r * 0.006);
    for (const lat of [-0.5, 0, 0.5]) { const yy = y + lat * r, half = Math.sqrt(1 - lat * lat) * r; ctx.beginPath(); ctx.ellipse(x, yy, half, half * 0.16, 0, 0, TAU); ctx.stroke(); }
    for (let i = 0; i < 4; i++) { const a = spin * TAU + (i * Math.PI) / 4; ctx.beginPath(); ctx.ellipse(x, y, Math.abs(Math.cos(a)) * r + 0.01, r, 0, 0, TAU); ctx.stroke(); }
    // the lit docking bay
    const bx = x + r * 0.42 * Math.sin(spin * TAU * 2 + 1) , by = y + r * 0.18;
    ctx.fillStyle = 'rgba(255,220,160,0.95)'; ctx.fillRect(bx - r * 0.07, by - r * 0.02, r * 0.14, r * 0.04);
    // night side: the planet's shadow takes the lower right
    const sh = ctx.createRadialGradient(x - r * 0.5, y - r * 0.5, r * 0.4, x + r * 0.2, y + r * 0.2, r * 1.25);
    sh.addColorStop(0, 'rgba(8,16,40,0)'); sh.addColorStop(1, 'rgba(8,16,40,0.62)');
    ctx.fillStyle = sh; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter'; ctx.setLineDash([r * 0.1, r * 0.06]);
    for (let k = 0; k < 2; k++) { const [rx, ry] = setRing(k); ringHalf(x, y, rx, ry, rings[k][2], true, t * rings[k][4] * (reduce ? 0 : 0.05) * -1); }
    ctx.setLineDash([]);
    // the emitter
    const ey = y + r * 0.965, pulse = 0.65 + 0.35 * Math.sin(t * 0.004);
    const e = ctx.createRadialGradient(x, ey, 0, x, ey, r * 0.2);
    e.addColorStop(0, `rgba(255,255,255,${pulse})`); e.addColorStop(1, rgba(GLOW, 0));
    ctx.fillStyle = e; ctx.fillRect(x - r * 0.2, ey - r * 0.2, r * 0.4, r * 0.4);
    ctx.globalCompositeOperation = 'source-over';
    O.ex = x; O.ey = ey;
  }
  function drawBeams(t) {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beams) {
      const k = (t - b.born) / b.life;
      if (k < 0 || k > 1) continue;
      const grow = Math.min(1, k / 0.14), fade = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      const a = (b.soft ? 0.5 : 1) * fade;
      const ex = O.ex, ey = O.ey;
      const tx = ex + (b.x - ex) * grow, ty = ey + (b.y - ey) * grow;
      const w0 = O.r * 0.035, w1 = (b.soft ? 12 : 26) * (0.7 + 0.3 * Math.sin(t * 0.03));
      const g = ctx.createLinearGradient(ex, ey, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${0.95 * a})`); g.addColorStop(1, rgba(GLOW, 0.5 * a));
      ctx.fillStyle = g; ctx.beginPath();
      ctx.moveTo(ex - w0, ey); ctx.lineTo(ex + w0, ey); ctx.lineTo(tx + w1, ty); ctx.lineTo(tx - w1, ty); ctx.closePath(); ctx.fill();
      // the spot where it lands: a ring on the ground and light rising off it
      if (grow >= 1) {
        const rr = (b.soft ? 22 : 46) * (0.6 + 0.4 * Math.min(1, (k - 0.14) / 0.2));
        ctx.strokeStyle = rgba(GLOW, 0.9 * a); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.ellipse(b.x, b.y, rr, rr * 0.22, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * a})`;
        ctx.beginPath(); ctx.ellipse(b.x, b.y, rr * 0.55, rr * 0.12, 0, 0, TAU); ctx.stroke();
        for (let i = 0; i < (b.soft ? 6 : 14); i++) {
          const ph = (t * 0.0007 + i * 0.37) % 1, sx = b.x + Math.sin(i * 12.9) * rr * 0.8, sy = b.y - ph * 90;
          ctx.fillStyle = `rgba(220,245,255,${(1 - ph) * 0.8 * a})`; ctx.fillRect(sx, sy, 1.8, 1.8);
        }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    beams = beams.filter((b) => t - b.born < b.life);
  }
  function frame(now) {
    last = now; const t = now - t0;
    px += (tpx - px) * 0.05; py += (tpy - py) * 0.05;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky(); drawStars(t); drawPlanet(); drawOverseer(t); drawBeams(t);
  }
  function loop(now) {
    raf = 0;
    if (!vis || document.hidden) return;
    frame(now);
    raf = requestAnimationFrame(loop);
  }
  function wake() { if (!raf && !reduce && vis && !document.hidden) raf = requestAnimationFrame(loop); }

  // ---- beaming things in
  const cards = hero.querySelector('[data-sky-cards]');
  const placed = [];
  function placeCards() { for (const c of placed) { const p = c.pos(); c.el.style.left = p.x + 'px'; c.el.style.top = p.y + 'px'; } }
  function beamTo(fx, soft) {
    const x = W * fx, y = surfaceY(x);
    const now = performance.now() - t0;
    beams.push({ x, y, born: now, life: soft ? 2200 : 3600, soft: Boolean(soft) });
    wake();
    return { x, y };
  }
  function materialize(text, fx) {
    const at = beamTo(fx, false);
    const el = document.createElement('div');
    el.className = 'sky-thing'; el.setAttribute('role', 'status');
    const initial = (text.trim()[0] || '•').toUpperCase();
    el.innerHTML = '<i></i><b></b><span></span>';
    el.querySelector('b').textContent = initial;
    el.querySelector('span').textContent = text;
    if (cards) cards.appendChild(el);
    // the card stays inside the first screen: on a short window the ground is below the fold, so it sits at the bottom edge
    const rec = { el, pos: () => ({ x: Math.min(Math.max(W * fx, 90), W - 90), y: Math.min(surfaceY(W * fx) - 4, window.innerHeight - 16 - hero.getBoundingClientRect().top) }) };
    placed.push(rec); const p = rec.pos(); el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    while (placed.length > 3) { const old = placed.shift(); old.el.classList.add('gone'); setTimeout(() => old.el.remove(), 700); }
    if (reduce) el.classList.add('still'); else setTimeout(() => el.classList.add('still'), 1500);
    return at;
  }

  // ---- the form
  const form = hero.querySelector('[data-sky-wish]');
  const input = form && form.querySelector('input');
  const reply = hero.querySelector('[data-sky-reply]');
  const hints = ['a lighthouse made of glass', 'a jump that feels floaty', 'a haunted vending machine', 'rain that smells of pennies', 'a very serious toaster', 'a boat that is also a piano'];
  let hi = 0, fxs = [0.5, 0.36, 0.64, 0.28, 0.72], fi = 0;
  if (input) {
    setInterval(() => { if (document.activeElement !== input && !input.value) { hi = (hi + 1) % hints.length; input.placeholder = hints[hi]; } }, 3200);
    input.placeholder = hints[0];
  }
  const replies = ['Beamed in. Now imagine it with a world around it.', 'There it is. I enjoyed that.', 'Appeared. Everything here arrived the same way.', 'Done. In a world, I would build it for you.'];
  let ri = 0, going = 0;
  if (form) form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value.trim().slice(0, 48);
    if (!v) { input.focus(); return; }
    materialize(v, fxs[fi++ % fxs.length]);
    input.value = '';
    if (reply) { reply.hidden = false; reply.classList.remove('on'); void reply.offsetWidth; reply.querySelector('span').textContent = replies[ri++ % replies.length] + ' Taking you to the sandbox…'; reply.classList.add('on'); }
    if (window.hgAnalytics && window.hgAnalytics.track) window.hgAnalytics.track('sky_wish', { length: v.length });
    // J, 2026-10-26: 5 s after a wish, off to the sandbox, where the Overseer really builds it
    if (!going) going = setTimeout(() => { location.href = '/play/sandbox'; }, 5000);
  });

  // ---- the Overseer speaks (click it, or wait)
  const say = hero.querySelector('[data-sky-say]');
  const lines = ['I have given you the power of free will.', 'Do with it what you will.', 'Everything you see here was beamed in.', 'Ask. I like being asked.'];
  let li = 0;
  function speak() { if (!say) return; say.classList.remove('on'); setTimeout(() => { say.textContent = lines[li++ % lines.length]; say.classList.add('on'); }, 350); }
  if (say) {
    const place = () => { say.style.left = O.x + 'px'; say.style.top = (O.y + O.r * 1.9) + 'px'; };
    place(); window.addEventListener('resize', () => setTimeout(place, 0)); if ('ResizeObserver' in window) new ResizeObserver(place).observe(hero);
    setTimeout(speak, 900); if (!reduce) setInterval(speak, 6500);
  }
  hero.addEventListener('click', (e) => {
    if (e.target.closest('a,button,input,form')) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (Math.hypot(mx - O.x, my - O.y) < O.r * 1.6) { speak(); beamTo(0.15 + Math.random() * 0.7, true); }
  });

  // ---- life
  hero.addEventListener('pointermove', (e) => { const r = hero.getBoundingClientRect(); tpx = ((e.clientX - r.left) / r.width - 0.5) * 2; tpy = ((e.clientY - r.top) / r.height - 0.5) * 2; });
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { vis = es[0].isIntersecting; wake(); }, { threshold: 0 }).observe(hero);
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('resize', resize);
  // the hero's height follows its text on a phone (fonts arriving, the reply line): redraw at the new size
  if ('ResizeObserver' in window) new ResizeObserver(() => { const r = hero.getBoundingClientRect(); if (Math.round(r.width) !== W || Math.round(r.height) !== H) resize(); }).observe(hero);
  if (!reduce) setInterval(() => { if (vis && !document.hidden && !beams.length) beamTo(0.1 + Math.random() * 0.8, true); }, 9000);
  resize();
  const quiet = () => { const s = Math.min(1, Math.max(0, window.scrollY / Math.max(1, hero.offsetHeight))); hero.style.setProperty('--s', s.toFixed(3)); document.body.classList.toggle('at-sky', s < 0.9); };
  window.addEventListener('scroll', quiet, { passive: true }); quiet();
  wake();
})();
