## Keeping it fast (phones first)

Most players are on phones: a world must start in a couple of seconds and never run out of memory (iOS Safari reloads
a page that takes too much). The engine does most of it by itself; build worlds that let it.

**What the engine does for you**
- **Textures by level of detail.** Every image Hawkes Games makes or keeps (textures, sprites, skies) has smaller copies
  (128, 256, 512, 1024, 2048 px, WebP), made by Gen with the image. A world loads each texture once at about the size it
  will have on screen (a sky: the screen's width) and sharpens only what's near, big on screen and in view, within the
  device's texture budget; far or unseen ones go back down when memory is tight. Use any texture size: the engine picks.
- **Models load nearest first**, a few at a time. Every model Gen makes or keeps has a low-detail copy (about an eighth
  of the triangles, small textures) and, when it pays, a middle one: far away only the low copy loads, near the most
  detailed copy the device takes (`shape.lod.distance`, 25 m).
- **Draw distance.** Small things far away aren't drawn (a 1 m crate: about 220 m on a phone, 700 m on a desktop;
  bigger things farther), and nothing is drawn past the fog's end. **Fog is the cheapest way to make a big world fast:**
  `config.fog` `{ "start": 70, "end": 240 }` hides and skips everything beyond it.
- **Shadows** come only from the nearest things (phones: 30 within 45 m).
- **Modules load when used.** Vehicles, homes, events and sharing load only when the world has them (or right after it's
  playable); nothing to do in scene.json.

**Budgets per device** (`config.budget` changes them for one world; phones get less, desktop is never held back):

| | phone | tablet | desktop |
|---|---|---|---|
| things (`entities`) | 900 | 1500 | 2500 |
| moving things simulated (`bodies`) | 150 | 250 | 400 |
| texture memory (`textureMB`) | 64 (iPhone), 96 | 128 (iPad), 160 | 512 |
| largest texture (`maxTexture`) | 1024 | 2048 | 8192 |
| shadows / shadow distance | 30 / 45 m | 70 / 70 m | 160 / 160 m |

**Rules of thumb for building**
- **Many of one thing: `"instanced": true`** (or `game.many` in a script): a hundred crates or a forest are one draw call.
- A herd is one `herd` thing with a `count`, not a hundred creatures.
- A phone world: up to ~300 things in view, ~100 animals, a few vehicles; past that, use fog and keep crowds instanced.
  Up to 900 things in all on a phone is fine (the farthest rest and aren't drawn).
- One sky picture (`config.sky`), not several; a terrain's layers are three or four textures, not ten.
- Prefer community and made assets (they have small copies). An image only a URL points at (`https://...`) has none.
- Lights are costly: a few `light` things, not dozens.
- Don't raise `config.budget` for phones; lower it for a world that's very full (e.g. `"bodies": 80`).

Examples in words:
- "make the island feel bigger but keep it fast on phones" → a larger terrain with `config.fog` `{ "start": 90, "end": 300 }`.
- "a forest of 500 trees" → terrain `scatter.trees: 500` (instanced), not 500 tree things.
- "a pile of 200 crates" → one `game.many(200, ...)` (or 200 crate specs with `"instanced": true`).
