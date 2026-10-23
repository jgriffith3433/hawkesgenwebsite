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
| `game.input.pick()` | What's under the mouse (or the crosshair): `{ entity, point }` or null. For clicking on things: strategy games, building, shops. |
| `game.input.onKey(key, fn)` | Calls fn when the key goes down. |

On phones there is a stick, dragging looks around, and two buttons: **⤒** is `space` and **B** is `e`.

