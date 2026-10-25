// The guest sandbox: /play/sandbox plays the 'sandbox' template (src/templates.ts) with no account, on this site's own
// page (served without the play sandbox: only our template runs here, and it needs the session to sign up).
// Guests play locally: nothing is saved, nothing costs anything, no Gen jobs, no assistant, no room (single-player).
//
// Who you are, then an account (J, 2026-10-24): the Overseer's intro and the mirror are a guest's; when the mirror's
// questions are done (a name or none), the account sheet opens and can't be put away (sign up, sign in, or Google; an
// email that already has an account is asked to sign in; "Forgot your password?" mails a link). Signed in, the island
// becomes their game (claim 'tour') and Pip's tour carries on in the editor, where the Overseer is the chat and what it
// makes is paid from their credits. Until then Pip waits (HawkesGuest.accountFirst: src/overseer-games/sandbox.js).
//
// When they want more ("Save this world", "Build your own", "Ask the Overseer", "Invite a friend"), the world as it is
// now is snapshotted (HawkesGuestCore.snapshot: every thing from scene.json still there, where it is now, and the
// things they spawned; terrain they dug) into localStorage, and the sign-up sheet opens (email, or Google, which comes
// back to /play/sandbox?claim=<intent>). Signed in, the snapshot becomes their first game: POST /v1/games (template
// 'sandbox') and the difference as scene ops (POST /v1/games/:id/scene), then the editor (/app/g/<id>).
//
// Analytics (Hawkes analytics, gen.hawkesgen.com/sdk/analytics@1.js): sandbox_start, sandbox_first_action,
// sandbox_try (each thing to try, once), sandbox_objective (each step of Pip's tour), sandbox_prompt (a button),
// signup_open, sandbox_signup, sandbox_claimed.
(function () {
  'use strict';
  const KEY = 'hg_guest_world';
  const MAX_THINGS = 450;
  const MAX_EDITS = 400;
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const r2 = (n) => Math.round(Number(n) * 100) / 100;

  // ------------------------------------------------------------------ the pure part (also run by test/engine/sandbox.test.ts)
  const Core = {
    /** The world as it is now, as a scene.json: the world's things that are still there (moving ones where they are
     *  now), things spawned while playing, and terrain edits (o.edits: what the 'terrain' event reported). */
    snapshot(H, o = {}) {
      const W = H.world;
      const graph = (W && W.graph) || {};
      const base = graph.entities || {};
      const config = clone(graph.config || {});
      const entities = {};
      let n = 0;
      for (const e of W.entities) {
        if (n >= MAX_THINGS) break;
        if (!e || !e.alive || !e.sceneId || W.byId.get(e.sceneId) !== e) continue;
        const d = e.data || {};
        if (d.grenade || d.sticky) continue; // in the air, about to go off
        const orig = base[e.sceneId];
        if (!orig && !(e.spawned && e.spec)) continue;
        const spec = clone(orig || e.spec);
        spec.id = e.sceneId;
        if (!orig) { delete spec.shadow; delete spec.temporary; }
        // Moving things where they are now (unless they fell into the sea or out of the world).
        const round = Boolean(H.planet && H.planet.round && H.hooks && H.hooks.space);
        const up = round ? H.planet.heightOf(e.position) : e.y;
        if (e.physics === 'dynamic' && Number.isFinite(up) && up > -2) {
          const q = e.node && e.node.rotationQuaternion;
          let yaw = 0;
          try { yaw = q && q.toEulerAngles ? q.toEulerAngles().y * 180 / Math.PI : e.rotation; } catch { yaw = 0; }
          const t = spec.transform || {};
          t.position = [r2(e.x), r2(e.y + 0.05), r2(e.z)];
          t.rotation = [0, Math.round(Number(yaw) || 0), 0];
          spec.transform = t;
          // (A round world: that's in the frame round the player; the world file keeps it on the planet.)
          if (round) H.hooks.space.toScene([{ op: 'replace', entity: spec }]);
        }
        entities[e.sceneId] = spec;
        n++;
      }
      const edits = (o.edits || []).filter((x) => Array.isArray(x));
      if (edits.length && config.terrain && typeof config.terrain === 'object') {
        config.terrain.edits = [...(config.terrain.edits || []), ...edits].slice(-MAX_EDITS);
      }
      return { version: graph.version || 1, config, entities };
    },
    /** The ops that turn the template's scene into the snapshot (deletes first, then the changed and new things). */
    toOps(base, snap) {
      const ops = [];
      const was = (base && base.entities) || {};
      if (JSON.stringify(base.config || {}) !== JSON.stringify(snap.config || {})) ops.push({ op: 'config', patch: snap.config });
      for (const id of Object.keys(was)) if (!snap.entities[id]) ops.push({ op: 'delete', id });
      for (const [id, e] of Object.entries(snap.entities)) {
        if (was[id] && JSON.stringify(was[id]) === JSON.stringify(e)) continue;
        ops.push({ op: 'replace', entity: e });
      }
      return ops;
    },
    chunks(list, n) { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; },
  };
  window.HawkesGuestCore = Core;
  if (typeof document === 'undefined') return;

  // ------------------------------------------------------------------ analytics
  const queue = [];
  function track(name, props) {
    const a = window.hawkesAnalytics;
    if (a && a.track) { try { a.track(name, props || {}); } catch { /* never break the game */ } } else queue.push([name, props]);
  }
  (function loadAnalytics() {
    const s = document.createElement('script');
    s.src = 'https://gen.hawkesgen.com/sdk/analytics@1.js';
    s.defer = true;
    s.dataset.product = 'hawkesgen';
    // Every event from here says it's the no-sign-up sandbox, played as a guest (who sticks around, by where they came in).
    s.onload = () => { try { window.hawkesAnalytics.setContext({ entry: 'sandbox', account: 'guest' }); } catch { /* fine */ } for (const [n, p] of queue.splice(0)) track(n, p); };
    document.head.appendChild(s);
  })();

  // ------------------------------------------------------------------ storage and the account side
  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.scene ? v : null; } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* fine */ } },
  };
  const api = async (method, url, body) => {
    let r;
    try { r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' }); }
    catch { const e = new Error("Couldn't reach Hawkes Gen. Check your connection and try again."); e.status = 0; throw e; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || `That did not work (${r.status})`); e.status = r.status; throw e; }
    return d;
  };
  const me = () => fetch('/v1/users/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.user) || null).catch(() => null);

  const isTouch = () => { try { return Boolean(window.HawkesPlay && window.HawkesPlay.touchUi); } catch { return false; } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ the look (dark: this is the game)
  function style() {
    const st = document.createElement('style');
    st.textContent = `
.gs-ui{position:fixed;z-index:30;font-family:var(--hud);color:#e8ecf6}
.gs-glass{background:rgba(10,14,24,.78);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.gs-acts{right:12px;top:12px;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100vw - 24px);pointer-events:auto}
.gs-acts button{font:700 14px var(--hud);letter-spacing:.03em;color:#e8ecf6;background:rgba(10,14,24,.78);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:10px;padding:9px 13px;cursor:pointer;min-height:40px}
.gs-acts button:hover{border-color:#4a9eff}
.gs-acts button.glow{border-color:#ffd84a;color:#fff;animation:gsGlow 1.6s ease-in-out infinite;position:relative}
.gs-acts button.glow::after{content:attr(data-tip);position:absolute;right:0;top:calc(100% + 8px);width:max-content;max-width:260px;font:600 13px/1.35 var(--hud);letter-spacing:0;text-align:left;color:#16130a;background:#ffd84a;border-radius:10px;padding:8px 11px;box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none}
@keyframes gsGlow{0%,100%{box-shadow:0 0 0 0 rgba(255,216,74,.0),0 0 12px rgba(255,216,74,.35)}50%{box-shadow:0 0 0 6px rgba(255,216,74,.18),0 0 26px rgba(255,216,74,.7)}}
.gs-acts button.primary{background:linear-gradient(90deg,#4a9eff,#a855f7);border-color:transparent;color:#fff}
.gs-acts .more{display:none}
.gs-toast{right:12px;top:62px;padding:12px 14px;display:flex;gap:12px;align-items:center;font:600 15px var(--hud);pointer-events:auto;max-width:calc(100vw - 24px)}
.gs-toast button{font:700 14px var(--hud);border-radius:9px;padding:8px 12px;cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#e8ecf6;min-height:38px}
.gs-toast button.primary{background:linear-gradient(90deg,#4a9eff,#a855f7);border-color:transparent;color:#fff}
.gs-veil{inset:0;z-index:60;background:rgba(4,6,12,.66);display:grid;place-items:center;padding:16px;pointer-events:auto}
.gs-sheet{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:22px 22px 18px;font-family:var(--sans)}
.gs-sheet h3{margin:0 0 6px;font:700 20px var(--display);letter-spacing:.04em;color:#fff}
.gs-sheet p{margin:0 0 14px;color:#a5acc2;font:14px/1.45 var(--sans)}
.gs-sheet .google{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;background:#fff;color:#1f2937;border-radius:10px;padding:11px;font:600 15px var(--sans);text-decoration:none;min-height:44px}
.gs-sheet .or{display:flex;align-items:center;gap:10px;color:#6b7280;font:12px var(--sans);margin:14px 0}
.gs-sheet .or::before,.gs-sheet .or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.14)}
.gs-sheet label{display:block;font:600 12.5px var(--sans);color:#c7cbe0;margin:0 0 4px}
.gs-sheet input{width:100%;box-sizing:border-box;font:15px var(--sans);color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);border-radius:9px;padding:10px 11px;margin-bottom:10px;-webkit-user-select:text;user-select:text}
.gs-sheet input:focus{outline:none;border-color:#4a9eff}
.gs-sheet .go{width:100%;font:700 15px var(--sans);color:#fff;background:linear-gradient(90deg,#4a9eff,#a855f7);border:0;border-radius:10px;padding:12px;cursor:pointer;min-height:46px}
.gs-sheet .go:disabled{opacity:.6}
.gs-sheet .err{color:#fca5a5;font:13px var(--sans);margin:0 0 10px}
.gs-sheet .note{color:#bfe3ff;font:13px/1.45 var(--sans);margin:0 0 10px;padding:8px 10px;border-radius:8px;background:rgba(74,158,255,.12);border:1px solid rgba(74,158,255,.35)}
.gs-sheet a.back{display:block;text-align:center;text-decoration:none}
.gs-sheet [hidden]{display:none !important}
.gs-sheet .fine{font:12px var(--sans);color:#8088a3;margin:10px 0 0}
.gs-sheet .fine a,.gs-sheet .swap a{color:#93c5fd}
.gs-sheet .swap{font:13px var(--sans);color:#a5acc2;margin:12px 0 0;text-align:center}
.gs-sheet .back{display:block;margin:12px auto 0;background:none;border:0;color:#a5acc2;font:600 14px var(--sans);cursor:pointer;padding:8px}
.gs-busy{font:700 14px var(--display);letter-spacing:.18em;color:#7cc4ff;text-align:center}
.gs-busy small{display:block;margin-top:10px;font:500 14px var(--sans);letter-spacing:0;color:#a5acc2}
@media (max-width:640px){
   .gs-acts .opt{display:none}.gs-acts .more{display:inline-block}
 .gs-acts.open{flex-direction:column;align-items:stretch}.gs-acts.open .opt{display:inline-block}
 .gs-toast{left:12px;flex-wrap:wrap}
}`;
    document.head.appendChild(st);
  }
  function el(html, cls) {
    const d = document.createElement('div');
    d.className = 'gs-ui ' + (cls || '');
    d.innerHTML = html;
    // Typing in our UI never drives the player.
    for (const t of ['keydown', 'keyup', 'keypress']) d.addEventListener(t, (e) => e.stopPropagation());
    document.body.appendChild(d);
    return d;
  }

  // ------------------------------------------------------------------ what they try (the island's own quest line guides them)
  // The guide is the world's: Pip's tour (config.quests "tour", src/overseer-games/sandbox.ts) in the quest tracker, and
  // its moments in the template's script. Here we only notice what they do, for the analytics and the nudge.
  const TRIES = ['drive', 'boom', 'fish', 'talk', 'spawn', 'fly'];

  function startUi(H, base, t0) {
    style();
    const touch = isTouch();
    const done = new Set();
    let first = false;
    const edits = [];
    track('sandbox_start', { touch, ms: Math.round(performance.now()), loadMs: Math.round(performance.now() - t0) });

    function tick(id) {
      if (done.has(id) || !TRIES.includes(id)) return;
      done.add(id);
      track('sandbox_try', { what: id, n: done.size, s: Math.round((performance.now() - t0) / 1000) });
      if (done.size === 2 && !touring()) nudge(4000);
    }
    // (While Pip's tour runs, the nudge waits for its end.)
    const touring = () => { try { return H.game.events.quests.state('tour') === 'active'; } catch { return false; } };

    // The buttons that open the account side.
    const acts = el(`<button type="button" class="primary" data-intent="save">Save this world</button><button type="button" class="opt" data-intent="build">Build your own</button><button type="button" class="opt" data-intent="assistant">Ask the Overseer</button><button type="button" class="opt" data-intent="invite">Invite a friend</button><button type="button" class="more" data-more aria-label="More">⋯</button>`, 'gs-acts');
    acts.querySelectorAll('[data-intent]').forEach((b) => { b.onclick = () => { acts.classList.remove('open'); want(b.dataset.intent, 'button'); }; });
    acts.querySelector('[data-more]').onclick = () => acts.classList.toggle('open');

    // One gentle nudge, once: after two things tried, at the end of the tour, or after four minutes.
    let nudged = false;
    function nudge(wait = 0) {
      if (nudged) return;
      nudged = true;
      if (wait) return void setTimeout(() => { nudged = false; nudge(); }, wait);
      const t = el('<span>Having fun? Keep this island: it becomes your game.</span><button type="button" class="primary" data-yes>Save this world</button><button type="button" data-no>Not now</button>', 'gs-glass gs-toast');
      t.querySelector('[data-yes]').onclick = () => { t.remove(); want('save', 'nudge'); };
      t.querySelector('[data-no]').onclick = () => t.remove();
      setTimeout(() => t.remove(), 12000);
    }
    setTimeout(() => { if (!touring()) nudge(); }, 4 * 60 * 1000);

    // What they do: the first action, and the things to try.
    const firstAction = (what) => { if (first) return; first = true; track('sandbox_first_action', { what, s: Math.round((performance.now() - t0) / 100) / 10, touch }); };
    const inUi = (e) => e.target && e.target.closest && e.target.closest('.gs-ui');
    window.addEventListener('keydown', (e) => { if (!inUi(e)) firstAction('key:' + String(e.key || '').toLowerCase().slice(0, 10)); }, true);
    window.addEventListener('pointerdown', (e) => { if (!inUi(e)) firstAction(e.pointerType === 'touch' ? 'touch' : 'click'); }, true);
    const game = H.game;
    const on = (ev, f) => { try { game.on(ev, f); } catch { /* an event this build doesn't have */ } };
    // The Overseer's intro (modules/overseer/intro.js) plays first here: did they watch it?
    on('intro', (d) => { if (d && d.state === 'end') track('sandbox_intro', { skipped: Boolean(d.skipped) }); });
    on('explosion', () => tick('boom'));
    on('cast', () => tick('fish'));
    on('catch', () => tick('fish'));
    on('spawned', () => tick('spawn'));
    on('sandbox-high', () => tick('fly'));
    // The tour's steps (Pip's quest line), each once, and its end: the moment to offer keeping the island.
    on('tour', (d) => { if (d && d.step) track('sandbox_objective', { step: d.step, s: Math.round((performance.now() - t0) / 1000), touch }); });
    on('quest', (d) => {
      if (!d || d.id !== 'tour') return;
      if (d.state === 'start') track('sandbox_objective', { step: 'start', s: Math.round((performance.now() - t0) / 1000), touch });
      if (d.state === 'done') {
        nudge(7000);
        setTimeout(() => highlightAssistant('done'), 9000);
        // The tour's end is the natural pause to ask how it was (the SDK's card, once a session; never mid-tour).
        setTimeout(() => { try { window.hawkesAnalytics?.ask?.({ id: 'sandbox-tour', question: 'How was the island tour?', context: 'sandbox tour', kind: 'stars', comment: true, theme: { background: '#14161b', color: '#f1f2f4', accent: '#f2b33d', font: 'Inter, system-ui, sans-serif', radius: '12px' } }); } catch { /* fine */ } }, 20000);
      }
    });
    // After the tour (or 5 minutes in without finishing it): the assistant is the next big thing, so its button glows
    // with a word on what it does, until it's clicked.
    let highlighted = false;
    function highlightAssistant(why) {
      if (highlighted) return;
      const b = acts.querySelector('[data-intent="assistant"]');
      if (!b) return;
      highlighted = true;
      b.classList.add('glow');
      b.dataset.tip = 'Describe anything ("a volcano", "a race around the island") and the Overseer builds it.';
      if (window.matchMedia && window.matchMedia('(max-width: 700px)').matches) acts.classList.add('open');
      b.addEventListener('click', () => { b.classList.remove('glow'); delete b.dataset.tip; }, { once: true });
      track('sandbox_highlight', { what: 'assistant', why, s: Math.round((performance.now() - t0) / 1000) });
    }
    setTimeout(() => highlightAssistant('5min'), 5 * 60 * 1000);
    on('terrain', (d) => { for (const x of (d && d.edits) || []) if (edits.length < MAX_EDITS) edits.push(x); });
    // The mirror's questions answered (or skipped): now the account (once; the sheet can't be put away).
    let gated = false;
    on('mirror', (d) => {
      if (gated || !d || (d.state !== 'done' && d.state !== 'skip')) return;
      gated = true;
      track('sandbox_gate', { s: Math.round((performance.now() - t0) / 1000), named: Boolean(lookName(H)) });
      setTimeout(() => want('tour', 'mirror'), 1400);
    });
    setInterval(() => {
      try { if (H.game.player && H.game.player.controller === 'drive') tick('drive'); } catch { /* fine */ }
      if (document.querySelector('.lv-chat')) tick('talk');
    }, 500);

    // ------------------------------------------------------------------ wanting more: snapshot, then the account
    async function want(intent, from) {
      track('sandbox_prompt', { intent, from });
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ }
      let snap = null;
      try { snap = Core.snapshot(H, { edits }); } catch (err) { console.warn('sandbox snapshot', err); }
      let look = null;
      try { look = H.presence && H.presence.look ? JSON.parse(JSON.stringify(H.presence.look)) : null; } catch { look = null; }
      store.set({ v: 1, at: Date.now(), intent, scene: snap || base, base, look });
      const user = await me();
      if (user) return claim(intent, user);
      openSheet(intent, { forced: intent === 'tour', name: lookName(H) });
    }
  }

  // ------------------------------------------------------------------ sign up (the landing page's account: email or Google)
  const WHY = {
    save: ['Save this world', 'Sign in (or make a free account) and this island, as you left it, becomes your game. Then change anything in it.'],
    build: ['Build your own', 'Sign in (or make a free account) and you are in the editor with this island: move things, add things, make it a game.'],
    assistant: ['Ask the Overseer', 'Describe anything ("a volcano", "a race around the island") and the Overseer builds it. It needs an account; your island comes with you.'],
    invite: ['Invite a friend', 'Playing and building together needs an account. Your island becomes your game, and you get a link to send.'],
    tour: ['One more thing', 'Sign in so I know you when you come back (new here? An account is free). Your island, your look and your name come with you, and I can make anything you ask for: it uses your credits, and new accounts start with free ones.'],
  };
  /** The name they gave at the mirror (or none). */
  function lookName(H) { try { const n = H && H.presence && H.presence.look && H.presence.look.name; return n ? String(n).slice(0, 40) : ''; } catch { return ''; } }
  function openSheet(intent, o = {}) {
    const [title, whyText] = WHY[intent] || WHY.save;
    const why = o.name && intent === 'tour' ? `${o.name}. ${whyText}` : whyText;
    const forced = Boolean(o.forced);
    track('signup_open', { from: 'sandbox', intent, forced });
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ }
    // Sign-in first (J, 2026-10-24): Google signs in and signs up the same way; "Create an account" is one tap away.
    let mode = 'login';
    const veil = el(`<div class="gs-glass gs-sheet" role="dialog" aria-modal="true" aria-labelledby="gsTitle">
      <h3 id="gsTitle">${esc(title)}</h3><p>${esc(why)}</p>
      <a class="google" id="gsGoogle" hidden href="/auth/google?next=${encodeURIComponent('/play/sandbox?claim=' + intent)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Continue with Google</span></a>
      <div class="or" id="gsOr" hidden>or with email</div>
      <form id="gsForm" novalidate>
        <div id="gsNameRow"><label for="gsName">Name or studio</label><input id="gsName" autocomplete="organization"></div>
        <label for="gsEmail">Email</label><input id="gsEmail" type="email" autocomplete="email" required>
        <label for="gsPw">Password <span id="gsPwHint">(8 characters or more)</span></label><input id="gsPw" type="password" minlength="8" autocomplete="new-password" required>
        <p class="err" id="gsErr" hidden></p>
        <p class="note" id="gsNote" hidden></p>
        <button class="go" type="submit" id="gsGo">Create account and save</button>
        <p class="swap" id="gsForgotRow" hidden><a href="#" id="gsForgot">Forgot your password?</a></p>
        <p class="fine" id="gsTerms">By creating an account you agree to the <a href="/legal#terms" target="_blank">terms</a> and <a href="/legal#privacy" target="_blank">privacy policy</a>.</p>
      </form>
      <p class="swap" id="gsSwap"></p>
      ${forced ? '<a class="back" href="/" data-leave>Leave the island</a>' : '<button type="button" class="back" data-back>Keep playing</button>'}
    </div>`, 'gs-veil');
    const $ = (id) => veil.querySelector('#' + id);
    const setMode = (m) => {
      mode = m;
      $('gsNameRow').hidden = m !== 'signup';
      $('gsPwHint').hidden = m !== 'signup';
      $('gsTerms').hidden = m !== 'signup';
      $('gsPw').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
      $('gsGo').textContent = intent === 'tour' ? (m === 'signup' ? 'Create my account' : 'Sign in') : m === 'signup' ? 'Create account and save' : 'Sign in and save';
      $('gsForgotRow').hidden = m !== 'login';
      $('gsSwap').innerHTML = m === 'signup' ? 'Have an account? <a href="#" data-swap>Sign in</a>' : 'New here? <a href="#" data-swap>Create an account</a>';
      $('gsSwap').querySelector('[data-swap]').onclick = (e) => { e.preventDefault(); setMode(m === 'signup' ? 'login' : 'signup'); };
      $('gsErr').hidden = true;
      $('gsNote').hidden = true;
    };
    setMode('login');
    if (o.name) $('gsName').value = o.name;
    const note = (text) => { $('gsNote').textContent = text; $('gsNote').hidden = false; $('gsErr').hidden = true; };
    const fail = (text) => { $('gsErr').textContent = text; $('gsErr').hidden = false; $('gsNote').hidden = true; };
    // "Forgot your password?": a link by email (the island stays in this browser; the reset page brings them back).
    $('gsForgot').onclick = async (e) => {
      e.preventDefault();
      const email = $('gsEmail').value.trim();
      if (!email) { fail('Type your email first, then ask again.'); $('gsEmail').focus(); return; }
      try {
        const r = await api('POST', '/v1/users/forgot', { email });
        track('sandbox_forgot', { intent, mail: Boolean(r.mail) });
        note(r.mail ? `If there's an account for ${email}, a link to set a new password is on its way. Set it, and you'll come back here to your island.` : 'This server sends no email. Ask support@hawkesgen.com for a link to set a new password.');
      } catch (x) { fail(x.message); }
    };
    fetch('/v1/health').then((r) => r.json()).then((h) => { if (h && h.google) { $('gsGoogle').hidden = false; $('gsOr').hidden = false; } }).catch(() => {});
    $('gsGoogle').addEventListener('click', () => track('sandbox_signup_google', { intent }));
    const close = () => veil.remove();
    // (Forced: it can't be put away: the way out is leaving the island.)
    if (!forced) veil.querySelector('[data-back]').onclick = close;
    else veil.querySelector('[data-leave]').onclick = () => track('sandbox_gate_leave', {});
    veil.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (!forced && e.target === veil) close(); });
    veil.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !forced) close(); });
    $('gsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const go = $('gsGo');
      const err = $('gsErr');
      err.hidden = true;
      $('gsNote').hidden = true;
      const body = { email: $('gsEmail').value.trim(), password: $('gsPw').value };
      if (!body.email || !body.password) { err.textContent = 'Your email and a password, please.'; err.hidden = false; return; }
      if (mode === 'signup' && body.password.length < 8) { err.textContent = 'The password needs 8 characters or more.'; err.hidden = false; $('gsPw').focus(); return; }
      if (mode === 'signup') body.name = $('gsName').value.trim();
      go.disabled = true;
      try {
        const d = await api('POST', mode === 'signup' ? '/v1/users/signup' : '/v1/users/login', body);
        if (d.apiKey) try { localStorage.setItem('hg_last_minted_key', d.apiKey); } catch { /* fine */ }
        track(mode === 'signup' ? 'sandbox_signup' : 'sandbox_login', { intent, method: 'email' });
        close();
        await claim(intent, d.user);
      } catch (x) {
        go.disabled = false;
        // That email already has an account: it's theirs to sign in to (with its password, or Google if made that way).
        if (mode === 'signup' && x.status === 409) {
          track('sandbox_signup_exists', { intent });
          setMode('login');
          $('gsPw').value = '';
          note(`There's already an account for ${body.email}. Sign in with its password${$('gsGoogle').hidden ? '' : ', or with Google if you made it that way'}.`);
          $('gsPw').focus();
          return;
        }
        if (mode === 'login' && x.status === 401) { fail("That email and password don't match an account. Try again, set a new password, or create an account if you're new."); $('gsForgotRow').hidden = false; return; }
        fail(x.message);
      }
    });
    setTimeout(() => $('gsEmail').focus(), 50);
  }

  // ------------------------------------------------------------------ signed in: the snapshot becomes their first game
  async function claim(intent, user) {
    const saved = store.get();
    const tour = intent === 'tour';
    style();
    const busy = el(tour ? '<div class="gs-busy">WELCOME<small>Your island is yours now. Pip is waiting…</small></div>' : '<div class="gs-busy">SAVING YOUR ISLAND<small>It becomes your game. Opening the editor…</small></div>', 'gs-veil');
    try {
      // (The tour goes on from the island as it loaded when this browser has none: signed in on another device.)
      if (!saved && !tour) throw new Error('Nothing to save: this browser has no island from the sandbox.');
      const name = saved && saved.look && saved.look.name ? String(saved.look.name).slice(0, 40) : '';
      let game;
      try { game = await api('POST', '/v1/games', { title: name ? `${name}'s island` : 'My island', template: 'sandbox' }); }
      catch (x) { if (x.status === 402) return gamesFull(busy, x.message, intent); throw x; }
      // The look they made at the mirror is theirs now (it replaces what the account had: they just chose it).
      if (saved && saved.look) await api('POST', '/v1/users/me/avatar', { avatar: saved.look }).catch((e) => console.warn('sandbox: look not saved', e));
      const ops = saved ? Core.toOps(saved.base || { config: {}, entities: {} }, saved.scene) : [];
      const notApplied = [];
      for (const part of Core.chunks(ops, 200)) {
        const r = await api('POST', `/v1/games/${game.id}/scene`, { ops: part });
        if (r && r.errors && r.errors.length) notApplied.push(...r.errors);
      }
      // Their island, from now on: the Overseer's beginning and the mirror only the first time (they've seen them here);
      // straight from the mirror (the tour), not again at all: Pip's tour goes on in the editor.
      const once = tour ? false : 'first';
      await api('POST', `/v1/games/${game.id}/scene`, { ops: [{ op: 'config', patch: { overseer: { intro: once } } }, { op: 'update', id: 'mirror', patch: { shape: { character: { start: once } } } }] }).catch(() => {});
      if (notApplied.length) console.warn('sandbox: some changes were not kept', notApplied);
      store.clear();
      track('sandbox_claimed', { intent, changes: ops.length, skipped: notApplied.length, user: user ? 'yes' : 'no' });
      // (The tour: playing, Pip's tour, the Overseer in the chat. Otherwise the editor's short building tour.)
      location.replace(tour ? `/app/g/${game.id}?tour=1` : `/app/g/${game.id}?welcome=build`);
    } catch (x) {
      busy.innerHTML = `<div class="gs-glass gs-sheet"><h3>That did not work</h3><p>${esc(x.message)}</p><button type="button" class="go" data-retry>Try again</button><a class="back" style="display:block;text-align:center" href="/app">Go to my games</a>${tour ? '' : '<button type="button" class="back" data-back>Back to the island</button>'}</div>`;
      busy.querySelector('[data-retry]').onclick = () => { busy.remove(); claim(intent, user); };
      const back = busy.querySelector('[data-back]');
      if (back) back.onclick = () => { busy.remove(); if (!window.HawkesPlay || !window.HawkesPlay.world) location.replace('/play/sandbox'); };
    }
  }
  /** Signed in, but their plan has no room for another game: their games, or the island as a guest (not kept). */
  function gamesFull(busy, message, intent) {
    track('sandbox_games_full', { intent });
    busy.innerHTML = `<div class="gs-glass gs-sheet"><h3>No room for another game</h3><p>${esc(message)}</p><a class="go" style="display:block;text-align:center;text-decoration:none" href="/app">Go to my games</a><button type="button" class="back" data-back>Play the island without keeping it</button></div>`;
    busy.querySelector('[data-back]').onclick = () => {
      busy.remove();
      if (!window.HawkesPlay || !window.HawkesPlay.world) return location.replace('/play/sandbox');
      window.HawkesGuest.accountFirst = false; // (Pip's tour, here)
    };
  }

  // ------------------------------------------------------------------ the page: claim (back from signing in), or play
  window.HawkesGuest = {
    /** Pip waits for this: the account comes first (the mirror opens the sheet; the tour goes on in the editor). */
    accountFirst: true,
    async boot(o = {}) {
      const t0 = performance.now();
      const q = new URLSearchParams(location.search);
      const intent = q.get('claim');
      if (intent) {
        history.replaceState(null, '', '/play/sandbox' + (q.get('touch') ? '?touch=' + q.get('touch') : ''));
        const user = await me();
        if (user && (store.get() || intent === 'tour')) {
          track('sandbox_signup', { intent, method: 'google' });
          document.getElementById('loading').hidden = true;
          return claim(WHY[intent] ? intent : 'save', user);
        }
      }
      // Fetch the world while the engine loads.
      const bundle = fetch('/v1/play-template/sandbox').then((r) => r.json().then((b) => { if (!r.ok) throw new Error(b.error || 'Could not load the sandbox'); return b; }));
      try {
        await window.HawkesModules.load('play', { bundle }); // (only the modules the island uses; the rest after)
        const b = await bundle;
        let base = null;
        try { base = JSON.parse(b.files['scene.json']); } catch { /* the template is ours: never */ }
        window.HawkesPlay.run(b, { mode: 'play' });
        startUi(window.HawkesPlay, base, t0);
      } catch (e) {
        if (o.failed) o.failed(e);
      }
    },
  };
})();
