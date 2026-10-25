# Animations: one set per rig class

J, 2026-10-25: "Let's start making the animations for them too. Come up with the animation set we need for each and let's
start making an animation set for 1 humanoid and 1 quadruped and 1 inanimate object."

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

A clip is **data** (`public/play/anim/<class>.json`): per clip `{ loop, seconds, ease, tracks }`, where a track is a bone (or
`Body`) with keys `[t, rx, ry, rz]` (degrees, 0 to 1 of the clip's time) and optionally `[t, x, y, z]` for position and
`[t, sx, sy, sz]` for scale, plus `events` (a sound or a particle at a time: footsteps, the toast pop). The engine side is
a small sampler in `presence-models.js`: it blends between clips over 0.15 s, applies one-shots over the loop, keeps the
procedural parts for what a clip does not touch, and plays through the same `animate(rig)` so every pose in the `/avatars`
showcase, every emote in the game and the mirror use it.

Why data and not baked GLBs: one file per class instead of 26 re-exported models (each carries its clips: the dog is
3.3 MB today); a clip is changed and seen in the showcase in seconds; no GPU, no server, no cost; a new model with the
same rig is animated the day it is added. The Gen route (`blender.character` `pose`, `loop`, `concat`, `retarget`, library
clips from Quaternius) remains for a hero character that earns baked clips, and these JSON clips can be baked through it
(`pose` ops are the same bone rotations) if a Unity export ever needs them.

## 4. Done when

For each of the three classes the P0 and P1 clips exist, `/avatars?body=<id>&pose=<clip>&t=<seconds>` renders any frame of
any clip so a review can judge it, a video of each clip is attached to the change, the pose names match the table, the
clips keep the toy principles (docs/characters.md section 2: squash and stretch keeps volume, anticipation, follow-through,
no linear timing), `npm test` covers the sampler, the blending and that every clip's bones exist in its class's skeleton,
and the phone tier keeps 30 fps with ten characters animating.
