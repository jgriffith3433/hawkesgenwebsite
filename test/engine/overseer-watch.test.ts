// The Overseer never "thinks forever" (J, 2026-11-10: "why isn't overseer responding it just thinks forever.."): the ask's
// watch (public/play/guest.js HawkesGuestCore.askWatch; editor.js has the same timer) gives up and says so plainly, with
// Retry, when the server goes quiet for a minute or the ask passes its cap, and a heartbeat keeps a long answer alive.
//   node --test --disable-warning=ExperimentalWarning test/engine/overseer-watch.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const guestSrc = fs.readFileSync(path.join(ROOT, 'public', 'play', 'guest.js'), 'utf8');
const editorSrc = fs.readFileSync(path.join(ROOT, 'public', 'editor.js'), 'utf8');
const ctx: any = { window: {}, console };
vm.runInNewContext(guestSrc, ctx, { filename: 'guest.js' });
const Core = ctx.window.HawkesGuestCore;

/** A clock the test moves by hand. */
function clock() {
  let t = 0, seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); t = next[1].at; next[1].fn();
      }
      t = end;
    },
    get pending() { return timers.size; },
  };
}
const watch = (c: ReturnType<typeof clock>, fails: string[]) => Core.askWatch({ quietMs: 60_000, capMs: 390_000, onFail: (why: string) => fails.push(why), setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, now: c.now });

test('a feed that never answers: the ask gives up after a minute of silence, once', () => {
  const c = clock(), fails: string[] = [];
  const w = watch(c, fails);
  w.start();
  c.advance(59_000);
  assert.deepEqual(fails, [], 'still waiting at 59 s');
  c.advance(2_000);
  assert.deepEqual(fails, ['quiet'], 'gave up at 60 s');
  assert.equal(w.running, false);
  c.advance(600_000);
  assert.deepEqual(fails, ['quiet'], 'only once');
});

test('a long answer with its heartbeat every 10 s is never cut off, but the whole ask has a cap', () => {
  const c = clock(), fails: string[] = [];
  const w = watch(c, fails);
  w.start();
  for (let s = 0; s < 380; s += 10) { c.advance(10_000); w.alive(); }
  assert.deepEqual(fails, [], 'alive for 380 s');
  c.advance(20_000);
  assert.deepEqual(fails, ['cap'], 'stopped at the cap (6.5 min), not later');
});

test('the answer stops the watch; the end without an answer waits only a little', () => {
  const c = clock(), fails: string[] = [];
  const w = watch(c, fails);
  w.start(); c.advance(30_000); w.stop();
  c.advance(600_000);
  assert.deepEqual(fails, []);
  assert.equal(c.pending, 0, 'no timer left behind');
  // "thinking" off (or a stream back with the Overseer idle) but no answer: 15 s, then it says so.
  w.start(); c.advance(5_000); w.alive(15_000);
  c.advance(14_000); assert.deepEqual(fails, []);
  c.advance(2_000); assert.deepEqual(fails, ['quiet']);
  // Signs of life before an ask, or after it ended, start nothing.
  w.alive(); c.advance(600_000); assert.deepEqual(fails, ['quiet']);
});

test('the island and the editor wire the watch: a timed-out request, the heartbeat, the answer ends "thinking", hello says whether it is', () => {
  for (const [name, src] of [['guest.js', guestSrc], ['editor.js', editorSrc]] as const) {
    assert.match(src, /\/ai`[^\n]*timeout: ASK_POST_MS/, `${name}: the message to the Overseer has a timeout`);
    assert.match(src, /d\.k === 'alive'\) return/, `${name}: the heartbeat is a sign of life, not a show event`);
    assert.match(src, /d\.thinking/, `${name}: hello says whether the Overseer is working`);
    assert.match(src, /ASK_QUIET_MS = 60_000/, `${name}: a minute of silence at most`);
  }
  assert.match(guestSrc, /H\.chat\.status\(null\);\s*\n\s*try \{ if \(H\.work && H\.work\.active\) H\.work\.end/, 'guest.js: the answer clears the status line and ends the work pill');
  assert.match(editorSrc, /clearAskWatch\(\); \$\('thinkingIndicator'\)\.hidden = true; toStage\(\{ type: 'overseer-work', k: 'end'/, 'editor.js: the answer ends "working"');
});
