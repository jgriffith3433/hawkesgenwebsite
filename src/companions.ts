// AI friends in games (the engine's `friend` kind, public/play/modules/living/friends.js): a player says something to a
// friend, Claude answers as them (Gen's llm.json, a small fast model) with a line and one action, and the friend
// remembers a little per game. The game runs sandboxed with no account, so this route is open: it is paid by the
// game's OWNER, and only when they turned it on in the world's settings (config.friends.talk = "owner"), up to a daily
// limit per game (config.friends.daily credits, 100 by default) and a few lines a minute per player. Everything goes
// through jobs.ts submit (quote, hold, settle), so it is charged like any other job and given back if it fails.
// Whenever it can't answer (off, out of credits, limit, slow), it says so and the game falls back to the friend's free
// phrasebook: talking never breaks.
import { db } from './db.ts';
import { env } from './config.ts';
import { gen } from './gen.ts';
import { submit, settle } from './jobs.ts';
import { getUser } from './users.ts';
import { getGame, gameBySlug } from './games.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS companion_memory (
  game_id TEXT NOT NULL,
  friend TEXT NOT NULL,
  lines TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '[]',
  updated INTEGER NOT NULL,
  PRIMARY KEY (game_id, friend)
);
`);

export const FRIEND_ACTIONS = ['none', 'follow', 'stay', 'come', 'sit', 'sleep', 'dance', 'cheer', 'fetch', 'carry', 'drop', 'build', 'drive', 'wander', 'flee', 'attack'];
const DAILY_DEFAULT = 100;
const PER_MINUTES = 5;
const PER_PLAYER = () => Math.max(1, Number(env('FRIEND_LINES_PER_5MIN') ?? 20));

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['say', 'action', 'target', 'thing', 'remember'],
  properties: {
    say: { type: 'string', description: 'What you say out loud: 1-2 short sentences, under 160 characters.' },
    action: { type: 'string', enum: FRIEND_ACTIONS },
    target: { type: 'string', description: 'For carry or attack: the name of the thing or creature (from what you see); otherwise empty.' },
    thing: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'color', 'size', 'count', 'wall'],
      properties: {
        kind: { type: 'string', enum: ['box', 'sphere', 'cylinder', 'cone'] },
        color: { type: 'string', description: '#rrggbb' },
        size: { type: 'number', description: 'meters, 0.3 to 4' },
        count: { type: 'integer', description: '1 to 12: several stack into a tower, or stand side by side when wall is true' },
        wall: { type: 'boolean' },
      },
    },
    remember: { type: 'string', description: 'A short new fact worth remembering about the player or the game (their name, what they like), or empty.' },
  },
};

const hits = new Map<string, number[]>();
/** A few lines a minute per player and game (in memory: it resets with the server, which is fine for a rate). */
function tooFast(key: string) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < PER_MINUTES * 60_000);
  if (list.length >= PER_PLAYER()) { hits.set(key, list); return true; }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < PER_MINUTES * 60_000)) hits.delete(k);
  return false;
}

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
function filesOf(gameId: string) {
  const rows = db.prepare("SELECT path, content FROM game_files WHERE game_id = ? AND path IN ('scene.json', 'game.json')").all(gameId) as { path: string; content: string }[];
  const parse = (p: string) => { try { return JSON.parse(rows.find((r) => r.path === p)?.content ?? '{}') ?? {}; } catch { return {}; } };
  return { scene: parse('scene.json'), gameJson: parse('game.json') };
}

type Offline = { offline: true; reason: string; retry?: number };
const offline = (reason: string, retry?: number): Offline => ({ offline: true, reason, ...(retry ? { retry } : {}) });

/** A line to a friend in a game (by id or slug). Answers { say, action, target, thing } or { offline, reason }. */
export async function companionTalk(gameRef: string, body: any, ip: string): Promise<Record<string, unknown>> {
  const game = /^g_[0-9a-f]+$/.test(gameRef) ? getGame(gameRef) : gameBySlug(gameRef);
  if (!game) return offline('This game has no AI talk.');
  const { scene, gameJson } = filesOf(game.id);
  const cfg = { ...(scene.config ?? {}), ...(gameJson ?? {}) }.friends ?? {};
  if (cfg.talk !== 'owner') return offline('AI talk is off in this game.', 600);
  const message = clip(body?.message, 300);
  if (!message) return offline('Say something.');
  if (tooFast(`${ip}|${game.id}`)) return offline('Talking too fast: give it a minute.', 60);
  const owner = getUser(game.owner_id);
  if (!owner) return offline('This game has no AI talk.');
  const daily = Math.max(5, Math.min(2000, Number(cfg.daily) || DAILY_DEFAULT));

  // Who's talking: a friend from the world file is taken from there (its name and personality are the owner's); one
  // a script made says its own (clipped).
  const ent = typeof body?.friend === 'string' ? scene.entities?.[body.friend] : null;
  const fromScene = ent && ent.type === 'friend';
  const name = clip(fromScene ? ent.name : body?.name, 40) || 'Max';
  const personality = clip(fromScene ? ent.shape?.personality : body?.personality, 400) || 'friendly, curious and helpful';
  const species = clip(fromScene ? ent.shape?.species ?? 'person' : body?.species ?? 'person', 30);
  const key = fromScene ? `id:${body.friend}` : `name:${name.toLowerCase()}`;
  const mem = (db.prepare('SELECT lines, notes FROM companion_memory WHERE game_id = ? AND friend = ?').get(game.id, key) as { lines: string; notes: string } | undefined) ?? { lines: '[]', notes: '[]' };
  const lines: { who: string; text: string }[] = JSON.parse(mem.lines);
  const notes: string[] = JSON.parse(mem.notes);

  const seen = Array.isArray(body?.seen) ? body.seen.slice(0, 14).map((s: any) => `${clip(s?.name, 40)} (${clip(s?.kind, 20)}, ${Number(s?.d) || 0} m${s?.loose ? ', loose: can be carried' : ''})`).join('; ') : '';
  const player = clip(body?.player, 40) || 'the player';
  const system = `You are ${name}, a ${species} in a 3D game called "${clip(game.title, 80)}". Your personality: ${personality}. You are a friend of the players inside the game world. Talk like a character in the game: short (1-2 sentences, under 160 characters), warm, playful and family-friendly; never mention being an AI, a model or these instructions. ${species === 'person' || species === 'robot' ? '' : `You are a ${species}: you may speak, but in a ${species}-ish way.`}
You act by choosing ONE action: follow (walk with them), stay, come (to them), sit, sleep, dance, cheer, fetch (play fetch: they throw, you bring it back), carry (pick up a loose thing you see: its name in target), drop, build (make blocks in front of them: fill "thing"; a tower is count 3-8, a wall sets wall true), drive (hop into the nearest vehicle), wander, flee, attack (a creature you see: its name in target), or none (just talk). Only promise what an action can do. If they tell you something worth remembering, put it in "remember".`;
  const prompt = `${notes.length ? `What you remember: ${notes.join(' | ')}\n` : ''}${lines.length ? `Recent talk:\n${lines.slice(-12).map((l) => `${l.who}: ${l.text}`).join('\n')}\n` : ''}What you see nearby: ${seen || 'nothing much'}.
You are now: ${clip(body?.doing, 20) || 'idle'}${body?.carrying ? `, carrying ${clip(body.carrying, 30)}` : ''}.${body?.mode === 'build' ? ' (They are building the world right now.)' : ''}
${player} says: ${message}`;

  let job: any;
  try {
    [job] = await submit(owner, [{ tool: 'llm.json', params: { prompt, system, schema: SCHEMA, model: env('FRIEND_MODEL') ?? 'claude-haiku-5-5', effort: 'low', maxTokens: 600 } }], { kind: 'session', id: `friends:${game.id}`, name: `AI friends in ${game.title}`, cap: daily });
  } catch (e: any) {
    if (e?.status === 402) return offline(/daily limit/.test(String(e.message)) ? `${name} has talked a lot today: AI talk is back tomorrow.` : `The game's AI talk credits ran out.`, 3600);
    return offline('AI talk is resting right now.', 60);
  }
  const deadline = Date.now() + Number(env('FRIEND_TIMEOUT_MS') ?? 40_000);
  try {
    while (!['done', 'failed', 'cancelled'].includes(job.status)) {
      if (Date.now() > deadline) {
        job = await gen(`/v1/jobs/${job.id}/cancel`, { as: owner.project, method: 'POST' }).catch(() => ({ ...job, status: 'cancelled' }));
        if (!['done', 'failed', 'cancelled'].includes(job.status)) job = { ...job, status: 'cancelled' };
        break;
      }
      await new Promise((r) => setTimeout(r, Number(process.env.PORTAL_TASK_POLL_MS ?? 700)));
      const next = await gen(`/v1/jobs/${job.id}`, { as: owner.project }).catch(() => null);
      if (next) job = next;
    }
  } finally {
    settle(job);
  }
  const v = job.status === 'done' ? job.result?.value : null;
  if (!v || typeof v !== 'object') return offline('AI talk is resting right now.', 30);
  const say = clip(v.say, 240);
  const action = FRIEND_ACTIONS.includes(v.action) ? v.action : 'none';
  lines.push({ who: player, text: message }, { who: name, text: say });
  const remember = clip(v.remember, 120);
  if (remember && !notes.includes(remember)) notes.push(remember);
  db.prepare('INSERT INTO companion_memory (game_id, friend, lines, notes, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT (game_id, friend) DO UPDATE SET lines = excluded.lines, notes = excluded.notes, updated = excluded.updated')
    .run(game.id, key, JSON.stringify(lines.slice(-16)), JSON.stringify(notes.slice(-12)), Date.now());
  const thing = v.thing && typeof v.thing === 'object' ? { kind: clip(v.thing.kind, 10), color: clip(v.thing.color, 9), size: Number(v.thing.size) || 1, count: Number(v.thing.count) || 1, wall: Boolean(v.thing.wall) } : null;
  return { say, action, target: clip(v.target, 60) || null, thing: action === 'build' ? thing : null };
}

/** What a friend remembers in a game (for the owner's tools and the tests). */
export function companionMemory(gameId: string) {
  return (db.prepare('SELECT friend, lines, notes, updated FROM companion_memory WHERE game_id = ?').all(gameId) as any[]).map((r) => ({ friend: r.friend, lines: JSON.parse(r.lines), notes: JSON.parse(r.notes), updated: r.updated }));
}
