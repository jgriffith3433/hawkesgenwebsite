// The cinematic camera: shots for intros, cut-scenes and J's trailer. No HUD, letterbox bars, smooth paths through
// keyframes (positions and things to look at, with eases), orbits around a thing, dolly and follow shots that ride
// with a vehicle, fixed shots that track a target, sequences of shots (cuts), slow motion, fades, a title over the
// picture, and "record this shot" straight to a clip.
//   - scene.json config.cinematics.<name> = a shot (the build editor's camera panel saves them there); "autoplay": true
//     plays it when the game starts
//   - scripts: game.cinematic.play('intro'), game.cinematic.orbit('Volcano', { seconds: 8 }), .follow(car), .path([...])
//     .record('intro'), .slowmo(0.3, 2), .stop()
// The shot's state is pure data (shotState below) so the engine tests can step it without a screen.
/* global HawkesPlay, BABYLON, HawkesShareMath */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const M = window.HawkesShareMath;
  const S = H.share;
  const W = () => H.world;
  const TYPES = ['path', 'orbit', 'follow', 'dolly', 'fixed', 'sequence'];

  // ------------------------------------------------------------------ finding things a shot points at
  /** A thing by name, id or tag; 'player'; 'vehicle' (the one you're in); or a point [x, y, z]. */
  function resolve(t) {
    const w = W();
    if (!w || t === undefined || t === null) return null;
    if (t && t.__entity) return t.alive ? t : null;
    if (Array.isArray(t)) return M.v3(t);
    if (typeof t === 'object' && 'x' in t) return M.v3(t);
    const s = String(t);
    if (s === 'player' || s === 'me') return w.player && w.player.alive ? w.player : null;
    if (s === 'vehicle' || s === 'car') { const v = H.vehicles && H.vehicles.current; if (v) return v; if (s === 'vehicle') return w.player && w.player.alive ? w.player : null; }
    for (const e of w.entities) if (e.alive && (e.name === s || e.sceneId === s)) return e;
    const low = s.toLowerCase();
    for (const e of w.entities) if (e.alive && ((e.name && String(e.name).toLowerCase() === low) || e.tag === s)) return e;
    for (const e of w.entities) if (e.alive && e.name && String(e.name).toLowerCase().includes(low)) return e;
    return null;
  }
  const pointOf = (t) => (Array.isArray(t) ? t : t && t.__entity ? [t.x, t.y, t.z] : null);
  /** How big a thing is (for orbit distances): half its largest side. */
  function sizeOf(e) {
    if (!e || !e.__entity) return 1;
    try { const b = e.box(); return Math.max(0.5, (b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2); } catch { return 1; }
  }
  /** Which way a thing faces (radians): its travel direction when moving, else its yaw. */
  function headingOf(e, st) {
    if (!e || !e.__entity) return 0;
    const vx = Number(e.vx) || 0, vz = Number(e.vz) || 0;
    const yaw = e.node && e.node.rotation ? e.node.rotation.y : 0;
    if (Math.hypot(vx, vz) > 1.5) {
      const h = Math.atan2(vx, vz);
      st.heading = st.heading === undefined ? h : st.heading + angleDiff(st.heading, h) * 0.12;
      return st.heading;
    }
    st.heading = st.heading === undefined ? yaw : st.heading + angleDiff(st.heading, yaw) * 0.08;
    return st.heading;
  }
  const angleDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

  // ------------------------------------------------------------------ a shot as data
  /** A shot spec in its full form: { type, seconds, letterbox, hud, ... } (a name looks it up in config.cinematics). */
  function shotSpec(nameOrSpec, extra = {}) {
    let spec = nameOrSpec;
    if (typeof nameOrSpec === 'string') {
      const all = cinematics();
      spec = all[nameOrSpec];
      if (!spec) throw new Error(`No camera shot called "${nameOrSpec}"${Object.keys(all).length ? ` (there are: ${Object.keys(all).join(', ')})` : ''}`);
      spec = { name: nameOrSpec, ...spec };
    }
    if (Array.isArray(spec)) spec = { type: 'path', keys: spec };
    spec = { ...(spec || {}), ...extra };
    if (!spec.type) spec.type = spec.shots ? 'sequence' : spec.keys || spec.points ? 'path' : spec.follow || spec.dolly ? 'follow' : spec.target || spec.orbit ? 'orbit' : 'path';
    if (spec.type === 'dolly') spec = { side: 6, angle: 90, ...spec, type: 'follow' };
    if (!TYPES.includes(spec.type)) throw new Error(`A camera shot's type is one of ${TYPES.join(', ')}`);
    return spec;
  }
  const defined = new Map(); // shots scripts defined this run (game.cinematic.define)
  function cinematics() {
    let c = {};
    try { c = H.lib.effectiveConfig().cinematics; } catch {}
    return { ...Object.fromEntries(defined), ...(c && typeof c === 'object' ? c : {}) };
  }

  /** A playing shot's state: what it needs each frame. */
  function shotState(spec) {
    const st = { spec, t: 0, done: false, pose: null, seq: null };
    if (spec.type === 'path') {
      // Things named as places to look at (or go to) are where they are when the shot starts.
      const keys = (spec.keys || spec.points || []).map((k) => {
        const out = { ...k };
        for (const f of ['look', 'lookAt', 'target']) if (typeof k[f] === 'string') { const p = pointOf(resolve(k[f])); out[f] = p || undefined; }
        for (const f of ['pos', 'position']) if (typeof k[f] === 'string') { const p = pointOf(resolve(k[f])); out[f] = p ? [p[0], p[1] + 3, p[2] - 6] : undefined; }
        return out;
      });
      st.path = M.normalizePath({ ...spec, keys });
      st.duration = st.path.duration;
    } else if (spec.type === 'sequence') {
      st.seq = { list: (spec.shots || []).map((x) => shotSpec(x)), i: -1, cur: null };
      st.duration = st.seq.list.reduce((a, s) => a + durationOf(s), 0);
    } else st.duration = durationOf(spec);
    return st;
  }
  function durationOf(spec) {
    if (spec.type === 'path') return M.normalizePath(spec).duration;
    if (spec.type === 'sequence') return (spec.shots || []).reduce((a, s) => a + durationOf(shotSpec(s)), 0);
    if (spec.type === 'follow' || spec.type === 'fixed') return Number(spec.seconds) > 0 ? Number(spec.seconds) : Infinity;
    return Number(spec.seconds) > 0 ? Number(spec.seconds) : 10;
  }
  /** Steps a shot by dt (real seconds) and works out the camera: { pos, look, fov, roll }. */
  function stepShot(st, dt) {
    const spec = st.spec;
    st.t += dt;
    if (spec.type === 'sequence') {
      const q = st.seq;
      if (!q.cur || q.cur.done) {
        if (q.cur && typeof q.cur.spec.onEnd === 'function') try { q.cur.spec.onEnd(); } catch {}
        q.i++;
        if (q.i >= q.list.length) { st.done = true; return st.pose; }
        q.cur = shotState(q.list[q.i]);
        st.cuts = (st.cuts || 0) + 1;
        st.pose = stepShot(q.cur, 0) || st.pose;
        return st.pose;
      }
      st.pose = stepShot(q.cur, dt) || st.pose;
      if (q.cur.done && q.i >= q.list.length - 1) st.done = true;
      return st.pose;
    }
    let pose = null;
    if (spec.type === 'path') pose = M.samplePath(st.path, st.t);
    else if (spec.type === 'orbit') {
      const tgt = resolve(spec.target !== undefined ? spec.target : spec.orbit);
      const c = pointOf(tgt) || M.v3(spec.center, [0, 0, 0]);
      const r = Number(spec.radius) || (tgt && tgt.__entity ? sizeOf(tgt) * 2.6 + 4 : 14);
      pose = M.orbitPose({ ...spec, center: c, radius: r, height: spec.height !== undefined ? Number(spec.height) : r * 0.4, lookHeight: spec.lookHeight !== undefined ? spec.lookHeight : tgt && tgt.__entity ? sizeOf(tgt) * 0.3 : 0 }, st.t);
    } else if (spec.type === 'follow') {
      const tgt = resolve(spec.target !== undefined ? spec.target : spec.follow !== undefined ? spec.follow : 'vehicle');
      if (tgt) {
        const want = M.followPose(pointOf(tgt), headingOf(tgt, st), spec);
        // Riding along: smoothed, so bumps and turns don't jolt the picture.
        const k = Number(spec.smooth) > 0 ? Number(spec.smooth) : 0.04;
        st.cam = st.cam ? { pos: M.damp3(st.cam.pos, want.pos, k, dt), look: M.damp3(st.cam.look, want.look, k * 0.6, dt) } : { pos: want.pos, look: want.look };
        pose = { pos: st.cam.pos, look: st.cam.look, fov: want.fov, roll: 0 };
      } else pose = st.pose;
      pose = pose && { ...pose, done: st.t >= durationOf(spec) };
    } else if (spec.type === 'fixed') {
      const tgt = resolve(spec.target !== undefined ? spec.target : spec.look);
      const look = pointOf(tgt) || M.v3(spec.look, [0, 0, 0]);
      const want = tgt && tgt.__entity ? [look[0], look[1] + (Number(spec.lookHeight) || 0.5), look[2]] : look;
      st.look = st.look ? M.damp3(st.look, want, Number(spec.smooth) > 0 ? Number(spec.smooth) : 0.05, dt) : want;
      pose = { pos: M.v3(spec.pos || spec.position, [0, 6, -12]), look: st.look, fov: Number(spec.fov) || null, roll: Number(spec.roll) || 0, done: st.t >= durationOf(spec) };
    }
    if (pose) {
      if (pose.fov === null || pose.fov === undefined) pose.fov = Number(spec.fov) > 0 ? Number(spec.fov) : null;
      st.pose = pose;
      if (pose.done && !spec.loop) st.done = true;
    }
    return st.pose;
  }

  // ------------------------------------------------------------------ playing shots
  const C = {
    playing: null, // { st, spec, resolve, rec, slowmo, opts, captionAt }
  };
  const skipEl = document.createElement('button');
  skipEl.type = 'button'; skipEl.className = 'sh-skip sh-keep'; skipEl.textContent = 'Skip ›'; skipEl.hidden = true;
  skipEl.onclick = (e) => { e.stopPropagation(); C.skip(); };
  skipEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  document.body.appendChild(skipEl);

  /**
   * Plays a shot (a name in config.cinematics, or a spec). Resolves when it ends: { done, skipped, clip }.
   * Options (in the spec or the second argument): letterbox (true, false or an aspect like 2.39), hud (false: hidden,
   * the default), controls (the player keeps control: the default for follow shots), slowmo (0.3), fade (seconds from
   * and to black), title / subtitle (words over the picture), skippable, then ('player' gives the camera back, 'stay'),
   * loop, record (true: record it to a clip; it opens for review), fov.
   */
  function play(nameOrSpec, opts = {}) {
    if (!W()) return Promise.reject(new Error('No game is running'));
    let spec;
    try { spec = shotSpec(nameOrSpec, opts); } catch (e) { return Promise.reject(e); }
    if (C.playing) finish({ skipped: true, replaced: true });
    if (S.photo && S.photo.on) S.photo.exit();
    const st = shotState(spec);
    const controls = spec.controls !== undefined ? spec.controls !== false : spec.type === 'follow';
    S.takeCamera('cinematic', { freeze: !controls });
    if (spec.hud !== true) S.clean('cinematic', true);
    const lb = spec.letterbox === undefined ? true : spec.letterbox;
    S.letterbox(Boolean(lb), Number(lb) > 1 ? Number(lb) : 2.39);
    if (Number(spec.slowmo) > 0 && Number(spec.slowmo) !== 1) S.timeScale('cinematic', Number(spec.slowmo));
    const fadeIn = spec.fade === undefined ? 0 : Number(typeof spec.fade === 'object' ? spec.fade.in : spec.fade) || 0;
    if (fadeIn > 0) { S.fade(1, 0); S.fade(0, fadeIn); }
    if (spec.title) setTimeout(() => { if (C.playing && C.playing.st === st) S.caption(spec.title, spec.subtitle); }, Math.max(0, fadeIn * 500));
    const skippable = spec.skippable !== undefined ? spec.skippable !== false : Boolean(spec.autoplay) || !spec.record;
    skipEl.hidden = !skippable || Boolean(spec.record);
    let rec = null;
    if (spec.record) {
      rec = S.recordShot ? S.recordShot() : null;
      if (!rec) S.toast("This browser can't record the game: the shot plays without recording");
    }
    return new Promise((resolve) => {
      C.playing = { st, spec, resolve, rec, skippable, fadeOut: spec.fade === undefined ? 0 : Number(typeof spec.fade === 'object' ? spec.fade.out : spec.fade) || 0, ending: false };
      // Put the camera at its first place at once (no frame of the old view).
      const pose = stepShot(st, 0);
      if (pose) S.setPose(pose.pos, pose.look, pose.fov, pose.roll);
    });
  }

  async function finish(o = {}) {
    const p = C.playing;
    if (!p) return;
    C.playing = null;
    skipEl.hidden = true;
    S.caption(null);
    S.timeScale('cinematic', null);
    // Stop recording first (what comes after the shot isn't in it), then give everything back, then wait for the file.
    const recording = p.rec ? p.rec.stop() : null;
    const stay = p.spec.then === 'stay' && !o.skipped && !o.stop;
    if (!o.replaced && !stay) { S.letterbox(false); S.clean('cinematic', false); S.releaseCamera('cinematic'); if (!p.fadeOut || o.skipped || o.stop) S.fade(0, 0); }
    try { if (typeof p.spec.onEnd === 'function') p.spec.onEnd(); } catch (e) { H.report && H.report(e); }
    let clip = null;
    if (recording) {
      try {
        const out = await recording;
        clip = { kind: 'clip', blob: out.blob, mime: out.mime, seconds: out.seconds, from: 0, to: out.seconds, title: p.spec.title || p.spec.name || '' };
      } catch (e) { console.warn('recording the shot', e); }
    }
    if (clip && p.spec.review !== false) S.review(clip);
    p.resolve({ done: !o.skipped && !o.stop, skipped: Boolean(o.skipped), clip });
  }

  H.hooks.frame.push((elapsed) => {
    const p = C.playing;
    if (!p) return;
    if (!W() || S.cameraOwner !== 'cinematic') { finish({ stop: true }); return; }
    const dt = Math.min(0.25, elapsed); // shots keep to real time, even on a slow machine
    const pose = stepShot(p.st, dt);
    if (pose) S.setPose(pose.pos, pose.look, pose.fov, pose.roll);
    const left = p.st.duration - p.st.t;
    if (p.fadeOut > 0 && !p.ending && Number.isFinite(left) && left <= p.fadeOut && !p.spec.loop) { p.ending = true; S.fade(1, p.fadeOut); }
    if (p.st.done) {
      finish({});
      if (p.fadeOut > 0) S.fade(0, 0.35);
    }
  });

  // Esc, space, enter or a tap skips a skippable shot.
  window.addEventListener('keydown', (e) => {
    const p = C.playing;
    if (!p || !p.skippable || p.spec.record) return;
    const k = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase();
    if (k === 'escape' || k === 'space' || k === 'enter') { e.preventDefault(); e.stopPropagation(); C.skip(); }
  }, true);

  // Autoplay: a shot marked "autoplay" plays when the game starts (playing, not while building).
  H.hooks.world.push({
    enter() {
      if (H.mode !== 'play') return;
      const all = cinematics();
      const first = Object.keys(all).find((k) => all[k] && all[k].autoplay);
      if (first) setTimeout(() => { if (W()) play(first).catch((e) => H.report && H.report(e)); }, 0);
    },
    leave() { defined.clear(); if (C.playing) { const p = C.playing; C.playing = null; skipEl.hidden = true; if (p.rec) p.rec.cancel(); p.resolve({ done: false, skipped: true, clip: null }); } },
  });

  Object.assign(C, {
    play,
    /** Ends the shot now and gives the camera back. */
    stop: () => { if (C.playing) finish({ stop: true }); else if (S.cameraOwner === 'cinematic') { S.letterbox(false); S.clean('cinematic', false); S.releaseCamera('cinematic'); } },
    skip: () => { if (C.playing) finish({ skipped: true }); },
    /** Plays a shot and records it: resolves with the clip (and opens it for review unless review: false). */
    record: (nameOrSpec, opts = {}) => play(nameOrSpec, { ...opts, record: true, skippable: false }),
    /** An orbit around a thing or point: { seconds: 10, degrees: 360, radius, height, from }. */
    orbit: (target, o = {}) => play({ type: 'orbit', target, ...o }),
    /** Rides with a moving thing: { distance: 8, height: 3, side: 0, angle: 0, lead: 4, seconds }. */
    follow: (target, o = {}) => play({ type: 'follow', target, ...o }),
    /** Alongside it, like a camera car: a follow shot from the side. */
    dolly: (target, o = {}) => play({ type: 'follow', target, side: 6, angle: 90, distance: 2, ...o }),
    /** Through keyframes: [{ pos, look, at?, ease? }, ...]. */
    path: (keys, o = {}) => play({ type: 'path', keys, ...o }),
    /** From one place, keeping a thing in the picture. */
    fixed: (pos, target, o = {}) => play({ type: 'fixed', pos, target, ...o }),
    /** Several shots, cut together. */
    sequence: (shots, o = {}) => play({ type: 'sequence', shots, ...o }),
    /** Slow motion (0.25 = a quarter speed) for `seconds` of real time (or until slowmo(1)). */
    slowmo: (scale = 0.3, seconds) => {
      S.timeScale('slowmo', Number(scale) === 1 ? null : Number(scale));
      clearTimeout(C._slow);
      if (Number(seconds) > 0) C._slow = setTimeout(() => S.timeScale('slowmo', null), Number(seconds) * 1000);
      return S.scale;
    },
    letterbox: (on = true, aspect) => S.letterbox(on, aspect),
    /** Words over the picture (a trailer's title card): caption('Mount Doom', 'the island'); caption(null) clears. */
    caption: (title, sub) => S.caption(title, sub),
    fade: (to, seconds) => S.fade(to, seconds),
    /** Saves a shot for later by name (this run only; config.cinematics keeps them in the game). */
    define: (name, spec) => { defined.set(String(name), spec); return String(name); },
    list: () => Object.keys(cinematics()),
    get: (name) => cinematics()[name] || null,
    // For tests and tools: a shot as data, stepped without a screen.
    _shotSpec: shotSpec, _shotState: shotState, _stepShot: stepShot, _resolve: resolve,
  });
  Object.defineProperties(C, {
    isPlaying: { get: () => Boolean(C.playing) },
    current: { get: () => (C.playing ? C.playing.spec : null) },
    time: { get: () => (C.playing ? C.playing.st.t : 0) },
    duration: { get: () => (C.playing ? C.playing.st.duration : 0) },
  });
  S.cinematic = C;
  H.cinematic = C;

  // game.cinematic and game.photo for scripts: added the moment the engine makes the game object (before scripts run).
  // (H.hooks.game: every new game object, before any script runs.)
  const scriptApi = () => ({
    play: (n, o) => C.play(n, o), stop: () => C.stop(), skip: () => C.skip(), record: (n, o) => C.record(n, o),
    orbit: C.orbit, follow: C.follow, dolly: C.dolly, path: C.path, fixed: C.fixed, sequence: C.sequence,
    slowmo: C.slowmo, letterbox: C.letterbox, caption: C.caption, fade: C.fade, define: C.define, list: C.list, get: C.get,
    get playing() { return Boolean(C.playing); },
    get current() { return C.current; },
  });
  const photoApi = () => ({ open: () => S.photo && S.photo.enter(), close: () => S.photo && S.photo.exit(), take: () => S.photo && S.photo.take(), get on() { return Boolean(S.photo && S.photo.on); }, clip: () => S.clipThat() });
  const attach = (g) => {
    if (!g || typeof g !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(g, 'cinematic')) Object.defineProperty(g, 'cinematic', { value: scriptApi(), enumerable: true, configurable: true });
    if (!Object.prototype.hasOwnProperty.call(g, 'photo')) Object.defineProperty(g, 'photo', { value: photoApi(), enumerable: true, configurable: true });
  };
  H.hooks.game.push(attach);
})();
