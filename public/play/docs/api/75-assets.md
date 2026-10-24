## Assets by id (`game.assets`)

Every function that loads an asset (`game.model`, `game.sprite`, `game.sound`, `game.music`, `game.sky`, textures,
videos) takes an asset id (`a_...`) or a name. To find the game's assets for a word, ask:

| | |
|---|---|
| `game.assets.for('cow', { kind: 'model' })` | The ids for a word, in order: `config.assets.cow` first, then every asset labelled "cow" (plurals and other words too), then names (`cow.glb`, `cow-2.glb`). `kind`: `model`, `image` (texture, sprite, sky), `sound` (sfx, music, voice), `video` |
| `game.assets.pick('cow', { kind: 'model', seed: thing.id })` | The one for this thing: the default, or (when the word mixes) a variant picked by `seed`: the same every time for the same seed |
| `game.assets.get(ref)` | `{ id, name, url, type, title, words }` for an id or a name (or null); `game.assets.url(ref)`, `game.assets.has(ref)` |
| `game.assets.list()` | Every asset of the game |
| `game.assets.words()` | Each word and the ids it uses (`{ cow: { ids, mix } }`) |

```js
// "A tree from the game's own trees at every corner" (a different one each, the same every time).
for (const [i, [x, z]] of [[-10, -10], [10, -10], [-10, 10], [10, 10]].entries()) {
  const id = game.assets.pick('tree', { kind: 'model', seed: `corner${i}`, mix: true });
  if (id) game.model(id, { x, z, size: 6 }); else game.cone({ x, z, y: 2, radius: 1.5, height: 4, color: '#3d6b35' });
}
```
