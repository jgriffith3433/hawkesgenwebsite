// Requests and answers for the portal's functions. Firebase Hosting sends the dynamic paths here (firebase.json
// rewrites); each area registers its routes with `route()`, and `handle` finds the one that matches. Hosting forwards
// only the `__session` cookie, so that is the one cookie the API reads or sets.
import crypto from 'node:crypto';
import type { Request } from 'firebase-functions/https';
import type { Response } from 'express';

export class PortalError extends Error {
  status: number;
  code?: string;
  constructor(message: string, { status = 400, code }: { status?: number; code?: string } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type Ctx = {
  req: Request;
  res: Response;
  url: URL;
  route: string;
  method: string;
  /** The caller's address (the first in X-Forwarded-For: Hosting puts the visitor there). */
  ip: string;
  /** What the pattern captured. */
  params: string[];
};

type Handler = (c: Ctx) => unknown | Promise<unknown>;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];

/** Registers a route. `pattern` is a path or a regular expression (anchored; groups become `params`). */
export function route(method: string, pattern: string | RegExp, handler: Handler) {
  const re = typeof pattern === 'string' ? new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : pattern;
  routes.push({ method, pattern: re, handler });
}

/** Every registered route's method and pattern (tests check that each admin route answers only an admin). */
export const routeTable = () => routes.map((r) => ({ method: r.method, pattern: r.pattern }));

export const id = (prefix: string, bytes = 8) => `${prefix}${crypto.randomBytes(bytes).toString('hex')}`;
export const sha256 = (s: Buffer | string) => crypto.createHash('sha256').update(s).digest('hex');

export function send(res: Response, status: number, body: unknown) {
  res.status(status).set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).send(JSON.stringify(body));
}
export const redirect = (res: Response, location: string, status = 302) => void res.status(status).set('Location', location).end();

/** The JSON body (Cloud Functions has already read it; `rawBody` keeps the bytes for signatures). */
export function json(req: Request): any {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const raw = req.rawBody?.toString('utf8') ?? '';
  if (!raw.trim()) return {};
  try { return JSON.parse(raw); } catch { throw new PortalError('Body is not valid JSON'); }
}
/** A form or JSON body (OAuth's token endpoint takes both). */
export function form(req: Request): Record<string, string> {
  const type = String(req.headers['content-type'] ?? '');
  if (type.includes('application/json')) return json(req);
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  return Object.fromEntries(new URLSearchParams(req.rawBody?.toString('utf8') ?? ''));
}

export function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch {}
  }
  return out;
}

export const clientIp = (req: Request) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.ip || '';

/** In-memory sliding window per key. One function instance's view only: a soft limit; hard ones live in Firestore. */
export class Limiter {
  private hits = new Map<string, number[]>();
  readonly max: number;
  readonly windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }
  over(key: string, now = Date.now()) { return (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs).length >= this.max; }
  hit(key: string, now = Date.now()) {
    const h = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (h.length >= this.max) { this.hits.set(key, h); return false; }
    h.push(now);
    this.hits.set(key, h);
    if (this.hits.size > 20_000) this.hits.delete(this.hits.keys().next().value!);
    return true;
  }
  take(key: string, message: string) { if (!this.hit(key)) throw new PortalError(message, { status: 429 }); }
}

export async function handle(req: Request, res: Response) {
  const url = new URL(req.originalUrl || req.url || '/', 'https://portal');
  const route = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';
  try {
    for (const r of routes) {
      if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) continue;
      const m = r.pattern.exec(route);
      if (!m) continue;
      const out = await r.handler({ req, res, url, route, method, ip: clientIp(req), params: m.slice(1) });
      if (!res.headersSent && out !== undefined) send(res, 200, out);
      return;
    }
    send(res, 404, { error: 'Not found' });
  } catch (e: any) {
    if (res.headersSent) return void res.end();
    const status = Number(e?.status) || 500;
    if (status >= 500) console.error(`[portal] ${method} ${route}:`, e);
    send(res, status, { error: status >= 500 && !(e instanceof PortalError) ? 'Something went wrong on our side' : e.message, ...(e?.code ? { code: e.code } : {}) });
  }
}
