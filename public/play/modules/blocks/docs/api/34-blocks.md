## Blocks (`game.blocks`)

With `config.blocks` on (World: Blocks). Block coordinates are whole numbers from 0 at the world's corner; `y` up.

| | |
|---|---|
| `game.blocks.get(x, y, z)` | The block's name (`'air'` for nothing). |
| `game.blocks.set(x, y, z, type)` | Changes one block for everyone (`type` a name, or `'air'`). |
| `game.blocks.fill([x, y, z], [x, y, z], type)` | A box of blocks (at most 20,000). Returns how many. |
| `game.blocks.mine(x, y, z)`, `place(x, y, z, type)` | As a player would (the `mine` / `place` events), from no bag. |
| `game.blocks.top(x, z)` | The highest solid block's y in a column (-1: none). |
| `game.blocks.at([x, y, z])` | The block a world point is in. `game.blocks.toWorld(x, y, z)`: a block's middle in the world. |
| `game.blocks.aim()` | What the crosshair is on: `{ x, y, z, n: the face, type }` or null. |
| `game.blocks.bag`, `give(type, n)`, `take(type, n)`, `count(type)` | The player's bag. |
| `game.blocks.select(type)`, `picked` | The block R places. |
| `game.blocks.craft(name)`, `recipes` | Crafting. |
| `game.blocks.edits()` | The changes from the seed's world, as `config.blocks.edits`. |

```js
// A tower of gold where the player starts, and a reward for every diamond.
const [x, , z] = game.blocks.at(game.player.position);
game.blocks.fill([x + 3, game.blocks.top(x + 3, z) + 1, z], [x + 3, game.blocks.top(x + 3, z) + 6, z], 'gold');
let found = 0;
game.on('mine', (d) => { if (d.type === 'diamond' && ++found === 5) game.over('Five diamonds! You win'); });
```
