## Events: rules that make the game (`config.events`)

**This is how you build game logic from words.** A rule is plain JSON: **when** something happens, **if** conditions
hold, **do** actions. Timers, zones, buttons, races, contests, disasters, waves of enemies, scores, winning: all rules.
Prefer rules over scripts: they are saved in the world, run online correctly (the host decides; see the end) and
can't crash. Rules only run while playing.

```json
{ "op": "config", "patch": { "events": {
  "vars": { "fish": { "value": 0, "per": "player" } },
  "clock": { "hour": 18, "day": 600 },
  "hud": ["clock"],
  "rules": [
    { "id": "night-zombies", "when": "night", "do": [{ "zombie-night": { "seconds": 120, "count": 12 } }] }
  ]
} } }
```

`config.events` (lists replace: send the whole `rules` list when you change one):

| key | what |
|---|---|
| `rules` | the list of rules (below). `config.events` can also just be the list |
| `vars` | variables and their start values: `{ "score": 0 }`; per player: `{ "laps": { "value": 0, "per": "player" } }` |
| `clock` | a time of day: `{ "hour": 8, "day": 720 }` (start hour; seconds a whole day lasts, 720 = 12 minutes). The sky darkens at night. On by itself when a rule uses a time |
| `hud` | variables shown top right: `["score", { "var": "fish", "label": "Fish", "per": "player" }, "clock"]` |
| `leaderboard` | per-player variables shown as a ranking: `[{ "var": "fish", "title": "Most fish" }]` |

### A rule

`{ "id": "name", "when": trigger or [triggers (any)], "if": condition or [conditions (all)], "do": [actions], "else": [actions], "once": true, "cooldown": 5, "max": 3, "enabled": false }`

### When (triggers)

| trigger | fires when |
|---|---|
| `"start"` | the game starts |
| `{ "after": 30 }` | 30 s after the start (once) |
| `{ "every": 300, "from": 60, "until": 600, "each": "player" }` | every 300 s (first at `from`, default the same); `each: "player"` runs it once per player (with that player as "who") |
| `"night"`, `"dawn"`, `"noon"`, `"dusk"`, `"midnight"`, `{ "time": 21.5 }` | the clock reaches that hour (every day) |
| `{ "enter": "Zone" }`, `{ "leave": "Zone" }` | a player goes into / out of a `zone` thing (or near any thing: `"near": 3`, or `{ "at": [x, y, z], "radius": 5 }`). `"what": "sheep"`: things (not players) going in |
| `{ "touch": "Lava" }` | a player touches that thing |
| `{ "click": "Button" }` | a player clicks or taps it |
| `{ "use": "Bell", "label": "Ring the bell", "reach": 2.5 }` | a player presses E near it (phones: tap the prompt) |
| `{ "key": "b" }` | a player presses a key |
| `{ "event": "catch", "of": "trout", "where": { "fish.weight": { ">=": 5 } } }` | **any event by name** (list below). `of` matches what it's about (the thing, vehicle, fish...) by name, tag, kind or species; `where` checks its data |
| `{ "var": "score", "reaches": 10 }` | a variable crosses a value: `reaches` (>=), `above`, `below`, `equals`; nothing: any change |
| `{ "count": "zombie", "below": 1 }` | how many things match crosses a value ("when all the zombies are dead") |
| `{ "destroyed": "Tower" }` | that thing is destroyed (by anything) |
| `{ "weather": "storm" }` | the weather becomes that (`rain`, `storm`, `drizzle`, `clear`, `snow`; `true`: any change) |
| `{ "creature": "cow", "is": "sleep" }` | a creature changes state (idle walk run eat sleep sit dance attack flee...) |
| `{ "quest": "sheep", "is": "done" }` | a quest starts, finishes or fails (`"start"`, `"done"`, `"failed"`; `"step": "id"`) |

**Events by name** (`{ "event": name }`): `explosion` (`position`, `radius`), `death` (`entity`, `by`), `kill`,
`hurt`, `pickup` (`entity`, `gives`), `checkpoint`, `finish`, `waypoint`, `gate`, `score` (`points`, `total`), `item`
(`item`, `count`), `catch` (`fish`: `id`, `name`, `rarity`, `weight`, `length`), `cast`, `bite`, `splash`, `soaked`,
`extinguish`, `swim`, `underwater`, `rain`, `lightning`, `weather`, `enter` / `exit` (a vehicle: `vehicle`, `seat`,
`driver`), `crash` (`vehicle`, `speed`), `wrecked`, `break`, `ignite`, `spawned`, `landed`, `mayhem`, `terrain`,
`disaster` (`name`, `state`: start/end), `quest` (`id`, `state`, `step`), and anything a script sends with
`game.emit(name, data)` (or an `emit` action): new modules' events just work.

### If (conditions)

A list means all of them; `{ "any": [...] }`, `{ "not": {...} }`.

| condition | true when |
|---|---|
| `{ "var": "coins", ">=": 5 }` | compare: `>`, `>=`, `<`, `<=`, `=`, `!=` (or `above`, `below`, `equals`); per-player variables are the player's who triggered it |
| `{ "count": "zombie", "<": 1 }` | how many things match |
| `{ "chance": 0.3 }` | 30% of the time |
| `{ "who": "host" }`, `{ "who": "Sam" }`, `{ "team": "red" }` | who triggered it (`team` is their per-player variable `team`) |
| `{ "has": "key" }`, `{ "has": "apple", "count": 3 }` | they carry an item or hold that tool |
| `{ "in": "Hill" }`, `{ "everyone": "Boat" }`, `{ "nobody": "Hill" }` | where they (or all players) are |
| `{ "quest": "sheep", "is": "active" }` | a quest's state: `available`, `active`, `done`, `failed`, `locked`; `"step": "id"` |
| `{ "time": [20, 6] }`, `{ "time": "night" }` | the clock's hour is in that window |
| `{ "elapsed": [60, 180] }` | seconds since the start |
| `{ "players": true, ">=": 2 }` | how many are playing |
| `{ "weather": "rain" }`, `{ "alive": "Boss" }` | the weather now; a thing still exists |

### Do (actions)

One action per object (its first key names it). Words in text fill in: `{player}` (who triggered it), a variable
(`{score}`), `{best:fish}` / `{bestValue:fish}` (the leader of a per-player variable), `{count:zombie}`, `{clock}`.
Things (`remove`, `set`, `move`...): a name, id, tag, kind or species (all that match), `"player"` (who triggered it),
`"players"`, or **`"it"`: the thing the trigger was about** (the coin touched, the button clicked, the tower destroyed).
Places (`at`, `to`): `[x, y, z]`, `[x, z]` (on the ground), `"player"`, a thing, `"it"`,
`{ "at": "Graveyard", "radius": 10 }` (a random spot there), `"random"`.

| action | does |
|---|---|
| `{ "spawn": "zombie", "count": 10, "at": "Graveyard", "area": 8, "pattern": "rain", "tag": "wave1" }` | makes things: any word (animals are real creatures, `zombie` hunts players), a kind, an asset, or a scene spec. `tag` names them for later rules |
| `{ "remove": "wave1", "count": 3 }` | removes things |
| `{ "move": "Boat", "to": "Dock", "seconds": 3 }`, `{ "move": "Door", "by": [0, 3, 0], "seconds": 1 }` | moves things (smoothly with seconds) |
| `{ "teleport": "player", "to": "Start" }` | moves the player there (`"players"`: everyone) |
| `{ "set": "Door", "color": "#ff0000", "visible": false, "physics": "dynamic", "data": {...}, "behaviors": [{ "use": "spin" }] }` | changes a thing: position, rotation, scale, color, emissive, opacity, visible, physics, tag, name, velocity, gravity, mass |
| `{ "behavior": "Rock", "use": "patrol", "range": 6 }` | gives a thing a behavior |
| `{ "explode": "Tower", "radius": 8, "force": 25, "damage": 50, "fire": true }` | a real explosion at a place or thing |
| `{ "damage": "player", "amount": 20 }`, `{ "heal": "player", "amount": 50 }` | hurts / heals the player (or things with health) |
| `{ "ignite": "Hay" }` | sets things on fire (Mayhem) |
| `{ "message": "The gate is open", "seconds": 3, "to": "player" }` | a message. `to`: `"all"` (default), `"player"` (only who triggered it), `"team:red"` |
| `{ "banner": "ROUND 2", "sub": "Fight!", "seconds": 3, "style": "win" }` | a big title (`style`: `win`, `lose`, `quest`) |
| `{ "countdown": 3, "then": "GO!", "freeze": true }` | 3, 2, 1, GO! (players can't move until GO) |
| `{ "timer": "Contest", "seconds": 180 }` | a countdown clock on screen (`"seconds": 0` removes it) |
| `{ "hud": "laps", "label": "Laps", "of": 3 }`, `{ "leaderboard": "fish", "title": "Most fish" }` | shows a variable / a ranking |
| `{ "sound": "bell" }`, `{ "music": "theme.mp3" }`, `{ "music": null }` | a sound (the game's asset, else made: `bell`, `chime`, `fanfare`, `alarm`, `siren`, `horn`, `whistle`, `drum`, `rumble`, `wind`, `beep`, `win`, `lose`, `boom`, `splash`...) |
| `{ "say": "Hello!", "by": "Max" }` | a speech bubble over a thing |
| `{ "friend": "Max", "act": "dance", "say": "Woo!" }`, `{ "creatures": "sheep", "do": "follow", "target": "player" }` | AI friends and creatures (follow, stay, come, sit, sleep, dance, cheer, flee, attack, wander) |
| `{ "shake": 0.5, "seconds": 1 }`, `{ "burst": "Chest", "color": "#ffd84a" }` | camera shake, sparks |
| `{ "weather": "storm" }` (`rain`, `drizzle`, `clear`), `{ "sky": "#101830" }`, `{ "fog": { "color": "#ccc", "end": 40 } }` | the sky and weather |
| `{ "time": 21 }` (or `"night"`), `{ "dark": 0.8, "seconds": 60 }` | sets the clock; darkens the world (for seconds, then back) |
| `{ "water": 3, "seconds": 20 }` | the sea rises (or falls) to that level (Water module; makes a sea if there is none) |
| `{ "dig": [x, z], "radius": 10, "depth": 6 }`, `raise`, `lower`, `flatten`, `crater` | reshapes terrain (`config.terrain`) |
| `{ "give": "rocket-launcher" }`, `{ "give": "apple", "count": 3 }`, `{ "take": "apple" }` | a tool in hand, or items in the player's bag |
| `{ "var": "score", "add": 1 }`, `"set"`, `"sub"`, `"toggle"`; `{ "score": 10 }` | variables (`"per": "player"` for the player's own); `score` adds to the player's score |
| `{ "quest": "sheep", "do": "start" }` | quests: `start`, `complete`, `fail`, `advance`, `reset`, `available` |
| `{ "disaster": "tornado", "seconds": 30 }` or `{ "tornado": { "seconds": 30 } }`, `{ "stop": "tornado" }` | disasters (below); `stop: "all"` |
| `{ "win": "{player} wins!" }`, `{ "lose": "Out of time" }`, `{ "end": "The end" }`, `{ "restart": true }` | ends the game for everyone |
| `{ "run": "other-rule" }`, `{ "enable": "id" }`, `{ "disable": "id" }`, `{ "emit": "door-open", "data": {...} }` | other rules; your own events |
| `{ "wait": 3 }` | waits before the next action |
| `{ "repeat": 5, "every": 1, "do": [...] }` (`"repeat": "forever"`, `"while": cond`, `"until": cond`) | repeats |
| `{ "if": cond, "do": [...], "else": [...] }`, `{ "random": [[...], [...]] }`, `{ "each": "player", "do": [...] }` | branches; a random one; once per player |

### Disasters (actions, on every screen at once)

| disaster | options (defaults) |
|---|---|
| `tornado` | a funnel that wanders, lifts and spins things and players: `seconds` 30, `at` (near the player), `radius` 7, `strength` 1, `speed` 3, `range` 35 |
| `meteor-shower` (`meteors`) | fireballs from the sky, each an explosion (fire, craters on terrain): `seconds` 30, `area` 35, `every` 0.8, `radius` 4, `damage` 30 |
| `flood` | the sea rises over the land, stays, goes back down: `seconds` 45, `depth` 2.5 (over the ground), or `level`; `rise` 12 s, `recede` (seconds, or false), `storm`: true. Needs the Water module |
| `earthquake` | shaking, things thrown about, cracks in terrain: `seconds` 8, `radius` 70, `strength` |
| `zombie-night` (`zombies`) | night falls, zombies come from the dark in `waves` (3) around every player (`count` 10), a "Dawn in" timer; at dawn they burn: `seconds` 90, `dark` 0.8 |
| `blizzard` | snow, white-out fog, wind, slower walking: `seconds` 40, `strength`, `wind` [x, z] |
| `volcano` | a mountain (terrain, or a rock cone) that rumbles, smokes and throws lava bombs that explode and burn: `seconds` 40, `at` (32 m ahead), `height` 16, `radius` 14, `every` 0.9, `keep`: true leaves the cone |

Every disaster sends `disaster` events (`{ "name": "tornado", "state": "start" / "end" }`) and cleans up after itself.

### Zones (`type: "zone"`)

An invisible area rules watch (shown while building). `shape.size` `[w, h, d]` or `shape.radius` (+ `height`);
`shape.show: true` keeps it glowing while playing (a hill to hold, a finish area). Any thing works as a place too
(within 2.5 m).

### Playing together

The host runs the rules. A player's own triggers (their zone, their click, their catch) go to the host, which checks
the conditions and runs the actions: world changes once (spawning, explosions, damage, digging), effects for everyone
(messages, sounds, weather, disasters), and "player" things (a tool, `"to": "player"` messages, teleports) for that
player only. Variables and quests are kept by the host and shown to all.

### Examples in words (copy these)

- **"every night zombies attack"** → `{ "clock": { "hour": 17, "day": 480 }, "hud": ["clock"], "rules": [{ "id": "zombies", "when": "night", "do": [{ "zombie-night": { "seconds": 100, "count": 12 } }] }] }` (the night lasts until the zombies' dawn).
- **"a meteor shower at noon"** → `{ "clock": { "hour": 9 }, "rules": [{ "id": "meteors", "when": "noon", "do": [{ "banner": "Look up!", "sub": "Meteor shower" }, { "meteor-shower": { "seconds": 30 } }] }] }`.
- **"when I ring the bell the island floods"** → a `cylinder` named Bell on a post, and `{ "id": "bell", "when": { "use": "Bell", "label": "Ring the bell" }, "cooldown": 60, "do": [{ "sound": "bell" }, { "message": "The tide is coming!" }, { "wait": 2 }, { "flood": { "seconds": 40, "depth": 2 } }] }` (with `config.water` for a sea).
- **"a tornado every 5 minutes"** → `{ "id": "tornado", "when": { "every": 300 }, "do": [{ "sound": "siren" }, { "banner": "Tornado!" }, { "tornado": { "seconds": 40 } }] }`.
- **"a fishing contest: most fish in 3 minutes wins"** → give rods (`config.player.tool: "rod"`), then `{ "vars": { "fish": { "value": 0, "per": "player" } }, "leaderboard": [{ "var": "fish", "title": "Fish caught" }], "rules": [ { "id": "go", "when": "start", "do": [{ "banner": "Fishing contest!", "sub": "Most fish in 3 minutes" }, { "timer": "Contest", "seconds": 180 }] }, { "id": "fish", "when": { "event": "catch" }, "do": [{ "var": "fish", "add": 1 }, { "message": "{player} caught a {fish.name}!" }] }, { "id": "end", "when": { "after": 180 }, "do": [{ "win": "{best:fish} wins with {bestValue:fish} fish!" }] } ] }`.
- **"a race with a countdown and a finish line"** → `waypoint`s (checkpoints and a "finish"), and `{ "rules": [ { "id": "go", "when": "start", "do": [{ "countdown": 3, "then": "GO!" }, { "timer": "Race", "seconds": 120 }] }, { "id": "won", "when": { "event": "finish" }, "once": true, "do": [{ "win": "{player} wins the race!" }] }, { "id": "late", "when": { "after": 123 }, "do": [{ "lose": "Too slow!" }] } ] }`.
- **"king of the hill"** → a `zone` "Hill" (`shape: { "radius": 4, "show": true }`) on a mound, and `{ "vars": { "hill": { "value": 0, "per": "player" } }, "leaderboard": [{ "var": "hill", "title": "Seconds on the hill" }], "rules": [ { "id": "hold", "when": { "every": 1, "each": "player" }, "if": { "in": "Hill" }, "do": [{ "var": "hill", "add": 1 }] }, { "id": "king", "when": { "var": "hill", "reaches": 60 }, "do": [{ "win": "{player} is king of the hill!" }] } ] }`.
- **"collect 10 coins to open the gate"** → 10 thin `cylinder`s tagged `coin` (`physics: "trigger"`), `"hud": [{ "var": "coins", "label": "Coins", "of": 10 }]` and `{ "id": "coin", "when": { "touch": "coin" }, "do": [{ "remove": "it" }, { "sound": "chime" }, { "var": "coins", "add": 1 }, { "if": { "var": "coins", "=": 10 }, "do": [{ "move": "Gate", "by": [0, 4, 0], "seconds": 2 }, { "message": "The gate opens!" }] }] }`.
- **"lava hurts"** → `{ "when": { "touch": "Lava" }, "cooldown": 0.5, "do": [{ "damage": "player", "amount": 15 }] }`.
- **"when all the zombies are dead, next wave"** → `{ "when": { "count": "zombie", "below": 1 }, "do": [{ "var": "wave", "add": 1 }, { "banner": "Wave {wave}" }, { "spawn": "zombie", "count": 8, "at": { "at": "player", "radius": 25 } }] }`.
- **"press B to drop a bomb"** → `{ "when": { "key": "b" }, "cooldown": 1, "do": [{ "spawn": "barrel", "at": "player" }] }`.
- **"an earthquake when someone pulls the lever"** → `{ "when": { "use": "Lever", "label": "Pull the lever" }, "do": [{ "earthquake": { "seconds": 6 } }] }`.
- **"day and night"** → `{ "clock": { "hour": 8, "day": 600 }, "hud": ["clock"] }`.

## Quests (`config.quests`)

People and AI friends ask for help: a "!" floats over them, the player walks up and presses E (or T, or taps;
friends also get a quest button in their chat), reads the quest, and accepts. Steps show in the **quest log** (📜
button, or Tab) and a tracker on screen; a glowing marker and an arrow at your feet point the way; finishing it pops
a banner, a fanfare and the rewards. Givers speak from your `lines` (free; no paid AI talk). Everyone playing shares
the quests (the host keeps them).

```json
{ "op": "config", "patch": { "quests": [ {
  "id": "sheep", "title": "Lost sheep", "giver": "Max",
  "text": "My sheep ran off in the storm! Can you find them and bring them to the barn?",
  "lines": { "accept": "Bless you!", "progress": "Any luck?", "done": "My sheep are home!", "decline": "Oh... maybe later." },
  "setup": [{ "spawn": "sheep", "count": 5, "at": { "at": [40, 0, 30], "radius": 20 }, "tag": "lost-sheep" }],
  "steps": [
    { "id": "find", "text": "Find the 5 lost sheep", "goal": { "find": "lost-sheep", "count": 5 } },
    { "id": "barn", "text": "Bring them to the barn", "goal": { "bring": "lost-sheep", "count": 5, "to": "Barn" } },
    { "id": "back", "goal": { "talk": "Max" } }
  ],
  "reward": { "score": 50, "give": "lasso", "text": "Max's old lasso" }
} ] } }
```

| quest key | what |
|---|---|
| `id`, `title`, `text` | its name and what the giver asks |
| `giver` | who gives it (a friend or any thing, by name). No giver: it starts by itself (`auto: true/false` overrides). A thing can also give quests with the behavior `{ "use": "quest-giver", "quest": "sheep" }` |
| `lines` | what the giver says: `offer` (default `text`), `accept`, `decline`, `progress`, `done` |
| `steps` | in order. A step: `{ "id", "text", "goal": {...} }` or `"goals": [...]` (all of them; `"any": true`: any one, and each goal's `next` picks the branch), `"next": "stepId"` (or `"end"`, `"fail"`), `"choice": [{ "label": "Help the farmer", "next": "farm" }, ...]` (the giver asks), `"optional": true` (a side objective that runs alongside the steps after it), `"do"` (actions when it starts), `"done"` (actions when it's done), `"reward"` |
| `setup` | actions when it starts (spawn what it needs) |
| `reward` | `{ "score": 50, "give": "lasso" or ["lasso", { "item": "gold", "count": 3 }], "var": { "trust": 1 }, "unlock": "next-quest", "enable": "rule-id", "do": [actions], "text": "shown in the fanfare" }` |
| `requires` | quest ids that must be done first (`locked` until then) |
| `seconds` | a time limit: it fails at 0 (and can be taken again) |
| `repeatable`, `onFail` | can be done again; actions when it fails |

**Goals** (`count` is how many, default 1):

| goal | done when |
|---|---|
| `{ "collect": "coin", "count": 5 }` | the player walks into 5 things that match (they disappear); `"pickup": true` counts `pickup` events instead |
| `{ "find": "lost-sheep", "count": 5 }` | the player finds them (walks up to them); creatures then follow the player |
| `{ "reach": "Lighthouse" }` | a player gets there (a zone, any thing, `[x, y, z]`) |
| `{ "talk": "Max" }` | the player talks to them (E near them) |
| `{ "catch": "trout", "count": 3 }` | catches fish (`"any"`, an id, a rarity: `"legendary"`) |
| `{ "drive": "car" }`, `{ "drive": "any", "to": "Garage" }` | gets in a vehicle; drives one there |
| `{ "defeat": "zombie", "count": 10 }` | those die |
| `{ "bring": "sheep", "count": 5, "to": "Barn" }` (also `herd`, `build`) | that many matching things are in the place at once (herd animals, carry crates, build a tower of blocks there) |
| `{ "deliver": "apple", "count": 3, "to": "Max" }` | a player with 3 apples in their bag comes to Max (they're handed over) |
| `{ "survive": 120 }`, `{ "until": "dawn" }` | time passes (seconds; or the clock reaches an hour) |
| `{ "use": "Lever", "label": "Pull the lever" }` | E on a thing |
| `{ "have": "gold", "count": 10 }`, `{ "var": "trust", ">=": 3 }`, `{ "event": "door-open", "count": 1 }` | items, variables, any event |

Quests send `quest` events (`id`, `state`: start, step, stepdone, done, failed): rules can react (`{ "when": { "quest":
"sheep", "is": "done" }, ... }`). A rule can start one: `{ "quest": "sheep", "do": "start" }`.

**Quests in words:**
- **"a quest from Max: find 5 lost sheep and bring them to the barn"** → the example above, plus a `zone` named Barn
  (`size` `[8, 4, 8]`) by a barn, and Max: `{ "type": "friend", "name": "Max", "shape": { "personality": "a worried old shepherd", "follow": false, "lines": ["Have you seen my sheep?"] } }`.
- **"the fisherman wants a legendary fish"** → `{ "id": "legend", "title": "The big one", "giver": "Old Pete", "steps": [{ "goal": { "catch": "legendary" } }, { "goal": { "talk": "Old Pete" } }], "reward": { "give": { "item": "golden lure" }, "score": 100 } }` and give a rod.
- **"drive the pizza to the lighthouse in 60 seconds"** → `{ "id": "pizza", "giver": "Luigi", "seconds": 60, "steps": [{ "goal": { "drive": "any", "to": "Lighthouse" } }], "reward": { "score": 30 } }`.
- **"defend the village until dawn"** → `{ "id": "defend", "giver": "Elder", "steps": [{ "do": [{ "zombie-night": { "seconds": 120 } }], "goal": { "survive": 120 } }], "reward": { "score": 200 } }`.
- **"a chain of quests"** → the second has `"requires": "first"` (and no giver: it starts as soon as the first is done).
- **"help the farmer or the thief"** → a step with `"choice": [{ "label": "Help the farmer", "next": "farm" }, { "label": "Help the thief", "next": "thief" }]` and those steps, each ending with `"next": "end"`.
