## Playing together

Everyone in a game runs the scripts. Things in the world, players and what they hold are kept in step for you; for
anything else your scripts decide, tell the others:

| Call | What |
|---|---|
| `game.net.send(name, data)` | Tells everyone else. `game.net.everyone(name, data)` includes you. |
| `game.net.on(name, (data, from) => {})` | Hears it. Also `'join'` and `'leave'` (`{ id, name }`). |
| `game.net.isHost` | True for one player (the one who simulates the world): spawn shared enemies here. |
| `game.net.players` | The others: `[{ id, name, color, entity }]`. `game.net.me`, `game.net.online`. |
| `game.rewind(seconds)` | Takes the world back (10 s at most; alone at once, together only the host's counts). `game.resetWorld()` starts it over as it loaded. |

What players see of each other is a smooth replay of the data, a little behind (about a tenth of a second plus the
network); their own player and whatever they drive or carry answer at once. Don't send positions yourself: things in
the world, players and vehicles are kept in step for you.

