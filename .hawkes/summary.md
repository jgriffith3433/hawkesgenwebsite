# Pilot models: person, dog, shoe

**Nothing left to make, and no GPU was spent ($0 of $2.49).** The PM note describes the earlier attempt (c_272e09bd2157), but #80 is already on beta, which this branch starts from, and it holds the real Gen art, not stand-ins.
- The person rig the note says was queued is job j_3bf7bcfa429f. It finished (`blender.character`, biped template, $0.43). Its output is byte-identical in size (2,167,148) to `public/play/models/person.glb`, so that file is the rigged model.
- `person.glb` has the clips ArmR, ArmR2, Head and LegRTip. `dog.glb` has ArmR, ArmR2, Head and LegBRTip. `shoe.glb` is rigid.
- Each model has a `-low.glb`.
- Triangles: near 7,600 / 7,600 / 7,595 (person / dog / shoe), low 2,279 / 2,280 / 2,275. All are within the ~8k limit.
- The registry rows in `presence-model-registry.js` are filled: height, form, anchors and the clip map.
- A failed load falls back to the procedural body (covered by `test/engine/models.test.ts`).
- There is no `pending-gpu.txt` to delete (none exists).

**Checked:** `test/engine/models.test.ts` and `test/playtest.test.ts` pass (20 of 20). That covers the files, the clip names, the head anchor against the model's top, the levels, the fallback and the scenario registration.

**Not checked:** I did not look at the hats, facing or walk in a browser, because none may run on this server. Beta's playtest `gen-models-pilot` plays it (person, dog and shoe in a top hat and a cap, walking, running, jumping and emoting). Please have a playtest look at hat placement and the dog's blotchy bake in game lighting.

**Changed before the full set** (from #80's notes, still true):
- Make the concept vinyl, not plush. The dog came out as fur.
- Make a smaller-texture low level. Even the low files are 1.8–3 MB because the bake is 1024 px.
- The template rig binds whole parts rigidly, so anchors are fixed offsets from the origin and don't follow a bone.
- Clip names come out as bone names. The row's `clips` maps them.

This change adds `.hawkes/scenario.txt` (`gen-models-pilot`) and no code.
