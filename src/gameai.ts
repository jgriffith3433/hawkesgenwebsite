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
import { memberGame, chatMessage, updateChatData, writeFile, deleteFile, listAssets, addAsset, freeName, LIMITS } from './games.ts';
import { broadcast } from './live.ts';

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
    title: '3D model', credits: '~55',
    build: (p) => [
      { tool: 'image.generate', title: 'Drawing it', params: { prompt: `${p}, single object, three-quarter view, centered, whole object in frame, plain white background, clean game asset`, width: 1024, height: 1024, count: 1 } },
      { tool: 'mesh.textured', title: 'Building the 3D model', params: { allowSingleView: true }, inputs: { image: { from: 0 } }, keep: true },
    ],
  },
  sfx: { title: 'Sound effect', credits: '~8', build: (p, o) => [{ tool: 'audio.sfx', title: 'Recording', params: { text: p, ...(o.seconds ? { duration: Number(o.seconds) } : {}), loop: false, count: 1 } }] },
  music: { title: 'Music loop', credits: '~20', build: (p, o) => [{ tool: 'audio.music', title: 'Composing', params: { prompt: p, seconds: Math.max(10, Math.min(180, Number(o.seconds) || 60)) } }] },
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
  memberGame(user, gameId);
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
  const pick = out.find((o) => /^(image|audio|model)\//.test(o.mime) || o.mime === 'model/gltf-binary') ?? out[0];
  let assetName: string | null = null;
  let state = t.state === 'done' ? 'done' : t.state;
  if (t.state === 'done' && pick && user) {
    try {
      assetName = (await addAsset(user, row.game_id, { asset: pick.asset, name: freeName(row.game_id, row.name, pick.mime) }, { project: user.project })).name;
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
let apiDoc = '';
const api = () => (apiDoc ||= fs.readFileSync(path.join(ROOT, 'public', 'play', 'API.md'), 'utf8'));

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'files', 'delete', 'assets'],
  properties: {
    reply: { type: 'string', description: 'What you did or what you suggest, in a few plain sentences for the people building the game.' },
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
        type: 'object', additionalProperties: false, required: ['kind', 'name', 'prompt'],
        properties: {
          kind: { type: 'string', enum: Object.keys(KINDS) },
          name: { type: 'string', description: 'File name the scripts use, with extension: sprite/image/texture .png, sky .jpg, model .glb, sfx/voice/music .mp3' },
          prompt: { type: 'string', description: 'What to generate: subject, style, mood. For voice: the exact line.' },
        },
      },
    },
  },
};

const SYSTEM = () => `You are the assistant inside Hawkes Gen's game builder. People (often beginners, often friends building together) make browser games here with short scripts that run on the Hawkes Play runtime, a friendly layer over Babylon.js. You change the game by returning whole files.

Rules:
- Use only the API below (plus plain JavaScript). Do not use import/export, fetch, localStorage, or DOM access except through game.ui.
- Keep changes focused on what was asked; keep the code short, readable and commented where it helps a beginner. Keep the existing style and structure.
- Return the WHOLE content of each file you change. Never return a file unchanged.
- Asset names: only use assets that are listed, or ones you list in "assets" so the people can generate them. Until an asset exists, scripts must not crash: prefer adding an asset in the same message and using a shape as a stand-in, or check with game.find / try.
- If the request is unclear or impossible, change nothing and say what you need.
- Reply in a few plain sentences: what changed and how to try it (which keys). No markdown headings.

${api()}`;

function context(gameId: string, focus?: string) {
  const files = db.prepare('SELECT path, content FROM game_files WHERE game_id = ? ORDER BY path').all(gameId) as { path: string; content: string }[];
  let budget = 150_000;
  const parts: string[] = [];
  // The open file first, then the rest while they fit.
  for (const f of [...files.filter((f) => f.path === focus), ...files.filter((f) => f.path !== focus)]) {
    const block = `--- ${f.path}\n${f.content}\n`;
    if (block.length > budget) { parts.push(`--- ${f.path}\n(left out: too long to include)\n`); continue; }
    budget -= block.length;
    parts.push(block);
  }
  const assets = listAssets(gameId).map((a) => `${a.name} (${a.mime ?? a.kind ?? 'file'})`);
  const chat = (db.prepare("SELECT role, text, user_id FROM game_chat WHERE game_id = ? AND role != 'system' ORDER BY created DESC LIMIT 12").all(gameId) as { role: string; text: string; user_id: string | null }[]).reverse();
  return { files: parts.join('\n'), assets, chat: chat.map((m) => `${m.role === 'ai' ? 'Assistant' : getUser(m.user_id ?? '')?.name ?? 'Someone'}: ${m.text.slice(0, 1500)}`).join('\n') };
}

const thinking = new Set<string>();

/** A message to the assistant: answered in the background; the reply and its file changes reach every editor live. */
export async function askAssistant(user: User, gameId: string, body: { message?: unknown; file?: unknown; errors?: unknown }) {
  const { game } = memberGame(user, gameId);
  const message = String(body.message ?? '').trim().slice(0, 4000);
  if (!message) throw new PortalError('Ask for something');
  if (thinking.has(game.id)) throw new PortalError('The assistant is still working on the last message', { status: 429 });
  const fresh = getUser(user.id)!;
  if (fresh.credits < AI_CREDITS()) throw new PortalError(`A message to the assistant costs ${AI_CREDITS()} credits; you have ${fresh.credits}.`, { status: 402 });
  const asked = chatMessage(game.id, user.id, 'user', message, { toAi: true });
  const ctx = context(game.id, typeof body.file === 'string' ? body.file : undefined);
  const errors = typeof body.errors === 'string' && body.errors.trim() ? `\nErrors the game is showing right now:\n${body.errors.slice(0, 3000)}\n` : '';
  const prompt = `Game: ${game.title}\n${game.description ? `About: ${game.description}\n` : ''}\nAssets in the game: ${ctx.assets.length ? ctx.assets.join(', ') : '(none yet)'}\n\nFiles:\n${ctx.files}\n\nRecent conversation:\n${ctx.chat || '(none)'}\n${errors}\n${user.name ?? 'Someone'}${typeof body.file === 'string' ? ` (looking at ${body.file})` : ''} asks: ${message}`;
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
    try {
      for (;;) {
        if (['done', 'failed', 'cancelled'].includes(job.status)) break;
        await new Promise((r) => setTimeout(r, Number(process.env.PORTAL_TASK_POLL_MS ?? 1500)));
        job = await gen(`/v1/jobs/${job.id}`, { as: fresh.project }).catch(() => job);
      }
      settle(job);
      if (job.status !== 'done') {
        chatMessage(game.id, null, 'ai', `I couldn't finish that (${job.error ?? job.status}). Your credits for it were given back.`, { error: true });
        return;
      }
      const v = job.result?.value ?? {};
      const changed: string[] = [];
      const problems: string[] = [];
      for (const f of Array.isArray(v.files) ? v.files : []) {
        try {
          if (String(f.content ?? '').length > LIMITS.fileBytes) throw new PortalError('too long');
          writeFile(user, game.id, { path: f.path, content: String(f.content ?? '') }, { by: 'Assistant' });
          changed.push(String(f.path));
        } catch (e: any) {
          problems.push(`${f.path}: ${e.message}`);
        }
      }
      const deleted: string[] = [];
      for (const p of Array.isArray(v.delete) ? v.delete : []) {
        try {
          deleteFile(user, game.id, p);
          deleted.push(String(p));
        } catch {}
      }
      const have = new Set(listAssets(game.id).map((a) => a.name));
      const suggested = (Array.isArray(v.assets) ? v.assets : []).filter((a: any) => KINDS[a?.kind] && a?.prompt && !have.has(a.name)).slice(0, 8)
        .map((a: any) => ({ kind: a.kind, name: String(a.name), prompt: String(a.prompt), credits: KINDS[a.kind].credits }));
      const text = String(v.reply ?? '').trim() || (changed.length ? 'Done.' : 'I had nothing to change.');
      chatMessage(game.id, null, 'ai', problems.length ? `${text}\n\n(Some changes could not be saved: ${problems.join('; ')})` : text, { changed, deleted, assets: suggested, replyTo: asked.id, job: job.id });
    } catch (e: any) {
      chatMessage(game.id, null, 'ai', `Something went wrong: ${e.message ?? e}`, { error: true });
    } finally {
      thinking.delete(game.id);
      broadcast(game.id, 'thinking', { on: false });
    }
  })();
  return { ok: true, message: asked, credits: AI_CREDITS() };
}

/** Marks an assistant suggestion as being made (so others see it was clicked). */
export function markSuggestion(messageId: string, index: number, taskId: string) {
  const r = db.prepare('SELECT data FROM game_chat WHERE id = ?').get(messageId) as { data: string | null } | undefined;
  if (!r?.data) return;
  const data = JSON.parse(r.data);
  if (data.assets?.[index]) {
    data.assets[index].task = taskId;
    updateChatData(messageId, data);
  }
}
