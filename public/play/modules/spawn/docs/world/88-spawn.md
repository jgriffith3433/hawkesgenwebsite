## The spawn wheel: bring anything into the world

Every player has a spawn wheel: three layers deep, **type → category → thing**, with everything the engine can make
(every kind of thing, every animal, every tool), the world itself (terrain, the sea, weather, disasters), effects, the
game's own assets and the community library. Whatever is spawned is beamed down by the Overseer in front of the
player, on the ground (or on the water for boats and fish), with a ghost showing where first.

**How players open it** (tell them this way):
- Desktop: **hold Q**, point with the mouse, click (or let go of Q) to go in or to spawn. **Esc** backs out a layer.
  The mouse wheel or **1-9** pick too. **Shift** (or holding the click) spawns **×10**. **F** stars a favorite.
  **Tab** opens the panel with a search field: type "cow". A quick tap of Q still switches tools while playing; in
  building a tap opens the wheel to click. The small **Q Spawn** button (bottom right) opens the panel.
- Phones: the round **+** button (right side) opens a sheet: big tiles, back (or swipe right) between layers, a search
  field, recent things at the top. Tap spawns; hold a tile for ×10; ☆ stars it.
- Gamepad: **D-pad up** opens the wheel, the left stick picks, **A** goes in or spawns, **X** spawns ×10, **B** backs out.

**The types and what's in them:**

| Type | Categories (examples) |
|---|---|
| Vehicles | On the road (car, 4x4, motorbike, bicycle), On the water (boat, submarine), In the air (airplane, helicopter), Vehicle models (library) |
| Animals and people | Farm animals (cow, pig, sheep, horse, chicken), Pets, Wild animals (deer, wolf, bear, elephant, lion...), Birds, In the water (fish, turtle, frog), People and robots (person, robot, friend), Strange creatures (dinosaur, slime), Herds |
| Things | Shapes (crate, ball, platform...), Mayhem (exploding barrel, breakable crate), Furniture, Kitchen and bathroom, Screens and media (TV, computer, radio), Signs and lights, Game pieces (start, checkpoint, zone), Props and Pictures (library) |
| Nature | Trees and plants (tree, pine tree, bush, flowers, log, plant), Rocks (rock, boulder, stone pillar) |
| Buildings and homes | Houses and rooms, Walls and doors, Buildings and textured walls (library textures: a 4 × 3 m wall covered in it) |
| Tools | Mayhem tools (rocket launcher, grenades, spawn gun, gravity gun, lasso, flamethrower), Weapons, Outdoors (shovel, bucket, fishing rod): each on a pad, walk into it to hold it |
| World | Terrain (a mountain, hill, volcano, crater, giant hole or lake *here*), The whole world (island, hills, canyon...), Water (the sea, a pool, a pond), Weather (rain, storm, snow, clear), Disasters (tornado, meteor shower, earthquake, flood, volcano, blizzard, zombie night), Skies (library) |
| Effects | Explosions, fireworks, confetti, sparks, smoke, slow motion; Music, Ambience and Sounds (library: a speaker) |
| This game | the game's own models, pictures, sounds and videos |

Stand-ins (shapes) are always there and free; when the game has a model for the word ("tree"), that is used instead.
Community library things appear while building in the editor; choosing one puts it in the game as a **variant** of its
word (like the Library's "use"), then spawns it.

**Building vs playing.** While building, a spawn is a real world edit: saved, shared with everyone, and **Ctrl+Z**
takes it back (×10 is one undo). Terrain and "the whole world" change `config` (saved). Disasters and effects happen
now and aren't saved. While playing, the wheel shows only if the game allows it, and what is spawned is not saved:

```json
{ "op": "config", "patch": { "spawn": true } }
```

| `config.spawn` | What |
|---|---|
| `true` | players can spawn while playing (×10 at most) |
| `{ "play": true, "max": 5, "types": ["vehicles", "living"] }` | while playing: at most ×5, only those types (`vehicles`, `living`, `things`, `nature`, `buildings`, `tools`, `world`, `effects`, `game`) |
| `false` or not set | building only (the default) |

**Examples in words** (what to say or do):
- "How do I get a 4x4?" → "Hold **Q** to open the spawn wheel → **Vehicles** → **On the road** → **4x4**. On a phone,
  tap **+** → Vehicles → On the road → 4x4." (Or Tab and type "4x4".)
- "I want a cow" → "Hold Q → Animals and people → Farm animals → Cow (Shift-click for ten)."
- "Put a stone wall here" → "Hold Q, press Tab, type 'stone', pick a stone wall from the library" (building).
- "Let players spawn things while they play" → the config patch above (`spawn: true`).
- "Only let them spawn vehicles" → `{ "spawn": { "play": true, "types": ["vehicles"] } }`.
- "Turn the spawn wheel off while playing" → `{ "spawn": false }` (building always has it).
