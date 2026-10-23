## Playing together

Everyone in a game runs the scripts. Things in the world, players and what they hold are kept in step for you; for
anything else your scripts decide, tell the others:

| Call | What |
|---|---|
| `game.net.send(name, data)` | Tells everyone else. `game.net.everyone(name, data)` includes you. |
| `game.net.on(name, (data, from) => {})` | Hears it. Also `'join'` and `'leave'` (`{ id, name }`). |
| `game.net.isHost` | True for one player (the one who simulates the world): spawn shared enemies here. |
| `game.net.players` | The others: `[{ id, name, color, entity }]`. `game.net.me`, `game.net.online`. |

