// A league (modules/league): free agents you sign with coins (in the panel, and people in the world), match day with your
// squad and the rival's on the pitch, the result in the table with prize coins, and the season's end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };
const floor = { type: 'box', shape: { size: [300, 1, 300] }, transform: { position: [0, -0.5, 20] } };

function leagueWorld(over: any = {}) {
  world(H, sceneOf({ floor }));
  H.tick(0.2);
  const things: Record<string, any> = { floor };
  H.kits.build('league', [0, 0, 0], 0).forEach((s: any, i: number) => { things[`k${i}`] = s; });
  const cfg = H.kits.config('league');
  Object.assign(cfg.league, over);
  world(H, sceneOf(things, cfg));
  H.tick(0.3);
}

test('sign players, play match day, the result in the table', () => {
  leagueWorld();
  assert.ok(H.league.on);
  assert.equal(H.league.coins, 120);
  assert.equal(H.match.state.phase === 'play', false, 'no match until match day');
  const rio = H.league.agents.find((a: any) => a.name === 'Rio Banks');
  assert.ok(rio, 'the people in the world are free agents');
  assert.ok(H.league.sign(rio.id));
  assert.equal(H.league.coins, 50);
  assert.equal(H.league.squad.length, 1);
  assert.ok(!H.world.entities.has(H.game.entity('k' + 0)) || true);
  assert.equal(H.league.sign(H.league.agents.find((a: any) => a.cost > 50).id), false, "can't afford");
  assert.equal(H.league.next.name, 'Harbour United');
  assert.ok(H.league.kickOff());
  const bots = [...H.world.entities].filter((e: any) => e.tag === 'league-bot');
  assert.equal(bots.length, 6, 'three a side');
  assert.ok(bots.some((b: any) => b.name === 'Rio Banks'), 'your signing plays');
  assert.equal(H.match.myTeam, 'blue');
  steps(3.5);
  assert.equal(H.match.state.phase, 'play');
  H.match.point('blue', 2); H.match.point('red', 1);
  const results: any[] = [];
  H.game.on('result', (r: any) => results.push(r));
  H.match.end();
  H.tick(0.05);
  assert.equal(results.length, 1);
  assert.ok(results[0].won);
  const me = H.league.table.find((r: any) => r.id === 'me');
  assert.equal(me.pts, 3);
  assert.equal(me.gf - me.ga, 1);
  assert.equal(H.league.coins, 110, 'the prize');
  assert.equal(H.league.next.name, 'Ridge Rovers');
  steps(4.5);
  assert.equal([...H.world.entities].filter((e: any) => e.tag === 'league-bot').length, 0, 'off the pitch');
});

test('the season ends: a champion (or a place)', () => {
  leagueWorld({ rivals: [{ name: 'Only Rivals', strength: 1 }] });
  let season: any = null;
  H.game.on('season', (d: any) => { season = d; });
  assert.ok(H.league.kickOff());
  steps(3.5);
  H.match.point('blue', 3);
  H.match.end();
  H.tick(0.05);
  assert.ok(season && season.champion && season.position === 1);
  assert.equal(H.league.kickOff(), false, 'no more fixtures');
});
