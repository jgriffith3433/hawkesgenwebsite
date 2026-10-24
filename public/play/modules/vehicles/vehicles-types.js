// Vehicles, part 1: what each vehicle is. Its numbers (size, mass, wheels, engine, grip, seats, cameras) and its
// stand-in body made of shapes, so every vehicle drives with no art at all and wears a model when the game has one
// (shape.model). vehicles.js simulates them, vehicles-play.js puts the player in them.
//
// A type is { title, icon, class, mass, size: [w, h, l] (the body box, meters), wheels: [...], suspension: { travel },
//   engine: { accel (m/s²), top (m/s), reverse, boost }, grip, drift, steer (degrees), seats: [{ at, show }],
//   eye (the driver's eyes, for the cockpit camera), cam: { distance, height }, contacts (hull points), body(ctx) }.
// class: 'wheeled' (car, truck, bicycle, motorbike), 'boat', 'sub', 'plane', 'heli'.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const V = H.vehicles || (H.vehicles = { _: {} });

  // ------------------------------------------------------------------ helpers for stand-in bodies
  /** Makes the materials a body uses (the paint is the vehicle's color; e._mat is the paint, so e.color works). */
  function materials(scene, color) {
    const m = (name, c, o = {}) => {
      const mat = new B.StandardMaterial(`veh-${name}`, scene);
      mat.diffuseColor = c;
      mat.specularColor = o.spec || new B.Color3(0.12, 0.12, 0.12);
      if (o.glow) mat.emissiveColor = o.glow;
      if (o.alpha !== undefined) mat.alpha = o.alpha;
      return mat;
    };
    const paint = H.lib.hex(color, '#d23c3c');
    return {
      paint: m('paint', paint, { spec: new B.Color3(0.35, 0.35, 0.35) }),
      trim: m('trim', paint.scale(0.55)),
      dark: m('dark', new B.Color3(0.09, 0.09, 0.1)),
      metal: m('metal', new B.Color3(0.6, 0.62, 0.66), { spec: new B.Color3(0.6, 0.6, 0.6) }),
      glass: m('glass', new B.Color3(0.25, 0.35, 0.45), { spec: new B.Color3(0.8, 0.8, 0.8), alpha: 0.75 }),
      head: m('head', new B.Color3(1, 1, 0.9), { glow: new B.Color3(0.55, 0.55, 0.5) }),
      tail: m('tail', new B.Color3(0.8, 0.05, 0.05), { glow: new B.Color3(0.35, 0.02, 0.02) }),
      white: m('white', new B.Color3(0.92, 0.92, 0.9)),
      seat: m('seat', new B.Color3(0.18, 0.16, 0.15)),
      green: m('nav-g', new B.Color3(0.1, 0.9, 0.3), { glow: new B.Color3(0.1, 0.8, 0.3) }),
      red: m('nav-r', new B.Color3(0.9, 0.1, 0.1), { glow: new B.Color3(0.8, 0.1, 0.1) }),
    };
  }

  /** ctx for a body builder: part(kind, options, material, position, rotation (degrees), { decor, parent }). */
  function bodyCtx(scene, root, mats) {
    const RAD = Math.PI / 180;
    const made = [];
    const make = {
      box: (o) => B.MeshBuilder.CreateBox('veh-part', { width: o[0], height: o[1], depth: o[2] }, scene),
      cyl: (o) => B.MeshBuilder.CreateCylinder('veh-part', { diameterTop: o.top ?? o.d, diameterBottom: o.bottom ?? o.d, height: o.h, tessellation: o.t || 18 }, scene),
      sphere: (o) => B.MeshBuilder.CreateSphere('veh-part', { diameterX: o[0], diameterY: o[1], diameterZ: o[2], segments: 12 }, scene),
      capsule: (o) => B.MeshBuilder.CreateCapsule('veh-part', { radius: o.r, height: o.h, tessellation: 16 }, scene),
    };
    function part(kind, size, mat, at = [0, 0, 0], rot = [0, 0, 0], o = {}) {
      const mesh = make[kind](size);
      mesh.material = mats[mat] || mat;
      mesh.parent = o.parent || root;
      mesh.position.set(at[0], at[1], at[2]);
      mesh.rotation.set(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD);
      mesh.receiveShadows = true;
      if (o.decor) { mesh.metadata = { decor: true }; mesh.isPickable = false; }
      made.push(mesh);
      return mesh;
    }
    return { part, scene, root, mats, made };
  }

  // ------------------------------------------------------------------ the vehicles
  const seat = (x, y, z, show = false) => ({ at: [x, y, z], show });
  /** Four wheels: front and back at z, x apart, mounted at y; steer the front, drive 'rear' | 'front' | 'all'. */
  const four = (r, w, x, front, back, y, drive) => [
    { at: [-x, y, front], r, w, steer: 1, drive: drive !== 'rear' },
    { at: [x, y, front], r, w, steer: 1, drive: drive !== 'rear' },
    { at: [-x, y, back], r, w, steer: 0, drive: drive !== 'front', rear: true },
    { at: [x, y, back], r, w, steer: 0, drive: drive !== 'front', rear: true },
  ];

  const TYPES = {
    car: {
      title: 'Car', icon: '🚗', class: 'wheeled', mass: 1200, color: '#d23c3c',
      size: [1.9, 0.7, 4.2],
      wheels: four(0.38, 0.3, 0.86, 1.35, -1.3, -0.2, 'rear'), suspension: { travel: 0.32 },
      engine: { accel: 15, top: 40, reverse: 12, boost: 1.45 }, grip: 1.0, drift: 0.32, steer: 32,
      seats: [seat(-0.42, 0.42, -0.25), seat(0.42, 0.42, -0.25), seat(-0.42, 0.42, -1.05), seat(0.42, 0.42, -1.05)],
      eye: [-0.42, 0.72, -0.1], cam: { distance: 7, height: 2.3 }, exhaust: [0.55, -0.25, -2.12], lamps: { front: 2.11, back: -2.11, x: 0.62, y: 0.02 },
      body(c) {
        c.part('box', [1.9, 0.7, 4.2], 'paint');
        c.part('box', [1.62, 0.56, 2.05], 'paint', [0, 0.62, -0.38]);
        c.part('box', [1.5, 0.46, 0.08], 'glass', [0, 0.6, 0.66], [-30, 0, 0], { decor: true });
        c.part('box', [1.5, 0.42, 0.08], 'glass', [0, 0.6, -1.42], [28, 0, 0], { decor: true });
        for (const s of [-1, 1]) c.part('box', [0.06, 0.38, 1.7], 'glass', [s * 0.82, 0.64, -0.38], [0, 0, 0], { decor: true });
        c.part('box', [2.0, 0.22, 0.25], 'dark', [0, -0.22, 2.12], [0, 0, 0], { decor: true });
        c.part('box', [2.0, 0.22, 0.25], 'dark', [0, -0.22, -2.12], [0, 0, 0], { decor: true });
      },
    },
    truck: {
      title: '4x4', icon: '🛻', class: 'wheeled', mass: 2000, color: '#3f7d3a',
      size: [2.1, 0.9, 4.6],
      wheels: four(0.56, 0.44, 1.02, 1.5, -1.45, -0.25, 'all'), suspension: { travel: 0.55, soft: 0.8 },
      engine: { accel: 17, top: 32, reverse: 11, boost: 1.35 }, grip: 1.25, drift: 0.5, steer: 30,
      seats: [seat(-0.45, 0.6, 0.3), seat(0.45, 0.6, 0.3), seat(-0.55, 1.0, -1.45, true), seat(0.55, 1.0, -1.45, true)],
      eye: [-0.45, 1.05, 0.45], cam: { distance: 8, height: 2.8 }, exhaust: [0.7, -0.35, -2.32], lamps: { front: 2.31, back: -2.31, x: 0.72, y: 0.1 },
      body(c) {
        c.part('box', [2.1, 0.9, 4.6], 'paint');
        c.part('box', [1.95, 0.85, 2.0], 'paint', [0, 0.86, 0.3]);
        c.part('box', [1.8, 0.62, 0.08], 'glass', [0, 0.9, 1.31], [-12, 0, 0], { decor: true });
        for (const s of [-1, 1]) c.part('box', [0.06, 0.5, 1.6], 'glass', [s * 0.99, 0.92, 0.3], [0, 0, 0], { decor: true });
        for (const s of [-1, 1]) c.part('box', [0.1, 0.4, 2.2], 'trim', [s * 1.0, 0.62, -1.25]);
        c.part('box', [2.1, 0.4, 0.1], 'trim', [0, 0.62, -2.3]);
        c.part('box', [1.9, 0.1, 0.25], 'dark', [0, 1.36, 0.6], [0, 0, 0], { decor: true });
        for (const s of [-1, 0, 1]) c.part('box', [0.28, 0.12, 0.08], 'head', [s * 0.55, 1.36, 0.75], [0, 0, 0], { decor: true });
        c.part('box', [2.2, 0.3, 0.3], 'dark', [0, -0.25, 2.35], [0, 0, 0], { decor: true });
        c.part('box', [1.7, 0.18, 1.0], 'dark', [0, -0.5, 0], [0, 0, 0], { decor: true });
      },
    },
    bicycle: {
      title: 'Bicycle', icon: '🚲', class: 'wheeled', mass: 90, color: '#2a8fd6', twoWheels: true,
      size: [0.3, 0.7, 1.7],
      wheels: [{ at: [0, -0.05, 0.56], r: 0.34, w: 0.06, steer: 1 }, { at: [0, -0.05, -0.56], r: 0.34, w: 0.06, steer: 0, drive: true, rear: true }],
      suspension: { travel: 0.12 },
      engine: { accel: 7, top: 13, reverse: 3, boost: 1.3 }, grip: 1.1, drift: 0.5, steer: 26, hop: 7,
      seats: [seat(0, 0.95, -0.15, true)],
      eye: [0, 1.75, 0.05], cam: { distance: 4.5, height: 1.9 },
      body(c) {
        const R = 90;
        c.part('cyl', { d: 0.05, h: 1.05 }, 'paint', [0, 0.2, 0.0], [R, 0, 0]);
        c.part('cyl', { d: 0.05, h: 0.75 }, 'paint', [0, 0.02, -0.28], [R + 50, 0, 0]);
        c.part('cyl', { d: 0.05, h: 0.62 }, 'paint', [0, 0.05, 0.42], [-25, 0, 0]);
        c.part('cyl', { d: 0.05, h: 0.55 }, 'paint', [0, 0.25, -0.35], [-20, 0, 0]);
        c.part('box', [0.18, 0.06, 0.3], 'seat', [0, 0.55, -0.35]);
        c.part('cyl', { d: 0.04, h: 0.6 }, 'dark', [0, 0.45, 0.5], [0, 0, 90]);
      },
    },
    motorbike: {
      title: 'Motorbike', icon: '🏍', class: 'wheeled', mass: 260, color: '#e0a020', twoWheels: true,
      size: [0.5, 0.7, 2.0],
      wheels: [{ at: [0, -0.1, 0.74], r: 0.34, w: 0.16, steer: 1 }, { at: [0, -0.1, -0.72], r: 0.36, w: 0.2, steer: 0, drive: true, rear: true }],
      suspension: { travel: 0.2 },
      engine: { accel: 18, top: 48, reverse: 4, boost: 1.4 }, grip: 1.15, drift: 0.4, steer: 22,
      seats: [seat(0, 0.95, -0.2, true), seat(0, 1.05, -0.7, true)],
      eye: [0, 1.75, 0.0], cam: { distance: 5, height: 2 }, exhaust: [0.22, -0.15, -0.95], lamps: { front: 0.95, back: -1.0, x: 0, y: 0.3 },
      body(c) {
        c.part('box', [0.42, 0.45, 1.2], 'paint', [0, 0.1, 0.05]);
        c.part('box', [0.36, 0.2, 0.7], 'seat', [0, 0.38, -0.35]);
        c.part('box', [0.44, 0.35, 0.5], 'paint', [0, 0.38, 0.35]);
        c.part('cyl', { d: 0.07, h: 0.7 }, 'metal', [0, 0.25, 0.68], [-25, 0, 0]);
        c.part('cyl', { d: 0.05, h: 0.7 }, 'dark', [0, 0.6, 0.55], [0, 0, 90]);
        c.part('cyl', { d: 0.09, h: 0.6 }, 'metal', [0.22, -0.1, -0.6], [90, 0, 0], { decor: true });
      },
    },
    boat: {
      title: 'Boat', icon: '🚤', class: 'boat', mass: 900, color: '#f2f2ee', float: 2.6,
      size: [2.2, 0.9, 5.2],
      engine: { accel: 11, top: 26, reverse: 5, boost: 1.4, turn: 1.4 }, grip: 0.5,
      seats: [seat(-0.45, 0.5, -0.6, true), seat(0.45, 0.5, -0.6, true), seat(-0.5, 0.5, -1.7, true), seat(0.5, 0.5, -1.7, true)],
      eye: [-0.45, 1.25, -0.4], cam: { distance: 9, height: 3 }, exhaust: [0, -0.2, -2.7],
      body(c) {
        c.part('box', [2.2, 0.9, 4.0], 'paint', [0, 0, -0.6]);
        const bow = c.part('box', [1.56, 0.9, 1.56], 'paint', [0, 0, 1.4], [0, 45, 0]);
        bow.scaling.set(1, 1, 1);
        c.part('box', [2.25, 0.22, 4.05], 'trim', [0, -0.35, -0.6], [0, 0, 0], { decor: true });
        c.part('box', [1.0, 0.5, 0.5], 'white', [-0.45, 0.65, 0.2]);
        c.part('box', [1.9, 0.5, 0.06], 'glass', [0, 0.75, 0.55], [-25, 0, 0], { decor: true });
        c.part('box', [0.5, 0.8, 0.5], 'dark', [0, 0.1, -2.75]);
      },
    },
    submarine: {
      title: 'Submarine', icon: '🛥', class: 'sub', mass: 4000, color: '#e8c22a', float: 1, lightsOn: true,
      size: [2.2, 2.2, 8],
      engine: { accel: 6, top: 13, reverse: 4, boost: 1.35, turn: 0.8, climb: 4 }, grip: 0.4,
      seats: [seat(0, 0.2, 1.6), seat(0, 0.2, 0.4), seat(0, 0.2, -0.8), seat(0, 0.2, -2)],
      eye: [0, 0.4, 3.2], cam: { distance: 12, height: 3.5 }, lamps: { front: 4.05, back: -4.05, x: 0.5, y: -0.3 },
      contacts: [[-1, -1.05, 3], [1, -1.05, 3], [-1, -1.05, -3], [1, -1.05, -3], [0, 1.05, 3.5], [0, 1.05, -3.5], [0, -1.05, 3.9], [0, -1.05, -3.9], [0, 2.3, 0.5]],
      body(c) {
        const hull = c.part('capsule', { r: 1.1, h: 8 }, 'paint', [0, 0, 0], [90, 0, 0]);
        void hull;
        c.part('box', [0.7, 1.2, 1.7], 'paint', [0, 1.5, 0.6]);
        c.part('cyl', { d: 0.12, h: 0.9 }, 'dark', [0, 2.5, 0.9], [0, 0, 0], { decor: true });
        c.part('box', [2.8, 0.08, 0.7], 'trim', [0, 0, -3.3], [0, 0, 0], { decor: true });
        c.part('box', [0.08, 1.6, 0.7], 'trim', [0, 0, -3.4], [0, 0, 0], { decor: true });
        for (const z of [2.2, 1.0, -0.2]) for (const s of [-1, 1]) c.part('cyl', { d: 0.45, h: 0.06 }, 'glass', [s * 1.08, 0.25, z], [0, 0, 90], { decor: true });
      },
    },
    airplane: {
      title: 'Airplane', icon: '✈', class: 'plane', mass: 1100, color: '#f4f4f0',
      size: [1.2, 1.2, 7],
      wheels: [
        { at: [0, -0.55, 2.4], r: 0.26, w: 0.14, steer: 1 },
        { at: [-1.3, -0.55, -0.2], r: 0.32, w: 0.18, steer: 0, rear: true },
        { at: [1.3, -0.55, -0.2], r: 0.32, w: 0.18, steer: 0, rear: true },
      ],
      suspension: { travel: 0.3 },
      engine: { accel: 14, top: 75, reverse: 0, boost: 1.5 }, grip: 0.9, drift: 0.9, steer: 28,
      aero: { lift: 0.0306, cl0: 0.4, clA: 4.5, stall: 15, drag: 0.095, cd0: 0.02, induced: 0.05 },
      seats: [seat(0, 0.35, 0.7), seat(0, 0.35, -0.3)],
      eye: [0, 0.85, 0.9], cam: { distance: 13, height: 3.2 }, lamps: { front: 3.6, back: -3.6, x: 0, y: -0.2 },
      collider: [{ size: [1.2, 1.2, 7], at: [0, 0, 0] }, { size: [9.2, 0.16, 1.6], at: [0, 0.05, 0.3] }, { size: [3.2, 0.12, 0.9], at: [0, 0.2, -3.6] }, { size: [0.14, 1.2, 1.0], at: [0, 0.75, -3.75] }],
      contacts: [[-4.6, 0, 0.2], [4.6, 0, 0.2], [0, -0.6, 3.4], [0, 0.6, 3.2], [0, 0.6, -3.4], [0, 1.6, -3.5], [-1.6, 0.1, -3.4], [1.6, 0.1, -3.4], [0, -0.6, -3.3]],
      body(c) {
        c.part('cyl', { top: 0.7, bottom: 1.2, h: 5.4 }, 'paint', [0, 0, 0.6], [90, 0, 0]);
        c.part('cyl', { top: 0.7, bottom: 0.25, h: 2.4 }, 'paint', [0, 0.15, -2.95], [90, 0, 0]);
        c.part('cyl', { top: 0.3, bottom: 0.9, h: 0.5 }, 'trim', [0, 0, 3.5], [90, 0, 0]);
        c.part('box', [9.2, 0.12, 1.6], 'paint', [0, 0.05, 0.3]);
        c.part('box', [3.2, 0.1, 0.9], 'paint', [0, 0.2, -3.6]);
        c.part('box', [0.1, 1.2, 1.0], 'trim', [0, 0.75, -3.75]);
        c.part('sphere', [0.8, 0.55, 1.5], 'glass', [0, 0.55, 0.8], [0, 0, 0], { decor: true });
        c.part('box', [0.12, 0.12, 0.3], 'red', [-4.62, 0.05, 0.3], [0, 0, 0], { decor: true });
        c.part('box', [0.12, 0.12, 0.3], 'green', [4.62, 0.05, 0.3], [0, 0, 0], { decor: true });
        for (const x of [-1.3, 1.3]) c.part('cyl', { d: 0.07, h: 0.5 }, 'dark', [x, -0.35, -0.2], [0, 0, 0], { decor: true });
        c.part('cyl', { d: 0.07, h: 0.5 }, 'dark', [0, -0.35, 2.4], [0, 0, 0], { decor: true });
      },
    },
    helicopter: {
      title: 'Helicopter', icon: '🚁', class: 'heli', mass: 1600, color: '#2b5fd9',
      size: [1.8, 1.7, 3.8],
      engine: { accel: 0, top: 50, reverse: 0, boost: 1.4, turn: 1.7 }, grip: 0.6,
      seats: [seat(-0.4, 0.05, 0.55), seat(0.4, 0.05, 0.55), seat(-0.4, 0.05, -0.5), seat(0.4, 0.05, -0.5)],
      eye: [-0.4, 0.6, 0.9], cam: { distance: 12, height: 3.5 }, lamps: { front: 1.9, back: -5.25, x: 0, y: 0.35 },
      collider: [{ size: [1.8, 1.7, 3.8], at: [0, 0, 0] }, { size: [2.0, 0.14, 2.8], at: [0, -1.3, 0.05] }, { size: [0.5, 0.5, 3.6], at: [0, 0.35, -3.4] }],
      contacts: [[-0.95, -1.35, 1.1], [0.95, -1.35, 1.1], [-0.95, -1.35, -1.0], [0.95, -1.35, -1.0], [0, 0.4, -5.3], [0, 1.4, 0], [0, 0.85, 1.9], [0, -0.85, 1.9]],
      body(c) {
        c.part('sphere', [1.8, 1.7, 3.8], 'paint');
        c.part('sphere', [1.5, 1.1, 1.6], 'glass', [0, 0.25, 1.15], [0, 0, 0], { decor: true });
        c.part('cyl', { top: 0.18, bottom: 0.45, h: 3.6 }, 'paint', [0, 0.35, -3.4], [90, 0, 0]);
        c.part('box', [0.08, 1.0, 0.7], 'trim', [0, 0.85, -5.0]);
        c.part('box', [1.4, 0.06, 0.4], 'trim', [0, 0.4, -4.9]);
        for (const s of [-1, 1]) {
          c.part('cyl', { d: 0.08, h: 2.8 }, 'dark', [s * 0.95, -1.3, 0.05], [90, 0, 0], { decor: true });
          c.part('cyl', { d: 0.06, h: 0.5 }, 'dark', [s * 0.8, -1.05, 0.7], [0, 0, s * 20], { decor: true });
          c.part('cyl', { d: 0.06, h: 0.5 }, 'dark', [s * 0.8, -1.05, -0.6], [0, 0, s * 20], { decor: true });
        }
        c.part('cyl', { d: 0.25, h: 0.5 }, 'dark', [0, 1.05, 0], [0, 0, 0], { decor: true });
      },
    },
  };
  // The 4x4 answers to its other names in scripts and words.
  V.aliases = { '4x4': 'truck', jeep: 'truck', pickup: 'truck', bike: 'bicycle', motorcycle: 'motorbike', plane: 'airplane', heli: 'helicopter', chopper: 'helicopter', sub: 'submarine', speedboat: 'boat' };

  /** The resting height of the body's center above the ground (for placing a vehicle on the floor). */
  function restHeight(def) {
    if (def.wheels && def.wheels.length) {
      const w = def.wheels[0], t = def.suspension.travel;
      return -w.at[1] + t + w.r - 0.45 * t;
    }
    if (def.contacts) return -Math.min(...def.contacts.map((c) => c[1]));
    return def.size[1] / 2;
  }

  V.types = TYPES;
  V.materials = materials;
  V.bodyCtx = bodyCtx;
  V.restHeight = restHeight;
  V.typeOf = (name) => TYPES[name] ? name : (V.aliases[String(name).toLowerCase()] || (TYPES[String(name).toLowerCase()] ? String(name).toLowerCase() : null));
})();
