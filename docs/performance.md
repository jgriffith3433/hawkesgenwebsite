# Loading speed and memory

Targets (J, 2026-10-23): about **2 s to playable on a phone**, and **never killed for memory** (iOS Safari reloads a page
that takes too much). Phone first; desktop is never capped to a phone's numbers.

## How a world loads now

1. `/play/modules.js` runs: Babylon, the glTF loaders, Havok and **Havok's wasm** start downloading at once (preload
   links), while the page fetches the game. Engine scripts are cached for good (`immutable`, their address has the
   engine's content hash); Babylon and Havok come pinned from jsDelivr (immutable too).
2. The loader reads the game (`HawkesModules.needs(bundle)`): **lazy modules** (vehicles, homes, events, share) load only
   when the world uses them; the others come once the world has drawn ~30 frames, when the page is idle.
3. Every **texture starts at its 128 px copy** (`src/variants.ts` makes 128, 256, 512, 1024, 2048 px and full-size WebP
   copies of every image once). Twice a second `textures.js` works out how many pixels each texture covers on screen and
   sharpens the most needed within the device's texture budget; the least visible go down first when it's full.
4. **Models load nearest first**, `H.budget.loads` at a time; with a low copy, only the copy the distance needs.
5. **Draw distance** (small things far away aren't drawn, nothing past the fog), **shadows** only near, and phones draw a
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

## Measured (2026-10-23)

Headless Chrome 141 on J's laptop (Core Ultra 7 155U, software WebGL: SwiftShader), the portal on 127.0.0.1 (no gzip
locally; Caddy compresses on the box). "Phone": 390x844 at 3x, an iPhone user agent, touch, CPU slowed 4x and "4G"
(9 Mbit/s down, 85 ms). Cold: empty cache; warm: the second visit. Software WebGL makes every frame far slower than a
real phone's GPU, so absolute phone times here are pessimistic; compare before with after.
Scripts: `measure.mjs`, `battery.mjs` (the session's scratchpad; easy to copy into `tools/` if wanted).

The heavy world: terrain (island, 125 scattered trees, rocks, bushes), water, 100 creatures in two herds, a house, a car,
a 4x4, a boat, a helicopter, 12 textured boxes (1024 px PNGs like the library's, ~1 MB each), 4 sprites, a 2048x1024
sky and 6 textured GLB crates with low copies.

The machine was shared with other agents during the runs, so times vary by tens of percent between runs (one beta cold
desktop run took 100 s because jsDelivr was slow); bytes and memory are exact. Times in seconds from navigation: first
frame / playable (warm = second visit).

| | beta (before) | this branch (after) |
|---|---|---|
| Heavy world, desktop: bytes downloaded | 20.0 MB (16.6 MB of it images) | **4.8 MB** (0.13 MB images, 1.4 MB the one crate GLB near you) |
| Heavy world, desktop: texture memory (GPU) | 93.6 MB | **22.6 MB** (sky sharpened to 2048: it fills the screen) |
| Heavy world, phone: texture memory | 89.5 MB (over an iPhone's 64 MB budget) | **14.1 MB** |
| Heavy world, phone: warm first frame | 30.9 s | **13.9 s** |
| Heavy world, phone: cold first frame | 51.5 s | **28.1 s** |
| Heavy world, desktop: warm first frame | 6.6-10 s (one run 147 s) | **5.3 s** |
| Heavy world, desktop CPU profile to first frame | 35 s (texture uploads 2.4 s) | 9.3 s |
| Sandbox, phone: warm first frame | 5.3-8.3 s | **4.3 s** |
| Sandbox, phone: cold first frame | 16.8-42 s | 16.6 s |
| Sandbox: engine scripts on the first visit (uncompressed) | 1.52 MB | 1.13 MB (homes, events, share come after) |
| JS heap (sandbox / heavy, phone) | 43-62 / 100-115 MB | 46-63 / 101-107 MB |

Most of a cold phone load is Babylon (6.8 MB, 1.5 MB gzipped) and Havok's wasm (2.1 MB, 0.66 MB gzipped) over 4G,
and SwiftShader compiling shaders; on a real phone's GPU the frames come much faster.

## What's left

- **Babylon is most of the first visit**: 6.8 MB (1.5 MB gzipped) of the ~2.6 MB a first visit downloads. 2 s on a
  phone's first visit over 4G needs a smaller Babylon (an ES-module build with only what the engine uses: a big job of
  its own). Second visits load no engine at all.
- **KTX2/Basis** (GPU-compressed textures, 4-8x less GPU memory than WebP's RGBA) needs an encoder Gen doesn't have
  (`image.transform` writes PNG, WebP and JPEG). With the copies and the budget, memory is already under control; add a
  `basisu` step to Gen when worlds need more sharp textures than the budget allows.
- **Textures inside GLB models** aren't resized: the low copy (its own smaller textures) is what keeps far models cheap.
  Models without a low copy count against the budget as they are.
- Vehicles cast scene-wide rays every step (`vehicles.js` `cast`: `pickWithRay` over every mesh): the biggest CPU cost
  in a world with many meshes after shaders. Parked vehicles sleep, but four of them settling at the start is a lot.
- Video posters have no copies yet (videos aren't images; a poster is made by the share window).
