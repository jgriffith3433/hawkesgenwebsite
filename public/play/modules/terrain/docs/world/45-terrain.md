## Terrain: big ground you can drive across, dig into and reshape

`config.terrain` turns on a heightmap ground (512 m across by default): hills, a mountain with a road up it, an island,
a canyon... Things land on it, roll down it, and vehicles drive on it (it's a real heightfield collider). Players dig
it with the shovel, explosions leave craters, and the build-mode brush (the **⛰ Terrain** button) raises, lowers,
flattens, smooths and paints it. Everything works with no art; ground textures, trees and rocks pick up the game's assets by word.

**Turning it on: delete the old flat floor** (the `plane`/`box` called Ground) in the same change, or it sits on top.
Things already in the world are fine: dynamic ones land on the new ground; static ones keep their height (move them
onto the ground: the terrain's height is `game.terrain.heightAt(x, z)`).

```json
{ "op": "config", "patch": { "terrain": { "shape": "mountain", "height": 90, "seed": 2 } } }
```

| Key | What | Default |
|---|---|---|
| `shape` | `flat`, `hills`, `mountain` (one big peak 150 m ahead of the start, a road winding up it), `mountains` (a ridged range either side of a valley), `island` (land in a sea, sandy beaches), `canyon` (a deep cut 40 m ahead), `valley`, `craters` (moon-like), `dunes` (sand). Words work too: "volcano", "desert", "beach" | `hills` |
| `height` | how tall the shape is, meters (mountain 80, mountains 70, valley 45, canyon depth 30, island 22, hills 14) | per shape |
| `size` | meters across (32 to 4096); `center: [x, z]` moves it | 512, [0, 0] |
| `seed` | a number or word: another seed is another landscape of the same kind | 1 |
| `roughness` | 0 smooth to 1 rugged | 0.5 |
| `detail` | meters between height samples (smaller is finer and slower) | 1 (bigger worlds coarser) |
| `y` | the base ground level | 0 |
| `road` | `false`: no road up the mountain | true |
| `sea` | sea level (a stand-in sea is drawn until the world has `config.water`), `false` for none | 0 for island, else none |
| `snow` | the snow line height, or `false` | high peaks get snow |
| `home` | `false`: don't flatten the area around the start (0, 0) | true |
| `colors` | `{ "grass": "#5f8f3e", "dirt": ..., "rock": ..., "snow": ..., "sand": ... }` stand-in colors | |
| `textures` | `{ "grass": "<asset or /play/... url>", ... }`: image assets (ids) or local `/play/` paths per ground layer (also by word: "terrain grass"...). On islands without snow, the `snow` slot is **wet sand** below the tide (footsteps still say `sand`) | |
| `maps` | `{ "grass": { "normal": "<url>" }, ... }`: optional normal maps per layer for bumps in the light | |
| `macro` | `{ "tile": 56 }` large-scale tint so tiling does not read from the air, or `false` | on when textures are set |
| `splat` | `{ "triplanar": true, "detailNear": 8, "detailFar": 36, "force": true }`: distance detail blend; cliff triplanar (desktop only; phones skip it) | |
| `tile` | meters one texture repeat covers | 4 |
| `scatter` | `{ "trees": 260, "rocks": 120, "bushes": 220, "seed": 3, "models": { "tree": "<asset>", "rock": "<asset>" } }` or `false`. Models also by word: "terrain tree"/"tree", "terrain rock"/"rock", "terrain bush"/"bush" (`config.assets.tree` picks which one). Scatter draws that one model hundreds of times from its lowest level of detail (Gen's), so keep counts in the hundreds | by shape |
| `add` | extra shapes placed on top: `[{ "type": "mountain", "at": [x, z], "radius": 100, "height": 60, "road": true }]`. Types: `mountain`, `volcano`, `hill`, `plateau` (`height`), `crater`, `hole`, `lake` (a bowl, `depth`), `flat` (level an area at `height`), `ridge` (`at`, `to`, `width`, `height`) | |
| `edits` | the brush's strokes, in order (the editor writes these): `[op, radius, amount, x1, z1, x2, z2, ...]`, op one of `raise`, `lower`, `dig`, `hole`, `crater` (amount = depth), `flatten` (amount = height), `smooth` (0-1), `paint` (0 grass, 1 dirt, 2 rock, 3 snow, 4 sand, -1 erase) | |
| `craters` | `false`: explosions don't mark the ground | true |

Ground layers blend by themselves: grass inland, dirt on mid slopes and painted roads, rock on cliffs above ~35°,
snow up high (or **wet sand** below the tide on sea islands), dry sand on the shore. Roads and dug holes are painted
dirt. Footstep surface names stay `grass` / `dirt` / `rock`→`stone` / `sand` / `wood`. The terrain's own thing is
`game.terrain.entity` (tag `terrain`): rays and the crosshair hit it, so `hit.entity.isTerrain` tells you it's the ground.

Playing together: what players dig, and craters, are shared (the host decides, late joiners catch up). Brush strokes
are saved in the game. The terrain should be about 120 KB of edits at most (the brush says how full it is).

**Examples in words** (what to do):
- **A world that already has a flat ground** (the Playground's "Ground" plane, a big floor box): turning terrain on hides
  it while the terrain is on (nothing stands on it; it comes back when terrain is turned off), and the player and loose
  things below the new ground are put on top of it. Leave it, or delete it to be rid of it for good; never move it.
  Things standing on it (steps, buildings) stay where they are: move them onto the terrain if they're buried.
- "make an island with a beach": `config` patch `{ "terrain": { "shape": "island" } }`.
- On a round planet (`config.planet.sphere`) the terrain stands on the planet at its `center` and follows the ball's
  curve, and its edges ease down to the planet's ground (an ocean planet's seabed: Overseer "An ocean planet"), so an
  `island` there is an island in the planet's ocean. Positions on it are the planet's, as for every thing.
  Add `"water": {...}` too if the world has the Water module, for real waves; the terrain draws a plain sea otherwise.
- "spawn a mountain and a 4x4 so I can drive up it": `{ "terrain": { "shape": "mountain" } }`,
  then the 4x4 at the foot of the road: the road starts near (0, 0) and winds up the mountain ahead (+z). A script can
  read it: `game.terrain.road` (points from the foot to the top).
- "put a mountain over there" (world already has terrain): add `{ "type": "mountain", "at": [x, z], "radius": 80,
  "height": 60 }` to `terrain.add` (send the whole `add` list: lists replace).
- "make it a desert" → `shape: "dunes"`; "the moon" → `shape: "craters"` plus a dark `background`; "snowy peaks" →
  `shape: "mountains", "height": 110`; "a different one" → another `seed`.
- "dig a giant hole here": a script `game.terrain.dig(x, z, 20, 15)` (where the player is: `game.player.x/z`), or a
  stamp `{ "type": "hole", "at": [x, z], "radius": 20, "depth": 15 }` in `add` to keep it in the world.
- "give me a shovel": `config.player.tool = "shovel"` (or `game.player.tool = 'shovel'`).
- "no trees" → `scatter: false`; "a forest" → `scatter: { "trees": 1500 }`; "use my pine model for the trees" →
  `scatter: { "models": { "tree": "pine" } }`.
- "use this grass texture on the ground" → `textures: { "grass": "<asset>" }`.
- "a lake in the valley": a `lake` stamp (bowl) and the Water module's water in it.
