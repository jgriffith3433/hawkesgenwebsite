## Vehicles (`car`, `truck`, `bicycle`, `motorbike`, `boat`, `submarine`, `airplane`, `helicopter`, `vehicle`)

Things players get into and drive, ride or fly. Walk up and press **E** (on a phone, tap the prompt or **B**) to get in;
E again gets out. The first one in drives; friends who get in after ride along (multiplayer). Every vehicle works with no
art (a body made of shapes), and wears a model when you give it one (`shape.model`). They are real physics bodies: they
crash into walls, throw crates and animals out of the way, roll over, get thrown by explosions and can be wrecked.

| type | what it is | seats | how it drives |
|---|---|---|---|
| `car` | a car: quick, drifts with the handbrake | 4 | W/S drive and brake, A/D steer, space handbrake (drift), shift boost |
| `truck` | **the 4x4** (also "jeep", "pickup"): big wheels, long soft suspension, all-wheel drive. Climbs mountains (25° ramps, terrain hills) | 2 inside + 2 in the back (you see them) | like the car |
| `bicycle` | a bicycle: slow, leans into turns, space hops | 1 | W pedals, shift sprints |
| `motorbike` | a motorbike: fast, leans, a passenger behind | 2 | like the car |
| `boat` | a speedboat: floats on water (the Water module's, or anything tagged `water`), bounces on waves | 4 | W/S throttle, A/D steer |
| `submarine` | dives and surfaces in water | 4 | C dives, space rises (let go deep: it holds its depth), W/S, A/D |
| `airplane` | rolls down a runway, takes off at about 90 km/h, flies, stalls when too slow | 2 | hold W to roll, S lifts the nose; flying: W/S pitch, A/D roll, space/C throttle |
| `helicopter` | hovers by itself, climbs and descends | 4 | space up, C down, W/S tilt forward/back, A/D turn |
| `vehicle` | any of these by name, usually wearing a model: `shape.vehicle` is `car`, `truck` (or `4x4`), `bicycle`, `motorbike`, `boat`, `submarine`, `airplane`, `helicopter` | | |

Everyone in any vehicle: **V** changes the camera (chase, far chase, cockpit), **H** horn, **L** headlights, **R** flips it
back onto its wheels (it does by itself after a few seconds upside down), mouse looks around. A speedometer, boost and
health show bottom right (altitude and throttle in aircraft, depth and ballast in the submarine).

```json
{ "op": "create", "entity": { "id": "jeep", "type": "truck", "name": "4x4", "transform": { "position": [4, 1.1, 8], "rotation": [0, 90, 0] }, "material": { "color": "#3f7d3a" } } }
```

| field | what | default |
|---|---|---|
| `transform.position` | where its middle is. On the floor: y ≈ car 0.8, truck 1.1, bicycle 0.5, motorbike 0.6, airplane 1.0, helicopter 1.4 (the editor places it for you); a boat or submarine goes on the water's surface | |
| `transform.rotation` | `[0, yaw, 0]`: which way it faces (+z is forward) | |
| `transform.scale` | a number: a bigger or smaller one (a monster truck: 1.5) that drives the same way | 1 |
| `material.color` | its paint | each type has one |
| `shape.model` | a model asset to wear as the body (the physics stays the vehicle's). Nodes named wheel/tire spin. `shape.modelYaw` turns a model that faces the wrong way (90, 180...) | none: shapes |
| `shape.speed` | top speed in m/s (36 m/s is 130 km/h) | car 40, truck 32, bicycle 13, motorbike 48, boat 26, submarine 13, airplane 75 |
| `shape.power`, `shape.grip` | engine strength and tire grip, times | 1 |
| `shape.handling` | `"drift"` (slides more) or `"grippy"` | |
| `shape.mass` | kilograms (heavier pushes more and is pushed less) | car 1200, truck 2000 |
| `shape.health` | crashes and explosions take it; at 0 it's a smoking wreck nobody can drive | 100 |
| `shape.sounds` | `{ "engine": "asset.mp3", "horn": "...", "crash": "..." }`. Without them, assets named `car-engine.mp3`, `horn.mp3`, `crash.mp3` (type first, or plain) are used, else the engine makes its own sounds | |
| `data.autopilot` | it drives itself: `{ "speed": 6, "steer": 1 }` circles, `{ "speed": 10 }` goes straight, a helicopter `{ "hover": 4 }` holds 4 m up | none |
| `data.density` | for the Water module: under 1 floats | by type |
| `physics` | `"dynamic"`: it drives (a real body). `"static"`: a parked prop nobody can get into | dynamic |

**Water.** Boats and submarines need water: the Water module's sea (`config.water`) or a `water` thing (a lake, a pool),
or any thing with the tag `water`. Cars that drive in sink slowly; planes and helicopters float a while.
**Terrain.** Vehicles drive on terrain (`config.terrain`): the 4x4 climbs the mountain's road, cars slide back down
slopes too steep for them.

**In words** (what to do when someone asks):
- "spawn a 4x4 next to me" → `create` a `truck` about 4 m in front of the player, y 1.1, facing the way they face.
- "a mountain and a 4x4 to drive up it" → `config` `{ "terrain": { "shape": "mountain" } }` and a `truck` at the foot of
  the road (`game.terrain.road[0]` in a script, or near the mountain's edge).
- "give me a car" / "a red sports car" → a `car` (`material.color` `#d01818`, `shape.speed` 50, `shape.handling` "drift").
- "a boat on the lake" → a `boat` on the water's surface (its y is the surface height + 0.2); "a submarine" likewise.
- "an airport" / "let me fly a plane" → a long flat runway (a `box` 12 × 0.2 × 160) and an `airplane` at one end facing
  down it; "a helicopter on the roof" → a `helicopter` on a flat roof.
- "a monster truck" → `{ "type": "truck", "transform": { "scale": 1.5 } }` (or `vehicle` with a model).
- "make this model a car" (a model asset) → `{ "type": "vehicle", "shape": { "vehicle": "car", "model": "<asset>.glb" } }`.
- "a race" → cars plus `waypoint`s (`data.role` "checkpoint" and a "finish"): driving through them counts.
- "cars that drive around by themselves" → `data.autopilot` `{ "speed": 8, "steer": 0.3 }`.
- "a bike for my friend too" → two `bicycle`s; or a `motorbike` (two seats).
