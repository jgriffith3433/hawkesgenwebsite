// Studio's character-motion playtest (public/playtest/character-motion.js) played here on the guest sandbox, the world it
// plays on beta: landings on 10 to 40 degree slopes go straight back to walking, and the planted foot holds from walk to
// run and back. The sandbox is a round world, so the test ground has to be where "up" is the player's up (it once sat
// 400 m away, where the planet's curve let the player fall past it and every landing and foot check failed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world as run } from './harness.ts';
import { templateBundle } from '../../src/templates.ts';

const H = await load();
const g = globalThis as any;
const scene = JSON.parse(templateBundle('sandbox')!.files['scene.json']);

test('the character-motion playtest on the sandbox: every slope landing goes back to walking, and the planted foot holds', async () => {
  run(H, { ...scene, config: { ...scene.config, look: false, shadows: false } }, { mode: 'play' });
  H.tick(0.5);
  // The playtest's clock is the page's: here, the engine's steps (and each step is a drawn frame).
  let clock = 0;
  const now = performance.now;
  (performance as any).now = () => clock;
  const step = () => { H.tick(1 / 60); clock += 1000 / 60; H.world.scene.onAfterRenderObservable.notifyObservers(H.world.scene); };
  const problems: string[] = [], events: string[] = [];
  const t = {
    wait: async (ms: number) => { for (let i = 0; i < Math.round(ms / (1000 / 60)); i++) step(); },
    until: async (fn: () => boolean, ms: number, what: string) => { for (let i = 0; i < ms / 16; i++) { if (fn()) return; step(); } throw new Error(`waited for ${what}`); },
    event: (k: string, d: string) => events.push(`${k}: ${d}`),
    problem: (k: string, d: string) => problems.push(`${k}: ${d}`),
    scene: () => {}, progress: () => {}, metric: () => {},
  };
  try {
    const { runCharacterMotion } = await import('../../public/playtest/character-motion.js');
    if (g.location) g.location.hostname = 'beta.hawkesgames.com';
    await runCharacterMotion(t, { options: { bodies: ['person'] } });
  } finally { (performance as any).now = now; }
  assert.equal(problems.join('\n'), '', events.filter((e) => e.startsWith('trace')).join('\n'));
  assert.ok(events.some((e) => e.startsWith('foot-run')), 'the feet were traced');
});
