// Mayhem: explosions, fire, things that break, things that tumble, and spawning a hundred of anything.
//   H.mayhem.explode(pos, { radius, force, damage, fire })   the host decides it once for everyone (H.sync.action)
//   H.mayhem.shatter(entity, { pieces, at, force })            a thing breaks into chunks that fly and tumble
//   H.mayhem.ignite(entity, { seconds }) / extinguish(entity)  things burn, smoke, hurt and spread fire
//   H.mayhem.spawnMany(what, count, { at, area, pattern })     "spawn 100 cows" (game.spawnMany for scripts)
//   H.mayhem.tumble(entity, strength)                          spin it like a ragdoll until it lands
// Every effect works with no art (flashes, shockwaves, smoke, debris, synthesized sounds) and uses a sound or a model
// by asset name when the game has one (explosion.mp3, cow.glb...). Kinds: mayhem-kinds.js. Tools: mayhem-tools.js.
// The assistant's docs: docs/world/65-mayhem.md and docs/api/65-mayhem.md.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const M = H.mayhemMath;
  const W = () => H.world;
  const G = () => H.game;
  const vec = L.vec;
  const posOf = L.posOf;
  const r2 = (n) => Math.round(n * 100) / 100;
  const r2v = (a) => [r2(a[0]), r2(a[1]), r2(a[2])];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hexc = (c, f = '#ffffff') => B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(String(c)) ? c : f);
  const online = () => Boolean(H.sync && H.sync.online);
  const me = () => (H.sync ? H.sync.me : null);
  const mine = (e) => !H.sync || H.sync.mine(e);
  const havok = () => H.physics && H.physics.engine === 'havok';
  const now = () => performance.now();

  // ------------------------------------------------------------------ settings: config.mayhem (a world feature)
  const DEFAULTS = {
    slowmo: false,     // big blasts slow time for a moment (playing alone)
    score: true,       // the mayhem score and combo text
    shake: 1,          // camera shake strength (0 turns it off)
    debris: true,      // flying chunks from blasts
    smoke: true,
    maxSpawn: H.touchUi ? 150 : 400,  // things spawnMany keeps alive at once
    maxDebris: H.touchUi ? 60 : 160,  // broken pieces alive at once (the oldest go first)
    debrisLife: 8,     // seconds a broken piece lasts
    burnSeconds: 7,    // how long a fire lasts on a thing
    spread: true,      // fire spreads to things nearby
    friendlyFire: true,
  };
  let cfg = { ...DEFAULTS };
  H.features.register('mayhem', {
    codex: {
      title: 'Mayhem settings', group: 'World features',
      what: 'How explosions and spawning behave: slow motion for big blasts, the score and combo text, shake, debris, smoke, how many things can be spawned at once.',
      value: { slowmo: true, score: true, shake: 1, maxSpawn: 400 },
      fields: Object.entries(DEFAULTS).map(([k, v]) => [k, typeof v, String(v)]),
    },
    apply(value) { cfg = { ...DEFAULTS, ...(value && typeof value === 'object' ? value : {}) }; },
    change(value) { cfg = { ...DEFAULTS, ...(value && typeof value === 'object' ? value : {}) }; },
    dispose() { cfg = { ...DEFAULTS }; },
  });

  // ------------------------------------------------------------------ quality: degrade gracefully when it gets heavy
  // 0 = everything, 1 = fewer particles and shorter-lived debris, 2 = the minimum. Watches the frame rate.
  const quality = { level: H.touchUi ? 1 : 0, slow: 0, fast: 0 };
  function watchFps(dt) {
    const fps = W() && W().scene ? W().scene.getEngine().getFps() : 60;
    if (!isFinite(fps) || fps <= 0) return;
    if (fps < 32) { quality.slow += dt; quality.fast = 0; } else if (fps > 52) { quality.fast += dt; quality.slow = 0; }
    if (quality.slow > 1.5 && quality.level < 2) { quality.level++; quality.slow = 0; }
    if (quality.fast > 6 && quality.level > (H.touchUi ? 1 : 0)) { quality.level--; quality.fast = 0; }
  }
  const q = (n) => Math.max(1, Math.round(n * [1, 0.55, 0.3][quality.level]));

  // ------------------------------------------------------------------ sound: an asset by name, or synthesized
  // The engine's audio (H.audio): one context, and every sound through its master (water can muffle it).
  const audio = () => H.audio.context;
  let noiseBuf = null;
  function noise() {
    const a = audio();
    if (!a) return null;
    if (noiseBuf) return noiseBuf;
    noiseBuf = a.createBuffer(1, a.sampleRate * 2, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  const SOUND_NAMES = {
    boom: ['explosion', 'boom', 'explode', 'blast'],
    whoosh: ['rocket', 'whoosh', 'launch'],
    crash: ['break', 'shatter', 'crash', 'smash'],
    pop: ['spawn', 'pop', 'poof'],
    beep: ['beep', 'tick'],
    throw: ['throw', 'swoosh'],
    fire: ['fire', 'flame', 'burn'],
    zap: ['gravity', 'zap', 'hum'],
    rope: ['rope', 'lasso', 'whip'],
    moo: ['moo', 'cow'],
  };
  /** The game's sound for a mayhem sound (an id or a name; H.assets by word: "explosion", "boom"...), or null. */
  function soundAsset(kind, own) {
    if (own && H.assets.has(own)) return own;
    for (const w of [].concat(own || [], SOUND_NAMES[kind] || [kind])) { const id = H.assets.pick(w, { kind: 'sound', mix: true }); if (id) return id; }
    return null;
  }
  /** Plays a mayhem sound: the game's asset when it has one (explosion.mp3, ...), else a synthesized one. `at` makes
   *  it quieter farther from you. */
  function sound(kind, o = {}) {
    let vol = o.volume ?? 1;
    if (o.at && W() && W().scene && W().scene.activeCamera) {
      const c = W().scene.activeCamera.position, p = vec(o.at);
      const d = Math.hypot(p[0] - c.x, p[1] - c.y, p[2] - c.z);
      vol *= clamp(1.2 - d / 70, 0.05, 1);
    }
    const asset = soundAsset(kind, o.asset);
    if (asset) { try { G().sound(asset, { volume: vol, rate: o.rate || (0.9 + Math.random() * 0.2) }); } catch {} return; }
    synth(kind, vol, o);
  }
  function synth(kind, vol, o) {
    const a = audio();
    if (!a || a.state !== 'running' || vol <= 0.01) return;
    const t = a.currentTime;
    const out = a.createGain();
    out.connect(H.audio.master);
    const noiseSrc = (dur) => { const s = a.createBufferSource(); s.buffer = noise(); s.start(t, Math.random(), dur); s.stop(t + dur); return s; };
    if (kind === 'boom') {
      const big = clamp((o.size || 5) / 6, 0.5, 2);
      const n = noiseSrc(1.6 * big);
      const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(70, t + 1.2 * big);
      out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.9 * vol, t + 0.01); out.gain.exponentialRampToValueAtTime(0.0001, t + 1.5 * big);
      n.connect(lp).connect(out);
      const os = a.createOscillator(); os.type = 'sine'; os.frequency.setValueAtTime(110, t); os.frequency.exponentialRampToValueAtTime(28, t + 0.6);
      const og = a.createGain(); og.gain.setValueAtTime(0.9 * vol, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      os.connect(og).connect(H.audio.master); os.start(t); os.stop(t + 0.75);
    } else if (kind === 'crash') {
      const n = noiseSrc(0.45);
      const hp = a.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 900 + Math.random() * 900; hp.Q.value = 0.7;
      out.gain.setValueAtTime(0.6 * vol, t); out.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      n.connect(hp).connect(out);
    } else if (kind === 'whoosh' || kind === 'throw' || kind === 'rope') {
      const d = kind === 'whoosh' ? 0.7 : 0.3;
      const n = noiseSrc(d);
      const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(kind === 'rope' ? 1400 : 400, t); bp.frequency.exponentialRampToValueAtTime(kind === 'rope' ? 500 : 2400, t + d);
      out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.5 * vol, t + d * 0.3); out.gain.exponentialRampToValueAtTime(0.0001, t + d);
      n.connect(bp).connect(out);
    } else if (kind === 'fire') {
      const n = noiseSrc(0.25);
      const bp = a.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 700;
      out.gain.setValueAtTime(0.25 * vol, t); out.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      n.connect(bp).connect(out);
    } else {
      // pop, beep, zap, moo: a little tone.
      const os = a.createOscillator();
      const f = { pop: [500, 900], beep: [1200, 1200], zap: [180, 90], moo: [140, 95] }[kind] || [600, 600];
      os.type = kind === 'zap' ? 'sawtooth' : kind === 'moo' ? 'triangle' : 'sine';
      const d = kind === 'moo' ? 0.8 : kind === 'zap' ? 0.25 : 0.1;
      os.frequency.setValueAtTime(f[0], t); os.frequency.exponentialRampToValueAtTime(f[1], t + d);
      out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.25 * vol, t + 0.01); out.gain.exponentialRampToValueAtTime(0.0001, t + d);
      os.connect(out); os.start(t); os.stop(t + d + 0.02);
    }
  }

  // ------------------------------------------------------------------ effects: flash, shockwave, smoke, debris, shake
  const fx = new Set(); // { update(dt) -> false when done, dispose() }
  function addFx(f) { fx.add(f); return f; }
  function runFx(dt) { for (const f of [...fx]) { let alive = false; try { alive = f.update(dt); } catch (err) { H.report(err, 'mayhem fx'); } if (!alive) { fx.delete(f); try { f.dispose(); } catch {} } } }
  function clearFx() { for (const f of fx) try { f.dispose(); } catch {} fx.clear(); }

  function glowMat(name, color, alpha = 1) {
    const m = new B.StandardMaterial(name, W().scene);
    m.emissiveColor = hexc(color); m.diffuseColor = new B.Color3(0, 0, 0); m.specularColor = new B.Color3(0, 0, 0);
    m.disableLighting = true; m.alpha = alpha; m.backFaceCulling = false;
    return m;
  }
  /** A fireball and a light that flare and fade. */
  function flash(at, radius, color = '#ffb347') {
    const sc = W().scene;
    const ball = B.MeshBuilder.CreateSphere('mh-fireball', { diameter: 1, segments: 12 }, sc);
    const m = glowMat('mh-fireball', color, 0.95);
    ball.material = m; ball.isPickable = false; ball.metadata = { decor: true };
    ball.position.set(at[0], at[1], at[2]);
    const core = B.MeshBuilder.CreateSphere('mh-core', { diameter: 1, segments: 10 }, sc);
    const cm = glowMat('mh-core', '#fff6d8', 1);
    core.material = cm; core.isPickable = false; core.metadata = { decor: true }; core.position.copyFrom(ball.position);
    const light = new B.PointLight('mh-flash', new B.Vector3(at[0], at[1] + 0.5, at[2]), sc);
    light.diffuse = hexc(color); light.specular = new B.Color3(0, 0, 0); light.range = radius * 4; light.intensity = 0;
    let t = 0;
    const D = 0.55;
    return addFx({
      update(dt) {
        t += dt;
        const k = t / D;
        const s = radius * (0.35 + 1.25 * (1 - Math.pow(1 - Math.min(1, k * 1.6), 3)));
        ball.scaling.setAll(s);
        m.alpha = 0.95 * Math.max(0, 1 - k);
        m.emissiveColor = B.Color3.Lerp(hexc(color), new B.Color3(0.35, 0.12, 0.05), Math.min(1, k * 1.3));
        core.scaling.setAll(s * 0.55 * Math.max(0, 1 - k * 2));
        light.intensity = 6 * Math.max(0, 1 - k * 1.8);
        return t < D;
      },
      dispose() { ball.dispose(); core.dispose(); m.dispose(); cm.dispose(); light.dispose(); },
    });
  }
  /** A ring that races out along the ground. */
  function shockwave(at, radius) {
    const sc = W().scene;
    const ring = B.MeshBuilder.CreateTorus('mh-shock', { diameter: 1, thickness: 0.06, tessellation: 40 }, sc);
    const m = glowMat('mh-shock', '#fff1c4', 0.8);
    ring.material = m; ring.isPickable = false; ring.metadata = { decor: true };
    ring.position.set(at[0], at[1] - 0.3, at[2]);
    let t = 0;
    const D = 0.45;
    return addFx({
      update(dt) { t += dt; const k = t / D; const s = radius * 2.6 * (1 - Math.pow(1 - Math.min(1, k), 2)); ring.scaling.set(s, 1 + k * 4, s); m.alpha = 0.8 * (1 - k); return t < D; },
      dispose() { ring.dispose(); m.dispose(); },
    });
  }
  /** Smoke that rises and spreads (dark for blasts, grey for fires). */
  function smoke(at, o = {}) {
    if (cfg.smoke === false) return null;
    const sc = W().scene;
    const n = q(o.count || 40);
    const ps = new B.ParticleSystem('mh-smoke', n, sc);
    ps.particleTexture = W().dot;
    ps.emitter = new B.Vector3(at[0], at[1], at[2]);
    const r = o.radius || 1;
    ps.minEmitBox = new B.Vector3(-r * 0.4, -0.2, -r * 0.4); ps.maxEmitBox = new B.Vector3(r * 0.4, r * 0.3, r * 0.4);
    const c = hexc(o.color || '#2a2522');
    ps.color1 = new B.Color4(c.r, c.g, c.b, 0.55); ps.color2 = new B.Color4(c.r * 1.3, c.g * 1.3, c.b * 1.3, 0.4); ps.colorDead = new B.Color4(c.r, c.g, c.b, 0);
    ps.minSize = r * 0.8; ps.maxSize = r * 2;
    ps.addSizeGradient(0, 0.5); ps.addSizeGradient(1, 2.2);
    ps.minLifeTime = 1.2; ps.maxLifeTime = o.life || 3;
    ps.manualEmitCount = n;
    ps.minEmitPower = 0.5; ps.maxEmitPower = 2 + r * 0.4;
    ps.direction1 = new B.Vector3(-0.6, 1, -0.6); ps.direction2 = new B.Vector3(0.6, 1.6, 0.6);
    ps.gravity = new B.Vector3(0, 1.2, 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_STANDARD;
    ps.minAngularSpeed = -1; ps.maxAngularSpeed = 1;
    ps.disposeOnStop = true;
    ps.targetStopDuration = (o.life || 3) + 0.2;
    ps.start();
    return ps;
  }
  /** Sparks and fire bits flying out. */
  function sparks(at, o = {}) {
    const g = G();
    g.burst(at, { color: o.color || '#ffb347', count: q(o.count || 60), speed: o.speed || 9, size: o.size || 0.35, life: 0.7 });
    g.burst(at, { color: '#fff2c0', count: q(30), speed: (o.speed || 9) * 0.6, size: 0.2, life: 0.4 });
  }
  // Little chunks thrown by a blast (cosmetic: instances of one small box, falling to the ground below them).
  let chunkSrc = null;
  function chunkMesh() {
    const sc = W().scene;
    if (chunkSrc && chunkSrc.getScene() === sc && !chunkSrc.isDisposed()) return chunkSrc;
    chunkSrc = B.MeshBuilder.CreateBox('mh-chunk', { size: 1 }, sc);
    const m = new B.StandardMaterial('mh-chunk', sc); m.diffuseColor = new B.Color3(0.25, 0.22, 0.2); m.specularColor = new B.Color3(0, 0, 0);
    chunkSrc.material = m; chunkSrc.isPickable = false; chunkSrc.metadata = { decor: true };
    chunkSrc.position.y = -10000; chunkSrc.alwaysSelectAsActiveMesh = false;
    return chunkSrc;
  }
  function debrisBits(at, radius) {
    if (cfg.debris === false) return;
    const src = chunkMesh();
    const n = q(Math.round(8 + radius * 1.5));
    const bits = [];
    for (let i = 0; i < n; i++) {
      const b = src.createInstance('mh-bit');
      b.isPickable = false; b.metadata = { decor: true };
      const s = 0.08 + Math.random() * 0.22;
      b.scaling.setAll(s);
      b.position.set(at[0], at[1] + 0.2, at[2]);
      const a = Math.random() * Math.PI * 2, up = 4 + Math.random() * 9, out = 3 + Math.random() * radius * 1.4;
      const hit = G().raycast([at[0] + Math.sin(a) * out * 0.6, at[1] + 2, at[2] + Math.cos(a) * out * 0.6], [0, -1, 0], 30, { ignore: null });
      bits.push({ m: b, v: [Math.sin(a) * out, up, Math.cos(a) * out], spin: [Math.random() * 12 - 6, Math.random() * 12 - 6, 0], floor: hit ? hit.point[1] + s / 2 : at[1] - 3, s });
    }
    let t = 0;
    const g = (W().config.gravity ?? -24);
    addFx({
      update(dt) {
        t += dt;
        for (const b of bits) {
          if (b.m.position.y > b.floor || b.v[1] > 0) {
            b.v[1] += g * dt;
            b.m.position.x += b.v[0] * dt; b.m.position.y += b.v[1] * dt; b.m.position.z += b.v[2] * dt;
            b.m.rotation.x += b.spin[0] * dt; b.m.rotation.y += b.spin[1] * dt;
            if (b.m.position.y < b.floor) { b.m.position.y = b.floor; b.v = [b.v[0] * 0.3, -b.v[1] * 0.25, b.v[2] * 0.3]; if (Math.abs(b.v[1]) < 1) b.v[1] = 0; }
          }
          if (t > 2.4) b.m.scaling.setAll(b.s * Math.max(0, 1 - (t - 2.4) / 0.6));
        }
        return t < 3;
      },
      dispose() { for (const b of bits) b.m.dispose(); },
    });
  }
  /** Shakes the camera, less the farther you are. */
  function shake(at, amount, seconds = 0.35) {
    const p = W() && W().player;
    if (!cfg.shake || !G()) return;
    let k = 1;
    if (p && at) { const d = p.distanceTo(at); k = clamp(1.3 - d / 30, 0, 1); }
    if (k > 0.02) G().camera.shake(amount * k * cfg.shake, seconds);
  }

  // ------------------------------------------------------------------ the score and combo text
  const score = { total: 0, combo: 0, last: 0, el: null, pop: null, hideAt: 0 };
  function styles() {
    if (document.getElementById('mh-style')) return;
    const s = document.createElement('style');
    s.id = 'mh-style';
    s.textContent = `
      .mh-score { position: absolute; left: 50%; top: max(14px, env(safe-area-inset-top)); transform: translateX(-50%); font: 800 15px/1 system-ui, sans-serif; letter-spacing: .14em; color: #ffe2a8; text-shadow: 0 0 12px rgba(255,120,40,.8), 0 2px 4px rgba(0,0,0,.7); pointer-events: none; transition: opacity .5s; z-index: 4; }
      .mh-score[hidden] { display: none; }
      .mh-score b { font-size: 22px; color: #fff; margin-left: 6px; }
      .mh-pop { position: absolute; left: 50%; top: 24%; transform: translate(-50%, -50%); font: 900 30px/1 system-ui, sans-serif; color: #fff; text-shadow: 0 0 18px rgba(255,90,30,.95), 0 3px 6px rgba(0,0,0,.6); pointer-events: none; z-index: 4; animation: mh-pop .9s ease-out forwards; white-space: nowrap; }
      .mh-pop em { font-style: normal; color: #ffd166; margin-left: 8px; }
      @keyframes mh-pop { 0% { transform: translate(-50%, -50%) scale(.4); opacity: 0; } 15% { transform: translate(-50%, -50%) scale(1.25); opacity: 1; } 30% { transform: translate(-50%, -50%) scale(1); } 100% { transform: translate(-50%, -90%) scale(1); opacity: 0; } }
      .mh-cross { position: absolute; left: 50%; top: 50%; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 2px solid rgba(255,220,180,.85); border-radius: 50%; box-shadow: 0 0 8px rgba(255,120,40,.7); pointer-events: none; z-index: 3; }
      .mh-cross::after { content: ''; position: absolute; left: 8px; top: 8px; width: 2px; height: 2px; border-radius: 1px; background: #fff; }
      .mh-cross[hidden], .mh-tip[hidden], .mh-touch[hidden] { display: none; }
      .mh-tip { position: absolute; left: 50%; bottom: max(96px, calc(env(safe-area-inset-bottom) + 90px)); transform: translateX(-50%); padding: 7px 14px; border-radius: 999px; background: rgba(10,12,20,.62); color: #fff; font: 600 13px/1.2 system-ui, sans-serif; pointer-events: none; z-index: 4; transition: opacity .6s; white-space: nowrap; max-width: calc(100vw - 32px); overflow: hidden; text-overflow: ellipsis; }
      .mh-tip b { color: #ffd166; }
      .mh-tip.out { opacity: 0; }
      .mh-touch button { position: fixed; border-radius: 50%; border: 1px solid rgba(255,200,150,.55); background: rgba(255,120,40,.22); color: #fff; font: 700 13px/1 system-ui, sans-serif; touch-action: none; z-index: 5; }
      .mh-touch .mh-fire { right: max(22px, env(safe-area-inset-right)); bottom: 112px; width: 78px; height: 78px; font-size: 15px; }
      .mh-touch .mh-alt { right: 112px; bottom: 182px; width: 58px; height: 58px; }
      .mh-touch .mh-next { right: max(22px, env(safe-area-inset-right)); bottom: 204px; width: 50px; height: 50px; font-size: 18px; }
    `;
    document.head.appendChild(s);
  }
  function scoreEl() {
    if (score.el && score.el.isConnected) return score.el;
    styles();
    const el = document.createElement('div');
    el.className = 'mh-score'; el.hidden = true;
    el.innerHTML = 'MAYHEM<b>0</b>';
    const ui = document.getElementById('ui') || document.body;
    ui.appendChild(el);
    score.el = el;
    return el;
  }
  /** Points for something that happened (hit, broke, kill, boom, burn), with the combo multiplier. */
  function addScore(what, n = 1) {
    if (!cfg.score || n <= 0 || !W()) return;
    const t = now();
    score.combo = t - score.last < 1800 ? score.combo + 1 : 1;
    score.last = t;
    let pts = 0;
    for (let i = 0; i < n; i++) pts += M.score(what, Math.min(score.combo, 10));
    score.total += pts;
    if (G()) G().state.mayhem = score.total;
    const el = scoreEl();
    el.hidden = false;
    el.querySelector('b').textContent = score.total.toLocaleString();
    // The combo, big in the middle: "+250 x5 COMBO".
    if (score.combo >= 2 || what === 'kill' || pts >= 50) {
      if (score.pop) score.pop.remove();
      const pop = document.createElement('div');
      pop.className = 'mh-pop';
      pop.innerHTML = `+${pts}${score.combo >= 2 ? `<em>×${Math.min(score.combo, 10)} COMBO</em>` : ''}`;
      (document.getElementById('ui') || document.body).appendChild(pop);
      score.pop = pop;
      setTimeout(() => pop.remove(), 950);
    }
    if (G()) G().emit('mayhem', { what, points: pts, total: score.total, combo: score.combo });
  }
  /** Points count for what you set off (or what happens near it soon after). */
  let myMayhemAt = -1e9;
  const credit = () => now() - myMayhemAt < 2500;

  // ------------------------------------------------------------------ slow motion (playing alone)
  let slowmo = null;
  /** Slows the game down for a moment (seconds, to about a third of the speed). Online games keep full speed. */
  function slowMotion(seconds = 0.9) {
    if (online() || !W() || W().paused || H.mode === 'build') return;
    slowmo = { until: now() + seconds * 1000 };
    H.slow('mayhem', 0.35); // the engine's time scale: fewer steps a second, nothing else runs twice
  }
  function runSlowmo() {
    if (!slowmo) return;
    if (now() > slowmo.until || !W()) { slowmo = null; H.slow('mayhem', null); }
  }

  // ------------------------------------------------------------------ the local player gets thrown too
  const knock = { v: [0, 0, 0], t: 0 };
  function knockPlayer(at, radius, force) {
    const p = W() && W().player;
    if (!p || !p.alive || (H.mode === 'build' && p.flying)) return;
    const c = [p.x, p.y, p.z];
    const d = Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]);
    if (d > radius) return;
    const k = M.falloff(d, radius);
    const h = Math.hypot(c[0] - at[0], c[2] - at[2]) || 1;
    const s = force * k * 0.9;
    knock.v = [((c[0] - at[0]) / h) * s, 0, ((c[2] - at[2]) / h) * s];
    knock.t = 0.45;
    p.vy = Math.max(p.vy, 4 + force * k * 0.5);
    p.grounded = false; p.wake();
  }
  // After the walking controller sets the player's speed: add what's left of the shove.
  function runKnock(dt) {
    const p = W() && W().player;
    if (!p || knock.t <= 0) return;
    const k = knock.t / 0.45;
    p.vx += knock.v[0] * k; p.vz += knock.v[2] * k;
    knock.t -= dt;
  }

  // ------------------------------------------------------------------ tumbling (ragdoll-ish)
  const tumbling = new Set();
  /** Spins a thing like a ragdoll while it flies; it lands and (creatures) gets back up. */
  function tumble(e, strength = 1) {
    if (!e || !e.alive || e.isPlayer || e.remotePlayer || e.physics !== 'dynamic') return;
    const s = clamp(strength, 0, 3);
    const spin = [(Math.random() - 0.5) * 14 * s, (Math.random() - 0.5) * 8 * s, (Math.random() - 0.5) * 14 * s];
    if (havok()) {
      e._wasUpright = e._wasUpright ?? e.upright;
      e.upright = false;
      e.angularVelocity = spin.map((x) => x * 57.3);
    }
    e._tumble = { spin, t: 0, rest: 0 };
    tumbling.add(e);
  }
  function runTumble(dt) {
    for (const e of [...tumbling]) {
      const tb = e._tumble;
      if (!e.alive || !tb) { tumbling.delete(e); continue; }
      tb.t += dt;
      const r = e.node.rotation;
      const speed = Math.hypot(e.vx, e.vy, e.vz);
      // Havok turns things for real (and knows when they rest); the first physics only turns what you see.
      const resting = tb.t > 0.3 && (e.sleeping || (speed < 0.7 && (havok() ? Math.hypot(...e.angularVelocity) < 40 : e.grounded)));
      if (!havok()) {
        if (!resting) { r.x += tb.spin[0] * dt; r.y += tb.spin[1] * dt; r.z += tb.spin[2] * dt; if (e.grounded) tb.spin = tb.spin.map((x) => x * 0.9); }
        else tb.spin = [0, 0, 0];
      }
      if (resting) tb.rest += dt; else tb.rest = 0;
      const getsUp = Boolean(e.living || (e.data && e.data.upright)) || e._wasUpright;
      if (havok() && !getsUp && tb.rest > 0.2) { e._tumble = null; tumbling.delete(e); continue; } // blocks lie as they fell
      if (tb.rest > (getsUp ? 0.9 : 0.15)) {
        // Lying still: creatures get back on their feet (upright again, so they don't tip while they do); blocks
        // settle on a face.
        if (havok() && e._wasUpright !== undefined) { e.upright = true; }
        const k = Math.min(1, dt * (getsUp ? 5 : 10));
        const tx = getsUp ? 0 : Math.round(r.x / (Math.PI / 2)) * (Math.PI / 2);
        const tz = getsUp ? 0 : Math.round(r.z / (Math.PI / 2)) * (Math.PI / 2);
        r.x += (tx - r.x) * k; r.z += (tz - r.z) * k;
        if (Math.abs(tx - r.x) < 0.01 && Math.abs(tz - r.z) < 0.01) {
          r.x = tx; r.z = tz;
          if (havok() && e._wasUpright !== undefined) { e.upright = e._wasUpright; e._wasUpright = undefined; e.wake(); }
          e._tumble = null; tumbling.delete(e);
          if (getsUp && e.living) G().emit('landed', { entity: e });
        }
      }
      if (tb.t > 12) { if (havok() && e._wasUpright !== undefined) { e.upright = e._wasUpright; e._wasUpright = undefined; } e._tumble = null; tumbling.delete(e); }
    }
  }

  // ------------------------------------------------------------------ breaking things into pieces
  const debris = []; // pieces alive, oldest first
  /** The pieces' look: the thing's own material when it has one (shared by all its pieces). */
  function pieceMaterial(e, color) {
    const sc = W().scene;
    const own = e._mat;
    const m = new B.StandardMaterial('mh-piece', sc);
    if (!own && e.living) { m.diffuseColor = hexc(color || creatureColor(e)); m.specularColor = new B.Color3(0.05, 0.05, 0.05); return m; }
    if (own && own.diffuseTexture) { m.diffuseTexture = own.diffuseTexture; m.diffuseColor = own.diffuseColor ? own.diffuseColor.clone() : new B.Color3(1, 1, 1); }
    else m.diffuseColor = own && own.diffuseColor ? own.diffuseColor.clone() : hexc(color || e.data.color || '#a07a50');
    if (own && own.emissiveColor) m.emissiveColor = own.emissiveColor.clone();
    m.specularColor = new B.Color3(0.05, 0.05, 0.05);
    return m;
  }
  /** Breaks a thing here and now: pieces fly from `at` (or its middle), the thing goes (scene things are hidden until
   *  the game starts over, or come back after `respawn` seconds). opts: { pieces, at, force, keep (leave the thing),
   *  color, respawn }. */
  function shatterLocal(e, o = {}) {
    if (!e || !e.alive || e._shattered) return [];
    e._shattered = true;
    const sc = W().scene;
    const size = e.size.map((x) => Math.max(0.1, x));
    const mid = [e.x + e.offset[0], e.y + e.offset[1], e.z + e.offset[2]];
    const from = o.at ? vec(o.at) : [mid[0], mid[1] - size[1] * 0.3, mid[2]];
    const force = Number(o.force) || 6;
    let want = Number(o.pieces) || (e._break && e._break.pieces) || 8;
    if (debris.length > cfg.maxDebris * 0.7 || quality.level > 0) want = Math.min(want, quality.level > 1 ? 4 : 6);
    const chunks = M.fracture(size, want, M.hashSeed(e.sceneId || e.name || String(e.x)));
    const mat = pieceMaterial(e, o.color);
    const yaw = e.node.rotation.y, cy = Math.cos(yaw), sy = Math.sin(yaw);
    const made = [];
    const budget = Math.max(0, 24 - debris.length);
    chunks.forEach((c, i) => {
      const box = B.MeshBuilder.CreateBox('mh-piece', { width: c.size[0] * 0.96, height: c.size[1] * 0.96, depth: c.size[2] * 0.96 }, sc);
      box.material = mat;
      const off = [c.offset[0] * cy + c.offset[2] * sy, c.offset[1], -c.offset[0] * sy + c.offset[2] * cy];
      const p = new L.Entity(box, { physics: 'dynamic', mass: Math.max(0.1, (e.mass || 1) / chunks.length), bounce: 0.25, friction: 0.7, data: { debris: true } }, 'box');
      p._mat = mat;
      p.node.position.set(mid[0] + off[0], mid[1] + off[1], mid[2] + off[2]);
      p.node.rotation.y = yaw;
      p.temporary = true;
      p.layer = 'debris';
      if (W().shadows && i < budget) { W().shadows.addShadowCaster(box); }
      box.receiveShadows = true;
      p.measure();
      // Away from where it was hit, and up.
      const d = [p.x - from[0], p.y - from[1], p.z - from[2]];
      const l = Math.hypot(...d) || 1;
      const k = force * (0.6 + Math.random() * 0.6);
      launch(p, [(d[0] / l) * k + (Math.random() - 0.5) * 2, Math.abs(d[1] / l) * k * 0.6 + 2 + Math.random() * 3, (d[2] / l) * k + (Math.random() - 0.5) * 2]);
      tumble(p, 0.6 + Math.random() * 0.8);
      p._born = W().time; // game time: pieces wait while the game is paused
      p._life = (cfg.debrisLife || 8) * (quality.level ? 0.5 : 1) * (0.8 + Math.random() * 0.4);
      debris.push(p);
      made.push(p);
    });
    p_disposeWith(mat, made);
    while (debris.length > cfg.maxDebris) { const old = debris.shift(); if (old && old.alive) old.destroy(); }
    // Dust and a crash.
    G().burst(mid, { color: o.color || (e.color || '#c8b49a'), count: q(28), speed: 4, size: 0.3, life: 0.6 });
    smoke(mid, { count: 10, radius: Math.max(...size) * 0.4, color: '#8a8070', life: 1.6 });
    sound('crash', { at: mid });
    shake(mid, 0.12, 0.15);
    if (credit() || !online()) addScore('broke');
    G().emit('break', { entity: e, pieces: made });
    if (!o.keep) {
      if (e.sceneId && !e.temporary) {
        e.visible = false; e.ghost = true; e.dead = true; e.velocity = [0, 0, 0]; e.hp = undefined;
        const back = Number(o.respawn ?? (e._break && e._break.respawn)) || 0;
        if (back > 0) G().after(back, () => { if (!e.alive) return; e._shattered = false; e.dead = false; e.ghost = false; e.visible = true; if (e.maxHp) e.hp = e.maxHp; if (e.home) { e.position = e.home.position; e.rotation = e.home.rotation; } });
      } else e.destroy();
    }
    return made;
  }
  // The pieces' shared material goes with the last piece.
  function p_disposeWith(mat, pieces) {
    let left = pieces.length;
    for (const p of pieces) p.onDestroy(() => { if (--left <= 0) mat.dispose(); });
  }
  function runDebris() {
    const t = W().time;
    for (let i = debris.length - 1; i >= 0; i--) {
      const p = debris[i];
      if (!p.alive) { debris.splice(i, 1); continue; }
      const age = t - p._born;
      if (age > p._life) {
        // Shrink away, then go.
        const k = 1 - (age - p._life) / 0.6;
        if (k <= 0) { p.destroy(); debris.splice(i, 1); } else p.node.scaling.setAll(Math.max(0.01, k));
      }
    }
  }
  const shatterAction = H.sync.action('mayhem:shatter', (d) => {
    const e = G() && G().entity(d.id);
    if (e) shatterLocal(e, { at: d.at, force: d.force, pieces: d.pieces, respawn: d.respawn });
  });
  /** Breaks a thing into pieces (for everyone, when it's in the world). */
  function shatter(target, o = {}) {
    const e = typeof target === 'string' ? G().entity(target) || G().find(target) : target;
    if (!e || !e.alive || e._shattered || e.isPlayer || e.remotePlayer) return false;
    if (e.sceneId) shatterAction({ id: e.sceneId, at: o.at ? r2v(vec(o.at)) : null, force: o.force || null, pieces: o.pieces || null, respawn: o.respawn ?? null });
    else shatterLocal(e, o);
    return true;
  }

  // breakable: { "use": "breakable", "strength": 12, "pieces": 8, "hp": 0, "respawn": 0 }
  const breakDef = {
    title: 'Breaks into pieces',
    says: (o) => `breaks into ${o.pieces} pieces when hit at ${o.strength} m/s${o.hp ? ` or after ${o.hp} damage` : ''}${o.respawn ? `, back after ${o.respawn} s` : ''}`,
    defaults: { strength: 12, pieces: 8, hp: 0, respawn: 0 },
    start(e, o) {
      e._break = { strength: Number(o.strength) || 12, pieces: Number(o.pieces) || 8, respawn: Number(o.respawn) || 0 };
      if (Number(o.hp) > 0 && e.hp === undefined) { e.maxHp = e.hp = Number(o.hp); }
      watched.add(e);
    },
    stop(e) { e._break = null; },
  };
  for (const n of ['breakable', 'shatters', 'fragile']) H.behavior(n, breakDef);
  // flammable: { "use": "flammable", "seconds": 10 } (dynamic things, creatures, barrels and crates burn anyway)
  const flamDef = {
    title: 'Can burn', says: (o) => `catches fire and burns for ${o.seconds} s`,
    defaults: { seconds: 0 },
    start(e, o) { e.data.flammable = true; if (Number(o.seconds) > 0) e.data.burnSeconds = Number(o.seconds); },
  };
  for (const n of ['flammable', 'burns']) H.behavior(n, flamDef);
  // explosive: { "use": "explosive", "radius": 6, "force": 20, "damage": 60 }: blows up when destroyed or hit hard
  const exploDef = {
    title: 'Explodes', says: (o) => `blows up (${o.radius} m) when destroyed, burnt or hit hard`,
    defaults: { radius: 6, force: 20, damage: 60, hp: 20, fire: true, strength: 16 },
    start(e, o) {
      e.data.explosive = { radius: Number(o.radius) || 6, force: Number(o.force) || 20, damage: Number(o.damage) || 60, fire: o.fire !== false, strength: Number(o.strength) || 16 };
      if (e.hp === undefined) e.maxHp = e.hp = Number(o.hp) || 20;
      watched.add(e);
    },
  };
  for (const n of ['explosive', 'explodes', 'bomb']) H.behavior(n, exploDef);
  if (H.behaviorMenu) H.behaviorMenu.push(['breakable', 'Breaks into pieces'], ['explosive', 'Explodes'], ['flammable', 'Can burn']);

  // Hits hard enough break breakables and set off explosives. Speed is the impact speed (Havok gives it; on the
  // first physics it's how fast the two were closing when they touched).
  const watched = new Set();
  const before = (e) => (e._pv && e._pvAt === stepNo ? e._pv : e._v || [e.vx || 0, e.vy || 0, e.vz || 0]);
  function impact({ a, b }) {
    if (!a || !b) return;
    const va = a.physics === 'dynamic' ? before(a) : [0, 0, 0], vb = b.physics === 'dynamic' ? before(b) : [0, 0, 0];
    const s = Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]);
    check(a, s, b); check(b, s, a);
  }
  function check(e, s, other) {
    if (!e.alive || e._shattered || e.dead || !mine(e) || H.mode === 'build') return;
    if (other && other.data && other.data.debris && s < 20) return; // pieces don't break things unless thrown hard
    if (e._break && s >= e._break.strength) shatter(e, { at: other ? [other.x, other.y, other.z] : null, force: Math.min(14, s * 0.5) });
    else if (e.data && e.data.explosive && s >= e.data.explosive.strength) blowUp(e);
  }
  H.physics.on('collision', impact);
  // How fast things were going before each step (what an impact is measured by).
  let stepNo = 0;
  H.physics.beforeStep(() => {
    stepNo++;
    const w = W();
    if (!w) return;
    for (const e of w.entities) if (e.physics === 'dynamic' && !e.sleeping) { const v = e._v || [e.vx, e.vy, e.vz]; e._pv = [v[0], v[1], v[2]]; e._pvAt = stepNo; }
  });

  // ------------------------------------------------------------------ explosions
  /** An explosive thing goes off (barrels, bombs): once, a moment later for a chain. */
  function blowUp(e, delay = 0) {
    if (!e || !e.alive || e._exploded) return;
    e._exploded = true;
    const x = e.data.explosive || e.data.barrel || {};
    const at = [e.x + e.offset[0], e.y + e.offset[1], e.z + e.offset[2]];
    const go = () => {
      explode(at, { radius: x.radius || 6, force: x.force || 20, damage: x.damage || 60, fire: x.fire !== false, remove: e.sceneId || null, chain: true });
      if (e.alive && !e.sceneId) e.destroy();
    };
    if (delay > 0 && G()) G().after(delay, go); else go();
  }

  const boomAction = H.sync.action('mayhem:boom', (d, ctx) => runBoom(d, ctx.authoritative));
  let lastBoom = { at: null, t: 0, chain: 0 };
  /** What everyone sees and hears (and, on the host, what it does to things). */
  function runBoom(d, authoritative) {
    const w = W(), g = G();
    if (!w || !g) return;
    const at = vec(d.at), R = Number(d.radius) || 5, F = Number(d.force ?? 18);
    // A world-made blast (by: 'world': a meteor, a volcano) counts for nobody's score.
    const world = d.by === 'world';
    const byMe = !world && (!online() || d.by === me());
    if (byMe) myMayhemAt = now();
    // Something exploding goes away for everyone.
    if (d.remove) { const x = g.entity(d.remove); if (x && x.alive) { x._exploded = true; if (x.temporary) x.destroy(); else { x.visible = false; x.ghost = true; x.dead = true; x.hp = undefined; } } }
    // Chains: blasts close in time grow the combo, and big ones slow time down.
    const chain = now() - lastBoom.t < 900 ? lastBoom.chain + 1 : 0;
    lastBoom = { at, t: now(), chain };
    if (d.effects !== false) {
      flash(at, R * 0.55, d.color || (d.fire ? '#ff9a3c' : '#ffd27a'));
      shockwave(at, R);
      sparks(at, { color: d.color || '#ff8a3d', speed: 5 + R, count: Math.round(30 + R * 8) });
      smoke(at, { radius: R * 0.35, count: Math.round(20 + R * 4), life: 2 + R * 0.25 });
      debrisBits(at, R);
      shake(at, Math.min(0.9, 0.15 + R * 0.06), 0.25 + R * 0.03);
      sound('boom', { at, size: R, asset: d.sound });
    }
    knockPlayer(at, R * 1.1, F);
    if (authoritative) {
      // Real pushes and damage (H.physics: mass-aware impulses on Havok), then tumbling, breaking and burning. (The
      // 'explosion' event is announced once, below, with mayhem's own fields.)
      const hit = H.physics.explode(at, { radius: R, force: F, damage: d.damage || 0, owner: d.owner || null, up: 0.8, push: false, event: false }) || [];
      let pushed = 0;
      for (const e of hit) {
        if (!e.alive || e.isPlayer || e.remotePlayer) continue;
        const dist = Math.hypot(e.x - at[0], e.y - at[1], e.z - at[2]);
        const k = M.falloff(dist, R);
        if (e.physics === 'dynamic') { tumble(e, 0.5 + k * 2); pushed++; }
        if (e._break && !e._shattered && F * k >= e._break.strength * 0.6) shatter(e, { at, force: F * k * 0.8 });
        if (d.fire && k > 0.25) ignite(e, {});
      }
      // (Creatures run from it by themselves: Living things hears the event.)
      if (byMe && pushed) addScore('hit', Math.min(pushed, 12));
    }
    if (!world && (byMe || credit())) addScore('boom');
    if (cfg.slowmo && (R >= 8 || chain >= 2)) slowMotion(R >= 8 ? 1.1 : 0.7);
    H.physics.announce({ position: at, radius: R, force: F, damage: d.damage || 0, fire: Boolean(d.fire), authoritative, by: d.by || null, chain, mayhem: true });
  }
  /** Blows up at a point: real pushes, damage that falls off with distance, a fireball, a shockwave, smoke, debris,
   *  a shake and a boom. opts: { radius (5), force (18), damage (40), fire (sets things alight), color, sound (an asset
   *  name), effects: false (no visuals), owner (an entity: who gets the kill), by: 'world' (a blast nobody set off:
   *  meteors, volcanoes; no one's score or combo) }. Online, the host decides it. */
  function explode(pos, o = {}) {
    const at = posOf(pos);
    const d = {
      at: r2v(at), radius: clamp(Number(o.radius) || 5, 0.5, 60), force: clamp(Number(o.force ?? 18), 0, 200), damage: clamp(Number(o.damage ?? 40), 0, 10000),
      fire: Boolean(o.fire), by: o.by === 'world' ? 'world' : me(), color: o.color || null, sound: o.sound || null, effects: o.effects !== false, remove: o.remove || null,
    };
    if (!o.chain && o.by !== 'world') myMayhemAt = now();
    // The owner (an entity, for the kill) only when playing alone: actions travel as JSON.
    if (o.owner && !online()) d.owner = o.owner;
    boomAction(d);
    delete d.owner;
    return d;
  }

  // Barrels, explosives and breakables with health: when they die (the engine's damage), they go off or break.
  function onDeath({ entity: e }) {
    if (!e) return;
    if (e.data && (e.data.explosive || e.data.barrel) && !e._exploded) blowUp(e, 0.06 + Math.random() * 0.14);
    else if (e._break && !e._shattered) { if (e.sceneId) shatterAction({ id: e.sceneId }); else shatterLocal(e, { keep: true }); }
    else if (e.living && !e._shattered) shatterLocal(e, { keep: true, pieces: 6, force: 5, color: creatureColor(e) });
    if (e.living && (credit() || !online())) addScore('kill');
  }

  const creatureColor = (e) => { const c = e.living && e.living.sp && e.living.sp.colors; return (c && c.body) || '#a07a50'; };

  // ------------------------------------------------------------------ fire
  const burning = new Map(); // entity -> { t, life, ps, smoke, tick, spread }
  /** Can it burn? Things with "flammable", moving things, creatures, crates and barrels (not the floor or walls). */
  function flammable(e) {
    if (!e || !e.alive || e.isPlayer || e.remotePlayer || e.kind === 'light' || e.kind === 'text' || e.kind === 'spawn') return false;
    if (e.data && e.data.flammable === false) return false;
    if (e.data && (e.data.flammable || e.data.barrel || e.data.explosive || e.data.crate)) return true;
    if (e.living) return true;
    return e.physics === 'dynamic' || Boolean(e._break);
  }
  function fireSystem(e) {
    const sc = W().scene;
    const n = q(Math.round(30 + Math.max(...e.size) * 20));
    const ps = new B.ParticleSystem('mh-fire', n, sc);
    ps.particleTexture = W().dot;
    ps.emitter = e.node;
    const h = e.half;
    ps.minEmitBox = new B.Vector3(-h[0] * 0.8, -h[1] * 0.4, -h[2] * 0.8); ps.maxEmitBox = new B.Vector3(h[0] * 0.8, h[1], h[2] * 0.8);
    ps.color1 = new B.Color4(1, 0.75, 0.25, 1); ps.color2 = new B.Color4(1, 0.35, 0.08, 1); ps.colorDead = new B.Color4(0.3, 0.05, 0, 0);
    ps.minSize = 0.25; ps.maxSize = 0.4 + Math.max(...h) * 0.5;
    ps.minLifeTime = 0.25; ps.maxLifeTime = 0.6;
    ps.emitRate = n * 2.2;
    ps.direction1 = new B.Vector3(-0.3, 1, -0.3); ps.direction2 = new B.Vector3(0.3, 1.5, 0.3);
    ps.minEmitPower = 1; ps.maxEmitPower = 2.5;
    ps.gravity = new B.Vector3(0, 3, 0);
    ps.blendMode = B.ParticleSystem.BLENDMODE_ADD;
    ps.start();
    return ps;
  }
  const igniteAction = H.sync.action('mayhem:ignite', (d) => { const e = G() && G().entity(d.id); if (e) igniteLocal(e, d.s); });
  const outAction = H.sync.action('mayhem:extinguish', (d) => { const e = G() && G().entity(d.id); if (e) extinguishLocal(e); });
  /** Sets a thing on fire (if it can burn): flames, smoke, damage over time, spreading to what's close. */
  function ignite(target, o = {}) {
    const e = typeof target === 'string' ? G().entity(target) || G().find(target) : target;
    if (!flammable(e) || (H.water && H.water.inWater && safeWater(e))) return false;
    const s = Number(o.seconds) || 0;
    if (burning.has(e)) { burning.get(e).t = 0; return true; }
    if (e.sceneId) igniteAction({ id: e.sceneId, s }); else igniteLocal(e, s);
    return true;
  }
  function safeWater(e) { try { return Boolean(H.water.inWater(e.position)); } catch { return false; } }
  function igniteLocal(e, seconds) {
    if (!e || !e.alive || burning.has(e)) { if (burning.has(e)) burning.get(e).t = 0; return; }
    const life = Number(seconds) || Number(e.data.burnSeconds) || cfg.burnSeconds || 7;
    const visible = [...burning.values()].filter((b) => b.ps).length < (quality.level > 1 ? 8 : 20);
    const b = { t: 0, life, ps: visible ? fireSystem(e) : null, tick: 0, spread: 0.6 + Math.random() * 0.5, char: 0, light: null };
    if (visible && burning.size < 6) {
      b.light = new B.PointLight('mh-fire-light', B.Vector3.Zero(), W().scene);
      b.light.diffuse = new B.Color3(1, 0.55, 0.2); b.light.range = 6; b.light.intensity = 1.2; b.light.parent = e.node;
    }
    burning.set(e, b);
    e.burning = true;
    G().emit('ignite', { entity: e });
    if (credit()) addScore('burn');
  }
  function extinguishLocal(e) {
    const b = burning.get(e);
    if (!b) return;
    burning.delete(e);
    e.burning = false;
    if (b.ps) { b.ps.stop(); const ps = b.ps; setTimeout(() => ps.dispose(), 800); }
    if (b.light) b.light.dispose();
    if (e.alive && W()) smoke([e.x, e.y + e.half[1], e.z], { count: 12, radius: Math.max(...e.half), color: '#5a5550', life: 2 });
  }
  /** Puts a fire out. */
  function extinguish(target) {
    const e = typeof target === 'string' ? G().entity(target) || G().find(target) : target;
    if (!e || !burning.has(e)) return false;
    if (e.sceneId) outAction({ id: e.sceneId }); else extinguishLocal(e);
    return true;
  }
  function runFire(dt) {
    for (const [e, b] of [...burning]) {
      if (!e.alive || e.dead || !e.visible) { extinguishLocal(e); continue; }
      b.t += dt; b.tick -= dt; b.spread -= dt;
      // Charred: darker the longer it burns (its own material only).
      if (e._mat && e._mat.diffuseColor && !e._sharedMat && b.char < 0.7) { b.char += dt * 0.08; e._mat.diffuseColor = B.Color3.Lerp(e._mat.diffuseColor, new B.Color3(0.08, 0.06, 0.05), dt * 0.08); }
      if (b.light) b.light.intensity = 0.9 + Math.random() * 0.6;
      if (H.water && H.water.inWater && safeWater(e)) { extinguish(e); continue; }
      if (!mine(e)) continue;
      // Damage over time (things with health burn down), and explosives go off.
      if (b.tick <= 0) { b.tick = 0.5; if (e.hp !== undefined) G().damage(e, 4, null); }
      if (e.data && (e.data.explosive || e.data.barrel) && b.t > 2.2) { blowUp(e); continue; }
      if (cfg.spread && b.spread <= 0) {
        // Things close by heat up and catch (the closer, the sooner): about a second and a half next to a fire.
        b.spread = 0.4;
        const r = Math.max(...e.half) + 0.9;
        for (const o of H.physics.overlap(H.physics.shapes.sphere(r), [e.x, e.y, e.z], { ignore: e })) {
          if (burning.has(o) || !flammable(o)) continue;
          const gap = Math.max(0, o.distanceTo(e) - Math.max(...e.half) - Math.max(...o.half));
          o._heat = (o._heat || 0) + 0.4 * (1.2 - Math.min(1, gap)) * (0.8 + Math.random() * 0.4);
          if (o._heat >= 1.5) { o._heat = 0; ignite(o); }
        }
      }
      if (b.t > b.life) extinguish(e);
    }
  }

  // ------------------------------------------------------------------ creatures run (Living things does the running)
  function panic(e, from) {
    if (!e || !e.alive || e.remote || !e.living || !H.living || !H.living.startle) return;
    const p = vec(from);
    H.living.startle(p, { radius: Math.hypot(e.x - p[0], e.z - p[2]) + 1, strength: 1 });
  }

  // ------------------------------------------------------------------ spawning many things
  const spawned = new Set();
  // Words that mean animals beyond Living things' own (its species and their other words are asked of it).
  const ANIMALS = ['animal', 'creature', 'critter', 'beast', 'pet', 'blob'];
  const isAnimal = (w) => ANIMALS.includes(w) || Boolean(H.living && H.living.species && H.living.species.name(w));
  const SINGULAR = { sheep: 'sheep', mice: 'mouse', geese: 'goose', boxes: 'box', wolves: 'wolf', puppies: 'puppy', bunnies: 'bunny', kitties: 'kitten', ponies: 'pony', dinos: 'dino', cubes: 'cube', fish: 'fish' };
  const single = (w) => SINGULAR[w] || (w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.endsWith('es') && /(ss|x|ch|sh)es$/.test(w) ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const COLORS = ['#e04f5f', '#f4a340', '#f4d35e', '#5fbf6a', '#4a9eff', '#a974e8', '#e86fb5', '#55d6c2'];
  /** What a word means as a scene spec: a kind ("barrel"), an animal ("cow"), an asset ("tree.glb"), a shape, or a
   *  stand-in block named after it. Objects pass through (a scene spec). */
  function specFor(what, o = {}) {
    if (what && typeof what === 'object') {
      const s = JSON.parse(JSON.stringify(what));
      if (!s.type) s.type = 'box';
      if (!s.physics && ['box', 'sphere', 'cylinder', 'cone', 'capsule', 'model'].includes(s.type)) s.physics = 'dynamic';
      return s;
    }
    const raw = String(what || 'box').trim();
    // An asset by its exact name ("tree.glb"), or a word with a model ("cow" -> cow.glb).
    const word = single(raw.toLowerCase().replace(/\.glb$/, '').replace(/[^a-z0-9 _-]/g, '').trim()) || 'box';
    // A model the game has: by id or name ("a_12", "tree.glb"), or for the word (H.assets: "tree" finds every tree).
    const glb = (H.assets.get(raw) && H.assets.get(raw).type === 'model' ? H.assets.idOf(raw) : null) || H.assets.pick(word, { kind: 'model' });
    const size = Number(o.size) || 0;
    if ((isAnimal(word) || isAnimal(raw.toLowerCase())) && H.kinds.has('creature')) {
      // Animals are Living things' creatures (they graze, flee, tumble when blown up and get back up).
      const species = ANIMALS.includes(word) ? 'cow' : H.living.species.name(word) || word;
      return { type: 'creature', name: cap(species), shape: { species, ...(size ? { size } : {}) }, physics: 'dynamic' };
    }
    if (glb) return { type: 'model', name: cap(word), shape: { asset: glb, size: size || 1.5, word: H.assets.get(raw) ? null : word }, physics: 'dynamic' };
    const alias = { ball: 'sphere', cube: 'box', block: 'box', bomb: 'barrel', explosive: 'barrel', tnt: 'barrel', pillar: 'cylinder', can: 'cylinder', crates: 'crate' }[word] || word;
    const color = COLORS[M.hashSeed(word) % COLORS.length];
    if (alias === 'sphere') return { type: 'sphere', name: 'Ball', shape: { radius: size ? size / 2 : 0.4 }, material: { color }, physics: 'dynamic', body: { bounce: 0.6 } };
    if (alias === 'box') return { type: 'box', name: 'Block', shape: { size: size || 0.8 }, material: { color }, physics: 'dynamic' };
    if (['cylinder', 'cone', 'capsule', 'torus'].includes(alias)) return { type: alias, name: cap(alias), material: { color }, physics: 'dynamic' };
    if (H.kinds.has(alias)) return { type: alias, name: cap(alias), ...(size ? { shape: { size } } : {}) };
    // Anything else: a block with its name on the spec (and its model as soon as one exists: ask for "<word>.glb").
    return { type: 'box', name: cap(word), shape: { size: size || 0.9 }, material: { color }, physics: 'dynamic', data: { standIn: word } };
  }
  const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

  /** In front of the player, on the ground. */
  function inFront(dist = 8) {
    const p = W() && W().player;
    const cam = W() && W().scene.activeCamera;
    if (!p) return [0, 0, 0];
    let dir = { x: p.forward.x, z: p.forward.z };
    if (cam) { const d = cam.getDirection(B.Axis.Z); const l = Math.hypot(d.x, d.z) || 1; dir = { x: d.x / l, z: d.z / l }; }
    return [p.x + dir.x * dist, p.bottom, p.z + dir.z * dist];
  }
  function groundAt(x, z, fromY) {
    const t = H.terrain && H.terrain.heightAt ? (() => { try { return H.terrain.heightAt(x, z); } catch { return null; } })() : null;
    // The ground: things that stay put (not other things just spawned, not the player).
    const ray = new B.Ray(new B.Vector3(x, fromY, z), new B.Vector3(0, -1, 0), 200);
    const hit = W().scene.pickWithRay(ray, (m) => { const en = H.entityOf(m); return Boolean(en && en.alive && en.solid && en.physics !== 'dynamic' && !en.isPlayer && m.isEnabled() && !(m.metadata && m.metadata.decor)); });
    const y = hit && hit.hit ? hit.pickedPoint.y : null;
    if (t !== null && t !== undefined && isFinite(t)) return y === null ? t : Math.max(t, y);
    return y;
  }
  let built = null;
  const spawnAction = H.sync.action('mayhem:spawn', (d) => { built = runSpawn(d); });
  function runSpawn(d) {
    const g = G(), w = W();
    if (!g || !w) return [];
    const at = vec(d.at);
    const base = d.spec;
    const lift = (() => { try { return H.kinds.lift(base) || 0.5; } catch { return 0.5; } })();
    const size = Math.max(0.3, lift * 2);
    const offs = M.layout(d.n, { ...d.o, size: d.o.size || size, seed: M.hashSeed(d.id) });
    const out = [];
    const shadowBudget = Math.max(0, 30 - spawned.size);
    const isOnline = online();
    for (let i = 0; i < offs.length; i++) {
      const spec = JSON.parse(JSON.stringify(base));
      spec.id = `${d.id}~${i}`;
      // A model for a word: each one picks its variant (by its id: the same for everyone), and its spec keeps the id.
      if (spec.type === 'model' && spec.shape && spec.shape.word) spec.shape.asset = H.assets.pick(spec.shape.word, { kind: 'model', seed: spec.id }) || spec.shape.asset;
      const off = offs[i];
      const x = at[0] + off[0], z = at[2] + off[2];
      let y;
      if (d.o.pattern === 'rain') y = at[1] + off[1] + (d.o.height || 0);
      else if (d.o.pattern === 'pile' || d.o.pattern === 'stack') y = at[1] + off[1] + lift + 0.05;
      else if (d.o.ground === false) y = at[1] + off[1]; // exactly there (thrown things)
      else { const gy = groundAt(x, z, at[1] + 4); y = (gy === null ? at[1] : gy) + lift + 0.05 + off[1]; }
      spec.transform = { ...(spec.transform || {}), position: r2v([x, y, z]), rotation: [0, Math.round(((M.hashSeed(spec.id) % 360) + 360) % 360), 0] };
      if (i >= shadowBudget) spec.shadow = false;
      let e;
      try { e = H.fromSpec(spec); } catch (err) { H.report(err, 'mayhem spawn'); break; }
      e.temporary = true;
      e.spawned = true;
      // Who moves it: whoever threw it (grenades), or the host; everyone else follows what they send.
      e.remote = isOnline && (d.owner ? d.owner !== me() : !H.sync.isHost);
      if (d.v) launch(e, d.v);
      if (d.data) Object.assign(e.data, JSON.parse(JSON.stringify(d.data)));
      spawned.add(e);
      e.onDestroy(() => spawned.delete(e));
      out.push(e);
    }
    // The Overseer brings them in (H.arrive: dropped from the sky, grown, beamed); without it, a pop.
    const arriving = Boolean(out.length && H.arrive && H.arrive.spawned(out, d));
    if (!arriving && d.fx !== false && out.length) {
      const pts = out.length > 24 ? out.filter((_, i) => i % Math.ceil(out.length / 24) === 0) : out;
      for (const e of pts) g.burst([e.x, e.y, e.z], { color: '#c8f0ff', count: q(10), speed: 2.5, size: 0.25, life: 0.5 });
      sound('pop', { at: out[0].position });
    }
    if (d.owner && d.owner === me()) for (const e of out) H.sync.claim(e);
    g.emit('spawned', { things: out, what: base.type, count: out.length });
    return out;
  }
  /** Makes `count` of something at once: a kind or a word ("cow", "barrel", "crate", "ball"), an asset name
   *  ("tree.glb"), or a scene spec ({ type, shape, material, ... }). opts: { at ([x, y, z]; default in front of you),
   *  area (radius, or [width, depth]), pattern ('scatter' | 'grid' | 'circle' | 'line' | 'pile' | 'stack' | 'rain'),
   *  spacing, size, height (rain: how high), velocity, owner (who simulates them: H.sync.me), data, arrive ('drop',
   *  'grow', 'beam', 'none', or { how, delay, gap }: how the Overseer brings them; by default by what they are) }.
   *  Online, everyone gets the same things (the host moves them). Returns them. */
  function spawnMany(what, count = 10, o = {}) {
    const g = G();
    if (!g || !W()) return [];
    const room = Math.max(0, (cfg.maxSpawn || 400) - spawned.size);
    let n = Math.max(0, Math.floor(Number(count) || 0));
    if (n > room) {
      // Over the budget: the oldest spawned things make room, up to half of them; then it spawns fewer.
      const old = [...spawned].slice(0, Math.min(spawned.size, Math.floor((cfg.maxSpawn || 400) / 2), n - room));
      for (const e of old) e.destroy();
      const room2 = Math.max(0, (cfg.maxSpawn || 400) - spawned.size);
      if (n > room2) { g.ui.message(`Spawned ${room2} (at most ${cfg.maxSpawn} at once)`, 2); n = room2; }
    }
    if (!n) return [];
    const spec = specFor(what, o);
    const at = o.at ? posOf(o.at) : inFront(Math.min(18, 5 + Math.sqrt(n) * 1.2));
    const d = {
      id: `mh${Math.random().toString(36).slice(2, 8)}`,
      spec, n,
      at: r2v(at),
      o: { area: o.area ?? null, pattern: o.pattern || 'scatter', spacing: o.spacing || null, size: o.size || null, height: o.height || null, ground: o.ground },
      v: o.velocity ? r2v(vec(o.velocity)) : null,
      owner: o.owner || null,
      data: o.data || null,
      fx: o.effects !== false,
      arrive: o.arrive || null,
    };
    built = null;
    spawnAction(d);
    const out = built || [];
    built = null;
    return out;
  }
  const clearAction = H.sync.action('mayhem:clear', () => { for (const e of [...spawned]) e.destroy(); for (const p of [...debris]) if (p.alive) p.destroy(); debris.length = 0; });

  /** Sends a thing flying (the engine keeps a velocity set while its body is being made). */
  function launch(e, v) { e.velocity = vec(v); }

  // ------------------------------------------------------------------ every step and frame
  H.hooks.step.push((dt) => { runKnock(dt); });
  H.physics.afterStep((dt) => {
    if (!W()) return;
    runTumble(dt);
    runFire(dt);
    runDebris();
    for (const f of H.mayhem.steps) try { f(dt); } catch (err) { H.report(err, 'mayhem'); }
  });
  H.hooks.frame.push((dt) => {
    if (!W()) return;
    runFx(dt);
    runSlowmo();
    watchFps(dt);
    for (const f of H.mayhem.frames) try { f(dt); } catch (err) { H.report(err, 'mayhem'); }
  });

  // A new world: forget the last one's fires and pieces; listen for deaths (barrels go off, crates break).
  H.hooks.world.push({
    enter() {
      const g = G();
      g.on('death', onDeath);
      score.total = 0; score.combo = 0;
      if (score.el) score.el.hidden = true;
      if (g.state) g.state.mayhem = 0;
    },
    leave() {
      clearFx();
      for (const [e, b] of burning) { if (b.ps) b.ps.dispose(); if (b.light) b.light.dispose(); void e; }
      burning.clear(); tumbling.clear(); spawned.clear(); watched.clear(); debris.length = 0;
      chunkSrc = null; slowmo = null; knock.t = 0;
      for (const f of H.mayhem.leaves) try { f(); } catch (err) { H.report(err, 'mayhem'); }
    },
  });

  // ------------------------------------------------------------------ the API
  H.mayhem = {
    explode, shatter, ignite, extinguish, tumble, spawnMany, specFor, slowMotion, sound, shake, flash, smoke, sparks,
    addScore, blowUp, panic, launch,
    clear: () => clearAction({}),
    isBurning: (e) => burning.has(e),
    flammable,
    get score() { return score.total; },
    get settings() { return cfg; },
    get quality() { return quality.level; },
    get spawned() { return [...spawned]; },
    get debris() { return debris.filter((p) => p.alive); },
    // For the tools and kinds files (and other modules): run every physics step / every frame / when a world ends.
    steps: [], frames: [], leaves: [],
    styles, inFront, groundAt,
    credit: () => { myMayhemAt = now(); },
  };

  // game.spawnMany / game.explode / game.mayhem for scripts (every new game object, before scripts run).
  H.hooks.game.push((g) => {
    g.mayhem = H.mayhem;
    if (!g.spawnMany) g.spawnMany = (what, count, o) => spawnMany(what, count, o);
    if (!g.explode) g.explode = (at, o) => explode(at, o);
  });
})();
