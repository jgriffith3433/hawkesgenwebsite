// Houses in one call: the "house" kind (rooms, floors, a style: walls with doors and windows cut in, floors, stairs, a
// roof, a light and a switch in every room, and furniture that works), a single "room", and a "wall" with openings.
// plan.js decides where every piece goes; this file makes them. A house is one thing in scene.json; its pieces are
// solid things of their own that move with it (turned in quarter turns), so you walk in through the front door.
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const L = H.lib;
  const M = H.homes;
  const RAD = Math.PI / 180;
  const W = () => H.world;
  const plan = window.HawkesHomesPlan;
  let seq = 0;
  H.hooks.world.push({ leave() { seq = 0; } });
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);

  /** A triangular prism (the attic under a gable roof): `size` [w, h, d], the ridge along x (alongX) or z. */
  function prism(size, alongX, material) {
    const [w, h, d] = size;
    const L2 = (alongX ? w : d) / 2, S2 = (alongX ? d : w) / 2;
    // Corners in (along, up, across) space, then turned so "along" is x or z.
    const P = (a, y, c) => (alongX ? [a, y, c] : [c, y, a]);
    const tri = (a) => [P(a, 0, -S2), P(a, h, 0), P(a, 0, S2)];
    const f0 = tri(-L2), f1 = tri(L2);
    const faces = [[f0[0], f0[2], f0[1]], [f1[0], f1[1], f1[2]], [f0[0], f0[1], f1[1]], [f0[0], f1[1], f1[0]], [f0[2], f1[2], f1[1]], [f0[2], f1[1], f0[1]]];
    const positions = [], indices = [];
    for (const f of faces) for (const v of f) { indices.push(positions.length / 3); positions.push(...v); }
    if (!alongX) for (let i = 0; i < indices.length; i += 3) { const t = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = t; }
    const normals = [];
    B.VertexData.ComputeNormals(positions, indices, normals);
    const vd = new B.VertexData();
    vd.positions = positions; vd.indices = indices; vd.normals = normals;
    const m = new B.Mesh('attic', W().scene);
    vd.applyToMesh(m);
    m.material = material;
    return m;
  }

  /** The material for a piece by its role, from the style (colors) and textures by asset name. */
  function materials(style, sh) {
    const tx = sh.textures || {};
    const st = String(sh.style || 'cozy').toLowerCase();
    const tex = (role) => tx[role] || M.assetFor(`${st}_${role}`, 'texture') || M.assetFor(`house_${role}`, 'texture');
    const many = (m) => { m.maxSimultaneousLights = 8; return m; };
    return {
      ext: many(M.mat(style.ext, { texture: tex('wall'), tile: 2 })),
      int: many(M.mat(style.int, { texture: tex('inside'), tile: 2 })),
      floor: many(M.mat(style.floor, { texture: tex('floor'), tile: 3 })),
      ceiling: many(M.mat(style.int)),
      stairs: many(M.mat(style.floor, { texture: tex('floor') })),
      trim: many(M.mat(style.trim)),
      roof: many(M.mat(style.roof, { texture: tex('roof'), tile: 3 })),
      glass: M.mat('#bfe3ff', { alpha: 0.22, spec: 0.9 }),
    };
  }

  /** A solid piece (a box) in the world, owned by an assembly. */
  function piece(size, mat, o = {}) {
    const mesh = B.MeshBuilder.CreateBox(o.name || 'house', { width: size[0], height: size[1], depth: size[2] }, W().scene);
    mesh.material = mat;
    mesh.receiveShadows = true;
    const e = new L.Entity(mesh, { physics: o.physics || 'static', name: o.name || 'House', tag: o.tag || 'house' }, 'box');
    e._mat = mat;
    e.grabbable = false;
    if (o.tilt) { const t = L.vec(o.tilt); mesh.rotation.set(t[0] * RAD, 0, t[2] * RAD); }
    L.place(e, { shadow: o.shadow !== false, rotation: o.tilt ? [o.tilt[0], 0, o.tilt[2]] : undefined });
    if (o.step) M.steppable(e);
    return e;
  }

  /** Little extras the planner asks for that aren't kinds of their own: a rubber duck, a ball, a TV host, a sign. */
  function extra(p, sh) {
    const g = H.game;
    if (p.kind === 'duck') {
      const e = H.kinds.get('sphere').build({ radius: 0.09 }, { color: '#ffd43b', physics: 'dynamic', name: 'Rubber duck', tag: 'duck', bounce: 0.3, mass: 0.2 }, null);
      M.part(e.node, 'sphere', [0.11], [0, 0.08, 0.04], '#ffd43b', { decor: true });
      M.part(e.node, 'cone', [0.05, 0.06], [0, 0.07, 0.12], '#f76707', { rot: [90, 0, 0], decor: true });
      M.usable(e, [{ label: 'squeak the duck', at: [0, 0.1, 0], use: () => { M.note(88, { voice: 'bell', dur: 0.2, volume: 0.25 }); e.push([0, 2, 0]); } }]);
      return e;
    }
    if (p.kind === 'ball') return H.kinds.get('sphere').build({ radius: 0.22 }, { color: p.color || '#ef476f', physics: 'dynamic', name: 'Ball', bounce: 0.7, mass: 0.4 }, null);
    if (p.kind === 'host') {
      const e = H.kinds.get('capsule').build({ radius: 0.28, height: 1.5 }, { color: '#3d5a80', name: 'News host', physics: 'static' }, null);
      M.part(e.node, 'sphere', [0.34], [0, 0.95, 0], '#f1c27d', { decor: true });
      M.part(e.node, 'sphere', [0.06], [-0.08, 1.0, -0.15], '#1d2128', { decor: true });
      M.part(e.node, 'sphere', [0.06], [0.08, 1.0, -0.15], '#1d2128', { decor: true });
      const lines = ['Good evening, and welcome to the news.', 'Breaking: this house is very cozy.', 'Back to you in the studio. Wait, that\'s me.'];
      let i = 0;
      M.usable(e, [{ label: 'talk to the host', at: [0, 0.8, 0], use: () => e.say(lines[i++ % lines.length], 3) }]);
      e.measure();
      return e;
    }
    if (p.kind === 'sign') return g.text(`● ON AIR · ${p.text || ''}`, { size: 0.16, color: '#ff6b6b', billboard: false });
    return null;
  }

  /** Builds a plan's pieces as things and joins them to `root` (they follow it). */
  function build(root, pl, sh, key) {
    const mats = materials(pl.style, sh);
    const list = [];
    const lamps = [];
    for (const p of pl.parts) {
      let e = null;
      try {
        if (p.kind === 'box') e = piece(p.size, mats[p.role] || mats.int, { step: p.step, name: p.role === 'floor' ? 'Floor' : p.role === 'stairs' ? 'Stairs' : p.role === 'trim' ? 'Railing' : p.role === 'ceiling' ? 'Ceiling' : 'Wall' });
        else if (p.kind === 'glass') e = piece(p.size, mats.glass, { name: 'Window', shadow: false });
        else if (p.kind === 'roof') e = piece(p.size, mats.roof, { physics: 'none', name: 'Roof', tilt: p.tilt });
        else if (p.kind === 'ramp') {
          // Only for real physics (the fallback box physics would make it a solid block): the steps stay for the eye.
          if (!(H.physics && H.physics.engine === 'havok')) continue;
          e = piece(p.size, mats.stairs, { name: 'Stairs', tilt: p.tilt, shadow: false });
          e.node.isVisible = false;
        }
        else if (p.kind === 'attic') {
          const m = prism(p.size, p.alongX, mats.ext);
          e = new L.Entity(m, { physics: 'none', name: 'Roof', tag: 'house' }, 'box');
          e.grabbable = false;
          L.place(e, { shadow: true });
        } else if (H.kinds.has(p.kind)) {
          const o = { name: p.name || null, color: p.color, data: { ...(p.data || {}) }, physics: H.kinds.get(p.kind).physics || 'static', homesKey: `${key}/${p.key}`, lenient: true };
          const shp = { ...(p.shape || {}) };
          if (p.kind === 'lamp' && p.light) shp.light = p.light;
          e = H.kinds.get(p.kind).build(shp, o, null);
          if (e._lamp) lamps.push({ e, room: p.data && p.data.room, floor: p.floor });
        } else e = extra(p, sh);
      } catch (err) { H.report(new Error(`house: ${p.kind}: ${err.message || err}`)); }
      if (!e) continue;
      e.data = { ...(e.data || {}), house: key, ...(p.room ? { room: p.room } : {}) };
      e.homesPart = p.key;
      list.push({ e, at: p.at, yaw: p.yaw || 0, p });
    }
    M.assemble(root, list.map(({ e, at, yaw }) => ({ e, at, yaw })));
    // Each room's lights light that room (and the floor and walls around it), not the whole house.
    const rooms = new Map(pl.rooms.map((r) => [`${r.floor}|${r.name}`, r]));
    const [cw, cd] = pl.cell;
    for (const { e, room, floor } of lamps) {
      const r = rooms.get(`${floor}|${room}`);
      const light = e._light;
      if (!r || !light) continue;
      const near = [];
      for (const it of list) {
        const p = it.p;
        if (p.floor !== undefined && p.floor !== floor && !(p.role === 'floor' && p.floor === floor) && !(p.role === 'ceiling')) continue;
        const half = p.size ? [p.size[0] / 2, p.size[2] / 2] : [0.6, 0.6];
        if (Math.abs(p.at[0] - r.x) > cw / 2 + half[0] + 0.2 || Math.abs(p.at[2] - r.z) > cd / 2 + half[1] + 0.2) continue;
        for (const m of [it.e.node, ...it.e.node.getChildMeshes()]) if (m.getTotalVertices && m.getTotalVertices() > 0) near.push(m);
      }
      light.includedOnlyMeshes = near;
    }
    return list;
  }

  /** The handle you grab a house (or a wall) by while building: a little glowing house over it. Hidden when playing. */
  function handle(root, at, label) {
    if (H.mode !== 'build') return;
    const m = M.mat('#7cf2c2', { glow: true });
    const box = M.part(root.node, 'box', [0.5, 0.36, 0.5], [at[0], at[1], at[2]], m);
    M.part(root.node, 'cone', [0.62, 0.32, 0], [at[0], at[1] + 0.34, at[2]], m, { tess: 4, rot: [0, 45, 0] });
    for (const c of root.node.getChildMeshes()) c.metadata = { entity: root };
    void box; void label;
  }

  function house(sh, o, spec, kind = 'house') {
    const root = new B.TransformNode(kind, W().scene);
    const e = new L.Entity(root, { ...o, physics: 'none' }, kind);
    const key = M.keyOf(o, spec) || `house${++seq}`; // scripts run for everyone in the same order: the same keys
    e.homesKey = key;
    const pl = plan({ ...sh, key });
    e.plan = pl;
    handle(e, [0, pl.size[1] + (pl.parts.some((p) => p.kind === 'roof') ? 3.6 : 1.2), 0], 'House');
    L.place(e, { ...o, shadow: false });
    e.half = [pl.size[0] / 2, pl.size[1] / 2, pl.size[2] / 2];
    build(e, pl, sh, key);
    e.measure = () => {}; // its own box is the handle; the pieces are the solid parts
    e.rooms = pl.rooms;
    return e;
  }

  H.kinds.register('house', {
    physics: 'none',
    maker: true,
    build: (sh, o, spec) => house(sh || {}, o, spec),
    editor: {
      word: 'a house', lift: () => 0.02, motion: [],
      hotbar: [{ order: 190, icon: '🏠', label: 'House', make: (yaw) => ({ type: 'house', name: 'House', shape: { rooms: 4, floors: 1, style: 'cozy' }, transform: { rotation: [0, Math.round(((yaw / RAD + 180) % 360) / 90) * 90, 0] } }) }],
    },
    codex: {
      group: 'Building', what: 'A whole furnished house in one thing: rooms (a number, or a list like ["living", "kitchen", "bedroom", "bathroom"]), floors with stairs, a style. Walls have doors and windows, every room a light and a switch, and furniture that works (sit, sleep, open the fridge, watch TV).',
      spec: { type: 'house', name: 'House', transform: { position: [0, 0, 0] }, shape: { rooms: ['living', 'kitchen', 'bedroom', 'bathroom'], floors: 1, style: 'cozy' } },
      fields: [['shape.rooms', 'a number, or a list of room kinds: living, kitchen, bedroom, bathroom, dining, office, music, kids, studio, garage, hall (or { type, name, tv, furnish })', '4'], ['shape.floors', '1 to 4 (stairs between them)', '1, or 2 for more than 4 rooms'], ['shape.style', 'cozy, modern, cabin, brick, beach, castle or pastel', 'cozy'], ['shape.tv', 'the living room TV\'s channels ("cartoons", or a list)', 'the usual shows'], ['shape.roof', 'gable, flat or false', 'by style'], ['shape.size', 'a room\'s width and depth in meters', '5'], ['shape.height', 'each floor\'s height', '3'], ['shape.furnish', 'false: empty rooms', 'true'], ['shape.colors', '{ ext, int, floor, roof, trim, door, sofa, bed }', 'the style\'s'], ['shape.textures', '{ wall, inside, floor, roof }: texture assets', '<style>_wall.png etc. when they exist'], ['shape.security', 'a camera over the front door (its picture is on the office computer)', 'true'], ['shape.show', 'the name of the TV show a studio room films', 'Hawkes News Live']],
      noFloor: false,
    },
  });

  // A single room: four walls with a door (and windows), a floor, a light and a switch, furniture by its type.
  H.kinds.register('room', {
    physics: 'none',
    maker: true,
    build(sh, o, spec) {
      const size = Array.isArray(sh.size) ? sh.size : [num(sh.size, 5), num(sh.size, 5)];
      const room = { type: sh.type || sh.kind || 'living', name: sh.name, tv: sh.tv, furnish: sh.furnish, show: sh.show };
      return house({ ...sh, rooms: [room], floors: 1, width: size[0], depth: size[1], roof: sh.roof === undefined ? (sh.ceiling === false ? false : 'flat') : sh.roof, security: sh.security === true }, o, spec, 'room');
    },
    editor: { word: 'a room', lift: () => 0.02, motion: [], hotbar: [{ order: 195, icon: '⬚', label: 'Room', make: (yaw) => ({ type: 'room', name: 'Room', shape: { type: 'bedroom', size: [5, 5] }, transform: { rotation: [0, Math.round(((yaw / RAD + 180) % 360) / 90) * 90, 0] } }) }] },
    codex: {
      group: 'Building', what: 'One room: walls with a door (front, -z) and windows, a floor and ceiling, a light and a switch, furnished by its type (living, kitchen, bedroom, bathroom, dining, office, music, kids, studio, garage, hall).',
      spec: { type: 'room', name: 'Bedroom', transform: { position: [0, 0, 0] }, shape: { type: 'bedroom', size: [5, 5], style: 'cozy' } },
      fields: [['shape.type', 'the kind of room', 'living'], ['shape.size', '[width, depth] in meters', '[5, 5]'], ['shape.style', 'like a house\'s', 'cozy'], ['shape.roof', 'flat, gable or false (open top)', 'flat'], ['shape.furnish', 'false: an empty room', 'true']],
    },
  });

  // A wall: a straight wall with doors and windows cut in (doors get a working door). Its position is the middle of its
  // bottom edge; it runs along its own x.
  H.kinds.register('wall', {
    physics: 'none',
    maker: true,
    build(sh, o, spec) {
      const len = num(sh.length, 4), h = num(sh.height, 2.8), t = num(sh.thickness, 0.2);
      const root = new B.TransformNode('wall', W().scene);
      const e = new L.Entity(root, { ...o, physics: 'none' }, 'wall');
      const key = M.keyOf(o, spec) || `wall${++seq}`;
      const ops = (Array.isArray(sh.openings) ? sh.openings : []).map((op) => {
        const door = (op.type || op.kind) !== 'window';
        const w = num(op.width, door ? 0.95 : 1.2), bottom = door ? 0 : num(op.bottom, 0.9), top = door ? num(op.height, 2.12) : bottom + num(op.height, 1.2);
        return { kind: door ? 'door' : 'window', at: num(op.at, 0) + len / 2, width: w, bottom, top: Math.min(top, h - 0.05), door: op.door !== false };
      });
      const mat = M.mat(o.color || '#e9e1d3', { texture: o.texture, tile: 2 });
      const glass = M.mat('#bfe3ff', { alpha: 0.22, spec: 0.9 });
      const parts = [];
      for (const p of plan.wallPieces({ x0: -len / 2, z0: 0, dir: 'x', len, y0: 0, h, t, openings: ops, role: 'wall' })) {
        parts.push({ e: piece(p.size, p.kind === 'glass' ? glass : mat, { name: p.kind === 'glass' ? 'Window' : (o.name || 'Wall'), shadow: p.kind !== 'glass' }), at: p.at, yaw: 0 });
      }
      ops.forEach((op, i) => {
        if (op.kind !== 'door' || !op.door) return;
        const d = H.kinds.get('door').build({ width: op.width - 0.05, height: op.top - 0.02 }, { homesKey: `${key}/door${i}`, color: '#8a5a33', physics: 'static', data: {} }, null);
        parts.push({ e: d, at: [op.at - len / 2, 0, 0], yaw: 0 });
      });
      handle(e, [0, h + 0.5, 0], 'Wall');
      L.place(e, { ...o, shadow: false });
      M.assemble(e, parts);
      e.measure = () => {};
      return e;
    },
    editor: { word: 'a wall', lift: () => 0.02, motion: [] },
    codex: {
      group: 'Building', what: 'A straight wall with doors and windows cut into it (openings: { type: "door" or "window", at: meters from its middle, width }). Doors get a working door. Its position is the middle of its bottom; it runs along its own x (turn it with rotation). In the editor, V draws walls.',
      spec: { type: 'wall', name: 'Wall', transform: { position: [0, 0, 0] }, shape: { length: 6, height: 2.8, openings: [{ type: 'door', at: -1.5 }, { type: 'window', at: 1.2 }] } },
      fields: [['shape.length', 'meters', '4'], ['shape.height', 'meters', '2.8'], ['shape.thickness', 'meters', '0.2'], ['shape.openings', '[{ type: door | window, at, width, height, bottom }]', 'none'], ['material.color', 'the wall\'s color', '#e9e1d3']],
    },
  });

  M.plan = plan;
  Object.assign(M.scriptApi, {
    /** A whole house: game.homes.house({ rooms: 5, floors: 2, style: 'cabin', x: 20 }). */
    house: (opts = {}) => H.kinds.get('house').build(opts, { ...opts, position: opts.position || [Number(opts.x) || 0, Number(opts.y) || 0, Number(opts.z) || 0], lenient: true }, null),
    /** One room: game.homes.room({ type: 'kitchen', size: [6, 4] }). */
    room: (opts = {}) => H.kinds.get('room').build(opts, { ...opts, position: opts.position || [Number(opts.x) || 0, Number(opts.y) || 0, Number(opts.z) || 0], lenient: true }, null),
    /** A wall with openings: game.homes.wall({ length: 6, openings: [{ type: 'door', at: 0 }] }). */
    wall: (opts = {}) => H.kinds.get('wall').build(opts, { ...opts, position: opts.position || [Number(opts.x) || 0, Number(opts.y) || 0, Number(opts.z) || 0], lenient: true }, null),
    /** A house's (or wall's) pieces by what they are: game.homes.find(house, 'front-door'), (house, 'fridge'),
     *  (house, 'tv'), (house, 'Kitchen') (everything in that room comes back from findAll). */
    find: (root, what) => M.scriptApi.findAll(root, what)[0] || null,
    findAll(root, what) {
      if (!root || !root._parts) return [];
      const w = String(what || '').toLowerCase();
      const all = root._parts.map((x) => x.e).filter((e) => e.alive);
      const exact = all.filter((e) => (e.homesPart || '').toLowerCase() === w);
      return exact.length ? exact : all.filter((e) => !w || e.kind === w || (e.name || '').toLowerCase() === w || ((e.data && e.data.room) || '').toLowerCase() === w);
    },
    /** The plan of a house without making it: its rooms, size and pieces. */
    plan: (opts = {}) => plan(opts),
    /** Puts a channel on a TV, computer or projector for now (not shared): game.homes.show(tv, { text: () => 'Score: ' + game.state.score }). */
    show: (e, channel) => { if (!e || !e._show) return false; e._override = channel === null ? null : channel; e._show(); return true; },
    /** Changes a screen's channel list (scripts run for everyone, so everyone gets the same list). */
    channels: (e, list) => { if (!e || !e._setChannels || !Array.isArray(list)) return false; e._setChannels(list); return true; },
    /** Turns a TV/radio/lamp on or off, or flips it: game.homes.power(tv, true). */
    power: (e, on) => { if (!e || !e.homes || !('on' in e.homes.state)) return false; M.set(e, { on: on === undefined ? !e.homes.state.on : Boolean(on) }); return true; },
    /** Opens or closes a door, fridge or cupboard: game.homes.open(door, false). */
    open: (e, open = true) => { if (!e || !e.homes || !('open' in e.homes.state)) return false; M.set(e, { open: Boolean(open) }); return true; },
    /** Switches a TV to a channel by number (0 is the first) or by name. */
    channel: (e, which) => {
      if (!e || !e._channels) return false;
      const list = e._channels();
      let i = typeof which === 'number' ? which : list.findIndex((c) => JSON.stringify(c).toLowerCase().includes(String(which).toLowerCase()));
      if (i < 0) return false;
      M.set(e, { on: true, channel: i % list.length });
      return true;
    },
  });
})();
