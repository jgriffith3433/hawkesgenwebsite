// Time while playing: rewind and reset.
//   - Rewind: the world keeps the last ~10 s of itself (where every moving thing was, how fast it went, its health),
//     a few times a second. Hold ◀◀ (Backspace, D-pad left on a gamepad) and it plays backwards; let go and it carries
//     on from there. Things that broke come back (from the world file), things made since go away.
//   - Reset: the world as it loaded (⟲, Shift+Backspace, D-pad down; asks first).
// Playing together the host decides: the host's rewind takes everyone's world back 10 s (their own players stay where
// they are) and its reset restarts everyone's; anyone else asks the host, who says yes or no. A world turns both off
// with "config": { "rewind": false } (a race, a puzzle with a score).
// H.rewind: { back(seconds), reset(), hold(on), seconds (how much is kept), rewinding, capture() } for tools and tests.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const W = () => H.world;
  const G = () => H.game;
  const KEEP = 10; // seconds kept
  const EVERY = 0.1; // seconds between snapshots
  const SPEED = 2; // rewinding plays back this many times faster than it happened
  let frames = []; // { t, recs: [{ e, id, v: [x y z, rx ry rz, vx vy vz, ax ay az, hp] }], player }
  let lastAt = -1;
  let born = new WeakMap(); // entity -> world time it was first seen (things made since a snapshot go on rewind)
  let world = null;
  let scrub = null; // { cursor } while rewinding
  const online = () => Boolean(H.sync && H.sync.online);
  const host = () => !online() || Boolean(H.sync.isHost);
  const allowed = () => { const w = W(); return Boolean(w && w.config && w.config.rewind !== false); };
  // The player's controls (◀◀ ⟲, Backspace, the D-pad) are off for now (J, 2026-10-24): only a world with
  // config.rewind { controls: true }, or H.rewind.controls = true in the console, shows them. Rewinding itself
  // (game.rewind, game.resetWorld) works as before.
  const controls = () => { const w = W(); return Boolean(H.rewind && H.rewind.controls) || Boolean(w && w.config && w.config.rewind && w.config.rewind.controls === true); };

  // ------------------------------------------------------------------ what's kept
  const keeps = (e, w) => e.alive && !e.remotePlayer && e !== w.player && e.physics === 'dynamic' && !e.isTerrain && !e.isScatter && !e.temporaryFx;
  function capture() {
    const w = W();
    if (!w) return;
    const recs = [];
    for (const e of w.entities) {
      if (!born.has(e)) born.set(e, w.time);
      if (!keeps(e, w)) continue;
      const av = e.sleeping ? null : safeSpin(e);
      const r = e.node.rotation;
      recs.push({ e, id: e.sceneId || null, v: [e.x, e.y, e.z, r.x, r.y, r.z, e.vx, e.vy, e.vz, av ? av[0] : 0, av ? av[1] : 0, av ? av[2] : 0, typeof e.hp === 'number' ? e.hp : NaN] });
    }
    const p = w.player;
    const player = p && p.alive && !p._vehRider ? { v: [p.x, p.y, p.z, p.vx, p.vy, p.vz], hp: p.hp } : null;
    frames.push({ t: w.time, recs, player });
    while (frames.length && frames[0].t < w.time - KEEP - EVERY) frames.shift();
  }
  const safeSpin = (e) => { try { return e.angularVelocity; } catch { return null; } };

  // ------------------------------------------------------------------ putting it back
  /** Puts the world where it was at world time `t` (between two snapshots: in between). final: also how fast things
   *  went, and what was made since goes; otherwise (while rewinding) things just stand where they were. */
  function restore(t, final) {
    const w = W();
    if (!w || !frames.length) return;
    let i = frames.length - 1;
    while (i > 0 && frames[i].t > t) i--;
    const a = frames[i], b = frames[Math.min(frames.length - 1, i + 1)];
    const k = b === a ? 0 : Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
    const at = new Map();
    for (const r of b.recs) at.set(r.e, r);
    const theirs = (e) => online() && e.sceneId && H.sync.holder(e) && H.sync.holder(e) !== H.sync.me;
    const seen = new Set();
    for (const r of a.recs) {
      let e = r.e;
      if (!e.alive) {
        if (!final) continue;
        // It broke (or was blown up) since: back from the world file.
        const spec = r.id && w.graph.entities[r.id];
        if (!spec || w.byId.get(r.id)) continue;
        try { e = H.fromSpec(JSON.parse(JSON.stringify(spec)), true); } catch (err) { H.report(err, 'rewind'); continue; }
      }
      if (theirs(e)) continue;
      if (online() && e.remote && e.sceneId) H.sync.claim(e);
      seen.add(e);
      const n = at.get(r.e);
      const v = n && k > 0 ? r.v.map((x, j) => (j >= 3 && j < 6 ? x + angle(n.v[j] - x) * k : x + (n.v[j] - x) * k)) : r.v;
      e.node.position.set(v[0], v[1], v[2]);
      e.node.rotation.set(v[3], v[4], v[5]);
      if (e.physics === 'dynamic') {
        e.velocity = final ? [v[6], v[7], v[8]] : [0, 0, 0];
        try { e.angularVelocity = final ? [v[9], v[10], v[11]] : [0, 0, 0]; } catch {}
      }
      if (Number.isFinite(v[12]) && typeof e.hp === 'number') { e.hp = v[12]; if (e.hp > 0 && e.dead && e.living) e.dead = false; }
      e.wake();
    }
    if (final) {
      // Made since then (debris, rockets, spawned things): gone.
      for (const e of [...w.entities]) {
        if (seen.has(e) || !keeps(e, w) || e.sceneId || e.keep || e.isPlayer || e.vehicle || e.living && e.living.herd) continue;
        const b0 = born.get(e);
        if (b0 !== undefined && b0 > a.t + 1e-6) e.destroy();
      }
    }
    // My own player (alone only: playing together, everyone keeps their own place).
    const p = w.player;
    if (!online() && p && p.alive && !p._vehRider) {
      const pa = a.player, pb = b.player;
      if (pa) {
        const v = pb && k > 0 ? pa.v.map((x, j) => x + (pb.v[j] - x) * k) : pa.v;
        p.position = [v[0], v[1], v[2]];
        p.velocity = final ? [v[3], v[4], v[5]] : [0, 0, 0];
        if (typeof pa.hp === 'number' && typeof p.hp === 'number') p.hp = pa.hp;
      }
    }
  }
  const angle = (d) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

  /** Seconds of the world kept right now (how far back a rewind can go). */
  const kept = () => { const w = W(); return frames.length && w ? Math.max(0, w.time - frames[0].t) : 0; };

  /** Back `seconds` at once (the host's rewind for everyone, tests, scripts). */
  function back(seconds = KEEP) {
    const w = W();
    if (!w || !frames.length) return false;
    const t = Math.max(frames[0].t, w.time - Math.max(0, Number(seconds) || 0));
    restore(t, true);
    frames = frames.filter((f) => f.t <= t + 1e-6);
    lastAt = w.time;
    if (online() && H.hooks.net && H.hooks.net.clear) H.hooks.net.clear();
    flash(`◀◀ ${Math.round(w.time - t)} s back`);
    return true;
  }
  /** Holding rewind (alone): the world plays backwards until let go. */
  function hold(on) {
    const w = W();
    if (!w) return;
    if (on && !scrub) {
      if (!frames.length || !allowed()) return;
      scrub = { cursor: w.time, from: w.time, paused: w.paused };
      w.paused = true;
      overlay(true);
    } else if (!on && scrub) {
      const t = Math.max(frames.length ? frames[0].t : w.time, scrub.cursor);
      restore(t, true);
      frames = frames.filter((f) => f.t <= t + 1e-6);
      lastAt = w.time;
      w.paused = scrub.paused;
      scrub = null;
      overlay(false);
    }
  }

  // ------------------------------------------------------------------ playing together: the host decides
  let rewindAction = null, resetAction = null, askAction = null;
  function setupSync() {
    if (rewindAction || !H.sync || !H.sync.action) return;
    rewindAction = H.sync.action('_rewind', (d, o) => { if (o.authoritative) back(d.s); else flash(`◀◀ ${d.by || 'The host'} rewound ${Math.round(d.s)} s`); });
    resetAction = H.sync.action('_reset', (d, o) => { flash(`⟲ ${d.by || 'The host'} reset the world`); doReset(o.authoritative); });
    // Someone asks the host (only the host shows it).
    askAction = H.sync.action('_timeask', (d, o) => { if (o.authoritative && online() && d.who !== H.sync.me) askHost(d); });
  }
  function doReset(authoritative) {
    frames = []; lastAt = -1;
    if (authoritative && online() && H.hooks.net && H.hooks.net.clear) H.hooks.net.clear();
    G() && G().restart();
  }
  const myName = () => H.hooks.myName || 'Someone';
  function rewindNow() {
    if (!allowed()) return;
    setupSync();
    if (!online()) return back(KEEP);
    if (host()) return rewindAction({ s: KEEP, by: myName() });
    askAction({ what: 'rewind', who: H.sync.me, name: myName() });
    flash('Asked the host to rewind');
  }
  function resetNow(confirmed) {
    if (!allowed()) return;
    setupSync();
    if (!confirmed) return confirmBox('Reset the world to how it loaded?', 'Reset', () => resetNow(true));
    if (!online()) return doReset(true);
    if (host()) return resetAction({ by: myName() });
    askAction({ what: 'reset', who: H.sync.me, name: myName() });
    flash('Asked the host to reset');
  }
  function askHost(d) {
    const what = d.what === 'reset' ? 'reset the world' : 'rewind 10 s';
    confirmBox(`${d.name || 'Someone'} wants to ${what}`, d.what === 'reset' ? 'Reset' : 'Rewind', () => {
      if (d.what === 'reset') resetAction({ by: myName() }); else rewindAction({ s: KEEP, by: myName() });
    }, 9000);
  }

  // ------------------------------------------------------------------ every step and frame
  H.hooks.step.push(() => {
    const w = W();
    if (!w) return;
    if (w !== world) { world = w; frames = []; lastAt = -1; born = new WeakMap(); scrub = null; overlay(false); }
    if (H.mode !== 'play' || scrub || !allowed()) return;
    if (w.time - lastAt >= EVERY - 1e-6) { lastAt = w.time; capture(); }
  });
  H.hooks.frame.push((dt) => {
    const w = W();
    if (!w) return;
    const on = controls();
    show(on && H.mode === 'play' && allowed() && !H.hooks.codex); // (no on-screen controls on the codex)
    if (on) { gamepad(); keys(); }
    if (scrub) {
      const low = frames.length ? frames[0].t : w.time;
      scrub.cursor = Math.max(low, scrub.cursor - dt * SPEED);
      restore(scrub.cursor, false);
      if (bar) bar.style.width = `${Math.round((kept() ? (scrub.cursor - low) / Math.max(0.01, scrub.from - low) : 0) * 100)}%`;
      if (scrub.cursor <= low && frames.length && overlayEl) overlayEl.classList.add('end');
    }
  });

  // ------------------------------------------------------------------ keys, gamepad, buttons
  function keys() {
    const i = H.input;
    if (!i || H.mode !== 'play') return;
    const typing = /INPUT|TEXTAREA|SELECT/.test((document.activeElement && document.activeElement.tagName) || '');
    if (typing) return;
    if (i.pressed.has('backspace') && i.held.has('shift')) { resetNow(false); return; }
    const want = i.held.has('backspace') && !i.held.has('shift');
    holdOrAsk(want, 'key');
  }
  // Holding: alone, plays backwards while held; together, a tap asks for (or, as host, does) a 10 s rewind.
  const holders = new Set();
  function holdOrAsk(on, who) {
    const had = holders.size > 0;
    if (on) holders.add(who); else holders.delete(who);
    const has = holders.size > 0;
    if (has === had) return;
    if (online()) { if (has) rewindNow(); return; }
    hold(has);
  }
  let pad = { left: false, down: false };
  function gamepad() {
    if (!navigator.getGamepads || H.mode !== 'play') return;
    let gp = null;
    try { gp = [...navigator.getGamepads()].find((g) => g && g.connected); } catch { return; }
    if (!gp || !gp.buttons) return;
    const left = Boolean(gp.buttons[14] && gp.buttons[14].pressed), down = Boolean(gp.buttons[13] && gp.buttons[13].pressed);
    if (left !== pad.left) holdOrAsk(left, 'pad');
    if (down && !pad.down) resetNow(false);
    pad = { left, down };
  }

  let ui = null, bar = null, overlayEl = null, flashEl = null;
  function css() {
    if (document.getElementById('rw-css')) return;
    const s = document.createElement('style');
    s.id = 'rw-css';
    s.textContent = `
.rw-ui{position:fixed;left:max(10px,env(safe-area-inset-left));top:max(10px,env(safe-area-inset-top));z-index:7;display:flex;gap:6px;pointer-events:auto}
.rw-ui[hidden]{display:none}
.rw-ui button{width:40px;height:40px;border:0;color:#dff1ff;font:700 15px/1 system-ui,sans-serif;background:rgba(10,18,34,.62);box-shadow:inset 0 0 0 1px rgba(110,190,255,.35);clip-path:polygon(8px 0,100% 0,100% calc(100% - 8px),calc(100% - 8px) 100%,0 100%,0 8px);cursor:pointer;touch-action:none;-webkit-user-select:none;user-select:none}
.rw-ui button:hover,.rw-ui button.on{background:linear-gradient(135deg,rgba(74,158,255,.75),rgba(168,85,247,.7))}
.rw-over{position:fixed;inset:0;z-index:6;pointer-events:none;background:radial-gradient(ellipse at center,rgba(40,90,180,.06),rgba(20,40,120,.35));box-shadow:inset 0 0 160px rgba(74,158,255,.45);display:flex;align-items:flex-start;justify-content:center}
.rw-over[hidden]{display:none}
.rw-over b{margin-top:70px;font:700 22px/1 Orbitron,system-ui,sans-serif;letter-spacing:.3em;color:#e6f6ff;text-shadow:0 0 18px rgba(74,158,255,.9)}
.rw-over i{position:absolute;top:104px;left:50%;width:220px;height:3px;margin-left:-110px;background:rgba(255,255,255,.15)}
.rw-over i em{display:block;height:100%;width:100%;background:#6cf0ff;box-shadow:0 0 10px #6cf0ff}
.rw-over.end b::after{content:' · 10 S';opacity:.6}
.rw-flash{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:8;font:600 13px system-ui,sans-serif;letter-spacing:.08em;color:#e6f6ff;padding:8px 16px;background:rgba(10,18,34,.82);box-shadow:inset 0 0 0 1px rgba(110,190,255,.35);pointer-events:none;opacity:0;transition:opacity .25s}
.rw-flash.on{opacity:1}
.rw-ask{position:fixed;left:50%;top:110px;transform:translateX(-50%);z-index:40;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 16px;background:rgba(10,18,34,.92);box-shadow:inset 0 0 0 1px rgba(110,190,255,.4),0 18px 50px rgba(0,0,0,.45);color:#e6f6ff;font:600 14px system-ui,sans-serif;pointer-events:auto}
.rw-ask button{border:0;padding:8px 14px;font:700 12px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;color:#fff;background:rgba(255,255,255,.12)}
.rw-ask button.yes{background:linear-gradient(90deg,#4a9eff,#a855f7)}`;
    document.head.appendChild(s);
  }
  function show(on) {
    if (!ui) {
      if (!on || !document.body) return;
      css();
      ui = document.createElement('div');
      ui.className = 'rw-ui';
      ui.innerHTML = '<button type="button" class="rw-back" title="Rewind (hold Backspace)" aria-label="Rewind">◀◀</button><button type="button" class="rw-reset" title="Reset the world (Shift+Backspace)" aria-label="Reset the world">⟲</button>';
      document.body.appendChild(ui);
      const b = ui.querySelector('.rw-back');
      const down = (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('on'); holdOrAsk(true, 'button'); };
      const up = () => { b.classList.remove('on'); holdOrAsk(false, 'button'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      ui.querySelector('.rw-reset').addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); resetNow(false); });
    }
    if (ui.hidden === on) ui.hidden = !on;
  }
  function overlay(on) {
    if (!document.body) return;
    if (!overlayEl) {
      if (!on) return;
      css();
      overlayEl = document.createElement('div');
      overlayEl.className = 'rw-over';
      overlayEl.innerHTML = '<b>◀◀ REWIND</b><i><em></em></i>';
      document.body.appendChild(overlayEl);
      bar = overlayEl.querySelector('em');
    }
    overlayEl.hidden = !on;
    overlayEl.classList.remove('end');
  }
  let flashT = null;
  function flash(text) {
    if (!document.body) return;
    css();
    if (!flashEl) { flashEl = document.createElement('div'); flashEl.className = 'rw-flash'; document.body.appendChild(flashEl); }
    flashEl.textContent = text;
    flashEl.classList.add('on');
    clearTimeout(flashT);
    flashT = setTimeout(() => flashEl.classList.remove('on'), 2200);
  }
  let askEl = null;
  function confirmBox(text, yes, act, ms = 0) {
    if (!document.body) { act(); return; }
    css();
    if (askEl) askEl.remove();
    const el = askEl = document.createElement('div');
    el.className = 'rw-ask';
    el.innerHTML = '<span></span><button type="button" class="yes"></button><button type="button" class="no">No</button>';
    el.querySelector('span').textContent = text;
    el.querySelector('.yes').textContent = yes;
    const close = () => { el.remove(); if (askEl === el) askEl = null; document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); close(); act(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    el.querySelector('.yes').onclick = () => { close(); act(); };
    el.querySelector('.no').onclick = close;
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    if (ms) setTimeout(close, ms);
  }

  H.rewind = {
    back: (s) => back(s),
    hold: (on) => hold(Boolean(on)),
    reset: () => resetNow(true),
    rewind: () => rewindNow(),
    capture: () => capture(),
    get seconds() { return kept(); },
    get rewinding() { return Boolean(scrub); },
    get frames() { return frames.length; },
  };
  H.hooks.game.push((game) => { game.rewind = (s) => { setupSync(); if (!online()) return back(s ?? KEEP); if (host()) rewindAction({ s: s ?? KEEP, by: myName() }); return true; }; game.resetWorld = () => resetNow(true); });
  setTimeout(setupSync, 0);
})();
