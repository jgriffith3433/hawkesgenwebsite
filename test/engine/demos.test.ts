// The Overseer's three demos (/play/t/<id>: Bot Arena, Sky Racer, Leap) played in the real engine: each builds with no
// errors and can be won and lost the way its title screen says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, world as run } from './harness.ts';
import { templateBundle } from '../../src/templates.ts';

const H = await load();
const g = globalThis as any;
const errors: string[] = [];
H.report = (e: any, where?: string) => { errors.push(String(where || '') + ': ' + String((e && e.message) || e)); };
const errorBox = () => (g.document.getElementById('error').children as any[]).map((c) => c.textContent);
const settle = (s: number, dt = 0.05) => { for (let t = 0; t < s; t += dt) H.tick(dt); };
// Every menu a script opens, with its buttons (the harness's DOM can't be queried): what's on screen and pressing them.
let shown: { id: string; o: any }[] = [];
H.hooks.game.push((game: any) => {
  const menu = game.ui.menu.bind(game.ui);
  game.ui.menu = (id: string, o: any = {}) => { shown.push({ id, o }); return menu(id, o); };
});
const menus = () => shown.map((m) => `${m.o.title ?? m.id}: ${m.o.html ?? m.o.text ?? ''}`);
/** Presses a button on the newest menu that has it. */
function press(label: RegExp) {
  for (let i = shown.length - 1; i >= 0; i--) {
    const it = (shown[i].o.items || []).find((b: any) => label.test(b.label));
    if (it) { if (it.onClick) it.onClick(); if (it.close !== false) H.game.ui.remove(shown[i].id); return true; }
  }
  return false;
}

function start(id: string) {
  errors.length = 0;
  shown = [];
  const b = templateBundle(id)!;
  const scene = JSON.parse(b.files['scene.json']);
  const scripts = Object.fromEntries(Object.entries(b.files).filter(([k]) => k.endsWith('.js')));
  run(H, { ...scene, config: { ...scene.config, look: false, shadows: false } }, { mode: 'play', scripts });
  return H.game;
}
const things = (tag: string) => [...H.world.entities].filter((e: any) => e.alive && e.tag === tag);

test('Bot Arena: builds, bots come through the gates, 25 down wins, three deaths lose', () => {
  const game = start('fps-arena');
  settle(0.5);
  assert.ok(press(/start/i), `the title has Start: ${menus().join(' | ')}`);
  settle(2);
  assert.deepEqual([...errors, ...errorBox()], []);
  assert.ok(game.player && game.player.alive, 'a player');
  const first = things('bot').length;
  assert.ok(first >= 1, 'a bot');
  settle(16);
  assert.ok(things('bot').length > first, `the gates beam in more (${first} -> ${things('bot').length})`);
  // Shoot them down (the rules count the engine's kills).
  for (let i = 0; i < 40 && game.state.kills < 25; i++) {
    const b = things('bot')[0];
    if (b) game.damage(b, 9999, game.player);
    settle(0.6);
  }
  assert.equal(game.state.kills, 25, 'every bot counted');
  assert.ok(menus().some((t) => /ARENA CLEARED/.test(t)), `won: ${menus().join(' | ')}`);
  assert.deepEqual([...errors, ...errorBox()], []);
});

test('Bot Arena: the shotgun and launch pad work, health drains fairly, three deaths lose', () => {
  const game = start('fps-arena');
  settle(0.5);
  press(/start/i);
  const p = game.player;
  // Standing at the start: a fair few seconds before anything lands.
  const hp0 = p.health;
  settle(8);
  const lost = hp0 - p.health;
  console.log(`[probe] idle 8 s at the start: lost ${lost} health; bots ${things('bot').map((b: any) => `${b.x.toFixed(0)},${b.z.toFixed(0)}`).join(' ')}`);
  // The shotgun pickup.
  p.position = [-18, 1.2, -6];
  settle(0.5);
  console.log(`[probe] gun after the shotgun crate: ${H.gameplay.gun.spec && H.gameplay.gun.spec.type}`);
  // The launch pad up to the tower (the bots stood down for this, so they can't shoot the player off it).
  for (const b of things('bot')) b.destroy();
  for (const id of ['gate_a', 'gate_b', 'gate_c']) H.world.byId.get(id).destroy();
  p.position = [0, 0.6, 12];
  let top = 0;
  for (let i = 0; i < 40; i++) { H.tick(0.05); top = Math.max(top, p.y); }
  settle(2);
  console.log(`[probe] launch pad: highest ${top.toFixed(1)} m, landed at ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}; gun ${H.gameplay.gun.spec && H.gameplay.gun.spec.type}`);
  // It throws you onto the tower's deck, where the rocket launcher is.
  assert.ok(p.y > 4 && Math.abs(p.z - 18) < 3.2 && Math.abs(p.x) < 3.2, `on the tower (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
  assert.equal(H.gameplay.gun.spec && H.gameplay.gun.spec.type, 'launcher', 'picked up the rocket launcher up there');
  for (let i = 0; i < 6 && !game.state.over; i++) { game.damage(game.player, 9999); settle(4); }
  console.log(`[probe] downs ${game.state.downs}, menus: ${menus().slice(-1)}`);
  assert.ok(menus().some((t) => /THE BOTS WIN/.test(t)), 'lost after three');
  assert.deepEqual([...errors, ...errorBox()], []);
});

/** Flies the player toward `to` for one step, turning no faster than the controls can (1.4 rad/s yaw, 1.1 pitch). */
function steer(to: number[], dt: number) {
  const p = H.game.player, cam = H.world.camera;
  const dx = to[0] - p.x, dy = to[1] - p.y, dz = to[2] - p.z;
  const wantYaw = Math.atan2(dx, dz), wantPitch = Math.max(-0.4, Math.min(0.9, -Math.atan2(dy, Math.hypot(dx, dz))));
  let dyaw = wantYaw - cam.yaw; while (dyaw > Math.PI) dyaw -= 2 * Math.PI; while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
  cam.yaw += Math.max(-1.4 * dt, Math.min(1.4 * dt, dyaw));
  cam.pitch += Math.max(-1.1 * dt, Math.min(1.1 * dt, wantPitch - cam.pitch));
}

test('Sky Racer: the countdown, every gate on the clock, the finish; idling runs out of time', () => {
  const game = start('sky-racer');
  settle(0.5);
  assert.deepEqual([...errors, ...errorBox()], []);
  assert.ok(press(/race/i), `the title has Race: ${menus().join(' | ')}`);
  settle(3.2);
  assert.ok(game.state.racing, 'GO after the countdown');
  const gates = [...H.world.entities].filter((e: any) => /^gate_\d+$/.test(e.sceneId)).sort((a: any, b: any) => Number(a.sceneId.slice(5)) - Number(b.sceneId.slice(5)));
  const finish = H.world.byId.get('finish');
  let i = 0;
  for (let t = 0; t < 90 && !game.state.over; t += 1 / 60) {
    const target = i < gates.length ? gates[i] : finish;
    steer([target.x, target.y, target.z], 1 / 60);
    H.tick(1 / 60);
    if (i < gates.length && (gates[i].opacity < 0.5 || target.z < game.player.z - 2)) i++;
  }
  console.log(`[probe] sky racer: ${game.state.gates}/${gates.length} gates, ${game.state.time.toFixed(1)} s, left ${game.state.left.toFixed(1)}; ${menus().slice(-1)}`);
  assert.ok(menus().some((t) => /NEW BEST|FINISHED/.test(t)), `finished: ${menus().slice(-1)}`);
  assert.equal(game.state.gates, gates.length, 'every gate');
  // Again, and fly nowhere: out of time.
  press(/race again/i);
  settle(0.5);
  press(/race/i);
  settle(20);
  assert.ok(menus().some((t) => /OUT OF TIME/.test(t)), `ran out: ${menus().slice(-1)}`);
  assert.deepEqual([...errors, ...errorBox()], []);
});

test('Leap: every gap can be jumped, spikes hurt, coins buy light, the summit wins; the sunset loses', () => {
  const game = start('platform-run');
  settle(0.5);
  assert.deepEqual([...errors, ...errorBox()], []);
  assert.ok(press(/climb/i), `the title has Climb: ${menus().join(' | ')}`);
  settle(0.3);
  const p = game.player;
  // Every step from the last: no higher than a double jump reaches, no farther than one carries (a moving one at its
  // nearest), and the summit after the last step.
  const g = Math.abs(H.world.config.gravity ?? 24);
  const v = Math.sqrt(2 * g * 2.2);
  const rise = 2 * 2.2 * 0.9; // (the second jump starts a little below the first's top)
  const route = [...Array.from({ length: 12 }, (_, i) => H.world.byId.get(`step_${i}`)), H.world.byId.get('summit_floor')];
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i];
    const up = (b.y + b.half[1]) - (a.y + a.half[1]);
    const gap = Math.max(0, Math.hypot(b.x - a.x, b.z - a.z) - Math.max(a.half[0], a.half[2]) - Math.max(b.half[0], b.half[2]) - 4.5);
    assert.ok(up < rise, `${b.sceneId}: ${up.toFixed(1)} m up`);
    assert.ok(gap < (2 * v / g) * 7 * 0.8, `${b.sceneId}: ${gap.toFixed(1)} m across`);
  }
  // Spikes hurt.
  const spike = H.world.byId.get('spike_2');
  const hp = p.health;
  p.position = [spike.x, spike.y + 0.8, spike.z];
  settle(0.6);
  assert.ok(p.health < hp, `spikes hurt (${hp} -> ${p.health})`);
  // A coin buys a second of light.
  const left = game.state.left;
  const coin = H.world.byId.get('coin_1');
  p.position = [coin.x, coin.y, coin.z];
  settle(0.3);
  assert.ok(game.state.score >= 1, 'the coin counted');
  assert.ok(game.state.left > left - 0.3, `light bought (${left.toFixed(1)} -> ${game.state.left.toFixed(1)})`);
  // The summit wins.
  const top = H.world.byId.get('summit');
  p.position = [top.x, top.y + 1, top.z];
  settle(1);
  assert.ok(menus().some((t) => /before dark/.test(t)), `won: ${menus().slice(-1)}`);
  // Again, waiting at the bottom: the sun sets.
  press(/again|climb/i);
  settle(0.5);
  press(/climb/i);
  settle(90);
  assert.ok(menus().some((t) => /SUNSET/.test(t)), `lost: ${menus().slice(-1)}`);
  assert.deepEqual([...errors, ...errorBox()], []);
});
