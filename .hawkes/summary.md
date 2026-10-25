# Things that appeared with no beam now arrive in one

**What was wrong:** the island's main things were just there after the intro, undo/redo of a removal popped the thing back, and a player joining the room appeared without a sign.

**Changed**
- `public/play/modules/overseer/arrive.js`: `H.arrive.cascade(ids)` hides the listed scene things and beams them in one after another (0.55 s apart, short beam each). It runs when the first-visit intro ends (played or skipped) and reads `config.overseer.cascade`. A return has no intro, so it never cascades. Skipped on the phone tier (cost). Also `H.arrive.joined(e, name)` and `label()` (a name that rises and fades), `short` beams, and game events `cascade` and `joined`. The `drop` rules for things with velocity are untouched (only `how: 'beam'` is used).
- `src/overseer-games/sandbox.ts`: `overseer.cascade: [pip, hut, jeep, boat, heli, rocket]`. Documented in `docs/world/12-overseer.md`.
- `public/play/build.js`: undo/redo that brings a thing back (any `create` op in the replay) goes out with `fx: 'beam'` and `short`, so it is re-beamed in a short beam (about 0.9 s). Others' builds and the editor protocol are unchanged.
- `public/play/net.js`: a peer who sends `join` while we are here is beamed in with "<name> joined" over them (once; peers already there, world reloads and crowds past `H.budget.characters` just appear). Every other player in the room sees it, since each client builds the avatar.
- `presence-markers.js`: `standIn(name, { joined: true })` uses the same arrival (for the playtest, no second browser).
- Test: `test/engine/arrive.test.ts` (cascade then none on a return; undo of a delete beams back).
- Playtest scenario `island-arrivals` (`public/playtest/portal.js`, named in `.hawkes/scenario.txt`): first visit, then the cascade events, undo-beam (Tab, a named-shortcut delete, real Ctrl+Z), the joiner (named shortcut stand-in) with beam and name, then a second visit where `just-there` is logged.

**Checked:** `node --test test/engine/arrive.test.ts` passes (9). Typecheck and the full suite were run (see the end of this file). No browser started here, so the playtest has not been run: please have it played on beta.

**For J:** if the sandbox page doesn't load build.js, the undo step logs a warning and is skipped. Phones get no cascade by design; say if you want a shorter one there. No GPU work, no estimate needed.

Checks: typecheck passes; arrive, observatory, undo, presence and playtest tests pass (39). One observatory assertion failed once in the full parallel run and passed alone: a flake under load.
