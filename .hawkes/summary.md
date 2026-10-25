# Mirror room upgrade

**What it asked for:** a lit reflection of the character that updates live, an entrance, a camera dolly per question,
a transformation pop with sparkles on "What are you?", the Overseer's reaction line, all quick and within a phone budget.

**What changed**
- `public/play/kinds.js` (mirror kind): the reflection texture is 256 px on a phone while idle (512 elsewhere) and is
  redrawn every few frames instead of every frame. With someone in front of it, it redraws only from meshes near the
  glass (12 m phone, 24 m elsewhere).
- `public/play/modules/mirror/mirror.js`:
  - Key and rim lights: a warm key in front of the player, a cool rim behind. They light only the player's meshes (not
    the world) and fade in. The frame glows warm while the mirror is open.
  - Entrance: the player starts 2.4 m back, walks up to the glass in 0.9 s, then waves (presence emote). Emits `mirror`
    state `arrive`.
  - Dolly: the camera eases to a per-question distance (`ZOOM`: what 1, look 0.86, name 0.74) over 0.9 s.
  - Transformation: picking a different body squashes and springs the character (0.48 s) with two sparkle bursts. The
    Overseer's `overseer-is-<id>` line and caption follow 250 ms later through the existing queue. The `pick` event now
    carries `pop`.
  - Frame-rate governor: under ~32 fps it drops the rim light, then the reflection size (256, redrawn every 3rd frame),
    then the sparkles. It emits `quality {level, fps}`.
- Doc `docs/world/32-mirror.md`, kind text in kinds.js, and `test/engine/mirror.test.ts` (entrance, lights, pop, event).

**Checked:** `npm run typecheck`, all of `test/engine/*.test.ts` and `test/sandbox.test.ts` pass (247 tests).
The Node harness has no GPU or real frame timing, so the 30 fps on the phone tier is by design (small texture, near-only
render list, two lights on one body, governor), not measured.

**For J:** this repo has no `window.hawkesPlaytest`, so there is no scenario. Please have a phone-tier playtest check the
fps. The easiest view is `/play/sandbox` (the mirror opens after the intro); Ctrl+Shift+M shows the fps.
**GPU:** nothing needed, so no estimate. No files touched by the two other agents.
