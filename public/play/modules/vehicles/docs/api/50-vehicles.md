## Vehicles (`game.car()`, `game.vehicles`)

Every vehicle kind has a maker that returns the vehicle (an entity): `game.car(opts)`, `game.truck(opts)` (the 4x4),
`game.bicycle`, `game.motorbike`, `game.boat`, `game.submarine`, `game.airplane`, `game.helicopter`. Options are the
spec's: `x, y, z` (or `position`; no `y` puts it on the floor at 0), `rotation`, `color`, `name`, `scale`, `speed`,
`power`, `grip`, `handling`, `mass`, `health`, `model`, `data`.

```js
const car = game.car({ x: 3, z: 8, color: '#2266ff', name: 'Blue' });
const jeep = game.vehicles.make('4x4', { x: -4, z: 8 });     // any type or name: car, truck, 4x4, jeep, bike, plane, heli...
game.vehicles.enter(car);                                     // you get in (the driver's seat if it's free)
car.on('enter', (d) => game.ui.message(`${d.me ? 'You' : 'Someone'} got in`));
game.on('exit', (d) => { if (d.vehicle === car && d.me) game.ui.message('Walking again'); });
```

| Call | What |
|---|---|
| `game.vehicles.enter(v, { seat, passenger })` | Puts you in (seat 0 drives). Returns false if it can't (parked prop, wrecked, full). |
| `game.vehicles.exit()` | Gets you out (beside a door, moving as it was). |
| `game.vehicles.current`, `game.vehicles.seat` | The vehicle you're in (or null) and your seat. |
| `game.vehicles.list(type?)`, `game.vehicles.nearest(from?, maxDistance = 50)` | Vehicles in the world; the closest one with a free seat. |
| `game.vehicles.make(type, opts)` | Makes one by type or name. |
| `game.vehicles.drive(v, { speed, steer, throttle, up, down, boost, brake, hover })` | Drives it from code (`null` stops): `speed` m/s or `throttle` -1..1, `steer` -1..1, helicopters `hover` (meters up). |
| `game.vehicles.board(v, thing, { driver })` / `unboard(thing)` | Seats a non-player (an AI friend, an animal, a dummy) and takes it out again. With `driver: true` and `drive()` it drives you around. |
| `game.vehicles.repair(v)`, `flip(v)`, `honk(v, seconds)`, `blast(at, { radius, force, damage })` | Fix it, put it back on its wheels, honk, throw and hurt vehicles near a point. |
| `v.speed`, `v.velocity`, `v.driver`, `v.riders`, `v.health`, `v.wrecked`, `v.lights`, `v.autopilot` | What it's doing (`lights`, `health`, `autopilot` are settable). |
| `v.enter()`, `v.exit()`, `v.honk()`, `v.flip()`, `v.repair()`, `v.push([x, y, z])`, `v.impulse([x, y, z])` | The same, on the vehicle. |
| `game.on('enter' / 'exit', ({ vehicle, player, id, seat, driver, me }) => {})`, `v.on('enter' / 'exit', fn)` | Someone got in or out (you: `me`). |
| `game.on('crash', ({ vehicle, speed, other, at }) => {})`, `game.on('wrecked', ({ vehicle }) => {})` | A hard hit; out of health. |

Vehicles are real physics bodies: everything in "Physics" works on them, and `game.physics.explode` (or the Mayhem
module's explosions) throws and hurts them. A vehicle made by a script exists on every player's machine (scripts run
everywhere) and its driver keeps the others in step.

```js
// A taxi: an AI friend drives you in circles until you press T.
const taxi = game.car({ z: 10, color: '#f4c430', name: 'Taxi' });
const driver = game.capsule({ x: 2, z: 10, color: '#8b5a2b', name: 'Driver' });
game.vehicles.board(taxi, driver, { driver: true });
game.vehicles.drive(taxi, { speed: 9, steer: 0.4 });
game.input.onKey('t', () => game.vehicles.drive(taxi, null));
```

**Modules** (`HawkesPlay.vehicles`): `types`, `kinds`, `list()`, `near(from, radius)`, `nearest(from, radius)`,
`enter`, `exit`, `board(v, entity, { driver })`, `unboard`, `drive`, `blast`, `useOffer(player)` (what E does here:
`{ label, act }`), `waterLevel(x, z)`, `simulatedByMe(v)`, `current`, `seat`. A vehicle's own state is `e.vehicle`.
