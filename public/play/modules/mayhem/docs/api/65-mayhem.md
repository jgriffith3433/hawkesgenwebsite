## Mayhem (`game.mayhem`, `game.spawnMany`, `game.explode`)

| Call | What |
|---|---|
| `game.spawnMany(what, count, { at, area, pattern, spacing, size, height, velocity, data })` | Makes `count` things at once and returns them. `what`: a word (`'cow'`, `'cows'`, `'barrel'`, `'crate'`, `'ball'`, `'box'`, any animal or noun), a kind, an asset (`'tree.glb'`), or a scene spec (`{ type: 'sphere', shape: { radius: 0.3 }, material: { color: '#ff0000' } }`). `at` (default: in front of the player, on the ground), `area` (a radius, or `[width, depth]`), `pattern`: `'scatter'` (default), `'grid'`, `'circle'`, `'line'`, `'pile'`, `'stack'`, `'rain'` (dropped from the sky; `height` adds more). Stays within `config.mayhem.maxSpawn` (the oldest go first). Online, everyone gets the same things and the host moves them |
| `game.explode([x, y, z], { radius: 5, force: 18, damage: 40, fire: false, color, sound })` | A real explosion: things thrown and spun (heavier ones less), damage falling off with distance, breakables broken, barrels set off, `fire: true` lights things, a fireball, shockwave, smoke, debris, a shake and a boom. Online the host decides it once for everyone  A blast nobody set off (a meteor, a volcano): `by: 'world'` (no one's score or combo). |
| `game.mayhem.shatter(thing, { pieces, at, force, respawn })` | Breaks a thing into pieces now |
| `game.mayhem.ignite(thing, { seconds })` / `extinguish(thing)` / `isBurning(thing)` | Fire. Returns false for things that can't burn |
| `game.mayhem.tumble(thing, strength)` | Spins it like a ragdoll; creatures get back up when they land |
| `game.mayhem.rope(a, b, length)` | Ties two things (or a thing and a point `[x, y, z]`) with a rope; `cutRopes(true)` cuts them all |
| `game.mayhem.giveTool(name, options)` | Puts a tool in the player's hands and on the belt (`game.mayhem.belt` lists it) |
| `game.mayhem.clear()` | Removes everything spawned and every broken piece |
| `game.mayhem.slowMotion(seconds)` | Slows the game for a moment (playing alone) |
| `game.mayhem.sound(name, { at, volume })` | A mayhem sound: `'boom'`, `'crash'`, `'whoosh'`, `'pop'`, `'beep'`, `'fire'`, `'throw'`, `'zap'`, `'rope'`, `'moo'` (the game's asset by that name, or synthesized) |
| `game.mayhem.score`, `game.state.mayhem` | The MAYHEM score (things hit, broken, burnt, killed, times the combo) |
| `game.barrel({ x, y, z, power })`, `game.crate({ x, y, z, size })`, `game['tool-pickup']('lasso', { x, y, z })` | Makers for the kinds |

Events (`game.on`): `'explosion'` `{ position, radius, force, damage, fire, authoritative, by, chain, mayhem }` (the
engine's one explosion event, once per blast for every player; `authoritative` is true where it was decided: terrain
digs craters there), `'break'` `{ entity, pieces }`,
`'ignite'` `{ entity }`, `'spawned'` `{ things, what, count }`, `'landed'` `{ entity }` (an animal back on its feet),
`'mayhem'` `{ what, points, total, combo }`.

```js
// "Spawn 100 cows and give me a rocket launcher"
game.spawnMany('cow', 100, { area: 20 });
game.player.tool = 'rocket-launcher';

// "Rain barrels from the sky every 10 seconds"
game.every(10, () => game.spawnMany('barrel', 12, { pattern: 'rain', area: 15 }));

// "A tower of crates and a bomb under it"
game.spawnMany('crate', 8, { pattern: 'stack', at: [0, 0, 6] });
game.after(3, () => game.explode([0, 0.5, 6], { radius: 7, force: 30, fire: true }));

// "When a cow dies, spawn two more" (a hydra farm)
game.on('death', ({ entity }) => { if (entity.data.species === 'cow') game.spawnMany('cow', 2, { at: entity.position }); });

// "Points for every explosion"
game.on('explosion', (e) => { if (e.authoritative) game.state.score = (game.state.score || 0) + 10; });
```

**How the launcher and blasts feel** (`HawkesPlay.mayhem.feel`, `mayhem-feel.js`; looks and sounds only): a rocket leaves with a muzzle flash, a puff and a backblast, the launcher model kicks back and the view nudges up; its trail is a flame that fades into smoke left hanging behind. Barrels hurt by a blast at the same moment go off one after another along the shock (about 16 m/s, never closer than 0.12 s apart, the whole roll within 2.4 s), nearest first, instead of all at once. Each blast also throws embers, and its boom is three layers (crack, boom, rumble) that arrive later and duller the farther you are. Hit-stop, slow motion on big blasts, the shake that falls off with distance, the screen flash and scorch marks come from Juice. Budget: later blasts of a chain make less (fewer particles, no light, no embers) and a phone makes less again, so a ten-barrel chain stays inside `H.budget`. `feel.sample()` gives what happened (`chains`, `rolled`, `lastDelays`, `embers`, `muzzle`, `layers`, `maxLive`); the pure numbers are `HawkesPlay.mayhemMath` (`soundDelay`, `chainSchedule`, `detail`, `boomLayers`, `emberCount`, `launcherKick`).

**The layers of a blast** (`HawkesPlay.mayhem.vfx`, `mayhem-vfx.js`; looks only): every barrel and rocket blast is built from pooled layers: a GPU-particle fireball (an 8x8 flipbook, additive, three size classes by the blast's radius), a smoke column fed up over about a second that drifts with `H.wind.dir` and lingers 6 to 8 s, a fast ground ring and dust in the colour of the surface under it, sparks with trails, one pooled point light for 0.15 s that lights the ground and props, a scorch mark (a plane lifted 3 cm with a polygon offset) that fades over 60 s, and on desktop High a heat ripple (a post-process alive for 0.6 s, the first blast of a chain only). A phone makes half the particles, no ripple and reads 512 px flipbooks (1024 px elsewhere). The flipbooks (fire, smoke, sparks) are drawn in code in slices after the world starts; `vfx.useSheets({ fire, smoke, sparks })` replaces them with Hawkes Gen sprite sheets (urls). Until they are drawn `vfx.ready()` is false and the older effects stand in. Rolo's rocket (vehicles of class `rocket`) gets an exhaust flame, dust thrown from the pad and a smoke trail that follows the whole climb. Nothing is allocated per blast after the first; damage, physics, hit-stop, shake, debris and the boom are unchanged. `vfx.sample()` gives each layer's count and the last blast's layers (what the playtest logs; also `window.__mayhemVfx()`); the numbers are `HawkesPlay.mayhemMath.vfxPlan(radius, k, tier, chain)`.
