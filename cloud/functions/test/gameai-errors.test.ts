// Why the Overseer's message did not change the game: each real failure is named, never the bare "I couldn't finish that".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, plainReason, rawError, wasRejected } from '../src/gameai-errors.ts';

test('Gen refusing Claude to a customer project (the 2026-11 cause) is an auth/config problem, not "couldn\'t finish"', () => {
  const gen = 'Claude needs your own access: add your Anthropic API key, or sign in with your Claude subscription, in your hawkesgen.ai settings.';
  assert.equal(classify(null, gen), 'auth');
  assert.equal(classify(402, 'x'), 'auth');
  assert.equal(classify(401, ''), 'auth');
  assert.match(plainReason('auth'), /my AI service/);
  assert.doesNotMatch(plainReason('auth'), /couldn't finish/);
});
test('timeouts, busy, garbled, empty and rejected each read differently', () => {
  assert.equal(classify(null, 'timeout'), 'timeout');
  assert.equal(classify(504, ''), 'timeout');
  assert.equal(classify(429, ''), 'busy');
  assert.equal(classify(null, 'Claude API error 529: overloaded'), 'busy');
  assert.equal(classify(null, 'Claude returned something that is not JSON'), 'garbled');
  assert.equal(classify(null, 'empty'), 'empty');
  assert.equal(classify(null, 'rejected'), 'rejected');
  assert.equal(classify(null, 'something odd'), 'unknown');
  const all = new Set(['auth', 'busy', 'timeout', 'empty', 'garbled', 'rejected'].map((k) => plainReason(k as any)));
  assert.equal(all.size, 6);
});
test('what was built stays is said when something was built', () => {
  assert.match(plainReason('timeout', false), /stays/);
  assert.match(plainReason('timeout', true), /Nothing in your game changed/);
});
test('the raw error keeps step, status and Gen\'s words, with no keys', () => {
  const r = rawError('gen-job', 402, 'bad Bearer abc.def-123 and sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(r.step, 'gen-job'); assert.equal(r.status, 402); assert.equal(r.kind, 'auth');
  assert.doesNotMatch(r.message, /abc\.def|sk-ant/);
  assert.ok(rawError('x', null, 'a'.repeat(5000)).message.length <= 400);
});
test('an answer whose every change the game refused is a failure; a partly applied one is not', () => {
  assert.equal(wasRejected({ ops: 2, applied: 0, files: 0, filesDone: 0 }), true);
  assert.equal(wasRejected({ ops: 2, applied: 1, files: 0, filesDone: 0 }), false);
  assert.equal(wasRejected({ ops: 0, applied: 0, files: 0, filesDone: 0 }), false);
});
