// Sharing: what photo mode (photo.js) and the cinematic camera (cinematic.js) stand on, and "clip that".
//   - the share camera: a camera of our own that takes over the view and gives it back as it was
//   - a clean screen (no HUD), letterbox bars, looks (vivid, noir, warm, cool, retro), slow motion and pausing
//   - recording the game (canvas.captureStream + MediaRecorder; game sound from H.audio.master when there is one)
//   - "clip that": two recorders taking turns keep the last 15 s (share-math.js ringPlan), saved in one press (F8)
//   - the review sheet (a photo, or a clip to trim) and the share window (/share/new: download, or a share link
//     /s/<id> in the player's own Gen project; the game runs sandboxed, so the window does the signed-in part)
// Settings: config.share = { clip: 15, clips: true, photo: true, buttons: true, caption: true } (false turns it all off).
/* global HawkesPlay, BABYLON, HawkesShareMath, HawkesNet */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const M = window.HawkesShareMath;
  const STEP = (H.lib && H.lib.STEP) || 1 / 60;
  const RAD = Math.PI / 180;
  const canvas = document.getElementById('stage');
  const W = () => H.world;
  const S = (H.share = H.share || {});

  // ------------------------------------------------------------------ settings
  function settings() {
    let c = {};
    try { c = (H.world && H.lib.effectiveConfig ? H.lib.effectiveConfig() : {}).share; } catch { c = {}; }
    if (c === false) return { off: true, clip: 15, clips: false, photo: false, buttons: false, caption: false };
    c = c && typeof c === 'object' ? c : {};
    return {
      off: false,
      clip: M.clamp(Number(c.clip) || 15, 3, 60),
      // The rolling clip costs a video encoder all the time: on by default on computers, a tap away on phones.
      clips: c.clips === undefined ? !H.touchUi : c.clips !== false,
      photo: c.photo !== false,
      // The 📷 🎬 buttons and the P / F8 keys are off for now (J, 2026-10-24): a world turns them on with
      // config.share { buttons: true, keys: { photo: 'p', clip: 'f8' } }. Photo mode and clips work as before
      // (S.photo.toggle(), S.clipThat()).
      buttons: c.buttons === true,
      caption: c.caption !== false,
      keys: { photo: String((c.keys && c.keys.photo) || '').toLowerCase(), clip: String((c.keys && c.keys.clip) || '').toLowerCase() },
    };
  }
  S.settings = settings;
  const sandboxed = (() => { try { return window.origin === 'null' || location.origin === 'null'; } catch { return true; } })();
  const store = {
    get(k) { try { return localStorage.getItem('hg-share-' + k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem('hg-share-' + k, v); } catch { /* sandboxed: no storage */ } },
  };
  /** Others in the room with us (pausing would stop the world for them when we're the host). */
  function together() {
    try { if (!window.HawkesNet || !HawkesNet.online) return false; const p = HawkesNet.peers(); return Boolean(p && (p.size || Object.keys(p).length)); } catch { return false; }
  }
  S.together = together;

  // ------------------------------------------------------------------ styles and the overlay pieces
  const css = document.createElement('style');
  css.textContent = `
    /* (Never Studio's 🐞 report button on the beta sites, [data-hawkes-report]: J reports from cinematics too.) */
    body.sh-clean > *:not(#stage):not(.sh-keep):not(script):not(style):not(link):not([data-hawkes-report]) { visibility: hidden !important; }
    body.sh-clean #stage { cursor: default; }
    .sh-keep { font-family: 'Rajdhani', 'Inter', system-ui, sans-serif; color: #e8ecf6; }
    .sh-bars { position: fixed; inset: 0; pointer-events: none; z-index: 30; }
    .sh-bars i { position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height .6s cubic-bezier(.2,.7,.2,1); }
    .sh-bars i:first-child { top: 0; } .sh-bars i:last-child { bottom: 0; }
    .sh-fade { position: fixed; inset: 0; background: #000; opacity: 0; pointer-events: none; z-index: 31; }
    .sh-caption { position: fixed; left: 6vw; bottom: 14vh; z-index: 32; pointer-events: none; opacity: 0; transition: opacity .8s; }
    .sh-caption b { display: block; font: 700 clamp(22px, 4.2vw, 56px)/1 'Orbitron', 'Rajdhani', sans-serif; letter-spacing: .12em; text-transform: uppercase; color: #fff; text-shadow: 0 2px 18px rgba(0,0,0,.7); }
    .sh-caption span { display: block; margin-top: 8px; font: 600 clamp(13px, 1.6vw, 20px)/1.2 'Rajdhani', sans-serif; letter-spacing: .3em; text-transform: uppercase; color: rgba(255,255,255,.85); text-shadow: 0 1px 8px rgba(0,0,0,.8); }
    .sh-caption.on { opacity: 1; }
    .sh-skip { position: fixed; right: 18px; bottom: 16px; z-index: 33; font: 600 12px/1 'Rajdhani', sans-serif; letter-spacing: .2em; text-transform: uppercase; color: rgba(255,255,255,.7); background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.25); padding: 8px 12px; border-radius: 999px; cursor: pointer; pointer-events: auto; }
    .sh-skip[hidden] { display: none; }
    .sh-dock { position: fixed; right: max(10px, env(safe-area-inset-right)); top: 50%; transform: translateY(-50%); display: grid; gap: 8px; z-index: 6; pointer-events: auto; }
    .sh-dock[hidden] { display: none; }
    .sh-dock button { position: relative; width: 42px; height: 42px; border-radius: 50%; border: 1px solid rgba(160,220,255,.35); background: rgba(10,16,30,.55); backdrop-filter: blur(8px); color: #e6f6ff; font: 18px/1 system-ui, sans-serif; cursor: pointer; display: grid; place-items: center; padding: 0; touch-action: manipulation; }
    .sh-dock button:hover { border-color: #6cf0ff; box-shadow: 0 0 14px rgba(108,240,255,.45); }
    .sh-dock button[hidden] { display: none; }
    .sh-dock .sh-rec::after { content: ''; position: absolute; right: 5px; top: 5px; width: 7px; height: 7px; border-radius: 50%; background: #64748b; }
    .sh-dock .sh-rec.on::after { background: #ef4444; box-shadow: 0 0 8px #ef4444; animation: sh-blink 1.6s ease-in-out infinite; }
    @keyframes sh-blink { 50% { opacity: .35; } }
    .sh-toast { position: fixed; left: 50%; top: 18px; transform: translate(-50%, -8px); z-index: 40; opacity: 0; transition: all .25s; pointer-events: none; font: 600 14px/1.3 'Rajdhani', sans-serif; letter-spacing: .06em; padding: 9px 16px; border-radius: 10px; background: rgba(10,16,30,.85); box-shadow: inset 0 0 0 1px rgba(110,190,255,.35); color: #e8f4ff; max-width: 90vw; text-align: center; }
    .sh-toast.on { opacity: 1; transform: translate(-50%, 0); }
    .sh-flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; z-index: 45; transition: opacity .35s; }
    .sh-review { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; background: rgba(4,6,12,.72); backdrop-filter: blur(6px); pointer-events: auto; padding: 16px; box-sizing: border-box; }
    .sh-review-box { width: min(760px, 100%); max-height: 100%; overflow: auto; background: rgba(12,16,28,.96); border-radius: 14px; box-shadow: inset 0 0 0 1px rgba(110,190,255,.3), 0 30px 80px rgba(0,0,0,.6); padding: 14px; box-sizing: border-box; display: grid; gap: 12px; }
    .sh-review-head { display: flex; align-items: center; gap: 10px; font: 700 13px 'Orbitron', sans-serif; letter-spacing: .16em; text-transform: uppercase; color: #dff1ff; }
    .sh-review-head .grow { flex: 1; }
    .sh-review-media { width: 100%; max-height: 56vh; object-fit: contain; background: #000; border-radius: 8px; display: block; }
    .sh-trim { display: grid; gap: 6px; font: 600 12px 'Rajdhani', sans-serif; letter-spacing: .08em; color: #a9c6e6; }
    .sh-trim-row { display: grid; grid-template-columns: 44px 1fr 54px; align-items: center; gap: 8px; }
    .sh-trim input[type=range] { width: 100%; accent-color: #6cf0ff; }
    .sh-btns { display: flex; gap: 8px; flex-wrap: wrap; }
    .sh-btn { font: 700 13px 'Rajdhani', sans-serif; letter-spacing: .08em; text-transform: uppercase; padding: 11px 16px; border-radius: 9px; border: 1px solid rgba(160,220,255,.3); background: rgba(255,255,255,.06); color: #fff; cursor: pointer; }
    .sh-btn:hover { border-color: #6cf0ff; }
    .sh-btn.primary { background: linear-gradient(90deg, #4a9eff, #a855f7); border: 0; }
    .sh-btn[disabled] { opacity: .5; cursor: default; }
    .sh-note { font: 500 12.5px/1.4 'Inter', system-ui, sans-serif; color: #a5acc2; }
    .sh-progress { height: 4px; border-radius: 2px; background: rgba(255,255,255,.1); overflow: hidden; }
    .sh-progress i { display: block; height: 100%; width: 0; background: #6cf0ff; }
    @media (max-width: 640px) { .sh-dock { top: auto; bottom: 200px; transform: none; } }`;
  document.head.appendChild(css);

  const make = (cls, html = '', tag = 'div') => { const el = document.createElement(tag); el.className = cls; if (html) el.innerHTML = html; document.body.appendChild(el); return el; };
  const bars = make('sh-bars sh-keep', '<i></i><i></i>');
  const fadeEl = make('sh-fade sh-keep');
  const captionEl = make('sh-caption sh-keep');
  const flashEl = make('sh-flash sh-keep');
  const toastEl = make('sh-toast sh-keep');

  let toastT = null;
  S.toast = (text, seconds = 2.2) => { toastEl.textContent = text; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), seconds * 1000); };
  S.flash = () => { flashEl.style.transition = 'none'; flashEl.style.opacity = '0.85'; requestAnimationFrame(() => { flashEl.style.transition = ''; flashEl.style.opacity = '0'; }); };

  // ------------------------------------------------------------------ a clean screen (no HUD), counted per owner
  const cleanBy = new Set();
  S.clean = (owner, on) => { if (on) cleanBy.add(owner); else cleanBy.delete(owner); document.body.classList.toggle('sh-clean', cleanBy.size > 0); };

  // ------------------------------------------------------------------ letterbox bars (on screen; drawn into captures too)
  const box = { on: false, aspect: 2.39 };
  function layoutBars() {
    const h = box.on ? M.letterbox(window.innerWidth, window.innerHeight, box.aspect) : 0;
    for (const i of bars.children) i.style.height = `${h}px`;
  }
  S.letterbox = (on, aspect) => {
    box.on = Boolean(on);
    if (Number(aspect) > 1) box.aspect = Number(aspect);
    layoutBars();
    return box.on;
  };
  Object.defineProperty(S, 'letterboxOn', { get: () => box.on });
  Object.defineProperty(S, 'letterboxAspect', { get: () => box.aspect });
  window.addEventListener('resize', layoutBars);

  /** Fades the screen to black (1) or back (0) over `seconds`. */
  const fade = { from: 0, to: 0, t: 0, d: 0, value: 0 };
  S.fade = (to, seconds = 0.5) => { fade.from = fade.value; fade.to = M.clamp(Number(to) || 0, 0, 1); fade.t = 0; fade.d = Math.max(0, Number(seconds) || 0); if (!fade.d) { fade.value = fade.to; fadeEl.style.opacity = String(fade.value); } };
  Object.defineProperty(S, 'fadeValue', { get: () => fade.value });
  /** A title over the picture (a trailer's lower third): S.caption('Mount Doom', 'the island') ... S.caption(null). */
  const cap = { title: '', sub: '' };
  S.caption = (title, sub) => {
    if (!title) { captionEl.classList.remove('on'); cap.title = ''; cap.sub = ''; return; }
    cap.title = String(title); cap.sub = sub ? String(sub) : '';
    captionEl.innerHTML = '';
    const b = document.createElement('b'); b.textContent = cap.title; captionEl.appendChild(b);
    if (cap.sub) { const s = document.createElement('span'); s.textContent = cap.sub; captionEl.appendChild(s); }
    requestAnimationFrame(() => captionEl.classList.add('on'));
  };
  Object.defineProperty(S, 'captionText', { get: () => (cap.title ? { ...cap } : null) });

  // ------------------------------------------------------------------ the share camera
  const rig = { cam: null, owner: null, prev: null, yaw: 0, pitch: 0, controls: null, fov: 1.0 };
  function poseOf(cam) {
    const pos = cam.globalPosition ? cam.globalPosition : cam.position;
    const d = cam.getDirection(B.Axis.Z);
    const a = M.lookAngles([0, 0, 0], [d.x, d.y, d.z]);
    return { pos: [pos.x, pos.y, pos.z], yaw: a.yaw, pitch: a.pitch, fov: cam.fov || 1.0 };
  }
  /** Takes the view: our camera starts where the current one is. `freeze`: the player stops answering keys. */
  S.takeCamera = (owner, o = {}) => {
    const w = W();
    if (!w || !w.scene) return null;
    const scene = w.scene;
    if (!rig.cam || rig.cam.getScene() !== scene || rig.cam.isDisposed && rig.cam.isDisposed()) {
      rig.cam = new B.UniversalCamera('share-cam', new B.Vector3(0, 5, -10), scene);
      rig.cam.minZ = 0.05; rig.cam.maxZ = 2000; rig.cam.inputs.clear();
      rig.cam.metadata = { share: true };
    }
    if (!rig.owner) {
      rig.prev = scene.activeCamera && scene.activeCamera !== rig.cam ? scene.activeCamera : rig.prev;
      rig.yaw = w.camera ? w.camera.yaw : 0; rig.pitch = w.camera ? w.camera.pitch : 0;
      const p = rig.prev ? poseOf(rig.prev) : { pos: [0, 5, -10], yaw: 0, pitch: 0.3, fov: 1 };
      rig.cam.position.set(p.pos[0], p.pos[1], p.pos[2]);
      rig.cam.rotation.set(p.pitch, p.yaw, 0);
      rig.cam.fov = p.fov;
      rig.fov = p.fov;
      if (w.player && w.player.alive && rig.controls === null) rig.controls = w.player.controls;
    }
    rig.owner = owner;
    if (w.player && w.player.alive) w.player.controls = o.freeze === false ? rig.controls !== false : false;
    scene.activeCamera = rig.cam;
    return rig.cam;
  };
  /** Gives the view back (to the camera the game was using) if `owner` still has it. */
  S.releaseCamera = (owner) => {
    if (!rig.owner || (owner && rig.owner !== owner)) return;
    const w = W();
    rig.owner = null;
    if (!w || !w.scene) return;
    if (rig.prev && !(rig.prev.isDisposed && rig.prev.isDisposed()) && rig.prev.getScene() === w.scene) w.scene.activeCamera = rig.prev;
    if (w.camera) { w.camera.yaw = rig.yaw; w.camera.pitch = rig.pitch; }
    if (w.player && w.player.alive && rig.controls !== null) w.player.controls = rig.controls;
    rig.controls = null;
    if (H.input && H.input.held) H.input.held.clear();
  };
  Object.defineProperty(S, 'camera', { get: () => (rig.owner ? rig.cam : null) });
  Object.defineProperty(S, 'cameraOwner', { get: () => rig.owner });
  /** Puts our camera somewhere: pos, a point to look at, fov in degrees, roll in degrees. */
  S.setPose = (pos, look, fov, roll) => {
    const c = rig.cam;
    if (!c) return;
    c.position.set(pos[0], pos[1], pos[2]);
    if (look) { const a = M.lookAngles(pos, look); c.rotation.set(a.pitch, a.yaw, (Number(roll) || 0) * RAD); }
    if (Number(fov) > 0) c.fov = M.clamp(Number(fov), 5, 140) * RAD;
  };
  S.cameraPose = () => (rig.cam ? { pos: [rig.cam.position.x, rig.cam.position.y, rig.cam.position.z], yaw: rig.cam.rotation.y, pitch: rig.cam.rotation.x, roll: rig.cam.rotation.z / RAD, fov: rig.cam.fov / RAD } : null);
  /** Where the camera the player sees from is, and what it looks at (the build editor drops keyframes with this). */
  S.viewPose = (reach = 60) => {
    const w = W();
    const cam = w && w.scene && w.scene.activeCamera;
    if (!cam) return null;
    const p = poseOf(cam);
    let look = M.ahead(p.pos, p.yaw, p.pitch, 10);
    try {
      const hit = w.scene.pickWithRay(cam.getForwardRay(reach), (m) => m.isPickable && !(m.metadata && (m.metadata.decor || m.metadata.share)) && m.isVisible);
      if (hit && hit.hit && hit.distance > 0.5) look = [hit.pickedPoint.x, hit.pickedPoint.y, hit.pickedPoint.z];
    } catch { /* no picking (tests): 10 m ahead */ }
    return { pos: p.pos, look, fov: Math.round((p.fov / RAD) * 10) / 10, yaw: p.yaw, pitch: p.pitch };
  };

  // ------------------------------------------------------------------ time: pause, slow motion
  // H.timeScale when the engine has one; otherwise we pause the world and step it ourselves (H.tick) at the scale.
  const time = { by: new Map(), scale: 1, acc: 0, inTick: false, pausedByUs: false };
  function applyTime() {
    let k = 1;
    for (const v of time.by.values()) k = Math.min(k, v);
    for (const v of time.by.values()) if (v > 1) k = v; // a speed-up only when nobody slows it
    time.scale = k;
    const w = W();
    if (w && w.scene) w.scene.animationTimeScale = k;
    if (typeof H.slow === 'function') H.slow('share', k); else if (typeof H.timeScale === 'number' && Object.getOwnPropertyDescriptor(H, 'timeScale')) { try { H.timeScale = k; } catch {} }
    if (k === 1 && time.pausedByUs && w) { w.paused = false; time.pausedByUs = false; time.acc = 0; }
    // Stopping or slowing takes effect now, not after the next step.
    if (k !== 1 && w && !nativeTime()) { if (!w.paused) time.pausedByUs = true; w.paused = true; }
  }
  const nativeTime = () => typeof H.timeScale === 'number';
  /** owner slows (0.25), stops (0) or speeds (2) the world; S.timeScale(owner, null) lets go. The slowest asked wins. */
  S.timeScale = (owner, k) => {
    if (k === null || k === undefined || Number(k) === 1) time.by.delete(owner);
    else time.by.set(owner, M.clamp(Number(k) || 0, 0, 4));
    applyTime();
    return time.scale;
  };
  Object.defineProperty(S, 'scale', { get: () => time.scale });
  function stepTime(elapsed) {
    const w = W();
    if (!w || time.scale === 1 || nativeTime() || time.inTick) return;
    if (!w.paused) time.pausedByUs = true;
    w.paused = true;
    if (time.scale <= 0) return;
    time.acc += elapsed * time.scale;
    let n = 0;
    while (time.acc >= STEP && n < 8) {
      time.acc -= STEP; n++;
      time.inTick = true;
      w.paused = false;
      try { H.tick(STEP); } catch (e) { H.report && H.report(e); } finally { time.inTick = false; if (H.world === w) w.paused = true; }
    }
    if (n === 8) time.acc = 0;
  }
  S._stepTime = stepTime;

  // ------------------------------------------------------------------ looks (filters)
  const LOOKS = ['none', 'vivid', 'noir', 'warm', 'cool', 'retro'];
  const look = { name: 'none', saved: null, scaling: null };
  function lookTargets() {
    const w = W();
    if (!w || !w.scene) return null;
    return { ip: w.scene.imageProcessingConfiguration, pipe: w.look || null, engine: w.scene.getEngine() };
  }
  /** The picture's look: 'none', 'vivid', 'noir', 'warm', 'cool', 'retro' (pixels, grain and warm color). */
  S.look = (name) => {
    const n = LOOKS.includes(String(name)) ? String(name) : 'none';
    const t = lookTargets();
    if (!t) return look.name;
    const ip = t.ip;
    if (!look.saved) look.saved = { curves: ip.colorCurvesEnabled, contrast: ip.contrast, exposure: ip.exposure, grain: t.pipe ? t.pipe.grainEnabled : false, chroma: t.pipe ? t.pipe.chromaticAberrationEnabled : false };
    // Back to the game's own look first.
    ip.colorCurvesEnabled = look.saved.curves; ip.contrast = look.saved.contrast; ip.exposure = look.saved.exposure;
    if (t.pipe) { try { t.pipe.grainEnabled = look.saved.grain; t.pipe.chromaticAberrationEnabled = look.saved.chroma; } catch {} }
    if (look.scaling !== null) { t.engine.setHardwareScalingLevel(look.scaling); look.scaling = null; }
    look.name = n;
    if (n === 'none') { look.saved = null; return n; }
    const cc = new B.ColorCurves();
    ip.colorCurves = cc; ip.colorCurvesEnabled = true;
    if (n === 'vivid') { cc.globalSaturation = 45; ip.contrast = look.saved.contrast * 1.12; }
    if (n === 'noir') { cc.globalSaturation = -100; ip.contrast = look.saved.contrast * 1.35; ip.exposure = look.saved.exposure * 1.05; }
    if (n === 'warm') { cc.globalHue = 35; cc.globalDensity = 40; cc.globalSaturation = 12; }
    if (n === 'cool') { cc.globalHue = 210; cc.globalDensity = 35; cc.globalSaturation = 5; }
    if (n === 'retro') {
      cc.globalHue = 40; cc.globalDensity = 30; cc.globalSaturation = -25; ip.contrast = look.saved.contrast * 1.1;
      if (t.pipe) { try { t.pipe.grainEnabled = true; t.pipe.grain.intensity = 18; t.pipe.grain.animated = true; t.pipe.chromaticAberrationEnabled = true; t.pipe.chromaticAberration.aberrationAmount = 18; } catch {} }
      look.scaling = t.engine.getHardwareScalingLevel();
      t.engine.setHardwareScalingLevel(look.scaling * 3);
    }
    return n;
  };
  S.LOOKS = LOOKS;
  Object.defineProperty(S, 'lookName', { get: () => look.name });

  // ------------------------------------------------------------------ pictures
  const frameDone = () => new Promise((resolve) => {
    const w = W();
    const eng = w && w.scene && w.scene.getEngine();
    if (!eng || !eng.onEndFrameObservable) return resolve();
    let done = false;
    eng.onEndFrameObservable.addOnce(() => { done = true; resolve(); });
    setTimeout(() => { if (!done) resolve(); }, 600);
  });
  /** The game's picture now, as a canvas (scale 2: twice the screen's pixels, up to 4096 wide), right after a frame. */
  S.grab = async (scale = 1) => {
    const w = W();
    const eng = w.scene.getEngine();
    const before = eng.getHardwareScalingLevel();
    const k = Math.max(1, Math.min(Number(scale) || 1, 4096 / Math.max(1, canvas.width)));
    if (k > 1) { eng.setHardwareScalingLevel(before / k); eng.resize(); await frameDone(); }
    let out = null;
    await new Promise((resolve) => {
      const eng2 = w.scene.getEngine();
      const take = () => {
        try {
          out = document.createElement('canvas');
          out.width = canvas.width; out.height = canvas.height;
          out.getContext('2d').drawImage(canvas, 0, 0);
        } catch (e) { out = null; }
        resolve();
      };
      if (eng2.onEndFrameObservable) { let done = false; eng2.onEndFrameObservable.addOnce(() => { done = true; take(); }); setTimeout(() => { if (!done) take(); }, 600); } else take();
    });
    if (k > 1) { eng.setHardwareScalingLevel(before); eng.resize(); }
    return out;
  };
  /** A picture finished: letterbox or a frame, and the caption (the game's name), drawn over it. */
  S.compose = (src, o = {}) => {
    const frame = o.frame || 'none';
    const pad = frame === 'border' ? Math.round(src.width * 0.025) : frame === 'polaroid' ? Math.round(src.width * 0.035) : 0;
    const foot = frame === 'polaroid' ? Math.round(src.width * 0.09) : 0;
    const c = document.createElement('canvas');
    c.width = src.width + pad * 2; c.height = src.height + pad * 2 + foot;
    const g = c.getContext('2d');
    g.fillStyle = frame === 'polaroid' ? '#f6f3ea' : '#ffffff';
    if (pad) g.fillRect(0, 0, c.width, c.height);
    g.drawImage(src, pad, pad);
    if (frame === 'letterbox' || (o.letterbox && frame === 'none')) {
      const h = M.letterbox(src.width, src.height, o.aspect || box.aspect);
      g.fillStyle = '#000'; g.fillRect(pad, pad, src.width, h); g.fillRect(pad, pad + src.height - h, src.width, h);
    }
    const title = o.caption === false ? '' : String(o.title || (H.bundle && H.bundle.title) || '');
    if (frame === 'polaroid') {
      g.fillStyle = '#2b2b2b'; g.font = `600 ${Math.round(foot * 0.36)}px Rajdhani, Inter, sans-serif`; g.textBaseline = 'middle';
      g.fillText(title || 'Hawkes Play', pad, pad * 2 + src.height + foot / 2 - pad / 2);
      g.textAlign = 'right'; g.fillStyle = '#8a8a8a'; g.font = `500 ${Math.round(foot * 0.24)}px Rajdhani, Inter, sans-serif`;
      g.fillText('hawkesgen.com', c.width - pad, pad * 2 + src.height + foot / 2 - pad / 2);
    } else if (title) {
      const s = Math.max(12, Math.round(src.width * 0.014));
      g.font = `600 ${s}px Rajdhani, Inter, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
      g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = s / 2; g.fillStyle = 'rgba(255,255,255,.82)';
      const lb = frame === 'letterbox' || o.letterbox ? M.letterbox(src.width, src.height, o.aspect || box.aspect) : 0;
      g.fillText(`${title} · hawkesgen.com`, pad + src.width - s, pad + src.height - lb - s * 0.7);
    }
    return c;
  };
  S.toBlob = (c, type = 'image/png', q) => new Promise((resolve) => { try { c.toBlob((b) => resolve(b), type, q); } catch { resolve(null); } });

  // ------------------------------------------------------------------ recording
  const MIMES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const canRecord = () => typeof window.MediaRecorder === 'function' && Boolean(canvas && canvas.captureStream);
  S.canRecord = canRecord;
  function pickMime() {
    if (!canRecord()) return '';
    for (const m of MIMES) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {} }
    return '';
  }
  S.mime = pickMime;
  let audioDest = null;
  /** The game's sound as a stream track, when the engine gives us its master output (H.audio.master). */
  function audioTracks() {
    const m = H.audio && (H.audio.output || H.audio.master);
    if (!m || !m.context || !m.context.createMediaStreamDestination) return [];
    try {
      if (!audioDest || audioDest.context !== m.context) { audioDest = m.context.createMediaStreamDestination(); m.connect(audioDest); }
      return audioDest.stream.getAudioTracks();
    } catch { return []; }
  }
  S.hasAudio = () => audioTracks().length > 0;
  let stageStream = null;
  function streamOf(source) {
    if (source === 'stage') {
      if (!stageStream || stageStream.getVideoTracks().every((t) => t.readyState === 'ended')) stageStream = canvas.captureStream(30);
      const s = new MediaStream(stageStream.getVideoTracks());
      for (const t of audioTracks()) s.addTrack(t);
      return s;
    }
    const s = source.captureStream(30);
    for (const t of audioTracks()) s.addTrack(t);
    return s;
  }
  /** Records a stream (or 'stage', the game's canvas): { stop() -> Promise<{ blob, mime, seconds }>, started, cancel() }. */
  function record(source, o = {}) {
    const mime = pickMime();
    const stream = source instanceof MediaStream ? source : streamOf(source || 'stage');
    const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: o.bitrate || 5_000_000 });
    const chunks = [];
    const r = { rec, started: performance.now(), mime: rec.mimeType || mime || 'video/webm', cancelled: false };
    rec.ondataavailable = (e) => { if (!r.cancelled && e.data && e.data.size) chunks.push(e.data); };
    rec.start(1000);
    r.stop = () => new Promise((resolve) => {
      const seconds = (performance.now() - r.started) / 1000;
      if (rec.state === 'inactive') return resolve({ blob: new Blob(chunks, { type: r.mime }), mime: r.mime.split(';')[0], seconds });
      rec.onstop = () => resolve({ blob: new Blob(chunks, { type: r.mime }), mime: r.mime.split(';')[0], seconds });
      try { rec.stop(); } catch { resolve({ blob: new Blob(chunks, { type: r.mime }), mime: r.mime.split(';')[0], seconds }); }
    });
    r.cancel = () => { r.cancelled = true; chunks.length = 0; try { if (rec.state !== 'inactive') rec.stop(); } catch {} };
    return r;
  }
  S.record = record;

  // A composite picture for recorded shots: the game, letterbox bars, the fade and the caption, drawn after each frame.
  const comp = { canvas: null, g: null, obs: null, users: 0 };
  function compositor() {
    if (!comp.canvas) { comp.canvas = document.createElement('canvas'); comp.g = comp.canvas.getContext('2d'); }
    comp.users++;
    if (!comp.obs) {
      const eng = W().scene.getEngine();
      comp.obs = eng.onEndFrameObservable.add(() => {
        const sw = canvas.width, sh = canvas.height;
        const k = Math.min(1, 1920 / Math.max(1, sw));
        const cw = Math.max(2, Math.round((sw * k) / 2) * 2), ch = Math.max(2, Math.round((sh * k) / 2) * 2);
        if (comp.canvas.width !== cw || comp.canvas.height !== ch) { comp.canvas.width = cw; comp.canvas.height = ch; }
        const g = comp.g;
        try { g.drawImage(canvas, 0, 0, cw, ch); } catch { return; }
        if (box.on) { const h = M.letterbox(cw, ch, box.aspect); g.fillStyle = '#000'; g.fillRect(0, 0, cw, h); g.fillRect(0, ch - h, cw, h); }
        if (captionEl.classList.contains('on') && cap.title) {
          const s = Math.round(Math.min(cw * 0.042, 56 * k * 1.5));
          const lb = box.on ? M.letterbox(cw, ch, box.aspect) : 0;
          g.save(); g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = s / 2; g.fillStyle = '#fff'; g.textBaseline = 'alphabetic';
          g.font = `700 ${s}px Orbitron, Rajdhani, sans-serif`;
          const y = ch - Math.max(lb, ch * 0.14) - (cap.sub ? s * 0.9 : 0) - s * 0.3;
          g.fillText(cap.title.toUpperCase(), cw * 0.06, y);
          if (cap.sub) { g.font = `600 ${Math.round(s * 0.38)}px Rajdhani, sans-serif`; g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(cap.sub.toUpperCase(), cw * 0.06, y + s * 0.75); }
          g.restore();
        }
        if (fade.value > 0) { g.fillStyle = `rgba(0,0,0,${fade.value})`; g.fillRect(0, 0, cw, ch); }
      });
    }
    return comp.canvas;
  }
  function compositorDone() {
    comp.users = Math.max(0, comp.users - 1);
    if (!comp.users && comp.obs) { try { W().scene.getEngine().onEndFrameObservable.remove(comp.obs); } catch {} comp.obs = null; }
  }
  /** Records what the player sees as shot: letterbox, captions and fades included. Returns the recorder (stop()). */
  S.recordShot = (o = {}) => {
    if (!canRecord()) return null;
    const c = compositor();
    const r = record(c, o);
    const stop = r.stop;
    r.stop = () => stop().then((x) => { compositorDone(); return x; });
    const cancel = r.cancel;
    r.cancel = () => { cancel(); compositorDone(); };
    return r;
  };

  // ------------------------------------------------------------------ "clip that": the last N seconds, always ready
  const ring = { on: false, plan: M.ringPlan(15), recs: [null, null], t0: 0, timer: null, busy: false };
  const ages = () => ring.recs.map((r) => (r ? (performance.now() - r.started) / 1000 : null));
  function ringTick() {
    if (!ring.on) return;
    const due = M.ringDue(ages(), ring.plan);
    for (const i of due) {
      if (ring.recs[i]) ring.recs[i].cancel();
      try { ring.recs[i] = record('stage', { bitrate: 4_000_000 }); } catch (e) { ring.recs[i] = null; console.warn('clip recorder', e); }
    }
  }
  /** Keeps the last `seconds` of the game ready to save (on), or stops (off). */
  S.clips = (on, seconds) => {
    if (seconds) ring.plan = M.ringPlan(seconds);
    if (on && !canRecord()) return false;
    if (on && !ring.on) { ring.on = true; ring.t0 = performance.now(); ringTick(); ring.timer = setInterval(ringTick, 500); }
    if (!on && ring.on) { ring.on = false; clearInterval(ring.timer); ring.recs.forEach((r) => r && r.cancel()); ring.recs = [null, null]; }
    dockState();
    return ring.on;
  };
  Object.defineProperty(S, 'clipping', { get: () => ring.on });
  Object.defineProperty(S, 'clipAges', { get: ages });
  /** Saves the last N seconds now: the recording (to review), or null when nothing was being kept. */
  S.clipThat = async (o = {}) => {
    if (!ring.on) { S.clips(true); S.toast(canRecord() ? `Keeping the last ${ring.plan.clip} s from now on: press again later` : "This browser can't record the game"); return null; }
    if (ring.busy) return null;
    const i = M.ringPick(ages());
    if (i < 0) return null;
    ring.busy = true;
    const r = ring.recs[i];
    ring.recs[i] = null;
    try { ring.recs[i] = record('stage', { bitrate: 4_000_000 }); } catch {}
    let out;
    try { out = await r.stop(); } finally { ring.busy = false; }
    const win = M.clipWindow(out.seconds, ring.plan.clip);
    const clip = { kind: 'clip', blob: out.blob, mime: out.mime, seconds: out.seconds, from: win.from, to: win.to, keep: ring.plan.clip, title: o.title };
    if (o.review !== false) S.review(clip);
    return clip;
  };

  // ------------------------------------------------------------------ pausing while a sheet is open
  const pausers = new Set();
  /** owner pauses the world (when nobody else is in it) until S.hold(owner, false). */
  S.hold = (owner, on) => {
    if (on) { if (!together()) { pausers.add(owner); S.timeScale('hold:' + owner, 0); } }
    else { pausers.delete(owner); S.timeScale('hold:' + owner, null); }
  };

  // ------------------------------------------------------------------ the review sheet
  let sheet = null;
  /** Shows a photo or clip: trim (clips), save or share, download. { kind, blob, mime, from, to, seconds, title } */
  S.review = (item) => {
    closeReview();
    const url = URL.createObjectURL(item.blob);
    const el = make('sh-review sh-keep');
    const isClip = item.kind === 'clip';
    el.innerHTML = `<div class="sh-review-box">
      <div class="sh-review-head"><span>${isClip ? 'Your clip' : 'Your photo'}</span><span class="grow"></span><button type="button" class="sh-btn" data-a="close">✕</button></div>
      ${isClip ? '<video class="sh-review-media" playsinline controls loop></video>' : '<img class="sh-review-media" alt="">'}
      ${isClip ? `<div class="sh-trim"><div class="sh-trim-row"><span>From</span><input type="range" data-t="from" step="0.1"><span data-v="from"></span></div><div class="sh-trim-row"><span>To</span><input type="range" data-t="to" step="0.1"><span data-v="to"></span></div><div class="sh-progress" hidden><i></i></div></div>` : ''}
      <div class="sh-btns"><button type="button" class="sh-btn primary" data-a="share">Save or share…</button>${sandboxed ? '' : '<button type="button" class="sh-btn" data-a="download">Download</button>'}<button type="button" class="sh-btn" data-a="close">${isClip ? 'Back to the game' : 'Keep shooting'}</button></div>
      <div class="sh-note"></div></div>`;
    const media = el.querySelector('.sh-review-media');
    const note = el.querySelector('.sh-note');
    media.src = url;
    const cur = { from: item.from || 0, to: item.to || item.seconds || 0, duration: item.seconds || 0 };
    sheet = { el, url, item, cur, busy: false };
    S.hold('review', true);
    if (isClip) {
      const fromIn = el.querySelector('[data-t="from"]'), toIn = el.querySelector('[data-t="to"]');
      const show = () => {
        el.querySelector('[data-v="from"]').textContent = `${cur.from.toFixed(1)} s`;
        el.querySelector('[data-v="to"]').textContent = `${cur.to.toFixed(1)} s`;
        note.textContent = `${(cur.to - cur.from).toFixed(1)} seconds${cur.from > 0.05 || cur.to < cur.duration - 0.05 ? ' (trimmed when you save it)' : ''}.`;
      };
      const setRange = (d) => {
        cur.duration = d;
        // "The last 15 s" of the file as it really is (its own length, not the clock's).
        if (item.keep) { cur.to = d; cur.from = Math.max(0, d - item.keep); }
        cur.to = Math.min(cur.to || d, d);
        cur.from = Math.min(cur.from, Math.max(0, cur.to - 0.5));
        for (const i of [fromIn, toIn]) { i.min = '0'; i.max = String(d.toFixed(1)); }
        fromIn.value = String(cur.from); toIn.value = String(cur.to);
        show();
      };
      // A recording often doesn't know its own length until it's been read to the end.
      media.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(media.duration) && media.duration > 0) { setRange(media.duration); media.currentTime = cur.from; return; }
        media.currentTime = 1e6;
        media.addEventListener('timeupdate', function once() {
          media.removeEventListener('timeupdate', once);
          const d = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : item.seconds;
          setRange(d);
          media.currentTime = cur.from;
        });
      });
      media.addEventListener('timeupdate', () => { if (!sheet || sheet.busy) return; if (media.currentTime > cur.to || media.currentTime < cur.from - 0.25) media.currentTime = cur.from; });
      fromIn.oninput = () => { cur.from = Math.min(Number(fromIn.value), cur.to - 0.5); fromIn.value = String(cur.from); media.currentTime = cur.from; show(); };
      toIn.oninput = () => { cur.to = Math.max(Number(toIn.value), cur.from + 0.5); toIn.value = String(cur.to); media.currentTime = Math.max(cur.from, cur.to - 1.5); show(); };
      media.muted = !S.hasAudio();
      media.play().catch(() => {});
      show();
    } else note.textContent = `${item.width || ''}${item.width ? ' × ' : ''}${item.height || ''}${item.width ? ' pixels. ' : ''}Save it, or share a link to it.`;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => e.stopPropagation());
    el.querySelectorAll('[data-a="close"]').forEach((b) => { b.onclick = () => closeReview(); });
    const final = async () => {
      if (!isClip) return item;
      const trimmed = cur.from > 0.05 || cur.to < cur.duration - 0.05;
      if (!trimmed) return item;
      sheet.busy = true;
      const bar = el.querySelector('.sh-progress');
      bar.hidden = false;
      note.textContent = 'Cutting your clip…';
      try {
        const out = await trim(media, cur.from, cur.to, (p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
        return { ...item, blob: out.blob, mime: out.mime, seconds: out.seconds, from: 0, to: out.seconds };
      } finally { if (sheet) { sheet.busy = false; bar.hidden = true; } }
    };
    el.querySelector('[data-a="share"]').onclick = async (e) => {
      const btn = e.currentTarget;
      // Open the window first, while the click still counts (pop-up blockers), then cut and send.
      const win = openShareWindow();
      if (!win) { note.textContent = 'Allow pop-ups for this game to save or share.'; return; }
      btn.disabled = true;
      try { S.share(await final(), win); } catch (err) { note.textContent = `Could not save it: ${err.message}`; try { win.close(); } catch {} } finally { btn.disabled = false; }
    };
    const dl = el.querySelector('[data-a="download"]');
    if (dl) dl.onclick = async () => { dl.disabled = true; try { download(await final()); } finally { dl.disabled = false; } };
    return el;
  };
  function closeReview() {
    if (!sheet) return;
    const s = sheet;
    sheet = null;
    try { const m = s.el.querySelector('video'); if (m) m.pause(); } catch {}
    s.el.remove();
    setTimeout(() => URL.revokeObjectURL(s.url), 60_000);
    S.hold('review', false);
  }
  S.closeReview = closeReview;
  Object.defineProperty(S, 'reviewing', { get: () => Boolean(sheet) });

  /** Re-records [from, to] of a clip in real time (a recording can only be cut by playing it again). */
  function trim(video, from, to, progress) {
    return new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth || 1280; c.height = video.videoHeight || 720;
      const g = c.getContext('2d');
      const stream = c.captureStream(30);
      // Sound: the video's own track through Web Audio (works where element.captureStream doesn't).
      let ac = null;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        const src = ac.createMediaElementSource(video);
        const dest = ac.createMediaStreamDestination();
        src.connect(dest);
        for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      } catch { ac = null; }
      const r = record(stream, { bitrate: 5_000_000 });
      video.pause(); video.loop = false; video.muted = false;
      const draw = () => {
        if (r.done) return;
        try { g.drawImage(video, 0, 0, c.width, c.height); } catch {}
        progress && progress(Math.min(1, (video.currentTime - from) / Math.max(0.1, to - from)));
        if (video.currentTime >= to || video.ended) { finish(); return; }
        requestAnimationFrame(draw);
      };
      const finish = () => {
        if (r.done) return;
        r.done = true;
        video.pause();
        r.stop().then((out) => { try { ac && ac.close(); } catch {} video.loop = true; resolve({ ...out, seconds: Math.max(0.1, to - from) }); }, reject);
      };
      video.currentTime = from;
      video.addEventListener('seeked', function go() { video.removeEventListener('seeked', go); video.play().then(() => requestAnimationFrame(draw), reject); });
    });
  }
  S.trim = trim;

  const ext = (mime) => (/mp4/.test(mime) ? 'mp4' : /webm/.test(mime) ? 'webm' : /png/.test(mime) ? 'png' : /jpe?g/.test(mime) ? 'jpg' : 'bin');
  const fileName = (item) => `${String((H.bundle && H.bundle.title) || 'hawkes-play').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hawkes-play'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext(item.mime)}`;
  function download(item) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(item.blob);
    a.download = fileName(item);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }
  S.download = download;

  // ------------------------------------------------------------------ the share window (/share/new)
  /** Which game this is, for the "Play this game" button: a slug, t/<template>, or the game's id while building. */
  function gameRef() {
    const parts = location.pathname.replace(/\/+$/, '').split('/');
    const b = H.bundle || {};
    if (parts[2] === 't' && parts[3]) return { game: `t/${parts[3]}`, title: b.title || '' };
    if (parts[2] && parts[2] !== '_draft') return { game: parts[2], title: b.title || '' };
    if (b.slug) return { game: b.slug, title: b.title || '' };
    if (b.id) return { game: b.id, title: b.title || '' };
    return { game: null, title: b.title || '' };
  }
  S.gameRef = gameRef;
  function openShareWindow() {
    try { return window.open('/share/new', `hg-share-${Date.now()}`, 'popup,width=640,height=820'); } catch { return null; }
  }
  /** Sends a photo or clip to the share window (opened now unless given): download there, or upload for a link. */
  S.share = async (item, win) => {
    const w = win || openShareWindow();
    if (!w) { S.toast('Allow pop-ups for this game to save or share'); return false; }
    let poster = item.poster || null;
    if (!poster && item.kind === 'clip') poster = await posterOf(item.blob, item.from || 0).catch(() => null);
    const ref = gameRef();
    const payload = { source: 'hawkes-share', type: 'media', kind: item.kind, blob: item.blob, mime: item.mime, poster, seconds: item.seconds || null, width: item.width || null, height: item.height || null, title: item.title || ref.title || '', game: ref.game, gameTitle: ref.title, filename: fileName(item) };
    const started = Date.now();
    const onMsg = (e) => {
      if (e.source !== w) return;
      const m = e.data || {};
      if (m.source !== 'hawkes-share') return;
      if (m.type === 'ready') { try { w.postMessage(payload, '*'); } catch (err) { S.toast(`Could not send it: ${err.message}`); } }
      if (m.type === 'shared' && m.url) S.toast('Share link made');
    };
    window.addEventListener('message', onMsg);
    const watch = setInterval(() => { let closed = true; try { closed = w.closed; } catch {} if (closed || Date.now() - started > 30 * 60_000) { clearInterval(watch); window.removeEventListener('message', onMsg); } }, 1000);
    return true;
  };
  /** A picture from a clip (its share card's image). */
  function posterOf(blob, at = 0) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto';
      const url = URL.createObjectURL(blob);
      const done = (b) => { URL.revokeObjectURL(url); resolve(b); };
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('no picture')); };
      v.onloadeddata = () => { v.currentTime = Math.max(0.05, at + 0.5); };
      v.onseeked = () => {
        const c = document.createElement('canvas');
        const k = Math.min(1, 1280 / Math.max(1, v.videoWidth));
        c.width = Math.round(v.videoWidth * k) || 1280; c.height = Math.round(v.videoHeight * k) || 720;
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        S.toBlob(c, 'image/jpeg', 0.86).then(done);
      };
      setTimeout(() => reject(new Error('timed out')), 8000);
      v.src = url;
    });
  }
  S.posterOf = posterOf;

  // ------------------------------------------------------------------ the dock: photo and clip buttons
  const dock = make('sh-dock', '<button type="button" class="sh-photo" title="Photo mode (P)" aria-label="Photo mode">📷</button><button type="button" class="sh-rec" title="Clip that: save the last 15 seconds (F8)" aria-label="Clip that">🎬</button>');
  dock.hidden = true;
  dock.addEventListener('pointerdown', (e) => e.stopPropagation());
  dock.querySelector('.sh-photo').onclick = () => S.photo && S.photo.toggle();
  dock.querySelector('.sh-rec').onclick = () => S.clipThat();
  // Long-press / right-click the clip button: turn the rolling clip off (or on).
  dock.querySelector('.sh-rec').oncontextmenu = (e) => { e.preventDefault(); const on = S.clips(!ring.on, settings().clip); store.set('clips', on ? '1' : '0'); S.toast(on ? `Keeping the last ${ring.plan.clip} s (F8 saves it)` : 'Clip that: off'); };
  function dockState() {
    const s = settings();
    const w = W();
    dock.hidden = s.off || !s.buttons || !w;
    dock.querySelector('.sh-photo').hidden = !s.photo;
    const rec = dock.querySelector('.sh-rec');
    rec.hidden = !canRecord();
    rec.classList.toggle('on', ring.on);
    rec.title = ring.on ? `Clip that: save the last ${ring.plan.clip} seconds (${s.keys.clip.toUpperCase()}; right-click turns it off)` : `Clip that: start keeping the last ${ring.plan.clip} seconds (${s.keys.clip.toUpperCase()})`;
  }
  S.dockState = dockState;

  // Keys: P photo mode, F8 clip that (config.share.keys changes them).
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const s = settings();
    if (s.off || !W()) return;
    const k = e.key === ' ' ? 'space' : String(e.key || '').toLowerCase();
    if (k === s.keys.clip && !sheet) { e.preventDefault(); S.clipThat(); }
  });

  // ------------------------------------------------------------------ the world comes and goes
  H.hooks.frame.push((elapsed) => {
    stepTime(elapsed);
    if (fade.d > 0 && fade.t < fade.d) { fade.t = Math.min(fade.d, fade.t + elapsed); fade.value = fade.from + (fade.to - fade.from) * (fade.t / fade.d); fadeEl.style.opacity = String(fade.value); }
    // Someone set the game's camera while we hold the view: theirs becomes the one we give back.
    const w = W();
    if (rig.owner && w && w.scene && w.scene.activeCamera !== rig.cam) { rig.prev = w.scene.activeCamera; w.scene.activeCamera = rig.cam; }
  });
  H.hooks.world.push({
    enter() {
      const s = settings();
      ring.plan = M.ringPlan(s.clip);
      const pref = store.get('clips');
      const want = !s.off && (pref === null ? s.clips : pref === '1');
      if (want !== ring.on) S.clips(want, s.clip);
      dockState();
    },
    leave() {
      rig.owner = null; rig.cam = null; rig.prev = null; rig.controls = null;
      time.by.clear(); time.scale = 1; time.pausedByUs = false; time.acc = 0;
      try { S.look('none'); } catch {}
      look.name = 'none'; look.saved = null; look.scaling = null;
      if (comp.obs) { try { W().scene.getEngine().onEndFrameObservable.remove(comp.obs); } catch {} comp.obs = null; comp.users = 0; }
      cleanBy.clear(); document.body.classList.remove('sh-clean');
      S.letterbox(false); S.caption(null); S.fade(0, 0);
      closeReview();
    },
  });
})();
