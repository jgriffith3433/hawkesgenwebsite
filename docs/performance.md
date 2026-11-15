# Loading speed and memory

Targets (J, 2026-10-23): about **2 s to playable on a phone**, and **never killed for memory** (iOS Safari reloads a page
that takes too much). Phone first; desktop is never capped to a phone's numbers. What J measures us by: network latency,
load times, phone support, frames per second, RAM.

## How a world loads now

1. `/play/modules.js` runs: Babylon, the glTF loaders, Havok and **Havok's wasm** start downloading at once (preload
   links), while the page fetches the game. Engine scripts are cached for good (`immutable`, their address has the
   engine's content hash); Babylon, the loaders and Havok come pinned from our own `/vendor/` (below; immutable too).
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

## Pinned libraries on our own address (2026-10-25)

Babylon, its loaders, Havok (and its wasm), the monitor's Inspector, CodeMirror, marked and model-viewer used to load
from jsDelivr, cdnjs and unpkg with no integrity hashes: a compromised CDN would have run code on hawkesgen.ai or in
every game. They now live in `public/vendor/<name>@<version>/` with their licenses, each with a `.br` and a `.gz` beside
it. `src/vendor.ts` serves the best one the browser accepts (`Content-Encoding`, `Vary: Accept-Encoding`), `immutable`
for a year (the version is in the path), open CORS (the play page has no origin), Havok's wasm as `application/wasm`.
`tools/vendor.mjs` fetches a version, refuses a file whose sha256 is not the one recorded in `tools/vendor.json` and
writes the compressed copies; `node tools/vendor.mjs add babylonjs 7.55.0` records a new version; `check` is offline.
The play page's CSP names no CDN any more (`PLAY_HOSTS`). Test `test/vendor.test.ts`.

**First visit, bytes on the wire with brotli (a new game player's engine download, measured 2026-10-25):**

| File | Before (jsDelivr) | After (ours) |
|---|---|---|
| babylon.js (6.8 MB) | 1,299,739 | 1,003,659 |
| babylonjs.loaders.min.js (288 KB) | 63,107 | 53,061 |
| HavokPhysics_umd.js | 15,062 | 12,640 |
| HavokPhysics.wasm (2.1 MB) | 642,515 | 500,038 |
| **Play page total** | **2,020,423** | **1,569,398** (-22%) |

The CDN's brotli is a fast setting; ours is made once at the highest (quality 11, 16 MB window). Besides the play page:
model-viewer (Creator Studio) 935,194 (unpkg sent it uncompressed) -> 205,284; the editor's CodeMirror core 50,319 and
marked 13,901 are the same size as before, now from our address (the editor adds three small modes: 17.6 KB total). The
Inspector (Ctrl+Shift+M > Inspector, ours only) 195,202 either way, fetched only when asked. A repeat visit loads none of
it: the files are immutable. One request origin fewer on a cold start (no DNS, TLS or connection to a CDN). Not
changed: model-viewer fetches its own Draco/KTX2 decoders from gstatic.com when a model needs them.

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

## Server capacity (2026-10-25)

How many players one portal process holds, measured with `tools/crowd.mjs` (no browser; `test/crowd.test.ts` runs it tiny
in `npm test`). It starts the portal on a free port with its own database and a stand-in for Gen, and ramps up:

- **Players** over `/v1/ws` (protocol 2) in rooms of 16, each sending what a real page sends: its pose every 66 ms inside a
  bundle (15 a second), a ping every 2 s (a real page pings every 5 s: more samples), and one player in eight driving a thing
  it owns (`own`, then `xf` every 33 ms). They live in worker threads (about 200 each) so the tool never measures itself;
  a level is flagged if the tool's own loop lags (p99 over 50 ms).
- **Page and asset loads** five a second (the landing page, `/play/sandbox`, `runtime.js`, `modules.js`, WORLD.md, the portfolio...).
- **Editor live streams** (SSE, 12), and **three sign-ins** a level (scrypt on the thread pool).

A level is **held** when the pings' p99 and the page loads' p99 are both under 100 ms, nobody is refused or reset, and the
tool kept up. The latency is the round trip of a ping through the portal's event loop.

| Players | Ping p50 / p99 | Page load p99 | Server loop p99 | Server CPU (one core = 100%) | RSS | Down / up per player | Held |
|---|---|---|---|---|---|---|---|
| 100 | 0.2 / 4.8 ms | 24 ms | 4.2 ms | 18% | 229 MB | 30.3 / 2.4 KB/s | yes |
| 300 | 0.8 / 12.5 ms | 21 ms | 9.4 ms | 35% | 329 MB | 31.1 / 2.4 KB/s | yes |
| **600** | 1.0 / 22.5 ms | 56 ms | 20 ms | 62% | 352 MB | 31.2 / 2.4 KB/s | **yes** |
| 800 | 12.6 / 28.3 ms | **125 ms** | 28 ms | 81% | 376 MB | 31.5 / 2.4 KB/s | no (page loads) |
| 1,000 | 13.9 / 46.3 ms | **157 ms** | 48 ms | 100% | 396 MB | 31.1 / 2.4 KB/s | no (page loads) |

(`node tools/crowd.mjs --levels 100,300,600,800,1000 --hold 20 --editors 12`, 8 cores, Node 24.22, 20 s a level, 12 editor
streams, nothing refused or reset at any level.)

**One process holds 600 players with p99 under 100 ms**, about 800 before pages slow down, and the game traffic itself stays
good beyond that (pings p99 46 ms at 1,000): the limit is the one thread doing everything. At 1,000 the process uses a whole
core. Memory is small: about 0.4 GB for 1,000 (roughly 160 KB a player over the idle process). Bandwidth is about 31 KB/s
down and 2.4 KB/s up for each player in a room of 16, so 600 players are about 19 MB/s out of the server: **the network
line, not the CPU, may be the first limit on the box** (check it before promising 600 live).

**Read it as a baseline, not a promise.** The load generator and the portal share one machine here, a stand-in Gen answers
instantly, the players do not run engines, and rooms are 16 (a fuller room costs more per player: every bundle carries
more avatars). Before this, `PORTAL_WS_MAX` stood at 3,000 sockets, five times what one process keeps responsive: lower it
(or add a second process) if live traffic ever gets near 600 at once. The slowest thing under load is plain page serving
(`/play/runtime.js` and the like), not the realtime path: first to look at if capacity matters.

**Beta** runs on the studio's control server next to Gen and Studio, so the tool refuses more than 200 players against any
address but this machine's:
`node tools/crowd.mjs --url https://hawkesgenwebsite.hawkesgen.ai --cookie '<studio session cookie>' --levels 50,100,200`
(everyone then arrives from one address, so the per-address caps (12 sockets, 30 new a minute) refuse most of them and are
reported as refused; `PORTAL_WS_PER_IP` and `PORTAL_WS_PER_MIN` would have to be raised on a test portal to measure more).

**While it runs**, `GET /v1/health/details` (an admin signed in, or a request from the box itself; `?reset=1` starts a new
event-loop window) shows what the server felt: event-loop delay p50/p99/max, heap and RSS, CPU, open HTTP sockets, game
sockets and rooms, editor streams, requests a second, Gen call latency and errors, the oldest unsettled job and the last backup.
`/v1/health` stays the plain, fast 200 Studio asks.

## Cluster: web processes and a worker (2026-10-25)

One process was the limit (above): everything shared one event loop. `PORTAL_ROLE=web` (the systemd unit) runs a **primary**
(`src/primary.ts`) that keeps `PORTAL_WEB_PROCS` **web processes** (default: the CPU count) on the one port with
`node:cluster`, and exactly one **worker** (`PORTAL_ROLE=worker`) that alone starts every background loop (`watch()` and its
sweep, `resumeTasks`, `resumeGens`, the starter pack). `node src/server.ts` with no role is still one process that does it all
(Studio's beta, the tests, a laptop). What was in one process's memory and had to stay one thing:

| Was in memory | Now |
|---|---|
| Editor live streams, their history for Last-Event-ID, who has the editor open (`live.ts`) | A **bus** (`src/bus.ts`): the worker hosts a hub on `.data/bus.sock`; a process that applies a change publishes it, the hub numbers it (`<boot>-<n>`, the last 200 per game), keeps the replay, merges presence, and hands it to **every** web process, the sender's too, so each editor's stream gets it once wherever it is. A stream that reconnects asks the hub for what it missed. Hawkes Net (`PORTAL_NET=hawkesnet`) still carries the game rooms there as before; the editors' feed always uses the bus. |
| World ops, edit-room events, kicks, closing a game (`rooms.ts`), who is playing (`here`), how full a room is (for invitations) | The same bus (`ops`, `room-event`, `room-kick`, `room-close`, `here`, `room`); Hawkes Net publishing (`publishOps`) still happens once, from the process that made the change |
| A game room's relay | Kept by **one** web process: the hash of the room (`edit:<game>` or `play:<slug>:<code>`) picks it, and a socket that arrives at another process is handed over through the primary with the request as it came (`rooms.ts handoff`). A process leaving does the same for anyone who arrives late, and tells its players `1012 restarting` so their page reconnects |
| The assistant's one-at-a-time lock (`gameai.ts thinking`) | A row in SQLite (`shared.ts lock`, `locks`: it lets go by itself if its holder dies) |
| The generate limits (10 a minute, 40 an hour) | SQLite (`SharedLimiter`, `rate_hits`) |
| The other limits (sign-ins, sign-ups, reports, beacons, sockets) | Stay per process and **divide by the process count** (`Limiter.limit`, `PORTAL_PROCS`; `PORTAL_WS_MAX` and `PORTAL_LIVE_MAX` too) |
| Running a started task / following a generation (`tasks.ts`, `gameai.ts`) | A web process writes the row and sends `task-start` / `gen-follow`; the worker runs it (and finds any a restart left, every 5 s). Task events (`task-event`) go to every process, so a request waiting on a task hears it |

**Rolling restart.** `systemctl reload hawkesgen-portal` (SIGUSR2 to the primary; `deploy/pull.mjs` does it after each deploy):
for each web slot a new process starts and must answer five times running before the old one is asked to leave; the old one
finishes its requests, ends its editor streams with a clean `bye` (the browser comes back with Last-Event-ID and misses
nothing) and exits; the worker goes last (old one stopped before the new one starts). `.data/roll.json` says `rolling`, `done` or
`failed`. A change to `src/primary.ts` or the unit needs `systemctl restart` (pull.mjs does that by itself, and installs the
unit file when the repo's differs).

**Measured (2026-10-25/26, the same 8-core machine, back to back; it was shared with other agents, load average 8, so every
number is worse than a quiet box gives and they move from run to run).** One process: held 450 at best that day (300 in another
run; the quiet-machine table above has 600). `--web 4` (four web processes and the worker): **held 1,500, the highest level tried**
(ping p99 41 ms, pages p99 55 ms, 186% of a core across the four, 1.4 GB), 3.3 times that day's single process and 2.5 times the
table's 600. A rolling restart under 600 players (`--web 4 --roll --levels 600 --hold 40`): all four processes and the worker
restarted in 57 s, 274 saves in, **0 failed, 0 page errors, every one of the 5 watching editor streams saw every save once**
(18 stream reconnects), the 600 players told `1012 restarting` and back in their rooms. Under 1,200 players the same restart
lost one save request out of 293 (not chased down) and the reconnect storm of 1,200 players pushed ping p99 to 230 ms: restarts
at that size are a thing to do in a quiet minute. Memory: 1.0 GB at 600 players for five processes (each loads the whole portal:
about 200 MB idle).

`node tools/crowd.mjs --web 4 --roll --levels ... --hold 15` runs the same test against a cluster, restarts it during the last
level while saving files, and reports whether any request failed and whether every editor stream saw every save once.
`test/cluster.test.ts` is the same in small: editors on both processes get a save once; the lock holds across processes; a roll
drops nothing; players who arrive at different processes are in one room.

## First load: the number and the console (2026-11-11)

The `first-load` playtest (`public/playtest/first-load.js`, safe on live: it reads only) measures what a stranger waits for.
From the landing page with the runner's cold browser, a real click on Play now, then on the play page: `msToLoadingScreen`
(the `hg-loading-shown` mark in `play.html`), `msToFirstFrame` (the `hg-first-frame` mark in `guest.js`, made with
`sandbox_first_frame`), `msToFirstInput` (real W or the stick; the player moved; `msToInputReady` is when control was
given, before the scenario's own pause at the click-to-enter veil), `bytesBeforeFirstFrame` and `requestsBeforeFirstFrame`
(resource timings that ended before the first frame; `cachedRequests` says whether the cache was cold). The phone twin
(`first-load@live:phone`: 390x844, touch) is meant to run at 4x CPU slowdown and 4G (9 Mbit/s, 85 ms): a page cannot set
those, so the runner does, and the report carries `cpuProbeMs` (a timed loop) and `navigator.connection` to show which run
it was. It reports its numbers however slow; nothing in it fails on time.

**The console.** Every line with `WebGL`, `GL_` or `WARNING` from the landing page to the end of the intro is a problem and
is listed in the report (`console-line`), with any `gl.getError()` code read at the first frame and at the end of the intro.
`guest.js` keeps the play page's console from its first line (under automation only). Chrome's own GL driver messages are
not `console.*` calls and a page cannot see them; the runner's console capture shows them, and the same rule applies.

| Warning | Cause | Fix |
|---|---|---|
| `Babylon.js v7.54.3 - WebGL2` (a console line at every engine start) | Babylon logs its banner at message level through `Logger`, which defaults to everything, when `runtime.js` makes the engine | `runtime.js` sets `Logger.LogLevels` to warnings and errors before the engine is made. Warnings and errors from Babylon, and every WebGL complaint, still reach the console |

Found by reading the engine, not yet by a run: anything else the first beta run lists goes in this table with its fix, at
its cause (runtime.js, textures.js, loader.js, the loading pearl, the soundscape), never by silencing the console. The
engine paths checked for GL warnings and found sound: the loading pearl is canvas 2D (no second WebGL context), the mirror
texture's render list leaves out its own glass (no feedback loop), text and sky dynamic textures have sizes of at least 4 px.
Textures and shadows are untouched by this change.

## First load: start playing, stream the rest (2026-11-11)

**Before** (the `first-load` playtest on live, as measured by k_4addbc635552; the figures are the runner's, not copied here
because the run's report is not in this repo): the loading cover stayed up until the whole scene was ready
(`scene.whenReadyAsync`: every shader and texture of the island, capped at 12 s), and every lazy module the island uses
(vehicles, races, events, share) was fetched and run before the world could start.
**After (code, not yet measured):** `runtime.js whenDrawn` lifts the cover once the first frames are on screen (the scene
ready, or four drawn frames with 1.2 s behind them, then two more; cap 8 s instead of 12) and Babylon's parallel shader
compile (on by default with `KHR_parallel_shader_compile`) finishes the rest frame by frame. `loader.js` with a bundle no
longer waits for the lazy modules: `afterFirstFrame` brings the game's own after the world is drawn and the page is idle
(`bring` rebuilds stand-ins of their kinds), then the rest (`later`). Babylon, Havok and its wasm were already preloaded as
soon as `modules.js` runs, side by side with the page. The editor and a load without a bundle are unchanged. The after
numbers (390x844 touch 4x CPU 4G, and 1280x720) come from the beta `first-load` run; targets: first frame 8 s / 4 s,
first input 12 s / 6 s, no loading cover after the first frame, zero WebGL lines.

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
