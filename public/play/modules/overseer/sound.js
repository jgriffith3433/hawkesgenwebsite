// The Overseer's sound identity (docs/world-bible.md "The Overseer's sound"; Portal 2 / GLaDOS sting as the bar):
// a vast treated voice from the sky, a short leitmotif in three moods, and a beam that hums louder as you approach.
//
//   H.overseerSound.route(el)     every Overseer <audio> through the treatment into the voice bus (replaces media)
//   H.overseerSound.motif(mood)   wonder | amused | ominous: plays the sting on the music bus, ducks area music
//   H.overseerSound.beamHum       3D loop at the active beam; gain rises ~6 dB from 60 m to 5 m
//   H.overseerSound.shimmer()     sky shimmer when it reacts
//   H.overseerSound.swell()       deep presence swell (intro / first gift)
//   window.__overseerSound        playtest log: motifs, treatment, hum samples, shimmer, swell
//
// Phone: a light chain (high shelf + wet into the mix's one shared convolver). Captions stay on; motif starts at once.
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.overseerSound) return;

  const DIR = '/play/audio/sfx/';
  const FILES = {
    wonder: 'overseer-motif-wonder',
    amused: 'overseer-motif-amused',
    ominous: 'overseer-motif-ominous',
    hum: 'overseer-beam-hum',
    shimmer: 'overseer-sky-shimmer',
    swell: 'overseer-presence-swell',
  };
  const OMINOUS_RE = /\b(warn|careful|danger|destruction|fail|lost|slipped|not that|not yet|crowded|wandered|took that one)\b/i;
  const phone = () => Boolean(H.device && H.device.tier === 'phone');
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const dbOf = (g) => 20 * Math.log10(Math.max(1e-6, g));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const log = { motifs: [], treatment: [], hum: [], shimmer: [], swell: [], unlockMs: null };
  const push = (arr, row, cap = 80) => { arr.push(row); if (arr.length > cap) arr.shift(); };
  Object.defineProperty(window, '__overseerSound', { configurable: true, get() { return log; } });

  let cathedralBuf = null;
  let nextMood = null; // set by a reaction a moment before its speech line
  let lastMotifAt = 0;
  const buffers = {}; // mood -> AudioBuffer (preloaded for ≤200 ms motif start on a phone)
  let preloadStarted = false;

  function preloadMotifs() {
    if (preloadStarted) return;
    const c = ac();
    if (!c || !H.audio.running) return;
    preloadStarted = true;
    for (const mood of ['wonder', 'amused', 'ominous']) {
      fetch(url(FILES[mood]))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((ab) => (ab ? c.decodeAudioData(ab.slice(0)) : null))
        .then((buf) => { if (buf) buffers[mood] = buf; })
        .catch(() => { /* synth fallback stays */ });
    }
  }

  function ac() {
    const a = H.audio;
    return a && a.context && a.master ? a.context : null;
  }
  function url(name) { return DIR + name + '.mp3'; }
  function hasFile(name) {
    try {
      if (H.lib && H.lib.siteSound) {
        // siteSound's index is the sfx list; we also allow a HEAD-less try via Audio.
      }
    } catch { /* fine */ }
    return true; // missing files fail quietly on play
  }

  /** A long hall IR made in code (desktop cathedral treatment). Phone reuses the mix's shared convolver. */
  function cathedralIR(c) {
    if (cathedralBuf) return cathedralBuf;
    const sec = phone() ? 1.2 : 3.2;
    const n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / c.sampleRate;
        const env = Math.exp(-t * (phone() ? 2.4 : 1.1));
        const early = t < 0.08 ? (1 - t / 0.08) * 0.55 : 0;
        const noise = (Math.random() * 2 - 1);
        lp = lp * 0.97 + noise * 0.03;
        d[i] = (noise * 0.35 + lp * 0.65 + early * (Math.random() * 2 - 1)) * env * (ch ? 0.92 : 1);
      }
    }
    cathedralBuf = b;
    return b;
  }

  /** Builds the treatment once the audio graph is up. Returns { input, out } into the voice bus. */
  function makeChain(c) {
    const voice = H.audio.voice;
    if (!voice) return null;
    const input = c.createGain();
    const high = c.createBiquadFilter();
    high.type = 'highshelf'; high.frequency.value = 4200; high.gain.value = phone() ? 1.5 : 2.2;
    const low = c.createBiquadFilter();
    low.type = 'lowshelf'; low.frequency.value = 160; low.gain.value = phone() ? 2.5 : 4.5;
    const out = c.createGain(); out.gain.value = 1;
    out.connect(voice);

    input.connect(high);
    // Dry + low octave colour into the voice.
    const dry = c.createGain(); dry.gain.value = phone() ? 0.92 : 0.78;
    high.connect(dry); dry.connect(out);
    const lowG = c.createGain(); lowG.gain.value = phone() ? 0.18 : 0.32;
    high.connect(low); low.connect(lowG); lowG.connect(out);

    // Subtle chorus (two short delays with a slow LFO). Skipped on phone for the light chain.
    if (!phone()) {
      const lfo = c.createOscillator(); lfo.frequency.value = 0.35;
      const lfoG = c.createGain(); lfoG.gain.value = 0.004;
      lfo.connect(lfoG); lfo.start();
      for (const [base, g] of [[0.018, 0.14], [0.027, 0.1]]) {
        const d = c.createDelay(0.08); d.delayTime.value = base;
        const cg = c.createGain(); cg.gain.value = g;
        lfoG.connect(d.delayTime);
        high.connect(d); d.connect(cg); cg.connect(out);
      }
    }

    // Cathedral reverb: desktop has its own convolver; phone shares the mix's one.
    const wet = c.createGain(); wet.gain.value = phone() ? 0.22 : 0.38;
    high.connect(wet);
    const mixSend = H.mix && H.mix.reverbIn;
    if (phone() && mixSend) {
      wet.connect(mixSend);
    } else {
      const conv = c.createConvolver();
      conv.normalize = true;
      conv.buffer = cathedralIR(c);
      const wetOut = c.createGain(); wetOut.gain.value = 1;
      wet.connect(conv); conv.connect(wetOut); wetOut.connect(out);
    }
    return {
      input, out,
      kind: phone() ? 'light' : 'cathedral',
      nodes: ['highshelf', 'lowshelf', phone() ? 'shared-convolver' : 'chorus+cathedral'],
    };
  }

  const routed = new WeakSet();
  /** Routes an Overseer <audio> through the treatment into the voice bus (and ducks music). */
  function route(el) {
    if (!el || routed.has(el)) return el;
    const c = ac();
    if (!c || !H.audio.master) {
      try { if (H.audio && H.audio.media) H.audio.media(el, { voice: true }); } catch { /* fine */ }
      return el;
    }
    try {
      // Prefer the treatment even for community clips (open CORS + crossOrigin=anonymous); fall back if the browser refuses.
      const chain = makeChain(c);
      if (!chain) { H.audio.media(el, { voice: true }); return el; }
      el.crossOrigin = el.crossOrigin || 'anonymous';
      const src = c.createMediaElementSource(el);
      src.connect(chain.input);
      routed.add(el);
      el.__overseerTreated = chain.kind;
      const key = `overseer-voice:${Math.random().toString(36).slice(2, 8)}`;
      const on = () => {
        if (H.audio.voiceDuck) H.audio.voiceDuck(key, true);
        push(log.treatment, { at: Math.round(now()), kind: chain.kind, nodes: chain.nodes.slice(), src: el.src || '' });
        try { if (H.game) H.game.emit('overseer-sound', { what: 'treatment', kind: chain.kind, nodes: chain.nodes }); } catch { /* fine */ }
      };
      const off = () => { if (H.audio.voiceDuck) H.audio.voiceDuck(key, false); };
      el.addEventListener('playing', on);
      for (const ev of ['ended', 'pause', 'error', 'emptied']) el.addEventListener(ev, off);
    } catch {
      try { H.audio.media(el, { voice: true }); } catch { /* fine */ }
    }
    return el;
  }

  function moodOf(d) {
    if (nextMood) { const m = nextMood; nextMood = null; return m; }
    if (d && d.mood && FILES[d.mood]) return d.mood;
    if (d && d.owner === 'intro') return 'wonder';
    if (d && OMINOUS_RE.test(d.text || '')) return 'ominous';
    if (d && (d.owner === 'reaction' || d.kind === 'build' || d.kind === 'idle')) return 'amused';
    if (d && d.kind === 'fail') return 'ominous';
    return 'wonder';
  }

  /** Plays a motif sting; ducks area music under it. Returns ms from call to play start (for the phone criterion). */
  function motif(mood, detail) {
    const m = FILES[mood] ? mood : 'wonder';
    const t0 = now();
    const a = H.audio;
    const c = ac();
    if (!a || !c || !a.running) {
      push(log.motifs, { at: Math.round(t0), mood: m, ok: false, ms: 0, reason: 'no-audio' });
      return 0;
    }
    // Don't stack the same mood within 0.45 s (a double speech ask). Intro lines always get their own play.
    const introLine = detail && detail.owner === 'intro';
    if (!introLine && now() - lastMotifAt < 450 && log.motifs.length && log.motifs[log.motifs.length - 1].mood === m) {
      push(log.motifs, { at: Math.round(t0), mood: m, ok: true, ms: 0, reused: true });
      return 0;
    }
    lastMotifAt = now();
    try {
      if (a.duck) a.duck('overseer-motif', 0.28);
      // Prefer a pre-decoded buffer (phone ≤200 ms); else an <audio> element.
      const buf = buffers[m];
      if (buf) {
        const src = c.createBufferSource(); src.buffer = buf;
        const g = c.createGain(); g.gain.value = 0.85;
        src.connect(g).connect(a.background || a.master);
        src.start();
        const ms = Math.round(now() - t0);
        push(log.motifs, { at: Math.round(now()), mood: m, ok: true, ms, buffered: true, text: detail && detail.text ? String(detail.text).slice(0, 80) : null });
        try { if (H.game) H.game.emit('overseer-sound', { what: 'motif', mood: m, ms }); } catch { /* fine */ }
        setTimeout(() => { try { src.stop(); if (a.duck) a.duck('overseer-motif', null); } catch { /* fine */ } }, 4500);
        return ms;
      }
      const el = new Audio(url(FILES[m]));
      el.crossOrigin = 'anonymous';
      el.volume = 0.85;
      if (a.media) a.media(el, { background: true });
      const start = () => {
        const ms = Math.round(now() - t0);
        push(log.motifs, { at: Math.round(now()), mood: m, ok: true, ms, text: detail && detail.text ? String(detail.text).slice(0, 80) : null });
        try { if (H.game) H.game.emit('overseer-sound', { what: 'motif', mood: m, ms }); } catch { /* fine */ }
      };
      el.addEventListener('playing', start, { once: true });
      el.addEventListener('ended', () => { try { if (a.duck) a.duck('overseer-motif', null); } catch { /* fine */ } });
      el.addEventListener('error', () => {
        try { if (a.duck) a.duck('overseer-motif', null); } catch { /* fine */ }
        push(log.motifs, { at: Math.round(now()), mood: m, ok: false, ms: Math.round(now() - t0), reason: 'missing' });
        synthMotif(m, t0, detail);
      });
      const pr = el.play();
      if (pr && pr.catch) pr.catch(() => synthMotif(m, t0, detail));
      setTimeout(() => { try { el.pause(); if (a.duck) a.duck('overseer-motif', null); } catch { /* fine */ } }, 4500);
      return Math.round(now() - t0);
    } catch {
      return synthMotif(m, t0, detail);
    }
  }

  function synthMotif(mood, t0, detail) {
    const c = ac();
    if (!c || !H.audio.background) return 0;
    try {
      if (H.audio.duck) H.audio.duck('overseer-motif', 0.28);
      const bus = c.createGain(); bus.gain.value = 0.0001; bus.connect(H.audio.background);
      const t = c.currentTime + 0.02;
      const freqs = mood === 'ominous' ? [110, 138.6, 164.8, 98] : mood === 'amused' ? [392, 494, 587, 440] : [261.6, 329.6, 392, 523.3];
      freqs.forEach((f, i) => {
        const o = c.createOscillator(); o.type = mood === 'ominous' ? 'triangle' : 'sine';
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t + i * 0.18);
        g.gain.exponentialRampToValueAtTime(0.08 - i * 0.012, t + i * 0.18 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 1.4);
        o.connect(g).connect(bus); o.start(t + i * 0.18); o.stop(t + i * 0.18 + 1.6);
      });
      bus.gain.exponentialRampToValueAtTime(0.7, t + 0.05);
      bus.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      const ms = Math.round(now() - t0);
      push(log.motifs, { at: Math.round(now()), mood, ok: true, ms, synth: true, text: detail && detail.text ? String(detail.text).slice(0, 80) : null });
      try { if (H.game) H.game.emit('overseer-sound', { what: 'motif', mood, ms, synth: true }); } catch { /* fine */ }
      setTimeout(() => { try { if (H.audio.duck) H.audio.duck('overseer-motif', null); } catch { /* fine */ } }, 3000);
      return ms;
    } catch { return 0; }
  }

  // ------------------------------------------------------------------ beam hum (3D distance gain)
  const hum = { el: null, sp: null, gain: null, at: null, until: 0, lastDb: null, playing: false };
  /** Gain for distance: at least +6 dB from 60 m to 5 m (linear in dB between those). */
  function humGainFor(dist) {
    const d = clamp(dist, 5, 60);
    // At 60 m → -18 dB (gain ~0.126); at 5 m → -12 dB (gain ~0.251) → +6 dB.
    const db = -18 + ((60 - d) / 55) * 6;
    return Math.pow(10, db / 20);
  }
  function stopHum() {
    hum.playing = false; hum.at = null;
    try { if (hum.el) { hum.el.pause(); hum.el = null; } } catch { /* fine */ }
    try { if (hum.sp && hum.sp.stop) hum.sp.stop(); } catch { /* fine */ }
    hum.sp = null; hum.gain = null;
  }
  function attachHum(at, seconds) {
    const c = ac();
    if (!c || !H.audio.running || !at) return;
    hum.at = at.slice ? at.slice() : [at[0], at[1], at[2]];
    hum.until = now() + Math.max(2, Number(seconds) || 4) * 1000;
    if (hum.playing) return;
    hum.playing = true;
    try {
      const g = c.createGain(); g.gain.value = 0.0001;
      const dest = H.audio.effects || H.audio.master;
      const sp = H.audio.spatial ? H.audio.spatial(hum.at, { who: 'overseer-beam-hum', ref: 5, max: 80, bus: dest }) : null;
      if (sp) { g.connect(sp.input); if (sp.start) sp.start(); } else g.connect(dest);
      hum.gain = g; hum.sp = sp;
      const el = new Audio(url(FILES.hum));
      el.crossOrigin = 'anonymous'; el.loop = true; el.volume = 1;
      // Own graph (not media()): distance gain is ours.
      try {
        const src = c.createMediaElementSource(el);
        src.connect(g);
      } catch {
        // Cross-origin / already used: fall back to a soft oscillator loop.
        const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
        const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 82.5;
        const og = c.createGain(); og.gain.value = 0.4;
        o.connect(og); o2.connect(og); og.connect(g); o.start(); o2.start();
        hum.el = { pause() { try { o.stop(); o2.stop(); } catch { /* fine */ } }, synth: true };
        return;
      }
      hum.el = el;
      el.play().catch(() => { /* silent until unlock */ });
    } catch { hum.playing = false; }
  }
  function humStep() {
    if (!hum.playing || !hum.at) return;
    if (now() > hum.until) { stopHum(); return; }
    const w = H.world, cam = w && w.scene && w.scene.activeCamera;
    if (!cam || !hum.gain) return;
    const p = cam.globalPosition || cam.position;
    const dist = Math.hypot(p.x - hum.at[0], p.y - hum.at[1], p.z - hum.at[2]);
    const g = humGainFor(dist);
    const t = ac() && ac().currentTime;
    try { if (t != null) hum.gain.gain.setTargetAtTime(g, t, 0.08); else hum.gain.gain.value = g; } catch { /* fine */ }
    if (hum.sp && hum.sp.set) hum.sp.set(hum.at);
    const db = dbOf(g);
    if (hum.lastDb == null || Math.abs(db - hum.lastDb) >= 0.4) {
      hum.lastDb = db;
      push(log.hum, { at: Math.round(now()), dist: Math.round(dist * 10) / 10, gain: Math.round(g * 1000) / 1000, db: Math.round(db * 10) / 10 });
      try { if (H.game) H.game.emit('overseer-sound', { what: 'hum', dist, gain: g, db }); } catch { /* fine */ }
    }
  }

  function playOneShot(name, bus, vol) {
    const c = ac();
    if (!c || !H.audio.running) return false;
    try {
      const el = new Audio(url(name));
      el.crossOrigin = 'anonymous'; el.volume = vol == null ? 0.7 : vol;
      if (H.audio.media) H.audio.media(el, bus === 'music' ? { background: true } : { sfx: true });
      el.play().catch(() => {});
      return true;
    } catch { return false; }
  }
  function shimmer() {
    const ok = playOneShot(FILES.shimmer, 'sfx', 0.55);
    push(log.shimmer, { at: Math.round(now()), ok });
    try { if (H.game) H.game.emit('overseer-sound', { what: 'shimmer', ok }); } catch { /* fine */ }
    if (!ok) {
      // Soft high chime fallback.
      const c = ac();
      if (!c || !H.audio.effects) return;
      const t = c.currentTime;
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 1760;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(H.audio.effects); o.start(t); o.stop(t + 1.3);
    }
  }
  function swell() {
    let ok = playOneShot(FILES.swell, 'music', 0.65);
    let synth = false;
    if (!ok) {
      const c = ac();
      if (c && H.audio.background) {
        try {
          const t = c.currentTime;
          const bus = c.createGain(); bus.gain.value = 0.0001; bus.connect(H.audio.background);
          for (const [f, type, g0] of [[55, 'sine', 0.1], [82.5, 'triangle', 0.05], [110, 'sine', 0.035]]) {
            const o = c.createOscillator(); o.type = type; o.frequency.value = f;
            const g = c.createGain();
            g.gain.setValueAtTime(0.0001, t);
            g.gain.exponentialRampToValueAtTime(g0, t + 0.8);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
            o.connect(g).connect(bus); o.start(t); o.stop(t + 3.4);
          }
          bus.gain.exponentialRampToValueAtTime(0.8, t + 0.4);
          bus.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
          ok = true; synth = true;
        } catch { /* fine */ }
      }
    }
    push(log.swell, { at: Math.round(now()), ok, synth });
    try { if (H.game) H.game.emit('overseer-sound', { what: 'swell', ok }); } catch { /* fine */ }
  }

  function onSpeechStart(d) {
    const mood = moodOf(d);
    // Log treatment even when the line has no clip yet (intro external / captions): the chain is ready.
    push(log.treatment, {
      at: Math.round(now()),
      kind: phone() ? 'light' : 'cathedral',
      nodes: phone() ? ['highshelf', 'lowshelf', 'shared-convolver'] : ['highshelf', 'lowshelf', 'chorus', 'cathedral'],
      line: true,
      text: d && d.text ? String(d.text).slice(0, 80) : null,
      owner: d && d.owner || null,
    });
    try { if (H.game) H.game.emit('overseer-sound', { what: 'treatment', kind: phone() ? 'light' : 'cathedral', line: true }); } catch { /* fine */ }
    motif(mood, d);
  }

  H.hooks.frame.push(() => { try { humStep(); } catch (err) { H.report(err, 'overseer-sound'); } });
  H.hooks.world.push({ leave() { stopHum(); nextMood = null; } });
  H.hooks.game.push((game) => {
    game.on('overseer-speech', (d) => { if (d && d.state === 'start') onSpeechStart(d); });
    game.on('reaction', (d) => {
      nextMood = d && d.kind === 'fail' ? 'ominous' : 'amused';
      shimmer();
    });
    game.on('beam', (d) => {
      if (d && d.at) attachHum(d.at, Math.max(4, Number(d.seconds) || 6));
      shimmer();
    });
    game.on('intro', (d) => { if (d && d.state === 'start') { preloadMotifs(); swell(); } });
    game.on('audio-unlock', () => preloadMotifs());
    preloadMotifs();
    // Mirror / gift / progress lines stay wonder by default (moodOf).
    game.on('progress', () => { nextMood = 'wonder'; });
    game.on('wish', (d) => { if (d && (d.state === 'done' || d.state === 'offer')) nextMood = 'wonder'; });
  });

  H.overseerSound = {
    FILES, route, motif, shimmer, swell, moodOf, humGainFor,
    beamHum: { attach: attachHum, stop: stopHum, gainFor: humGainFor, get at() { return hum.at; }, get playing() { return hum.playing; }, get log() { return log.hum; } },
    get log() { return log; },
    /** Force a mood for the next speech line (playtests). */
    armMood(m) { nextMood = FILES[m] ? m : null; },
  };
})();
