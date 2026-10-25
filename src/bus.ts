// The portal's small message bus: how the web processes share what used to live in one process's memory. The worker
// owns a hub on a UNIX socket (`.data/bus.sock`); every web process connects to it and sends one JSON message per
// line. The hub keeps what must be one thing for everybody (each game's recent live events with their ids, who has the
// editor open on which process) and hands every message to every web process, the sender's included, so a change
// saved through one process reaches an editor connected to any other, once. One process (`node src/server.ts`, tests)
// uses the same hub in its own memory: the code above it is the same.
import net from 'node:net';
import fs from 'node:fs';
import { id } from './util.ts';

export type Msg = { t: string; [k: string]: any };
export type LiveEvent = { id: string; n: number; event: string; data: unknown; mid?: string };
type Sub = { send(m: Msg): void; procs: Set<string> };

const KEEP = 200;
/** State, not history: never replayed to a stream that comes back. */
const NOT_REPLAYED = new Set(['presence', 'cursor', 'hello', 'thinking']);
/** Messages the hub's own process answers instead of passing on (the worker's work: run a task, follow a generation). */
const hubHandlers = new Map<string, (m: Msg) => void>();
export const onHub = (t: string, fn: (m: Msg) => void) => void hubHandlers.set(t, fn);

export class Hub {
  readonly boot = id('b', 3);
  readonly subs = new Set<Sub>();
  private history = new Map<string, { seq: number; events: { n: number; event: string; data: unknown; mid?: string }[] }>();
  private presence = new Map<string, Map<string, unknown[]>>();
  private heard = new Set<string>(); // message ids already handled (a web process says its last few seconds again when the worker has been away)

  subscribe(sub: Sub) { this.subs.add(sub); return () => this.drop(sub); }
  /** A web process went away: the editors it held are gone with it. */
  drop(sub: Sub) {
    this.subs.delete(sub);
    for (const proc of sub.procs) for (const [game, by] of this.presence) if (by.delete(proc)) this.sendPresence(game);
  }
  private fan(m: Msg) { for (const s of this.subs) try { s.send(m); } catch {} }
  private sendPresence(game: string) {
    const by = this.presence.get(game);
    if (by && !by.size) this.presence.delete(game);
    this.fan({ t: 'presence', game, procs: Object.fromEntries(by ?? []) });
  }
  receive(from: Sub | null, m: Msg) {
    if (!m || typeof m.t !== 'string') return;
    if (m.mid) {
      if (this.heard.has(m.mid)) return;
      this.heard.add(m.mid);
      if (this.heard.size > 20_000) this.heard.delete(this.heard.values().next().value!);
    }
    if (m.t === 'live') {
      let evId: string | undefined;
      if (!NOT_REPLAYED.has(m.event)) {
        let h = this.history.get(m.game);
        if (!h) this.history.set(m.game, (h = { seq: 0, events: [] }));
        h.events.push({ n: ++h.seq, event: m.event, data: m.data, mid: m.mid });
        if (h.events.length > KEEP) h.events.shift();
        evId = `${this.boot}-${h.seq}`;
      }
      return this.fan({ t: 'live', game: m.game, event: m.event, data: m.data, id: evId, mid: m.mid });
    }
    if (m.t === 'presence-set') {
      const by = this.presence.get(m.game) ?? new Map<string, unknown[]>();
      if (Array.isArray(m.conns) && m.conns.length) by.set(m.proc, m.conns); else by.delete(m.proc);
      this.presence.set(m.game, by);
      from?.procs.add(m.proc);
      return this.sendPresence(m.game);
    }
    if (m.t === 'history') { // a process that was away: everything the hub kept for these games (it drops what it has heard, by `mid`)
      for (const game of m.games ?? []) for (const e of this.history.get(game)?.events ?? []) from?.send({ t: 'live', game, event: e.event, data: e.data, id: `${this.boot}-${e.n}`, mid: e.mid, replay: true });
      return void from?.send({ t: 'history-done' });
    }
    if (m.t === 'missed') return void from?.send({ t: 'missed-reply', rid: m.rid, events: this.missed(m.game, m.last) });
    const h = hubHandlers.get(m.t);
    if (h) return h(m);
    this.fan(m);
  }
  /** The events after `last` (an id from this boot), or none when the id is from before a restart or too old to be kept. */
  missed(game: string, last: string | null | undefined): LiveEvent[] {
    const m = /^(\w+)-(\d+)$/.exec(last ?? '');
    const h = this.history.get(game);
    if (!m || m[1] !== this.boot || !h) return [];
    return h.events.filter((e) => e.n > Number(m[2])).map((e) => ({ id: `${this.boot}-${e.n}`, n: e.n, event: e.event, data: e.data, mid: e.mid }));
  }
}

// ------------------------------------------------------------------ this process's side
const listeners = new Map<string, ((m: Msg) => void)[]>();
const connectedHooks: (() => void)[] = [];
/** Calls `fn` for every message of type `t` that reaches this process (a web process, or the only one). */
export const on = (t: string, fn: (m: Msg) => void) => void listeners.set(t, [...(listeners.get(t) ?? []), fn]);
/** Calls `fn` each time the connection to the hub is (re)made: say again what only this process knows. */
export const onConnect = (fn: () => void) => void connectedHooks.push(fn);
const delivered = new Map<string, number>(); // message ids this process has handled: a message the worker was told twice is heard once
/** Notes that this process has handled the message `mid` (an event given to a stream from the hub's history), so a copy that comes later is dropped. */
export const markHeard = (mid?: string) => { if (mid) delivered.set(mid, Date.now()); };
let catchupGames: () => string[] = () => [];
/** Which games this process has streams for: after a worker restart it asks the hub for what it missed in those. */
export const catchUp = (fn: () => string[]) => { catchupGames = fn; };
const deliver = (m: Msg) => {
  if (m.mid) {
    if (delivered.has(m.mid)) return;
    delivered.set(m.mid, Date.now());
    if (delivered.size > 20_000) delivered.delete(delivered.keys().next().value!);
  }
  for (const fn of listeners.get(m.t) ?? []) try { fn(m); } catch (e) { console.error('[portal] bus:', e); } };

let hub: Hub | null = null;       // the hub, when this process hosts it (the only process, or the worker)
let local: Sub | null = null;     // this process's own subscription to it (not in the worker)
let client: Client | null = null; // the connection to the worker's hub (a web process)

function localHub() {
  if (!hub) { hub = new Hub(); local = { send: deliver, procs: new Set() }; hub.subscribe(local); }
  return hub;
}

/** Sends a message to every process (the hub keeps a few kinds for itself). Never throws; never waits. */
export function publish(m: Msg) {
  if (client) client.send(m);
  else localHub().receive(local, m);
}

/** What a stream that comes back after `last` missed: now when the hub is in this process, else after asking it. */
export function missed(game: string, last: string | null | undefined): LiveEvent[] | Promise<LiveEvent[]> {
  if (client) return client.ask({ t: 'missed', game, last });
  return localHub().missed(game, last);
}

/** The worker: hosts the hub on a UNIX socket. */
export function hostHub(sock: string): Promise<Hub> {
  hub = new Hub();
  const h = hub;
  local = { send: deliver, procs: new Set() }; // (the worker hears its own hub too: task events, for the generations it follows)
  h.subscribe(local);
  try { fs.unlinkSync(sock); } catch {}
  const server = net.createServer((conn) => {
    const sub: Sub = { procs: new Set(), send: (m) => { if (conn.writableLength > 16 * 1024 * 1024) return void conn.destroy(); conn.write(`${JSON.stringify(m)}\n`); } };
    h.subscribe(sub);
    let buf = '';
    conn.setEncoding('utf8');
    conn.on('data', (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try { h.receive(sub, JSON.parse(line)); } catch (e) { console.error('[portal] bus message:', e); }
      }
    });
    conn.on('error', () => {});
    conn.on('close', () => h.drop(sub));
  });
  return new Promise((res, rej) => { server.once('error', rej); server.listen(sock, () => { try { fs.chmodSync(sock, 0o600); } catch {} res(h); }); });
}

class Client {
  private sock: string;
  private conn: net.Socket | null = null;
  // What was sent in the last few seconds. When the worker goes away and comes back (a restart), a message written to it just
  // before it went may never have been handled: all of them are said again, and the hub and the processes keep the ones
  // they have heard (`mid`), so each is handled once.
  private ring: { at: number; mid: string; line: string }[] = [];
  private n = 0;
  private holding: Msg[] | null = null;
  private me = id('', 4);
  private asks = new Map<string, (events: LiveEvent[]) => void>();
  constructor(sock: string) { this.sock = sock; this.connect(); }
  private connect() {
    const c = net.connect(this.sock);
    let buf = '';
    c.setEncoding('utf8');
    c.on('connect', () => {
      this.conn = c;
      this.trim();
      for (const r of this.ring) c.write(r.line);
      // Whatever the hub fanned out while this process was not connected (a worker restart) is in its history: ask for it, and
      // hold what arrives meanwhile behind it so every stream still sees its events in order.
      const games = catchupGames();
      if (games.length) {
        this.holding = [];
        c.write(`${JSON.stringify({ t: 'history', games })}\n`);
        setTimeout(() => this.release(), 3000).unref();
      }
      for (const fn of connectedHooks) try { fn(); } catch {}
    });
    c.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let m: Msg;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'missed-reply') { this.asks.get(m.rid)?.(m.events); this.asks.delete(m.rid); }
        else if (m.t === 'history-done') this.release();
        else if (this.holding && !m.replay) this.holding.push(m);
        else deliver(m);
      }
    });
    c.on('error', () => {});
    c.on('close', () => { if (this.conn === c) this.conn = null; setTimeout(() => this.connect(), 200).unref(); });
  }
  private release() {
    const held = this.holding;
    this.holding = null;
    for (const m of held ?? []) deliver(m);
  }
  pending() { return (this.conn?.writableLength ?? 0) > 0 || !this.conn; }
  private trim() {
    const from = Date.now() - 5000;
    while (this.ring.length && (this.ring[0].at < from || this.ring.length > 5000)) this.ring.shift();
  }
  send(m: Msg) {
    const mid = `${this.me}.${++this.n}`;
    const line = `${JSON.stringify({ ...m, mid })}\n`;
    this.ring.push({ at: Date.now(), mid, line });
    this.trim();
    if (this.conn && !this.conn.destroyed) this.conn.write(line);
  }
  ask(m: Msg): Promise<LiveEvent[]> {
    const rid = id('q', 4);
    return new Promise((res) => {
      const t = setTimeout(() => { this.asks.delete(rid); res([]); }, 2000);
      this.asks.set(rid, (e) => { clearTimeout(t); res(e); });
      this.send({ ...m, rid });
    });
  }
}

/** A web process: connects to the worker's hub. Messages sent before it is up wait their turn. */
export function connectHub(sock: string) {
  client = new Client(sock);
}

/** Waits (a moment at most) until what this process has sent to the hub has left it: before exiting, so a save just made is not lost with it. */
export async function drainBus() {
  for (let i = 0; i < 30 && client?.pending(); i++) await new Promise((r) => setTimeout(r, 10));
}

export const busMode = () => (client ? 'worker' : hub ? 'local' : 'none');
