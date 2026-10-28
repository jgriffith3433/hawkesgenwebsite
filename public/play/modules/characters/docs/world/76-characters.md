## Characters: talk, sides, a day (`config.factions`)

Abilities that make a person (any thing: a capsule, a model, a creature) feel alive.

**`talk`**: E talks. `lines`: what they say, `|` between lines ("Nice weather.|Keep away from the hill."). Or a `tree`
with answers to pick:

```json
{ "use": "talk", "side": "villagers", "tree": { "start": "hi", "nodes": {
  "hi":  { "say": "Bandits camp past the hill. Will you help us?", "choices": [
           { "text": "I will", "go": "yes", "standing": 10 }, { "text": "Not my problem", "end": true } ] },
  "yes": { "say": "Take this.", "choices": [{ "text": "Thanks", "give": "health potion", "end": true }] } } } }
```

An answer (or a node's `do`) can: `go` (the next node), `end`, `give` / `take` an item (`count`), `signal` (set a
signal; `on: false` unsets it), `emit` (an event for a script or a rule), `standing` (how the side feels about you,
+/-), `follow` (they follow you), and `need` (shown only if you carry that item). Events `talk`, `talked`.

**`faction`**: on a side (`side`, `fights`, `hp`, `damage`, `shoots`, `range`, `speed`, `sight`). Sides in
`config.factions`: `{ "bandits": { "player": "hostile", "hates": ["villagers"] }, "guards": { "player": "friendly",
"likes": ["villagers"] } }`. A side hostile to you comes for you; a side hostile to another fights it; a side that likes
you goes for whatever hurts you. Hurting one of a side makes the whole side like you less (-8 a hit, -25 a death); talk
answers and scripts (`game.characters.like(side, n)`) raise it. Standing is -100 to 100 (under -30 hostile, over 30
friendly). Event `standing`.

**`routine`**: lives a day: hunger and tiredness rise; it goes to eat at `eat`, sleeps at `sleep` at night, works at
`work` by day (8 to 17), goes `home`, and wanders between (`wander` meters). Places are things by name. The day is the
world's clock (`config.time`) or `day` seconds. A sign over its head shows what it's doing. Event `routine`.

**In words:** "make the villagers alive" -> `routine` (their beds, the market, their work) and `talk`; "a bandit camp
that attacks the village" -> `factions` with bandits hating villagers, `faction` on each; "a quest giver" -> a `talk`
tree whose answer `give`s an item or `emit`s the quest's event. The kit `village` has all three.
