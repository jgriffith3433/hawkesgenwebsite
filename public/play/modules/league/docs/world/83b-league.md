## A league: your club, recruits, rival clubs (`config.league`)

A season of matches (Matches above) for a club the player runs: sign players with coins, play each rival, climb the
table. It needs a pitch with two goals (`score-zone` for red and for blue: the football kit) and `config.match` with
`"join": "blue"` (the player is always on the club's side) and `"auto": false` (a match starts on match day, not at once).

```json
"match": { "teams": ["red", "blue"], "join": "blue", "auto": false, "time": 180, "score": 5, "start": 3 },
"league": {
  "team": { "name": "Hawkes FC" }, "squad": 3, "coins": 120, "legs": 1,
  "rivals": [{ "name": "Harbour United", "strength": 2 }, { "name": "Summit City", "strength": 5 }],
  "recruits": [{ "name": "Rio Banks", "speed": 8, "kick": 5, "cost": 70 }], "agents": 6,
  "win": 60, "draw": 25, "loss": 10
}
```

| Key | What |
|---|---|
| `team.name` | Your club. |
| `rivals` | Clubs to play, each `{ name, strength 1-5 }` (their players' speed and shooting). |
| `squad` | Players a side besides you (1-6). Fewer signed: youth players (slow, weak) fill in. |
| `coins`, `win`, `draw`, `loss` | Money to start with, and the prize for each result. |
| `recruits`, `agents` | Free agents to sign (`speed`, `kick` 1-10, `cost`), plus `agents` more made up. |
| `legs` | 1: each rival once; 2: home and away. |

The ability **`recruit`** (`name`, `speed`, `kick`, `cost`) makes a person in the world a free agent: walk up, E signs
them. **🏆 League** (top left) shows the table (P W D L GD Pts), the next fixture with **Play match**, your squad and the
free agents with Sign buttons. A win is 3 points, a draw 1; the other clubs play each other too. Events: `signed`,
`matchday`, `result` (`{ us, them, won, drew, prize }`), `season` (`{ position, champion }`).

**In words:** "a whole football game where I recruit players and we play other teams for points" -> the kit `league`
(the pitch, three people to sign by the touchline, four rival clubs), and a script for the story between matches
(a rival's manager's lines, a cup final when the season ends).
