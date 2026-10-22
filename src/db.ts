// The portal's own database (.data/portal.db): customers, sessions, their API keys, the credit ledger, and the Gen
// jobs they paid for. Gen's library and queue live in Gen; nothing here is shared with Studio's control server.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.ts';

fs.mkdirSync(DATA_DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'portal.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT NOT NULL,
  project TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  created INTEGER NOT NULL,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  last_used INTEGER,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  job_id TEXT,
  stripe_session_id TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_user ON credit_ledger (user_id, created);
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_stripe ON credit_ledger (stripe_session_id) WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_job_kind ON credit_ledger (job_id, kind) WHERE job_id IS NOT NULL;
-- The Gen jobs customers paid for: settled once Gen says done (kept) or failed/cancelled (refunded).
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  credits INTEGER NOT NULL,
  status TEXT NOT NULL,
  created INTEGER NOT NULL,
  settled INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_open ON jobs (settled) WHERE settled IS NULL;
CREATE INDEX IF NOT EXISTS jobs_user ON jobs (user_id, created);
-- One-time links to set a password (an admin's first sign-in, a reset an admin hands out).
CREATE TABLE IF NOT EXISTS password_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  used INTEGER
);
`);

// Columns added after the first release.
const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
if (!cols('users').includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'customer'");
// Referrals: a customer's own code, who invited them, whether that friend's first purchase has paid its reward, and
// where a sign-up came from (?ref= or ?utm_source=, kept in a cookie by the landing page).
for (const [c, t] of [['ref_code', 'TEXT'], ['referred_by', 'TEXT'], ['referral_paid', 'INTEGER NOT NULL DEFAULT 0'], ['source', 'TEXT']]) if (!cols('users').includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_ref_code ON users(ref_code) WHERE ref_code IS NOT NULL');
if (!cols('users').includes('disabled')) db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
// Which connection or API key started a job (spend limits per connection), and an API key's own daily limit.
if (!cols('jobs').includes('via')) db.exec('ALTER TABLE jobs ADD COLUMN via TEXT');
if (!cols('api_keys').includes('daily_cap')) db.exec('ALTER TABLE api_keys ADD COLUMN daily_cap INTEGER');

/** Runs fn in one transaction. */
export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
