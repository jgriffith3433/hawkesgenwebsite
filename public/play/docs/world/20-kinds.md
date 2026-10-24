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
| `model` | a 3D model (.glb) | `asset` (its name in the game's assets), `size` (height in meters), `lod`: `{ low, distance }` (a low-detail copy shown farther than `distance` m, 25 by default; the model's own levels of detail from Gen, or a `<name>_low.glb` asset, are used by themselves) |
| `sprite` | a picture that faces you | `image` (asset name), `size`, `frames: { cols, rows, fps }` (with `fps` the sheet plays on a loop) |
| `text` | a floating sign | `text`, `size` (letter height) |
| `light` | a light (also: `light: { type: point / spot / sun, color, intensity, range }`) | |
| `video` | a screen playing a video asset (muted until clicked) | `asset`, `width`, `height` (default 16:9), `loop` |
| `mirror` | a framed mirror | `width`, `height` |
| `spawn` | where players start (`data.role`, default "player"); invisible when playing | |
| `waypoint` | a glowing orb over a ring: `data.role` "waypoint" (a stop on a route), "checkpoint" (players come back here after falling), "finish" (wins, `data.message`) or "start"; `data.next` is the next one's id (a dotted line shows the way). Players reach it by coming within `shape.radius` | `radius` (1.6) |
| `trigger` | an invisible zone things can enter | `size` |

A `model` whose asset doesn't exist yet shows as a wireframe and appears by itself once the asset is made.

