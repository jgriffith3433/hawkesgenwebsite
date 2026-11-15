// The loading wrapper for /play/ game pages (J, 2026-11-11: "playing or watching something within 2 s and honest progress").
// A hook line, a tiny dodge-and-rewind toy to play while the build downloads (the Galaxian-in-Ridge-Racer idea), and a bar
// driven by bytes really received. Never timed, never polled: every update is an event (an Unity progress callback, a fetch
// stream chunk, a resource-timing entry).
//
//   var w = HawkesLoadWrap.mount({ root, hook, accent, label })   draws into root (a positioned element), starts at once
//   w.progress(fraction, {bytes, total})   a real fraction 0..1 of the download (never goes back)
//   w.track(url, init)                      fetch with a stream: counts bytes as chunks arrive; resolves the Response
//   w.expect(totalBytes)                    the known total, when the host knows it (sets track()'s denominator)
//   w.downloaded()                          the last byte is in: the bar is 100% (once), the label turns to "Starting"
//   w.finish()                              hand off to the game: fades out only once the game has drawn (no blank frame)
//
// window.HawkesLoad (read by the playtest): { shownAt, firstFrameAt, bytes, total, pct, lastByteAt, fullAt, doneAt, bytesAtFull }.
// The toy: a little ship dodges falling shots (drag or A/D/arrows); hold (touch, R or Space) to rewind the last 2 s.
(function () {
  'use strict';
  var L = window.HawkesLoad = window.HawkesLoad || {};
  function mount(opts) {
    opts = opts || {};
    var root = opts.root || document.body;
    var accent = opts.accent || '#ffb13d';
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var box = document.createElement('div');
    box.className = 'hlw';
    box.setAttribute('role', 'status');
    box.innerHTML = '<style>' +
      '.hlw{position:absolute;inset:0;z-index:2147482000;background:#000;color:#fff;display:flex;flex-direction:column;align-items:center;font-family:Inter,system-ui,sans-serif;transition:opacity .35s ease;touch-action:none;-webkit-user-select:none;user-select:none}' +
      '.hlw.out{opacity:0;pointer-events:none}' +
      '.hlw.has-art{background:#05080f center/cover no-repeat}' +
      '.hlw.has-art::before{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.72) 55%,rgba(0,0,0,.88));pointer-events:none}' +
      '.hlw.has-art>*{position:relative;z-index:1}' +
      '.hlw .hk{margin:max(18px,env(safe-area-inset-top)) 18px 0;max-width:34ch;text-align:center;font-size:clamp(16px,3.6vw,22px);line-height:1.35;font-weight:600;text-shadow:0 1px 3px #000}' +
      '@media (orientation:portrait) and (max-width:500px){.hlw.has-art{background-size:cover;background-position:center top}}' +
      '.hlw .bw{width:min(86vw,420px);margin-top:14px}' +
      '.hlw .bar{height:8px;border-radius:4px;background:rgba(255,255,255,.14);overflow:hidden}' +
      '.hlw .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff6a3d,' + accent + ')}' +
      '.hlw .st{margin-top:6px;font-size:13px;color:rgba(255,255,255,.75);text-align:center;font-variant-numeric:tabular-nums}' +
      '.hlw canvas{flex:1;min-height:0;width:100%;display:block;touch-action:none}' +
      '.hlw .tip{margin:0 14px max(14px,env(safe-area-inset-bottom));font-size:13px;color:rgba(255,255,255,.7);text-align:center}' +
      '</style>' +
      '<p class="hk"></p><div class="bw"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><p class="st">0%</p></div>' +
      '<canvas aria-label="A little game to play while this loads"></canvas>' +
      '<p class="tip">Drag to dodge &middot; hold to rewind</p>';
    box.querySelector('.hk').textContent = opts.hook || '';
    // Painted key art behind the toy (island loading): opts.art is a URL; portrait phones prefer opts.artTall (2:3).
    if (opts.art) {
      var tall = opts.artTall && window.matchMedia && matchMedia('(orientation: portrait) and (max-width: 500px)').matches;
      box.classList.add('has-art');
      box.style.backgroundImage = 'url("' + String(tall ? opts.artTall : opts.art).replace(/"/g, '') + '")';
    }
    root.appendChild(box);
    var cv = box.querySelector('canvas'), ctx = cv.getContext('2d'), fill = box.querySelector('.bar i'), bar = box.querySelector('.bar');
    var st = box.querySelector('.st'), tip = box.querySelector('.tip');
    if (!window.matchMedia || !matchMedia('(pointer: coarse)').matches) tip.textContent = 'A D or arrows to dodge · hold R to rewind';
    var W = 0, H = 0, dpr = 1;
    function size() { dpr = Math.min(2, window.devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = Math.max(1, W * dpr); cv.height = Math.max(1, H * dpr); }
    size();
    window.addEventListener('resize', size);

    // ---- the toy: state is a pure step so the last 2 s can be replayed backwards
    var hist = [], s = { x: 0.5, t: 0, shots: [], hits: 0, score: 0, seed: 7 };
    var keys = { l: 0, r: 0 }, target = null, rewinding = false;
    function rnd() { s.seed = (s.seed * 1664525 + 1013904223) >>> 0; return s.seed / 4294967296; }
    function clone(o) { return { x: o.x, t: o.t, hits: o.hits, score: o.score, seed: o.seed, shots: o.shots.map(function (b) { return { x: b.x, y: b.y, v: b.v }; }) }; }
    function step(dt) {
      var dir = keys.r - keys.l;
      if (target !== null) s.x += Math.max(-1, Math.min(1, (target - s.x) * 8)) * 0.9 * dt; else s.x += dir * 0.9 * dt;
      s.x = Math.max(0.05, Math.min(0.95, s.x));
      s.t += dt;
      if (rnd() < dt * (1.6 + Math.min(2.4, s.t / 30))) s.shots.push({ x: 0.05 + rnd() * 0.9, y: -0.04, v: 0.35 + rnd() * 0.3 });
      for (var i = s.shots.length - 1; i >= 0; i--) {
        var b = s.shots[i]; b.y += b.v * dt * (H > 0 ? 1.0 : 1);
        if (b.y > 0.86 && b.y < 0.95 && Math.abs(b.x - s.x) < 0.045) { s.hits++; s.shots.splice(i, 1); }
        else if (b.y > 1.05) { s.shots.splice(i, 1); s.score++; }
      }
    }
    var last = 0, raf = 0, over = false;
    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = rewinding ? '#0a1a2c' : '#050505'; ctx.fillRect(0, 0, W, H);
      var i, b;
      for (i = 0; i < s.shots.length; i++) { b = s.shots[i]; ctx.fillStyle = '#ff4a2a'; ctx.beginPath(); ctx.arc(b.x * W, b.y * H, Math.max(5, W * 0.012), 0, 6.3); ctx.fill(); }
      var px = s.x * W, py = H * 0.9, r = Math.max(10, Math.min(W, H) * 0.035);
      ctx.fillStyle = rewinding ? '#6cf0ff' : accent;
      ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py + r); ctx.lineTo(px - r, py + r); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '600 13px Inter,system-ui,sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('dodged ' + s.score + ' · hit ' + s.hits, 10, 18);
    }
    function frame(ts) {
      if (over) return;
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016; last = ts;
      if (rewinding) { if (hist.length) s = hist.pop(); } else { hist.push(clone(s)); if (hist.length > 120) hist.shift(); step(dt); }
      draw();
      if (!L.firstFrameAt) L.firstFrameAt = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function pos(e) { var r = cv.getBoundingClientRect(); return (e.clientX - r.left) / Math.max(1, r.width); }
    // One finger or the mouse: the ship follows; a second finger (or a right/other button, or holding still) rewinds.
    var touches = 0;
    cv.addEventListener('pointerdown', function (e) { touches++; if (touches > 1 || e.button > 0) rewinding = true; else target = pos(e); try { cv.setPointerCapture(e.pointerId); } catch (x) { /* fine */ } });
    cv.addEventListener('pointermove', function (e) { if (touches === 1 && !rewinding) target = pos(e); });
    function up() { touches = Math.max(0, touches - 1); if (!touches) { target = null; rewinding = false; } else rewinding = false; }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    // Hold-to-rewind on touch: pressing in the lower part of the screen with a thumb that is not moving is a long press.
    var holdT = 0;
    cv.addEventListener('pointerdown', function (e) { var x0 = e.clientX; clearTimeout(holdT); holdT = setTimeout(function () { if (touches === 1 && Math.abs((target === null ? x0 : target * cv.clientWidth + cv.getBoundingClientRect().left) - x0) < 6) rewinding = true; }, 450); });
    cv.addEventListener('pointerup', function () { clearTimeout(holdT); });
    function key(e, d) {
      var k = e.key;
      if (k === 'a' || k === 'A' || k === 'ArrowLeft') keys.l = d; else if (k === 'd' || k === 'D' || k === 'ArrowRight') keys.r = d;
      else if (k === 'r' || k === 'R' || k === ' ') rewinding = !!d; else return;
    }
    function kd(e) { key(e, 1); } function ku(e) { key(e, 0); }
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku);
    // Sound starts on the first tap (a real gesture): the host says what that means (the Sick of It page presses its Tap to play prompt).
    if (opts.onFirstTap) ['pointerdown', 'keydown'].forEach(function (n) { var h = function () { window.removeEventListener(n, h, true); try { opts.onFirstTap(); } catch (x) { /* never breaks the toy */ } }; window.addEventListener(n, h, true); });
    if (reduce) { draw(); } else raf = requestAnimationFrame(frame);

    // ---- progress: real bytes only
    var shown = 0, fullDone = false, got = 0, total = 0;
    L.shownAt = performance.now(); L.bytes = 0; L.total = 0; L.pct = 0;
    function show(f, label) {
      f = Math.max(shown, Math.min(1, f)); shown = f; L.pct = Math.round(f * 100);
      fill.style.width = (f * 100).toFixed(1) + '%'; bar.setAttribute('aria-valuenow', String(L.pct));
      st.textContent = label || (L.pct + '%');
    }
    function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }
    var api = {
      root: box,
      progress: function (f, info) {
        if (fullDone) return;
        if (info && info.bytes != null) { L.bytes = info.bytes; L.lastByteAt = performance.now(); }
        if (info && info.total) L.total = info.total;
        show(Math.min(0.995, f), Math.round(Math.min(0.995, f) * 100) + '%' + (L.total ? ' · ' + mb(L.bytes) + ' of ' + mb(L.total) : ''));
      },
      expect: function (n) { total = n; L.total = n; },
      track: function (url, init) {
        return fetch(url, init).then(function (res) {
          if (!res.body || !res.body.getReader) return res;
          var reader = res.body.getReader(), chunks = [];
          return new Promise(function (ok, fail) {
            (function pump() {
              reader.read().then(function (r) {
                if (r.done) { ok(new Response(new Blob(chunks), { status: res.status, headers: res.headers })); return; }
                chunks.push(r.value); got += r.value.length; L.bytes = got; L.lastByteAt = performance.now();
                if (total) api.progress(got / total, { bytes: got, total: total });
                pump();
              }, fail);
            })();
          });
        });
      },
      downloaded: function (bytes) {
        if (fullDone) return; fullDone = true;
        if (bytes != null) L.bytes = bytes;
        L.bytesAtFull = L.bytes; L.fullAt = performance.now(); if (!L.lastByteAt) L.lastByteAt = L.fullAt;
        show(1, '100%' + (L.total ? ' · ' + mb(L.bytes) : '') + ' · starting');
      },
      finish: function (after) {
        // The game's canvas is already behind this layer; fade out over it. `after` runs when the layer is gone.
        if (over) return; over = true; L.doneAt = performance.now();
        box.classList.add('out');
        window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('resize', size);
        setTimeout(function () { cancelAnimationFrame(raf); box.remove(); if (after) after(); }, reduce ? 0 : 400);
      },
    };
    return api;
  }
  window.HawkesLoadWrap = { mount: mount };
})();
