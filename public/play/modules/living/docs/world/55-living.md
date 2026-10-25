## Living things: animals, people and AI friends

Three kinds bring a world to life. They work with no art at all (bodies built from blocks that walk, graze, sleep and
wag), and a model replaces the stand-in by itself when the game has one for the species' word (WORLD.md "Assets by id": `config.assets.cow` mixes several cow models over a herd), or `shape.model` (an asset id).
A model's clips play by name: walk, run, idle, eat, sleep, sit, dance, attack.

| type | what it is | `shape` |
|---|---|---|
| `creature` | one animal or person with a brain | `species`, `size`, `temper`, `follow`, `roam`, `speed`, `color`, `colors` `{ body, head, legs, accent }`, `model`, `rideable`, `hp`, `sight` |
| `herd` | many of one species at once (1 to 300), cheap: they keep together, graze, sleep and stampede together | `species`, `count`, `radius`, `size`, `roam`, `temper` |
| `friend` | an AI friend with a name and a personality; players talk to them (E or T near them, or click) | `personality`, `species` (person by default), `follow` (false = stays put: a villager), `lines` (things they say when you come near), `talk` (false = no chat), `look` (a mirror look, e.g. `{ "what": "toaster", "name": "Mrs Ember", "body": "#b8bfcc" }`: the friend shows that body from the Presence module instead of a creature; with `talk: false` and a script that answers E through `H.use`, a villager that speaks in the game chat), `color` |

**Living things own every animal** in a game: this is the one way to make one (Mayhem's `game.spawnMany('cow', 100)` and
its spawn gun make these creatures too, and blow them up). `critter` is an old word for `creature`.

**Species:** cow, sheep, pig, horse, deer, dog, cat, wolf, bear, rabbit, chicken, bird (flies), penguin, dinosaur,
fish (out of water it flops about; in water it swims), person, robot. Other words work too: puppy, kitten, bunny, hen,
lamb, pony, t-rex, villager, android, duck, goat, fox... and these borrow a close body in their own colors and size:
elephant, lion, tiger, zebra, giraffe, panda, llama, alpaca, monkey, turtle, mouse, rat, frog, hamster, squirrel,
raccoon, moose, camel, kangaroo, slime, ostrich, parrot, owl, eagle. Any other word ("wibbles") is a small stand-in
animal in a color of its own.

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
space jumps, E gets off. (E does the nearest thing on offer: ride, talk to a friend, get in a car...)

**AI friends** follow you, stay, come, sit, sleep, dance, cheer, play fetch, carry things, build blocks with you (in the
editor their blocks are real edits), ride along in vehicles (and drive, with the Vehicles module), flee explosions and
cheer when you win (finish, checkpoint, kill, gate, goal, score, win events). They understand plain commands and
answer in character from a phrasebook (their `personality`, their species' voice: a dog woofs, a robot beeps), free and
offline. There is **no paid AI conversation** for friends: never offer one or mention credits for them. To have a friend
say particular things, give it `lines`.

`config.living.max`: the most creatures a world may hold (400; 160 on phones).

### Examples in words

- "spawn 100 cows that panic when I fire a rocket" → `{ "op": "create", "entity": { "type": "herd", "name": "Cows",
  "shape": { "species": "cow", "count": 100 }, "transform": { "position": [0, 0, 20] } } }` and give the player a
  launcher: `{ "op": "config", "patch": { "player": { "weapon": "launcher" } } }`. (Cows already panic at explosions and
  gunfire.)
- "give me a dog that follows me" → `{ "type": "creature", "name": "Rex", "shape": { "species": "dog", "follow": "player" } }`
  near the player. Dogs fetch: give the player `{ "tool": "ball" }` (config.player) or the friend chat's Fetch button.
- "an AI friend named Max who helps me build" → `{ "type": "friend", "name": "Max", "shape": { "personality": "a
  cheerful builder who loves towers and bad puns" } }`. Players talk to him with T (or a click): the quick buttons and
  plain words ("follow me", "build a tower", "dance") just work.
- "a farm" → herds of 8 sheep and 10 chickens, 3 cows, a horse to ride, a dog that follows, inside fences (boxes).
- "a wolf pack hunting deer" → a `herd` of 4 wolves and a `herd` of 12 deer 30 m apart.
- "a T-rex that chases me" → `{ "type": "creature", "shape": { "species": "dinosaur", "size": 1.5 } }` (angry by default).
- "a village with people" → several `friend`s with `follow: false` and `lines` ("Welcome to Oakvale!"), or `creature`s
  of species `person`.
- "a horse I can ride" → `{ "type": "creature", "shape": { "species": "horse" } }` (rideable: E).
- "a giant pink pig" → `{ "type": "creature", "shape": { "species": "pig", "size": 3, "color": "#ff9ecb" } }`.
- "make the cows use my cow model" → `config.assets.cow.ids` = [its id] (or one cow's `shape.model`: the id). "Mix in the
  brown cows" → add the brown cow's id with `"mix": true`.
