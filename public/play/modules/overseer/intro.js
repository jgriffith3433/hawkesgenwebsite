// The beginning (J's story): the first time a player enters a world, the camera looks up at the Overseer in the sky,
// the Overseer beams the player down and says: "I have given you the power of free will. Do with it what you will."
// About fifteen seconds, and the player is in control from the moment the beam lands (about 2 s in): they can walk and
// look while the four lines play, each captioned with the Overseer's name in the letterbox bar (a dark plate on a phone).
// One tap, click, Esc, Space or Enter skips the rest and the camera blends behind the player in 0.4 s. A guest's intro
// ends with the beam's light on the mirror and the camera turned to it; the "first thing" card is for a signed-in player.
//   - config.overseer.intro: "first" (the default: once per player, remembered on this device), "always", "short" (a friend answering an invitation: the beam and one line, about 4.5 s) or false.
//   - The sound: a score made here (a hum, the beam's swell and whoosh, a chime, a tone under each line). The voice: a
//     sound asset named "overseer-intro" in the game, else the Overseer's own line (overseer.js VOICES).
//   - With sound still blocked by the browser (no click or key yet), it first shows the gateway: the Overseer's ring, one
//     "Enter" (click, tap, Enter or Space) that unlocks the sound and starts the intro at once (game.on('gateway')).
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
  const SECONDS = 15.5;

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
      if (H.audio && H.audio.media) H.audio.media(a);
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

  // ------------------------------------------------------------------ the caption: the Overseer's name and the line, in the letterbox bar
  const CAP_CSS = '.ov-cap{position:fixed;left:0;right:0;z-index:31;display:flex;justify-content:center;align-items:center;pointer-events:none;box-sizing:border-box;opacity:0;transition:opacity .35s;font-family:system-ui,sans-serif;color:#fff}'
    + '.ov-cap.on{opacity:1}.ov-cap .in{display:grid;gap:3px;text-align:center;max-width:min(92vw,900px)}'
    + '.ov-cap b{font:700 12px/1 system-ui,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#9fd0ff}'
    + '.ov-cap span{font:600 clamp(18px,2.1vw,26px)/1.25 system-ui,sans-serif;text-shadow:0 1px 6px rgba(0,0,0,.8)}'
    + '.ov-cap.bar{bottom:0}'
    + '.ov-cap.plate{top:max(64px,calc(env(safe-area-inset-top) + 60px));z-index:28;padding:0 12px}'
    + '.ov-cap.plate .in{background:rgba(6,9,22,.86);border:1px solid rgba(160,190,255,.35);border-radius:12px;padding:10px 16px 12px;box-shadow:0 6px 24px rgba(0,0,0,.5)}'
    + '.ov-cap.plate span{font-size:clamp(17px,4.6vw,22px)}'
    + 'body.ov-intro-on .hc-chat .hc-log{opacity:0!important}';
  /** Where the words go: the letterbox bar when there is room (a wide window), else a dark plate near the top, clear of the stick and buttons. */
  function captionBox() {
    const iw = window.innerWidth, ih = window.innerHeight;
    const bar = iw >= ih ? Math.round((ih - iw / 2.39) / 2) : 0;
    return bar >= 60 ? { mode: 'bar', h: bar } : { mode: 'plate', h: 0 };
  }

  /** Plays the intro now (resolves { skipped } when it ends). The player is in control from the moment the beam lands. */
  async function play() {
    const w = W(), g = G();
    if (!w || !g || playing) return { skipped: true };
    const p = w.player;
    const c = OV.position;
    if (!p || !p.alive || !c) return { skipped: true };
    playedThisPage = true;
    await waitForSound();
    if (W() !== w || !p.alive) return { skipped: true };
    const short = isShort();
    const SEC = short ? 4.5 : SECONDS;
    const guest = Boolean(window.HawkesGuest) && !window.HawkesGuest.looks;
    const at = [p.x, p.bottom, p.z];
    let hx = c[0] - at[0], hz = c[2] - at[2];
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const vis = p.node.visibility;
    const controls0 = p.controls;
    p.node.visibility = 0;
    p.controls = false; // until the beam lands (about 2 s in)
    // Looking up at the Overseer, over the player's shoulder: the game's own camera, which settles behind them by itself.
    const heading = Math.atan2(hx, hz);
    try { p.node.rotation.y = heading; w.camera.yaw = heading; w.camera.pitch = -0.32; } catch { /* a camera without them */ }
    const timers = [];
    const later = (s, fn) => timers.push(setTimeout(() => { if (playing && W() === w) fn(); }, s * 1000));
    const S = H.share;
    const box = captionBox();
    if (!document.getElementById('ov-cap-css')) { const st = document.createElement('style'); st.id = 'ov-cap-css'; st.textContent = CAP_CSS; document.head.appendChild(st); }
    const capEl = document.createElement('div');
    capEl.className = `ov-cap ${box.mode}`;
    if (box.mode === 'bar') capEl.style.height = `${box.h}px`;
    capEl.setAttribute('aria-live', 'polite');
    capEl.innerHTML = '<div class="in"><b></b><span></span></div>';
    document.body.appendChild(capEl);
    document.body.classList.add('ov-intro-on');
    if (box.mode === 'bar' && S && S.letterbox) S.letterbox(true, 2.39);
    let capUntil = 0, capTimer = null;
    /** A line in the caption: the speaker's name and the words, held at least 2 s (a missing voice clip changes nothing). */
    const caption = (line, secs) => {
      capEl.querySelector('b').textContent = 'Overseer';
      capEl.querySelector('span').textContent = line;
      capEl.classList.add('on');
      const hold = Math.max(2, secs);
      capUntil = performance.now() + hold * 1000;
      clearTimeout(capTimer);
      capTimer = setTimeout(() => capEl.classList.remove('on'), hold * 1000);
    };
    let audio = null, ended = false;
    let done;
    const finished = new Promise((r) => { done = r; });
    const SLOW = 0.4;
    /** One tap, click, Esc, Space or Enter: the rest is skipped and the camera blends behind the player in 0.4 s. */
    const skip = () => { if (playing && !ended) end(true); };
    const t0 = performance.now();
    const onKey = (e) => {
      if (performance.now() - t0 < 400 || e.repeat) return;
      const k = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase();
      if (!['escape', 'space', 'enter'].includes(k)) return;
      if (e.target && e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
      skip();
    };
    const OUT = '#touch,.tl-zone,button,a,input,textarea,select,.hp-enter,.gs-ui,.hc-form,.hc-card,.hc-panel';
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

    /** Gives the camera back behind the player over ~0.4 s. */
    const blendBehind = () => {
      const s0 = performance.now();
      const y0 = w.camera.yaw, q0 = w.camera.pitch;
      const dy = (() => { let d = (p.node.rotation.y - y0) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; })();
      const step = () => {
        if (W() !== w || !p.alive) return;
        const k = Math.min(1, (performance.now() - s0) / (SLOW * 1000));
        const e = k * k * (3 - 2 * k);
        try { w.camera.yaw = y0 + dy * e; w.camera.pitch = q0 + (0.32 - q0) * e; } catch { /* fine */ }
        if (k < 1) requestAnimationFrame(step);
      };
      step();
    };
    function end(skipped) {
      if (ended) return;
      ended = true;
      for (const t of timers) clearTimeout(t);
      clearTimeout(capTimer);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      if (audio && skipped) try { audio.pause(); } catch { /* fine */ }
      stopScore(skipped ? 0.4 : 2.5);
      if (H.speech) { H.speech.hold('intro', false); if (skipped) H.speech.clear('intro'); }
      capEl.classList.remove('on');
      setTimeout(() => capEl.remove(), 400);
      document.body.classList.remove('ov-intro-on');
      if (S && S.letterbox && box.mode === 'bar') S.letterbox(false);
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

    // The beam: the player appears in it and is in control as it lands.
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
      // The voice clip is the two free-will lines, so it starts with them.
      later(5.8, () => { audio = voice(); if (audio) audio.play().catch(() => {}); });
      // The greeting and the invitation have clips of their own (quality rule 6: no unvoiced story line): the desk plays them.
      const spoken = (line, secs, clip) => { caption(line, secs); OV.say(line, secs, { owner: 'intro', priority: 'important', voice: clip }); };
      later(3.0, () => spoken(LINES[0], 2.6, 'overseer-found-your-way.mp3'));
      later(6.0, () => say(LINES[1], 3.0));
      later(9.2, () => say(LINES[2], 2.6));
      later(12.3, () => spoken(LINES[3], 3.0, 'overseer-ask.mp3'));
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
    if (game.overseer) game.overseer.intro = () => play();
  });
  Object.defineProperties(OV, Object.getOwnPropertyDescriptors({ intro: play, get introPlaying() { return Boolean(playing); }, introSeen: seen, INTRO_LINES: LINES }));
})();
