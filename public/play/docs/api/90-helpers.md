## Helpers

`game.random(min, max)`, `game.randomInt(min, max)`, `game.pick(array)`, `game.clamp(v, min, max)`,
`game.lerp(a, b, t)`, `game.asset(name)` (an asset's URL), `game.hasAsset(name)`, `game.log(...)` (prints in the
editor). `game.scene`, `game.engine` and `game.BABYLON` are Babylon itself, for anything else.

## A whole game (rules on top of a world)

```js
// scripts/main.js: the world has coins (behaviors: collectible) and a door with the "opens" behavior.
game.state.score = 0;
game.ui.text('goal', 'Collect 5 coins to open the gate', { x: 'center', y: 'top' });
game.onUpdate(() => {
  game.ui.bar('hp', game.player.health / 100, { label: 'Health', y: 'bottom' });
  if (game.state.score >= 5 && !game.state.open) {
    game.state.open = true;
    game.entity('gate').destroy();
    game.ui.message('The gate is open!');
  }
});
```
