# Animations: one set per rig class

J, 2026-10-25: "Let's start making the animations for them too. Come up with the animation set we need for each and let's
start making an animation set for 1 humanoid and 1 quadruped and 1 inanimate object."

**The decision (J, 2026-10-25):** "Yes make it compatible with Mixamo, this is important so do it right. For the bipedals make
that 'standard' as well and the ones that need to be data driven do that too." So there are three classes and each has one
file of clips (section 3):

| Class | Skeleton | Takes | Clips |
|---|---|---|---|
| `mixamo` | the standard Mixamo skeleton (`mixamorig:Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand` and fingers, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase`, the same on the right: 65 bones) | every biped (the 11 of section 1 once Gen's `mesh.rig` has re-rigged them; a separate task) | Mixamo's own library and the CC0 Quaternius clips fit them, and `public/play/anim/mixamo.json` adds ours |
| `quadruped` | the quad template (15 joints) | dog, fox, sheep, horse | `public/play/anim/quadruped.json` |
| `object` | one `Body`, the whole body | the rigid things | `public/play/anim/object.json` |

**Built so far:** the format, the sampler (`presence-anim.js`), the class files with a starter `idle` and `walk` each, the
`/avatars?body=<id>&pose=<clip>&t=<seconds>` view, the tests, and **the whole quadruped set** (section 2B: 29 clips, made on the
dog and checked on the fox, sheep and horse; section 2B1 below has what it does and where the rig limits it). **Left:** every
other clip of the humanoid and object tables (they are the list to author, in the same files), the Mixamo re-rig of the biped models (until a model has it, the 11 template-rigged bipeds
keep their own GLB clips and the procedural motion; `/avatars?body=person&standin=mixamo` shows the Mixamo class on a
stand-in puppet), importing Mixamo/Quaternius clips (`toDelta` is the conversion), and the object class's named parts (the
toast slices, the teapot's lid).

## 1. What the models are (measured from `public/play/models/*.glb`)

| Rig class | Skeleton | Models that share it | Clips in the file today |
|---|---|---|---|
| **Humanoid** (biped template) | 11 joints: `Hips`, `Spine`, `Head`, `ArmL`/`ArmLTip`, `ArmR`/`ArmRTip`, `LegL`/`LegLTip`, `LegR`/`LegRTip` (limbs have two segments, no fingers, no neck) | person, robot, tvbot, dinosaur, penguin, chicken, cat, pig, bear, cow, rabbit (11) | 4 to 9 template clips named after a bone: `Head` (idle, 2 s), `ArmR` (walk, 1 s), `ArmR2` (run, 0.6 s), `LegRTip` (jump, 0.7 s) |
| **Quadruped** (quad template) | 15 joints: `Root`, `Body`, `Head`, `LegFL`/`FR`/`BL`/`BR` each with a `Tip`, `ArmL`/`ArmR` with `Tip` (the second pair under the body) | dog, fox, sheep, horse (4) | the same four names: idle, walk, run, jump (`LegBRTip`) |
| **Object** (rigid) | none: one mesh node `Body` | toaster, shoe, teapot, cactus, cone, banana, mushroom, potato, duck, rollbot, fish (11) | none: they move procedurally by their `form` (`presence-models.js` motion) |

So the work is **three sets**, not 26. Every model in a class takes the same set, because the bones have the same names.
That is the reason the sets are **data** (section 3), not clips baked into each GLB: one file per class, a few KB, instant to
change, and the 11 + 4 + 11 models all move. A clip a GLB carries still wins for the role it names (the registry's `clips`).

## 2. The sets

Names are the engine's roles and emotes (`presence-models.js ROLE_RE`, `FALLBACK`, the radial emote menu), so the game
asks for `walk` and gets the set's `walk`. **L** = loops, **1** = plays once and returns. Seconds are at the model's own
speed. **P0** = the engine already asks for it, **P1** = needed to feel finished, **P2** = later.

### A. Humanoid (made on the person; all 11 biped-template models take it)

| Clip | L/1 | s | What it does | P |
|---|---|---|---|---|
| `idle` | L | 3.2 | breathe (chest up 2%), arms hang with a 4 degree sway, weight shifts every 3rd breath | P0 |
| `idle_look` | L | 5 | idle, head looks left, right, up at the sky (the Overseer) | P1 |
| `idle_fidget` | 1 | 2.5 | stretch, roll the shoulders, or scratch the head; one random pick every 8 to 12 s | P1 |
| `walk` | L | 1.0 | legs swing 32 degrees, opposite arms, body bobs 4 cm twice a stride, head steady | P0 |
| `run` | L | 0.6 | legs 55 degrees, 12 degree forward lean, arms pump, hips bob 9 cm | P0 |
| `jump_start` | 1 | 0.25 | crouch (80 ms), stretch up, arms rise | P1 |
| `jump` | L | 0.7 | in the air: legs tuck, arms up | P0 |
| `fall` | L | 0.9 | arms up, legs bicycle, 8 degree lean | P0 |
| `land` | 1 | 0.3 | squash 0.82 then spring with one overshoot, arms out for balance | P1 |
| `swim_idle` | L | 2 | upright treading water, arms sweep | P1 |
| `swim` | L | 0.9 | prone, 70 degrees forward, arms stroke, legs flutter | P0 |
| `sit` | L | 4 | seated, hands on knees, feet swing a little | P0 |
| `sit_down`, `stand_up` | 1 | 0.6 each | the way in and out of `sit` | P1 |
| `sleep` | L | 4 | curled on the side, slow breath | P0 |
| `drive` | L | 2 | seated, hands on a wheel, head turns with it | P1 |
| `wave` | 1 | 1.6 | the right arm up, hand waves 3 times | P0 |
| `dance` | L | 2.4 | hop step, hips swing, arms alternate overhead | P0 |
| `cheer` | 1 | 1.4 | crouch, jump with both arms up | P0 |
| `laugh` | 1 | 1.6 | head back, shoulders shake, one hand on the belly | P0 |
| `point` | 1 | 1.2 | right arm straight ahead, head follows it | P0 |
| `clap` | 1 | 1.6 | hands together in front six times, a little bounce | P0 |
| `thumbsup` | 1 | 1.2 | right arm bent up, a nod | P0 |
| `heart` | 1 | 1.6 | both arms over the head forming a loop | P0 |
| `shrug` | 1 | 1.2 | shoulders up, arms out, head tilts | P1 |
| `bow` | 1 | 1.4 | bend at the spine, arm across the chest, rise | P2 |
| `hurt` | 1 | 0.5 | flinch back, arms in | P1 |
| `knock_down`, `get_up` | 1 | 0.9, 1.1 | thrown onto the back by an explosion; sits up and stands | P1 |
| `fish_cast`, `fish_reel` (L), `fish_catch` | 1, L, 1 | 1.0, 0.8, 1.6 | the rod: swing back and forward; lean and crank; hold the fish up | P2 |
| `aim` | L | 1 | both arms forward holding a launcher (an upper-body layer over walk/idle) | P2 |

### B. Quadruped (made on the dog; fox, sheep, horse take it)

| Clip | L/1 | s | What it does | P |
|---|---|---|---|---|
| `idle` | L | 3 | breathe, tail swings slowly, an ear flick, head turns | P0 |
| `idle_sniff` | L | 3 | head down to the ground, snuffles, tail up | P1 |
| `idle_fidget` | 1 | 2 | scratch behind the ear with a hind leg, or shake the head | P1 |
| `walk` | L | 1.0 | diagonal pairs, back rolls, tail swings | P0 |
| `trot` | L | 0.7 | a quicker diagonal gait with a bounce | P1 |
| `run` | L | 0.5 | gallop: bounding pairs, back stretches 1.1, ears back | P0 |
| `jump_start` / `jump` / `land` | 1 / L / 1 | 0.25 / 0.7 / 0.3 | crouch and push; front legs reach, hind legs trail; land on the front legs first | P0/P1 |
| `fall` | L | 0.9 | legs spread, tail up | P0 |
| `swim` | L | 0.9 | paddle with all four, head up | P0 |
| `sit` | L | 4 | haunches down, front legs straight, tail sweeping the ground | P0 |
| `lie_down`, `sleep` | 1, L | 0.8, 4 | down on the belly then curled with the nose on the tail | P0 |
| `drive` | L | 2 | sits up on the seat, ears back | P1 |
| `wave` | 1 | 1.6 | sits and lifts one front paw, three shakes (the dog's "hello") | P0 |
| `dance` | L | 2.4 | hops on the hind legs, front paws up, turns | P0 |
| `cheer` | 1 | 1.4 | rears up on the hind legs, front paws high | P0 |
| `laugh` | 1 | 1.6 | head back, mouth open, a bark-pant, chest shakes | P0 |
| `point` | 1 | 1.2 | the "pointer" pose: nose forward, one front paw up, tail rigid | P0 |
| `clap` | 1 | 1.6 | front paws pat the ground in turn | P0 |
| `thumbsup` | 1 | 1.2 | tail wag fast, a nod | P0 |
| `heart` | 1 | 1.6 | play-bow with a spin and the tail high | P0 |
| `bark` | 1 | 0.8 | head up and a lunge forward | P1 |
| `shake_off` | 1 | 1.2 | the wet-dog shake from the head back to the tail | P1 |
| `shrug` | 1 | 1.2 | head tilt, one ear down, a small sigh | P1 |
| `hurt` | 1 | 0.5 | yelp: body tucks, tail between the legs | P1 |
| `knock_down`, `get_up` | 1 | 0.9, 1.0 | tumbles onto its side; rolls over and shakes | P1 |

### B1. The quadruped set as built (`public/play/anim/quadruped.json`)

The file is written by `tools/make-quadruped-clips.mjs` (`node tools/make-quadruped-clips.mjs`): each clip is a function of the
cycle that lays rotations on bones, and the file keeps the sampled keys (loops 8 to 24 keys, spline, so they close; a one-shot
ends at rest unless it is a pose to stay in: `lie_down`, `knock_down`). Edit the tool, run it, look at `/avatars?body=dog&pose=<clip>&t=<s>`.

**What the rig is** (measured from the four GLBs, `test/engine/anim.test.ts` reads the same):
- `Root > Body > Head`, and `LegFL/FR/BL/BR` hang from `Body`, their hips close to Body's own pivot: pitching Body rocks the torso on
  its legs, so every pitch turns the four legs back by the same angle (`Pose.legs`) to keep the paws where they were.
- The legs are one rigid segment, and the dog's front legs rest leaning 28 degrees forward (the hind ones 11 back). A paw is on the
  ground for a front angle of about 0 to +10 degrees and a hind one of -25 to +5; leaning further forward lifts a front paw, further
  back a hind one. The gaits are windows in those ranges (`swing()` in the tool), with the whole body's bob doing the rest.
- **`ArmL`/`ArmR` on the dog are a second pair of limbs under the body that the mesh does not use**: no vertex of the dog, fox or horse
  is weighted to them (the sheep's two small `arm_l`/`arm_r` meshes are, and are left at rest). The `Tip` bones move no vertex on the
  dog, fox or horse either (the legs have no knee). So the set uses `Root`, `Body`, `Head` and the four legs, and never names an Arm.
- **There is no tail or ear bone.** The dog's tail and ears are part of its body and head meshes; the fox's and horse's tails are part
  of the body mesh, which is weighted to `Body`, `Root` and the legs, so **a tail moves with the hind legs and Body's yaw**. A tail wag
  is Body's yaw (the head is turned back against it to stay steady), an ear flick is a small roll of the head.
- The leg meshes are weighted across legs (the fox most, its hind legs pull the torso), so big hind rotations smear the fox's body.
  The set keeps hind folds under about 70 degrees and a gallop's under 40; a re-rig with cleaner weights, knees and a tail bone is the
  way to better feet and tails.

**What is in it, in the engine's terms:** `idle`, `walk`, `run`, `jump`, `fall`, `swim`, `sit`, `drive` are roles (`ROLE_CLIPS`); the
quadruped's `walk` becomes **`trot`** above 2.4 m/s; `jump_start` and `land` are the take-off and landing one-shots; **after 8 to 12 s
standing still** the player plays `idle_sniff` (a loop of 3 s) or `idle_fidget` (a one-shot) once, and a step cancels it; `sit`, `sleep`,
`wave`, `dance`, `cheer`, `laugh`, `point`, `clap`, `thumbsup`, `heart` and `shrug` are the emote wheel's names. `lie_down`, `bark`,
`shake_off`, `hurt`, `knock_down` and `get_up` have no trigger yet: they play from `/avatars` and from `rig.emote = { def: { name } }`,
and wait for the wheel entries, a damage event and Juice's ragdoll to call them. The registry's quadruped rows now carry a `stride`
in body heights (`quadStride`: walk 1.0, trot 2.0, run 3.4 heights a cycle) so the feet do not skate at the old 1.6 and 4.5 m.

**The gaits:** the walk lands its feet in diagonal pairs a little apart (left front at 0, right hind at 0.12, right front at 0.5, left
hind at 0.62: four beats in two pairs), the trot lands each pair together (0 and 0.5) with a bounce twice a cycle, and the run is a
gallop (the front pair reaches while the hind pair pushes, the back stretches to 1.1 in the extended flight and gathers to 0.97, the whole
body rises in the two flights and the head stays level). Footsteps are events on all three, at the moment the foot lands.

### C. Object (made on the toaster; the ten other rigid models take it with their own proportions)

There is no skeleton, so a clip moves the one `Body` node (position, rotation, scale) and, for a model that has them, named
procedural parts (the toaster's two toast slices, the teapot's lid, the shoe's tongue). The toy rule holds: squash and
stretch keeps volume (scale y by k and x/z by 1/sqrt(k)).

| Clip | L/1 | s | What it does | P |
|---|---|---|---|---|
| `idle` | L | 3.2 | squash and stretch breathing (1.0 to 1.025), a tiny sway, it looks around by turning 8 degrees | P0 |
| `idle_fidget` | 1 | 1.5 | the signature gag: the toaster pops one slice half way and drops it; a teapot rattles its lid | P1 |
| `walk` | L | 1.0 | waddle: roll 8 degrees side to side, hop 6 cm, a tiny squash on each step | P0 |
| `run` | L | 0.6 | lean 18 degrees, bounce 9 cm, squash on every landing, stretch in the air | P0 |
| `jump_start` / `jump` / `land` | 1 / L / 1 | 0.25 / 0.7 / 0.3 | squash to 0.8, stretch to 1.15 and launch; tuck and spin a quarter turn; squash then wobble | P0/P1 |
| `fall` | L | 0.9 | tumbles slowly around its middle | P0 |
| `swim` | L | 2 | floats: bobs 4 cm, drifts in a slow turn | P0 |
| `sit` | L | 4 | settles low (scale y 0.9), still but breathing | P0 |
| `sleep` | L | 4 | tilts 14 degrees onto one side, a slow breath (the face closes its eyes) | P0 |
| `wave` | 1 | 1.6 | tilts forward and back like a bow, three times | P0 |
| `dance` | L | 2.4 | hops in time, spins a half turn each beat, the parts flap | P0 |
| `cheer` | 1 | 1.4 | squash then a high jump; both slices pop up | P0 |
| `laugh` | 1 | 1.6 | shakes quickly side to side, a little squash on each beat | P0 |
| `point` | 1 | 1.2 | leans toward the target and a slice shoots out that way | P0 |
| `clap` | 1 | 1.6 | presses down and pops back up six times | P0 |
| `thumbsup` | 1 | 1.2 | one slice pops up and stays, a nod | P0 |
| `heart` | 1 | 1.6 | pulses 1.0 to 1.15 twice, glowing | P0 |
| `shrug` | 1 | 1.2 | tilts to one side then the other, the parts droop | P1 |
| `hurt` | 1 | 0.5 | squash-jolt and the parts fly off a little | P1 |
| `knock_down`, `get_up` | 1 | 0.9, 1.2 | tips over onto its side; rocks up and settles | P1 |

Other forms get the nearest set and the form's own motion for the rest: `bird` (penguin, chicken) takes the humanoid set
with wings for arms; `swimmer` (fish) has its own `swim`, `flop` (on land) and `idle`; `roller` (rollbot) rolls with the
distance travelled; `legless` (duck) takes the object set with a waddle.

## 3. How the clips are made and played

### The file

`public/play/anim/<class>.json` (`mixamo`, `quadruped`, `object`; served with open CORS, one fetch a class, loaded by
`P.anim.load(cls)` when a model of the class is built):

```json
{ "class": "mixamo", "version": 1, "clips": {
  "walk": { "loop": true, "seconds": 1.0, "ease": "spline",
    "events": [{ "t": 0, "name": "footstep", "foot": "L" }],
    "tracks": { "LeftUpLeg": { "rot": [[0, -22, 0, 0], [0.25, 0, 0, 0], [0.5, 22, 0, 0], [0.75, 0, 0, 0]] },
                "Hips": { "rot": [[0, 0, -5, 0]], "pos": [[0, 0, -0.011, 0], [0.25, 0, 0.011, 0]] } } } } }
```

- **Per clip:** `loop` (true loops; false is a one-shot that holds its last key), `seconds` (at the model's own speed: a walk
  of 1.0 plays at `stride.walk`, 1.6 m/s, and speeds up and slows down with the body), `ease` (`spline` Catmull-Rom through
  the keys, no stop at each one: the default for a loop; `smooth` ease in and out between keys, the default for a one-shot;
  `linear`), `tracks`, `events`.
- **A track** is a bone name with keys. A key's first number is the time, 0 to 1 of the clip, rising, and a loop wraps from
  its last key to its first. `rot` is `[t, rx, ry, rz]` in degrees, applied z, then x, then y (Babylon's yaw / pitch / roll);
  `q` is `[t, x, y, z, w]` instead. `pos` `[t, x, y, z]` and `scl` `[t, sx, sy, sz]` belong to the bones that move as a whole:
  `Hips` (mixamo), `Root` and `Body` (quadruped), `Body` (object). `pos` is in **model heights** (0.05 is a twentieth of the
  character's height), so any size takes the same clip. A clip that squashes keeps volume (`sy` up, `sx` and `sz` by
  `1 / sqrt(sy)`).
- **Events** `{ t, name, ...anything }` fire once as the clip passes `t` (a loop's wrap included) to the listeners of
  `P.anim.on((name, rig, event) => ...)`: `footstep`, `hop`, a prop pop. Nothing listens yet (the footsteps will drive sound).
- **Bone names:** `mixamorig:`, `mixamorig7:`, `mixamorig_` and no prefix are the same bone (`P.anim.norm`). A bone the model
  lacks is skipped; a bone **the class skeleton lacks fails the test** (`P.anim.validate`, `test/engine/anim.test.ts`, which
  reads the real GLBs' joints and, for Mixamo, a Mixamo-rigged GLB once there is one, else `test/fixtures/mixamo-skeleton.json`).

### Deltas on the rest pose (and how rest differences are handled)

Every rotation is a **delta from the model's rest pose, in the model's axes at rest** (glTF: y up, the front +z, x the
character's **left**): `local = restParent⁻¹ · delta · restParent · restLocal`. So `rx > 0` pitches a hanging limb back and
nods a head down, `ry > 0` turns to the left, `rz > 0` rolls to the right (the left arm, which rests along +x, drops with
`rz < 0`), whatever the bone's own axes are: the quadruped template's legs are turned 130 degrees in the file, and a clip never
knows. The deltas of a chain compose (a forearm's delta is relative to its arm's pose), as in a Mixamo clip.

A Mixamo library clip stores absolute local rotations; `P.anim.toDelta(abs, rest, restParentWorld)` converts one
(`rp · abs · rest⁻¹ · rp⁻¹`) when the library is imported.

**MIA rig against Mixamo's own.** Mixamo clips assume Mixamo's T-pose. Gen's `mesh.rig` may rest a character differently (an
A-pose, a bent knee). On binding, the arms and legs are **measured**: the direction of each limb bone to its child at rest is
compared with Mixamo's (arms along +x and -x, legs down), and the difference becomes a **fix** put before every clip delta
(`delta · fix`), so a clip reads the same on an A-pose rig and a T-pose rig (`test/engine/anim.test.ts` holds the hands to
5 cm). Twist about a limb's own axis is not measured (the measuring is by direction). A row can set `restFix: false`
(trust the rest as it is) or `restFix: { LeftArm: [rx, ry, rz] }` (degrees, instead of the measured one) for a model the
measuring gets wrong. The quadruped and the object have one rest each, their template, so nothing is measured for them.
The skeleton must fit: a model that lacks the class's key bones (`P.anim.CLASSES[cls].need`) does not take the set at all
(`/avatars` says "unfit" and the bones missing), which is how a biped that still has the old 11-joint template rig keeps its
own GLB clips.

### Playing

`presence-anim.js` (`P.anim`, registered in `module.json` before `presence-models.js`, whose changes are a small hook in
`animate()`): a **Player** per rig keeps one looping layer (what the body is doing) and one-shots over it.
- **Roles to clips** (`P.anim.ROLE_CLIPS`): `idle`; `walk` (then `run`); `run` (then `walk`); `jump` (then `fall`); `fall`
  (then `jump`); `swim`; `drive` (then `sit`) when seated in a vehicle; an emote is its own name (`wave dance cheer laugh point
  clap thumbsup heart shrug sit sleep`); `jump_start` and `land` are one-shots at take-off and landing when the set has them.
- **Blends** of 0.15 s (`P.anim.FADE`): a new loop fades in while the old fades out; a one-shot fades in over the loop, moves
  only the bones it names (a wave leaves the legs walking), and fades out when the emote ends or the clip does.
- **A role with no clip in the set** goes on to the GLB's own clip for it (the registry's `clips`), and then to the procedural
  motion by form (`gait`, `bodyEmote`); `run` with no run clip anywhere takes the set's walk, faster. The set wins where it
  has the exact clip.
- **Object class:** `Body` is the rig's mover, the node around the body's middle that already squashes and hops it, so the
  hats and everything worn follow; `pos` y is added to the hop, `rot` to its tilt, `scl` to its squash.
- **Which class:** the registry row's `rig` (`mixamo | quadruped | object | none`), else from `form`: `biped` and `bird` ->
  `mixamo`, `quadruped` -> `quadruped`, `thing` and `legless` -> `object`; `roller` and `swimmer` have none (the roll with the
  distance and the fish's swim stay procedural) unless the row says so.
- **Cost:** a bone is three quaternion products; ten walking characters are about 0.3 ms of animation a frame in Node, out of
  view nothing is sampled, and the data adds no draw calls or triangles (`test/engine/anim.test.ts`).

### Seeing a clip

`/avatars?body=<id>&pose=<clip>&t=<seconds>` draws any clip of the model's class at that moment from the data (a loop
repeats): `body=dog&pose=walk&t=0.5`, `body=toaster&pose=walk&t=0.25`, and for the Mixamo class on the stand-in puppet
`body=person&standin=mixamo&pose=walk&t=0.5`. The pose buttons list the clips of the set. `window.hawkesAvatars.anim()` says
which class, whether it is ready or unfit, and the clips. The playtest scenario `avatar-animations` takes these frames.

### Why data and not baked GLBs

One file per class instead of 26 re-exported models (each carries its clips: the dog is 3.3 MB today); a clip is changed and
seen in the showcase in seconds; no GPU, no server, no cost; a new model with the same rig is animated the day it is added,
and Mixamo's library fits the Mixamo class as it is. The Gen route (`blender.character` `pose`, `loop`, `concat`, `retarget`,
library clips from Quaternius) remains for a hero character that earns baked clips, and these clips can be baked through it
(`pose` ops are the same bone rotations) if a Unity export ever needs them.

## 4. Done when

For each of the three classes the P0 and P1 clips exist, `/avatars?body=<id>&pose=<clip>&t=<seconds>` renders any frame of
any clip so a review can judge it, a video of each clip is attached to the change, the pose names match the table, the
clips keep the toy principles (docs/characters.md section 2: squash and stretch keeps volume, anticipation, follow-through,
no linear timing), `npm test` covers the sampler, the blending and that every clip's bones exist in its class's skeleton,
and the phone tier keeps 30 fps with ten characters animating.
