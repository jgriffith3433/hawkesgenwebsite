# Characters: the look, the movement, the budget

One art direction for every body a player can be (`presence-core.js WHATS`, drawn by `presence-bodies.js`, `presence.js`
for the person, `living/species.js` for the animals). This is the **target**. The person is built to it (section 5b); every other body is still a stand-in in the table at the end,
and `/avatars` is the tool that shows them, side by side, so the art pass can be judged against this page. Tone of the world: warm, a little absurd, never scary (the Overseer is dry, the
bodies are not).

## 1. The look: a soft toy

Everything reads as one family of vinyl toys on a shelf. Stylized, never realistic.

- **Form.** Rounded: no sharp box edges anywhere (corner radius at least 12% of the part's smallest side; `softBox`
  for anything boxy). Limbs are capsules or tapered tubes, never cylinders with flat caps showing. Big simple masses,
  few of them: a silhouette must read as the body at 24 px tall.
- **Proportions** (head : whole body, by class; the height is `WHATS h`, feet on y = 0 at every scale):
  biped 1 : 2.6 (head about 38%), quadruped 1 : 3, thing-with-legs 1 : 2 (the thing is the head),
  legless and roller 1 : 1.6. Legs are short and thick (leg length at most 30% of the height, thickness at least 0.16 of
  it), arms stop above the knee, hands and feet are balls and pads, never fingers. `shape` (tall, wide, tiny...) scales
  the whole figure and must not break these.
- **Palette.** Every body gets three colors from its look (`body`, `accent`, `detail`), and one function makes every
  tone from them, so a color picked by a player always looks designed: `palette(look)` returns
  `base` (the pick), `shade` (base with lightness at -18% and hue turned 8 degrees toward blue: the underside, the
  legs), `light` (+10% lightness, 6 degrees toward yellow: the top), `rim` (the light's color at 70% over base: the
  rim light), `eye` (always near-white `#fbfbf6`), `ink` (`#14161d`, pupils and mouths, never pure black) and `cheek`
  (accent at 45% toward pink). Parts take their color from this set, never from a literal. The 12-color picker
  (`LOOK.palette`) and the skin tones all pass through it, and the check is a swatch row in `/avatars`.
- **Light.** One soft key from the world plus a **rim light** on every body: a fresnel term on the one shared
  material (`emissiveFresnelParameters`: edge `rim`, center black, bias 0.2, power 2.5) so a body keeps its shape against
  a dark night and a bright day. Shading is two soft steps (light / shade) from vertex color or a 2-texel gradient ramp,
  not a smooth realistic falloff. No specular glints except the eyes.
- **Edge.** The fresnel edge is the outline. A hero (the player's own body, and the one in the mirror) may add a
  thin inverted-hull outline (1.5% of the height, `ink` at 55%), one extra draw call; nobody else pays for it.
- **Eyes.** The face lives on the eyes: each about 11% of the head's width, two or three times what the stand-ins have,
  pure white spheres with a large dark pupil and one specular dot. They **follow**: pupils turn toward the look target
  (the camera by default, else the nearest thing the character is facing or whatever it was told to watch, by
  `lookAt(point)`), clamped to the eye, with the head turning a third of the way after 0.25 s. Things with no eyes yet
  (cone, banana...) get them in the same size.
- **Mouth and brows.** A small system, not a texture per mood: a mouth is one curve mesh with three controls
  (`open`, `smile`, `width`), a brow is a thin capsule per eye with `raise` and `tilt`. Seven expressions are
  combinations of those five numbers: `neutral`, `happy`, `surprised`, `sad`, `angry`, `sleepy`, `mischief`
  (the `/avatars` picker). A face that is not a mouth (the TV's screen, the duck's beak, the toaster's slots)
  is told the same five numbers and draws them its own way. Expressions blend over 0.15 s and the emotes (wave, dance,
  laugh...) set one on their own.
- **No realism.** No fur, feathers, scales or cloth as geometry or texture; one flat toy surface with the palette. No
  anatomy beyond what the silhouette needs. Hats and extras stay where they are (`rig.neck`, `faceY`, `faceZ`) so all of
  them still fit everything.

## 2. Movement: squash and stretch, never stiff

All motion is procedural (no clips, no rig files: the bodies are built from joints in code), driven by the same few
numbers on every body so a crowd moves like one cast. Speeds below are `rig.speed` in m/s.

| Principle | What it means here |
|---|---|
| **Idle breathing** | The body scales 1.0 to 1.025 in y (and 1.0 to 0.985 in x/z) on a 3.2 s sine; the head lags 0.1 s behind. Always on, never a still frame. A character that has not moved for 8 s shifts weight or looks around once. |
| **Blink** | Both lids close in 80 ms and open in 120 ms every 2.5 to 6 s (random, not rhythmic); 15% are double blinks. Sleepy keeps them half closed. |
| **Squash and stretch** | Volume is kept: scale y by k and x/z by 1/sqrt(k). Landing squashes to 0.82 (90 ms) and recovers over 220 ms with one overshoot to 1.05; a jump's launch stretches to 1.15; a hard turn leans into it. |
| **Anticipation and follow-through** | A jump crouches for 80 ms first. A stop settles with the body 0.05 s after the feet. Hats, tails, ears, antennas, the teapot's spout are **secondary**: damped springs (frequency 3 to 5 Hz, damping 0.4) fed by the body's acceleration, so they overshoot and settle. |
| **Arcs and timing** | Limbs swing on arcs, not lines; the body bobs twice per stride; eased in and out, never linear. |

**The poses** (what each body must do, mapped to its class):

| Pose | Biped | Quadruped | Thing with legs / legless | Roller / swimmer |
|---|---|---|---|---|
| idle | breathe, blink, arms hang with a 4 degree sway | same, tail and ears alive | breathe, tiny sway, face alive | roller: gentle bob; fish: fins flutter |
| walk (about 2.5 m/s) | legs swing 32 degrees, opposite arms, body bobs 4 cm, head steady | diagonal pairs, back rolls, tail swings | short stomps with a lean; legless waddles (roll 8 degrees, hop 6 cm) | roller rolls with its speed; fish flops |
| run (about 6 m/s) | legs 55 degrees, 12 degree forward lean, arms pump, stretch 1.06 | gallop: bounding pairs, stretch 1.1 | leans 18 degrees, body bobs 9 cm | roller tilts forward, fish dashes |
| jump | crouch, stretch up, arms rise, legs tuck at the top | front legs reach, back legs push, ears up | hops with a stretch; the face goes `surprised` | pops up, spins once |
| fall | arms up, legs bicycle, 8 degree lean, `surprised` | legs spread, tail up | tumbles slowly around its middle | same |
| swim | prone, 70 degrees forward, arms stroke, legs flutter | paddle with all four, head up | floats, bobs, spins gently | fish: its whole body is the stroke |
| drive | sits, hands on the wheel, head turns with it | sits up on the seat, ears back | peeks over the dash | roller sits in a cup |

All of it is tested the same way `/avatars` shows it: every body, every pose, from the one table of poses above.

## 3. Budget

Target device: a mid phone (the `H.device` "mid" tier: `scale.js H.budget`), **30 fps with 10 characters in view**,
the rest of the world included. A character spends from the world's frame, so the budget is what leaves room.

| Per character | Target | Hard limit |
|---|---|---|
| Triangles | 1,500 (a hero 3,000) | 2,500 (a hero 4,000) |
| Draw calls | 3 | 6 (a hero 7, with the outline) |
| Materials | 1 shared toy material per scene, colored by vertex color | 3 (a glowing screen or visor may be a second) |
| Joints (animated nodes) | 6 to 12 | 16 |
| Texture memory | none: no textures | 256 KB total for all faces |
| Per frame, 10 bodies in view (the phone tier) | 15,000 triangles, 40 draw calls | 22,000 triangles, 110 draw calls (section 7 measures it) |

How it is met: parts of one body that share a material and do not move relative to each other are **merged into one
mesh per joint** (`H.mergeParts`, `scale.js`); one `StandardMaterial` with vertex color and the fresnel rim is shared by
every body in the scene, so the player's three colors cost vertex data and no new material; far bodies (past
`H.budget` draw distance fraction) drop to the body alone (no hat details, simple face) and past 60 m to a billboard; a
sphere is 10 to 12 segments, a capsule 8; nothing casts a shadow except the player's own and the three nearest.
Characters count against the existing **budgets** (`things`, `bodies`, `shadows`) and are never exempt.

## 4. The check

`/avatars` is the instrument: every body live, with its triangle, draw-call and material count next to the target above,
a turntable, the poses, expressions, color pickers and the screenshot URL below. `tools/avatar-stats.ts` measures the
same numbers headlessly (`docs/characters-before.json` is its output for the stand-ins), and
`test/engine/avatars.test.ts` builds every body and fails on a body that does not exist in the showcase. After the art
pass the budget columns must go green for every body.

Screenshot mode, for a playtest or a review: `/avatars?body=<id>&pose=<pose>&bg=<bg>`, with `pose` one of `idle`,
`walk`, `run`, `jump`, `fall`, `swim`, `drive` or an emote (`wave`, `dance`, `cheer`, `laugh`, `point`, `sit`, `sleep`,
`clap`, `thumbsup`, `heart`), `bg` one of `day`, `night`, `studio`, `grass`; also `face=` (`visor`, `eyes`, `smile`,
`none`: the person's), `hat=`, `shape=`, `c1=`, `c2=`, `c3=` (hex without `#`: body, accent, detail), `t=<seconds>` to
freeze a moment of the motion, `turn=1` for the turntable, `ui=1` to keep the controls. The page sets
`document.body.dataset.ready = 'true'` (and `window.avatarsReady`) when the body is drawn and has been still for a moment.
`/avatars?body=all` is the contact sheet.

## 5. Every body: before

Measured by `tools/avatar-stats.ts` on the real presence code (default pose, face `eyes`, no hat, its own colors).
The **stand-ins** are far over the budget (the median body is twice the hard limit) because they are stacks
of 14-segment spheres; the art pass replaces them, it does not tune them. Heights are as built: the person comes out at
1.66 m against its 1.8 m target, a proportion gap the pass fixes.

| Body | Group | Class | Height | Triangles | Draw calls | Materials | The art pass: its signature |
|---|---|---|---|---|---|---|---|
| `person` | people | biped | 1.66 m | 6,592 | 13 | 5 | soft hero; the proportions every other body is measured against |
| `robot` | people | biped | 1.8 m | 6,236 | 15 | 5 | rounded visor-head; the visor becomes two big lit eyes |
| `tvbot` | people | biped | 1.75 m | 4,540 | 20 | 5 | the screen IS the face: eyes, brows and mouth drawn on it |
| `rollbot` | people | roller | 1.35 m | 6,288 | 8 | 4 | ball body, dome head; eyes on the dome, brow as the visor lid |
| `dog` | animals | quadruped | 0.95 m | 3,528 | 12 | 5 | floppy ears and a tail carry the expression |
| `cat` | animals | quadruped | 0.8 m | 1,272 | 12 | 5 | tail and ears; pupils slit when surprised |
| `fox` | animals | quadruped | 1 m | 4,092 | 12 | 5 | big brush tail, pointed ears (built from the wolf) |
| `pig` | animals | quadruped | 0.95 m | 3,528 | 12 | 5 | snout and ears; round belly |
| `bear` | animals | quadruped | 1.4 m | 3,916 | 12 | 4 | round ears, heavy and slow |
| `rabbit` | animals | quadruped | 0.8 m | 3,904 | 11 | 4 | tall ears that droop and perk |
| `penguin` | animals | biped bird | 1.1 m | 1,328 | 12 | 5 | flipper arms, belly patch |
| `chicken` | animals | biped bird | 0.9 m | 952 | 13 | 6 | comb and wattle, head bob |
| `cow` | animals | quadruped | 1.5 m | 3,640 | 18 | 6 | patches, udder-free: a toy, not a farm |
| `sheep` | animals | quadruped | 1.1 m | 3,728 | 11 | 4 | fleece as a few big puffs, dark face |
| `horse` | animals | quadruped | 1.8 m | 5,232 | 13 | 4 | long face but still toy: short neck, big eye |
| `dinosaur` | animals | biped | 1.9 m | 5,400 | 17 | 5 | big head, stubby arms, tail counterweight |
| `fish` | animals | swimmer | 0.9 m | 448 | 5 | 3 | tail and fins; swims, flops on land |
| `shoe` | things | thing with legs | 0.95 m | 5,308 | 16 | 6 | the toe cap is the face |
| `toaster` | things | thing with legs | 1.15 m | 6,460 | 20 | 6 | slots are the brow line; toast pops up for happy |
| `cactus` | things | thing with legs | 1.7 m | 8,772 | 26 | 8 | arms are the cactus arms; flower is the hat spot |
| `cone` | things | thing with legs | 1.4 m | 4,360 | 9 | 5 | stripes only on the cone, never on the face |
| `teapot` | things | thing with legs | 1.05 m | 8,682 | 14 | 6 | spout and handle are the secondary motion |
| `banana` | things | thing with legs | 1.6 m | 14,516 | 20 | 6 | curve = the lean; peel flaps for happy |
| `mushroom` | things | thing with legs | 1.35 m | 11,444 | 17 | 6 | cap spots are the palette accent |
| `potato` | things | thing with arms | 1 m | 15,540 | 22 | 7 | lumps stay few and big |
| `duck` | things | legless | 0.95 m | 7,208 | 8 | 3 | waddle and bob; beak is the mouth |

Group notes: **people** are the style's reference (the person first, then the three machines which borrow its proportions);
**animals** keep the species skeletons in `living/species.js` (they are shared with the world's creatures, so the
restyle must keep their sizes and joints) and take the face, palette and rim; **things** are the funniest and the most
at risk: the silhouette stays the object (a shoe is a shoe) and the character is a face plus short legs, never a mascot
with an object printed on it.

## 5b. The person, after

`presence-person.js` (the look: `hair`, `hairColor`, `bottom`, `shoes` besides `body` = top, `head` = skin; tones from `core.palette(look)`).
Measured by `tools/avatar-stats.ts`:

| | before | after | target / hard limit |
|---|---|---|---|
| Triangles | 6,592 | about 2,350 (2,050 to 2,500 by hair) | 3,000 / 4,000 (hero) |
| Draw calls | 13 | 8 | 7 (hero): one over, from the five moving pieces (legs, arms, hair) plus torso, head and face |
| Materials | 5 | 1 (shared, vertex colors, rim light) | 1 |
| Height | 1.66 m | 1.85 m with hair (the body 1.8 m) | 1.8 m |

Face: eyes 0.115 wide with big pupils and a highlight, lids, brows, a mouth with five numbers; seven expressions; blinks every
2.5 to 6 s. Poses: idle (breathes, looks around, shifts weight), walk, run, jump (crouch, stretch, tuck, landing squash with an
overshoot), fall, swim, drive, with hair and shirt on springs. The things are rebuilt in 5c; the animals are unchanged.

## 5c. The things, after

`presence-things.js` rebuilds the eleven things (`shoe toaster cactus cone teapot banana mushroom potato duck tvbot rollbot`) as toys: the object's own
shape in vertex-colored meshes under the one rim-lit material (the TV and the roll-bot add a lit screen), tones from `core.tones()`, painted
details (stripes, spots, freckles, a glaze band), a **face drawn on the object** (eyes that follow the camera and blink, a mouth and brows
from the five expression numbers, cheeks; on the TV and the roll-bot a lit screen with hearts), tiny arms and feet. Each moves its own way, has an idle
gag after about 3 s of standing still (then every 6 to 11 s) and a signature reaction to any emote (not sit or sleep). `/avatars?body=<id>&pose=gag`
and `pose=react` play them on a loop. Before/after pictures: `docs/characters-things/` (software renders of the real presence code, `tools/avatar-preview.ts`,
`WHAT=<id>`; the lit and rim-lit picture is `/avatars`). Test `test/engine/things.test.ts`.

| Body | Triangles | Draws | Locomotion | Idle gag | Signature (any emote) |
|---|---|---|---|---|---|
| `shoe` | 2,556 | 8 | rocks heel to toe on stubby legs, tongue and laces swing | three impatient toe taps, tongue lolling | heel click: hop, spin, tongue out |
| `toaster` | 2,592 | 9 | hops, a slice of toast bobbing up from each slot | ding: toast shoots up, the lever clicks | both slices launch, tumble and drop back in |
| `cactus` | 2,097 | 7 | lumbers on pot feet, arms swinging | the flower blooms, a little sway | "no hugs": arms cross, flower pops |
| `cone` | 1,756 | 4 | pogo hops on its base, squashing on landing | directs traffic: stern face, one arm stop, one waving | spins like a top, leaping |
| `teapot` | 1,658 | 8 | waddle; spout and handle on springs, lid chatters | whistles: lid rattles, steam | pours: leans over to the spout side, steam |
| `banana` | 1,692 | 10 | swaggering sway over short legs | about to slip: foot kicks, peel flutters | peels: three strips open, ta-da |
| `mushroom` | 1,778 | 9 | bouncy, the cap squashing on the stem | deep breath, pfff: spores puff | boing: crouch and leap, cap bouncing |
| `potato` | 1,722 | 7 | rocks along; at a jog it tucks and rolls | the sprout grows, eyes roll up to it | a full forward roll |
| `duck` | 1,860 | 9 | waddle, rolling foot to foot, paddle feet slapping | two squeaks, beak open, bubbles | squeaky spin with wings wide |
| `tvbot` | 2,216 | 9 | stiff walk, antennas on springs | static rolls over the screen | hearts in its eyes, bouncing |
| `rollbot` | 1,390 | 7 | the ball rolls with its speed, leaning in | scans: the head looks left and right | wheelie leap, the head spins a full turn |

All are over the 3-draw target (each moving piece is a mesh) but inside the hard limit for triangles; the person is the one in the doc's hero budget.

## 5d. The machines, after

`presence-robots.js` rebuilds the three machines (`robot`, `tvbot`, `rollbot`) as hard-surface toys on the same shared rim-lit material: **beveled forms** (`bevel`: a chamfered box of 44 triangles with a lit edge), **panel lines, vents and rivets**, **lit screens** for faces (eyes, brows and a mouth from the five expression numbers, drawn in light, so a mood is visible at once) and **pistons**. `robot` was a Living-species stand-in and is now built here like the other things. Pictures: `docs/characters-robots/<id>-before-after.png` and `<id>-motion.png` (idle, walk, boot at three moments, reaction; software renders by `tools/avatar-preview.ts`, laid out by `tools/avatar-sheet.ts`). Test `test/engine/things.test.ts` (the machines).

| Body | Triangles | Draws | Moves | Idle (hums, scans) | Boot-up |
|---|---|---|---|---|---|
| `robot` | about 2,700 | 12 | each foot lifts on a piston rod as that leg swings; piston neck bobs; whip antenna on a spring | chest lights breathe, a hair of tremble, head drifts side to side; the gag is a full scan with the screen following | a ring of light with a beam above it climbs from the floor, the screen is dark, flickers on, the lights chase, the antenna jolts |
| `tvbot` | about 2,900 | 12 | two lugged wheels turn with the distance (radius known) on piston struts that ride the bumps; rabbit ears sway and splay | head scans a little, static rolls over the screen | same |
| `rollbot` | about 2,600 | 8 | the ball with a lugged tread band and seams rolls with the distance; the head sinks on its piston neck as it leans | scans, antenna ticks | same |

The boot plays when a body is first drawn (rig time 0) and never changes the body's size, so hats, the mirror and the height checks see it from the first frame. `/avatars?body=<id>&pose=boot` loops it. The beam is made on the first boot and hangs on the pose beside the body.

## 6. Not decided here

Texture-based faces versus mesh faces on phones (the doc picks meshes: no texture memory); whether the animals' ears and tails
get the spring secondary motion first. Voice and sounds for characters are separate (`overseer-mirror-*` lines already exist).

## 5d. The mirror's look: eyes and accessories

`look.eyeColor` (default `#14161d`, as before) colors the person's iris (a dark pupil sits inside it) and the pupils of the
googly-eyed bodies. `look.accessory` is one of twelve small procedural meshes (`ACCESSORIES` in presence-core.js, built by
`accessory()` in presence.js) in `look.accessoryColor`. They use the anchors every body already has and nothing else:
**head** (`rig.neck`, as a hat), **face** (`rig.neck` at `faceY`/`faceZ`, as glasses), **neck** and **back** (`rig.pose`,
placed as a person's and moved by where this body's head is, as the extras are). So a new body only has to set its anchors
to wear all twelve. Each is a handful of primitives (under ten meshes) in the look's color plus one dark or lit detail.
The server's lists (`src/presence.ts AVATAR`) and the client's (`LOOK`) are kept equal by `test/engine/presence.test.ts`.
Sync needs nothing new: the whole look rides in the presence state, and a player's tag shows their main color and the
accessory's icon. The things with a screen face (TV robot, roll-bot) keep their own eyes; `eyeColor` does not tint them.

## 5d. The animals, after

`living/species.js` builds the bodies (the species table and its joints are unchanged: sizes, `hips`, `head`, `tail`, `wings`, `arms` keep their meaning for creatures and herds) and `living/animal.js` moves them (`H.living.drive`), for the world's creatures and for the mirror's animal alike.
What changed: **light** (a fur-like fresnel rim in each color's own tint, a lighter muzzle and underside); **eyes** (white ball, pupil, glint on joints: blink every 2.5 to 6 s, shut asleep, pupils follow the camera when it is near and the head turns a little toward it; cats have bright eyes and slit pupils); **ears** on joints (point, floppy, round, long) on damped springs: they trail the head and the bounce, flick now and then, perk, flatten at a run, droop asleep; **tails** in two joints, the tip trailing the root (a cat's swish, a dog's wag); **gaits** by `gait` in the table: a four-beat walk, trot and gallop for quadrupeds (a horse high-stepping, a cow's plod with a roll, a bear's shoulder roll, a pig's scurry, a deer's bound), a rabbit's hop, a chicken's head thrust, a penguin's waddle, a dinosaur's stomp with the tail as counterweight; **idles** by `idle`: a cat stretches, a dog pants and wags, birds fluff and shake, a horse paws, a pig sniffs, cows and sheep chew and flick their tails, a deer freezes alert, a rabbit twitches and sits up, a bear sways, a dinosaur sweeps its head and roars. Triangles went down (dog 3,528 to about 2,000, cat 1,272 to about 1,050, horse 5,232 to about 2,900: the soft shapes use 6 segments and the new small parts are 20 and 80 triangle icospheres); draw calls rose by about 6 to 8 per body (eyes, muzzle, belly), but instances of one source and color batch, so a herd pays per shape, not per animal. Picture: `docs/characters-animals-before-after.png` (before left, after right; software render by `tools/avatar-preview.ts`, no rim light: the real one is `/avatars?body=dog`). Test: `test/engine/living.test.ts` (animals).

## 7. A crowd

What ten and thirty bodies cost, and how it is kept down (`presence-person.js`, `presence.js updateRigs`, `scale.js H.budget`). Bodies are
drawn from the world's frame, so a crowd is a budget of its own: the **phone tier** (`H.budget.characters` 10, `farCharacter` 30 m) is the one the
table below is held to.

- **Shared geometry.** The person's legs, arms, torso, and head with hair are built once per scene and per look (`shared`: keyed by the tones
  each part uses, so two players in the same shirt share a torso even if their trousers differ) as hidden source meshes. Every body draws
  **instances** of them: one copy of the vertices, one batch per source for all the bodies that share it. Everything uses the one rim-lit
  material. Only the face is a mesh of its own (its points are rewritten for the eyes, blinks and mouth).
- **Merged parts.** What a body wears (hat, glasses, scarf, backpack, headphones...) is joined with `H.mergeParts` into one mesh per joint and
  color; a top hat, scarf, pack and headphones went from 11 meshes to 5. The cape, wings and tail swing, so they stay apart.
- **Far bodies.** Past 30 m (a 3 m band keeps a body at the edge from flickering) each source swaps to its **half-detail level**
  (Babylon LOD: half the segments and rings, a third of the triangles: the body's 2,370 on desktop, about 1,500 on a phone whose near level is built at three quarters, to 750; worn parts at 0.3 of the tessellation of a desktop's).
  The shape is the same to within 1.5 px at 30 m on a phone screen (`test/engine/crowd.test.ts` checks the bounding boxes), so nothing pops.
  A far body also moves simply: the legs and arms swing with the stride and it leans into a run, with **no blinking, no gaze, no hair or
  shirt springs**; its face is settled once (lids open) and left; it updates every 2nd frame (every 6th when out of view) with the time it missed.
- **A cap on the animated.** Only the nearest `H.budget.characters` bodies in view and inside 30 m animate in full (face, gaze, blink, springs):
  10 on a phone, 20 on a tablet, 40 on desktop. Yours counts when it is drawn. The others take the cheap level, still walking and
  gesturing. A body changes level at most every half second. The monitor shows it under **Characters** (`H.presence.crowd()`).
- **Name tags are pooled.** A tag taken off a head waits (up to 40) for the next one; a crowd coming and going makes no new elements.

Measured by `tools/crowd-stats.ts` (`test/engine/crowd-measure.ts`: `n` players on a flat floor in third person, random looks with hats and
accessories, two seconds of frames, read through the monitor's `sample()`: `activeDraws` and `activeTriangles` count what the camera draws, instances of one
source as one batch; Babylon's null engine has no GPU counter, a phone's own counters in the monitor read the same way. Milliseconds are Node's CPU for the
step and the scene's culling, good for comparing runs, not phones):

| Crowd (phone tier) | Draw calls | Triangles | Frame (Node) | In full | Cheap | Past 30 m |
|---|---|---|---|---|---|---|
| 1 body (you) | 11 | 2,474 | 1.7 ms | 1 | 0 | 0 |
| 10, different looks | 98 | 19,670 | 3.1 ms | 10 | 0 | 0 |
| 10, one look | 34 | 16,406 | 1.9 ms | 10 | 0 | 0 |
| 10, all past 30 m | 98 | 14,954 | 2.0 ms | 1 | 9 | 9 |
| 30, different looks | 226 | 46,360 | 4.1 ms | 10 | 20 | 6 |
| 30, one look | 79 | 44,086 | 2.8 ms | 10 | 20 | 6 |
| 30, a third past 30 m | 229 | 43,612 | 4.1 ms | 10 | 20 | 11 |
| 30, different looks (desktop tier: cap 40) | 226 | 72,156 | 4.8 ms | 24 | 6 | 6 |

(The first row includes the floor's mesh; each body is about 8 draws and 1,900 to 2,500 triangles with what it wears. The floor is 1 draw.)
The near level is built at `H.budget.detail` (a phone's 0.5 gives three quarters of the segments, desktop all of them). Ten bodies in view on the phone tier come to **about 100 draw calls and 19,700 triangles with ten different looks, 34 draw calls and 16,400 triangles
when they share one**, inside the table in section 3 (110 and 22,000). Instances cut draws only for bodies that share a part, so the worst
case (every look different) is what the limit is set to; the mirror's pickers make real crowds share a lot (hair, skin and shoes come from short lists).
Triangles are not batched away: past the cap, thirty bodies draw about 46,000 triangles because the ones inside 30 m keep their full meshes.
The tests keep this honest: `test/engine/crowd.test.ts` spawns 10 and 30 bodies and fails over the phone budget; the target column (15,000 and 40) is not met yet.

## The shared face system (presence-core.js)

One piece of logic drives every body's face; the bodies only draw what it decides. `EXPRESSIONS` are six main faces (neutral,
happy, surprised, scared, grumpy, sleepy; sad, angry and mischief remain). `feel(event, data)` turns a game event into a face and
a time (a hard landing over 9 m/s: surprised, over 14: scared; a blast near: scared, farther: surprised; a hit: grumpy; a catch:
happy; speaking moves the mouth); `mood()` holds it (a stronger feeling replaces a weaker one, never the reverse while it lasts);
`gazeTarget()` picks what the eyes follow (the Overseer while it speaks, a point a script told it to watch, the nearest player
within 10 m, the camera); `blinkStep()` is the blink; `landTracker()` finds hard landings from a body's grounded and vertical speed.
The per-body **face spec** (`FACE_SPEC`, `faceSpec(what)`) is the small table of how strongly a body shows an expression (`gain`),
whether it blinks and whether its mouth moves when it speaks. Tests: `test/engine/expressions.test.ts`; playtest
`faces-and-emotes`. The emote wheel is radial on desktop and touch: the six emotes (wave, laugh, cheer, shrug, dance, point) around
the middle, **More** for sit, sleep, clap, thumbs up and heart; emotes go through `H.sync.action('presence:emote')` to everyone.

## 8. Gen models

Every body in the table of section 5 can be a **model made through Hawkes Gen** instead of the procedural stand-in. The procedural body stays: it is the
fallback while a type has no model, while one is loading, and if it fails to load (a 404, a bad file); nothing in the mirror, the name tags or the
presence state changes (`look.what` still says what you are, `look.hat`, `extras` and `accessory` still say what you wear). Code: `presence-models.js`
(load, build, anchors, motion), data: `presence-model-registry.js`; `presence.js` calls `P.models.attach(rig)` at the end of `makeRig`,
`P.models.animate` from `animate` and `P.models.dispose` from `disposeRig`.

**The registry** (`P.modelRegistry`, filled in by `presence-model-registry.js`, changed at runtime by `P.models.register(id, patch)`): one row for each of the 26
types, `{ asset, url, lods, h, form, yaw, head, anchors, clips, stride, parts, radius }`. A row with no `asset` and no `url` has no model yet and keeps its
procedural body.

| Field | Meaning |
|---|---|
| `asset` / `url` | the Gen asset id (a library or community asset, loaded from `/v1/community/<id>/file`) or an address |
| `lods` | Gen's summary of the asset's levels (`{ kind: 'mesh', tris, tex, levels: [{ tris, tex, url }] }`, the bundle's `assets[name].lods`): `H.kinds.modelLevels` picks the **near** level whose textures fit the device and the lowest as the **low** one. Without it the one file serves both (`low` may name a far file) |
| `h` | the real height in meters, feet on the ground; default `WHATS h`. The model is scaled to it, never to 1.8 m |
| `form` | `biped`, `quadruped`, `bird`, `swimmer`, `roller`, `thing` (a thing with legs) or `legless`: how it moves where the file has no clip for it |
| `yaw` | radians to turn the model so its front looks along +z of the body. Babylon hangs a glTF under `__root__` turned half way round with z mirrored, which keeps the file's +z front at +z (and mirrors x), so the default is 0 (a file made facing -z needs pi) |
| `head` | the head's width in meters (default a share of `h` by form, `P.models.HEAD_SHARE`: biped 22%, quadruped 30%, thing 50%...). Hats and glasses are drawn for a head 0.43 wide and scaled by `head / 0.43` |
| `anchors` | `head` (the top of the head: a hat sits on it), `face` (between the eyes, at the front: glasses), `neck` (a scarf's ring, a bow tie, a cape, a collar, a medal), `back` (a backpack, wings, a jetpack), `rump` (a tail). Each `{ node, at, rot, scale }`: `node` the name of a node of the model (a bone of a skinned model is a node, so is any part of a model of rigid parts), `at` an offset in that node's units (from the model's origin, as authored in the file with the front toward +z, when there is no node; the loader mirrors x, so the engine mirrors an authored x), `rot` radians to straighten a bone whose axes are not +y up and +z forward, `scale` a multiplier on this anchor's size. An anchor left out comes from the model's bounding box and its form (a head on top and in front for a quadruped, at the top for the rest): good enough to see, a row should name the head at least |
| `clips` | GLB animation names by role: `idle walk run jump fall swim`, and any emote (`wave dance cheer laugh shrug point sit sleep clap thumbsup heart`). Left out, a role takes the clip with the word in its name |
| `stride` | meters per second at which the walk and run clips look right (default 1.6 and 4.5): their speed follows the body's |
| `rig` | the animation set (docs/animations.md): `mixamo` (the standard Mixamo skeleton, `mixamorig:Hips`...), `quadruped` (the quad template), `object` (one `Body`) or `none`; default from `form` (`biped` and `bird` mixamo, `quadruped`, `thing` and `legless` object, a `roller` and a `swimmer` none) |
| `restFix` | for the `mixamo` set: `false` to trust the model's rest pose, or `{ LeftArm: [rx, ry, rz] }` degrees to set a limb's fix by hand; left out, the arms and legs are measured against Mixamo's T-pose |
| `parts` | named nodes moved by hand when no clip drives them: `{ node, role, axis, amp, ph }` with `role` `leg arm tail ear wing fin head wheel`; a `wheel` rolls with the distance (`radius`) |

**Anchors, hats and the rest.** The procedural meshes are the ones that are used; they are not remade for a model. When the model has loaded, the rig's `neck` (where
`hat()` and the face things are drawn: its origin is 0.44 below the top of the head) becomes a node under the **head anchor**, scaled to the model's head, and
`rig.faceY` / `faceZ` are measured from the **face anchor**; `rig.mounts.neck`, `.back` and `.rump` are nodes under the other anchors, scaled the same way, which
the scarf, bow tie, cape, bell, collar, medal (neck), backpack, wings, jetpack (back) and tail (rump) are put in. Then `P._redress(rig)` makes the hat, extras and
accessory again there. Because the anchors are under the model's bones (or parts), what is worn follows the head and the body as the clips or the parts move.
Skinned and rigid-part models both work: a skinned model's joints are the nodes that `node:` names.

**Animation sets (data).** Before the GLB's own clips, a model takes the clips of its class from `public/play/anim/<class>.json` (`presence-anim.js`; format, rest-pose handling and fallbacks in docs/animations.md). The decision (J, 2026-10-25): every biped is re-rigged to the **standard Mixamo skeleton** (`mixamorig:Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand` and fingers, `LeftUpLeg`, `LeftLeg`, `LeftFoot`, `LeftToeBase`, the same on the right; a separate task does the rigging with Gen's `mesh.rig`) so Mixamo animations and the CC0 Quaternius clips fit them; the quadruped template rig and the rigid objects are driven by clips authored as data. A biped that still has the old 11-joint template rig does not fit the Mixamo set and keeps its GLB clips and the procedural motion (today the dinosaur only; the person, robot and the eight others are Mixamo: "Mixamo models" below is the recipe). A role the set has no clip for falls to the GLB's clip, then to the procedural motion below.

**Animation.** With clips: idle, walk and run (blended by speed, the clip's speed following the body's through `stride`), jump and fall (in the air, going up or down), swim (in water), and an emote's own clip by name,
all cross-faded over about a tenth of a second by weight; out of view the clips are paused and in the cheap crowd levels only the one clip plays. Without a clip for a role, the
**procedural fallback** moves the whole model (a `mover` node around its middle, feet kept on the ground) and the named `parts`: quadruped bobs, pitches and rolls with a stretch at a gallop; a bird
waddles; a swimmer sways in water and flops on land; a roller rolls with the distance (the part that rolls is under the model, not the hats); a thing hops, waddles and leans; a legless one waddles and
hops; a biped bobs and leans. Always: breathing, a stretch on launch, a landing squash (down in 90 ms, back over 220 ms with one overshoot), volume kept. An emote with no clip is done by the
whole body (hop, spin, lean, lie down: `bodyEmote`). Models carry their own faces: the expressions of section 1 do not apply to them.

**Performance.** One container per file per scene (`fetchContainer`): a player is an instance of it (`instantiateModelsToScene`, geometry and materials shared), so ten
players who are dogs are one download. A far body (past `H.budget.farCharacter`) takes the **low** level, loaded the first time one is far, and its anchors and parts move
to it; past the animated cap or out of view a body is cheap. A look change disposes the instance (clips, skeleton, nodes) and the next player gets the cached container. A model's **near level should be at most 8,000
triangles on the phone tier** (`P.models.TRIS`: 8,000 phone, 14,000 tablet, 30,000 desktop); `/avatars` flags a model over it (the triangles row turns red and says "over").

**How to add one.**
1. Make the model through Hawkes Gen (a GLB, one mesh or rigid parts or a skinned character, the front toward +z, feet on y = 0 or anywhere: the height is set by the row). Gen makes its levels of detail itself.
2. Look at it in `/avatars?body=<id>&standin=1` style: put the row in `presence-model-registry.js` (or try it with `P.models.register` in the console): `asset`, `h`, `form`.
3. Name the anchors from its node names (open the GLB in the showcase: `P.models.stats(rig).missing` lists a node that was not found), then the `clips` and `parts` it needs.
4. Open `/avatars?body=<id>&compare=1`: the model and the procedural body side by side, with a hat, in every pose; check the triangles against the budget and that the hat, glasses and pack sit right on the front and top.

**The check.** `/avatars?standin=1` fills four types with tiny stand-in models of boxes (`public/avatars-standins.js`: a skinned biped with clips, a quadruped of rigid parts, a fish, a toaster) loaded through Babylon's own
glTF loader from GLB bytes made in the page; `compare=1` shows each next to its procedural body, `hat=` puts a hat on both. The same files are `test/fixtures/models/standin-*.glb` (`node tools/standin-glbs.mjs`).
`test/engine/models.test.ts` covers the registry, loading and fallback, the height, the anchors and what is worn, the clips and the procedural motion of every form, the levels, the instances and disposal.
Nothing here is generated on the GPU; the models are made separately through Hawkes Gen and dropped into the registry.

### The pilot: person, dog, shoe

The first three rows of the registry are filled (`public/play/models/person.glb`, `dog.glb`, `shoe.glb`, each with a `-low.glb`; the files are served with open CORS because the play page is sandboxed). Made through Hawkes Gen: one front-view toy concept, `image.viewsheet`, `mesh.views3d` best of three judged against the concept, Blender `retopo` to 3,800 quads and a `lod` at 30%, then a rig by Gen's robot route (`split` + `template` biped / quadarm + procedural clips; `mesh.rig` would not install on the GPU server). Near 7,600 / 7,600 / 7,595 triangles, low 2,279 / 2,280 / 2,275.
Things learned for the full set: the clips come out named after bones (`ArmR` walk, `ArmR2` run, `Head` idle, `LegRTip` or `LegBRTip` jump): the row's `clips` maps them. The template rig binds whole parts rigidly, so the anchors in these rows are fixed offsets from the model's origin (they do not follow a bone). The bake is 1024 px, so even the low level is 1.8-3 MB: a smaller-texture low level is still to make. The concept must be vinyl, not plush (the dog came out as fur and its bake is blotchy). The playtest `gen-models-pilot` checks all of it in the game.

### The full set: the other 23 types

All 26 rows of the registry have a file (`public/play/models/<id>.glb` and `<id>-low.glb`). The recipe, per type (Gen project `hawkesgenwebsite`, label pack `gen-models`): a vinyl-toy concept (`image.generate`, two takes, one picked by eye; a retake when it was sitting or three-quarter), `image.cutout`, `image.viewsheet` (Claude checks the four views; a failed sheet is made again), `mesh.views3d` three takes (two for the toaster, mushroom and duck, which needed a second view sheet), then one `blender.character` job: `fix`, `retopo` 3,800 faces (7,600 triangles), `bake` 1024, **`project`** (the color texture painted from the four view pictures: the baked color alone came out in black blotches), `lod` 30% (2,280 triangles), `split` + `template` + `clips` where the form needs a rig, and a GLB export with **JPEG textures** (`textures: "jpeg"` for the near file and the low one: 0.4-0.8 MB each instead of 2-3 MB with PNG).

Forms. Gen drew most animals as **upright vinyl toys**, so cat, pig, bear, rabbit and cow are rigged as bipeds (`form: biped`), penguin and chicken as `bird` with the biped rig, the dinosaur as a biped. Sheep, horse and fox (like the pilot's dog) have four legs and the quadruped template (`form: quadruped`, jump clip `LegBRTip2`). The robot and the TV robot use the biped rig. Everything else is one rigid mesh and moves by its form, procedurally: the roll-bot (`legless`: a split wheel was too risky), fish (`swimmer`), duck (`legless`) and the toaster, cactus, cone, teapot, banana, mushroom and potato (`thing`). Clip names are the template's: `idle` Head, `walk` ArmR, `run` ArmR2, `jump` LegRTip2 (biped) or LegBRTip2 (quadruped); `LegRTip` and `LegBRTip` are the death clips. Models are about 1 unit tall, feet on y = 0, centered, the face toward +z; the row's `h` sets the real height and `head` the head's width (hats scale to it); the anchors in the rows are offsets in the model's own units, estimated from the concepts and the template's bones (not followed by the clips). The playtest `gen-models-all` goes through every row (a type with no file is logged `model-missing` and keeps its procedural body) and puts ten different models in view for the crowd tools.

Things to know: a near-white belly makes `image.cutout` punch a hole (the penguin's first mesh had a black belly): put such a concept on a mid-tone background. The split of the template rigs is by nearest centre, so a quadruped's parts can be mixed (the fox's and the horse's tails and hind legs share bones): check the walk in `/avatars?compare=1`. The fish came out turned about 30 degrees from +z (its concept was a three-quarter view; 31.3 degrees measured on the loaded file): its row has `yaw: -0.546` and its anchors are turned by the same angle.

### Mixamo models: the person and the robot (the recipe for the other nine)

J, 2026-10-25: "make it compatible with Mixamo, this is important so do it right. For the bipedals make that 'standard' as well." The person and the robot are the first two models on the **standard Mixamo skeleton** (52 bones: `mixamorig:Hips`, `Spine`, `Spine1`, `Spine2`, `Neck`, `Head`, both arms to the `Hand` and its 15 finger bones, both legs to `ToeBase`), rigged by Gen's `mesh.rig` (`kind: humanoid`, Make-It-Animatable). A Mixamo FBX or a Quaternius clip (CC0, Gen's library: `motion:ual1/Walk_Loop`) fits them, and so does `public/play/anim/mixamo.json` (the engine's own clips). Rows: `rig: 'mixamo'`, no `clips` (the data set plays; they have no GLB clips), anchors on `mixamorig:` bones.

**The recipe (Gen project `hawkesgenwebsite`, label pack `mixamo`; GPU on the L40S, about $0.29 a rig):**

1. **Source: an upright figure with its arms out.** `mesh.rig` needs a standing human-shaped body with the arms away from the torso. The pilot's chibi models have their arms hanging at the sides, no neck and a head as big as the body: run on them as they were (`mesh.rig` `kind: humanoid` on the old near GLB, jobs `j_d2a756d60aa9` person, `j_47d813f62baf` robot) it gives the full skeleton but stretches the arms out sideways, tears the shoulders and drops the textures (`textures were not copied onto mesh: 6937 vertices, the source has 1179`). So each model went through Gen's own humanoid chain: `asset.make` preset `shared/character3d` with the model's front still (a Blender `angles` front render of the old model, `blender.character` `import` + `angles`) as the concept: `image.edit` A-pose, `image.remove-background`, `image.viewsheet`, `mesh.views3d` best of three (judged by Claude), Blender fix, retopo to 8,000 quads (16,000 triangles), bake, `mesh.rig` humanoid. Person `j_d9ac725ac027`, robot `j_a30923286e38`; the A-pose stills, meshes, rigged GLBs and FBXs are in the library (labels `pack: mixamo`, `what: person|robot`, `step: full`): person rigged GLB `a_cc1d4924a1e32d95` (FBX `a_e2f495ef36dc9bbe`, mesh `a_0bc7ac8862ed26a4`, A-pose `a_37c7a3b840d0d582`), robot rigged GLB `a_78a62636c43c1cf7` (FBX `a_5475a8ae47236abe`, mesh `a_08ebd5c32bb115d3`, A-pose `a_2fd3375d338b5cc0`). The result keeps the look (the vinyl toy, the colors and the faces came through the bake) with a normal 16,000-triangle mesh; the face is a texture.
2. **Judge the skin** from the retarget preview, not from the stills (below): arms and legs move on their own, no webbing between the legs or the arms and the torso, the head follows, nothing tears at the shoulders. Both passed (frames at four moments of `Walk_Loop`: `blender.character` previews `a_6477611ffbe8d8ab` person, `a_d88c51209864890b` robot).
3. **A Mixamo clip plays on it.** `blender.character` ops `import` (`clips: false`, see below), `retarget` with the library's `motion:ual1/Walk_Loop` (Rigify-named: it came over by bone direction, 41 frames, none missing, scale 0.25 and 0.36), `preview` with `turntable: false, clips: ["Walk_Loop"]`. Both walk correctly, upright and textured.
4. **The two levels: `lod`.** `import` (`clips: false`), `lod` with `levels: [0.475, 0.1425]` (of the 16,000 triangles: **7,600 near and 2,280 low exactly**, the same budgets as the other models), `textures: "jpeg"`. `lod` keeps the skin, so the low level is on the same 52 bones, skinned by the same weights; nothing was re-rigged or transferred. `j_594d6fff9b20` (person), `j_4e38ae6da903` (robot): about 4 cents each.
5. **Stand it up, `node tools/mixamo-upright.mjs <near> <low> <out-near> <out-low>`** (see "What went wrong"): turns the root node, grounds the figure, and scales the embedded textures from 2048 to 1024 px (ffmpeg JPEG), so near 1.3 MB / low 0.5 MB per model. The files go to `public/play/models/<id>.glb` and `<id>-low.glb`.
6. **Anchors: `node tools/mixamo-anchors.mjs public/play/models/<id>.glb`** prints the head, face, neck, back and rump anchors for the registry: the offset in the bone's own units and the turn that makes the anchor's axes the body's (y up, +z forward) however the bone is tilted, worked out with Babylon's own matrices the way the loader hangs the file (mirrored x under `__root__`), and checks itself (each anchor lands on its point and stands upright). The ratios are the pilot's (hat on the top of the head, glasses 0.445 of the head's width below it and in front, scarf one head width under the top). A row names the bones: `head`, `face` on `mixamorig:Head`, `neck` on `mixamorig:Neck`, `back` on `mixamorig:Spine2`, `rump` on `mixamorig:Hips`, so a hat follows the head when it nods and a pack follows the spine.
7. **Check**: `node --test test/engine/models.test.ts test/engine/anim.test.ts` (the shipped files: 52 bones, one skin, triangles, the clip set binds, they stand and face +z, the walk swings the legs against each other); playtest `avatar-animations` (`mixamo-skeleton`, `mixamo-upright`, `mixamo-hat-on-head`, `mixamo-walk-moves`, `mixamo-budget`, and scenes of each walking, running, jumping, waving, in a top hat and beside the procedural body); `/avatars?body=person&compare=1&hat=tophat`.

**What went wrong, and what to know:**

- **`mesh.rig`'s GLB and FBX come out lying on their backs and 3 m tall.** The skeleton, the skin and the mesh are right (the retarget preview plays upright because retargeting aligns the bones by direction), but the whole figure is rotated 90 degrees about X and the "height 1.8" was measured on the lying thickness. The cause is in Gen (`mesh.rig`'s finish step: the FBX Make-It-Animatable writes is not turned into Blender's axes), not fixed here (this repo cannot reach it). `tools/mixamo-upright.mjs` is the workaround and a whole fix for the web: the armature (the file's one root) gets a +90 degree turn about X and the feet are put on y = 0. It does **not** scale: the engine fits a model to its row's `h` by its bounds, and the clip player moves the hips in the bones' own units, which a scale would change. Delete the tool when Gen turns the figure upright.
- **`blender.character` `import` fails on a GLB that carries a clip** (`ReferenceError: StructRNA of type Object has been removed`, in `action_label`, `hawkes_character.py`, because `import` removes the file's other objects and then names the clip after them). `mesh.rig`'s GLB has its procedural `Walk`. Use `"clips": false` on `import`. Also a Gen fix to make.
- A rigged GLB's `angles` stills show the figure lying (above): do not judge the skin from them, use `preview` of a retargeted clip (or the game).
- `mesh.rig` of a model that is not a human shape (chibi with its arms down) fails quietly: look at the A-pose first. The preset's `image.edit` A-pose keeps the toy's look well.
- The first run on a server installs two venvs (30 GB free needed); both rigs here ran on a server that had it. The `blender.character` jobs are cents; `mesh.views3d` is the big line (about $0.2-0.3 a take, three takes).
- Cost of this pair (both chains, the two first rigs and every check), as estimated from Gen's per-tool medians (the exact figure is in Studio's job list): about $2.5 of the $10, most of it the mesh takes. Not seen: the hands (the fingers are bones, but the toy's mitts were not looked at close up).

**The table for the other nine** (J, 2026-10-25: "do this right"; run with the recipe above, GPU on the L40S, project `hawkesgenwebsite`, label pack `mixamo`). Eight are on the standard Mixamo skeleton; the dinosaur is **not standard yet** (below). "Spend" is Gen's cost for the model's chain, the front still, the preview and the levels, by Gen's per-tool medians (about $0.9 each; the whole run about $9 of the $20 with the two failed view sheets and the dinosaur's rig tries; Studio's job list has the exact figure).

| Model | Rig kind | Bones | Preview verdict (`Walk_Loop`, Quaternius, retargeted) | Extras | Spend |
|---|---|---|---|---|---|
| person | `mesh.rig` humanoid | 52 Mixamo | clean | none | pilot |
| robot | `mesh.rig` humanoid | 52 Mixamo | clean | none | pilot |
| tvbot | `mesh.rig` humanoid | 52 Mixamo | clean: the TV head follows, legs and arms free | none | ~$0.9 |
| cat | `mesh.rig` humanoid | 52 Mixamo | clean, short arms swing; no tail geometry in the new mesh | none | ~$0.9 |
| pig | `mesh.rig` humanoid | 52 Mixamo | legs and head clean; the tail came out as a flat pink plate at the back that swings with the hips (cosmetic, remake the tail later) | none | ~$0.9 |
| bear | `mesh.rig` humanoid | 52 Mixamo | clean, no tearing at the shoulders | none | ~$0.9 |
| rabbit | `mesh.rig` humanoid | 52 Mixamo | clean; ears follow the head | none (ears skin to `Head`) | ~$0.9 |
| cow | `mesh.rig` humanoid | 52 Mixamo | clean; horns and ears follow the head | none | ~$1.2 (the first view sheet failed on the tail; remade fresh with a note that the tail is a short stub) |
| penguin | `mesh.rig` humanoid | 52 Mixamo | clean legs and feet; the flippers sit tight against the body, so the arm swing is small | none | ~$0.9 |
| chicken | `mesh.rig` humanoid | 52 Mixamo | clean; wings swing as arms, comb stays on the head | none | ~$0.9 |
| dinosaur | not rigged to Mixamo: **not standard yet** | 21 (`bone_0`..`bone_20`, SkinTokens) | not played: the names are not Mixamo and the textures were dropped | - | ~$0.9 (two failed view sheets) + $0.29 (`kind: auto`) |

**Not standard yet: the dinosaur.** It keeps the old 11-joint template rig and its GLB clips (nothing changed in the game). What was tried: (1) `shared/character3d` from its front still, twice (the second with the sheet's form `creature` and a note on the spikes): both stopped at `image.viewsheet`, before any 3D was made, because the generated back view never matched the sides (the back spikes came out as small round bumps, not the large plates of the side views: "the views still do not match after 4 tries"); (2) `mesh.rig` `kind: auto` (SkinTokens) on the old model (`j_27494edc8c8f`): it rigs, but with 21 generic `bone_N` names and `textures were not copied onto character: 6604 vertices, the source has 656`, so no Mixamo skeleton and no texture. What is left: a hand-made A-pose and view sheet for the dinosaur (the spikes drawn by hand on all four views), then the recipe; or `blender.character` `rename` of the SkinTokens bones to Mixamo names once the textures come across. The A-pose and rotation retries were not worth a run: the failure is before the rig.

Extra bones: **none of the eight has any**. The recipe keeps to the 52 standard bones; tails and ears are skinned to `Hips` and `Head` (the cat has no tail at all in the new mesh; the pig's is the flat plate above).

Built from: the old models' front stills (`blender.character` `angles`, jobs `j_1281e6f1c1ae` tvbot ... `j_354cc2e8130f` rabbit), the chains `j_a019344f0683` tvbot, `j_1dc608ca30b7` penguin, `j_b32d265af94f` chicken, `j_8c9edab0efaf` cat, `j_7c799aca8a1e` pig, `j_82d9804e60ba` bear, `j_aeece79a7bce` rabbit, `j_a2a4390cf6a8` cow; the retarget previews `j_f308795dba41`, `j_ccade4907590`, `j_cfe57d417232`, `j_02fdb5c8987e`, `j_c4121e91358c`, `j_41c62b8fd83d`, `j_82766a697e1e`, `j_2210f2958d12` (the video's frames are the verdicts above); the levels `j_8df5bdb1c9ea` ... `j_ce0693188440`. In the game (`rig: 'mixamo'`, anchors from `tools/mixamo-anchors.mjs`) their `head` width is the old row's for the cat, pig, rabbit and cow (the measured width included ears and horns and would have made the hats too big). Check: `/avatars?body=<id>&compare=1&hat=tophat`; playtest `avatar-animations` plays all nine Mixamo bodies (`mixamoBodies`).

### Gen hats

The mirror's hats (`LOOK.hats`) can be Gen models too (`presence-hats.js`, rows in `P.hatRegistry` in `presence-model-registry.js`: `{ url, width, sink, tint, flat }`; files `public/play/models/hat-<kind>.glb`). Made through Hawkes Gen with the `shared/prop3d` steps (`image.generate` front view in the vinyl-toy style of section 1, `image.remove-background`, `image.viewsheet` form prop, `mesh.views3d`, then Blender `fix`, `retopo` to 650 quads, a 512 px `bake` and `budget phone`): 1,233-1,300 triangles each (cap, beanie, tophat, crown, cowboy, party, helmet, chef), plain white where the hat takes the colour pick. The halo, horns and bunny could not be made that way (two takes of each: a halo is a floating ring, so the image model draws an inner tube or a donut with wings; a headband prompt gives a flat loop that hangs to the base; "horns on a pad" gives an egg-shaped dome; bunny ears on a pad failed the viewsheet consistency check), so they are built from geometry by `node tools/hat-glbs.mjs` (no GPU): a small rounded cap with the ring on a post, the horns or the ears growing out of it, 390-640 triangles each, base at y = 0 and nothing below it, one white material that the row's `flat` colours. Seen from the files: the crown's colour bake came out black, so its row has `flat: '#facc15'` (the texture is dropped); the baked textures are 512 px (the budget check says 4096 for the file's other maps).
When the worn hat has a row and its file has loaded, `dress()` in `presence.js` asks `P.hats.put`: the model is fitted at load (base at the origin, `width` (the file's x extent, the body of the hat, in head units), `sink` into the head, turned by `yaw` (default 0: the loader keeps a file's +z front at +z)) under a holder on `rig.neck`, which is the head anchor of the person and, after `P.models` moves it, of every Gen model type, scaled to the head: so the hat follows the head and fits all of them. `tint: true` multiplies the model's material (a copy per wearer) by the look's accent (`#ffffff`, the default, leaves it); a hat with detail colours (crown, cowboy, tophat, chef) has no `tint`. The procedural hat stays while the file loads, when it fails to load, when it is over `P.hats.MAX_TRIS` (1,800) and for a hat with no row. Tests `test/engine/hats.test.ts`; playtest `gen-hats`.
