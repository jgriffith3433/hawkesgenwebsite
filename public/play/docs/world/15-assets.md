## Assets by id

Every asset of a game has an **id** (`a_...`, from Gen), a **name** (`cow.glb`, `cow-2.glb`: what old scripts use), a
title ("Spotted cow") and **words** ("cow", "spotted cow"). A game can hold many assets for one word (seven cows from
the community library). Anywhere a spec takes an asset (`shape.asset`, `shape.model`, `material.texture`, `config.sky`,
sounds, videos, TV channels) it takes an **id** (best: it never changes) or a name. Never make up a file name: use an id
from "Assets in the game", or say what you need in "assets" so it can be made or picked from the community library.

**`config.assets`** is the world's own choice per word, in order:

```json
{ "op": "config", "patch": { "assets": { "cow": { "ids": ["a_1", "a_2", "a_3"], "mix": true } } } }
```

- The first id is the default: every cow (a creature, a herd, `spawnMany('cow')`, a cow from the spawn gun) uses it.
- `"mix": true` spreads the ids over many things: a herd of 30 gets a mix of the three, each animal always the same one.
- `"only": true`: never other assets labelled with the word.
- Without an entry, a word uses the game's assets labelled with it (plurals and other words too: "cows", "calf"), the
  first by default; and before ids, names (`cow.glb`, then `cow-2.glb`).
- Changing it changes what's in the world at once (the herd swaps its cows).

Every module finds its art by word this way: animals by species ("cow", "horse"), terrain layers ("terrain grass",
"grass"), scatter ("tree", "rock"), fish ("trout", "fish"), the bucket and the rod, vehicle sounds ("car engine",
"engine", "horn"), mayhem sounds ("explosion", "moo"), homes' furniture ("sofa"), videos ("cartoons").

Examples in words:
- "use the spotted cow instead" → `{ "op": "config", "patch": { "assets": { "cow": { "ids": ["<the spotted cow's id>"], "mix": false } } } }`.
- "mix in some brown cows" → that word's `ids` with the brown cow's id added, `"mix": true` (a community thing: list it in
  "assets" with "community" set to its id; the people pick it and it is added as a variant).
- "make the trees pine trees" → `config.assets.tree.ids` = the pine tree's id.
