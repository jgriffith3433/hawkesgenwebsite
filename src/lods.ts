// Assets' levels of detail, from Hawkes Gen's LOD system (hawkesgen src/lod.ts): Gen makes smaller copies of every image
// and model itself when the asset is made (part of making it: nobody pays, nothing is listed twice), and keeps them
// with the asset. The portal only reads them, and keeps each asset's summary here by id so a game's bundle and the
// community library carry them inline: playing a game never asks Gen once per asset (latency).
//
//   rememberLods(id, lods)   a Gen asset answer carried its summary (addAsset, the starter sync): keep it
//   lodsOf(ids)              the summaries known now, by id (sync: bundles are built synchronously); anything unknown,
//                            or still being made, is asked for in the background, many in one request, for next time
//   refreshLods(ids)         that request: GET /v1/lods?ids=... (Gen queues any asset made before it had LODs)
//   levelUrls(summary, url)  the summary as the engine takes it: each level at `${url}?lod=<level>&v=<its hash>` (a
//                            link that always means the same file: cached for good), or at Gen's CDN link when the level
//                            is backed up (`cdn`, public assets only: see publicUrls)
//   cdnOf(ids)               Gen's public CDN link of each asset known to be backed up (rememberLods keeps it with the
//                            summary, `gen_lods.cdn`, so a bundle never asks Gen per asset)
//   publicAssetUrl(id, proxy)     the CDN link when there is one, else the proxy link (a draft never uses this: its links are signed)
import { db } from './db.ts';
import { gen } from './gen.ts';
import { cdnHosts } from './config.ts';

db.exec(`
-- (Before Gen had its LOD system, beta's portal made images' copies itself: those tables are gone.)
DROP TABLE IF EXISTS asset_variants;
DROP TABLE IF EXISTS variant_sources;
CREATE TABLE IF NOT EXISTS gen_lods (
  asset TEXT PRIMARY KEY,       -- a_... in Gen
  lods TEXT,                    -- Gen's summary (JSON), null: none (not an image or model, or not made yet)
  state TEXT,                   -- Gen's: queued, done, skipped, failed (null: Gen didn't say)
  fetched INTEGER NOT NULL
);
`);
// Gen's public CDN link of the original (set when the file is in its S3 bucket and the CDN is on). Files are named by their hash, so a link never changes meaning.
if (!(db.prepare('PRAGMA table_info(gen_lods)').all() as { name: string }[]).some((c) => c.name === 'cdn')) db.exec('ALTER TABLE gen_lods ADD COLUMN cdn TEXT');

export type GenLevel = { level: number; bytes: number; w?: number; h?: number; tris?: number; tex?: number; role?: string; sha: string; inS3?: boolean; cdn?: string };
export type GenLods = { kind: 'image' | 'mesh'; state: string; size?: [number, number]; tris?: number; tex?: number; bytes: number; sha: string; inS3?: boolean; cdn?: string; levels: GenLevel[] };

/** How long an answer is good for: levels still being made are asked again soon; made ones rarely (a new LOD version). */
const FRESH = { made: 24 * 3600_000, making: 60_000, none: 10 * 60_000, notBackedUp: 15 * 60_000 };
/** Only links on a CDN host the play page's CSP names (config.ts cdnHosts) are kept: they go into public bundles. */
const CDN_URL = /^(https:\/\/[a-z0-9.-]+(?::\d+)?)\/sha256\/[0-9a-f]+$/;
const goodCdn = (x: unknown): string | null => { const m = typeof x === 'string' ? CDN_URL.exec(x) : null; return m && cdnHosts().includes(m[1]) ? x as string : null; };

/** Keeps what Gen said. `asked`: the answer to GET /v1/lods, which also queues anything Gen hasn't made levels for; an
 *  asset answer without levels (made before the LOD system) is asked about there at its next use. `cdn`: the asset answer's
 *  own CDN link (sounds, videos and other files have no summary but are backed up too); the summary's takes its place. */
export function rememberLods(asset: string, lods: GenLods | null | undefined, o: { asked?: boolean; cdn?: unknown } = {}) {
  if (!/^a_[0-9a-f]+$/.test(asset)) return;
  const cdn = goodCdn(lods?.cdn) ?? goodCdn(o.cdn);
  if (lods === undefined) {
    if (cdn) db.prepare('INSERT INTO gen_lods (asset, lods, state, fetched, cdn) VALUES (?, NULL, NULL, 0, ?) ON CONFLICT(asset) DO UPDATE SET cdn = excluded.cdn').run(asset, cdn);
    return;
  }
  db.prepare('INSERT INTO gen_lods (asset, lods, state, fetched, cdn) VALUES (?, ?, ?, ?, ?) ON CONFLICT(asset) DO UPDATE SET lods = excluded.lods, state = excluded.state, fetched = excluded.fetched, cdn = COALESCE(excluded.cdn, gen_lods.cdn)')
    .run(asset, lods ? JSON.stringify(lods) : null, lods?.state ?? null, lods || o.asked ? Date.now() : 0, cdn);
}

/** An asset as Gen answered it (GET /v1/assets/:id, a list row): its summary and its CDN link. */
export const rememberAsset = (a: { id?: string; lods?: GenLods | null; cdn?: unknown } | null | undefined) => { if (a?.id) rememberLods(a.id, a.lods ?? null, { cdn: a.cdn }); };

/** The CDN links known for these assets (only those Gen has backed up and given a link for). Images and models whose
 *  link isn't known are re-asked about now and then (lodsOf), so a link appears once the file is backed up. */
export function cdnOf(ids: (string | null | undefined)[]): Record<string, string> {
  const list = [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^a_[0-9a-f]+$/.test(x)))];
  const out: Record<string, string> = {};
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400);
    for (const r of db.prepare(`SELECT asset, cdn FROM gen_lods WHERE cdn IS NOT NULL AND asset IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as { asset: string; cdn: string }[]) out[r.asset] = r.cdn;
  }
  return out;
}
/** A public link to the asset: Gen's CDN when it has one, else the portal's own (`proxy`). */
export const publicAssetUrl = (id: string | null | undefined, proxy: string) => (id ? cdnOf([id])[id] : undefined) ?? proxy;

const wanted = new Set<string>();
let timer: NodeJS.Timeout | null = null;
/** The summaries known for these assets (ids without levels are left out). Unknown or stale ones are fetched soon. */
export function lodsOf(ids: (string | null | undefined)[]): Record<string, GenLods> {
  const list = [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^a_[0-9a-f]+$/.test(x)))];
  const out: Record<string, GenLods> = {};
  const now = Date.now();
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400);
    const rows = db.prepare(`SELECT asset, lods, state, fetched, cdn FROM gen_lods WHERE asset IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as { asset: string; lods: string | null; state: string | null; fetched: number; cdn: string | null }[];
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.asset);
      if (r.lods) { const s = JSON.parse(r.lods) as GenLods; if (s.levels?.length) out[r.asset] = s; }
      const age = now - r.fetched;
      // (Made but not on the CDN yet: asked again sooner, since backing up comes after.)
      const made = r.state === 'done' || r.state === 'skipped';
      if (age > (made ? (r.cdn || !r.lods ? FRESH.made : FRESH.notBackedUp) : r.state ? FRESH.making : FRESH.none)) wanted.add(r.asset);
    }
    for (const id of chunk) if (!seen.has(id)) wanted.add(id);
  }
  if (wanted.size && !timer) { timer = setTimeout(() => { timer = null; void refreshLods([...wanted]).catch(() => {}); }, 300); timer.unref?.(); }
  return out;
}

/** Asks Gen for these assets' levels, 200 at a time (the portal's key: every customer's project). */
export async function refreshLods(ids: string[]) {
  for (const id of ids) wanted.delete(id);
  let known = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    let r: { lods: Record<string, GenLods> };
    try {
      r = await gen(`/v1/lods?ids=${chunk.join(',')}`, { signal: AbortSignal.timeout(20_000) });
    } catch (e) {
      // Gen didn't answer (or is older than its LOD system): what we know stays, and these wait a while to be asked again.
      const now = Date.now();
      for (const id of chunk) db.prepare('INSERT INTO gen_lods (asset, lods, state, fetched) VALUES (?, NULL, NULL, ?) ON CONFLICT(asset) DO UPDATE SET fetched = excluded.fetched').run(id, now);
      throw e;
    }
    for (const id of chunk) { rememberLods(id, r.lods?.[id] ?? null, { asked: true }); if (r.lods?.[id]) known++; }
  }
  return known;
}

export type EngineLevel = { level: number; url: string; bytes: number; w?: number; h?: number; tris?: number; tex?: number; role?: string };
export type EngineLods = { kind: 'image' | 'mesh'; size?: [number, number]; tris?: number; tex?: number; bytes: number; levels: EngineLevel[] };
/** A summary as the engine (public/play/textures.js, kinds.js) and the library pages take it: each level with its link.
 *  `url` is the asset's portal link, which each level extends (`?lod=<level>&v=<hash>`); with `cdn` (public assets only), a
 *  level that Gen has backed up is at its own CDN link instead, and one that isn't stays on the portal's. */
export function levelUrls(s: GenLods, url: string, o: { cdn?: boolean } = {}): EngineLods {
  const join = url.includes('?') ? '&' : '?';
  return {
    kind: s.kind, ...(s.size ? { size: s.size } : {}), ...(s.tris ? { tris: s.tris, tex: s.tex ?? 0 } : {}), bytes: s.bytes,
    levels: s.levels.map(({ sha, cdn, inS3, ...l }) => ({ ...l, url: (o.cdn && goodCdn(cdn)) || `${url}${join}lod=${l.level}&v=${sha}` })),
  };
}
