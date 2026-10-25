// Presence, finding each other in a shared world: a marker over every other player who is on screen but too far for a
// name tag, an arrow on the screen's edge toward the ones who aren't (tap either to go there), "go to" next to someone
// with the Overseer's beam, and reporting a player. The math is core.marker / core.besideSpot (tested in Node); the
// who's-here list (presence-ui.js) uses P.goTo and P.report too.
/* global HawkesPlay, BABYLON, HawkesNet */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const P = H.presence;
  const C = P.core;
  const B = window.BABYLON;
  const W = () => H.world;

  const CSS = `
.pr-marks{position:fixed;inset:0;pointer-events:none;z-index:3;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.pr-mark{position:absolute;left:0;top:0;display:flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;background:rgba(8,12,22,.7);border:1.5px solid var(--c,#7dd3fc);color:#fff;font:700 13px/1.1 system-ui,sans-serif;white-space:nowrap;text-shadow:0 1px 2px #000;pointer-events:auto;cursor:pointer;min-height:30px;touch-action:manipulation;will-change:transform}
.pr-mark small{opacity:.7;font-weight:600}
.pr-mark i{display:inline-block;font-style:normal;color:var(--c,#7dd3fc);line-height:1}
.pr-mark.on i{transform:rotate(90deg)}
.pr-mark.edge{padding:5px 10px}
body.pr-touch .pr-mark{min-height:40px;font-size:14px}
`;
  let layer = null;
  const els = new Map();
  function ensureLayer() {
    if (!document.getElementById('pr-marks-style')) {
      const st = document.createElement('style');
      st.id = 'pr-marks-style';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.className = 'pr-marks';
    document.body.appendChild(layer);
    layer.addEventListener('pointerdown', (e) => e.stopPropagation());
    layer.addEventListener('click', (e) => {
      const m = e.target.closest ? e.target.closest('.pr-mark') : null;
      if (m && m.dataset.id) P.goTo(m.dataset.id);
    });
    return layer;
  }

  /** The markers this frame (tests read it): [{ id, name, mode: 'on' | 'edge', x, y, angle, distance }]. */
  P.markers = [];
  const phone = () => Boolean(H.touchUi);

  function draw() {
    const w = W();
    const cam = w && w.scene && w.scene.activeCamera;
    const me = w && w.player;
    const lay = ensureLayer();
    if (!cam || !me || !me.alive || P.off() || !P.enabled('markers')) { clear(); return; }
    const canvas = document.getElementById('stage');
    const view = { w: (canvas && canvas.clientWidth) || window.innerWidth || 800, h: (canvas && canvas.clientHeight) || window.innerHeight || 600, fov: cam.fov || 0.9, margin: phone() ? 34 : 28 };
    const viewM = cam.getViewMatrix();
    const cp = cam.globalPosition || cam.position;
    const tagged = new Set(P.shown.filter((s) => s.tag).map((s) => s.key));
    const out = [];
    for (const x of P.players()) {
      const e = x.entity;
      if (x.me || !e || !e.alive || e.visible === false) continue;
      const at = new B.Vector3(e.x, e.y + 1.6, e.z);
      const c = B.Vector3.TransformCoordinates(at, viewM);
      const mk = C.marker({ x: c.x, y: c.y, z: c.z }, view);
      const distance = Math.hypot(e.x - me.x, e.y - me.y, e.z - me.z);
      // On screen with a name tag already over them: nothing more to show.
      if (mk.mode === 'on' && tagged.has(x.key)) continue;
      out.push({ id: x.id, key: x.key, name: x.name, color: x.color, mode: mk.mode, x: mk.x, y: mk.mode === 'on' ? mk.y - 26 : mk.y, angle: mk.angle ?? null, distance });
    }
    out.sort((a, b) => a.distance - b.distance);
    P.markers = out.slice(0, phone() ? 4 : 8);
    const used = new Set();
    for (const m of P.markers) {
      used.add(m.key);
      let el = els.get(m.key);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<i></i><b></b><small></small>';
        lay.appendChild(el);
        els.set(m.key, el);
      }
      el.dataset.id = m.id;
      el.style.setProperty('--c', m.color || '#7dd3fc');
      const cls = `pr-mark ${m.mode}`;
      if (el.className !== cls) el.className = cls;
      const arrow = el.children[0], nm = el.children[1], dist = el.children[2];
      if (nm.textContent !== m.name) nm.textContent = m.name;
      const d = `${Math.round(m.distance)} m`;
      if (dist.textContent !== d) dist.textContent = d;
      arrow.textContent = '➤';
      arrow.style.transform = m.mode === 'edge' ? `rotate(${Math.round((m.angle * 180) / Math.PI)}deg)` : '';
      el.style.display = '';
      // An edge marker's arrow sits on the screen's edge; its label is kept inside by shifting toward the middle.
      const shift = m.mode === 'edge' ? `translate(${Math.round(-50 - Math.cos(m.angle) * 50)}%, ${Math.round(-50 - Math.sin(m.angle) * 50)}%)` : 'translate(-50%, -100%)';
      el.style.transform = `translate(${Math.round(m.x)}px, ${Math.round(m.y)}px) ${shift}`;
    }
    for (const [k, el] of els) if (!used.has(k)) { el.remove(); els.delete(k); }
  }
  function clear() { for (const el of els.values()) el.remove(); els.clear(); P.markers = []; }

  // ------------------------------------------------------------------ going to someone
  let goAt = -Infinity;
  const say = (text) => { try { H.chat ? H.chat.line({ kind: 'sys', text }) : W().game && W().game.ui.message(text, 1.6); } catch { /* no world */ } };
  function beamAt(at, seconds) {
    try {
      if (H.overseer && typeof H.overseer.beam === 'function') return H.overseer.beam(at, { radius: 1.3, seconds });
      if (H.spawn && typeof H.spawn.beam === 'function') return H.spawn.beam(at, '');
    } catch (err) { H.report(err, 'presence beam'); }
    return null;
  }
  /** Goes to stand next to a player (their id from players(), or their key), the Overseer's beam where you left and where you arrive.
   *  → true if you went. */
  P.goTo = (id) => {
    const w = W();
    const me = w && w.player;
    if (!me || !me.alive) return false;
    const key = String(id);
    const x = P.players().find((q) => !q.me && (String(q.id) === key || q.key === key));
    const e = x && x.entity;
    if (!e || !e.alive) { say('They are not in view of the beam right now.'); return false; }
    if (performance.now() - goAt < 1500) return false;
    goAt = performance.now();
    const from = [me.x, me.y, me.z];
    const spot = C.besideSpot(from, [e.x, e.y, e.z]);
    beamAt(from, 1.2);
    me.position = [spot[0], spot[1] + 1, spot[2]];
    me.velocity = [0, 0, 0];
    beamAt(spot, 1.8);
    P.lastGo = { id: x.id, name: x.name, from, to: spot, at: performance.now() };
    try { if (H.track) H.track('presence_goto', {}); } catch { /* never break the game */ }
    P.closeUi && P.closeUi();
    say(`Beamed next to ${x.name}.`);
    return true;
  };

  // ------------------------------------------------------------------ reporting
  const reported = new Set();
  /** Reports a player's name or behaviour (the reason: 'name', 'chat' or 'other'). They are muted for you at once.
   *  The report is a `presence_report` analytics event (the id only, no name or chat text). → true the first time. */
  P.report = (id, reason = 'other') => {
    const x = P.players().find((q) => !q.me && (String(q.id) === String(id) || q.key === String(id)));
    if (!x) return false;
    const first = !reported.has(x.key);
    reported.add(x.key);
    P.mute(x.id, true);
    if (first) { try { if (H.track) H.track('presence_report', { reason: ['name', 'chat', 'other'].includes(reason) ? reason : 'other' }); } catch { /* fine */ } }
    P._emit('report', { id: x.id, name: x.name, reason });
    return first;
  };
  P.reported = (id) => { const x = P.players().find((q) => String(q.id) === String(id)); return Boolean(x && reported.has(x.key)); };

  // ------------------------------------------------------------------ a stand-in for a second player (playtests, tests, the codex)
  /** Puts a player-shaped stand-in in the room as net.js would show a real one: P.standIn('Mira', { ahead: 40, side: 0 }).
   *  It only stands there (no real second browser), but everything here treats it as another player. Returns its id. */
  P.standIn = (name, o = {}) => {
    const w = W();
    const me = w && w.player;
    if (!me || !window.HawkesNet) return null;
    const id = o.id || `standin-${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'x'}`;
    const peers = HawkesNet.peers();
    if (peers.has(id)) return id;
    const yaw = Number.isFinite(o.yaw) ? o.yaw : 0;
    const at = [me.x + Math.sin(yaw) * (o.ahead ?? 30) + Math.cos(yaw) * (o.side ?? 0), me.y, me.z + Math.cos(yaw) * (o.ahead ?? 30) - Math.sin(yaw) * (o.side ?? 0)];
    const color = o.color || '#f59e0b';
    const a = H.game.capsule({ x: at[0], y: at[1], z: at[2], radius: 0.35, height: 1.8, color, physics: 'kinematic', tag: 'player', name });
    a.remotePlayer = true; a.isPlayer = true; a.netId = id;
    peers.set(id, { id, name, color, state: { p: at, y: 0, pi: 0 }, avatar: a, seen: performance.now(), standIn: true });
    if (o.joined && H.arrive && H.arrive.joined) H.arrive.joined(a, name); // (as net.js shows someone who joins right now)
    return id;
  };
  P.removeStandIns = () => { const peers = window.HawkesNet && HawkesNet.peers(); if (!peers) return; for (const [id, pr] of peers) if (pr.standIn) { try { pr.avatar && pr.avatar.destroy(); } catch { /* gone */ } peers.delete(id); } };

  H.hooks.frame.push(() => {
    try {
      if (window.HawkesNet) for (const pr of HawkesNet.peers().values()) if (pr.standIn) pr.seen = performance.now();
      draw();
    } catch (err) { H.report(err, 'presence markers'); }
  });
  H.hooks.world.push({ leave() { clear(); } });
})();
