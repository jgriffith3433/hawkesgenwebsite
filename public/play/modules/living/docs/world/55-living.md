## Living things: animals, people and AI friends

Three kinds bring a world to life. They work with no art at all (bodies built from blocks that walk, graze, sleep and
wag), and a model replaces the stand-in by itself when the game has an asset named `<species>.glb` (or `shape.model`).
A model's clips play by name: walk, run, idle, eat, sleep, sit, dance, attack.

| type | what it is | `shape` |
|---|---|---|
| `creature` | one animal or person with a brain | `species`, `size`, `temper`, `follow`, `roam`, `speed`, `color`, `colors` `{ body, head, legs, accent }`, `model`, `rideable`, `hp`, `sight` |
| `herd` | many of one species at once (1 to 300), cheap: they keep together, graze, sleep and stampede together | `species`, `count`, `radius`, `size`, `roam`, `temper` |
| `friend` | an AI friend with a name and a personality; players talk to them (T, or click) | `personality`, `species` (person by default), `follow` (false = stays put: a villager), `lines` (things they say when you come near), `talk` (false = no chat), `color` |

**Species:** cow, sheep, pig, horse, deer, dog, cat, wolf, bear, rabbit, chicken, bird (flies), penguin, dinosaur,
fish (out of water it flops about; in water it swims), person, robot. Other words work too: puppy, kitten, bunny, hen,
lamb, pony, t-rex, villager, android, duck, goat, fox...

**Tempers** (each species has one; `shape.temper` changes it):
- `calm` (cows, sheep, horses): graze and wander; move away from players who come too close or run at them; stampede from
  explosions and gunfire.
- `shy` (deer, rabbits, chickens, birds): run when you're still far away.
- `pet` (dogs, cats): follow their person (`follow: "player"`), wag, play fetch when you throw a ball.
- `predator` (wolves): hunt the species they eat when hungry (sheep, chickens, deer...).
- `angry` (dinosaurs): hunt players and big animals. Make one calm with `temper: "calm"`.
- `neutral` (bears, robots): mind their business; fight back when hurt; bears swipe if you get too close.
- `person`: wanders like a villager.

Brave ones (predators, bears, dogs) fight whatever hurts them; everyone else runs. Anything blown up tumbles through the
air, lies there a moment, gets up and runs. They find their way around walls and don't walk off edges. Creatures have
health (`hp`): weapons and explosions can kill them. While building they stand still where you put them.

**Riding:** a creature with `rideable: true` (horses and dinosaurs are) is ridden with E: WASD steers, shift gallops,
space jumps, E gets off.

**AI friends** follow you, stay, come, sit, sleep, dance, cheer, play fetch, carry things, build blocks with you (in the
editor their blocks are real edits), ride along in vehicles (and drive, with the Vehicles module), flee explosions and
cheer when you win (finish, checkpoint, kill, gate, goal, score, win events). They understand plain commands for free.
**For real conversations** set `config.friends`:

| `config.friends` | |
|---|---|
| `talk` | `"owner"`: Claude speaks for the friends, **paid with the game owner's credits** (a few credits a line). Anything else: the free phrasebook |
| `daily` | the most credits AI talk may spend a day in this game (100 by default, 2000 at most); after that the friends use the phrasebook until tomorrow |

Turn `talk` on only when the person asking is the owner (or says they're fine paying), and tell them what it costs.
Friends remember a little of what was said (per game, per friend).

`config.living.max`: the most creatures a world may hold (400; 160 on phones).

### Examples in words

- "spawn 100 cows that panic when I fire a rocket" → `{ "op": "create", "entity": { "type": "herd", "name": "Cows",
  "shape": { "species": "cow", "count": 100 }, "transform": { "position": [0, 0, 20] } } }` and give the player a
  launcher: `{ "op": "config", "patch": { "player": { "weapon": "launcher" } } }`. (Cows already panic at explosions and
  gunfire.)
- "give me a dog that follows me" → `{ "type": "creature", "name": "Rex", "shape": { "species": "dog", "follow": "player" } }`
  near the player. Dogs fetch: give the player `{ "tool": "ball" }` (config.player) or the friend chat's Fetch button.
- "an AI friend named Max who helps me build" → `{ "type": "friend", "name": "Max", "shape": { "personality": "a
  cheerful builder who loves towers and bad puns" } }`; if they want him to really talk, `{ "op": "config", "patch":
  { "friends": { "talk": "owner", "daily": 100 } } }` (tell them it uses their credits).
- "a farm" → herds of 8 sheep and 10 chickens, 3 cows, a horse to ride, a dog that follows, inside fences (boxes).
- "a wolf pack hunting deer" → a `herd` of 4 wolves and a `herd` of 12 deer 30 m apart.
- "a T-rex that chases me" → `{ "type": "creature", "shape": { "species": "dinosaur", "size": 1.5 } }` (angry by default).
- "a village with people" → several `friend`s with `follow: false` and `lines` ("Welcome to Oakvale!"), or `creature`s
  of species `person`.
- "a horse I can ride" → `{ "type": "creature", "shape": { "species": "horse" } }` (rideable: E).
- "a giant pink pig" → `{ "type": "creature", "shape": { "species": "pig", "size": 3, "color": "#ff9ecb" } }`.
- "make the cows use my cow model" → name the asset `cow.glb` (or `shape.model: "spotty_cow.glb"`).
