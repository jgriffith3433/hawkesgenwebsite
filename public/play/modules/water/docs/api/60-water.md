## Water

`game.water` is the water in the world (the sea, water things, rain) and what you can do with it. WORLD.md "Water" has
the settings; this is for scripts.

| | What |
|---|---|
| `game.water.surfaceAt(x, z)` | Height of the water's surface there (waves included), or `null` where there's no water. |
| `game.water.inWater(pos)` | True if a point `[x, y, z]` (or a thing's middle) is under water. `depthAt(pos)`: how far under (negative: above). |
| `game.water.at(pos)` | `{ body, surface, depth }` or null: which water (`body.kind` is `"ocean"` or `"box"`, `body.entity` the water thing). |
| `game.water.bodies()` | Every body of water. `game.water.sea` is the sea (or null); `game.water.level` its level (settable). |
| `game.water({ size: [w, h, d], x, y, z, basin, waves, current, fish, color })` | Makes a water thing (like `game.box`). |
| `game.water.rise(level, seconds)` | Moves the sea's level smoothly: floods, tides, a draining lake. |
| `game.water.dump(target, { volume, height })` | Water falls on a thing, a player (by name: `'Sam'`; `'me'`) or a point `[x, y, z]`: it splashes, knocks people over, soaks them and puts out fire. `volume`: 1 a bucket, 10 a bathtub, 50 a water tower. Online the host decides what it pushes. |
| `game.water.splash(pos, size)` | Just the splash (spray, rings, sound): `size` 0.2 a pebble to 3 a cannonball. `ripple(x, z, size)`: rings only. |
| `game.water.wet(thing, seconds)` | Makes it wet (drips; puts out fire). `isWet(thing)`, `dry(thing)`. |
| `game.water.buoyancy(thing, { density, drag, points })` | Floats a thing for this step: call it every step from `game.physics.beforeStep` for your own hulls (vehicles do). Returns `{ submerged, surface, depth }`. Everything dynamic already floats by `data.density`; calling this takes over for that thing. |
| `game.water.swimming()` | True while you swim. `game.water.underwater`: your head is under. `game.water.rain`: how hard it rains (0 to 1). |
| `game.water.sound(name, { at, volume })` | `'splash'`, `'plop'`, `'bite'`, `'reel'`, `'catch'`, `'snap'`, `'drip'` (the game's own sound of that name if it has one). |

### Fish

| | What |
|---|---|
| `game.water.fish.list()` / `get(id)` | Every species: `{ id, name, rarity, water, kg: [min, max], cm: [min, max], color, strength }`. |
| `game.water.fish.add({ id, name, rarity, water, kg, cm, color, strength, points, chance, model })` | A species of your own (`rarity`: common, uncommon, rare, legendary, junk; `water`: fresh, salt, any; `strength` 0 to 1: how it fights; `model`: an asset name). `remove(id)`. |
| `game.water.fish.in(pos)` | The species living in the water there. `roll(pos)`: a random catch from there. |
| `game.water.fish.give(id, { weight })` | Counts as a catch for this player (the card, the log, the `catch` event for everyone). |
| `game.water.fish.journal()` | This player's catch log: `{ fish: { trout: { count, best, longest } }, total, points }`. `log()` opens it on screen (species caught with their best, the rest as silhouettes; J, or 📖 on phones), `clear()` empties it. Kept with the Overseer's memory: in the account when signed in, on this device otherwise. |
| `game.water.fish.odds(pos, { hour, depth, luck })` | `[{ id, p }]`: the chance of each species there. A species has `hours: [from, to]` (it bites 2.5x likelier then, 0.3x otherwise; wraps past midnight) and `depth: "shallow" \| "mid" \| "deep"` (1.8x / 0.4x; a longer cast reaches deeper: under 3.5 m shallow, under 6 mid). Nothing is ever ruled out. `hour` is the world's clock (`game.sky.hour`). |
| `game.water.fish.board()` | Rewrites the catch boards: any thing with `data: { catchBoard: true }` shows your species count and three biggest, and E near it opens the log. |

### Events (`game.on`)

| event | data |
|---|---|
| `'catch'` | `{ fish: { id, name, rarity, weight, length, points }, by: { id, name }, mine, entity }`: on every player's screen, for every catch (contests) |
| `'species'` | `{ fish: { id, name, rarity, weight, length }, entity }`: this player's first catch of a species (not junk): a banner and confetti, and the Overseer notes it. `'catch'` data has `fish.first` |
| `'cast'`, `'bite'`, `'hooked'`, `'escape'`, `'snap'` | the fishing steps, on the fisher's screen |
| `'splash'` | `{ at, size, entity }`: something went into the water (or water landed: `bucket: true`) |
| `'soaked'` | `{ at, radius, entities, volume }`: dumped water landed |
| `'extinguish'` | `{ at, radius, entity, entities, by }`: water put out what is there (fire listens: Mayhem) |
| `'wet'`, `'knocked'`, `'swim'` (`{ swimming }`), `'underwater'` (`{ under }`), `'weather'`, `'rain'` (every 2 s while raining), `'lightning'`, `'bucket'` | |

### Examples

```js
// "Dump a bucket of water on Sam" (anyone in the game by name; a big one with volume: 20).
game.water.dump('Sam');

// "Every 30 seconds, drop a huge wave of water on a random player."
game.every(30, () => { const p = game.pick(game.all('player')); if (p) game.water.dump(p, { volume: 25 }); });

// "A fishing contest: 3 minutes, the heaviest catch wins."
const best = {};
game.ui.message('Fishing contest! 3 minutes', 2);
game.on('catch', (c) => {
  const who = c.by.name || 'You';
  best[who] = Math.max(best[who] || 0, c.fish.weight);
  game.ui.text('board', Object.entries(best).sort((a, b) => b[1] - a[1]).map(([n, kg]) => `${n}: ${kg} kg`).join('\n'), { x: 'right' });
});
game.after(180, () => { const top = Object.entries(best).sort((a, b) => b[1] - a[1])[0]; game.over(top ? `${top[0]} wins with ${top[1]} kg!` : 'No fish caught'); });

// "Flood the island slowly, then drain it."
game.water.rise(3, 20); game.after(40, () => game.water.rise(-0.6, 20));

// "Make the boat float" (a hull of your own: lift at four corners, so it rocks and rights itself).
const hull = game.find('Boat');
game.physics.beforeStep(() => game.water.buoyancy(hull, { density: 0.35, points: [[-1, -0.4, -2], [1, -0.4, -2], [-1, -0.4, 2], [1, -0.4, 2]] }));

// "Add a rare eel to the fish" (your own species).
game.water.fish.add({ id: 'night-eel', name: 'Night eel', rarity: 'rare', water: 'any', kg: [1, 4], color: '#2b2d6e', strength: 0.8 });

// "Put out the fire when it rains."
game.on('rain', () => { for (const f of game.all('fire')) f.destroy(); });
```
