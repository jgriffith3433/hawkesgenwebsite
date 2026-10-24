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

## Frame rate: what a frame costs (2026-10-24)

J's report: a herd, a rocket, a house, a truck, a mountain, a TV and a cliff made his desktop play at 18 fps (911 draw
calls, 10 lights, the fixed step 8.6 ms) and only 40 fps looking at the empty sky (251 draw calls for 8 meshes). A CPU
profile (Chrome DevTools protocol, `perf.mjs` and `tree.mjs` in the session's scratchpad) found:

1. **Vehicles' wheel rays picked every triangle in the world**: `scene.pickWithRay` per wheel per step, through the
   terrain's 115k triangles: 420 of every 1000 ms with two vehicles. They now cast against Havok's colliders
   (`H.physics.raycast` with `filter`): 20 ms a second. (That was most of "the physics step"; Havok's own solve is
   about 0.7 ms a step with ~140 bodies.)
2. **The shadow map drew every caster in the world every frame** (Babylon doesn't cull them): 300 casters looking at
   the sky. Now only near casters whose shadow can fall in the camera's view, not tiny ones, and the map is drawn again
   only when one of those moved. Phones filter shadows in one pass (PCF) instead of two blur passes.
3. **Lamps lit every mesh in the world**: a point light with a range now lights only the meshes in it; house materials
   take `H.budget.lights` (4 on phones).
4. **Stand-ins of many parts**: a car's ~24 boxes, a barrel's rings, a bookshelf's boards and a house's 55 walls are
   drawn as one mesh per material (`H.mergeParts`; the house's pieces stay as bodies); barrels share their materials.
5. **Per-frame rays**: homes asked "what is the player looking at" with a scene pick every frame (40 ms a second); now
   10 times a second, or at once when you turn or move. Impact sounds stopped looking up sound assets that don't exist.
6. **Per-step bookkeeping** in physics.js: still things are skipped without working out their pose, settings compared
   as they are instead of building strings for every body every step. Dynamic `mesh` colliders become convex hulls.

Measured headless on J's laptop (Core Ultra 7 155U, Intel graphics through D3D11, 1920x1031; the machine was running
other agents' work, so fps varies by tens of percent between runs; draw calls and the profile's milliseconds are
steadier). The sandbox with herd, rocket, house, truck, TV and rock spawned (a mountain and a cliff need building mode):

| | beta (fd0a8dd + 4ff989c) | this branch |
|---|---|---|
| J's scene, looking at it: fps / draw calls / step | 7.8 / 479 / 18.3 ms | **29.7 / 180 / 4.4 ms** |
| J's scene, looking at the sky | 10.1 / 317 / 12.3 ms | **44.1 / 47 / 5.8 ms** |
| J's scene, CPU per second in the fixed step (profile) | 646 ms (10.4 ms a step) | **242 ms (4.0 ms a step)** |
| the sandbox alone, looking at it / the sky: draw calls | 149 / 56 | 170 (another view) / **34** |
| the sandbox alone: fps at it / at the sky | 45 / 55 | 49 / 54 (headless caps near 60) |
| phone (`?touch=1`, 390x844 at 3x, CPU 4x slower): J's scene, at it | 0.7 / 636 / 147 ms | 2.1 / 374 / 59 ms |
| the same phone, at the sky | 0.6 / 124 / 159 ms | 3.0 / 28 / 53 ms |

A second run of this branch with the house in view: 18.9 fps, 482 draw calls, step 5.6 ms (the machine busier). The
phone numbers are an emulated slow phone on a busy laptop (a 4x slower CPU makes each step about 4x longer): far better,
not yet playable; `catchUp` (3 steps a frame on phones) keeps it from spending ever longer frames catching up.

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
- Frame rate: the render is now most of a frame (~200 draw calls with ~150 materials in view: furniture and
  vehicles each have their own materials, so they share no batches); sharing materials by look across things (a copy
  made when one is recolored) would cut more. `game.raycast` still picks triangles (scripts and tools, not every frame).
  On a phone-class CPU the fixed step (creatures, Havok, impacts) is still the limit: fewer steps a second on phones
  (30, interpolated) would halve it.
- Video posters have no levels (videos aren't images; a poster is made by the share window).
