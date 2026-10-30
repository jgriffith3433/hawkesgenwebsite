## Looks: choosing how a thing looks (`game.looks`)

A thing has a function (its kind: a truck drives, a chair seats, a cow grazes) and a look (the model it wears). The
looks chooser changes only the look: the camera turns round the thing, the player picks a look from the community
library or the game's own models (shown on the thing at once), or has a new one made with Hawkes Games. A truck wearing
a teapot still drives like a truck. It opens only while building, or on the player's own island; never in a published
game.

```js
game.looks.open(game.find('Blue truck'));     // the chooser, on that thing
game.on('looks', ({ state, id, look }) => {}); // 'open', 'done' (look: the asset it wears now), 'cancel'
```

Where a look lives: `shape.model` for the kinds that wear one (vehicles, creatures, furniture), `shape.asset` for a
model thing; a plain shape (a box) becomes a model thing of its size. The Overseer opens it with a `look` line.
