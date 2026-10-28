## Items and money (`game.items`)

| | |
|---|---|
| `game.items.give(item, n)`, `take(item, n)` | The player's bag (online through the host). |
| `game.items.has(item, n)`, `count(item)`, `bag`, `money` | What they carry. |
| `game.items.use(item)` | Uses it (its `use`), as the Use button does. |
| `game.items.buy(shop, item)`, `sell(shop, item)`, `craft(make)` | As the panels do. |
| `game.items.unlock(door)` | As E at a `locked` thing. |
| `game.items.about(item)` | `{ name, icon, about, price, usable }`. |
| `game.items.open('bag' / 'bench')` | Opens the panel. |

```js
// A bounty: 10 coins for every crate broken, a key after five.
let n = 0;
game.on('death', (d) => { if (d.entity && d.entity.name === 'Crate') { game.items.give('coins', 10); if (++n === 5) game.items.give('key'); } });
```
