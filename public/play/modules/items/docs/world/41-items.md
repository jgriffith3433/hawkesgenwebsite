## Items and money (`config.items`)

Every player has a **bag**. Money is an item (`coins` by default): pick it up, earn it in rules, spend it in shops.
**🎒** (or I) opens the bag; usable items have a Use button. The rules' `give`, `take` and `has` use the same bag.

```json
"items": {
  "currency": "coins", "start": { "coins": 10 },
  "defs": { "lantern": { "icon": "🏮", "about": "lights the way", "use": { "emit": "lantern" }, "consume": false, "price": 40 } },
  "recipes": [{ "make": "planks", "count": 4, "from": { "wood": 1 } }]
}
```

Items every game knows: coins 🪙, gem 💎, key 🗝️, health potion (heals 40), speed potion and jump potion (15 s), food
(heals 15), wood, stone, rocket launcher (a weapon in hand). `defs` adds or changes any: `icon`, `about`, `price` (what
shops ask by default), `use` (`heal`, `speed` and `seconds`, `jump` and `seconds`, `tool`: a tool in hand, `emit`: an
event for a script), `consume` (false: kept after use).

| Ability | What | Settings |
|---|---|---|
| `item` | walk into it: it goes in your bag (a coin, a key, a gem...) | `item`, `count`, `respawn` (seconds; 0: once), `spin` |
| `shop` | E opens it: buy (and sell back) | `name`, `sells` ("health potion:10, key:25" or `[{ item, price, stock }]`), `buys` ("gem:40") |
| `locked` | E with the item opens it (it slides away) | `needs` (key), `keep`, `move` (meters), `axis`, `signal` (sent when it opens) |
| `bench` | E opens crafting (config.items.recipes) | |

Events: `item` (`{ item, count, total }`), `pickup`, `buy`, `sell`, `craft`, `use`, `unlock`. The kit `market` lays out
a stall, coins, a locked vault with a gem and a bench.
