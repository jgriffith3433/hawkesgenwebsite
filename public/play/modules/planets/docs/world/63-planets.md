## Planets: more than one in a game (`config.planets`)

The world as written is the **home planet**. `config.planets.list` adds others. Each hangs in the sky as a planet you
can see; fly up into space (2.5 km up, or in a rocket or spaceship) and **🪐 Planets** opens: pick one, a warp, and you
arrive standing on it (your ship with you). Everyone in the room travels together.

```json
"planets": {
  "home": { "name": "Verdant" },
  "travel": "space",
  "list": [
    { "id": "ember", "name": "Ember", "about": "lava seas, low gravity", "biome": "lava", "radius": 8000, "gravity": 0.6,
      "terrain": { "shape": "volcano" }, "water": false, "time": { "hour": 21 } },
    { "id": "frost", "name": "Frost", "biome": "ice", "gravity": 0.9, "weather": "storm" },
    { "id": "moon", "name": "The Moon", "biome": "ice", "radius": 1500, "gravity": 0.17, "at": [0, 0, 0] }
  ]
}
```

| Planet key | What |
|---|---|
| `id`, `name`, `about` | A short id (letters, digits, dashes), the name on the board and in the warp, a line under it. |
| `biome`, `radius`, `color` | Its look from space and on it (as `config.planet`: earth, forest, desert, ice, ocean, lava, alien). A round home planet stays round: a different `radius` is a smaller or bigger ball (the world starts again on it). |
| `planet`, `terrain`, `water`, `weather`, `time`, `blocks`, `look` | Its own of those world settings (the same shapes as the world's). Left out: none of them (a bare planet); `planet` left out is home's with this biome and radius. |
| `gravity` | 1 normal, 0.17 a moon, 0.38 Mars-like. |
| `at` | Where you arrive (the world file's numbers), unless a `spawn` thing is on it. |

`travel`: `"space"` (default: the board opens high up or in a rocket or spaceship; `from`: the height in meters, 2500)
or `"anywhere"` (always). **Things on a planet:** give a thing `"data": { "planet": "ember" }`; things without it are
home's. While you are away, the home planet's things are put away (and come back when you return); what you make while on
a planet is on it. The ability **`warp-gate`** (`planet`: an id, or empty for the next one) sends you when you walk into
it. Events: `travel` (`{ from, to }`), `arrive` (`{ planet, name }`).

**In words:** "put me on an entirely new planet" -> a `planets.list` entry and `game.planets.travel('<id>')` in a script
(or a `warp-gate` in front of them); "let me fly to different planets" -> three or four planets in `planets.list`, a
spaceship (`type: "spaceship"`) or a rocket, `travel: "space"`; "a moon base" -> a small icy planet with `gravity` 0.17
and the base's things with `data.planet`.
