## Living things (`HawkesPlay.living`)

Makers: `game.creature({ species, x, z, ...shape })` (with `count` > 1 it makes a herd), `game.herd({ species, count,
position })`, `game.friend({ name, personality, species, x, z })`. Every creature is an entity (push it, hurt it,
`e.say('Moo')`), with `e.data.species` and `e.hp`. A herd's animals are `herd.members`. `game.living` is also
`HawkesPlay.living`: write `const living = HawkesPlay.living;` at the top of a script (`game.living` is the same thing,
but only once the world is running: in updates, events and timers, not at the top of a script or in `onStart`).

| | |
|---|---|
| `living.spawn(species, opts)` | one creature (`x`, `z`, `y`, `follow`, `temper`, `size`, `color`...), or a herd with `count` (and `at`, `radius`) |
| `living.all(species?)`, `living.near(at, radius, species?)` | creatures |
| `living.command(e, what, opts)` | `'follow'` (`target`: `'player'`, an entity or a name), `'stay'`, `'sit'`, `'sleep'`, `'come'` (`target`), `'goto'` (`at: [x, z]`), `'dance'`, `'cheer'`, `'fetch'` (`target`), `'carry'` (`thing`), `'drop'`, `'wander'`, `'attack'` (`target`), `'flee'` (`target`); `seconds` ends it |
| `living.follow(e, target)`, `living.stay(e)`, `living.goTo(e, [x, z])`, `living.wander(e)` | the same, shorter |
| `living.startle(at, { radius, strength })` | scares the creatures near a point: they run (herds stampede). Explosions (the engine's `'explosion'` event: any blast) and gunfire do it by themselves; the closest are knocked over |
| `living.status(e)` | `{ species, state, act, hunger, energy, fear, following, carrying, riding, routine? }` (state: idle walk run eat sleep sit dance knocked attack cheer fly swim flop; `act` may also be `fish` / `tend` / `wave` on a routine; `routine` is `{ spot, facing, visited, want }` when `shape.routine` is set) |
| `living.hour()` | the world's hour (0–24) for routines, or null when there is no clock |
| `living.ride(e)`, `living.dismount()` | puts the player on a creature and off it (the `ride` controller) |
| `living.path(from, to)` | a way around obstacles: `[[x, z], ...]` or null |
| `living.pickUp(e, thing)`, `living.drop(e)` | a creature carries something (in its mouth or its arms) |
| `living.talk(friend, text)` | says something to an AI friend: a promise of `{ say, action }` (the action happens). Friends answer from a free phrasebook (personality, species voice); there is no paid AI talk |
| `living.act(friend, action, say)` | makes a friend do and say something: `living.act(max, 'dance', 'Watch this!')` |
| `living.openChat(friend)` | opens the chat with a friend (`null` closes it) |
| `living.chat.addChip({ label, show(friend), act(friend) })` | a button of your own in friends' chats (shown when `show` says so); returns a function that removes it |
| `living.species.add(name, def)` | a new species: `living.species.add('goat', { ...living.species.get('sheep'), colors: { body: '#eee', head: '#eee', legs: '#555', accent: '#555' } })` |
| `living.count`, `living.max` | how many creatures there are, and the world's limit |
| `living.on('startle' / 'hurt' / 'act' / 'routine', fn)` | hear about it (`routine`: a stays friend walked, arrived, faced the player or resumed) |

The **`ball` tool** (`game.player.tool = 'ball'`): click (or G, or the Throw button on phones) throws it; dogs fetch
it; walk over it to pick it up. The **`ride` controller**: `game.player.control('ride', { mount: horse })`.

Playing together: the host runs the brains (a rider runs their mount) and herds send their animals' places a few
times a second; what a friend says and does reaches everyone.

```js
// A dog that follows you, and a ball to throw for it.
game.onStart(() => {
  const rex = game.creature({ species: 'dog', name: 'Rex', x: 2, z: 2, follow: 'player' });
  game.player.tool = 'ball';
});

// 50 sheep; a wolf shows up after 30 seconds.
game.onStart(() => {
  game.herd({ species: 'sheep', count: 50, position: [0, 0, 20] });
  game.after(30, () => game.creature({ species: 'wolf', x: 40, z: 40 }).living.hunger = 1);
});

// A shepherd friend who comes when you score.
const max = game.friend({ name: 'Max', personality: 'a calm old shepherd', follow: false, x: -3, z: 4 });
game.on('score', () => HawkesPlay.living.act(max, 'cheer', 'Well done!'));

// Stampede on a key.
game.input.onKey('k', () => HawkesPlay.living.startle(game.player.position, { radius: 30 }));
```
