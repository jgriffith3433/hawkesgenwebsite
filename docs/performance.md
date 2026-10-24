# Loading speed and memory

Targets (J, 2026-10-23): about **2 s to playable on a phone**, and **never killed for memory** (iOS Safari reloads a page
that takes too much). Phone first; desktop is never capped to a phone's numbers. What J measures us by: network latency,
load times, phone support, frames per second, RAM.

## How a world loads now

1. `/play/modules.js` runs: Babylon, the glTF loaders, Havok and **Havok's wasm** start downloading at once (preload
   links), while the page fetches the game. Engine scripts are cached for good (`immutable`, their address has the
   engine's content hash); Babylon and Havok come pinned from jsDelivr (immutable too).
2. The loader reads the game (`HawkesModules.needs(bundle)`): **lazy modules** (vehicles, homes, events, share) load only
   when the world uses them; the others come once the world has drawn ~30 frames, when the page is idle.
3. The bundle carries every image's and model's **levels of detail** inline (`assets[name].lods`, `src/lods.ts`), so no
   request per asset is needed to know them. Hawkes Gen makes them itself when the asset is made (its LOD system,
   `hawkesgen/src/lod.ts`): images at 128, 256, 512, 1024, 2048 px and the full size as WebP; models a low (about an
   eighth of the triangles or fewer, textures an eighth of the model's), a mid when it pays (40%, 1024 px textures) and
   a high (every triangle, textures as WebP at most 2048) when that's a much smaller file. Each level is a link that
   names its file's hash, cached for good.
4. Every **texture loads once at a first level**: about the size it will have on screen from where the player starts
   (a sky: the screen's width; a box or sprite: its size and distance), within its share of the budget; nothing to go by,
   the smallest. Twice a second `textures.js` works out how many pixels each texture covers and sharpens the most needed
   within the device's texture budget, straight to the level it needs (one more request, never a ladder), holding one
   copy; the least visible go down first when it's full.
5. **Models load nearest first**, `H.budget.loads` at a time: far away only the low level, near the most detailed level
   whose textures fit the device (`H.budget.maxTexture`: a phone takes the mid, 1024 px).
6. **Draw distance** (small things far away aren't drawn, nothing past the fog), **shadows** only near, and phones draw a
   3x screen at 2x.

## Budgets per device (`scale.js`, `H.budgetsFor`)

| | iPhone | Android phone | iPad / tablet | desktop |
|---|---|---|---|---|
| texture memory | 64 MB | 96 MB (64 with ≤3 GB) | 128 / 160 MB | 512 MB (256 with ≤4 GB) |
| largest texture | 1024 | 1024 | 2048 | 8192 |
| pixel ratio | 2 | 2 | 2 | the device's |
| draw distance (per m of radius) | 220 | 220 | 320 | 700 |
| shadows / distance | 30 / 45 m | 30 / 45 m | 70 / 70 m | 160 / 160 m |
| things / moving bodies | 900 / 150 | 900 / 150 | 1500 / 250 | 2500 / 400 |

## Measured: Gen's LOD system against the portal's own copies (2026-10-23)

Headless Chrome on J's laptop (Core Ultra 7 155U, software WebGL: SwiftShader), the portal on 127.0.0.1 (no gzip
locally). "Phone": 390x844 at 3x, an iPhone user agent, touch, CPU slowed 4x and "4G" (9 Mbit/s down, 85 ms). Cold: an
empty cache; warm: the second visit. JS heap after a garbage collection. Software WebGL makes every frame far slower
than a real phone's GPU, and the machine runs other work, so times vary by tens of percent between runs; bytes, requests
and memory are exact. Before: beta `591b490` (the portal's `variants.ts` copies, made by Gen's `image.transform`, with a
fake Gen). After: this branch against a real local Hawkes Gen (branch `lod-system`) that made every level itself.

The heavy world: terrain (island, scattered trees, rocks, bushes), water, 100 creatures in two herds, a house, a car, a
4x4, a boat, a helicopter, 12 textured boxes (1024 px PNGs like the library's), 4 sprites, a 2048x1024 sky and 6 crate
models (a 6,912-triangle GLB with a 1024 px PNG inside; before, also a hand-made 12-triangle low copy beside it).

| Heavy world | before | after |
|---|---|---|
| desktop: bytes downloaded (cold) | 5.18 MB (images 0.13, models 1.43) | **4.07-4.09 MB** (images and models 0.45: the near crate is 0.33 MB with WebP inside, not 1.47) |
| phone: bytes downloaded (cold) | 5.18 MB | **4.06-4.07 MB** |
| desktop / phone: requests per load (cold) | 98-102 / 104-105 | **96-97 / 100-102** (textures start at their level; the sky at its size, not 128 then 2048) |
| desktop: texture memory (GPU) | 24.7 MB | 24.7 MB |
| phone: texture memory | 16.0-16.2 MB | 16.0-16.2 MB |
| phone: first frame, cold (median of 3) | 26.2 s | **20.5 s** |
| phone: everything loaded, cold (median of 3) | 44.0 s | **31.1 s** |
| phone: first frame, warm | 14.5 s | **9.9 s** |
| desktop: first frame, cold / warm | 7.1-12.1 s / 5.2-6.6 s | 8.0-8.1 s / 5.1-5.5 s |
| desktop: CPU to the first frame (profile, median of 6) | 5.4 s | 5.4 s (shader compiles are most of it) |
| JS heap, desktop / phone (after a GC) | 96-99 / 80-84 MB (median 81.9) | 96-98 / 78-82 MB (median 79.0) |
| draw calls, desktop / phone (monitor) | ~1,220 / ~245 | ~1,210 / ~240 |

The sandbox (no Gen assets: only engine code changed) is the same before and after: 3.5 MB on a first visit, 10.3 / 5.3
MB of textures desktop / phone, 50-57 MB of heap, 109-130 / 83-91 draw calls.

**A starter-pack model**, where the old way did worst (a 12,000-triangle Draco GLB with a 2048 px WebP inside, and
Blender's low copy with the same 2048 px texture): before, a far copy was a 2.5 MB file holding a 2048 px texture (about
21 MB of GPU memory each); now its low level is **20 KB with a 256 px texture (0.35 MB)**, and a phone's near copy is the
mid (490 KB, 1024 px: 5.6 MB instead of 22). The 4096 px chair gets a high level at 2048 (a quarter of the memory).

Scripts: `measure.mjs` and `battery.mjs` in the session's scratchpad (`lodm/`), with `setup.mjs` (the heavy world) and
`fakegen.mjs` (the before side).

## What's left

- **KTX2/Basis** (GPU-compressed textures: 4-8x less GPU memory than WebP's RGBA) isn't made yet. It needs an encoder on
  Gen's control server (Binomial's `basisu` binary or KTX-Software's `toktx`; neither is on the box, and there's no npm
  build of the encoder) and the engine to load Babylon's KTX2 transcoder (a wasm download of its own on the first visit,
  which costs a phone's cold load). The place for it is a level format in Gen's `asset.lod` (a `ktx2` level beside the
  WebP ones) and a check in `textures.js` for the device's support: next.
- **Babylon is most of the first visit**: 6.8 MB (1.5 MB gzipped). 2 s on a phone's first visit over 4G needs a smaller
  Babylon (an ES-module build with only what the engine uses: a big job of its own). Second visits load no engine at all.
- Textures inside models aren't managed by `textures.js` (a model's levels are what keep far models cheap); they count
  against the budget as they are.
- Vehicles cast scene-wide rays every step (`vehicles.js` `cast`): the biggest CPU cost in a world with many meshes
  after shaders.
- Video posters have no levels (videos aren't images; a poster is made by the share window).
