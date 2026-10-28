## Matches: teams, rounds, a clock, a score to win (`config.match`)

Any game becomes a match with a few settings; one scoreboard at the top for everyone (the host keeps it).

```json
{ "op": "config", "id": "", "json": { "match": { "teams": ["red", "blue"], "time": 300, "score": 5, "objective": "Score in the other team's goal" } } }
```

| key | what | default |
|---|---|---|
| `teams` | `["red", "blue"]`, a number of teams, or `false` (everyone for themselves). Players are split evenly; a team's `spawn` thing (`data.role`: the team) is where they start | 2 |
| `time` | seconds a round (0: no clock) | 300 |
| `score` | points to win a round (0: the clock decides) | 0 |
| `rounds` | rounds in the match (round wins show in brackets) | 1 |
| `lives` | lives each (0: endless); out when they're gone; the last side standing wins | 0 |
| `mode` | `"classic"`, `"tag"` (someone is IT; touch to pass it; not being it scores), `"hide"` (seekers wait in the dark for `start` seconds; found hiders become seekers) | classic |
| `start` | countdown seconds | 5 |
| `kills` | a kill is a point (for the killer's team) | true |
| `objective` | a line under the scoreboard | |

Points: the rule action `{ "point": "red" }` (or `"point": "player"`, `"n": 3`), scripts `game.match.point("red", 1)`,
kills, and the sports abilities below. Events: `game.on('point')`, `'round'` (`{ round, winner, over }`), `'tag'`, `'goal'`.

### Sports and flags (abilities)

| ability | what it does | settings |
|---|---|---|
| `ball` | run into it to dribble; E or a click near it kicks it the way you look; back to the middle when it falls out | `kick` (18), `lift` (5), `dribble` (1.2) |
| `score-zone` | a goal, a hoop, a base: a ball in it scores `points` for `team` (and the ball goes back); with `takes: "flag"`, an enemy flag carried in captures | `team`, `points` (1), `takes` (ball / flag) |
| `flag` | a team's flag: the other team picks it up (E) and carries it to their base; dropped, it goes home after `back` s | `team`, `back` (10) |
| `teammate` | an AI player: runs to the ball and shoots it at the goal that scores for its team | `team`, `speed` (5.5), `kick` (16) |

A basketball is a `ball` that is also `holdable` (E picks it up, a click throws it) and `bouncy`; tennis is a bouncy
`ball` with a `score-zone` behind each end. The spawn wheel's play kits set these up: football (with AI players),
basketball, tennis, capture the flag, team deathmatch, tag, hide and seek, survival waves.
