// The Overseer's first-time lines (public/play/modules/overseer/lines.js): each once per device, in order of
// importance, and never over the intro, the mirror, a tour moment or another Overseer line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [-4, 0, 0] } };

let t = 0;
const L = H.lines;
const said: string[] = [];
function fresh() {
  t = 100;
  L.clock = () => t;
  H.speech.clock = () => t; // (one clock: the speech desk lets a line wait for the one before it)
  H.speech.reset();
  L.rand = () => 0;
  L.reset();
  said.length = 0;
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  H.game.on('overseer-line', (d: any) => said.push(d.id));
  t += L.SETTLE + 1; // past the world's settling
}
const origIntro = Object.getOwnPropertyDescriptor(H.overseer, 'introPlaying')!;
const introOn = () => Object.defineProperty(H.overseer, 'introPlaying', { configurable: true, get: () => true });
const introOff = () => Object.defineProperty(H.overseer, 'introPlaying', origIntro);
const step = (s = 0.3) => { t += s; H.tick(0.05); };

test('every first-time moment has a line, with its text, and the clips reused say the same words', () => {
  assert.deepEqual([...L.IDS].sort(), ['boom', 'build', 'dock', 'death', 'fish', 'friend', 'return', 'space'].sort());
  for (const id of L.IDS) {
    const d = L.LINES[id];
    assert.ok(d.text.length >= 1 && d.text.every((x: string) => x.length > 8 && x.length < 90), id);
    assert.ok(d.text.every((x: string) => !/[!]/.test(x)), `${id}: calm, no exclamation marks`);
    if (d.voice) assert.ok(H.overseer.VOICES[d.voice], `${id}: ${d.voice} is a clip we have`);
  }
});

test('a first moment is one line in the chat, and never again', () => {
  fresh();
  const chat: string[] = [];
  const line = H.chat.line;
  H.chat.line = (m: any) => { chat.push(m.text); return line(m); };
  H.game.emit('catch', { mine: true });
  step();
  assert.deepEqual(said, ['fish']);
  assert.equal(chat.length, 1);
  assert.ok(L.seen('fish'));
  t += 60; H.game.emit('catch', { mine: true }); step();
  t += 60; H.game.emit('catch', { mine: true }); step();
  assert.deepEqual(said, ['fish'], 'not again');
  // Remembered on the device: a fresh load reads it back.
  L.reload();
  assert.ok(L.seen('fish'));
  H.chat.line = line;
});

test('each moment is its own: a vehicle wreck, a dock, a fall, a spawn, the air thinning, a friend', () => {
  fresh();
  const go = (fn: () => void, id: string) => { fn(); step(); assert.equal(said[said.length - 1], id, id); t += 30; };
  go(() => H.game.emit('wrecked', { vehicle: null }), 'boom');
  go(() => H.game.emit('docked', { who: 'me' }), 'dock');
  go(() => H.game.emit('spawned', { things: [] }), 'build');
  go(() => H.game.respawn(), 'death');
  assert.equal(said.length, 4);
  // Above the air.
  const sky = H.sky; const was = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sky), 'space') || Object.getOwnPropertyDescriptor(sky, 'space');
  Object.defineProperty(sky, 'space', { configurable: true, get: () => 0.9 });
  step(); step();
  assert.equal(said[said.length - 1], 'space');
  if (was) Object.defineProperty(sky, 'space', was); else delete (sky as any).space;
  // A friend: a new peer in the room.
  const peers = new Map();
  (globalThis as any).HawkesNet = (globalThis as any).window?.HawkesNet;
  const net = (globalThis as any).window.HawkesNet || ((globalThis as any).window.HawkesNet = {});
  const keep = net.peers; net.peers = () => peers;
  t += 30; step(); peers.set('c1', {}); t += 30; step(); step();
  assert.equal(said[said.length - 1], 'friend');
  net.peers = keep;
});

test('what loads with the world is not "built"', () => {
  fresh();
  t = 100; world(H, sceneOf({ floor, start })); H.tick(0.1);
  H.game.on('overseer-line', (d: any) => said.push(d.id));
  H.game.emit('spawned', { things: [] }); step(0.5);
  assert.deepEqual(said, [], 'inside the settling time');
});

test('a line waits for the intro, the mirror and a tour moment, then comes', () => {
  fresh();
  // The intro is playing.
  introOn();
  H.game.emit('catch', { mine: true }); step(); step();
  assert.deepEqual(said, [], 'waits for the intro');
  assert.deepEqual(L.waiting, ['fish']);
  introOff();
  step();
  assert.deepEqual(said, ['fish'], 'then it is said');
  // A tour moment: the Overseer is answering a finished step.
  t += 60;
  H.game.emit('tour', { step: 'fish' });
  H.game.emit('wrecked', {}); step(); step();
  assert.deepEqual(said, ['fish'], 'waits for the tour');
  assert.equal(L.blocked(), 'moment');
  t += 11; step();
  assert.deepEqual(said, ['fish', 'boom']);
  // The mirror is open.
  t += 60;
  H.game.mirror = { pending: true };
  H.game.emit('docked', {}); step(); step();
  assert.deepEqual(said, ['fish', 'boom']);
  assert.equal(L.blocked(), 'mirror');
  H.game.mirror = { pending: false };
  step();
  assert.deepEqual(said, ['fish', 'boom', 'dock']);
});

test('another Overseer line is never talked over', () => {
  fresh();
  H.overseer.say('Something long enough that it takes a moment to read, from the intro or the assistant.');
  H.game.emit('catch', { mine: true }); step(0.5);
  assert.deepEqual(said, [], 'the Overseer is speaking');
  assert.equal(L.blocked(), 'speaking');
  t += 15; step();
  assert.deepEqual(said, ['fish']);
});

test('priority: the most important waiting line goes first, one at a time', () => {
  fresh();
  introOn();
  H.game.emit('catch', { mine: true });   // fish
  H.game.emit('spawned', { things: [] }); // build
  H.game.emit('docked', {});              // dock
  H.game.emit('wrecked', {});             // boom
  step();
  assert.deepEqual(L.waiting.sort(), ['boom', 'build', 'dock', 'fish']);
  introOff();
  step();
  assert.deepEqual(said, ['dock'], 'the dock first');
  step(1);
  assert.deepEqual(said, ['dock'], 'not over it');
  t += 8; step();
  assert.deepEqual(said, ['dock', 'boom']);
  t += 8; step();
  t += 8; step();
  assert.deepEqual(said, ['dock', 'boom', 'fish', 'build'], 'fish before build: same priority, asked first');
});

test('a line that waits too long gives up, and is not counted as said', () => {
  fresh();
  introOn();
  H.game.emit('catch', { mine: true }); step();
  t += L.STALE + 5; step();
  introOff();
  step();
  assert.deepEqual(said, []);
  assert.equal(L.seen('fish'), false, 'it comes again');
  H.game.emit('catch', { mine: true }); step();
  assert.deepEqual(said, ['fish']);
});

test('coming back after seven days says so, sooner does not', () => {
  fresh();
  const now = Date.now();
  const store: Record<string, string> = {};
  const ls = (globalThis as any).window.localStorage;
  const real = ls ? { g: ls.getItem, s: ls.setItem } : null;
  const win = (globalThis as any).window;
  const prior = win.localStorage;
  win.localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = String(v); } };
  try {
    L.now = () => now;
    store.hg_overseer_lastvisit = String(now - 3 * 24 * 3600 * 1000);
    L.visit(); step(); assert.deepEqual(said, [], 'three days is not a return');
    store.hg_overseer_lastvisit = String(now - 8 * 24 * 3600 * 1000);
    L.visit(); step();
    assert.deepEqual(said, ['return']);
    assert.equal(store.hg_overseer_lastvisit, String(now), 'the visit is kept');
  } finally { win.localStorage = prior; L.now = () => Date.now(); }
  void real;
});
