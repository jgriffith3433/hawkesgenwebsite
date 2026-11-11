// Mix: the island's Web Audio graph as a proper mix (docs/world/92-mix.md; the engine's buses are in runtime.js H.audio).
//   buses   music, ambience, voice, sfx (H.audio.effects), ui -> master -> makeup -> compressor -> limiter -> ceiling -> speakers
//   duck    a voice (H.audio.voiceDuck, every clip routed with { voice: true }) holds the music 8 dB and ambience 4 dB down
//   place   H.audio.spatial(at, o): HRTF + inverse-distance rolloff + a distance low-pass on desktop; equal-power stereo
//           (StereoPannerNode and a distance gain) on the phone tier. One listener: the camera.
//   rooms   convolution reverb zones blended by where the player is: open air, the hangar's hall, the wooden pier, a soft room
//           in any building (impulse responses made in code). The phone has one convolver, whose room is swapped.
//   level   a K-weighted loudness meter and a slow leveler that aims the master at -16 LUFS; window.__mix shows it all.
// No timers that fetch: everything runs on the engine's frame hook and the audio graph itself.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.mix) return;
  const M = H.mixMath;
  const A = H.audio;
  const B = window.BABYLON;
  const ctx = () => A.context;
  const phone = () => Boolean(H.device && H.device.tier === 'phone');
  const running = () => { const c = ctx(); return c && c.state === 'running' && A.master ? c : null; };

  // ------------------------------------------------------------------ the listener: the camera
  // Babylon is left-handed and Web Audio right-handed: x is mirrored for the listener and every panner, so a thing on
  // your right is heard on your right.
  const L = { pos: [0, 0, 0], right: [1, 0, 0], fwd: [0, 0, 1], up: [0, 1, 0], ok: false };
  function readListener() {
    const w = H.world, cam = w && w.scene && w.scene.activeCamera;
    if (!cam || !B) return false;
    const p = cam.globalPosition || cam.position;
    const f = cam.getDirection(B.Axis.Z), u = cam.getDirection(B.Axis.Y), r = cam.getDirection(B.Axis.X);
    L.pos = [p.x, p.y, p.z]; L.fwd = [f.x, f.y, f.z]; L.up = [u.x, u.y, u.z]; L.right = [r.x, r.y, r.z]; L.ok = true;
    return true;
  }
  function pushListener() {
    const c = running();
    if (!c || !L.ok) return;
    const l = c.listener;
    try {
      if (l.positionX) {
        l.positionX.value = -L.pos[0]; l.positionY.value = L.pos[1]; l.positionZ.value = L.pos[2];
        l.forwardX.value = -L.fwd[0]; l.forwardY.value = L.fwd[1]; l.forwardZ.value = L.fwd[2];
        l.upX.value = -L.up[0]; l.upY.value = L.up[1]; l.upZ.value = L.up[2];
      } else { l.setPosition(-L.pos[0], L.pos[1], L.pos[2]); l.setOrientation(-L.fwd[0], L.fwd[1], L.fwd[2], -L.up[0], L.up[1], L.up[2]); }
    } catch { /* fine */ }
  }

  // ------------------------------------------------------------------ placing a sound
  const voices = []; // what was placed, newest last: { who, at, dist, pan, model, t } (window.__mix.voices)
  const live = new Set(); // placed sources that follow something or are still playing: updated every frame
  /** A place for a sound: connect your node to `.input` (it ends at o.bus, else the effects bus). `at` is [x,y,z] or a function
   *  giving it (a moving thing). o: ref (full volume to there, 4), rolloff (1; 0 = no distance gain), max (220), muffle (1 = the
   *  distance low-pass, 0 = none, 2 = a blast), who (for the log). Returns { input, set(at), start(), stop(), info }. */
  function spatial(at, o = {}) {
    const c = ctx();
    if (!c || !A.master) return null;
    const bus = o.bus || A.effects || A.master;
    const get = typeof at === 'function' ? at : () => at;
    const input = c.createGain();
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
    const hrtf = !phone();
    let panner = null, dist = null, stereo = null;
    if (hrtf) {
      panner = c.createPanner();
      panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
      panner.refDistance = o.ref || 4; panner.maxDistance = o.max || 220; panner.rolloffFactor = o.rolloff ?? 1;
      input.connect(lp); lp.connect(panner); panner.connect(bus);
    } else {
      dist = c.createGain(); stereo = c.createStereoPanner(); // (equal-power)
      input.connect(lp); lp.connect(dist); dist.connect(stereo); stereo.connect(bus);
    }
    const rec = { who: o.who || null, at: [0, 0, 0], dist: 0, pan: 0, model: hrtf ? 'hrtf' : 'stereo', t: Math.round(performance.now()), gain: 1, cutoff: 20000 };
    const sp = {
      input, info: rec, node: panner || stereo,
      /** Moves it (or re-reads it from the function it was given) and updates the pan, gain and low-pass. */
      set(p) {
        const a = p || get() || [0, 0, 0];
        const pl = M.place(L, a, { ref: o.ref, rolloff: o.rolloff, max: o.max, muffle: o.muffle });
        rec.at = [Math.round(a[0] * 10) / 10, Math.round(a[1] * 10) / 10, Math.round(a[2] * 10) / 10]; rec.dist = Math.round(pl.dist * 10) / 10; rec.pan = Math.round(pl.pan * 100) / 100; rec.gain = Math.round(pl.gain * 1000) / 1000; rec.cutoff = Math.round(pl.cutoff);
        const t = c.currentTime;
        try {
          if (panner) {
            if (panner.positionX) { panner.positionX.value = -a[0]; panner.positionY.value = a[1]; panner.positionZ.value = a[2]; } else panner.setPosition(-a[0], a[1], a[2]);
          } else { stereo.pan.setTargetAtTime(pl.pan, t, 0.03); dist.gain.setTargetAtTime(o.rolloff === 0 ? 1 : pl.gain, t, 0.03); }
          lp.frequency.setTargetAtTime(pl.cutoff, t, 0.03);
        } catch { /* fine */ }
        return rec;
      },
      start() { live.add(sp); sp.set(); },
      stop() { live.delete(sp); },
    };
    readListener(); pushListener();
    sp.set();
    voices.push(rec); if (voices.length > 60) voices.shift();
    if (typeof at === 'function') live.add(sp);
    return sp;
  }
  A.spatial = spatial;
  A.listen = () => { if (readListener()) pushListener(); };

  // ------------------------------------------------------------------ reverb zones
  const send = { in: null, convs: {}, wet: {}, buffers: {}, shared: null, sharedWet: null, sharedZone: null, linked: {}, ready: false };
  const irOf = (zone, c) => {
    if (!send.buffers[zone]) {
      const ir = M.impulse(zone, c.sampleRate, phone() ? 0.55 : 1, 3);
      const b = c.createBuffer(2, ir.left.length, c.sampleRate);
      b.copyToChannel(ir.left, 0); b.copyToChannel(ir.right, 1);
      send.buffers[zone] = b;
    }
    return send.buffers[zone];
  };
  function setupSends(c) {
    if (send.ready || !A.effects || !A.voice) return;
    send.in = c.createGain();
    // What goes into the rooms: the world's effects and the voices (never the music or the interface).
    const t1 = c.createGain(); t1.gain.value = 0.7; A.effects.connect(t1).connect(send.in);
    const t2 = c.createGain(); t2.gain.value = 0.45; A.voice.connect(t2).connect(send.in);
    if (phone()) {
      send.shared = c.createConvolver(); send.shared.normalize = true;
      send.sharedWet = c.createGain(); send.sharedWet.gain.value = 0;
      send.in.connect(send.shared); send.shared.connect(send.sharedWet); send.sharedWet.connect(A.master);
    } else {
      for (const z of M.ZONE_NAMES) { send.wet[z] = c.createGain(); send.wet[z].gain.value = 0; send.wet[z].connect(A.master); }
    }
    send.ready = true;
  }
  /** Sets the rooms' wet levels from the blend: every room at its share (desktop), or the strongest alone (phone). */
  function applyReverb(c, w, zone) {
    const t = c.currentTime;
    if (phone()) {
      if (send.sharedZone !== zone) {
        // One convolver: close its send, swap the room's impulse, open it again (no click, no second reverb).
        send.sharedZone = zone;
        send.sharedWet.gain.cancelScheduledValues(t); send.sharedWet.gain.setTargetAtTime(0, t, 0.02);
        setTimeout(() => {
          if (send.sharedZone !== zone) return;
          try { send.shared.buffer = irOf(zone, c); } catch { /* fine */ }
          send.sharedWet.gain.setTargetAtTime(M.ZONES[zone].wet, c.currentTime, 0.15);
        }, 90);
      }
      return;
    }
    for (const z of M.ZONE_NAMES) {
      const level = w[z] * M.ZONES[z].wet;
      if (level > 0.01 && !send.linked[z]) {
        if (!send.convs[z]) { send.convs[z] = c.createConvolver(); send.convs[z].buffer = irOf(z, c); send.convs[z].connect(send.wet[z]); }
        send.in.connect(send.convs[z]); send.linked[z] = true;
      }
      send.wet[z].gain.setTargetAtTime(level, t, 0.25);
      // Silent for good (and its tail gone): the convolver stops costing anything.
      if (level <= 0.01 && send.linked[z]) { send.idle = send.idle || {}; send.idle[z] = (send.idle[z] || 0) + 1; if (send.idle[z] > 30) { try { send.in.disconnect(send.convs[z]); } catch { /* fine */ } send.linked[z] = false; send.idle[z] = 0; } } else if (send.idle) send.idle[z] = 0;
    }
  }

  // ------------------------------------------------------------------ where the player is
  const state = { zone: 'open', weights: M.blend({}), raw: { hangar: 0, pier: 0, building: 0 }, changes: [] };
  let pierE = null, homes = [], homesAt = -9;
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const posOfE = (e) => [num(e.x, 0), num(e.y, 0), num(e.z, 0)];
  const ROOMY = /(^|[^a-z])(hut|house|cabin|shed|barn|home|hangar room)([^a-z]|$)/i;
  function rawZones() {
    const w = H.world, p = w && w.player;
    if (!p) return null;
    const at = posOfE(p), raw = { hangar: 0, pier: 0, building: 0 };
    const hg = H.overseer && H.overseer.hangar;
    if (hg && hg.inside) raw.hangar = 1;
    if (!pierE || !pierE.alive) { const g = H.game; pierE = g && g.find ? g.find('pier') || g.find('Pier') : null; }
    if (pierE) raw.pier = M.pierWeight(at, posOfE(pierE), [num(pierE.half && pierE.half[0], 16), num(pierE.half && pierE.half[1], 0.15), num(pierE.half && pierE.half[2], 1.6)]);
    const now = performance.now() / 1000;
    if (now - homesAt > 2) {
      homesAt = now;
      homes = (w.entities || []).filter((e) => e && e.alive && (e.kind === 'house' || (e.data && e.data.reverb === 'room') || (e.name && ROOMY.test(e.name) && e.kind !== 'zone')));
    }
    for (const e of homes) raw.building = Math.max(raw.building, M.nearBox(at, posOfE(e), [Math.max(1, num(e.half && e.half[0], 2)), Math.max(1, num(e.half && e.half[1], 1.5)), Math.max(1, num(e.half && e.half[2], 2))], 1.2));
    return raw;
  }
  let zoneAt = 0;
  function zones(c) {
    const raw = rawZones();
    if (!raw) return;
    const w = M.blend(raw), prev = state.zone, next = M.activeZone(prev, w);
    state.raw = raw; state.weights = w;
    if (next !== prev) {
      state.zone = next;
      const ev = { from: prev, to: next, at: Math.round(performance.now()), weights: Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v * 100) / 100])), wet: M.ZONES[next].wet, tail: M.ZONES[next].len };
      state.changes.push(ev); if (state.changes.length > 40) state.changes.shift();
      try { H.game && H.game.emit('mix-zone', ev); } catch { /* fine */ }
    }
    setupSends(c);
    if (send.ready) applyReverb(c, w, state.zone);
  }

  // ------------------------------------------------------------------ the loudness meter and the leveler
  const meter = { loud: new M.Loudness(), on: false, nodes: null, peakOn: false, acc: 0, n: 0, block: 0 };
  function startMeter(c) {
    if (meter.nodes || !A.output || !c.createScriptProcessor) return;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    const shelf = c.createBiquadFilter(); shelf.type = 'highshelf'; shelf.frequency.value = 1500; shelf.gain.value = 4;
    const sp = c.createScriptProcessor(2048, 2, 1);
    const mute = c.createGain(); mute.gain.value = 0;
    A.output.connect(hp); hp.connect(shelf); shelf.connect(sp); sp.connect(mute); mute.connect(c.destination);
    const per = Math.round(c.sampleRate * 0.1);
    sp.onaudioprocess = (e) => {
      const a = e.inputBuffer.getChannelData(0), b = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : a;
      for (let i = 0; i < a.length; i++) {
        meter.acc += a[i] * a[i] + b[i] * b[i];
        if (++meter.n >= per) { meter.loud.push(meter.acc / per); meter.acc = 0; meter.n = 0; meter.block++; }
      }
    };
    meter.nodes = { hp, shelf, sp, mute };
    meter.on = true;
  }
  function startPeaks(c) {
    if (meter.peakNode || !A.output || !c.createScriptProcessor) return;
    const sp = c.createScriptProcessor(2048, 2, 1), mute = c.createGain(); mute.gain.value = 0;
    A.output.connect(sp); sp.connect(mute); mute.connect(c.destination);
    sp.onaudioprocess = (e) => {
      for (let ch = 0; ch < e.inputBuffer.numberOfChannels; ch++) {
        const d = e.inputBuffer.getChannelData(ch);
        for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > meter.loud.peak) meter.loud.peak = v; if (v >= 0.999) meter.loud.clipped++; }
      }
      meter.loud.samples += e.inputBuffer.length;
    };
    meter.peakNode = sp;
  }
  let levelAt = 0;
  function leveler(c) {
    startMeter(c);
    const now = c.currentTime;
    if (now - levelAt < 1) return;
    levelAt = now;
    if (!meter.on || state.hold) return;
    A.makeupDb = M.level(A.makeupDb, meter.loud.shortTerm(), 1);
  }

  // ------------------------------------------------------------------ unlocking on the first tap
  const unlock = { first: null, ms: null, state: null };
  function gesture() {
    const c = ctx();
    if (!c) return;
    if (unlock.first === null) unlock.first = performance.now();
    A.master; // (builds the graph now, in the gesture)
    if (c.state !== 'running') c.resume().catch(() => {});
  }
  for (const ev of ['pointerdown', 'touchstart', 'touchend', 'keydown', 'click']) window.addEventListener(ev, gesture, true);
  function watchUnlock() {
    const c = ctx();
    if (!c || unlock.watching) return;
    unlock.watching = true;
    c.addEventListener('statechange', () => {
      unlock.state = c.state;
      if (c.state === 'running' && unlock.ms === null && unlock.first !== null) {
        unlock.ms = Math.round(performance.now() - unlock.first);
        try { H.game && H.game.emit('audio-unlock', { ms: unlock.ms, model: phone() ? 'stereo' : 'hrtf' }); } catch { /* fine */ }
      }
    });
  }

  // ------------------------------------------------------------------ every frame
  H.hooks.frame.push(() => {
    try {
      const c = ctx();
      if (!c) return;
      watchUnlock();
      if (c.state !== 'running') return;
      if (readListener()) pushListener();
      for (const sp of live) sp.set();
      const now = performance.now();
      if (now - zoneAt > 100) { zoneAt = now; zones(c); }
      leveler(c);
    } catch (err) { H.report(err, 'mix'); }
  });

  // ------------------------------------------------------------------ what the playtest and the console read
  const API = {
    spatial, listener: L, zones: state, voices, unlock, math: M,
    get zone() { return state.zone; },
    get model() { return phone() ? 'stereo' : 'hrtf'; },
    get levels() { return A.levels; },
    /** Loudness since the meter's last reset: { momentary, shortTerm, integrated, peak, clipped, blocks, makeupDb } (LUFS). */
    lufs() { const l = meter.loud; return { momentary: l.momentary(), shortTerm: l.shortTerm(), integrated: l.integrated(), peak: Math.round(l.peak * 1000) / 1000, peakDb: Math.round(M.gainToDb(l.peak) * 10) / 10, clipped: l.clipped, blocks: meter.block, makeupDb: Math.round(A.makeupDb * 10) / 10 }; },
    /** Starts (or restarts) a measurement: the integrated loudness and the peaks count from now. */
    measure() { const c = running(); if (c) { startMeter(c); startPeaks(c); } meter.loud.reset(); return meter.on; },
    reset() { meter.loud.reset(); },
    /** The voices placed since a mark, with their pan now (the live ones follow what they came from). */
    voicesSince(t = 0) { return voices.filter((v) => v.t >= t); },
    /** A short tone from a place, for checks: plays through the voice bus's placement and returns its record. */
    probe(at, o = {}) {
      const c = running();
      if (!c) return null;
      const sp = spatial(at, { who: o.who || 'probe', bus: o.bus || A.voice });
      const osc = c.createOscillator(), g = c.createGain();
      osc.frequency.value = o.freq || 440; g.gain.value = o.gain ?? 0.2;
      osc.connect(g).connect(sp.input);
      const dur = o.seconds || 0.6;
      osc.start(); osc.stop(c.currentTime + dur);
      sp.start(); setTimeout(() => sp.stop(), dur * 1000);
      return sp.info;
    },
  };
  H.mix = API;
  // window.__mix: the numbers, always current (reads, never stores).
  Object.defineProperty(window, '__mix', {
    configurable: true,
    get() {
      const lv = A.levels;
      return {
        model: API.model, zone: state.zone, weights: state.weights, raw: state.raw, zoneChanges: state.changes,
        levels: lv, duckDb: lv.duckDb, buses: { music: lv.music, ambience: lv.ambience, voice: lv.voice, sfx: lv.sfx, ui: lv.ui },
        settings: { music: lv.musicSetting, voice: lv.voiceSetting, effects: lv.effectsSetting },
        unlock: { ...unlock }, running: Boolean(running()), voices: voices.slice(-20), lufs: API.lufs(), api: API,
      };
    },
  });
})();
