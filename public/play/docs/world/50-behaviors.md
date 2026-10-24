## What things do on their own (`behaviors`)

A list of `{ "use": name, ...options }`. A thing can have several.

| use | does | options (defaults) |
|---|---|---|
| `spin` | spins | `speed` 90 (degrees a second), `axis` "y" |
| `bob` | floats up and down | `height` 0.4, `speed` 1 |
| `patrol` | moves back and forth (or along `points`) | `axis` "x", `range` 4, `speed` 1, `points` [[x,y,z], ...] |
| `wander` | wanders around where it started | `radius` 6, `speed` 2 |
| `follow` | follows the nearest player | `speed` 3, `distance` 1.5, `range` 30 |
| `look-at-player` | turns to face the nearest player | |
| `hop` | keeps hopping (needs `dynamic`) | `height` 1.5 |
| `bouncy` | bounces when it lands (needs `dynamic`) | `amount` 0.8 |
| `collectible` | players collect it (a score); everyone sees it go | `points` 1, `respawn` 0 (seconds), `sound` |
| `hurts` | hurts players who touch it | `damage` 20, `every` 0.6 |
| `checkpoint` | players come back here after falling | |
| `goal` | touching it wins the game | `message` "You win!" |
| `launch` | launches whatever lands on it upward; with `to` (a thing's id or `[x, y, z]`) it throws you over to land there (a launch pad up to a tower) | `power` 18, `to` none |
| `opens` | rises out of the way when someone comes close (a door) | `height` 3, `distance` 4, `speed` 3 |
| `glow` | glows and pulses | `color`, `speed` 1.5 |
| `talks` | says something when you come close | `text`, `distance` 4 |
| `spawner` | makes copies of itself (or of `of`, a thing's id) | `every` 3, `max` 8, `spread` 1.5 |
| `sound` | plays a sound when touched | `asset` |
| `health` | can be hurt and destroyed (and come back after `respawn` seconds) | `hp` 100, `respawn` 0 |
| `enemy` | an enemy that thinks: wanders, notices players it can see, chases, keeps its distance, strafes, shoots (or hits up close), retreats when hurt, searches where it last saw you. Its eye shows its mood (green, amber, red). Needs nothing else; give it a body like a capsule | `hp` 60, `speed` 3.4, `sight` 30, `range` 14, `damage` 7, `rate` 1.4, `accuracy` 0.7, `melee` false |
| `pickup` | players pick it up by walking into it | `gives` "health" / "ammo" / "weapon", `amount` 25, `weapon` "shotgun", `respawn` 15 |
| `gate` | a ring to go through (for races): points, and lights up the next one | `points` 100, `next` (the next gate's id) |

**Making a shooter:** give the player a `weapon` (config.player), give bodies the `enemy` behavior, put a `spawner`
(`of`: the enemy's id) on a pad to send more, scatter `pickup`s, and keep score in a script with
`game.on('kill', ...)`. That is how Bot Arena is made. **A race:** `mode: "flight"` (or walking), `gate` rings joined by
`next`, and a `waypoint` with the role "finish". **A strategy game:** `view: "rts"` and `game.input.pick()` in a
script to see what was clicked.

A game can add its own: a file in `behaviors/` that calls `game.behavior('name', { start, update, hit, stop })`
(each gets `(thing, ..., options, memory, game)`), then any thing can use `{ "use": "name" }`. Saving the file
updates the running game without a reload.

