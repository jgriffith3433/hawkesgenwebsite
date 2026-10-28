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
| `H.physics.raycast(from, dir, dist, { ignore, layers, all, filter, characters })` | `{ entity, point, normal, distance }` or null; `filter(entity)` false looks past a thing, `characters: false` skips characters' boxes. Against the colliders: use it for anything cast every step (wheels, feet), never `scene.pickWithRay` (every triangle of every mesh in the world) |
| `H.physics.shapeCast(shape, from, to, { ignore, layers })` | `{ entity, point, normal, fraction }` or null |
| `H.physics.overlap(shape, at, { ignore, all })` | the entities inside |

### Joints

`H.physics.joint(type, a, b, opts)` with type `'fixed'`, `'hinge'` (doors, wheels: `axis`, `limits: [min, max]` degrees,
`motor: { speed, force }`), `'ball'`, `'slider'` (`axis`, `limits`), `'distance'` (`min`, `max`), `'spring'`
(`stiffness`, `damping`). `pivotA`/`pivotB` are points in each body's own space; `b = null` joins `a` to the world.
Returns `{ a, b, type, remove(), motor(speed, force), limits(min, max) }`. Hinges and sliders are 6-DoF constraints (Babylon's own Hinge and Prismatic take no limits or motors): positive limits and motor speeds go along `+axis` and turn the way the thing's own rotation counts. `worldPivot` ([x, y, z]) places a joint to the world somewhere other than on `a` (a rope's knot above). The abilities on top of them are `modules/abilities/contraptions.js`.

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
  `shadows` (nearest casters only), `detail` (fewer sides on round things on phones), `lights` (the most lights one
  material takes). Spawning 100 of anything is fine; test your module's worst case with the 200-body scenario in
  `test/engine/runtime.test.ts`.
- **What a frame costs** (`test/engine/frame.test.ts`; `docs/performance.md` has the numbers):
  - **Draw calls**: a thing built from many parts is drawn as one mesh per material: `H.mergeParts(meshes, { keep })`
    after building a stand-in (vehicles' bodies, furniture, barrels' rings; a house's pieces stay as bodies but are
    drawn together). Leave out what moves against its parent (wheels, doors, rotors, flames) or mark it
    `metadata.keep`; keep a reference only to parts you left out (merged ones are disposed). Share materials by look.
  - **Shadows**: add casters with `W.shadows.addShadowCaster(m)` as before; each frame only the near ones (`shadows`,
    `shadowDistance`) whose shadow can fall in the camera's view, and not tiny ones, are drawn into the map, and the map
    is drawn again only when one of those moved (nothing at all looking at the sky). Don't replace the shadow map's
    `getCustomRenderList` or `refreshRate`.
  - **Lights**: a point or spot light with a `range` lights only the meshes in it (scale.js sets `includedOnlyMeshes`
    twice a second); set `includedOnlyMeshes` yourself to choose (a house's rooms do). Give every light you make a range.
  - **Rays every frame or step**: `H.physics.raycast` (colliders), never a scene pick per frame; work out what the
    player looks at a few times a second (homes' "what E does" does it 10 times a second).
  - **Bodies**: moving things never get a triangle collider (a dynamic `mesh` shape becomes its convex hull);
    still things cost almost nothing per step (a node exactly where it was is skipped).

## 6c. Loading and memory (phones first)

Targets: a world playable in about 2 s on a phone, and never killed for memory (iOS Safari reloads a page that takes
too much). `docs/performance.md` has the measured numbers and how to measure.

- **Devices and budgets** (`scale.js`): `H.device = { tier: 'phone' | 'tablet' | 'desktop', ios, memoryGB, cores }`
  and `H.budget` per tier (`H.budgetsFor(device)`): besides entities, bodies, shadows and detail, `textureMB` (iPhone 64,
  Android phone 96, iPad 128, desktop 512, or 256 with 4 GB), `maxTexture` (1024 on phones), `pixelRatio` (phones draw a
  3x screen at 2x; desktop 0: never capped), `drawDistance` (meters drawn per meter of a mesh's radius: 220 phone, 700
  desktop; never past the fog's end for fogged meshes), `shadowDistance`, `loads` (models and textures loading at
  once), `lights` (4 phone, 6 tablet, 8 desktop) and `catchUp` (the most fixed steps a frame runs to catch up: 3
  phone, 4 tablet, 8 desktop; past it a slow device plays in slow motion), `characters` (bodies animated in full: 10 phone, 20
  tablet, 40 desktop) and `farCharacter` (30 m: past it a body draws its half-detail level and moves simply; docs/characters.md "A crowd"). Phones get less (and a one-pass filtered shadow instead of the
  blurred one); desktop is never capped to a phone's numbers.
- **Draw distance** puts a Babylon LOD level with nothing at the far end on every entity mesh (`m._cullAt`). A mesh with
  its own LOD levels is left alone; `e.noCull = true` draws a thing at any distance (a planet; a mesh with
  `applyFog = false` or a material with `fogEnabled = false` is drawn past the fog).
- **Textures by level of detail** (`textures.js`, `H.textures`): bundle images carry `lods` ({ kind: 'image', size:
  [w, h], levels: [{ level, url, w, h, bytes }] }): Hawkes Gen makes them itself when the image is made (its LOD
  system: 128-2048 px and the full size as WebP) and the portal puts them in the bundle (`src/lods.ts`).
  `H.lib.assetUrl(ref, hint)` gives an image's **first level**: with `hint` `{ at: [x, y, z], size }` (the thing it's
  on) the level about its size on screen from where the player starts, with `{ sky: true }` the screen's width, without
  one the smallest; never more than its share of `H.budget.textureMB`. So any `new B.Texture(H.lib.assetUrl(id, hint),
  ...)` your module makes loads once at about the right size and is managed by itself: every half second the engine measures how many pixels each texture
  covers (near, big, in view), upgrades the most needed within `H.budget.textureMB`, and downgrades the least visible
  first when over. Swaps don't blank the texture (the new file loads beside it), at most `H.budget.loads` at once, and
  the old level is disposed after the swap (one copy per texture). Textures it doesn't manage (inside models, your
  render targets) still count against the budget.
  - **Big visuals** (a sky, a planet, the Overseer): `H.textures.reserve('yours', bytes)` keeps room for what you'll
    make (everything else shrinks to fit); `reserve('yours', 0)` gives it back. `H.textures.headroom()` is the room left.
  - A texture from an asset not made through `assetUrl`: `H.textures.track(texture, { asset: id })`.
  - `H.textures.onPressure(fn)`: called with the bytes over budget when downgrading textures isn't enough (models let
    their full-detail copies go). `H.textures.stats()` for a debug overlay; `H.textures.off = true` turns it all off.
  - Never call `texture.updateURL` on a managed texture (it blanks it): leave the level to the engine.
- **Models** (`kinds.js`): one queue, nearest to the camera first, `H.budget.loads` at a time, so the world is playable
  while far things stream in. A model's copies are its levels of detail from Gen (`lods` { kind: 'mesh', tris, tex,
  levels: [{ level (triangles), tris, tex, role: low | mid | high, url }] }; `H.kinds.modelLevels(entry)`): far away its
  low level (about 12% of the triangles, textures an eighth of the model's), near the most detailed level whose textures fit
  `H.budget.maxTexture` (a phone: the mid, 1024 px; a desktop: every triangle, textures at most 2048). Older games pair a
  `<name>_low.glb` by name. Only the copy its distance needs loads; the near copy comes when you're near and the texture
  budget has room, and is let go far away when memory is tight. Load your own GLBs with
  `B.SceneLoader.ImportMeshAsync` as before; prefer the `model` kind (or `H.assets` + `model`) to get all of this.
- **Lazy modules** (`module.json`): `"lazy": true` loads your scripts only when a game uses the module: one of its
  `kinds` in the scene, one of its `"config"` keys, one of its `"tools"` handed out or lying around, or one of those or
  its `"words"` in the game's scripts (`'car'`, `game.vehicles`). `"needs": ["other"]` brings another lazy module along.
  Everything else lazy loads a moment after the world is playable, and joins it: its scene and game hooks run, its
  world hook's `enter(world)` runs, and scene things of its kinds (stand-in boxes until then) are rebuilt. So a lazy
  module must work when it arrives after the world started (most do: register, then hooks). Code in another module
  that uses yours checks it's there (`H.vehicles && ...`). `HawkesModules.ensure(name or kind)` loads one now (a spawn
  wheel offering a car before Vehicles came). Lazy today: vehicles, homes, events, share. Don't mark a module lazy if
  other modules use it while loading, or if it changes how the player or the world behaves from the first frame.
- **Caching**: engine scripts carry the manifest's content hash (`?v=`) and are served `immutable` for a year when it
  matches; Babylon and Havok come pinned from our own `/vendor/` (docs/performance.md; immutable too), and their big files start downloading the
  moment `/play/modules.js` runs (preload links), in parallel with the game's own fetch.

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
- Moving scene things are sent by their simulator 10 times a second (20 for important ones: driven, held), stamped
  with the shared clock and delta-encoded; things scripts make (game.many) are not synced: every player's scripts make
  their own.
- **What others see is a replay of the data.** Every remote thing (scene things, players' avatars, herds, vehicles that
  aren't scene things) is drawn from a buffer of snapshots, about one send interval plus the network's delay and
  jitter behind (adaptive), interpolated (positions lerped, turns slerped), with velocity-based extrapolation only for
  short gaps. Your own player and what you drive or hold are simulated on your machine: no lag at any ping. When
  authority over a thing changes (you claim it, someone else does, the host leaves) the change is blended out over
  ~0.15 s, and the new authority starts from the newest snapshot carried on to now (things in flight keep flying; a
  host explosion whose result never arrived is applied by whoever takes the things over).
- `H.sync.mine(e)`, `H.sync.claim(e, { hold })` (take over simulating it: do this before pushing a thing someone else
  owns; false if someone holds it), `H.sync.release(e)`, `H.sync.holder(e)`, `H.sync.isHost`, `H.sync.online`,
  `H.sync.me`, `H.sync.host`, `H.sync.onHost(fn(newHost, oldHost))`, `H.sync.now()` (the shared clock, ms),
  `H.sync.stats()` (bytes, messages, corrections, extrapolated frames).
- **Held things stay yours.** Something you carry (`e.held`), drive (a vehicle whose driver's seat is yours) or mark
  `e.netHold = true` is locked to you: bumping into it, blasting it or claiming it never takes it from you. The owner
  pushes it in a host explosion.
- **Your own synced things, smooth:** `set(state, changed, from, meta)` gets `meta.at` (the sender's shared-clock
  stamp) and `meta.from`; keep a `H.sync.track(opts)` per thing, `push(meta.at, values, meta.from)` in set and
  `sample()` each frame (opts: `pos`, `vel`, `euler`, `yaw`, `quat`: which values are what). Living's herds and
  vehicles do this.
- **Interest:** the server sends each player what's near them at full rate and far things less often (4 a second past
  45 m, once a second past 130 m, every 3 s past 320 m), important and moving things first, within ~96 KB/s per
  player. A state that says where it is (`where: () => [x, y, z]`) gets the same; `important: true` sends it first.
  Measured (test/engine/net.multi.ts): 100 stampeding cows, three vehicles, crates and 4 players: the host sends
  ~27 KB/s in ~21 messages a second, each player gets 26-33 KB/s (the room allows 90 messages a second).
- Scripts' own messages stay `game.net.send / on` (API.md). Tests: `test/engine/netsim.ts` runs 2-4 engines in workers
  with the real relay and links with latency, jitter and loss (`test/engine/net.multi.ts`); `test/relay.test.ts`.

## 7a. Time: rewind and reset (`H.rewind`, rewind.js)

The world keeps its last 10 s (every moving thing's pose, velocity and health, 10 times a second) while playing. Hold
◀◀ (Backspace, D-pad left) and it plays backwards; let go and it carries on from there (broken scene things come back
from the world file, things made since go). ⟲ (Shift+Backspace, D-pad down) resets the world to how it loaded.
Together, the host decides: the host's rewind takes everyone 10 s back (players keep their places), others ask the
host. `config.rewind: false` turns both off. `H.rewind.back(s)`, `.hold(on)`, `.reset()`, `.seconds`; scripts:
`game.rewind(s)`, `game.resetWorld()`. Build mode has undo/redo instead (↶ ↷, Ctrl+Z, D-pad left/right): only your own
edits, field by field, keeping what others changed since.

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

## 7b2. Touch layout (`H.touchLayout`, touchlayout.js)

On a phone (`H.touchUi`; `?touch=1` forces it) every touch control and HUD piece lives in one of four **zones** plus the stick and
the two main buttons, all computed from the viewport and the safe-area insets by `H.touchLayout.compute()` (pure; set as CSS
variables `--tl-<zone>-x|y|w|h` on `<html>`, again on resize, rotation and when building lifts the controls over the hotbar):

| Zone | Where | What flows into it |
|---|---|---|
| stick, jump, action | bottom left; bottom right (60 px, jump on the right, B left of it) | `#touch` |
| `#tl-ctx` | above jump and action, 2 columns of 3 buttons (60 px, 8 px apart), filling upward | `.mh-touch`, `#veh-touch`, `.sw-fab`, `.lv-touchbtn`, and the extra `.tb` buttons water adds (fish, catch log, dive) |
| `#tl-tl` | top left | the **HUD** toggle, `.pr-hud` (chat, emotes, people), `.qs-btn` (Journal), `.tour-stuck`, `.tour-track` / `.qs-track` |
| `#tl-tr` | top right (beside the cluster in landscape) | `.gs-acts`, `.gs-toast`, `.corner`, `#veh-hud`, `.mh-score`, `.wp-ammo` |
| `#tl-mid` | bottom centre (landscape: between the left HUD and the buttons; portrait: above the controls) | `.hc-chat` (the Overseer's captions), then `.hp-use`, `#veh-prompt`, `.mh-tip`, `.water-hud` |

Do not position a touch control with pixel offsets from a corner. Make your element where you like and add its selector to `ZONE_OF`
in touchlayout.js; it is moved into the zone and flows there, so it cannot cover another one. Buttons are at least 48 px
(`K.MIN`, audited); a new button goes in `#tl-ctx` and is 60 px (`--tl-btn`). `test/engine/touchlayout.test.ts` proves, for portrait and
landscape phones with and without a notch, that the zones never overlap, stay inside the safe area and leave room to read.

- **Hide the HUD:** the HUD button (top left) toggles `body.tl-hud-off` (remembered, `hg_touch_hud_off`): everything but the stick and buttons goes.
- **Haptics:** `H.haptic(ms | [pattern])` (a short tick on every button and the stick; the fishing catch, hits and blasts use Juice's rumble). Silent with reduced motion or `localStorage.hg_haptics = '0'`, and where there is no vibration API.
- **`H.touchLayout.audit()`** measures the real page: every showing control, overlaps, buttons under 48 px, anything outside the safe area (`{ ok, text, overlaps, small, outside }`). The playtest scenario `touch-controls` logs it at every step.

## 7c. Sound (`H.audio`)

Every sound goes through one output: `H.audio.master` (a GainNode), never `context.destination`. `H.audio.context` is the
engine's AudioContext (one for everything; it starts running at the first click, tap or key; null without WebAudio, as
in tests). `H.audio.effect(name, node)` puts a filter between everything and the speakers (water muffles the world
under water: `effect('water', lowpass)`, `null` takes it out); `H.audio.media(audioElement)` routes an `<audio>` (music,
loops) through it; `H.audio.volume` is the master volume; `H.audio.output` is what reaches the speakers (after the
effects: record from it, as share's clips do). `H.audio.hold(owner, on)` silences everything but the background (music and ambience, `media(el, { background: true })`) while any owner holds (the account sheet over the sandbox uses it). `game.sound(name)` and `game.music(name)` already use it.

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

## 7g. Gen models for characters (`H.presence.models`)

`modules/presence/presence-models.js` + the data in `presence-model-registry.js`: a "What are you?" type can be a Gen-made GLB. A row of `P.modelRegistry` with an `asset` or `url` gives that type a model; the procedural body is the fallback while it loads or when it is missing. The rig keeps its API (`rig.neck`, `faceY`, `faceZ`, `rig.pose`); with a model, `rig.neck` and the new `rig.mounts.{neck, back, rump}` are nodes under the model's own bones or parts, scaled to its head, and `P._redress(rig)` makes what is worn again there. A module that adds a worn thing should parent it to `rig.neck` (head, face) or `rig.mounts.neck/back/rump` when `rig.mounts` exists, else to `rig.pose`, as `extra()` and `accessory()` do. `P.models.attach / animate / dispose / stats / register / setLoader`. Fields, anchors, clips, the procedural fallback by form and how to add a model: docs/characters.md "Gen models". Tests `test/engine/models.test.ts`.

### 7g2. Animation clips as data (`H.presence.anim`)

`modules/presence/presence-anim.js` (registered in `module.json` before `presence-models.js`), data in `public/play/anim/{mixamo,quadruped,object}.json`. One clip format for three rig classes: per clip `loop`, `seconds`, `ease`, `tracks` (a bone name with `rot` Euler degrees or `q`, and `pos` / `scl` for `Hips`, `Root`, `Body`), `events`. Rotations are deltas from the model's rest pose in the model's axes (so a clip fits any bone orientation, and a Mixamo-style T-pose is measured against the model's own rest: `restFix`); `mixamorig:`, `mixamorig7:` and unprefixed bone names are the same. A registry row picks its class with `rig` (default from `form`). `P.anim`: `load(cls)`, `setData(cls, file)`, `validate(cls, file)` (the test that every named bone exists in the class skeleton), `sampleClip`, `bind`, `apply`, `Player` (blends of 0.15 s, one-shots over loops, events), `drive` (called by `P.models.animate`; returns null for a role the set lacks, so the GLB's own clip and then the procedural motion take it), `on(fn)` for clip events, `has(rig, clip)`, `info(rig)`, `toDelta` (a Mixamo library rotation to a delta). `rig.forceClip = { name, t }` draws a clip at a moment (`/avatars?body=<id>&pose=<clip>&t=<s>`). Docs: docs/animations.md. Tests `test/engine/anim.test.ts`.

## 8. Tests

`npm test` runs `test/engine/*.test.ts`: the engine in Node (Babylon's NullEngine and Havok's wasm, no browser), the
same files the browser loads. A scenario builds a world from scene.json, steps it (`H.tick(seconds)`) and checks what
happened. Add your module's scenarios there (things it makes build from their specs; vehicles drive up a slope; water
floats a crate...). `test/engine/harness.ts` loads the engine and your module: `load({ extra: [yourFile] })`, then `world(H, sceneOf({...}))`
and `H.tick(seconds)`. `test/engine/runtime.test.ts` has every core scenario to copy from.

## 8b. What a game may ask the editor

A game's scripts run in the same window as the engine (`new Function` in runtime.js), so anything they can post to the
editor page (`window.parent.postMessage({ source: 'hawkes-play', type, ... })`) is **a request, never a decision**.
Spending credits and acting on the account belong to the person, in the editor (`public/editor-bridge.js`, the door;
`public/editor.js`, what is behind it). The rules:

- **An allowlist.** Only the types in `ALLOWED` (editor-bridge.js) are answered; anything else is ignored. A module that
  needs a new message adds its type there, and to the handler in `editor.js`. Never add one that spends or changes the account.
- **`generate` is a card, not a call.** The editor shows a card (what, kind, price from `/v1/asset-kinds`, the person's balance)
  with **Make it** and **Not now**; only Make it posts `/games/:id/generate`. One card at a time: while it is open, `generate`
  from the frame is dropped. The editor tells the frame when it is answered (`generate-closed`, `made`), which the build
  card's "Make it with AI" button listens for (build.js). The in-world Gen beam and a waiting model's button go through it.
- **`ask` only fills the chat box.** The text (and the `@mention`) goes into the editor's chat input, which takes focus; the
  person presses Enter, and `sendChat` (the only thing that calls `/ai`) runs from their own key. The tour's `asked` step completes then.
- **`ops` and `spawn-community` stay automatic** (that is the person building), but are limited: `ops` 30 a second,
  `spawn-community` 2 a second. The excess is dropped, with one console warning per type.
- **`share-open` and `share-media` carry a photo or clip to the share window.** A game page has no cookies and a window it
  opens is sandboxed too (no `allow-popups-to-escape-sandbox`), so it cannot open `/share/new` itself: it posts `share-open`
  in the tap (the click still counts; the editor answers `share-opened {ok}`), then `share-media` with the payload, and the
  editor hands it to the window it opened when that says `ready` (`share-done {url}` goes back). `share-open` is limited to 2 a
  second. A sandboxed page played on its own has no page around it and says sharing works from the editor.
- **Links are ours or plain text.** A chat line's `action.href` (editor.js, chat.js) is a link only if `safeHref`
  (editor-bridge.js) accepts it: a path with one `/`, or https on hawkesgen.ai / this page's origin. Anything else is shown as text.
- **The page's policy.** A game page carries a Content-Security-Policy beside its sandbox (`src/server.ts playCsp`, hosts in
  `PLAY_HOSTS`): a script's `fetch` to a site not listed is refused. Add a host there when the engine starts using one
  (test `test/play-csp.test.ts` finds engine files that name one that is not listed). Inline scripts of play.html get a nonce per load.
- **The server is the second guard:** `POST /v1/games/:id/generate` takes 10 a minute and 40 an hour per account (429), and
  `/ai` allows one message at a time per game (429 while the Overseer is working).

Tests: `test/engine/bridge.test.ts` (a script posts 50 `generate` and 50 `ask`; nothing is requested), `test/portal.test.ts` (the limit).

## 7f. The sky, the planet and the Overseer (`H.sky`, `H.planet`, `H.overseer`)

The `overseer` module (`public/play/modules/overseer/`) owns the time of day, the light and the sky in every game. Don't
write `W.hemi` / `W.sun` intensities or `scene.clearColor` every frame yourself: report what you want with
`H.sky.set(owner, { dark: 0-1, flash: 0-1, weather: true })` (`null` takes it back) and the sky multiplies it in with
the clock and the altitude (water's rain and the events module's dark do this). The clock is `H.sky.clock(create)` (one
object: `{ hour, day, run, light, jumped }`), shared with the events module. Fog set by anyone keeps its colour and
distances by day; the sky darkens it at night and stretches it with altitude.

Every standard and PBR material curves with the planet (a material plugin: `y -= |xz - camera.xz|² / 2R`); a custom
`ShaderMaterial` that draws ground or water far away adds the same line (water.js does), and `material.hpNoCurve = true`
opts a material out. `H.planet.air(y)` is the air (1 at sea level, thinning with height): anything that flies on air
uses it (vehicles: rotors, wings, air-breathing engines). Things beyond the world's own camera reach (the planet, the
ship, beams) go in the sky's far layer: `H.sky.bg.add(mesh, group)` and `H.sky.onBg((camera, farCamera) => ...)`.

**A round world** (`config.planet.sphere`, every new game; `modules/overseer/round.js`). The ground is a whole planet
(50 km across by default). scene.json keeps things on the planet (its middle at `[0, -radius, 0]`, rotations turned from
standing upright where the thing is); the engine runs in a **frame around the player**: up is +y under them, they stay
near x = z = 0, so physics, the camera, the controllers, building and your module work as on flat ground and float32 stays
precise. Every ~100 m round the frame moves (a rebase): the engine moves and turns every entity, body, character, the
camera and the Overseer by one small rotation. **If your module keeps positions of its own** (goals, homes, its own
integrator's pose and velocity), turn them in `H.planet.frame.onRebase((tr) => ...)` with `tr.point`, `tr.dir`, `tr.quat`
(Living things and Vehicles do), or they jump 100 m. Gravity points to the middle (Havok's -y is exact under the player;
`physics.js roundGravity` adds the rest for bodies away from them); dynamic things and characters more than 1.5 km off rest
(`e._far`: skip simulating them yourself, as vehicles do). Scene edits made here go through `H.applyOps(ops, { local:
true })` (or the editor's `edit`), which put them on the planet; never write a world-file position from a local one
yourself. The ground is a curved patch round the player (`kind: 'planet'`, `_frameFixed`) and the ball in the far layer.
Terrain is a thing on the planet: it's put upright at its `center`, its heights follow the ball's curve and its edges
ease down to the planet's ground (`generate(value, { round })` in terrain-core.js), the frame moves it like everything
else, and `H.terrain`'s queries (`heightAt`, `normalAt`, `place`, `dig`, edits, craters) take points in the world round
you and turn them into its own coordinates (`H.terrain.fieldPoint(p)`; edits are saved in those). **An ocean planet**
(`config.planet.seabed`, meters under sea level): the ground patch and the ball sit that deep, the ball paints sea
with the terrain's island where it is, and Water's sea (a ball at its level round the middle in the shader) has no floor
of its own and grows to the horizon as you climb (`test/engine/round.test.ts`, "an ocean planet"). Things still
assuming flat ground: Living things' navigation grid (flat cells near the creature), Mayhem's and Events' spawn heights
(y near 0 under you is right).


Whatever appears comes down from the Overseer, through **arrivals** (`H.arrive`, `modules/overseer/arrive.js`), chosen
by what the thing is: **drop** (most things: high in the beam, then a fall; real physics while playing, so online the
host or owner decides it; building, an exact fall onto the op's spot), **grow** (plants, up out of the ground), **beam**
(lights, text, zones, things that float or are attached: in place), **none**. Every way of making things uses it: scene
ops (`fx`: `"materialize"`, `"arrive"` and `"auto"` choose by the thing, or `"drop"`, `"grow"`, `"beam"`, `"none"`; an
op's own `arrive` wins; overseer.js hands its ops hook to `H.arrive.ops`), Mayhem's spawnMany for everyone (its
`arrive` option; `H.arrive.spawned` from `runSpawn`: the spawn gun, the spawn wheel while playing, events' spawns), and
terrain stamps (terrain.js eases the ground to the new shape over ~5 s and calls `H.arrive.quake`).
- **Building, a drop's spot is decided before the op:** `H.arrive.plan(specs)` moves a falling thing onto whatever is
  over its spot (a roof), so the op, the saved world and undo hold where it really lands (the spawn wheel and the hotbar
  do this; the gizmo, grab and copy never drop). Someone else's drop (the assistant's) that lands on a roof is saved
  there by the room's host (one `update`, on nobody's undo list).
- **Your own:** `H.arrive.bring(things, { how, exact })`, `H.arrive.how(e)`, `H.arrive.landing(at, { lift, half })`;
  the look alone is `H.overseer.beam(target, opts)` (`.pulse(k)`), `H.overseer.materialize(entity)`,
  `H.overseer.flare(k)`. Use `H.arrive.down(at)` / `up(at)` for which way things fall (straight down today; a round
  planet makes it toward the center). Cheap by design: no lights, nearby arrivals share one beam, landing rings are a
  pool of six, particles are juice's pools, a few synthesized voices through `H.audio.master`, nothing left behind
  (`test/engine/arrive.test.ts`).
