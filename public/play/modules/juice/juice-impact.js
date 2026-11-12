// Juice: the impact sound library (hawkes.library.json "impact-sounds"; clips from Hawkes Gen audio.sfx in
// public/play/audio/impact/, listed in its index.json). One player for everything that hits something:
//   H.impact.hit(a, b, { speed, impulse, at, t0 })  two bodies met (juice-audio.js sends every Havok collision here): the
//       material from both bodies (the louder one rings: metal over wood over stone, sand under everything on a beach),
//       light or heavy by the impulse, a variant that is never the one played last in that set, pitch +-8 percent, gain
//       +-2 dB, a rate limit per body so a pile of crates does not machine-gun; through the sfx bus, placed at the hit.
//   H.impact.explosion(at, radius)  a blast: the sound arrives distance / 343 m/s late (scheduled on the audio clock),
//       the near version (crack and boom) up to 60 m, past that the far one (a rolling boom) through a low-pass; then
//       the debris patter.
//   H.impact.fish('cast' | 'plop' | 'strike' | 'flap' | 'reel', { at, volume })  the fishing set (water.js sound()).
//   H.impact.splash(at, size)  something into the sea (water.js).   H.impact.roll(body, speed, at)  a barrel rolling.
// Loading: the near sets (every material, the near blast, the fishing set) first, the far tails (far blast, debris, barrel
// roll) a moment after, so a phone's first frame never waits for them; decoded on the first tap. Until a set is decoded
// the older synthesized hit plays (hit() returns null, juice-audio.js falls through). Everything is logged
// (window.__impact.log: kind, material, weight, variant, delay, latency) for the `island-impact` playtest.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || !H.juiceMath) return;
  const M = H.juiceMath;
  const clamp = M.clamp;
  const DIR = '/play/audio/impact/';
  const SOUND_OF_LIGHT = 343; // m/s
  const FAR_FROM = 60;        // m: past this a blast is the far version

  // ------------------------------------------------------------------ the library: files by set, decoded once
  const lib = { index: null, raw: new Map(), bufs: new Map(), bytes: 0, loading: false, phase: 'idle', decoded: 0 };
  const ctx = () => H.audio && H.audio.context;
  const bus = () => (H.audio && (H.audio.effects || H.audio.master)) || null;
  const live = () => { const a = ctx(); return a && a.state === 'running' && bus() ? a : null; };
  const camPos = () => { const w = H.world; const c = w && w.scene && w.scene.activeCamera; return c ? c.globalPosition || c.position : null; };
  const distTo = (at) => { const c = camPos(); return c && at ? Math.hypot(at[0] - c.x, at[1] - c.y, at[2] - c.z) : 0; };
  const rnd = (a, b) => a + Math.random() * (b - a);

  const fetchSet = (name) => {
    const files = (lib.index.sets && lib.index.sets[name]) || [];
    return Promise.all(files.map((f) => fetch(DIR + f).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null).then((b) => {
      if (b) { lib.bytes += b.byteLength; lib.raw.set(`${name}:${f}`, b); }
    })));
  };
  /** Fetches the index and the near sets now, the far ones after the near ones and a pause (not before the first frame). */
  function load() {
    if (lib.loading || typeof fetch !== 'function' || typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return;
    lib.loading = true;
    fetch(DIR + 'index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((ix) => {
      if (!ix || !ix.sets) { lib.phase = 'none'; return; }
      lib.index = ix;
      const far = new Set(ix.far || []);
      const names = Object.keys(ix.sets);
      lib.phase = 'near';
      return Promise.all(names.filter((n) => !far.has(n)).map(fetchSet)).then(() => {
        lib.phase = 'near-ready'; decode();
        return new Promise((res) => setTimeout(res, 2000));
      }).then(() => Promise.all(names.filter((n) => far.has(n)).map(fetchSet))).then(() => { lib.phase = 'all'; decode(); });
    });
  }
  /** Decodes what has arrived (needs the audio context, so after the first tap; a suspended one decodes fine). */
  function decode() {
    const a = ctx();
    if (!a || !lib.index) return;
    for (const [key, raw] of lib.raw) {
      lib.raw.delete(key);
      const i = key.indexOf(':'), name = key.slice(0, i), file = key.slice(i + 1);
      const files = lib.index.sets[name] || [];
      const slot = files.indexOf(file);
      a.decodeAudioData(raw.slice(0)).then((buf) => { let arr = lib.bufs.get(name); if (!arr) { arr = new Array(files.length).fill(null); lib.bufs.set(name, arr); } arr[slot] = buf; lib.decoded++; }).catch(() => {});
    }
  }
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, () => decode(), { passive: true, capture: true });
  load();

  const have = (set) => { const arr = lib.bufs.get(set); return arr ? arr.filter(Boolean).length : 0; };
  const ready = () => have('wood-light') > 0 && have('metal-heavy') > 0;

  // ------------------------------------------------------------------ the log the playtest reads
  const log = [];
  const stats = { played: 0, limited: 0, repeats: 0, byMaterial: {}, variants: {}, maxLatencyMs: 0, lastFile: null };
  function note(e) {
    e.t = Math.round(performance.now());
    log.push(e); if (log.length > 800) log.shift();
    if (e.kind === 'impact') {
      stats.played++;
      const m = e.material;
      stats.byMaterial[m] = (stats.byMaterial[m] || 0) + 1;
      (stats.variants[m] || (stats.variants[m] = new Set())).add(e.file);
      if (e.latencyMs > stats.maxLatencyMs) stats.maxLatencyMs = e.latencyMs;
      if (e.file === stats.lastFile) stats.repeats++;
      stats.lastFile = e.file;
    }
    return e;
  }

  // ------------------------------------------------------------------ choosing a variant: never the same twice in a row
  const lastIdx = new Map();
  function pick(set) {
    const arr = lib.bufs.get(set);
    if (!arr) return null;
    const ok = []; arr.forEach((b, i) => { if (b) ok.push(i); });
    if (!ok.length) return null;
    let i = ok[Math.floor(Math.random() * ok.length)];
    if (ok.length > 1) { const last = lastIdx.get(set); while (i === last) i = ok[Math.floor(Math.random() * ok.length)]; }
    lastIdx.set(set, i);
    return { i, buf: arr[i], file: (lib.index.sets[set] || [])[i] || `${set}-${i + 1}` };
  }

  // ------------------------------------------------------------------ where it goes: the sfx bus, placed at the hit
  function outFor(a, at, o = {}) {
    const dest = bus();
    const g = a.createGain();
    if (at && H.audio.spatial) {
      const sp = H.audio.spatial(at, { ref: o.ref ?? 3, max: o.max ?? 150, rolloff: o.rolloff ?? 1.1, muffle: o.muffle, bus: dest, who: 'impact' });
      if (sp) { g.connect(sp.input); return g; }
    }
    g.connect(dest);
    return g;
  }
  /** One clip: a source through a gain (and a low-pass for far things), started `delay` s from now on the audio clock. */
  function fire(buf, o) {
    const a = live();
    if (!a) return null;
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.rate || 1;
    const g = outFor(a, o.at, o.spatial);
    g.gain.value = o.gain;
    let tail = src;
    if (o.lowpass) { const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass; f.Q.value = 0.5; src.connect(f); tail = f; }
    tail.connect(g);
    src.start(a.currentTime + Math.max(0, o.delay || 0));
    src.onended = () => { try { g.disconnect(); } catch { /* gone */ } };
    return src;
  }
  const db = (x) => Math.pow(10, x / 20);

  // ------------------------------------------------------------------ impacts: material, weight, variant, rate limit
  const LIBMAT = { wood: 'wood', plastic: 'wood', metal: 'metal', stone: 'stone', glass: 'glass', water: 'water', dirt: 'sand', flesh: 'sand' };
  const isBarrel = (e) => Boolean(e && ((e.data && (e.data.barrel || e.data.explosive)) || /barrel|drum/i.test(String(e.name || e.sceneId || ''))));
  function materialFor(a, b, at) {
    const ma = M.materialOf(a), mb = M.materialOf(b);
    const main = (M.LOUD[ma] ?? 0) >= (M.LOUD[mb] ?? 0) ? ma : mb;
    let m = LIBMAT[main] || 'stone';
    // On the beach everything but metal and glass lands in sand.
    const ground = a && a.isTerrain ? a : b && b.isTerrain ? b : null;
    if (ground && m !== 'metal' && m !== 'glass' && at && H.terrain && H.terrain.materialAt) { try { if (H.terrain.materialAt(at[0], at[2]) === 'sand') m = 'sand'; } catch { /* no ground info */ } }
    return m;
  }
  const bodyId = (e) => e && (e._jid || (e._jid = ++bodyIds));
  let bodyIds = 100000;
  const voices = [];
  /** A body's own rate limit: no sooner than `gap` after its last sound, and 5 a second. */
  function limited(e, now, gap) {
    if (!e) return false;
    const s = e._imp || (e._imp = { t: -1e9, n: 0, w: 0 });
    if (now - s.t < gap) return true;
    if (now - s.w > 1000) { s.w = now; s.n = 0; }
    if (s.n >= 5) return true;
    s.t = now; s.n++;
    return false;
  }

  function hit(a, b, o = {}) {
    if (!lib.index) return null;
    const t0 = o.t0 ?? performance.now();
    const at = o.at || (a ? [a.x, a.y, a.z] : null);
    const d = distTo(at);
    if (d > 90) return null;
    const dynA = a && a.physics === 'dynamic' ? a : null, dynB = b && b.physics === 'dynamic' ? b : null;
    const mover = dynA || dynB;
    const mass = clamp(Math.min(dynA ? dynA.mass : 1e9, dynB ? dynB.mass : 1e9), 0.05, 400);
    const speed = Math.abs(Number(o.speed) || 0);
    const energy = Number(o.impulse) > 0 ? Number(o.impulse) : speed * (Number.isFinite(mass) ? mass : 1);
    const heavy = speed >= 7 || energy >= 80;
    let material = materialFor(a, b, at);
    let set = `${material}-${heavy ? 'heavy' : 'light'}`;
    const barrel = isBarrel(a) || isBarrel(b);
    if (barrel && !heavy) { material = 'metal'; set = 'barrel-bounce'; }
    if (!have(set)) return null;
    // Rate limit: the body that moves, and the pair
    const now = performance.now();
    if (limited(mover, now, heavy ? 0.16 * 1000 : 0.09 * 1000)) { stats.limited++; return 'limited'; }
    const p = pick(set);
    if (!p) return null;
    const rate = 1 + rnd(-0.08, 0.08);
    const gdb = rnd(-2, 2);
    const base = heavy ? clamp(0.55 + speed / 30, 0.55, 1) : clamp(0.25 + speed / 12, 0.25, 0.75);
    // Concurrent voices are capped (the oldest are left to ring out).
    while (voices.length && voices[0] < now) voices.shift();
    if (voices.length >= 18 && base < 0.5) { stats.limited++; return 'limited'; }
    const src = fire(p.buf, { at, gain: base * db(gdb), rate });
    if (!src) return null;
    voices.push(now + p.buf.duration * 1000 / rate);
    return note({
      kind: 'impact', material, weight: set === 'barrel-bounce' ? 'bounce' : heavy ? 'heavy' : 'light', set, variant: p.i + 1, file: p.file,
      delayMs: 0, latencyMs: Math.round((performance.now() - t0) * 10) / 10, pitch: Math.round(rate * 1000) / 1000, gainDb: Math.round(gdb * 10) / 10,
      body: (mover && (mover.sceneId || mover.name)) || '?', other: (b && (b.sceneId || b.name)) || '?', speed: Math.round(speed * 10) / 10, dist: Math.round(d),
    });
  }

  /** Something splashes into the sea: the water set, light or heavy by its size. */
  function splash(at, size = 1, o = {}) {
    const heavy = size >= 1.2;
    const set = `water-${heavy ? 'heavy' : 'light'}`;
    if (!have(set)) return null;
    const d = distTo(at);
    if (d > 90) return null;
    const p = pick(set), rate = 1 + rnd(-0.08, 0.08), gdb = rnd(-2, 2);
    const src = p && fire(p.buf, { at, gain: clamp(0.35 + size * 0.2, 0.3, 1) * db(gdb) * (o.volume ?? 1), rate });
    if (!src) return null;
    return note({ kind: 'impact', material: 'water', weight: heavy ? 'heavy' : 'light', set, variant: p.i + 1, file: p.file, delayMs: 0, latencyMs: 0, pitch: rate, gainDb: gdb, body: 'splash', other: 'sea', speed: 0, dist: Math.round(d) });
  }

  /** A barrel rolling: a roll clip from the barrel, one every ~1.4 s per barrel. Returns true when it handled it. */
  function roll(e, speed, at) {
    if (!have('barrel-roll')) return false;
    const now = performance.now();
    if (now - (e._rollAt || 0) < 1400) return true;
    if (distTo(at) > 45) return true;
    e._rollAt = now;
    const p = pick('barrel-roll');
    if (!p) return false;
    const rate = 1 + rnd(-0.08, 0.08), gdb = rnd(-2, 2);
    if (!fire(p.buf, { at, gain: clamp(speed / 14, 0.15, 0.7) * db(gdb), rate })) return false;
    note({ kind: 'roll', material: 'metal', weight: 'roll', set: 'barrel-roll', variant: p.i + 1, file: p.file, delayMs: 0, latencyMs: 0, pitch: rate, gainDb: gdb, body: e.sceneId || e.name || '?', other: '', speed: Math.round(speed * 10) / 10, dist: Math.round(distTo(at)) });
    return true;
  }

  // ------------------------------------------------------------------ explosions: late by distance, far past 60 m
  function explosion(at, radius = 6, o = {}) {
    if (!lib.index || !at) return null;
    const dist = distTo(at);
    const far = dist > FAR_FROM;
    const set = far ? 'explosion-far' : 'explosion-near';
    const flashT = performance.now();
    if (!have(set)) return null;
    const p = pick(set);
    if (!p) return null;
    const delay = dist / SOUND_OF_LIGHT;
    const rate = 1 + rnd(-0.08, 0.08), gdb = rnd(-2, 2);
    const near = clamp(1.1 - dist / 140, 0.4, 1);
    const gain = (far ? clamp(0.95 - (dist - FAR_FROM) / 300, 0.45, 0.9) : near) * db(gdb) * clamp(0.75 + radius / 24, 0.75, 1.15);
    // (Placed where it went off but with no second distance fade: the far boom is dull and low by its own filter.)
    const lowpass = far ? clamp(2600 - (dist - FAR_FROM) * 16, 450, 2600) : 0;
    if (!fire(p.buf, { at, gain, rate, delay, lowpass, spatial: { rolloff: 0, muffle: 0, ref: 3, max: 1000 } })) return null;
    const entry = note({ kind: 'explosion', material: 'blast', weight: far ? 'far' : 'near', set, variant: p.i + 1, file: p.file, delayMs: Math.round(delay * 1000), latencyMs: 0, pitch: rate, gainDb: gdb, lowpass: Math.round(lowpass), body: 'blast', other: '', speed: 0, dist: Math.round(dist), radius, flashT: Math.round(flashT) });
    // The debris patters down a beat after the boom, on whatever is round you (only where you could hear it land).
    if (dist < 90 && have('debris')) {
      const dp = pick('debris');
      if (dp) {
        const when = delay + 0.55 + rnd(0, 0.5) + Math.min(0.6, radius / 20);
        const dat = [at[0] + rnd(-3, 3), at[1], at[2] + rnd(-3, 3)];
        if (fire(dp.buf, { at: dat, gain: clamp(0.8 - dist / 140, 0.3, 0.8) * db(rnd(-2, 2)), rate: 1 + rnd(-0.08, 0.08), delay: when })) {
          note({ kind: 'debris', material: 'debris', weight: 'patter', set: 'debris', variant: dp.i + 1, file: dp.file, delayMs: Math.round(when * 1000), latencyMs: 0, pitch: 1, gainDb: 0, body: 'blast', other: '', speed: 0, dist: Math.round(dist) });
        }
      }
    }
    return entry;
  }

  // ------------------------------------------------------------------ fishing: cast, plop, strike, flap, and the reel's loop
  const FISH_SET = { cast: 'fish-cast', plop: 'fish-plop', strike: 'fish-strike', flap: 'fish-flap' };
  const reel = { src: null, g: null, last: 0, timer: 0 };
  function stopReel() {
    const a = ctx();
    if (reel.src && a) { try { reel.g.gain.setTargetAtTime(0, a.currentTime, 0.04); reel.src.stop(a.currentTime + 0.2); } catch { /* gone */ } }
    reel.src = null; reel.g = null; reel.timer = 0;
  }
  function fish(name, o = {}) {
    if (!lib.index) return false;
    const a = live();
    const set = name === 'reel' ? 'fish-reel' : FISH_SET[name];
    if (!set || !have(set)) return false;
    const vol = clamp(o.volume ?? 1, 0, 1);
    if (name === 'reel') {
      // The reel clicks are called as the line comes in: one looping clip while they keep coming, faded a moment after the last.
      reel.last = performance.now();
      if (reel.src) return true;
      const p = pick(set);
      if (!p || !a) return false;
      const src = a.createBufferSource(); src.buffer = p.buf; src.loop = true;
      const g = a.createGain(); g.gain.value = 0.55 * vol;
      src.connect(g).connect(bus());
      src.start();
      reel.src = src; reel.g = g;
      const watch = () => { if (performance.now() - reel.last > 260) stopReel(); else reel.timer = setTimeout(watch, 120); };
      reel.timer = setTimeout(watch, 200);
      note({ kind: 'fish', material: 'fish', weight: 'reel', set, variant: p.i + 1, file: p.file, delayMs: 0, latencyMs: 0, pitch: 1, gainDb: 0, body: 'rod', other: '', speed: 0, dist: 0 });
      return true;
    }
    const p = pick(set);
    if (!p) return false;
    const rate = 1 + rnd(-0.08, 0.08), gdb = rnd(-2, 2);
    if (!fire(p.buf, { at: o.at || null, gain: 0.8 * vol * db(gdb), rate })) return false;
    note({ kind: 'fish', material: 'fish', weight: name, set, variant: p.i + 1, file: p.file, delayMs: 0, latencyMs: 0, pitch: rate, gainDb: gdb, body: 'rod', other: '', speed: 0, dist: Math.round(distTo(o.at)) });
    return true;
  }

  H.hooks.world.push({ leave() { stopReel(); } });
  H.impact = { hit, explosion, splash, roll, fish, isBarrel, ready, load, decode, log, stats, lib };
  /** What the playtest reads. */
  window.__impact = {
    log,
    ready: () => ready(),
    phase: () => lib.phase,
    bytes: () => lib.bytes,
    sets: () => Object.fromEntries([...lib.bufs].map(([k, v]) => [k, v.filter(Boolean).length])),
    stats: () => ({ ...stats, variants: Object.fromEntries(Object.entries(stats.variants).map(([k, v]) => [k, [...v]])) }),
    reset: () => { log.length = 0; stats.played = 0; stats.limited = 0; stats.repeats = 0; stats.byMaterial = {}; stats.variants = {}; stats.maxLatencyMs = 0; stats.lastFile = null; },
  };
})();
