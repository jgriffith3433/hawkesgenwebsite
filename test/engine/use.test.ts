// E near things (public/play/use.js): the line on screen follows what's offered, and after doing something it's drawn
// again even when nothing is offered any more (a "Get out of the submarine" used to stay when the sub sped off).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const floor = { type: 'box', shape: { size: [40, 1, 40] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('after doing the only thing offered, the line goes away', async () => {
  world(H, sceneOf({ floor, start }), { mode: 'play' });
  let offered = true;
  H.use.register('test:once', { near: () => (offered ? { label: 'Get out of the test', act: () => { offered = false; } } : null) });
  H.tick(0.1);
  const body = (globalThis as any).document.body;
  const line = () => body.children.find((c: any) => c.className === 'hp-use');
  assert.ok(line() && line().children.length === 1, 'the line shows it');
  // Do it the way a tap on the line does (E goes through the same run()).
  line().children[0].onpointerdown({ preventDefault() {}, stopPropagation() {} });
  assert.equal(offered, false);
  await wait(200); // (the line is redrawn a few times a second)
  H.tick(0.1);
  assert.equal(line().children.length, 0, 'nothing is offered now: the line is empty, not the old one');
});
