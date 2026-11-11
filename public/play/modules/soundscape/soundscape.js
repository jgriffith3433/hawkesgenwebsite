// Soundscape: ambience beds crossfaded by where the player stands (inland wind and birds, beach waves and gulls, pier
// creaks), footsteps by surface (3+ variants, never the same one twice, slight pitch), and a sound for interactions.
// Everything goes through H.audio (master: the mute and volume; background: ambience, ducked under the Overseer).
// No timers: positions are read on the engine's frame hook. Files are /play/audio/sfx/<name>.mp3 listed in index.json;
// a missing file falls back to a small synthesized tone (interactions) or Juice's own steps.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.soundscape) return;
  const DIR = '/play/audio/sfx/';
  const BEDS = { inland: 'amb-inland', beach: 'amb-beach', pier: 'amb-pier' };
  // Per-bed loudness so a quiet Gen take does not drop out when the player walks into that area.
  const BED_GAIN = { inland: 0.78, beach: 0.95, pier: 0.72 };
  const STEPS = { sand: 'step-sand', grass: 'step-grass', dirt: 'step-grass', wood: 'step-wood', stone: 'step-stone' };
  const VARIANTS = 3;
  const bufs = new Map(), beds = {}, last = {};
  let index = null, started = false;
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  fetch(DIR + 'index.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((j) => { index = new Set((j && j.sounds) || []); });
  const has = (n) => Boolean(index && index.has(n));
  function load(name) {
    if (!bufs.has(name)) {
      const ctx = H.audio.context;
      bufs.set(name, fetch(`${DIR}${name}.mp3`).then((r) => r.arrayBuffer()).then((b) => ctx.decodeAudioData(b)).catch(() => { bufs.delete(name); return null; }));
    }
    return bufs.get(name);
  }
  function play(name, o = {}) {
    const ctx = H.audio.context;
    const dest = H.audio.effects || H.audio.master;
    if (!ctx || ctx.state !== 'running' || !dest) return;
    load(name).then((b) => {
      if (!b) return;
      const s = ctx.createBufferSource(), g = ctx.createGain();
      s.buffer = b; s.playbackRate.value = o.rate || 1; g.gain.value = o.volume ?? 1;
      s.connect(g).connect(dest); s.start();
    });
  }
  /** A different variant from the last one for this key (1..n), never the same twice in a row. */
  function pick(key, n) {
    let v = 1 + Math.floor(Math.random() * n);
    if (n > 1 && v === last[key]) v = (v % n) + 1;
    last[key] = v;
    return v;
  }
  /** How many `base-1`..`base-N` files the index lists (at least 1 to play). */
  function variantsOf(base) {
    let n = 0;
    while (has(`${base}-${n + 1}`)) n++;
    return n;
  }
  function tone(f1, f2, dur, vol) {
    const ctx = H.audio.context;
    const dest = H.audio.effects || H.audio.master;
    if (!ctx || ctx.state !== 'running' || !dest) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  const FALLBACK = { pickup: [660, 990, 0.12], place: [220, 140, 0.1], build: [440, 1320, 0.3], panel: [500, 700, 0.08], quest: [660, 1320, 0.35], send: [520, 880, 0.14] };
  /** One interaction sound by name (pickup, place, build, panel, quest, send): the file when the site has it, else a tone. */
  const UI_VOL = { pickup: 0.8, place: 0.85, build: 0.8, panel: 0.9, quest: 0.85, send: 0.95 };
  function ui(name) {
    if (has(`ui-${name}`)) play(`ui-${name}`, { volume: UI_VOL[name] ?? 0.8, rate: 0.97 + Math.random() * 0.06 });
    else if (FALLBACK[name]) tone(FALLBACK[name][0], FALLBACK[name][1], FALLBACK[name][2], 0.12);
  }
  // Wood Gen takes are sustained/thumpy (high RMS); scale them so pier boards match sand/grass punch.
  const STEP_VOL = { sand: 1, grass: 1, dirt: 1, wood: 0.35, stone: 0.9 };
  /** A footstep on a surface: true when this module plays it (its files exist), so Juice's synthesis stands down. */
  function step(surface, o = {}) {
    const base = STEPS[surface];
    const n = base ? variantsOf(base) : 0;
    if (!base || n < 1) return false;
    const vol = Math.min(1, (o.loudness ?? 0.3) * 1.6 * (STEP_VOL[surface] ?? 1));
    play(`${base}-${pick(base, n)}`, { volume: vol, rate: (o.pitch || 1) * (0.94 + Math.random() * 0.12) });
    return true;
  }

  // Where the island's areas are: the pier and beach lie east (x ~57..89), the inland path west of the beach.
  function weights(x) {
    const pier = smooth(60, 70, x), beach = smooth(28, 48, x) * (1 - pier * 0.85), inland = 1 - smooth(28, 48, x);
    return { inland, beach, pier };
  }
  function startBeds() {
    started = true;
    const ctx = H.audio.context, bed = H.audio.background;
    for (const k of Object.keys(BEDS)) {
      if (!has(BEDS[k])) { started = false; continue; }
      if (beds[k]) continue;
      beds[k] = { g: null };
      load(BEDS[k]).then((b) => {
        if (!b) { delete beds[k]; return; }
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = b; s.loop = true; g.gain.value = 0;
        s.connect(g).connect(bed); s.start(0, Math.random() * b.duration);
        beds[k].g = g;
      });
    }
  }
  H.hooks.frame.push(() => {
    try {
      const ctx = H.audio.context, w = H.world, p = w && w.player;
      if (!ctx || !p) return;
      // A hidden page stops its sound; coming back resumes it.
      if (document.hidden) { if (ctx.state === 'running') ctx.suspend().catch(() => {}); return; }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      if (ctx.state !== 'running' || !index) return;
      if (!started) startBeds();
      const wt = weights(p.x);
      for (const k of Object.keys(beds)) if (beds[k].g) beds[k].g.gain.setTargetAtTime(wt[k] * (BED_GAIN[k] ?? 0.8), ctx.currentTime, 0.6);
    } catch (err) { H.report(err, 'soundscape'); }
  });
  H.hooks.world.push({
    enter() {
      const g = H.game; if (!g || !g.on) return;
      g.on('spawn', () => ui('place'));
      g.on('pickup', () => ui('pickup'));
      g.on('quest', (d) => { if (d && (d.state === 'stepdone' || d.state === 'done')) ui('quest'); });
      g.on('asked', () => ui('send'));
      // Named build/panel events (playtest and future emitters) plus the island's real ones.
      g.on('build', () => ui('build'));
      g.on('panel', () => ui('panel'));
      g.on('workStart', () => ui('build'));
      g.on('mirror', (d) => { if (d && d.state === 'open') ui('panel'); });
      g.on('spawn-wheel', (d) => { if (d && (d.state === 'open' || !d.state)) ui('panel'); });
    },
  });
  H.soundscape = { step, ui, weights, play, beds: () => Object.keys(beds).filter((k) => beds[k].g), _last: last };
})();
