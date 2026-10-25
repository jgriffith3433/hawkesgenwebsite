// Settings from .env (gitignored; deploy writes it on the server) and the environment, which wins. Read when asked, so
// tests can set them before a module uses them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readEnvFile(file: string): Record<string, string> {
  try {
    return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter((m): m is RegExpExecArray => Boolean(m)).map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]));
  } catch {
    return {};
  }
}
const fileEnv = readEnvFile(path.join(ROOT, '.env'));

export const env = (k: string): string | undefined => process.env[k] || fileEnv[k] || undefined;

export const DATA_DIR = env('PORTAL_DATA_DIR') ?? path.join(ROOT, '.data');
export const PORT = Number(env('PORT') ?? 8800);
/** Hawkes Gen, the backend: where every job runs. The portal is one of its customers, with one key. */
export const genUrl = () => (env('HAWKESGEN_URL') ?? 'https://gen.hawkesgen.com').replace(/\/+$/, '');
export const genKey = () => env('HAWKESGEN_KEY') ?? '';
/** This site's own address (Stripe's return links). */
/** Where Gen hands out public asset links (its CDN, settings.storage.cdn). A game page's CSP names exactly these hosts
 *  (server.ts PLAY_HOSTS.assets) and bundles carry a CDN link only from one of them, so a link a game can't load never
 *  goes out. PORTAL_CDN_HOSTS (comma separated origins) adds another, e.g. for a test CDN. */
export const cdnHosts = () => [...new Set(['https://cdn.hawkesgen.com', ...(env('PORTAL_CDN_HOSTS') ?? '').split(',').map((h) => h.trim().replace(/\/+$/, '')).filter((h) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(h))])];
export const publicUrl = () => (env('PUBLIC_URL') ?? 'https://hawkesgen.com').replace(/\/+$/, '');
/**
 * Customers' projects in Gen are this prefix plus their id; the portal's Gen key is scoped to `${PROJECT_PREFIX}*`.
 * PORTAL_PROJECT_PREFIX gives another copy of the portal its own customers in the same Gen (the beta portal Hawkes
 * Studio runs uses ubeta_, with a key scoped to ubeta_*), so it never reaches a live customer's project.
 */
export const PROJECT_PREFIX = (() => {
  const p = env('PORTAL_PROJECT_PREFIX') ?? 'usr_';
  if (!/^[a-z][a-z0-9]{0,15}_$/.test(p)) throw new Error(`PORTAL_PROJECT_PREFIX must be lowercase letters and digits ending in "_" (got "${p}")`);
  return p;
})();
/** A customer's id (their Gen project), for routes: the prefix and 16 hex digits. */
export const USER_ID = `${PROJECT_PREFIX}[0-9a-f]+`;
