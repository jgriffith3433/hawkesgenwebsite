// "Use in this game" (POST /v1/games/:id/community): a community thing goes into a game as its asset (nothing copied or
// paid twice: it stays its owner's Gen asset), counts a use and a like (community.ts recordUse), and becomes what the world
// uses for its word (config.assets). src/community.ts useInGame, between the two areas.
import { route, PortalError } from './http.ts';
import { requireUser } from './accounts.ts';
import { listedRow, viewOne, recordUse } from './community.ts';
import { memberGame, addAsset, freeName, sceneOps, fileContent, assetsOf, lodsOf } from './games.ts';
import { parseScene } from './scene.ts';
import { singular, headWord, wordsOf } from './words.ts';

route('POST', /^\/v1\/games\/(g_[0-9a-f]+)\/community$/, async ({ req, params: [gameId] }) => {
  const user = await requireUser(req);
  const body: any = req.body ?? {};
  await memberGame(user, gameId);
  const r = await listedRow(String(body.id ?? ''));
  if (!r) throw new PortalError('That is no longer in the community library', { status: 404 });
  const mode = body.mode === 'replace' ? 'replace' : 'variant';
  const word = singular(String(body.word ?? '').toLowerCase().replace(/[^a-z0-9 -]+/g, '').trim()) || headWord(r.title, r.category) || 'thing';
  const words = wordsOf(word, r.title, r.category, r.tags ? r.tags.split(' ') : []);
  const found = await assetsOf(gameId).where('asset', '==', r.id).limit(1).get();
  let row: any = found.empty ? null : found.docs[0].data();
  if (!row || body.name) {
    const want = String(body.name ?? '').trim() || r.title;
    try { row = await addAsset(user, gameId, { asset: r.id, name: await freeName(gameId, want, r.mime) }, { project: r.project, words, title: r.title }); }
    catch (e: any) {
      // The row is listed but its file isn't in Gen (the beta's library lacks the live starter pack's things). The player
      // is never told "not in your library": the engine gets `missing` and puts a base stand-in; we log it for devs.
      if (e?.status !== 404) throw e;
      console.warn(`[portal] community ${r.id} ("${r.title}", ${r.kind}) is listed but not in Gen (project ${r.project}): placing a stand-in`);
      return { missing: true, asset: null, item: await viewOne(r), word, mode, assets: {} };
    }
    // A model's low copy comes as its levels of detail; an old row without them still brings its separate low copy.
    if (r.low && String(row.name).endsWith('.glb') && !(await lodsOf([r.id]))[r.id]?.levels?.some((l: any) => l.role === 'low')) {
      await addAsset(user, gameId, { asset: r.low, name: String(row.name).replace(/\.glb$/, '_low.glb') }, { project: r.project, words, title: r.title }).catch(() => null);
    }
    await recordUse(user, r.id, gameId);
  }
  // What the world uses for the word: config.assets (the game's own choice and order).
  const cur = (parseScene(await fileContent(gameId, 'scene.json')).config as any)?.assets?.[word] ?? null;
  const ids: string[] = Array.isArray(cur?.ids) ? cur.ids.map(String) : [];
  const all = ids.includes(r.id) ? ids : [...ids, r.id];
  // A variant added to others turns mixing on (the editor's switch turns it off again).
  const next = mode === 'replace' ? { ids: [r.id], mix: false } : { ids: all, mix: all.length > ids.length && all.length > 1 ? true : Boolean(cur?.mix) };
  const ops: any = await sceneOps(user, gameId, [{ op: 'config', patch: { assets: { [word]: next } } }], { by: user.name ?? undefined });
  return { asset: row, item: await viewOne(r), word, mode, assets: { [word]: next }, rev: ops.rev, applied: ops.applied };
});
