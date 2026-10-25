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
| Per frame, 10 in view | 15,000 triangles, 30 draw calls | 25,000 triangles, 60 draw calls |

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
