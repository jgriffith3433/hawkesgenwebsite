# Engine modules: how a workstream adds to the game engine

The engine (`public/play/`) is a small core plus modules. A module is **a folder of its own** that adds kinds of
things, tools, controllers, world features, synced state and doc sections through registries. It never edits
`runtime.js` or a shared list, so six workstreams can build at once without touching each other's lines.

`H` below is `window.HawkesPlay` (the engine); scripts in a game see the friendly side as `game` (API.md).

## 1. Make the module

```
public/play/modules/vehicles/
  module.json          { "title": "Vehicles", "order": 50, "scripts": ["vehicles.js"], "kinds": ["car", "boat"] }
  vehicles.js          your code: H.kinds.register(...), H.controllers.register(...), ...
  editor.js            optional: listed as "editor": ["editor.js"] (loaded only in the editor's sandbox)
  docs/world/60-vehicles.md   your section of WORLD.md (scene.json: kinds, config keys, behaviors)
  docs/api/60-vehicles.md     your section of API.md (scripting)
```

- **Found by looking:** `src/engine.ts` reads every `modules/*/module.json`. Your scripts load after the core, in
  `order` (then name), with the engine's single cache-busting version (a hash of every engine file: nobody bumps it).
- **`kinds`** in module.json is the list the server checks scene.json against (`src/scene.ts`): a world can only hold
  kinds some module declares. Add yours there, not in scene.ts.
- **Docs:** `NN-name.md` files are joined in file-name order (core sections use 10, 20, ... 90; pick a number that puts
  yours where it reads best, e.g. 45 after physics). The assistant reads WORLD.md + API.md fresh with every message
  (`/play/WORLD.md`, `/play/API.md`), so write what it needs: what each thing is, its spec, and **examples in words**
  ("drive the 4x4 up the mountain" means these ops / this script).
- A file is wrapped in an IIFE and starts with `const H = window.HawkesPlay; const B = BABYLON;`. Everything works
  with no art (primitives and stand-ins) and picks up models, textures and sounds by asset name when they exist.
- Tests: add scenarios to `test/engine/` (see 8). `npm run typecheck` checks syntax: add your files to its
  `node --check` list in package.json (one line, at the end).

`test/engine/sample-module.js` is a complete small module (a kind, a tool and a controller): copy it to start.

## 2. A kind of thing (`H.kinds.register`)

```js
H.kinds.register('car', {
  physics: 'dynamic',                       // unless the spec says otherwise
  maker: true,                              // game.car({ ...opts }) for scripts; or a function (...args) => entity
  build(shape, o, spec) {                   // shape = spec.shape (or the maker's options); o = common options
    const e = H.lib.shape('car', () => BABYLON.MeshBuilder.CreateBox('car', { width: 2, height: 1, depth: 4 }, H.world.scene), o);
    // ...wheels as child meshes (metadata: { decor: true } for parts that aren't the collider)...
    return e;                               // must return the entity
  },
  destroy(e) { /* undo what build made outside e.node: lights, observers, sounds */ },
  editor: {
    word: 'a car',                          // the HUD: "a car · falls · can be thrown"
    lift: (spec) => 0.6,                    // how far above the floor it's placed
    textureable: true,                      // a texture from the library can cover it
    motion: [['dynamic', 'Drives'], ['static', 'Parked']],  // the card's "How it moves" choices ([] for none)
    hotbar: [{ order: 120, icon: '🚗', label: 'Car', make: (yaw) => ({ type: 'car', name: 'Car' }) }],
    asset: { kind: 'mesh', make: (asset, { title, yaw }) => spec },   // optional: what a library asset becomes
  },
  codex: { group: 'Vehicles', what: 'A car you can get in and drive (E).', spec: { type: 'car', ... }, fields: [['shape.color', '...', '']] },
});
```

- `o` holds: `name, tag, data, physics, position, rotation, scale, color, emissive, opacity, texture, tile, bounce,
  friction, mass, grab, shadow, visible, lenient` (lenient: missing assets show a stand-in instead of throwing).
- Building blocks in `H.lib`: `Entity` (wrap any node: `new H.lib.Entity(node, o, 'car')`), `shape(kind, makeMesh, o)`
  (a mesh entity with material, placement, shadows), `place(e, o)`, `material(o)`, `size3`, `hex`, `vec`,
  `assetUrl(name)`, `hasAsset(name)`. `H.kinds.lift(spec)`, `H.kinds.get(type)`, `H.kinds.list()`.
- The codex (`/entities`) and build.js (HUD words, hotbar, cards, library placing) read all of this from the registry.
- **Keep the codex in step** (J: the codex is how people meet the engine). Every kind needs `codex: { group, what, spec }`
  (`test/engine/codex.test.ts` fails without one), and its spec should show something worth looking at: a sample
  picture, video or sound from `public/examples/` (the codex's `SAMPLES` in `public/entities.js` maps names to them;
  our Knight mascot is `knight-walk.webp` / `.mp4`), never a missing asset. On the codex `HawkesPlay.hooks.codex` is
  true: a module draws no on-screen controls of its own there.
- An entity's own cleanup: `e.onDestroy(fn)`. Everyone's: `H.hooks.destroy.push(fn)`.

## 3. A tool the player holds (`H.tools.register`)

```js
H.tools.register('shovel', {
  title: 'Shovel', kind: 'tool',
  equip(ctx) { ctx.state.mesh = /* a view model parented to the camera */; },
  unequip(ctx) { ctx.state.mesh.dispose(); },
  step(dt, ctx) { if (H.input.mouse.pressed) { /* dig where ctx.game.aim(4) points */ } },   // 60 times a second
  frame(dt, ctx) { /* sway, HUD */ },
});
```

- The player holds one tool: `game.player.tool = 'shovel'` (or `{ type: 'shovel', ...options }`, given to you as
  `ctx.opts`), or `config.player.tool` in the world. `weapon` is the same thing (the guns are tools: blaster, rifle,
  shotgun, launcher in gameplay.js).
- `ctx = { game, H, player, opts, state, name }`; `state` is yours for as long as it's held.
- Tools are put away while building, in the RTS view, and in controllers that say `tools: false`.
- Input: `H.input` (`held`, `pressed`, `mouse`, `touchUi`) or `ctx.game.input`. On phones add a button with
  `H.bindTouchKey(button, 'f')` (it presses a key while held).

## 4. A way of moving (`H.controllers.register`)

```js
H.controllers.register('drive', {
  title: 'Driving: W/S throttle, A/D steer, E gets out',
  speed: 12,        // default config.player.speed in this mode
  tools: false,     // no gun in hand while driving
  enter(p, ctx) { ctx.state.car = ctx.opts.vehicle; p.visible = false; },
  update(p, dt, ctx) { /* read ctx.game.input, move the car, keep p on its seat */ },
  idle(p, ctx) { /* while a menu is open or the editor isn't in control */ },
  exit(p, ctx) { p.visible = true; },
});
// Getting in and out (from your tool, behavior or kind):
game.player.control('drive', { vehicle: car });
game.player.control('walk');
```

- Built in (controllers.js): `walk` (walking, jumping, F to fly where allowed, flying around while building) and
  `flight` (always moving forward, the craft). `config.player.mode` picks the one a game starts in; building always walks.
- `ctx = { game, H, player, state, opts, mode }` (`mode` is 'build' or 'play'). `game.player.controller` is the name.

## 5. A world feature (`H.features.register`)

```js
H.features.register('terrain', {            // owns config.terrain in scene.json (or game.json)
  apply(value, ctx) { ctx.state.ground = makeTerrain(value, ctx.scene); },   // the world starts with it set
  change(value, old, ctx) { reshape(ctx.state.ground, value); },            // an edit changed it (optional:
                                                                              //  without it, dispose + apply)
  update(dt, ctx) { /* every step while on */ },
  dispose(ctx) { ctx.state.ground.destroy(); },                              // turned off, or the world ends
});
```

- `ctx = { game, H, world, scene, key, state, value }`. Features apply before the world's things are built, so things
  land on your terrain. `false`/`null` turns a feature off. One key per feature: terrain, water, weather, time.
- The assistant turns it on with `{ "op": "config", "patch": { "terrain": { ... } } }`: document the value's shape.
- `codex: { title, group, what, value, fields: [[key, what, default]] }` gives it a page in the codex (`/entities`):
  `value` is an example the codex turns on live.

## 5b. Your part of `game` (`H.hooks.game`)

```js
H.hooks.game.push((game, world) => { game.vehicles = api; });   // game.vehicles for scripts
```

Runs for every new `game` object (each run, each reload), before the world is built and before any script's first
line. Never redefine `window.game`. (Mayhem adds game.spawnMany/explode, water game.water, living game.living, terrain
game.terrain this way.)

## 6. Physics (`H.physics`)

The engine's physics is **Havok** (Babylon Physics v2, wasm from the CDN, pinned in `public/play/engine.json`).
`H.physics.engine` says which is running ('havok', or 'legacy': the old box physics, while Havok loads or if it
can't). Havok runs every game (`H.physics.engine === 'havok'`); 'legacy' only takes over if the wasm can't load.
Write against this API, never Havok directly, so the engine can keep its promises (sleeping, budgets, sync).

### Bodies (on entities)

| | |
|---|---|
| `e.physics` | `'static'`, `'dynamic'`, `'kinematic'`, `'trigger'`, `'none'` (settable: the body changes with it) |
| `e.mass`, `e.friction`, `e.bounce`, `e.gravity` | kilograms (default 1), 0-1, 0-0.95, gravity factor (0 floats) |
| `e.velocity`, `e.vx/vy/vz` | m/s; `e.angularVelocity` degrees/s around x, y, z |
| `e.push([x, y, z])` | adds to the velocity (as before) |
| `e.impulse([x, y, z], at?)` | a kick in N·s (velocity changes by impulse / mass); `at` (a world point) also spins it |
| `e.force([x, y, z], at?)`, `e.torque([x, y, z])` | for this step only: call every step for thrust, wind, buoyancy |
| `e.upright` | true: never tips over (capsules, the player, things that walk default to true) |
| `e.layer`, `e.collidesWith` | a layer name, and the layers it hits (`'all'` or a list) |
| `e.sleeping`, `e.sleep()`, `e.wake()` | resting bodies sleep and cost nothing; anything that moves them wakes them |
| `e.on('hit' / 'leave', fn(other))` | touching starts and ends (triggers too), as before |
| spec `body` | `{ bounce, friction, mass, grab, shape, layer, collides, upright, damping: [linear, angular] }` |

### Shapes

`H.physics.shapes.box([w, h, d])`, `.sphere(r)`, `.capsule(r, h)`, `.cylinder(r, h)`, `.convex(entityOrMesh)` (hull: for
models that move), `.mesh(entityOrMesh)` (exact triangles: static/kinematic only), `.heightfield({ width, depth, rows,
cols, heights, id, version })` (terrain), `.compound([{ shape, position, rotation }])`. Give one to `H.physics.setShape(e, shape)` or
as spec `body.shape` (`'auto'`, the default, picks: box, sphere, capsule, cylinder, convex for models). A description
is looked at once (by identity): to change a collider give a new description (or bump its `version`). Big data
(heightfields, compounds with many parts) should carry an `id` and a `version`: the body is remade when either changes,
and the numbers are never compared.

### Queries

| | |
|---|---|
| `H.physics.raycast(from, dir, dist, { ignore, layers, all })` | `{ entity, point, normal, distance }` or null |
| `H.physics.shapeCast(shape, from, to, { ignore, layers })` | `{ entity, point, normal, fraction }` or null |
| `H.physics.overlap(shape, at, { ignore, all })` | the entities inside |

### Joints

`H.physics.joint(type, a, b, opts)` with type `'fixed'`, `'hinge'` (doors, wheels: `axis`, `limits: [min, max]` degrees,
`motor: { speed, force }`), `'ball'`, `'slider'` (`axis`, `limits`), `'distance'` (`min`, `max`), `'spring'`
(`stiffness`, `damping`). `pivotA`/`pivotB` are points in each body's own space; `b = null` joins `a` to the world.
Returns `{ a, b, type, remove(), motor(speed, force), limits(min, max) }`.

### Explosions, events, steps

- `H.physics.explode(at, { radius, force, damage, owner, up, info, event })`: impulses away from `at` (stronger closer)
  and damage to things with health. Online, use it through the sync action (7) so the host decides once for everyone.
- **One explosion event.** Every explosion is announced once per player: `H.physics.on('explosion', fn)` (modules: it
  lasts across worlds) and `game.on('explosion', fn)` (scripts), with `{ position, radius, force, damage,
  authoritative, ...info }`. `H.physics.explode` and `H.sync.explode` announce it themselves (`authoritative: true` where
  it was decided, `false` for the others online); pass `event: false` for a second call on the same blast (the
  launcher's damage-only call). A module that shows an explosion some other way calls `H.physics.announce({ position,
  radius, force, damage, authoritative, ... })` once. React to it, never wrap `H.physics.explode`: effects for everyone,
  lasting changes (craters, scores) only when `authoritative`.
- `H.physics.on('collision', fn({ a, b, point, normal, speed }))`, `'collision-end'`, `'trigger'` (`{ trigger, entity,
  entered }`), `'explosion'`: each returns an `off()`. Speed is the impact speed (how fast they were closing: fixed things
  count as infinitely heavy), for impact sounds and breakables.
- A velocity set on a thing whose body is being made or remade this step (just spawned, reshaped, let go, made dynamic)
  is kept: no need to set it again after the step.
- `H.physics.beforeStep(fn(dt))` (apply forces: buoyancy, wind, engines) and `afterStep(fn(dt))`. Fixed step: 60 a second.
- `H.physics.gravity` (m/s², along y), `H.physics.layer(name)` (makes or finds a layer; 16 at most).
- `H.physics.bodyOf(e)`: the Babylon `PhysicsBody` behind an entity (or null), for what this API doesn't cover. Bodies are
  made, remade and dropped by the engine each step (when a thing's shape, physics or visibility changes), so don't keep it.
- How bodies follow the world: dynamic things are simulated; static things that something moves (a behavior, a script,
  the editor) become driven bodies that carry what stands on them; `kinematic` things are always driven. Turning stays
  Euler (`e.node.rotation`), so behaviors and scripts keep working; don't set `rotationQuaternion` on an entity's node.

### Character controller

`H.physics.character(entity, { radius, height, stepHeight, maxSlope })` returns `{ move([vx, vy, vz]), jump(speed),
teleport(p), grounded, standing, normal, remove() }`: walks over slopes up to `maxSlope` degrees, steps up to
`stepHeight`, rides moving things, pushes dynamic things. The player has one; give creatures and AI friends theirs.

## 6b. Many things (scale)

- `game.many(count, (i) => opts)` (or a spec's `"instanced": true`, or `instanced: true` in a maker's options) makes
  primitive kinds as **instances of one mesh**: one draw call for a herd. Each copy has its own transform, physics and
  `color`; emissive, opacity and texture are shared by every copy of that look. A kind of yours gets this by passing a
  geometry key to `H.lib.shape(kind, make, opts, key)` (the same key for the same mesh).
- Materials are **shared** by things that look alike. Change looks through `e.color`, `e.emissive`, `e.opacity`; if you
  touch `e._mat` yourself, call `e.ownMaterial()` first (or every thing of that look changes).
- `H.budget` (scale.js, per device; `config.budget` overrides): `entities` (past it the oldest script-made things are
  removed: mark yours `e.keep = true` to protect them), `bodies` (the farthest dynamic things rest, `e._frozen`),
  `shadows` (nearest casters only), `detail` (fewer sides on round things on phones). Spawning 100 of anything is fine;
  test your module's worst case with the 200-body scenario in `test/engine/runtime.test.ts`.

## 7. Playing together (`H.sync`)

Everyone runs the whole game. Things in scene.json that move are simulated by their owner (whoever grabbed or pushed
it last) or the host; their positions are sent for you. For your module's own state:

```js
// State: sent by its owner (the host by default) only when it changes, up to `rate` times a second.
H.sync.state('vehicle:' + car.sceneId, {
  rate: 15,
  owner: () => H.sync.mine(car),            // or 'host' (default), or 'everyone'
  get: () => ({ driver: car.data.driver || null, lights: car.data.lights, speed: Math.round(car.speed) }),
  set: (state, changed, from) => { Object.assign(car.data, state); },
});

// Actions the host decides once for everyone (explosions, mass spawning, a bucket of water dumped):
const boom = H.sync.action('mayhem:boom', (d, { authoritative }) => {
  effects(d);                                       // everyone: sparks, sound, shake
  if (authoritative) H.physics.explode(d.at, d);    // only the host pushes things; their new positions are synced
});
boom({ at: [x, y, z], radius: 6, force: 20 });      // from anyone
```

- `H.sync.explode(at, { radius, force, up, damage, info })`: the engine's own host-authoritative explosion (the rocket launcher uses
  it): the host throws things and takes them over, everyone's own player is pushed where they stand. Do the damage
  yourself with `H.physics.explode(at, { radius, damage, force: 0, owner })` so kills are credited to whoever fired.
- Moving scene things are sent by their simulator 10 times a second, delta-encoded (only the fields that changed, all
  of them once a second); things scripts make (game.many) are not synced: every player's scripts make their own.
- `H.sync.mine(e)`, `H.sync.claim(e)` (take over simulating it: do this before pushing a thing someone else owns),
  `H.sync.release(e)`, `H.sync.isHost`, `H.sync.online`, `H.sync.me`.
- Scripts' own messages stay `game.net.send / on` (API.md).

## 7b. E near things (`H.use`)

One key does what's near: riding a horse, talking to a friend, getting into a car, sitting on a chair. Don't read E
yourself; offer it:

```js
H.use.register('vehicles:enter', {
  keys: ['f'],                 // optional: other keys that do your offer too
  near(player) {               // asked every step and a few times a second for the hint: keep it cheap
    const car = nearestCar(player, 3);
    if (player.controller === 'drive') return { label: 'Get out', priority: 100, act: () => player.control('walk') };
    return car && { label: `Drive the ${car.name}`, distance: dist(car), act: () => enter(car) };
  },
});
```

The engine picks one offer: the highest `priority` (0 by default; getting off/out of what you're on uses 100), then the
smallest `distance`. It shows it as one line ("E Ride the horse"; tapping it does it on phones) and E does it, once per
press. `build: true` (on the offer or the registration) offers it while building too. `H.use.offers()` lists what's on
offer, `H.use.act()` does the best one. Living things registers `living:ride` and `living:talk` (T too), vehicles
`vehicles:enter`, homes `homes:use`, events `events` (quest givers: priority 6). `noKey: true`: shown and tapped, but
E doesn't do it.

A friend's chat (Living things) takes your buttons: `H.living.chat.addChip({ label, show(friend), act(friend) })`
(events adds its quest chip this way); `H.living.chat.refresh()` redraws them.

## 7c. Sound (`H.audio`)

Every sound goes through one output: `H.audio.master` (a GainNode), never `context.destination`. `H.audio.context` is the
engine's AudioContext (one for everything; it starts running at the first click, tap or key; null without WebAudio, as
in tests). `H.audio.effect(name, node)` puts a filter between everything and the speakers (water muffles the world
under water: `effect('water', lowpass)`, `null` takes it out); `H.audio.media(audioElement)` routes an `<audio>` (music,
loops) through it; `H.audio.volume` is the master volume; `H.audio.output` is what reaches the speakers (after the
effects: record from it, as share's clips do). `game.sound(name)` and `game.music(name)` already use it.

## 7c2. Slow motion (`H.timeScale`, `H.slow`)

`H.slow('mine', 0.35)` slows the world (fewer fixed steps a second: physics, behaviors, scripts' updates and every step
hook together; frame hooks still run once a frame in real time), `H.slow('mine', null)` lets go; the slowest owner wins,
`0` stops it. `H.timeScale` reads it (setting it is the 'default' owner). Never fake it by pausing and calling `H.tick`.
A new world starts at 1.

## 7e. Art: assets by id, found by word (`H.assets`)

**Never build file names** (`${species}.glb`, `car-engine.mp3`). A game can hold many assets for one word (seven
cows), each with an id (`a_...`), a name, a type (model, image, sound, video), a title and words. Ask for a word:

```js
const id = H.assets.pick('cow', { kind: 'model', seed: e.sceneId });   // the one for this thing (or null: a stand-in)
const all = H.assets.for('cow', { kind: 'model' });                    // every one, in the world's order
const url = H.assets.url(id);                                           // H.lib.assetUrl / hasAsset take ids too
```

- Order: `config.assets[word].ids` (the world's choice), then assets labelled with the word (plurals, and synonyms
  modules add: `H.assets.synonym('puppy', 'dog')`), then names (`word.glb`, `word-2.glb`) for old games.
- `pick` gives the default, or a variant per `seed` when the word mixes (`config.assets[word].mix`): seed with the
  thing's id (a herd: its id and the animal's index), so a reload gets the same ones.
- Mark the scene thing that picked by word (`e._assetPick = word`): a change of `config.assets` rebuilds it, so the
  herd swaps its cows at once. A new thing you make from a spec (not in the world file) writes the id it got into its
  spec (`shape.model`), so it's kept when saved.
- Specs and options take ids: `shape.model`, `shape.asset`, `material.texture`, `sounds.<what>`.
- Living things (species), Mayhem (sounds, spawning), Water (sounds, fish, bucket, rod), Terrain (layers, scatter),
  Vehicles (sounds, `shape.model`) and Homes (`assetFor(word, kind)`) all do this; WORLD.md "Assets by id" tells the
  assistant.

## 7d. Animals

**Living things owns animals** (species, brains, herds, riding, friends): to make one, use its `creature` kind (or
`H.living.spawn`). Other modules don't make their own animals: Mayhem's `spawnMany('cow')` and spawn gun make creatures and
throw them; vehicles carry them; homes have pets the same way. Knock one over with an explosion, or set `e._tumble`
while you spin it (Living things lets it lie until it's cleared).

## 8. Tests

`npm test` runs `test/engine/*.test.ts`: the engine in Node (Babylon's NullEngine and Havok's wasm, no browser), the
same files the browser loads. A scenario builds a world from scene.json, steps it (`H.tick(seconds)`) and checks what
happened. Add your module's scenarios there (things it makes build from their specs; vehicles drive up a slope; water
floats a crate...). `test/engine/harness.ts` loads the engine and your module: `load({ extra: [yourFile] })`, then `world(H, sceneOf({...}))`
and `H.tick(seconds)`. `test/engine/runtime.test.ts` has every core scenario to copy from.
