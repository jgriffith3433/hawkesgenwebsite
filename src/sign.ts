// Signed, expiring tokens for links an agent uses without our auth header: downloads (/dl/...) and uploads (/up/...).
// HMAC-SHA256 with the portal's secret (PORTAL_SECRET, else one made once and kept in .data/secret).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, env } from './config.ts';

let secret: Buffer | null = null;
function key() {
  if (secret) return secret;
  const fromEnv = env('PORTAL_SECRET');
  if (fromEnv) return (secret = Buffer.from(fromEnv));
  const file = path.join(DATA_DIR, 'secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return (secret = Buffer.from(fs.readFileSync(file, 'utf8').trim()));
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (body: string) => crypto.createHmac('sha256', key()).update(body).digest().subarray(0, 18);

/** A keyed digest of some text (base64url): the same text always gives the same digest, which can't be turned back. */
export const digest = (text: string) => b64(crypto.createHmac('sha256', key()).update(text).digest());

export function sign(payload: Record<string, unknown>, ttlSeconds: number) {
  const body = b64(JSON.stringify({ ...payload, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${b64(mac(body))}`;
}

/** The payload of a token we signed, and whether its time has run out (null: not ours, or damaged). */
export function check<T = Record<string, any>>(token: string): { payload: T & { e: number }; expired: boolean } | null {
  const [body, sig] = String(token ?? '').split('.');
  if (!body || !sig) return null;
  const want = mac(body);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const v = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return { payload: v, expired: !(v.e >= Date.now() / 1000) };
  } catch {
    return null;
  }
}

export function verify<T = Record<string, any>>(token: string): (T & { e: number }) | null {
  const c = check<T>(token);
  return c && !c.expired ? c.payload : null;
}
