// Presence, the player's side: game chat (Enter, or 💬), the emote wheel (hold B, 😀 on phones, Y on a gamepad),
// who's here (Tab, or 👥: friends first, add friend, mute, watch), customizing your look (the editor's profile menu, or
// a mirror: the mirror's questions; this panel where there's no mirror module), and the spectate bar.
// Everything here is page UI over the game; presence.js does the world side.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const P = H.presence;
  const C = P.core;
  const W = () => H.world;
  const phone = () => Boolean(H.touchUi);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ styles
  const CSS = `
.pr-layer{position:fixed;inset:0;pointer-events:none;z-index:4;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.pr-head{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:3px;transform-origin:50% 100%;will-change:transform}
.pr-tag{position:relative;display:flex;align-items:center;gap:4px;padding:3px 9px;border-radius:999px;background:rgba(8,12,22,.62);border:1.5px solid rgba(255,255,255,.18);color:#fff;font:700 14px/1.15 system-ui,sans-serif;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.8);box-shadow:0 2px 8px rgba(0,0,0,.25)}
.pr-tag.pr-friend{background:rgba(8,28,44,.72)}
.pr-tag.pr-ai,.pr-tag.pr-npc,.pr-tag.pr-pet{font-size:12.5px;padding:2px 8px;background:rgba(8,12,22,.5)}
.pr-tag.pr-speaking{box-shadow:0 0 0 2px rgba(125,211,252,.55),0 2px 8px rgba(0,0,0,.25)}
.pr-badges{font-size:12px;letter-spacing:1px}
.pr-dots{display:inline-flex;gap:2px;margin-left:2px}.pr-dots i{width:4px;height:4px;border-radius:50%;background:#fff;opacity:.4;animation:pr-dot 1s infinite}.pr-dots i:nth-child(2){animation-delay:.15s}.pr-dots i:nth-child(3){animation-delay:.3s}
@keyframes pr-dot{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}
.pr-hp{width:56px;height:5px;border-radius:3px;background:rgba(0,0,0,.5);overflow:hidden}.pr-hp em{display:block;height:100%;background:linear-gradient(90deg,#34d399,#a3e635);transition:width .15s}
.pr-react{position:absolute;left:100%;bottom:0;margin-left:4px;font-size:26px;line-height:1;opacity:0;transform:translateY(6px) scale(.4);transition:opacity .2s,transform .25s cubic-bezier(.3,1.6,.5,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
.pr-react.on{opacity:1;transform:translateY(-4px) scale(1)}.pr-react.loop{animation:pr-float 2s ease-in-out infinite}
@keyframes pr-float{0%,100%{transform:translateY(-2px)}50%{transform:translateY(-9px)}}
.pr-bubbles{display:flex;flex-direction:column;align-items:center;gap:3px}
.pr-bubble{max-width:230px;padding:6px 10px;border-radius:12px;background:rgba(255,255,255,.95);color:#0b1020;font:500 13.5px/1.3 system-ui,sans-serif;text-align:center;overflow-wrap:anywhere;box-shadow:0 3px 10px rgba(0,0,0,.3);animation:pr-pop .18s ease-out;position:relative}
.pr-bubble:last-child::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:0;border-top-color:rgba(255,255,255,.95)}
@keyframes pr-pop{from{transform:scale(.7);opacity:0}to{transform:scale(1);opacity:1}}
.pr-hud{position:fixed;left:10px;top:58%;transform:translateY(-50%);z-index:7;display:flex;flex-direction:column;gap:6px}
.pr-hud button,.pr-btn{font:600 13px/1 system-ui,sans-serif;color:#fff;background:rgba(10,14,26,.7);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:8px 10px;cursor:pointer;min-height:34px;touch-action:manipulation}
.pr-hud button:hover,.pr-btn:hover{background:rgba(30,40,70,.85)}
.pr-hud button b{font-weight:700;margin-left:3px}
body.pr-touch .pr-hud button{min-width:46px;min-height:46px;font-size:20px;border-radius:12px}
.pr-log{position:fixed;left:12px;bottom:84px;z-index:7;width:min(380px,calc(100vw - 24px));display:flex;flex-direction:column;gap:3px;pointer-events:none;font:500 14px/1.3 system-ui,sans-serif}
.pr-log p{margin:0;padding:4px 9px;border-radius:8px;background:rgba(6,10,20,.55);color:#e5ecff;text-shadow:0 1px 2px #000;transition:opacity .6s;overflow-wrap:anywhere}
.pr-log p b{margin-right:6px}.pr-log p.npc{font-style:italic;opacity:.92}.pr-log p.sys{color:#9fb0d0;font-size:12.5px}
.pr-log p.old{opacity:0}.pr-log.open p.old{opacity:1}
body.pr-touch .pr-log{bottom:auto;top:66px;width:min(320px,calc(100vw - 24px));font-size:13px}
.pr-chat{position:fixed;left:12px;bottom:40px;z-index:30;display:flex;gap:6px;width:min(380px,calc(100vw - 24px))}
.pr-chat[hidden]{display:none}
.pr-chat input{flex:1;min-width:0;font:15px system-ui,sans-serif;color:#fff;background:rgba(10,14,26,.88);border:1px solid rgba(125,211,252,.55);border-radius:10px;padding:10px 12px;outline:none}
.pr-chat button{font:700 14px system-ui;color:#0b1020;background:#7dd3fc;border:0;border-radius:10px;padding:0 14px;cursor:pointer}
body.pr-touch .pr-chat{bottom:auto;top:66px}
.pr-panel{scrollbar-color:rgba(255,255,255,.25) transparent;scrollbar-width:thin;position:fixed;z-index:31;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 20px));max-height:min(80vh,620px);overflow:auto;background:rgba(12,16,28,.94);color:#eef2ff;border:1px solid rgba(255,255,255,.16);border-radius:16px;box-shadow:0 18px 60px rgba(0,0,0,.5);font:14px/1.4 system-ui,sans-serif;padding:12px 14px 14px}
.pr-panel[hidden]{display:none}
.pr-panel.pr-look{left:auto;right:16px;transform:translateY(-50%);width:min(400px,calc(100vw - 20px))}
@media (max-width:760px){.pr-panel.pr-look{left:0;right:0;top:auto;bottom:0;transform:none;width:auto;max-height:50vh;border-radius:16px 16px 0 0}}
.pr-panel header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.pr-panel header b{font-size:17px;flex:1}
.pr-panel h4{margin:12px 0 6px;font:700 11px/1 system-ui;letter-spacing:.12em;text-transform:uppercase;color:#9fb0d0}
.pr-x{background:none;border:0;color:#fff;font-size:22px;cursor:pointer;padding:2px 8px;min-height:36px}
.pr-row{display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid rgba(255,255,255,.07)}
.pr-row .dot{width:12px;height:12px;border-radius:50%;flex:none}
.pr-row .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pr-row .nm small{opacity:.6;margin-left:6px}
.pr-row button{font:600 12px system-ui;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 9px;cursor:pointer;min-height:32px}
.pr-row button.go{background:rgba(125,211,252,.18);border-color:rgba(125,211,252,.5)}
.pr-row button[disabled]{opacity:.5;cursor:default}
.pr-note{opacity:.65;font-size:12.5px;margin-top:8px}
.pr-sw{display:flex;flex-wrap:wrap;gap:6px}
.pr-sw button{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer;padding:0}
.pr-sw button.on{border-color:#fff;box-shadow:0 0 0 2px #7dd3fc}
.pr-sw input[type=color]{width:34px;height:30px;border:0;background:none;padding:0;cursor:pointer}
.pr-ch{display:flex;flex-wrap:wrap;gap:6px}
.pr-ch button{font:600 12.5px system-ui;color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:9px;padding:7px 10px;cursor:pointer;min-height:34px}
.pr-ch button.on{background:rgba(125,211,252,.25);border-color:#7dd3fc}
body.pr-touch .pr-sw button{width:38px;height:38px}body.pr-touch .pr-ch button{min-height:42px;font-size:14px}
.pr-wheel{position:fixed;inset:0;z-index:32;display:flex;align-items:center;justify-content:center;pointer-events:none}
.pr-wheel[hidden]{display:none}
.pr-wheel .ring{position:relative;width:340px;height:340px;border-radius:50%;background:radial-gradient(circle,rgba(10,14,26,.35) 28%,rgba(10,14,26,.78) 30%);pointer-events:auto;border:1px solid rgba(255,255,255,.12)}
.pr-wheel .ring button{position:absolute;width:74px;height:74px;margin:-37px 0 0 -37px;border-radius:50%;border:2px solid rgba(255,255,255,.15);background:rgba(20,26,46,.9);color:#fff;font:600 11px system-ui;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;transition:transform .1s}
.pr-wheel .ring button span{font-size:28px;line-height:1}
.pr-wheel .ring button.hot{transform:scale(1.14);border-color:#7dd3fc;background:rgba(40,70,120,.95)}
.pr-wheel .ring .mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:700 13px system-ui;color:#cfe3ff;text-align:center;pointer-events:none}
.pr-wheel.grid{align-items:flex-end}
.pr-wheel.grid .ring{width:min(520px,100vw);height:auto;border-radius:18px 18px 0 0;background:rgba(10,14,26,.94);display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:12px 12px max(14px,env(safe-area-inset-bottom))}
.pr-wheel.grid .ring button{position:static;margin:0;width:auto;height:76px;border-radius:14px}
.pr-wheel.grid .ring .mid{display:none}
.pr-spect{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:14px;background:rgba(10,14,26,.85);color:#fff;font:600 14px system-ui;border:1px solid rgba(255,255,255,.16)}
.pr-spect[hidden]{display:none}.pr-spect b{min-width:90px;text-align:center}
.pr-me-pop{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:8;font-size:64px;pointer-events:none;opacity:0;transition:opacity .2s,transform .3s}
.pr-me-pop.on{opacity:1;transform:translateX(-50%) translateY(-20px)}
`;
  function style() {
    if (document.getElementById('pr-style')) return;
    const st = document.createElement('style');
    st.id = 'pr-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const make = (tag, cls, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html !== undefined) el.innerHTML = html; document.body.appendChild(el); return el; };
  const freeMouse = () => { try { if (document.pointerLockElement) document.exitPointerLock(); } catch {} };
  const anyOpen = () => Boolean((chat && !chat.hidden) || (panel && !panel.hidden) || (wheel && !wheel.hidden));
  P.uiOpen = anyOpen;

  // ------------------------------------------------------------------ the HUD buttons
  let hud = null;
  function ensureHud() {
    style();
    document.body.classList.toggle('pr-touch', phone());
    if (hud && hud.isConnected) return;
    hud = make('div', 'pr-hud', '<button type="button" data-a="chat" title="Chat (Enter)" aria-label="Chat">💬</button><button type="button" data-a="emote" title="Emotes (hold B)" aria-label="Emotes">😀</button><button type="button" data-a="people" title="Who\'s here (Tab)" aria-label="Who\'s here">👥<b>1</b></button>');
    hud.id = 'pr-hud';
    hud.addEventListener('pointerdown', (e) => e.stopPropagation());
    hud.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('button') : null;
      const a = b && b.dataset.a;
      if (a === 'chat') openChat();
      if (a === 'emote') toggleWheel();
      if (a === 'people') togglePeople();
    });
  }
  function hudState() {
    if (!hud) return;
    const off = !P.enabled('chat') && !P.enabled('emotes') && !P.enabled('list');
    hud.style.display = off ? 'none' : '';
    const [c, e, p] = hud.children;
    if (c) c.style.display = P.enabled('chat') ? '' : 'none';
    if (e) e.style.display = P.enabled('emotes') ? '' : 'none';
    if (p) { p.style.display = P.enabled('list') ? '' : 'none'; const n = P.players().length; const b = p.querySelector('b'); if (b && b.textContent !== String(n)) b.textContent = String(n); }
  }

  // ------------------------------------------------------------------ chat: Enter to talk, a log of what was said
  let chat = null, input = null, log = null;
  function ensureChat() {
    style();
    if (chat && chat.isConnected) return;
    log = make('div', 'pr-log');
    chat = make('form', 'pr-chat', '<input type="text" maxlength="160" placeholder="Say something… (Enter)" autocomplete="off" enterkeyhint="send"><button type="submit">Say</button>');
    chat.hidden = true;
    input = chat.querySelector('input');
    chat.addEventListener('submit', (e) => {
      e.preventDefault();
      const t = input.value;
      if (t.trim() && !P.say(t)) line({ sys: true, text: 'Slow down a little…' });
      input.value = '';
      closeChat();
    });
    input.addEventListener('input', () => P.setTyping(input.value.length > 0));
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = ''; closeChat(); } e.stopPropagation(); });
    input.addEventListener('blur', () => setTimeout(() => { if (chat && !chat.hidden && document.activeElement !== input) closeChat(); }, 150));
    chat.addEventListener('pointerdown', (e) => e.stopPropagation());
  }
  function openChat() {
    // (Where the Overseer is in the chat, 💬 and Enter talk to it: modules/overseer/chat.js.)
    if (H.chat && H.chat.attached && H.chat.open()) return;
    // (Anywhere else, typing is the free Overseer phrasebook: modules/overseer/talk.js, which also says it to the other players.)
    if (H.talk && H.chat && !H.chat.embedded && H.chat.open()) return;
    if (!P.enabled('chat')) return;
    if (H.chat && !H.chat.embedded) {
      // Typing goes in the one chat window too (said to the other players), not a box of its own.
      H.chat.setFallback({ send: (t) => { if (!P.say(t)) throw new Error('Slow down a little…'); }, placeholder: 'Say something… (Enter)' });
      if (H.chat.open()) return;
    }
    ensureChat();
    closeWheel();
    chat.hidden = false;
    log.classList.add('open');
    freeMouse();
    setTimeout(() => { try { input.focus(); } catch {} }, 0);
    P.setTyping(true);
  }
  function closeChat() {
    if (!chat || chat.hidden) return;
    chat.hidden = true;
    log.classList.remove('open');
    P.setTyping(false);
    try { input.blur(); } catch {}
    const c = document.getElementById('stage'); if (c && c.focus) try { c.focus(); } catch {}
  }
  function line(m) {
    // Everything said goes in the game's one chat window (H.chat: the editor's chat in the editor), never a log of its own.
    if (H.chat) { H.chat.line({ kind: m.sys ? 'sys' : m.npc ? 'npc' : m.me ? 'me' : 'player', who: m.name, text: m.text, color: m.color, friend: m.friend }); return; }
    ensureChat();
    const p = document.createElement('p');
    if (m.sys) { p.className = 'sys'; p.textContent = m.text; }
    else {
      if (m.npc) p.className = 'npc';
      const b = document.createElement('b');
      b.textContent = `${m.friend ? '★ ' : ''}${m.me ? 'You' : m.name}`;
      b.style.color = m.npc ? '#fde68a' : m.friend ? '#7dd3fc' : m.color || '#9ecbff';
      p.appendChild(b);
      const t = document.createElement('span');
      t.textContent = m.text;
      p.appendChild(t);
    }
    log.appendChild(p);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => p.classList.add('old'), 12000);
  }
  P.on('say', (m) => { if (P.enabled('chat')) line(m); });

  // ------------------------------------------------------------------ the emote wheel
  let wheel = null, hot = -1, heldAt = 0, chose = false;
  function ensureWheel() {
    style();
    if (wheel && wheel.isConnected) return;
    wheel = make('div', 'pr-wheel', '<div class="ring"><div class="mid">Emotes<br><small>1–0</small></div></div>');
    wheel.hidden = true;
    const ring = wheel.firstChild;
    C.EMOTES.forEach((em, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.i = String(i);
      b.innerHTML = `<span>${em.icon}</span>${esc(em.label)}`;
      b.addEventListener('pointerenter', () => setHot(i));
      b.addEventListener('click', (e) => { e.stopPropagation(); pick(i); });
      ring.appendChild(b);
    });
    wheel.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === wheel) closeWheel(); });
  }
  function layoutWheel() {
    const grid = phone() || window.innerWidth < 520;
    wheel.classList.toggle('grid', grid);
    const btns = [...wheel.firstChild.querySelectorAll('button')];
    btns.forEach((b, i) => {
      if (grid) { b.style.left = ''; b.style.top = ''; return; }
      const a = (i / btns.length) * Math.PI * 2 - Math.PI / 2;
      b.style.left = `${170 + Math.cos(a) * 128}px`; b.style.top = `${170 + Math.sin(a) * 128}px`;
    });
  }
  function setHot(i) { hot = i; if (wheel) [...wheel.firstChild.querySelectorAll('button')].forEach((b, j) => b.classList.toggle('hot', j === i)); }
  function openWheel() { if (!P.enabled('emotes')) return; ensureWheel(); closeChat(); layoutWheel(); wheel.hidden = false; chose = false; setHot(-1); freeMouse(); }
  function closeWheel() { if (wheel) wheel.hidden = true; setHot(-1); }
  function toggleWheel() { ensureWheel(); if (wheel.hidden) openWheel(); else closeWheel(); }
  function pick(i) { const em = C.EMOTES[i]; closeWheel(); chose = true; if (em) try { P.emote(em.name); } catch (err) { H.report(err, 'presence'); } }
  // Seeing your own emote in first person: a big emoji for a moment.
  let pop = null;
  P.on('emote', (d) => {
    if (d.key !== 'me') return;
    const p = W() && W().player;
    if (p && p._view !== 'first') return;
    style();
    if (!pop || !pop.isConnected) pop = make('div', 'pr-me-pop');
    pop.textContent = d.icon;
    pop.classList.add('on');
    clearTimeout(pop._t);
    pop._t = setTimeout(() => pop.classList.remove('on'), 1400);
  });

  // ------------------------------------------------------------------ panels: who's here, customize
  let panel = null, panelKind = null;
  function ensurePanel() {
    style();
    if (panel && panel.isConnected) return;
    panel = make('div', 'pr-panel');
    panel.hidden = true;
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closePanel(); } e.stopPropagation(); });
  }
  function closePanel() {
    if (!panel || panel.hidden) return;
    const was = panelKind;
    panel.hidden = true; panelKind = null;
    if (was === 'look') endPreview();
  }
  function togglePeople() { if (panelKind === 'people') closePanel(); else openPeople(); }
  function openPeople() {
    if (!P.enabled('list')) return;
    ensurePanel();
    closeWheel(); closeChat();
    if (panelKind === 'look') endPreview();
    panelKind = 'people'; panel.className = 'pr-panel';
    panel.hidden = false;
    freeMouse();
    renderPeople();
  }
  let peopleSig = '';
  function renderPeople(force = true) {
    if (!panel || panelKind !== 'people') return;
    const list = P.players();
    const sig = JSON.stringify(list.map((x) => [x.id, x.name, x.friend, x.host, x.typing, x.verified, x.requested, x.muted, x.spectating])) + P.me.signedIn + P.spectating();
    if (!force && sig === peopleSig) return;
    peopleSig = sig;
    const n = list.length;
    let html = `<header><b>Who's here <small style="opacity:.6;font-weight:500">${n}</small></b><button type="button" class="pr-x" data-a="close" aria-label="Close">×</button></header>`;
    for (const x of list) {
      const tags = `${x.host ? ' 👑' : ''}${x.friend ? ' ★' : ''}${x.typing ? ' …' : ''}`;
      html += `<div class="pr-row" data-id="${esc(x.id)}"><span class="dot" style="background:${esc(x.color || '#4a9eff')}"></span><span class="nm">${esc(x.name)}${tags}${x.me ? '<small>you</small>' : x.friend ? '<small>friend</small>' : ''}${x.host ? '<small>host</small>' : ''}</span>`;
      if (!x.me) {
        if (P.me.signedIn && x.verified && !x.friend) html += x.requested ? '<button type="button" disabled>Asked</button>' : '<button type="button" class="go" data-a="friend">+ Friend</button>';
        html += `<button type="button" data-a="mute">${x.muted ? 'Unmute' : 'Mute'}</button>`;
        if (P.enabled('spectate')) html += `<button type="button" data-a="watch">${P.spectating() === x.key ? 'Watching' : '👁 Watch'}</button>`;
      }
      html += '</div>';
    }
    if (n <= 1) html += '<p class="pr-note">Just you here. "Play with friends" (bottom right) makes a room and copies its link.</p>';
    if (!P.me.signedIn) html += '<p class="pr-note">Sign in to Hawkes Gen to keep your look in every game and add friends.</p>';
    panel.innerHTML = html;
    panel.onclick = (e) => {
      const b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      const a = b.dataset.a;
      const row = b.closest('.pr-row');
      const id = row && row.dataset.id;
      if (a === 'close') closePanel();
      if (a === 'look') openLook();
      if (a === 'mute') { P.mute(id, b.textContent === 'Mute'); renderPeople(); }
      if (a === 'watch') { if (P.spectating() === `p:${id}`) P.spectate(null); else { P.spectate(id); closePanel(); } }
      if (a === 'friend') { b.disabled = true; b.textContent = '…'; P.addFriend(id).then((s) => { b.textContent = s === 'friends' ? 'Friends!' : 'Asked'; }, (err) => { b.textContent = 'Not now'; line({ sys: true, text: err.message }); }); }
    };
  }
  P.on('people', () => renderPeople(false));

  // Customize: colors, shape, hat, face, extras (and a model by asset id). You see yourself while it's open.
  let preview = null;
  function startPreview() {
    const p = W() && W().player;
    if (!p || preview) return;
    preview = { view: p._view, controls: p.controls };
    if (p._view === 'first') p.view = 'third';
  }
  function endPreview() {
    const p = W() && W().player;
    if (preview && p && p.alive && preview.view && p._view !== preview.view) p.view = preview.view;
    preview = null;
  }
  function openLook() {
    if (!P.enabled('customize')) return;
    // The mirror's questions (modules/mirror): what you are, how you look, your name, anywhere. This panel otherwise.
    if (H.mirror && H.mirror.dress) { closeWheel(); closeChat(); closePanel(); if (H.mirror.dress()) return; }
    ensurePanel();
    closeWheel(); closeChat();
    panelKind = 'look'; panel.className = 'pr-panel pr-look';
    panel.hidden = false;
    freeMouse();
    startPreview();
    renderLook();
  }
  const HAT_ICON = { none: '—', cap: '🧢', beanie: '🧶', tophat: '🎩', crown: '👑', cowboy: '🤠', party: '🥳', halo: '😇', horns: '😈', bunny: '🐰', helmet: '⛑️', chef: '👨‍🍳' };
  const EXTRA_ICON = { glasses: '👓', shades: '🕶️', scarf: '🧣', backpack: '🎒', cape: '🦸', bowtie: '🎀', wings: '🪽', tail: '🦊' };
  function renderLook() {
    if (!panel || panelKind !== 'look') return;
    const L = P.look || C.cleanLook({});
    const sw = (key, list) => `<div class="pr-sw" data-k="${key}">${list.map((c) => `<button type="button" data-v="${c}" class="${L[key] === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}<input type="color" value="${L[key]}" aria-label="Any color"></div>`;
    const ch = (key, list, label = (x) => x) => `<div class="pr-ch" data-k="${key}">${list.map((x) => `<button type="button" data-v="${x}" class="${(Array.isArray(L[key]) ? L[key].includes(x) : L[key] === x) ? 'on' : ''}">${label(x)}</button>`).join('')}</div>`;
    panel.innerHTML = `<header><b>Your look</b><button type="button" class="pr-btn" data-a="random">🎲 Random</button><button type="button" class="pr-x" data-a="done" aria-label="Done">×</button></header>
      <h4>Body</h4>${sw('body', C.LOOK.palette)}
      <h4>Skin</h4>${sw('head', C.LOOK.skins)}
      <h4>Accent</h4>${sw('accent', ['#ffffff', ...C.LOOK.palette])}
      <h4>Shape</h4>${ch('shape', C.LOOK.shapes, cap)}
      <h4>Hat</h4>${ch('hat', C.LOOK.hats, (h) => `${HAT_ICON[h] || ''} ${h === 'none' ? 'None' : cap(h)}`)}
      <h4>Face</h4>${ch('face', C.LOOK.faces, cap)}
      <h4>Extras <small style="opacity:.6;text-transform:none;letter-spacing:0">(up to ${C.LOOK.maxExtras})</small></h4>${ch('extras', C.LOOK.extras, (x) => `${EXTRA_ICON[x] || ''} ${cap(x)}`)}
      <h4>Model</h4><div class="pr-ch"><input type="text" data-k="model" placeholder="a community model's id (a_…)" value="${esc(L.model || '')}" style="flex:1;font:13px system-ui;color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:9px;padding:8px"></div>
      <p class="pr-note">${P.me.signedIn ? 'Saved to your account: it shows in every game.' : 'Saved on this device. Sign in to keep it in every game.'}</p>
      <div style="display:flex;justify-content:flex-end;margin-top:10px"><button type="button" class="pr-btn" data-a="done" style="background:#7dd3fc;color:#0b1020">Done</button></div>`;
    panel.onclick = (e) => {
      const b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      if (b.dataset.a === 'done') { closePanel(); return; }
      if (b.dataset.a === 'random') { P.randomLook(); renderLook(); return; }
      const box = b.parentNode;
      const k = box && box.dataset.k;
      if (!k || b.dataset.v === undefined) return;
      const v = b.dataset.v;
      if (k === 'extras') {
        const cur = new Set(L.extras);
        if (cur.has(v)) cur.delete(v); else { if (cur.size >= C.LOOK.maxExtras) cur.delete([...cur][0]); cur.add(v); }
        P.setLook({ extras: [...cur] });
      } else P.setLook({ [k]: v });
      renderLook();
    };
    for (const inp of panel.querySelectorAll('input[type=color]')) inp.addEventListener('change', () => { P.setLook({ [inp.parentNode.dataset.k]: inp.value }); renderLook(); });
    const m = panel.querySelector('input[data-k=model]');
    if (m) m.addEventListener('change', () => { const v = m.value.trim(); P.setLook({ model: /^a_[0-9a-f]{6,40}$/.test(v) ? v : null }); renderLook(); });
  }
  const cap = (s) => String(s)[0].toUpperCase() + String(s).slice(1);
  P.customize = () => openLook();
  P.showPeople = () => openPeople();
  P.openChat = () => openChat();
  P.openEmotes = () => openWheel();
  P.closeUi = () => { closeChat(); closeWheel(); closePanel(); };

  // ------------------------------------------------------------------ the spectate bar
  let bar = null;
  function ensureBar() {
    style();
    if (bar && bar.isConnected) return;
    bar = make('div', 'pr-spect', '<button type="button" class="pr-btn" data-a="prev" aria-label="Previous">◀</button><b></b><button type="button" class="pr-btn" data-a="next" aria-label="Next">▶</button><button type="button" class="pr-btn" data-a="stop">Stop watching</button>');
    bar.hidden = true;
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.addEventListener('click', (e) => { const b = e.target.closest ? e.target.closest('button') : null; if (!b) return; if (b.dataset.a === 'stop') P.spectate(null); else P.spectate(b.dataset.a); });
  }
  P.on('spectate', (d) => { ensureBar(); bar.hidden = !d; if (d) bar.querySelector('b').textContent = `👁 ${d.name}`; renderPeople(false); });

  // ------------------------------------------------------------------ keys
  const typingIn = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); };
  window.addEventListener('keydown', (e) => {
    if (typingIn(e) || !W() || P.off()) return;
    const k = String(e.key || '').toLowerCase();
    if (wheel && !wheel.hidden) {
      if (/^[0-9]$/.test(k)) { e.preventDefault(); pick(k === '0' ? 9 : Number(k) - 1); return; }
      if (k === 'escape') { e.preventDefault(); closeWheel(); return; }
      if (k === 'enter' && hot >= 0) { e.preventDefault(); pick(hot); return; }
    }
    if (panel && !panel.hidden && k === 'escape') { e.preventDefault(); closePanel(); return; }
    if (P.spectating()) {
      if (k === 'arrowright' || k === ']') { P.spectate('next'); return; }
      if (k === 'arrowleft' || k === '[') { P.spectate('prev'); return; }
      if (k === 'escape') { P.spectate(null); return; }
    }
    if (e.repeat) return;
    if (k === 'enter' && H.mode !== 'build' && P.enabled('chat') && !anyOpen()) { e.preventDefault(); openChat(); return; }
    if (k === 'tab' && P.enabled('list')) { e.preventDefault(); togglePeople(); return; }
    if (k === 'b' && P.enabled('emotes') && !anyOpen()) { heldAt = performance.now(); openWheel(); }
  }, true);
  window.addEventListener('keyup', (e) => {
    const k = String(e.key || '').toLowerCase();
    if (k !== 'b' || !wheel || wheel.hidden || typingIn(e)) return;
    // Held and let go over an emote plays it; a quick tap leaves the wheel open to click.
    if (performance.now() - heldAt > 280) { if (hot >= 0) pick(hot); else closeWheel(); }
  });

  // ------------------------------------------------------------------ gamepad: Y emotes, Back who's here, LB/RB watch
  const pad = { was: [], hotAt: 0 };
  function gamepad() {
    if (!navigator.getGamepads) return;
    let gp = null;
    try { gp = [...navigator.getGamepads()].find((g) => g && g.connected); } catch { return; }
    if (!gp) return;
    const down = (i) => Boolean(gp.buttons[i] && gp.buttons[i].pressed);
    const pressed = (i) => down(i) && !pad.was[i];
    if (pressed(3)) toggleWheel();
    if (pressed(8)) togglePeople();
    if (P.spectating()) { if (pressed(5)) P.spectate('next'); if (pressed(4)) P.spectate('prev'); if (pressed(1)) P.spectate(null); }
    if (wheel && !wheel.hidden) {
      const x = gp.axes[0] || 0, y = gp.axes[1] || 0;
      if (Math.hypot(x, y) > 0.5) { const a = Math.atan2(y, x) + Math.PI / 2; const n = C.EMOTES.length; setHot(((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n); }
      if (pressed(0) && hot >= 0) pick(hot);
      if (pressed(1)) closeWheel();
    }
    pad.was = gp.buttons.map((b) => b.pressed);
  }

  // ------------------------------------------------------------------ the editor's pause menu can open these
  // (editor.js: frame.postMessage({ type: 'presence', open: 'customize' | 'people' | 'emotes' | 'chat' }, '*'))
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (e.source !== window.parent || m.type !== 'presence') return;
    if (m.open === 'customize') openLook();
    if (m.open === 'people') openPeople();
    if (m.open === 'emotes') openWheel();
    if (m.open === 'chat') openChat();
  });

  let at = 0;
  H.hooks.frame.push(() => {
    try {
      if (!W()) return;
      if (P.off()) { if (hud) hud.style.display = 'none'; P.closeUi(); return; }
      ensureHud();
      gamepad();
      if (performance.now() - at > 500) { at = performance.now(); hudState(); renderPeople(false); }
    } catch (err) { H.report(err, 'presence'); }
  });
  H.hooks.world.push({ leave() { P.closeUi(); if (bar) bar.hidden = true; preview = null; } });
})();
