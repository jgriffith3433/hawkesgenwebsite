// Files for agents. Downloads: a signed link per output (/dl/<token>/<name>, a day) that `curl -o` fetches without a key.
// Uploads: a one-time link (/up/<token>, half an hour) that `curl -T file` sends to, or bytes/a public URL given directly.
// Either way the file lands in Gen as the customer's asset and is used as "asset:a_...".
// Signing is HMAC-SHA256 with the portal's signing key (Secret Manager PORTAL_SIGNING_KEY, config.ts SECRETS.signing).
// A used upload link is a document uploadTokens/{jti}, created once in a transaction.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { db } from './store.ts';
import { publicUrl, SECRETS } from './config.ts';
import { genFetch } from './gen.ts';
import { getUser, requireUser, type User } from './accounts.ts';
import { id, PortalError, route, send, json } from './http.ts';

/** What a function can take in one request is 32 MB (Cloud Functions' limit), so uploads through a link or inline stop
 *  just under it. A file fetched from an https address is read by the function itself and may be bigger. */
export const UPLOAD_LIMIT = 30 * 1024 * 1024;
export const FETCH_LIMIT = 64 * 1024 * 1024;
const TOO_BIG = 'Files up to 30 MB through an upload link (a limit of where this site runs). For a bigger file, put it at a public https address and pass the URL instead (up to 64 MB).';

// ------------------------------------------------------------ signed tokens (src/sign.ts)

const key = () => Buffer.from(SECRETS.signing.value());
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
  // Compared as text: decoding first would let a stray trailing character through (base64url drops it).
  const want = Buffer.from(b64(mac(body)));
  const got = Buffer.from(sig);
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

// ------------------------------------------------------------ files

const EXT: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'model/gltf-binary': '.glb', 'application/json': '.json', 'text/plain': '.txt' };
export const extFor = (mime = '') => EXT[mime.split(';')[0]] ?? '';
const safeName = (s: string) => String(s || 'file').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';

/** A download link for one of the customer's assets, good for a day. */
export function downloadUrl(user: User, asset: string, name: string) {
  return `${publicUrl()}/dl/${sign({ p: user.project, a: asset }, 24 * 3600)}/${safeName(name)}`;
}

/** The bytes of a customer's asset (previews for the agent). */
export async function assetBytes(user: User, asset: string, max = 1_500_000) {
  const r = await genFetch(`/v1/assets/${asset}/file`, { as: user.project, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return null;
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len && len > max) { void r.body?.cancel().catch(() => {}); return null; }
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length > max ? null : buf;
}

/** Puts bytes into Gen as the customer's asset. */
export async function putFile(user: User, data: Uint8Array, filename: string, contentType = 'application/octet-stream', limit = FETCH_LIMIT) {
  if (!data.length) throw new PortalError('The file is empty');
  if (data.length > limit) throw new PortalError(limit === UPLOAD_LIMIT ? TOO_BIG : 'Files up to 64 MB', { status: 413 });
  const r = await genFetch(`/v1/assets?project=${encodeURIComponent(user.project)}`, { as: user.project, method: 'POST', rawBody: data as any, headers: { 'Content-Type': contentType, 'X-Filename': safeName(filename) }, signal: AbortSignal.timeout(280_000) });
  const a: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(a.error ?? `Upload failed (${r.status})`, { status: r.status === 413 ? 413 : 502 });
  return { asset: a.id as string, ref: `asset:${a.id}`, kind: a.kind as string, mime: a.mime as string, size: data.length };
}

/** A one-time upload link: PUT or POST the file's bytes to it. */
export function uploadLink(user: User, filename: string) {
  const jti = id('u', 8);
  const url = `${publicUrl()}/up/${sign({ u: user.id, f: safeName(filename), j: jti }, 30 * 60)}`;
  return { url, curl: `curl -sS -T "${filename.replace(/"/g, '')}" "${url}"`, expiresInMinutes: 30, maxMB: UPLOAD_LIMIT / 1024 / 1024 };
}

// ------------------------------------------------------------ fetching public https files (no private addresses)

/** Is this address on the public internet (no loopback, private, link-local or metadata ranges)? */
export function publicAddress(ip: string): boolean {
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
 *  redirect is refused. The body is read up to FETCH_LIMIT. */
export function fetchPinned(u: URL, addr: Resolved, timeoutMs = 60_000) {
  return new Promise<{ status: number; type: string; body: Uint8Array }>((resolve, reject) => {
    const req = https.request(u, { method: 'GET', lookup: pinnedLookup(addr) as any, timeout: timeoutMs, headers: { 'User-Agent': 'hawkesgen-portal', Accept: '*/*' } }, (r) => {
      const status = r.statusCode ?? 0;
      if (status >= 300 && status < 400) { r.resume(); return reject(new Error('it redirects, which is not followed')); }
      if (status < 200 || status >= 300) { r.resume(); return resolve({ status, type: '', body: new Uint8Array() }); }
      if (Number(r.headers['content-length'] ?? 0) > FETCH_LIMIT) { r.resume(); return reject(new PortalError('Files up to 64 MB', { status: 413 })); }
      const chunks: Buffer[] = [];
      let size = 0;
      r.on('data', (c: Buffer) => {
        size += c.length;
        if (size > FETCH_LIMIT) { req.destroy(new PortalError('Files up to 64 MB', { status: 413 })); return; }
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
  let name: string;
  try { name = decodeURIComponent(u.pathname.split('/').pop() || '') || `file${extFor(type)}`; } catch { name = `file${extFor(type)}`; }
  return putFile(user, r.body, name.includes('.') ? name : `${name}${extFor(type)}`, type);
}

// ------------------------------------------------------------ routes (no auth header: the link is the key)

route('GET', /^\/dl\/([\w-]+\.[\w-]+)(?:\/[^/]*)?$/, async ({ res, params, method }) => {
  const t = verify<{ p: string; a: string }>(params[0]);
  if (!t || !/^a_[0-9a-f]+$/.test(t.a)) throw new PortalError('This link has expired. Ask for the file again.', { status: 410 });
  const r = await genFetch(`/v1/assets/${t.a}/file`, { as: t.p, signal: AbortSignal.timeout(280_000) });
  if (!r.ok || !r.body) throw new PortalError('File not found', { status: 404 });
  // Streamed (chunked) without a length when big: a function's answer over 32 MB must be streamed to get through.
  const len = Number(r.headers.get('content-length') ?? 0);
  res.status(200).set({ 'Content-Type': r.headers.get('content-type') ?? 'application/octet-stream', ...(len && len < 32 * 1024 * 1024 ? { 'Content-Length': String(len) } : {}), 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'attachment' });
  if (method === 'HEAD') { void r.body.cancel().catch(() => {}); return void res.end(); }
  await pipeline(Readable.fromWeb(r.body as any), res).catch(() => {});
});

async function receiveUpload(token: string, req: any) {
  const t = verify<{ u: string; f: string; j: string }>(token);
  if (!t) throw new PortalError('This upload link has expired. Ask for a new one.', { status: 410 });
  const user = await getUser(t.u);
  if (!user || user.disabled) throw new PortalError('Account not available', { status: 403 });
  const body: Buffer | undefined = req.rawBody;
  if (Number(req.headers['content-length'] ?? 0) > UPLOAD_LIMIT || (body?.length ?? 0) > UPLOAD_LIMIT) throw new PortalError(TOO_BIG, { status: 413 });
  if (!body?.length) throw new PortalError('The file is empty');
  // Used once: the link's document is created (a second use finds it and is refused) before the file goes to Gen.
  const used = await db.runTransaction(async (tx) => {
    const ref = db.collection('uploadTokens').doc(t.j);
    if ((await tx.get(ref)).exists) return true;
    tx.create(ref, { used: Date.now(), user: user.id, expires: t.e * 1000 });
    return false;
  });
  if (used) throw new PortalError('This upload link was already used. Ask for a new one.', { status: 410 });
  return putFile(user, new Uint8Array(body), t.f, String(req.headers['content-type'] ?? 'application/octet-stream'), UPLOAD_LIMIT);
}
for (const method of ['PUT', 'POST']) route(method, /^\/up\/([\w-]+\.[\w-]+)$/, async ({ req, res, params }) => send(res, 200, await receiveUpload(params[0], req)));

route('POST', '/v1/uploads', async ({ req }) => uploadLink(await requireUser(req), String(json(req).filename ?? 'upload.bin')));
