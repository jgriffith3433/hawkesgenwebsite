// The room relay: what a game room's server keeps and sends, with no sockets, accounts or database in it (rooms.ts
// does those), so tests drive it with a simulated network.
//
// What it keeps, per room:
//   - who is here, who is the host (the oldest connection: it simulates everything nobody else does), who owns each
//     moving thing (whoever grabbed or pushed it last) and which of those are held (a car someone is driving, a thing
//     someone carries: nobody else can take them over by bumping into them)
//   - the last known pose of every moving thing (`ents`) and the latest copy of every synced state (`states`), so
//     someone who joins gets the world as it is, and a new host takes over from the newest data
//
// What it sends (protocol 2, `v=2` on the socket's URL): every 33 ms each connection gets one bundle
// ({ t: 'b', m: [...] }) with what is relevant to it:
//   - reliable things first, in order (joins, leaves, ownership, world edits, script events, actions)
//   - other players' avatars (near ones at their full rate, far ones 5 times a second)
//   - moving things, delta-encoded against what this connection already has (so skipping some for one connection
//     never breaks the others), by interest: near things at their full rate, farther ones less often (4 a second, 1 a
//     second, one every 3 s), in priority order (important things, things in motion, near, waited longest) within a
//     byte budget per connection
//   - synced states (H.sync.state) the same way: only the keys that changed since this connection last got them, and
//     states that say where they are (a herd, a vehicle) less often when they're far
// Protocol 1 connections (an old page still open) get every message as it comes, as before.
//
// Messages: xf entries are [id, mask, ...values]: bits 0-8 are x y z, rx ry rz, vx vy vz; 9-11 angular velocity
// (degrees/s); bit 12 (no value) marks an important thing (a vehicle someone drives, a held thing).

export const LIMITS = {
  people: 32,
  message: 200 * 1024, // bytes in one message
  perSecond: 90, // messages (bundles) a connection may send each second
  innerPerSecond: 900, // messages inside bundles, each second
  budget: 96 * 1024, // bytes a second each connection is sent of moving things and states (reliable ones always go)
  flushMs: 33,
  ents: 4096, // moving things remembered per room
  states: 2048,
};

const VALUES = 12;
const IMPORTANT = 1 << 12;

export type Out = {
  rel: unknown[];
  me: Map<string, { s: any; at: number }>;
  meAt: Map<string, number>;
  xf: Set<string>;
  sent: Map<string, { v: (number | undefined)[]; at: number; full: number }>;
  st: Map<string, Set<string> | true>;
  stAt: Map<string, number>;
  tokens: number;
  tokensAt: number;
};
export type Conn = {
  id: string;
  name: string;
  color: string;
  user: string | null;
  joined: number;
  v: number; // protocol
  send(text: string): void;
  close?(code: number, why: string): void;
  rate: { at: number; n: number; inner: number };
  pos: [number, number, number] | null;
  out: Out;
  stats: { inBytes: number; outBytes: number; inMsgs: number; outMsgs: number; skipped: number };
};
export type Ent = { v: (number | undefined)[]; c: string; at: number; imp: boolean };
export type State = { copy: Record<string, unknown>; c: string; at: number; w: [number, number] | null; imp: boolean };
export type Room = {
  key: string;
  gameId: string;
  edit: boolean;
  conns: Map<string, Conn>;
  host: string | null;
  owners: Map<string, string>;
  locks: Map<string, string>;
  ents: Map<string, Ent>;
  states: Map<string, State>;
};

export function newRoom(key: string, gameId: string, edit = false): Room {
  return { key, gameId, edit, conns: new Map(), host: null, owners: new Map(), locks: new Map(), ents: new Map(), states: new Map() };
}
const newOut = (): Out => ({ rel: [], me: new Map(), meAt: new Map(), xf: new Set(), sent: new Map(), st: new Map(), stAt: new Map(), tokens: LIMITS.budget, tokensAt: 0 });

export function newConn(o: { id: string; name: string; color: string; user: string | null; v: number; send: (t: string) => void; close?: (code: number, why: string) => void; now: number }): Conn {
  return { id: o.id, name: o.name, color: o.color, user: o.user, joined: o.now, v: o.v, send: o.send, close: o.close, rate: { at: 0, n: 0, inner: 0 }, pos: null, out: newOut(), stats: { inBytes: 0, outBytes: 0, inMsgs: 0, outMsgs: 0, skipped: 0 } };
}

function raw(c: Conn, m: unknown) {
  const text = JSON.stringify(m);
  c.stats.outBytes += text.length;
  c.stats.outMsgs++;
  c.send(text);
}
/** Reliable: in order, to everyone (but `except`), in the next bundle (protocol 1: now). */
function reliable(room: Room, m: unknown, except?: string) {
  let text: string | null = null;
  for (const c of room.conns.values()) {
    if (c.id === except) continue;
    if (c.v >= 2) c.out.rel.push(m);
    else { text ??= JSON.stringify(m); c.stats.outBytes += text.length; c.stats.outMsgs++; c.send(text); }
  }
}
const peers = (room: Room) => [...room.conns.values()].map((c) => ({ c: c.id, name: c.name, color: c.color, user: c.user }));

/** Someone joined: their hello now, everyone else hears of them, and the world as it is follows in their first bundle. */
export function join(room: Room, c: Conn, now: number) {
  room.conns.set(c.id, c);
  if (!room.host) room.host = c.id;
  raw(c, { t: 'hello', you: c.id, name: c.name, color: c.color, host: room.host, peers: peers(room), owners: Object.fromEntries(room.owners), locks: Object.fromEntries(room.locks), now, edit: room.edit, v: 2 });
  reliable(room, { t: 'join', c: c.id, name: c.name, color: c.color, user: c.user }, c.id);
  if (c.v >= 2) {
    for (const id of room.ents.keys()) c.out.xf.add(id);
    for (const n of room.states.keys()) c.out.st.set(n, true);
    for (const o of room.conns.values()) if (o.id !== c.id && o.pos) c.out.me.set(o.id, { s: { p: o.pos }, at: now });
  }
}

export function leave(room: Room, c: Conn) {
  if (!room.conns.delete(c.id)) return false;
  for (const [eid, owner] of room.owners) if (owner === c.id) room.owners.delete(eid);
  for (const [eid, owner] of room.locks) if (owner === c.id) room.locks.delete(eid);
  for (const o of room.conns.values()) { o.out.me.delete(c.id); o.out.meAt.delete(c.id); }
  reliable(room, { t: 'leave', c: c.id });
  if (room.host === c.id) {
    // The next oldest takes over simulating the world (from the newest data: the poses and states kept here).
    const next = [...room.conns.values()].sort((a, b) => a.joined - b.joined)[0];
    room.host = next?.id ?? null;
    if (next) reliable(room, { t: 'host', c: next.id });
  }
  return true;
}

/** One message (text) from a connection. */
export function receive(room: Room, c: Conn, text: string, now: number) {
  c.stats.inBytes += text.length;
  c.stats.inMsgs++;
  if (now - c.rate.at > 1000) { c.rate.at = now; c.rate.n = 0; c.rate.inner = 0; }
  if (++c.rate.n > LIMITS.perSecond) return;
  let m: any;
  try { m = JSON.parse(text); } catch { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t === 'b' && Array.isArray(m.m)) {
    for (const x of m.m.slice(0, 256)) { if (++c.rate.inner > LIMITS.innerPerSecond) return; if (x && typeof x === 'object') one(room, c, x, now); }
    return;
  }
  one(room, c, m, now);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const may = (room: Room, c: Conn, id: string) => { const o = room.owners.get(id); return o ? o === c.id : room.host === c.id; };

function one(room: Room, c: Conn, m: any, now: number) {
  switch (m.t) {
    case 'ping': return raw(c, { t: 'pong', at: m.at, now });
    case 'me': {
      const s = m.s && typeof m.s === 'object' ? m.s : null;
      if (!s) return;
      if (Array.isArray(s.p) && s.p.length >= 3 && s.p.every((x: unknown) => num(x) !== undefined)) c.pos = [s.p[0], s.p[1], s.p[2]];
      const at = num(m.at) ?? now;
      for (const o of room.conns.values()) {
        if (o.id === c.id) continue;
        if (o.v >= 2) o.out.me.set(c.id, { s, at });
        else raw(o, { t: 'me', c: c.id, s });
      }
      return;
    }
    case 'xf': {
      if (!Array.isArray(m.x)) return;
      const at = num(m.at) ?? now;
      const legacy: unknown[] = [];
      for (const x of m.x) {
        if (!Array.isArray(x) || typeof x[0] !== 'string' || typeof x[1] !== 'number') continue;
        const id = x[0].slice(0, 64);
        if (!may(room, c, id)) continue; // only the one simulating it says where it is
        let ent = room.ents.get(id);
        if (!ent) {
          if (room.ents.size >= LIMITS.ents) continue;
          ent = { v: new Array(VALUES).fill(undefined), c: c.id, at, imp: false };
          room.ents.set(id, ent);
        }
        const mask = x[1];
        let k = 2;
        for (let i = 0; i < VALUES; i++) if (mask & (1 << i)) { const v = num(x[k++]); if (v !== undefined) ent.v[i] = v; }
        ent.c = c.id; ent.at = at; ent.imp = Boolean(mask & IMPORTANT);
        for (const o of room.conns.values()) if (o.id !== c.id && o.v >= 2) o.out.xf.add(id);
        legacy.push(x);
      }
      if (legacy.length) for (const o of room.conns.values()) if (o.id !== c.id && o.v < 2) raw(o, { t: 'xf', c: c.id, x: legacy });
      return;
    }
    case 'ev': {
      const name = String(m.name ?? '').slice(0, 64);
      const data = m.data ?? null;
      if (name === '_s' && data && typeof data.n === 'string' && data.d && typeof data.d === 'object') return syncState(room, c, data, now);
      const ev = { t: 'ev', c: c.id, name, data };
      if (m.self) reliable(room, ev); else reliable(room, ev, c.id);
      return;
    }
    case 'own': {
      const eid = String(m.id ?? '').slice(0, 64);
      if (!eid) return;
      const lockedBy = room.locks.get(eid);
      if (m.on) {
        if (lockedBy && lockedBy !== c.id && room.conns.has(lockedBy)) {
          // Held by someone else (they're driving it): it stays theirs; tell the asker who has it.
          return c.v >= 2 ? void c.out.rel.push({ t: 'own', id: eid, c: lockedBy, lock: 1 }) : raw(c, { t: 'own', id: eid, c: lockedBy });
        }
        room.owners.set(eid, c.id);
        if (m.lock) room.locks.set(eid, c.id); else room.locks.delete(eid);
      } else if (room.owners.get(eid) === c.id) { room.owners.delete(eid); room.locks.delete(eid); }
      else return;
      return reliable(room, { t: 'own', id: eid, c: m.on ? c.id : null, lock: m.on && m.lock ? 1 : 0 });
    }
    case 'clear': {
      // The host put the world back (reset or rewind): what's kept here is stale.
      if (room.host !== c.id) return;
      room.ents.clear();
      for (const o of room.conns.values()) { o.out.xf.clear(); o.out.sent.clear(); }
      return;
    }
  }
}

function syncState(room: Room, c: Conn, data: any, now: number) {
  const n = data.n.slice(0, 120);
  let st = room.states.get(n);
  if (!st) {
    if (room.states.size >= LIMITS.states) return;
    st = { copy: {}, c: c.id, at: now, w: null, imp: false };
    room.states.set(n, st);
  }
  if (data.f) st.copy = {};
  const keys = Object.keys(data.d);
  for (const k of keys) st.copy[k] = data.d[k];
  st.c = c.id;
  st.at = num(data.at) ?? now;
  st.w = Array.isArray(data.w) && num(data.w[0]) !== undefined && num(data.w[1]) !== undefined ? [data.w[0], data.w[1]] : null;
  st.imp = Boolean(data.i);
  for (const o of room.conns.values()) {
    if (o.id === c.id) continue;
    if (o.v < 2) { raw(o, { t: 'ev', c: c.id, name: '_s', data }); continue; }
    const d = o.out.st.get(n);
    if (data.f) o.out.st.set(n, true);
    else if (d === true) continue;
    else if (d) for (const k of keys) d.add(k);
    else o.out.st.set(n, new Set(keys));
  }
}

/** World edits saved by the server: everyone applies them; what was kept of the things they rebuild is dropped. */
export function ops(room: Room, ops: any[], by: string, fx: string | null, except?: string) {
  for (const op of ops) {
    const id = op && (op.id || (op.entity && op.entity.id));
    if (typeof id !== 'string' || !(op.op === 'delete' || op.op === 'replace' || op.op === 'create' || (op.op === 'update' && op.patch && Object.keys(op.patch).some((k) => k !== 'transform')))) continue;
    room.ents.delete(id);
    for (const o of room.conns.values()) { o.out.xf.delete(id); o.out.sent.delete(id); }
  }
  reliable(room, { t: 'ops', ops, by, c: except ?? null, fx }, except);
}
export function event(room: Room, name: string, data: unknown) { reliable(room, { t: 'ev', c: null, name, data }); }

// ------------------------------------------------------------------ the bundles
const dist2 = (a: [number, number, number] | null, x: number | undefined, z: number | undefined) => (!a || x === undefined || z === undefined ? 0 : (a[0] - x) ** 2 + (a[2] - z) ** 2);
/** How long a thing at this distance (squared) waits between updates, at most (ms). */
function tierMs(d2: number, imp: boolean) {
  if (d2 < 45 * 45) return 0;
  if (d2 < 130 * 130) return imp ? 0 : 250;
  if (d2 < 320 * 320) return imp ? 250 : 1000;
  return imp ? 1000 : 3000;
}
const moving = (v: (number | undefined)[]) => Math.abs(v[6] ?? 0) + Math.abs(v[7] ?? 0) + Math.abs(v[8] ?? 0) > 0.05;

/** Sends each connection its bundle (call every LIMITS.flushMs). */
export function flush(room: Room, now: number) {
  for (const c of room.conns.values()) if (c.v >= 2) flushOne(room, c, now);
}
function flushOne(room: Room, c: Conn, now: number) {
  const o = c.out;
  if (!o.tokensAt) o.tokensAt = now;
  o.tokens = Math.min(LIMITS.budget, o.tokens + ((now - o.tokensAt) / 1000) * LIMITS.budget);
  o.tokensAt = now;
  const m: unknown[] = o.rel;
  o.rel = [];
  // Avatars: near ones every time, far ones 5 times a second.
  for (const [id, p] of o.me) {
    const peer = room.conns.get(id);
    const far = peer && peer.pos && dist2(c.pos, peer.pos[0], peer.pos[2]) > 120 * 120;
    if (far && now - (o.meAt.get(id) ?? 0) < 200) continue;
    m.push({ t: 'me', c: id, s: p.s, at: p.at });
    o.meAt.set(id, now);
    o.me.delete(id);
  }
  let used = 0;
  // Moving things: what's due, most important first, within the budget.
  if (o.xf.size) {
    const due: { id: string; ent: Ent; pri: number }[] = [];
    for (const id of o.xf) {
      const ent = room.ents.get(id);
      if (!ent) { o.xf.delete(id); continue; }
      const last = o.sent.get(id);
      const d2 = dist2(c.pos, ent.v[0], ent.v[2]);
      const wait = tierMs(d2, ent.imp);
      const waited = last ? now - last.at : 1e6;
      if (waited < wait) { c.stats.skipped++; continue; }
      const pri = ((waited + 50) / (wait + 50)) * (ent.imp ? 4 : 1) * (moving(ent.v) ? 2 : 1) / (1 + Math.sqrt(d2) / 40);
      due.push({ id, ent, pri });
    }
    // Important things (driven, held) first, then by how long they've waited for their tier, motion and nearness.
    due.sort((a, b) => Number(b.ent.imp) - Number(a.ent.imp) || b.pri - a.pri);
    const groups = new Map<string, { t: 'xf'; c: string; at: number; x: unknown[] }>();
    for (const { id, ent } of due) {
      if (used > 0 && used >= o.tokens) break;
      const last = o.sent.get(id);
      const full = !last || now - last.full > 2500;
      let mask = 0;
      const vals: number[] = [];
      for (let i = 0; i < VALUES; i++) {
        const v = ent.v[i];
        if (v === undefined) continue;
        if (full || last!.v[i] === undefined || Math.abs(v - (last!.v[i] as number)) > 1e-6) { mask |= 1 << i; vals.push(v); }
      }
      o.xf.delete(id);
      if (!mask) continue;
      if (ent.imp) mask |= IMPORTANT;
      const entry = [id, mask, ...vals];
      used += 8 + id.length + vals.length * 7;
      const key = `${ent.c}|${ent.at}`;
      let g = groups.get(key);
      if (!g) { g = { t: 'xf', c: ent.c, at: ent.at, x: [] }; groups.set(key, g); }
      g.x.push(entry);
      o.sent.set(id, { v: ent.v.slice(), at: now, full: full ? now : last!.full });
    }
    for (const g of groups.values()) m.push(g);
  }
  // Synced states: the keys that changed since this connection last got them; far ones (they say where) less often.
  if (o.st.size) {
    for (const [n, keys] of o.st) {
      const st = room.states.get(n);
      if (!st) { o.st.delete(n); continue; }
      const wait = st.w ? tierMs(dist2(c.pos, st.w[0], st.w[1]), st.imp) * 2 : 0;
      if (wait && now - (o.stAt.get(n) ?? 0) < wait) { c.stats.skipped++; continue; }
      if (used > 0 && used >= o.tokens && !st.imp) break;
      const full = keys === true;
      const d: Record<string, unknown> = {};
      if (full) Object.assign(d, st.copy);
      else for (const k of keys) if (k in st.copy) d[k] = st.copy[k];
      const ev = { t: 'ev', c: st.c, name: '_s', data: { n, d, f: full ? 1 : 0, at: st.at } };
      used += JSON.stringify(d).length + n.length + 40;
      m.push(ev);
      o.st.delete(n);
      o.stAt.set(n, now);
    }
  }
  o.tokens -= used;
  if (!m.length) return;
  raw(c, { t: 'b', m });
}
