# The Overseer's first-time lines

**What I built.** `public/play/modules/overseer/lines.js` (registered in `module.json`, syntax-checked in `npm run typecheck`): eight lines from the story doc's "First-time moments", each said once per device.

| Moment | Trigger | Line | Voice |
|---|---|---|---|
| first build/spawn | `spawned` / `landed` | "A new one, from me." | existing clip `overseer-a-new-one.mp3` |
| first fish | `catch` | "The sea gives. It gives slowly…" / "A fish. You waited well." | text only |
| first fall/death | the world's `respawn` hook (death and falling out) | "Down you go again. The light is patient." / "That was a fall worth watching. Come back." | text only |
| first dock | `docked`, `docked-pad` | "You came all this way. The door was open." / "Welcome in…" | text only |
| first time above the air | `H.sky.space > 0.5` | "There. That is the whole planet…" / "It gets quiet up here…" | text only |
| first vehicle explosion | `wrecked` | "Destruction is a kind of freedom too." | existing clip `overseer-destruction.mp3` |
| first friend joins | a new peer in `HawkesNet.peers()` | "Someone is here with you. Good." / "You have company. I sent them down gently." (new, in the doc's voice) | text only |
| back after 7 days | `hg_overseer_lastvisit` older than 7 days | "You came back. The sea kept your place." / "Hello again. It rained while you were gone." | text only |

I only reused a clip where it says the very same words as the caption. The other lines are text-only; new clips are the separate voice task.

**Rules.** Lines go through `H.overseer.speak` into the one chat. A line waits, and is said when the way is clear, while the intro plays or is about to, the mirror is open or pending, a tour moment is on (`tour`, `spawn-wheel`, the tour's start and end, held 6–10 s), or any other Overseer chat line is still being read (`H.chat.line` is watched for this). Waiting lines go in order of importance (return, dock, space, fall, explosion/friend, build/fish). A line that waits more than 60 s gives up *without* counting as said. Nothing counts in the first 3 s of a world, so what loads with it isn't "built". A line is marked said only when it's delivered. `game.on('overseer-line')` announces each one.

**Once per device.** `localStorage` `hg_overseer_lines`. The editor's sandboxed stage has no storage, so `editor.js` (two small edits) seeds `bundle.overseerLines` and keeps what the stage posts (`overseer-lines`), the same way as the intro's `overseen`.

**Checks.** `test/engine/lines.test.ts` (9 tests): lines and clips, once-only and remembered, each trigger, the settling time, waiting for intro/mirror/tour, not talking over another line, priority order, giving up when stale, the 7-day return. `npm run typecheck` passes; `npm test` passes except `net.multi.ts` "remote things move smoothly", which failed once under load and passed on re-runs (unrelated).

**Left for J / later.**
- **Account-level memory.** "Once per device" is done. Saving the set to the signed-in account needs a server field (a users/games column and an endpoint); I left it out, so a new device repeats the lines. The hand-off point is `bundle.overseerLines`.
- **Voice clips** for the text-only lines: a separate task, cents each, no GPU. No GPU work here, so no estimate is needed.
- No `hawkesPlaytest` contract in this repo, so no scenario file; the try steps below show each moment.
