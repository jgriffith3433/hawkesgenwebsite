// What every web process must see the same way, kept in the database (WAL, short writes) instead of one process's memory:
// the assistant's one-at-a-time lock for a game, and the limits on starting generations.
import { db } from './db.ts';
import { id } from './util.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, holder TEXT NOT NULL, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rate_hits (key TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_hits_key ON rate_hits (key, at);
`);

const holders = new Map<string, string>();

/** Takes the lock `name` for at most `ttlMs` (a crashed holder lets go by itself). False when someone else holds it. */
export function lock(name: string, ttlMs: number) {
  const holder = id('h', 6), now = Date.now();
  const r = db.prepare('INSERT INTO locks (name, holder, until) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, until = excluded.until WHERE locks.until <= ?').run(name, holder, now + ttlMs, now);
  if (Number(r.changes) !== 1) return false;
  holders.set(name, holder);
  return true;
}
/** Lets go of a lock this process took. */
export function unlock(name: string) {
  const holder = holders.get(name);
  holders.delete(name);
  if (holder) db.prepare('DELETE FROM locks WHERE name = ? AND holder = ?').run(name, holder);
}
export function locked(name: string) {
  return Boolean(db.prepare('SELECT 1 FROM locks WHERE name = ? AND until > ?').get(name, Date.now()));
}

/** A sliding window kept in the database, so the limit holds across web processes. Same shape as util.ts `Limiter`. */
export class SharedLimiter {
  readonly max: number;
  readonly windowMs: number;
  readonly prefix: string;
  constructor(max: number, windowMs: number, prefix: string) { this.max = max; this.windowMs = windowMs; this.prefix = prefix; }
  private k(key: string) { return `${this.prefix}:${key}`; }
  count(key: string, now = Date.now()) {
    return Number((db.prepare('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND at > ?').get(this.k(key), now - this.windowMs) as { n: number }).n);
  }
  over(key: string, now = Date.now()) { return this.count(key, now) >= this.max; }
  /** Counts a hit and says whether it was allowed (a refused hit is not counted). */
  hit(key: string, now = Date.now()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM rate_hits WHERE key = ? AND at <= ?').run(this.k(key), now - this.windowMs);
      const ok = this.count(key, now) < this.max;
      if (ok) db.prepare('INSERT INTO rate_hits (key, at) VALUES (?, ?)').run(this.k(key), now);
      db.exec('COMMIT');
      return ok;
    } catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
  }
}
/** Forgets hits older than a day (the worker does this now and then). */
export const sweepShared = () => void db.prepare('DELETE FROM rate_hits WHERE at < ?').run(Date.now() - 86_400_000);
