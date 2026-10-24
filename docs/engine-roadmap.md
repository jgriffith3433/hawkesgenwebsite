# The engine roadmap: "anything you can imagine"

J, 2026-10-23: *"Spawn 100 animals and blow them up with rockets, spawn a large bucket of water over someone, dig a giant
hole, fly an airplane or helicopter, spawn a mountain and a 4x4 and drive up it, go fishing, submarines, boats, bicycles,
AI friends, houses and everything that goes in houses, TV shows inside the TV in the house. It goes on and on. … After
you are done I want to feel like what I can do in the game is truly limitless: it just depends on my imagination and
how many credits I have."*

This is about the **engine** (public/play/), not art. Every feature must work with primitives and stand-ins today and
look better the moment a model, texture or sound arrives (from the community library or Gen). The assistant must know
every feature, so "spawn 100 cows and give me a rocket launcher" just works.

## Where the engine is (2026-10-23)

- No physics engine: hand-written axis-aligned boxes (runtime.js `step`, `sweep`), no rotation, slopes, joints,
  forces or broadphase (O(n²)); things that overlap stay overlapped.
- 16 entity kinds in one `switch` (`fromSpec`); a new kind touches 8 places (runtime, scene.ts `TYPES`, WORLD.md,
  entities.js, build.js, API.md, makers in `makeGame`, `Entity.destroy`).
- No terrain, no water, no instancing, a material per entity, every mesh a shadow caster.
- Multiplayer: everyone simulates; owner/host authority per thing; only dynamic scene entities' poses are synced.
- The assistant reads WORLD.md + API.md once per server process (cached).
- No automated tests of the client engine.

## How the work is split

Phase 1 is one session, alone: it changes the core every other workstream builds on. Phase 2 workstreams run in
parallel, each in **its own files**, each a pull request into `beta`. Phase 3 pulls it together.

### Phase 1 — Foundation (one session)

1. **Modules.** One manifest (`public/play/modules.json` or similar) lists the engine's script files; play.html,
   entities.html and build.js load from it (no hard-coded `<script>` lists, one cache-busting version).
2. **Kind registry.** `H.kinds.register(type, { build, defaultPhysics, destroy, maker, editor: { word, lift, motion,
   textureable, hotbar }, codex })`. The 16 kinds move into it (their own file). `fromSpec`, `Entity.destroy`,
   `game.<maker>`, build.js and entities.js read from it. scene.ts validates kinds against a list modules extend
   without editing the same line (e.g. a JSON file of kinds per module).
3. **Real physics: Havok** (Babylon Physics v2, `@babylonjs/havok` wasm from the CDN), behind `H.physics`: rigid bodies
   with rotation, convex/mesh/heightfield shapes, joints, forces and impulses, raycasts and shape casts, sleeping,
   collision events, layers/filters. The player becomes a proper character controller on it (slopes, stairs, standing
   on moving things). Keep what exists working: push, carry, bounce, triggers, `hit`/`leave`, `kinematic`, `ghost`,
   `held`. Fixed step, deterministic enough for host authority.
4. **Feature seams.** `H.features.register(configKey, { apply, dispose })` for world-level things (terrain, water,
   weather, time of day) so each owns a `config` key and a file. `H.controllers.register(mode, ...)` so walking,
   flying, driving and swimming are each a controller (flight moves out of runtime.js). `H.tools.register(...)` for
   things the player holds and uses (gun, rocket launcher, shovel, bucket, fishing rod, spawn gun).
5. **Scale.** Instancing / thin instances and shared materials for many copies of a thing; a shadow budget; LOD for
   primitives too; a spawn budget that degrades gracefully (100+ animals at 60 fps on a laptop, playable on a phone).
6. **Networking seam.** A sync registry so modules sync their own state (vehicle state, terrain edits, water level)
   and a host-authoritative pattern for explosions and mass physics (the host claims what it pushes); throttled,
   delta-encoded transforms.
7. **Docs per module.** WORLD.md and API.md are assembled from one section per module (e.g. `public/play/docs/*.md`),
   and gameai.ts reads them fresh (no process-lifetime cache), so each workstream documents itself without conflicts.
8. **Engine tests.** An automated check that loads the engine in a headless browser (or Babylon NullEngine + Havok in
   Node) and runs scenarios: things fall and stack, the player walks up a slope, 200 bodies stay above N fps, kinds
   build from specs, a module registers a kind. Runs in `npm test` / CI.

Done when: every existing template and game still plays (no behavior regressions), the codex shows every kind from the
registry, a sample module in its own file adds a kind + a tool + a controller with no edit to runtime.js, and the tests
run in CI.

### Phase 2 — Workstreams (parallel; each its own files, its own PR into beta)

| Workstream | What players can do |
|---|---|
| **A. Vehicles** | Get in and out (E), drive and ride: car, 4x4 with suspension that climbs mountains, bicycle, motorbike, boat, submarine, airplane, helicopter. Seats for friends. Works with any model as the body (stand-in shapes until a model exists). Synced in multiplayer. Boats and subs use D's buoyancy |
| **B. Mayhem** | Tools: rocket launcher, grenade, spawn gun, gravity gun, lasso. Explosions with real impulses, fire, smoke, debris; breakable things that shatter into pieces; ragdoll-ish tumbling animals; spawn 100 of anything at once ("spawn 100 cows") within the scale budget |
| **C. Terrain** | Heightmap terrain: spawn a mountain, hills, an island, a canyon from words; dig a giant hole and pile dirt (shovel, explosions leave craters via an event); paint ground textures; physics heightfield; synced edits |
| **D. Water** | Oceans, lakes and pools with waves; swimming and diving; buoyancy for anything; underwater look; a bucket of water dumped on someone (splash, wet, knock-down); rain; **fishing** (rod, cast, bite, reel-in minigame, fish species, a catch log) |
| **E. Living things** | Creatures and NPCs with goals: herds, flee, follow, sleep, eat; pathfinding over terrain; **AI friends** you talk to (an LLM through the portal, paid with credits, with memory) who follow you, help, drive, play; animated models (Gen rigs and motions) |
| **F. Homes & media** | Build houses room by room; furniture that works (sit on chairs and sofas, lie in beds, open fridges and doors, flick lights, run taps); **TVs that play shows** (video assets: add a `video` kind to Gen's KINDS), radios, phones, computers with screens |

Rules for every workstream:
- Your files only: `public/play/<module>.js` (and more files of your own), your doc section(s), your test scenarios, your
  line in the kinds list. Touch runtime.js only through the seams; if a seam is missing, add the smallest hook and say so
  in the PR.
- Everything works with no art (primitives and stand-ins), and picks up models, textures and sounds by name.
- Multiplayer: sync through the sync registry; decide who's authoritative.
- Phones: touch controls for everything you add.
- Tell the assistant: your doc section, and examples in words ("drive the 4x4 up the mountain" → which ops/scripts).
- Tests: scenarios in the engine tests; `npm run typecheck` and `npm test` green.

### Integration (after A–F)

One animal system (living owns animals; mayhem uses it), core hooks (`H.hooks.game`, one `explosion` event, the shared
`H.use` E-key registry, `H.audio.master`, physics fixes), terrain over an existing ground, no paid AI friend talk (J:
not for now; friends use the free phrasebook), and **assets by id** (J: "pass ids around"): the bundle carries Gen
asset ids, words are labels (`config.assets[word] = {ids, mix}`), `H.assets.for(word)` / `pick(word, seed)`, specs
store the chosen id, using a community item is explicit replace vs variant.

### Phase 3 — Fun (J's picks, 2026-10-23)

J: "make this a fun game people will like playing." Each is a workstream in its own files where it can be; run 3–4 at a
time (more overloaded the API).

1. **Play before signing up.** The landing page drops you into a live sandbox, no account; sign up to save, build or
   share, and the session carries over.
2. **Spawn wheel, 3 layers deep: type → category → asset**, from the kind registry, the community library (ids) and the
   game's assets. Hold Q (desktop radial), a button and a 3-step sheet on phones, gamepad too.
3. **Netcode and undo.** Snapshot interpolation (render ~100 ms behind a buffer), prediction and reconciliation for your
   own player and vehicle, interest management, host hand-off. Undo/redo for world edits; rewind or reset to a world
   snapshot while playing. (Later option: the room's simulation on the server, since the engine runs headless in Node.)
4. **Events and quests.** One generic `when → if → do` system in scene.json (triggers, timers, counters, variables,
   conditions, actions) the assistant writes from words; disasters (tornado, meteor, flood, zombie night) are event
   actions; quests from NPCs and AI friends run on it. J: the logic kit is the assistant making whatever logic you need,
   so the engine must make any behavior possible.
5. **Juice.** Material impact sounds, ragdoll players and creatures, hit-stop, slow-mo, shake, particles, day and night,
   weather, camera polish. J: "all of it".
6. **Presence.** Name tags over players, friends, NPCs and pets; speech bubbles; emotes; avatar customization; who's
   here; friend markers; spectate.
7. **Sharing and the trailer.** Photo mode, "clip that" (the last 15 s), share links with clips, a cinematic camera
   (paths, orbit, letterbox) J uses for the demo and trailer.
8. **Loading speed.** Time-to-first-frame target (~2 s on a phone); load only the modules a world uses; draw distance,
   culling, LOD for everything, compressed textures, cached Havok wasm, streaming; phone-first budgets that never cap
   desktop.
   **Textures by level of detail** (J, 2026-10-23: library textures are megabytes; network and memory are the limits, and
   Safari reloads the page when it runs out of memory): every texture gets smaller variants (e.g. 128, 256, 512, 1024,
   WebP) made once when it enters the library or a game, kept on the asset by id; scenes load the smallest first and
   upgrade only what's near and big on screen while there's headroom; a per-device texture memory budget (strict on iOS
   Safari) downgrades the least visible first so the page is never killed; KTX2/Basis GPU compression measured and used
   where it pays; the textures baked inside models get the same treatment.
9. **Featured games** (the Overseer's): showcase worlds with quests, NPCs and AI friends as the soul (island adventure,
   mountain off-road, fishing village, mayhem playground, dream house) and the existing templates upgraded; Studio
   playtest scenarios for each.

Also: safety for user-made games (chat filter, report/block, checks on what the assistant builds); fun analytics through
Gen's player analytics; one input layer for touch, keyboard/mouse and gamepad.

## Process

- Sessions work in their own git worktrees on their own branches, cut from `beta`, and open PRs into `beta`; the managing
  session reviews and merges. Never push `main` (going live is J's `DEPLOY hawkesgenwebsite`).
- **Git auth: always use the stored token**, never the credential manager (it pops a sign-in window nobody can answer):
  `git -c credential.helper= -c credential.helper=store <fetch|pull|push> ...`. No `gh` on this PC.
- No GPU spending (no Gen jobs) without J's OK; the engine must not need art to work.
