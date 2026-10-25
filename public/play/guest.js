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
// Coming back (J, 2026-10-25): a second visit does not repeat the beginning. `hg_sandbox_return` (the `ret` record: the
// character's name, the tour step they are on, who they were signed in as) is written when the mirror is done and as the
// tour moves; with the intro's own flag (`hg_overseer_intro`) it makes a visit a return. A return skips the intro and the
// mirror (config as in the Observatory's return), is beamed in, is welcomed back by name, and the tour resumes on the step
// they left (sandbox.js reads HawkesGuest.resume and fast-forwards Pip's quest silently). L or "Change my look" opens the
// mirror's questions anywhere. Storage cleared: no record, no intro flag, the full beginning.
// Invitations (J, 2026-10-25; src/invites.ts, docs/story.md "Visitors"): "Invite a friend" (the button, and the pause menu on
// Esc twice) needs no account. It asks POST /v1/island-invite for a link, puts this player in the island's room
// (play:t/sandbox:<code>, HawkesNet) and shares the link (the native share sheet on phones, else copied). A friend who opens
// /play/sandbox?invite=<token> is checked first (GET /v1/island-invite/<token>: closed, full, expired and unreadable links get
// a plain message and "Start my own island"), then gets the same loading screen, a short intro (config.overseer.intro
// "short"), the mirror, and the sheet as always (J's rule); at the mirror's end they join the room and are beamed in beside
// the inviter, who sees the beam and the name and hears from the Overseer: "Someone is coming." ?ref=<code> in the link is kept
// as the landing page keeps it (hg_ref), so a sign-up credits the inviter.
// Analytics (Hawkes analytics, gen.hawkesgen.com/sdk/analytics@1.js): sandbox_start, sandbox_first_action,
// sandbox_try (each thing to try, once), sandbox_objective (each step of Pip's tour), sandbox_prompt (a button),
// signup_open, sandbox_signup, sandbox_claimed.
// The funnel, in order, each with `ms` (since the page loaded; track() adds it) and nothing personal (no email, name or
// password; failures give a reason code): sandbox_open (landing page) > sandbox_scripts_ready > sandbox_world_built >
// sandbox_first_frame > sandbox_start > sandbox_veil_shown > sandbox_veil_passed > sandbox_intro_start >
// sandbox_intro_skip | sandbox_intro_end > sandbox_mirror_open > sandbox_mirror_answer {step} | sandbox_mirror_skip {step} >
// sandbox_sheet_shown > sandbox_sheet_focus {field} > sandbox_google_popup {opened} > sandbox_signup_submit {mode} >
// sandbox_signup_ok {mode, method} | sandbox_signup_failed {mode, reason} > sandbox_tour_start > sandbox_tour_step {step, n}
// (drive, fish, boom, spawn, ask, fly, and Chapter One's hill and launch) > sandbox_tour_done; sandbox_quest_hill / sandbox_quest_launch / sandbox_bay_lit; sandbox_first_{drive,fish,boom,ask,fly}. Listed in AGENTS.md.
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
    /** The Overseer's words on the account sheet (docs/story.md voice rules: it asks, never commands, never says why). */
    sheetLine(name) {
      const n = String(name || '').replace(/[<>]/g, '').trim().slice(0, 40);
      return n ? `${n}. A good name to keep. Tell me where to find you, and I will keep this world for you.` : 'I have watched you arrive. Tell me where to find you, and I will keep this world for you.';
    },
    /** What the sheet shows of who they are: icon, what they chose to be, the name, the body color (H.presence.core). */
    character(H) {
      const look = (H && H.presence && H.presence.look) || (H && H.presence && H.presence.me && H.presence.me.look) || null;
      const core = H && H.presence && H.presence.core;
      const w = look && core && core.WHAT && core.WHAT.get ? core.WHAT.get(look.what) : null;
      const color = look && /^#[0-9a-f]{6}$/i.test(look.body || '') ? look.body : '#4a9eff';
      return { icon: (w && w.icon) || '🧍', label: (w && w.label) || 'A person', name: (look && look.name) || '', color };
    },
    chunks(list, n) { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; },
  };
  window.HawkesGuestCore = Core;
  if (typeof document === 'undefined') return;
  // Studio's playtest (public/playtest/portal.js): only a browser under automation loads it.
  try { if (navigator.webdriver || /[?&]playtest=/.test(location.search) || sessionStorage.getItem('hg_playtest_run')) import('/playtest/portal.js').catch(function () {}); } catch { /* never breaks the game */ }

  // ------------------------------------------------------------------ analytics
  const queue = [];
  function track(name, props) {
    props = Object.assign({ ms: Math.round(performance.now()) }, props);
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
  // For the engine's own moments that happen before (or outside) the game events (the click-to-enter veil).
  window.hgFunnel = (name, props) => { try { track(name, props); } catch { /* never break the game */ } };

  // ------------------------------------------------------------------ storage and the account side
  const store = {
    get() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.scene ? v : null; } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* fine */ } },
  };
  const api = async (method, url, body, o = {}) => {
    let r;
    try { r = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}) }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin', keepalive: Boolean(o.keepalive) }); }
    catch { const e = new Error("Couldn't reach Hawkes Gen. Check your connection and try again."); e.status = 0; throw e; }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(d.error || `That did not work (${r.status})`); e.status = r.status;
      // Studio's login in front of the beta site (not the portal): its 401 says where to sign in.
      if (r.status === 401 && typeof d.signin === 'string' && /^https:\/\//.test(d.signin)) e.wall = d.signin;
      throw e;
    }
    return d;
  };
  const me = () => fetch('/v1/users/me?soft=1', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((d) => (d && d.user) || null).catch(() => null);

  const isTouch = () => { try { return Boolean(window.HawkesPlay && window.HawkesPlay.touchUi); } catch { return false; } };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ the look (dark: this is the game)
  function style() {
    const st = document.createElement('style');
    st.textContent = `
.gs-ui{position:fixed;z-index:30;font-family:var(--hud);color:#e8ecf6}
.gs-glass{background:rgba(10,14,24,.78);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.gs-acts{right:12px;top:12px;display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100vw - 24px);pointer-events:auto}
.gs-acts button{font:700 14px var(--hud);letter-spacing:.03em;color:#e8ecf6;background:rgba(10,14,24,.78);border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-radius:10px;padding:9px 13px;cursor:pointer;min-height:44px}
.gs-acts button:hover{border-color:#4a9eff}
.gs-acts button.glow{border-color:#ffd84a;color:#fff;animation:gsGlow 1.6s ease-in-out infinite;position:relative}
.gs-acts button.glow::after{content:attr(data-tip);position:absolute;right:0;top:calc(100% + 8px);width:max-content;max-width:260px;font:600 13px/1.35 var(--hud);letter-spacing:0;text-align:left;color:#16130a;background:#ffd84a;border-radius:10px;padding:8px 11px;box-shadow:0 6px 20px rgba(0,0,0,.4);pointer-events:none}
@keyframes gsGlow{0%,100%{box-shadow:0 0 0 0 rgba(255,216,74,.0),0 0 12px rgba(255,216,74,.35)}50%{box-shadow:0 0 0 6px rgba(255,216,74,.18),0 0 26px rgba(255,216,74,.7)}}
.gs-acts button.primary{background:linear-gradient(90deg,#4a9eff,#a855f7);border-color:transparent;color:#fff}
.gs-acts .more{display:none}
.gs-toast{right:12px;top:62px;padding:12px 14px;display:flex;gap:12px;align-items:center;font:600 15px var(--hud);pointer-events:auto;max-width:calc(100vw - 24px)}
.gs-toast button{font:700 14px var(--hud);border-radius:9px;padding:8px 12px;cursor:pointer;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#e8ecf6;min-height:44px}
.gs-toast button.primary{background:linear-gradient(90deg,#4a9eff,#a855f7);border-color:transparent;color:#fff}
.gs-veil{inset:0;z-index:60;background:rgba(4,6,12,.66);display:grid;place-items:center;padding:16px;pointer-events:auto}
.gs-sheet{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;padding:22px 22px 18px;font-family:var(--sans)}
.gs-who{display:flex;align-items:center;gap:14px;margin:0 0 14px}
.gs-who .face{flex:none;width:68px;height:68px;border-radius:50%;display:grid;place-items:center;font-size:36px;background:radial-gradient(circle at 35% 30%,rgba(255,255,255,.35),transparent 55%),var(--c,#4a9eff);box-shadow:0 0 0 2px rgba(255,255,255,.2),0 0 22px var(--c,#4a9eff)}
.gs-who .who{min-width:0}.gs-who b{display:block;font:700 17px var(--display);letter-spacing:.04em;color:#fff;overflow-wrap:anywhere}.gs-who small{color:#a5acc2;font:13px var(--sans)}
.gs-sheet p.says{color:#dfe6ff;font:italic 15px/1.5 var(--sans)}
.gs-sheet h3{margin:0 0 6px;font:700 20px var(--display);letter-spacing:.04em;color:#fff}
.gs-sheet p{margin:0 0 14px;color:#a5acc2;font:14px/1.45 var(--sans)}
.gs-sheet .google{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;box-sizing:border-box;background:#fff;color:#1f2937;border-radius:10px;padding:11px;font:600 15px var(--sans);text-decoration:none;min-height:44px}
.gs-sheet .or{display:flex;align-items:center;gap:10px;color:#a5acc2;font:12px var(--sans);margin:14px 0}
.gs-sheet .or::before,.gs-sheet .or::after{content:'';flex:1;height:1px;background:rgba(255,255,255,.14)}
.gs-sheet label{display:block;font:600 12.5px var(--sans);color:#c7cbe0;margin:0 0 4px}
.gs-sheet input{width:100%;box-sizing:border-box;font:15px var(--sans);color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);border-radius:9px;padding:10px 11px;margin-bottom:10px;-webkit-user-select:text;user-select:text}
.gs-sheet input:focus{border-color:#7cc4ff}.gs-sheet :is(input,button,a):focus-visible,.gs-acts button:focus-visible,.gs-toast button:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 5px #0b66d6}
.gs-sheet .go{width:100%;font:700 15px var(--sans);color:#fff;background:linear-gradient(90deg,#4a9eff,#a855f7);border:0;border-radius:10px;padding:12px;cursor:pointer;min-height:46px}
.gs-sheet .go:disabled{opacity:.6}
.gs-sheet .err{color:#fca5a5;font:13px var(--sans);margin:0 0 10px}
.gs-sheet .err a{color:#93c5fd}
.gs-sheet .note{color:#bfe3ff;font:13px/1.45 var(--sans);margin:0 0 10px;padding:8px 10px;border-radius:8px;background:rgba(74,158,255,.12);border:1px solid rgba(74,158,255,.35)}
.gs-sheet a.back{display:block;text-align:center;text-decoration:none}
.gs-sheet input.bad{border-color:#f87171}
.gs-sheet .fld{color:#fca5a5;font:12.5px var(--sans);margin:-6px 0 10px}
.gs-sheet .pw{position:relative}
.gs-sheet .pw input{padding-right:70px;min-height:44px}.gs-sheet input{min-height:44px}
.gs-sheet .pw button{position:absolute;right:0;top:0;height:44px;min-width:62px;background:none;border:0;color:#93c5fd;font:600 13px var(--sans);cursor:pointer;border-radius:8px}
.gs-sheet .go{display:flex;align-items:center;justify-content:center;gap:9px}
.gs-sheet .spin{width:16px;height:16px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:gsspin .7s linear infinite}
@keyframes gsspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.gs-sheet .spin{animation-duration:2s}}
.gs-sheet [hidden]{display:none !important}
.gs-sheet .fine{font:12px var(--sans);color:#8088a3;margin:10px 0 0}
.gs-sheet .fine a,.gs-sheet .swap a{color:#93c5fd}
.gs-sheet .swap{font:13px var(--sans);color:#a5acc2;margin:12px 0 0;text-align:center}
.gs-sheet .back{display:block;margin:12px auto 0;background:none;border:0;color:#a5acc2;font:600 14px var(--sans);cursor:pointer;padding:8px;min-height:44px}.gs-sheet .swap a,.gs-sheet .fine a{display:inline-block;padding:11px 4px}
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

  // What the signed-in part needs from the running island (startUi sets it).
  const session = { H: null, base: null, edits: null, acts: null, friend: null, invited: false };
  function startUi(H, base, t0) {
    style();
    const touch = isTouch();
    const done = new Set();
    let first = false;
    const edits = [];
    Object.assign(session, { H, base, edits });
    track('sandbox_start', { touch, ms: Math.round(performance.now()), loadMs: Math.round(performance.now() - t0) });

    function tick(id) {
      if (done.has(id) || !TRIES.includes(id)) return;
      done.add(id);
      if (['drive', 'fish', 'boom', 'fly'].includes(id)) first1(id);
      track('sandbox_try', { what: id, n: done.size, s: Math.round((performance.now() - t0) / 1000) });
      if (done.size === 2 && !touring()) nudge(4000);
    }
    // (While Pip's tour runs, the nudge waits for its end.)
    const touring = () => { try { return H.game.events.quests.state('tour') === 'active'; } catch { return false; } };

    // The buttons that open the account side.
    const acts = el(`<button type="button" class="primary" data-intent="save">Save this world</button><button type="button" class="opt" data-intent="build">Build your own</button><button type="button" class="opt" data-intent="assistant">Ask the Overseer</button><button type="button" class="opt" data-intent="invite">Invite a friend</button><button type="button" class="opt" data-look title="Change how you look (L)">Change my look</button><button type="button" class="more" data-more aria-label="More">⋯</button>`, 'gs-acts');
    acts.querySelectorAll('[data-intent]').forEach((b) => { b.onclick = () => { acts.classList.remove('open'); want(b.dataset.intent, 'button'); }; });
    acts.querySelector('[data-more]').onclick = () => acts.classList.toggle('open');
    session.acts = acts;

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
    on('intro', (d) => {
      if (!d) return;
      if (d.state === 'start') track('sandbox_intro_start', {});
      if (d.state === 'end') { track('sandbox_intro', { skipped: Boolean(d.skipped) }); track(d.skipped ? 'sandbox_intro_skip' : 'sandbox_intro_end', {}); }
    });
    // The first time they drive, fish, blow something up, ask the Overseer or fly (a try, once each).
    const firsts = new Set();
    const first1 = (what) => { if (firsts.has(what)) return; firsts.add(what); track('sandbox_first_' + what, {}); };
    on('asked', () => first1('ask'));
    // The mirror: each question answered (the next one is reached, or the last is done) or skipped.
    let mirrorStep = null;
    const mirrorAnswered = new Set();
    const answered = () => { if (mirrorStep && !mirrorAnswered.has(mirrorStep)) { mirrorAnswered.add(mirrorStep); track('sandbox_mirror_answer', { step: mirrorStep }); } };
    on('mirror', (d) => {
      if (!d) return;
      if (d.state === 'open') track('sandbox_mirror_open', { auto: Boolean(d.auto) });
      else if (d.state === 'step') { if (d.step !== mirrorStep) answered(); mirrorStep = d.step || null; }
      else if (d.state === 'done') { answered(); mirrorStep = null; }
      else if (d.state === 'skip') { if (mirrorStep) track('sandbox_mirror_skip', { step: mirrorStep }); mirrorStep = null; }
    });
    on('explosion', () => tick('boom'));
    on('cast', () => tick('fish'));
    on('catch', () => tick('fish'));
    on('spawned', () => tick('spawn'));
    on('sandbox-high', () => tick('fly'));
    // The tour's steps (Pip's quest line), each once, and its end: the moment to offer keeping the island.
    // (sandbox_tour_step: the step they have reached, in the tour's order; a finished step reaches the next.)
    // (Chapter One: `hill` (quest 6) and `launch` (quest 8) are new; `n` stays what it was for the older steps, so the funnel keeps its meaning.)
    const STEPS = ['drive', 'fish', 'boom', 'spawn', 'ask', 'hill', 'fly', 'launch'];
    const STEP_N = { drive: 1, fish: 2, boom: 3, spawn: 4, ask: 5, fly: 6, hill: 7, launch: 8 };
    const reached = new Set();
    const reach = (step) => { if (reached.has(step)) return; reached.add(step); track('sandbox_tour_step', { step, n: STEP_N[step] }); };
    // A stable event per new quest, once each: when the quest is done.
    const questDone = new Set();
    // (A resumed tour fast-forwards the steps already done: sandbox.js lists them in HawkesGuest.skipped; they are not counted again.)
    const skipped = (step) => Boolean(window.HawkesGuest.skipped && window.HawkesGuest.skipped.has(step));
    on('tour', (d) => { if (d && (d.step === 'hill' || d.step === 'launch') && !skipped(d.step) && !questDone.has(d.step)) { questDone.add(d.step); track('sandbox_quest_' + d.step, { s: Math.round((performance.now() - t0) / 1000), touch }); } });
    on('bay-lit', () => track('sandbox_bay_lit', {}));
    on('tour', (d) => {
      if (!d || !d.step || skipped(d.step)) return;
      { const i = STEPS.indexOf(d.step); if (i >= 0) ret.patch({ tour: STEPS[i + 1] || 'done' }); }
      track('sandbox_objective', { step: d.step, s: Math.round((performance.now() - t0) / 1000), touch });
      const i = STEPS.indexOf(d.step);
      if (i >= 0 && i + 1 < STEPS.length) reach(STEPS[i + 1]);
    });
    on('quest', (d) => {
      if (!d || d.id !== 'tour') return;
      if (d.state === 'start' && !(ret.get() || {}).tour) ret.patch({ tour: STEPS[0] });
      if (d.state === 'start' && window.HawkesGuest.resumed) return; // (picking the tour up, not starting it)
      if (d.state === 'start') { track('sandbox_objective', { step: 'start', s: Math.round((performance.now() - t0) / 1000), touch }); track('sandbox_tour_start', {}); reach(STEPS[0]); }
      if (d.state === 'done' && skipped('launch')) return; // (finished on an earlier visit)
      if (d.state === 'done') {
        track('sandbox_tour_done', {});
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
    let gated = Boolean(session.friend && session.friend.user); // (a signed-in friend has no sheet)
    // Changing how you look is always one press away (L, or the button): the mirror's questions, anywhere.
    const look = () => { try { if (H.mirror && H.mirror.dress && !H.mirror.isOpen) { track('sandbox_look_open', { returning: Boolean(session.returning) }); H.mirror.dress(); } } catch { /* fine */ } };
    acts.querySelector('[data-look]').onclick = () => { acts.classList.remove('open'); look(); };
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'l' && e.key !== 'L') return;
      if (e.ctrlKey || e.metaKey || e.altKey || document.body.dataset.gsSheet || inUi(e)) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      look();
    });
    // ------------------------------------------------------------------ invitations: the inviter's link, the friend's arrival
    const say = (text, priority) => { if (H.chat) H.chat.line({ kind: 'overseer', keep: 30, text, priority }); };
    const myName = () => lookName(H) || (ret.get() || {}).name || '';
    let invited = null; // { link, room } once this player has an invitation out
    async function invite(from) {
      track('sandbox_invite', { from, touch });
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ }
      if (!invited) {
        let r;
        try { r = await api('POST', '/v1/island-invite', { name: myName() }); }
        catch (err) { flash(err.message || 'Could not make a link. Try again.'); return; }
        invited = { link: r.link, room: r.room };
        session.invited = true;
        // Our room: the friend comes to us here. (A signed-in player's editor room is left for it; their island is saved as ever.)
        if (window.HawkesNet) window.HawkesNet.connect({ token: null, play: 't/sandbox', room: r.room, name: myName() || 'Host', join: false });
        H.game.net.on('join', (d) => {
          track('sandbox_invite_arrived', {});
          // Both at once, important: the speech desk says them one after the other, ahead of the tour's and Pip's lines (a
          // normal line queued behind a chatty island went stale or was dropped, and the second one never showed).
          say('Someone is coming.', 'important');
          say(`${d && d.name ? d.name : 'A friend'} is here.`, 'important');
        });
      }
      shareLink(invited.link);
    }
    function flash(text) {
      const t = toast(text);
      setTimeout(() => t.remove(), 4500);
    }
    /** Phones: the native share sheet. Elsewhere (or when it is not there): the link is copied, and shown to copy again. */
    async function shareLink(url) {
      const text = 'Come and play on my island.';
      if (touch && navigator.share) {
        try { await navigator.share({ title: 'Hawkes Gen island', text, url }); track('sandbox_invite_shared', { how: 'sheet' }); return; }
        catch (err) { if (err && err.name === 'AbortError') return; /* otherwise fall through to the copy */ }
      }
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch { /* shown below */ }
      track('sandbox_invite_shared', { how: copied ? 'copy' : 'shown' });
      const t = el(`<span>${copied ? 'Link copied.' : 'Copy this link:'}</span><input type="text" readonly aria-label="Invitation link" value="${esc(url)}" style="min-width:0;flex:1;font:13px var(--sans);color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:8px"><button type="button" class="primary">Copy</button><button type="button" data-x aria-label="Close">✕</button>`, 'gs-glass gs-toast');
      t.dataset.invite = 'link';
      const input = t.querySelector('input');
      input.onfocus = () => input.select();
      t.querySelector('.primary').onclick = async () => { try { await navigator.clipboard.writeText(url); } catch { input.select(); document.execCommand && document.execCommand('copy'); } t.firstChild.textContent = 'Link copied.'; };
      t.querySelector('[data-x]').onclick = () => t.remove();
      setTimeout(() => t.remove(), 60000);
    }
    // The pause menu: Esc twice (like the Observatory's way back); the friend's invitation is in it.
    let escAt = 0;
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.repeat || document.body.dataset.gsSheet) return;
      const now = Date.now();
      if (now - escAt > 700) { escAt = now; return; }
      escAt = 0;
      try { H.game.ui.menu('pause', { title: 'Paused', items: [{ label: 'Resume' }, { label: 'Invite a friend', onClick: () => invite('pause') }, { label: 'Change my look', onClick: look }] }); } catch { /* no menus in this build */ }
    }, true);

    // A friend who opened an invitation: at the mirror's end (or, for a return, once beamed in) they join the inviter's room.
    const inv = session.friend;
    if (inv) {
      let joined = false;
      const join = () => {
        if (joined) return;
        joined = true;
        track('sandbox_invite_join', {});
        let placed = false;
        const place = () => {
          if (placed) return true;
          const peers = window.HawkesNet && window.HawkesNet.peers && window.HawkesNet.peers();
          const host = peers && window.HawkesNet.host ? peers.get(window.HawkesNet.host) : null;
          const pos = host && host.state && host.state.p;
          const player = H.world && H.world.player;
          if (!pos || !player) return false;
          placed = true;
          player.position = [pos[0] + 1.6, pos[1] + 0.4, pos[2] + 1.0];
          player.velocity = [0, 0, 0];
          try { H.overseer.beam(player, { radius: 1.3, seconds: 2.4 }); } catch { /* fine */ }
          track('sandbox_invite_beamed', {});
          setTimeout(() => say(inv.name ? `${inv.name} is here. Go to them.` : 'Someone is here. Go to them.'), 1800);
          return true;
        };
        H.hooks.world.push({ net: (st) => {
          if (st === 'refused') { track('sandbox_invite_refused', {}); gone({ state: 'closed', message: 'That island closed before you could arrive. Ask for a new link, or start an island of your own.' }); }
          if (st === 'online') { let n = 0; const t = setInterval(() => { if (place() || ++n > 40) clearInterval(t); }, 250); }
        } });
        window.HawkesNet.connect({ token: null, play: 't/sandbox', room: inv.room, name: myName() || 'Friend', join: true });
      };
      on('mirror', (d) => { if (d && (d.state === 'done' || d.state === 'skip')) setTimeout(join, 800); });
      if (session.returning) setTimeout(join, 3500);
    }

    // A return (the beginning was seen and the mirror done here before): the Overseer welcomes them back by name. A guest
    // still without an account gets the sheet next (the order is J's: intro, mirror, account, tour); a signed-in player's
    // welcome is goLive's, and the tour picks up on its own.
    if (session.returning) {
      const rec = session.returning;
      track('sandbox_return', { signedIn: Boolean(rec.signedIn), tour: rec.tour || null });
      const name = lookName(H) || rec.name || '';
      if (!rec.signedIn && !gated) {
        setTimeout(() => { if (H.chat) H.chat.line({ kind: 'overseer', keep: 30, text: name ? `Welcome back, ${name}. The mirror is there if you want a new look: press L.` : 'Welcome back. The mirror is there if you want a new look: press L.' }); }, 2600);
        gated = true;
        setTimeout(() => want('tour', 'return'), 6500);
      }
    }
    // The mirror's questions answered (or skipped): now the account (once; the sheet can't be put away).
    on('mirror', (d) => {
      if (gated || !d || (d.state !== 'done' && d.state !== 'skip')) return;
      gated = true;
      ret.patch({ name: lookName(H) || null });
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
      if (intent === 'invite') return invite(from); // (no account: the friend does not need one, and neither does the inviter)
      // Kept already (signed in): Save saves now, Build and Invite open the editor, Ask opens the chat.
      if (island) {
        if (intent === 'save') return saveNow(false).then(flashSaved);
        if (intent === 'build' || intent === 'invite') return toEditor();
        if (intent === 'assistant') return void (H.chat && H.chat.open());
        return;
      }
      try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ }
      let snap = null;
      try { snap = Core.snapshot(H, { edits }); } catch (err) { console.warn('sandbox snapshot', err); }
      let look = null;
      try { look = H.presence && H.presence.look ? JSON.parse(JSON.stringify(H.presence.look)) : null; } catch { look = null; }
      store.set({ v: 1, at: Date.now(), intent, scene: snap || base, base, look });
      const user = await me();
      if (user) return signedIn(intent, user);
      openSheet(intent, { forced: intent === 'tour', name: lookName(H) });
    }
  }

  // ------------------------------------------------------------------ sign up (the landing page's account: email or Google)
  const WHY = {
    save: ['Save this world', 'Sign in (or make a free account) and this island, as you left it, becomes your game. Then change anything in it.'],
    build: ['Build your own', 'Sign in (or make a free account) and you are in the editor with this island: move things, add things, make it a game.'],
    assistant: ['Ask the Overseer', 'Describe anything ("a volcano", "a race around the island") and the Overseer builds it. It needs an account; your island comes with you.'],
    invite: ['Invite a friend', 'Playing and building together needs an account. Your island becomes your game, and you get a link to send.'],
    share: ['Share this moment', 'Sign in (or make a free account) and the moment you just had becomes a link to send. It is kept in your own library, and this island comes with you.'],
    tour: ['Keep this island', 'An account is free. It keeps this island as your game, with your look and your name, so it is here when you come back. With an account you can ask the Overseer to make things for you: that uses credits, and new accounts start with some free ones.'],
  };
  /** The name they gave at the mirror (or none). */
  function lookName(H) { try { const n = H && H.presence && H.presence.look && H.presence.look.name; return n ? String(n).slice(0, 40) : ''; } catch { return ''; } }
  /** Nothing behind the sheet reacts while it is open: the player's controls off (back as they were on close), keys
   *  that don't come from the sheet never reach the engine, held keys let go, and every sound but the music is held. */
  function lockGame(sheet) {
    const H = session.H;
    const p = (() => { try { return H && H.world && H.world.player; } catch { return null; } })();
    const was = p ? p.controls : null;
    if (p) p.controls = false;
    try { window.dispatchEvent(new Event('blur')); } catch { /* fine */ } // (the engine forgets the keys held)
    try { H && H.audio && H.audio.hold && H.audio.hold('guest-sheet', true); } catch { /* fine */ }
    const stop = (e) => {
      if (sheet.contains(e.target)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    const types = ['keydown', 'keyup', 'keypress', 'wheel', 'contextmenu'];
    for (const t of types) window.addEventListener(t, stop, true);
    document.body.dataset.gsSheet = '1';
    return () => {
      for (const t of types) window.removeEventListener(t, stop, true);
      delete document.body.dataset.gsSheet;
      try { H && H.audio && H.audio.hold && H.audio.hold('guest-sheet', false); } catch { /* fine */ }
      if (p && was !== null && H.world.player === p) p.controls = was;
    };
  }
  function openSheet(intent, o = {}) {
    const [title, whyText] = WHY[intent] || WHY.save;
    const why = whyText;
    const forced = Boolean(o.forced);
    const who = Core.character(session.H);
    track('signup_open', { from: 'sandbox', intent, forced });
    track('sandbox_sheet_shown', { intent, forced });
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch { /* fine */ }
    // Sign-in first (J, 2026-10-24): Google signs in and signs up the same way; "Create an account" is one tap away.
    let mode = 'login';
    const veil = el(`<div class="gs-glass gs-sheet" role="dialog" aria-modal="true" aria-labelledby="gsTitle">
      <div class="gs-who" id="gsWho"><div class="face" style="--c:${esc(who.color)}" aria-hidden="true">${esc(who.icon)}</div><div class="who"><b>${esc(who.name || who.label)}</b><small>${esc(who.name ? who.label : 'This is you.')}</small></div></div>
      ${forced ? `<p class="says" id="gsSays">“${esc(Core.sheetLine(who.name))}”</p>` : ''}
      <h3 id="gsTitle">${esc(title)}</h3><p>${esc(why)}</p>
      <a class="google" id="gsGoogle" hidden href="/auth/google?next=${encodeURIComponent('/play/sandbox?claim=' + intent)}"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Continue with Google</span></a>
      <div class="or" id="gsOr" hidden>or with email</div>
      <form id="gsForm" novalidate>
        <label for="gsEmail">Email</label><input id="gsEmail" type="email" autocomplete="email" inputmode="email" autocapitalize="off" spellcheck="false" required aria-describedby="gsEmailErr">
        <p class="fld" id="gsEmailErr" hidden></p>
        <label for="gsPw">Password <span id="gsPwHint">(8 characters or more)</span></label>
        <div class="pw"><input id="gsPw" type="password" minlength="8" autocomplete="new-password" required aria-describedby="gsPwErr"><button type="button" id="gsShow" aria-pressed="false" aria-label="Show password">Show</button></div>
        <p class="fld" id="gsPwErr" hidden></p>
        <p class="err" id="gsErr" role="alert" hidden></p>
        <p class="note" id="gsNote" hidden></p>
        <button class="go" type="submit" id="gsGo"><span class="spin" aria-hidden="true" hidden></span><span id="gsGoText">Create account and save</span></button>
        <button type="button" class="back" id="gsRetry" hidden>Try again</button>
        <p class="swap" id="gsForgotRow" hidden><a href="#" id="gsForgot">Forgot your password?</a></p>
        <p class="fine" id="gsTerms">By creating an account you agree to the <a href="/legal#terms" target="_blank">terms</a> and <a href="/legal#privacy" target="_blank">privacy policy</a>.</p>
      </form>
      <p class="swap" id="gsSwap"></p>
      ${forced ? '<a class="back" href="/" data-leave>Leave the island</a>' : '<button type="button" class="back" data-back>Keep playing</button>'}
    </div>`, 'gs-veil');
    const $ = (id) => veil.querySelector('#' + id);
    const setMode = (m) => {
      mode = m;
      $('gsPwHint').hidden = m !== 'signup';
      $('gsTerms').hidden = m !== 'signup';
      $('gsPw').autocomplete = m === 'signup' ? 'new-password' : 'current-password';
      $('gsGoText').textContent = intent === 'tour' ? (m === 'signup' ? 'Create my account' : 'Sign in') : m === 'signup' ? 'Create account and save' : 'Sign in and save';
      $('gsForgotRow').hidden = m !== 'login';
      $('gsSwap').innerHTML = m === 'signup' ? 'Have an account? <a href="#" data-swap>Sign in</a>' : 'New here? <a href="#" data-swap>Create an account</a>';
      $('gsSwap').querySelector('[data-swap]').onclick = (e) => { e.preventDefault(); setMode(m === 'signup' ? 'login' : 'signup'); };
      $('gsErr').hidden = true;
      $('gsNote').hidden = true;
      $('gsRetry').hidden = true;
      $('gsPwErr').hidden = true;
      if (m === 'login') $('gsPw').classList.remove('bad');
    };
    setMode('login');
    // Inline checks before submit (the server checks again): a bad email on leaving the field, a short password as it's
    // typed when making an account. Each says what to do.
    const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const emailMsg = (v, final) => !v ? (final ? 'Type your email.' : '') : EMAIL_OK.test(v) ? '' : 'That email looks incomplete. Check it, like name@example.com.';
    const pwMsg = (v, final) => !v ? (final ? 'Type a password.' : '') : mode === 'signup' && v.length < 8 ? `${8 - v.length} more character${8 - v.length === 1 ? '' : 's'} to go: 8 or more.` : '';
    const showField = (inp, out, text) => { out.textContent = text; out.hidden = !text; inp.classList.toggle('bad', Boolean(text)); inp.setAttribute('aria-invalid', text ? 'true' : 'false'); };
    const checkEmail = (final) => { const m = emailMsg($('gsEmail').value.trim(), final); showField($('gsEmail'), $('gsEmailErr'), m); return !m; };
    const checkPw = (final) => { const m = pwMsg($('gsPw').value, final); showField($('gsPw'), $('gsPwErr'), m); return !m; };
    $('gsEmail').addEventListener('blur', () => { if ($('gsEmail').value) checkEmail(false); });
    $('gsEmail').addEventListener('input', () => { if (!$('gsEmailErr').hidden) checkEmail(false); });
    $('gsPw').addEventListener('input', () => { if (mode === 'signup' || !$('gsPwErr').hidden) checkPw(false); });
    $('gsShow').onclick = () => {
      const on = $('gsPw').type === 'password';
      $('gsPw').type = on ? 'text' : 'password';
      $('gsShow').textContent = on ? 'Hide' : 'Show';
      $('gsShow').setAttribute('aria-pressed', String(on));
      $('gsShow').setAttribute('aria-label', on ? 'Hide password' : 'Show password');
      $('gsPw').focus();
    };
    // Which field they reach for (once each; never what they type).
    const focused = new Set();
    veil.addEventListener('focusin', (e) => {
      const f = { gsName: 'name', gsEmail: 'email', gsPw: 'password' }[e.target && e.target.id];
      if (f && !focused.has(f)) { focused.add(f); track('sandbox_sheet_focus', { field: f, intent }); }
    });
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
    // Google in a popup: the island keeps running behind it (blocked popups: the link takes the page, and the island
    // comes back from its snapshot through /play/sandbox?claim=).
    $('gsGoogle').addEventListener('click', (e) => {
      track('sandbox_signup_google', { intent });
      let w = null;
      try { w = window.open('/auth/google?next=' + encodeURIComponent('/auth/popup'), 'hg-google', 'popup,width=500,height=660'); } catch { w = null; }
      track('sandbox_google_popup', { intent, opened: Boolean(w) });
      if (!w) return;
      e.preventDefault();
      note('Finish signing in with Google in the window that opened.');
      const onMsg = async (ev) => {
        if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'hg-auth') return;
        removeEventListener('message', onMsg);
        if (!ev.data.ok) { track('sandbox_signup_failed', { mode: 'google', reason: 'cancelled', intent }); note('Google sign-in was cancelled. Try again, or use your email.'); return; }
        const u = await me();
        if (!u) { track('sandbox_signup_failed', { mode: 'google', reason: 'no_session', intent }); fail("Google didn't sign you in. Try again, or use your email."); return; }
        track('sandbox_login', { intent, method: 'google' });
        track('sandbox_signup_ok', { mode: 'google', method: 'google', intent });
        close();
        await signedIn(intent, u);
      };
      addEventListener('message', onMsg);
    });
    const unlock = lockGame(veil);
    const opener = document.activeElement;
    const close = () => { unlock(); veil.remove(); try { opener && opener.focus && opener.isConnected && opener.focus(); } catch { /* fine */ } };
    // Keyboard: focus goes into the sheet and Tab turns round inside it (the page behind is frozen), so even the forced
    // sheet always has a next control, including "leave"; Escape closes it only when it is not forced.
    veil.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = [...veil.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && !x.closest('[hidden]') && x.getClientRects().length);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!veil.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    setTimeout(() => { const t = $('gsEmail'); if (t && !veil.contains(document.activeElement)) t.focus({ preventScroll: true }); }, 0);
    // (Forced: it can't be put away: the way out is leaving the island.)
    const dismiss = () => { close(); if (o.onCancel) o.onCancel(); };
    if (!forced) veil.querySelector('[data-back]').onclick = dismiss;
    else veil.querySelector('[data-leave]').onclick = () => track('sandbox_gate_leave', {});
    veil.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (!forced && e.target === veil) dismiss(); });
    veil.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !forced) dismiss(); });
    $('gsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const go = $('gsGo');
      const err = $('gsErr');
      err.hidden = true;
      $('gsNote').hidden = true;
      const body = { email: $('gsEmail').value.trim(), password: $('gsPw').value };
      $('gsRetry').hidden = true;
      track('sandbox_signup_submit', { mode, intent });
      const okE = checkEmail(true);
      const okP = checkPw(true);
      if (!okE || !okP) {
        track('sandbox_signup_failed', { mode, reason: !body.email || !body.password ? 'missing_fields' : !okP ? 'short_password' : 'invalid', intent });
        $(okE ? 'gsPw' : 'gsEmail').focus();
        return;
      }
      // The character's name is already known: it is the account's name (no field to fill in).
      if (mode === 'signup' && o.name) body.name = String(o.name).slice(0, 120);
      go.disabled = true;
      go.classList.add('busy');
      go.querySelector('.spin').hidden = false;
      veil.setAttribute('aria-busy', 'true');
      const idle = () => { go.disabled = false; go.classList.remove('busy'); go.querySelector('.spin').hidden = true; veil.removeAttribute('aria-busy'); };
      try {
        const d = await api('POST', mode === 'signup' ? '/v1/users/signup' : '/v1/users/login', body);
        if (d.apiKey) try { localStorage.setItem('hg_last_minted_key', d.apiKey); } catch { /* fine */ }
        track(mode === 'signup' ? 'sandbox_signup' : 'sandbox_login', { intent, method: 'email' });
        track('sandbox_signup_ok', { mode, method: 'email', intent });
        close();
        await signedIn(intent, d.user);
      } catch (x) {
        idle();
        // Why, as a code: never the email, the password or the server's wording (which can repeat them).
        const st = Number(x && x.status) || 0;
        track('sandbox_signup_failed', { mode, intent, status: st || null, reason: x && x.wall ? 'studio_wall' : st === 409 ? 'exists' : st === 401 ? 'bad_credentials' : st === 429 ? 'rate_limited' : st === 400 || st === 422 ? 'invalid' : st >= 500 ? 'server' : st >= 400 ? 'rejected' : 'network' });
        if (x.wall) return studioWall(x.wall);
        // That email already has an account: it's theirs to sign in to (with its password, or Google if made that way).
        if (mode === 'signup' && x.status === 409) {
          track('sandbox_signup_exists', { intent });
          setMode('login');
          $('gsPw').value = '';
          note(`There's already an account for ${body.email}. Type its password to sign in${$('gsGoogle').hidden ? '' : ', or use Google if you made it that way'}.`);
          $('gsPw').focus();
          return;
        }
        if (mode === 'login' && x.status === 401) { fail("That email and password don't match an account. Try again, set a new password, or create an account if you're new."); $('gsForgotRow').hidden = false; return; }
        // No connection: the form is kept as it is and one press tries again.
        if (!st) { fail("Couldn't reach Hawkes Gen. Check your connection, then try again. Nothing was lost."); $('gsRetry').hidden = false; $('gsRetry').focus(); return; }
        if (st === 429) { fail(mode === 'signup' ? 'Too many sign-ups from this connection just now. Try again in a while, or sign in if you already have an account.' : 'Too many tries. Wait a few minutes, then sign in again.'); return; }
        if (st >= 500) { fail('Something went wrong on our side. Try again in a moment.'); $('gsRetry').hidden = false; return; }
        fail(x.message);
      }
    });
    $('gsRetry').onclick = () => $('gsForm').requestSubmit();
    // The beta site (Studio's login in front of it, which a window not signed in to Studio meets): sign in to Studio in a
    // popup, then the same form goes again by itself. The island keeps running behind it.
    function studioWall(signin) {
      track('sandbox_studio_wall', { intent });
      fail('');
      $('gsErr').innerHTML = 'This is the beta site: it needs a Studio sign-in first. <a href="#" data-studio>Sign in to Studio</a>, then your account is made here.';
      $('gsErr').querySelector('[data-studio]').onclick = (e) => {
        e.preventDefault();
        let w = null;
        const back = `${location.origin}/auth/popup?studio=1`;
        try { w = window.open(`${signin}?next=${encodeURIComponent(back)}`, 'hg-studio', 'popup,width=520,height=680'); } catch { w = null; }
        if (!w) { note('Your browser blocked the window. Sign in to Studio in another tab, then press the button again.'); return; }
        note('Sign in to Studio in the window that opened.');
        const onMsg = (ev) => {
          if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'hg-auth') return;
          removeEventListener('message', onMsg);
          if (!ev.data.ok) { note('Studio sign-in was cancelled.'); return; }
          $('gsForm').requestSubmit();
        };
        addEventListener('message', onMsg);
      };
    }
    setTimeout(() => $('gsEmail').focus(), 50);
  }


  // ------------------------------------------------------------------ signed in, without leaving: the island is kept here
  // (J, 2026-10-24: "I wanted sign in and registration to be seamless".) Signing in closes the sheet and the same world
  // plays on: it becomes their game in the background (POST /v1/games + the changes so far as ops), joins that game's
  // room (the Overseer's world changes arrive like any builder's, live) and its feed (the Overseer's answers, what it
  // makes, new assets), the chat talks to the Overseer (H.chat, modules/overseer/chat.js), Pip's tour goes on, and what
  // they do is saved every 20 s and on leaving. Building (the editor) is a page of its own, when they choose it.
  const RET = 'hg_sandbox_return';
  const ret = {
    get() { try { const v = JSON.parse(localStorage.getItem(RET) || 'null'); return v && v.v === 1 ? v : null; } catch { return null; } },
    patch(p) { try { localStorage.setItem(RET, JSON.stringify({ ...(ret.get() || { v: 1 }), ...p, v: 1, at: Date.now() })); } catch { /* fine */ } },
    /** A return: they went through the beginning here before (the intro's flag is still there and the mirror was done). */
    is() { try { return Boolean(localStorage.getItem('hg_overseer_intro') && ret.get()); } catch { return false; } },
  };
  // "Share this moment" (modules/share/moments.js) asks for the account here: signed in already, it gets the user at once;
  // otherwise the sheet opens (the moment is held in the page, and nothing reloads) and it gets the user after sign-in, or
  // null when the sheet is put away.
  const shareWaiters = [];
  const flushShare = (user) => { while (shareWaiters.length) shareWaiters.shift()(user || null); };
  const KEPT = 'hg_sandbox_island';
  const kept = {
    get() { try { return JSON.parse(localStorage.getItem(KEPT) || 'null'); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEPT, JSON.stringify(v)); } catch { /* fine */ } },
    clear() { try { localStorage.removeItem(KEPT); } catch { /* fine */ } },
  };
  let island = null; // { id, base, user }
  /** After signing in: Build and Invite open the editor (a page of their own); the rest stays on the island. */
  function signedIn(intent, user) {
    if (intent === 'share') return island ? afterKeep(intent) : keep(intent, user); // (the moment waits for this: afterKeep hands it on)
    if (intent === 'build' || intent === 'invite') return island ? toEditor() : claim(intent, user);
    return keep(intent, user);
  }
  async function keep(intent, user) {
    const H = session.H;
    if (!H || !H.world) return claim(intent, user);
    if (island) return afterKeep(intent);
    const busy = toast('Keeping your island…');
    try {
      const snap = Core.snapshot(H, { edits: session.edits });
      const name = lookName(H);
      let look = null;
      try { look = H.presence && H.presence.look ? JSON.parse(JSON.stringify(H.presence.look)) : null; } catch { look = null; }
      let game;
      try { game = await api('POST', '/v1/games', { title: name ? `${name}'s island` : 'My island', template: 'sandbox' }); }
      catch (x) { busy.remove(); if (x.status === 402) return gamesFull(el('', 'gs-veil'), x.message, intent); throw x; }
      // The look they made at the mirror is theirs now (it replaces what the account had: they just chose it).
      if (look) await api('POST', '/v1/users/me/avatar', { avatar: look }).catch((e) => console.warn('sandbox: look not saved', e));
      // What the Overseer remembered of them on this device goes into the account (the newer record wins).
      try { if (H.memory) await H.memory.sync(); } catch { /* fine */ }
      const ops = Core.toOps(session.base || { config: {}, entities: {} }, snap);
      for (const part of Core.chunks(ops, 200)) await api('POST', `/v1/games/${game.id}/scene`, { ops: part });
      // Their island: no Overseer's beginning or mirror again (they've seen them; the mirror is still there to use).
      await api('POST', `/v1/games/${game.id}/scene`, { ops: [{ op: 'config', patch: { overseer: { intro: false } } }, { op: 'update', id: 'mirror', patch: { shape: { character: { start: false } } } }] }).catch(() => {});
      island = { id: game.id, base: snap, user: user.id };
      store.clear();
      kept.set({ id: game.id, user: user.id });
      track('sandbox_claimed', { intent, changes: ops.length, user: 'yes', seamless: true });
      busy.remove();
      await goLive(user, true);
      afterKeep(intent);
    } catch (x) {
      busy.remove();
      const forced = intent === 'tour';
      const sheet = el(`<div class="gs-glass gs-sheet"><h3>Your island wasn't kept yet</h3><p>${esc(x.message)}</p><button type="button" class="go" data-retry>Try again</button>${forced ? '<a class="back" href="/app">Go to my games</a>' : '<button type="button" class="back" data-back>Keep playing</button>'}</div>`, 'gs-veil');
      sheet.querySelector('[data-retry]').onclick = () => { sheet.remove(); keep(intent, user); };
      const back = sheet.querySelector('[data-back]');
      if (back) back.onclick = () => sheet.remove();
    }
  }
  function afterKeep(intent) {
    if (intent === 'share') me().then(flushShare);
    if (intent === 'assistant' && session.H && session.H.chat) session.H.chat.open();
  }
  /** The island's game, live on this page: its room, its feed, the Overseer in the chat, saving, the buttons. */
  async function goLive(user, fresh) {
    const H = session.H;
    const id = island.id;
    window.HawkesGuest.accountFirst = false; // (Pip's tour, here)
    try {
      const b = await api('GET', `/v1/games/${id}/bundle`);
      // Our room connection: saves carry it so the server doesn't send our own changes back to us (applied again, they
      // rebuilt what they touched: you were thrown out of the car and the camera reset on every save).
      if (!session.hooked && H.hooks && H.hooks.world) { session.hooked = true; H.hooks.world.push({ net: (st, info) => { if (info && info.me) session.conn = info.me; } }); }
      if (b.net && b.net.token && window.HawkesNet && !session.friend && !session.invited) window.HawkesNet.connect({ token: b.net.token });
    } catch (x) { console.warn('sandbox: no live room', x); }
    feed(id, user);
    if (H.chat) H.chat.attach({ send: (t) => ask(id, t), placeholder: isTouch() ? 'Talk to the Overseer…' : 'Press Enter to talk to the Overseer' });
    // What the Observatory's wardrobe asks the Overseer with (modules/overseer/wardrobe.js): the price first, then the same paid message the chat sends.
    H.assistant = { quote: async () => ({ credits: await askPrice(id), balance: session.credits == null ? null : session.credits }), ask: (t) => ask(id, t) };
    autosave();
    signedInButtons();
    ret.patch({ user: user.id });
    // The real numbers: the balance now (the sign-up may have given some) and what a message to the Overseer costs (Gen's quote).
    const fresh1 = (await me()) || user;
    const n = Number(fresh1.credits) || 0;
    session.credits = n;
    const price = await askPrice(id);
    const name = (H.presence && H.presence.look && H.presence.look.name) || (ret.get() || {}).name || user.name || '';
    const hi = name ? `Welcome, ${name}.` : 'Welcome.';
    const say = (text, action) => H.chat && H.chat.line({ kind: 'overseer', text, action, keep: 30 });
    const emit = (ev, d) => { try { H.game.emit(ev, d); } catch { /* fine */ } };
    setTimeout(() => {
      if (!fresh) say(`${name ? `Welcome back, ${name}.` : 'Welcome back.'} Your island, as you left it${window.HawkesGuest.resumed && window.HawkesGuest.resumed !== 'done' ? ', and the tour where you stopped' : ''}. Press L to change how you look; talk to me here any time.`);
      else if (n > 0) {
        say(`${hi} This island is yours now. You have ${n.toLocaleString()} credits, and a message to me costs ${price}${n >= price ? `: that is ${Math.floor(n / price).toLocaleString()} ${Math.floor(n / price) === 1 ? 'ask' : 'asks'}` : ', so you are a little short'}. Nothing is spent until you send.`);
        emit('credits-told', { credits: n, price });
        if (n >= price) setTimeout(() => offerAsks(), 3500);
      } else {
        say(`${hi} This island is yours now. What I make uses credits, and you have none right now.`, { label: 'Get credits', href: '/app#credits' });
        emit('credits-told', { credits: 0, price });
      }
    }, 1200);
    // The tour's ask step teaches the same three asks again, when it is reached (spawn done).
    H.game.on('tour', (d) => { if (d && d.step === 'spawn') offerAsks(true); });
  }
  /** What a message to the Overseer costs now (Gen's quote through the portal; the portal's floor if it can't be had). */
  async function askPrice(id) {
    try { const q = await api('GET', `/v1/games/${id}/ai/quote`); session.price = Number(q.credits) || session.price || 8; if (q.balance != null) session.credits = Number(q.balance); }
    catch { session.price = session.price || 8; }
    return session.price;
  }
  /** Three things to ask for, each a line with its price and a Send: nothing is asked or charged until it is tapped. */
  const EXAMPLE_ASKS = ['a lighthouse', 'a tune for the island', 'a hat for me'];
  async function offerAsks(again) {
    const H = session.H;
    if (!island || !H.chat) return;
    if (!again && session.offered) return;
    session.offered = true;
    const price = await askPrice(island.id);
    if (session.credits < price) { outOfCredits(); return; }
    H.chat.line({ kind: 'overseer', text: `Here is what I can do. Tap one to send it, or type your own. Each message costs ${price} credits; whatever I offer to make shows its own price before it runs.`, keep: 40 });
    for (const t of EXAMPLE_ASKS) {
      H.chat.line({ kind: 'sys', text: `“${t}” · ${price} credits`, keep: 60, action: { label: 'Send', onclick: (btn) => sendExample(t, btn) } });
    }
    try { H.game.emit('asks-offered', { asks: EXAMPLE_ASKS, price }); } catch { /* fine */ }
    track('sandbox_asks_offered', { price, credits: session.credits });
  }
  async function sendExample(text, btn) {
    const H = session.H;
    if (btn) { btn.disabled = true; btn.textContent = 'Sent'; }
    track('sandbox_ask_example', { text });
    try { await ask(island.id, text); } catch (x) { if (btn) { btn.disabled = false; btn.textContent = 'Send'; } if (H.chat) H.chat.line({ kind: 'sys', text: x.message }); }
  }
  /** The game's feed (the editor's: /v1/games/:id/live): the Overseer's answers and offers, its work, new assets, files. */
  function feed(id, user) {
    if (typeof EventSource === 'undefined') return;
    const H = session.H;
    const seen = new Set();
    // One listener set, a stream that comes back quietly: `bye` from the server, a drop or an error closes it and a new one
    // opens after a growing wait (1 s to 30 s) with the last event id, so what was missed arrives once and nothing twice.
    let es = null, last = '', tries = 0, timer = null, gone = false;
    const handlers = [];
    const on = (name, fn) => { handlers.push([name, fn]); es && es.addEventListener(name, fn); };
    const open = () => {
      if (gone) return;
      es = new EventSource(`/v1/games/${id}/live${last ? `?last=${encodeURIComponent(last)}` : ''}`, { withCredentials: true });
      es.addEventListener('open', () => { tries = 0; });
      for (const [name, fn] of handlers) es.addEventListener(name, fn);
      for (const name of ['chat', 'gen', 'asset', 'file', 'deleted']) es.addEventListener(name, (e) => { if (e.lastEventId) last = e.lastEventId; });
      const retry = () => { if (!es) return; es.close(); es = null; if (!gone) timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** tries++)); };
      es.addEventListener('bye', () => { tries = 0; retry(); });
      es.onerror = retry;
    };
    let assetsT = null;
    addEventListener('pagehide', () => { gone = true; clearTimeout(timer); if (es) es.close(); }); // leaving: close the stream ourselves, not by the page being torn down
    on('chat', (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (!m || !H.chat) return;
      const firstTime = !seen.has(m.id);
      seen.add(m.id);
      if (!firstTime) return;
      if (m.role === 'ai') {
        H.chat.line({ kind: 'overseer', text: m.text, keep: 30 });
        // What it offers to make (a model, a sound...): one tap makes it, paid from their credits.
        for (const [i, sg] of ((m.data && m.data.assets) || []).entries()) {
          if (sg.used || sg.task) continue;
          H.chat.line({ kind: 'sys', text: `I can make it: ${sg.kind}, "${String(sg.prompt).slice(0, 60)}"${sg.credits ? ` (${sg.credits} credits)` : ''}.`, keep: 60, action: { label: 'Make it', onclick: (btn) => make(id, sg, m.id, i, btn) } });
        }
      } else if (m.role === 'system') H.chat.line({ kind: 'sys', text: m.text });
      else H.chat.line({ kind: m.user_id && m.user_id === user.id ? 'me' : 'player', who: m.name || 'Someone', text: m.text });
    });
    on('thinking', (e) => { let d = {}; try { d = JSON.parse(e.data); } catch { /* fine */ } if (H.chat) H.chat.status(d.on ? 'The Overseer is thinking…' : null); });
    on('gen', (e) => {
      let r; try { r = JSON.parse(e.data); } catch { return; }
      if (!r || !H.chat) return;
      if (r.state === 'running') H.chat.status(`Making ${r.name || r.kind}${r.steps ? ` · step ${r.step} of ${r.steps}` : ''}${r.progress != null ? ` · ${Math.round(r.progress * 100)}%` : ''}`);
      else if (!seen.has(`gen:${r.task_id}:${r.state}`)) {
        seen.add(`gen:${r.task_id}:${r.state}`);
        H.chat.status(null);
        if (r.state === 'done') H.chat.line({ kind: 'overseer', text: `I have made ${r.asset_name || r.name}. It's in your island.` });
        else H.chat.line({ kind: 'overseer', text: `I couldn't make ${r.name || 'that'}${r.error ? `: ${r.error}` : ''}. Your credits for it were given back.` });
      }
    });
    // A new asset (made, or from the community): the world gets it (stand-ins become the real thing).
    on('asset', () => {
      clearTimeout(assetsT);
      assetsT = setTimeout(async () => { try { const b = await api('GET', `/v1/games/${id}/bundle`); if (b.assets) H.setAssets(b.assets); } catch { /* next time */ } }, 400);
    });
    // World edits come through the room; anything else (a script, a new world file) is reloaded in place.
    on('file', (e) => {
      let d; try { d = JSON.parse(e.data); } catch { return; }
      if (!d || !d.path) return;
      if (d.path === 'scene.json' && d.ops && ((session.conn && d.conn === session.conn) || saving || (d.rev && savedRevs.has(d.rev)))) return; // our own save
      if (!(d.path === 'scene.json' && d.ops) && typeof d.content === 'string') { try { H.reload({ [d.path]: d.content }); } catch (err) { console.warn('sandbox: reload', err); } }
      rebase();
    });
    on('deleted', () => { gone = true; clearTimeout(timer); es && es.close(); if (H.chat) { H.chat.detach(); H.chat.line({ kind: 'sys', text: 'This island was deleted.' }); } island = null; kept.clear(); });
    open();
  }
  /** A message to the Overseer, with what the player sees (the editor sends the same: build.js context()). */
  async function ask(id, text) {
    const H = session.H;
    // Known to be out of credits: say so, with the Get credits link, and send nothing (no request that is bound to fail).
    if (session.credits != null && session.price != null && session.credits < session.price) { outOfCredits(); return; }
    try {
      await api('POST', `/v1/games/${id}/ai`, { message: text, context: worldContext(H) || undefined });
      track('assistant_ask', { chars: text.length, where: 'sandbox' });
      me().then((u) => { if (u) session.credits = Number(u.credits) || 0; });
      try { H.game.emit('asked', { chars: text.length }); } catch { /* fine */ }
    } catch (x) {
      if (x.status === 402) return outOfCredits(x.message);
      if (x.status === 429) throw new Error("I'm still working on the last request. Ask again when it's done.");
      if (!x.status || x.status >= 500) throw new Error("I couldn't hear you just now. Nothing was charged; try again in a moment.");
      throw x;
    }
  }
  async function make(id, sg, messageId, i, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Making…'; }
    try { await api('POST', `/v1/games/${id}/generate`, { kind: sg.kind, prompt: sg.prompt, name: sg.name, messageId, suggestion: i }); track('asset_make', { kind: sg.kind, where: 'sandbox' }); }
    catch (x) { if (btn) { btn.disabled = false; btn.textContent = 'Make it'; } if (x.status === 402) outOfCredits(x.message); else if (session.H.chat) session.H.chat.line({ kind: 'sys', text: x.message }); }
  }
  /** Out of credits: the Overseer says so, with a way to get more (a new tab: the island keeps running); back here,
   *  the balance is read again. */
  let creditsAt = 0;
  function outOfCredits(message) {
    const H = session.H;
    track('credits_out', { where: 'sandbox' });
    if (Date.now() - creditsAt < 20000) return;
    creditsAt = Date.now();
    if (H.chat) H.chat.line({ kind: 'overseer', priority: 'important', keep: 60, text: `The light has gone quiet for now. Take more when you wish, and ask me again: the island will be as you left it.`, action: { label: 'Get credits', href: '/app#credits' } });
    const back = async () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', back);
      const u = await me();
      if (u && Number(u.credits) > 0 && H.chat) H.chat.line({ kind: 'overseer', text: `You have ${Number(u.credits).toLocaleString()} credits now. Ask me again.` });
    };
    document.addEventListener('visibilitychange', back);
  }
  /** What the player sees, for the Overseer: where they are and look, what's near (on a round world, on the planet). */
  function worldContext(H) {
    try {
      const B = window.BABYLON, w = H.world, p = w.player, cam = w.scene.activeCamera;
      const d = cam.getDirection(B.Axis.Z);
      const at = p ? p.position : [cam.position.x, cam.position.y, cam.position.z];
      const sp = H.hooks && H.hooks.space;
      const pl = (v) => (sp ? sp.toPlanet(v) : v).map(r2);
      const dl = (v) => (sp ? sp.dirToPlanet(v) : v).map(r2);
      const near = [...w.entities].filter((e) => e.sceneId && e.alive).map((e) => ({ e, dist: e.distanceTo(at) })).sort((a, b) => a.dist - b.dist).slice(0, 14)
        .map(({ e, dist }) => ({ id: e.sceneId, name: e.name, distance: r2(dist), at: pl(e.position) }));
      const hit = w.scene.pickWithRay(cam.getForwardRay(40), (m) => m.isPickable && m.isEnabled());
      return {
        mode: 'play',
        player: { at: pl(at), facing: dl([d.x, d.y, d.z]), ...(sp ? { up: dl([0, 1, 0]) } : {}), flying: Boolean(p && p.flying), standingOn: (p && p.standing && p.standing.sceneId) || null },
        lookPoint: hit && hit.hit ? pl([hit.pickedPoint.x, hit.pickedPoint.y, hit.pickedPoint.z]) : null,
        nearby: near,
        players: [],
      };
    } catch { return null; }
  }
  // Saving: what changed since the last save, every minute, when the tab goes away, and around changes from elsewhere.
  // (Not the vehicle you're in: it's saved where you leave it.)
  let saving = false, saveTimer = null, rebaseT = null;
  const savedRevs = new Set(); // scene.json revisions our saves made (their feed events are ours, nothing to do)
  async function saveNow(keepalive) {
    if (!island || saving || !session.H || !session.H.world) return;
    saving = true;
    try {
      const now = Core.snapshot(session.H, { edits: session.edits });
      let riding = null;
      try { riding = window.game && window.game.vehicles && window.game.vehicles.current; } catch { riding = null; }
      if (riding && riding.sceneId && now.entities) {
        const was = island.base && island.base.entities && island.base.entities[riding.sceneId];
        if (was) now.entities[riding.sceneId] = was; else delete now.entities[riding.sceneId];
      }
      const ops = Core.toOps(island.base, now);
      for (const part of Core.chunks(ops, 200)) {
        const r = await api('POST', `/v1/games/${island.id}/scene`, { ops: part }, { keepalive, headers: session.conn ? { 'X-Room-Conn': session.conn } : undefined });
        if (r && r.rev) { savedRevs.add(r.rev); if (savedRevs.size > 50) savedRevs.delete(savedRevs.values().next().value); }
      }
      island.base = now;
      if (ops.length) flashSaved();
    } catch (x) { console.warn('sandbox: not saved yet', x); } finally { saving = false; }
  }
  /** The Overseer (or a builder) changed the world: save ours first, then count theirs as already there. */
  function rebase() {
    clearTimeout(rebaseT);
    rebaseT = setTimeout(async () => { await saveNow(false); try { if (island) island.base = Core.snapshot(session.H, { edits: session.edits }); } catch { /* next time */ } }, 1500);
  }
  function autosave() {
    if (saveTimer) return;
    saveTimer = setInterval(() => saveNow(false), 60000);
    addEventListener('pagehide', () => saveNow(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(true); });
  }
  function toEditor() { return saveNow(false).then(() => { location.href = `/app/g/${island.id}`; }); }
  /** Signed in: Save shows it's kept (and saves now), Build and Invite open the editor, Ask opens the chat. */
  function signedInButtons() {
    const acts = session.acts;
    if (!acts) return;
    const b = (k) => acts.querySelector(`[data-intent="${k}"]`);
    if (b('save')) { b('save').textContent = 'Saved ✓'; b('save').classList.remove('primary'); }
    if (b('build')) { b('build').textContent = 'Build'; b('build').classList.add('primary'); }
  }
  function flashSaved() {
    const s = session.acts && session.acts.querySelector('[data-intent="save"]');
    if (!s) return;
    s.textContent = 'Saved ✓';
    s.classList.add('glow');
    setTimeout(() => s.classList.remove('glow'), 1200);
  }
  function toast(text) { return el(`<span>${esc(text)}</span>`, 'gs-glass gs-toast'); }

  // ------------------------------------------------------------------ signed in elsewhere: the snapshot becomes their game, in the editor
  // (Build and Invite, and back from Google's page when the popup was blocked.)
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

  /** An invitation that cannot be used (closed, full, expired, unreadable): the reason, in plain words, and their own island. */
  function gone(st) {
    track('sandbox_invite_gone', { state: st.state });
    if (window.HawkesLoadScreen) window.HawkesLoadScreen.done(); else { const l = document.getElementById('loading'); if (l) l.hidden = true; }
    style();
    for (const x of document.querySelectorAll('.gs-veil')) x.remove();
    const v = el(`<div class="gs-glass gs-sheet" role="dialog" aria-modal="true" aria-label="Invitation"><h3>${st.state === 'full' ? 'The island is full' : st.state === 'expired' ? 'This invitation has run out' : 'No one is on this island'}</h3><p>${esc(st.message)}</p><button type="button" class="go" data-own>Start my own island</button></div>`, 'gs-veil');
    v.dataset.invite = st.state;
    const b = v.querySelector('[data-own]');
    b.onclick = () => { const u = new URL(location.href); u.searchParams.delete('invite'); location.href = u.pathname + u.search; };
    b.focus();
  }
  /** ?ref=<code> kept as the landing page keeps it (index.html): 30 days, for the sign-up (users.ts originOf). */
  function keepRef(q) {
    const v = q.get('ref');
    if (!v || !/^[a-z0-9_.-]{1,60}$/i.test(v)) return;
    const keep = (name, val) => { document.cookie = `${name}=${encodeURIComponent(val)}; Max-Age=${30 * 86400}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; };
    keep('hg_ref', v);
    keep('hg_src', 'referral');
  }

  // ------------------------------------------------------------------ the page: claim (back from signing in), or play
  window.HawkesGuest = {
    /** The signed-in user, asking for the account with the sheet if there is none (the moment chip's one tap): a user, or null. */
    async account() {
      const user = await me();
      if (user) return user;
      return new Promise((resolve) => { shareWaiters.push(resolve); openSheet('share', { name: lookName(session.H), onCancel: () => flushShare(null) }); });
    },
    /** Pip waits for this: the account comes first (the mirror opens the sheet; signed in, the tour goes on here). */
    accountFirst: true,
    /** A return (public/play/guest.js): the tour step they left on (sandbox.js picks the tour up there), and the steps it fast-forwarded. */
    resume: null, resumed: null, skipped: null,
    async boot(o = {}) {
      const t0 = performance.now();
      const q = new URLSearchParams(location.search);
      const intent = q.get('claim');
      if (intent) {
        history.replaceState(null, '', '/play/sandbox' + (q.get('touch') ? '?touch=' + q.get('touch') : ''));
        const user = await me();
        if (user && (store.get() || intent === 'tour')) {
          track('sandbox_signup', { intent, method: 'google' });
          if (window.HawkesLoadScreen) window.HawkesLoadScreen.done(); else document.getElementById('loading').hidden = true;
          return claim(WHY[intent] ? intent : 'save', user);
        }
      }
      // An invitation: is the island there for them? (Before the engine loads anything; the same loading screen meanwhile.)
      const token = q.get('invite');
      let friend = null;
      if (token) {
        keepRef(q);
        let st = null;
        try { st = await api('GET', `/v1/island-invite/${encodeURIComponent(token)}`); } catch { st = { state: 'closed', message: 'We could not reach the island just now. Try the link again in a moment, or start an island of your own.' }; }
        track('sandbox_invite_open', { state: st.state });
        if (st.state !== 'open') return gone(st);
        friend = { token, room: st.room, name: st.name || '', user: await me() }; // (signed in: no sheet; their own island stays theirs)
      }
      // Signed in with an island kept here before: it plays on, as they left it (not the guest sandbox again).
      const was = kept.get();
      if (was && was.id && !friend) {
        const user = await me();
        if (user && user.id === was.user) {
          try {
            const gb = await api('GET', `/v1/games/${was.id}/bundle`);
            await window.HawkesModules.load('play', { bundle: Promise.resolve(gb) });
            // Back again: the tour picks up on the step they left (sandbox.js reads this) and they are welcomed by name (goLive).
            const rec = ret.get();
            if (rec && rec.user === user.id && rec.tour) window.HawkesGuest.resumed = window.HawkesGuest.resume = rec.tour;
            session.returning = { ...(rec || {}), signedIn: true };
            window.HawkesPlay.run(gb, { mode: 'play' });
            let base = null;
            try { base = JSON.parse(gb.files['scene.json']); } catch { /* fine */ }
            startUi(window.HawkesPlay, base, t0);
            island = { id: was.id, base: base || { config: {}, entities: {} }, user: user.id };
            setTimeout(() => { try { island.base = Core.snapshot(window.HawkesPlay, { edits: session.edits }); } catch { /* fine */ } }, 3000);
            track('sandbox_resume', {});
            await goLive(user, false);
            return;
          } catch (x) {
            if (x.status === 404 || x.status === 403) kept.clear();
            console.warn('sandbox: the kept island did not load', x);
          }
        } else if (!user) { /* signed out: the guest sandbox (the island stays theirs) */ }
      }
      // Fetch the world while the engine loads.
      const bundle = fetch('/v1/play-template/sandbox').then((r) => r.json().then((b) => { if (!r.ok) throw new Error(b.error || 'Could not load the sandbox'); return b; }));
      try {
        await window.HawkesModules.load('play', { bundle }); // (only the modules the island uses; the rest after)
        track('sandbox_scripts_ready', {});
        const b = await bundle;
        let base = null;
        try { base = JSON.parse(b.files['scene.json']); } catch { /* the template is ours: never */ }
        // Back from a featured game (the Observatory's travel board), or a second visit: no intro and no mirror again (the
        // Observatory beams them in; a return is beamed in and welcomed back, startUi). Storage cleared: the full beginning.
        const comingBack = ret.is();
        if ((q.get('return') === 'observatory' || comingBack) && base) {
          try {
            base.config = { ...(base.config || {}), overseer: { ...((base.config || {}).overseer || {}), intro: false } };
            if (base.entities && base.entities.mirror) base.entities.mirror = { ...base.entities.mirror, shape: { ...(base.entities.mirror.shape || {}), character: { ...((base.entities.mirror.shape || {}).character || {}), start: false } } };
            b.files['scene.json'] = JSON.stringify(base);
          } catch { /* the usual start */ }
        }
        // A friend's beginning is short: the beam and one line, then the mirror (a return skips both, as ever).
        if (friend && !comingBack && base) {
          base.config = { ...(base.config || {}), overseer: { ...((base.config || {}).overseer || {}), intro: 'short' } };
          b.files['scene.json'] = JSON.stringify(base);
        }
        session.friend = friend;
        if (comingBack && q.get('return') !== 'observatory') session.returning = { ...ret.get(), signedIn: false };
        window.HawkesPlay.run(b, { mode: 'play' });
        track('sandbox_world_built', {});
        requestAnimationFrame(() => requestAnimationFrame(() => track('sandbox_first_frame', {})));
        startUi(window.HawkesPlay, base, t0);
      } catch (e) {
        if (o.failed) o.failed(e);
      }
    },
  };  // (Playtest only, a named setup shortcut: the game is told the balance, then offered the asks as an empty account would be.)
  window.HawkesGuest.pretendCredits = (n) => { session.credits = Number(n) || 0; session.offered = false; return offerAsks(); };

})();
