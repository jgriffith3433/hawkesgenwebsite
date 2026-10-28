// The free demo API (src/demo.ts on the old server): one image in, pixel art or a cutout out, no account. The one way to
// run Gen without paying, on purpose and fenced in (AGENTS.md hard rule): only these two tools, which run on Gen's CPU
// (never a GPU tool), images up to 6 MB, DEMO_PER_IP (3) tries per address a day and DEMO_PER_DAY (300) for everyone.
// It runs as the demo project (DEMO_PROJECT), not a customer.
//
// The limits hold across function instances: each try is taken in a Firestore transaction on two documents,
// demoRuns/ip_<hash of the address> and demoRuns/all, each a list of the last day's times (a rolling 24 hours, as before).
import crypto from 'node:crypto';
import { db } from './store.ts';
import { env, PROJECT_PREFIX } from './config.ts';
import { gen, genFetch } from './gen.ts';
import { PortalError, route } from './http.ts';

export const DEMO_PROJECT = `${PROJECT_PREFIX}0000000000000000`;
const MAX_BYTES = 6 * 1024 * 1024;
const DAY = 24 * 3600_000;

/** The two demos: Gen tool and params. CPU tools only. */
export const DEMOS: Record<string, { tool: string; params: Record<string, unknown>; title: string }> = {
  pixel: { tool: 'image.transform', title: 'Pixel art', params: { ops: [{ op: 'trim' }, { op: 'pixelate', size: 64, colors: 16 }, { op: 'outline', width: 1 }, { op: 'scale', factor: 6, pixel: true }], format: 'png' } },
  cutout: { tool: 'image.cutout', title: 'Background removed', params: { glow: false } },
};

const ipHash = (ip: string) => crypto.createHash('sha256').update(`demo:${ip}`).digest('hex').slice(0, 24);
const perIp = () => Number(env('DEMO_PER_IP') ?? 3);
const perDay = () => Number(env('DEMO_PER_DAY') ?? 300);
const runs = () => db.collection('demoRuns');
const recent = (d: FirebaseFirestore.DocumentSnapshot, now: number) => ((d.exists ? d.get('runs') : null) ?? []).filter((t: number) => t >= now - DAY) as number[];

/** Tries left for this address today (also bounded by the day's cap for everyone). */
export async function demoAllowance(ip: string, now = Date.now()) {
  const [mine, all] = await db.getAll(runs().doc(`ip_${ipHash(ip)}`), runs().doc('all'));
  return { left: Math.max(0, Math.min(perIp() - recent(mine, now).length, perDay() - recent(all, now).length)), perIp: perIp() };
}

/** Takes one try for this address, or says it's the last one gone. Strict: one transaction for both counts. */
async function takeTry(ip: string) {
  const now = Date.now();
  const mineRef = runs().doc(`ip_${ipHash(ip)}`);
  const allRef = runs().doc('all');
  const ok = await db.runTransaction(async (t) => {
    const [mine, all] = await Promise.all([t.get(mineRef), t.get(allRef)]);
    const m = recent(mine, now);
    const a = recent(all, now);
    if (m.length >= perIp() || a.length >= perDay()) return false;
    // `expires` lets a Firestore TTL policy drop addresses not seen for a day (firestore.indexes.json).
    t.set(mineRef, { runs: [...m, now], expires: new Date(now + DAY) });
    t.set(allRef, { runs: [...a, now] });
    return true;
  });
  if (!ok) throw lastTry();
}
const lastTry = () => new PortalError('That was the last free try today. Make an account for 50 free credits and keep going.', { status: 429 });

/** Checks the request before anything reaches Gen. */
export async function demoProblem(kind: string, bytes: number, contentType: string, ip: string): Promise<PortalError | null> {
  if (!DEMOS[kind]) return new PortalError('kind: pixel or cutout');
  if (!/^image\/(png|jpeg|webp)$/.test(contentType)) return new PortalError('A PNG, JPG or WebP image');
  if (!bytes) return new PortalError('The image is empty');
  if (bytes > MAX_BYTES) return new PortalError('Images up to 6 MB here (no limit with an account)', { status: 413 });
  if ((await demoAllowance(ip)).left <= 0) return lastTry();
  return null;
}

/** Runs one demo and returns the result image's bytes. */
export async function runDemo(kind: string, data: Uint8Array, contentType: string, ip: string) {
  const problem = await demoProblem(kind, data.length, contentType, ip);
  if (problem) throw problem;
  await takeTry(ip);
  const up = await genFetch(`/v1/assets?project=${DEMO_PROJECT}`, { as: DEMO_PROJECT, method: 'POST', rawBody: data as any, headers: { 'Content-Type': contentType, 'X-Filename': `demo.${contentType.split('/')[1]}` } });
  const a: any = await up.json().catch(() => ({}));
  if (!up.ok) throw new PortalError(a.error ?? 'Upload failed', { status: 502 });
  const d = DEMOS[kind];
  const job = (await gen<{ jobs: any[] }>('/v1/jobs', { as: DEMO_PROJECT, body: { tool: d.tool, params: d.params, inputs: { image: `asset:${a.id}` }, labels: { demo: kind } } })).jobs[0];
  let j = job;
  for (let i = 0; i < 90 && !['done', 'failed', 'cancelled'].includes(j.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    j = await gen(`/v1/jobs/${job.id}`, { as: DEMO_PROJECT });
  }
  if (j.status !== 'done') throw new PortalError(j.status === 'failed' ? `That didn't work: ${j.error ?? 'try another image'}` : 'Busy right now; try again in a minute', { status: 502 });
  const out = (j.outputs ?? []).find((o: any) => String(o.mime).startsWith('image/'));
  if (!out) throw new PortalError('No image came back; try another one', { status: 502 });
  const f = await genFetch(`/v1/assets/${out.asset}/file`, { as: DEMO_PROJECT });
  if (!f.ok) throw new PortalError('Could not fetch the result', { status: 502 });
  return { bytes: Buffer.from(await f.arrayBuffer()), mime: String(out.mime), left: (await demoAllowance(ip)).left };
}

route('GET', '/v1/demo', ({ ip }) => demoAllowance(ip));
route('POST', '/v1/demo', async ({ req, res, url, ip }) => {
  const kind = String(url.searchParams.get('kind') ?? '');
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  const body: Buffer = req.rawBody ?? Buffer.alloc(0);
  const r = await runDemo(kind, new Uint8Array(body), type, ip);
  res.status(200).set({ 'Content-Type': r.mime, 'Cache-Control': 'no-store', 'X-Demo-Left': String(r.left) }).end(r.bytes);
});
