// The behaviors every game has: things a thing does on its own, named the way people say them ("it spins", "it hurts
// you", "you can collect it"). A thing lists them in scene.json: behaviors: [{ use: 'spin', speed: 90 }]. Each one is
// { title, says(options), defaults, start, update, hit, stop }, called with (thing, ..., options, memory, game).
// Scripts add their own with game.behavior(name, def). WORLD.md lists these for people and for the assistant.
/* global HawkesPlay */
(function () {
  'use strict';
  const H = window.HawkesPlay;
  const def = (names, d) => { for (const n of [].concat(names)) H.behavior(n, d); };
  const isPlayer = (e) => Boolean(e && (e.isPlayer));
  const RAD = Math.PI / 180;
  const axisOf = (a) => (a === 'x' ? 0 : a === 'z' ? 2 : 1);
  const home = (e) => (e.home && e.home.position) || e.position;

  def(['spin', 'rotate', 'turn'], {
    title: 'Spins', says: (o) => `spins ${o.speed > 0 ? '' : 'backwards '}(${Math.abs(o.speed)}°/s)`,
    defaults: { speed: 90, axis: 'y' },
    update(e, dt, o) { const r = e.node.rotation; r[o.axis === 'x' ? 'x' : o.axis === 'z' ? 'z' : 'y'] += o.speed * RAD * dt; },
  });

  def(['bob', 'float', 'hover'], {
    title: 'Floats up and down', says: (o) => `floats up and down (${o.height} m)`,
    defaults: { height: 0.4, speed: 1 },
    start(e, o, s) { s.y = home(e)[1]; },
    update(e, dt, o, s, game) { if (!e.held) e.node.position.y = s.y + Math.sin(game.now * o.speed * Math.PI) * o.height; },
  });

  def(['patrol', 'oscillate', 'slide', 'move'], {
    title: 'Moves back and forth', says: (o) => (o.points ? `follows a path of ${o.points.length} points` : `moves back and forth ${o.range} m along ${o.axis}`),
    defaults: { axis: 'x', range: 4, speed: 1 },
    start(e, o, s) { s.from = home(e).slice(); },
    update(e, dt, o, s, game) {
      if (e.held) return;
      const t = game.now * o.speed;
      if (Array.isArray(o.points) && o.points.length > 1) {
        // Along the points and back, at speed meters per second.
        const pts = [s.from, ...o.points];
        const segs = [];
        let total = 0;
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; const d = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); segs.push({ a, b, d }); total += d; }
        let at = (t * 2) % Math.max(0.001, total);
        for (const sg of segs) { if (at <= sg.d) { const k = at / Math.max(0.001, sg.d); e.node.position.set(sg.a[0] + (sg.b[0] - sg.a[0]) * k, sg.a[1] + (sg.b[1] - sg.a[1]) * k, sg.a[2] + (sg.b[2] - sg.a[2]) * k); return; } at -= sg.d; }
        return;
      }
      const i = axisOf(o.axis);
      const p = s.from.slice();
      p[i] += Math.sin(t) * o.range;
      e.node.position.set(p[0], p[1], p[2]);
    },
  });

  def(['wander', 'roam'], {
    title: 'Wanders around', says: (o) => `wanders around (${o.radius} m)`,
    defaults: { radius: 6, speed: 2 },
    start(e, o, s) { s.c = home(e).slice(); s.goal = null; s.wait = 0; },
    update(e, dt, o, s, game) {
      if (e.held || e.remote) return;
      if (!s.goal || Math.hypot(s.goal[0] - e.x, s.goal[2] - e.z) < 0.4 || s.wait > 6) { s.goal = [s.c[0] + game.random(-o.radius, o.radius), 0, s.c[2] + game.random(-o.radius, o.radius)]; s.wait = 0; }
      s.wait += dt;
      const d = { x: s.goal[0] - e.x, z: s.goal[2] - e.z };
      if (e.physics === 'dynamic') e.walk(d, o.speed); else { const l = Math.hypot(d.x, d.z) || 1; e.node.position.x += (d.x / l) * o.speed * dt; e.node.position.z += (d.z / l) * o.speed * dt; e.node.rotation.y = Math.atan2(d.x, d.z); }
    },
  });

  def(['follow', 'chase'], {
    title: 'Follows you', says: (o) => `follows the nearest player${o.speed ? ` at ${o.speed} m/s` : ''}`,
    defaults: { speed: 3, distance: 1.5, range: 30 },
    update(e, dt, o, s, game) {
      if (e.held || e.remote) return;
      const p = game.nearest('player', e);
      if (!p || p.distanceTo(e) > o.range) { if (e.physics === 'dynamic') e.walk({ x: 0, z: 0 }, 0); return; }
      const d = { x: p.x - e.x, z: p.z - e.z };
      const far = Math.hypot(d.x, d.z) > o.distance;
      if (e.physics === 'dynamic') e.walk(far ? d : { x: 0, z: 0 }, o.speed);
      else if (far) { const l = Math.hypot(d.x, d.z) || 1; e.node.position.x += (d.x / l) * o.speed * dt; e.node.position.z += (d.z / l) * o.speed * dt; e.node.rotation.y = Math.atan2(d.x, d.z); }
    },
  });

  def(['look-at-player', 'face-player', 'watch'], {
    title: 'Turns to face you', says: () => 'turns to face the nearest player',
    update(e, dt, o, s, game) { const p = game.nearest('player', e); if (p && !e.held) e.lookAt(p); },
  });

  def(['hop', 'jumpy', 'keep-bouncing'], {
    title: 'Keeps hopping', says: (o) => `keeps hopping (${o.height} m)`,
    defaults: { height: 1.5 },
    update(e, dt, o, s, game) { if (e.physics === 'dynamic' && e.grounded && !e.held) e.jump(Math.sqrt(2 * Math.abs(game.config.gravity ?? 24) * o.height)); },
  });

  def(['bouncy', 'bounce'], {
    title: 'Bouncy', says: (o) => `bounces (${Math.round(o.amount * 100)}%)`,
    defaults: { amount: 0.8 },
    start(e, o) { e.bounce = Math.max(0, Math.min(0.98, Number(o.amount) || 0.8)); },
    stop(e) { e.bounce = 0; },
  });

  // Collected things are gone for everyone: the one who touched it tells the others.
  function hideCollected(game, id) { const e = game.entity(id); if (e && e.visible) { e.visible = false; e._collected = true; return e; } return null; }
  def(['collectible', 'collect', 'coin'], { // ('pickup' is gameplay.js's: health, ammo, weapons)
    title: 'Can be collected', says: (o) => `can be collected (+${o.points})${o.respawn ? `, comes back after ${o.respawn} s` : ''}`,
    defaults: { points: 1, respawn: 0, sound: null },
    start(e, o, s, game) {
      if (!game.state._collectNet) { game.state._collectNet = true; game.net.on('_collect', (d) => { const x = hideCollected(game, d && d.id); if (x) game.burst(x.position, { color: x.color || '#f4c430', count: 14 }); }); }
      if (e.physics === 'static' || e.physics === 'dynamic') e.ghost = true; // you walk through it to pick it up
    },
    hit(e, other, o, s, game) {
      if (!isPlayer(other) || other !== game.player || !e.visible || e._collected) return;
      e.visible = false; e._collected = true;
      game.state.score = (game.state.score || 0) + Number(o.points || 1);
      game.burst(e.position, { color: e.color || '#f4c430', count: 24 });
      if (o.sound && game.hasAsset(o.sound)) game.sound(o.sound);
      game.ui.text('_score', `★ ${game.state.score}`, { x: 'right', size: 26 });
      if (e.sceneId) game.net.send('_collect', { id: e.sceneId });
      if (o.respawn > 0) game.after(o.respawn, () => { if (e.alive) { e.visible = true; e._collected = false; } });
    },
  });

  def(['hurts', 'damage', 'lava', 'spikes'], {
    title: 'Hurts you', says: (o) => `hurts you (${o.damage} a hit)`,
    defaults: { damage: 20, every: 0.6 },
    update(e, dt, o, s, game) {
      s.cool = Math.max(0, (s.cool || 0) - dt);
      const p = game.mode === 'build' ? null : game.player;
      if (p && s.cool === 0 && e.visible && p.touching(e)) { s.cool = o.every; H.hurtPlayer(o.damage, e); game.burst(p.position, { color: '#ef4444', count: 10 }); }
    },
  });

  def(['checkpoint', 'save-point'], {
    title: 'Saves your progress', says: () => 'is a checkpoint: you come back here after falling',
    hit(e, other, o, s, game) {
      if (other !== game.player || s.done) return;
      s.done = true;
      game.checkpoint([e.x, e.bottom + e.size[1], e.z]);
      game.burst(e.position, { color: '#34d399', count: 30 });
      game.ui.message('Checkpoint', 1.2);
      e.emissive = '#1f7a4f';
    },
  });

  def(['goal', 'finish', 'win'], {
    title: 'Wins the game', says: (o) => `wins the game: "${o.message}"`,
    defaults: { message: 'You win!' },
    hit(e, other, o, s, game) {
      if (other !== game.player || s.done) return;
      s.done = true;
      game.burst(e.position, { color: '#f4c430', count: 60 });
      if (game.mode === 'build') { game.ui.message(`${o.message} (in the game this ends it)`, 2.5); game.after(3, () => { s.done = false; }); }
      else game.over(o.message);
    },
  });

  // `to`: where it throws you (a thing's id or [x, y, z]): up at `power` and across, landing there (the walking player
  // keeps that momentum in the air, steering a little). Without it, straight up.
  /** The sideways speed that lands something thrown up at `vy` from `from` on `to`, under the world's gravity. */
  function across(from, to, vy, game) {
    const g = Math.abs(game.config.gravity ?? 24);
    const dh = to[1] - from[1];
    const disc = vy * vy - 2 * g * dh;
    if (disc < 0) return null;
    const t = (vy + Math.sqrt(disc)) / g; // (coming down onto it)
    return t > 0.05 ? [(to[0] - from[0]) / t, (to[2] - from[2]) / t] : null;
  }
  function launch(e, other, o, game) {
    other.vy = o.power; other.grounded = false; other.standing = null;
    let at = null;
    if (Array.isArray(o.to)) at = o.to.map(Number);
    else if (o.to) { const t = game.find(String(o.to)); if (t) at = [t.x, t.y + (t.half ? t.half[1] : 0), t.z]; }
    const v = at && across([other.x, other.bottom ?? other.y, other.z], at, o.power, game);
    if (v) { other.vx = v[0]; other.vz = v[1]; other._flung = { vx: v[0], vz: v[1] }; }
    other.wake();
  }
  def(['launch', 'jump-pad', 'launch-pad', 'trampoline'], {
    title: 'Launches you up', says: (o) => (o.to ? `launches you up (${o.power} m/s) and over to ${Array.isArray(o.to) ? o.to.join(', ') : o.to}` : `launches you up (${o.power} m/s)`),
    defaults: { power: 18 },
    hit(e, other, o, s, game) {
      if (other.physics !== 'dynamic') return;
      launch(e, other, o, game);
      game.burst([other.x, other.bottom, other.z], { color: '#22d3ee', count: 16 });
    },
    update(e, dt, o, s, game) {
      // Touching from above while standing on it counts too.
      const p = game.player;
      if (p && p.standing === e && p.vy <= 0) launch(e, p, o, game);
    },
  });

  def(['opens', 'door'], { // ('gate' is gameplay.js's race ring)
    title: 'Opens when you come close', says: (o) => `opens (rises ${o.height} m) when someone comes within ${o.distance} m`,
    defaults: { height: 3, distance: 4, speed: 3 },
    start(e, o, s) { s.y = home(e)[1]; s.k = 0; },
    update(e, dt, o, s, game) {
      if (e.held) return;
      const p = game.nearest('player', e);
      const want = p && p.distanceTo(e) < o.distance ? 1 : 0;
      s.k += Math.sign(want - s.k) * Math.min(Math.abs(want - s.k), dt * o.speed / Math.max(0.1, o.height));
      e.node.position.y = s.y + s.k * o.height;
    },
  });

  def(['glow', 'pulse'], {
    title: 'Glows', says: (o) => `glows ${o.color}`,
    defaults: { color: '#4a9eff', speed: 1.5 },
    update(e, dt, o, s, game) {
      if (!e._mat || !e.ownMaterial()) return; // its own material: things that look alike share one
      const k = 0.55 + 0.45 * Math.sin(game.now * o.speed * Math.PI);
      const c = game.BABYLON.Color3.FromHexString(/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#4a9eff');
      e._mat.emissiveColor = c.scale(k);
    },
  });

  def(['talks', 'says', 'sign'], {
    title: 'Says something when you come close', says: (o) => `says "${o.text}"`,
    defaults: { text: 'Hello!', distance: 4 },
    update(e, dt, o, s, game) {
      const p = game.player;
      const near = p && p.distanceTo(e) < o.distance;
      if (near && !s.near) e.say(o.text, 4);
      s.near = near;
    },
  });

  def(['spawner', 'spawns'], {
    title: 'Makes copies', says: (o) => `makes a copy of ${o.of || 'itself'} every ${o.every} s (up to ${o.max})`,
    defaults: { every: 3, max: 8, of: null, spread: 1.5 },
    start(e, o, s) { s.t = 0; s.made = []; },
    update(e, dt, o, s, game) {
      if (!game.net.isHost) return;
      s.t += dt;
      s.made = s.made.filter((x) => x.alive);
      if (s.t < o.every || s.made.length >= o.max) return;
      s.t = 0;
      const src = o.of ? H.world.graph.entities[o.of] || Object.values(H.world.graph.entities).find((x) => x.name === o.of) : e.spec; // (by id, or by name)
      if (!src) return;
      const spec = JSON.parse(JSON.stringify(src));
      spec.id = `${spec.id}~${Math.random().toString(36).slice(2, 7)}`;
      spec.behaviors = (spec.behaviors || []).filter((b) => (b.use || b.type) !== 'spawner');
      const at = [e.x + game.random(-o.spread, o.spread), e.y + e.size[1], e.z + game.random(-o.spread, o.spread)];
      spec.transform = { ...(spec.transform || {}), position: at };
      const c = H.fromSpec(spec);
      c.temporary = true; // copies live only while the game runs (never saved), and everyone playing sees them
      game.net.send('_spawn', { spec });
      s.made.push(c);
    },
    stop(e, o, s) { for (const x of s.made || []) x.destroy(); },
  });

  def(['sound', 'noise'], {
    title: 'Makes a sound when touched', says: (o) => `plays ${o.asset} when touched`,
    defaults: { asset: null },
    hit(e, other, o, s, game) { if (isPlayer(other) && o.asset && game.hasAsset(o.asset)) game.sound(o.asset); },
  });

  /** The built-ins with their plain titles, for the editor's menus. */
  H.behaviorMenu = [
    ['spin', 'Spins'], ['bob', 'Floats up and down'], ['patrol', 'Moves back and forth'], ['wander', 'Wanders around'],
    ['follow', 'Follows you'], ['look-at-player', 'Turns to face you'], ['hop', 'Keeps hopping'], ['bouncy', 'Bouncy'],
    ['collectible', 'Can be collected'], ['hurts', 'Hurts you'], ['checkpoint', 'Checkpoint'], ['goal', 'Wins the game'],
    ['launch', 'Launch pad'], ['opens', 'Opens when you come close'], ['glow', 'Glows'], ['talks', 'Says something'], ['spawner', 'Makes copies'],
  ];
})();
