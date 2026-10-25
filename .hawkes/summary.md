# Perf events from real devices

**What changed**
- `public/play/analytics.js`: a `perf` event, sampled in the existing once-a-second frame hook (frame times kept in memory, no continuous reporting, no monitor needed):
  - `phase: ready` at `game_ready`: `tier`, `stages {dom, paint, ready}` (ms, page timings), `bytes` fetched, plus the snapshot below.
  - `phase: 30s` after 30 s of play, then `2m` every 2 minutes of play: median and p5 `fps`, `frameMs` / `frameMsP95` (since the last report), `drawCalls`, `triangles`, `activeMeshes`, `heapMB`, `textureMB` vs `textureBudgetMB`, `entities`.
  - `phase: low_fps` once a session when fps < 20 for 3 s: `lowFps`, mode, vehicle, last feature, space, intro, render scaling, seconds played, plus the snapshot.
  - Only visible, drawn frames count. Nothing in it identifies a person.
- `AGENTS.md` Analytics row and `public/legal.html` statistics line updated.
- `test/engine/analytics.test.ts`: the schedule (ready, 30s, 2m) and low-fps-once.

**Checked**: analytics engine tests pass; typecheck and full `npm test` run (see below if noted).

**Notes**: the monitor's `sample()` needs its counters (open panel), so analytics reads the engine's own counters instead. `heapMB` is Chromium only. `bytes` counts transfer size (0 for cross-origin without Timing-Allow-Origin, then null). No `hawkesPlaytest` contract here, so no scenario; to see it: play a game on beta and open Studio analytics, product hawkesgen, event `perf`.
Checks: typecheck clean; 377 tests pass; net.multi.ts is flaky (passed 6/6 on baseline and on 2 of 3 runs with my change, 5/6 once), unrelated to analytics.
