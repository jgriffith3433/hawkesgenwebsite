## The Overseer, the sky and the planet (`game.overseer`, `game.sky`)

```js
// A beam from the Overseer onto the crate (things you create are beamed in by themselves).
game.overseer.beam(game.find('Crate'), { radius: 2 });
// Beam something in: it grows out of the light.
const gift = game.box({ x: 0, y: 0.5, z: 6, color: '#ffd166' });
game.overseer.materialize(gift);
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
`emitter()`, `hangar`, `docked`, `intro`).
