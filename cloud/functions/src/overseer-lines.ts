// The Overseer at work, as a show (J, 2026-10-27: "I ALWAYS want some visual feedback WHILE the overseer is thinking";
// a request is built piece by piece, never a snap). Three parts, all pure here so tests drive them:
//   - The line protocol: the assistant answers in JSON Lines, one thing per line (focus, say, beat, op, wait, file,
//     delete, asset, reply). Gen's llm.text job hands back the text as it is written (`result.partial`), and each line
//     is applied the moment it is complete: `readLines` finds the new complete lines in the text so far.
//   - Pacing: `pace` says how long to hold after a line, so the world fills in beat by beat even when the text arrives
//     all at once (a beat's title is seen, things land one after another, a `wait` is honoured), within a total budget.
//   - The director: a fast small model answers in a second or two with an opening line, where the work goes and the
//     beats it will play (DIRECTOR_SCHEMA), while the full answer is still being written. `resolveFocus` turns its
//     "where" (what they look at, the player, a thing) into world coordinates from what the player sees.

/** One line of the answer, as parsed. Anything else on a line is ignored and reported. */
export type Line =
  | { kind: 'focus'; at: number[] | null; radius: number; area: string; id: string | null }
  | { kind: 'say'; text: string; who: string | null }
  | { kind: 'beat'; title: string }
  | { kind: 'op'; op: string; id: string; json: any }
  | { kind: 'wait'; seconds: number }
  | { kind: 'file'; path: string; content: string }
  | { kind: 'delete'; path: string }
  | { kind: 'asset'; asset: { kind: string; name: string; prompt: string; community: string } }
  | { kind: 'reply'; text: string }
  | { kind: 'look'; id: string; prompt: string; suggest: string[]; why: string };

export const AREAS = ['ground', 'terrain', 'sky', 'sea', 'thing', 'area', 'player', 'ui', 'sound'];
const OPS = new Set(['create', 'update', 'replace', 'delete', 'config']);
const num = (x: unknown, d: number) => (Number.isFinite(Number(x)) ? Number(x) : d);
const vec = (x: unknown) => (Array.isArray(x) && x.length === 3 && x.every((v) => Number.isFinite(Number(v))) ? x.map(Number) : null);
const clampN = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** One line of text as a Line, or a reason it isn't one. Fences and blank lines are nothing (null, no reason). */
export function parseLine(raw: string): Line | { problem: string } | null {
  const s = raw.trim().replace(/,$/, '');
  if (!s || /^```/.test(s)) return null;
  let o: any;
  try { o = JSON.parse(s); } catch { return { problem: `not a JSON line: ${s.slice(0, 80)}` }; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { problem: 'a line that is not an object' };
  if (o.focus && typeof o.focus === 'object') {
    const f = o.focus;
    return { kind: 'focus', at: vec(f.at), radius: clampN(num(f.radius, 12), 2, 400), area: AREAS.includes(f.kind) ? f.kind : 'area', id: typeof f.id === 'string' && f.id ? f.id.slice(0, 64) : null };
  }
  if (typeof o.say === 'string') return o.say.trim() ? { kind: 'say', text: o.say.trim().slice(0, 300), who: typeof o.who === 'string' && o.who.trim() ? o.who.trim().slice(0, 40) : null } : null;
  if (typeof o.beat === 'string') return o.beat.trim() ? { kind: 'beat', title: o.beat.trim().slice(0, 60) } : null;
  if (typeof o.op === 'string') {
    if (!OPS.has(o.op)) return { problem: `unknown op ${String(o.op).slice(0, 20)}` };
    let json = o.json ?? {};
    if (typeof json === 'string') { try { json = json.trim() ? JSON.parse(json) : {}; } catch { return { problem: `${o.op} ${o.id}: json is not valid JSON` }; } }
    if (!json || typeof json !== 'object') return { problem: `${o.op} ${o.id}: json is not an object` };
    return { kind: 'op', op: o.op, id: String(o.id ?? '').slice(0, 64), json };
  }
  if (o.wait !== undefined) return { kind: 'wait', seconds: clampN(num(o.wait, 1), 0, 4) };
  if (typeof o.file === 'string') return typeof o.content === 'string' ? { kind: 'file', path: o.file, content: o.content } : { problem: `${o.file}: no content` };
  if (typeof o.delete === 'string') return { kind: 'delete', path: o.delete };
  if (o.asset && typeof o.asset === 'object') {
    const a = o.asset;
    return { kind: 'asset', asset: { kind: String(a.kind ?? ''), name: String(a.name ?? ''), prompt: String(a.prompt ?? ''), community: String(a.community ?? '') } };
  }
  if (typeof o.reply === 'string') return { kind: 'reply', text: o.reply.trim() };
  if (o.look && typeof o.look === 'object' && typeof o.look.id === 'string' && o.look.id) {
    const lk = o.look;
    return { kind: 'look', id: lk.id.slice(0, 64), prompt: String(lk.prompt ?? '').slice(0, 300), suggest: (Array.isArray(lk.suggest) ? lk.suggest : []).filter((x: unknown) => typeof x === 'string' && /^a_[0-9a-f]{6,40}$/.test(x)).slice(0, 12), why: String(lk.why ?? '').slice(0, 160) };
  }
  return { problem: `a line of no known kind (${Object.keys(o).slice(0, 3).join(', ')})` };
}

/** The complete lines in `text` from character `from` on: each ends with a newline (the last one only when `final`).
 *  Returns them and where the next read starts. A line is never read twice. */
export function readLines(text: string, from: number, final = false): { lines: string[]; next: number } {
  const lines: string[] = [];
  let at = from;
  for (;;) {
    const nl = text.indexOf('\n', at);
    if (nl < 0) break;
    lines.push(text.slice(at, nl));
    at = nl + 1;
  }
  if (final && at < text.length) { lines.push(text.slice(at)); at = text.length; }
  return { lines, next: at };
}

/** Rejoins a line the model broke with a raw newline inside a string (a long reply typed with a line break): a line
 *  that opens an object and doesn't end with "}" waits for the next pieces (joined with a space). A piece that is a whole
 *  line of its own ends the wait (the broken one goes through as it is, to be reported), so a bad line never swallows good
 *  ones; at most 20 pieces wait. `push` gives back the lines ready now; `flush` the rest at the end. */
export function lineJoiner() {
  let carry: string[] = [];
  const whole = (s: string) => { try { JSON.parse(s.trim().replace(/,$/, '')); return true; } catch { return false; } };
  const open = (s: string) => { const t = s.trim().replace(/,$/, ''); return t.startsWith('{') && !t.endsWith('}') && !whole(t); };
  return {
    push(raw: string): string[] {
      if (!carry.length) {
        if (open(raw)) { carry = [raw]; return []; }
        return [raw];
      }
      if (raw.trim().startsWith('{') && whole(raw)) { const broken = carry.join(' '); carry = []; return [broken, raw]; }
      carry.push(raw);
      const joined = carry.join(' ');
      if (whole(joined) || carry.length >= 20) { carry = []; return [joined]; }
      return [];
    },
    flush(): string | null { const j = carry.length ? carry.join(' ') : null; carry = []; return j; },
  };
}

/** How long to hold after a line before the next is shown (ms), and what the budget has left. The show is paced only
 *  while the budget lasts (PACE.budget in all), so a long answer never keeps the player waiting at the end. */
// One change a second (J, 2026-10-27: "separate them out by a second": the network takes them one at a time and the player
// sees each land); a beat holds a little longer. The budget is how long the show may be paced in all: past it, the rest
// arrives as fast as it is written, so a very long answer never keeps the player waiting at the end.
export const PACE = { beat: 1200, op: 1000, opDelete: 1000, say: 300, file: 300, budget: 180_000 };
export function pace(line: Line, left: number): number {
  if (left <= 0) return 0;
  const ms = line.kind === 'beat' ? PACE.beat
    : line.kind === 'op' ? (line.op === 'delete' ? PACE.opDelete : PACE.op)
    : line.kind === 'wait' ? line.seconds * 1000
    : line.kind === 'say' ? PACE.say
    : line.kind === 'file' ? PACE.file
    : 0;
  return Math.min(ms, left);
}

// ------------------------------------------------------------------ the director: the first seconds
export const DIRECTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['say', 'where', 'id', 'radius', 'area', 'beats'],
  properties: {
    say: { type: 'string', description: "The Overseer's first words, at once: one short sentence in its voice saying what it is starting (\"A race, then. Let me lay the course.\"). Never a question." },
    where: { type: 'string', enum: ['look', 'player', 'thing', 'sky', 'around'], description: 'Where the work goes: the point they look at, around the player, a named thing (id), the sky above them, or all around them.' },
    id: { type: 'string', description: 'For where "thing": the id of the thing (from what they see), else "".' },
    radius: { type: 'number', description: 'How big the area is, meters (a crate 2, a house 10, a race course 80, a whole island 250).' },
    area: { type: 'string', enum: AREAS, description: 'What kind of work: ground/terrain (reshaping), sky, sea, thing (one object), area (things placed around), player (their controls, view, vehicle), ui, sound.' },
    beats: { type: 'array', maxItems: 6, items: { type: 'string' }, description: 'The stages of the build as the player will see them, 2-5 words each, in order ("The ground rises", "The track appears", "Rivals arrive", "Your car", "On your marks"). 2 to 6.' },
  },
};

export const DIRECTOR_SYSTEM = `You are the Overseer, the giant ship in the sky of a 3D game world that beams down whatever the players ask for. A player just asked for something. Another part of you is already building it; your job is the first two seconds: say what you are starting, decide where the work happens, and name the beats of the show the player is about to watch. Your voice: calm, vast, a little amused, generous; first person, short. Never call yourself an assistant or an AI. Never refuse: if it is unclear, start with what is clear. Answer only the JSON.`;

/** The director's prompt: the request and what the player sees, nothing else (it must answer in a second or two). */
export function directorPrompt(message: string, view: string, world: string) {
  return `${view ? `${view}\n` : ''}The world has ${world.split('\n').filter(Boolean).length} things.\n\nThe player asks: ${message}`;
}

/** Where the director's "where" is, in world coordinates, from what the player sees (build.js context()). */
export function resolveFocus(d: { where?: string; id?: string; radius?: number }, ctx: any): { at: number[] | null; id: string | null } {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const player = vec(c.player?.at);
  const up = vec(c.player?.up) ?? [0, 1, 0];
  const thing = d.id ? [c.lookingAt, ...(Array.isArray(c.nearby) ? c.nearby : [])].find((n: any) => n && n.id === d.id) : null;
  if (d.where === 'thing' && thing && vec(thing.at)) return { at: vec(thing.at), id: thing.id };
  if (d.where === 'look' && vec(c.lookPoint)) return { at: vec(c.lookPoint), id: null };
  if (d.where === 'look' && c.lookingAt && vec(c.lookingAt.at)) return { at: vec(c.lookingAt.at), id: c.lookingAt.id ?? null };
  if (d.where === 'sky' && player) { const h = clampN(num(d.radius, 40), 20, 120); return { at: player.map((v, i) => v + up[i] * h), id: null }; }
  if (player) {
    // In front of them, as far as the area is big (around: on them).
    const f = vec(c.player?.facing) ?? [0, 0, 1];
    const k = d.where === 'around' ? 0 : clampN(num(d.radius, 12) * 0.6, 4, 60);
    return { at: player.map((v, i) => v + f[i] * k), id: null };
  }
  return { at: vec(c.lookPoint), id: null };
}
