// Assets' levels of detail, from Hawkes Gen's LOD system (hawkesgen src/lod.ts): Gen makes smaller copies of every image
// and model itself when the asset is made, and keeps them with the asset. The portal only reads them, and keeps each
// asset's summary by id so bundles and the community library carry them inline (no request to Gen per asset).
//
// Firestore: genLods/{a_id} { lods (Gen's summary, a map, or null), state, fetched, cdn (or null), want }
//   rememberLods / rememberAsset / rememberMany   keep what a Gen answer said (written only when it changed)
//   lodsOf(ids)          the summaries known now. On the old server, unknown or stale ids were fetched 300 ms later by a
//                        timer; a function has no such timer, so they are marked `want` and the scheduled `refreshLods` (askLods)
//                        (every 15 minutes) asks Gen for them, many in one request
//   cdnOf(ids)           Gen's public CDN link of each asset known to be backed up
//   levelUrls(summary)   the summary as the engine takes it: each level at `${url}?lod=<level>&v=<hash>`, or its CDN link
import { onSchedule } from 'firebase-functions/scheduler';
import { db, FieldValue } from './store.ts';
import { gen } from './gen.ts';
import { cdnHosts, SECRETS } from './config.ts';

export type GenLevel = { level: number; bytes: number; w?: number; h?: number; tris?: number; tex?: number; role?: string; sha: string; inS3?: boolean; cdn?: string };
export type GenLods = { kind: 'image' | 'mesh'; state: string; size?: [number, number]; tris?: number; tex?: number; bytes: number; sha: string; inS3?: boolean; cdn?: string; levels: GenLevel[] };
type LodDoc = { lods: GenLods | null; state: string | null; fetched: number; cdn: string | null; want?: number };

const col = () => db.collection('genLods');
/** How long an answer is good for: levels still being made are asked again soon; made ones rarely. */
const FRESH = { made: 24 * 3600_000, making: 60_000, none: 10 * 60_000, notBackedUp: 15 * 60_000 };
const ASSET = /^a_[0-9a-f]+$/;
/** Only links on a CDN host the play page's CSP names (config.ts cdnHosts) are kept: they go into public answers. */
const CDN_URL = /^(https:\/\/[a-z0-9.-]+(?::\d+)?)\/sha256\/[0-9a-f]+$/;
const goodCdn = (x: unknown): string | null => { const m = typeof x === 'string' ? CDN_URL.exec(x) : null; return m && cdnHosts().includes(m[1]) ? x as string : null; };
const ids = (list: (string | null | undefined)[]) => [...new Set(list.filter((x): x is string => typeof x === 'string' && ASSET.test(x)))];

/** Reads genLods documents for these ids (getAll, 300 at a time). */
async function docs(list: string[]): Promise<Map<string, LodDoc>> {
  const out = new Map<string, LodDoc>();
  for (let i = 0; i < list.length; i += 300) {
    const snaps = await db.getAll(...list.slice(i, i + 300).map((a) => col().doc(a)));
    for (const s of snaps) if (s.exists) out.set(s.id, s.data() as LodDoc);
  }
  return out;
}

type Said = { asset: string; lods: GenLods | null | undefined; asked?: boolean; cdn?: unknown };
/** The document a Gen answer makes of what was there (null: nothing to write). */
function merged(was: LodDoc | undefined, s: Said, now: number): Partial<LodDoc> | null {
  const cdn = goodCdn(s.lods?.cdn) ?? goodCdn(s.cdn);
  if (s.lods === undefined) {
    // Only a CDN link (sounds, videos: no summary but backed up).
    if (!cdn || was?.cdn === cdn) return null;
    return was ? { cdn } : { lods: null, state: null, fetched: 0, cdn };
  }
  const next: LodDoc = { lods: s.lods ?? null, state: s.lods?.state ?? null, fetched: s.lods || s.asked ? now : 0, cdn: cdn ?? was?.cdn ?? null };
  if (was && JSON.stringify(was.lods ?? null) === JSON.stringify(next.lods) && was.state === next.state && was.cdn === next.cdn && !was.want && (next.fetched === 0 || now - was.fetched < FRESH.making)) return null;
  return next;
}

/** Keeps what Gen said about many assets: one read, then writes only where something changed. */
export async function rememberMany(said: Said[]) {
  const list = said.filter((s) => ASSET.test(s.asset));
  if (!list.length) return 0;
  const have = await docs(ids(list.map((s) => s.asset)));
  const now = Date.now();
  let batch = db.batch();
  let n = 0;
  let written = 0;
  for (const s of list) {
    const next = merged(have.get(s.asset), s, now);
    if (!next) continue;
    batch.set(col().doc(s.asset), { ...next, want: FieldValue.delete() }, { merge: true });
    written++;
    if (++n === 450) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
  return written;
}

export const rememberLods = (asset: string, lods: GenLods | null | undefined, o: { asked?: boolean; cdn?: unknown } = {}) => rememberMany([{ asset, lods, ...o }]);
/** An asset as Gen answered it (GET /v1/assets/:id, a list row): its summary and its CDN link. */
export const rememberAsset = (a: { id?: string; lods?: GenLods | null; cdn?: unknown } | null | undefined) => (a?.id ? rememberLods(a.id, a.lods ?? null, { cdn: a.cdn }) : Promise.resolve(0));

/** What one lookup knows: the summaries (ids with levels) and the CDN links. Stale or unknown ids are marked for the
 *  scheduled refresh. Callers that need both use this once rather than lodsOf and cdnOf apart. */
export async function known(list: (string | null | undefined)[]) {
  const all = ids(list);
  const have = await docs(all);
  const lods: Record<string, GenLods> = {};
  const cdn: Record<string, string> = {};
  const now = Date.now();
  const want: string[] = [];
  for (const a of all) {
    const r = have.get(a);
    if (!r) { want.push(a); continue; }
    if (r.lods?.levels?.length) lods[a] = r.lods;
    if (r.cdn) cdn[a] = r.cdn;
    const made = r.state === 'done' || r.state === 'skipped';
    const age = now - Number(r.fetched ?? 0);
    if (!r.want && age > (made ? (r.cdn || !r.lods ? FRESH.made : FRESH.notBackedUp) : r.state ? FRESH.making : FRESH.none)) want.push(a);
  }
  if (want.length) await markWanted(want, have).catch(() => {});
  return { lods, cdn };
}
export const lodsOf = async (list: (string | null | undefined)[]) => (await known(list)).lods;
export const cdnOf = async (list: (string | null | undefined)[]) => (await known(list)).cdn;
/** A public link to the asset: Gen's CDN when it has one, else the portal's own (`proxy`). */
export const publicAssetUrl = async (assetId: string | null | undefined, proxy: string) => (assetId ? (await cdnOf([assetId]))[assetId] : undefined) ?? proxy;

async function markWanted(list: string[], have: Map<string, LodDoc>) {
  let batch = db.batch();
  let n = 0;
  const now = Date.now();
  for (const a of list) {
    batch.set(col().doc(a), have.has(a) ? { want: now } : { lods: null, state: null, fetched: 0, cdn: null, want: now }, { merge: true });
    if (++n === 450) { await batch.commit(); batch = db.batch(); n = 0; }
  }
  if (n) await batch.commit();
}

/** Asks Gen for these assets' levels, 200 at a time (the portal's key: every customer's project). */
export async function askLods(list: string[]) {
  let got = 0;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    let r: { lods: Record<string, GenLods> };
    try {
      r = await gen(`/v1/lods?ids=${chunk.join(',')}`, { signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      // Gen didn't answer: what we know stays, and these wait a while to be asked again.
      const batch = db.batch();
      for (const a of chunk) batch.set(col().doc(a), { fetched: Date.now(), want: FieldValue.delete() }, { merge: true });
      await batch.commit();
      throw e;
    }
    await rememberMany(chunk.map((a) => ({ asset: a, lods: r.lods?.[a] ?? null, asked: true })));
    // (rememberMany skips unchanged rows; their `want` mark still has to go.)
    const batch = db.batch();
    for (const a of chunk) batch.set(col().doc(a), { want: FieldValue.delete(), fetched: Date.now() }, { merge: true });
    await batch.commit();
    got += chunk.filter((a) => r.lods?.[a]).length;
  }
  return got;
}

/** One round of the schedule: what lookups marked as wanted, and summaries made but not on the CDN yet (every 15 minutes). */
export async function refreshRound() {
  const now = Date.now();
  const wanted = await col().where('want', '>', 0).limit(2000).get();
  const notBackedUp = await col().where('cdn', '==', null).where('fetched', '<', now - FRESH.notBackedUp).limit(500).get();
  const list = new Set(wanted.docs.map((d) => d.id));
  for (const d of notBackedUp.docs) {
    const r = d.data() as LodDoc;
    if (r.lods && (r.state === 'done' || r.state === 'skipped')) list.add(d.id);
  }
  return { asked: list.size, known: list.size ? await askLods([...list]) : 0 };
}

export const refreshLods = onSchedule({ schedule: 'every 15 minutes', secrets: [SECRETS.genKey], timeoutSeconds: 300 }, async () => { await refreshRound(); });

export type EngineLevel = { level: number; url: string; bytes: number; w?: number; h?: number; tris?: number; tex?: number; role?: string };
export type EngineLods = { kind: 'image' | 'mesh'; size?: [number, number]; tris?: number; tex?: number; bytes: number; levels: EngineLevel[] };
/** A summary as the engine and the library pages take it: each level with its link (`?lod=<level>&v=<hash>` on `url`), or,
 *  with `cdn` (public assets only), the level's own CDN link when Gen has backed it up. */
export function levelUrls(s: GenLods, url: string, o: { cdn?: boolean } = {}): EngineLods {
  const join = url.includes('?') ? '&' : '?';
  return {
    kind: s.kind, ...(s.size ? { size: s.size } : {}), ...(s.tris ? { tris: s.tris, tex: s.tex ?? 0 } : {}), bytes: s.bytes,
    levels: s.levels.map(({ sha, cdn, inS3, ...l }) => ({ ...l, url: (o.cdn && goodCdn(cdn)) || `${url}${join}lod=${l.level}&v=${sha}` })),
  };
}
