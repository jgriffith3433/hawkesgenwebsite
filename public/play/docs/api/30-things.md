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


**Many at once:** `game.many(100, (i) => ({ type: 'box', size: 0.8, x: i % 10, z: Math.floor(i / 10), y: 3, physics: 'dynamic', color: '#ffffff' }))`
makes copies of one mesh (cheap: one draw call for all of them), each with its own position, color and physics. Use
it for herds, piles, crowds and debris. A world keeps itself playable: past a few thousand things the oldest ones
scripts made make room, the farthest moving things rest until you come near, and only the nearest things cast
shadows (`game.json` `"budget": { "entities": 2500, "bodies": 400, "shadows": 160 }` changes the limits; phones get less).
