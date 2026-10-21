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
export const publicUrl = () => (env('PUBLIC_URL') ?? 'https://hawkesgen.com').replace(/\/+$/, '');
/** Customers' projects in Gen are this prefix plus their id; the portal's Gen key is scoped to `${PROJECT_PREFIX}*`. */
export const PROJECT_PREFIX = 'usr_';
