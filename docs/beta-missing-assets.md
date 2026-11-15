# Sandbox community assets missing on beta (2026-11-08)

**Checked:** `GET https://beta.hawkesgen.ai/v1/play-template/sandbox` (its `gone` list) and `GET /v1/community`, `/v1/community/categories`.

## Finding

Beta's community library is **empty** (`{"items":[],"total":0}`, no shelves). The bundle for the sandbox has `assets: {}` and
`gone` lists **all 53** ids of `src/overseer-games/sandbox.ts` `SANDBOX_ASSETS`: nothing resolves, not just a few.
The cause is that beta's Gen has no starter pack: `syncStarter` (cloud/functions/src/community.ts) fills `communityAssets`
from the starter project `ustg_00000000000000c0` on beta Gen, which holds no `asset.make` jobs. The ids in sandbox.ts are
**live** Gen asset ids, so even a thing made on beta would get a new id and sandbox.ts would have to be remapped per lane.

| Group | Ids gone on beta |
|---|---|
| Vehicles (4x4, speedboat, helicopter, rocket, launch pad) | a_5b069a758ac32489, a_de2b49db6c07ddbf, a_684d31e9de4bbe07, a_11e8d3df79091171, a_f8c34d23977960e7 |
| Trees, bush, rocks, flowers | oak a_3360deb351df9daa, pine a_384334cd70168ed9, bush a_04e385dd742d5a28, rock a_19aebee77f37565e, boulder a_dc56946e844c7904, flowers a_a7ed659b5ed36b2f |
| Props (cottage, bench, fence, mailbox, lamp, lantern, barrel, crate, duck) | a_e2926729398f5648, a_c26613ea7b560e31, a_bed4735621add18b, a_6f2332b9073bd95c, a_38cb16892853ae7e, a_58a1cad3c13eb660, a_31e531682f8104f7, a_843a91d54da816bf, a_84460c8d4b2e652d |
| Textures (planks, old wood, diamond plate) | a_060f6c6ea7f15e43, a_1f7765105ca832ed, a_d6cd6dd006c8c540 |
| Fish (5) | a_3dfc2c1c930c9d3c, a_2dca8b8f15912700, a_76d71b002bac2b77, a_96630d7a5f927828, a_6e4f9f1eed67e96b |
| Overseer voice and mirror lines (13) | a_f5c151efa39d35c9, a_bacd20f46737e756, a_e86b71afc8a4d1c7, a_96af75c7b29f0446, a_e8eb1d1e6dc695fb, a_996ee77e57857b6a, a_045f8213473256ee, a_c0e328781a118af8, a_994bf59af90bf68b, a_76a84299626f8402, a_92afa99ab3bb1365, a_7a79bc1e721339aa, a_2e4236a4f60b4f15 |
| Music, ambience, SFX (13) | a_d998f214d5f7be98, a_f69c9b828dba9342, a_58c72e4ca54f1b54, a_dce85c4cf4bb730b, a_39a9c6daee1e4450, a_67e1ecc6f6db5125, a_d9173a67938251db, a_da988c2a3ef17441, a_36c3b4b30fbf86a5, a_5717103de477ec99, a_dc0dfae4b6bc1da9, a_671a42a3b6f17705, a_59258c64f6975010 |

**Starter story models** (`community/starter.mjs` tag `story`): The Overseer (pearl ship), Rocket, Launch pad, Space capsule,
Lunar lander. None exist on beta (empty library). The live ids for the Rocket and Launch pad are in sandbox.ts; the Overseer
pearl, capsule and lander have no id in the sandbox.

## What was done

Nothing was generated. Three blockers, all outside what this session can do:

1. This session's Gen key has **no access to the beta starter project** (`ustg_00000000000000c0`: "No access to that project"),
   so a model made here cannot land where `syncStarter` reads. Writing `communityAssets` in Firestore directly is not
   possible from the repo.
2. The budget ($0.48 in the brief; J's thread says $3) does not cover the 5 vehicles/props that matter, let alone the
   whole pack. The starter pack is 100+ models plus voice, music and SFX (voice and sound are live-only artists' work).
3. Fresh ids would not match sandbox.ts anyway.

## What to do (needs J or Gen's owner)

- **Best fix:** point beta's `syncStarter` at the live pack: copy the starter project's `asset.make` jobs into beta Gen
  (or give beta's key read access to the live starter project) so the same `a_` ids exist. Then no code changes.
- Otherwise run `node tools/starter.mjs estimate model` then `make model` against beta (J's OK; costs money) and map ids
  per lane.
- Until then beta is correct as handled: the bundle's `gone` list stops the engine requesting them, and the wheel places stand-in
  shapes. Priority if making by hand: 4x4 truck, speedboat, helicopter, rocket, launch pad (the tour's vehicles), then
  trees, rocks, cottage, barrel, crate.
