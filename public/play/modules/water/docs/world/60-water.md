## Water

Water is a world setting (the sea, `config.water`), a kind of thing (`water`: pools, ponds, lakes, rivers, tanks), and
weather (`config.weather`: rain and storms). In any of it players swim and dive, things float or sink, things that
fall in splash, and you can fish. Everything works with no art; models and sounds are picked up by word when the game
has them (see "Art by word" below).

### The sea (`config.water`)

```json
{ "op": "config", "patch": { "water": { "level": -0.6 } } }
```

`true` (sea level 0), a number (the level), or an object:

| key | what | default |
|---|---|---|
| `level` | height of the sea's surface (meters) | 0 |
| `waves` | wave height in meters (0: flat calm, 0.6: rough) | 0.2 |
| `wavelength`, `speed` | how long the waves are, how fast they roll | 14, 1 |
| `color` | the water's color | `#1f7fb3` |
| `clarity` | 0 murky to 1 clear: how far you see under water | 0.5 |
| `depth` | how deep the sea floor is under the surface | 20 |
| `floor` | `false`: no sea floor (things sink out of the world) | true |
| `floorColor` | the sea floor's color | `#c2b280` |
| `foam` | white foam on crests and on shores (shores need terrain) | true |
| `fish` | `true`, `false`, a list of fish ids (`["tuna", "swordfish"]`), `"fresh"` or `"salt"` | true (salt water) |
| `species` | fish of your own (same fields as below), added to this sea | none |
| `current` | `[x, z]` m/s: the water flows, carrying floating things and swimmers | none |
| `breath` | seconds a swimmer can stay under (`false`: forever) | 25 |
| `swim` | `false`: nobody swims in it (you walk on the bottom) | true |
| `opacity` | how see-through the surface is | 0.94 |

The sea covers everything outside the land: **land is anything above the level**. On the plain Playground the ground
is a 60 × 60 plane at height 0, so a sea at `-0.6` makes it an island you can walk off into the water. Keep the level at
least `waves × 2` below flat ground or the wave tops show through it. With terrain (`config.terrain`) the sea fills
every valley below its level and foams on the beaches. On a round planet the sea is a ball at its level all the way
round: give the planet a `seabed` (Overseer, "An ocean planet") so its ground lies under it, and the sea reaches the
horizon however high you climb.

### Water things (`type: "water"`)

A box of water of any size. Its `position` is its middle; the surface is at the top (`position.y + size[1] / 2`). It
never blocks anyone (physics is always `none`).

```json
{ "op": "create", "entity": { "id": "pool", "type": "water", "name": "Pool", "transform": { "position": [6, 0.8, 4] }, "shape": { "size": [8, 1.6, 5], "basin": true } } }
```

| `shape` | what | default |
|---|---|---|
| `size` | `[width, depth of the water, length]` meters | `[8, 2, 8]` |
| `basin` | `true`: a pool (white floor and walls you can climb out over); `"pond"`: earthy banks; a color; none: a see-through tank | none |
| `rim` | how far the walls stand above the water | 0.3 (ponds 0.12) |
| `waves`, `wavelength`, `speed` | as for the sea; by default small water barely ripples, big water laps | by size |
| `current` | `[x, z]` m/s: a river | none |
| `fish`, `species`, `salt` | as for the sea; water things are fresh water | fish: true (pools: false) |
| `clarity`, `breath`, `swim`, `foam` | as for the sea | |
| `material.color`, `material.opacity` | the water's color, how see-through the sides are | `#1f7fb3`, 0.35 |

- A **pool**: `basin: true`, set into the ground or standing on it. A diving board is a box at the edge.
- A **pond** or **lake**: `basin: "pond"`, wide and shallow (`[20, 1.5, 14]`), fish by default.
- A **river**: a long box with a current: `size: [60, 2, 6]`, `current: [1.5, 0]` (turn it with `rotation` [0, angle, 0]).
- A **fish tank**: no basin, small (`[2, 1, 1]`), `fish: ["koi", "golden-carp"]` (fish swim about in any water that has them).
- A **hot tub**: `[2.5, 1, 2.5]`, `basin: "#8b5e3c"`, `waves: 0.05`.

### Floating and sinking

Everything that moves (`physics: "dynamic"`) floats or sinks in any water by its density next to water's (1):
`data.density` (`0.3` floats high like a raft, `0.6` a crate, `0.95` barely, `2.5` sinks like a rock). With no density
it is guessed from the name: rocks, stones, anchors, metal, bricks, statues sink; boats, rafts, logs, crates, barrels,
balls, ducks float; balls (`sphere`) float high. Floating things bob on the waves, drift down their slopes and go with
the current; a hull tipped over rights itself.

```json
{ "op": "create", "entity": { "type": "box", "name": "Raft", "physics": "dynamic", "shape": { "size": [3, 0.3, 2] }, "data": { "density": 0.3 }, "transform": { "position": [30, 2, 0] } } }
```

### Swimming

Walking into water deeper than your chest starts swimming (while playing): WASD swims where you look (look down and
swim forward to dive), space swims up, C dives, and space at the surface climbs out (onto a pool's edge, a dock, a
boat). Under water the view turns blue with moving light, sounds are muffled, and an Air bar counts down (`breath`);
out of air hurts. Wading in shallow water slows you down. Phones: the jump button swims up, a ⤓ button dives.

### Rain and storms (`config.weather`)

`"rain"`, `"drizzle"`, `"storm"` (lightning and thunder), `"clear"`, or `{ "rain": 0 to 1, "wind": [x, z], "dark": 0 to 1,
"lightning": true }`. Rain falls around you, rings every water near you, darkens the sky, gets you wet when there's no
roof over your head, and makes fish bite sooner and rare fish likelier. `null` turns it off.

### Fishing

There are 23 kinds of fish in four rarities (and junk). Each bites at certain hours of the world's clock and lives at a
depth (cast far for deep water): night fish like the catfish, moray and anglerfish, day fish like the snapper and tuna.
The catch log (J, or 📖) lists what you have caught with your best, and the rest as silhouettes. A new species gets a
banner and the Overseer notes it. Put `"data": { "catchBoard": true }` on a sign or box to make a board that shows your
best catches (E opens the log). The log is kept in the account when signed in.

Give the player a rod: `{ "op": "config", "patch": { "player": { "tool": "rod" } } }` (or `"fishing-rod"`; options:
`{ "type": "rod", "luck": 2, "bite": 1.5, "strength": 1.2 }`: luck makes rare fish likelier, bite makes them bite sooner,
strength makes the line harder to snap). Hold the mouse (phones: 🎣) to charge, let go to cast; the bobber floats
where it lands. Nibbles, then a bite (the bobber goes under, "!"): click (tap) in time to hook it. Then hold to reel
and keep the tension in the green: too much snaps the line, slack too long and it gets away. The first fish a player ever catches is made easy: a bite within about 5 s of the cast, a common fish, a longer window to hook it, and a line that holds. J (📖) opens the catch log.

The fish (`id`: name, rarity, water, kg):

| rarity | fresh water | salt water | either |
|---|---|---|---|
| common | `minnow`, `perch`, `bluegill`, `carp` | `sardine`, `mackerel` | |
| uncommon | `trout`, `bass`, `catfish` | `snapper` | |
| rare | `pike`, `koi` | `tuna` | `salmon` |
| legendary | `golden-carp`, `old-whiskers` (a giant catfish) | `swordfish` | `moonfish` |
| junk | | | `old-boot`, `tin-can` |

Your own fish in a world (no script): `"species": [{ "id": "lava-eel", "name": "Lava eel", "rarity": "legendary",
"water": "any", "kg": [3, 9], "cm": [80, 160], "color": "#ff5a1f", "strength": 0.9 }]` on the sea or a water thing;
`"fish": "own"` makes those the only ones.

### The bucket

`{ "op": "config", "patch": { "player": { "tool": "bucket" } } }` (`{ "type": "bucket", "volume": 3, "refill": "water" }`:
a bigger bucket that you refill by dipping it in water). Click (phones: 💧) to throw the water where you look: it
splashes, knocks people over, soaks them and puts out fire. Pouring water on someone from a script: API.md "Water".

### Art by word

Stand-ins until the game has assets for these words (WORLD.md "Assets by id"): models `bucket`, `fishing rod` (or
`rod`), a fish per species (`trout`, or `fish trout`, or one `fish` for all); sounds `splash`,
`plop`, `bite`, `reel`, `catch`, `snap`, `drip`, `rain` (looped).

### Examples in words

- "Make a lake with fish and give me a rod" → a water thing `{ "type": "water", "name": "Lake", "shape": { "size": [24, 2, 18], "basin": "pond" }, "transform": { "position": [0, 1, -20] } }` (fish are on by default), then `config` `player.tool: "rod"`.
- "Turn this into an island" → `config` `water: { "level": -0.6 }`.
- "Make it stormy" → `config` `weather: "storm"`; "stop the rain" → `weather: null`.
- "Add a pool with a diving board" → a water thing with `basin: true`, and a box (`[0.6, 0.1, 3]`) at the edge, a little above the rim.
- "Make the sea rough" → `water: { "level": -1, "waves": 0.7 }`. "Calm water" → `waves: 0`.
- "Make a river" → a long water thing with `current`, e.g. `size: [80, 2, 8], current: [2, 0]`.
- "Make the crates sink" → `update` each crate with `data: { density: 2 }`.
- "Give me a bucket" → `config` `player.tool: "bucket"`.
- "Only legendary fish in the pond" → the pond's `shape.fish: ["golden-carp", "old-whiskers", "moonfish"]`.
- "Dump a bucket of water on Sam", "flood the island", "a fishing contest" → scripts (API.md "Water").
