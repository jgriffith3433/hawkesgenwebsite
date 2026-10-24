## The Overseer, the sky and the planet (`game.overseer`, `game.sky`)

```js
// A beam from the Overseer onto the crate (things you create are beamed in by themselves).
game.overseer.beam(game.find('Crate'), { radius: 2 });
// Beam something in: it grows out of the light.
const gift = game.box({ x: 0, y: 0.5, z: 6, color: '#ffd166' });
game.overseer.materialize(gift);
// Arrivals: things made by spawnMany come down by themselves (dropped, grown or beamed, by what they are).
game.spawnMany('car', 1, { at: [0, 0, 10] });              // out of the sky onto that spot (on the roof if there is one)
game.spawnMany('cow', 20, { at: game.player, area: 10 });  // a herd rains down one by one
game.spawnMany('crate', 4, { arrive: 'beam' });            // or say how: 'drop', 'grow', 'beam', 'none'
// Things a script makes with game.box, game.model... just appear; bring one in from the sky yourself:
const prize = game.box({ x: 0, y: 0.5, z: 6, color: '#ffd166', physics: 'dynamic' });
game.arrive(prize, 'drop');
game.on('landed', ({ thing, at, weight }) => { if (weight > 0.6) game.ui.message('THUD', 1); });
// The Overseer speaks (words over the picture).
game.overseer.say('You found the key. Do with it what you will.', 4);
// The time of day.
game.sky.hour = 'night';              // or 21.5
game.sky.time = { hour: 6, minutes: 8 }; // a running clock
if (game.sky.hour > 20) game.ui.message('Night falls');
// How high you are, and whether you've reached space.
game.every(1, () => { if (game.sky.space > 0.9) game.ui.message('Space!', 1); });
game.on('docked', () => game.ui.message('Welcome aboard'));
```

| | |
|---|---|
| `game.overseer.beam(target, opts)` | A beam from the emitter to a thing or `[x, y, z]`. `opts`: `radius` (m, at the bottom), `seconds` (1.6), `hold: true` (stays until `.end()`), `color`, `entity` (grows in), `ring`, `sound`. Returns `{ end(), move(target) }` |
| `game.overseer.materialize(thing or [things], opts)` | Beams it in (one wide beam for several) |
| `game.overseer.say(text, seconds)` | Words from the Overseer over the picture |
| `game.arrive(thing or [things], how)` | Brings it in from the Overseer where it is now: `'drop'` (from high in the beam; real physics while playing; lands on a roof over it), `'grow'` (up out of the ground), `'beam'`, `'auto'` (by what it is). Several drop one by one |
| `game.spawnMany(what, n, { arrive })` | `arrive`: `'drop'`, `'grow'`, `'beam'`, `'none'`, or `{ how, delay, gap }` (seconds before the first, between each). Default: by what it is. Online the host's copies fall for real and everyone sees the same |
| `game.on('landed', ({ thing, at, weight, on }) => ...)` | A dropped thing came down (`weight` 0-1: how heavy it felt; `on`: what it landed on) |
| `game.overseer.intro()` | Plays the intro now (a promise: `{ skipped }`) |
| `game.overseer.position`, `.radius` | Where it is (`null` when the game has none) |
| `game.sky(colorOrAsset)` | As before: a sky picture or colour |
| `game.sky.hour` | The clock's hour (0-24; `null` with no clock). Set it (a number or `"night"`, `"dawn"`...) to jump there |
| `game.sky.time = value` | Like `config.time` (WORLD.md) |
| `game.sky.day` | Daylight now, 0.12 (night) to 1 |
| `game.sky.altitude`, `game.sky.space` | The camera's height above sea level, and 0 (in the air) to 1 (in space) |
| `game.on('intro', ({ state, skipped }) => ...)` | The intro starts (`state: 'start'`) and ends (`'end'`) |
| `game.on('beam', ({ at, radius, entity }) => ...)` | Every beam |
| `game.on('docked')`, `game.on('undocked')`, `game.on('docked-pad', ({ vehicle }))` | In the Overseer's hangar; landed on its pad |

Modules: `H.sky` (the one owner of the clock and the light: report what you want with `H.sky.set(owner, { dark, flash,
weather })`, never write the lights yourself; `H.sky.bg` is the far layer, `H.sky.onBg(fn)` places far things each
frame), `H.planet` (`air(y)`, `altitude(y)`, `drop(d)`, `space`, `radius`, `surface`; every standard/PBR material curves
with the planet; a custom shader adds `y -= |xz - camera.xz|² / 2R` itself), `H.overseer` (`beam`, `materialize`,
`emitter()`, `flare(k)`, `hangar`, `docked`, `intro`; a beam's `pulse(k)`), `H.arrive` (`bring(things, { how, exact })`,
`how(entity)`, `plan(specs)` (building: a drop's spot, roof and all, before the op), `landing(at, { lift, half })`,
`quake(at, { radius, rise, seconds })` (the ground moving), `down(at)` / `up(at)`, `of(entity)`, `active`).
