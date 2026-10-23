## Looking, aiming, hitting

`game.raycast(from, direction, distance)` is the first thing a ray hits: `{ entity, point, distance, normal }` or
null. `game.aim(distance)` is what the crosshair is on. `game.camera.forward` and `game.camera.position` are the view.


## Physics

Things with `physics: "dynamic"` fall, tumble, roll and stack; the rest stay put or move only when moved. Scripts can
push them around:

| Call | What |
|---|---|
| `e.push([x, y, z])` | Adds to its velocity (m/s). |
| `e.impulse([x, y, z])` | A kick: heavier things (`mass`) move less. |
| `e.force([x, y, z])` | A steady push for this step: call it every step (thrusters, wind). |
| `e.angularVelocity = [x, y, z]` | Spins it (degrees a second). |
| `e.upright = true` | It never tips over (characters, animals). |
| `game.physics.explode([x, y, z], { radius: 5, force: 15, damage: 40 })` | Throws everything nearby away and hurts what has health. |
| `game.physics.overlap(game.physics.shapes.sphere(3), [x, y, z])` | The things within 3 m. |
| `game.physics.joint('hinge', door, frame, { axis: [0, 1, 0], pivotA: [-0.5, 0, 0] })` | Joins two things: `fixed`, `hinge`, `ball`, `slider`, `distance`, `spring`. |
| `game.physics.gravity = -9.8` | The world's gravity (m/s², default -24, which feels like a game). |
