// Real-time strategy (config.rts; J, 2026-10-27: "an RTS game in space with waves and a story and progression"): you
// command units. Things become units, buildings and resources with abilities (`unit`, `building`, `resource`); the
// player's side is config.rts.team. Click a unit to select it (shift adds, drag a box for many), right-click (or tap,
// with units selected) to move, attack what you click, or gather a resource; A then click attacks along the way; S stops;
// Q picks your whole army. A building trains units for its side's resources; workers gather and bring them home. The
// other sides can be AI (they gather, train and attack in waves) or other players. A side with no buildings left has
// lost. Online the host runs every unit; commands go to it (H.sync), and the sides' resources come back (H.sync.state).
/* global HawkesPlay, BABYLON */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const B = BABYLON;
  const W = () => H.world;
  const G = () => H.game;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hex = (c, f = '#ffffff') => B.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(String(c)) ? c : f);
  const COLORS = { blue: '#3b82f6', red: '#ef4444', green: '#22c55e', yellow: '#eab308', purple: '#a855f7', orange: '#f97316' };
  const colorOf = (team) => COLORS[team] || (cfg().teams && cfg().teams[team] && cfg().teams[team].color) || '#e5e7eb';

  // The units a building can train (by name), and what each is like. A building's `makes` may also give its own
  // ({ name, cost, time, spec }). Space units fly (`fly`: their height over the ground or the plane they are on).
  const UNITS = {
    worker: { cost: 50, time: 5, hp: 60, speed: 4.5, damage: 3, range: 1.6, rate: 1, sight: 10, gather: 10, shape: 'capsule', size: 0.7 },
    soldier: { cost: 80, time: 6, hp: 120, speed: 4, damage: 10, range: 1.8, rate: 0.9, sight: 14, shape: 'capsule', size: 0.9 },
    ranged: { cost: 100, time: 7, hp: 80, speed: 4, damage: 9, range: 10, rate: 1.1, sight: 16, shape: 'cylinder', size: 0.8 },
    tank: { cost: 220, time: 12, hp: 420, speed: 2.6, damage: 32, range: 12, rate: 2.2, sight: 16, shape: 'box', size: 1.8 },
    fighter: { cost: 120, time: 6, hp: 90, speed: 9, damage: 8, range: 12, rate: 0.6, sight: 22, fly: 6, shape: 'cone', size: 1.2 },
    frigate: { cost: 320, time: 14, hp: 600, speed: 4, damage: 26, range: 18, rate: 1.6, sight: 24, fly: 9, shape: 'box', size: 3 },
    'mining-ship': { cost: 60, time: 5, hp: 70, speed: 6, damage: 0, range: 0, rate: 1, sight: 12, fly: 4, gather: 12, shape: 'sphere', size: 1 },
  };
  const unitSpec = (name, team, at) => {
    const u = UNITS[name] || UNITS.soldier, s = u.size, col = colorOf(team);
    const shape = u.shape === 'box' ? { size: [s, s * 0.6, s * 1.3] } : u.shape === 'sphere' ? { radius: s / 2 } : u.shape === 'cone' ? { radius: s / 2, height: s * 1.4 } : { radius: s * 0.35, height: s * 1.9 };
    const type = u.shape === 'cone' ? 'cone' : u.shape;
    return {
      type, name: `${team} ${name}`, shape, material: { color: col }, physics: u.fly ? 'kinematic' : 'dynamic',
      transform: { position: at, rotation: u.shape === 'cone' ? [90, 0, 0] : [0, 0, 0] },
      behaviors: [{ use: 'unit', team, role: name, hp: u.hp, speed: u.speed, damage: u.damage, range: u.range, rate: u.rate, sight: u.sight, gather: u.gather || 0, fly: u.fly || 0 }],
    };
  };

  const cfg = () => (W() && W().graph && W().graph.config && W().graph.config.rts) || null;
  const on = () => Boolean(cfg()) && H.mode !== 'build';
  const myTeam = () => { const c = cfg(); return (c && c.team) || 'blue'; };
  const units = new Set(), buildings = new Set(), resources = new Set();
  const state = { res: {}, lost: {}, over: false, sel: new Set(), amove: false, waves: {}, ai: {} };
  const host = () => !H.sync || !H.sync.online || H.sync.isHost;
  const teamOf = (e) => e && e.data && e.data.team;
  const enemies = (a, b) => Boolean(a && b && a !== b);
  /** Something a side attacks: another side's unit or building, or an enemy (gameplay.js) when it's yours. */
  function hostileTo(team, e) {
    if (!e || !e.alive || e.dead) return false;
    const t = teamOf(e);
    if (t) return enemies(team, t);
    return team === myTeam() && e.tag === 'enemy';
  }

  // ------------------------------------------------------------------ marks: a ring when selected, a health bar
  function marks(e, color) {
    const scene = W().scene, r = Math.max(e.half[0], e.half[2]) * 1.5 + 0.2;
    const ring = B.MeshBuilder.CreateTorus('rts-ring', { diameter: r * 2, thickness: 0.08, tessellation: 24 }, scene);
    const m = new B.StandardMaterial('rts-ring', scene); m.disableLighting = true; m.emissiveColor = hex(color); ring.material = m;
    ring.parent = e.node; ring.position.y = -e.half[1] + 0.05; ring.isPickable = false; ring.metadata = { decor: true }; ring.setEnabled(false);
    const bar = B.MeshBuilder.CreatePlane('rts-hp', { width: 1.2, height: 0.12 }, scene);
    const bm = new B.StandardMaterial('rts-hp', scene); bm.disableLighting = true; bm.emissiveColor = hex('#22c55e'); bar.material = bm;
    bar.parent = e.node; bar.position.y = e.half[1] + 0.45; bar.billboardMode = B.Mesh.BILLBOARDMODE_ALL; bar.isPickable = false; bar.metadata = { decor: true }; bar.setEnabled(false);
    return { ring, bar, bm };
  }
  function showMarks(e, s) {
    if (!s.marks) return;
    const sel = state.sel.has(e), hurt = e.maxHp && e.hp < e.maxHp;
    s.marks.ring.setEnabled(sel);
    s.marks.bar.setEnabled(sel || hurt);
    if (e.maxHp) {
      const k = clamp(e.hp / e.maxHp, 0, 1);
      s.marks.bar.scaling.x = Math.max(0.02, k);
      s.marks.bm.emissiveColor = hex(k > 0.5 ? '#22c55e' : k > 0.25 ? '#eab308' : '#ef4444');
    }
  }
  /** A shot: a short beam of the side's color, and the damage. */
  function shoot(e, t, dmg, color) {
    const g = G();
    const scene = W().scene;
    const a = new B.Vector3(e.x, e.y + e.half[1] * 0.4, e.z), b = new B.Vector3(t.x, t.y + t.offset[1], t.z);
    const line = B.MeshBuilder.CreateLines('rts-shot', { points: [a, b] }, scene);
    line.color = hex(color); line.isPickable = false;
    setTimeout(() => line.dispose(), 90);
    if (g.sound) g.sound('laser', { at: [e.x, e.y, e.z], volume: 0.4 });
    g.damage(t, dmg, e);
  }

  // ------------------------------------------------------------------ units
  /** Where a unit goes next to reach a point (a little apart from friends on the way). */
  function steer(e, to, speed, s, dt) {
    const dx = to[0] - e.x, dz = to[2] - e.z, d = Math.hypot(dx, dz);
    let x = d > 0.01 ? dx / d : 0, z = d > 0.01 ? dz / d : 0;
    for (const o of units) {
      if (o === e || !o.alive || o.dead) continue;
      const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz), room = (e.half[0] + o.half[0]) * 1.4 + 0.3;
      if (od > 0.001 && od < room) {
        const k = (room - od) * 1.2;
        x += ox / od * k; z += oz / od * k;
        // (One in the way ahead: step round it, not into it.)
        if (-(ox * x + oz * z) / od > 0.5) { x += -oz / od * k; z += ox / od * k; }
      }
    }
    const l = Math.hypot(x, z) || 1;
    if (s.fly) {
      const y = (s.flyBase ?? e.y - s.fly) + s.fly, k = Math.min(1, d) * speed * dt;
      e.position = [e.x + x / l * k, e.y + (y - e.y) * Math.min(1, dt * 3), e.z + z / l * k];
      if (d > 0.2) e.node.rotation.y = Math.atan2(x, z);
    } else e.walk({ x: x / l * Math.min(1, d), z: z / l * Math.min(1, d) }, speed);
    return d;
  }
  function nearest(list, from, pred, max = Infinity) {
    let best = null, bd = max;
    for (const o of list) { if (!pred(o)) continue; const d = Math.hypot(o.x - from.x, o.z - from.z); if (d < bd) { best = o; bd = d; } }
    return best;
  }
  function targetsNear(e, team, sight) {
    let best = null, bd = sight;
    const consider = (o) => { if (!hostileTo(team, o)) return; const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < bd) { best = o; bd = d; } };
    for (const o of units) consider(o);
    for (const o of buildings) consider(o);
    if (team === myTeam()) for (const o of W().entities) if (o.tag === 'enemy' && !o._rts) consider(o);
    return best;
  }
  function home(e, team) { return nearest(buildings, e, (b) => b.alive && teamOf(b) === team && b._rts && b._rts.dropoff); }

  H.behavior('unit', {
    title: 'A unit', group: 'Strategy', icon: '🪖',
    says: (o) => `a ${o.team} ${o.role}: ${o.hp} health${o.gather ? ', gathers' : ''}`,
    defaults: { team: 'blue', role: 'soldier', hp: 100, speed: 4, damage: 8, range: 8, rate: 1, sight: 16, gather: 0, fly: 0 },
    settings: [
      { key: 'team', label: 'Side', type: 'choice', options: Object.keys(COLORS) },
      { key: 'role', label: 'Kind', type: 'choice', options: Object.keys(UNITS) },
      { key: 'hp', label: 'Health', type: 'number', min: 1, max: 5000 },
      { key: 'speed', label: 'Speed', type: 'number', min: 0, max: 30, unit: 'm/s' },
      { key: 'damage', label: 'Damage', type: 'number', min: 0, max: 500 },
      { key: 'range', label: 'Range', type: 'number', min: 0, max: 60, unit: 'm' },
      { key: 'gather', label: 'Gathers a trip', type: 'number', min: 0, max: 100 },
      { key: 'fly', label: 'Flies at', type: 'number', min: 0, max: 50, unit: 'm' },
    ],
    start(e, o, s) {
      if (e.hp === undefined) { e.maxHp = e.hp = Number(o.hp) || 100; }
      e.data.team = String(o.team || 'blue');
      e.data.role = String(o.role || 'soldier');
      e._rts = { unit: true, s };
      s.order = null; s.cool = Math.random(); s.look = 0; s.carry = 0; s.fly = Number(o.fly) || 0; s.gatherN = Number(o.gather) || 0;
      if (s.fly) { e.gravity = 0; s.flyBase = e.y - s.fly; }
      s.marks = marks(e, colorOf(e.data.team));
      units.add(e);
      e.onDestroy(() => { units.delete(e); state.sel.delete(e); });
    },
    update(e, dt, o, s, g) {
      showMarks(e, s);
      if (e.remote || e.dead || !on()) { if (!e.remote && e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0); return; }
      const team = e.data.team, ord = s.order || { type: 'idle' };
      s.cool -= dt; s.look -= dt;
      const speed = Number(o.speed) || 4, range = Math.max(0.5, Number(o.range) || 1.6) + e.half[0];
      // Who to fight: the one ordered, else (not just moving) the nearest seen.
      if (ord.type !== 'move' && ord.type !== 'gather' && s.look <= 0) {
        s.look = 0.3;
        if (!(ord.target && ord.target.alive && !ord.target.dead)) s.foe = Number(o.damage) > 0 ? targetsNear(e, team, Number(o.sight) || 16) : null;
      }
      const foe = ord.target && ord.target.alive && !ord.target.dead && ord.type === 'attack' ? ord.target : s.foe && s.foe.alive && !s.foe.dead ? s.foe : null;
      if (foe && ord.type !== 'move' && ord.type !== 'gather') {
        const d = Math.hypot(foe.x - e.x, foe.z - e.z) - Math.max(foe.half[0], foe.half[2]);
        if (d > range && ord.type !== 'hold') steer(e, [foe.x, foe.y, foe.z], speed, s, dt);
        else {
          if (!s.fly && e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0);
          e.lookAt([foe.x, foe.y, foe.z]);
          if (s.cool <= 0 && d <= range + 0.3) { s.cool = Number(o.rate) || 1; shoot(e, foe, Number(o.damage) || 8, colorOf(team)); }
        }
        return;
      }
      if (ord.type === 'attack' && !(ord.target && ord.target.alive)) { s.order = null; return; }
      if (ord.type === 'move' || ord.type === 'amove') {
        if (steer(e, ord.to, speed, s, dt) < Math.max(0.8, ord.spread || 0)) s.order = null;
        return;
      }
      if (ord.type === 'gather') return gather(e, o, s, ord, dt);
      if (!s.fly && e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0);
      else if (s.fly) steer(e, [e.x, e.y, e.z], 0, s, dt);
    },
    stop(e, o, s) { if (s.marks) { s.marks.ring.dispose(); s.marks.bar.dispose(); } units.delete(e); },
  });
  /** A worker's round: to the resource, a moment's work, home with it, and back. */
  function gather(e, o, s, ord, dt) {
    const team = e.data.team, speed = Number(o.speed) || 4, n = Number(o.gather) || 0;
    if (!n) { s.order = null; return; }
    if (s.carry >= n || (s.carry && !(ord.target && ord.target.alive))) {
      const b = home(e, team);
      if (!b) { s.order = null; return; }
      if (steer(e, [b.x, b.y, b.z], speed, s, dt) < Math.max(b.half[0], b.half[2]) + e.half[0] + 1) {
        addRes(team, ord.kind || 'crystal', s.carry);
        G().emit('gathered', { team, kind: ord.kind || 'crystal', amount: s.carry, unit: e });
        s.carry = 0; s.work = 0;
      }
      return;
    }
    const r = ord.target && ord.target.alive ? ord.target : nearest(resources, e, (x) => x.alive && (x.data.amount || 0) > 0, 60);
    if (!r) { s.order = s.carry ? s.order : null; return; }
    ord.target = r; ord.kind = r.data.kind || 'crystal';
    if (steer(e, [r.x, r.y, r.z], speed, s, dt) > Math.max(r.half[0], r.half[2]) + e.half[0] + 0.8) return;
    if (!s.fly && e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0);
    s.work = (s.work || 0) + dt;
    if (s.work < 1.4) return;
    s.work = 0;
    const take = Math.min(n, r.data.amount || 0);
    r.data.amount = (r.data.amount || 0) - take;
    s.carry += take;
    if (r.data.amount <= 0) { G().emit('depleted', { resource: r }); if (r._rts && r._rts.s) r.visible = false; r.destroy(); }
  }

  // ------------------------------------------------------------------ buildings and resources
  function makesOf(o) {
    const list = Array.isArray(o.makes) ? o.makes : String(o.makes || '').split(',').map((x) => x.trim()).filter(Boolean);
    return list.map((m) => (typeof m === 'string' ? { name: m, cost: (UNITS[m] || UNITS.soldier).cost, time: (UNITS[m] || UNITS.soldier).time } : { name: String(m.name || 'unit'), cost: Number(m.cost) || 0, time: Number(m.time) || 5, spec: m.spec || null }));
  }
  H.behavior('building', {
    title: 'A building', group: 'Strategy', icon: '🏭',
    says: (o) => `a ${o.team} building${o.makes ? ` that trains ${o.makes}` : ''}`,
    defaults: { team: 'blue', hp: 600, makes: 'worker,soldier', dropoff: true, rally: 6 },
    settings: [
      { key: 'team', label: 'Side', type: 'choice', options: Object.keys(COLORS) },
      { key: 'hp', label: 'Health', type: 'number', min: 1, max: 20000 },
      { key: 'makes', label: 'Trains', type: 'text' },
      { key: 'dropoff', label: 'Takes resources', type: 'bool' },
      { key: 'rally', label: 'New units stand', type: 'number', min: 2, max: 40, unit: 'm' },
    ],
    start(e, o, s) {
      if (e.hp === undefined) { e.maxHp = e.hp = Number(o.hp) || 600; }
      e.data.team = String(o.team || 'blue');
      e._rts = { building: true, dropoff: o.dropoff !== false, makes: makesOf(o), queue: [], s };
      s.marks = marks(e, colorOf(e.data.team));
      buildings.add(e);
      e.onDestroy(() => { buildings.delete(e); state.sel.delete(e); });
    },
    update(e, dt, o, s) {
      showMarks(e, s);
      if (e.remote || e.dead || !on() || !host()) return;
      const q = e._rts.queue;
      if (!q.length) return;
      q[0].left -= dt;
      if (q[0].left > 0) return;
      const it = q.shift();
      const yaw = e.node.rotation.y, r = (Number(o.rally) || 6) + Math.max(e.half[0], e.half[2]);
      const k = (s.made = (s.made || 0) + 1);
      const at = [e.x + Math.sin(yaw) * r + ((k % 3) - 1) * 1.6, e.y - e.half[1] + 0.2, e.z + Math.cos(yaw) * r + (Math.floor(k / 3) % 3 - 1) * 1.6];
      const spec = it.spec ? JSON.parse(JSON.stringify(it.spec)) : unitSpec(it.name, e.data.team, at);
      if (it.spec) {
        spec.transform = { ...(spec.transform || {}), position: at };
        spec.behaviors = (spec.behaviors || []).some((b) => b.use === 'unit') ? spec.behaviors : [...(spec.behaviors || []), { use: 'unit', team: e.data.team, role: it.name }];
      }
      if ((UNITS[it.name] || {}).fly) at[1] += UNITS[it.name].fly;
      spawnUnit(spec, at, e.data.team);
    },
    stop(e, o, s) { if (s.marks) { s.marks.ring.dispose(); s.marks.bar.dispose(); } buildings.delete(e); },
  });
  H.behavior('resource', {
    title: 'A resource', group: 'Strategy', icon: '💎',
    says: (o) => `${o.amount} ${o.kind} to gather`,
    defaults: { kind: 'crystal', amount: 500 },
    settings: [{ key: 'kind', label: 'What', type: 'text' }, { key: 'amount', label: 'How much', type: 'number', min: 1, max: 100000 }],
    start(e, o, s) {
      e.data.kind = String(o.kind || 'crystal');
      if (e.data.amount === undefined) e.data.amount = Number(o.amount) || 500;
      e._rts = { resource: true, s };
      resources.add(e);
      e.onDestroy(() => resources.delete(e));
    },
    stop(e) { resources.delete(e); },
  });
  function spawnUnit(spec, at, team) {
    let made = [];
    if (H.mayhem && H.mayhem.spawnMany) made = H.mayhem.spawnMany(spec, 1, { at, ground: false, effects: true, arrive: 'beam' }) || [];
    else { try { const x = H.fromSpec(spec); x.temporary = true; made = [x]; } catch (err) { H.report(err, 'rts'); } }
    for (const u of made) G().emit('trained', { team, unit: u, role: u.data.role });
    return made[0] || null;
  }

  // ------------------------------------------------------------------ the sides' resources (the host keeps them)
  function addRes(team, kind, n) { const r = state.res[team] || (state.res[team] = {}); r[kind] = Math.max(0, (r[kind] || 0) + n); hud.dirty = true; }
  const resOf = (team, kind = 'crystal') => ((state.res[team] || {})[kind] || 0);
  function train(b, name) {
    const r = b && b._rts;
    if (!r || !r.makes) return false;
    const m = r.makes.find((x) => x.name === name);
    if (!m || r.queue.length >= 8) return false;
    const team = teamOf(b), kind = (cfg() && cfg().currency) || 'crystal';
    if (resOf(team, kind) < m.cost) return false;
    addRes(team, kind, -m.cost);
    r.queue.push({ name: m.name, left: m.time, time: m.time, spec: m.spec });
    return true;
  }

  // ------------------------------------------------------------------ commands (to the host)
  function order(list, ord) {
    const n = list.length, cols = Math.ceil(Math.sqrt(n));
    list.forEach((u, i) => {
      if (!u._rts || !u._rts.s) return;
      const o = { ...ord };
      if (o.to && n > 1 && o.type !== 'gather') {
        const gap = 1.8, cx = (i % cols) - (cols - 1) / 2, cz = Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2;
        o.to = [o.to[0] + cx * gap, o.to[1], o.to[2] + cz * gap];
        o.spread = 0.8;
      }
      if (o.type === 'gather' && !u._rts.s.gatherN) o.type = 'move';
      u._rts.s.order = o; u._rts.s.foe = null;
    });
  }
  const byId = (id) => [...units, ...buildings, ...resources].find((e) => e.sceneId === id) || null;
  const cmdAction = H.sync && H.sync.action ? H.sync.action('rts:cmd', (d, info) => {
    if (!info || !info.authoritative || !d || !Array.isArray(d.ids)) return;
    const list = d.ids.map(byId).filter((u) => u && u.alive && u._rts && u._rts.unit && teamOf(u) === d.team);
    const t = d.target ? byId(d.target) : null;
    order(list, { type: d.type, to: d.to || null, target: t, kind: t && t.data.kind });
  }) : null;
  const makeAction = H.sync && H.sync.action ? H.sync.action('rts:make', (d, info) => {
    if (!info || !info.authoritative || !d) return;
    const b = byId(d.id);
    if (b && teamOf(b) === d.team) train(b, d.unit);
  }) : null;
  function command(type, o = {}) {
    const ids = [...state.sel].filter((u) => u.alive && u._rts && u._rts.unit).map((u) => u.sceneId).filter(Boolean);
    if (!ids.length) return false;
    const d = { ids, team: myTeam(), type, to: o.to ? o.to.map((v) => Math.round(v * 100) / 100) : null, target: o.target ? o.target.sceneId : null };
    if (cmdAction) cmdAction(d); else order([...state.sel].filter((u) => u._rts && u._rts.unit), { type, to: d.to, target: o.target });
    flag(o.to || (o.target && o.target.position), type);
    return true;
  }
  function makeAt(b, unit) {
    const d = { id: b.sceneId, team: myTeam(), unit };
    if (makeAction && b.sceneId) makeAction(d); else train(b, unit);
  }
  /** Where a command was sent: a small ring that fades. */
  function flag(at, type) {
    if (!at || !W()) return;
    const scene = W().scene;
    const r = B.MeshBuilder.CreateTorus('rts-flag', { diameter: 1.4, thickness: 0.07, tessellation: 20 }, scene);
    const m = new B.StandardMaterial('rts-flag', scene); m.disableLighting = true; m.emissiveColor = hex(type === 'attack' || type === 'amove' ? '#ef4444' : type === 'gather' ? '#38bdf8' : '#22c55e');
    r.material = m; r.isPickable = false; r.position.set(at[0], at[1] + 0.1, at[2]);
    flags.push({ r, m, t: 0 });
  }
  const flags = [];
  function runFlags(dt) {
    for (let i = flags.length - 1; i >= 0; i--) {
      const f = flags[i];
      f.t += dt; f.r.scaling.setAll(1 + f.t * 1.5); f.m.alpha = Math.max(0, 1 - f.t * 2.5);
      if (f.t > 0.4) { f.r.dispose(); f.m.dispose(); flags.splice(i, 1); }
    }
  }

  // ------------------------------------------------------------------ the commander's hands: select and command
  const canvas = () => document.getElementById('stage');
  const drag = { down: null, box: null, el: null };
  function pickAt(x, y) {
    const w = W();
    if (!w) return null;
    const r = canvas().getBoundingClientRect();
    const hit = w.scene.pick(x - r.left, y - r.top, (m) => m.isPickable && m.isEnabled() && !(m.metadata && m.metadata.decor));
    let e = null;
    if (hit && hit.pickedMesh) { let n = hit.pickedMesh; while (n && !e) { e = [...W().entities].find((x2) => x2.node === n) || null; n = n.parent; } }
    let point = hit && hit.pickedPoint ? [hit.pickedPoint.x, hit.pickedPoint.y, hit.pickedPoint.z] : null;
    if (!point) {
      // Nothing under the mouse (space): the plane your units are on.
      const ray = w.scene.createPickingRay(x - r.left, y - r.top, B.Matrix.Identity(), w.scene.activeCamera);
      const sel = [...state.sel], py = sel.length ? sel.reduce((a, u) => a + u.y - (u._rts.s.fly || 0), 0) / sel.length : 0;
      if (Math.abs(ray.direction.y) > 1e-4) { const t = (py - ray.origin.y) / ray.direction.y; if (t > 0) point = [ray.origin.x + ray.direction.x * t, py, ray.origin.z + ray.direction.z * t]; }
    }
    return { entity: e && (e._rts ? e : null), any: e, point };
  }
  const mine = (e) => e && e.alive && e._rts && (e._rts.unit || e._rts.building) && teamOf(e) === myTeam();
  function select(list, add) {
    if (!add) state.sel.clear();
    for (const e of list) if (mine(e)) state.sel.add(e);
    hud.dirty = true;
    G().emit('selected', { things: [...state.sel] });
  }
  function boxSelect(a, b, add) {
    const w = W(), cam = w.scene.activeCamera, r = canvas().getBoundingClientRect();
    const x0 = Math.min(a[0], b[0]) - r.left, x1 = Math.max(a[0], b[0]) - r.left, y0 = Math.min(a[1], b[1]) - r.top, y1 = Math.max(a[1], b[1]) - r.top;
    const vp = cam.viewport.toGlobal(w.engine ? w.engine.getRenderWidth() : r.width, w.engine ? w.engine.getRenderHeight() : r.height);
    const sx = r.width / vp.width, sy = r.height / vp.height;
    const out = [];
    for (const u of units) {
      if (!mine(u)) continue;
      const p = B.Vector3.Project(new B.Vector3(u.x, u.y, u.z), B.Matrix.Identity(), w.scene.getTransformMatrix(), vp);
      if (p.z < 0 || p.z > 1) continue;
      const px = p.x * sx, py = p.y * sy;
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) out.push(u);
    }
    select(out, add);
  }
  function rightClick(ev) {
    const p = pickAt(ev.clientX, ev.clientY);
    if (!p) return;
    const t = p.entity || p.any;
    if (t && hostileTo(myTeam(), t)) command('attack', { target: t, to: [t.x, t.y, t.z] });
    else if (t && t._rts && t._rts.resource) command('gather', { target: t, to: [t.x, t.y, t.z] });
    else if (p.point) command(state.amove ? 'amove' : 'move', { to: p.point });
    state.amove = false;
    hud.dirty = true;
  }
  function leftClick(ev) {
    const p = pickAt(ev.clientX, ev.clientY);
    if (state.amove && p && p.point) { command('amove', { to: p.point }); state.amove = false; hud.dirty = true; return; }
    // A tap with units chosen on a phone commands (there is no right button).
    if (H.touchUi && state.sel.size && !(p && mine(p.entity))) { rightClick(ev); return; }
    if (p && mine(p.entity)) {
      if (ev.shiftKey && state.sel.has(p.entity)) { state.sel.delete(p.entity); hud.dirty = true; return; }
      select([p.entity], ev.shiftKey);
    } else if (!ev.shiftKey) select([], false);
  }
  function boxEl() {
    if (drag.el) return drag.el;
    const el = document.createElement('div');
    el.className = 'rts-box';
    document.body.appendChild(el);
    drag.el = el;
    return el;
  }
  window.addEventListener('pointerdown', (ev) => {
    if (!on() || ev.target !== canvas()) return;
    drag.down = { x: ev.clientX, y: ev.clientY, button: ev.button, shift: ev.shiftKey, moved: false };
  }, true);
  window.addEventListener('pointermove', (ev) => {
    const d = drag.down;
    if (!d || !on()) return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 6) d.moved = true;
    if (d.moved && d.button === 0 && !H.touchUi) {
      const el = boxEl();
      el.hidden = false;
      el.style.left = `${Math.min(d.x, ev.clientX)}px`; el.style.top = `${Math.min(d.y, ev.clientY)}px`;
      el.style.width = `${Math.abs(ev.clientX - d.x)}px`; el.style.height = `${Math.abs(ev.clientY - d.y)}px`;
    }
  }, true);
  window.addEventListener('pointerup', (ev) => {
    const d = drag.down;
    drag.down = null;
    if (drag.el) drag.el.hidden = true;
    if (!d || !on()) return;
    if (d.button === 2) { if (!d.moved) rightClick(ev); return; } // (a right drag turns the camera)
    if (d.button !== 0) return;
    if (d.moved && !H.touchUi) boxSelect([d.x, d.y], [ev.clientX, ev.clientY], d.shift);
    else if (!d.moved) leftClick(ev);
  }, true);

  // ------------------------------------------------------------------ the HUD: resources, the selection, training
  const hud = {
    el: null, dirty: true,
    make() {
      const css = document.createElement('style');
      css.textContent = `
        .rts-box { position: fixed; z-index: 7; border: 1px solid #7dd3fc; background: rgba(125,211,252,.12); pointer-events: none; }
        .rts-hud { position: fixed; inset: auto 0 0 0; z-index: 5; pointer-events: none; font: 600 12px/1.25 system-ui, sans-serif; color: #e8eef7; }
        .rts-res { position: fixed; top: max(10px, env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); background: rgba(10,14,22,.78); border: 1px solid rgba(255,255,255,.15); border-radius: 999px; padding: 6px 14px; display: flex; gap: 14px; pointer-events: auto; }
        .rts-panel { position: fixed; left: 50%; transform: translateX(-50%); bottom: max(12px, env(safe-area-inset-bottom)); background: rgba(10,14,22,.85); border: 1px solid rgba(255,255,255,.15); border-radius: 14px; padding: 8px 10px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: min(720px, calc(100vw - 24px)); pointer-events: auto; }
        .rts-panel button { min-height: 40px; min-width: 44px; padding: 6px 10px; border-radius: 9px; border: 1px solid rgba(255,255,255,.2); background: rgba(255,255,255,.08); color: inherit; font: inherit; cursor: pointer; }
        .rts-panel button:disabled { opacity: .45; cursor: default; }
        .rts-panel button.on { border-color: #ef4444; background: rgba(239,68,68,.25); }
        .rts-panel .rts-q { opacity: .8; font-weight: 500; }
        .rts-panel .rts-sel { opacity: .9; }`;
      document.head.appendChild(css);
      const el = document.createElement('div');
      el.className = 'rts-hud';
      el.innerHTML = '<div class="rts-res"></div><div class="rts-panel"></div>';
      el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
      el.addEventListener('click', (ev) => {
        const b = ev.target.closest && ev.target.closest('button');
        if (!b) return;
        const a = b.dataset.a;
        if (a === 'all') selectArmy();
        else if (a === 'stop') command('stop');
        else if (a === 'hold') command('hold');
        else if (a === 'amove') { state.amove = !state.amove; this.dirty = true; }
        else if (a === 'make') { const bl = [...state.sel].find((x) => x._rts && x._rts.building); if (bl) makeAt(bl, b.dataset.u); }
      });
      document.body.appendChild(el);
      this.el = el;
    },
    render() {
      if (!on()) { if (this.el) this.el.hidden = true; return; }
      if (!this.el) this.make();
      this.el.hidden = false;
      const team = myTeam(), kind = (cfg() && cfg().currency) || 'crystal';
      const mineN = [...units].filter((u) => teamOf(u) === team && u.alive).length;
      this.el.querySelector('.rts-res').innerHTML = `<span style="color:${colorOf(team)}">●</span><span>💎 ${Math.floor(resOf(team, kind))} ${kind}</span><span>🪖 ${mineN}</span>`;
      const sel = [...state.sel].filter((e) => e.alive);
      const bl = sel.find((x) => x._rts && x._rts.building);
      let h = '';
      if (bl && sel.length === 1) {
        const r = bl._rts;
        h += `<span class="rts-sel">${bl.name || 'Building'}</span>`;
        for (const m of r.makes) h += `<button type="button" data-a="make" data-u="${m.name}" ${resOf(team, kind) < m.cost ? 'disabled' : ''}>${m.name} · ${m.cost}</button>`;
        if (r.queue.length) h += `<span class="rts-q">training ${r.queue[0].name} ${Math.ceil(Math.max(0, r.queue[0].left))}s${r.queue.length > 1 ? ` +${r.queue.length - 1}` : ''}</span>`;
      } else if (sel.length) {
        const by = {};
        for (const u of sel) by[u.data.role || 'unit'] = (by[u.data.role || 'unit'] || 0) + 1;
        h += `<span class="rts-sel">${Object.entries(by).map(([k, n]) => `${n} ${k}`).join(', ')}</span>`;
        h += `<button type="button" data-a="amove" class="${state.amove ? 'on' : ''}" title="A">Attack-move</button><button type="button" data-a="stop" title="S">Stop</button><button type="button" data-a="hold" title="H">Hold</button>`;
      } else h += `<span class="rts-sel">${H.touchUi ? 'Tap a unit to choose it, then tap where to go' : 'Click a unit · drag a box · right-click to move or attack'}</span>`;
      h += '<button type="button" data-a="all" title="Q">Army</button>';
      const panel = this.el.querySelector('.rts-panel');
      if (panel.innerHTML !== h) panel.innerHTML = h;
      this.dirty = false;
    },
  };
  function selectArmy() { select([...units].filter((u) => mine(u) && u._rts.s && !u._rts.s.gatherN), false); }

  // ------------------------------------------------------------------ AI sides, waves, the end
  function aiStep(dt) {
    const c = cfg();
    if (!c || !c.teams) return;
    const kind = c.currency || 'crystal';
    for (const [team, t] of Object.entries(c.teams)) {
      if (!t || team === myTeam()) continue;
      const ai = state.ai[team] || (state.ai[team] = { think: 1, wave: Number(t.wave) || 4, waves: 0 });
      // Waves: units arrive at their buildings (or a point) every so often and attack.
      if (t.waves) {
        const wv = state.waves[team] || (state.waves[team] = { t: Number(t.waves.first ?? t.waves.every) || 45, n: 0 });
        wv.t -= dt;
        if (wv.t <= 0) {
          wv.t = Number(t.waves.every) || 45;
          wv.n++;
          const count = Math.min(40, (Number(t.waves.count) || 4) + (Number(t.waves.grow) || 0) * (wv.n - 1));
          const from = [...buildings].find((b) => teamOf(b) === team && b.alive);
          const at = Array.isArray(t.waves.at) ? t.waves.at : from ? [from.x, from.y, from.z] : null;
          if (at) {
            const made = [];
            const unit = t.waves.unit || 'soldier';
            for (let i = 0; i < count; i++) {
              const p = [at[0] + Math.cos(i * 2.4) * (3 + i * 0.4), at[1] + ((UNITS[unit] || {}).fly || 0.5), at[2] + Math.sin(i * 2.4) * (3 + i * 0.4)];
              const u = spawnUnit(unitSpec(unit, team, p), p, team);
              if (u) made.push(u);
            }
            G().emit('wave', { team, n: wv.n, count: made.length });
            if (G().ui && team !== myTeam()) G().ui.message(t.waves.title ? `${t.waves.title} ${wv.n}` : `Wave ${wv.n}: ${made.length} ${unit}s`, 2.4);
            ai.pending = made;
          }
        }
        if (ai.pending && ai.pending.length) {
          const goal = target(team);
          const list = ai.pending.filter((u) => u.alive && u._rts && u._rts.s);
          if (goal) { order(list, { type: 'amove', to: [goal.x, goal.y, goal.z] }); ai.pending = null; }
        }
      }
      if (!t.ai) continue;
      ai.think -= dt;
      if (ai.think > 0) continue;
      ai.think = 1;
      const mineU = [...units].filter((u) => teamOf(u) === team && u.alive);
      const workers = mineU.filter((u) => u._rts.s && u._rts.s.gatherN > 0);
      for (const w of workers) if (!w._rts.s.order) order([w], { type: 'gather' });
      const blds = [...buildings].filter((b) => teamOf(b) === team && b.alive);
      for (const b of blds) {
        const r = b._rts;
        if (r.queue.length) continue;
        const wantWorker = workers.length < (Number(t.workers) || 4) && r.makes.find((m) => (UNITS[m.name] || {}).gather);
        const fighters = r.makes.filter((m) => !(UNITS[m.name] || {}).gather);
        const pick = wantWorker || fighters[Math.floor(Math.random() * fighters.length)];
        if (pick) train(b, pick.name);
      }
      const army = mineU.filter((u) => !u._rts.s.gatherN && !u._rts.s.order);
      if (army.length >= ai.wave) {
        const goal = target(team);
        if (goal) { order(army, { type: 'amove', to: [goal.x, goal.y, goal.z] }); ai.wave += Number(t.grow) || 2; ai.waves++; G().emit('attack', { team, count: army.length }); }
      }
    }
  }
  /** Where a side attacks: the player's side's nearest building, else its units. */
  function target(team) {
    const from = [...buildings].find((b) => teamOf(b) === team && b.alive) || [...units].find((u) => teamOf(u) === team && u.alive);
    if (!from) return null;
    return nearest(buildings, from, (b) => b.alive && hostileTo(team, b)) || nearest(units, from, (u) => u.alive && hostileTo(team, u));
  }
  function checkEnd() {
    const c = cfg();
    if (!c || c.win === false || state.over) return;
    const teams = new Set([myTeam(), ...Object.keys(c.teams || {}), ...[...buildings].map(teamOf)]);
    const alive = (t) => [...buildings].some((b) => teamOf(b) === t && b.alive && !b.dead);
    const had = (t) => state.had && state.had.has(t);
    state.had = state.had || new Set();
    for (const t of teams) if (alive(t)) state.had.add(t);
    if (had(myTeam()) && !alive(myTeam())) { state.over = true; G().emit('rts', { lost: true }); G().over(c.lose || 'Your base has fallen'); return; }
    const foes = [...teams].filter((t) => t !== myTeam() && had(t));
    if (foes.length && foes.every((t) => !alive(t))) { state.over = true; G().emit('rts', { won: true }); G().over(c.winText || 'Victory: every enemy base is down'); }
  }

  // ------------------------------------------------------------------ every step
  H.hooks.step.push((dt) => {
    if (!on()) return;
    if (host()) { aiStep(dt); checkEnd(); }
  });
  let hudT = 0;
  H.hooks.frame.push((dt) => {
    hudT -= dt;
    if (!W()) return;
    runFlags(dt);
    if (hudT <= 0 || hud.dirty) { hudT = 0.25; hud.render(); }
    if (!on()) return;
    const g = G();
    if (!g) return;
    if (g.input.pressed('a') && state.sel.size) { state.amove = !state.amove; hud.dirty = true; }
    if (g.input.pressed('s') && state.sel.size) command('stop');
    if (g.input.pressed('h') && state.sel.size) command('hold');
    if (g.input.pressed('q')) selectArmy();
  });
  // The sides' resources: the host's are everyone's.
  if (H.sync && H.sync.state) H.sync.state('rts', { rate: 2, get: () => ({ r: state.res }), set: (st) => { if (st && st.r && !host()) { state.res = st.r; hud.dirty = true; } } });

  // A new world: its config's resources, nothing chosen.
  H.hooks.world.push({
    enter() {
      state.res = {}; state.sel.clear(); state.over = false; state.waves = {}; state.ai = {}; state.had = null; state.amove = false;
      const c = cfg();
      if (!c) return;
      const kind = c.currency || 'crystal';
      const start = c.resources && typeof c.resources === 'object' ? c.resources : { [kind]: Number(c.resources) || 200 };
      for (const t of new Set([myTeam(), ...Object.keys(c.teams || {})])) {
        const own = c.teams && c.teams[t] && c.teams[t].resources;
        state.res[t] = { ...(own && typeof own === 'object' ? own : own !== undefined ? { [kind]: Number(own) } : start) };
      }
    },
    leave() { units.clear(); buildings.clear(); resources.clear(); state.sel.clear(); },
  });

  const api = {
    get on() { return on(); },
    get team() { return myTeam(); },
    get selected() { return [...state.sel]; },
    units: (team) => [...units].filter((u) => u.alive && (!team || teamOf(u) === team)),
    buildings: (team) => [...buildings].filter((b) => b.alive && (!team || teamOf(b) === team)),
    resources: () => [...resources].filter((r) => r.alive),
    select: (list, add = false) => select([].concat(list || []), add),
    /** Orders units (host or offline): { type: 'move' | 'amove' | 'attack' | 'gather' | 'stop' | 'hold', to, target }. */
    order: (list, o) => order([].concat(list || []).filter((u) => u && u._rts && u._rts.unit), { ...o, to: o.to ? H.lib.vec(o.to) : null }),
    command: (type, o) => command(type, o || {}),
    train: (building, unit) => train(building, unit),
    /** A building learns to train another unit (a name, or { name, cost, time, spec }): progression. */
    unlock: (building, m) => { const r = building && building._rts; if (!r || !r.makes) return false; const [x] = makesOf({ makes: [m] }); if (!r.makes.some((y) => y.name === x.name)) r.makes.push(x); hud.dirty = true; return true; },
    spawn: (unit, team, at) => spawnUnit(unitSpec(unit, team, H.lib.vec(at)), H.lib.vec(at), team),
    resource: (team, kind) => resOf(team || myTeam(), kind || (cfg() && cfg().currency) || 'crystal'),
    give: (team, n, kind) => addRes(team || myTeam(), kind || (cfg() && cfg().currency) || 'crystal', Number(n) || 0),
    UNITS,
    _: { state, hud, pickAt, leftClick, rightClick },
  };
  H.rts = api;
  H.hooks.game.push((game) => { game.rts = api; });
})();
