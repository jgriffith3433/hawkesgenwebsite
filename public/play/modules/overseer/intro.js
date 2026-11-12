// The beginning (J's story): the first time a player enters a world, the camera looks up at the Overseer in the sky,
// the Overseer beams the player down and says: "I have given you the power of free will. Do with it what you will."
// About fourteen seconds. A short look-up (~5.5 s, gently pushing in) frames the player fully under the ship; on a
// portrait phone the shot uses a milder look-up, more distance/height and a wider FOV so the body sits in the
// upper-middle (not pinned to an edge), and the nearby mirror is hidden for that look so its grey slab cannot fill
// the frame. Captions sit in a letterbox bar on a computer and on a dark plate on a phone; the greeting plays as the beam lands; control from ~2 s.
// A large Skip pill (kept clear of the feet on portrait), plus any tap/click/Esc/Space/Enter, ends it and blends the
// camera behind the player. A guest's intro ends facing the mirror; the "first thing" card is for a signed-in player.
//   - config.overseer.intro: "first" (the default: once per player, remembered on this device), "always", "short" (a friend answering an invitation: the beam and one line, about 4.5 s) or false.
//   - The sound: a score made here (a hum, the beam's swell and whoosh, a chime, a tone under each line). The voice: a
//     sound asset named "overseer-intro" in the game, else the Overseer's own line (overseer.js VOICES).
//   - With sound still blocked by the browser (no click or key yet), it first shows the gateway: the Overseer's ring, one
//     "Enter" (click, tap, Enter or Space) that unlocks the sound and starts the intro at once (game.on('gateway')).
//   - It starts only once the world has been drawn (H.worldDrawn, runtime.js whenDrawn: scene ready, three frames on screen); the loading screen stays up until then, so the bars, captions and Skip never sit over an undrawn black page.
//   - Remembered in localStorage ("hg_overseer_intro"); a sandboxed game page (the editor's stage) asks its page,
//     which passes it in the bundle (bundle.overseen) and is told when it has played (message "overseer-seen").
//   - game.overseer.intro() plays it from a script; game.on('intro', ({ state }) => ...) hears it start and end.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const OV = H.overseer;
  const { smooth } = H.sky._;
  const KEY = 'hg_overseer_intro';
  // Greeting, the gift, the gift's second half, then the invitation that starts building (canon line 4, "Ask, and I will send it down").
  const LINES = ['You found your way. Good.', 'I have given you the power of free will.', 'Do with it what you will.', 'Ask, and I will send it down.'];
  const PROMPT = { text: 'Tell the Overseer what to make first: a lighthouse, a tune, a hat.', label: 'Ask for your first thing' };
  const SECONDS = 14;

  let playing = null;
  let playedThisPage = false;

  function policy() {
    const c = OV.config;
    if (!c) return false;
    const v = c.intro;
    if (v === false || v === 'off' || v === 'never' || v === 'none') return false;
    return v === 'always' || v === 'short' ? 'always' : 'first';
  }
  function seen() {
    try { if (window.localStorage.getItem(KEY)) return true; } catch { /* a sandboxed page: ask the bundle */ }
    const b = H.bundle;
    return Boolean(b && b.overseen);
  }
  function remember() {
    try { window.localStorage.setItem(KEY, String(Date.now())); } catch { /* sandboxed */ }
    try { if (window.parent && window.parent !== window) window.parent.postMessage({ source: 'hawkes-play', type: 'overseer-seen' }, '*'); } catch { /* fine */ }
    if (H.bundle) H.bundle.overseen = true;
  }
  /** No screen (the engine tests): never on its own. */
  function screenless() { try { return W().scene.getEngine() instanceof B.NullEngine; } catch { return true; } }
  function autoplayShot() {
    try { const c = H.lib.effectiveConfig().cinematics || {}; return Object.keys(c).some((k) => c[k] && c[k].autoplay); } catch { return false; }
  }
  /** Whether this world start plays the intro (the Overseer skips its usual beam-in then). */
  function wanted() {
    const w = W();
    if (!w || !w.player || w._overseerKept || screenless() || H.hooks.codex) return false;
    const p = policy();
    // The camera work is the share module's (game.cinematic); it may load a moment later (lazy), so it isn't asked here.
    if (!p || !G() || autoplayShot()) return false;
    if (p === 'always') return true;
    return !seen() && !playedThisPage;
  }
  OV.introWanted = wanted;
  /** "short" (a friend answering an invitation, guest.js): the beam and one line over ~4.5 s, no voice clip. */
  const isShort = () => Boolean(OV.config && OV.config.intro === 'short');

  /** The voice line, when the game has one (a sound named "overseer-intro"). */
  function voice() {
    let id = null;
    try { id = H.assets && H.assets.pick ? H.assets.pick('overseer-intro', { kind: 'sound' }) : null; } catch { id = null; }
    if (!id) { try { if (H.lib.hasAsset('overseer-intro.mp3')) id = 'overseer-intro.mp3'; } catch { /* none */ } }
    // Not in this game: the Overseer's own voice line (overseer.js VOICES, the community library's).
    if (!id) return OV.voice ? OV.voice('overseer-intro.mp3') : null;
    try {
      const a = new Audio(H.lib.assetUrl(id));
      a.crossOrigin = 'anonymous';
      if (H.overseerSound && H.overseerSound.route) H.overseerSound.route(a);
      else if (H.audio && H.audio.media) H.audio.media(a, { voice: true });
      return OV.duckWhile ? OV.duckWhile(a) : a;
    } catch { return null; }
  }

  // ------------------------------------------------------------------ the sound (made here: no files, nothing to pay)
  /** The Overseer's score for the intro, synthesized: a deep hum under it all, a swell and a whoosh as the beam comes
   *  down, a chime as the player appears, and a soft voice-like tone under each line. Returns stop(fade seconds). */
  function score() {
    const ctx = H.audio && H.audio.context, out = H.audio && H.audio.master;
    if (!ctx || !out || ctx.state !== 'running') return () => {};
    const t0 = ctx.currentTime + 0.05;
    const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(out);
    const nodes = [];
    const keep = (n) => { nodes.push(n); return n; };
    const env = (g, at, a, peak, hold, rel) => { g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(peak, at + a); g.gain.setValueAtTime(peak, at + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, at + a + hold + rel); };
    const tone = (type, freq, at, a, peak, hold, rel, dest = bus, detune = 0) => {
      const o = keep(ctx.createOscillator()); o.type = type; o.frequency.value = freq; o.detune.value = detune;
      const g = ctx.createGain(); env(g, at, a, peak, hold, rel); o.connect(g).connect(dest);
      o.start(at); o.stop(at + a + hold + rel + 0.1);
      return o;
    };
    const noise = () => {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const n = keep(ctx.createBufferSource()); n.buffer = b; n.loop = true; return n;
    };
    // The hum: two low tones a fifth apart, slightly detuned, through a slowly breathing filter.
    const humF = ctx.createBiquadFilter(); humF.type = 'lowpass'; humF.frequency.value = 220; humF.Q.value = 6; humF.connect(bus);
    const lfo = keep(ctx.createOscillator()); lfo.frequency.value = 0.18; const lfoG = ctx.createGain(); lfoG.gain.value = 90; lfo.connect(lfoG).connect(humF.frequency); lfo.start(t0);
    for (const [f, dt] of [[55, -4], [55, 5], [82.4, 0], [110, 3]]) tone('sawtooth', f, t0, 2.2, 0.07, SECONDS - 3, 2.6, humF, dt);
    const air = noise(); const airF = ctx.createBiquadFilter(); airF.type = 'bandpass'; airF.frequency.value = 900; airF.Q.value = 0.7;
    const airG = ctx.createGain(); env(airG, t0, 2.5, 0.025, SECONDS - 3.5, 2.5); air.connect(airF).connect(airG).connect(bus); air.start(t0); air.stop(t0 + SECONDS + 1);
    // The beam: a swell of light (a high chord) and a rising whoosh.
    const tb = t0 + 1.3;
    for (const f of [440, 554.4, 659.3, 880]) tone('sine', f, tb, 1.6, 0.035, 1.6, 2.2, bus, (Math.random() - 0.5) * 8);
    tone('triangle', 1760, tb + 0.4, 1.2, 0.012, 1.2, 1.8);
    const wh = noise(); const whF = ctx.createBiquadFilter(); whF.type = 'bandpass'; whF.Q.value = 1.4;
    whF.frequency.setValueAtTime(300, tb); whF.frequency.exponentialRampToValueAtTime(4200, tb + 1.8);
    const whG = ctx.createGain(); env(whG, tb, 0.9, 0.12, 0.4, 1.2); wh.connect(whF).connect(whG).connect(bus); wh.start(tb); wh.stop(tb + 3);
    // The chime: the player is here.
    const tc = t0 + 2.7;
    for (const [f, peak] of [[1318.5, 0.08], [1975.5, 0.045], [2637, 0.02]]) tone('sine', f, tc, 0.01, peak, 0.05, 2.6);
    // Under each line: a low, warm, voice-like tone (a formant over a soft saw).
    for (const [at, len] of [[3.0, 2.9], [6.2, 3.3]]) {
      const vf = ctx.createBiquadFilter(); vf.type = 'bandpass'; vf.frequency.value = 520; vf.Q.value = 3; vf.connect(bus);
      tone('sawtooth', 98, t0 + at, 0.35, 0.05, len - 0.9, 0.8, vf);
      tone('sawtooth', 146.8, t0 + at, 0.45, 0.025, len - 1, 0.8, vf, 4);
    }
    return (fade = 0.6) => {
      const now = ctx.currentTime;
      try { bus.gain.cancelScheduledValues(now); bus.gain.setValueAtTime(bus.gain.value, now); bus.gain.linearRampToValueAtTime(0, now + fade); } catch { /* fine */ }
      setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch { /* done */ } } try { bus.disconnect(); } catch { /* fine */ } }, (fade + 0.1) * 1000);
    };
  }

  /** The guest sandbox's funnel (play/guest.js sets it; nothing anywhere else): never breaks the intro. */
  function funnel(name) { try { if (window.hgFunnel) window.hgFunnel(name, {}); } catch { /* fine */ } }

  const VEIL_CSS = '.hp-enter{position:fixed;inset:0;z-index:2147482000;display:grid;place-items:center;padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));box-sizing:border-box;background:radial-gradient(ellipse at 50% 45%,rgba(20,34,80,.35),rgba(4,6,16,.92) 70%);color:#eef2ff;font-family:system-ui,sans-serif;animation:hpEnterIn .7s ease both;touch-action:manipulation;-webkit-tap-highlight-color:transparent}'
    + '.hp-enter.out{animation:hpEnterOut .5s ease forwards}.hp-enter .in{display:grid;justify-items:center;gap:22px;text-align:center;max-width:min(92vw,420px)}'
    + '.hp-enter .ring{position:relative;width:min(46vmin,240px);aspect-ratio:1;border-radius:50%;display:grid;place-items:center;border:2px solid rgba(160,190,255,.55);box-shadow:0 0 40px rgba(110,150,255,.45),inset 0 0 40px rgba(110,150,255,.25);animation:hpRing 3.2s ease-in-out infinite}'
    + '.hp-enter .ring:before,.hp-enter .ring:after{content:"";position:absolute;inset:-14px;border-radius:50%;border:1px solid rgba(160,190,255,.25)}.hp-enter .ring:after{inset:-30px;border-color:rgba(160,190,255,.12)}'
    + '.hp-enter button{appearance:none;border:0;cursor:pointer;color:#06091a;background:linear-gradient(#f4f7ff,#b9ccff);font:700 clamp(18px,4.4vmin,24px)/1 system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;padding:.95em 2.2em;border-radius:999px;box-shadow:0 0 28px rgba(140,175,255,.7);min-width:140px;min-height:48px}'
    + '.hp-enter button:focus-visible{outline:3px solid #fff;outline-offset:4px}.hp-enter p{margin:0;font:400 14px/1.4 system-ui,sans-serif;opacity:.72;letter-spacing:.04em}'
    + '@keyframes hpEnterIn{from{opacity:0}to{opacity:1}}@keyframes hpEnterOut{to{opacity:0}}@keyframes hpRing{50%{transform:scale(1.05);box-shadow:0 0 64px rgba(110,150,255,.7),inset 0 0 50px rgba(110,150,255,.35)}}'
    + '@media (prefers-reduced-motion:reduce){.hp-enter .ring{animation:none}}';

  /** Browsers keep sound off until a click, tap or key. Before the intro: the gateway, the Overseer's ring and one
   *  "Enter". That one gesture (click, tap, Enter or Space) unlocks the sound and starts the intro, and the game hears
   *  it as game.on('gateway', { state: 'passed' }) so the island's sound starts right then. */
  function waitForSound() {
    const ctx = H.audio && H.audio.context;
    if (!ctx || ctx.state === 'running' || H.hooks.codex) return Promise.resolve();
    return new Promise((done) => {
      const veil = document.createElement('div');
      veil.className = 'hp-enter';
      veil.setAttribute('role', 'dialog');
      veil.setAttribute('aria-label', 'Enter the world');
      veil.innerHTML = '<div class="in"><div class="ring" aria-hidden="true"></div><button type="button">Enter</button><p>This world has sound. Turn it up.</p></div>';
      if (!document.getElementById('hp-enter-css')) {
        const st = document.createElement('style');
        st.id = 'hp-enter-css';
        st.textContent = VEIL_CSS;
        document.head.appendChild(st);
      }
      const btn = veil.querySelector('button');
      let passed = false;
      const go = (e) => {
        if (passed) return;
        if (e && e.type === 'keydown') {
          const k = String(e.key || '').toLowerCase();
          if (['shift', 'control', 'alt', 'meta', 'tab'].includes(k) || e.repeat) return;
        }
        passed = true;
        if (e) { e.preventDefault(); e.stopPropagation(); }
        window.removeEventListener('keydown', go, true);
        // Inside the gesture: unlock the sound now, and tell the game so its sound starts with it.
        const resumed = ctx.resume().catch(() => {});
        funnel('sandbox_veil_passed');
        try { if (G()) G().emit('gateway', { state: 'passed' }); } catch { /* fine */ }
        veil.classList.add('out');
        setTimeout(() => veil.remove(), 520);
        resumed.finally(() => done());
      };
      veil.addEventListener('pointerdown', go);
      veil.addEventListener('click', go);
      window.addEventListener('keydown', go, true);
      document.body.appendChild(veil);
      try { btn.focus({ preventScroll: true }); } catch { /* fine */ }
      funnel('sandbox_veil_shown');
    });
  }

  /** The intro's last beat: a card in the chat that starts world building (it opens the chat to talk to the Overseer). */
  function invite() {
    const g = G();
    if (!g || !H.chat) return;
    try {
      H.chat.line({ kind: 'sys', text: PROMPT.text, keep: 90, action: { label: PROMPT.label, onclick: () => { try { H.chat.open(); } catch { /* fine */ } try { G().emit('intro', { state: 'prompt-used' }); } catch { /* fine */ } } } });
      g.emit('intro', { state: 'prompt' });
    } catch (err) { H.report(err, 'intro'); }
  }

  // ------------------------------------------------------------------ the caption: the Overseer's name and the line on a dark plate (no letterbox crop)
  const LOOK_SEC = 5.5; // sky look with a push-in; then the camera settles behind the player while the lines finish
  const CAP_CSS = '.ov-cap{position:fixed;left:0;right:0;z-index:31;display:flex;justify-content:center;align-items:center;pointer-events:none;box-sizing:border-box;opacity:0;transition:opacity .35s;font-family:system-ui,sans-serif;color:#fff}'
    + '.ov-cap.on{opacity:1}.ov-cap .in{display:grid;gap:3px;text-align:center;max-width:min(92vw,900px)}'
    + '.ov-cap b{font:700 12px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#9fd0ff}'
    + '.ov-cap span{font:600 clamp(18px,2.1vw,26px)/1.25 system-ui,sans-serif;text-shadow:0 1px 6px rgba(0,0,0,.8)}'
    + '.ov-cap.plate{top:max(64px,calc(env(safe-area-inset-top) + 60px));z-index:28;padding:0 12px}'
    + '.ov-cap.plate .in{background:rgba(6,9,22,.86);border:1px solid rgba(160,190,255,.35);border-radius:12px;padding:10px 16px 12px;box-shadow:0 6px 24px rgba(0,0,0,.5)}'
    + '.ov-cap.plate span{font-size:clamp(17px,4.6vw,22px)}'
    // Desktop: a letterbox. Two bars slide in over the top and bottom edges (the picture stays whole behind them); the
    // caption sits bright inside the bottom bar, far from the player's model, which walks in the middle of the frame.
    + '.ov-bars{position:fixed;inset:0;z-index:27;pointer-events:none}.ov-bars i{position:absolute;left:0;right:0;height:11vh;background:#04060f;transition:transform .5s ease}'
    + '.ov-bars i:first-child{top:0;transform:translateY(-100%)}.ov-bars i:last-child{bottom:0;transform:translateY(100%)}.ov-bars.on i{transform:none}'
    + '.ov-cap.bar{bottom:0;height:11vh;z-index:28;padding:0 16px}.ov-cap.bar .in{background:none;border:0;box-shadow:none;padding:0}'
    + '.ov-cap.bar b{font-size:13px;color:#a9d6ff}.ov-cap.bar span{font-size:clamp(20px,2.4vw,30px);color:#fff}'
    + '.ov-skip{position:fixed;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:34;appearance:none;border:0;cursor:pointer;color:#06091a;background:linear-gradient(#f4f7ff,#b9ccff);font:700 clamp(16px,2.4vw,20px)/1 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;padding:.85em 1.6em;min-width:132px;min-height:48px;border-radius:999px;box-shadow:0 0 28px rgba(140,175,255,.7);pointer-events:auto;touch-action:manipulation}'
    + '.ov-skip:focus-visible{outline:3px solid #fff;outline-offset:4px}'
    // Portrait: lift Skip off the feet (the look frames the body in the lower half; a bottom-corner pill sat on them).
    + '@media (orientation:portrait){.ov-skip{bottom:max(96px,calc(env(safe-area-inset-bottom) + 88px))}}'
    + 'body.ov-intro-on .hc-chat .hc-log{opacity:0!important}';

  /** Resolves when the scene's shaders and textures are ready and five frames in a row came in under 50 ms (at most 7 s):
   *  the intro's camera work then starts on a smooth frame, not under the world's own compile stalls. */
  function settled(w) {
    const scene = w.scene;
    const ready = new Promise((res) => {
      const t = setTimeout(res, 5000);
      try { scene.whenReadyAsync().then(() => { clearTimeout(t); res(); }, () => { clearTimeout(t); res(); }); } catch { clearTimeout(t); res(); }
    });
    const calm = new Promise((res) => {
      let last = 0, good = 0;
      const step = (now) => {
        if (last) good = now - last < 50 ? good + 1 : 0;
        last = now;
        if (good >= 5 || w !== W()) res(); else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return ready.then(() => Promise.race([calm, new Promise((res) => setTimeout(res, 2000))]));
  }

  /** Plays the intro now (resolves { skipped } when it ends). The player is in control from the moment the beam lands. */
  async function play() {
    const w = W(), g = G();
    if (!w || !g || playing) return { skipped: true };
    const p = w.player;
    const c = OV.position;
    if (!p || !p.alive || !c) return { skipped: true };
    playedThisPage = true;
    const quiet = settled(w); // compiles behind the "Enter" veil
    await waitForSound();
    // Skip is there from the moment the player has entered, over the loading screen if it is still up (a pill at once, not
    // a black wait): the camera work waits for the world to be drawn (runtime.js whenDrawn), but for at most 8 s from here,
    // so the player has control by about 12 s on the slowest machine. A tap on Skip now ends the wait and the intro.
    if (!document.getElementById('ov-cap-css')) { const st = document.createElement('style'); st.id = 'ov-cap-css'; st.textContent = CAP_CSS; document.head.appendChild(st); }
    const skipEl = document.createElement('button');
    skipEl.type = 'button';
    skipEl.className = 'ov-skip';
    skipEl.textContent = 'Skip ›';
    skipEl.setAttribute('aria-label', 'Skip the introduction');
    document.body.appendChild(skipEl);
    let cancelled = false, cancel;
    const cancelP = new Promise((r) => { cancel = r; });
    skipEl.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (!playing) { cancelled = true; cancel(); } });
    skipEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    let timer;
    const drawn = Promise.all([quiet, H.worldDrawn]).catch(() => {}); // (the loading screen has its own timeout)
    await Promise.race([drawn, cancelP, new Promise((r) => { timer = setTimeout(r, 8000); })]);
    clearTimeout(timer);
    if (cancelled || W() !== w || !p.alive) {
      skipEl.remove();
      if (cancelled && W() === w) { remember(); G().emit('intro', { state: 'end', skipped: true }); }
      return { skipped: true };
    }
    const short = isShort();
    const SEC = short ? 4.5 : SECONDS;
    const guest = Boolean(window.HawkesGuest) && !window.HawkesGuest.looks;
    const portrait = typeof window !== 'undefined' && window.innerHeight > window.innerWidth;
    const at = [p.x, p.bottom, p.z];
    let hx = c[0] - at[0], hz = c[2] - at[2];
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const vis = p.node.visibility;
    const controls0 = p.controls;
    p.node.visibility = 0;
    p.controls = false; // until the beam lands (about 2 s in)
    // Looking up at the Overseer over the player's shoulder: pull the third-person camera back so the body stays in frame.
    // Portrait: milder pitch, more distance/height and a wider FOV so the body sits upper-middle, not cropped to an edge.
    const heading = Math.atan2(hx, hz);
    const camOpts = w.camera && w.camera.opts;
    const dist0 = camOpts && Number(camOpts.distance);
    const height0 = camOpts && Number(camOpts.height);
    const fov0 = camOpts && camOpts.fov;
    const pitch0 = portrait ? -0.18 : -0.38;
    const distLook = portrait ? Math.max(10.5, Number(dist0) || 5) : Math.max(7.5, Number(dist0) || 5);
    const LOOK = short ? 2.2 : LOOK_SEC;
    // The mirror sits on the Overseer's side of the start: on a tall portrait frame it fills a third of the shot as a
    // grey slab. Hide it for the whole intro look; bring it back in end() (a guest then faces it).
    const hiddenMirrors = [];
    const hideMirrors = (hide) => {
      for (const e of w.entities) {
        if (!e || !e.alive || e.kind !== 'mirror' || !e.node) continue;
        if (hide) {
          if (e.node.isEnabled && e.node.isEnabled() === false) continue;
          try { e.node.setEnabled(false); hiddenMirrors.push(e); } catch { /* fine */ }
        }
      }
      if (!hide) {
        for (const e of hiddenMirrors) { try { if (e.node) e.node.setEnabled(true); } catch { /* fine */ } }
        hiddenMirrors.length = 0;
      }
    };
    try {
      p.node.rotation.y = heading;
      w.camera.yaw = heading;
      w.camera.pitch = pitch0;
      w.camera.idleSince = performance.now();
      if (w.camera.mode === 'third' && camOpts) {
        camOpts.distance = distLook;
        if (portrait) {
          camOpts.height = Math.max(2.2, Number(height0) || 1.4);
          camOpts.fov = 82 * (Math.PI / 180); // runtime third-person honors opts.fov when set
        }
      }
      hideMirrors(true);
    } catch { /* a camera without them */ }
    const timers = [];
    const later = (s, fn) => timers.push(setTimeout(() => { if (playing && W() === w) fn(); }, s * 1000));
    const capEl = document.createElement('div');
    // A phone (portrait or touch) keeps the dark plate; a computer gets the letterbox bar.
    const letterbox = !portrait && !(H.touchUi || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches));
    let barsEl = null;
    if (letterbox) {
      barsEl = document.createElement('div');
      barsEl.className = 'ov-bars';
      barsEl.innerHTML = '<i></i><i></i>';
      document.body.appendChild(barsEl);
      requestAnimationFrame(() => requestAnimationFrame(() => barsEl && barsEl.classList.add('on')));
    }
    capEl.className = letterbox ? 'ov-cap bar' : 'ov-cap plate';
    capEl.setAttribute('aria-live', 'polite');
    capEl.innerHTML = '<div class="in"><b></b><span></span></div>';
    document.body.appendChild(capEl);
    document.body.classList.add('ov-intro-on');
    let capTimer = null;
    /** A line in the caption: the speaker's name and the words, held at least 2 s (a missing voice clip changes nothing). */
    const caption = (line, secs) => {
      capEl.querySelector('b').textContent = 'Overseer';
      capEl.querySelector('span').textContent = line;
      capEl.classList.add('on');
      const hold = Math.max(2, secs);
      clearTimeout(capTimer);
      capTimer = setTimeout(() => capEl.classList.remove('on'), hold * 1000);
    };
    let audio = null, ended = false, looking = true;
    let done;
    const finished = new Promise((r) => { done = r; });
    const SLOW = 0.4;
    /** One tap, click, Esc, Space or Enter, or the Skip pill: the rest is skipped and the camera blends behind the player. */
    const skip = () => { if (playing && !ended) end(true); };
    skipEl.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); skip(); });
    const t0 = performance.now();
    const onKey = (e) => {
      if (performance.now() - t0 < 400 || e.repeat) return;
      const k = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase();
      if (!['escape', 'space', 'enter'].includes(k)) return;
      if (e.target && e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
      skip();
    };
    const OUT = '#touch,.tl-zone,button,a,input,textarea,select,.hp-enter,.gs-ui,.hc-form,.hc-card,.hc-panel,.ov-skip';
    let down = null;
    const onDown = (e) => {
      if (performance.now() - t0 < 400 || (e.target && e.target.closest && e.target.closest(OUT))) { down = null; return; }
      if (e.pointerType === 'touch') down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId }; // a drag is looking round; a tap skips
      else skip();
    };
    const onUp = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
      down = null;
      if (d < 12 && dt < 500) skip();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    playing = { started: t0 };
    const stopScore = score();
    if (H.speech) H.speech.hold('intro');
    g.emit('intro', { state: 'start' });

    const restoreCam = () => {
      try {
        if (w.camera && w.camera.mode === 'third' && camOpts) {
          if (Number.isFinite(dist0)) camOpts.distance = dist0;
          if (Number.isFinite(height0)) camOpts.height = height0;
          else if (portrait) delete camOpts.height;
          if (fov0 !== undefined) camOpts.fov = fov0;
          else delete camOpts.fov;
        }
      } catch { /* fine */ }
    };
    /** Gives the camera back behind the player over ~0.4 s. Mirror stays hidden until end() (still ahead on the Overseer's side). */
    const blendBehind = () => {
      looking = false;
      restoreCam();
      const s0 = performance.now();
      const y0 = w.camera.yaw, q0 = w.camera.pitch;
      const dy = (() => { let d = (p.node.rotation.y - y0) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; })();
      const step = () => {
        if (W() !== w || !p.alive) return;
        const k = Math.min(1, (performance.now() - s0) / (SLOW * 1000));
        const e = k * k * (3 - 2 * k);
        try { w.camera.yaw = y0 + dy * e; w.camera.pitch = q0 + (0.32 - q0) * e; w.camera.idleSince = performance.now(); } catch { /* fine */ }
        if (k < 1) requestAnimationFrame(step);
      };
      step();
    };
    // A short push-in while looking at the Overseer (not a static hold); then settle behind the player.
    const lookStep = () => {
      if (!playing || ended || W() !== w || !looking) return;
      const t = (performance.now() - t0) / 1000;
      if (t >= LOOK) { blendBehind(); return; }
      const k = Math.min(1, t / LOOK);
      const e = k * k * (3 - 2 * k);
      try {
        w.camera.pitch = pitch0 + (portrait ? 0.12 : 0.18) * e;
        if (w.camera.mode === 'third' && camOpts) camOpts.distance = distLook - (portrait ? 1.6 : 1.2) * e;
        w.camera.idleSince = performance.now(); // hold the look; don't idle-recenter mid-shot
      } catch { /* fine */ }
      requestAnimationFrame(lookStep);
    };
    requestAnimationFrame(lookStep);

    function end(skipped) {
      if (ended) return;
      ended = true;
      looking = false;
      for (const t of timers) clearTimeout(t);
      clearTimeout(capTimer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      if (audio && skipped) try { audio.pause(); } catch { /* fine */ }
      stopScore(skipped ? 0.4 : 2.5);
      if (H.speech) { H.speech.hold('intro', false); if (skipped) H.speech.clear('intro'); }
      capEl.classList.remove('on');
      skipEl.remove();
      if (barsEl) { barsEl.classList.remove('on'); const b = barsEl; setTimeout(() => b.remove(), 600); }
      setTimeout(() => capEl.remove(), 400);
      document.body.classList.remove('ov-intro-on');
      restoreCam();
      hideMirrors(false);
      playing = null;
      if (W() === w && p.alive) {
        p.node.visibility = vis;
        p.controls = controls0 !== false;
        try { if (H.input && H.input.held) H.input.held.clear(); } catch { /* fine */ }
        // Skipped before the beam came: still beamed in.
        if (skipped && performance.now() - t0 < (short ? 700 : 1500)) OV.beam(p, { radius: 1.3, seconds: 1.6 });
        if (skipped) blendBehind();
        else if (guest) {
          // The beam's light settles on the mirror and the camera turns to it (the mirror's questions open next).
          let m = null;
          for (const e of w.entities) if (e.alive && e.kind === 'mirror') { m = e; break; }
          if (m) {
            try { OV.beam(m, { radius: 1.4, seconds: 2.2, sound: false }); } catch { /* fine */ }
            try { const ya = Math.atan2(m.x - p.x, m.z - p.z); p.node.rotation.y = ya; w.camera.yaw = ya; w.camera.pitch = 0.2; } catch { /* fine */ }
          }
        }
      }
      remember();
      // After a skip, a beat for the camera to settle behind the player before whatever follows (the mirror opens on 'end').
      setTimeout(() => {
        if (W() === w && G()) G().emit('intro', { state: 'end', skipped: Boolean(skipped) });
        // The card that starts building is for a signed-in player on their own island: a guest has no Overseer chat yet.
        if (!short && !guest && W() === w) invite();
      }, skipped ? SLOW * 1000 + 60 : 0);
      done({ skipped: Boolean(skipped) });
    }

    // The beam: the player appears in it and is in control as it lands; the greeting is said then (canon).
    later(short ? 0.6 : 1.3, () => {
      OV.beam(p, { radius: 1.5, seconds: short ? 2.4 : 3.4 });
      const s0 = performance.now();
      const fadeIn = () => { if (!playing || !p.alive) return; const k = smooth(0.25, 1.1, (performance.now() - s0) / 1000); p.node.visibility = k * (vis || 1); if (k < 1) requestAnimationFrame(fadeIn); };
      fadeIn();
    });
    later(short ? 1.2 : 2.0, () => { p.controls = controls0 !== false; });
    const say = (line, secs) => { caption(line, secs); OV.say(line, secs, { owner: 'intro', priority: 'important', external: true }); };
    if (short) later(1.4, () => say(LINES[2], 2.8));
    else {
      // The greeting as the player appears; the free-will voice clip covers the next two lines.
      const spoken = (line, secs, clip) => { caption(line, secs); OV.say(line, secs, { owner: 'intro', priority: 'important', voice: clip }); };
      later(1.5, () => spoken(LINES[0], 2.6, 'overseer-found-your-way.mp3'));
      later(4.3, () => { audio = voice(); if (audio) audio.play().catch(() => {}); });
      later(4.5, () => say(LINES[1], 3.0));
      later(7.7, () => say(LINES[2], 2.6));
      later(10.8, () => spoken(LINES[3], 3.0, 'overseer-ask.mp3'));
    }
    later(SEC, () => end(false));
    return finished;
  }

  H.hooks.world.push({
    enter(w) {
      if (!wanted()) return;
      // A moment after the world starts (every module's set up, the player is in place).
      setTimeout(async () => {
        if (W() !== w || !wanted()) return;
        if (!G().cinematic && window.HawkesModules && HawkesModules.ensure) await HawkesModules.ensure('share').catch(() => {});
        if (W() === w && wanted() && G() && G().cinematic) play().catch((e) => H.report(e, 'intro'));
      }, 120);
    },
    leave() { playing = null; },
  });
  H.hooks.game.push((game) => {
    if (game.overseer) {
      game.overseer.intro = () => play();
      // game.overseer is its own object (overseer.js), not H.overseer: scripts and the playtest read it from here.
      Object.defineProperty(game.overseer, 'introPlaying', { get: () => Boolean(playing), enumerable: true, configurable: true });
    }
  });
  Object.defineProperties(OV, Object.getOwnPropertyDescriptors({ intro: play, get introPlaying() { return Boolean(playing); }, introSeen: seen, INTRO_LINES: LINES }));
})();
