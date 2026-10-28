// Matches (modules/match): a countdown, a clock, points to win a round, rounds; the scoreboard; a ball you dribble and
// kick into a goal that scores for its team and comes back to the middle; an AI player that shoots at the right goal;
// hide and seek holding the seekers still in the dark; lives; and the game kits that set a match up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const g = globalThis as any;
const floor = { type: 'box', shape: { size: [400, 1, 400] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const steps = (s: number) => { for (let t = 0; t < s; t += 0.05) H.tick(0.05); };
const buttons = new Map<string, any>();
function press(k: string) {
  let b = buttons.get(k);
  if (!b) { b = new g.HTMLElement('button'); H.bindTouchKey(b, k); buttons.set(k, b); }
  b.dispatch('pointerdown', { preventDefault() {}, stopPropagation() {} }); H.tick(1 / 60); b.dispatch('pointerup', { preventDefault() {}, stopPropagation() {} });
}
const hud = () => g.document.body.children.find((c: any) => c.className === 'mt-hud');

test('a match: a countdown, then play; points to win end the round; one scoreboard', () => {
  world(H, sceneOf({ floor, start }, { match: { teams: ['red', 'blue'], time: 60, score: 2, start: 3 } }));
  H.tick(0.2);
  let st = H.match.state;
  assert.equal(st.phase, 'start');
  assert.deepEqual(st.teams, ['red', 'blue']);
  assert.ok(['red', 'blue'].includes(H.match.myTeam), 'I am on a team');
  H.match.point('red'); // (before the whistle: nothing)
  assert.equal(H.match.state.score.red, undefined);
  steps(3.2);
  assert.equal(H.match.state.phase, 'play');
  const clock = H.match.state.clock;
  steps(1);
  assert.ok(H.match.state.clock < clock, 'the clock runs');
  H.match.point('red'); H.match.point('red');
  st = H.match.state;
  assert.equal(st.score.red, 2);
  assert.equal(st.winner, 'red');
  assert.equal(st.phase, 'end', 'one round: the match is over');
  H.tick(0.05);
  assert.ok(hud(), 'the scoreboard is up');
  assert.match(hud().innerHTML, /Red 2/);
});

test('rounds: the next one starts after a moment, the score from zero, round wins kept; the clock ends a round', () => {
  world(H, sceneOf({ floor, start }, { match: { teams: ['red', 'blue'], time: 2, rounds: 2, start: 1 } }));
  H.tick(0.2);
  steps(1.2);
  H.match.point('blue');
  steps(2.2);
  let st = H.match.state;
  assert.equal(st.winner, 'blue', 'the clock ran out with blue ahead');
  assert.equal(st.phase, 'over');
  steps(6.5);
  st = H.match.state;
  assert.equal(st.round, 2);
  assert.deepEqual(st.score, {}, 'a fresh score');
  assert.equal(st.wins.blue, 1, 'the round win is kept');
});

test('football: dribble and kick the ball into the goal; the goal scores for its team and the ball goes back', () => {
  world(H, sceneOf({ floor, start,
    ball: { type: 'sphere', name: 'Ball', shape: { radius: 0.4 }, physics: 'dynamic', transform: { position: [0, 0.4, 3] }, behaviors: [{ use: 'ball', kick: 20 }] },
    goal: { type: 'box', name: 'Blue scores here', shape: { size: [7, 3, 2] }, physics: 'none', transform: { position: [0, 1.5, 40] }, behaviors: [{ use: 'score-zone', team: 'blue' }] },
  }, { match: { teams: ['red', 'blue'], time: 0, start: 0 } }));
  H.tick(0.2);
  steps(0.2);
  const ball = H.game.entity('ball'), p = H.world.player;
  p.position = [0, 1, 1.6]; p.node.rotation.y = 0;
  H.tick(0.05);
  press('e');
  assert.ok(ball.vz > 10, `kicked forward (${ball.vz.toFixed(1)} m/s)`);
  // Into the goal.
  ball.position = [0, 1, 40];
  H.tick(0.05);
  assert.equal(H.match.state.score.blue, 1, 'a goal for blue');
  assert.ok(Math.abs(ball.z - 3) < 0.5, 'the ball is back in the middle');
});

test('an AI player runs to the ball and shoots at the goal that scores for its team', () => {
  world(H, sceneOf({ floor, start,
    ball: { type: 'sphere', name: 'Ball', shape: { radius: 0.4 }, physics: 'dynamic', transform: { position: [10, 0.4, 10] }, behaviors: [{ use: 'ball' }] },
    goal: { type: 'box', name: 'Red scores here', shape: { size: [7, 3, 2] }, physics: 'none', transform: { position: [10, 1.5, 40] }, behaviors: [{ use: 'score-zone', team: 'red' }] },
    bot: { type: 'capsule', name: 'Red player', shape: { radius: 0.35, height: 1.7 }, physics: 'kinematic', transform: { position: [14, 0.95, 4] }, behaviors: [{ use: 'teammate', team: 'red', speed: 6, kick: 18 }] },
  }));
  H.tick(0.2);
  const ball = H.game.entity('ball');
  let kicked = false;
  H.game.on('kick', () => { kicked = true; });
  for (let t = 0; t < 4 && !kicked; t += 0.05) H.tick(0.05);
  assert.ok(kicked, 'it reached the ball and kicked');
  assert.ok(ball.vz > 5, `toward the red-scoring goal (+z) (${ball.vz.toFixed(1)})`);
});

test('hide and seek: a lone player seeks; seekers wait still in the dark, then go', () => {
  world(H, sceneOf({ floor, start }, { match: { mode: 'hide', start: 2, time: 30 } }));
  H.tick(0.2);
  assert.equal(H.match.myTeam, 'seekers');
  H.tick(0.05);
  assert.equal(H.world.player.controls, false, 'held still while they hide');
  assert.ok(g.document.body.children.some((c: any) => c.className === 'mt-dark'), 'in the dark');
  steps(2.2);
  assert.equal(H.world.player.controls, true, 'and off they go');
  assert.ok(!g.document.body.children.some((c: any) => c.className === 'mt-dark'));
});

test('lives: dying takes one; with none left you are out', () => {
  world(H, sceneOf({ floor, start }, { match: { teams: false, lives: 2, start: 0, time: 0 } }));
  H.tick(0.2); steps(0.1);
  const me = H.match._.meId();
  H.game.emit('death', { entity: H.game.player });
  assert.equal(H.match.state.lives[me], 1);
  H.game.emit('death', { entity: H.game.player });
  assert.equal(H.match.state.lives[me], 0);
  assert.equal(H.match.state.out[me], true);
});

test('the game kits set up a match (and a weapon, waves) with their things', () => {
  world(H, sceneOf({ floor, start }));
  H.tick(0.2);
  for (const id of ['football', 'basketball', 'tennis', 'ctf', 'deathmatch', 'tag', 'hide', 'survival']) {
    const c = H.kits.config(id);
    assert.ok(c && c.match, `${id} has a match`);
    const specs = H.kits.build(id, [0, 0, 0], 0);
    assert.ok(specs.length, id);
    for (const s of specs) { assert.ok(H.kinds.has(s.type), `${id}: ${s.type}`); for (const b of s.behaviors || []) assert.ok(H.behaviorDef(b.use), `${id}: ${b.use}`); }
  }
  assert.equal(H.kits.config('deathmatch').player.weapon, 'blaster');
  assert.ok(H.kits.config('survival').events.rules.length >= 1, 'survival brings its waves');
  const football = H.kits.build('football', [0, 0, 0], 0);
  assert.equal(football.filter((s: any) => s.behaviors && s.behaviors.some((b: any) => b.use === 'teammate')).length, 4, 'two AI players a side');
});
