// "Share this moment": sharing as a loop. After a big explosion, a first catch, a long jump or a dock, a small chip hangs at
// the top of the screen for six seconds. One tap keeps the last eight seconds (a photo where the game cannot record) with the
// character, their name tag and a line from the Overseer, puts it in the player's own Gen library, and offers the link: the
// phone's share sheet, or the link copied. A guest who taps is shown the account sheet (public/play/guest.js) and the moment is
// still there when it closes. Where the game runs sandboxed (no cookies), the existing share window does the account part.
// Rules and captions are in share-math.js (momentGate, momentCaption); docs/story.md "Moments to keep". Settings:
// config.share.moments (false turns the chip off). Events for scripts and tests: game.on('moment', { state, kind, ... }).
/* global HawkesPlay, HawkesShareMath, HawkesGuest */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const M = window.HawkesShareMath;
  const S = H.share;
  const sandboxed = (() => { try { return window.origin === 'null' || location.origin === 'null'; } catch { return true; } })();
  const Mo = (S.moments = {});

  const css = document.createElement('style');
  css.textContent = `
    .sh-moment { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 64px); transform: translate(-50%, -12px); z-index: 31; display: flex; align-items: center; gap: 10px; max-width: min(92vw, 460px); padding: 8px 8px 8px 16px; border-radius: 999px; background: rgba(12, 16, 30, .82); border: 1px solid rgba(160, 200, 255, .38); color: #e8ecf6; box-shadow: 0 6px 24px rgba(0, 0, 0, .4), 0 0 28px rgba(120, 170, 255, .22); font-size: 15px; opacity: 0; pointer-events: none; transition: opacity .25s, transform .25s; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
    .sh-moment.on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
    .sh-moment .sh-m-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sh-moment .sh-m-text small { display: block; font-size: 12px; color: #a9b6d8; overflow: hidden; text-overflow: ellipsis; }
    .sh-moment button { min-height: 48px; min-width: 48px; padding: 0 16px; border-radius: 999px; border: 0; font: 700 15px inherit; font-family: inherit; color: #fff; background: linear-gradient(90deg, #4a9eff, #a855f7); cursor: pointer; }
    .sh-moment button.quiet { background: rgba(255, 255, 255, .12); }
    .sh-moment button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
    .sh-moment i { position: absolute; left: 16px; right: 16px; bottom: 4px; height: 2px; border-radius: 2px; background: rgba(160, 200, 255, .55); transform-origin: left; }
    .sh-moment.run i { animation: sh-moment-run var(--sh-moment-s, 6s) linear forwards; }
    @keyframes sh-moment-run { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) { .sh-moment { transition: none; } .sh-moment.run i { animation: none; } }
  `;
  document.head.appendChild(css);
  const chip = document.createElement('div');
  chip.className = 'sh-moment sh-keep';
  chip.setAttribute('role', 'status');
  chip.setAttribute('aria-live', 'polite');
  document.body.appendChild(chip);

  const st = { kind: null, caption: '', at: 0, still: null, shownAt: null, lastCaption: '', timer: null, state: 'idle', link: null, tourStart: null, caught: false, jumps: M.jumpWatch(), item: null, busy: false };
  const emit = (state, more) => { st.state = state; try { H.game && H.game.emit('moment', { state, kind: st.kind, caption: st.caption, ...(more || {}) }); } catch { /* fine */ } };
  Mo.state = () => ({ state: st.state, kind: st.kind, caption: st.caption, link: st.link });
  Object.defineProperty(Mo, 'visible', { get: () => chip.classList.contains('on') });

  const settings = () => { const s = S.settings(); return { ...s, moments: !s.off && s.momentsOn }; };
  const me = () => {
    const look = (H.presence && H.presence.look) || (H.presence && H.presence.me && H.presence.me.look) || null;
    const core = H.presence && H.presence.core;
    const w = look && core && core.WHAT && core.WHAT.get ? core.WHAT.get(look.what) : null;
    return { name: String((look && look.name) || '').slice(0, 40), what: (w && w.label) || '', icon: (w && w.icon) || '', color: look && /^#[0-9a-f]{6}$/i.test(look.body || '') ? look.body : '#4a9eff' };
  };
  /** Something else has the screen: the intro, the mirror, a sheet, photo mode, a shot, the review, the account sheet. */
  const busy = () => {
    try {
      if (H.overseer && H.overseer.introPlaying) return true;
      if (H.mirror && H.mirror.isOpen) return true;
      if (S.photo && S.photo.on) return true;
      if (S.reviewing) return true;
      if (H.game && H.game.cinematic && H.game.cinematic.playing) return true;
      if (document.body.dataset.gsSheet) return true;
    } catch { /* fine */ }
    return false;
  };
  const tourActive = () => { try { return H.game.events.quests.state('tour') === 'active'; } catch { return false; } };

  // ------------------------------------------------------------------ the picture: the moment's still, finished as a card
  /** The still, drawn as the share card: the game's picture, the character's name tag, the Overseer's line, and the ship as a
   *  pearl of light in the sky. This is the card Discord and X show (and a photo's whole picture). */
  function card(src, o) {
    const W = Math.min(1280, src.width), k = W / src.width, Hh = Math.round(src.height * k);
    const c = document.createElement('canvas');
    c.width = W; c.height = Hh;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0, W, Hh);
    const u = Math.max(12, Math.round(W / 60));
    // the Overseer's ship: a pearl of light with two thin rings, up in the sky
    const px = W - u * 5, py = u * 4.2, pr = u * 1.5;
    const halo = g.createRadialGradient(px, py, pr * 0.2, px, py, pr * 3);
    halo.addColorStop(0, 'rgba(255,255,255,.55)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = halo; g.fillRect(px - pr * 3, py - pr * 3, pr * 6, pr * 6);
    const pearl = g.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
    pearl.addColorStop(0, '#ffffff'); pearl.addColorStop(1, '#bcd2ff');
    g.fillStyle = pearl; g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = Math.max(1, u / 10);
    g.beginPath(); g.ellipse(px, py, pr * 1.7, pr * 0.5, -0.25, 0, Math.PI * 2); g.stroke();
    // the foot: a dark fade, the line in the Overseer's voice, the name tag
    const foot = Hh * 0.3;
    const fade = g.createLinearGradient(0, Hh - foot, 0, Hh);
    fade.addColorStop(0, 'rgba(6,10,24,0)'); fade.addColorStop(1, 'rgba(6,10,24,.82)');
    g.fillStyle = fade; g.fillRect(0, Hh - foot, W, foot);
    g.textBaseline = 'alphabetic';
    const lines = M.wrapText(o.caption, 44).slice(0, 3);
    g.font = `italic 500 ${Math.round(u * 1.45)}px Rajdhani, Inter, sans-serif`;
    g.fillStyle = 'rgba(232,240,255,.95)';
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = u / 2;
    lines.forEach((l, i) => g.fillText(i === 0 ? `“${l}${lines.length === 1 ? '”' : ''}` : `${l}${i === lines.length - 1 ? '”' : ''}`, u * 1.4, Hh - u * 1.6 - (lines.length - 1 - i) * u * 1.7));
    const tagY = Hh - u * 1.6 - lines.length * u * 1.7 - u * 0.6;
    const label = `${o.icon ? o.icon + ' ' : ''}${o.name || o.what || 'A player'}`;
    g.font = `700 ${Math.round(u * 1.2)}px Rajdhani, Inter, sans-serif`;
    const tw = g.measureText(label).width + u * 1.6;
    g.shadowBlur = 0;
    g.fillStyle = o.color || '#4a9eff';
    g.beginPath();
    if (g.roundRect) g.roundRect(u * 1.2, tagY - u * 1.5, tw, u * 1.9, u); else g.rect(u * 1.2, tagY - u * 1.5, tw, u * 1.9);
    g.fill();
    g.fillStyle = '#fff'; g.fillText(label, u * 2, tagY - u * 0.2);
    g.font = `600 ${Math.round(u * 0.9)}px Rajdhani, Inter, sans-serif`; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText('hawkesgen.com', W - u * 1.2, Hh - u * 0.7);
    return c;
  }

  // ------------------------------------------------------------------ the chip
  function show(kind) {
    const w = H.world;
    if (!w) return;
    const s = settings();
    if (!s.moments) return;
    const gate = M.momentGate({ now: performance.now(), lastShown: st.shownAt, tourStart: st.tourStart, tourActive: tourActive(), busy: busy() || st.busy, kind, firstCatchSeen: st.caught });
    if (!gate.show) return;
    if (kind === 'catch') st.caught = true;
    st.kind = kind;
    st.caption = M.momentCaption(kind, Math.random(), st.lastCaption);
    st.lastCaption = st.caption;
    st.shownAt = performance.now();
    st.still = null; st.link = null; st.item = null;
    const who = me();
    // The still, now (the card for a photo, and the clip's picture): a clip is cut only if they tap.
    S.grab(1).then((c) => { if (c && st.kind === kind) st.still = card(c, { ...who, caption: st.caption }); }).catch(() => {});
    render('ask');
    emit('chip', { shown: M.MOMENT_SHOW });
  }
  function render(mode) {
    clearTimeout(st.timer);
    const m = M.MOMENTS[st.kind] || { label: 'A moment' };
    if (mode === 'ask') {
      chip.innerHTML = `<span class="sh-m-text">Share this moment<small>${m.label}</small></span><button type="button" data-a="keep">Share</button><i></i>`;
      chip.style.setProperty('--sh-moment-s', `${M.MOMENT_SHOW}s`);
      chip.classList.add('on'); chip.classList.remove('run'); void chip.offsetWidth; chip.classList.add('run');
      st.timer = setTimeout(hide, M.MOMENT_SHOW * 1000);
      chip.querySelector('[data-a="keep"]').onclick = () => tap();
    } else if (mode === 'working') {
      chip.innerHTML = `<span class="sh-m-text">${st.workText || 'Keeping it…'}</span>`;
      chip.classList.add('on'); chip.classList.remove('run');
    } else if (mode === 'link') {
      chip.innerHTML = `<span class="sh-m-text">Your link is ready<small>${esc(st.link)}</small></span><button type="button" data-a="share">${navigator.share ? 'Share' : 'Copy'}</button><button type="button" class="quiet" data-a="close" aria-label="Close">✕</button>`;
      chip.classList.add('on'); chip.classList.remove('run');
      chip.querySelector('[data-a="share"]').onclick = () => offer(st.link, true);
      chip.querySelector('[data-a="close"]').onclick = hide;
      st.timer = setTimeout(hide, 20000);
    } else if (mode === 'error') {
      chip.innerHTML = `<span class="sh-m-text">${esc(st.workText || 'That did not get through')}<small>Tap to try again</small></span><button type="button" data-a="keep">Again</button>`;
      chip.classList.add('on'); chip.classList.remove('run');
      chip.querySelector('[data-a="keep"]').onclick = () => tap();
      st.timer = setTimeout(hide, 12000);
    }
  }
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hide() { clearTimeout(st.timer); chip.classList.remove('on', 'run'); if (st.state === 'chip') emit('gone'); }
  Mo.hide = hide;
  Mo.trigger = (kind) => show(kind);

  // ------------------------------------------------------------------ one tap
  /** A clip from a recorder's blob, cut to its last `seconds` (a recording is cut by playing it again). */
  function cutLast(clip, seconds) {
    if (!clip.seconds || clip.seconds <= seconds + 1) return Promise.resolve(clip);
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      const url = URL.createObjectURL(clip.blob);
      const bail = () => { URL.revokeObjectURL(url); resolve(clip); };
      v.onerror = bail;
      v.onloadedmetadata = () => {
        const run = () => {
          const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : clip.seconds;
          S.trim(v, Math.max(0, d - seconds), d).then((out) => { URL.revokeObjectURL(url); resolve({ ...clip, blob: out.blob, mime: out.mime, seconds: out.seconds, from: 0, to: out.seconds }); }, bail);
        };
        if (Number.isFinite(v.duration) && v.duration > 0) run();
        else { v.currentTime = 1e6; v.addEventListener('timeupdate', function once() { v.removeEventListener('timeupdate', once); run(); }); }
      };
      setTimeout(bail, 45000);
      v.src = url;
    });
  }
  const jpeg = (c) => S.toBlob(c, 'image/jpeg', 0.88);
  function upload(blob, mime, name) {
    return fetch('/v1/assets', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': mime || blob.type || 'application/octet-stream', 'X-Filename': name }, body: blob })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok || !d.id) throw new Error(d.error || `Upload failed (${r.status})`); return d; });
  }
  /** Who is signed in, for the account part: the page's guest sheet when there is one, else a plain look. */
  async function account() {
    if (window.HawkesGuest && window.HawkesGuest.account) return window.HawkesGuest.account();
    const d = await fetch('/v1/shares/session', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return (d && d.user) || null;
  }
  function tap() {
    if (st.busy) return;
    clearTimeout(st.timer);
    const kind = st.kind, caption = st.caption, who = me();
    emit('tap', {});
    // Where games run sandboxed (no cookies) the share window does the account part: open it now, while the tap counts.
    const win = sandboxed && S.openShareWindow ? S.openShareWindow() : null;
    if (sandboxed && !win) { st.workText = 'Allow pop-ups to share'; render('error'); emit('failed', { reason: 'popup' }); return; }
    st.busy = true; st.workText = 'Keeping the last eight seconds…'; render('working');
    run(kind, caption, who, win).catch((err) => { st.workText = (err && err.message) || 'That did not get through'; render('error'); emit('failed', { reason: String(st.workText).slice(0, 80) }); try { win && win.close(); } catch { /* fine */ } }).finally(() => { st.busy = false; });
  }
  async function run(kind, caption, who, win) {
    // 1. the media: the last 8 seconds, or the still
    let item = null;
    if (S.clipping && S.canRecord()) {
      const clip = await S.clipThat({ review: false }).catch(() => null);
      if (clip && clip.blob) { st.workText = 'Cutting the last eight seconds…'; render('working'); item = await cutLast(clip, M.MOMENT_CLIP); item.kind = 'clip'; }
    }
    const still = st.still;
    const stillBlob = still ? await jpeg(still) : null;
    if (!item) {
      if (!stillBlob) throw new Error('Could not keep that one');
      item = { kind: 'photo', blob: stillBlob, mime: 'image/jpeg', width: still.width, height: still.height };
    } else { item.poster = stillBlob || null; item.width = still ? still.width : null; item.height = still ? still.height : null; }
    item.title = M.momentTitle(kind, who.name);
    item.moment = { kind, caption, who: who.name, what: who.what };
    st.item = item;
    emit('kept', { media: item.kind, seconds: item.seconds || null });
    // 2. the account and the link
    if (sandboxed) {
      st.workText = 'Opening the share window…'; render('working');
      await S.share(item, win);
      emit('window', {});
      hide();
      return;
    }
    const user = await account();
    if (!user) { emit('declined', {}); st.workText = 'Not shared'; render('error'); return; }
    st.workText = 'Sending it to your library…'; render('working');
    const ref = S.gameRef();
    const base = item.kind === 'clip' ? `moment-${Date.now()}` : `moment-${Date.now()}`;
    const ext = item.kind === 'clip' ? (/mp4/.test(item.mime) ? 'mp4' : 'webm') : 'jpg';
    const main = await upload(item.blob, String(item.mime).split(';')[0], `${base}.${ext}`);
    let thumb = null;
    if (item.kind === 'clip' && item.poster) { try { thumb = (await upload(item.poster, 'image/jpeg', `${base}-card.jpg`)).id; } catch { thumb = null; } }
    const r = await fetch('/v1/shares', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset: main.id, thumb, title: item.title, game: ref.game, width: item.width, height: item.height, seconds: item.seconds || null, moment: item.moment }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Could not make the link');
    st.link = d.url;
    emit('link', { url: d.url, id: d.id, media: item.kind });
    render('link');
    offer(d.url, false);
  }
  /** The phone's share sheet; elsewhere (or when it is refused) the link is copied. */
  async function offer(url, fromTap) {
    const title = st.item ? st.item.title : 'A moment';
    if (navigator.share && (H.touchUi || fromTap)) {
      try { await navigator.share({ title, text: st.caption || title, url }); emit('shared', { how: 'sheet' }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); S.toast('Link copied'); emit('copied', { how: 'clipboard' }); }
    catch { S.toast(url, 6); }
  }

  // ------------------------------------------------------------------ what counts as a moment
  H.hooks.game.push((game) => {
    game.on('explosion', (ev) => { if (M.bigBlast(ev)) show('boom'); });
    game.on('catch', (d) => { if (d && d.mine !== false) show('catch'); });
    game.on('docked', (d) => { if (d !== false) show('dock'); });
    game.on('docked-pad', () => show('dock'));
    game.on('quest', (d) => { if (d && d.id === 'tour' && d.state === 'start') st.tourStart = performance.now(); });
  });
  H.hooks.frame.push((elapsed) => {
    const w = H.world, p = w && w.player;
    if (!p || !p.alive) return;
    const seated = p._seatedAt !== undefined && w.time - p._seatedAt < 0.3;
    const j = st.jumps.step(seated ? true : Boolean(p.grounded), p.y, elapsed);
    if (j) show('jump');
  });
  H.hooks.world.push({
    enter() { st.jumps = M.jumpWatch(); st.tourStart = null; st.shownAt = null; hide(); },
    leave() { hide(); st.still = null; st.item = null; },
  });
})();
