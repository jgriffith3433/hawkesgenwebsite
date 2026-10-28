## Strategy (`game.rts`)

With `config.rts` (World: Strategy).

| | |
|---|---|
| `game.rts.units(team?)`, `buildings(team?)`, `resources()` | The living ones. |
| `game.rts.selected`, `select(things, add)` | The player's chosen units. |
| `game.rts.order(units, { type, to, target })` | `type` move, amove (fight on the way), attack, gather, stop, hold (on the host, or offline). |
| `game.rts.command(type, { to, target })` | As the player: the chosen units (online, through the host). |
| `game.rts.train(building, name)` | Trains a unit if its side can pay. |
| `game.rts.unlock(building, name)` | It learns to train another unit (a name, or `{ name, cost, time, spec }`): progression. |
| `game.rts.spawn(name, team, [x, y, z])` | A unit at once, free (a story's reinforcements). |
| `game.rts.resource(team?, kind?)`, `give(team, n, kind?)` | A side's resources. |

```js
// Progression: after the third wave the station learns to build frigates.
game.on('wave', (w) => {
  if (w.n === 3) { game.rts.unlock(game.entity('station'), 'frigate'); game.ui.message('Frigates unlocked', 3); }
});
```
