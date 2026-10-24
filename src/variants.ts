// Smaller copies of every image a game or the community library uses (textures, sprites, skies, pictures): 128, 256,
// 512, 1024 and 2048 px on the long side, as WebP, plus the full size as WebP when the original is a PNG or JPEG. The
// engine loads the smallest first and upgrades what's near and big on screen within the device's memory budget
// (public/play/textures.js), so a phone never downloads or holds megabytes it can't show.
//
// They are made once per image, by Gen's image.transform (Pillow on Gen's CPU: no GPU, no credits), as the image's own
// project, and kept here by id: asset_variants (image, size) -> the variant's asset id. Who pays: nobody. This is the
// platform's own work, started by the portal (never by a request a customer shapes: the steps are fixed here), once per
// image, and capped for customers' images (VARIANTS_PER_DAY, 400 a day for everyone). AGENTS.md lists it beside the demo.
//
//   queueVariants(asset, project, o)   an image entered the library or a game: make its variants (soon, in the background)
//   variantMap(ids)                    { id: { size: [w, h], variants: { 128: { id, bytes, w, h } } } } for the bundle
//   watchVariants()                    the background worker (and the backfill of everything already there, at start)
//   backfillVariants()                 queues every community image and every image in a game that has none yet
import { db } from './db.ts';
import { env } from './config.ts';
import { gen, genFetch } from './gen.ts';

/** The variant sizes (px on the long side). */
export const VARIANT_SIZES = [128, 256, 512, 1024, 2048];
/** WebP quality for the variants: small files, no visible loss at the size they're shown. */
export const VARIANT_QUALITY = 82;
const IMAGE_MIME = /^image\/(png|jpeg|webp)$/;
const DAY = 24 * 3600_000;

db.exec(`
CREATE TABLE IF NOT EXISTS asset_variants (
  asset TEXT NOT NULL,          -- the original image (a_...)
  size INTEGER NOT NULL,        -- its long side, px
  variant TEXT NOT NULL,        -- the smaller copy (a_...), in the same Gen project
  mime TEXT,
  bytes INTEGER,
  width INTEGER,
  height INTEGER,
  PRIMARY KEY (asset, size)
);
CREATE INDEX IF NOT EXISTS asset_variants_variant ON asset_variants (variant);
-- One row per image that should have variants: what's left to do, and the original's size.
CREATE TABLE IF NOT EXISTS variant_sources (
  asset TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  source TEXT NOT NULL,         -- 'community' (Hawkes' and players' shared things) or 'game' (a customer's game asset)
  state TEXT NOT NULL,          -- 'pending', 'done', 'skipped' (not an image we can read, or small already), 'failed'
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  tries INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS variant_sources_state ON variant_sources (state, created);
`);

// ------------------------------------------------------------------ an image's size, from its first bytes
/** Width and height of a PNG, JPEG, WebP or GIF (null when it isn't one we can read). No dependencies. */
export function imageSize(b: Uint8Array): { width: number; height: number; type: string } | null {
  const u8 = b;
  const be16 = (i: number) => (u8[i] << 8) | u8[i + 1];
  const be32 = (i: number) => ((u8[i] << 24) >>> 0) + (u8[i + 1] << 16) + (u8[i + 2] << 8) + u8[i + 3];
  const le16 = (i: number) => u8[i] | (u8[i + 1] << 8);
  const le24 = (i: number) => u8[i] | (u8[i + 1] << 8) | (u8[i + 2] << 16);
  const ascii = (i: number, n: number) => String.fromCharCode(...u8.subarray(i, i + n));
  if (u8.length >= 24 && u8[0] === 0x89 && ascii(1, 3) === 'PNG') return { width: be32(16), height: be32(20), type: 'png' };
  if (u8.length >= 10 && ascii(0, 3) === 'GIF') return { width: le16(6), height: le16(8), type: 'gif' };
  if (u8.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: le24(24) + 1, height: le24(27) + 1, type: 'webp' };
    if (chunk === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff, type: 'webp' };
    if (chunk === 'VP8L') { const v = u8[21] | (u8[22] << 8) | (u8[23] << 16) | (u8[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1, type: 'webp' }; }
    return null;
  }
  if (u8.length >= 4 && u8[0] === 0xff && u8[1] === 0xd8) {
    let i = 2;
    while (i + 9 < u8.length) {
      if (u8[i] !== 0xff) { i++; continue; }
      const m = u8[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = be16(i + 2);
      // Start of frame (any kind but DHT, JPG and DAC): the size.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: be16(i + 7), height: be16(i + 5), type: 'jpeg' };
      i += 2 + len;
    }
  }
  return null;
}

// ------------------------------------------------------------------ which variants an image gets
export type VariantStep = { size: number; width: number; height: number; ops: Record<string, unknown>[] };
/** The variants an image of this size gets: every size below its long side, then the full size as WebP when the
 *  original isn't WebP already (a 1 MB PNG is about 150 KB as WebP). The steps are Gen image.transform ops. */
export function variantPlan(width: number, height: number, mime?: string | null): VariantStep[] {
  const long = Math.max(width, height);
  if (!(long > 0) || long > 16384) return [];
  const fit = (s: number) => (width >= height ? { width: s, height: Math.max(1, Math.round((height * s) / width)) } : { width: Math.max(1, Math.round((width * s) / height)), height: s });
  const out: VariantStep[] = [];
  for (const s of VARIANT_SIZES) {
    if (s >= long) break;
    const d = fit(s);
    out.push({ size: s, ...d, ops: [{ op: 'resize', ...(width >= height ? { width: s } : { height: s }), fit: 'stretch', ...(width >= height ? { height: d.height } : { width: d.width }) }] });
  }
  if (!/webp/.test(String(mime ?? '')) && long > VARIANT_SIZES[0] && long <= 8192) out.push({ size: long, width, height, ops: [{ op: 'scale', factor: 1 }] });
  return out;
}

// ------------------------------------------------------------------ the queue
/** An image entered the library or a game: its variants get made in the background (once; repeats do nothing). */
export function queueVariants(asset: string, project: string, o: { mime?: string | null; source?: 'community' | 'game' } = {}) {
  if (!/^a_[0-9a-f]+$/.test(asset) || !project) return false;
  if (o.mime !== undefined && o.mime !== null && !IMAGE_MIME.test(String(o.mime))) return false;
  const now = Date.now();
  const r = db.prepare("INSERT OR IGNORE INTO variant_sources (asset, project, source, state, created, updated) VALUES (?, ?, ?, 'pending', ?, ?)").run(asset, project, o.source ?? 'game', now, now);
  // Something already known as a game image that the library now lists: it's Hawkes' or shared, so not capped.
  if (!r.changes && o.source === 'community') db.prepare("UPDATE variant_sources SET source = 'community' WHERE asset = ?").run(asset);
  if (r.changes) kick();
  return Boolean(r.changes);
}

/** Every image in the community library and in games without variants yet: queued (nothing is made twice). */
export function backfillVariants() {
  let queued = 0;
  let rows: { id: string; project: string; mime: string | null; kind: string; thumb: string | null }[] = [];
  try { rows = db.prepare('SELECT id, project, mime, kind, thumb FROM community_assets WHERE hidden = 0').all() as typeof rows; } catch { /* no library table yet */ }
  for (const r of rows) {
    if (['texture', 'image', 'sprite', 'sky'].includes(r.kind) && queueVariants(r.id, r.project, { mime: r.mime, source: 'community' })) queued++;
    if (r.thumb && queueVariants(r.thumb, r.project, { source: 'community' })) queued++;
  }
  try {
    const g = db.prepare("SELECT DISTINCT asset, project, mime FROM game_assets WHERE mime LIKE 'image/%'").all() as { asset: string; project: string; mime: string }[];
    for (const r of g) if (queueVariants(r.asset, r.project, { mime: r.mime, source: 'game' })) queued++;
  } catch { /* no games table yet */ }
  return { queued, ...variantStatus() };
}

/** How far along it is: images by state, and variants made. */
export function variantStatus() {
  const by = Object.fromEntries((db.prepare('SELECT state, COUNT(*) AS n FROM variant_sources GROUP BY state').all() as { state: string; n: number }[]).map((r) => [r.state, r.n]));
  const v = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes FROM asset_variants').get() as { n: number; bytes: number };
  return { images: by, variants: v.n, variantBytes: v.bytes };
}

// ------------------------------------------------------------------ making them
type Source = { asset: string; project: string; source: string; state: string; width: number | null; height: number | null; tries: number };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One image transform on Gen as the image's own project; resolves with the output asset, or throws. */
async function transform(src: Source, step: VariantStep, waitMs: number) {
  const job = (await gen<{ jobs: any[] }>('/v1/jobs', { as: src.project, body: { tool: 'image.transform', params: { ops: step.ops, format: 'webp', quality: VARIANT_QUALITY }, inputs: { image: `asset:${src.asset}` }, labels: { lod: String(step.size), of: src.asset } } })).jobs[0];
  let j = job;
  const until = Date.now() + waitMs;
  while (!['done', 'failed', 'cancelled'].includes(j.status) && Date.now() < until) {
    await sleep(Number(env('VARIANTS_POLL_MS') ?? 1000));
    j = await gen(`/v1/jobs/${job.id}`, { as: src.project });
  }
  if (j.status !== 'done') throw new Error(j.status === 'failed' ? `image.transform failed: ${j.error ?? '?'}` : 'image.transform timed out');
  const out = (j.outputs ?? []).find((o: any) => String(o.mime ?? '').startsWith('image/'));
  if (!out?.asset) throw new Error('image.transform gave no image');
  return { id: String(out.asset), mime: String(out.mime), bytes: Number(out.bytes) || null, width: Number(j.result?.width) || step.width, height: Number(j.result?.height) || step.height };
}

/** Makes one image's missing variants. Returns what it did. */
export async function makeVariants(asset: string, o: { waitMs?: number } = {}) {
  const src = db.prepare('SELECT * FROM variant_sources WHERE asset = ?').get(asset) as Source | undefined;
  if (!src) return { asset, state: 'unknown' };
  const set = (state: string, extra: Record<string, unknown> = {}) => {
    const cols = Object.keys(extra);
    db.prepare(`UPDATE variant_sources SET state = ?, updated = ?${cols.map((c) => `, ${c} = ?`).join('')} WHERE asset = ?`).run(state, Date.now(), ...(Object.values(extra) as any[]), asset);
  };
  db.prepare('UPDATE variant_sources SET tries = tries + 1, updated = ? WHERE asset = ?').run(Date.now(), asset);
  try {
    // Its size and type, from the file itself.
    const r = await genFetch(`/v1/assets/${asset}/file`, { as: src.project, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`the file answered ${r.status}`);
    const buf = new Uint8Array(await r.arrayBuffer());
    const s = imageSize(buf);
    if (!s || s.type === 'gif') { set('skipped', { error: s ? 'a GIF (animated pictures keep their frames)' : 'not an image we can read', bytes: buf.length }); return { asset, state: 'skipped' }; }
    const { width, height } = s;
    set('pending', { width, height, bytes: buf.length });
    const done = new Set((db.prepare('SELECT size FROM asset_variants WHERE asset = ?').all(asset) as { size: number }[]).map((r) => r.size));
    const plan = variantPlan(width, height, `image/${s.type}`);
    if (!plan.length) { set('skipped', { error: 'small already' }); return { asset, state: 'skipped' }; }
    let made = 0;
    for (const step of plan) {
      if (done.has(step.size)) continue;
      const v = await transform(src, step, o.waitMs ?? 120_000);
      // The full size again only when WebP is smaller (it nearly always is).
      if (step.size === Math.max(width, height) && v.bytes && v.bytes >= buf.length) continue;
      db.prepare('INSERT OR REPLACE INTO asset_variants (asset, size, variant, mime, bytes, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)').run(asset, step.size, v.id, v.mime, v.bytes, v.width, v.height);
      made++;
    }
    set('done', { error: null });
    return { asset, state: 'done', made };
  } catch (e: any) {
    const tries = (db.prepare('SELECT tries FROM variant_sources WHERE asset = ?').get(asset) as { tries: number }).tries;
    set(tries >= 3 ? 'failed' : 'pending', { error: String(e?.message ?? e).slice(0, 300) });
    return { asset, state: 'error', error: String(e?.message ?? e) };
  }
}

/** Customers' images done in the last day (the cap; Hawkes' and shared library things aren't counted). */
const gameImagesToday = () => Number((db.prepare("SELECT COUNT(*) AS n FROM variant_sources WHERE source = 'game' AND state IN ('done', 'failed') AND updated >= ?").get(Date.now() - DAY) as { n: number }).n);

/** The next image to do: library things first, then games' (within the day's cap). Retries wait a little. */
function next(): Source | null {
  const retry = Date.now() - 5 * 60_000;
  const c = db.prepare("SELECT * FROM variant_sources WHERE state = 'pending' AND source = 'community' AND (tries = 0 OR updated < ?) ORDER BY created LIMIT 1").get(retry) as Source | undefined;
  if (c) return c;
  if (gameImagesToday() >= Number(env('VARIANTS_PER_DAY') ?? 400)) return null;
  return (db.prepare("SELECT * FROM variant_sources WHERE state = 'pending' AND (tries = 0 OR updated < ?) ORDER BY created LIMIT 1").get(retry) as Source | undefined) ?? null;
}

let running: Promise<void> | null = null;
let wake: (() => void) | null = null;
/** Works through the queue, one image at a time (Gen's CPU is shared). */
export function drainVariants(o: { max?: number; waitMs?: number } = {}) {
  if (running) return running;
  running = (async () => {
    await null; // (so `running` is set before the finally below can clear it)
    try {
      for (let i = 0; i < (o.max ?? 1e9); i++) {
        const s = next();
        if (!s) break;
        await makeVariants(s.asset, { waitMs: o.waitMs });
      }
    } finally { running = null; }
  })();
  return running;
}
function kick() { if (wake) wake(); }

/** The background worker: the backfill at start (anything without variants is queued), then the queue as it fills. */
export function watchVariants(everyMs = 30_000) {
  let stopped = false;
  const loop = async () => {
    try { const b = backfillVariants(); if (b.queued) console.log(`[portal] image variants: ${b.queued} images queued`); } catch (e: any) { console.warn('[portal] image variants backfill:', e.message); }
    while (!stopped) {
      await drainVariants().catch((e) => console.warn('[portal] image variants:', e.message));
      await new Promise<void>((r) => { const t = setTimeout(r, everyMs); t.unref?.(); wake = () => { clearTimeout(t); r(); }; });
      wake = null;
    }
  };
  void loop();
  return () => { stopped = true; kick(); };
}

// ------------------------------------------------------------------ reading them
export type VariantInfo = { size: [number, number] | null; variants: Record<string, { id: string; bytes: number | null; w: number | null; h: number | null }> };
/** The variants of these images, by image id (images without any are left out). */
export function variantMap(ids: string[]): Record<string, VariantInfo> {
  const out: Record<string, VariantInfo> = {};
  const list = [...new Set(ids.filter((x) => /^a_[0-9a-f]+$/.test(x)))];
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400);
    const q = chunk.map(() => '?').join(',');
    const sizes = db.prepare(`SELECT asset, width, height FROM variant_sources WHERE asset IN (${q})`).all(...chunk) as { asset: string; width: number | null; height: number | null }[];
    const dims = new Map(sizes.map((s) => [s.asset, s.width && s.height ? [s.width, s.height] as [number, number] : null]));
    for (const r of db.prepare(`SELECT asset, size, variant, bytes, width, height FROM asset_variants WHERE asset IN (${q}) ORDER BY size`).all(...chunk) as { asset: string; size: number; variant: string; bytes: number | null; width: number | null; height: number | null }[]) {
      const e = (out[r.asset] ??= { size: dims.get(r.asset) ?? null, variants: {} });
      e.variants[String(r.size)] = { id: r.variant, bytes: r.bytes, w: r.width, h: r.height };
    }
  }
  return out;
}

/** The variant of an image at a size (exactly that size, else the next bigger one, else the biggest): its asset id. */
export function variantAt(asset: string, size: number): string | null {
  const r = (db.prepare('SELECT variant FROM asset_variants WHERE asset = ? AND size >= ? ORDER BY size LIMIT 1').get(asset, size) ?? db.prepare('SELECT variant FROM asset_variants WHERE asset = ? ORDER BY size DESC LIMIT 1').get(asset)) as { variant: string } | undefined;
  return r?.variant ?? null;
}

/** Which image a variant belongs to (null: it isn't one). */
export const variantOf = (variant: string) => ((db.prepare('SELECT asset FROM asset_variants WHERE variant = ?').get(variant) as { asset: string } | undefined)?.asset ?? null);

/** A Gen library list without the variants (they belong to their image, not in the customer's own list). */
export function hideVariants<T extends { items?: any[]; total?: number }>(list: T): T {
  if (!list || !Array.isArray(list.items)) return list;
  const items = list.items.filter((a) => !(a && a.labels && a.labels.lod !== undefined && a.labels.of));
  return { ...list, items, total: typeof list.total === 'number' ? Math.max(items.length, list.total - (list.items.length - items.length)) : list.total };
}
