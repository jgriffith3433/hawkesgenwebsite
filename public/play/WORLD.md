# The world (scene.json)

A game's world is `scene.json`: settings, and a list of **things**. The editor changes it as you build (grab, drop,
the cards, the hotbar, undo), and so does the assistant. Every change is saved and shows up for everyone in the game
at once. Scripts (API.md) run on top of the world and can find its things with `game.entity(id)` or `game.find(name)`.

```json
{
  "config": { "background": "#9fd3f0", "ambient": 0.7, "sun": 0.9, "gravity": -24, "fog": null },
  "entities": {
    "crate_1": {
      "type": "box", "name": "Crate",
      "transform": { "position": [2, 0.5, 4], "rotation": [0, 30, 0], "scale": [1, 1, 1] },
      "shape": { "size": [1, 1, 1] },
      "material": { "color": "#b07a45" },
      "physics": "dynamic", "body": { "bounce": 0.2 },
      "behaviors": [{ "use": "spin", "speed": 45 }]
    }
  }
}
```

Units are meters, seconds and degrees. +y is up. A thing's position is its center.

## Kinds of things (`type`)

| type | what it is | `shape` |
|---|---|---|
| `box` | a block: floors, walls, crates, platforms | `size: [w, h, d]` or a number |
| `sphere` | a ball | `radius` |
| `cylinder` | a pillar, a coin (thin), a barrel | `radius`, `height` |
| `cone` | a cone, a spike, a tree top | `radius`, `height` |
| `capsule` | a pill: bodies for characters | `radius`, `height` |
| `torus` | a ring | `radius`, `thickness` |
| `plane` | flat ground | `width`, `depth` |
| `model` | a 3D model (.glb) | `asset` (its name in the game's assets), `size` (height in meters) |
| `sprite` | a picture that faces you | `image` (asset name), `size`, `frames: { cols, rows }` |
| `text` | a floating sign | `text`, `size` (letter height) |
| `light` | a light (also: `light: { type: point / spot / sun, color, intensity, range }`) | |
| `video` | a screen playing a video asset (muted until clicked) | `asset`, `width`, `height` (default 16:9), `loop` |
| `mirror` | a framed mirror | `width`, `height` |
| `spawn` | where players start (`data.role`, default "player"); invisible when playing | |
| `waypoint` | a glowing orb over a ring: `data.role` "waypoint" (a stop on a route), "checkpoint" (players come back here after falling), "finish" (wins, `data.message`) or "start"; `data.next` is the next one's id (a dotted line shows the way). Players reach it by coming within `shape.radius` | `radius` (1.6) |
| `trigger` | an invisible zone things can enter | `size` |

A `model` whose asset doesn't exist yet shows as a wireframe and appears by itself once the asset is made.

## How the player plays (`config.player`)

Every game has a player. How it plays is in the world's settings, so the assistant can change it when someone says
"let me fly", "jump higher", "I want to see my character" or "make it a top-down game":

```json
{ "op": "config", "patch": { "player": { "view": "third", "jump": 3, "fly": true, "doubleJump": true, "speed": 8 } } }
```

| setting | what | default |
|---|---|---|
| `view` | `"first"` (through your eyes), `"third"` (behind you: you see your character), `"top"` (from above), `"rts"` (a commander's camera over the map: WASD pans, wheel zooms, right-drag turns, the mouse stays free to click things) | first |
| `mode` | `"walk"`, or `"flight"`: always moving forward, steered by the mouse (or WASD), space boosts | walk |
| `mouse` | `"free"` never captures the mouse (point-and-click games, strategy, menus); `"locked"` captures it when you click | locked |
| `weapon` | what you carry: `"blaster"`, `"rifle"`, `"shotgun"`, `"launcher"`, or `{ "type": "rifle", "damage": 20, "rate": 8, "ammo": 30, "reload": 1.5, "range": 100, "spread": 0.01, "pellets": 1, "color": "#ffd24a" }`. Click to fire, R reloads | none |
| `distance` | how far the camera is in third person (or how high, top-down) | 5 / 18 |
| `speed` | walking speed in m/s (shift runs 1.6x) | 6 |
| `jump` | jump height in meters | 1.5 |
| `doubleJump` | a second jump in the air | false |
| `fly` | double-tap space (or F) to fly while playing (building always can) | false |
| `gravity` | 1 normal, 0.5 moon, 0 floating | 1 |

Scripts can also change them while playing: `game.player.view = 'third'`, `game.player.jumpHeight = 3`,
`game.player.canFly = true`. Checkpoints are `waypoint` things with the role "checkpoint", not invisible boxes.

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
| `launch` | launches whatever lands on it upward | `power` 18 |
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

## Changes (ops)

The editor and the assistant change the world with ops:

- `{ "op": "create", "entity": { "id": "lamp_2", "type": "light", ... } }` (an id is made from the name if missing)
- `{ "op": "update", "id": "crate_1", "patch": { "physics": "dynamic", "material": { "color": "#ff0000" } } }`
  (objects merge, lists and values replace, `null` removes a field)
- `{ "op": "replace", "entity": { ...the whole thing... } }`
- `{ "op": "delete", "id": "crate_1" }` (things whose `parent` it was go too)
- `{ "op": "config", "patch": { "background": "#101018", "fog": { "start": 20, "end": 80 } } }`
