// The Overseer at work (H.work): what the player sees from the moment they ask until it is built (J, 2026-10-27: "I
// ALWAYS want some visual feedback WHILE the overseer is thinking"; a request is built piece by piece, never a snap).
//   - At once (the same frame they press send, before the server answers): the ship turns to them, the emitter flares,
//     beams lock onto the spot they look at and sweep it, the ground there lights up as selected (a glowing disc, its
//     edge and a scan ring running out from the middle), a soft working hum starts, and the work pill appears.
//   - The work pill (.ov-work, top right under the account buttons; the touch layout's mid zone on a phone): a breathing orb, "The Overseer is
//     working", the beat now playing, the beats to come (when it has a plan), seconds so far and an arrow toward the work
//     when it is off screen.
//   - As the answer comes (the server's `overseer` events, src/overseer-lines.ts): `plan` (the director's first words,
//     where, the beats), `focus` (the beams and the selection glide to the new place and size), `beat` (a pulse, a chime,
//     the pill's line), `say` (the Overseer speaks through the speech desk; a character's line is a named chat line),
//     `op` (a beam pulses: the thing itself arrives through arrive.js), `file`, `end` (a burst, the selection fades, ✓).
//   - Never stuck: a session ends itself after 6 minutes, and a new one replaces it.
// The terrain module asks H.work.active to reshape the ground in steps while the Overseer works (terrain.js growTo).
// Cheap: a few beams from the Overseer's pool (H.overseer.beam, hold), three meshes, one DOM element, two oscillators.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const { clamp, num, smooth, PHONE } = H.sky._;
  const MAX_SECONDS = 360;
  const GLOW = '#8fd8ff';

  let S = null; // the session: { t, at, radius, area, beams, sel, pill, beats, beat, n, ops, ended, endT }
  let lookOffer = null; // a look the answer asked the player to choose (opened at the end)

  // ------------------------------------------------------------------ where
  const v3 = (p) => new B.Vector3(p[0], p[1], p[2]);
  /** The world file's coordinates (the server's) to the engine's frame (a round world moves under the player). */
  function local(p) { const sp = H.hooks.space; return p && sp && sp.toLocal ? sp.toLocal(p) : p; }
  function upAt(p) { return H.arrive && H.arrive.up ? H.arrive.up(p) : [0, 1, 0]; }
  const ours = (m) => m && m.name && /^ov-/.test(m.name);
  /** The point the player looks at (the ground or a thing ahead), else 10 m in front of the camera. */
  function lookPoint() {
    const w = W();
    if (!w || !w.scene || !w.scene.activeCamera) return null;
    const cam = w.scene.activeCamera;
    try {
      const hit = w.scene.pickWithRay(cam.getForwardRay(80), (m) => m.isPickable !== false && m.isVisible && !ours(m));
      if (hit && hit.hit && hit.pickedPoint) return [hit.pickedPoint.x, hit.pickedPoint.y, hit.pickedPoint.z];
    } catch { /* no picking (tests) */ }
    const d = cam.getDirection(B.Axis.Z);
    const p = w.player ? w.player.position : [cam.position.x, cam.position.y, cam.position.z];
    return [p[0] + d.x * 10, p[1] + d.y * 10, p[2] + d.z * 10];
  }
  /** The ground under a point (the first thing below it), else the point. */
  function ground(p) {
    const w = W();
    if (!w || !w.scene) return p;
    const up = upAt(p);
    try {
      const from = v3([p[0] + up[0] * 40, p[1] + up[1] * 40, p[2] + up[2] * 40]);
      const hit = w.scene.pickWithRay(new B.Ray(from, v3([-up[0], -up[1], -up[2]]), 120), (m) => m.isPickable !== false && m.isVisible && !ours(m));
      if (hit && hit.hit && hit.pickedPoint) return [hit.pickedPoint.x, hit.pickedPoint.y, hit.pickedPoint.z];
    } catch { /* no picking */ }
    return p;
  }
  const playerAt = () => { const w = W(); return w && w.player ? w.player.position.slice() : null; };

  // ------------------------------------------------------------------ the selection: the area lit up
  function makeSel(scene) {
    const root = new B.TransformNode('ov-work-sel', scene);
    const mat = (name, alpha) => {
      const m = new B.StandardMaterial(name, scene);
      m.disableLighting = true;
      m.emissiveColor = B.Color3.FromHexString(GLOW);
      m.alpha = alpha;
      m.backFaceCulling = false;
      return m;
    };
    const disc = B.MeshBuilder.CreateDisc('ov-work-disc', { radius: 1, tessellation: PHONE ? 40 : 72 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.material = mat('ov-work-disc-m', 0);
    // A hologram over the ground: rings and spokes of light, brighter at the rim (the texture is its light and its alpha).
    const tex = gridTexture(scene);
    if (tex) { disc.material.emissiveTexture = tex; disc.material.opacityTexture = tex; disc.material.emissiveColor = new B.Color3(1, 1, 1); }
    const edge = B.MeshBuilder.CreateTorus('ov-work-edge', { diameter: 2, thickness: 0.02, tessellation: PHONE ? 48 : 96 }, scene);
    edge.material = mat('ov-work-edge-m', 0);
    const scan = B.MeshBuilder.CreateTorus('ov-work-scan', { diameter: 2, thickness: 0.012, tessellation: PHONE ? 48 : 96 }, scene);
    scan.material = mat('ov-work-scan-m', 0);
    for (const m of [disc, edge, scan]) { m.parent = root; m.isPickable = false; m.applyFog = false; }
    return { root, disc, edge, scan, k: 0, scanT: 0, burst: 0 };
  }
  let grid = null;
  function gridTexture(scene) {
    if (grid && grid.getScene() === scene && !grid._disposed) return grid;
    try {
      const S = PHONE ? 256 : 512;
      const t = new B.DynamicTexture('ov-work-grid', { width: S, height: S }, scene, true);
      const c = t.getContext();
      if (!c || !c.createRadialGradient) return null;
      const m = S / 2;
      c.clearRect(0, 0, S, S);
      const g = c.createRadialGradient(m, m, 0, m, m, m);
      g.addColorStop(0, 'rgba(120,200,255,0.10)'); g.addColorStop(0.75, 'rgba(120,200,255,0.18)'); g.addColorStop(0.97, 'rgba(170,230,255,0.55)'); g.addColorStop(1, 'rgba(170,230,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(m, m, m, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(190,236,255,0.55)';
      for (let i = 1; i <= 6; i++) { c.lineWidth = i === 6 ? 3 : 1.4; c.beginPath(); c.arc(m, m, (m - 2) * (i / 6), 0, Math.PI * 2); c.stroke(); }
      c.lineWidth = 1.2;
      for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; c.beginPath(); c.moveTo(m + Math.cos(a) * m * 0.17, m + Math.sin(a) * m * 0.17); c.lineTo(m + Math.cos(a) * (m - 2), m + Math.sin(a) * (m - 2)); c.stroke(); }
      t.hasAlpha = true;
      t.update();
      grid = t;
      return t;
    } catch { return null; }
  }
  function disposeSel(sel) {
    if (!sel) return;
    for (const m of [sel.disc, sel.edge, sel.scan]) { if (m.material) m.material.dispose(false, false); m.dispose(); }
    sel.root.dispose();
  }

  // ------------------------------------------------------------------ sound: a soft working hum, chimes
  let hum = null;
  function ac() { try { return H.audio && H.audio.context && H.audio.master ? H.audio.context : null; } catch { return null; } }
  function startHum() {
    const a = ac();
    if (!a || hum) return;
    try {
      const out = a.createGain(); out.gain.value = 0; out.connect(H.audio.master);
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.connect(out);
      const o1 = a.createOscillator(); o1.type = 'sine'; o1.frequency.value = 196;
      const o2 = a.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 293.7;
      const lfo = a.createOscillator(); lfo.frequency.value = 0.35;
      const lfoG = a.createGain(); lfoG.gain.value = 0.012;
      lfo.connect(lfoG).connect(out.gain);
      o1.connect(lp); o2.connect(lp);
      for (const o of [o1, o2, lfo]) o.start();
      out.gain.setTargetAtTime(0.028, a.currentTime, 0.4);
      hum = { out, oscs: [o1, o2, lfo] };
    } catch { hum = null; }
  }
  function stopHum() {
    if (!hum) return;
    const h = hum; hum = null;
    try { const a = ac(), t = a.currentTime; h.out.gain.cancelScheduledValues(t); h.out.gain.setTargetAtTime(0, t, 0.25); for (const o of h.oscs) o.stop(t + 1.5); setTimeout(() => { try { h.out.disconnect(); } catch { /* gone */ } }, 1800); } catch { /* gone */ }
  }
  /** A chime: rising (a beat), a soft tick (a thing arrived), a chord (done) or a low fall (stopped). */
  function chime(kind) {
    const a = ac();
    if (!a) return;
    try {
      const t = a.currentTime;
      const notes = kind === 'done' ? [523.3, 659.3, 784, 1046.5] : kind === 'beat' ? [587.3, 880] : kind === 'stop' ? [392, 293.7] : [1318.5];
      const gain = kind === 'tick' ? 0.035 : 0.06;
      notes.forEach((f, i) => {
        const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = a.createGain(); const t0 = t + i * (kind === 'done' ? 0.09 : 0.07);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + (kind === 'done' ? 1.4 : 0.6));
        o.connect(g).connect(H.audio.master); o.start(t0); o.stop(t0 + 1.6);
      });
    } catch { /* no sound */ }
  }

  // ------------------------------------------------------------------ the work pill
  const CSS = `
.ov-work{position:fixed;right:12px;top:64px;transform:translateY(-8px);z-index:40;min-width:240px;max-width:min(360px,calc(100vw - 32px));
  padding:9px 14px 10px 12px;border-radius:16px;background:rgba(8,14,28,.78);border:1px solid rgba(143,216,255,.35);box-shadow:0 0 24px rgba(143,216,255,.18),0 6px 22px rgba(0,0,0,.35);
  color:#e8f6ff;font:500 13px/1.3 Inter,system-ui,sans-serif;display:grid;grid-template-columns:auto 1fr auto;gap:2px 10px;align-items:center;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;backdrop-filter:blur(6px)}
.ov-work.on{opacity:1;transform:translateY(0)}
.ov-work .orb{grid-row:1/3;width:22px;height:22px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#bfeaff 35%,#4fb8ee 70%,rgba(79,184,238,0) 72%);box-shadow:0 0 12px #8fd8ff;animation:ovw-breathe 1.6s ease-in-out infinite}
.ov-work .t{font-weight:600;letter-spacing:.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ov-work .b{grid-column:2/3;color:#a9dcff;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:15px}
.ov-work .s{grid-row:1/3;grid-column:3;display:flex;flex-direction:column;align-items:flex-end;gap:3px;font:500 11px/1 "JetBrains Mono",ui-monospace,monospace;color:#8fb7d4}
.ov-work .arrow{width:14px;height:14px;display:none;color:#8fd8ff;transition:transform .2s}
.ov-work .dots{grid-column:1/4;display:flex;gap:4px;margin-top:5px}
.ov-work .dots i{flex:1;height:3px;border-radius:2px;background:rgba(143,216,255,.18);overflow:hidden;position:relative}
.ov-work .dots i.done{background:#8fd8ff}
.ov-work .dots i.now::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#8fd8ff,transparent);animation:ovw-run 1.1s linear infinite}
.ov-work .bar{grid-column:1/4;height:2px;margin-top:6px;border-radius:2px;background:rgba(143,216,255,.15);overflow:hidden;position:relative}
.ov-work .bar::after{content:"";position:absolute;top:0;bottom:0;width:35%;background:linear-gradient(90deg,transparent,#8fd8ff,transparent);animation:ovw-sweep 1.4s ease-in-out infinite}
.ov-work.done .orb{animation:none;background:radial-gradient(circle at 35% 35%,#fff,#c9ffd9 40%,#3ccf7a 72%,rgba(60,207,122,0) 74%);box-shadow:0 0 12px #6fe6a0}
.ov-work.done .bar::after,.ov-work.done .dots i.now::after{animation:none;opacity:0}
.ov-work.stopped .orb{animation:none;filter:grayscale(1);opacity:.7}
.tl-zone .ov-work{position:relative;right:auto;top:auto;transform:none;min-width:0;width:100%}
@keyframes ovw-breathe{0%,100%{transform:scale(.88);box-shadow:0 0 8px #8fd8ff}50%{transform:scale(1.08);box-shadow:0 0 18px #bfeaff}}
@keyframes ovw-run{from{transform:translateX(-100%)}to{transform:translateX(100%)}}
@keyframes ovw-sweep{0%{left:-35%}100%{left:100%}}
@media (prefers-reduced-motion:reduce){.ov-work .orb,.ov-work .bar::after,.ov-work .dots i.now::after{animation:none}}`;
  function makePill() {
    if (typeof document === 'undefined' || !document.body) return null;
    if (!document.getElementById('ov-work-css')) { const st = document.createElement('style'); st.id = 'ov-work-css'; st.textContent = CSS; document.head.appendChild(st); }
    const el = document.createElement('div');
    el.className = 'ov-work';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<span class="orb" aria-hidden="true"></span><span class="t">The Overseer is working</span><span class="s"><span class="sec">0s</span><svg class="arrow" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1 L12 9 H8.5 V13 H5.5 V9 H2 Z" fill="currentColor"/></svg></span><span class="b"></span><span class="dots" hidden></span><span class="bar"></span>';
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    return { el, t: el.querySelector('.t'), b: el.querySelector('.b'), sec: el.querySelector('.sec'), arrow: el.querySelector('.arrow'), dots: el.querySelector('.dots'), shownSec: -1 };
  }
  function pillDots(p, total, now) {
    if (!p || !total) return;
    p.dots.hidden = false;
    if (p.dots.childElementCount !== total) p.dots.innerHTML = '<i></i>'.repeat(total);
    [...p.dots.children].forEach((d, i) => { d.className = i < now - 1 ? 'done' : i === now - 1 ? 'now' : ''; });
  }
  function removePill(p, after) {
    if (!p) return;
    setTimeout(() => { p.el.classList.remove('on'); setTimeout(() => p.el.remove(), 400); }, after);
  }

  // ------------------------------------------------------------------ beams
  /** How many beams sweep the work: more for a bigger area (fewer on a phone). */
  const beamCount = (r) => (PHONE ? (r > 20 ? 2 : 1) : r > 60 ? 4 : r > 14 ? 3 : 2);
  function syncBeams(s) {
    const want = beamCount(s.radius);
    while (s.beams.length > want) { const b = s.beams.pop(); if (b && b.end) b.end(false); }
    while (s.beams.length < want && H.overseer && H.overseer.beam) {
      const b = H.overseer.beam(beamSpot(s, s.beams.length, want), { hold: true, radius: clamp(s.radius * 0.12, 1, 9), sound: s.beams.length === 0 });
      if (!b) break;
      s.beams.push(b);
    }
  }
  /** Where beam i of n points now: circling the area, each on its own orbit and speed. */
  function beamSpot(s, i, n) {
    const a = s.t * (0.55 + i * 0.17) + (i / Math.max(1, n)) * Math.PI * 2;
    const r = s.radius * (n === 1 ? 0.25 : 0.35 + 0.25 * Math.sin(s.t * 0.7 + i * 1.9));
    const c = s.at;
    const up = upAt(c);
    // Two directions across the ground at the center.
    let ax = [1, 0, 0];
    if (Math.abs(up[0]) > 0.9) ax = [0, 0, 1];
    const d1 = norm(cross(up, ax)), d2 = cross(up, d1);
    return [c[0] + (d1[0] * Math.cos(a) + d2[0] * Math.sin(a)) * r, c[1] + (d1[1] * Math.cos(a) + d2[1] * Math.sin(a)) * r, c[2] + (d1[2] * Math.cos(a) + d2[2] * Math.sin(a)) * r];
  }
  /** A beam never comes down on the player (inside one, the screen goes white): pushed out to 6 m from them. */
  function clearOf(p, me) {
    if (!me) return p;
    const d = [p[0] - me[0], p[1] - me[1], p[2] - me[2]];
    const up = upAt(me);
    const h = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    const flat = [d[0] - up[0] * h, d[1] - up[1] * h, d[2] - up[2] * h];
    const len = Math.hypot(flat[0], flat[1], flat[2]);
    if (len >= 6) return p;
    const dir = len > 0.01 ? flat.map((v) => v / len) : norm(cross(up, [1, 0, 0]));
    return [me[0] + dir[0] * 6 + up[0] * h, me[1] + dir[1] * 6 + up[1] * h, me[2] + dir[2] * 6 + up[2] * h];
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  // ------------------------------------------------------------------ the session
  function begin(o = {}) {
    const w = W();
    if (!w || !w.scene) return null;
    if (S && !S.ended) { // asked again before the last ended: keep the show, refocus
      if (o.at) focus({ at: o.at, radius: o.radius, area: o.area, local: o.local });
      return S;
    }
    if (S) { if (S.sel && S.sel.disc.getScene() === w.scene && !S.sel.disc.isDisposed()) finish(S, true); else if (S.pill) removePill(S.pill, 0); S = null; }
    const at0 = o.at ? (o.local ? o.at : local(o.at)) : lookPoint() || playerAt();
    if (!at0) return null;
    S = {
      t: 0, wall: 0, born: performance.now(), at: ground(at0), want: null, radius: 6, wantR: num(o.radius, 6), area: o.area || 'area',
      beams: [], sel: makeSel(w.scene), pill: makePill(), beats: [], beat: 0, plan: null, ops: 0, ended: false, endT: 0, flareT: 0, text: String(o.text || ''),
    };
    syncBeams(S);
    if (H.overseer) { if (H.overseer.attend) H.overseer.attend(30); if (H.overseer.flare) H.overseer.flare(1); }
    startHum();
    chime('beat');
    if (S.pill) S.pill.b.textContent = S.text ? `“${S.text.length > 60 ? `${S.text.slice(0, 57)}…` : S.text}”` : 'Listening…';
    emit('workStart', { at: S.at.slice() });
    return S;
  }
  /** The work moves: the beams and the selection glide to a new place and size. */
  function focus(o = {}) {
    if (!S || S.ended) begin({ at: o.at, local: o.local, radius: o.radius, area: o.area });
    if (!S) return;
    let at = o.at ? (o.local ? o.at : local(o.at)) : null;
    if (!at && o.area === 'player') at = playerAt();
    if (!at) return;
    S.area = o.area || S.area;
    S.follow = S.area === 'player' || S.area === 'ui' || S.area === 'sound';
    S.want = S.area === 'sky' ? at : ground(at);
    S.wantR = clamp(num(o.radius, S.radius), 2, 300);
    S.sel.burst = 1;
    if (H.overseer && H.overseer.flare) H.overseer.flare(0.6);
  }
  function plan(o = {}) {
    if (!S) begin({});
    if (!S) return;
    if (Array.isArray(o.beats) && o.beats.length) { S.plan = o.beats.slice(0, 6); renderBeat(); }
    if (o.at) focus({ at: o.at, radius: o.radius, area: o.area });
    else if (o.radius) S.wantR = clamp(num(o.radius, S.radius), 2, 300);
    if (o.say) say({ text: o.say });
  }
  function beat(o = {}) {
    if (!S) begin({});
    if (!S) return;
    S.beat = Math.max(S.beat + 1, num(o.n, S.beat + 1));
    S.beats.push(String(o.title || ''));
    for (const b of S.beams) if (b && b.pulse) b.pulse(1.2);
    if (H.overseer && H.overseer.flare) H.overseer.flare(0.8);
    S.sel.burst = 1;
    chime('beat');
    renderBeat();
    emit('workBeat', { n: S.beat, title: S.beats[S.beats.length - 1] });
  }
  function renderBeat() {
    const p = S && S.pill;
    if (!p) return;
    const title = S.beats[S.beats.length - 1];
    if (title) p.b.textContent = title;
    else if (S.plan && S.plan[0] && !S.beat) p.b.textContent = `Next: ${S.plan[0]}`;
    const total = Math.max(S.plan ? S.plan.length : 0, S.beat);
    if (total > 1) pillDots(p, total, Math.max(1, S.beat));
  }
  function say(o = {}) {
    const text = String(o.text || '').trim();
    if (!text) return;
    if (o.who) {
      if (H.chat) H.chat.line({ kind: 'npc', who: String(o.who).slice(0, 40), text, color: '#ffcf6b', keep: 20 });
      if (S) for (const b of S.beams) if (b && b.pulse) b.pulse(0.4);
    } else if (H.overseer && H.overseer.say) H.overseer.say(text, Math.max(2.5, text.length / 16), { priority: 'normal', owner: 'work' });
  }
  function op() {
    if (!S) return;
    S.ops++;
    const b = S.beams[S.ops % Math.max(1, S.beams.length)];
    if (b && b.pulse) b.pulse(0.7);
    if (S.ops % 2 === 0) chime('tick');
  }
  function end(o = {}) {
    if (!S || S.ended) return;
    const ok = o.ok !== false;
    S.ended = true; S.endT = S.t; S.ok = ok;
    for (const b of S.beams) if (b && b.end) b.end(ok);
    S.beams = [];
    stopHum();
    chime(ok ? 'done' : 'stop');
    if (ok && G() && G().burst) try { G().burst([S.at[0], S.at[1] + 0.6, S.at[2]], { color: '#e8f6ff', count: PHONE ? 20 : 48, speed: 6 }); } catch { /* fine */ }
    const p = S.pill;
    if (p) {
      p.el.classList.add(ok ? 'done' : 'stopped');
      p.t.textContent = ok ? 'Done' : 'Stopped';
      if (ok && S.plan) pillDots(p, Math.max(S.plan.length, S.beat), Math.max(S.plan.length, S.beat) + 1);
      if (!ok) p.b.textContent = o.why || 'What was already built stays.';
      removePill(p, ok ? 2600 : 4000);
      S.pill = null;
    }
    emit('workEnd', { ok, ops: S.ops, beats: S.beat });
  }
  function finish(s, now) {
    for (const b of s.beams) if (b && b.kill) b.kill();
    s.beams = [];
    disposeSel(s.sel);
    s.sel = null;
    if (s.pill) { removePill(s.pill, 0); s.pill = null; }
    if (now) stopHum();
  }
  function emit(name, data) { const g = G(); if (g && g.emit) try { g.emit(name, data); } catch { /* a listener's own */ } }

  // Every frame: the area glides to where the work is, the beams circle it, the ground glows and scans.
  H.hooks.frame.push((elapsed) => {
    const s = S;
    if (!s) return;
    const w = W();
    // A new world (a reload, another game): what this held went with the old one.
    if (!w || !w.scene || (s.sel && (s.sel.disc.isDisposed() || s.sel.disc.getScene() !== w.scene))) { if (s.pill) removePill(s.pill, 0); if (S === s) S = null; stopHum(); return; }
    const dt = Math.min(0.1, Math.max(0, Number(elapsed) || 0.016));
    s.t += dt;
    s.wall = (performance.now() - s.born) / 1000; // the real time (the game may be paused behind a sheet)
    if (!s.ended && s.wall > MAX_SECONDS) end({ ok: false, why: 'That took too long; I stopped watching.' });
    if (s.follow && !s.ended) { const p = playerAt(); if (p) s.want = p; }
    if (s.want) {
      const k = 1 - Math.exp(-dt * 2.2);
      s.at = s.at.map((v, i) => v + (s.want[i] - v) * k);
    }
    s.radius += (s.wantR - s.radius) * (1 - Math.exp(-dt * 1.8));
    // The beams: circling, and the Overseer keeps attending while it works.
    if (!s.ended) {
      syncBeams(s);
      const me = playerAt();
      s.beams.forEach((b, i) => { if (b && b.move) b.move(clearOf(beamSpot(s, i, s.beams.length), me)); });
      if ((s.flareT += dt) > 1.3) { s.flareT = 0; if (H.overseer) { if (H.overseer.flare) H.overseer.flare(0.25); if (H.overseer.attend) H.overseer.attend(4); } }
    }
    // The selection.
    const sel = s.sel;
    if (sel) {
      const fadeIn = smooth(0, 0.35, s.t);
      const fadeOut = s.ended ? 1 - smooth(s.endT, s.endT + 0.9, s.t) : 1;
      const k = fadeIn * fadeOut;
      sel.burst = Math.max(0, sel.burst - dt * 1.6);
      const up = upAt(s.at);
      sel.root.position.set(s.at[0] + up[0] * 0.12, s.at[1] + up[1] * 0.12, s.at[2] + up[2] * 0.12);
      const q = new B.Quaternion();
      B.Quaternion.FromUnitVectorsToRef(B.Axis.Y, v3(up), q);
      sel.root.rotationQuaternion = q;
      const r = s.radius;
      sel.disc.scaling.set(r, r, r);
      sel.disc.material.alpha = (0.55 + 0.2 * Math.sin(s.t * 3) + sel.burst * 0.45) * k;
      sel.disc.rotation.z = s.t * 0.15; // the hologram turns slowly (round its own axis)
      sel.edge.scaling.set(r, Math.max(1, r * 0.05), r);
      sel.edge.material.alpha = (0.55 + 0.25 * Math.sin(s.t * 4) + sel.burst * 0.4) * k;
      sel.scanT = (sel.scanT + dt / 1.6) % 1;
      const sr = r * Math.max(0.02, sel.scanT);
      sel.scan.scaling.set(sr, Math.max(1, r * 0.04), sr);
      sel.scan.material.alpha = (1 - sel.scanT) * 0.7 * k;
      if (s.ended && s.t > s.endT + 1) { finish(s, false); if (S === s) S = null; return; }
    }
    // The pill: seconds so far, and an arrow toward the work when it isn't in view.
    const p = s.pill;
    if (p) {
      const sec = Math.floor(s.wall);
      // While it thinks (no beat to show yet) the headline changes every few seconds: it is a character at work, not a spinner.
      if (!s.ended && H.reactions && sec !== p.shownSec && (sec === 0 || (sec % 4 === 0 && !s.beats.length))) p.t.textContent = `${H.reactions.think()}…`;
      if (sec !== p.shownSec) { p.shownSec = sec; p.sec.textContent = `${sec}s`; }
      const cam = w && w.scene && w.scene.activeCamera;
      if (cam) {
        const to = v3(s.at).subtract(cam.globalPosition || cam.position);
        const f = cam.getDirection(B.Axis.Z), rt = cam.getDirection(B.Axis.X);
        const ahead = B.Vector3.Dot(to.normalize(), f);
        if (ahead > 0.82) p.arrow.style.display = 'none';
        else {
          p.arrow.style.display = 'block';
          const ang = Math.atan2(B.Vector3.Dot(to, rt), B.Vector3.Dot(to, f));
          p.arrow.style.transform = `rotate(${ang}rad)`;
        }
      }
    }
  });
  // A round world: what this keeps follows the frame when it moves under the player.
  if (H.planet && H.planet.frame && H.planet.frame.onRebase) H.planet.frame.onRebase((tr) => {
    if (!S) return;
    S.at = tr.point(S.at);
    if (S.want) S.want = tr.point(S.want);
  });

  /** One event from the server (src/overseer-lines.ts via the live feed): { k: begin|plan|focus|beat|say|op|file|end, ... }. */
  function handle(m) {
    if (!m || typeof m !== 'object') return;
    try {
      switch (m.k) {
        case 'begin': return void begin({ at: m.at, text: m.text });
        case 'plan': return plan(m);
        case 'focus': return focus({ at: m.at, radius: m.radius, area: m.area });
        case 'beat': return beat(m);
        case 'say': return say(m);
        case 'op': return op(m);
        case 'file': if (S && S.pill) S.pill.b.textContent = `Writing ${String(m.path || '').replace(/^.*\//, '')}`; return;
        // How a thing should look is the player's choice (modules/looks): the chooser opens when the build is done.
        case 'look': lookOffer = { id: m.id, prompt: m.prompt, suggest: m.suggest, why: m.why }; if (S && S.pill) S.pill.b.textContent = 'Choose how it looks'; return;
        case 'end': {
          end(m);
          const o = lookOffer;
          lookOffer = null;
          if (o && m.ok !== false && H.looks) setTimeout(() => { try { H.looks.offer(o); } catch (err) { if (H.report) H.report(err, 'work'); } }, 900);
          return;
        }
      }
    } catch (err) { if (H.report) H.report(err, 'work'); }
  }

  H.work = {
    begin, focus, plan, beat, say, op, end, handle,
    /** True while the Overseer is working on a request (the ground reshapes in steps then: terrain.js). */
    get active() { return Boolean(S && !S.ended); },
    /** A sample for tests and the playtest: where, how big, beams, the pill's text, beats, things arrived. */
    state() { return S ? { at: S.at.slice(), radius: S.radius, area: S.area, beams: S.beams.length, beat: S.beat, beats: S.beats.slice(), plan: S.plan, ops: S.ops, ended: S.ended, pill: S.pill ? S.pill.b.textContent : null, headline: S.pill ? S.pill.t.textContent : null } : null; },
    /** A pulse from elsewhere (the terrain's steps). */
    pulse(k = 1) { if (!S) return; S.sel.burst = Math.max(S.sel.burst, k); for (const b of S.beams) if (b && b.pulse) b.pulse(k); if (H.overseer && H.overseer.flare) H.overseer.flare(0.4 * k); },
  };
  // The editor page sends the server's events in (build.js forwards `overseer-work`); the island calls H.work itself.
  if (typeof window !== 'undefined') window.addEventListener('message', (ev) => {
    const m = ev.data || {};
    if (ev.source !== window.parent || m.type !== 'overseer-work') return;
    if (m.k === 'begin' && !m.at && m.local !== false) { begin({ text: m.text }); return; } // the instant one: what they look at here
    handle(m);
  });
})();
