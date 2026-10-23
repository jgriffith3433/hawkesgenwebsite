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

