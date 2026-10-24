## Juice: feel from scripts (`game.juice`, `game.ragdoll`)

Everything happens by itself (impacts, blasts, landings, crashes). Scripts can add more:

| call | what it does |
|---|---|
| `game.ragdoll(thing, { velocity: [x, y, z], spin })` | knocks a player or creature down limp (6-8 boxes on joints) and throws it; it gets back up in a moment. Null if it can't (no physics, budget, turned off). `game.juice.ragdoll.end(thing)` gets it up now, `.is(thing)`, `.active` |
| `game.juice.shake(0.6)` | shakes the camera (0-1; it adds up and fades). `game.camera.shake(strength, seconds)` goes through it too. `{ at: [x, y, z] }` makes it weaker farther away |
| `game.juice.hitStop(0.08)` | freezes the world for a moment (at most 0.15 s; playing alone) |
| `game.juice.slowmo(0.3, 1.5)` | slow motion: 30% speed for 1.5 real seconds, easing back (playing alone) |
| `game.juice.flash(0.7)` | a flash over the screen (reduce motion dims it) |
| `game.juice.rumble(strong, weak, ms)` | controller rumble (a phone vibrates) |
| `game.juice.recoil(0.4)` | kicks the view up (guns do this by themselves) |
| `game.juice.sound.play({ material: 'metal', size: 'crash', loudness: 0.8, at: [x, y, z] })` | an impact sound (the game's sound for "metal crash" if it has one) |
| `game.juice.sound.footstep('snow', { at })`, `game.juice.sound.whoosh(at, speed)` | a step, a whoosh |
| `game.juice.fx.burst('sparks', [x, y, z], { count: 30 })` | particles: `dust`, `sparks`, `splinters`, `chips`, `glass`, `spray` (`color`, `speed`, `dir`) |
| `game.juice.fx.decal('scorch', [x, y, z], { size: 3 })` | a mark on the ground: `scorch`, `tire`, `print` (`yaw`, `normal`, `life` seconds) |
| `game.juice.level`, `game.juice.deviceLevel = 'reduced'`, `game.juice.reduceMotion = true` | the juice level now; this device's choice (kept in the browser) |
| `game.juice.openSettings()` | the Feel menu: level and reduce motion for this device |

Events: `game.on('ragdoll', ({ entity, on }) => ...)` when something goes limp (`on: true`) and gets back up (`on: false`).
`game.juice.feel.on('land', ({ speed, surface }) => ...)` when you land (m/s).

```js
// A trampoline that launches you limp:
game.find('Trampoline').on('hit', (who) => { if (who === game.player) game.ragdoll(who, { velocity: [0, 18, 0] }); });
// A boss stomp: shake, a beat of freeze, dust.
game.on('stomp', (d) => { game.juice.shake(0.8); game.juice.hitStop(0.06); game.juice.fx.burst('dust', d.at, { count: 60 }); });
```
