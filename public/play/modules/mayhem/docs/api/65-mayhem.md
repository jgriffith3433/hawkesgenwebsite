## Mayhem (`game.mayhem`, `game.spawnMany`, `game.explode`)

| Call | What |
|---|---|
| `game.spawnMany(what, count, { at, area, pattern, spacing, size, height, velocity, data })` | Makes `count` things at once and returns them. `what`: a word (`'cow'`, `'cows'`, `'barrel'`, `'crate'`, `'ball'`, `'box'`, any animal or noun), a kind, an asset (`'tree.glb'`), or a scene spec (`{ type: 'sphere', shape: { radius: 0.3 }, material: { color: '#ff0000' } }`). `at` (default: in front of the player, on the ground), `area` (a radius, or `[width, depth]`), `pattern`: `'scatter'` (default), `'grid'`, `'circle'`, `'line'`, `'pile'`, `'stack'`, `'rain'` (dropped from the sky; `height` adds more). Stays within `config.mayhem.maxSpawn` (the oldest go first). Online, everyone gets the same things and the host moves them |
| `game.explode([x, y, z], { radius: 5, force: 18, damage: 40, fire: false, color, sound })` | A real explosion: things thrown and spun (heavier ones less), damage falling off with distance, breakables broken, barrels set off, `fire: true` lights things, a fireball, shockwave, smoke, debris, a shake and a boom. Online the host decides it once for everyone |
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
