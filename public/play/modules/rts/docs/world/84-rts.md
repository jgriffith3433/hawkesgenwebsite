## Strategy: units you command (`config.rts`)

A world with `config.rts` is a real-time strategy game: the player commands a side. Give things abilities:
**`unit`** (moves, fights the other sides by itself, gathers if it can), **`building`** (trains units, takes resources
home, and a side with none left has lost), **`resource`** (a crystal field workers mine). Put the player in the
commander's camera with `"player": { "view": "rts" }`.

```json
"rts": {
  "team": "blue", "resources": 300, "currency": "crystal",
  "teams": { "red": { "ai": true, "resources": 300, "wave": 4, "grow": 2, "workers": 4,
                      "waves": { "every": 60, "first": 90, "count": 4, "grow": 2, "unit": "fighter", "title": "Wave" } } },
  "lose": "Your station has fallen", "winText": "The sector is yours"
},
"player": { "view": "rts" }
```

| Key | What |
|---|---|
| `team` | The player's side (blue, red, green, yellow, purple, orange). |
| `resources`, `currency` | What every side starts with (a number of the currency, default 200 crystal; or `{ crystal: 300 }`). |
| `teams.<side>.ai` | true: the side plays itself: workers gather, its buildings train, its army attacks when it has `wave` units (then `grow` more each time). |
| `teams.<side>.waves` | Units that arrive at its first building (or `at`) every `every` seconds (`first` for the first), `count` more by `grow` each wave, of `unit`, and attack your side: the way to make **waves**. Works without `ai`. |
| `win: false` | No automatic end (a story script decides). `lose`, `winText`: the end's words. |

**Abilities:**

| Ability | Settings |
|---|---|
| `unit` | `team`, `role` (a name: worker, soldier, ranged, tank, fighter, frigate, mining-ship), `hp`, `speed`, `damage`, `range`, `rate` (seconds a shot), `sight`, `gather` (a trip's load: a worker), `fly` (meters over where it starts: ships). A unit with physics "dynamic" walks; "kinematic" with `fly` flies. |
| `building` | `team`, `hp`, `makes` ("worker,soldier": what it trains; or `[{ "name", "cost", "time", "spec" }]` for your own unit things), `dropoff` (workers bring resources here), `rally` (meters out where new units stand). |
| `resource` | `kind` (crystal), `amount`. |

Trained units by name: worker 50 (5 s), soldier 80, ranged 100, tank 220, fighter 120 (flies), frigate 320 (flies),
mining-ship 60 (flies, gathers). **Controls:** click a unit (shift adds), drag a box, right-click the ground to move, an
enemy to attack, a resource to gather; A then click: attack-move; S stops, H holds, Q picks your army; a chosen building
shows its training buttons. On a phone: tap to choose, tap where to go. Events: `trained`, `gathered`, `wave`, `attack`,
`selected`, `rts` (`{ won }` / `{ lost }`).

**In words:** "an RTS in space with waves" -> `config.rts` with red `waves` and `ai`, `view: "rts"`, a blue station
(`building` makes "mining-ship,fighter,frigate") and crystal `resource`s, the red station far off; the story in a script
(objectives per wave with game.ui, the progression: more units unlocked as waves pass by changing a building's `makes`).
The kits `rts` and `space-rts` lay one out.
