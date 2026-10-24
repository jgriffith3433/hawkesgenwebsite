// Events and quests (public/play/modules/events): the when -> if -> do rules, variables, timers, zones, events from
// other modules, disasters starting and cleaning up, a quest from a friend start to finish, and the host deciding
// online. Run in the real engine in Node (test/engine/harness.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world, sceneOf } from './harness.ts';

const H = await load();
const E = H.events;
const floor = { type: 'box', name: 'Ground', shape: { size: [120, 1, 120] }, transform: { position: [0, -0.5, 0] } };
const start = { type: 'spawn', transform: { position: [0, 0, 0] } };
const run = (entities: Record<string, any>, config: Record<string, any> = {}, o: any = {}) => world(H, sceneOf({ floor, start, ...entities }, config), o);
const g = () => H.game;
const at = (x: number, z: number, y = 1) => { const p = g().player; p.position = [x, y, z]; p.velocity = [0, 0, 0]; };

test('a rule runs at the start, after a delay and every few seconds; variables count', () => {
  run({}, {
    events: {
      vars: { ticks: 0, started: false },
      rules: [
        { id: 'hello', when: 'start', do: [{ var: 'started', set: true }, { message: 'Welcome {player}!' }] },
        { id: 'later', when: { after: 2 }, do: [{ var: 'later', set: 'yes' }] },
        { id: 'tick', when: { every: 1 }, do: [{ var: 'ticks', add: 1 }] },
      ],
    },
  });
  assert.equal(g().events.value('started'), true, 'start rule ran');
  H.tick(1.05);
  assert.equal(g().events.value('ticks'), 1);
  assert.equal(g().events.value('later'), 0, 'not yet');
  H.tick(2.05);
  assert.equal(g().events.value('ticks'), 3);
  assert.equal(g().events.value('later'), 'yes');
  assert.ok(g().events.history.some((h: any) => h.rule === 'hello'));
});

test('conditions, else, chance, templates and per-player variables', () => {
  run({}, {
    events: {
      vars: { coins: 0, fish: { value: 0, per: 'player' } },
      rules: [
        { id: 'rich', when: { event: 'check' }, if: { var: 'coins', '>=': 3 }, do: [{ var: 'said', set: 'rich with {coins}' }], else: [{ var: 'said', set: 'poor' }] },
        { id: 'never', when: { event: 'check' }, if: { chance: 0 }, do: [{ var: 'lucky', set: 1 }] },
        { id: 'always', when: { event: 'check' }, if: [{ chance: 1 }, { not: { var: 'coins', '>': 10 } }], do: [{ var: 'fine', set: 1 }] },
        { id: 'fish', when: { event: 'fished' }, do: [{ var: 'fish', add: 2 }] },
      ],
    },
  });
  g().emit('check', {});
  assert.equal(g().events.value('said'), 'poor');
  g().events.set('coins', 5);
  g().emit('check', {});
  assert.equal(g().events.value('said'), 'rich with 5');
  assert.equal(g().events.value('lucky'), 0);
  assert.equal(g().events.value('fine'), 1);
  g().emit('fished', {});
  assert.equal(g().events.value('fish', 'me'), 2, 'per-player variable');
  assert.deepEqual(g().events.standings('fish')[0].value, 2);
  assert.equal(E.fill('{best:fish} has {bestValue:fish}', { who: E.meWho() }), `${E.myName()} has 2`);
});

test('waits, repeats, if/else and random inside the actions', () => {
  run({}, {
    events: {
      rules: [{
        id: 'seq', when: { event: 'go' },
        do: [
          { var: 'a', set: 1 },
          { wait: 1 },
          { var: 'a', set: 2 },
          { repeat: 3, every: 0.5, do: [{ var: 'n', add: 1 }] },
          { if: { var: 'n', '=': 3 }, do: [{ var: 'branch', set: 'yes' }], else: [{ var: 'branch', set: 'no' }] },
          { random: [[{ var: 'r', set: 1 }], [{ var: 'r', set: 2 }]] },
        ],
      }],
    },
  });
  g().emit('go', {});
  assert.equal(g().events.value('a'), 1);
  H.tick(0.5);
  assert.equal(g().events.value('a'), 1, 'still waiting');
  H.tick(0.6);
  assert.equal(g().events.value('a'), 2);
  assert.equal(g().events.value('n'), 1, 'first repeat at once');
  H.tick(1.1);
  assert.equal(g().events.value('n'), 3);
  assert.equal(g().events.value('branch'), 'yes');
  assert.ok([1, 2].includes(g().events.value('r')));
});

test('zones (enter, leave), touching, using with E, clicking, destroyed things, counts and variables crossing', () => {
  run({
    hill: { type: 'zone', name: 'Hill', shape: { radius: 3, height: 3 }, transform: { position: [10, 1.5, 0] } },
    bell: { type: 'cylinder', name: 'Bell', shape: { radius: 0.4, height: 0.6 }, transform: { position: [-6, 1, 0] } },
    tower: { type: 'box', name: 'Tower', shape: { size: 1 }, transform: { position: [0, 0.5, 12] } },
    crate1: { type: 'box', name: 'Crate', tag: 'loot', shape: { size: 0.5 }, transform: { position: [5, 0.25, 8] } },
    crate2: { type: 'box', name: 'Crate', tag: 'loot', shape: { size: 0.5 }, transform: { position: [6, 0.25, 8] } },
  }, {
    events: {
      rules: [
        { id: 'in', when: { enter: 'Hill' }, do: [{ var: 'in', add: 1 }] },
        { id: 'out', when: { leave: 'Hill' }, do: [{ var: 'out', add: 1 }] },
        { id: 'ring', when: { use: 'Bell', label: 'Ring the bell' }, do: [{ var: 'rung', add: 1 }] },
        { id: 'click', when: { click: 'Tower' }, do: [{ var: 'clicked', add: 1 }] },
        { id: 'gone', when: { destroyed: 'Tower' }, do: [{ var: 'gone', set: true }] },
        { id: 'empty', when: { count: 'loot', below: 1 }, do: [{ var: 'looted', set: true }] },
        { id: 'ten', when: { var: 'points', reaches: 10 }, do: [{ var: 'won', set: true }] },
      ],
    },
  });
  at(0, 0); H.tick(0.3);
  at(10, 0); H.tick(0.3);
  assert.equal(g().events.value('in'), 1, 'entered once');
  H.tick(0.5);
  assert.equal(g().events.value('in'), 1, 'standing in it does not repeat');
  at(20, 0); H.tick(0.3);
  assert.equal(g().events.value('out'), 1);
  // E near the bell.
  at(-4.5, 0); H.tick(0.4);
  const offer = E.bestOffer(g().player);
  assert.ok(offer && /Ring the bell/.test(offer.label), `offer: ${offer && offer.label}`);
  offer.act();
  assert.equal(g().events.value('rung'), 1);
  // Clicking.
  H.tick(1.1);
  const tower = g().entity('tower');
  for (const h of tower.handlers.click) h([0, 1, 12]);
  assert.equal(g().events.value('clicked'), 1);
  tower.destroy();
  assert.equal(g().events.value('gone'), true);
  H.tick(0.6);
  for (const c of g().all('loot')) c.destroy();
  H.tick(0.6);
  assert.equal(g().events.value('looted'), true);
  g().events.set('points', 4);
  assert.notEqual(g().events.value('won'), true);
  g().events.change('points', 7);
  assert.equal(g().events.value('won'), true);
});

test('"it" is what the trigger was about: coins touched disappear one by one', () => {
  const coins = Object.fromEntries([0, 1, 2].map((i) => [`coin${i}`, { type: 'cylinder', name: 'Coin', tag: 'coin', physics: 'trigger', shape: { radius: 0.4, height: 0.1 }, transform: { position: [i * 4 + 4, 1, 0] } }]));
  run(coins, { events: { hud: [{ var: 'coins', label: 'Coins', of: 3 }], rules: [{ id: 'coin', when: { touch: 'coin' }, do: [{ remove: 'it' }, { var: 'coins', add: 1 }, { if: { var: 'coins', '=': 3 }, do: [{ var: 'all', set: true }] }] }] } });
  for (const x of [4, 8, 12]) { at(x, 0); H.tick(0.25); }
  assert.equal(g().events.value('coins'), 3);
  assert.equal(g().all('coin').length, 0);
  assert.equal(g().events.value('all'), true);
});

test("other modules' events trigger rules by name, with filters", () => {
  run({}, {
    events: {
      rules: [
        { id: 'fish', when: { event: 'catch', of: 'trout' }, do: [{ var: 'trout', add: 1 }] },
        { id: 'big', when: { event: 'catch', where: { 'fish.weight': { '>=': 5 } } }, do: [{ var: 'big', add: 1 }] },
        { id: 'boom', when: { event: 'explosion' }, do: [{ var: 'booms', add: 1 }] },
        { id: 'car', when: { event: 'enter', of: 'car' }, do: [{ var: 'drove', set: true }] },
        { id: 'mine', when: { event: 'my-thing', where: { colour: 'red' } }, do: [{ var: 'red', set: true }] },
      ],
    },
  });
  g().emit('catch', { fish: { id: 'trout', name: 'Trout', weight: 2 }, mine: true, by: { id: null, name: null } });
  g().emit('catch', { fish: { id: 'pike', name: 'Pike', weight: 7 }, mine: true, by: { id: null, name: null } });
  g().emit('catch', { fish: { id: 'trout', name: 'Trout', weight: 9 }, mine: false, by: { id: 'p9', name: 'Sam' } });
  assert.equal(g().events.value('trout'), 1, "someone else's catch is theirs to send");
  assert.equal(g().events.value('big'), 1);
  g().emit('explosion', { position: [0, 0, 0], radius: 4, authoritative: true });
  assert.equal(g().events.value('booms'), 1);
  const car = g().box({ name: 'Car', tag: 'car', x: 3 });
  g().emit('enter', { vehicle: car, me: true, seat: 0 });
  assert.equal(g().events.value('drove'), true);
  g().emit('my-thing', { colour: 'blue' });
  assert.notEqual(g().events.value('red'), true);
  g().emit('my-thing', { colour: 'red' });
  assert.equal(g().events.value('red'), true);
});

test('actions change the world: spawn, set, move, remove, give, teleport, the clock and the dark', () => {
  run({ door: { type: 'box', name: 'Door', shape: { size: [2, 3, 0.3] }, transform: { position: [0, 1.5, 6] } } }, {
    events: { clock: { hour: 20.5, day: 240 }, rules: [] },
  });
  g().events.do([
    { spawn: 'crate', count: 4, at: [5, 0, 5], tag: 'spawned-crates' },
    { set: 'Door', color: '#ff0000', visible: false },
    { give: 'apple', count: 3 },
    { give: 'rocket-launcher' },
    { teleport: 'player', to: [20, 2, 20] },
  ]);
  H.tick(0.2);
  assert.equal(g().all('spawned-crates').length + [...H.world.entities].filter((e: any) => e.data && e.data.tag === 'spawned-crates').length > 0, true, 'spawned');
  assert.equal(g().entity('door').visible, false);
  assert.equal(g().events.items().apple, 3);
  assert.ok(g().events.has('apple', 3));
  assert.ok(g().events.has('rocket-launcher'), 'a tool is in hand');
  assert.ok(Math.abs(g().player.x - 20) < 1.5);
  g().events.do([{ remove: 'spawned-crates' }]);
  assert.equal([...H.world.entities].filter((e: any) => e.data && e.data.tag === 'spawned-crates').length, 0);
  // Night: the clock crosses 21:00 and a time rule fires; the world gets darker.
  g().events.add({ id: 'night', when: 'night', do: [{ var: 'night', set: true }] });
  const sky0 = H.world.scene.clearColor.r;
  H.tick(6);
  assert.equal(g().events.value('night'), true, `hour ${g().events.hour}`);
  assert.ok(H.world.scene.clearColor.r <= sky0, 'darker at night');
});

// The disasters' own parts (their names start with "ev-"); explosions and splashes they cause clean up on their own.
const ours = (list: any[]) => list.filter((x) => /^ev-/.test(x.name || '')).length;
const counts = () => ({ meshes: ours(H.world.scene.meshes), systems: ours(H.world.scene.particleSystems), lights: ours(H.world.scene.lights) });
const loose = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`crate${i}`, { type: 'box', name: 'Box', physics: 'dynamic', shape: { size: 0.6 }, transform: { position: [8 + (i % 3), 0.4, 8 + Math.floor(i / 3)] } }]));

for (const [name, extra, cfg] of [
  ['tornado', { seconds: 4, at: [8, 0, 8] }, {}],
  ['meteor-shower', { seconds: 3, at: [10, 0, 10], every: 0.3 }, {}],
  ['flood', { seconds: 4, rise: 1, depth: 1.5 }, { water: { level: -2 } }],
  ['earthquake', { seconds: 3 }, {}],
  ['zombie-night', { seconds: 4, count: 4, waves: 2 }, {}],
  ['blizzard', { seconds: 3 }, {}],
  ['volcano', { seconds: 3, at: [0, 0, 30], every: 0.3 }, {}],
] as const) {
  test(`disaster: ${name} runs and stops cleanly`, () => {
    run(loose(6), { ...cfg, events: { rules: [{ id: 'd', when: { event: 'go' }, do: [{ disaster: name, ...extra }] }, { id: 'end', when: { event: 'disaster', where: { state: 'end' } }, do: [{ var: 'ended', add: 1 }] }, { id: 'boom', when: { event: 'explosion' }, do: [{ var: 'booms', add: 1 }] }] } });
    H.tick(0.3);
    const before = counts();
    const fog = H.world.scene.fogMode;
    const box = g().entity('crate0');
    const y0 = box.y;
    const level0 = H.water && H.water.sea ? H.water.level : null;
    g().emit('go', {});
    assert.deepEqual(g().events.disasters, [name]);
    let moved = false, maxLevel = -99, zombies = 0;
    for (let i = 0; i < 20; i++) {
      H.tick(0.1);
      if (Math.abs(box.y - y0) > 0.3 || Math.hypot(box.vx, box.vz) > 0.5) moved = true;
      if (H.water && H.water.sea) maxLevel = Math.max(maxLevel, H.water.level);
      zombies = Math.max(zombies, [...H.world.entities].filter((e: any) => e.alive && e.data && e.data.tag === 'zombie-night').length);
    }
    if (name === 'tornado' || name === 'earthquake') assert.ok(moved, `${name} moves loose things`);
    if (name === 'flood') assert.ok(maxLevel > (level0 ?? -2) + 0.5, `the sea rose (${level0} -> ${maxLevel})`);
    if (name === 'zombie-night') assert.ok(zombies >= 2, `zombies came (${zombies})`);
    if (name === 'zombie-night') assert.ok(E.state.dark.v > 0.3, 'it got dark');
    if (name === 'blizzard') assert.equal(H.world.scene.fogMode, H.world.scene.constructor.FOGMODE_LINEAR ?? 3);
    if (name === 'volcano') assert.ok(g().all('volcano').length === 1, 'a volcano stands');
    H.tick(8);
    if (name === 'meteor-shower' || name === 'volcano') assert.ok(g().events.value('booms') >= 2, `${name}: things blow up (${g().events.value('booms')})`);
    assert.deepEqual(g().events.disasters, [], 'over');
    assert.equal(g().events.value('ended'), 1, 'the end was announced');
    const after = counts();
    assert.equal(after.systems, before.systems, `particles cleaned (${before.systems} -> ${after.systems})`);
    assert.equal(after.lights, before.lights, 'lights cleaned');
    assert.equal(after.meshes, before.meshes, `meshes cleaned (${before.meshes} -> ${after.meshes})`);
    if (name === 'blizzard') assert.equal(H.world.scene.fogMode, fog, 'fog restored');
    if (name === 'volcano') assert.equal(g().all('volcano').length, 0, 'the volcano went with it');
    if (name === 'zombie-night') { H.tick(2); assert.equal([...H.world.entities].filter((e: any) => e.alive && e.data && e.data.tag === 'zombie-night').length, 0, 'zombies gone at dawn'); }
    if (name === 'flood') { H.tick(3); assert.ok(H.water.level < maxLevel - 0.5, 'the water went down'); }
  });
}

test('stop ends a disaster early, and leaving the world cleans everything', () => {
  run({}, { events: { rules: [{ id: 't', when: 'start', do: [{ tornado: { seconds: 60, at: [5, 0, 5] } }] }] } });
  H.tick(0.5);
  assert.deepEqual(g().events.disasters, ['tornado']);
  g().events.do([{ stop: 'tornado' }]);
  assert.deepEqual(g().events.disasters, []);
  g().events.do([{ disaster: 'blizzard', seconds: 30 }]);
  const s = E.state;
  run({});
  assert.equal(s.disasters.length, 0, 'the old world stopped its disasters');
});

test('a quest from a friend: offer, find the sheep, bring them to the barn, talk, reward', () => {
  run({
    max: { type: 'friend', name: 'Max', shape: { personality: 'a calm old shepherd', follow: false }, transform: { position: [2, 1, 2] } },
    barn: { type: 'zone', name: 'Barn', shape: { size: [8, 4, 8] }, transform: { position: [-15, 2, 0] } },
    flower: { type: 'sphere', name: 'Flower', tag: 'flower', shape: { radius: 0.2 }, physics: 'none', transform: { position: [-30, 0.3, -30] } },
  }, {
    quests: [{
      id: 'sheep', title: 'Lost sheep', giver: 'Max', text: 'My sheep ran off! Find them and bring them to the barn.',
      lines: { accept: 'Thank you!', done: 'My sheep are home!' },
      setup: [{ spawn: 'sheep', count: 3, at: [20, 0, 20], area: 4, tag: 'lost-sheep' }],
      steps: [
        { id: 'flowers', text: 'Pick a flower for Max', optional: true, goal: { collect: 'flower', count: 1 }, reward: { score: 5 } },
        { id: 'find', text: 'Find the lost sheep', goal: { find: 'lost-sheep', count: 3 } },
        { id: 'bring', text: 'Bring them to the barn', goal: { bring: 'lost-sheep', count: 3, to: 'Barn' } },
        { id: 'back', goal: { talk: 'Max' } },
      ],
      reward: { score: 50, give: ['lasso', { item: 'wool', count: 2 }] },
    }],
    events: { rules: [{ id: 'cheer', when: { quest: 'sheep', is: 'done' }, do: [{ var: 'cheered', set: true }] }] },
  });
  const Q = g().events.quests;
  assert.equal(Q.state('sheep'), 'available');
  at(3, 3.5); H.tick(0.4);
  const offer = E.bestOffer(g().player);
  assert.ok(offer && /Max/.test(offer.label), `offer to talk: ${offer && offer.label}`);
  offer.act(); // opens the dialog (in Node: accepts through the host)
  if (Q.state('sheep') !== 'active') Q.start('sheep');
  assert.equal(Q.state('sheep'), 'active');
  H.tick(0.3);
  const sheep = [...H.world.entities].filter((e: any) => e.alive && e.data && e.data.tag === 'lost-sheep');
  assert.equal(sheep.length, 3, 'the sheep are out there');
  assert.equal(Q.step('sheep'), 'find');
  for (const s of sheep) { at(s.x + 1, s.z); H.tick(0.3); }
  assert.equal(Q.step('sheep'), 'bring', `found them all (progress ${JSON.stringify(Q.progress('sheep'))})`);
  at(-30, -29.5); H.tick(0.4);
  assert.equal(g().entity('flower'), null, 'picked the flower (a side goal, alongside)');
  assert.equal(g().events.value('score', 'me'), 5, 'its reward');
  assert.ok(sheep.every((s: any) => s.data.found), 'they follow you now');
  for (const s of sheep) { s.position = [-15 + (Math.random() - 0.5) * 3, 0.8, (Math.random() - 0.5) * 3]; s.velocity = [0, 0, 0]; }
  H.tick(0.3);
  assert.equal(Q.step('sheep'), 'back', `in the barn (progress ${JSON.stringify(Q.progress('sheep'))})`);
  const tgt = Q.targets();
  assert.ok(tgt.length >= 1, 'a marker points at Max');
  Q.talk('sheep');
  H.tick(0.2);
  assert.equal(Q.state('sheep'), 'done');
  assert.equal(g().events.value('score', 'me'), 55);
  assert.equal(g().events.items().wool, 2);
  assert.ok(g().events.has('lasso'));
  H.tick(0.1);
  assert.equal(g().events.value('cheered'), true, 'rules hear quest events');
});

test('quests: branching choices, optional steps, event goals and requires', () => {
  run({ elder: { type: 'capsule', name: 'Elder', behaviors: [{ use: 'quest-giver', quest: 'fork' }], transform: { position: [0, 1, 4] } } }, {
    quests: [
      {
        id: 'fork', title: 'Two roads', giver: null, auto: false,
        steps: [
          { id: 'pick', text: 'Choose a side', choice: [{ label: 'Fish', next: 'fish' }, { label: 'Fight', next: 'fight' }] },
          { id: 'fish', goal: { catch: 'any', count: 2 }, next: 'end' },
          { id: 'fight', goal: { defeat: 'dummy', count: 1 }, next: 'end' },
        ],
      },
      { id: 'after', title: 'Afterwards', requires: 'fork', steps: [{ goal: { event: 'party' } }] },
    ],
  });
  const Q = g().events.quests;
  H.tick(0.1);
  assert.equal(Q.state('fork'), 'available');
  assert.equal(Q.state('after'), 'locked');
  Q.start('fork');
  assert.equal(Q.step('fork'), 'pick');
  Q.choose('fork', 0);
  assert.equal(Q.step('fork'), 'fish');
  g().emit('catch', { fish: { id: 'perch', name: 'Perch' }, mine: true });
  g().emit('catch', { fish: { id: 'carp', name: 'Carp' }, mine: true });
  assert.equal(Q.state('fork'), 'done');
  H.tick(0.1);
  assert.equal(Q.state('after'), 'active', 'the next quest started by itself (no giver)');
  g().emit('party', {});
  assert.equal(Q.state('after'), 'done');
});

test('playing together: a guest sends its triggers to the host, the host runs the actions', () => {
  run({ hill: { type: 'zone', name: 'Hill', shape: { radius: 3 }, transform: { position: [10, 1.5, 0] } } }, {
    events: {
      vars: { hill: { value: 0, per: 'player' } },
      rules: [
        { id: 'in', when: { enter: 'Hill' }, do: [{ var: 'hill', add: 1 }, { message: '{player} is on the hill', to: 'all' }, { give: 'flag', count: 1 }, { banner: 'You are on the hill', to: 'player' }] },
        { id: 'host-only', when: { every: 1 }, do: [{ var: 'ticks', add: 1 }] },
      ],
    },
  });
  const out: any[] = [];
  E._net = { online: true, host: false, me: 'p2', name: 'Sam', out, players: [{ id: 'p1', name: 'Hostie', entity: null }] };
  try {
    H.tick(1.2);
    assert.equal(g().events.value('ticks'), 0, 'a guest runs no timers');
    at(0, 0); H.tick(0.3);
    at(10, 0); H.tick(0.3);
    assert.equal(g().events.value('hill', 'p2'), 0, 'the guest changes nothing itself');
    const asked = out.filter((m) => m.name === 'events:fire' && !m.host);
    assert.equal(asked.length, 1, 'the guest asked the host');
    assert.equal(asked[0].d.who.id, 'p2');
    // Now this machine is the host and gets the guest's request.
    out.length = 0;
    E._net.host = true; E._net.me = 'p1'; E._net.name = 'Hostie';
    E._deliver('events:fire', asked[0].d, { authoritative: true });
    assert.equal(g().events.value('hill', 'p2'), 1, "the host counted it for the guest");
    assert.equal(g().events.items('p2').flag, 1, "the guest's bag");
    const sent = out.filter((m) => m.name === 'events:do');
    const msg = sent.find((m) => m.d.n === 'message');
    assert.ok(msg && msg.d.pid === null && /Sam is on the hill/.test(msg.d.a.message), 'everyone hears it, with the right name');
    const ban = sent.find((m) => m.d.n === 'banner');
    assert.equal(ban.d.pid, 'p2', 'the banner is only for the guest');
    // A guest applies only what is for it.
    E._net.host = false; E._net.me = 'p3';
    delete E.state.ui.banner;
    E._deliver('events:do', ban.d);
    assert.equal(E.state.ui.banner, undefined, 'another guest shows nothing');
    E._net.me = 'p2';
    E._deliver('events:do', ban.d);
    assert.ok(E.state.ui.banner && /on the hill/.test(E.state.ui.banner.textContent), 'the guest it is for sees it');
    H.tick(1.1);
    E._net.host = true;
    H.tick(1.1);
    assert.ok(g().events.value('ticks') >= 1, 'the host runs timers');
  } finally { delete E._net; }
});
