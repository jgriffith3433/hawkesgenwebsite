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
| `game.player.tool` | What the player holds: a gun (`'rifle'`, or `{ type: 'rifle', damage: 20 }`) or a module's tool. `weapon` is the same. |
| `game.player.control(mode, options)` | Switches how the player moves: `'walk'`, `'flight'`, or a module's (driving, swimming). `game.player.controller` is the current one. |
