// The house planner: words in (rooms, floors, style), a list of pieces out (floors, walls with doors and windows cut
// in, stairs, railings, a roof, doors, lights and switches, furniture per room). Pure JavaScript with no Babylon, so
// the engine tests run it in Node; house.js turns the pieces into things. Coordinates are the house's own: meters
// from the middle of its footprint at ground level, the front door on the -z side.
/* global HawkesPlay */
(function (root) {
  'use strict';
  const STYLES = {
    cozy: { ext: '#e9d8c4', int: '#f3e9dc', floor: '#b07a4f', roof: '#a0463a', trim: '#ffffff', door: '#7a4a2a', sofa: '#6d7fb3', bed: '#5b7fd1', roofShape: 'gable' },
    modern: { ext: '#f5f5f5', int: '#fafafa', floor: '#c9c9c9', roof: '#3b3f4a', trim: '#22252b', door: '#30343b', sofa: '#8d99ae', bed: '#2b2d42', roofShape: 'flat' },
    cabin: { ext: '#8a5a33', int: '#c8a27a', floor: '#7a5532', roof: '#4a5a3a', trim: '#5b3d22', door: '#5b3d22', sofa: '#9c4a3a', bed: '#7a3b2e', roofShape: 'gable' },
    brick: { ext: '#a5533f', int: '#efe6d6', floor: '#9a6a3e', roof: '#3d3d46', trim: '#f1ece2', door: '#2f4a3a', sofa: '#3f6e5a', bed: '#b35a4a', roofShape: 'gable' },
    beach: { ext: '#bfe3f0', int: '#fffaf0', floor: '#e8d9b5', roof: '#f2f2f2', trim: '#ffffff', door: '#3a86b4', sofa: '#f4a261', bed: '#2a9d8f', roofShape: 'gable' },
    castle: { ext: '#8d8d93', int: '#b7b2a6', floor: '#6e6a63', roof: '#4a4a6a', trim: '#6c6c72', door: '#4a2f1e', sofa: '#7b2d26', bed: '#5a2a6a', roofShape: 'flat' },
    pastel: { ext: '#ffd6e0', int: '#fff5f8', floor: '#e2c2a5', roof: '#9b5de5', trim: '#ffffff', door: '#00bbf9', sofa: '#f15bb5', bed: '#00bbf9', roofShape: 'gable' },
  };
  const ROOM_TYPES = ['living', 'kitchen', 'bedroom', 'bathroom', 'dining', 'office', 'music', 'kids', 'studio', 'garage', 'hall'];
  const ALIASES = { 'living room': 'living', lounge: 'living', 'tv room': 'living', 'family room': 'living', bed: 'bedroom', 'master bedroom': 'bedroom', bath: 'bathroom', toilet: 'bathroom', restroom: 'bathroom', study: 'office', 'dining room': 'dining', kitchenette: 'kitchen', 'music room': 'music', nursery: 'kids', playroom: 'kids', 'kids room': 'kids', 'tv studio': 'studio', hallway: 'hall', entrance: 'hall', room: 'hall' };
  const GROUND = { living: 0, kitchen: 1, dining: 2, hall: 3, garage: 4, studio: 5, music: 6 };
  const NAMES = { living: 'Living room', kitchen: 'Kitchen', bedroom: 'Bedroom', bathroom: 'Bathroom', dining: 'Dining room', office: 'Office', music: 'Music room', kids: 'Kids\' room', studio: 'TV studio', garage: 'Garage', hall: 'Hall' };
  const DEFAULT_ROOMS = ['living', 'kitchen', 'bedroom', 'bathroom', 'office', 'bedroom', 'dining', 'kids'];

  const r2 = (n) => Math.round(n * 1000) / 1000;
  function roomList(v) {
    if (Array.isArray(v)) return v.slice(0, 16).map((x) => (typeof x === 'object' && x ? x : { type: String(x) }));
    const n = Math.max(1, Math.min(16, Math.round(Number(v) || 4)));
    return Array.from({ length: n }, (_, i) => ({ type: DEFAULT_ROOMS[i % DEFAULT_ROOMS.length] }));
  }
  const typeOf = (t) => { const s = String(t || 'hall').toLowerCase().trim(); if (ROOM_TYPES.includes(s)) return s; if (ALIASES[s]) return ALIASES[s]; const hit = ROOM_TYPES.find((k) => s.includes(k)); return hit || (s.includes('live') ? 'living' : 'hall'); };

  /** Rectangle [x0, z0, x1, z1] minus holes: the pieces that are left. */
  function subtract(rect, holes) {
    let out = [rect];
    for (const h of holes) {
      const next = [];
      for (const r of out) {
        const [ax0, az0, ax1, az1] = r;
        const ix0 = Math.max(ax0, h[0]), iz0 = Math.max(az0, h[1]), ix1 = Math.min(ax1, h[2]), iz1 = Math.min(az1, h[3]);
        if (ix0 >= ix1 || iz0 >= iz1) { next.push(r); continue; }
        if (az0 < iz0) next.push([ax0, az0, ax1, iz0]);
        if (iz1 < az1) next.push([ax0, iz1, ax1, az1]);
        if (ax0 < ix0) next.push([ax0, iz0, ix0, iz1]);
        if (ix1 < ax1) next.push([ix1, iz0, ax1, iz1]);
      }
      out = next;
    }
    return out.filter((r) => r[2] - r[0] > 0.01 && r[3] - r[1] > 0.01);
  }

  /** A straight wall from (x0, z0) along x (dir 'x') or z, `len` long, with openings cut in: solid boxes around them. */
  function wallPieces(o) {
    const { x0, z0, dir, len, y0, h, t, openings = [], role } = o;
    const out = [];
    const box = (a, b, ya, yb) => {
      if (b - a < 0.02 || yb - ya < 0.02) return;
      const mid = (a + b) / 2, cy = (ya + yb) / 2;
      out.push({ kind: 'box', role, size: dir === 'x' ? [b - a, yb - ya, t] : [t, yb - ya, b - a], at: dir === 'x' ? [x0 + mid, cy, z0] : [x0, cy, z0 + mid] });
    };
    let cur = 0;
    const ops = openings.slice().sort((a, b) => a.at - b.at);
    for (const op of ops) {
      const a = Math.max(cur, op.at - op.width / 2), b = Math.min(len, op.at + op.width / 2);
      box(cur, a, y0, y0 + h);
      box(a, b, op.top, y0 + h);
      if (op.bottom > y0 + 0.01) box(a, b, y0, op.bottom);
      if (op.kind === 'window') out.push({ kind: 'glass', size: dir === 'x' ? [b - a, op.top - op.bottom, 0.03] : [0.03, op.top - op.bottom, b - a], at: dir === 'x' ? [x0 + (a + b) / 2, (op.top + op.bottom) / 2, z0] : [x0, (op.top + op.bottom) / 2, z0 + (a + b) / 2] });
      cur = b;
    }
    box(cur, len, y0, y0 + h);
    return out;
  }

  /** Furniture for a kind of room, in the room's own space (meters from its middle; its front is -z), for a 5 m room. */
  function furnishing(type, o) {
    const s = o.style;
    const tvChannels = o.tv;
    const F = [];
    const add = (kind, x, z, yaw = 0, extra = {}) => F.push({ kind, x, z, yaw, ...extra });
    if (type === 'living') {
      add('rug', -1.2, 0.1, 0, { shape: { size: [2.6, 1.8] }, color: '#b4553e', y: 0.006 });
      add('sofa', -1.2, 1.75, 180, { shape: { seats: 3 }, color: s.sofa });
      add('tv', -1.2, -1.95, 0, { shape: { width: 1.2, ...(tvChannels ? { channels: tvChannels } : {}) } });
      add('table', -1.2, 0.2, 0, { shape: { size: [1.1, 0.42, 0.6] }, color: '#7a5532' });
      add('remote', -1.0, 0.2, 20, { y: 0.42 });
      add('lamp', -2.15, 1.95, 0, {});
      add('plant', 1.95, -1.95, 0, {});
      add('shelf', 1.8, 2.2, 180, { shape: { size: [1, 1.9, 0.35] } });
      add('clock', 1.2, -2.38, 0, { y: 2.15, wall: true });
      add('radio', 2.0, 1.2, 270, { y: 0.0, onTable: true });
    } else if (type === 'kitchen') {
      add('fridge', -2.0, 2.05, 180, { data: { items: ['milk', 'apple', 'cheese', 'juice', 'cake', 'eggs'] } });
      add('cupboard', -1.15, 2.15, 180, { shape: { size: [0.9, 0.9, 0.6] }, data: { items: ['bread', 'banana'] }, color: '#c7b299' });
      add('sink', 1.0, 2.15, 180, { shape: { size: [0.9, 0.9, 0.6] } });
      add('oven', 1.8, 2.15, 180, {});
      add('table', -1.2, -0.9, 0, { shape: { size: [1.0, 0.75, 1.0], round: true }, color: '#a57548' });
      add('chair', -1.95, -0.9, 90, { color: '#a0703f' });
      add('chair', -0.45, -0.9, 270, { color: '#a0703f' });
      add('clock', 1.4, -2.38, 0, { y: 2.15, wall: true, shape: { digital: true } });
    } else if (type === 'bedroom') {
      add('rug', -1.4, 0.3, 0, { shape: { size: [2.2, 1.4] }, color: '#7a8bb5', y: 0.006 });
      add('bed', -1.4, 1.3, 180, { color: s.bed });
      add('table', -0.25, 2.1, 0, { shape: { size: [0.45, 0.5, 0.4] }, color: '#7a5532' });
      add('lamp', -0.25, 2.1, 0, { y: 0.5, shape: { table: true } });
      add('cupboard', 1.7, 2.1, 180, { shape: { size: [1.1, 2, 0.6] }, color: '#b08a5a' });
      add('plant', 2.0, -1.95, 0, { shape: { height: 0.8 } });
      add('clock', -1.4, -2.38, 0, { y: 2.1, wall: true });
    } else if (type === 'bathroom') {
      add('bathtub', -1.4, -1.95, 90, {});
      add('toilet', 1.9, 2.05, 180, {});
      add('sink', 0.95, 2.15, 180, { shape: { size: [0.7, 0.85, 0.5] } });
      if (o.shower) add('shower', 1.9, -1.9, 0, {});
      add('duck', -1.4, -1.95, 0, { y: 0.2 });
    } else if (type === 'dining') {
      add('table', -1.1, 0.6, 0, { shape: { size: [1.4, 0.75, 0.8] }, color: '#8a5a33' });
      for (const [x, z, y] of [[-1.45, 0.0, 0], [-0.75, 0.0, 0], [-1.45, 1.2, 180], [-0.75, 1.2, 180]]) add('chair', x, z, y, { color: '#6b4a2b' });
      add('cupboard', 1.8, 2.15, 180, { shape: { size: [1.2, 0.9, 0.5] }, color: '#8a5a33', data: { items: ['cake', 'soda'] } });
      add('plant', 2.0, -2.0, 0, {});
    } else if (type === 'office') {
      add('desk', -1.4, 2.05, 180, {});
      add('computer', -1.5, 2.05, 180, { y: 0.75, shape: { channels: ['desktop', { camera: `${o.key}/cam`, title: 'Front door camera' }, 'news', 'clock'] } });
      add('phone', -0.95, 1.95, 160, { y: 0.75 });
      add('chair', -1.45, 1.3, 0, { color: '#30343b' });
      add('shelf', 1.6, 2.2, 180, {});
      add('lamp', 2.1, -2.0, 0, {});
    } else if (type === 'music') {
      add('piano', -1.2, 2.05, 180, {});
      add('sofa', 1.4, -1.9, 0, { shape: { seats: 2 }, color: s.sofa });
      add('radio', 2.0, 1.6, 270, { onTable: true });
      add('rug', -0.5, 0, 0, { shape: { size: [2, 2], round: true }, color: '#5a6fb3', y: 0.006 });
    } else if (type === 'kids') {
      add('rug', 0.3, 0, 0, { shape: { size: [2, 2], round: true }, color: '#ffd166', y: 0.006 });
      add('bed', -1.7, 1.35, 180, { shape: { size: 'single' }, color: '#ef476f' });
      add('shelf', 1.6, 2.2, 180, { shape: { size: [1, 1.2, 0.35] } });
      for (const [x, z, c] of [[0.6, -0.4, '#ef476f'], [-0.2, 0.5, '#06d6a0'], [0.9, 0.6, '#118ab2']]) add('ball', x, z, 0, { color: c, y: 0.25 });
      add('lamp', 2.0, -2.0, 0, { shape: { table: true } });
    } else if (type === 'studio') {
      add('desk', -1.1, 1.2, 180, { shape: { size: [1.6, 0.75, 0.6] }, color: '#1d3557' });
      add('host', -1.1, 1.85, 180, {});
      add('cctv', -1.1, -2.1, 0, { y: 1.75, shape: { pitch: 8, fov: 55 }, data: { show: o.show || 'Hawkes News Live' } });
      add('sign', -1.1, 2.38, 180, { y: 2.2, text: o.show || 'Hawkes News Live' });
      add('lamp', -2.1, 0.0, 0, { light: { color: '#ffffff', intensity: 1.0, range: 7 } });
      add('lamp', -0.1, 0.0, 0, { light: { color: '#ffffff', intensity: 1.0, range: 7 } });
      add('tv', 1.7, -1.95, 0, { shape: { width: 0.9, channels: [o.show || 'Hawkes News Live'] } });
    } else if (type === 'garage') {
      add('shelf', 1.9, 2.2, 180, { shape: { size: [1.2, 1.9, 0.45], books: false }, color: '#8d99ae' });
    } else {
      add('plant', 2.0, -2.0, 0, {});
    }
    return F;
  }

  /** The whole house: { size, floors, rooms, parts }. */
  function plan(opts = {}) {
    const style = STYLES[String(opts.style || 'cozy').toLowerCase()] || STYLES.cozy;
    const colors = { ...style, ...(opts.colors || {}) };
    const S = Math.max(3, Math.min(10, Number(opts.size) || 5));
    const SX = Math.max(3, Math.min(12, Number(opts.width) || S)), SZ = Math.max(3, Math.min(12, Number(opts.depth) || S));
    const Hf = Math.max(2.6, Math.min(5, Number(opts.height) || 3));
    const T = 0.2;
    const furnish = opts.furnish !== false;
    const key = String(opts.key || 'house');
    let rooms = roomList(opts.rooms).map((r, i) => ({ ...r, type: typeOf(r.type || r.name), order: i }));
    let floors = Math.max(1, Math.min(4, Math.round(Number(opts.floors) || (rooms.length > 4 ? 2 : 1))));
    // Rooms that belong downstairs go first (the living room by the front door), the rest fill the floors above.
    if (floors > 1) rooms.sort((a, b) => (GROUND[a.type] ?? 9) - (GROUND[b.type] ?? 9) || a.order - b.order);
    else rooms.sort((a, b) => (a.type === 'living' ? -1 : b.type === 'living' ? 1 : a.order - b.order));
    const perFloor = Math.max(Math.ceil(rooms.length / floors), floors > 1 ? 2 : 1);
    const cols = Math.max(1, Math.min(4, Number(opts.cols) || (perFloor <= 2 ? perFloor : perFloor <= 4 ? 2 : 3)));
    const rows = Math.ceil(perFloor / cols);
    const Wd = cols * SX, Dp = rows * SZ;
    const x0 = -Wd / 2, z0 = -Dp / 2;
    const stairCell = floors > 1 ? { c: cols - 1, r: rows - 1 } : null;
    const doorCell = { c: 0, r: 0 };
    const count = {};
    for (const r of rooms) count[r.type] = (count[r.type] || 0) + 1;
    const seen = {};
    // Cells in the order rooms fill them: the front door's cell first, then front to back.
    const cellOrder = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cellOrder.push({ c, r });
    const placed = [];
    let ri = 0;
    for (let f = 0; f < floors; f++) {
      const cells = cellOrder.slice().sort((a, b) => (a.c === doorCell.c && a.r === doorCell.r && f === 0 ? -1 : 0) - (b.c === doorCell.c && b.r === doorCell.r && f === 0 ? -1 : 0) || ((stairCell && a.c === stairCell.c && a.r === stairCell.r) ? 1 : 0) - ((stairCell && b.c === stairCell.c && b.r === stairCell.r) ? 1 : 0));
      // Rooms spread evenly over the floors; spare cells are halls (the stairs' cell is the last one filled).
      let take = Math.ceil((rooms.length - ri) / (floors - f));
      for (const cell of cells) {
        const room = ri < rooms.length && take-- > 0 ? rooms[ri++] : { type: 'hall' };
        seen[room.type] = (seen[room.type] || 0) + 1;
        const name = room.name || (count[room.type] > 1 ? `${NAMES[room.type]} ${seen[room.type]}` : NAMES[room.type]);
        placed.push({ ...room, name, floor: f, c: cell.c, r: cell.r, x: x0 + cell.c * SX + SX / 2, z: z0 + cell.r * SZ + SZ / 2, stairs: Boolean(stairCell && cell.c === stairCell.c && cell.r === stairCell.r) });
      }
    }
    const roomAt = (f, c, r) => placed.find((p) => p.floor === f && p.c === c && p.r === r);
    const parts = [];
    let n = 0;
    const push = (p) => { p.key = p.key || `${p.kind}${++n}`; parts.push(p); return p; };
    const floorTop = (f) => f * Hf + 0.15;

    // Stairs: a switchback in the back corner cell; floor f's run goes up along band (f % 2) of the back wall.
    const rise = 0.25, steps = Math.round(Hf / rise), tread = Math.min(0.3, (SX - 0.6) / (steps + 1));
    const stepRise = Hf / steps;
    const band = (f) => {
      if (!stairCell) return null;
      const cx0 = x0 + stairCell.c * SX, cz1 = z0 + (stairCell.r + 1) * SZ - T / 2;
      const w = Math.min(1.2, (SZ - 1) / 2);
      return f % 2 === 0
        ? { zA: cz1 - w, zB: cz1, xs: cx0 + 0.3, dir: 1, cx0 }
        : { zA: cz1 - 2 * w, zB: cz1 - w, xs: cx0 + SX - 0.3, dir: -1, cx0 };
    };
    const holes = (f) => { // the opening in floor f for the stairs coming up from f - 1
      if (f === 0 || !stairCell) return [];
      const b = band(f - 1);
      const run = tread * (steps - 1);
      const xa = b.dir > 0 ? b.cx0 + 0.1 : b.xs - run, xb = b.dir > 0 ? b.xs + run : b.cx0 + SX - 0.1;
      return [[Math.min(xa, xb), b.zA - 0.05, Math.max(xa, xb), b.zB]];
    };
    for (let f = 0; f <= floors; f++) {
      // Floor slabs (and the top one is the ceiling under the roof).
      const y0 = f === 0 ? 0 : f * Hf - 0.05, y1 = f === 0 ? 0.15 : f * Hf + 0.15;
      for (const r of subtract([x0, z0, x0 + Wd, z0 + Dp], f < floors ? holes(f) : [])) {
        push({ kind: 'box', role: f === floors ? 'ceiling' : 'floor', size: [r2(r[2] - r[0]), r2(y1 - y0), r2(r[3] - r[1])], at: [r2((r[0] + r[2]) / 2), r2((y0 + y1) / 2), r2((r[1] + r[3]) / 2)], step: f < floors, floor: f });
      }
      if (f === floors) break;
      // Railings around the stairwell's opening (not on the side you arrive from).
      for (const h of holes(f)) {
        const b = band(f - 1), ft = floorTop(f);
        push({ kind: 'box', role: 'trim', size: [r2(h[2] - h[0]), 0.9, 0.05], at: [r2((h[0] + h[2]) / 2), r2(ft + 0.45), r2(h[1] - 0.03)], floor: f });
        if (b.dir < 0) push({ kind: 'box', role: 'trim', size: [r2(h[2] - h[0]), 0.9, 0.05], at: [r2((h[0] + h[2]) / 2), r2(ft + 0.45), r2(h[3] + 0.03)], floor: f });
        const closed = b.dir > 0 ? h[0] : h[2];
        if (Math.abs(closed - (x0 + stairCell.c * SX)) > 0.2 && Math.abs(closed - (x0 + stairCell.c * SX + SX)) > 0.2) push({ kind: 'box', role: 'trim', size: [0.05, 0.9, r2(h[3] - h[1])], at: [r2(closed), r2(ft + 0.45), r2((h[1] + h[3]) / 2)], floor: f });
      }
      // The stairs up from this floor.
      if (stairCell && f < floors - 1) {
        const b = band(f);
        for (let i = 0; i < steps; i++) {
          const top = floorTop(f) + (i + 1) * stepRise;
          const xa = b.dir > 0 ? b.xs + i * tread : b.xs - (i + 1) * tread;
          push({ kind: 'box', role: 'stairs', size: [r2(tread), r2(top - floorTop(f) + 0.02), r2(b.zB - b.zA)], at: [r2(xa + tread / 2), r2((floorTop(f) - 0.02 + top) / 2), r2((b.zA + b.zB) / 2)], step: true, floor: f });
        }
      }
    }

    // Walls: the outside (windows, the front door) and between rooms (a doorway in each, with a door).
    const ext = (f) => ({ y0: f === 0 ? 0 : f * Hf - 0.05, h: f === 0 ? Hf - 0.05 : Hf });
    const doorOp = (at, f) => ({ kind: 'door', at, width: 0.95, bottom: floorTop(f), top: floorTop(f) + 2.12 });
    const winOp = (at, f, w = 1.2) => ({ kind: 'window', at, width: w, bottom: floorTop(f) + 0.9, top: floorTop(f) + 2.1 });
    const doors = []; // { at, yaw, floor, rooms: [a, b], front }
    const winsOn = opts.windows !== false;
    for (let f = 0; f < floors; f++) {
      const { y0, h } = ext(f);
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const cellX = x0 + c * SX, cellZ = z0 + r * SZ;
        const stairs = stairCell && c === stairCell.c && r === stairCell.r;
        const room = roomAt(f, c, r);
        // Front (-z) and back (+z) outside walls.
        if (r === 0) {
          const front = f === 0 && c === doorCell.c;
          const ops = front ? [doorOp(SX / 2, f)] : winsOn ? [winOp(SX / 2, f)] : [];
          for (const w of wallPieces({ x0: cellX - (c === 0 ? T / 2 : 0), z0: z0, dir: 'x', len: SX + (c === 0 ? T / 2 : 0) + (c === cols - 1 ? T / 2 : 0), y0, h, t: T, openings: ops.map((o) => ({ ...o, at: o.at + (c === 0 ? T / 2 : 0) })), role: 'ext' })) push({ ...w, floor: f });
          if (front) doors.push({ at: [cellX + SX / 2, floorTop(f), z0], yaw: 0, floor: f, rooms: [room], front: true });
        }
        if (r === rows - 1) {
          const ops = winsOn && !stairs ? [winOp(SX / 2, f)] : [];
          for (const w of wallPieces({ x0: cellX - (c === 0 ? T / 2 : 0), z0: z0 + Dp, dir: 'x', len: SX + (c === 0 ? T / 2 : 0) + (c === cols - 1 ? T / 2 : 0), y0, h, t: T, openings: ops.map((o) => ({ ...o, at: o.at + (c === 0 ? T / 2 : 0) })), role: 'ext' })) push({ ...w, floor: f });
        }
        // Left and right outside walls.
        if (c === 0 || c === cols - 1) {
          for (const side of c === 0 && c === cols - 1 ? [0, 1] : c === 0 ? [0] : [1]) {
            const wx = side === 0 ? x0 : x0 + Wd;
            const at = stairs ? Math.min(SZ / 2, 1.2) : SZ / 2;
            const ops = winsOn ? [winOp(at, f, stairs ? 0.9 : 1.2)] : [];
            for (const w of wallPieces({ x0: wx, z0: cellZ, dir: 'z', len: SZ, y0, h, t: T, openings: ops, role: 'ext' })) push({ ...w, floor: f });
          }
        }
        // Inside walls: to the right (+x) and to the back (+z) neighbor, each with a doorway.
        const ft = floorTop(f), ih = (f + 1) * Hf - 0.05 - ft;
        if (c < cols - 1) {
          const nStairs = stairCell && c + 1 === stairCell.c && r === stairCell.r;
          const at = stairs || nStairs ? Math.min(SZ / 2, 1.2) : SZ / 2;
          for (const w of wallPieces({ x0: cellX + SX, z0: cellZ + T / 2, dir: 'z', len: SZ - T, y0: ft, h: ih, t: T, openings: [doorOp(at - T / 2, f)], role: 'int' })) push({ ...w, floor: f });
          doors.push({ at: [cellX + SX, ft, cellZ + at], yaw: 90, floor: f, rooms: [room, roomAt(f, c + 1, r)] });
        }
        if (r < rows - 1) {
          for (const w of wallPieces({ x0: cellX + T / 2, z0: cellZ + SZ, dir: 'x', len: SX - T, y0: ft, h: ih, t: T, openings: [doorOp(SX / 2 - T / 2, f)], role: 'int' })) push({ ...w, floor: f });
          doors.push({ at: [cellX + SX / 2, ft, cellZ + SZ], yaw: 0, floor: f, rooms: [room, roomAt(f, c, r + 1)] });
        }
      }
    }
    if (opts.doors !== false) doors.forEach((d, i) => push({ kind: 'door', key: d.front ? 'front-door' : `door${i}`, at: d.at, yaw: d.yaw, color: d.front ? colors.door : colors.trim === '#ffffff' ? '#efe6d6' : colors.door, shape: { width: 0.9, height: 2.1 }, floor: d.floor }));
    // A porch step and a mat by the front door; a camera over it (its picture is on the office computer).
    const fd = doors.find((d) => d.front);
    if (fd) {
      push({ kind: 'box', role: 'trim', size: [2.2, 0.08, 1.0], at: [fd.at[0], 0.04, z0 - 0.6], step: true, floor: 0 });
      push({ kind: 'rug', key: 'mat', at: [fd.at[0], 0.085, z0 - 0.6], shape: { size: [1.0, 0.6] }, color: '#7a5532', floor: 0 });
      if (opts.security !== false) push({ kind: 'cctv', key: 'cam', name: 'Front door camera', at: [fd.at[0] + 1.1, 2.55, z0 - 0.35], yaw: 180, shape: { pitch: 28, fov: 70 }, floor: 0 });
    }

    // The roof: a gable (two slopes over the long side) or flat with a low wall.
    const roofShape = opts.roof === false ? 'none' : String(opts.roof || colors.roofShape || 'gable');
    const top = floors * Hf + 0.15;
    if (roofShape === 'gable') {
      const alongX = Wd >= Dp;
      const span = alongX ? Dp : Wd, len = (alongX ? Wd : Dp) + 0.6;
      const rh = Math.min(3, span * 0.32);
      push({ kind: 'attic', role: 'ext', size: [r2(alongX ? len - 0.6 : span), r2(rh), r2(alongX ? span : len - 0.6)], alongX, at: [0, r2(top), 0] });
      const slope = Math.hypot(span / 2 + 0.35, rh);
      const ang = Math.atan2(rh, span / 2) * 180 / Math.PI;
      for (const s of [-1, 1]) {
        const off = (span / 4 + 0.175);
        push({ kind: 'roof', size: alongX ? [r2(len), 0.12, r2(slope)] : [r2(slope), 0.12, r2(len)], at: alongX ? [0, r2(top + rh / 2 + 0.06), r2(s * off)] : [r2(s * off), r2(top + rh / 2 + 0.06), 0], tilt: alongX ? [r2(s * ang), 0, 0] : [0, 0, r2(-s * ang)] });
      }
    } else if (roofShape === 'flat') {
      for (const [w, d, x, z] of [[Wd + T, T, 0, z0], [Wd + T, T, 0, z0 + Dp], [T, Dp, x0, 0], [T, Dp, x0 + Wd, 0]]) push({ kind: 'box', role: 'ext', size: [r2(w), 0.5, r2(d)], at: [r2(x), r2(top + 0.25), r2(z)] });
    }

    // Rooms: a light on the ceiling, a switch by the way in, and the furniture of their kind.
    for (const room of placed) {
      const ft = floorTop(room.floor);
      push({ kind: 'lamp', key: `light-${room.floor}-${room.c}-${room.r}`, at: [room.x, ft, room.z], shape: { ceiling: true, height: r2(Hf - 0.2) }, data: { room: room.name }, color: '#f6efe2', floor: room.floor });
      const mine = doors.filter((d) => d.floor === room.floor && d.rooms.includes(room));
      const door = mine.find((d) => d.front) || mine.find((d) => d.yaw === 0 && d.at[2] < room.z) || mine[0];
      if (door && opts.lights !== false) {
        // Beside the doorway, on the room's side of the wall.
        const along = door.yaw === 0 ? [1, 0] : [0, 1];
        const into = door.yaw === 0 ? [0, Math.sign(room.z - door.at[2]) || 1] : [Math.sign(room.x - door.at[0]) || 1, 0];
        const sx = door.at[0] + along[0] * 0.8 + into[0] * 0.115, sz = door.at[2] + along[1] * 0.8 + into[1] * 0.115;
        const yaw = into[1] > 0 ? 0 : into[1] < 0 ? 180 : into[0] > 0 ? 90 : 270;
        push({ kind: 'switch', key: `switch-${room.floor}-${room.c}-${room.r}`, at: [r2(sx), r2(ft + 1.2), r2(sz)], yaw, data: { room: room.name }, floor: room.floor });
      }
      if (!furnish || room.furnish === false) continue;
      const kx = SX / 5, kz = SZ / 5;
      for (const it of furnishing(room.type, { style: colors, tv: room.tv || (room.type === 'living' ? opts.tv : null), shower: room.shower ?? opts.shower, key, show: room.show || opts.show })) {
        // The stairs' corner of a room stays clear.
        if (room.stairs && it.z * kz > -0.4) continue;
        push({ kind: it.kind, key: `${it.kind}-${room.floor}-${room.c}-${room.r}-${n + 1}`, at: [r2(room.x + it.x * kx), r2(ft + (it.y || 0)), r2(room.z + it.z * kz)], yaw: it.yaw, shape: it.shape, data: { ...(it.data || {}), room: room.name }, color: it.color, light: it.light, text: it.text, name: it.name, floor: room.floor, room: room.name });
      }
    }
    return { size: [Wd, floors * Hf, Dp], floors, cols, rows, cell: [SX, SZ], height: Hf, style: colors, rooms: placed.map(({ name, type, floor, x, z, stairs }) => ({ name, type, floor, x, z, stairs })), parts, doors: doors.length, stairs: Boolean(stairCell) };
  }

  plan.STYLES = STYLES;
  plan.ROOM_TYPES = ROOM_TYPES;
  plan.subtract = subtract;
  plan.wallPieces = wallPieces;
  root.HawkesHomesPlan = plan;
  if (root.HawkesPlay && root.HawkesPlay.homes) root.HawkesPlay.homes.plan = plan;
})(typeof window !== 'undefined' ? window : globalThis);
