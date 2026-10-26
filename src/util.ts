import crypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const id = (prefix: string, bytes = 8) => `${prefix}${crypto.randomBytes(bytes).toString('hex')}`;
export const sha256 = (s: Buffer | string) => crypto.createHash('sha256').update(s).digest('hex');

/** An error with the HTTP status it answers with. */
export class PortalError extends Error {
  status: number;
  code?: string;
  constructor(message: string, { status = 400, code }: { status?: number; code?: string } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The caller's address: the peer, or what Caddy forwards when the peer is this machine. */
export const clientIp = (req: IncomingMessage) => {
  const peer = req.socket.remoteAddress ?? '';
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()?.trim();
  return /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(peer) && fwd ? fwd : peer;
};

/** A whole number from the environment (a cap), or `fallback` when it is missing or not a positive number. */
export function envInt(read: (k: string) => string | undefined, key: string, fallback: number) {
  const n = Math.floor(Number(read(key)));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}

export async function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new PortalError('Request body too large', { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage): Promise<any> {
  const raw = (await readBody(req)).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PortalError('Body is not valid JSON');
  }
}

/** A sliding-window limiter for one kind of thing, kept in memory: `max` hits per `windowMs` for each key (an address, an
 *  account, an email). Every limiter sweeps once a minute (keys with no recent hit are forgotten) and holds at most
 *  `maxKeys` keys, the oldest let go first, so a flood of made-up keys can't grow the process. */
export class Limiter {
  readonly windowMs: number;
  /** The limit for the whole portal; each web process keeps `limit`, its share (PORTAL_PROCS processes take turns). */
  readonly max: number;
  readonly maxKeys: number;
  private hits = new Map<string, number[]>();
  constructor(max: number, windowMs: number, maxKeys = 20_000) {
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    limiters.add(this);
    if (!sweeper) {
      sweeper = setInterval(() => { const now = Date.now(); for (const l of limiters) l.sweep(now); }, 60_000);
      sweeper.unref?.();
    }
  }
  get limit() { return Math.max(1, Math.ceil(this.max / envInt((k) => process.env[k], 'PORTAL_PROCS', 1))); }
  /** Is this key at its limit right now? Counts nothing. */
  over(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h) return false;
    while (h.length && now - h[0] >= this.windowMs) h.shift();
    return h.length >= this.limit;
  }
  /** Counts a hit and says whether it was allowed. A refused hit is not counted. */
  hit(key: string, now = Date.now()) {
    if (this.over(key, now)) return false;
    let h = this.hits.get(key);
    if (!h) {
      if (this.hits.size >= this.maxKeys) { this.sweep(now); if (this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value!); }
      this.hits.set(key, (h = []));
    }
    h.push(now);
    return true;
  }
  /** Forgets the keys with no hit inside the window. */
  sweep(now = Date.now()) {
    for (const [k, h] of this.hits) if (!h.length || now - h[h.length - 1] >= this.windowMs) this.hits.delete(k);
  }
  /** Hits inside the window for this key. */
  count(key: string, now = Date.now()) {
    const h = this.hits.get(key);
    if (!h) return 0;
    while (h.length && now - h[0] >= this.windowMs) h.shift();
    return h.length;
  }
  get size() { return this.hits.size; }
  /** Counts a hit or throws a 429 with this message. */
  take(key: string, message: string, extra: { code?: string } = {}) {
    if (!this.hit(key)) throw new PortalError(message, { status: 429, ...extra });
  }
}
const limiters = new Set<Limiter>();
let sweeper: ReturnType<typeof setInterval> | null = null;
