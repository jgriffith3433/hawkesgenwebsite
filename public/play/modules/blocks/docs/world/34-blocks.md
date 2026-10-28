## Blocks: a world you mine and build, block by block (`config.blocks`)

`config.blocks` grows a **world of blocks** from a seed: bedrock at the bottom, stone with ores (coal, iron, gold, diamond
deeper down), dirt, grass (or snow, or sand) on top, caves winding through the stone, trees. Players stand on it, mine it
with the **pickaxe** and build with what they mine. Everyone playing sees every change. It is the way to answer "make a
voxel mining game", "a block world", "a game where you dig for diamonds".

```json
"blocks": { "world": "caves", "size": [48, 32, 48], "seed": 4021, "at": [0, -14, 0] },
"player": { "tool": "pickaxe" }
```

| Key | What |
|---|---|
| `world` | `hills` (default), `caves` (hills with caves), `flat`, `desert`, `snowy`, `empty` (nothing: build from the floor up). |
| `size` | Blocks `[wide, tall, deep]`: 8 to 128 across, 8 to 96 tall. Default `[48, 32, 48]`. Bigger costs more on phones: keep it at most 64 x 48 x 64 for a game people play on phones. |
| `at` | The world's bottom middle, in the world file's numbers (on a round planet, the planet's own, like `transform.position`). The ground grows to about 0.42 of the height, so `at` about 14 under the start (`[0, -14, 0]` for 32 tall) puts the start on the surface. A player inside blocks is always lifted onto the top. |
| `scale` | Meters a block (0.25 to 4, default 1). |
| `seed` | Which world (a whole number). The same seed is the same world. |
| `ores`, `caves`, `trees` | false turns them off (`caves: true` adds caves to any world). |
| `creative` | true: every block to place, mining is quick, no bag (a building game). |
| `reach` | How far the pickaxe reaches, meters (default 6). |
| `edits` | `[[x, y, z, type], ...]`: blocks changed from the seed's world (the editor saves these). `type` a name or 0 for air. |

**Blocks** (`type` by name): grass, dirt, stone, sand, wood, leaves, coal, iron, gold, diamond, planks, glass, brick, snow,
bedrock (can't be mined), cobble, lamp. Mining drops a block into the bag (grass drops dirt, stone cobble, leaves and glass
nothing); harder blocks take longer (leaves 0.2 s, dirt 0.45, stone 1.2, diamond 2.6). `config.player.tool` `{ "type":
"pickaxe", "power": 2 }` mines twice as fast.

**The pickaxe:** hold click to mine what you look at, **R** or shift+click puts the picked block on the face you look
at, 1-9 or the wheel picks from the bar, ⚒ on the bar crafts. On a phone: Mine and Place buttons, tap the bar. Recipes:
4 planks from 1 wood; glass from 2 sand; 2 brick from 2 cobble and 1 dirt; a lamp from 1 coal and 1 glass; stone from 1
cobble and 1 coal.

**Game events** for rules and scripts: `mine` (`{ type, at: [x, y, z], point, by }`), `place`, `craft` (`{ what, count }`).
A rule that pays for diamonds: `{ "when": { "on": "mine" }, "if": ..., "do": [...] }`; a goal "mine 5 diamonds" counts
`mine` events whose `type` is `diamond`.

**In words:**
- "make a voxel mining game" -> `config.blocks` `{ "world": "caves", "at": [0, -14, 0] }`, `config.player.tool` `"pickaxe"`,
  a goal (mine diamonds, build a tower), and the story's line.
- "build a block house" in a world with blocks -> a script or ops is not needed: the builder clicks with ⛏ Blocks; the
  assistant writes `edits` (a floor of planks, walls of brick, glass windows, a lamp) when asked to build it.
- "make it a creative building world" -> `"creative": true`, `"world": "flat"`.
