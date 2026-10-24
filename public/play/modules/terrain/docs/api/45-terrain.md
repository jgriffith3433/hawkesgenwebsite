## Terrain (`game.terrain`)

When the world has `config.terrain` (WORLD.md "Terrain"), `game.terrain` reads and reshapes the ground. (Without one,
`game.terrain.active` is false and reads give null.) Modules use the same thing as `HawkesPlay.terrain`.

| Call | What |
|---|---|
| `game.terrain.heightAt(x, z)` | The ground's height (world y) there, or null off the terrain. |
| `game.terrain.normalAt(x, z)` / `slopeAt(x, z)` | The ground's up direction `[nx, ny, nz]` / its steepness in degrees. |
| `game.terrain.materialAt(x, z)` | `'grass'`, `'dirt'`, `'rock'`, `'snow'` or `'sand'`. |
| `game.terrain.place(thing, lift = 0)` | Puts a thing on the ground below it (and returns the height). |
| `game.terrain.randomPoint({ near: [x, z], radius, maxSlope: 30 })` | A spot on dry, walkable ground `[x, y, z]` (spawn animals over the hills). |
| `game.terrain.dig(x, z, radius = 3, depth = 2, { pile, share })` | A hole (flat bottom from radius 4). `dig(x, z, 20, 15)` is a giant one. `pile: true` heaps the dirt beside it. |
| `game.terrain.raise / lower(x, z, radius, meters)` | A smooth bump or dip. |
| `game.terrain.flatten(x, z, radius, height?)` | Levels the ground (at `height`, or the height in the middle): a building site, a landing pad. |
| `game.terrain.smooth(x, z, radius, strength = 0.6)` | Softens bumps. |
| `game.terrain.paint(x, z, radius, 'dirt')` | Paints a layer: `grass`, `dirt` (roads, paths), `rock`, `snow`, `sand`, or `erase`. |
| `game.terrain.crater(x, z, radius, depth?)` | A crater with a rim, scorched, and the trees in it gone. |
| `game.terrain.mountain(x, z, { radius, height, road })`, `hill(x, z, radius, height)` | Adds a shape to the live world. |
| `game.terrain.road` | The mountain road: `[x, z]` points from its foot to the top (shape `mountain`). |
| `game.terrain.info` | `{ center, size, min, max, shape, cell }`. |
| `game.on('terrain', ({ edits, box }) => ...)` | The ground changed (dug, cratered, brushed). |

**Who sees an edit.** Scripts run on every player's machine, so an edit a script makes at the start (or on a shared
event) happens everywhere by itself. An edit from one player's action (a key, a click) needs `{ share: true }` as the
last argument so everyone gets it: `game.terrain.dig(x, z, 3, 2, { share: true })`. The shovel and explosions share
theirs already. Script edits aren't saved in the world (they're part of playing); stamps and brush strokes are.

**Explosions** (`game.emit('explosion', { at: [x, y, z], radius, force })`, which the Mayhem module sends) leave a
crater sized by the radius, unless `config.terrain.craters` is false or the blast was high in the air.

**The shovel** is a tool: `game.player.tool = 'shovel'` (or `{ type: 'shovel', radius: 2.5, depth: 1.2 }` for a big
one). Click digs where you look and throws the dirt beside the hole; shift+click (or R) piles dirt; holding G or R keeps going. On a
phone: hold the Dig and Pile buttons.

```js
// Dig a giant hole in front of the player when they press H, for everyone.
game.input.onKey('h', () => {
  const p = game.player, f = p.forward;
  game.terrain.dig(p.x + f.x * 25, p.z + f.z * 25, 20, 15, { share: true });
});

// 30 sheep on the hills (keep them off steep ground and out of the sea).
for (let i = 0; i < 30; i++) {
  const at = game.terrain.randomPoint({ near: [0, 0], radius: 120, maxSlope: 25 });
  if (at) game.box({ x: at[0], y: at[1] + 0.6, z: at[2], size: [1.2, 1, 0.8], color: '#f4f1ea', physics: 'dynamic', tag: 'sheep' });
}

// A flag on the summit of the mountain road.
const top = game.terrain.road.at(-1);
game.cylinder({ x: top[0], z: top[1], y: game.terrain.heightAt(top[0], top[1]) + 2, radius: 0.08, height: 4, color: '#dddddd' });
```

For modules: `HawkesPlay.terrain` is the same object (`heightAt`, `normalAt`, `dig` are the shared contract), plus
`field` (the heights, read only), `core` (the math), and `entity` (the ground's thing). The ground is one static
Havok heightfield body (tree trunks a second one), rebuilt at most four times a second after edits.
