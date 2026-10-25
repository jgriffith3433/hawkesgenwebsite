## Races: lit gates, a countdown, a lap clock and a ghost (`config.race`)

A world with `config.race` has courses to race. A course is a loop of **gates**, each a pair of tall pillars of light with
a faint banner between them. The **first gate is the start and the finish line**. Drive the course's vehicle through it,
the right way, and the **countdown** starts (3, 2, 1, GO): the vehicle is held still on the line, so everyone starts from a
standstill, and the clock starts at GO. The next three gates are lit (two on a phone), the one to take is bright and
pulses; the ones you pass go dark. After the last gate, going back through the first one ends the lap; after the last lap
the race ends with the time on screen, whether it is a **best time** and the **board**. Only the vehicle's own kind counts
(`"vehicle": "wheeled"` is any car, 4x4 or bike; `"boat"` any boat; or a vehicle type such as `"helicopter"`).

```json
"race": {
  "courses": [
    { "id": "ridge", "name": "Ridge Run", "vehicle": "wheeled", "laps": 3, "width": 14, "color": "#34d399",
      "par": 80000, "rival": "Pip",
      "gates": [[46, 6, 4.95], [52, 22, 2.55], [34, 46, 2.21], [0, 50, 5.04]] }
  ],
  "sounds": { "go": "power-up.mp3", "finish": "level-up.mp3", "best": "victory.mp3" }
}
```

| Course key | What |
|---|---|
| `id`, `name` | A short id (letters, digits and dashes: it names the saved best) and the name on screen. |
| `vehicle` | What may race it: a vehicle class (`wheeled`, `boat`, `heli`, `plane`...) or a vehicle type. |
| `laps` | 1 to 9. |
| `gates` | `[x, z, y]` in the world file's numbers (on a round planet, the planet's own: the same numbers as `transform.position`), at least three; `y` is the ground (or the sea) at the gate. A gate faces from the one before to the one after, so the loop's first gate faces the lap. Keep legs 30 m or more and bends gentle: a vehicle has to make them at speed. |
| `width` | How wide each gate is in meters (14 for a 4x4, about 24 for a boat). A little slack either side counts. |
| `color` | The gates' light. The start gate is white. |
| `par`, `rival` | The rival's time (ms) and name: it stands on the board to beat until the player has faster ones. |
| `sounds` | Optional asset names for `tick`, `go`, `gate`, `lap`, `finish`, `best`; without them the module beeps by itself. |

**Kept:** the best time per course is part of the Overseer's memory (the account when signed in, this device otherwise),
and the best run's **ghost** (a pale copy of the vehicle replaying the best run from GO, so you race it) and the **board**
(the best ten runs on this device, with the rival's time) are on this device (localStorage `hg_race`). The next try after a
best has the ghost beside it. A run that ends sooner (out of the vehicle for six seconds, wrecked, a long way from the
course, or the Stuck? rescue) is called off and counts for nothing.

**The race board:** a thing with `"data": { "raceBoard": "<course id>" }` shows the top times of that course as words on
its face (like the catch board), and **E** near it opens the board.

Examples in words: "add a race round the lake for cars" is `config.race` with a loop of six to ten gates round it (check
each gate's `y` against the ground), `vehicle: "wheeled"`, `laps: 2`; "a boat race" is the same with `"boat"` and gates on
the water (`y` the water's level). Put the first gate where the vehicles are: the start is by the dock.
