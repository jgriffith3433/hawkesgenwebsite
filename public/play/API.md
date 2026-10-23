# Hawkes Play scripting

A game is a few script files plus assets. The runtime (Babylon.js underneath) runs every `.js` file under
`scripts/` once, in name order (or the order in `game.json` `"scripts"`), with one global: **`game`**. Scripts
share data through `game.state` (or top-level variables on `window`). Units are meters and seconds. +y is up,
+z is forward, rotations are in degrees.

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
  "scripts": ["scripts/world.js", "scripts/player.js"]
}
```

Everything is optional. `"lights": false` turns off the default light (a sky light and a sun).

## Lifecycle

| Call | What |
|---|---|
| `game.onStart(fn)` | After every script has run. Build the level here or at top level. |
| `game.onUpdate((dt, time) => {})` | Every frame. `dt` is seconds since the last frame (capped at 0.05). |
| `game.after(seconds, fn)` | Once, later. Returns a function that cancels it. |
| `game.every(seconds, fn)` | Repeats. Returns a function that cancels it. |
| `game.time` | Seconds since the start (stops while paused). |
| `game.pause()`, `game.resume()`, `game.paused` | Pause: updates, timers and physics stop. |
| `game.restart()` | Throws the world away and runs every script again. |
| `game.over(text?)` | Pauses and shows a message with a Play again button. |
| `game.state` | A plain object for your data. Empty after a restart. |
| `game.save(key, value)`, `game.load(key, fallback)` | Kept across restarts while the page is open. |

## Making things

Every maker returns an **entity**.

```js
const ground = game.box({ size: [40, 1, 40], y: -0.5, color: '#6a9f4b' });
const player = game.capsule({ y: 2, color: '#e07a2f', physics: 'dynamic', tag: 'player' });
const coin = game.cylinder({ x: 3, y: 1, radius: 0.4, height: 0.1, color: '#f4c430', physics: 'trigger', tag: 'coin' });
const tree = game.model('tree.glb', { x: -4, size: 3 });      // an asset; size = height in meters
const hero = game.sprite('hero.png', { y: 1, size: 2 });        // a 2D image that faces the camera
```

| Maker | Shape options |
|---|---|
| `game.box(opts)` | `size: [w, h, d]` or a number |
| `game.sphere(opts)` | `radius` |
| `game.capsule(opts)` | `radius`, `height` |
| `game.cylinder(opts)` | `radius`, `height` |
| `game.plane(opts)` | `size: [w, d]`: flat on the ground |
| `game.model(name, opts)` | A `.glb` asset. `size` scales it to that height. Loads in the background; `entity.ready` is a promise. |
| `game.sprite(name, opts)` | An image asset. `size` is its height. `frames: { cols, rows }` for a sprite sheet. `billboard: false` keeps it flat and facing +z. |

Options every maker takes: `x, y, z` (or `position: [x, y, z]`), `rotation` (degrees around y, or `[x, y, z]`),
`scale`, `color: '#rrggbb'`, `texture: 'name.png'` with `tile: [u, v]`, `emissive: '#rrggbb'` (glows; ignores light),
`opacity`, `physics`, `tag`, `name`, `shadow` (casts a shadow, default true), `visible`, `data` (your own fields).

**physics:**
- `'static'` (the default for shapes and models): solid, never moves by itself. Floors, walls, platforms.
- `'dynamic'`: falls with gravity, is pushed out of solid things, has velocity. Players, enemies, crates.
- `'kinematic'`: solid, moves only when you move it (and collides when moved with `move`). Moving platforms.
- `'trigger'`: not solid, but reports `hit`. Coins, checkpoints, danger zones.
- `'none'` (the default for sprites): decoration, no collisions.

Colliders are boxes around the shape (rotated shapes get the box around them).

## Entities

| Property / method | What |
|---|---|
| `e.x, e.y, e.z`, `e.position` (`[x, y, z]`) | Where it is (its center). Settable. |
| `e.rotation` | Turn around y in degrees. Settable. `e.turn(degrees)` adds to it. |
| `e.scale` | A number or `[x, y, z]`. Settable. |
| `e.vx, e.vy, e.vz`, `e.velocity` | Velocity (dynamic bodies use it every frame). |
| `e.move(dx, dy, dz)` | Moves by that much, stopping at solid things (for dynamic and kinematic bodies). |
| `e.walk(direction, speed)` | Sets horizontal velocity from a direction (`{x, z}` or `[x, z]`, e.g. `game.input.direction()`) and turns to face it. |
| `e.jump(speed)` | Sets `vy` if it is standing on something. Returns true if it jumped. |
| `e.grounded` | True while standing on something solid. |
| `e.lookAt(target)` | Turns to face an entity or `[x, y, z]`. |
| `e.forward` | `{x, z}`: the way it faces. |
| `e.distanceTo(other)` | Meters to an entity or `[x, y, z]`. |
| `e.touching(tagOrEntity)` | True if it is touching one. |
| `e.on('hit', other => {})` | When it starts touching something. `e.on('click', fn)` when clicked or tapped. |
| `e.color`, `e.opacity`, `e.visible` | Settable. |
| `e.play(name, loop = true)` | Plays a model's animation by name (`e.animations` lists them). |
| `e.animate(from, to, fps = 10, loop = true)` | Plays frames of a sprite sheet. `e.frame` sets one. |
| `e.flip` | Mirrors a sprite. |
| `e.destroy()`, `e.alive` | Removes it. |
| `e.tag`, `e.name`, `e.data` | Your labels and fields. |
| `e.mesh` | The Babylon node, for anything not covered here. |

Finding things: `game.find(name)`, `game.all(tag)`, `game.nearest(tag, from)`.

## Camera

| Call | What |
|---|---|
| `game.camera.follow(entity, { distance: 10, height: 5, behind: false, smooth: 0.1 })` | Follows from a fixed angle, or from behind it with `behind: true`. |
| `game.camera.firstPerson(entity, { height: 0.6 })` | Mouse look (click to capture the mouse). The entity turns with the view. |
| `game.camera.orbit(target, { distance: 12 })` | Drag to look around a point or an entity. |
| `game.camera.topDown(entity, { height: 18 })` | Straight down from above. |
| `game.camera.fixed([x, y, z], [lookX, lookY, lookZ])` | Stays put. |
| `game.camera.shake(strength = 0.3, seconds = 0.3)` | Shakes. |

## Input

| Call | What |
|---|---|
| `game.input.key('w')` | Held down. Names: letters, digits, `space`, `shift`, `enter`, `escape`, `arrowup`, `arrowdown`, `arrowleft`, `arrowright`. |
| `game.input.pressed('space')` | Went down this frame. `game.input.released(k)`: went up this frame. |
| `game.input.axis()` | `{x, y}` from WASD, the arrows or the touch stick, each -1 to 1 (y is forward). |
| `game.input.direction()` | `{x, z}`: the same, turned to match the camera. Feed it to `walk`. |
| `game.input.mouse` | `{x, y, down, pressed}` in pixels. |
| `game.input.onKey(key, fn)` | Calls fn when the key goes down. |

On phones a stick and two buttons appear: **A** is `space` and **B** is `e`.

## Screen text and buttons

| Call | What |
|---|---|
| `game.ui.text(id, text, { x: 'left', y: 'top', size: 22, color: '#fff' })` | Shows or updates a line of text. `x`: left, center, right. `y`: top, middle, bottom. |
| `game.ui.bar(id, value, { label, color, x, y })` | A bar from 0 to 1 (health, time). |
| `game.ui.button(id, label, fn, { x, y })` | A button. |
| `game.ui.message(text, seconds = 2)` | A big message in the middle. |
| `game.ui.remove(id)`, `game.ui.clear()` | Removes text, bars and buttons. |

## Sound

`game.sound('jump.mp3', { volume: 1 })` plays once. `game.music('theme.mp3', { volume: 0.5 })` loops;
`game.stopMusic()`. Sound starts after the player's first click or key (browsers require it).

## Look and effects

`game.sky('#9fd3f0')` sets the background color; `game.sky('sky.jpg')` puts a panorama image around the world.
`game.burst([x, y, z], { color: '#ffcc00', count: 30, size: 0.2, speed: 4 })` throws out sparks.
`game.light({ type: 'point', position: [0, 3, 0], color: '#ffaa55', intensity: 1, range: 10 })` adds a light.

## Helpers

`game.random(min, max)`, `game.randomInt(min, max)`, `game.pick(array)`, `game.clamp(v, min, max)`,
`game.lerp(a, b, t)`, `game.asset(name)` (an asset's URL), `game.log(...)` (prints in the editor's console).
`game.scene`, `game.engine` and `game.BABYLON` are Babylon itself, for anything else.

## A whole game

```js
// scripts/main.js
game.box({ size: [30, 1, 30], y: -0.5, color: '#6a9f4b' });
const player = game.capsule({ y: 1, color: '#e07a2f', physics: 'dynamic' });
game.camera.follow(player, { distance: 12, height: 8 });
game.state.score = 0;

for (let i = 0; i < 10; i++) {
  const coin = game.cylinder({ x: game.random(-12, 12), z: game.random(-12, 12), y: 0.8, radius: 0.4, height: 0.1, rotation: [90, 0, 0], color: '#f4c430', emissive: '#7a5a00', physics: 'trigger', tag: 'coin' });
  coin.on('hit', (other) => {
    if (other !== player) return;
    coin.destroy();
    game.burst(coin.position, { color: '#f4c430' });
    game.state.score++;
    if (game.all('coin').length === 0) game.over('You found them all!');
  });
}

game.onUpdate((dt) => {
  player.walk(game.input.direction(), 6);
  if (game.input.pressed('space')) player.jump(8);
  for (const c of game.all('coin')) c.turn(120 * dt);
  game.ui.text('score', `Coins: ${game.state.score}`);
  if (player.y < -10) game.restart();
});
```
