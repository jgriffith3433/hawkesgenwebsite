// The Observatory (docs/story.md, "The Observatory"): docking ends at a pad, and from the hangar's back wall a lift
// takes you up into a round room inside the ship: curved walls with tall windows onto the planet below and the stars, a
// slowly turning model of the planet, soft lights that rise with the Overseer's voice, a calm music bed, a place each for
// the mirror, a wardrobe and a travel board (placeholders for now) and the Overseer as a pearl of light that drifts to you
// (not a body). The first time, a short scene: it greets you by the name you chose, thanks you, gives you a gift (an
// accessory for your look) and raises a question it does not answer. Every later time is quick: a lift, one line.
//
// The room is a static thing in the world (colliders like the hangar's, so it holds wherever you are), shown only while you
// are in it: then the hull and the hangar's look are hidden (dock.js `interior`) so the windows open on the sky. The lift
// is a fade and a move, never a ride you can get stuck in: it times out, gives the controls back, and the way out is always
// the same lift (or falling out of the room, which sends you back to the bay by the lift in the hangar).
//
//   H.overseer.observatory   { inside, state ('bay' | 'riding' | 'inside'), first (this device has not been), scene (while the
//                              first arrival plays), lift (the hangar's lift, world meters), gift, pearl, level, music }
//   H.overseer.observatory.go() / .leave() / .skip()      what the lift's E does (tests and the playtest use them too)
//   game.on('observatory', ({ state: 'enter' | 'scene' | 'gift' | 'ready' | 'leave', first }))
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const W = () => H.world;
  const G = () => H.game;
  const OV = H.overseer;
  const M = () => H.observatoryMath;
  const mat = OV._.mat;
  const { PHONE } = H.sky._;
  const KEY = 'observatory';
  const RIDE = { out: 0.8, hold: 0.6, in: 1.0, max: 7 }; // seconds: fade to black, black, fade up; the most a ride may take

  let S = null; // this world's Observatory: { root, solid, glass, ..., state }
  let shipIn = null; // the ship they docked in (docked-pad), so the lift down puts them beside it
  let me = null; // the player's trip: { state, t, first, veh, from, to }

  // ------------------------------------------------------------------ the frame (the bay's own, from dock.js)
  const bay = () => OV.bay;
  /** A point in the bay's frame ([across, up from the ship's middle, out]) in world meters. */
  function at(x, y, z) {
    const b = bay();
    const s = Math.sin(b.yaw), c = Math.cos(b.yaw);
    return [b.c[0] + x * c + z * s, b.c[1] + y, b.c[2] - x * s + z * c];
  }
  /** The atrium's floor level is under the ship's middle; a point in the atrium's own frame ([across, up, toward the lift]). */
  const room = (x, y, z) => at(x, -M().ROOM.drop + y, z);
  /** The lift in the hangar: just in front of the back wall. */
  const liftBay = () => { const f = bay().f; return at(0, f.floor, f.back + 7); };
  const liftRoom = () => { const p = M().spot('lift'); return room(p[0], 0, p[1]); };

  // ------------------------------------------------------------------ building the room
  function glowTexture(scene) {
    const t = new B.DynamicTexture('ov-obs-glow', 128, scene, false);
    const c = t.getContext();
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.32)'); g.addColorStop(0.65, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128); t.update(); t.hasAlpha = true;
    return t;
  }
  /** A small plaque of words (a station's name and what it is waiting for). */
  function plaque(scene, title, sub, color) {
    const t = new B.DynamicTexture('ov-obs-label', { width: 256, height: 128 }, scene, true);
    const c = t.getContext();
    c.clearRect(0, 0, 256, 128);
    c.fillStyle = 'rgba(8,14,26,0.55)'; c.fillRect(0, 0, 256, 128);
    c.strokeStyle = color; c.lineWidth = 3; c.strokeRect(4, 4, 248, 120);
    c.fillStyle = '#eaf7ff'; c.font = '600 34px sans-serif'; c.textAlign = 'center'; c.fillText(title, 128, 62);
    c.fillStyle = '#8fd8ff'; c.font = '600 20px sans-serif'; c.fillText(sub, 128, 98);
    t.update();
    return t;
  }
  /** The planet, painted: ocean, a few islands, a pale cloud band (a model, not the real one). */
  function planetTexture(scene) {
    const t = new B.DynamicTexture('ov-obs-planet', { width: 256, height: 128 }, scene, true);
    const c = t.getContext();
    const g = c.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#9ed4f0'); g.addColorStop(0.18, '#2f7fc0'); g.addColorStop(0.82, '#1f66a8'); g.addColorStop(1, '#a9dcf2');
    c.fillStyle = g; c.fillRect(0, 0, 256, 128);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 12; i++) {
      const x = rnd() * 256, y = 24 + rnd() * 80, r = 5 + rnd() * 13;
      c.fillStyle = i % 4 === 0 ? '#e9dca6' : '#5fa65a';
      for (const dx of [-256, 0, 256]) { c.beginPath(); c.ellipse(x + dx, y, r * 1.5, r, rnd() * 3, 0, Math.PI * 2); c.fill(); }
    }
    c.fillStyle = 'rgba(255,255,255,0.45)';
    for (let i = 0; i < 16; i++) { const x = rnd() * 256, y = 14 + rnd() * 100; c.fillRect(x, y, 20 + rnd() * 40, 3 + rnd() * 4); }
    t.update();
    return t;
  }

  function build(w) {
    const scene = w.scene;
    const R = M().ROOM;
    const b = bay();
    const root = new B.TransformNode('ov-obs-root', scene);
    root.position.set(b.c[0], b.c[1], b.c[2]);
    root.rotation.y = b.yaw;
    const shell = mat(scene, 'ov-obs-shell', { diffuse: new B.Color3(0.82, 0.85, 0.9), spec: new B.Color3(0.25, 0.25, 0.28), power: 40, emissive: new B.Color3(0.13, 0.14, 0.17) });
    const floorM = mat(scene, 'ov-obs-floor', { diffuse: new B.Color3(0.3, 0.34, 0.42), spec: new B.Color3(0.3, 0.3, 0.34), power: 60, emissive: new B.Color3(0.05, 0.06, 0.08) });
    const glassM = mat(scene, 'ov-obs-glass', { diffuse: new B.Color3(0.6, 0.8, 1), emissive: new B.Color3(0.04, 0.07, 0.1), alpha: 0.1 });
    glassM.backFaceCulling = false;
    const lightM = mat(scene, 'ov-obs-light', { emissive: new B.Color3(0.5, 0.72, 0.9), unlit: true });
    const warmM = mat(scene, 'ov-obs-warm', { emissive: new B.Color3(1, 0.88, 0.66), unlit: true });
    const radial = (name, size, a, y) => { const m = B.MeshBuilder.CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene); m.position.set(Math.sin(a) * R.radius, y, Math.cos(a) * R.radius); m.rotation.y = a; return m; };

    // The walls: windows between thin mullions, a sill, a header band; solid where a station stands; a lintel over the lift.
    const solid = [], glass = [];
    const segs = M().segments();
    const chord = 2 * R.radius * Math.sin(Math.PI / R.segments) * 1.03;
    const floor = B.MeshBuilder.CreateCylinder('ov-obs-floor', { diameter: R.radius * 2 + 1.2, height: 0.8, tessellation: PHONE ? 40 : 56 }, scene);
    floor.position.y = -0.4;
    solid.push(floor);
    for (const s of segs) {
      const a = (s.mid * Math.PI) / 180;
      solid.push(radial('ov-obs-header', [chord, 0.9, 0.7], a, R.wall - 0.45));
      if (s.kind === 'window') {
        solid.push(radial('ov-obs-sill', [chord, R.sill, 0.7], a, R.sill / 2));
        glass.push(radial('ov-obs-pane', [chord, R.wall - 0.9 - R.sill, 0.12], a, (R.wall - 0.9 + R.sill) / 2));
        const am = (s.a0 * Math.PI) / 180;
        solid.push(radial('ov-obs-mullion', [0.45, R.wall - 0.9, 0.8], am, (R.wall - 0.9) / 2));
      } else if (s.kind === 'wall') {
        solid.push(radial('ov-obs-wall', [chord, R.wall - 0.9, 0.9], a, (R.wall - 0.9) / 2));
      } else { // the lift's door: pillars either side of the opening and a lintel
        solid.push(radial('ov-obs-lintel', [chord, R.wall - 5.5, 0.9], a, 5.5 + (R.wall - 5.5) / 2 - 0.45));
        for (const sd of [-1, 1]) { const o = a + sd * (chord / 2 - 0.5) / R.radius; solid.push(radial('ov-obs-jamb', [1, 5.5, 0.9], o, 2.75)); }
      }
    }
    // The roof: a ring round an open middle (the stars), thick enough to walk no further than the wall.
    const roof = B.MeshBuilder.CreateLathe('ov-obs-roof', { shape: [new B.Vector3(R.radius * R.oculus, 0, 0), new B.Vector3(R.radius + 0.6, 0, 0), new B.Vector3(R.radius + 0.6, 0.7, 0), new B.Vector3(R.radius * R.oculus, 0.7, 0)], radius: 1, tessellation: PHONE ? 40 : 56, closed: true }, scene);
    roof.position.y = R.wall;
    solid.push(roof);
    const solidM = B.Mesh.MergeMeshes(solid, true, true);
    solidM.name = 'ov-obs-solid';
    solidM.material = shell;
    const glassMesh = B.Mesh.MergeMeshes(glass, true, true);
    glassMesh.name = 'ov-obs-glass';
    glassMesh.material = glassM;
    glassMesh.isPickable = false;
    const make = (mesh, name, friction) => {
      mesh.parent = null;
      const e = new L.Entity(mesh, { physics: 'static', name, tag: 'observatory', grab: false, friction }, 'overseer');
      e.temporary = true; e.keep = true; e.data.overseer = 'observatory';
      L.place(e, { position: room(0, 0, 0), rotation: [0, b.yaw / L.RAD, 0], shadow: false });
      H.physics.setShape(e, H.physics.shapes.mesh(e));
      return e;
    };
    const solidE = make(solidM, 'Observatory', 0.9);
    const glassE = make(glassMesh, 'Observatory windows', 0.9);
    // (The floor shows the darker slate: a ring of it over the shell's pale.)
    const inlay = B.MeshBuilder.CreateDisc('ov-obs-inlay', { radius: R.radius - 0.2, tessellation: PHONE ? 40 : 56 }, scene);
    inlay.rotation.x = Math.PI / 2; inlay.position.y = 0.02; inlay.material = floorM;

    // Decor (no colliders): the lights, the planet on its stand, the stations' places, the lift's glow.
    const decor = new B.TransformNode('ov-obs-decor', scene);
    decor.parent = root;
    decor.position.y = -R.drop;
    inlay.parent = decor;
    const lights = [];
    const ringLight = (name, d, y, th) => { const t = B.MeshBuilder.CreateTorus(name, { diameter: d, thickness: th, tessellation: PHONE ? 48 : 72 }, scene); t.position.y = y; t.parent = decor; t.material = lightM; lights.push(t); return t; };
    ringLight('ov-obs-ring-top', R.radius * 2 - 1.6, R.wall - 1.1, 0.22);
    ringLight('ov-obs-ring-floor', R.radius * 1.15, 0.05, 0.16);
    ringLight('ov-obs-ring-stand', 6.8, 0.06, 0.18);
    const stand = B.MeshBuilder.CreateCylinder('ov-obs-stand', { diameterTop: 1.2, diameterBottom: 2.6, height: 2.1, tessellation: 24 }, scene);
    stand.position.y = 1.05; stand.parent = decor; stand.material = shell;
    const globe = B.MeshBuilder.CreateSphere('ov-obs-planet', { diameter: R.planet.r * 2, segments: PHONE ? 20 : 32 }, scene);
    globe.position.y = R.planet.y; globe.parent = decor;
    const pm = mat(scene, 'ov-obs-planet', { diffuse: new B.Color3(1, 1, 1), emissive: new B.Color3(0.28, 0.3, 0.34), spec: new B.Color3(0.15, 0.15, 0.18), power: 24 });
    pm.diffuseTexture = planetTexture(scene);
    globe.material = pm;
    const orbit = B.MeshBuilder.CreateTorus('ov-obs-orbit', { diameter: R.planet.r * 2 + 2.2, thickness: 0.05, tessellation: 64 }, scene);
    orbit.position.y = R.planet.y; orbit.rotation.x = 0.4; orbit.parent = decor; orbit.material = lightM; lights.push(orbit);
    // The places: a pedestal and a plaque on the wall behind each, and a ring that waits.
    const places = {};
    const pedestals = [];
    const names = { mirror: ['Mirror', 'hung soon'], board: ['Travel board', 'lit soon'], wardrobe: ['Wardrobe', 'filled soon'] };
    for (const id of ['mirror', 'board', 'wardrobe']) {
      const [x, z] = M().spot(id);
      const a = (M().STATIONS[id].angle * Math.PI) / 180;
      const ped = B.MeshBuilder.CreateCylinder('ov-obs-ped', { diameter: 3.2, height: 0.3, tessellation: 24 }, scene);
      ped.position.set(x, 0.15, z); ped.parent = decor; ped.material = shell; pedestals.push(ped);
      const ring = B.MeshBuilder.CreateTorus('ov-obs-ped-ring', { diameter: 3.0, thickness: 0.1, tessellation: 40 }, scene);
      ring.position.set(x, 0.34, z); ring.parent = decor; ring.material = lightM; lights.push(ring);
      const pl = B.MeshBuilder.CreatePlane('ov-obs-plaque', { width: 3.6, height: 1.8 }, scene);
      pl.position.set(Math.sin(a) * (R.radius - 0.55), 6.2, Math.cos(a) * (R.radius - 0.55));
      pl.rotation.y = a + Math.PI; // (facing the middle)
      pl.parent = decor;
      const pmat = mat(scene, 'ov-obs-plaque', { emissive: new B.Color3(1, 1, 1), unlit: true });
      pmat.emissiveTexture = plaque(scene, names[id][0], names[id][1], '#8fd8ff');
      pmat.opacityTexture = pmat.emissiveTexture;
      pl.material = pmat; pl.isPickable = false;
      places[id] = { at: room(x, 0, z), label: names[id][0] };
    }
    // The lift in the room: a lit disc on the floor at the door.
    const [lx, lz] = M().spot('lift');
    const pad = B.MeshBuilder.CreateTorus('ov-obs-lift', { diameter: 4, thickness: 0.18, tessellation: 40 }, scene);
    pad.position.set(lx, 0.06, lz); pad.parent = decor; pad.material = lightM; lights.push(pad);
    // The lift in the hangar: a lit doorway in the back wall, and a ring on the floor in front of it.
    const f = bay().f;
    const door = B.MeshBuilder.CreateBox('ov-obs-hangar-door', { width: 7, height: 15, depth: 0.5 }, scene);
    door.position.set(0, f.floor + 7.5, f.back + 0.4); door.parent = root; door.material = warmM; door.isPickable = false;
    const hring = B.MeshBuilder.CreateTorus('ov-obs-hangar-ring', { diameter: 5, thickness: 0.2, tessellation: 40 }, scene);
    hring.position.set(0, f.floor + 0.1, f.back + 7); hring.parent = root; hring.material = lightM;
    const hangarBits = [door, hring];

    // The pearl: a luminous sphere and its halo (the Overseer is not a body here).
    const pearl = B.MeshBuilder.CreateSphere('ov-obs-pearl', { diameter: 0.7, segments: 16 }, scene);
    pearl.material = mat(scene, 'ov-obs-pearl', { emissive: new B.Color3(1, 0.97, 0.92), unlit: true });
    pearl.parent = decor;
    const halo = B.MeshBuilder.CreatePlane('ov-obs-halo', { size: 5 }, scene);
    halo.material = mat(scene, 'ov-obs-halo', { emissive: new B.Color3(0.82, 0.94, 1), unlit: true });
    halo.material.opacityTexture = glowTexture(scene);
    halo.material.alphaMode = B.Engine.ALPHA_ADD;
    halo.material.disableDepthWrite = true;
    halo.billboardMode = B.Mesh.BILLBOARDMODE_ALL;
    halo.isPickable = false;
    halo.parent = pearl;
    const lamp = new B.PointLight('ov-obs-lamp', new B.Vector3(0, 5, 0), scene);
    lamp.diffuse = new B.Color3(0.86, 0.94, 1); lamp.specular = new B.Color3(0.4, 0.45, 0.5); lamp.range = 46; lamp.intensity = 0.4;
    lamp.parent = pearl;

    const s = { root, decor, solidE, glassE, globe, pearl, halo, lamp, lights, lightM, warmM, hangarBits, places, pm: pearl.material, pos: [0, 5.5, 0], level: 0, music: null, t: 0, shown: null };
    s.show = (inside) => {
      if (s.shown === inside) return;
      s.shown = inside;
      solidE.node.layerMask = glassE.node.layerMask = inside ? 0x0FFFFFFF : 0;
      decor.setEnabled(inside);
      lamp.setEnabled(inside);
    };
    s.show(false);
    for (const m of [...lights, pearl, halo, ...pedestals, globe, stand, ...hangarBits]) { m.isPickable = false; m.metadata = { decor: true, overseer: true }; }
    // (The hangar's bits show with the hangar: when the ship is near.)
    const near = () => OV.lod === 'near';
    for (const m of hangarBits) m.setEnabled(near());
    s.hangarSync = () => { for (const m of hangarBits) m.setEnabled(near() && !(me && me.state === 'inside')); };
    return s;
  }

  // ------------------------------------------------------------------ music: a calm bed (a slow chord, a drone, a high ping now and then)
  function musicStart() {
    if (!S || S.music) return;
    const m = { playing: true, since: S.t, chord: -1, nodes: null, ping: 4 };
    S.music = m;
    try {
      const ac = H.audio && H.audio.context;
      const out = H.audio && (H.audio.background || H.audio.master);
      if (!ac || !out) return;
      const bus = ac.createGain();
      bus.gain.value = 0.0001;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
      bus.connect(lp); lp.connect(out);
      bus.gain.setTargetAtTime(0.16, ac.currentTime, 1.4);
      const oscs = [0, 1, 2, 3].map((i) => {
        const o = ac.createOscillator(); o.type = i === 0 ? 'triangle' : 'sine'; o.frequency.value = M().CHORDS[0][i];
        const g = ac.createGain(); g.gain.value = i === 0 ? 0.55 : 0.3;
        const lfo = ac.createOscillator(); lfo.frequency.value = 0.07 + i * 0.031;
        const lg = ac.createGain(); lg.gain.value = 0.12;
        lfo.connect(lg); lg.connect(g.gain);
        o.connect(g); g.connect(bus); o.start(); lfo.start();
        return { o, lfo };
      });
      m.nodes = { ac, bus, lp, oscs };
    } catch { m.nodes = null; /* no sound */ }
  }
  function musicTick(dt) {
    const m = S && S.music;
    if (!m) return;
    const chord = Math.floor(Math.max(0, S.t - m.since) / 12) % M().CHORDS.length;
    if (chord !== m.chord) {
      m.chord = chord;
      if (m.nodes) { const t0 = m.nodes.ac.currentTime; m.nodes.oscs.forEach((x, i) => x.o.frequency.setTargetAtTime(M().chordAt((S.t - m.since))[i], t0, 2.2)); }
    }
    m.ping -= dt;
    if (m.ping <= 0 && m.nodes) {
      m.ping = 5 + Math.random() * 6;
      try {
        const { ac, bus } = m.nodes;
        const notes = M().chordAt(S.t - m.since);
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = notes[Math.floor(Math.random() * 4)] * 4;
        const g = ac.createGain(); const t0 = ac.currentTime;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2);
        o.connect(g); g.connect(bus); o.start(t0); o.stop(t0 + 3.3);
      } catch { /* fine */ }
    }
  }
  function musicStop() {
    const m = S && S.music;
    if (!m) return;
    S.music = null;
    const n = m.nodes;
    if (!n) return;
    try {
      const t0 = n.ac.currentTime;
      n.bus.gain.cancelScheduledValues(t0); n.bus.gain.setTargetAtTime(0.0001, t0, 0.5);
      setTimeout(() => { for (const x of n.oscs) { try { x.o.stop(); x.lfo.stop(); } catch { /* done */ } } try { n.bus.disconnect(); n.lp.disconnect(); } catch { /* done */ } }, 2500);
    } catch { /* fine */ }
  }

  // ------------------------------------------------------------------ the fade (a black sheet; time-driven, so it is the same in a test)
  let sheet = null;
  function fadeTo(k) {
    if (typeof document === 'undefined' || !document.body) return;
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'ov-obs-fade';
      sheet.style.cssText = 'position:fixed;inset:0;background:#05080f;opacity:0;pointer-events:none;z-index:9';
      document.body.appendChild(sheet);
    }
    sheet.style.opacity = String(Math.max(0, Math.min(1, k)));
    sheet.hidden = k <= 0.001;
  }

  // ------------------------------------------------------------------ the trip
  function nameOf() {
    const look = H.presence && H.presence.look;
    return M().clean((look && look.name) || (H.memory && H.memory.get && H.memory.get().name) || '');
  }
  const first = () => !(H.lines && H.lines.seen && H.lines.seen(KEY));
  const walking = () => { const p = W() && W().player; return Boolean(p && p.alive && !(H.vehicles && H.vehicles.current && H.vehicles.current.alive)); };
  const emit = (state, extra) => { if (G()) G().emit('observatory', { state, first: me ? me.first : false, ...(extra || {}) }); };

  /** Take the lift up. */
  function go() {
    if (!S || !walking() || me) return false;
    if (!OV.hangar || !OV.hangar.inside) return false;
    me = { state: 'riding', dir: 'up', phase: 'out', t: 0, first: first(), took: 0, veh: shipIn && shipIn.alive ? shipIn : null };
    chimeRide();
    return true;
  }
  /** Take the lift down, back to the bay. */
  function leave(why) {
    if (!S) return false;
    if (me && me.state === 'riding') return false;
    const first0 = me ? me.first : false;
    const prior = me;
    me = { state: 'riding', dir: 'down', phase: 'out', t: 0, first: first0, veh: prior ? prior.veh : null, why: why || 'lift', scene: null };
    if (prior && prior.scene) { prior.scene = null; if (H.speech) H.speech.clear('observatory'); }
    chimeRide();
    return true;
  }
  function chimeRide() {
    try {
      const ac = H.audio && H.audio.context;
      if (!ac || ac.state !== 'running') return;
      const t0 = ac.currentTime;
      const out = ac.createGain(); out.gain.value = 0.0001; out.connect(H.audio.master);
      out.gain.exponentialRampToValueAtTime(0.09, t0 + 0.3); out.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
      [196, 293.66].forEach((fq, i) => { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(fq, t0); o.frequency.linearRampToValueAtTime(fq * (i ? 1.5 : 1.25), t0 + 2); o.connect(out); o.start(t0); o.stop(t0 + 2.3); });
    } catch { /* no sound */ }
  }

  /** Where the player is put in the bay when they come down: beside the rocket they came in, else by the lift. */
  function bayArrival() {
    const v = me && me.veh && me.veh.alive ? me.veh : null;
    if (v) return [v.position[0] + 6 * Math.cos(bay().yaw), v.position[1] + 1.2, v.position[2] - 6 * Math.sin(bay().yaw)];
    const f = bay().f;
    return at(0, f.floor + 1.2, f.back + 11);
  }
  function putPlayer(pos) {
    const p = W().player;
    p.position = pos;
    p.velocity = [0, 0, 0];
    if (p.vx !== undefined) { p.vx = 0; p.vy = 0; p.vz = 0; }
  }

  /** The player is in the room: start the music, the pearl comes, and the scene or the quick line plays. */
  function arrive() {
    const nm = nameOf();
    S.show(true);
    OV.interior(true);
    S.hangarSync();
    S.t = S.t || 0;
    musicStart();
    S.pos = [0, 6, 0];
    me.state = 'inside';
    me.at = S.t;
    emit('enter');
    const sc = me.first ? M().scene(nm, H.presence && H.presence.look) : null;
    me.scene = sc ? { ...sc, next: 0, startedAt: S.t, skipped: false } : null;
    me.quickDone = false;
    me.n = (me.n || 0);
    if (sc) emit('scene');
  }

  function say(text, voice) {
    if (OV.speak) OV.speak(text, voice || null, 6, { priority: 'important', owner: 'observatory' });
  }
  function giveGift(g) {
    let ok = false;
    try { if (H.presence && H.presence.setLook) { H.presence.setLook({ accessory: g.id, accessoryColor: g.color }); ok = true; } } catch (err) { H.report(err, 'observatory gift'); }
    if (!ok && G() && G().mayhem && G().mayhem.giveTool) { G().mayhem.giveTool('matches'); ok = true; }
    S.flare = 1;
    chimeGift();
    if (G()) G().emit('observatory-gift', { gift: g.id, kind: g.kind, label: g.label });
    emit('gift', { gift: g.id });
    S.gift = g;
    if (H.lines && H.lines.mark) H.lines.mark(KEY); // (the first arrival is done when the gift is given)
    return ok;
  }
  function chimeGift() {
    try {
      const ac = H.audio && H.audio.context;
      if (!ac || ac.state !== 'running') return;
      const t0 = ac.currentTime;
      const out = ac.createGain(); out.gain.value = 0.0001; out.connect(H.audio.master);
      out.gain.exponentialRampToValueAtTime(0.1, t0 + 0.04); out.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
      [659.25, 880, 1318.5].forEach((fq, i) => { const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = fq; o.connect(out); o.start(t0 + i * 0.1); o.stop(t0 + 2.4); });
    } catch { /* no sound */ }
  }
  function playScene(dt) {
    const sc = me.scene;
    if (!sc) return;
    const t = S.t - sc.startedAt;
    while (sc.next < sc.steps.length && t >= sc.steps[sc.next].at) {
      const st = sc.steps[sc.next++];
      say(st.say, st.voice);
      if (st.gift) giveGift(sc.gift);
    }
    if (sc.next >= sc.steps.length && t >= sc.length) { me.scene = null; emit('ready'); }
    void dt;
  }
  /** Skips what is left of the first arrival (the gift is still given, once). */
  function skip() {
    const sc = me && me.scene;
    if (!sc) return false;
    if (H.speech) H.speech.clear('observatory');
    if (!S.gift) giveGift(sc.gift);
    me.scene = null;
    emit('ready', { skipped: true });
    return true;
  }

  // ------------------------------------------------------------------ each step
  H.hooks.step.push((dt) => {
    if (!S || !W()) return;
    const p = W().player;
    S.t += dt;
    // The lights and the pearl follow the voice, in the room only.
    const speaking = Boolean(H.speech && H.speech.busy);
    // (in the room: from the lift's black on the way up to its black on the way down)
    const inside = Boolean(me && (me.state === 'inside' || (me.dir === 'up' && me.phase !== 'out') || (me.dir === 'down' && me.phase === 'out')));
    if (inside) {
      S.level = M().voiceLevel(S.level, speaking, S.t, dt);
      const k = M().glow(S.level, S.t);
      S.lightM.emissiveColor.set(0.35 + 0.5 * k, 0.55 + 0.4 * k, 0.75 + 0.25 * k);
      S.lamp.intensity = 0.25 + 0.9 * S.level + 0.1 * Math.sin(S.t * 0.5);
      S.globe.rotation.y += dt * 0.12;
      const tgt = p && p.alive ? p.position : null;
      const local = tgt ? room(0, 0, 0) : null;
      const rel = tgt ? [tgt[0] - local[0], tgt[1] - local[1], tgt[2] - local[2]] : null;
      // (the pearl lives in the atrium's frame: rotate the player's offset into it)
      const b = bay(), sn = Math.sin(b.yaw), cs = Math.cos(b.yaw);
      const tl = rel ? [rel[0] * cs - rel[2] * sn, rel[1], rel[0] * sn + rel[2] * cs] : null;
      const near = me.scene || S.t - me.at < 40 ? 'follow' : 'idle';
      const st = M().pearlStep(S.pos, tl, S.t, dt, near);
      S.pos = st.pos;
      S.pearl.position.set(S.pos[0], S.pos[1], S.pos[2]);
      const sc = 1 + 0.16 * S.level + (S.flare || 0) * 0.5;
      S.pearl.scaling.setAll(sc);
      S.halo.scaling.setAll(1 + S.level * 0.6 + (S.flare || 0));
      if (S.flare) S.flare = Math.max(0, S.flare - dt * 0.7);
      musicTick(dt);
    } else if (S.music) musicStop();

    if (!me) { S.hangarSync(); return; }
    me.t += dt;
    if (me.state === 'riding') {
      // A ride is a fade out, a move at black, a fade up. It cannot hang: past RIDE.max it finishes where it was going.
      const lift = me.dir === 'up';
      if (me.phase === 'out') {
        fadeTo(me.t / RIDE.out);
        if (p) p.controls = false;
        if (me.t >= RIDE.out || me.t > RIDE.max) {
          me.phase = 'hold'; me.t = 0;
          if (lift) { const q = M().spot('lift'); putPlayer(room(q[0] * 0.8, 0.3, q[1] * 0.8)); arrive(); me.state = 'riding'; }
          else { leaveRoom(); putPlayer(bayArrival()); }
        }
      } else if (me.phase === 'hold') {
        fadeTo(1);
        if (me.t >= RIDE.hold) { me.phase = 'in'; me.t = 0; }
      } else {
        fadeTo(1 - me.t / RIDE.in);
        if (me.t >= RIDE.in || me.t > RIDE.max) {
          fadeTo(0);
          if (p) p.controls = true;
          if (lift) { me.state = 'inside'; me.at = S.t; } else { emit('leave'); me = null; }
        }
      }
      return;
    }
    // Inside: the scene, the quick line, and never stuck.
    if (me.state === 'inside') {
      if (me.scene && S.t - me.scene.startedAt >= 0) playScene(dt);
      if (!me.first && !me.quickDone && S.t - me.at >= 1.5) { me.quickDone = true; say(M().quick(nameOf(), (H.memory && H.memory.get ? H.memory.get().visits : 0)), null); emit('ready'); }
      if (p && p.alive) {
        const c = room(0, 0, 0);
        const dx = p.position[0] - c[0], dz = p.position[2] - c[2], dy = p.position[1] - c[1];
        if (Math.hypot(dx, dz) > M().ROOM.radius + 6 || dy < -30 || dy > M().ROOM.wall + 40) leave('fell');
      }
    }
  });

  /** The room is empty: the sky closes, the hull and hangar show again, the music stops. */
  function leaveRoom() {
    if (!S) return;
    OV.interior(false);
    S.show(false);
    S.hangarSync();
    musicStop();
    if (H.speech) H.speech.clear('observatory');
  }

  // ------------------------------------------------------------------ E at the lift
  H.use.register('observatory:lift', {
    near(p) {
      if (!S || !walking()) return null;
      if (me && me.state === 'riding') return null;
      if (me && me.state === 'inside') {
        if (me.scene && me.first && S.t - me.scene.startedAt > 3) { const d0 = Math.hypot(p.position[0] - liftRoom()[0], p.position[2] - liftRoom()[2]); if (d0 > 5) return me.scene ? { label: 'Skip', act: skip, priority: -1, distance: 99, key: null } : null; }
        const l = liftRoom();
        const d = Math.hypot(p.position[0] - l[0], p.position[2] - l[2]);
        return d < 5 ? { label: 'Take the lift down to the bay', act: () => leave('lift'), distance: d, priority: 5 } : null;
      }
      if (!OV.hangar || !OV.hangar.inside) return null;
      const l = liftBay();
      const d = Math.hypot(p.position[0] - l[0], p.position[2] - l[2]);
      return d < 7 ? { label: 'Take the lift up to the Observatory', act: go, distance: d, priority: 5 } : null;
    },
  });
  // The places that wait (the mirror, the wardrobe, the board): E near one, one plain line.
  H.use.register('observatory:places', {
    near(p) {
      if (!S || !me || me.state !== 'inside') return null;
      for (const id of ['mirror', 'wardrobe', 'board']) {
        const pl = S.places[id];
        const d = Math.hypot(p.position[0] - pl.at[0], p.position[2] - pl.at[2]);
        if (d < 3) return { label: `${pl.label}`, act: () => say(id === 'mirror' ? 'A place for a mirror. It is not hung yet.' : id === 'wardrobe' ? 'A place for your wardrobe. Empty, for now.' : 'A board for the places we could go. It is dark, for now.'), distance: d, priority: 1 };
      }
      return null;
    },
  });

  // ------------------------------------------------------------------ the world
  OV.onEnter((O, w) => {
    S = null; me = null;
    if (!OV.bay) return;
    try { S = build(w); } catch (err) { H.report(err, 'overseer observatory'); S = null; }
  });
  OV.onLeave(() => {
    if (!S) return;
    musicStop();
    fadeTo(0);
    const p = W() && W().player;
    if (p && me && me.state === 'riding') p.controls = true;
    for (const e of [S.solidE, S.glassE]) if (e && e.alive) e.destroy();
    S.root.dispose(false, true);
    S = null; me = null;
  });
  OV.onLod(() => { if (S) S.hangarSync(); });
  if (H.planet && H.planet.frame && H.planet.frame.onRebase) H.planet.frame.onRebase(() => {
    if (!S || !OV.bay) return;
    const b = bay();
    S.root.position.set(b.c[0], b.c[1], b.c[2]);
    S.root.rotationQuaternion = H.planet.frame.toLocalQ().multiply(B.Quaternion.RotationAxis(B.Axis.Y, b.yaw));
  });
  H.hooks.game.push((game) => { game.on('docked-pad', (d) => { if (d && d.vehicle) shipIn = d.vehicle; }); });
  H.hooks.world.push({
    enter() { me = null; shipIn = null; },
    leave() { const p = W() && W().player; if (p && me && me.state === 'riding') p.controls = true; fadeTo(0); me = null; },
    // Down and sent back to the start: you are not in the room any more.
    respawn() { if (S && me) { leaveRoom(); const p = W() && W().player; if (p) p.controls = true; fadeTo(0); me = null; } },
  });

  Object.defineProperty(OV, 'observatory', {
    configurable: true,
    get() {
      return {
        get on() { return Boolean(S); },
        get inside() { return Boolean(me && me.state === 'inside'); },
        get state() { return me ? me.state : 'bay'; },
        get first() { return first(); },
        get scene() { return Boolean(me && me.scene); },
        get lift() { return S ? liftBay() : null; },
        get liftRoom() { return S ? liftRoom() : null; },
        get gift() { return S && S.gift ? S.gift.id : null; },
        get pearl() { return S ? S.pos.slice() : null; },
        get level() { return S ? S.level : 0; },
        get music() { return Boolean(S && S.music); },
        get places() { return S ? Object.keys(S.places) : []; },
        go, leave: () => leave('call'), skip,
      };
    },
  });
})();
