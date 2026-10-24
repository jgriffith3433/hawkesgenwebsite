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
//                            link that always means the same file: cached for good)
import { db } from './db.ts';
import { gen } from './gen.ts';

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

export type GenLevel = { level: number; bytes: number; w?: number; h?: number; tris?: number; tex?: number; role?: string; sha: string };
export type GenLods = { kind: 'image' | 'mesh'; state: string; size?: [number, number]; tris?: number; tex?: number; bytes: number; sha: string; levels: GenLevel[] };

/** How long an answer is good for: levels still being made are asked again soon; made ones rarely (a new LOD version). */
const FRESH = { made: 24 * 3600_000, making: 60_000, none: 10 * 60_000 };

/** Keeps what Gen said. `asked`: the answer to GET /v1/lods, which also queues anything Gen hasn't made levels for; an
 *  asset answer without levels (made before the LOD system) is asked about there at its next use. */
export function rememberLods(asset: string, lods: GenLods | null | undefined, o: { asked?: boolean } = {}) {
  if (!/^a_[0-9a-f]+$/.test(asset) || lods === undefined) return;
  db.prepare('INSERT INTO gen_lods (asset, lods, state, fetched) VALUES (?, ?, ?, ?) ON CONFLICT(asset) DO UPDATE SET lods = excluded.lods, state = excluded.state, fetched = excluded.fetched')
    .run(asset, lods ? JSON.stringify(lods) : null, lods?.state ?? null, lods || o.asked ? Date.now() : 0);
}

const wanted = new Set<string>();
let timer: NodeJS.Timeout | null = null;
/** The summaries known for these assets (ids without levels are left out). Unknown or stale ones are fetched soon. */
export function lodsOf(ids: (string | null | undefined)[]): Record<string, GenLods> {
  const list = [...new Set(ids.filter((x): x is string => typeof x === 'string' && /^a_[0-9a-f]+$/.test(x)))];
  const out: Record<string, GenLods> = {};
  const now = Date.now();
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400);
    const rows = db.prepare(`SELECT asset, lods, state, fetched FROM gen_lods WHERE asset IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as { asset: string; lods: string | null; state: string | null; fetched: number }[];
    const seen = new Set<string>();
    for (const r of rows) {
      seen.add(r.asset);
      if (r.lods) { const s = JSON.parse(r.lods) as GenLods; if (s.levels?.length) out[r.asset] = s; }
      const age = now - r.fetched;
      if (age > (r.state === 'done' || r.state === 'skipped' ? FRESH.made : r.state ? FRESH.making : FRESH.none)) wanted.add(r.asset);
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
/** A summary as the engine (public/play/textures.js, kinds.js) and the library pages take it: each level with its link. */
export function levelUrls(s: GenLods, url: string): EngineLods {
  const join = url.includes('?') ? '&' : '?';
  return {
    kind: s.kind, ...(s.size ? { size: s.size } : {}), ...(s.tris ? { tris: s.tris, tex: s.tex ?? 0 } : {}), bytes: s.bytes,
    levels: s.levels.map(({ sha, ...l }) => ({ ...l, url: `${url}${join}lod=${l.level}&v=${sha}` })),
  };
}
