## Controls (`game.controls`)

Every game has a **Controls** button (on a computer `?` opens it too): the keys that work right now (moving, the camera,
E, Q spawns, K changes how the thing you point at looks, L your own look, I the bag, B emotes, Enter talks, Esc twice
pauses), plus what the moment adds (driving, a tool in hand, building). On a phone it is a sheet of big buttons that do
those things (Spawn, Change look, My look, Bag, Emotes, Journal, Quests, Talk, Camera, Stuck?).

| | |
|---|---|
| `game.controls.add({ group, keys, what, when, act, icon, tap })` | Your game's own line: `keys` as shown ("G"), `what` it does, `when()` (shown only then), and for phones `tap` (the button's word), `icon` and `act()` (what the button does). Returns a remover. |
| `game.controls.open()`, `close()`, `list()` | Open it, close it, what it shows now. |
| `game.controls.changeLook()` | As K: the look chooser on what the player points at (or the vehicle they're in), where looks can be chosen. |

```js
// A game with its own keys: they show in Controls, and on phones as a button.
game.controls.add({ group: 'This game', keys: 'G', what: 'throw a snowball', tap: 'Throw', icon: '❄️', act: () => throwSnowball() });
```
