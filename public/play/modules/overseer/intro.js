// The beginning (J's story): the first time a player enters a world, the camera looks up at the Overseer in the sky,
// the Overseer beams the player down and says: "I have given you the power of free will. Do with it what you will."
// About ten seconds; any key or a tap skips it. After that (or on a later visit), being beamed in is enough.
//   - config.overseer.intro: "first" (the default: once per player, remembered on this device), "always", or false.
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
  const LINES = ['I have given you the power of free will.', 'Do with it what you will.'];
  const SECONDS = 10.5;

  let playing = null;
  let playedThisPage = false;

  function policy() {
    const c = OV.config;
    if (!c) return false;
    const v = c.intro;
    if (v === false || v === 'off' || v === 'never' || v === 'none') return false;
    return v === 'always' ? 'always' : 'first';
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

  /** Plays the intro now (resolves { skipped } when it ends). */
  async function play() {
    const w = W(), g = G();
    if (!w || !g || !g.cinematic || playing) return { skipped: true };
    const p = w.player;
    const c = OV.position;
    if (!p || !p.alive || !c) return { skipped: true };
    playedThisPage = true;
    await waitForSound();
    if (W() !== w || !p.alive) return { skipped: true };
    const at = [p.x, p.bottom, p.z];
    // Toward the ship across the ground, and the side.
    let hx = c[0] - at[0], hz = c[2] - at[2];
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const sx = hz, sz = -hx;
    const lookUp = (pos, elev, dist = 60) => { const ce = Math.cos(elev), se = Math.sin(elev); return [pos[0] + hx * ce * dist, pos[1] + se * dist, pos[2] + hz * ce * dist]; };
    const k0 = [at[0] - hx * 9 + sx * 1.5, at[1] + 0.7, at[2] - hz * 9 + sz * 1.5];
    const k1 = [at[0] - hx * 6.5 - sx * 1.2, at[1] + 1.1, at[2] - hz * 6.5 - sz * 1.2];
    const k2 = [at[0] - hx * 3.2, at[1] + 1.6, at[2] - hz * 3.2];
    const keys = [
      { pos: k0, look: lookUp(k0, 0.36), at: 0 },
      { pos: k1, look: lookUp(k1, 0.27), at: SECONDS * 0.62 },
      { pos: k2, look: [at[0] + hx * 6, at[1] + 1.4, at[2] + hz * 6], at: SECONDS },
    ];
    const vis = p.node.visibility;
    p.node.visibility = 0;
    const timers = [];
    const later = (s, fn) => timers.push(setTimeout(() => { if (playing && W() === w) fn(); }, s * 1000));
    let audio = null;
    const skip = (e) => {
      if (!playing) return;
      if (e && e.type === 'keydown' && (e.repeat || ['shift', 'control', 'alt', 'meta'].includes(String(e.key || '').toLowerCase()))) return;
      try { g.cinematic.skip(); } catch { /* ended */ }
    };
    // Any key or a tap skips (a moment after it starts, so the click that started the game doesn't).
    const t0 = performance.now();
    const onKey = (e) => { if (performance.now() - t0 > 400) skip(e); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onKey, true);
    playing = { started: t0 };
    const stopScore = score();
    if (H.speech) H.speech.hold('intro');
    g.emit('intro', { state: 'start' });
    // The beam: the player appears in it.
    later(1.3, () => {
      OV.beam(p, { radius: 1.5, seconds: 3.4 });
      const s0 = performance.now();
      const fadeIn = () => { if (!playing || !p.alive) return; const k = smooth(0.25, 1.1, (performance.now() - s0) / 1000); p.node.visibility = k; if (k < 1) requestAnimationFrame(fadeIn); };
      fadeIn();
    });
    later(2.7, () => { audio = voice(); if (audio) audio.play().catch(() => {}); });
    later(3.0, () => OV.say(LINES[0], 3.1, { owner: 'intro', priority: 'important', external: true }));
    later(6.2, () => OV.say(LINES[1], 3.6, { owner: 'intro', priority: 'important', external: true }));
    let r = { skipped: true };
    try {
      r = await g.cinematic.path(keys, { seconds: SECONDS, fade: { in: 0.9, out: 0.6 }, letterbox: true, skippable: true, ease: 'inOut' });
    } catch (err) { H.report(err, 'intro'); }
    for (const t of timers) clearTimeout(t);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onKey, true);
    if (audio && r.skipped) try { audio.pause(); } catch { /* fine */ }
    stopScore(r.skipped ? 0.4 : 2.5);
    if (H.speech) { H.speech.hold('intro', false); if (r.skipped) H.speech.clear('intro'); }
    playing = null;
    if (W() === w && p.alive) {
      p.node.visibility = vis;
      // Skipped before the beam came: still beamed in.
      if (r.skipped && performance.now() - t0 < 1500) OV.beam(p, { radius: 1.3, seconds: 1.6 });
    }
    remember();
    if (G()) G().emit('intro', { state: 'end', skipped: Boolean(r.skipped) });
    return { skipped: Boolean(r.skipped) };
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
