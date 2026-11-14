// The island title screen (J, 2026-11-12): replaces the sandbox's opaque click-to-enter veil with a live fly-over of
// the real island at golden hour (Sea of Thieves outpost attract), the Hawkes Games lockup, Press any key / Tap to start,
// then Continue / New island / Settings. First input unlocks audio and starts the clearing theme; Play swoops the camera
// to the player (1.5–2.5 s) with a whoosh and hands off to the intro (or control). Account and save behaviour unchanged.
//   - Only the sandbox (/play/sandbox or HawkesGuest). Other worlds keep intro.js's Enter veil.
//   - OV.titleGate() resolves once Play is chosen; intro.js awaits it instead of waitForSound on the sandbox.
//   - Funnel: sandbox_veil_shown / sandbox_veil_passed (same names as the old veil) plus title-* game events.
//   - Logo: /play/brand/hawkes-games-title.webp when present, else a CSS wordmark (Gen art lands via studio_gen_import).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const OV = H.overseer;
  const W = () => H.world;
  const G = () => H.game;
  const LOGO_URL = '/play/brand/hawkes-games-title.webp';
  const GOLDEN_HOUR = 16.9;
  const SWOOP_MIN = 1.5;
  const SWOOP_MAX = 2.5;

  let active = null; // { phase, resolve, ... }
  let pending = null; // Promise for the current gate
  let doneThisPage = false;

  function funnel(name, props) {
    try { if (window.hgFunnel) window.hgFunnel(name, props || {}); } catch { /* fine */ }
  }
  function isSandbox() {
    try {
      if (window.HawkesGuest) return true;
      const p = String(location.pathname || '');
      return /\/play\/sandbox\/?$/.test(p) || /\/play\/t\/sandbox\/?$/.test(p);
    } catch { return false; }
  }
  function screenless() {
    try { return W().scene.getEngine() instanceof B.NullEngine; } catch { return true; }
  }
  function touchUi() {
    return Boolean(H.touchUi || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches));
  }
  function returning() {
    try {
      if (window.HawkesGuest && (HawkesGuest.resume || HawkesGuest.resumed || (HawkesGuest.session && HawkesGuest.session.returning))) return true;
      return Boolean(localStorage.getItem('hg_overseer_intro') && localStorage.getItem('hg_sandbox_return'));
    } catch { return false; }
  }
  function emit(state, extra) {
    try { if (G()) G().emit('title', { state, ...(extra || {}) }); } catch { /* fine */ }
  }

  const CSS = `
.hp-title{position:fixed;inset:0;z-index:2147482000;pointer-events:none;box-sizing:border-box;
  padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));
  display:grid;grid-template-rows:1fr auto 1fr;align-items:center;justify-items:center;color:#eef4ff;
  font-family:system-ui,sans-serif;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.hp-title .hp-title-logo{pointer-events:none;grid-row:1;align-self:end;margin-bottom:min(4vh,28px);
  display:grid;justify-items:center;gap:10px;opacity:0;transform:translateY(18px) scale(.96);
  transition:opacity .9s ease, transform 1.1s cubic-bezier(.2,.8,.2,1);filter:drop-shadow(0 0 28px rgba(120,170,255,.45))}
.hp-title.on .hp-title-logo{opacity:1;transform:none}
.hp-title .hp-title-logo img{display:block;width:min(78vw,520px);height:auto;max-height:22vh;object-fit:contain}
.hp-title .hp-title-word{margin:0;font:700 clamp(28px,8vw,54px)/1.05 "Orbitron",system-ui,sans-serif;
  letter-spacing:.14em;text-transform:uppercase;text-align:center;
  background:linear-gradient(180deg,#fff 0%,#c9dcff 55%,#8eb6ff 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 0 40px rgba(140,180,255,.35)}
.hp-title .hp-title-word b{display:block;font:600 clamp(12px,2.8vw,16px)/1 system-ui,sans-serif;letter-spacing:.42em;color:#9ec0ff;margin-top:10px;
  -webkit-background-clip:initial;background:none;color:#9ec0ff;text-shadow:none}
.hp-title .hp-title-seal{margin:0;font:600 clamp(12px,2.8vw,16px)/1 system-ui,sans-serif;letter-spacing:.42em;text-transform:uppercase;
  color:#9ec0ff;text-align:center;text-shadow:0 0 18px rgba(120,170,255,.45)}
.hp-title .hp-title-seal[hidden]{display:none!important}
.hp-title .hp-title-prompt{grid-row:3;align-self:start;margin-top:min(6vh,40px);pointer-events:auto;appearance:none;border:0;background:transparent;
  color:#e8efff;font:600 clamp(14px,3.6vw,18px)/1.3 system-ui,sans-serif;letter-spacing:.18em;text-transform:uppercase;
  padding:14px 18px;min-height:48px;opacity:.9;animation:hpTitlePulse 1.8s ease-in-out infinite;cursor:pointer}
.hp-title .hp-title-prompt[hidden],.hp-title .hp-title-menu[hidden]{display:none!important}
.hp-title .hp-title-menu{grid-row:3;align-self:start;margin-top:min(4vh,28px);display:grid;gap:12px;justify-items:center;pointer-events:auto;width:min(92vw,320px)}
.hp-title .hp-title-menu button{appearance:none;border:0;cursor:pointer;width:100%;min-height:52px;border-radius:999px;
  font:700 clamp(15px,3.8vw,18px)/1 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;padding:.95em 1.4em}
.hp-title .hp-title-menu button.primary{color:#06091a;background:linear-gradient(#f4f7ff,#b9ccff);box-shadow:0 0 28px rgba(140,175,255,.7)}
.hp-title .hp-title-menu button.ghost{color:#e8efff;background:rgba(8,12,28,.55);border:1px solid rgba(170,200,255,.35);backdrop-filter:blur(8px)}
.hp-title .hp-title-menu button:focus-visible{outline:3px solid #fff;outline-offset:4px}
.hp-title.out{animation:hpTitleOut .45s ease forwards}
@keyframes hpTitlePulse{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes hpTitleOut{to{opacity:0}}
@media (orientation:portrait) and (max-width:500px){
  .hp-title{grid-template-rows:minmax(28vh,38vh) 1fr minmax(28vh,36vh)}
  .hp-title .hp-title-logo{align-self:center;margin:0}
  .hp-title .hp-title-prompt,.hp-title .hp-title-menu{align-self:end;margin-bottom:max(12px,env(safe-area-inset-bottom))}
}
@media (prefers-reduced-motion:reduce){
  .hp-title .hp-title-logo{transition:none}.hp-title .hp-title-prompt{animation:none;opacity:.9}
}
body.hp-title-on .hc-chat,body.hp-title-on .tl-zone,body.hp-title-on .gs-acts,body.hp-title-on .pg-hud,body.hp-title-on .wh-hud,body.hp-title-on .ct-btn,body.hp-title-on .ov-work{opacity:0!important;pointer-events:none!important}
`;

  /** Attract spline: clearing → beach → pier → Overseer pearl in the sky → beam start. Times in seconds along the loop. */
  function attractKeys(w) {
    const p = w.player;
    const at = p ? [p.x, p.bottom + 1.2, p.z] : [-6, 5, 0];
    // Real Overseer position (sandbox OVERSEER_AT): hangar beat looks straight at the pearl from the hill.
    const ov = (OV && OV.position) || [9700, 4200, -3000];
    return [
      { at: 0, pos: [-22, 16, -28], look: [2, 5, 4] }, // clearing + mirror meadow
      { at: 9, pos: [8, 14, -22], look: [24, 4, 2] }, // road toward the ridge
      { at: 18, pos: [48, 11, -26], look: [62, 2, -8] }, // fuel beach barrels
      { at: 28, pos: [78, 9, -14], look: [86, 2.2, 0] }, // pier + rod (waves and gulls in frame)
      { at: 38, pos: [30, 28, 32], look: [ov[0], ov[1], ov[2]] }, // Helipad Hill looking up at the Overseer
      { at: 48, pos: [at[0] - 10, at[1] + 9, at[2] - 16], look: at }, // start clearing, ready to swoop
      { at: 56, pos: [-22, 16, -28], look: [2, 5, 4] },
    ];
  }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function sampleKeys(keys, t) {
    const dur = keys[keys.length - 1].at;
    let u = ((t % dur) + dur) % dur;
    let i = 0;
    while (i < keys.length - 2 && keys[i + 1].at < u) i++;
    const a = keys[i], b = keys[i + 1];
    const k = (u - a.at) / Math.max(0.001, b.at - a.at);
    const e = k * k * (3 - 2 * k);
    return { pos: lerp3(a.pos, b.pos, e), look: lerp3(a.look, b.look, e) };
  }

  function whoosh() {
    const ctx = H.audio && H.audio.context, out = H.audio && (H.audio.effects || H.audio.master);
    if (!ctx || !out || ctx.state !== 'running') return;
    try {
      const t0 = ctx.currentTime + 0.02;
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
      f.frequency.setValueAtTime(280, t0); f.frequency.exponentialRampToValueAtTime(3800, t0 + 1.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.8);
      src.connect(f).connect(g).connect(out);
      src.start(t0); src.stop(t0 + 2);
    } catch { /* fine */ }
  }

  function ensureCss() {
    if (document.getElementById('hp-title-css')) return;
    const st = document.createElement('style');
    st.id = 'hp-title-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function buildUi() {
    ensureCss();
    const root = document.createElement('div');
    root.className = 'hp-title';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Hawkes Games');
    root.dataset.title = '1';
    const back = returning();
    const prompt = touchUi() ? 'Tap to start' : 'Press any key';
    root.innerHTML = `
      <div class="hp-title-logo" data-logo>
        <img alt="" hidden data-logo-img>
        <p class="hp-title-word" data-word>Hawkes Games<b>Island</b></p>
        <p class="hp-title-seal" data-seal hidden>Island</p>
      </div>
      <button type="button" class="hp-title-prompt" data-prompt>${prompt}</button>
      <div class="hp-title-menu" data-menu hidden>
        ${back ? '<button type="button" class="primary" data-continue>Continue</button>' : '<button type="button" class="primary" data-play>Play</button>'}
        <button type="button" class="ghost" data-new>New island</button>
        <button type="button" class="ghost" data-settings>Settings</button>
      </div>`;
    document.body.appendChild(root);
    const img = root.querySelector('[data-logo-img]');
    const word = root.querySelector('[data-word]');
    const seal = root.querySelector('[data-seal]');
    // Prefer the Gen lockup when the file is there; keep the CSS wordmark as fallback.
    // With the Gen lockup, keep a soft "Island" seal so the mark reads as this world's.
    const probe = new Image();
    probe.onload = () => {
      img.src = LOGO_URL; img.hidden = false; img.alt = 'Hawkes Games';
      word.hidden = true; if (seal) seal.hidden = false;
    };
    probe.onerror = () => { img.hidden = true; word.hidden = false; if (seal) seal.hidden = true; };
    probe.src = LOGO_URL + '?v=2';
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('on')));
    return root;
  }

  function takeCam(w) {
    const scene = w.scene;
    const prev = scene.activeCamera;
    const cam = new B.UniversalCamera('hp-title-cam', new B.Vector3(-22, 16, -28), scene);
    cam.minZ = 0.2; cam.maxZ = 8000; cam.fov = (touchUi() ? 62 : 55) * (Math.PI / 180);
    try { cam.inputs.clear(); } catch { /* fine */ }
    scene.activeCamera = cam;
    return { cam, prev };
  }
  function setPose(cam, pose) {
    cam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    const dx = pose.look[0] - pose.pos[0], dy = pose.look[1] - pose.pos[1], dz = pose.look[2] - pose.pos[2];
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    cam.rotation.set(pitch, yaw, 0);
  }
  function softDof(on) {
    const w = W();
    if (!w || !w.look) return null;
    const saved = { on: null, fStop: null, focal: null };
    try {
      saved.on = w.look.depthOfFieldEnabled;
      if (on && !touchUi()) {
        w.look.depthOfFieldEnabled = true;
        try {
          w.look.depthOfFieldBlurLevel = 1;
          if (w.look.depthOfField) {
            saved.fStop = w.look.depthOfField.fStop;
            saved.focal = w.look.depthOfField.focalLength;
            w.look.depthOfField.fStop = 2.2;
            w.look.depthOfField.focalLength = 50;
          }
        } catch { /* fine */ }
      }
    } catch { return null; }
    return saved;
  }
  function restoreDof(saved) {
    const w = W();
    if (!w || !w.look || !saved) return;
    try {
      if (saved.on !== null) w.look.depthOfFieldEnabled = saved.on;
      if (w.look.depthOfField) {
        if (saved.fStop != null) w.look.depthOfField.fStop = saved.fStop;
        if (saved.focal != null) w.look.depthOfField.focalLength = saved.focal;
      }
    } catch { /* fine */ }
  }

  /** Disposes the title's camera without taking the world's picture with it. The look's pipeline (runtime.js) adds every
   *  new camera, and Camera.dispose() disposes the post-processes it holds: those are shared with the player's camera, so
   *  disposing an attached camera left the world rendering into dead textures: one flat sky-blue frame for the intro.
   *  So: take it out of every pipeline first, make sure the player's camera is still in the look, then dispose. */
  function dropCam(w, cam, main) {
    const sc = w.scene;
    try { if (w.look && w.look.cameras && w.look.cameras.includes(cam)) w.look.removeCamera(cam); } catch { /* fine */ }
    try { sc.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('hp-ssao', [cam]); } catch { /* not built */ }
    try {
      if (cam.detachPostProcess && cam._postProcesses) for (const pp of cam._postProcesses.slice()) if (pp) cam.detachPostProcess(pp);
    } catch { /* fine */ }
    try { cam.dispose(); } catch { /* fine */ }
    try {
      const m = main && !(main.isDisposed && main.isDisposed()) ? main : (w.camera && w.camera.cam);
      if (m && w.look && w.look.cameras && !w.look.cameras.includes(m)) w.look.addCamera(m);
      if (m && sc.activeCamera !== m && (!sc.activeCamera || sc.activeCamera.isDisposed())) sc.activeCamera = m;
    } catch { /* fine */ }
  }

  function clearNewIsland() {
    try {
      localStorage.removeItem('hg_overseer_intro');
      localStorage.removeItem('hg_sandbox_return');
      localStorage.removeItem('hg_sandbox_island');
    } catch { /* fine */ }
    try {
      if (window.HawkesGuest) {
        HawkesGuest.resume = null;
        HawkesGuest.resumed = null;
        HawkesGuest.skipped = null;
        if (HawkesGuest.session) HawkesGuest.session.returning = null;
      }
    } catch { /* fine */ }
  }

  async function unlockAudio() {
    const ctx = H.audio && H.audio.context;
    if (ctx && ctx.state !== 'running') {
      try { await ctx.resume(); } catch { /* fine */ }
    }
    try { if (G()) G().emit('gateway', { state: 'passed' }); } catch { /* fine */ }
    funnel('sandbox_veil_passed');
    emit('input');
  }

  function hidePlayer(w, hide) {
    const p = w && w.player;
    if (!p || !p.node) return null;
    if (hide) {
      const vis = p.node.visibility;
      const controls = p.controls;
      p.node.visibility = 0;
      p.controls = false;
      return { vis, controls };
    }
    return null;
  }

  function settleFrames(w) {
    return new Promise((res) => {
      let last = 0, good = 0, n = 0;
      const step = (now) => {
        n++;
        if (last) good = now - last < 50 ? good + 1 : 0;
        last = now;
        if (good >= 3 || n > 90 || w !== W()) res();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  /** Run the title gate. Resolves { choice: 'play'|'new' }. */
  function run() {
    if (pending) return pending;
    if (doneThisPage || screenless() || !isSandbox() || H.mode !== 'play' || H.hooks.codex) {
      return Promise.resolve({ choice: 'play', skipped: true });
    }
    const w = W();
    if (!w || !w.player || !w.player.alive) return Promise.resolve({ choice: 'play', skipped: true });

    pending = (async () => {
      doneThisPage = true;
      const tStart = performance.now();
      await Promise.race([H.worldDrawn || Promise.resolve(), new Promise((r) => setTimeout(r, 8000))]);
      if (W() !== w || !w.player.alive) return { choice: 'play', skipped: true };
      await settleFrames(w);

      const held = hidePlayer(w, true);
      // Hold the island at golden hour for the attract (sandbox already sits near this; set so the claim is true).
      try { if (H.lighting && H.lighting.setHour) H.lighting.setHour(GOLDEN_HOUR); } catch { /* fine */ }
      const dof = softDof(true);
      const { cam, prev } = takeCam(w);
      const keys = attractKeys(w);
      const root = buildUi();
      document.body.classList.add('hp-title-on');
      funnel('sandbox_veil_shown');
      emit('show', { ms: Math.round(performance.now() - tStart) });
      const logoAt = performance.now();
      emit('logo', { ms: 0 });

      let phase = 'attract'; // attract | menu | swoop
      let choice = 'play';
      let attractT0 = performance.now();
      let frameHook = null;
      let resolved = false;
      let resolveGate;
      const gate = new Promise((r) => { resolveGate = r; });

      const prompt = root.querySelector('[data-prompt]');
      const menu = root.querySelector('[data-menu]');

      const onFrame = () => {
        if (!active || W() !== w) return;
        if (phase === 'attract' || phase === 'menu') {
          const t = (performance.now() - attractT0) / 1000;
          setPose(cam, sampleKeys(keys, t));
          // Mild focus pull toward the look point.
          try {
            if (w.look && w.look.depthOfFieldEnabled && w.look.depthOfField) {
              const d = B.Vector3.Distance(cam.position, new B.Vector3(...sampleKeys(keys, t).look));
              w.look.depthOfField.focusDistance = Math.max(2000, d * 1000);
            }
          } catch { /* fine */ }
        }
      };
      frameHook = onFrame;
      H.hooks.frame.push(frameHook);
      // First pose immediately so the first frame is the island, not the player.
      setPose(cam, sampleKeys(keys, 0));
      emit('flyover', { ms: Math.round(performance.now() - logoAt) });

      const showMenu = async () => {
        if (phase !== 'attract') return;
        phase = 'menu';
        active.phase = 'menu';
        await unlockAudio();
        prompt.hidden = true;
        menu.hidden = false;
        emit('menu', { returning: returning() });
        try {
          const first = menu.querySelector('button');
          if (first) first.focus({ preventScroll: true });
        } catch { /* fine */ }
      };

      const onKey = (e) => {
        if (phase !== 'attract') return;
        const k = String(e.key || '').toLowerCase();
        if (['shift', 'control', 'alt', 'meta', 'tab', 'escape'].includes(k) || e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        showMenu();
      };
      const onPointer = (e) => {
        if (phase !== 'attract') return;
        if (e.target && e.target.closest && e.target.closest('[data-settings],[data-menu]')) return;
        e.preventDefault();
        e.stopPropagation();
        showMenu();
      };
      window.addEventListener('keydown', onKey, true);
      root.addEventListener('pointerdown', onPointer, true);
      prompt.addEventListener('click', (e) => { e.preventDefault(); showMenu(); });

      const finish = (picked) => {
        if (resolved) return;
        resolved = true;
        choice = picked;
        phase = 'swoop';
        active.phase = 'swoop';
        window.removeEventListener('keydown', onKey, true);
        root.removeEventListener('pointerdown', onPointer, true);
        resolveGate();
      };

      menu.querySelector('[data-play]')?.addEventListener('click', (e) => { e.preventDefault(); finish('play'); });
      menu.querySelector('[data-continue]')?.addEventListener('click', (e) => { e.preventDefault(); finish('continue'); });
      menu.querySelector('[data-new]')?.addEventListener('click', (e) => {
        e.preventDefault();
        const wasReturn = returning();
        clearNewIsland();
        // A return visit already patched intro off in the bundle: reload so the full beginning plays again.
        if (wasReturn) {
          try { location.href = '/play/sandbox?fresh=1'; } catch { finish('new'); }
          return;
        }
        finish('new');
      });
      menu.querySelector('[data-settings]')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Title sits above the game menu: hide our chrome while Settings is open so the existing menu is usable.
        root.style.visibility = 'hidden';
        root.style.pointerEvents = 'none';
        try {
          if (H.gameMenu && H.gameMenu.open) H.gameMenu.open('settings');
          else if (G() && G().menu && G().menu.open) G().menu.open('settings');
        } catch { /* fine */ }
        emit('settings');
        const watch = setInterval(() => {
          let open = false;
          try { open = Boolean((H.gameMenu && H.gameMenu.isOpen && H.gameMenu.isOpen()) || (G() && G().menu && G().menu.isOpen && G().menu.isOpen())); } catch { /* fine */ }
          if (!open && !document.querySelector('.gm-wrap')) {
            clearInterval(watch);
            if (root.isConnected) { root.style.visibility = ''; root.style.pointerEvents = ''; }
          }
        }, 200);
      });

      active = { phase, root, cam, choice: null };
      window.__title = {
        phase: () => phase,
        logoMs: () => Math.round(performance.now() - logoAt),
        active: () => Boolean(active),
      };

      await gate;

      // Swoop to the player.
      const swoopStart = performance.now();
      emit('play', { choice });
      whoosh();
      root.classList.add('out');
      const p = w.player;
      const from = { pos: [cam.position.x, cam.position.y, cam.position.z], look: sampleKeys(keys, (performance.now() - attractT0) / 1000).look };
      const toPos = p ? [p.x - Math.sin(p.node.rotation.y) * 5.5, p.bottom + 2.4, p.z - Math.cos(p.node.rotation.y) * 5.5] : from.pos;
      const toLook = p ? [p.x, p.bottom + 1.3, p.z] : from.look;
      const swoopSec = SWOOP_MIN + Math.random() * (SWOOP_MAX - SWOOP_MIN);
      await new Promise((done) => {
        const step = () => {
          if (W() !== w) return done();
          const k = Math.min(1, (performance.now() - swoopStart) / (swoopSec * 1000));
          const e = k * k * (3 - 2 * k);
          setPose(cam, { pos: lerp3(from.pos, toPos, e), look: lerp3(from.look, toLook, e) });
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      emit('swoop-done', { ms: Math.round(performance.now() - swoopStart), choice });

      // Tear down.
      const ix = H.hooks.frame.indexOf(frameHook);
      if (ix >= 0) H.hooks.frame.splice(ix, 1);
      restoreDof(dof);
      try {
        if (prev && !(prev.isDisposed && prev.isDisposed())) w.scene.activeCamera = prev;
      } catch { /* fine */ }
      dropCam(w, cam, prev || (w.camera && w.camera.cam));
      if (held && p && p.node) {
        p.node.visibility = held.vis;
        // Intro (or play) takes controls; leave them off until then, and tell the intro what they were: it restores
        // what it finds, so reading our own "off" would leave the player unable to move for good.
        p.controls = false;
        OV.titleControls = held.controls !== false;
      }
      document.body.classList.remove('hp-title-on');
      root.remove();
      active = null;
      try { delete window.__title; } catch { /* fine */ }
      pending = null;
      return { choice, ms: Math.round(performance.now() - tStart) };
    })();

    return pending;
  }

  /** Whether the sandbox should show the title instead of the Enter veil. */
  function wanted() {
    return isSandbox() && H.mode === 'play' && !screenless() && !H.hooks.codex;
  }

  OV.titleWanted = wanted;
  OV.titleGate = run;
  OV.titlePlaying = () => Boolean(active);
  Object.defineProperty(OV, 'titlePhase', { get: () => (active ? active.phase : null), configurable: true });

  H.hooks.game.push((game) => {
    if (!game.overseer) return;
    game.overseer.title = run;
    Object.defineProperty(game.overseer, 'titlePlaying', { get: () => Boolean(active), enumerable: true, configurable: true });
  });

  // Returning sandbox visits skip the intro: still show the title so Play is the first gesture.
  H.hooks.world.push({
    enter(w) {
      if (!wanted() || doneThisPage) return;
      setTimeout(async () => {
        if (W() !== w || doneThisPage || !wanted()) return;
        // Intro owns the gate when it will play; otherwise we run the title alone.
        if (OV.introWanted && OV.introWanted()) return;
        try {
          const r = await run();
          if (W() === w && w.player && w.player.alive) {
            w.player.controls = true;
            try { if (H.input && H.input.held) H.input.held.clear(); } catch { /* fine */ }
          }
          emit('end', r);
        } catch (e) { H.report(e, 'title'); }
      }, 100);
    },
    leave() {
      if (active && active.root) try { active.root.remove(); } catch { /* fine */ }
      document.body.classList.remove('hp-title-on');
      active = null;
      pending = null;
    },
  });
})();
