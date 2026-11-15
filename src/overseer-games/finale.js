// The end of Chapter One (docs/story.md "5c. The finale"): Rolo's rocket settles on the pad in the Overseer's hangar and the
// chapter closes as a set piece, in the engine, with the cinematic camera: (1) the back wall's doors grind open and light
// spills across the floor, the music swells; (2) the six neighbours are beamed in at the door, walk to the player and each
// says one line in their own recorded voice; (3) the Overseer pays off the opening hook (free will, "a shoe will do");
// (4) CONTROL COMES BACK and the player makes the last move themselves (a big "Light the sky" button, or E): the Overseer's
// first ask of their free will; (5) fireworks, then "Chapter One complete" on the letterbox; (6) a five-second tease: a lamp
// lit on the far shore that the Overseer did not light. Every shot skips with one tap; the playable part does not.
// Kept once per device (localStorage `hg_chapter_one`); the journal has a replay. Playtest `chapter-one-finale`.
(function () {
  const H = window.HawkesPlay;
  const KEY = 'hg_chapter_one';
  let B = window.BABYLON; // (read again when it plays: the engine may load after this script)
  const isDone = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return Boolean(window.__chapterOneDone); } };
  const setDone = () => { window.__chapterOneDone = true; try { localStorage.setItem(KEY, '1'); } catch { /* kept for this visit */ } };
  const OV = () => H && H.overseer;
  const cin = () => game.cinematic;

  // ------------------------------------------------------------------ the lines (each has a recording: public/play/audio/voice)
  const LINES = {
    welcome: ['overseer', 'The Overseer', 'You came. Good. Come in.'],
    pip: ['pip', 'Pip', 'Huh! That is a lot of floor. Hi, Floor!'],
    bobbin: ['bobbin', 'Admiral Bobbin', 'Carry on. That is an order. It is also a suggestion.'],
    ember: ['ember', 'Mrs Ember', 'Dear, I brought you a letter. It says: well done. It has no sender. Sorry.'],
    rolo: ['rolo', 'Rolo', 'huh. you parked it. nicely. one wobble. that is fine.'],
    dolores: ['dolores', 'Dolores', 'I came up. I was not waiting. The view is fine.'],
    channel: ['channel', 'Channel', 'Breaking: a hangar, a crowd, and the new one. Ratings: record.'],
    payoff: ['overseer', 'The Overseer', 'I gave you free will, and told you a shoe would do. It would have. You did better.'],
    ask: ['overseer', 'The Overseer', 'Now, one thing. Free will is only the next thing, and it is yours. Light the sky.'],
    thanks: ['overseer', 'The Overseer', 'Thank you for coming. That is all of the first part.'],
    tease: ['overseer', 'The Overseer', 'I did not light that one.'],
  };
  const COLORS = { overseer: '#e5d9b8', pip: '#f9a8d4', bobbin: '#facc15', ember: '#fb923c', rolo: '#22d3ee', dolores: '#4ade80', channel: '#7dd3fc' };
  const CAST_IDS = { bobbin: 'Admiral Bobbin', ember: 'Mrs Ember', rolo: 'Rolo', dolores: 'Dolores', channel: 'Channel' };

  // ------------------------------------------------------------------ small tools
  const wait = (s) => new Promise((r) => game.after(s, r));
  const finale = (window.__finale = Object.assign(window.__finale || {}, { running: false, log: [] }));
  let run = 0; // the run in charge: a stale run's timers do nothing
  const emit = (name, d) => { finale.log.push({ name, t: Math.round(performance.now()), ...(d || {}) }); try { game.emit(name, d || {}); } catch { /* fine */ } };
  const touch = () => Boolean(H && H.touchUi);

  // The caption, inside the letterbox (its own element: the engine's chat and HUD are hidden during a shot). Bottom centre,
  // one or two lines, fits a 390 px portrait screen; on a landscape letterbox it sits in the lower bar.
  let capEl = null;
  function caption(who, text) {
    if (!capEl) {
      const st = document.createElement('style');
      st.textContent = [
        '.fn-cap{position:fixed;left:50%;transform:translateX(-50%);bottom:max(14px,env(safe-area-inset-bottom));z-index:9000;width:min(760px,calc(100vw - 24px));display:flex;align-items:flex-end;justify-content:center;gap:10px;text-align:left;pointer-events:none;opacity:0;transition:opacity .35s;color:#fff;font:600 clamp(15px,2.4vw,24px)/1.3 system-ui,sans-serif;text-shadow:0 2px 10px #000,0 0 3px #000}',
        '.fn-cap.on{opacity:1}.fn-cap .fn-words{flex:1;min-width:0;max-width:36em}.fn-cap b{display:block;font:800 clamp(10px,1.4vw,13px)/1.2 system-ui,sans-serif;letter-spacing:.16em;text-transform:uppercase;margin-bottom:3px}',
        '.fn-cap .hc-port{flex:none;width:64px;height:64px;border-radius:12px;object-fit:cover;box-shadow:0 0 0 2px rgba(255,255,255,.4)}',
        '@media (max-aspect-ratio:1/1){.fn-cap{padding:34px 8px 6px;background:linear-gradient(transparent,rgba(0,0,0,.72) 55%);width:100vw;bottom:0}.fn-cap .hc-port{width:72px;height:72px}}',
        '.fn-act{position:fixed;left:50%;transform:translateX(-50%);bottom:max(210px,calc(env(safe-area-inset-bottom) + 190px));z-index:9001;min-width:min(78vw,340px);min-height:68px;padding:12px 26px;border-radius:40px;border:2px solid #fff4c4;background:linear-gradient(#ffd84a,#f59e0b);color:#2a1a00;font:800 clamp(20px,4vw,26px)/1.1 system-ui,sans-serif;letter-spacing:.03em;box-shadow:0 0 36px rgba(255,216,74,.7),0 6px 18px rgba(0,0,0,.5);cursor:pointer;touch-action:manipulation;animation:fn-pulse 1.4s ease-in-out infinite}',
        '.fn-act[hidden]{display:none}.fn-act small{display:block;font:600 12px system-ui,sans-serif;opacity:.7;margin-top:2px}',
        '@keyframes fn-pulse{50%{transform:translateX(-50%) scale(1.05)}}',
        '@media (prefers-reduced-motion:reduce){.fn-act{animation:none}}',
      ].join('\n');
      document.head.appendChild(st);
      capEl = document.createElement('div');
      capEl.className = 'fn-cap';
      capEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(capEl);
    }
    if (!text) { capEl.classList.remove('on'); return; }
    capEl.innerHTML = '';
    const words = document.createElement('span'); words.className = 'fn-words';
    const b = document.createElement('b'); b.textContent = who;
    const c = (H && H.portraits && H.portraits.color(who)) || COLORS[String(who).toLowerCase()] || '#e5d9b8';
    b.style.color = c;
    words.appendChild(b); words.appendChild(document.createTextNode(text));
    capEl.appendChild(words);
    try { if (H && H.portraits) H.portraits.attach(capEl, who, { mood: 'emotion', color: c }); } catch { /* words only */ }
    capEl.classList.add('on');
  }

  // Sound: low rumble for the doors, chords for the swell, a dark drone for the tease. All through the engine's buses.
  function out() { return H && H.audio && (H.audio.background || H.audio.effects || H.audio.master); }
  function tone(notes, { seconds = 4, gain = 0.1, type = 'sine', attack = 1.2, detune = 0 } = {}) {
    try {
      const ac = H.audio.context;
      if (!ac || ac.state !== 'running') return;
      const t0 = ac.currentTime, g = ac.createGain();
      g.gain.value = 0.0001; g.connect(out());
      g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
      for (const f of notes) { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = detune; o.connect(g); o.start(t0); o.stop(t0 + seconds + 0.1); }
    } catch { /* quiet */ }
  }
  function rumble(seconds = 3.2) {
    try {
      const ac = H.audio.context;
      if (!ac || ac.state !== 'running') return;
      const n = Math.floor(ac.sampleRate * seconds), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * i / n);
      const s = ac.createBufferSource(); s.buffer = buf;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 110;
      const g = ac.createGain(); g.gain.value = 0.9;
      s.connect(lp); lp.connect(g); g.connect(H.audio.effects || H.audio.master); s.start();
    } catch { /* quiet */ }
  }
  const sfx = (n, v = 0.5) => { try { if (game.hasAsset(n)) game.sound(n, { volume: v }); } catch { /* quiet */ } };
  // The island's chord (D major, rising) and the dark motif (a low minor second under a held fifth).
  const swell = () => { tone([146.83, 220, 293.66, 369.99], { seconds: 6, gain: 0.12, attack: 2.2 }); tone([587.33, 739.99], { seconds: 5, gain: 0.04, attack: 2.6 }); };
  const dark = () => { tone([55, 58.27], { seconds: 6.5, gain: 0.16, attack: 1.4, type: 'sawtooth' }); tone([82.41, 233.08], { seconds: 6, gain: 0.05, attack: 2, type: 'triangle' }); };

  // ------------------------------------------------------------------ the hangar's doors, light, and the far lamp
  const ticks = [];
  let tickHooked = false;
  function tick(seconds, fn) {
    if (!tickHooked && H.hooks && H.hooks.frame) { tickHooked = true; H.hooks.frame.push((dt) => { for (const k of ticks.slice()) { k.t += Math.min(dt, 0.1); const u = Math.min(1, k.t / k.s); try { k.fn(u); } catch { k.t = 1e9; } if (u >= 1) ticks.splice(ticks.indexOf(k), 1); } }); }
    ticks.push({ s: seconds, t: 0, fn });
  }
  const set = { meshes: [], light: null, doors: null };
  function dispose() {
    for (const m of set.meshes.splice(0)) { try { m.dispose(); } catch { /* gone */ } }
    if (set.light) { try { set.light.dispose(); } catch { /* gone */ } set.light = null; }
    set.doors = null;
  }
  function emissive(name, mesh, rgb, alpha) {
    const m = new B.StandardMaterial(name, mesh.getScene());
    m.disableLighting = true; m.emissiveColor = new B.Color3(...rgb); m.alpha = alpha; m.alphaMode = B.Engine.ALPHA_ADD;
    try { m.disableDepthWrite = true; } catch { /* fine */ }
    mesh.material = m; mesh.isPickable = false; mesh.metadata = { decor: true };
    return m;
  }
  function buildDoors(bay) {
    dispose();
    const sc = H.world.scene, f = bay.f, par = bay.node;
    const w = 6.4, h = Math.min(11, f.top - f.floor - 2), z = f.back + 0.7, x0 = -f.halfW * 0.55;
    const mk = (name, size, pos) => { const m = B.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, sc); m.parent = par; m.position.set(pos[0], pos[1], pos[2]); m.isPickable = false; m.metadata = { decor: true }; set.meshes.push(m); return m; };
    const steel = new B.StandardMaterial('fn-door', sc); steel.diffuseColor = new B.Color3(0.32, 0.36, 0.44); steel.specularColor = new B.Color3(0.5, 0.5, 0.6);
    const L = mk('fn-door-l', [w, h, 0.7], [x0 - w / 2, f.floor + h / 2, z]);
    const R = mk('fn-door-r', [w, h, 0.7], [x0 + w / 2, f.floor + h / 2, z]);
    L.material = steel; R.material = steel;
    const glow = mk('fn-glow', [w * 2, h, 0.05], [x0, f.floor + h / 2, f.back + 0.35]);
    const gm = emissive('fn-glow', glow, [1, 0.9, 0.62], 0);
    const spill = B.MeshBuilder.CreateGround('fn-spill', { width: w * 1.7, height: 22 }, sc);
    spill.parent = par; spill.position.set(x0, f.floor + 0.07, f.back + 11 + 0.7); set.meshes.push(spill);
    const sm = emissive('fn-spill', spill, [1, 0.85, 0.5], 0);
    const light = new B.PointLight('fn-light', new B.Vector3(0, 0, 0), sc);
    light.parent = par; light.position = new B.Vector3(x0, f.floor + 4, f.back + 5); light.diffuse = new B.Color3(1, 0.88, 0.55); light.range = 60; light.intensity = 0;
    set.light = light;
    set.doors = { L, R, x0, w, gm, sm, light, zWall: f.back, floor: f.floor };
    return set.doors;
  }
  function openDoors(seconds = 3.4) {
    const d = set.doors;
    if (!d) return;
    rumble(seconds); sfx('teleport.mp3', 0.4);
    tick(seconds, (u) => {
      const e = u * u * (3 - 2 * u);
      d.L.position.x = d.x0 - d.w / 2 - e * d.w; d.R.position.x = d.x0 + d.w / 2 + e * d.w;
      d.gm.alpha = 0.85 * e; d.sm.alpha = 0.4 * e; d.light.intensity = 3.2 * e;
      if (u > 0.35 && u < 0.4) try { game.camera.shake(0.05, 0.4); } catch { /* fine */ }
    });
  }
  const doorsOpenNow = () => { const d = set.doors; if (d) { d.L.position.x = d.x0 - d.w * 1.5; d.R.position.x = d.x0 + d.w * 1.5; d.gm.alpha = 0.85; d.sm.alpha = 0.4; d.light.intensity = 3.2; } };

  // The lamp on the far shore: a pale amber point that blinks twice, with a thin column of light. In the far distance, low.
  let lamp = null;
  function lightLamp(bay) {
    const sc = H.world.scene, f = bay.f;
    const pos = [f.halfW * 0.25, f.floor - 150, f.front + 1500];
    const a = B.MeshBuilder.CreateSphere('fn-lamp', { diameter: 26, segments: 10 }, sc), c = B.MeshBuilder.CreateCylinder('fn-lamp-col', { diameter: 4, height: 190, tessellation: 10 }, sc);
    for (const m of [a, c]) { m.parent = bay.node; m.position.set(pos[0], pos[1] + (m === c ? 95 : 0), pos[2]); set.meshes.push(m); }
    const am = emissive('fn-lamp', a, [1, 0.8, 0.4], 0), cm = emissive('fn-lamp-col', c, [1, 0.8, 0.45], 0);
    lamp = { a, c, am, cm, at: pos };
    tick(5.2, (u) => {
      const blink = u < 0.62 ? (Math.sin(u / 0.62 * Math.PI * 4) > 0.2 ? 0.55 : 0.12) : 0.8;
      const rise = Math.min(1, u / 0.3);
      am.alpha = blink * rise; cm.alpha = 0.5 * rise * (u > 0.62 ? 1 : 0.4);
    });
    return lamp;
  }

  // ------------------------------------------------------------------ people
  const peopleSpots = (bay) => {
    const f = bay.f, z = f.padZ + 6;
    return { pip: [3, z + 3.5], bobbin: [11, z + 3.5], ember: [-1, z + 0.5], rolo: [14.5, z + 0.5], dolores: [5, z + 7], channel: [9.5, z + 7] };
  };
  const cast = () => {
    const out = [];
    const pip = game.all('Pip')[0];
    if (pip) out.push(['pip', pip]);
    for (const [id] of Object.entries(CAST_IDS)) { const e = game.find && game.find(id); if (e && e.alive) out.push([id, e]); }
    return out;
  };
  const saved = new Map();
  function arrive(bay, id, e, instant) {
    const f = bay.f, spot = peopleSpots(bay)[id], d = set.doors;
    if (!saved.has(id)) saved.set(id, [e.x, e.y, e.z]);
    const to = bay.at(spot[0], f.floor + 1.1, spot[1]);
    const from = bay.at(d ? d.x0 : 0, f.floor + 1.1, f.back + 4);
    try {
      if (!instant) { e.position = from; e.velocity = [0, 0, 0]; const O = OV(); if (O && O.beam) O.beam(e, { radius: 1.6, seconds: 1.2 }); game.burst(from, { color: '#fff4c4', count: 22, speed: 3, size: 0.14 }); }
      if (instant) { e.position = to; e.velocity = [0, 0, 0]; }
      else if (H.living && H.living.command) H.living.command(e, 'goto', { at: [to[0], to[2]], near: 1.2 });
      if (instant && H.living && H.living.command) H.living.command(e, 'stay');
    } catch { /* they are placed by the fallback below */ }
    // Whatever the walk did, they are there for the next beat.
    game.after(instant ? 0.1 : 7, () => { try { if (Math.hypot(e.x - to[0], e.z - to[2]) > 6) { e.position = to; e.velocity = [0, 0, 0]; } if (H.living && H.living.command) H.living.command(e, 'stay'); } catch { /* fine */ } });
  }
  function sendHome() {
    for (const [id, e] of cast()) {
      const was = saved.get(id);
      try { if (was) { e.position = was; e.velocity = [0, 0, 0]; } if (H.living && H.living.command) H.living.command(e, 'wander'); } catch { /* fine */ }
    }
    saved.clear();
  }

  // One line: the speaker's own bubble (the recorded clip), the chat, and the letterbox caption.
  function speak(key, entity, seconds) {
    const [voice, who, text] = LINES[key];
    const clip = (H.lib && H.lib.recordedLine && H.lib.recordedLine(voice, text)) || null;
    const s = seconds || Math.min(7, 2.4 + text.length / 16);
    caption(who, text);
    game.after(s + 0.4, () => { if (capEl && capEl.textContent.endsWith(text)) caption(null); });
    if (voice === 'overseer') { try { game.overseer.say(text, s); } catch { /* the caption stands */ } }
    else if (entity && entity.say) { try { if (entity.lookAt && game.player) entity.lookAt(game.player); entity.say(text, s); } catch { /* the caption stands */ } }
    if (H.chat && H.chat.line && voice !== 'overseer') { try { H.chat.line({ kind: 'npc', who, text, color: COLORS[voice], keep: 12 }); } catch { /* fine */ } }
    emit('finale-line', { who, text, clip });
    return s;
  }

  // ------------------------------------------------------------------ the shots
  const landscape = () => window.innerWidth >= window.innerHeight;
  const shot = async (keys, seconds, o = {}) => {
    const c = cin();
    if (!c || !c.path) return { skipped: true };
    try { return await c.path(keys, { seconds, fade: { in: o.fadeIn ?? 0.4, out: o.fadeOut ?? 0.4 }, letterbox: landscape(), skippable: true, ease: 'inOut', title: o.title, subtitle: o.subtitle }); } catch (e) { try { H.report && H.report(e, 'finale-shot'); } catch { /* fine */ } return { skipped: true }; }
  };
  // A tap anywhere skips the shot that is playing (the Skip button is there too).
  if (!window.__finaleTap) {
    window.__finaleTap = true;
    window.addEventListener('pointerdown', (e) => { const c = cin(); if (c && c.playing && c.playing.skippable && finale.running && !(e.target && e.target.closest && e.target.closest('.fn-act'))) { emit('finale-skip', { by: 'tap' }); c.skip(); } }, true);
  }

  let actEl = null, actDone = null;
  function showAct(onDone) {
    if (!actEl) {
      actEl = document.createElement('button');
      actEl.type = 'button'; actEl.className = 'fn-act'; actEl.hidden = true;
      actEl.innerHTML = 'Light the sky<small></small>';
      document.body.appendChild(actEl);
    }
    actEl.querySelector('small').textContent = touch() ? 'tap' : 'click, or press E';
    actEl.hidden = false;
    actDone = onDone;
    actEl.onclick = (e) => { e.stopPropagation(); press('button'); };
    actEl.onpointerup = (e) => { e.stopPropagation(); press(e.pointerType === 'touch' ? 'tap' : 'button'); };
    if (!window.__finaleKey) { window.__finaleKey = (e) => { if ((e.key === 'e' || e.key === 'E' || e.key === 'Enter') && actDone) { e.preventDefault(); e.stopPropagation(); press('key'); } }; window.addEventListener('keydown', window.__finaleKey, true); }
  }
  function press(how) { const f = actDone; if (!f) return; actDone = null; actEl.hidden = true; f(how); }

  // ------------------------------------------------------------------ the whole set piece
  async function play(o = {}) {
    if (finale.running) return false;
    B = window.BABYLON;
    const O = OV(), bay = O && O.bay;
    if (!bay || !B || !H.world || !cin()) { emit('finale-unavailable', { why: 'no hangar or no camera' }); return false; }
    const my = ++run, alive = () => run === my;
    finale.running = true; finale.replay = Boolean(o.replay);
    emit('finale-start', { replay: Boolean(o.replay) });
    const t0 = performance.now();
    try {
      const f = bay.f, p = game.player, at = bay.at;
      // On foot beside the pad (the rocket is on it), doors built shut.
      try { if (H.vehicles && H.vehicles.current && H.vehicles.exit) H.vehicles.exit(true); } catch { /* on foot */ }
      if (p) { p.position = at(7, f.floor + 1.2, f.padZ + 6); p.velocity = [0, 0, 0]; }
      const d = buildDoors(bay), x0 = d.x0;
      const camA = (x, y, z) => at(x, f.floor + y, z);
      const spots = peopleSpots(bay);
      const cleanupShot = () => { caption(null); };

      // ---- 1. the doors
      const doorShot = shot([
        { pos: camA(x0 + 6, 3.2, f.padZ - 4), look: camA(x0, 4.5, f.back), at: 0 },
        { pos: camA(x0 + 3, 3.6, f.back + 16), look: camA(x0, 5, f.back), at: 4 },
        { pos: camA(x0 - 2, 2.6, f.back + 11), look: camA(x0, 4, f.back), at: 8 },
      ], 8.5, { fadeIn: 0.6 });
      game.after(0.8, () => { if (alive()) { openDoors(3.6); emit('finale-doors-open', {}); } });
      game.after(2.2, () => { if (alive()) swell(); });
      game.after(3.4, () => { if (alive()) speak('welcome', null, 3); });
      let r = await doorShot; cleanupShot();
      if (!alive()) return false;
      doorsOpenNow(); // (a skipped shot still ends with the doors open)

      // ---- 2. the neighbours gather and speak; 3. the Overseer's payoff
      const order = ['pip', 'bobbin', 'ember', 'rolo', 'dolores', 'channel'];
      const people = Object.fromEntries(cast());
      const gather = shot([
        { pos: camA(spots.channel[0] + 6, 2.4, spots.channel[1] + 9), look: camA(8, 1.8, spots.pip[1]), at: 0 },
        { pos: camA(14, 2.2, spots.channel[1] + 7), look: camA(7, 1.6, spots.pip[1] - 1), at: 12 },
        { pos: camA(-2, 2.4, spots.ember[1] + 8), look: camA(8, 2.2, spots.pip[1]), at: 24 },
      ], 27, { fadeIn: 0.3, fadeOut: 0.3 });
      let gone = false;
      order.forEach((id, i) => {
        const e = people[id]; if (!e) return;
        game.after(i * 2.8 + 0.3, () => { if (alive() && !gone) arrive(bay, id, e, false); });
        game.after(i * 2.8 + 2.4, () => { if (alive() && !gone) speak(id, e, 2.6); });
      });
      game.after(order.length * 2.8 + 2.2, () => { if (alive() && !gone) speak('payoff', null, 6.4); });
      r = await gather; gone = true; cleanupShot();
      if (!alive()) return false;
      for (const id of order) if (people[id]) arrive(bay, id, people[id], true); // (a skipped shot: everyone is simply there)

      // ---- 4. control returns: the player makes the last move
      emit('finale-control', { phase: 'gathered', ms: Math.round(performance.now() - t0) });
      speak('ask', null, 6.5);
      const pill = (() => { const m = B.MeshBuilder.CreateCylinder('fn-pillar', { diameter: 1.2, height: 14, tessellation: 16 }, H.world.scene); m.parent = bay.node; m.position.set(7, f.floor + 7, f.padZ + 11); set.meshes.push(m); emissive('fn-pillar', m, [1, 0.85, 0.4], 0.35); return m; })();
      const how = await new Promise((resolve) => {
        showAct((h) => resolve(h));
        game.after(32, () => { if (alive() && actDone) { try { game.overseer.say('Whenever you like. The sky is patient.', 4); } catch { /* fine */ } } });
      });
      if (!alive()) return false;
      emit('finale-input', { how, ms: Math.round(performance.now() - t0) });
      try { pill.dispose(); } catch { /* gone */ }

      // ---- 5. the sky lights; the title
      const sky = () => { const x = (Math.random() * 2 - 1) * f.halfW * 0.9, y = 14 + Math.random() * 30, z = f.front + 14 + Math.random() * 60; return at(x, f.floor + y, z); };
      const cols = ['#ffd84a', '#7dd3fc', '#f472b6', '#a7f3d0', '#fff4c4', '#fb923c'];
      sfx('victory.mp3', 0.6); swell();
      const show = shot([
        { pos: camA(7, 2, f.padZ + 5), look: camA(7, 22, f.front + 30), at: 0 },
        { pos: camA(5, 3.5, f.front - 18), look: camA(0, 30, f.front + 50), at: 6 },
        { pos: camA(2, 5, f.front + 4), look: camA(0, 32, f.front + 70), at: 10 },
      ], 10.5, { fadeIn: 0.25 });
      let fire = 0, over = false;
      const burstLoop = () => { if (!alive() || over || fire++ > 26) return; const c = sky(); game.burst(c, { color: cols[fire % cols.length], count: 90, speed: 13, size: 0.55 }); game.burst(c, { color: '#ffffff', count: 30, speed: 7, size: 0.3 }); sfx(fire % 2 ? 'power-up.mp3' : 'level-up.mp3', 0.28); game.after(0.4, burstLoop); };
      game.after(0.6, burstLoop);
      for (const id of order) if (people[id] && H.living && H.living.command) game.after(0.8, () => { try { H.living.command(people[id], 'cheer'); } catch { /* fine */ } });
      game.after(4, () => { if (alive() && !over) speak('thanks', null, 4.6); });
      await show; over = true; cleanupShot();
      if (!alive()) return false;

      emit('finale-title', { title: 'Chapter One complete' });
      swell();
      await shot([
        { pos: camA(7, 4, f.front - 4), look: camA(0, 30, f.front + 80), at: 0 },
        { pos: camA(7, 4.6, f.front - 2), look: camA(0, 30, f.front + 80), at: 4.5 },
      ], 4.5, { fadeIn: 0.8, fadeOut: 0.6, title: 'Chapter One complete', subtitle: 'What Are You?' });
      if (!alive()) return false;

      // ---- 6. the tease
      const l = lightLamp(bay);
      dark(); emit('finale-tease', { lamp: true });
      game.after(1.8, () => { if (alive()) speak('tease', null, 3); });
      await shot([
        { pos: camA(0, 3.5, f.front + 2), look: camA(f.halfW * 0.1, -20, f.front + 600), at: 0 },
        { pos: camA(0, 3.4, f.front + 3), look: l ? [bay.at(l.at[0], l.at[1], l.at[2])[0], bay.at(l.at[0], l.at[1], l.at[2])[1] + 20, bay.at(l.at[0], l.at[1], l.at[2])[2]] : camA(0, -10, f.front + 900), at: 5.2 },
      ], 5.4, { fadeIn: 0.5, fadeOut: 0.5 });
      if (!alive()) return false;
    } catch (e) { try { H.report && H.report(e, 'finale'); } catch { /* fine */ } }
    // ---- done: control is back at once
    run++; // (a stale run's timers do nothing)
    caption(null); sendHome(); dispose();
    try { const c = cin(); if (c && c.stop) c.stop(); } catch { /* fine */ }
    if (actEl) actEl.hidden = true; actDone = null;
    finale.running = false;
    if (!o.replay) setDone();
    emit('finale-control-returned', { ms: Math.round(performance.now() - t0), controls: !(game.player && game.player.controls === false) });
    emit('chapter-one-complete', { replay: Boolean(o.replay) });
    return true;
  }

  // ------------------------------------------------------------------ when it plays: the first docking after the rocket quest
  game.on('docked-pad', () => {
    if (isDone() || finale.running) return;
    const quest = window.__islandPlayed;
    if (!(quest && quest.has && quest.has('launch'))) return; // (docked without the rocket quest: the Observatory's own first time)
    game.after(1.2, () => { if (!isDone() && !finale.running) play({}); });
  });
  // The journal's replay (and the playtest): only where the hangar is.
  function replay() {
    const O = OV();
    if (!(O && O.bay)) { try { game.overseer.say('Bring the rocket back to the bay, and I will open it again.', 5); } catch { /* fine */ } return false; }
    play({ replay: true });
    return true;
  }
  window.__island = Object.assign(window.__island || {}, { finale: { play, replay, isDone, LINES, state: finale } });
})();
