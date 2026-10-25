// Files for agents. Downloads: a signed link per output (/dl/<token>/<name>, a day) that `curl -o` fetches without a key.
// Uploads: a one-time link (/up/<token>, half an hour) that `curl -T file` sends to, or bytes/a public URL given directly.
// Either way the file lands in Gen as the customer's asset and is used as "asset:a_...".
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from './db.ts';
import { publicUrl } from './config.ts';
import { genFetch } from './gen.ts';
import { sign, verify } from './sign.ts';
import { id, PortalError, readBody } from './util.ts';
import type { User } from './users.ts';

export const UPLOAD_LIMIT = 64 * 1024 * 1024;

db.exec('CREATE TABLE IF NOT EXISTS upload_tokens (jti TEXT PRIMARY KEY, used INTEGER)');

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'model/gltf-binary': '.glb', 'application/json': '.json', 'text/plain': '.txt' };
export const extFor = (mime = '') => EXT[mime.split(';')[0]] ?? '';
const safeName = (s: string) => String(s || 'file').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';

/** A download link for one of the customer's assets, good for a day. */
export function downloadUrl(user: User, asset: string, name: string) {
  return `${publicUrl()}/dl/${sign({ p: user.project, a: asset }, 24 * 3600)}/${safeName(name)}`;
}

export async function serveDownload(token: string, res: ServerResponse) {
  const t = verify<{ p: string; a: string }>(token);
  if (!t || !/^a_[0-9a-f]+$/.test(t.a)) throw new PortalError('This link has expired. Ask for the file again.', { status: 410 });
  const r = await genFetch(`/v1/assets/${t.a}/file`, { as: t.p, signal: AbortSignal.timeout(300_000) });
  if (!r.ok || !r.body) throw new PortalError('File not found', { status: 404 });
  res.writeHead(200, { 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream', ...(r.headers.get('content-length') ? { 'Content-Length': r.headers.get('content-length')! } : {}), 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'attachment' });
  const { Readable } = await import('node:stream');
  const { pipeline } = await import('node:stream/promises');
  await pipeline(Readable.fromWeb(r.body as any), res).catch(() => {});
}

/** The bytes of a customer's asset (previews for the agent). */
export async function assetBytes(user: User, asset: string, max = 1_500_000) {
  const r = await genFetch(`/v1/assets/${asset}/file`, { as: user.project, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len && len > max) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > max ? null : buf;
}

/** Puts bytes into Gen as the customer's asset. */
export async function putFile(user: User, data: Uint8Array, filename: string, contentType = 'application/octet-stream') {
  if (!data.length) throw new PortalError('The file is empty');
  if (data.length > UPLOAD_LIMIT) throw new PortalError('Files up to 64 MB', { status: 413 });
  const r = await genFetch(`/v1/assets?project=${encodeURIComponent(user.project)}`, { as: user.project, method: 'POST', rawBody: data as any, headers: { 'Content-Type': contentType, 'X-Filename': safeName(filename) }, signal: AbortSignal.timeout(300_000) });
  const a: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(a.error ?? `Upload failed (${r.status})`, { status: r.status === 413 ? 413 : 502 });
  return { asset: a.id as string, ref: `asset:${a.id}`, kind: a.kind as string, mime: a.mime as string, size: data.length };
}

/** A one-time upload link: PUT or POST the file's bytes to it. */
export function uploadLink(user: User, filename: string) {
  const jti = id('u', 8);
  const url = `${publicUrl()}/up/${sign({ u: user.id, f: safeName(filename), j: jti }, 30 * 60)}`;
  return { url, curl: `curl -sS -T "${filename.replace(/"/g, '')}" "${url}"`, expiresInMinutes: 30 };
}

export async function receiveUpload(token: string, req: IncomingMessage, getUser: (id: string) => User | null) {
  const t = verify<{ u: string; f: string; j: string }>(token);
  if (!t) throw new PortalError('This upload link has expired. Ask for a new one.', { status: 410 });
  if (db.prepare('SELECT 1 FROM upload_tokens WHERE jti = ?').get(t.j)) throw new PortalError('This upload link was already used. Ask for a new one.', { status: 410 });
  const user = getUser(t.u);
  if (!user || user.disabled) throw new PortalError('Account not available', { status: 403 });
  if (Number(req.headers['content-length'] ?? 0) > UPLOAD_LIMIT) throw new PortalError('Files up to 64 MB', { status: 413 });
  const body = await readBody(req, UPLOAD_LIMIT);
  db.prepare('INSERT INTO upload_tokens (jti, used) VALUES (?, ?)').run(t.j, Date.now());
  return putFile(user, new Uint8Array(body), t.f, String(req.headers['content-type'] ?? 'application/octet-stream'));
}

/** Is this address on the public internet (no loopback, private, link-local or metadata ranges)? */
export function publicAddress(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return publicAddress(v.slice(7));
  return !(v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80'));
}

type Resolved = { address: string; family: number };

/** The addresses of a name, all of which must be public (one private answer refuses the lot). */
export async function resolvePublic(hostname: string, lookup: (host: string) => Promise<Resolved[]> = (h) => dns.lookup(h, { all: true })): Promise<Resolved[]> {
  const host = hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }] : await lookup(host).catch(() => []);
  if (!addrs.length || addrs.some((a) => !publicAddress(a.address))) throw new PortalError("That address can't be fetched");
  return addrs;
}

/** A `lookup` for node:https that answers only with the address we already vetted, whatever the name now resolves to. */
export function pinnedLookup(addr: Resolved) {
  return (_host: string, opts: any, cb: (err: Error | null, address?: any, family?: number) => void) => {
    if (opts && opts.all) cb(null, [{ address: addr.address, family: addr.family }]);
    else cb(null, addr.address, addr.family);
  };
}

/** GETs an https URL, connecting to the vetted address only (the name is still sent for TLS and the Host header). A
 *  redirect is refused. The body is read up to UPLOAD_LIMIT. */
export function fetchPinned(u: URL, addr: Resolved, timeoutMs = 60_000) {
  return new Promise<{ status: number; type: string; body: Uint8Array }>((resolve, reject) => {
    const req = https.request(u, { method: 'GET', lookup: pinnedLookup(addr) as any, timeout: timeoutMs, headers: { 'User-Agent': 'hawkesgen-portal', Accept: '*/*' } }, (r) => {
      const status = r.statusCode ?? 0;
      if (status >= 300 && status < 400) { r.resume(); return reject(new Error('it redirects, which is not followed')); }
      if (status < 200 || status >= 300) { r.resume(); return resolve({ status, type: '', body: new Uint8Array() }); }
      if (Number(r.headers['content-length'] ?? 0) > UPLOAD_LIMIT) { r.resume(); return reject(new PortalError('Files up to 64 MB', { status: 413 })); }
      const chunks: Buffer[] = [];
      let size = 0;
      r.on('data', (c: Buffer) => {
        size += c.length;
        if (size > UPLOAD_LIMIT) { req.destroy(new PortalError('Files up to 64 MB', { status: 413 })); return; }
        chunks.push(c);
      });
      r.on('end', () => resolve({ status, type: String(r.headers['content-type'] ?? 'application/octet-stream'), body: new Uint8Array(Buffer.concat(chunks)) }));
      r.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

/** Fetches a public https file into the customer's library. Private and local addresses are refused, and the connection
 *  goes to the address that was checked, so a name that changes between the check and the fetch reaches nothing private. */
export async function fetchIntoLibrary(user: User, url: string, resolver?: (host: string) => Promise<Resolved[]>) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PortalError('Not a valid URL');
  }
  if (u.protocol !== 'https:') throw new PortalError('Only https:// links can be fetched');
  const [addr] = await resolvePublic(u.hostname, resolver);
  const r = await fetchPinned(u, addr).catch((e) => { if (e instanceof PortalError) throw e; throw new PortalError(`Could not fetch it: ${e.message}`); });
  if (r.status < 200 || r.status >= 300) throw new PortalError(`Could not fetch it (${r.status})`);
  const type = r.type;
  const name = decodeURIComponent(u.pathname.split('/').pop() || 'file') || `file${extFor(type)}`;
  return putFile(user, r.body, name.includes('.') ? name : `${name}${extFor(type)}`, type);
}
