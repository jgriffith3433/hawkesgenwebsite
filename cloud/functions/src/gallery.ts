// The public gallery (/games reads GET /v1/gallery; games.ts gallery on the old server) and what Gen makes for a game
// (GET /v1/asset-kinds, the codex's table, from gameai.ts KINDS).
//
// Games are the games area's (games/{g_id} with the SQLite columns: slug, title, description, owner_id, visibility, hidden,
// cover, plays, updated, visitors; gameAssets with game_id, name, asset). Who is in a game right now was kept in memory
// on the old server (rooms.ts liveCounts); here it is `liveCounts.of`, which answers zero until the presence area
// replaces it (the same seam as caller.ts accessTokens).
import { db, users } from './store.ts';
import { route } from './http.ts';
import { cdnOf } from './lods.ts';

export type Live = { playing: number; building: number };
/** Who is playing and building each game (ids: g_..., or t:<template> for the Overseer's games). Replaced by presence. */
export const liveCounts: { of: (ids: string[]) => Promise<Record<string, Live>> } = { of: async () => ({}) };

/** The Overseer's featured games (src/templates.ts featured(), in TEMPLATES order). */
const FEATURED: { id: string; name: string; emoji: string; blurb: string; url?: string; cover?: string; remix?: boolean }[] = [
  { id: 'sickofit', name: 'Sick of It', emoji: '😈', url: '/play/sickofit', cover: '/play/sickofit/cover.svg', remix: false, blurb: 'A sarcastic nobody chases the Overlord up 1,000 floors of Hell. Dodge bullets, rewind time, free the diamonds.' },
  { id: 'fps-arena', name: 'Bot Arena', emoji: '🎯', blurb: 'A first-person arena on a far planet at dusk: robots beamed in by the Overseer, a shotgun, a rocket launcher on the tower, barrels that blow. Clear 25, three lives.' },
  { id: 'sky-racer', name: 'Sky Racer', emoji: '🛩️', blurb: 'Race a starship down a sunset valley through 24 glowing gates. Each gate buys time; boost with space, beat your best.' },
  { id: 'platform-run', name: 'Leap', emoji: '🏃', blurb: 'A third-person climb from a village to the Overseer\'s rocket before the sun sets: moving platforms, spikes, coins, gems and checkpoints.' },
];
export const featured = () => FEATURED.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb, emoji: t.emoji, url: t.url ?? `/play/t/${t.id}`, ...(t.cover ? { cover: t.cover } : {}), remix: t.remix !== false }));

/** Test and placeholder islands never make the page (a name like "test", "untitled", "playtest-..."), nor do worlds nobody has played. */
export const isTestName = (title: unknown) => /^\s*(test|testing|tests|untitled|asdf+|qwerty|playtest|qa|demo|new (game|world|island)|my (first )?(game|world|island)|game \d*|world \d*)\b|playtest|\btest\b/i.test(String(title ?? '')) || !String(title ?? '').trim();

const liveAssetUrl = (slug: string, name: string) => `/play-asset/${slug}/live/${encodeURIComponent(name)}`;

/** The public games, all live: most people in them right now first (then most played), or newest, or most played. */
export async function gallery(sort: 'live' | 'popular' | 'new' = 'live', limit = 60) {
  const s = await db.collection('games').where('visibility', '==', 'public').where('hidden', '==', 0).orderBy(sort === 'new' ? 'updated' : 'plays', 'desc').limit(500).get();
  const rows = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).filter((g) => (g.plays ?? 0) > 0 && !isTestName(g.title));
  const live = await liveCounts.of([...featured().map((t) => `t:${t.id}`), ...rows.map((g) => g.id)]).catch(() => ({} as Record<string, Live>));
  const counts = (key: string): Live => ({ playing: live[key]?.playing ?? 0, building: live[key]?.building ?? 0 });
  const list = rows.map((g) => ({ g, slug: g.slug, title: g.title, description: g.description ?? '', plays: g.plays ?? 0, updated: g.updated, url: `/play/${g.slug}`, visitors: g.visitors ?? 'play', ...counts(g.id) }));
  if (sort === 'live') list.sort((a, b) => b.playing + b.building - (a.playing + a.building) || b.plays - a.plays);
  const top = list.slice(0, Math.max(1, Math.min(200, limit)));
  // Owners' names and covers only for the games answered.
  const owners = [...new Set(top.map((x) => x.g.owner_id).filter(Boolean))] as string[];
  const names = new Map<string, string | null>();
  for (let i = 0; i < owners.length; i += 300) for (const u of await db.getAll(...owners.slice(i, i + 300).map((o) => users().doc(o)))) names.set(u.id, u.exists ? (u.get('name') ?? null) : null);
  const covers = new Map<string, string>();
  await Promise.all(top.filter((x) => x.g.cover).map(async (x) => {
    const a = await db.collection('gameAssets').where('game_id', '==', x.g.id).where('name', '==', x.g.cover).limit(1).get();
    if (!a.empty) covers.set(x.g.id, a.docs[0].get('asset'));
  }));
  const cdn = await cdnOf([...covers.values()]);
  return {
    featured: featured().map((t) => ({ ...t, ...counts(`t:${t.id}`) })),
    games: top.map(({ g, ...x }) => {
      const asset = covers.get(g.id);
      return { slug: x.slug, title: x.title, description: x.description, by: names.get(g.owner_id) ?? null, plays: x.plays, updated: x.updated, url: x.url, visitors: x.visitors, cover: asset ? cdn[asset] ?? liveAssetUrl(g.slug, g.cover) : null, playing: x.playing, building: x.building };
    }),
  };
}

/** What Gen makes for a game, with its price (gameai.ts KINDS: just the titles and prices the codex reads). */
export const KINDS: Record<string, { title: string; credits: string }> = {
  sprite: { title: 'Sprite (transparent image)', credits: '~7' },
  image: { title: 'Image', credits: '~5' },
  texture: { title: 'Tiling texture', credits: '~5' },
  sky: { title: 'Sky panorama', credits: '~10' },
  model: { title: '3D model', credits: '~90' },
  sfx: { title: 'Sound effect', credits: '~8' },
  music: { title: 'Music loop', credits: '~20' },
  video: { title: 'Video (a TV show clip)', credits: '~40' },
  voice: { title: 'Voice line', credits: '~10' },
};

route('GET', '/v1/gallery', ({ url }) => {
  const so = url.searchParams.get('sort');
  return gallery(so === 'new' ? 'new' : so === 'popular' ? 'popular' : 'live', Number(url.searchParams.get('limit')) || 60);
});
route('GET', '/v1/asset-kinds', () => Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, { title: v.title, credits: v.credits }])));
