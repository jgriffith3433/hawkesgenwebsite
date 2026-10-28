## Mood: how the world feels (`config.mood`), and scary things

`"mood": "scary"` makes a world frightening with the engine's own parts: the dark comes in, fog close round you (30 m),
a **flashlight** in your hand (T, or 🔦 on a phone), a low drone and wind made live, creaks far off, film grain and a
dark vignette, and a **heartbeat** that quickens when something is near. `"eerie"` is the same, lighter. `"calm"` is
none of it. Or an object: `{ "preset": "scary", "dark": 0.9, "fog": 20, "fogColor": "#05070a", "flashlight": true,
"sound": true, "grain": true, "heartbeat": true }`.

| Ability | What | Settings |
|---|---|---|
| `stalker` | comes for the player **only while they aren't looking at it** (or the flashlight is off and it's dark), stops dead when looked at; when it reaches them: a jump scare, it hurts, and it is back where it started. `mode: "chase"` always comes (slower while looked at). | `mode` unseen / chase, `speed` 3.2, `damage` 25, `sight` 45, `scare` true, `text` (words on the scare) |
| `scare` | a place that jump-scares you when you walk in: a flash, a sting, the screen shakes, words or a picture for a moment | `text`, `image` (an asset), `once` true, `delay` seconds |
| `flicker` | a light (or a thing) flickers and sometimes goes out | `rate`, `low` |

Events: `scare` (`{ text, by }`), `caught` (`{ by }`). A script's own jump scare: `game.mood.scare({ text: 'RUN' })`.

**In words:** "make a scary game" -> `"mood": "scary"`, a place to escape from (corridors, a locked door and a key, a
`goal` at the way out), one or two `stalker`s, a `scare` in a doorway, `flicker` on the lamps, and a story in a script
(notes to find, objectives one at a time with game.ui). The kit `haunted` lays a small one out. Keep it frightening, not
gory: tension, the dark, sounds and surprise.
