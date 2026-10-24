## Camera shots, photo mode and clips (`config.cinematics`, `config.share`)

Every game has **photo mode** (the game stops, a free camera flies anywhere, then a PNG to save or share), **"clip
that"** (the last 15 seconds saved in one press, then trimmed and saved or shared), and
**cinematic camera shots**: intros, cut-scenes and trailer shots with letterbox bars and no HUD. Shared photos and clips
get a page at `/s/<id>` with a "Play this game" button. None of it needs art or credits. For now players get no 📷 🎬
buttons and no P / F8 keys unless the world asks: `"share": { "buttons": true, "keys": { "photo": "p", "clip": "f8" } }`;
scripts open them with `game.photo.open()` and `game.photo.clip()` (a "Photo" button in your own menu).

### Shots: `config.cinematics`

A named shot in scene.json's config. Players and scripts play it by name (`game.cinematic.play('intro')`); the build
editor's **🎥 Shots** panel makes them by flying around and dropping keys.

```json
{ "op": "config", "patch": { "cinematics": {
  "intro": { "type": "path", "autoplay": true, "title": "Fire Island", "subtitle": "a game by Ava", "fade": 0.8,
             "keys": [ { "pos": [-60, 40, -60], "look": "Volcano" },
                       { "pos": [0, 25, -45], "look": "Volcano" },
                       { "pos": [30, 12, -10], "look": [0, 2, 0] } ], "seconds": 12 },
  "volcano": { "type": "orbit", "target": "Volcano", "seconds": 10, "degrees": 360, "height": 18 }
} } }
```

| Shot | Fields |
|---|---|
| `"type": "path"` | `keys`: `[{ pos: [x, y, z], look: [x, y, z] or a thing's name, at?: seconds, hold?: seconds, ease?, fov?, roll? }]` (a key without `look` looks where the path goes next). `seconds` (or `speed` m/s): keys without `at` are spread by distance, so the camera moves evenly. `ease`: `smooth` (default), `inOut`, `linear`, `in`, `out`, `sine`. The camera curves smoothly through every key |
| `"type": "orbit"` | `target` (a thing's name or `[x, y, z]`), `seconds` (10), `degrees` (360: once round; 90: a quarter), `radius` (from the thing's size), `height`, `from` (degrees: 0 is from the south), `loop` |
| `"type": "follow"` | Rides with a moving thing: `target` (a name, `"player"`, or `"vehicle"`: the one you're in), `distance` (8), `height` (3), `angle` (0 behind, 90 its right side, 180 in front), `side` (m to the right: a dolly), `lead` (looks ahead), `smooth`, `seconds` (none: until stopped). **The player keeps control** (drive while it films) |
| `"type": "dolly"` | A follow shot from the side, like a camera car: `side: 6, angle: 90` |
| `"type": "fixed"` | Stays at `pos` and keeps `target` in the picture (it turns to follow it) |
| `"type": "sequence"` | `shots`: a list of shots (or names), cut one after another |

On any shot: `autoplay: true` (plays when the game starts; one shot), `letterbox` (true by default, false, or an aspect like
`2.39`), `hud: true` (keep the HUD; hidden by default), `controls` (true: the player keeps control), `slowmo` (0.3: the
world at 30% speed during the shot), `fade` (seconds from and to black, or `{ "in": 1, "out": 0.5 }`), `title` and
`subtitle` (words over the picture), `skippable` (Esc, Space or a tap skips; autoplay shots are), `then: "stay"` (the
camera stays when it ends), `loop`, `fov` (degrees).

### Settings: `config.share`

`{ "clip": 15, "clips": true, "photo": true, "buttons": true, "caption": true, "keys": { "photo": "p", "clip": "f8" } }`.
`clip` is how many seconds "clip that" keeps (3-60); `clips` keeps them all the time (on by default on computers, off on
phones until the player turns it on: it costs a video encoder); `photo: false` turns photo mode off (a competitive game);
`caption: false` leaves the game's name off photos; `"share": false` turns all of it off.

### In words

- "Make an intro camera fly-over of my island" → a `path` shot with `autoplay: true`, a `title`, `fade: 1`, keys high
  over the sea coming in toward the island's middle (look at the island's main thing by name), 10-15 seconds.
- "An orbit shot around the volcano when the game starts" → `{ "type": "orbit", "target": "Volcano", "autoplay": true,
  "seconds": 10 }`.
- "Show the castle, then the dragon, then the player" → a `sequence` of a `fixed` or `orbit` shot for each.
- "Slow motion when the rocket hits" → a script: `game.cinematic.slowmo(0.2, 1.5)` in the explosion's handler.
- "Film me driving the 4x4 up the mountain" → `game.cinematic.follow('vehicle', { angle: 30, distance: 9, height: 3 })`
  (or `dolly` for alongside), recorded with the 🎥 panel's Record or `game.cinematic.record(...)`.
- "No photo mode in my game" → `{ "share": { "photo": false } }`.
