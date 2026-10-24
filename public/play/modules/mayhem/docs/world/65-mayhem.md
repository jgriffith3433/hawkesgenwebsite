## Mayhem: explosions, fire, things that break, animals, tools, spawning a hundred of anything

Everything here works with no art: blocky stand-ins, flashes, smoke and synthesized sounds. A model or a sound with the
right name is used by itself when the game has one (`cow.glb` for cows, `explosion.mp3` for blasts; see the end).

### Kinds

| type | what it is | `shape` |
|---|---|---|
| `barrel` | an exploding barrel (red, a yellow band). Shot, burnt (2 s) or hit hard (16 m/s) it blows up, and its blast sets off barrels next to it: chain reactions. Dynamic by default | `power` (blast radius, 6), `damage` 60, `force` 22, `hp` 20, `fire` (true: sets things alight), `strength` (impact speed that sets it off, 16), `radius` 0.42, `height` 1.15 |
| `crate` | a wooden crate that breaks into pieces when hit hard (11 m/s: thrown, dropped from 3 m), shot, blown up or burnt down. Dynamic by default | `size` 1 (or `[w, h, d]`), `strength` 11, `pieces` 8, `hp` 30, `respawn` 0 (seconds until it's back; 0: when the game starts over) |
| `critter` | a stand-in animal made of blocks: `cow`, `pig`, `sheep`, `chicken`, `duck`, `penguin`, `horse`, `dog`, `cat`, `rabbit`, `bear`, `frog`, `elephant`, `dinosaur`, `slime`, or any word (a body in a color from its name; goat, panda, fox, wolf, lion, tiger, deer, zebra, llama, mouse, turtle... borrow a look). It grazes and wanders, runs from blasts and from the lasso, flies and tumbles when hit and gets back up, burns, and pops into chunks when it dies. A model named after it (`cow.glb`) takes its place when the game has one | `species` "cow", `size` (height in meters), `hp` (by size), `wander` (false: stands still), `speed` 1.1, `asset` (a model to use) |
| `tool-pickup` | a tool floating over a glowing pad: walking into it while playing puts the tool in your hands (and on your belt: Q switches tools). It comes back after `respawn` seconds | `tool` (below), `respawn` 10, `options` (the tool's options) |

```json
{ "id": "barrel_1", "type": "barrel", "transform": { "position": [3, 0.6, 0] } }
{ "id": "cow_1", "type": "critter", "shape": { "species": "cow" }, "transform": { "position": [0, 0.8, 5] } }
{ "id": "rl", "type": "tool-pickup", "shape": { "tool": "rocket-launcher" }, "transform": { "position": [0, 0.05, -3] } }
```

### Behaviors for any thing

| use | does | options (defaults) |
|---|---|---|
| `breakable` (also `shatters`, `fragile`) | breaks into pieces (boxes split into real chunks that fly, tumble and fade after a few seconds; models into blocks of their size) when hit at `strength` m/s, by a blast, or after `hp` damage | `strength` 12, `pieces` 8, `hp` 0 (0: only by impacts and blasts), `respawn` 0 |
| `explosive` (also `explodes`, `bomb`) | blows up when destroyed, burnt or hit hard: any thing becomes a bomb | `radius` 6, `force` 20, `damage` 60, `hp` 20, `fire` true, `strength` 16 |
| `flammable` (also `burns`) | can catch fire (moving things, critters, crates and barrels burn anyway; floors and walls don't unless they have this) | `seconds` (how long it burns) |

Fire: a burning thing has flames and smoke, takes damage (4 every half second: things with health burn down, crates
break), heats up what touches it (it catches after about a second and a half), and barrels go off. Water puts it out.
`"data": { "flammable": false }` makes a thing fireproof.

### Tools (`config.player.tool`, `config.player.tools`, or a `tool-pickup`)

| tool | click (phone: FIRE) | R (phone: the second button) | options |
|---|---|---|---|
| `rocket-launcher` | fires a rocket that blows up where it hits | | `radius` 5.5, `force` 20, `damage` 60, `fire` false, `speed` 32, `rate` 1.4 (a second) |
| `grenade` | hold to aim (a dotted arc shows where it goes; holding longer throws farther), let go to throw; it bounces and goes off after its fuse | | `fuse` 2.5, `radius` 5, `force` 18, `damage` 50, `fire` |
| `sticky-bomb` (also `detonator`) | throws a bomb that sticks to whatever it hits (and moves with it) | sets off every bomb you threw, one after another (BOOM) | `radius` 4.5, `force` 16, `damage` 45, `max` 10 |
| `spawn-gun` | makes the current thing where you aim (shift-click: 10) | next thing (also the mouse wheel) | `what` (the first thing: any word, kind or asset), `items` (the list; default cow, barrel, crate, pig, sheep, chicken, penguin, ball, box, plus the game's models), `count` 1, `pattern` |
| `gravity-gun` | picks up what you aim at (moving things, critters, small fixed things), click again to throw it hard | drops it (DROP); the wheel pulls it closer or pushes it away | `power` 30, `range` 24 |
| `lasso` | ropes what you aim at to you: it follows you (lasso a post or a wall and you hang from it). Click again on something else (or the ground) to tie the roped thing to that | cuts your ropes (CUT) | `range` 30, `length`, `max` 8 |
| `flamethrower` | hold: a stream of fire that sets what it reaches alight (8 m) and hurts | | `reach` 8, `damage` 3 |
| `matches` | lights what's right in front of you | | `reach` 3.5 |

```json
{ "op": "config", "patch": { "player": { "tool": "rocket-launcher", "tools": ["rocket-launcher", "grenade", "gravity-gun", "spawn-gun"] } } }
```
`tools` is the belt you start with (Q, or ⇄ on a phone, switches to the next one); `tool` is the one in your hands. A
tool with options: `{ "type": "rocket-launcher", "radius": 9, "fire": true }`. The guns from before (`weapon`) still
work and can be on the belt too. Tools are put away while building.

### Settings (`config.mayhem`, all optional)

`{ "slowmo": true }` slows time for a moment on big blasts and chains (playing alone); `score: false` hides the
MAYHEM score and combo text; `shake` (1; 0 turns camera shake off); `debris: false`; `smoke: false`; `maxSpawn`
(things spawned at once, 400; 150 on phones: past it the oldest go); `maxDebris` (160); `debrisLife` (8 s);
`burnSeconds` (7); `spread: false` (fire doesn't spread).

### Sounds and models by name

Blasts play the first of `explosion`, `boom`, `explode`, `blast` (with .mp3/.wav/.ogg/.m4a) the game has; breaking
`break`/`shatter`/`crash`; rockets `rocket`/`whoosh`; spawning `spawn`/`pop`; fire `fire`/`flame`; throws `throw`;
ropes `rope`/`lasso`; cows `moo`. Without one, a sound is synthesized. Critters use `<species>.glb`; `spawnMany("tree")`
uses `tree.glb` when there is one.

### In words (what the assistant does)

- "Give me a rocket launcher" → `config` `player.tool: "rocket-launcher"` (and add it to `player.tools` if they have others).
- "Give me all the mayhem tools" → `player.tools: ["rocket-launcher", "grenade", "sticky-bomb", "spawn-gun", "gravity-gun", "lasso", "flamethrower"]`, `player.tool: "rocket-launcher"`.
- "Put a rocket launcher over there to pick up" → create a `tool-pickup` with `shape.tool: "rocket-launcher"`.
- "Add some exploding barrels" → several `barrel`s a meter or two apart (close enough to chain).
- "Make the crates breakable" → `crate`s, or `behaviors: [{ "use": "breakable" }]` on the boxes. "Make the vase fragile" → `breakable` with `strength: 5`.
- "Make that tower explode when shot" → `behaviors: [{ "use": "explosive", "radius": 8 }]`.
- "A farm with cows and pigs" → `critter`s with `species` cow / pig (a fence of boxes around them).
- "Spawn 100 cows" while playing → a script: `game.spawnMany('cow', 100)` (API.md: Mayhem). To keep them in the world, create `critter`s.
- "Slow motion on big explosions" → `config` `mayhem: { "slowmo": true }`.
