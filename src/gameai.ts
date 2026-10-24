// The game assistant and game asset generation. The assistant is Claude through Gen's llm.json tool: it reads the
// game's files, its assets, the recent chat and the Hawkes Play API, and answers with a reply, whole new contents for the
// files it changes, and assets it suggests (which a member then makes with one click: GPU work is never started without
// someone asking). Both are paid like every Gen job (jobs.ts submit / tasks.ts); a message costs at least AI_CREDITS.
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.ts';
import { env, ROOT } from './config.ts';
import { gen } from './gen.ts';
import { submit, settle } from './jobs.ts';
import { startTask, events, getTask, results, type Step, type Task } from './tasks.ts';
import { getUser, type User } from './users.ts';
import { PortalError } from './util.ts';
import { memberGame, chatMessage, updateChatData, writeFile, deleteFile, listAssets, addAsset, freeName, sceneOps, LIMITS } from './games.ts';
import { describeScene, parseScene } from './scene.ts';
import { engineDoc } from './engine.ts';
import { broadcastOps } from './rooms.ts';
import { broadcast } from './live.ts';
import { search as searchCommunity } from './community.ts';

export const AI_CREDITS = () => Math.max(1, Number(env('GAME_AI_CREDITS') ?? 8));

db.exec(`
CREATE TABLE IF NOT EXISTS game_gen (
  task_id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  prompt TEXT NOT NULL,
  message_id TEXT,
  state TEXT NOT NULL DEFAULT 'running',
  asset_name TEXT,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS game_gen_game ON game_gen (game_id, created);
`);

// ------------------------------------------------------------------ making assets for a game
export const KINDS: Record<string, { title: string; credits: string; build: (prompt: string, o: any) => Promise<Step[]> | Step[] }> = {
  sprite: {
    title: 'Sprite (transparent image)', credits: '~7',
    build: (p) => [
      { tool: 'image.generate', title: 'Painting', params: { prompt: `${p}, single subject, centered, full body, plain flat background, game sprite`, width: 1024, height: 1024, count: 1 } },
      { tool: 'image.cutout', title: 'Cutting out', inputs: { image: { from: 0 } }, keep: true },
    ],
  },
  image: { title: 'Image', credits: '~5', build: (p, o) => [{ tool: 'image.generate', title: 'Painting', params: { prompt: p, width: o.wide ? 1344 : 1024, height: o.wide ? 768 : 1024, count: 1 } }] },
  texture: {
    title: 'Tiling texture', credits: '~5',
    build: (p) => [{ tool: 'image.generate', title: 'Painting the texture', params: { prompt: `${p}, seamless tileable texture, top-down, flat even lighting, no shadows`, width: 1024, height: 1024, seamless: true, count: 1 } }],
  },
  sky: { title: 'Sky panorama', credits: '~10', build: (p) => [{ tool: 'image.panorama', title: 'Painting the sky', params: { prompt: p } }] },
  model: {
    // Always from four views (Hawkes Gen's rule: one picture guesses the back), cleaned, with a low-detail copy.
    title: '3D model', credits: '~90',
    build: (p) => [
      { tool: 'image.generate', title: 'Drawing it', params: { prompt: `${p}, single object, straight front view, centered, whole object in frame, plain flat light grey background, even light, no shadow, clean game asset`, width: 1024, height: 1024, count: 1 } },
      { tool: 'image.remove-background', title: 'Cutting it out', inputs: { image: { from: 0 } } },
      { tool: 'image.viewsheet', title: 'Drawing its back and sides', params: { form: 'prop', cell: 1024, retries: 2 }, inputs: { image: { from: 1 } } },
      { tool: 'mesh.views3d', title: 'Building the 3D model from four views', inputs: { image: { from: 2, kind: 'image' } } },
      { tool: 'blender.character', title: 'Cleaning it up', params: { ops: [{ op: 'import', file: 0, clips: false }, { op: 'fix', shards: 0.02, holes: 24 }, { op: 'retopo', faces: 12000 }, { op: 'bake', size: 2048 }, { op: 'lod', levels: [0.15], compress: 'draco', textures: 'webp' }, { op: 'export', format: 'glb', title: 'high', compress: 'draco', textures: 'webp' }] }, inputs: { files: [{ from: 3, kind: 'mesh' }] }, keep: true },
    ],
  },
  sfx: { title: 'Sound effect', credits: '~8', build: (p, o) => [{ tool: 'audio.sfx', title: 'Recording', params: { text: p, ...(o.seconds ? { duration: Number(o.seconds) } : {}), loop: false, count: 1 } }] },
  music: { title: 'Music loop', credits: '~20', build: (p, o) => [{ tool: 'audio.music', title: 'Composing', params: { prompt: p, seconds: Math.max(10, Math.min(180, Number(o.seconds) || 60)) } }] },
  // A video clip (a TV show, a screen's loop): text to video, 16:9 for screens. Plays on tv, projector, computer and video things.
  video: {
    title: 'Video (a TV show clip)', credits: '~40',
    build: (p, o) => [{ tool: 'video.t2v', title: 'Filming', params: { prompt: `${p}, a TV show shot, steady framing`, seconds: Math.max(1, Math.min(10, Number(o.seconds) || 5)), width: 832, height: 480 } }],
  },
  voice: {
    title: 'Voice line', credits: '~10',
    build: async (p, o) => {
      const r: any = await gen('/v1/providers/elevenlabs/voices', { as: o.project }).catch(() => ({ voices: [] }));
      const voices = r.voices ?? [];
      const want = String(o.voice ?? '').toLowerCase();
      const v = (want && voices.find((x: any) => String(x.name).toLowerCase().includes(want))) || voices[0];
      if (!v) throw new PortalError('No voices are available right now');
      return [{ tool: 'audio.voice', title: 'Speaking', params: { text: p, voice: v.voice_id ?? v.id, count: 1 } }];
    },
  },
};

/** Starts making an asset for a game; when it's done it joins the game's assets under `name`. */
export async function generateAsset(user: User, gameId: string, body: { kind?: unknown; prompt?: unknown; name?: unknown; seconds?: unknown; voice?: unknown; messageId?: unknown }) {
  const { game } = memberGame(user, gameId);
  const kind = String(body.kind ?? '');
  const k = KINDS[kind];
  if (!k) throw new PortalError(`kind is one of ${Object.keys(KINDS).join(', ')}`);
  const prompt = String(body.prompt ?? '').trim().slice(0, 1500);
  if (!prompt) throw new PortalError('Describe what to make');
  const name = String(body.name ?? '').trim() || prompt.split(/\s+/).slice(0, 3).join('-');
  const steps = await k.build(prompt, { seconds: body.seconds, voice: body.voice, project: user.project });
  const t = startTask(user, { kind: 'session', id: `game:${game.id}`, name: game.title, cap: null }, `${k.title}: ${prompt.slice(0, 60)}`, steps);
  db.prepare('INSERT INTO game_gen (task_id, game_id, user_id, name, kind, prompt, message_id, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(t.id, game.id, user.id, name, kind, prompt, body.messageId ? String(body.messageId) : null, Date.now());
  follow(t.id);
  const row = genRow(t.id)!;
  broadcast(game.id, 'gen', row);
  return row;
}

type GenRow = { task_id: string; game_id: string; user_id: string; name: string; kind: string; prompt: string; message_id: string | null; state: string; asset_name: string | null; created: number };
function genRow(taskId: string) {
  const r = db.prepare('SELECT * FROM game_gen WHERE task_id = ?').get(taskId) as GenRow | undefined;
  if (!r) return null;
  const t = getTask(taskId);
  return { ...r, detail: t?.detail ?? null, error: t?.error ?? null, credits: t?.credits ?? 0, by: getUser(r.user_id)?.name ?? null };
}

export function pendingGens(user: User, gameId: string) {
  memberGame(user, gameId, 'player');
  return { gens: (db.prepare('SELECT task_id FROM game_gen WHERE game_id = ? ORDER BY created DESC LIMIT 30').all(gameId) as { task_id: string }[]).map((r) => genRow(r.task_id)) };
}

const following = new Set<string>();
/** Watches a generation task: progress to the game's editors, and the result into the game's assets. */
function follow(taskId: string) {
  if (following.has(taskId)) return;
  following.add(taskId);
  const on = (t: Task) => {
    const row = db.prepare('SELECT * FROM game_gen WHERE task_id = ?').get(taskId) as GenRow | undefined;
    if (!row) return;
    if (t.state === 'running') return void broadcast(row.game_id, 'gen', genRow(taskId));
    events.off(taskId, on);
    following.delete(taskId);
    void finish(row, t);
  };
  events.on(taskId, on);
  const now = getTask(taskId);
  if (now && now.state !== 'running') on(now);
}

async function finish(row: GenRow, t: Task) {
  if (row.state !== 'running') return;
  const user = getUser(row.user_id);
  const out = results(t);
  // A model comes as the full GLB and its low-detail copy (title "…LOD1"): the copy joins as "<name>_low.glb".
  const glbs = out.filter((o) => o.mime === 'model/gltf-binary');
  const low = glbs.find((o) => /lod/i.test(o.title ?? ''));
  const pick = glbs.find((o) => !/lod/i.test(o.title ?? '')) ?? out.find((o) => /^(image|audio|model|video)\//.test(o.mime) || o.mime === 'model/gltf-binary') ?? out[0];
  let assetName: string | null = null;
  let state = t.state === 'done' ? 'done' : t.state;
  if (t.state === 'done' && pick && user) {
    try {
      // Its words: the name the assistant gave it (and so what it is), e.g. "cow.glb" -> cow.
      const words = [row.name];
      assetName = (await addAsset(user, row.game_id, { asset: pick.asset, name: freeName(row.game_id, row.name, pick.mime) }, { project: user.project, words, title: row.name.replace(/\.[a-z0-9]+$/i, '') })).name;
      if (low && assetName.endsWith('.glb')) await addAsset(user, row.game_id, { asset: low.asset, name: assetName.replace(/\.glb$/, '_low.glb') }, { project: user.project, words }).catch(() => null);
    } catch (e: any) {
      state = 'failed';
      db.prepare('UPDATE tasks SET error = ? WHERE id = ?').run(`Made, but not added to the game: ${e.message}`, t.id);
    }
  } else if (t.state === 'done') state = 'failed';
  db.prepare('UPDATE game_gen SET state = ?, asset_name = ? WHERE task_id = ?').run(state, assetName, row.task_id);
  broadcast(row.game_id, 'gen', genRow(row.task_id));
}

/** After a restart: follow the generations still running, and finish any that ended while we were down. */
export function resumeGens() {
  for (const r of db.prepare("SELECT task_id FROM game_gen WHERE state = 'running'").all() as { task_id: string }[]) follow(r.task_id);
}

// ------------------------------------------------------------------ the assistant
// The engine's docs, assembled from every module's sections and read fresh for each message (src/engine.ts), so a
// module's new section reaches the assistant without a restart.
const api = () => `${engineDoc('world')}\n\n${engineDoc('api')}`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'world', 'files', 'delete', 'assets'],
  properties: {
    reply: { type: 'string', description: 'What you did or what you suggest, in a few plain sentences for the people building the game.' },
    world: {
      type: 'array',
      description: 'Changes to the world (scene.json), as ops: create, update, replace, delete, config (see "Changes (ops)"). They appear live for everyone. Prefer these over scripts for anything that is a thing in the world.',
      items: {
        type: 'object', additionalProperties: false, required: ['op', 'id', 'json'],
        properties: {
          op: { type: 'string', enum: ['create', 'update', 'replace', 'delete', 'config'] },
          id: { type: 'string', description: 'The id of the thing ("" for config).' },
          json: { type: 'string', description: 'JSON text. create/replace: the whole thing ({"type":"box","name":...,"transform":...}). update/config: the patch ({"physics":"dynamic"}). delete: "{}".' },
        },
      },
    },
    files: {
      type: 'array',
      description: 'Files to create or replace, each with its WHOLE new content. Leave out files you do not change.',
      items: { type: 'object', additionalProperties: false, required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
    },
    delete: { type: 'array', description: 'Paths of files to delete.', items: { type: 'string' } },
    assets: {
      type: 'array',
      description: 'Assets the game needs that do not exist yet, for the people to generate with one click. Your scripts may already use them by name.',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'name', 'prompt', 'community'],
        properties: {
          kind: { type: 'string', enum: Object.keys(KINDS) },
          name: { type: 'string', description: 'File name the scripts use, with extension: sprite/image/texture .png, sky .jpg, model .glb, sfx/voice/music .mp3, video .mp4' },
          prompt: { type: 'string', description: 'What to generate: subject, style, mood. For voice: the exact line.' },
          community: { type: 'string', description: 'The id (a_...) of the community library thing that fits best, from the list you were given, or "". The people choose: that one, another match, or making their own.' },
        },
      },
    },
  },
};

const SYSTEM = () => `You are the assistant inside Hawkes Gen's game engine. People (often beginners, often friends building together) build 3D browser games here by walking around inside them as a first-person player. A game is a world (scene.json: things with a shape, a look, a way of moving and behaviors) plus scripts that run on the Hawkes Play runtime. You change the game two ways: "world" ops for the things in it (they appear live, in front of the player), and whole files for scripts and custom behaviors.

How to think about requests:
- People describe things the way they see them: "make that ball bounce", "put a tower over there", "the door should open when I get close". Work out what that means in the engine: which thing ("that" is what they are looking at or mentioned with @), which physics, which behaviors, and whether it needs a custom behavior file.
- "That", "this", "it" and "here" mean the thing they are looking at (lookingAt), the @mentioned thing, or the point they are looking at (lookPoint). Put new things near the player, in front of them, resting on what's under them (center y = surface y + half the height), unless they say where.
- Prefer the built-in behaviors. When something needs logic they don't cover, write a behaviors/<name>.js file with game.behavior(...) and give the thing { "use": "<name>" }. Use scripts/ files for game rules (scores, timers, win conditions, waves).
- Keep sizes human: a person is 1.8 m, a door 2 m, a crate 1 m. Things that should be thrown around are "dynamic"; floors, walls and buildings are "static".
- For a house use the "house" kind (rooms, floors, a style: WORLD.md "Homes"), and furniture kinds for what goes in it. Build other big things from several pieces with clear names, so people can grab and change each one.
- Ids are lowercase words with underscores. Reuse an existing id to change a thing; never make a duplicate.

Rules:
- Use only the API below (plus plain JavaScript). Do not use import/export, fetch, localStorage, or DOM access except through game.ui.
- Keep changes focused on what was asked; keep the code short, readable and commented where it helps a beginner. Keep the existing style and structure.
- Return the WHOLE content of each file you change. Never return a file unchanged. Never write scene.json as a file: change the world with "world" ops.
- Every game already has a player (WASD, mouse look, jump) and catches players who fall. Change how it plays with a config op on "player" (view first/third/top, speed, jump, doubleJump, fly, gravity): "let me fly", "jump higher", "I want to see my character" are config changes, not scripts. Only write your own player or camera for a different kind of game (then set game.player.controls = false).
- Combat is built in: config.player.weapon (blaster, rifle, shotgun, launcher, or tuned), the "enemy" behavior (enemies that see, chase, strafe, shoot, retreat), "health", "pickup", "spawner" (of: an enemy's id) and game.on('kill'). Use them for shooters instead of writing AI or guns in scripts.
- Mouse control: config.player.mouse "free" keeps the mouse a pointer (strategy, point-and-click, menu games); view "rts" is a commander's camera; mode "flight" flies.
- Checkpoints, routes, finish lines and goals are "waypoint" things (data.role checkpoint / waypoint / finish, data.next for a route), not invisible trigger boxes.
- Menus, popups, shops, inventories, dialog and HUDs are game.ui (panel, menu, popup, ask, attach, theme, style) in scripts, styled to the game with game.ui.theme or game.json "ui". Title screens only when game.mode === 'play'; a Start button calls game.input.capture(); see "A game's own screens".
- The community library is everything other builders and Hawkes have shared (models, textures, skies, sprites, music, ambience, sound effects). When they ask for a thing ("a ball", "rain sounds", "a grass floor"), list it in "assets" as usual and set "community" to the best match from the community list if there is one: they are shown the community matches next to "make our own", and pick. Meanwhile put it in the world already, using the asset name (a "model" with that asset, a material texture, the config sky): the engine shows a waiting stand-in until the asset arrives, then the real thing.
- Asset names: only use assets that are listed, or ones you list in "assets" so the people can generate them. Until an asset exists, scripts must not crash: prefer adding an asset in the same message and using a shape as a stand-in, or check with game.find / try.
- Assets by id: every asset has an id (a_...) and words ("cow", "spotted cow"). In world ops write ids (shape.model, shape.asset, material.texture take an id or a name), never invent file names. config.assets says which assets a word uses: { "cow": { "ids": ["a_1", "a_2"], "mix": true } } (the first is the default; mix spreads them over many things, e.g. a herd). "Use the spotted cow instead" = config op { "assets": { "cow": { "ids": ["<its id>"], "mix": false } } }; "mix in some brown cows" = add the brown one's id to that word's ids with "mix": true (from the community list: "community" in "assets", or the game's own assets). Modules find assets for a word by themselves (WORLD.md "Assets by id").
- If the request is unclear or impossible, change nothing and say what you need.
- Reply in a few plain sentences: what changed and how to try it (which keys). No markdown headings.

${api()}`;

/** The assistant's world ops ({ op, id, json }) as scene ops. One that doesn't parse is skipped and reported. */
function worldOps(list: any[], problems: string[]) {
  const ops: unknown[] = [];
  for (const w of list.slice(0, 200)) {
    let body: any = {};
    try { body = w?.json ? JSON.parse(String(w.json)) : {}; } catch { problems.push(`world: ${w?.op} ${w?.id}: not valid JSON`); continue; }
    const id = String(w?.id ?? '');
    if (w?.op === 'create' || w?.op === 'replace') ops.push({ op: w.op, entity: { ...body, ...(id ? { id } : {}) } });
    else if (w?.op === 'update') ops.push({ op: 'update', id, patch: body });
    else if (w?.op === 'delete') ops.push({ op: 'delete', id });
    else if (w?.op === 'config') ops.push({ op: 'config', patch: body });
  }
  return ops;
}

/** Where the player is and what they see, from the editor (build.js context()), for "that", "here" and "it". */
function playerView(raw: unknown, mention: unknown) {
  const c = raw && typeof raw === 'object' ? (raw as any) : null;
  const m = mention && typeof mention === 'object' ? (mention as any) : null;
  const j = (x: unknown) => JSON.stringify(x ?? null).slice(0, 600);
  const lines: string[] = [];
  if (m?.id) lines.push(`They mention @${String(m.name ?? m.id).slice(0, 60)}: the thing with id "${String(m.id).slice(0, 64)}".`);
  if (c) {
    if (c.player) lines.push(`The player is at ${j(c.player.at)}, facing ${j(c.player.facing)}${c.player.flying ? ', flying' : ''}${c.player.standingOn ? `, standing on ${String(c.player.standingOn).slice(0, 64)}` : ''}.`);
    lines.push(c.lookingAt ? `They are looking at: ${j(c.lookingAt)}.` : 'They are not looking at any thing.');
    if (c.lookPoint) lines.push(`The point they are looking at (on a surface): ${j(c.lookPoint)}.`);
    if (Array.isArray(c.nearby) && c.nearby.length) lines.push(`Nearby, closest first: ${c.nearby.slice(0, 14).map((n: any) => `${String(n?.id ?? '').slice(0, 64)}${n?.name ? ` "${String(n.name).slice(0, 60)}"` : ''} (${String(n?.what ?? '').slice(0, 80)}, ${Number(n?.distance) || 0} m)`).join('; ')}.`);
    if (Array.isArray(c.players) && c.players.length) lines.push(`Other players here: ${c.players.slice(0, 8).map((p: any) => `${String(p?.name ?? '').slice(0, 30)} at ${j(p?.at)}`).join('; ')}.`);
    if (c.mode) lines.push(`They are ${c.mode === 'build' ? 'building' : 'playing'}.`);
  }
  return lines.length ? `What the player sees right now:\n${lines.join('\n')}\n` : '';
}

function context(gameId: string, focus?: string) {
  const all = db.prepare('SELECT path, content FROM game_files WHERE game_id = ? ORDER BY path').all(gameId) as { path: string; content: string }[];
  const scene = all.find((f) => f.path === 'scene.json');
  const files = all.filter((f) => f.path !== 'scene.json');
  let budget = 150_000;
  const parts: string[] = [];
  // The open file first, then the rest while they fit.
  for (const f of [...files.filter((f) => f.path === focus), ...files.filter((f) => f.path !== focus)]) {
    const block = `--- ${f.path}\n${f.content}\n`;
    if (block.length > budget) { parts.push(`--- ${f.path}\n(left out: too long to include)\n`); continue; }
    budget -= block.length;
    parts.push(block);
  }
  // The game's assets by id, with their words and titles, and the world's own choices per word (config.assets).
  const assets = listAssets(gameId).filter((a) => !/_low\.glb$/.test(a.name)).map((a) => `${a.asset} ${a.name}${a.title ? ` "${String(a.title).slice(0, 40)}"` : ''} [${(a.words as string[]).slice(0, 5).join(', ')}]`);
  const chosen = (parseScene(scene?.content).config as any)?.assets;
  if (chosen && typeof chosen === 'object') for (const [w, v] of Object.entries(chosen).slice(0, 40)) assets.push(`config.assets.${w} = ${JSON.stringify(v)}`);
  const chat = (db.prepare("SELECT role, text, user_id FROM game_chat WHERE game_id = ? AND role != 'system' ORDER BY created DESC LIMIT 12").all(gameId) as { role: string; text: string; user_id: string | null }[]).reverse();
  return { files: parts.join('\n'), assets, world: describeScene(parseScene(scene?.content)), chat: chat.map((m) => `${m.role === 'ai' ? 'Assistant' : getUser(m.user_id ?? '')?.name ?? 'Someone'}: ${m.text.slice(0, 1500)}`).join('\n') };
}

const thinking = new Set<string>();

/** What to tell the players when the assistant's job didn't finish: plain, and always that nothing broke. */
function whyNot(job: { status: string; error?: string | null }) {
  const err = String(job.error ?? '').toLowerCase();
  const after = ' Nothing in your game changed, and the credits are back in your account.';
  if (err === 'timeout') return `That was taking too long, so I stopped it.${after} Try again, or ask for a smaller piece first.`;
  if (err === 'unreachable') return `I lost my connection to the AI service.${after} Give it a moment and try again.`;
  if (job.status === 'cancelled') return `That request was cancelled before I finished.${after}`;
  if (/overload|rate|busy|capacity|429|529/.test(err)) return `The AI is very busy right now.${after} Try again in a minute.`;
  if (/json|schema|parse/.test(err)) return `My answer came back garbled, so I didn't use it.${after} Try again; rewording can help.`;
  return `I couldn't finish that.${after} Try again, or say it a different way.`;
}

/** A message to the assistant: answered in the background; the reply and its file changes reach every editor live. */
export async function askAssistant(user: User, gameId: string, body: { message?: unknown; file?: unknown; errors?: unknown; context?: unknown; mention?: unknown }) {
  const { game, role } = memberGame(user, gameId);
  // Builders change the world through the assistant; scripts are for editors and the owner.
  const codes = role === 'editor' || role === 'owner';
  const message = String(body.message ?? '').trim().slice(0, 4000);
  if (!message) throw new PortalError('Ask for something');
  if (thinking.has(game.id)) throw new PortalError('The assistant is still working on the last message', { status: 429 });
  const fresh = getUser(user.id)!;
  if (fresh.credits < AI_CREDITS()) throw new PortalError(`A message to the assistant costs ${AI_CREDITS()} credits; you have ${fresh.credits}.`, { status: 402 });
  const asked = chatMessage(game.id, user.id, 'user', message, { toAi: true });
  const ctx = context(game.id, typeof body.file === 'string' ? body.file : undefined);
  const errors = typeof body.errors === 'string' && body.errors.trim() ? `\nErrors the game is showing right now:\n${body.errors.slice(0, 3000)}\n` : '';
  const view = playerView(body.context, body.mention);
  const shared = searchCommunity({ q: message, limit: 16 }).items;
  const communityList = shared.length ? `\nCommunity library things that match what they said (id, kind, title, tags):\n${shared.map((c) => `${c.id} ${c.kind} "${c.title}" [${c.tags.join(' ')}]`).join('\n')}\n` : '';
  const prompt = `Game: ${game.title}\n${game.description ? `About: ${game.description}\n` : ''}\nAssets in the game (id name "title" [words]; then config.assets, the world's choice per word):\n${ctx.assets.length ? ctx.assets.join('\n') : '(none yet)'}\n\nThe world (scene.json), one line per thing:\n${ctx.world || '(empty)'}\n\nFiles (scripts and behaviors):\n${ctx.files}\n\nRecent conversation:\n${ctx.chat || '(none)'}\n${errors}${communityList}\n${view}\n${user.name ?? 'Someone'} asks: ${message}`;
  thinking.add(game.id);
  broadcast(game.id, 'thinking', { on: true, by: user.name });
  let job: any;
  try {
    [job] = await submit(fresh, [{ tool: 'llm.json', params: { prompt, system: SYSTEM(), schema: SCHEMA, effort: 'medium', maxTokens: 32000 } }], { kind: 'session', id: `game:${game.id}`, name: game.title, cap: null }, { minCredits: AI_CREDITS() });
  } catch (e) {
    thinking.delete(game.id);
    broadcast(game.id, 'thinking', { on: false });
    throw e;
  }
  void (async () => {
    // Nothing may leave the assistant "thinking" forever: a job that takes too long is cancelled (and refunded).
    const deadline = Date.now() + Number(env('GAME_AI_TIMEOUT_MS') ?? 5 * 60_000);
    let unreachable = 0;
    try {
      for (;;) {
        if (['done', 'failed', 'cancelled'].includes(job.status)) break;
        if (Date.now() > deadline) {
          job = await gen(`/v1/jobs/${job.id}/cancel`, { as: fresh.project, method: 'POST' }).catch(() => ({ ...job, status: 'cancelled' }));
          if (!['done', 'failed', 'cancelled'].includes(job.status)) job = { ...job, status: 'cancelled' };
          job.error = 'timeout';
          break;
        }
        await new Promise((r) => setTimeout(r, Number(process.env.PORTAL_TASK_POLL_MS ?? 1500)));
        const next = await gen(`/v1/jobs/${job.id}`, { as: fresh.project }).catch(() => null);
        if (next) { job = next; unreachable = 0; } else if (++unreachable > 40) { job = { ...job, status: 'failed', error: 'unreachable' }; break; }
      }
      settle(job);
      if (job.status !== 'done') {
        chatMessage(game.id, null, 'ai', whyNot(job), { error: true, retry: message, mention: body.mention ?? null, replyTo: asked.id });
        return;
      }
      const v = job.result?.value ?? {};
      const changed: string[] = [];
      const problems: string[] = [];
      for (const f of Array.isArray(v.files) ? v.files : []) {
        if (!codes) { problems.push(`${f.path}: only editors can change scripts (ask the owner)`); continue; }
        try {
          if (f.path === 'scene.json') throw new PortalError('the world changes as "world" ops, not as a file');
          if (String(f.content ?? '').length > LIMITS.fileBytes) throw new PortalError('too long');
          writeFile(user, game.id, { path: f.path, content: String(f.content ?? '') }, { by: 'Assistant' });
          changed.push(String(f.path));
        } catch (e: any) {
          problems.push(`${f.path}: ${e.message}`);
        }
      }
      let world: unknown[] = [];
      if (Array.isArray(v.world) && v.world.length) {
        try {
          const r = sceneOps(null, game.id, worldOps(v.world, problems), { by: 'Assistant' });
          world = r.applied;
          if (r.applied.length) broadcastOps(game.id, r.applied, 'Assistant', 'materialize');
          for (const e of r.errors) problems.push(`world: ${e}`);
        } catch (e: any) {
          problems.push(`world: ${e.message}`);
        }
      }
      const deleted: string[] = [];
      for (const p of codes && Array.isArray(v.delete) ? v.delete : []) {
        try {
          deleteFile(user, game.id, p);
          deleted.push(String(p));
        } catch {}
      }
      const have = new Set(listAssets(game.id).map((a) => a.name));
      const suggested = (Array.isArray(v.assets) ? v.assets : []).filter((a: any) => KINDS[a?.kind] && a?.prompt && !have.has(a.name)).slice(0, 8)
        .map((a: any) => ({ kind: a.kind, name: String(a.name), prompt: String(a.prompt), credits: KINDS[a.kind].credits, community: communityFor(a) }));
      const text = String(v.reply ?? '').trim() || (changed.length || world.length ? 'Done.' : 'I had nothing to change.');
      chatMessage(game.id, null, 'ai', problems.length ? `${text}\n\n(Some changes could not be saved: ${problems.join('; ')})` : text, { changed, deleted, world, assets: suggested, replyTo: asked.id, job: job.id });
    } catch (e: any) {
      console.error('[portal] assistant:', e);
      chatMessage(game.id, null, 'ai', "Something went wrong on my side before I could finish. Nothing in your game changed, and you weren't charged for this one.", { error: true, retry: message, mention: body.mention ?? null, replyTo: asked.id });
      if (job && !['done', 'failed', 'cancelled'].includes(job.status)) settle({ ...job, status: 'failed', error: String(e?.message ?? e) });
    } finally {
      thinking.delete(game.id);
      broadcast(game.id, 'thinking', { on: false });
    }
  })();
  return { ok: true, message: asked, credits: AI_CREDITS() };
}

/** Community things that could be this suggestion: the assistant's pick first, then the best matches of that kind. */
const COMMUNITY_KIND: Record<string, string> = { model: 'model', texture: 'texture', sky: 'sky', sprite: 'sprite', image: 'image', sfx: 'sfx', music: 'music' };
function communityFor(a: { kind: string; name: string; prompt: string; community?: string }) {
  const kind = COMMUNITY_KIND[a.kind];
  if (!kind) return [];
  const q = `${String(a.name).replace(/\.[a-z0-9]+$/i, '').replace(/[-_]/g, ' ')} ${a.prompt}`;
  const found = searchCommunity({ q, kind, limit: 6 }).items;
  const picked = a.community ? searchCommunity({ kind, limit: 120 }).items.find((c) => c.id === a.community) : null;
  return (picked ? [picked, ...found.filter((c) => c.id !== picked.id)] : found).slice(0, 6).map((c) => ({ id: c.id, title: c.title, thumb: c.thumb, kind: c.kind, by: c.by }));
}

/** Marks an assistant suggestion as being made, or as answered by a community thing (so others see it was chosen). */
export function markSuggestion(messageId: string, index: number, taskId: string | null, used?: { id: string; title: string } | null) {
  const r = db.prepare('SELECT data FROM game_chat WHERE id = ?').get(messageId) as { data: string | null } | undefined;
  if (!r?.data) return;
  const data = JSON.parse(r.data);
  if (data.assets?.[index]) {
    if (taskId) data.assets[index].task = taskId;
    if (used) data.assets[index].used = { id: used.id, title: used.title };
    updateChatData(messageId, data);
  }
}
