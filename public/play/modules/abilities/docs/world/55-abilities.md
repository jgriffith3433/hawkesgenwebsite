## Abilities: anything can do anything (`behaviors`)

Abilities are behaviors any thing can carry, stacked: a couch that drives, a teapot that flies, a crate you pick up and
throw, a rock that teleports you, a lever that opens the castle gate. **Prefer them over scripts**: they work at once
while playing, while building and on the island, online for everyone, and players tweak their settings on the build
card. A thing's look and its abilities are separate: any model can carry any ability.

```json
{ "op": "create", "id": "turbo_couch", "json": { "type": "sofa", "name": "Turbo couch", "physics": "dynamic", "behaviors": [{ "use": "drivable", "speed": 18 }] } }
{ "op": "create", "id": "carpet", "json": { "type": "box", "name": "Flying carpet", "shape": { "size": [1.6, 0.08, 2.6] }, "material": { "color": "#b91c1c" }, "physics": "kinematic", "behaviors": [{ "use": "flyable" }] } }
```

| ability | what it does | settings (default) |
|---|---|---|
| `seat` | E: sit on it | `height` (0.4), `label` |
| `drivable` | E: get on and drive it (W/S, A/D) | `speed` (14), `turn` (90 °/s), `hover` (0 m), `height` |
| `flyable` | E: get on and fly it (Space up, C down) | `speed` (18), `turn`, `lift` (8), `height` |
| `holdable` | E: pick it up; click or F throws it, E puts it down | `throw` (14 m/s) |
| `teleport` | touching it sends you to a thing (its name) or `[x, y, z]` | `to` |
| `boost` | a speed pad: pushes you the way it faces | `power` (22), `up` (2) |
| `cannon` | E: fires you out the way it faces | `power` (30), `angle` (40°) |
| `gravity` | inside it, gravity × `factor` (moon 0.17, none 0) | `factor` (0.25) |
| `button` | E: turns a signal on for `seconds` | `signal` ("open"), `seconds` (1) |
| `lever` | E: turns a signal on and off | `signal` |
| `plate` | a pressure plate: the signal is on while someone or something stands on it | `signal` |
| `opens` / `door` | opens when someone comes near, or when its `signal` is on; `axis` y (up), x (sideways), z (back) | `height` (3), `distance` (4), `speed`, `signal`, `axis` |
| `shows` | appears while a signal is on (`hide: true`: vanishes): secret walls, hidden bridges | `signal`, `hide` |
| `hill` | king of the hill: points every second you stand on it; the top three show for everyone | `points` (1) |

Riding and carrying move the thing: give a ridden thing `physics` "kinematic" (it moves itself) and a carried one
"dynamic" (it falls when thrown). Zones (`teleport`, `boost`, `gravity`) let you walk into them.

### Signals: things telling each other

A signal is a name that is on or off, shared by everyone in the game. Buttons, levers and plates set it; doors (`opens`
with `signal`) and `shows` answer it; rules can too: `"when": { "signal": "gate" }` (when it turns on; `"off": true`
when it turns off), the action `{ "signal": "gate" }` (on; `"to": "off"`, `"to": "toggle"`, or `"seconds": 2` for a
moment), the condition `{ "signal": "gate" }`. Scripts: `game.signal.set('gate', true)`, `.toggle`, `.pulse`, `.get`,
`game.on('signal', ({ name, on }) => {})`.

### Play kits

Ready-made bits of play in the spawn wheel (🎲 Play kits), made only of things and abilities: an obstacle course, a coin
rush, king of the hill, a lever and gate with a hidden bridge, a teleporter pair, a human cannon, a low-gravity bubble, a
dance floor, silly rides (a drivable couch, a flying carpet, a throwable crate). Build the same from the abilities above.
