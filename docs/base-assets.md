# Base assets: what the game must always have

J, 2026-11-05: "Make sure all assets are able to be placed and the player never receives the message this asset is not in your library."

## How an asset reaches a world

| Source | Where it lives | Resolves on beta? |
|---|---|---|
| (a) Repo files | `public/play/models/*.glb` (63: animals, hats, banana, cactus, cone, duck...), `public/play/anim/*.json`, `public/vendor/` | Always |
| (a) Engine stand-ins | The wheel's kinds, species, tools, nature shapes, effects, terrain, weather, disasters, play kits: all made in code (`spawn-core.js local()`) | Always |
| (b) Community ids | Rows in the community library (`communityAssets`, synced from Gen's starter project `usr_00000000000000c0` by `syncStarter`) that point at a Gen asset: the Overseer's featured games (`src/overseer-games/index.ts`: 22 ids, `sandbox.ts`: 14, 25 models, 26 sounds, 3 pictures by name), the Overseer's voice lines (`overseer.js VOICES`: ~40 `a_` ids), and the wheel's library shelves | Only where the Gen project holds the file. **The live library has them; beta (`hawkes-staging`) lacks many.** |
| (c) Unknown | None found: every id in code is one of the above | n/a |

## What was wrong

The wheel's library tiles come from `GET /v1/community`. A row can be listed while its Gen asset is not in the project it points at (beta's Gen has no starter pack). Choosing it ran `POST /v1/games/:id/community` -> `addAsset`, which answered 404 "That asset is not in your library", and the wheel showed that sentence.

## What changed

- `cloud/functions/src/use-community.ts`: a listed row whose asset is gone answers `{ missing: true }` (200) and logs `[portal] community a_... is listed but not in Gen` for developers.
- `public/editor.js`, `public/play/guest.js`: pass `missing` through, no error text.
- `public/play/modules/spawn/spawn.js` `standInFor`: a missing, failed or unanswered library thing is placed as a base stand-in of its kind (model: block, texture: plain wall, picture/video: panel, sound/music: speaker, sky: clear blue), named for the thing, `data.standIn` with the wanted id, and a console warning. The player sees the thing appear; never the old sentence.
- The wheel's own non-library tiles never touch Gen and always resolve. Template ids missing on beta were already dropped by the bundle's `gone` list (`templateGone`).

## Base assets still to make

`hawkes.assets.json` lists all 310 entries (the starter pack, with prompts, and the recipe each uses). Nothing was generated.

| Type | Count | Cost class | Estimate |
|---|---|---|---|
| model | 150 | GPU (image, 3D views, mesh, 3 candidates) | not priced (see below) |
| texture | 30 | GPU (image, 3 candidates) | not priced (see below) |
| sky | 10 | GPU (panorama) | not priced (see below) |
| sprite | 10 | GPU (image + cutout, 3 candidates) | not priced (see below) |
| music | 25 | API (music) | not priced (see below) |
| ambience | 10 | API (sound, cents) | not priced (see below) |
| sfx | 35 | API (sound, cents) | not priced (see below) |
| voice | 40 | API (voice, cents) | not priced (see below) |

**Price: not computed.** `hawkesgen_estimate` answered "No access to project" for `usr_00000000000000c0` from this agent. From J's PC: `node tools/starter.mjs estimate model` (and `texture`, `sky`, `sprite`, `music`, `ambience`, `sfx`, `voice`), then `make <kind>` with J's OK. Models, textures, skies and sprites are the GPU part (190 things x 3 candidates); the audio kinds are API calls of cents each. Cheapest first step that removes most stand-ins: sfx (35), ambience (10), voice (40: the Overseer's lines).

Beta also needs the pack in its own Gen (`beta.hawkesgen.ai`) project, or its rows synced from live, for the library tiles to resolve; until then they place stand-ins.
