// The mirror: where you become who you are. In front of a mirror (E, or by itself when a player arrives: its
// shape.character.start), the player is stood facing it, the camera looks over their shoulder at the reflection, and
// the Overseer asks the mirror's questions one at a time (mirror-core.js STEPS): "What are you?" (an animal, a robot, a
// shoe...: presence's WHATS), "How do you look?" (colors, size, hat, face, extras), "What are you called?", and if the
// mirror asks it, "How do you see the world?" (first or third person, for this game). Every choice shows on the
// reflection at once and is the player's look (H.presence.setLook: saved to the account, sent to the room).
// Then the Overseer names them, and the game hears game.on('mirror', { state: 'done', what, name }).
// While building, a mirror's card has 🪞 Character mirror: its questions, who players may be, whether it opens by itself.
// game.mirror (scripts): open(mirror?), dress() (anywhere, no mirror), close(), isOpen, pending, step.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = (H.mirror = H.mirror || {});
  const MC = M.core;
  const W = () => H.world;
  const G = () => H.game;
  const PR = () => H.presence;
  const PC = () => (H.presence && H.presence.core) || null;

  // ------------------------------------------------------------------ remembering: first time, and the chosen view
  const store = {
    get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* a sandboxed page */ } },
  };
  const gameKey = () => { const b = H.bundle || {}; return String(b.id || b.slug || b.template || location.pathname).slice(0, 80); };
  const seenKey = () => `hg_mirror_seen:${gameKey()}`;
  const viewKey = () => `hg_mirror_view:${gameKey()}`;
  const seenOnPage = new Set();

  // ------------------------------------------------------------------ the mirrors in the world
  const configOf = (e) => MC.cleanConfig(e ? e._mirrorSpec : undefined);
  const mirrors = () => (W() ? [...W().entities].filter((e) => e.alive && e.kind === 'mirror' && !configOf(e).off) : []);
  const playing = () => H.mode !== 'build' && !H.hooks.codex;
  function nearestMirror(p, reach) {
    let best = null, bd = Infinity;
    for (const e of mirrors()) {
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < bd && (reach == null || d <= configOf(e).reach + (e._mirrorW || 2) / 2)) { bd = d; best = e; }
    }
    return best;
  }
  /** The mirror that opens by itself for this player now (its start says so and they haven't seen it, or "always"). */
  function autoMirror() {
    if (!playing() || !W() || !W().player) return null;
    for (const e of mirrors()) {
      const c = configOf(e);
      if (c.start === 'always') return e;
      if (c.start === 'first' && !store.get(seenKey()) && !seenOnPage.has(gameKey())) return e;
    }
    return null;
  }

  // ------------------------------------------------------------------ the Overseer's words
  // One line at a time, in order: each waits for the one before it to end (its voice, else time to read it). A newer
  // question replaces one still waiting, and so does a newer remark (they moved on): nothing piles up or overlaps.
  const lines = [];
  let speaking = null; // { audio, timer, wait }
  /** The Overseer says it: words on screen, and its voice when the game has the line (the starter pack's
   *  "overseer-mirror-*", by name). delay: ms before the voice (a caption that starts with words it doesn't say).
   *  kind: 'step' (a question), 'react' (a remark on a choice), or 'line'. */
  function narrate(text, file, seconds, delay = 0, kind = 'line') {
    const g = G();
    if (!g || !session || !session.cfg.voice) return;
    if (kind !== 'line') for (let i = lines.length - 1; i >= 0; i--) if (lines[i].kind === kind || (kind === 'step' && lines[i].kind === 'react')) lines.splice(i, 1);
    lines.push({ text, file, seconds, delay, kind });
    speak();
  }
  /** Quiet now: what's being said stops, what's waiting is dropped. */
  function hush() {
    lines.length = 0;
    if (!speaking) return;
    clearTimeout(speaking.timer); clearTimeout(speaking.wait);
    try { if (speaking.audio) speaking.audio.pause(); } catch { /* gone */ }
    speaking = null;
  }
  function speak() {
    if (speaking || !lines.length) return;
    const g = G();
    if (!g) { lines.length = 0; return; }
    const it = lines.shift();
    const read = it.seconds || Math.max(2.6, Math.min(8, it.text.length / 12));
    if (g.overseer && g.overseer.say) g.overseer.say(it.text, read + 1.5);
    const cur = (speaking = { audio: null, timer: null, wait: null });
    const next = () => { if (speaking !== cur) return; clearTimeout(cur.timer); speaking = null; setTimeout(speak, 350); };
    // (The game's own asset by that name, else the Overseer's own line from the community library: overseer.js.)
    const url = !it.file ? null : H.overseer && H.overseer.voiceUrl ? H.overseer.voiceUrl(it.file) : g.hasAsset && g.hasAsset(it.file) && g.asset ? g.asset(it.file) : null;
    // No voice for it: long enough to read before the next one.
    if (!url || typeof Audio === 'undefined') { cur.timer = setTimeout(next, Math.min(read, 2.6) * 1000); return; }
    cur.wait = setTimeout(() => {
      if (speaking !== cur) return;
      try {
        const a = new Audio(url);
        a.crossOrigin = 'anonymous';
        if (H.audio && H.audio.media) H.audio.media(a);
        if (H.overseer && H.overseer.duckWhile) H.overseer.duckWhile(a); // (the music dips while it speaks)
        cur.audio = a;
        a.onended = next;
        // A voice that won't play: the words stay up long enough to read, as with no voice.
        a.onerror = () => { clearTimeout(cur.timer); cur.timer = setTimeout(next, Math.min(read, 2.6) * 1000); };
        const pr = a.play();
        if (pr && pr.catch) pr.catch(() => { clearTimeout(cur.timer); cur.timer = setTimeout(next, read * 1000); });
        cur.timer = setTimeout(next, 15000); // (a voice that never says it ended)
      } catch { cur.timer = setTimeout(next, read * 1000); }
    }, it.delay || 0);
  }

  // ------------------------------------------------------------------ the session: in front of the mirror
  let session = null;
  let pending = false;
  let reactT = null;
  const look = () => (PR() && PR().look) || (PC() ? PC().cleanLook({}) : {});
  const setLook = (part) => {
    if (PR() && PR().setLook) PR().setLook(part);
    refreshReflection();
    // Anywhere, the picture follows their size (a shoe needs the camera lower than a horse).
    if (session && !session.mirror && (part.what || part.shape)) {
      // Now, and again once the new body is drawn (next frames), measured.
      try { stage(session.p, null); } catch { /* keeps it */ }
      setTimeout(() => { if (session && !session.mirror) try { stage(session.p, null); } catch { /* keeps it */ } }, 150);
    }
    render();
  };
  function refreshReflection() { if (session && session.mirror) session.mirror._mirrorFast = true; }

  /** The camera to a shot: at once, or (glide) from wherever it is now, eased over a second and a half (from the
   *  intro's last shot, or from behind the player, to the reflection). */
  let glideObs = null;
  function stopGlide() { const w = W(); if (glideObs && w) w.scene.onBeforeRenderObservable.remove(glideObs); glideObs = null; }
  function shot(pos, at, glide) {
    const w = W();
    stopGlide();
    const cam = w.camera.babylon;
    if (!glide || !cam || !cam.getTarget) return w.camera.internal(() => w.camera.api.fixed(pos, at));
    const p0 = cam.position.clone(), t0 = cam.getTarget().clone();
    const p1 = new B.Vector3(pos[0], pos[1], pos[2]), t1 = new B.Vector3(at[0], at[1], at[2]);
    const start = performance.now(), ms = 1500;
    const put = (k) => { const a = B.Vector3.Lerp(p0, p1, k), b = B.Vector3.Lerp(t0, t1, k); w.camera.internal(() => w.camera.api.fixed([a.x, a.y, a.z], [b.x, b.y, b.z])); };
    put(0);
    glideObs = w.scene.onBeforeRenderObservable.add(() => {
      let k = Math.min(1, (performance.now() - start) / ms);
      k = k * k * (3 - 2 * k);
      put(k);
      if (k >= 1) stopGlide();
    });
  }

  /** Stands the player in front of the mirror, facing it; the camera over their shoulder, looking at the reflection. */
  function stage(p, e, glide) {
    const w = W();
    if (!e) {
      // Anywhere (dressing up without a mirror): the camera a few meters off, on the first side with nothing in the
      // way (in front of them, else behind, else either side), and they turn to face it.
      const yaw0 = w.camera.yaw || 0, D = 3.4;
      const chest = new B.Vector3(p.x, p.y + 0.4, p.z);
      const mine = (m) => { let n = m; while (n) { if (n === p.node) return true; n = n.parent; } return false; };
      let yaw = yaw0;
      for (const a of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
        const d = new B.Vector3(Math.sin(yaw0 + a), 0.12, Math.cos(yaw0 + a)).normalize();
        const hit = w.scene.pickWithRay(new B.Ray(chest, d, D + 0.4), (m) => m.isPickable && m.isEnabled() && m.isVisible && !mine(m) && !(m.metadata && m.metadata.decor));
        if (!hit || !hit.hit) { yaw = yaw0 + a; break; }
      }
      const f = [Math.sin(yaw), Math.cos(yaw)];
      w.camera.yaw = yaw; // facing the camera: we see their front
      p.node.rotation.y = yaw;
      // Framed to their size now (a potato is not a horse, a dinosaur is long): the body as drawn, when it is.
      const C = PC(), lk = look();
      const sz = (C && C.LOOK.sizes[lk.shape]) || [1, 1, 1];
      let h = ((C && C.WHAT.get(lk.what)) || { h: 1.8 }).h * sz[1], deep = h * 0.5;
      const rig = PR() && PR()._internal && PR()._internal.rigs.get(p);
      if (rig && rig.root && rig.what === lk.what) {
        try { const bb = rig.root.getHierarchyBoundingVectors(true); h = Math.max(0.3, bb.max.y - bb.min.y); deep = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z); } catch { /* the catalog's */ }
      }
      const feet = p.y - 0.9;
      const dist = 1.5 + Math.max(h * 1.05, deep * 1.2);
      const lean = window.innerWidth < 700 ? 0 : 0.3 + dist * 0.12;
      shot([p.x + f[0] * dist, feet + h * 0.8 + 0.4, p.z + f[1] * dist], [p.x - Math.cos(yaw) * lean, feet + h * 0.5, p.z + Math.sin(yaw) * lean], glide);
      return;
    }
    e.node.computeWorldMatrix(true);
    const fw = e.node.forward; // the side the glass faces
    const f = new B.Vector3(fw.x, 0, fw.z);
    if (f.lengthSquared() < 1e-6) f.set(0, 0, 1);
    f.normalize();
    const right = new B.Vector3(f.z, 0, -f.x);
    const m = e.node.getAbsolutePosition();
    const ground = m.y - (e._mirrorH || 3) / 2;
    const stand = m.add(f.scale(2.3));
    p.position = [stand.x, ground + 0.95, stand.z];
    p.velocity = [0, 0, 0];
    const yaw = Math.atan2(-f.x, -f.z); // facing the mirror
    w.camera.yaw = yaw; w.camera.pitch = 0;
    p.node.rotation.y = yaw;
    // Over the shoulder, far enough to see all of you and all of the glass. The questions sit on the right (at the
    // bottom on a phone), so the picture leans the other way to keep the reflection clear of them.
    const phone = typeof window !== 'undefined' && window.innerWidth < 700;
    const side = phone ? 0.35 : 0.8, aim = phone ? 0.15 : 1.0;
    const cam = stand.add(f.scale(phone ? 3.9 : 3.3)).add(right.scale(side));
    // (On a phone the questions take the bottom: the camera looks down a little more, so the glass sits up top.)
    shot([cam.x, ground + (phone ? 2.6 : 2.25), cam.z], [m.x + right.x * aim, ground + (phone ? -0.35 : 1.1), m.z + right.z * aim], glide);
  }

  /** A sharper reflection while someone's in front of it (it's the picture they're looking at), the usual one after. */
  function sharpen(e, on) {
    try {
      const mesh = e.node.getChildMeshes(true).find((m) => m.name === 'mirror-surface');
      const tex = mesh && mesh.material && mesh.material.reflectionTexture;
      if (!tex || !tex.resize) return;
      const want = on ? (H.device && H.device.tier === 'phone' ? 512 : 1024) : 512;
      if (tex.getSize().width !== want) tex.resize(want);
    } catch { /* keeps its size */ }
  }
  /** Opens the questions at a mirror (or, with no mirror, anywhere). o: { auto, cfg (preview settings), anywhere }. */
  function open(e, o = {}) {
    const w = W(), g = G();
    if (session || !w || !w.player || !w.player.alive) return false;
    if (!e && !o.anywhere) e = nearestMirror(w.player);
    if (!e && !o.anywhere) return false;
    const cfg = o.cfg ? MC.cleanConfig(o.cfg) : e ? configOf(e) : MC.cleanConfig({ steps: ['what', 'look', 'name'], voice: false });
    if (cfg.off) return false;
    const p = w.player;
    session = { mirror: e || null, cfg, steps: cfg.steps.slice(), i: 0, auto: Boolean(o.auto), p, saved: { controls: p.controls, view: p._view || 'first', flying: p.flying }, view: null, before: JSON.stringify(look()) };
    pending = false;
    p.controls = false;
    if (H.mode !== 'build') p.flying = false;
    p._mirrorShow = true;
    hush();
    try { stage(p, e, true); } catch (err) { H.report(err, 'mirror'); }
    if (e) { e._mirrorFast = true; sharpen(e, true); }
    try { if (g && g.input && g.input.release) g.input.release(); } catch { /* fine */ }
    show();
    emit({ state: 'open', auto: session.auto });
    // (Arriving, the Overseer's first words come before the first question: the queue keeps them in order.)
    if (session.auto && cfg.voice) narrate(MC.OPEN.say, MC.OPEN.voice, 3.2);
    go(0);
    return true;
  }
  /** Ends it: the look stays (it's set as you choose), the camera and controls come back, the Overseer names you. */
  function finish(skipped) {
    if (!session) return;
    const s = session, p = s.p, g = G();
    const lk = look();
    hide();
    clearTimeout(reactT);
    stopGlide();
    // Whatever was still to be said about the questions is dropped; done, the Overseer has the last word.
    if (skipped) hush(); else for (let i = lines.length - 1; i >= 0; i--) if (lines[i].kind !== 'line') lines.splice(i, 1);
    p._mirrorShow = false;
    if (s.mirror) { s.mirror._mirrorFast = false; sharpen(s.mirror, false); }
    if (p.alive) {
      p.controls = s.saved.controls !== false;
      if (H.mode === 'build') p.flying = s.saved.flying;
      const view = s.view || s.saved.view;
      if (s.view) store.set(viewKey(), s.view);
      try { p.view = view; } catch (err) { H.report(err, 'mirror'); }
    }
    if (!skipped) {
      narrate(MC.doneLine(lk), MC.DONE.voice, 5.5, lk.name ? 1300 : 900, 'line');
      try { if (g && g.burst) { g.burst([p.x, p.y + 1.2, p.z], { color: '#ffd84a', count: 40, speed: 5, size: 0.2 }); g.burst([p.x, p.y + 1.5, p.z], { color: '#7dd3fc', count: 30, speed: 4.5, size: 0.18 }); } } catch { /* no fx */ }
      try { if (g && g.hasAsset && g.hasAsset('level-up.mp3')) g.sound('level-up.mp3', { volume: 0.45 }); } catch { /* no sound */ }
    }
    seenOnPage.add(gameKey());
    store.set(seenKey(), String(Date.now()));
    session = null;
    emit({ state: skipped ? 'skip' : 'done', what: lk.what, name: lk.name || null, changed: JSON.stringify(lk) !== s.before, auto: s.auto });
  }
  function emit(d) { const g = G(); try { if (g && g.emit) g.emit('mirror', d); } catch (err) { H.report(err, 'mirror'); } }

  /** Goes to step i (0-based in this mirror's questions); past the last one, done. */
  function go(i) {
    if (!session) return;
    if (i >= session.steps.length) return finish(false);
    session.i = Math.max(0, i);
    const st = MC.STEPS.find((x) => x.id === session.steps[session.i]);
    render();
    if (st) narrate(st.say, st.voice, undefined, 0, 'step');
    emit({ state: 'step', step: st ? st.id : null });
  }

  // ------------------------------------------------------------------ on screen: the questions
  let root = null;
  /** A what's word on its card: "Dog", "TV robot". */
  const word = (w) => { const t = w.label.replace(/^(a|an) /i, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CSS = `
    .mr{position:fixed;right:max(16px,env(safe-area-inset-right));top:50%;transform:translateY(-50%);width:min(400px,calc(100vw - 32px));max-height:min(86vh,760px);display:flex;flex-direction:column;z-index:60;
      background:var(--glass,rgba(10,12,20,.78));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid var(--line,rgba(255,255,255,.12));border-radius:18px;color:var(--fg,#e8ecf6);
      font:500 15px/1.35 var(--hud,'Rajdhani','Inter',system-ui,sans-serif);box-shadow:0 18px 60px rgba(0,0,0,.45);pointer-events:auto;animation:mr-in .35s ease-out}
    @keyframes mr-in{from{opacity:0;transform:translate(24px,-50%)}to{opacity:1;transform:translateY(-50%)}}
    .mr-top{display:flex;align-items:center;gap:8px;padding:14px 16px 4px}.mr-dots{display:flex;gap:6px}.mr-dots i{width:22px;height:5px;border-radius:3px;background:rgba(255,255,255,.18)}.mr-dots i.on{background:var(--accent,#4a9eff)}.mr-dots i.done{background:rgba(74,158,255,.5)}
    .mr-x{margin-left:auto;background:none;border:0;color:var(--fg-2,#a5acc2);font-size:22px;cursor:pointer;line-height:1;padding:2px 6px}
    .mr-q{margin:4px 16px 2px;font:700 26px/1.1 var(--display,'Orbitron','Rajdhani',sans-serif);letter-spacing:.02em}
    .mr-sub{margin:0 16px 8px;color:var(--fg-2,#a5acc2);font-size:14px}
    .mr-body{overflow:auto;padding:4px 16px 12px;flex:1}
    .mr-body h4{margin:12px 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--fg-2,#a5acc2)}
    .mr-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .mr-card{display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 4px 7px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid transparent;color:inherit;font:inherit;cursor:pointer;min-height:68px}
    .mr-card .ic{font-size:28px;line-height:1.1}.mr-card span:last-child{font-size:13px;opacity:.9;text-align:center}
    .mr-card:hover{background:rgba(255,255,255,.11)}.mr-card.on{border-color:var(--accent,#4a9eff);background:rgba(74,158,255,.18)}
    .mr-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .mr-sw{width:30px;height:30px;border-radius:50%;border:2px solid rgba(255,255,255,.25);cursor:pointer;padding:0}.mr-sw.on{border-color:#fff;box-shadow:0 0 0 2px var(--accent,#4a9eff)}
    .mr-row input[type=color]{width:34px;height:30px;border:0;background:none;padding:0;cursor:pointer}
    .mr-chip{padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}
    .mr-chip.on{border-color:var(--accent,#4a9eff);background:rgba(74,158,255,.2)}.mr-chip:hover{background:rgba(255,255,255,.12)}
    .mr-name{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:12px;border:1px solid var(--line,rgba(255,255,255,.18));background:rgba(0,0,0,.25);color:inherit;font:600 22px/1.2 var(--hud,'Rajdhani',sans-serif)}
    .mr-big{display:flex;flex-direction:column;gap:10px}.mr-big .mr-card{flex-direction:row;justify-content:flex-start;gap:12px;padding:14px;min-height:0}.mr-big .mr-card span:last-child{text-align:left;font-size:16px}
    .mr-foot{display:flex;gap:8px;padding:12px 16px 16px;border-top:1px solid var(--line,rgba(255,255,255,.1))}
    .mr-btn{padding:10px 16px;border-radius:12px;border:1px solid var(--line,rgba(255,255,255,.16));background:rgba(255,255,255,.06);color:inherit;font:600 16px/1 var(--hud,'Rajdhani',sans-serif);cursor:pointer}
    .mr-btn.go{margin-left:auto;background:var(--accent,#4a9eff);border-color:transparent;color:#05101f}.mr-btn:disabled{opacity:.4;cursor:default}
    .mr-dice{margin-top:10px}
    @media (max-width:700px){.mr{top:auto;bottom:max(10px,env(safe-area-inset-bottom));transform:none;max-height:46vh;right:10px;width:calc(100vw - 20px);animation:none}.mr-grid{grid-template-columns:repeat(4,1fr)}.mr-q{font-size:21px}}`;
  function show() {
    if (typeof document === 'undefined' || !document.body) return;
    if (!document.getElementById('mr-style')) { const st = document.createElement('style'); st.id = 'mr-style'; st.textContent = CSS; document.head.appendChild(st); }
    root = document.createElement('div');
    root.className = 'mr';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Who you are');
    // The game doesn't get the keys or clicks meant for these questions.
    for (const ev of ['keydown', 'keyup', 'keypress', 'pointerdown', 'wheel', 'mousedown', 'touchstart']) root.addEventListener(ev, (x) => { x.stopPropagation(); if (ev === 'keydown' && x.key === 'Escape') finish(true); });
    document.body.appendChild(root);
  }
  function hide() { if (root) { root.remove(); root = null; } }

  const HATS = [['none', '—', 'No hat'], ['cap', '🧢', 'Cap'], ['beanie', '🧶', 'Beanie'], ['tophat', '🎩', 'Top hat'], ['crown', '👑', 'Crown'], ['cowboy', '🤠', 'Cowboy'], ['party', '🥳', 'Party'], ['halo', '😇', 'Halo'], ['horns', '😈', 'Horns'], ['bunny', '🐰', 'Bunny ears'], ['helmet', '⛑️', 'Helmet'], ['chef', '👨‍🍳', 'Chef']];
  const FACES = [['visor', '🥽', 'Visor'], ['eyes', '👀', 'Eyes'], ['smile', '🙂', 'Smile'], ['none', '😶', 'Plain']];
  const EXTRAS = [['glasses', '👓', 'Glasses'], ['shades', '🕶️', 'Shades'], ['scarf', '🧣', 'Scarf'], ['backpack', '🎒', 'Backpack'], ['cape', '🦸', 'Cape'], ['bowtie', '🎀', 'Bow tie'], ['wings', '🪽', 'Wings'], ['tail', '🐒', 'Tail']];
  const SIZES = [['normal', 'Normal'], ['tall', 'Tall'], ['short', 'Short'], ['wide', 'Wide'], ['tiny', 'Tiny'], ['big', 'Big']];

  function render() {
    if (!root || !session) return;
    const s = session, st = MC.STEPS.find((x) => x.id === s.steps[s.i]) || MC.STEPS[0];
    const lk = look();
    const last = s.i === s.steps.length - 1;
    const dots = s.steps.map((_, i) => `<i class="${i === s.i ? 'on' : i < s.i ? 'done' : ''}"></i>`).join('');
    const sub = { what: 'Pick anything. You can come back to the mirror later.', look: 'Your colors, your size, a hat, a face, a few extras.', name: 'What should everyone call you?', view: 'For this game. You can change it at the mirror any time.' }[st.id] || '';
    root.innerHTML = `
      <div class="mr-top"><div class="mr-dots">${dots}</div><button type="button" class="mr-x" data-a="skip" aria-label="Close" title="Done for now (Esc)">×</button></div>
      <h2 class="mr-q">${esc(st.title)}</h2><p class="mr-sub">${esc(sub)}</p>
      <div class="mr-body">${body(st.id, lk)}</div>
      <div class="mr-foot">
        <button type="button" class="mr-btn" data-a="back" ${s.i === 0 ? 'disabled' : ''}>Back</button>
        <button type="button" class="mr-btn go" data-a="next">${last ? 'That\'s me ✓' : 'Next →'}</button>
      </div>`;
    root.onclick = onClick;
    const name = root.querySelector('.mr-name:not(.mr-model)');
    if (name) {
      name.oninput = () => { clearTimeout(name._t); name._t = setTimeout(() => { if (PR() && PR().setLook) PR().setLook({ name: name.value }); }, 250); };
      name.onkeydown = (x) => { x.stopPropagation(); if (x.key === 'Enter') { if (PR() && PR().setLook) PR().setLook({ name: name.value }); go(session.i + 1); } if (x.key === 'Escape') finish(true); };
      setTimeout(() => { try { name.focus({ preventScroll: true }); } catch { /* fine */ } }, 50);
    }
    for (const inp of root.querySelectorAll('input[type=color]')) inp.oninput = () => setLook({ [inp.dataset.part]: inp.value });
    const model = root.querySelector('.mr-model');
    if (model) { model.onkeydown = (x) => x.stopPropagation(); model.onchange = () => setLook({ model: model.value.trim() || null }); }
  }
  function body(step, lk) {
    const C = PC();
    if (step === 'what') {
      const list = MC.allowed(session.cfg);
      return MC.GROUPS.map(([g, label]) => {
        const items = list.filter((w) => w.group === g);
        if (!items.length) return '';
        return `<h4>${esc(label)}</h4><div class="mr-grid">${items.map((w) => `<button type="button" class="mr-card ${lk.what === w.id ? 'on' : ''}" data-what="${w.id}"><span class="ic">${w.icon}</span><span>${esc(word(w))}</span></button>`).join('')}</div>`;
      }).join('') + `<div class="mr-dice"><button type="button" class="mr-chip" data-a="randomWhat">🎲 Surprise me</button></div>`;
    }
    if (step === 'look') {
      const w = C.WHAT.get(lk.what) || C.WHAT.get('person');
      const person = w.body === 'person';
      const sw = (part, list) => `<div class="mr-row">${list.map((c) => `<button type="button" class="mr-sw ${String(lk[part]).toLowerCase() === c ? 'on' : ''}" style="background:${c}" data-part="${part}" data-c="${c}" aria-label="${c}"></button>`).join('')}<input type="color" data-part="${part}" value="${esc(lk[part])}" aria-label="Any color"></div>`;
      const own = w.colors || [];
      const pal = (extra) => [...new Set([...extra.map((c) => c.toLowerCase()), ...C.LOOK.palette])].slice(0, 12);
      return `<h4>Main color</h4>${sw('body', pal([own[0] || lk.body]))}
        <h4>Second color</h4>${sw('accent', pal([own[1] || lk.accent]))}
        <h4>${person ? 'Skin' : 'Details'}</h4>${sw('head', person ? C.LOOK.skins : pal([own[2] || lk.head]))}
        <h4>Size</h4><div class="mr-row">${SIZES.map(([v, t]) => `<button type="button" class="mr-chip ${lk.shape === v ? 'on' : ''}" data-shape="${v}">${t}</button>`).join('')}</div>
        <h4>Hat</h4><div class="mr-row">${HATS.map(([v, ic, t]) => `<button type="button" class="mr-chip ${lk.hat === v ? 'on' : ''}" data-hat="${v}" title="${t}">${ic} ${t}</button>`).join('')}</div>
        ${person ? `<h4>Face</h4><div class="mr-row">${FACES.map(([v, ic, t]) => `<button type="button" class="mr-chip ${lk.face === v ? 'on' : ''}" data-face="${v}">${ic} ${t}</button>`).join('')}</div>` : ''}
        <h4>Extras (up to ${C.LOOK.maxExtras})</h4><div class="mr-row">${EXTRAS.map(([v, ic, t]) => `<button type="button" class="mr-chip ${lk.extras.includes(v) ? 'on' : ''}" data-extra="${v}">${ic} ${t}</button>`).join('')}</div>
        <div class="mr-dice"><button type="button" class="mr-chip" data-a="randomLook">🎲 Shuffle my look</button></div>
        <details style="margin-top:12px"><summary style="cursor:pointer;color:var(--fg-2,#a5acc2)">Use a 3D model instead</summary>
          <input class="mr-name mr-model" style="font-size:15px;margin-top:6px" placeholder="a_… (a community model's id)" value="${esc(lk.model || '')}" aria-label="A model's asset id"></details>`;
    }
    if (step === 'name') {
      return `<input class="mr-name" maxlength="${C.NAME_MAX}" placeholder="Type a name…" value="${esc(lk.name || '')}" aria-label="Your name" autocomplete="off" spellcheck="false">
        <div class="mr-dice"><button type="button" class="mr-chip" data-a="suggest">🎲 Suggest one</button></div>`;
    }
    if (step === 'view') {
      const cur = session.view || store.get(viewKey()) || session.saved.view;
      return `<div class="mr-big">
        <button type="button" class="mr-card ${cur === 'first' ? 'on' : ''}" data-view="first"><span class="ic">👁️</span><span><b>Through my eyes</b><br><small>First person</small></span></button>
        <button type="button" class="mr-card ${cur === 'third' ? 'on' : ''}" data-view="third"><span class="ic">🎥</span><span><b>Over my shoulder</b><br><small>Third person: you see yourself</small></span></button>
      </div>`;
    }
    return '';
  }
  function onClick(ev) {
    const t = ev.target.closest('button');
    if (!t || !session) return;
    const C = PC();
    const a = t.dataset.a;
    if (a === 'next') { const n = root.querySelector('.mr-name:not(.mr-model)'); if (n && PR()) PR().setLook({ name: n.value }); return go(session.i + 1); }
    if (a === 'back') return go(session.i - 1);
    if (a === 'skip') return finish(true);
    if (t.dataset.what) return pickWhat(t.dataset.what);
    if (a === 'randomWhat') { const list = MC.allowed(session.cfg).filter((w) => w.id !== look().what); if (list.length) pickWhat(list[Math.floor(Math.random() * list.length)].id); return; }
    if (t.dataset.c) return setLook({ [t.dataset.part]: t.dataset.c });
    if (t.dataset.shape) return setLook({ shape: t.dataset.shape });
    if (t.dataset.hat) return setLook({ hat: t.dataset.hat });
    if (t.dataset.face) return setLook({ face: t.dataset.face });
    if (t.dataset.extra) {
      const cur = look().extras.slice();
      const i = cur.indexOf(t.dataset.extra);
      if (i >= 0) cur.splice(i, 1); else { cur.push(t.dataset.extra); while (cur.length > C.LOOK.maxExtras) cur.shift(); }
      return setLook({ extras: cur });
    }
    if (a === 'randomLook') {
      const r = C.randomLook();
      const lk = look();
      return setLook({ body: r.body, accent: r.accent, head: (C.WHAT.get(lk.what) || {}).body === 'person' ? r.head : r.accent, shape: r.shape, hat: r.hat, extras: r.extras, face: r.face });
    }
    if (a === 'suggest') {
      const n = MC.suggestName(look().what);
      const inp = root.querySelector('.mr-name:not(.mr-model)');
      if (inp) inp.value = n;
      if (PR()) PR().setLook({ name: n });
      return;
    }
    if (t.dataset.view) {
      session.view = t.dataset.view;
      try { session.p.view = session.view; } catch { /* fine */ }
      stage(session.p, session.mirror, false); // (the view moves the camera: back to the mirror's)
      return render();
    }
  }
  /** Being something else: its own colors (you change them next), and the Overseer's word on it. */
  function pickWhat(id) {
    const C = PC();
    const w = C.WHAT.get(id);
    if (!w) return;
    const lk = look();
    const part = { what: id };
    if (lk.what !== id) { part.body = w.colors[0]; part.accent = w.colors[1]; part.head = w.colors[2]; if (w.body !== 'person') part.face = 'eyes'; }
    setLook(part);
    clearTimeout(reactT);
    reactT = setTimeout(() => narrate(w.line, `overseer-is-${id}.mp3`, 4.5, 0, 'react'), 350);
    emit({ state: 'pick', what: id });
  }

  // ------------------------------------------------------------------ E near a mirror
  H.use.register('mirror:look', {
    near(p) {
      if (session || !playing()) return null;
      const e = nearestMirror(p, true);
      return e ? { label: 'Change who you are', distance: Math.hypot(e.x - p.x, e.z - p.z), act: () => open(e) } : null;
    },
  });

  // ------------------------------------------------------------------ by itself, when a player arrives
  H.hooks.world.push({
    enter() {
      if (session) { session = null; hide(); }
      const w = W();
      // The view a player chose at a mirror that asks it (this game's, remembered).
      const v = store.get(viewKey());
      if (w && w.player && playing() && (v === 'first' || v === 'third') && mirrors().some((e) => configOf(e).steps.includes('view'))) { try { w.player.view = v; } catch { /* fine */ } }
      const e = autoMirror();
      pending = Boolean(e);
      if (!e) return;
      // After the Overseer's intro when there is one (game.on('intro') below), else in a moment.
      const intro = Boolean(H.overseer && H.overseer.introWanted && H.overseer.introWanted());
      if (!intro) setTimeout(() => { if (pending && !session) open(autoMirror() || e, { auto: true }); }, 1200);
    },
  });
  H.hooks.game.push((game) => {
    game.on('intro', (d) => { if (d && d.state === 'end' && pending && !session) setTimeout(() => { const e = autoMirror(); if (e && !session) open(e, { auto: true }); else pending = false; }, 150); });
    game.mirror = {
      /** Opens the questions at a mirror (a thing, a name, or the nearest). */
      open: (m) => open(typeof m === 'string' ? game.find(m) : m || null),
      /** The questions anywhere, without a mirror (a character screen). */
      dress: (o) => open(null, { anywhere: true, cfg: o || undefined }),
      close: () => finish(true),
      get isOpen() { return Boolean(session); },
      /** A mirror will open by itself in a moment (after the intro): wait for game.on('mirror') before greeting. */
      get pending() { return pending || Boolean(session); },
      get step() { return session ? session.steps[session.i] : null; },
    };
  });
  /** For presence's 🎨 Customize: the same questions anywhere. */
  M.dress = (cfg) => open(null, { anywhere: true, cfg });
  M.open = (e, o) => open(e, o);
  M.finish = (skipped) => finish(skipped);
  M.go = (i) => go(i);
  Object.defineProperty(M, 'session', { get: () => session, configurable: true });
  M._internal = { lines: () => lines.slice(), speaking: () => speaking, pickWhat, nearestMirror, autoMirror, configOf, get pending() { return pending; }, forget: () => { seenOnPage.clear(); store.set(seenKey(), ''); } };

  // ------------------------------------------------------------------ building: the mirror's own settings (its card's 🪞)
  const kind = H.kinds.get('mirror');
  if (kind && kind.editor) {
    kind.editor.card = {
      label: '🪞 Character mirror',
      open(ctx) { settings(ctx); },
    };
  }
  let setEl = null;
  function settings(ctx) {
    if (typeof document === 'undefined') return;
    if (setEl) setEl.remove();
    if (!document.getElementById('mr-style')) { const st = document.createElement('style'); st.id = 'mr-style'; st.textContent = CSS; document.head.appendChild(st); }
    const raw = ctx.spec && ctx.spec.shape ? ctx.spec.shape.character : undefined;
    let cfg = MC.cleanConfig(raw);
    const el = (setEl = document.createElement('div'));
    el.className = 'mr';
    for (const ev of ['keydown', 'keyup', 'pointerdown', 'wheel', 'mousedown']) el.addEventListener(ev, (x) => x.stopPropagation());
    document.body.appendChild(el);
    const save = (label) => {
      const out = cfg.off ? false : { steps: cfg.steps, whats: cfg.whats, start: cfg.start, voice: cfg.voice, reach: cfg.reach };
      ctx.update({ shape: { character: out } }, label || 'the mirror');
    };
    const draw = () => {
      const all = (PC() && PC().WHATS) || [];
      const allowedIds = new Set(MC.allowed(cfg).map((w) => w.id));
      const everyone = !cfg.whats.length;
      el.innerHTML = `
        <div class="mr-top"><b style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--fg-2,#a5acc2)">While building</b><button type="button" class="mr-x" data-a="close" aria-label="Close">×</button></div>
        <h2 class="mr-q">🪞 Character mirror</h2><p class="mr-sub">Where players become who they are. Different games, different questions.</p>
        <div class="mr-body">
          <h4>This mirror</h4><div class="mr-row">
            <button type="button" class="mr-chip ${!cfg.off ? 'on' : ''}" data-off="0">Asks who you are</button>
            <button type="button" class="mr-chip ${cfg.off ? 'on' : ''}" data-off="1">Just a mirror</button></div>
          ${cfg.off ? '' : `
          <h4>When players arrive</h4><div class="mr-row">
            ${[[false, 'Only with E'], ['first', 'Opens the first time'], ['always', 'Opens every time']].map(([v, t]) => `<button type="button" class="mr-chip ${cfg.start === v ? 'on' : ''}" data-start="${v}">${t}</button>`).join('')}</div>
          <h4>The questions, in order</h4>
          ${cfg.steps.map((id, i) => { const st = MC.STEPS.find((x) => x.id === id); return `<div class="mr-row" style="margin:4px 0"><button type="button" class="mr-chip on" data-step="${id}" title="Leave it out">✓ ${esc(st.title)}</button><button type="button" class="mr-chip" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Earlier">↑</button><button type="button" class="mr-chip" data-down="${i}" ${i < cfg.steps.length - 1 ? '' : 'disabled'} aria-label="Later">↓</button></div>`; }).join('')}
          <div class="mr-row">${MC.STEPS.filter((st) => !cfg.steps.includes(st.id)).map((st) => `<button type="button" class="mr-chip" data-step="${st.id}">+ ${esc(st.title)}</button>`).join('')}</div>
          <h4>Who players can be</h4>
          <div class="mr-row"><button type="button" class="mr-chip ${everyone ? 'on' : ''}" data-who="all">Anything</button>${MC.GROUPS.map(([g, t]) => `<button type="button" class="mr-chip ${!everyone && cfg.whats.includes(g) ? 'on' : ''}" data-who="${g}">${esc(t)}</button>`).join('')}</div>
          <div class="mr-grid" style="margin-top:8px">${all.map((w) => `<button type="button" class="mr-card ${!everyone && allowedIds.has(w.id) ? 'on' : ''}" data-pick="${w.id}" title="${esc(w.label)}"><span class="ic">${w.icon}</span><span>${esc(word(w))}</span></button>`).join('')}</div>
          <h4>The Overseer</h4><div class="mr-row">
            <button type="button" class="mr-chip ${cfg.voice ? 'on' : ''}" data-voice="1">Narrates</button>
            <button type="button" class="mr-chip ${!cfg.voice ? 'on' : ''}" data-voice="0">Stays quiet</button></div>`}
        </div>
        <div class="mr-foot"><button type="button" class="mr-btn" data-a="close">Close</button>${cfg.off ? '' : '<button type="button" class="mr-btn go" data-a="try">Try it</button>'}</div>`;
    };
    el.onclick = (ev) => {
      const t = ev.target.closest('button');
      if (!t) return;
      const d = t.dataset;
      if (d.a === 'close') { el.remove(); setEl = null; return; }
      if (d.a === 'try') { el.remove(); setEl = null; ctx.close(); open(ctx.entity, { cfg }); return; }
      if (d.off !== undefined) { cfg = d.off === '1' ? MC.cleanConfig(false) : MC.cleanConfig({}); save(d.off === '1' ? 'a plain mirror' : 'the mirror\'s questions'); }
      else if (d.start !== undefined) { cfg.start = d.start === 'false' ? false : d.start; save('when it opens'); }
      else if (d.step) {
        const i = cfg.steps.indexOf(d.step);
        if (i >= 0) { if (cfg.steps.length > 1) cfg.steps.splice(i, 1); } else cfg.steps.push(d.step);
        save('the questions');
      } else if (d.up !== undefined || d.down !== undefined) {
        const i = Number(d.up ?? d.down), j = d.up !== undefined ? i - 1 : i + 1;
        if (j >= 0 && j < cfg.steps.length) { [cfg.steps[i], cfg.steps[j]] = [cfg.steps[j], cfg.steps[i]]; save('the order of the questions'); }
      } else if (d.who) {
        if (d.who === 'all') cfg.whats = [];
        else { const i = cfg.whats.indexOf(d.who); if (i >= 0) cfg.whats.splice(i, 1); else cfg.whats = cfg.whats.filter((x) => MC.GROUPS.some((g) => g[0] === x)).concat(d.who); }
        save('who players can be');
      } else if (d.pick) {
        // One by one: starting from everything allowed now, this one in or out.
        const now = new Set(MC.allowed(cfg).map((w) => w.id));
        if (!cfg.whats.length) now.clear();
        if (now.has(d.pick)) now.delete(d.pick); else now.add(d.pick);
        cfg.whats = [...now];
        save('who players can be');
      } else if (d.voice !== undefined) { cfg.voice = d.voice === '1'; save('the Overseer'); }
      draw();
    };
    draw();
  }
})();
