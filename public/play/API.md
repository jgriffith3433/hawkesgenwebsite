# Hawkes Play scripting

A game is a world (`scene.json`, see WORLD.md) plus scripts. The runtime (Babylon.js underneath) runs every `.js`
file in `behaviors/` and then `scripts/`, in name order (or the order in `game.json` `"scripts"`), with one global:
**`game`**. Scripts share data through `game.state`. Units are meters and seconds. +y is up, +z is forward,
rotations are in degrees. Saving a script updates the running game at once (no reload; the player stays put).

Every game already has a **first-person player** (WASD, mouse look, space to jump, shift to run) and catches anyone
who falls out of the world. Put the things in the world with scene.json; use scripts for the rules (scores, timers,
waves, winning) and for things that come and go.

## game.json (optional)

```json
{
  "background": "#9fd3f0",
  "gravity": -24,
  "ambient": 0.7,
  "sun": 0.9,
  "shadows": true,
  "pixelated": false,
  "fog": { "color": "#9fd3f0", "start": 40, "end": 120 },
  "look": true,
  "sky": true,
  "player": true,
  "controls": true,
  "ui": { "font": "Georgia, serif", "accent": "#f4c430", "panel": "rgba(30,20,10,.85)", "radius": 4 },
  "scripts": ["scripts/world.js", "scripts/player.js"]
}
```

Everything is optional. `"lights": false` turns off the default sky light and sun; `"look": false` the game look
(glow, vignette, filmic color); `"sky": false` the gradient sky; `"player": false` the built-in player (make your
own camera); `"controls": false` keeps the player but lets your scripts move it. `"ui"` themes every screen the game
makes (below).

## Lifecycle

| Call | What |
|---|---|
| `game.onStart(fn)` | After every script has run. |
| `game.onUpdate((dt, time) => {})` | Every step (60 a second). `dt` is seconds since the last one. |
| `game.after(seconds, fn)` | Once, later. Returns a function that cancels it. |
| `game.every(seconds, fn)` | Repeats. Returns a function that cancels it. |
| `game.time` | Seconds since the start (stops while paused). |
| `game.now` | Seconds on a clock every player shares: use it for things that must line up between players. |
| `game.pause()`, `game.resume()`, `game.paused` | Pause: updates, timers and physics stop. |
| `game.restart()` | Starts the game over (the world as built, the scripts again). |
| `game.over(text?)` | Pauses and shows a message with a Play again button. |
| `game.mode` | `'build'` in the editor while building, `'play'` when playing. |
| `game.state` | A plain object for your data. Empty after a restart. |
| `game.save(key, value)`, `game.load(key, fallback)` | Kept across restarts while the page is open. |

## The player

`game.player` is you: a capsule, 1.8 m tall, that walks, jumps, flies while building and is caught if it falls.

| | What |
|---|---|
| `game.player.health` | 0 to 100. At 0 the player goes back to the start. `game.hurt(amount)` takes some. |
| `game.player.controls` | `false` stops the built-in walking (move it yourself with `walk`, `move`, `velocity`). |
| `game.player.gravity` | `0` floats, `1` normal, `0.5` moon jump. |
| `game.player.flying` | True while flying. |
| `game.player.view` | `'first'`, `'third'` (see your character) or `'top'`. Settable. |
| `game.player.speed`, `.jumpHeight`, `.doubleJump`, `.canFly` | Walking speed, jump height in meters, a second jump in the air, flying while playing. (The world's `config.player` sets the start values: WORLD.md.) |
| `game.state.waypoints` | How many waypoints (things with `data.role` "waypoint") the player has reached. |
| `game.spawn(role = 'player')` | Puts the player on a spawn point (a `spawn` thing with that `data.role` or tag) and returns them. |
| `game.respawn()` | Back to the start (or the last checkpoint). `game.checkpoint([x, y, z])` sets where. |

## Things from the world

`game.entity(id)` is a thing from scene.json by its id; `game.find(name)` by name; `game.all(tag)` every thing with
that tag (or name); `game.nearest(tag, from)` the closest. They are entities (below), like the ones scripts make.

## Making things

Every maker returns an **entity**. Things made by scripts last while the game runs (they aren't saved in the world).

```js
const crate = game.box({ size: 1, y: 3, color: '#b07a45', physics: 'dynamic' });
const coin = game.cylinder({ x: 3, y: 1, radius: 0.4, height: 0.1, rotation: [90, 0, 0], color: '#f4c430', physics: 'trigger', tag: 'coin' });
const tree = game.model('tree.glb', { x: -4, size: 3 });      // an asset; size = height in meters
const hero = game.sprite('hero.png', { y: 1, size: 2 });        // a 2D image that faces the camera
const sign = game.text('Danger!', { y: 2, size: 0.4 });         // floating words
```

| Maker | Shape options |
|---|---|
| `game.box(opts)` | `size: [w, h, d]` or a number |
| `game.sphere(opts)` | `radius` |
| `game.capsule(opts)` | `radius`, `height` |
| `game.cylinder(opts)` | `radius`, `height` |
| `game.cone(opts)` | `radius`, `height` |
| `game.torus(opts)` | `radius`, `thickness` |
| `game.plane(opts)` | `size: [w, d]`: flat on the ground |
| `game.model(name, opts)` | A `.glb` asset. `size` scales it to that height. `entity.ready` is a promise. |
| `game.sprite(name, opts)` | An image asset. `size` is its height. `frames: { cols, rows }` for a sprite sheet. |
| `game.text(words, opts)` | `size` (letter height), `color`, `billboard: false` keeps it flat |
| `game.light(opts)` | `type: 'point' / 'spot' / 'sun'`, `color`, `intensity`, `range`, `position` |

Options every maker takes: `x, y, z` (or `position: [x, y, z]`), `rotation` (degrees around y, or `[x, y, z]`),
`scale`, `color: '#rrggbb'`, `texture: 'name.png'` with `tile: [u, v]`, `emissive: '#rrggbb'` (glows), `opacity`,
`physics`, `bounce`, `friction`, `mass`, `tag`, `name`, `shadow` (default true), `visible`, `data` (your fields).

**physics:** `'static'` (stays put, solid; the default), `'dynamic'` (falls, bounces, gets pushed and thrown),
`'kinematic'` (solid, moves only when you move it; things on it ride along), `'trigger'` (not solid, reports `hit`),
`'none'` (decoration). Colliders are boxes around the shape.

## Entities

| Property / method | What |
|---|---|
| `e.x, e.y, e.z`, `e.position` (`[x, y, z]`) | Where it is (its center). Settable. |
| `e.rotation` | Turn around y in degrees. Settable. `e.turn(degrees)` adds; `e.rotate(x, y, z)` adds on every axis. |
| `e.scale`, `e.size` | Scale (settable); size in meters `[w, h, d]`. |
| `e.vx, e.vy, e.vz`, `e.velocity` | Velocity (dynamic things use it every step). `e.push([x, y, z])` adds to it. |
| `e.move(dx, dy, dz)` | Moves by that much, stopping at solid things. |
| `e.walk(direction, speed)` | Sets horizontal velocity from a direction (`{x, z}`, e.g. `game.input.direction()`) and turns to face it. |
| `e.jump(speed)` | Jumps if it is standing on something. Returns true if it jumped. |
| `e.grounded`, `e.standing` | Standing on something; the thing it stands on. |
| `e.lookAt(target)`, `e.forward`, `e.distanceTo(other)` | Facing, the way it faces (`{x, z}`), meters to another. |
| `e.touching(tagOrEntity)` | True if it is touching one. |
| `e.on('hit', other => {})`, `e.on('leave', other => {})`, `e.on('click', point => {})` | Touch starts, ends; clicked or tapped. |
| `e.color`, `e.emissive`, `e.opacity`, `e.visible` | Settable. |
| `e.say(text, seconds)` | A speech bubble over it. |
| `e.play(name, loop)` | Plays a model's animation (`e.animations` lists them). `e.animate(from, to, fps)` plays sprite frames. |
| `e.destroy()`, `e.alive` | Removes it. |
| `e.tag`, `e.name`, `e.data`, `e.sceneId` | Labels, your fields, its id in scene.json (if it came from there). |
| `e.mesh` | The Babylon node, for anything not covered here. |

## Behaviors of your own

A file in `behaviors/` defines one; any thing in the world can then use it with `{ "use": "name", ...options }`
(see WORLD.md for the built-in ones). Each function gets `(thing, ..., options, memory, game)`; `memory` is that
thing's own scratch object.

```js
// behaviors/wobble.js
game.behavior('wobble', {
  defaults: { amount: 10, speed: 3 },
  update(thing, dt, o, memory, game) { thing.node.rotation.z = Math.sin(game.now * o.speed) * o.amount * Math.PI / 180; },
  hit(thing, other, o, memory, game) { if (other === game.player) thing.say('Hey!'); },
});
```

`start(thing, o, memory, game)` runs once, `update(thing, dt, ...)` every step, `hit(thing, other, ...)` on touch,
`stop(thing, ...)` when it goes.

## Looking, aiming, hitting

`game.raycast(from, direction, distance)` is the first thing a ray hits: `{ entity, point, distance, normal }` or
null. `game.aim(distance)` is what the crosshair is on. `game.camera.forward` and `game.camera.position` are the view.

## Camera

The player's camera is first person. For other kinds of games:

| Call | What |
|---|---|
| `game.camera.follow(entity, { distance: 10, height: 5, behind: false, smooth: 0.1 })` | Follows from a fixed angle, or from behind it. |
| `game.camera.firstPerson(entity, { height })` | Mouse look from an entity (`height` from its feet for the player). |
| `game.camera.orbit(target, { distance: 12 })` | Drag to look around a point or an entity. |
| `game.camera.topDown(entity, { height: 18 })` | Straight down from above. |
| `game.camera.fixed([x, y, z], [lookX, lookY, lookZ])` | Stays put. |
| `game.camera.shake(strength = 0.3, seconds = 0.3)` | Shakes. |

## Input

| Call | What |
|---|---|
| `game.input.key('w')` | Held down. Names: letters, digits, `space`, `shift`, `enter`, `escape`, `arrowup`... |
| `game.input.pressed('space')` | Went down this step. `game.input.released(k)`: went up. |
| `game.input.axis()` | `{x, y}` from WASD, the arrows or the touch stick, each -1 to 1. |
| `game.input.direction()` | `{x, z}`: the same, turned to match the camera. Feed it to `walk`. |
| `game.input.mouse` | `{x, y, down, pressed}` in pixels. |
| `game.input.onKey(key, fn)` | Calls fn when the key goes down. |

On phones there is a stick, dragging looks around, and two buttons: **⤒** is `space` and **B** is `e`.

## Screens: text, bars, menus, popups

Everything a game puts on the screen. Theme it all with `game.ui.theme({ font, color, accent, panel, border, radius,
blur })` (or `"ui"` in game.json), and add your own CSS with `game.ui.style(css)` for classes you pass as `class`.

| Call | What |
|---|---|
| `game.ui.text(id, text, { x: 'left', y: 'top', size: 22, color })` | A line of text. `x`: left, center, right. `y`: top, middle, bottom. |
| `game.ui.bar(id, value, { label, color, x, y })` | A bar from 0 to 1 (health, time). |
| `game.ui.button(id, label, fn, { x, y })` | A button. |
| `game.ui.message(text, seconds = 2)` | A big message in the middle. |
| `game.ui.panel(id, { title, text or html, buttons: [{ label, onClick }], x, y, width, closable, class })` | A box on screen: an inventory, a quest log, a shop. Returns `{ close, update }`. |
| `game.ui.menu(id, { title, text, items: [{ label, onClick, primary }], pause, closable, class })` | A menu over the game: a pause menu, a level select. It pauses the game (unless `pause: false`); arrows and Enter work. |
| `await game.ui.popup(text, { title, buttons: ['Yes', 'No'] })` | A question; resolves to the label picked. |
| `await game.ui.ask(question, { placeholder })` | Asks for words; resolves to what they typed (or null). |
| `game.ui.attach(id, entity, { text or html, offset })` | A label that stays on a thing in the world (names, health, prices). |
| `game.ui.html(id, html, { x, y, class })` | Your own HTML, for anything else. `game.ui.el(id)` is its element. |
| `game.ui.remove(id)`, `game.ui.clear()` | Removes them. |

```js
// A pause menu on P, in the game's own style.
game.ui.theme({ font: '"Trebuchet MS", sans-serif', accent: '#ff7a1a', panel: 'rgba(20,12,4,.9)', radius: 2 });
game.input.onKey('p', () => game.ui.menu('pause', {
  title: 'Paused',
  items: [
    { label: 'Resume', primary: true },
    { label: 'Restart', onClick: () => game.restart() },
  ],
}));

// A shopkeeper who asks before selling.
const shop = game.find('Shopkeeper');
game.ui.attach('shop_label', shop, { text: 'Shop' });
shop.on('click', async () => {
  const pick = await game.ui.popup('A sword for 10 coins?', { title: 'Shop', buttons: ['Buy', 'No thanks'] });
  if (pick === 'Buy' && (game.state.score || 0) >= 10) { game.state.score -= 10; game.ui.message('Sold!'); }
});
```

## Sound

`game.sound('jump.mp3', { volume: 1 })` plays once. `game.music('theme.mp3', { volume: 0.5 })` loops;
`game.stopMusic()`. Sound starts after the player's first click or key (browsers require it).

## Look and effects

`game.sky('#9fd3f0')` sets the sky color; `game.sky('sky.jpg')` puts a panorama image around the world.
`game.burst([x, y, z], { color: '#ffcc00', count: 30, size: 0.2, speed: 4 })` throws out sparks.

## Playing together

Everyone in a game runs the scripts. Things in the world, players and what they hold are kept in step for you; for
anything else your scripts decide, tell the others:

| Call | What |
|---|---|
| `game.net.send(name, data)` | Tells everyone else. `game.net.everyone(name, data)` includes you. |
| `game.net.on(name, (data, from) => {})` | Hears it. Also `'join'` and `'leave'` (`{ id, name }`). |
| `game.net.isHost` | True for one player (the one who simulates the world): spawn shared enemies here. |
| `game.net.players` | The others: `[{ id, name, color, entity }]`. `game.net.me`, `game.net.online`. |

## Helpers

`game.random(min, max)`, `game.randomInt(min, max)`, `game.pick(array)`, `game.clamp(v, min, max)`,
`game.lerp(a, b, t)`, `game.asset(name)` (an asset's URL), `game.hasAsset(name)`, `game.log(...)` (prints in the
editor). `game.scene`, `game.engine` and `game.BABYLON` are Babylon itself, for anything else.

## A whole game (rules on top of a world)

```js
// scripts/main.js: the world has coins (behaviors: collectible) and a door with the "opens" behavior.
game.state.score = 0;
game.ui.text('goal', 'Collect 5 coins to open the gate', { x: 'center', y: 'top' });
game.onUpdate(() => {
  game.ui.bar('hp', game.player.health / 100, { label: 'Health', y: 'bottom' });
  if (game.state.score >= 5 && !game.state.open) {
    game.state.open = true;
    game.entity('gate').destroy();
    game.ui.message('The gate is open!');
  }
});
```
