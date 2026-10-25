// The game's chat window (J, 2026-10-24: "All captions should be in the chat window, period. I don't want to see any text
// overlapping the assistant chat window"): one place for everything said in a game, the Overseer (its lines used to be
// big captions), Pip and the other friends, the other players and you.
//
//   H.chat.line({ kind, who, text, color, action })   kind: 'overseer' | 'npc' | 'player' | 'me' | 'sys'
//   H.chat.attach({ send(text) })   typing in it talks to the Overseer (the guest sandbox once signed in); detach()
//   H.chat.open()                   focus its input (Enter does it too while attached)
//   H.chat.status(text | null)      a quiet line under the log ("The Overseer is thinking…")
//
// In the editor's frame there's no window here: each line goes to the editor page's own chat (post 'chat-line'), which is
// the Overseer's chat there. Elsewhere it's drawn at the bottom middle (top left on phones, where the stick and buttons
// aren't), the last lines fading after a while; the presence module's game chat writes its lines here too.
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.chat) return;
  // (The editor's game frame is /play/_draft: there the editor page shows the chat. Anywhere else, even in someone's iframe, it's here.)
  const embedded = (() => { try { return window.parent !== window && location.pathname.replace(/\/+$/, '') === '/play/_draft'; } catch { return false; } })();
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KEEP = 14; // seconds a line stays before fading (all of them show again while you type)
  let box = null, log = null, form = null, input = null, statusEl = null, attached = null, fallback = null;
  const sender = () => attached || fallback;

  function style() {
    if (document.getElementById('hc-css')) return;
    const st = document.createElement('style');
    st.id = 'hc-css';
    st.textContent = `
.hc-chat{position:fixed;left:50%;transform:translateX(-50%);bottom:max(14px,env(safe-area-inset-bottom));z-index:24;width:min(640px,calc(100vw - 32px));display:flex;flex-direction:column;align-items:stretch;gap:6px;pointer-events:none;font-family:var(--hud,system-ui,sans-serif)}
.hc-log{display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:5px;max-height:9.6em;overflow:hidden;text-align:center;font:600 15px/1.35 var(--hud,system-ui,sans-serif);letter-spacing:.02em;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 1px #000;-webkit-mask-image:linear-gradient(to top,#000 0%,#000 40%,rgba(0,0,0,.45) 75%,transparent 100%);mask-image:linear-gradient(to top,#000 0%,#000 40%,rgba(0,0,0,.45) 75%,transparent 100%)}
.hc-log p{margin:0;max-width:100%;transition:opacity .8s;overflow-wrap:anywhere;pointer-events:auto}
.hc-log p.old{opacity:0}.hc-log p.old .act{pointer-events:none}
.hc-chat.typing .hc-log p.old,.hc-chat:hover .hc-log p.old{opacity:.85}
.hc-log b{font:700 11px var(--display,system-ui);letter-spacing:.14em;text-transform:uppercase;margin-right:8px}
.hc-log p.overseer b{color:#7cc8ff;text-shadow:0 0 10px rgba(74,158,255,.8)}
.hc-log p.overseer b i{display:inline-block;width:10px;height:10px;margin:0 6px -1px 0;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff 0,#e8f4ff 30%,#9fd8ff 70%,#4a9eff 100%);box-shadow:0 0 8px rgba(143,216,255,.9)}
.hc-log p.npc b{color:#fde68a}.hc-log p.npc span{font-style:italic}
.hc-log p.me b{color:#d8b4fe}
.hc-log p.sys{color:rgba(200,225,255,.78);font-style:italic;font-weight:500;font-size:13.5px}
.hc-log .act{border:0;cursor:pointer;display:inline-block;margin-left:8px;font:700 11px var(--display,system-ui);letter-spacing:.08em;padding:5px 9px;background:linear-gradient(90deg,#f2b33d,#ff7a45);color:#16130a;text-decoration:none;text-shadow:none}
.hc-status{font:700 11px var(--display,system-ui);letter-spacing:.2em;text-transform:uppercase;color:#7cc8ff;text-shadow:0 0 10px rgba(74,158,255,.8);text-align:center}
.hc-status[hidden],.hc-form[hidden]{display:none}
.hc-form{position:relative;display:flex;align-items:center;gap:10px;pointer-events:auto;padding:4px 4px 6px;opacity:.6;transition:opacity .3s}
.hc-chat.typing .hc-form,.hc-form:hover{opacity:1}
.hc-form::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1.5px;background:linear-gradient(90deg,transparent,rgba(140,200,255,.55) 20%,rgba(140,200,255,.55) 80%,transparent)}
.hc-chat.typing .hc-form::after{height:2px;background:linear-gradient(90deg,transparent,#6cf0ff 15%,#a855f7 85%,transparent);box-shadow:0 0 14px rgba(108,240,255,.7)}
.hc-form input{flex:1;min-width:0;border:0;background:transparent;color:#fff;font:600 17px var(--hud,system-ui,sans-serif);letter-spacing:.03em;padding:8px 0;outline:none;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,.9)}
.hc-form input::placeholder{color:rgba(220,235,255,.6);font:700 11px var(--display,system-ui);letter-spacing:.22em;text-transform:uppercase}
body.pr-touch .hc-chat{left:12px;transform:none;top:max(66px,env(safe-area-inset-top));bottom:auto;width:min(340px,calc(100vw - 24px));flex-direction:column-reverse}
body.pr-touch .hc-log{align-items:flex-start;text-align:left;font-size:13.5px;max-height:8em;justify-content:flex-start;-webkit-mask-image:none;mask-image:none}
body.pr-touch .hc-log p{background:rgba(6,10,20,.55);padding:4px 9px;border-radius:8px}
body.pr-touch .hc-form{background:rgba(6,10,20,.8);border-radius:10px;padding:2px 10px;opacity:1}
body.pr-touch .hc-form input{text-align:left;font-size:15px}
body.pr-touch .hc-form:not(.on){display:none}`;
    document.head.appendChild(st);
  }

  function ensure() {
    if (box && box.isConnected) return true;
    if (typeof document === 'undefined' || !document.body) return false;
    style();
    box = document.createElement('div');
    box.className = 'hc-chat sh-keep';
    box.innerHTML = '<div class="hc-log" aria-live="polite"></div><div class="hc-status" hidden></div><form class="hc-form" hidden><input type="text" maxlength="4000" enterkeyhint="send" autocomplete="off" placeholder="Press Enter to talk to the Overseer" aria-label="Message the Overseer"></form>';
    document.body.appendChild(box);
    log = box.querySelector('.hc-log');
    statusEl = box.querySelector('.hc-status');
    form = box.querySelector('.hc-form');
    input = form.querySelector('input');
    // Typing here never drives the player, and a tap here isn't a tap on the game.
    for (const t of ['keydown', 'keyup', 'keypress', 'pointerdown']) box.addEventListener(t, (e) => e.stopPropagation());
    input.addEventListener('focus', () => { box.classList.add('typing'); form.classList.add('on'); });
    input.addEventListener('blur', () => { box.classList.remove('typing'); if (!input.value) form.classList.remove('on'); if (!attached) form.hidden = true; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; input.blur(); focusGame(); } });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      const to = sender();
      if (!text || !to) return;
      input.value = '';
      input.blur();
      focusGame();
      try { Promise.resolve(to.send(text)).catch((err) => line({ kind: 'sys', text: err && err.message ? err.message : String(err) })); }
      catch (err) { line({ kind: 'sys', text: err && err.message ? err.message : String(err) }); }
    });
    return true;
  }
  const focusGame = () => { const c = document.getElementById('stage'); if (c && c.focus) try { c.focus(); } catch { /* fine */ } };

  /** A line in the chat: who said it and what (an Overseer line may carry a link to act on: { label, href }). */
  function line(m) {
    if (!m || m.text === undefined || m.text === null || String(m.text).trim() === '') return;
    const kind = m.kind || (m.overseer ? 'overseer' : m.sys ? 'sys' : m.npc ? 'npc' : m.me ? 'me' : 'player');
    const text = String(m.text).slice(0, 600);
    const who = kind === 'overseer' ? 'Overseer' : kind === 'me' ? 'You' : m.who || m.name || '';
    if (embedded) { try { H.post({ type: 'chat-line', kind, who, text, color: m.color || null, action: m.action || null }); } catch { /* fine */ } return; }
    if (!ensure()) return;
    const p = document.createElement('p');
    p.className = kind;
    if (kind !== 'sys') {
      const b = document.createElement('b');
      b.innerHTML = kind === 'overseer' ? '<i aria-hidden="true"></i>Overseer' : esc(`${m.friend ? '★ ' : ''}${who}`);
      if (m.color && kind === 'player') b.style.color = m.color;
      p.appendChild(b);
    }
    const t = document.createElement('span');
    t.textContent = text;
    p.appendChild(t);
    if (m.action && typeof m.action.onclick === 'function') {
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'act';
      a.textContent = m.action.label || 'Do it';
      a.onclick = (e) => { e.preventDefault(); e.stopPropagation(); try { m.action.onclick(a); } catch { /* fine */ } };
      p.appendChild(a);
    } else if (m.action && m.action.href) {
      const a = document.createElement('a');
      a.className = 'act'; a.href = m.action.href; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = m.action.label || 'Open';
      p.appendChild(a);
    }
    log.appendChild(p);
    while (log.children.length > 8) log.firstChild.remove();
    setTimeout(() => p.classList.add('old'), (m.keep || KEEP) * 1000);
    return p;
  }

  H.chat = {
    embedded,
    line,
    /** Typing talks to the Overseer: send(text) does it (and says what went wrong by throwing). */
    attach(o) {
      attached = o && typeof o.send === 'function' ? o : null;
      if (embedded || !attached || !ensure()) return;
      form.hidden = false;
      if (o.placeholder) input.placeholder = o.placeholder;
    },
    detach() { attached = null; if (form) form.hidden = true; if (input && fallback) input.placeholder = fallback.placeholder || ''; },
    get attached() { return Boolean(attached); },
    /** Where nobody attached the Overseer: what typing here does instead (the game chat: presence-ui.js). */
    setFallback(o) { fallback = o && typeof o.send === 'function' ? o : null; if (!attached && input && fallback) input.placeholder = fallback.placeholder || ''; },
    /** Opens the input: to the Overseer when attached, else to the fallback (the other players); false when neither. */
    open() {
      const to = sender();
      if (embedded || !to || !ensure()) return false;
      form.hidden = false;
      input.placeholder = (to === attached ? attached.placeholder : fallback.placeholder) || 'Press Enter to talk to the Overseer';
      form.classList.add('on'); try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ } setTimeout(() => input.focus(), 0); return true; },
    status(text) { if (embedded) { try { H.post({ type: 'chat-status', text: text || null }); } catch { /* fine */ } return; } if (!ensure()) return; statusEl.hidden = !text; statusEl.textContent = text || ''; },
  };
  // Enter talks to the Overseer while it's attached (before the game chat, which still has its 💬 button).
  if (!embedded) {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !attached || e.repeat) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      H.chat.open();
    }, true);
  }
})();
