## Races (`game.race`, `game.on('race')`)

The world's courses are run by the Race module (WORLD.md, "Races"); a script reads and listens.

```js
game.on('race', (d) => {
  if (d.state === 'countdown') game.ui.message(String(d.n), 0.8);           // 3, 2, 1
  if (d.state === 'go') game.ui.message('GO!', 1);
  if (d.state === 'gate') console.log(`gate ${d.index} of ${d.of}`, d.ms, d.delta);   // d.delta: ms against your best run's gate (null the first time)
  if (d.state === 'finish') game.ui.message(d.isBest ? 'New best!' : 'Finished', 2);   // d.ms, d.best, d.previous, d.beatGhost, d.beatPar
});
```

| Call | What |
|---|---|
| `game.on('race', fn)` | `state`: `countdown` (`n`: 3, 2, 1), `go` (`ghost`: whether one is racing), `gate` (`index`, `of`, `lap`, `ms`, `delta`), `lap` (`lap`, `laps`, `ms`, `delta`), `finish` (`ms`, `isBest`, `previous`, `best`, `beatGhost`, `par`, `beatPar`, `rival`), `abort` (`why`: `left`, `wrecked`, `far`, `rescue`). Every one has `course` (the id). |
| `game.race.courses` | The courses as set in the world: `id`, `name`, `vehicle`, `laps`, `width`, `par`, `rival`, `gates` (`x`, `y`, `z`, `dx`, `dz`: the way it faces). |
| `game.race.state` | `{ phase: 'idle' \| 'countdown' \| 'running', course, lap, laps, ms, next, checkpoint, of }`. |
| `game.race.best(id)` | The best time in ms (0: none yet), from the account's memory and this device. |
| `game.race.ghost(id)`, `game.race.board(id)` | The kept ghost (`{ ms, step, p }`, decimeters) and the board rows (`{ rank, name, ms, rival }`). |
| `game.race.showBoard(id)` | Opens the board card. |
| `game.race.abort(why)` | Calls the race off. |
| `game.race.setLaps(id, n)` | Changes a course's laps (not while it is being raced). |

Times are milliseconds of game time from GO. A script that wants the island's Pip to cheer, a prize at a best time or a
race of its own kind (on foot?) listens to `race` and does it; the clock, gates, ghost and board stay the module's.
