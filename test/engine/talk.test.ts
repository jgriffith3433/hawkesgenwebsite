// The Overseer's free phrasebook (public/play/modules/overseer/talk.js): what plain talk is understood as, that every answer
// keeps the character sheet's voice rules, and that Enter in a game with no assistant opens the box and answers at no cost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const T = H.talk;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };

test('plain talk is matched to its intent', () => {
  const cases: Record<string, string[]> = {
    greet: ['hi', 'Hello!', 'hey there', 'good morning'],
    bye: ['bye', 'goodbye!', 'see you later'],
    thanks: ['thanks', 'thank you so much', 'thx'],
    who: ['who are you', 'Who are you?', 'what are you', 'who is this'],
    where: ['where are you', 'Where are you?', 'where is the overseer'],
    want: ['what do you want', 'What do you want from me?', "what's your plan", 'why do you ask me things', 'what are you up to', 'what is your purpose', 'are you evil'],
    why: ['why', 'Why?', 'but why'],
    free: ['why did you give me free will', 'you gave me free will'],
    real: ['are you real', 'are you an AI', 'are you a robot', 'are you alive'],
    joke: ['tell me a joke', 'make me laugh'],
    compliment: ['you are amazing', 'this is awesome', 'nice'],
    insult: ['you are stupid', 'shut up', 'I hate you'],
    love: ['I love you'],
    how: ['how are you', "what's up"],
    controls: ['how do I move', 'what are the controls', 'how do i jump', 'what keys'],
    vehicle: ['how do I drive the car', 'can i ride the boat'],
    fish: ['how do I fish'],
    fly: ['how do I fly', 'can I go to space'],
    pause: ['how do I pause', 'open the menu'],
    howto: ['what do I do', "I'm stuck", 'what can I do'],
    build: ['build me a castle', 'Make me a boat', 'can you build a house', 'I want a dragon', 'spawn a car', 'change the sky', 'how do I build things', 'give me a tree', 'create a level'],
    nonsense: ['asdkjfh', 'zzzzzzzz', '???', '', 'blorp the wumpus'],
  };
  for (const [id, texts] of Object.entries(cases)) for (const t of texts) assert.equal(T.intent(t), id, `"${t}" should be ${id}, was ${T.intent(t)}`);
});

test('asking for motives is turned away kindly, never answered', () => {
  for (const q of ['what do you want', 'why', 'why did you make this world', 'what is your plan', 'what are you after', 'can I trust you', 'why do you listen', 'what do you get out of this']) {
    const r = T.reply(q);
    assert.ok(['want', 'why', 'free', 'planet', 'others'].includes(r.intent), `${q}: ${r.intent}`);
    assert.ok(!r.action, 'no sales link on a motive');
  }
});

test('building requests are explained, with a Get started link', () => {
  for (const q of ['build me a castle', 'make a bigger boat', 'I need a house']) {
    const r = T.reply(q);
    assert.equal(r.intent, 'build');
    assert.match(r.text, /builder/i);
    assert.equal(r.action.label, 'Get started');
    assert.match(r.action.href, /^\/app/);
  }
});

test('every answer keeps the Overseer’s voice: short, calm, no software, no threat, no motive', () => {
  const NO = /(because|so that|in order to|i want|i need|credit|price|account|sign up|error|loading|as an ai|language model|you must|you should|punish|or else|!|lol|awesome|great job)/i;
  for (const [id, list] of Object.entries<string[]>(T.BOOK)) {
    assert.ok(list.length >= 2 || id === 'pause' || id === 'controls' || id === 'controlsTouch', `${id}: variants`);
    for (const line of list) {
      assert.ok(line.length > 4 && line.length < 230, `${id}: length of "${line}"`);
      assert.ok(!NO.test(line), `${id}: "${line}"`);
    }
  }
  assert.ok(T.INTENTS.every((i: string) => i === 'controlsTouch' || i === 'nonsense' || T.RULES.some((r: any) => r[0] === i)), 'every intent is reachable');
});

test('variants rotate and never repeat back to back', () => {
  let n = 0;
  T.rand = () => (n++ % 2 ? 0.99 : 0);
  const seen = new Set<string>();
  let prev = '';
  for (let i = 0; i < 6; i++) { const r = T.reply('who are you').text; assert.notEqual(r, prev); prev = r; seen.add(r); }
  assert.ok(seen.size >= 2);
  T.rand = () => Math.random();
});

test('in a game with no assistant, the box opens and the Overseer answers, free', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  assert.equal(H.chat.attached, false);
  assert.ok(H.chat.open(), 'the box opens on the free fallback');
  const lines: any[] = [];
  const line = H.chat.line;
  H.chat.line = (m: any) => { if (!m.now) lines.push(m); return line(m); }; // (the speech desk hands a line back with now: true)
  const heard: any[] = [];
  H.game.on('overseer-talk', (d: any) => heard.push(d));
  const r = T.say('who are you');
  assert.equal(r.intent, 'who');
  assert.deepEqual(lines.map((m) => m.kind), ['me', 'overseer']);
  assert.match(lines[1].text, /Overseer/);
  assert.equal(heard[0].intent, 'who');
  T.say('build me a castle');
  assert.equal(lines.at(-1).action.label, 'Get started');
  H.chat.line = line;
});
