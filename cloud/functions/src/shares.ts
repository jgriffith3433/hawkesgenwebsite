// Share links for photos and clips from games: /s/<id> (src/shares.ts on the old server). The file is the player's own Gen
// asset (uploaded through the POST /v1/assets pass-through); the share document only says which asset, its picture, its
// title and which game it came from. The share page is rendered here with Open Graph and Twitter tags (Discord and X
// read them; they don't run scripts), and its media is streamed from Gen (Range included, never as a page).
//
// Firestore: shares/{id} with the SQLite columns. Games are read from games/{g_id} (slug, title, hidden), the games area's.
import crypto from 'node:crypto';
import type { Response } from 'express';
import { db, FieldValue, users } from './store.ts';
import { gen, genFetch } from './gen.ts';
import { publicUrl } from './config.ts';
import { authenticate, profile, requireUser, type User } from './accounts.ts';
import { PortalError, route, send } from './http.ts';
import { cdnOf, rememberAsset } from './lods.ts';
import { streamFrom } from './community.ts';

type Row = { id: string; user_id: string; project: string; asset: string; thumb: string | null; kind: string; mime: string; title: string; game: string | null; game_title: string | null; width: number | null; height: number | null; seconds: number | null; views: number; created: number; hidden: number; moment: string | null; caption: string | null; who: string | null; what: string | null };

const shares = () => db.collection('shares');
const ASSET = /^a_[0-9a-f]+$/;
const SHARE_ID = /^[A-Za-z0-9_-]{6,16}$/;
/** Shares a player may make in a day. */
export const SHARES_PER_DAY = 100;
const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v: unknown, max: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.min(max, n) : null; };

export const MOMENTS: Record<string, string> = { boom: 'A big explosion', catch: 'A first catch', jump: 'A long jump', dock: 'A dock' };
const noMarkup = (s: string) => s.replace(/[<>]/g, '');
export function cleanMoment(m: unknown): { kind: string; caption: string; who: string; what: string } | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const kind = String(o.kind ?? '');
  if (!MOMENTS[kind]) return null;
  return { kind, caption: noMarkup(clean(o.caption, 140)), who: noMarkup(clean(o.who, 40)), what: noMarkup(clean(o.what, 40)) };
}

/** The starting templates' titles (src/templates.ts TEMPLATES: id -> name), for "Play this game" on a template's share. */
const TEMPLATE_TITLES: Record<string, string> = {
  'fps-arena': 'Bot Arena', 'sky-racer': 'Sky Racer', 'platform-run': 'Leap', collector: 'Coin collector', runner: 'Endless runner',
  arena: 'Arena survival', blank: 'Playground', planet: 'A new planet', sandbox: 'Island sandbox',
};

/** Where "Play this game" goes, from what the game page knew: a game id (building), a slug, or t/<template>. */
export async function gameLink(ref: unknown): Promise<{ path: string; title: string } | null> {
  const r = String(ref ?? '').trim().toLowerCase();
  if (!r) return null;
  let m = /^t\/([a-z0-9-]+)$/.exec(r);
  if (m) return TEMPLATE_TITLES[m[1]] ? { path: `/play/t/${m[1]}`, title: TEMPLATE_TITLES[m[1]] } : null;
  m = /^(g_[0-9a-f]+)$/.exec(r);
  let g: FirebaseFirestore.DocumentData | null = null;
  if (m) { const s = await db.collection('games').doc(m[1]).get(); g = s.exists ? s.data()! : null; }
  else if (/^[a-z0-9-]+$/.test(r)) { const s = await db.collection('games').where('slug', '==', r).limit(1).get(); g = s.empty ? null : s.docs[0].data(); }
  if (!g || !g.slug) return null;
  return { path: `/play/${g.slug}`, title: String(g.title ?? '') };
}

async function assetInfo(user: User, assetId: string) {
  const a: any = await gen(`/v1/assets/${assetId}`, { as: user.project }).catch(() => null);
  if (!a || a.id !== assetId) throw new PortalError("That file isn't in your library", { status: 404 });
  await rememberAsset(a);
  return { mime: String(a.mime ?? a.contentType ?? ''), kind: String(a.kind ?? '') };
}

/** Makes a share link for one of the player's photos or clips (already uploaded to their Gen project). */
export async function createShare(user: User, body: { asset?: unknown; thumb?: unknown; title?: unknown; game?: unknown; width?: unknown; height?: unknown; seconds?: unknown; moment?: unknown }) {
  const asset = String(body.asset ?? '');
  if (!ASSET.test(asset)) throw new PortalError('asset is the a_... id of an uploaded photo or clip');
  const today = (await shares().where('user_id', '==', user.id).where('created', '>', Date.now() - 86_400_000).count().get()).data().count;
  if (today >= SHARES_PER_DAY) throw new PortalError(`Up to ${SHARES_PER_DAY} share links a day`, { status: 429 });
  const info = await assetInfo(user, asset);
  const kind = /^video\//.test(info.mime) || info.kind === 'video' ? 'clip' : /^image\//.test(info.mime) || info.kind === 'image' ? 'photo' : null;
  if (!kind) throw new PortalError('Only photos (PNG, JPEG, WebP) and clips (MP4, WebM) can be shared');
  let thumb: string | null = null;
  if (body.thumb !== undefined && body.thumb !== null && body.thumb !== '') {
    const t = String(body.thumb);
    if (!ASSET.test(t)) throw new PortalError('thumb is the a_... id of a picture');
    const ti = await assetInfo(user, t);
    if (!/^image\//.test(ti.mime) && ti.kind !== 'image') throw new PortalError('thumb must be a picture');
    thumb = t;
  } else if (kind === 'photo') thumb = asset;
  const game = await gameLink(body.game);
  const moment = cleanMoment(body.moment);
  const title = clean(body.title, 90) || (moment ? `${moment.who ? moment.who + ' · ' : ''}${MOMENTS[moment.kind]}` : '') || (game ? `${kind === 'clip' ? 'A clip' : 'A photo'} from ${game.title}` : kind === 'clip' ? 'A clip' : 'A photo');
  const shareId = crypto.randomBytes(6).toString('base64url');
  const mime = info.mime || (kind === 'clip' ? 'video/webm' : 'image/png');
  const row: Omit<Row, 'id'> = {
    user_id: user.id, project: user.project, asset, thumb, kind, mime, title, game: game?.path ?? null, game_title: game?.title ?? null,
    width: num(body.width, 16384), height: num(body.height, 16384), seconds: num(body.seconds, 3600), views: 0, created: Date.now(), hidden: 0,
    moment: moment?.kind ?? null, caption: moment?.caption || null, who: moment?.who || null, what: moment?.what || null,
  };
  await shares().doc(shareId).create(row);
  return view({ id: shareId, ...row }, user.name ?? null);
}

async function getRow(shareId: string): Promise<Row | null> {
  if (!SHARE_ID.test(shareId)) return null;
  const s = await shares().doc(shareId).get();
  return s.exists && !s.get('hidden') ? ({ id: s.id, ...(s.data() as Omit<Row, 'id'>) }) : null;
}
const nameOf = async (userId: string) => { const s = await users().doc(userId).get(); return s.exists ? (s.get('name') ?? null) as string | null : null; };

/** What anyone may see of a share. */
export function view(r: Row, byName: string | null) {
  const base = publicUrl();
  return {
    id: r.id, url: `${base}/s/${r.id}`, kind: r.kind, mime: r.mime, title: r.title,
    media: `${base}/s/${r.id}/media`, image: r.thumb ? `${base}/s/${r.id}/image` : null,
    game: r.game ? { url: `${base}${r.game}`, title: r.game_title } : null,
    moment: r.moment ? { kind: r.moment, label: MOMENTS[r.moment] ?? null, caption: r.caption, who: r.who, what: r.what } : null,
    by: byName ?? 'A player', width: r.width, height: r.height, seconds: r.seconds, views: r.views, created: r.created,
  };
}
export async function getShare(shareId: string) {
  const r = await getRow(shareId);
  if (!r) throw new PortalError('No such share', { status: 404 });
  return view(r, await nameOf(r.user_id));
}
export async function myShares(user: User) {
  const s = await shares().where('user_id', '==', user.id).where('hidden', '==', 0).orderBy('created', 'desc').limit(100).get();
  return { shares: s.docs.map((d) => view({ id: d.id, ...(d.data() as Omit<Row, 'id'>) }, user.name ?? null)) };
}
/** Takes a share link down (the file stays in the player's library). */
export async function deleteShare(user: User, shareId: string) {
  const s = SHARE_ID.test(shareId) ? await shares().doc(shareId).get() : null;
  if (!s?.exists || s.get('user_id') !== user.id) throw new PortalError('No such share', { status: 404 });
  await s.ref.delete();
  return { ok: true };
}

/** The share's photo/clip or its card picture, from the player's Gen project (open CORS, never rendered as a page). */
export async function serveShareFile(shareId: string, which: 'media' | 'image', req: any, res: Response, method: string) {
  const r = await getRow(shareId);
  const asset = r ? (which === 'media' ? r.asset : r.thumb) : null;
  if (!r || !asset) throw new PortalError('Not found', { status: 404 });
  const headers: Record<string, string> = {};
  if (req.headers.range) headers.Range = String(req.headers.range);
  const gr = await genFetch(`/v1/assets/${asset}/file`, { as: r.project, headers, signal: AbortSignal.timeout(280_000) });
  if (!gr.ok && gr.status !== 206) { await gr.body?.cancel().catch(() => {}); throw new PortalError('Not found', { status: 404 }); }
  let type = gr.headers.get('content-type') ?? '';
  if (!/^(image|video)\//i.test(type)) type = which === 'media' ? r.mime : 'image/jpeg';
  if (/svg|html|xml|javascript/i.test(type)) type = 'application/octet-stream';
  // Only the headers the old server passed on (no content-disposition or last-modified from Gen).
  await streamFrom(gr, res, method, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'content-type': type }, ['content-length', 'accept-ranges', 'content-range', 'etag']);
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** What the preview card says (Discord and X read these). */
export function previewTags(r: Row, byName: string | null) {
  const v = view(r, byName);
  const clip = r.kind === 'clip';
  const what = clip ? 'A clip' : 'A photo';
  const caption = r.caption ? `“${r.caption}”` : '';
  const by = r.who || '';
  const desc = r.moment
    ? [caption, `${by ? by + ', ' : ''}${(MOMENTS[r.moment] ?? 'a moment').toLowerCase()}${v.game ? ` in ${v.game.title}` : ''}. A game made with Hawkes Gen: play it in your browser.`].filter(Boolean).join(' ')
    : v.game ? `${what} from ${v.game.title}, a game made with Hawkes Gen. Play it in your browser.` : `${what} from a game made with Hawkes Gen.`;
  const dims = v.width && v.height ? [['og:image:width', String(v.width)], ['og:image:height', String(v.height)]] : [];
  const tags: string[][] = [
    ['og:type', clip ? 'video.other' : 'website'], ['og:site_name', 'Hawkes Gen'], ['og:title', v.title], ['og:description', desc], ['og:url', v.url],
    ...(v.image ? [['og:image', v.image], ['og:image:alt', r.caption ? `${v.title}: ${r.caption}` : v.title], ...dims] : []),
    ...(clip ? [['og:video', v.media], ['og:video:url', v.media], ['og:video:secure_url', v.media], ['og:video:type', r.mime], ...(v.width && v.height ? [['og:video:width', String(v.width)], ['og:video:height', String(v.height)]] : [])] : []),
  ];
  const twitter: string[][] = [['twitter:card', v.image ? 'summary_large_image' : 'summary'], ['twitter:title', v.title], ['twitter:description', desc], ...(v.image ? [['twitter:image', v.image], ['twitter:image:alt', r.caption ? `${v.title}: ${r.caption}` : v.title]] : [])];
  return { desc, tags, twitter, url: v.url };
}

const html = (res: Response, status: number, body: string) => void res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).send(body);

/** The share page, /s/<id>: the photo or clip, who made it, "Play this game"; preview tags. A moment from the game is shown
 *  in the Overseer's sky. */
export async function sharePage(shareId: string, res: Response) {
  const r = await getRow(shareId);
  if (!r) return html(res, 404, page({ title: 'Not here any more', head: '', body: '<main class="sh-main"><h1>This link isn\'t here any more.</h1><p class="muted">Whoever shared it took it down, or the address is off by a letter.</p><p><a class="btn btn-primary" href="/games">Play games</a></p></main>' }));
  await shares().doc(r.id).update({ views: FieldValue.increment(1) }).catch(() => {});
  const byName = await nameOf(r.user_id);
  const v = view(r, byName);
  const clip = r.kind === 'clip';
  const { desc, tags, twitter } = previewTags(r, byName);
  const head = [
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${esc(v.url)}">`,
    ...tags.map(([k, c]) => `<meta property="${esc(k)}" content="${esc(c)}">`),
    ...twitter.map(([k, c]) => `<meta name="${esc(k)}" content="${esc(c)}">`),
  ].join('\n  ');
  const cdn = await cdnOf([r.asset, r.thumb]);
  const mediaSrc = cdn[r.asset] ?? `/s/${r.id}/media`;
  const posterSrc = r.thumb ? cdn[r.thumb] ?? `/s/${r.id}/image` : null;
  const media = clip
    ? `<video class="sh-media" src="${esc(mediaSrc)}" ${posterSrc ? `poster="${esc(posterSrc)}"` : ''} controls playsinline loop autoplay muted></video>`
    : `<img class="sh-media" src="${esc(mediaSrc)}" alt="${esc(r.caption ? `${v.title}: ${r.caption}` : v.title)}">`;
  const when = new Date(r.created).toISOString().slice(0, 10);
  const shareText = encodeURIComponent(r.caption ? `“${r.caption}” ${v.title}` : v.game ? `${v.title} · ${v.game.title}` : v.title);
  const moment = Boolean(r.moment);
  const who = r.who || v.by;
  const stage = moment
    ? `<div class="sh-sky" aria-label="The Overseer's sky">
      <span class="sh-pearl" aria-hidden="true"><i></i></span>
      <div class="sh-frame">${media}</div>
      <span class="sh-sea" aria-hidden="true"></span>
    </div>
    <div class="sh-says">
      <span class="sh-tag"><b>${esc(who)}</b>${r.what ? `<small>${esc(r.what)}</small>` : ''}</span>
      ${r.caption ? `<p class="sh-caption">“${esc(r.caption)}”</p>` : ''}
    </div>`
    : `<div class="sh-frame">${media}</div>`;
  const body = `<main class="sh-main${moment ? ' sh-moment' : ''}">
    ${stage}
    <div class="sh-info">
      <div>
        <h1>${esc(v.title)}</h1>
        <p class="muted">${esc(clip ? 'Clip' : 'Photo')} by ${esc(moment ? who : v.by)}${v.game ? ` · from <a href="${esc(r.game!)}">${esc(v.game.title)}</a>` : ''} · ${when}</p>
      </div>
      <div class="sh-actions">
        ${v.game ? `<a class="btn btn-primary btn-lg" href="${esc(r.game!)}">▶ Play this game</a>` : '<a class="btn btn-primary btn-lg" href="/games">▶ Play games</a>'}
        <button class="btn btn-secondary" type="button" id="copy" data-url="${esc(v.url)}">Copy link</button>
        <a class="btn btn-secondary" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${shareText}&url=${encodeURIComponent(v.url)}">Post on X</a>
        <a class="btn btn-ghost" href="/s/${esc(r.id)}/media" download>Download</a>
      </div>
    </div>
    <p class="muted sh-made">Made with <a href="/">Hawkes Gen</a>: build a game with friends and AI, in your browser.</p>
  </main>
  <script>document.getElementById('copy').onclick=function(){var b=this;try{navigator.clipboard.writeText(b.dataset.url);b.textContent='Copied';setTimeout(function(){b.textContent='Copy link'},1800)}catch(e){prompt('Copy this link',b.dataset.url)}};</script>`;
  html(res, 200, page({ title: v.title, head, body }));
}

function page(o: { title: string; head: string; body: string }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(o.title)} · Hawkes Gen</title>
  <link rel="icon" href="/favicon.svg">
  <link rel="stylesheet" href="/public.css">
  <link rel="stylesheet" href="/site.css">
  <link rel="stylesheet" href="/builder.css">
  ${o.head}
  <script src="/sitenav.js" defer></script>
  <style>
    .sh-main { max-width: 1040px; margin: 0 auto; padding: 24px 16px 48px; display: grid; gap: 18px; }
    .sh-frame { background: #0a0a0f; border-radius: 14px; overflow: hidden; box-shadow: var(--shadow, 0 8px 24px rgba(0,0,0,.12)); }
    .sh-media { display: block; width: 100%; max-height: 72vh; object-fit: contain; background: #0a0a0f; }
    .sh-info { display: flex; flex-wrap: wrap; gap: 14px; align-items: center; justify-content: space-between; }
    .sh-info h1 { margin: 0 0 4px; font-size: clamp(22px, 3vw, 30px); }
    .sh-info p { margin: 0; }
    .sh-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .sh-made { text-align: center; }
    .sh-sky { position: relative; border-radius: 18px; overflow: hidden; padding: clamp(18px, 4vw, 40px) clamp(14px, 5vw, 56px) clamp(26px, 5vw, 52px); background:
      radial-gradient(1.5px 1.5px at 12% 18%, #fff 60%, transparent), radial-gradient(1px 1px at 31% 8%, #cfe0ff 60%, transparent), radial-gradient(1.5px 1.5px at 58% 14%, #fff 60%, transparent), radial-gradient(1px 1px at 83% 30%, #cfe0ff 60%, transparent), radial-gradient(1px 1px at 7% 52%, #fff 60%, transparent), radial-gradient(1px 1px at 92% 70%, #fff 60%, transparent),
      linear-gradient(180deg, #060b1d 0%, #0f1f4a 55%, #1d4f86 100%); box-shadow: 0 14px 40px rgba(20, 40, 90, .28); }
    .sh-sky .sh-frame { position: relative; z-index: 1; box-shadow: 0 10px 34px rgba(0, 0, 0, .5); }
    .sh-pearl { position: absolute; z-index: 2; top: clamp(10px, 3vw, 28px); right: clamp(12px, 5vw, 56px); width: clamp(26px, 5vw, 46px); aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle at 35% 35%, #fff, #bcd2ff 70%); box-shadow: 0 0 30px 10px rgba(190, 215, 255, .55), 0 0 90px 30px rgba(120, 170, 255, .25); }
    .sh-pearl i { position: absolute; left: -45%; right: -45%; top: 28%; bottom: 28%; border: 1.5px solid rgba(255, 255, 255, .7); border-radius: 50%; transform: rotate(-14deg); }
    .sh-sea { position: absolute; left: 0; right: 0; bottom: 0; height: clamp(14px, 3vw, 30px); background: linear-gradient(180deg, rgba(27, 134, 184, 0), #1b86b8 70%); }
    .sh-says { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-top: -4px; }
    .sh-tag { display: inline-flex; align-items: baseline; gap: 8px; padding: 6px 14px; border-radius: 999px; background: #0f1f4a; color: #fff; font: 700 15px var(--font, Inter, sans-serif); }
    .sh-tag small { font-weight: 500; font-size: 12px; color: #b9c8ee; }
    .sh-caption { margin: 0; flex: 1; min-width: 220px; font: italic 500 clamp(17px, 2.4vw, 22px)/1.4 Georgia, 'Times New Roman', serif; color: #1b2a55; }
  </style>
</head>
<body class="landing">
  <header class="bar">
    <a class="hg-brand" href="/"><img src="/favicon.svg" alt=""><span>Hawkes Gen</span></a>
    <nav class="hg-nav-links" data-site-nav><a href="/games">Games</a><a href="/community">Community library</a><a href="/entities">Engine codex</a><a href="/app/studio">Asset Studio</a><a href="/#pricing">Pricing</a><a href="/connect">For developers</a></nav>
    <a class="btn btn-primary btn-sm" href="/app">Build a game</a>
  </header>
  ${o.body}
</body>
</html>`;
}

// ------------------------------------------------------------ routes

// The share window asks who's there without a 401 for guests (they can still download).
route('GET', '/v1/shares/session', async ({ req }) => { const u = await authenticate(req); return { user: u ? (await profile(u)).user ?? null : null }; });
route('GET', /^\/v1\/shares\/([\w-]{6,16})$/, async ({ res, params }) => { res.set('Access-Control-Allow-Origin', '*'); return getShare(params[0]); });
route('POST', '/v1/shares', async ({ req }) => createShare(await requireUser(req), (req.body ?? {}) as any));
route('GET', '/v1/shares/mine', async ({ req }) => myShares(await requireUser(req)));
route('DELETE', /^\/v1\/shares\/([\w-]{6,16})$/, async ({ req, params }) => deleteShare(await requireUser(req), params[0]));
route('GET', /^\/s\/([\w-]{6,16})(?:\/(media|image))?$/, async ({ req, res, params, method }) => (params[1] ? serveShareFile(params[0], params[1] as 'media' | 'image', req, res, method) : sharePage(params[0], res)));
void send;
