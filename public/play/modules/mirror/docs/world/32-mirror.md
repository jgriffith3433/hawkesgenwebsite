## The mirror: who you are (`mirror` things, `shape.character`)

A `mirror` is where players become who they are. In front of it (E: "Change who you are", or by itself when they
arrive) the player stands facing it, the camera looks over their shoulder at their reflection, and the Overseer asks,
one question at a time:

1. **"What are you?"**: a person, a robot, a TV robot, a roll-bot; a dog, cat, fox, pig, bear, bunny, penguin, chicken,
   cow, sheep, horse, dinosaur, fish; a shoe, toaster, cactus, traffic cone, teapot, banana, mushroom, potato or rubber
   duck. Picking one changes the reflection at once, and the Overseer has a word about it.
2. **"How do you look?"**: three colors (main, second, skin or details), a size (normal, tall, short, wide, tiny, big),
   a hat, a face (people), up to three extras (glasses, shades, scarf, backpack, cape, bow tie, wings, tail).
3. **"What are you called?"**: their character's name, shown over their head (🎲 suggests a funny one).
4. (Only if the mirror asks it) **"How do you see the world?"**: first or third person, for this game.

Then the Overseer names them ("Sir Laces the shoe. I will remember that.") and the game goes on. The choices are the
player's look everywhere (their account keeps it; everyone in the room sees it). Their body is still a 1.8 m capsule to
physics: a tiny cat and a tall horse collide the same.

Each mirror decides its questions, in `shape.character` (while building: its card's **🪞 Character mirror** button):

| key | what it does | default |
|---|---|---|
| `steps` | the questions, in order: `"what"`, `"look"`, `"name"`, `"view"` | `["what", "look", "name"]` |
| `whats` | who players may be: ids (`"dog"`, `"shoe"`...) or groups (`"people"`, `"animals"`, `"things"`); `[]` for anything | `[]` |
| `start` | `"first"`: opens by itself the first time a player arrives (after the Overseer's intro); `"always"`: every time; `false`: only with E | `false` |
| `voice` | `false`: the Overseer stays quiet (captions and voice) | `true` |
| `reach` | how close E works (meters) | `3` |

`"character": false` makes a plain mirror (it only reflects). A world with no mirror still lets players dress up from
🎨 Customize (👥 list): the same questions, anywhere.

**Examples in words:**
- "Let players pick their character at the start" → a mirror near the spawn:
  `{ "op": "create", "entity": { "type": "mirror", "name": "Mirror", "transform": { "position": [0, 1.3, -4] }, "shape": { "width": 1.5, "height": 2.4, "character": { "start": "first" } } } }`.
- "A racing game where you can only be a robot or a dinosaur" → `"character": { "whats": ["robot", "tvbot", "rollbot", "dinosaur"], "start": "always" }`.
- "Let players choose first or third person" → add `"view"` to its `steps`: `"steps": ["what", "look", "name", "view"]`.
- "Skip the name, ask only what they are" → `"steps": ["what"]`.
- "Just a decorative mirror" → `"character": false`.
