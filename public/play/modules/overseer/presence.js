// The Overseer's sky presence: a soft face of light and aurora in the clouds toward the ship (docs/story.md,
// "The sky presence"). Soft billboard layers / a shader, never a hard mesh. It slowly turns its gaze to the player,
// brightens with the voice envelope, and plays distinct reactions (delight, interest, idle blink, awe, night squint).
// Each reaction asks H.reactions for a line of that kind. Exposes window.__overseerPresence for the playtest.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  if (!H || H.skyPresence) return;
  const B = BABYLON;
  const { clamp, num, smooth, PHONE } = H.sky._;
  const W = () => H.world;
  const G = () => H.game;

  const IDLE_AFTER = 30; // seconds of quiet before an idle blink (the brief)
  const REACT_GAP = 4; // seconds between voiced reactions of any kind
  const KINDS = ['delight', 'interest', 'idle', 'awe', 'night', 'rocket'];

  // ------------------------------------------------------------------ shader: soft face + aurora + cloud veil
  B.Effect.ShadersStore.hpSkyFaceVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUV;
void main(void) {
  vUV = uv;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}`;
  B.Effect.ShadersStore.hpSkyFaceFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform float time;
uniform float speak;   // 0..1 voice envelope
uniform float pulse;   // reaction intensity
uniform float blink;   // 0 open .. 1 closed
uniform float squint;  // night
uniform float widen;   // delight flare
uniform float rocket;  // rocket boarding: vertical shaft pulse
uniform float lean;    // interest: gaze lean toward the catch
uniform float awe;     // first-build soft swell
uniform vec2 gaze;     // -1..1 pupil offset
uniform float alpha;   // cinematic fade
uniform float night;   // 0 day .. 1 night
uniform float phone;   // 1 = cheaper

float soft(float d, float soft) { return 1.0 - smoothstep(0.0, soft, d); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main(void) {
  vec2 uv = vUV * 2.0 - 1.0;
  float r = length(uv);
  // Soft cloud veil in front (sits "behind" wisps): holes of lower alpha.
  float clouds = 0.0;
  if (phone < 0.5) {
    clouds = 0.35 * soft(abs(sin((uv.x + time * 0.02) * 3.1) * 0.55 + uv.y * 0.8 - 0.15), 0.55)
           + 0.25 * soft(abs(sin((uv.x * 0.7 - time * 0.015) * 5.0) * 0.4 + uv.y * 1.1 + 0.2), 0.4);
  } else {
    clouds = 0.3 * soft(abs(uv.y * 0.9 + sin(uv.x * 2.5 + time * 0.02) * 0.25 - 0.1), 0.5);
  }
  // Aurora halo (ellipse, slightly taller).
  vec2 face = uv * vec2(1.0, 1.15);
  float faceR = length(face);
  float disc = soft(faceR, 0.95) * soft(max(0.0, faceR - 0.15), 0.85);
  float glow = soft(faceR, 1.35) * (0.35 + 0.25 * speak + 0.3 * pulse + 0.2 * awe);
  // Soft eyes: two luminous points that gaze.
  float eyeY = 0.12 - squint * 0.08;
  float eyeSep = 0.22 * (1.0 + 0.35 * widen);
  vec2 g = gaze * 0.12 + vec2(lean * 0.08, lean * 0.04);
  // Rocket: a thin vertical shaft of light through the face (distinct from delight's widen).
  float shaft = soft(abs(uv.x) - 0.02, 0.04) * soft(abs(uv.y) - 0.55, 0.7) * rocket;
  vec2 left = vec2(uv.x + eyeSep, uv.y - eyeY) - g;
  vec2 right = vec2(uv.x - eyeSep, uv.y - eyeY) - g;
  float eyeOpen = 1.0 - blink;
  float lids = soft(abs(uv.y - eyeY) - (0.07 * eyeOpen * (1.0 - squint * 0.55)), 0.05);
  float eyes = (soft(length(left), 0.13) + soft(length(right), 0.13)) * lids * eyeOpen;
  float pupils = (soft(length(left), 0.04) + soft(length(right), 0.04)) * eyeOpen;
  // Mouth-soft crescent of light (amused when speaking / delight).
  float mouth = soft(abs(uv.y + 0.28 - speak * 0.02) + abs(uv.x) * 0.35 - 0.12 - 0.08 * widen, 0.08) * (0.35 + 0.55 * speak + 0.45 * widen);
  // Colour: pearl + cyan glow, warmer when speaking, cooler at night. Eyes stay bright so the face reads at island distance.
  vec3 pearl = mix(vec3(0.92, 0.95, 1.0), vec3(0.55, 0.78, 1.0), 0.45 + 0.3 * night);
  vec3 glowC = mix(vec3(0.55, 0.85, 1.0), vec3(0.35, 0.55, 1.0), night);
  vec3 col = pearl * disc * (0.55 + 0.25 * speak + 0.2 * awe)
           + glowC * glow
           + vec3(1.0, 0.99, 0.96) * eyes * (1.15 + 0.55 * speak + 0.35 * widen)
           + vec3(0.05, 0.12, 0.28) * pupils * 1.4
           + glowC * mouth
           + vec3(0.85, 0.95, 1.0) * shaft;
  float a = clamp(disc * 0.85 + glow * 0.55 + eyes * 0.9 + mouth * 0.5 + shaft * 0.7, 0.0, 1.0);
  a *= (1.0 - clouds * 0.55);
  a *= alpha;
  // Soft edge so it never reads as a hard mesh.
  a *= soft(faceR, 1.05);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

  let mesh = null, mat = null, root = null;
  let armed = false;
  let quiet = 0, lastReactAt = -1e9, lastIdleAt = -1e9, lastNight = false;
  let firstBuildDone = false;
  const react = { kind: null, t: 0, pulse: 0, widen: 0, rocket: 0, lean: 0, awe: 0, blink: 0, squint: 0 };
  const gaze = { x: 0, y: 0, tx: 0, ty: 0, target: [0, 0, 0] };
  const uniforms = { time: 0, speak: 0, pulse: 0, blink: 0, squint: 0, widen: 0, rocket: 0, lean: 0, awe: 0, gazeX: 0, gazeY: 0, alpha: 1, night: 0, phone: PHONE ? 1 : 0 };
  const state = {
    visible: false,
    onScreen: false,
    upperThird: false,
    gazeTarget: [0, 0, 0],
    gaze: { x: 0, y: 0 },
    lastReaction: null,
    speak: 0,
    alpha: 1,
    costMs: 0,
    kinds: KINDS.slice(),
  };

  function shipPos() {
    const cfg = H.lib && H.lib.effectiveConfig ? H.lib.effectiveConfig() : (W() && W().config) || {};
    const o = cfg.overseer;
    if (o && typeof o === 'object' && Array.isArray(o.position) && o.position.length === 3) {
      return [num(o.position[0], 9700), num(o.position[1], 4200), num(o.position[2], -3000)];
    }
    // Sandbox / default heading toward OVERSEER_AT.
    return [9700, 4200, -3000];
  }

  function make(scene) {
    if (mesh) return;
    const size = PHONE ? 5200 : 6400; // vast soft disc (angular size larger than the hull)
    root = new B.TransformNode('ov-sky-presence', scene);
    mesh = B.MeshBuilder.CreatePlane('ov-sky-face', { size, sideOrientation: B.Mesh.DOUBLESIDE }, scene);
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.receiveShadows = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
    mesh.metadata = { decor: true, noGlow: true, overseer: true, skyPresence: true };
    mat = new B.ShaderMaterial('ov-sky-face', scene, { vertex: 'hpSkyFace', fragment: 'hpSkyFace' }, {
      attributes: ['position', 'uv'],
      uniforms: ['world', 'viewProjection', 'time', 'speak', 'pulse', 'blink', 'squint', 'widen', 'rocket', 'lean', 'awe', 'gaze', 'alpha', 'night', 'phone'],
      needAlphaBlending: true,
    });
    mat.alphaMode = B.Engine.ALPHA_ADD;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mesh.material = mat;
    const U = () => uniforms;
    mat.onBindObservable.add(() => {
      const e = mat.getEffect(), u = U();
      if (!e || !u) return;
      e.setFloat('time', u.time);
      e.setFloat('speak', u.speak);
      e.setFloat('pulse', u.pulse);
      e.setFloat('blink', u.blink);
      e.setFloat('squint', u.squint);
      e.setFloat('widen', u.widen);
      e.setFloat('rocket', u.rocket);
      e.setFloat('lean', u.lean);
      e.setFloat('awe', u.awe);
      e.setFloat2('gaze', u.gazeX, u.gazeY);
      e.setFloat('alpha', u.alpha);
      e.setFloat('night', u.night);
      e.setFloat('phone', u.phone);
    });
    const bg = H.sky.bg;
    if (bg) bg.add(mesh, 2); // with the ship; soft layer reads as character in the sky
    place();
  }

  function place() {
    if (!root) return;
    const [x, y, z] = shipPos();
    // A little nearer than the hull centre so the face reads large in the upper sky.
    const cam = W() && W().scene && W().scene.activeCamera;
    if (cam) {
      const px = cam.globalPosition.x, py = cam.globalPosition.y, pz = cam.globalPosition.z;
      const dx = x - px, dy = y - py, dz = z - pz;
      const d = Math.hypot(dx, dy, dz) || 1;
      const k = 0.92; // slightly closer than the ship
      root.position.set(px + dx * k, py + dy * k, pz + dz * k);
    } else {
      root.position.set(x, y, z);
    }
  }

  function dispose() {
    const bg = H.sky && H.sky.bg;
    if (mesh && bg) try { bg.remove(mesh); } catch { /* fine */ }
    if (mesh) try { mesh.dispose(); } catch { /* fine */ }
    if (root) try { root.dispose(); } catch { /* fine */ }
    mesh = null; mat = null; root = null;
  }

  function cinematic() {
    // Keep the face visible for the Gift of Free Will tip-up (introPlaying): that beat is looking at the Overseer.
    // Fade only for other cinematics that frame it (share / game cinematic camera).
    try {
      const g = G();
      if (g && g.cinematic && (g.cinematic.playing || g.cinematic.isPlaying)) return true;
      if (H.share && H.share.cinematic && H.share.cinematic.playing) return true;
    } catch { /* fine */ }
    return false;
  }

  function speakEnv() {
    try {
      if (H.speech && H.speech.busy) return 1;
      if (H.speech && H.speech.current) return 1;
      const p = G() && G().overseer && G().overseer.presence ? G().overseer.presence() : null;
      if (p && p.speaking) return clamp(p.speaking, 0, 1);
    } catch { /* fine */ }
    return 0;
  }

  function screenSample() {
    const out = { onScreen: false, upperThird: false, nx: 0, ny: 0 };
    if (!root || !W() || !W().scene || !W().scene.activeCamera) return out;
    try {
      const cam = W().scene.activeCamera;
      const eng = W().scene.getEngine();
      const w = eng.getRenderWidth(), h = eng.getRenderHeight();
      if (!w || !h) return out;
      const p = B.Vector3.Project(root.position, B.Matrix.Identity(), cam.getTransformationMatrix(), cam.viewport.toGlobal(w, h));
      const nx = p.x / w, ny = p.y / h;
      out.nx = nx; out.ny = ny;
      out.onScreen = nx > 0.02 && nx < 0.98 && ny > 0.02 && ny < 0.98 && p.z > 0 && p.z < 1;
      // Upper third of the portrait frame (phone criterion).
      out.upperThird = out.onScreen && ny < 0.38;
    } catch { /* fine */ }
    return out;
  }

  function setGazeToward(px, py, pz) {
    gaze.target = [px, py, pz];
    state.gazeTarget = gaze.target;
    if (!root) return;
    const rx = root.position.x, ry = root.position.y, rz = root.position.z;
    const dx = px - rx, dy = py - ry, dz = pz - rz;
    const len = Math.hypot(dx, dy, dz) || 1;
    // Project into a soft local gaze (up = world up): horizontal and vertical angles.
    const horiz = Math.atan2(dx, dz);
    const vert = Math.asin(clamp(dy / len, -1, 1));
    // Face the camera already (billboard); gaze is a relative offset from "looking down at the island".
    const cam = W().scene.activeCamera;
    let wantX = 0, wantY = 0;
    if (cam) {
      const cx = cam.globalPosition.x - rx, cz = cam.globalPosition.z - rz;
      const faceYaw = Math.atan2(cx, cz);
      wantX = clamp((horiz - faceYaw) / (Math.PI * 0.35), -1, 1);
      wantY = clamp(vert / (Math.PI * 0.25), -1, 1);
    } else {
      wantX = clamp(horiz / (Math.PI * 0.5), -1, 1);
      wantY = clamp(vert / (Math.PI * 0.35), -1, 1);
    }
    gaze.tx = wantX; gaze.ty = wantY;
  }

  function fire(kind, opts = {}) {
    if (!KINDS.includes(kind) && kind !== 'idle') return false;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (!opts.force && now - lastReactAt < REACT_GAP) return false;
    lastReactAt = now;
    react.kind = kind;
    react.t = 0;
    react.pulse = 1;
    react.widen = kind === 'delight' ? 1 : 0;
    react.rocket = kind === 'rocket' ? 1 : 0;
    react.lean = kind === 'interest' ? 1 : 0;
    react.awe = kind === 'awe' ? 1 : 0;
    react.blink = kind === 'idle' ? 1 : 0;
    if (kind === 'night') react.squint = 1;
    if (kind === 'interest') { gaze.tx = clamp(gaze.tx + 0.35, -1, 1); gaze.ty = clamp(gaze.ty + 0.2, -1, 1); }
    state.lastReaction = { kind, at: now, text: null };
    // Ask the shuffled deck; rocket reuses delight's lines (same flare, distinct lastReaction kind).
    const sayKind = kind === 'rocket' ? 'delight' : kind;
    try {
      if (H.reactions && H.reactions.say) H.reactions.say(sayKind);
    } catch (err) { if (H.report) H.report(err, 'sky presence reaction'); }
    try {
      if (H.game) H.game.emit('sky-presence', { kind });
    } catch { /* fine */ }
    publish();
    return true;
  }

  function publish() {
    const scr = screenSample();
    state.visible = Boolean(mesh && mesh.isEnabled() && state.alpha > 0.08);
    state.onScreen = scr.onScreen;
    state.upperThird = scr.upperThird;
    state.gaze = { x: Math.round(gaze.x * 1000) / 1000, y: Math.round(gaze.y * 1000) / 1000 };
    state.speak = Math.round(speakEnv() * 1000) / 1000;
    window.__overseerPresence = {
      visible: state.visible && state.onScreen,
      onScreen: state.onScreen,
      upperThird: state.upperThird,
      gazeTarget: state.gazeTarget.slice(),
      gaze: { ...state.gaze },
      lastReaction: state.lastReaction ? { ...state.lastReaction } : null,
      speak: state.speak,
      alpha: Math.round(state.alpha * 1000) / 1000,
      costMs: state.costMs,
      kinds: state.kinds.slice(),
      react: { kind: react.kind, pulse: Math.round(react.pulse * 1000) / 1000, blink: Math.round(react.blink * 1000) / 1000, squint: Math.round(react.squint * 1000) / 1000 },
    };
  }

  function step(dt) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (!armed || !mesh || !mat) { state.costMs = 0; return; }
    place();
    const player = W() && W().player;
    if (player) setGazeToward(player.x, player.y + 1.4, player.z);
    // Slow gaze follow.
    gaze.x += (gaze.tx - gaze.x) * (1 - Math.exp(-dt * 1.6));
    gaze.y += (gaze.ty - gaze.y) * (1 - Math.exp(-dt * 1.6));

    const speaking = speakEnv();
    const active = speaking > 0.15 || react.pulse > 0.05 || (H.speech && H.speech.current);
    quiet = active ? 0 : quiet + dt;

    // Reaction envelopes decay.
    react.t += dt;
    react.pulse *= Math.exp(-dt * 1.4);
    react.widen *= Math.exp(-dt * 1.1);
    react.rocket *= Math.exp(-dt * 1.0);
    react.lean *= Math.exp(-dt * 0.9);
    react.awe *= Math.exp(-dt * 0.7);
    if (react.kind === 'idle') {
      // Slow blink then a short impatient flicker.
      const u = react.t;
      react.blink = u < 0.35 ? u / 0.35 : u < 0.7 ? 1 - (u - 0.35) / 0.35 : u < 1.1 ? 0.15 + 0.85 * Math.abs(Math.sin((u - 0.7) * 28)) : Math.max(0, react.blink - dt * 2);
    } else {
      react.blink = Math.max(0, react.blink - dt * 2);
    }
    // Night squint: sky day factor, or the lighting hour when the island clock does not drive the light.
    let day = H.sky ? H.sky.day : 1;
    try {
      const hour = H.lighting && typeof H.lighting.hour === 'number' ? H.lighting.hour
        : (H.sky && H.sky.hour);
      if (typeof hour === 'number' && (hour < 5.5 || hour > 20)) day = 0.12;
      else if (typeof hour === 'number' && (hour < 7 || hour > 18.5)) day = Math.min(day, 0.45);
    } catch { /* fine */ }
    const nightK = 1 - clamp((day - 0.12) / 0.88, 0, 1);
    const wantSquint = nightK > 0.55 ? 0.55 + 0.45 * nightK : nightK * 0.3;
    react.squint += (wantSquint - react.squint) * (1 - Math.exp(-dt * 0.8));
    if (nightK > 0.7 && !lastNight) {
      lastNight = true;
      fire('night');
    } else if (nightK < 0.35) lastNight = false;

    // Idle: blink + line after 30 s quiet.
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
    if (quiet >= IDLE_AFTER && now - lastIdleAt > 45) {
      lastIdleAt = now;
      fire('idle');
    }

    // Cinematic fade.
    const wantA = cinematic() ? 0 : 1;
    state.alpha += (wantA - state.alpha) * (1 - Math.exp(-dt * 2.2));

    uniforms.time = now;
    uniforms.speak = speaking;
    uniforms.pulse = clamp(react.pulse, 0, 1);
    uniforms.blink = clamp(react.blink, 0, 1);
    uniforms.squint = clamp(react.squint, 0, 1);
    uniforms.widen = clamp(react.widen, 0, 1);
    uniforms.rocket = clamp(react.rocket, 0, 1);
    uniforms.lean = clamp(react.lean, 0, 1);
    uniforms.awe = clamp(react.awe, 0, 1);
    uniforms.gazeX = gaze.x;
    uniforms.gazeY = gaze.y;
    uniforms.alpha = clamp(state.alpha, 0, 1);
    uniforms.night = nightK;
    uniforms.phone = PHONE ? 1 : 0;

    const t1 = typeof performance !== 'undefined' ? performance.now() : t0;
    state.costMs = Math.round((t1 - t0) * 100) / 100;
    publish();
  }

  H.hooks.world.push({
    enter(w) {
      armed = true;
      quiet = 0; lastReactAt = -1e9; lastIdleAt = -1e9; lastNight = false; firstBuildDone = false;
      try { make(w.scene); } catch (err) { if (H.report) H.report(err, 'sky presence'); }
      publish();
    },
    leave() { armed = false; dispose(); publish(); },
  });
  H.hooks.frame.push((dt) => { if (armed) try { step(dt); } catch (err) { if (H.report) H.report(err, 'sky presence step'); } });
  H.hooks.game.push((game) => {
    game.on('explosion', (ev) => {
      // Big blasts and barrel chains (share rule ~ radius 6+) read as delight.
      const r = ev && (ev.radius ?? ev.r);
      if (r !== undefined && r < 4) return;
      fire('delight');
    });
    game.on('catch', (d) => { if (!d || d.mine !== false) fire('interest'); });
    game.on('workEnd', (d) => {
      if (!d || d.ok === false) return;
      if (!firstBuildDone && (d.ops > 0 || d.beats > 0)) {
        firstBuildDone = true;
        fire('awe', { force: true });
      }
    });
    game.on('enter', (d) => {
      // Boarding the rocket: a distinct sky reaction (criteria: "the rocket").
      try {
        if (d && d.me === false) return;
        const e = d && d.vehicle;
        const id = e && (e.id || e.name || '');
        const kind = (e && (e.type || (e.data && (e.data.vehicle || e.data.kind)))) || '';
        if (/rocket/i.test(String(id)) || /rocket/i.test(String(kind))) fire('rocket');
      } catch { /* fine */ }
    });
  });

  H.skyPresence = {
    IDLE_AFTER, REACT_GAP, KINDS,
    fire,
    sample: () => ({ ...window.__overseerPresence }),
    get state() { return state; },
  };
  // Seed the playtest hook immediately.
  window.__overseerPresence = {
    visible: false, onScreen: false, upperThird: false, gazeTarget: [0, 0, 0], gaze: { x: 0, y: 0 },
    lastReaction: null, speak: 0, alpha: 1, costMs: 0, kinds: KINDS.slice(), react: { kind: null, pulse: 0, blink: 0, squint: 0 },
  };
})();
