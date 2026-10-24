## The spawn wheel from scripts (`game.spawnWheel`)

```js
game.spawnWheel.open();                    // opens the wheel (the sheet on phones), if the player may spawn now
game.spawnWheel.close();
game.spawnWheel.allowed();                 // building, or config.spawn lets players spawn while playing
await game.spawnWheel.spawn('cow', 10);    // as the wheel would: by word or id ("4x4", "species:cow", "tool:lasso")
game.spawnWheel.search('boat');            // [{ id, name, type, category }], best first
game.on('spawn', ({ item, count, ids }) => { /* someone used the wheel: item { id, name, type, category } */ });
```

- While playing, `spawn` makes runtime things (not saved; shared online through Mayhem's spawning) and only when the
  game allows it (`config.spawn`). While building it makes saved scene things (one undo).
- For spawning by script without the wheel's rules, use `game.spawnMany(what, count, opts)` (Mayhem).

Modules: `H.spawn` holds the model (`types()`, `categories(type)`, `items(type, category)`, `load(...)`, `search(q)`,
`place(spec, { count, floats })`, `spawn(item, { count })`, `recent`, `favorites`). A kind registered with
`editor.hotbar` entries or a `codex.spec` shows up in the wheel by itself (its `codex.group` picks the type);
`editor: { spawn: false }` keeps a kind out of it.
