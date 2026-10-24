// A simulated network for the multiplayer tests: two to four engines (test/engine/net-peer.ts, each in a worker),
// the real room relay (src/relay.ts) in the middle, and between them links with latency, jitter and loss. Links are
// ordered like TCP (a WebSocket is): a lost packet arrives a retransmit later and holds back everything behind it.
// Everyone runs on one virtual clock in lockstep: 60 steps a second, the relay's bundles every 33 ms.
import { Worker } from 'node:worker_threads';
import * as relay from '../../src/relay.ts';

export type Link = { latency: number; jitter: number; loss: number };
type Ev = { at: number; seq: number; run: () => void };

/** A small seeded random (so a run is the same every time). */
function rng(seed: number) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class Peer {
  sim: Sim; name: string; w: Worker; link: Link; conn: relay.Conn | null = null; inbox: any[] = []; gone = false;
  upLast = 0; downLast = 0;
  private waits = new Map<number, (v: any) => void>(); private seq = 0; private ready: Promise<void>;
  constructor(sim: Sim, name: string, link: Link, o: { skew?: number; extra?: string[] }) {
    this.sim = sim; this.name = name; this.link = link;
    this.w = new Worker(new URL('./net-peer.ts', import.meta.url), { workerData: { base: sim.base, skew: o.skew ?? 0, extra: o.extra ?? [] } });
    this.ready = new Promise((res, rej) => {
      this.w.on('error', rej);
      this.w.on('message', (m: any) => {
        if (m.t === 'ready') return res();
        if (m.t === 'connect') return sim.connect(this, m.url);
        if (m.t === 'disconnect') return sim.disconnect(this);
        if (m.t === 'ticked' || m.t === 'done') { const f = this.waits.get(m.id); this.waits.delete(m.id); f?.(m); }
      });
    });
  }
  whenReady() { return this.ready; }
  call(msg: any): Promise<any> { const id = ++this.seq; return new Promise((res) => { this.waits.set(id, res); this.w.postMessage({ ...msg, id }); }); }
  async run<T = any>(code: string): Promise<T> { const r = await this.call({ t: 'eval', code }); if (r.error) throw new Error(`${this.name}: ${r.error}`); return r.value; }
  async world(scene: any, scripts?: Record<string, string>) { const r = await this.call({ t: 'world', scene, scripts }); if (r.error) throw new Error(r.error); }
  /** When something this player sent (up) or is sent (down) arrives, over its link. */
  delay(dir: 'up' | 'down') {
    const l = this.link, r = this.sim.random;
    let at = this.sim.now + l.latency + r() * l.jitter;
    if (l.loss && r() < l.loss) at += Math.max(200, l.latency * 2 + 40); // lost: resent after a timeout
    const last = dir === 'up' ? this.upLast : this.downLast;
    at = Math.max(at, last);
    if (dir === 'up') this.upLast = at; else this.downLast = at;
    return at;
  }
  stop() { return this.w.terminate(); }
}

export class Sim {
  now = 0;
  base = 1_800_000_000_000;
  room = relay.newRoom('play:test:room', 'g_test');
  peers: Peer[] = [];
  random: () => number;
  private q: Ev[] = [];
  private qseq = 0;
  private seqConn = 0;
  private lastFlush = 0;
  constructor(seed = 7) { this.random = rng(seed); }
  schedule(at: number, run: () => void) { this.q.push({ at, seq: ++this.qseq, run }); }

  async add(name: string, link: Partial<Link> = {}, o: { skew?: number; extra?: string[] } = {}) {
    const p = new Peer(this, name, { latency: 0, jitter: 0, loss: 0, ...link }, o);
    this.peers.push(p);
    await p.whenReady();
    return p;
  }
  connect(p: Peer, url: string) {
    const v = /[?&]v=2/.test(url) ? 2 : 1;
    const name = decodeURIComponent((/[?&]name=([^&]*)/.exec(url) || [])[1] || '') || p.name;
    this.schedule(p.delay('up'), () => {
      if (p.gone) return;
      const id = `c${++this.seqConn}`;
      const conn = relay.newConn({ id, name, color: '#4a9eff', user: null, v, now: this.base + this.now, send: (text) => { if (!p.gone) this.schedule(p.delay('down'), () => p.inbox.push({ text })); } });
      p.conn = conn;
      this.schedule(p.delay('down'), () => p.inbox.push({ open: true }));
      relay.join(this.room, conn, this.base + this.now);
    });
  }
  disconnect(p: Peer) {
    const c = p.conn;
    if (!c) return;
    p.conn = null;
    this.schedule(p.delay('up'), () => relay.leave(this.room, c));
  }
  /** A player closes their tab (no goodbye beyond the socket closing: what it already sent still arrives first). */
  async drop(p: Peer) {
    p.gone = true;
    const c = p.conn;
    p.conn = null;
    if (c) this.schedule(Math.max(this.now + p.link.latency, p.upLast) + 1e-3, () => relay.leave(this.room, c));
    this.peers = this.peers.filter((x) => x !== p);
    await p.stop();
  }

  /** Runs everyone for `ms` of simulated time. each(t) after every step (for recording). */
  async step(ms: number, each?: (t: number) => Promise<void> | void) {
    const end = this.now + ms;
    const dt = 1000 / 60;
    while (this.now < end - 1e-6) {
      this.now += dt;
      this.q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      while (this.q.length && this.q[0].at <= this.now) this.q.shift()!.run();
      if (this.now - this.lastFlush >= relay.LIMITS.flushMs - 1e-6) { this.lastFlush = this.now; relay.flush(this.room, this.base + this.now); }
      const done = await Promise.all(this.peers.map((p) => { const inbox = p.inbox.splice(0); return p.call({ t: 'tick', now: 1000 + this.now, dt: 1 / 60, inbox }).then((r) => [p, r] as const); }));
      for (const [p, r] of done) {
        for (const text of r.out as string[]) {
          const conn = p.conn;
          if (!conn) continue;
          this.schedule(p.delay('up'), () => { if (this.room.conns.has(conn.id)) relay.receive(this.room, conn, text, this.base + this.now); });
        }
      }
      if (each) await each(this.now);
    }
  }
  async stop() { await Promise.all(this.peers.map((p) => p.stop())); this.peers = []; }
}
