## Juice: how the game feels (`config.juice`)

Every game has it, with no art and no setup: **impact sounds** chosen by what the two things are made of and how hard
they met (a crate on stone knocks, a car into a wall crashes and rings, a cow lands with a thud), **footsteps** by
surface (grass, dirt, sand, snow, stone, wood, metal, water), rolling and scraping sounds, tire squeal, wind when you go
fast, whooshes for things thrown past you; **ragdolls** (players and animals go limp when blasted, run over or falling
far, then get back up; your own rocket launches you, it doesn't kill you); **hit-stop** (a beat of freeze on big hits and
kills) and **slow motion** on huge blasts (playing alone); **screen shake** stronger closer to the blast, a flash when one
goes off next to you, controller rumble; **dust, sparks, splinters, scorch marks, tire marks and footprints** in sand and
snow; and the **camera**: the view widens at speed and dips when you land.

All sounds are synthesized until the game has a sound for the word, then that is used (assets by id, found by word):
impacts look for `"<material> <size>"` then `"<material> hit"`, `"<material> impact"` (e.g. `metal crash`, `wood knock`,
`glass hit`; sizes: `tap`, `knock`, `crash`); footsteps for `"footstep <surface>"` (e.g. `footstep snow`), then
`footstep`; whooshes for `whoosh`.

### What things are made of

A thing's material is guessed (animals and people are flesh, robots and vehicles metal, crates wood, barrels metal,
static floors and walls stone, balls plastic, terrain dirt, its name too: "Glass window", "Steel beam", "Log") or set:

```json
{ "id": "gong", "type": "cylinder", "data": { "material": "metal" } }
{ "id": "path", "type": "box", "physics": "static", "data": { "surface": "sand" } }
```

`data.material`: wood, metal, stone, glass, flesh, plastic, water, dirt. `data.surface` (what footsteps sound like on it):
grass, dirt, sand, snow, stone, wood, metal, water.

### Settings: `config.juice`

`false` turns all of it off. Otherwise any of these (defaults shown):

| key | what | default |
|---|---|---|
| `level` | the most this world wants: `full`, `reduced`, `minimal` (each player's device can ask for less) | `full` |
| `boom` | how big explosions feel: shake, flash, slow motion and scorch marks scale with it | 1 |
| `shake` | camera shake strength (0 off) | 1 |
| `flash` | the flash of a close blast (0 off) | 1 |
| `slowmo`, `slowmoScale`, `slowmoSeconds`, `slowmoRadius` | huge blasts (this radius in meters, or a chain of three) slow time to `slowmoScale` for `slowmoSeconds` | true, 0.3, 1, 10 |
| `hitstop` | a beat of freeze on big hits and kills | true |
| `ragdolls` | players and creatures go limp | true |
| `selfBlast` | `launch`: your own blasts throw you but leave you alive; `hurt`: they hurt like any other | `launch` |
| `sounds`, `footsteps` | the sounds | true |
| `particles`, `decals` | dust and sparks; scorch, tire marks and footprints | true |
| `fov`, `landing`, `recoil`, `bob` | the view widens at speed, dips on landing, kicks when a gun fires, bobs as you walk (bob is off unless asked) | true, true, true, false |
| `rumble` | controller rumble and phone vibration | true |

Hit-stop and slow motion only happen playing alone (online, everyone's world must keep the same time); shake, flashes
and everything else play online too.

**Per device (each player's own, kept in their browser):** a juice level (full on computers, reduced on phones: fewer
voices, particles, marks and ragdolls; minimal: no ragdolls or marks) and **reduce motion** (shake, flashes, the FOV kick
and head bob turned well down; on by default when the device asks for reduced motion). It steps itself down when frames
get slow. Scripts open the menu with `game.juice.openSettings()`.

### Examples in words

- "Make explosions bigger and slower" → `{ "op": "config", "patch": { "juice": { "boom": 1.8, "slowmoRadius": 6, "slowmoScale": 0.2, "slowmoSeconds": 1.6 } } }`
  (and bigger blasts themselves: a larger `radius` where they're made, e.g. barrels' `shape.power`, `game.explode(at, { radius: 10 })`).
- "Turn off screen shake" → `{ "juice": { "shake": 0, "flash": 0 } }`.
- "No slow motion" → `{ "juice": { "slowmo": false } }`. "No ragdolls" → `{ "juice": { "ragdolls": false } }`.
- "Head bob when I walk" → `{ "juice": { "bob": true } }`.
- "Rockets should kill me" → `{ "juice": { "selfBlast": "hurt" } }`.
- "Make it calm, for little kids" → `{ "juice": { "shake": 0.3, "flash": 0, "hitstop": false, "slowmo": false } }`.
- "The floor is snow" (footsteps crunch, prints are left) → the floor's `data.surface: "snow"` (terrain snow already is).
