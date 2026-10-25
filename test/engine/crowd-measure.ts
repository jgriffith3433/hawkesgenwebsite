// A crowd of bodies, measured through the resource monitor (public/play/modules/monitor): what N players cost in draw calls,
// triangles and frame time. Used by test/engine/crowd.test.ts (which holds the budget) and tools/crowd-stats.ts (which prints
// the table docs/characters.md quotes). Players are stood in for as presence.test.ts does: peers in net.js's list with a capsule.
import { world, sceneOf } from './harness.ts';

const floor = { type: 'box', shape: { size: [200, 1, 200] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, -6] } };

/** The bodies in view are `n`: the player's own, and n - 1 players the room holds. */
export type Spread = 'near' | 'far' | 'mixed';
export type Row = { name: string; bodies: number; draws: number; triangles: number; frameMs: number; full: number; simple: number; far: number; materials: number; heapMB: number };

/** Where body i of n stands, in meters ahead of and to the side of the player, who looks down +z from z = -6. */
function place(i: number, n: number, spread: Spread): [number, number] {
  const row = Math.floor(i / 5), col = i % 5;
  const side = (col - 2) * 2.2;
  // near: rows 4 m apart from 3 m ahead (the whole crowd inside 30 m); far: rows from 40 m; mixed: every third row far.
  const ahead = spread === 'far' ? 34 + row * 4 : spread === 'mixed' ? 3 + row * 4 + (row % 3 === 2 ? 30 : 0) : 3 + row * 4;
  void n;
  return [side, ahead - 6 + 6];
}

export function measureCrowd(H: any, name: string, n: number, o: { spread?: Spread; sameLook?: boolean; seconds?: number; tier?: 'phone' | 'tablet' | 'desktop' } = {}): Row {
  const spread = o.spread || 'near', P = H.presence, G = (globalThis as any).HawkesNet;
  G.peers().clear(); P._internal.peerInfo.clear();
  const budget = H.budgetsFor({ tier: o.tier || 'phone', ios: false, memoryGB: 6 });
  world(H, sceneOf({ floor, start }, { budget }), { mode: 'play' });
  H.game.player.controls = false;
  H.game.player.view = 'third'; // (so your own body is one of the n)
  for (let i = 0; i < n - 1; i++) { // (n bodies in view: you, in third person, and n - 1 others)
    const [x, z] = place(i, n, spread), id = `c${i}`;
    const a = H.game.capsule({ x, y: 0.9, z, radius: 0.35, height: 1.8, color: '#ef4444', physics: 'kinematic', tag: 'player', name: `P${i}` });
    a.remotePlayer = true; a.isPlayer = true; a.netId = id;
    G.peers().set(id, { id, name: `P${i}`, color: '#ef4444', state: { p: [x, 0.9, z], y: 0, pi: 0 }, avatar: a, seen: performance.now() });
    P._internal.peerInfo.set(id, { look: P.core.randomLook(o.sameLook ? 1 : 100 + i) });
  }
  H.tick(1);
  const frames = Math.round((o.seconds || 2) * 60);
  const scene = H.world.scene;
  const t0 = performance.now();
  for (let i = 0; i < frames; i++) { H.tick(1 / 60); scene.render(); } // (a frame: the world's step, then the scene drawn into the null engine)
  const frameMs = (performance.now() - t0) / frames;
  const s = H.monitor.sample();
  const c = P.crowd();
  return { name, bodies: n, draws: s.activeDraws, triangles: s.activeTriangles, frameMs, full: c.full, simple: c.simple, far: c.far, materials: s.materials, heapMB: s.heapMB || 0 };
}
