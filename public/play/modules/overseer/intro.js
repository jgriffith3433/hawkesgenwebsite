// The beginning (J's story): the first time a player enters a world, the camera looks up at the Overseer in the sky,
// the Overseer beams the player down and says: "I have given you the power of free will. Do with it what you will."
// About ten seconds; any key or a tap skips it. After that (or on a later visit), being beamed in is enough.
//   - config.overseer.intro: "first" (the default: once per player, remembered on this device), "always", or false.
//   - The voice: a sound asset named "overseer-intro" in the game, if it has one; otherwise the words alone.
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
    if (!p || !G() || !G().cinematic || autoplayShot()) return false;
    if (p === 'always') return true;
    return !seen() && !playedThisPage;
  }
  OV.introWanted = wanted;

  /** The voice line, when the game has one (a sound named "overseer-intro"). */
  function voice() {
    let id = null;
    try { id = H.assets && H.assets.pick ? H.assets.pick('overseer-intro', { kind: 'sound' }) : null; } catch { id = null; }
    if (!id) { try { if (H.lib.hasAsset('overseer-intro.mp3')) id = 'overseer-intro.mp3'; } catch { /* none */ } }
    if (!id) return null;
    try {
      const a = new Audio(H.lib.assetUrl(id));
      a.crossOrigin = 'anonymous';
      if (H.audio && H.audio.media) H.audio.media(a);
      return a;
    } catch { return null; }
  }

  /** Plays the intro now (resolves { skipped } when it ends). */
  async function play() {
    const w = W(), g = G();
    if (!w || !g || !g.cinematic || playing) return { skipped: true };
    const p = w.player;
    const c = OV.position;
    if (!p || !p.alive || !c) return { skipped: true };
    playedThisPage = true;
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
    g.emit('intro', { state: 'start' });
    // The beam: the player appears in it.
    later(1.3, () => {
      OV.beam(p, { radius: 1.5, seconds: 3.4 });
      const s0 = performance.now();
      const fadeIn = () => { if (!playing || !p.alive) return; const k = smooth(0.25, 1.1, (performance.now() - s0) / 1000); p.node.visibility = k; if (k < 1) requestAnimationFrame(fadeIn); };
      fadeIn();
    });
    later(2.7, () => { audio = voice(); if (audio) audio.play().catch(() => {}); });
    later(3.0, () => OV.say(LINES[0], 3.1));
    later(6.2, () => OV.say(LINES[1], 3.6));
    let r = { skipped: true };
    try {
      r = await g.cinematic.path(keys, { seconds: SECONDS, fade: { in: 0.9, out: 0.6 }, letterbox: true, skippable: true, ease: 'inOut' });
    } catch (err) { H.report(err, 'intro'); }
    for (const t of timers) clearTimeout(t);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onKey, true);
    if (audio && r.skipped) try { audio.pause(); } catch { /* fine */ }
    if (r.skipped) OV.say('', 0.01);
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
      setTimeout(() => { if (W() === w && wanted()) play().catch((e) => H.report(e, 'intro')); }, 120);
    },
    leave() { playing = null; },
  });
  H.hooks.game.push((game) => {
    if (game.overseer) game.overseer.intro = () => play();
  });
  Object.defineProperties(OV, Object.getOwnPropertyDescriptors({ intro: play, get introPlaying() { return Boolean(playing); }, introSeen: seen, INTRO_LINES: LINES }));
})();
