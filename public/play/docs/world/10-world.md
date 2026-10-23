# The world (scene.json)

A game's world is `scene.json`: settings, and a list of **things**. The editor changes it as you build (grab, drop,
the cards, the hotbar, undo), and so does the assistant. Every change is saved and shows up for everyone in the game
at once. Scripts (API.md) run on top of the world and can find its things with `game.entity(id)` or `game.find(name)`.

```json
{
  "config": { "background": "#9fd3f0", "ambient": 0.7, "sun": 0.9, "gravity": -24, "fog": null },
  "entities": {
    "crate_1": {
      "type": "box", "name": "Crate",
      "transform": { "position": [2, 0.5, 4], "rotation": [0, 30, 0], "scale": [1, 1, 1] },
      "shape": { "size": [1, 1, 1] },
      "material": { "color": "#b07a45" },
      "physics": "dynamic", "body": { "bounce": 0.2 },
      "behaviors": [{ "use": "spin", "speed": 45 }]
    }
  }
}
```

Units are meters, seconds and degrees. +y is up. A thing's position is its center.

