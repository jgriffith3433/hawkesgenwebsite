# Hawkes Play scripting

A game is a world (`scene.json`, see WORLD.md) plus scripts. The runtime (Babylon.js underneath) runs every `.js`
file in `behaviors/` and then `scripts/`, in name order (or the order in `game.json` `"scripts"`), with one global:
**`game`**. Scripts share data through `game.state`. Units are meters and seconds. +y is up, +z is forward,
rotations are in degrees. Saving a script updates the running game at once (no reload; the player stays put).

Every game already has a **first-person player** (WASD, mouse look, space to jump, shift to run) and catches anyone
who falls out of the world. Put the things in the world with scene.json; use scripts for the rules (scores, timers,
waves, winning) and for things that come and go.

## game.json (optional)

```json
{
  "background": "#9fd3f0",
  "gravity": -24,
  "ambient": 0.7,
  "sun": 0.9,
  "shadows": true,
  "pixelated": false,
  "fog": { "color": "#9fd3f0", "start": 40, "end": 120 },
  "look": true,
  "sky": true,
  "player": true,
  "controls": true,
  "ui": { "font": "Georgia, serif", "accent": "#f4c430", "panel": "rgba(30,20,10,.85)", "radius": 4 },
  "scripts": ["scripts/world.js", "scripts/player.js"]
}
```

Everything is optional. `"lights": false` turns off the default sky light and sun; `"look": false` the game look
(glow, vignette, filmic color); `"sky": false` the gradient sky; `"player": false` the built-in player (make your
own camera); `"controls": false` keeps the player but lets your scripts move it. `"ui"` themes every screen the game
makes (below).

## Lifecycle

| Call | What |
|---|---|
| `game.onStart(fn)` | After every script has run. |
| `game.onUpdate((dt, time) => {})` | Every step (60 a second). `dt` is seconds since the last one. |
| `game.after(seconds, fn)` | Once, later. Returns a function that cancels it. |
| `game.every(seconds, fn)` | Repeats. Returns a function that cancels it. |
| `game.time` | Seconds since the start (stops while paused). |
| `game.now` | Seconds on a clock every player shares: use it for things that must line up between players. |
| `game.pause()`, `game.resume()`, `game.paused` | Pause: updates, timers and physics stop. |
| `game.restart()` | Starts the game over (the world as built, the scripts again). |
| `game.over(text?)` | Pauses and shows a message with a Play again button. |
| `game.mode` | `'build'` in the editor while building, `'play'` when playing. |
| `game.state` | A plain object for your data. Empty after a restart. |
| `game.save(key, value)`, `game.load(key, fallback)` | Kept across restarts while the page is open. |

## Events

`game.on(name, (data) => {})` hears the engine's events and your own (`game.emit(name, data)`):
`'kill'` (you destroyed something: `{ entity }`), `'death'` (anything destroyed, the player too: `{ entity, by }`),
`'hurt'`, `'pickup'`, `'checkpoint'`, `'finish'`, `'gate'` (`{ entity, points }`), `'waypoint'`.

`game.damage(target, amount, from)` hurts anything: the player, another player (over the network), or a thing with
health (the `health` or `enemy` behavior), which is destroyed at 0.

