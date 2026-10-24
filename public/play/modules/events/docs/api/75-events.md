## Events and quests from scripts (`game.events`)

The rules of WORLD.md "Events" work from scripts too, and scripts can add their own actions and conditions. Rules
added by a script last while the game runs (the world's `config.events` is saved). Scripts run on every player's
machine; rules run on the host, so adding the same rule everywhere is right (the others forward their triggers).

| Call | What |
|---|---|
| `game.events.add(rule)` | Adds a rule (`{ id, when, if, do }`, or a list); returns its id. Same id replaces |
| `game.events.remove(id)`, `enable(id, on)`, `disable(id)`, `get(id)`, `list()` | Manage rules (`get` has `count`: how often it ran) |
| `game.events.run(id, data)` | Runs a rule now (its `if` too). Host only |
| `game.events.do([actions])` | Runs actions now, on the host (on a guest it does nothing: the host does it for everyone) |
| `game.events.value(name, playerId?)`, `set(name, value, { per, player })`, `change(name, by, { per })`, `declare(name, value, per)` | Variables (the host's; everyone sees them). `game.events.vars` is the globals |
| `game.events.standings(name)` | A per-player variable, best first: `[{ id, name, value }]` |
| `game.events.has(item, n)`, `items(playerId?)`, `give(item, n)` | The player's bag |
| `game.events.hour` (settable), `clock` (`{ hour, day, text }`), `dark(0.8, fade, seconds)` | The time of day; the dark |
| `game.events.disaster(name, opts)`, `stop(name or 'all')`, `disasters` | Starts a disaster on this screen (use the `disaster` action in rules to reach everyone) |
| `game.events.action(name, fn(a, ctx), { scope })` | A new action: `{ "confetti": true, ... }` then works in rules. `scope`: `'all'` (every screen, default), `'host'` (once), `'player'` (who triggered it). `ctx.who` is `{ id, name }`, `ctx.data` the trigger's data |
| `game.events.condition(name, fn(c, ctx))` | A new condition |
| `game.events.history` | The last rules that ran (`{ rule, t, who }`): for checking a game works |
| `game.events.banner(title, sub, seconds)`, `game.events.sound(name)` | The big title, a made sound |

**Quests:** `game.events.quests`

| Call | What |
|---|---|
| `add(quest)` | Adds a quest (WORLD.md "Quests") |
| `start(id)`, `complete(id)`, `fail(id)`, `advance(id)` | Moves it on |
| `state(id)` | `'locked'`, `'available'`, `'active'`, `'done'`, `'failed'` |
| `step(id)`, `progress(id)` | The current step's id; `{ stepId: { goalIndex: n } }` |
| `talk(id)`, `choose(id, i)` | Does a `talk` goal / picks a `choice` (what the giver's dialog does) |
| `open()`, `close()`, `talkTo(thing)`, `track(id)`, `list()` | The quest log, a giver's dialog, the tracked quest |

```js
// "Confetti" as an action anyone's rules can use.
game.events.action('confetti', (a, ctx) => { game.burst(game.player.position, { color: a.color || '#ff5ad1', count: 80, speed: 8 }); });
game.events.add({ id: 'party', when: { event: 'finish' }, do: [{ confetti: true }, { win: '{player} made it!' }] });

// A wave every 30 seconds, more each time.
game.events.declare('wave', 0);
game.events.add({ id: 'waves', when: { every: 30 }, do: [{ var: 'wave', add: 1 }, { banner: 'Wave {wave}' }, { spawn: 'zombie', count: 5, at: { at: 'player', radius: 25 } }] });

// A script's own event triggers rules (and quests' event goals).
game.input.onKey('h', () => game.emit('honk', { by: game.player }));
game.events.add({ when: { event: 'honk' }, cooldown: 2, do: [{ sound: 'horn' }] });

// A quest from code.
game.events.quests.add({ id: 'hello', title: 'Say hi', giver: 'Max', steps: [{ goal: { talk: 'Max' } }], reward: { score: 5 } });
```

For modules: `HawkesPlay.events` (`defineAction`, `defineCondition`, `defineDisaster(name, { seconds, start(h), step(h, dt) })`,
`things(ref)`, `posOf(ref)`, `inside(point, zone)`, `perform(action, ctx)`, `addRule`, `quests`). Any event a module
sends with `game.emit(name, data)` can trigger rules by name; put `mine: true` in the data when it's about this
player only (or `me`), so a guest's machine forwards it to the host.
