## How it moves (`physics`)

| physics | in plain words |
|---|---|
| `static` | stays put. Solid. Floors, walls, platforms. The default for shapes and models. |
| `dynamic` | falls, can be pushed, picked up and thrown. Crates, balls, loose things. |
| `kinematic` | solid, and moves only by itself (a behavior or a script): moving platforms, doors. |
| `trigger` | you go through it, and it notices (coins, goals, zones). |
| `none` | decoration: nothing bumps into it. |

`body` fine-tunes a moving thing: `bounce` (0 to 0.95), `friction` (0 to 1, default 0.6), `mass` (default 1),
`grab: false` (players can't pick it up). Players stand on anything solid and ride along on things that move.
Anything that falls out of the world comes back where it was (players go back to their start or last checkpoint).

Physics is real: dynamic things tumble, roll, stack and topple; walkers (capsules, anything with a walking behavior)
stay upright; players walk up slopes and stairs and ride whatever they stand on. `body` also takes `upright: true`
(never tips over), `shape` (`"box"`, `"sphere"`, `"capsule"`, `"cylinder"`, `"convex"`, `"mesh"`; default `"auto"`,
the thing's own shape) and `layer` / `collides` (which things hit which). `"instanced": true` on a thing makes many
copies of the same shape cheap.

