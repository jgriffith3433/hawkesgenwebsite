## Planets (`game.planets`)

| | |
|---|---|
| `game.planets.list()` | `[{ id, name, biome, gravity, home }]` (home first). |
| `game.planets.here` | The planet you're on (`'home'` for the world as written). |
| `game.planets.travel(id, { fx: true })` | Everyone goes there (with the warp; `fx: false` at once). False while building or already going. |
| `game.planets.canTravel`, `open()` | Whether the board can open here; opens it. |

```js
// Chapter two begins on Ember.
game.on('quest', (q) => { if (q.id === 'chapter-1' && q.done) game.after(3, () => game.planets.travel('ember')); });
game.on('arrive', (p) => { if (p.planet === 'ember') game.ui.message('Ember. It is hot here.', 3); });
```
