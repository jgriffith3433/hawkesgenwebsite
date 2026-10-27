// The Overseer at work (src/overseer-lines.ts, gameai.ts): the line protocol, reading lines as the text grows, pacing,
// where the director's "where" is; then the whole thing against a fake Gen whose llm.text job writes its answer a few
// lines at a time: the world changes one line at a time while the job still runs, the `overseer` events come in order
// (begin, plan, focus, say, beat, op...), the director's plan arrives, and the reply ends it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

// ------------------------------------------------------------------ a fake Gen that writes slowly
const jobs = new Map<string, any>();
const ANSWER = [
  '{"focus":{"at":[10,0,20],"radius":40,"kind":"sky"}}',
  '{"say":"A war, then. Let me darken the sky."}',
  '{"beat":"Gunships arrive"}',
  '{"op":"create","id":"gunship_1","json":{"type":"box","name":"Gunship","transform":{"position":[10,30,20]}}}',
  '{"op":"create","id":"gunship_2","json":"{\\"type\\":\\"box\\",\\"name\\":\\"Gunship two\\",\\"transform\\":{\\"position\\":[14,30,20]}}"}',
  'this line is not JSON',
  '{"wait":0.2}',
  '{"beat":"They wake"}',
  '{"op":"update","id":"gunship_1","json":{"physics":"kinematic"}}',
  '{"say":"Bravo Two, on my wing!","who":"Commander Hale"}',
  '{"file":"scripts/war.js","content":"// the war\\ngame.on(\'start\', () => {});\\n"}',
  '{"asset":{"kind":"sfx","name":"rotor.mp3","prompt":"helicopter rotor loop","community":""}}',
  '{"reply":"Two gunships are up. W to climb."}',
];
const fakeGen = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const body = raw.length ? JSON.parse(raw.toString()) : undefined;
  const json = (status: number, b: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
  const url = new URL(req.url!, 'http://gen');
  if (url.pathname === '/v1/billing/quote') return json(200, { tool: body.tool, credits: body.tool === 'llm.json' ? 1 : 5 });
  if (url.pathname === '/v1/jobs' && req.method === 'POST') {
    const job = { id: `j_${crypto.randomBytes(4).toString('hex')}`, tool: body.tool, params: body.params, status: 'running', polls: 0, result: null as any };
    jobs.set(job.id, job);
    return json(200, { jobs: [job] });
  }
  const m = /^\/v1\/jobs\/(j_[0-9a-f]+)$/.exec(url.pathname);
  if (m) {
    const j = jobs.get(m[1]);
    if (!j) return json(404, { error: 'no job' });
    j.polls++;
    if (j.tool === 'llm.json') { // the director: answers on its first look
      Object.assign(j, { status: 'done', result: { value: { say: 'A war. Watch the sky.', where: 'look', id: '', radius: 60, area: 'sky', beats: ['Gunships arrive', 'They wake', 'Orders'] } } });
    } else {
      // Three more lines a look (the last one half written), done after the answer is all there.
      const upto = Math.min(ANSWER.length, j.polls * 3);
      const text = ANSWER.slice(0, upto).join('\n') + '\n' + (upto < ANSWER.length ? ANSWER[upto].slice(0, 9) : '');
      if (upto >= ANSWER.length && j.polls > ANSWER.length / 3 + 1) Object.assign(j, { status: 'done', result: { text: ANSWER.join('\n') } });
      else j.result = { partial: text, chars: text.length };
    }
    return json(200, j);
  }
  if (url.pathname === '/v1/events') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': hello\n\n'); return; }
  return json(404, { error: 'not in the fake' });
});
await new Promise<void>((r) => fakeGen.listen(0, '127.0.0.1', () => r()));

process.env.PORTAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-overseer-'));
process.env.HAWKESGEN_URL = `http://127.0.0.1:${(fakeGen.address() as any).port}`;
process.env.HAWKESGEN_KEY = 'hg_portal_test_key';
process.env.PUBLIC_URL = 'https://hawkesgen.test';
process.env.STARTER_CREDITS = '50';
process.env.PORTAL_AI_POLL_MS = '20';

const L = await import('../src/overseer-lines.ts');
const { handle } = await import('../src/server.ts');
const { on } = await import('../src/bus.ts');
const portal = http.createServer((req, res) => void handle(req, res));
await new Promise<void>((r) => portal.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(portal.address() as any).port}`;
test.after(() => { portal.close(); fakeGen.close(); });

async function call(route: string, o: { body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  if (o.cookie) headers.Cookie = o.cookie;
  const r = await fetch(base + route, { method: o.body !== undefined ? 'POST' : 'GET', headers, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

// ------------------------------------------------------------------ the pure parts
test('parseLine: every kind, json as an object or as text, and what is not a line', () => {
  assert.deepEqual(L.parseLine('{"focus":{"at":[1,2,3],"radius":900,"kind":"sky"}}'), { kind: 'focus', at: [1, 2, 3], radius: 400, area: 'sky', id: null });
  assert.deepEqual(L.parseLine('{"focus":{"kind":"nonsense"}}'), { kind: 'focus', at: null, radius: 12, area: 'area', id: null });
  assert.deepEqual(L.parseLine('{"say":"Hello.","who":"Pip"}'), { kind: 'say', text: 'Hello.', who: 'Pip' });
  assert.deepEqual(L.parseLine('{"beat":"Gunships arrive"}'), { kind: 'beat', title: 'Gunships arrive' });
  assert.deepEqual(L.parseLine('{"op":"create","id":"a","json":{"type":"box"}}'), { kind: 'op', op: 'create', id: 'a', json: { type: 'box' } });
  assert.deepEqual(L.parseLine('{"op":"update","id":"a","json":"{\\"physics\\":\\"dynamic\\"}"},'), { kind: 'op', op: 'update', id: 'a', json: { physics: 'dynamic' } }, 'json as text, a trailing comma');
  assert.deepEqual(L.parseLine('{"wait":9}'), { kind: 'wait', seconds: 4 });
  assert.deepEqual(L.parseLine('{"file":"scripts/a.js","content":"x"}'), { kind: 'file', path: 'scripts/a.js', content: 'x' });
  assert.deepEqual(L.parseLine('{"reply":" Done. "}'), { kind: 'reply', text: 'Done.' });
  assert.equal(L.parseLine('```json'), null);
  assert.equal(L.parseLine('   '), null);
  assert.ok('problem' in (L.parseLine('{"op":"explode","id":"a"}') as any));
  assert.ok('problem' in (L.parseLine('hello') as any));
  assert.ok('problem' in (L.parseLine('{"op":"create","id":"a","json":"{nope"}') as any));
});

test('readLines: only complete lines, each once, the rest when final', () => {
  let r = L.readLines('{"a":1}\n{"b":', 0);
  assert.deepEqual(r, { lines: ['{"a":1}'], next: 8 });
  r = L.readLines('{"a":1}\n{"b":2}\n{"c"', r.next);
  assert.deepEqual(r.lines, ['{"b":2}']);
  r = L.readLines('{"a":1}\n{"b":2}\n{"c":3}', r.next, true);
  assert.deepEqual(r.lines, ['{"c":3}']);
  assert.equal(r.next, '{"a":1}\n{"b":2}\n{"c":3}'.length);
});

test('pace: beats hold longer than things, waits are honoured, the budget runs out', () => {
  const beat = L.parseLine('{"beat":"x"}') as any, op = L.parseLine('{"op":"create","id":"a","json":{}}') as any, wait = L.parseLine('{"wait":2}') as any;
  assert.ok(L.pace(beat, 1e9) > L.pace(op, 1e9));
  assert.equal(L.pace(wait, 1e9), 2000);
  assert.equal(L.pace(wait, 500), 500);
  assert.equal(L.pace(beat, 0), 0);
  assert.equal(L.pace(L.parseLine('{"reply":"x"}') as any, 1e9), 0);
});

test('resolveFocus: what they look at, a thing, the sky over them, in front of them', () => {
  const ctx = { player: { at: [0, 0, 0], facing: [0, 0, 1], up: [0, 1, 0] }, lookPoint: [3, 0, 9], lookingAt: { id: 'crate', at: [1, 0, 2] }, nearby: [{ id: 'jeep', at: [5, 0, 5] }] };
  assert.deepEqual(L.resolveFocus({ where: 'look' }, ctx).at, [3, 0, 9]);
  assert.deepEqual(L.resolveFocus({ where: 'thing', id: 'jeep' }, ctx), { at: [5, 0, 5], id: 'jeep' });
  assert.deepEqual(L.resolveFocus({ where: 'sky', radius: 50 }, ctx).at, [0, 50, 0]);
  assert.deepEqual(L.resolveFocus({ where: 'around' }, ctx).at, [0, 0, 0]);
  assert.deepEqual(L.resolveFocus({ where: 'player', radius: 10 }, ctx).at, [0, 0, 6]);
  assert.deepEqual(L.resolveFocus({ where: 'look' }, null), { at: null, id: null });
});

// ------------------------------------------------------------------ the whole show
test('a request streams in: the world changes line by line while the job runs, the events come in order, the reply ends it', async () => {
  const su = await call('/v1/users/signup', { body: { email: 'war@example.com', password: 'password123' } });
  assert.equal(su.status, 200, JSON.stringify(su.body));
  const cookie = su.cookie!;
  const g = (await call('/v1/games', { cookie, body: { title: 'War', template: 'blank' } })).body;
  const events: any[] = [];
  const opsSeen: { at: number; ids: string[] }[] = [];
  on('live', (m: any) => { if (m.game === g.id && m.event === 'overseer') events.push(m.data); });
  on('ops', (m: any) => { if (m.game === g.id) opsSeen.push({ at: events.length, ids: m.ops.map((o: any) => o.entity?.id ?? o.id) }); });
  const ctx = { player: { at: [0, 0, 0], facing: [0, 0, 1] }, lookPoint: [2, 0, 8] };
  const r = await call(`/v1/games/${g.id}/ai`, { cookie, body: { message: 'put me in the middle of a helicopter war', context: ctx } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // While the job is still running, the first things are already in the world.
  const mainJob = () => [...jobs.values()].find((j) => j.tool === 'llm.text');
  for (let i = 0; i < 200 && !opsSeen.length; i++) await new Promise((res) => setTimeout(res, 10));
  assert.ok(opsSeen.length, 'a thing arrived');
  assert.equal(mainJob().status, 'running', 'before the answer was finished');
  const chat = async () => (await call(`/v1/games/${g.id}/chat`, { cookie })).body;
  for (let i = 0; i < 300; i++) { const c = await chat(); if ((c.messages ?? c).some?.((x: any) => x.role === 'ai')) break; await new Promise((res) => setTimeout(res, 20)); }
  const kinds = events.map((e) => e.k);
  assert.equal(kinds[0], 'begin');
  assert.deepEqual(events[0].at, [2, 0, 8], 'begins on what they look at');
  assert.ok(kinds.includes('plan'), 'the director spoke');
  const plan = events.find((e) => e.k === 'plan');
  assert.deepEqual(plan.beats, ['Gunships arrive', 'They wake', 'Orders']);
  const order = kinds.filter((k) => ['focus', 'say', 'beat', 'op', 'file', 'end'].includes(k));
  assert.deepEqual(order, ['focus', 'say', 'beat', 'op', 'op', 'beat', 'op', 'say', 'file', 'end']);
  assert.deepEqual(events.find((e) => e.k === 'focus').at, [10, 0, 20]);
  assert.equal(events.filter((e) => e.k === 'say')[1].who, 'Commander Hale');
  assert.deepEqual(events.filter((e) => e.k === 'beat').map((e) => e.n), [1, 2]);
  assert.deepEqual(opsSeen.map((o) => o.ids[0]), ['gunship_1', 'gunship_2', 'gunship_1'], 'one change at a time, in order');
  assert.ok(events.at(-1).ok && events.at(-1).ops === 3);
  const scene = (await call(`/v1/games/${g.id}/bundle`, { cookie })).body;
  const sceneText = typeof scene === 'string' ? scene : JSON.stringify(scene);
  assert.match(sceneText, /Gunship two/);
  const ai = ((await chat()).messages ?? (await chat())).filter((x: any) => x.role === 'ai').at(-1);
  assert.match(ai.text, /^Two gunships are up\. W to climb\./);
  assert.match(ai.text, /not a JSON line/, 'the bad line is noted');
  assert.equal(ai.data.assets[0].name, 'rotor.mp3');
  assert.deepEqual(ai.data.changed, ['scripts/war.js']);
  // The price: the answer (at least the floor) and the director.
  const q = (await call(`/v1/games/${g.id}/ai/quote`, { cookie })).body;
  assert.equal(q.credits, 8 + 1);
});
